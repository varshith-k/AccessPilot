import {
  isTerminalEvent,
  startTaskRequestSchema,
  taskEventSchema,
  type StartTaskRequest,
  type TaskEvent,
} from "@/lib/contracts";
import { TaskClientError } from "./errors";
import {
  mockScenarios,
  type MockScenarioName,
  type ScriptedEvent,
  type ScriptStep,
} from "./mock/scenarios";
import { realScheduler, type Scheduler, type TimerHandle } from "./scheduler";
import type { TaskClient } from "./types";

export interface MockTaskClientOptions {
  scenario?: MockScenarioName;
  scheduler?: Scheduler;
  /** Multiplies every scripted delay. 0 emits everything on the next tick. */
  speed?: number;
  /** Simulated latency of approve, deny, resume, and stop calls, in ms. */
  latencyMs?: number;
}

interface Listener {
  onEvent: (event: TaskEvent) => void;
  onError: (error: Error) => void;
}

interface MockRun {
  taskId: string;
  queue: ScriptStep[];
  /** Every event emitted so far, replayed to a new subscriber like a server would. */
  history: TaskEvent[];
  seq: number;
  timer: TimerHandle | null;
  waitingFor:
    | { kind: "approval"; step: Extract<ScriptStep, { kind: "await_approval" }> }
    | { kind: "resume"; step: Extract<ScriptStep, { kind: "await_resume" }> }
    | null;
  listener: Listener | null;
  ended: boolean;
}

function conflict(message: string): TaskClientError {
  return new TaskClientError({ kind: "http", status: 409, code: "invalid_state", message });
}

/**
 * Deterministic in-memory backend that plays a scripted scenario. It honors approve, deny,
 * resume, and stop the same way the real backend must, and pauses while nobody is subscribed.
 */
export class MockTaskClient implements TaskClient {
  private readonly scenario: MockScenarioName;
  private readonly scheduler: Scheduler;
  private readonly speed: number;
  private readonly latencyMs: number;
  private readonly runs = new Map<string, MockRun>();
  private nextId = 1;

  constructor(options: MockTaskClientOptions = {}) {
    this.scenario = options.scenario ?? "scholarship-happy";
    this.scheduler = options.scheduler ?? realScheduler;
    this.speed = options.speed ?? 1;
    this.latencyMs = options.latencyMs ?? 150;
  }

  get scenarioName(): MockScenarioName {
    return this.scenario;
  }

  async start(input: StartTaskRequest): Promise<{ taskId: string }> {
    await this.delay();
    const parsed = startTaskRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new TaskClientError({
        kind: "http",
        status: 400,
        code: "invalid_request",
        message: parsed.error.issues[0]?.message ?? "That request was not valid.",
      });
    }
    const taskId = `mock-${this.scenario}-${this.nextId++}`;
    const run: MockRun = {
      taskId,
      queue: [...mockScenarios[this.scenario].script],
      history: [],
      seq: 0,
      timer: null,
      waitingFor: null,
      listener: null,
      ended: false,
    };
    this.runs.set(taskId, run);
    this.record(run, { type: "task.started", url: parsed.data.url, goal: parsed.data.goal });
    return { taskId };
  }

  subscribe(
    taskId: string,
    onEvent: (event: TaskEvent) => void,
    onError: (error: Error) => void,
  ): () => void {
    const run = this.runs.get(taskId);
    if (!run) {
      this.scheduler.setTimeout(
        () =>
          onError(
            new TaskClientError({
              kind: "connection_lost",
              message: "That task could not be found. Please start it again.",
            }),
          ),
        0,
      );
      return () => undefined;
    }

    const listener: Listener = { onEvent, onError };
    run.listener = listener;
    const replay = [...run.history];
    this.scheduler.setTimeout(() => {
      if (run.listener !== listener) return;
      for (const event of replay) listener.onEvent(event);
      this.advance(run);
    }, 0);

    return () => {
      if (run.listener !== listener) return;
      run.listener = null;
      this.clearTimer(run);
    };
  }

  async approve(taskId: string, approvalId: string): Promise<void> {
    await this.delay();
    this.decide(taskId, approvalId, "approve");
  }

  async deny(taskId: string, approvalId: string, _reason?: string): Promise<void> {
    await this.delay();
    this.decide(taskId, approvalId, "deny");
  }

  async resume(taskId: string): Promise<void> {
    await this.delay();
    const run = this.requireRun(taskId);
    if (run.ended || run.waitingFor?.kind !== "resume") {
      throw conflict("This task is not waiting for you to continue.");
    }
    const { step } = run.waitingFor;
    run.waitingFor = null;
    run.queue = [...step.then, ...run.queue];
    this.advance(run);
  }

  async stop(taskId: string): Promise<void> {
    await this.delay();
    const run = this.requireRun(taskId);
    if (run.ended) return;
    this.clearTimer(run);
    run.queue = [];
    run.waitingFor = null;
    this.emit(run, { type: "task.stopped", by: "user" });
  }

  private decide(taskId: string, approvalId: string, decision: "approve" | "deny"): void {
    const run = this.requireRun(taskId);
    if (run.ended || run.waitingFor?.kind !== "approval") {
      throw conflict("This task is not waiting for approval.");
    }
    const { step } = run.waitingFor;
    if (step.approvalId !== approvalId) {
      throw new TaskClientError({
        kind: "http",
        status: 404,
        code: "approval_not_found",
        message: "That approval request has expired.",
      });
    }
    run.waitingFor = null;
    run.queue = [...(decision === "approve" ? step.approve : step.deny), ...run.queue];
    this.advance(run);
  }

  private requireRun(taskId: string): MockRun {
    const run = this.runs.get(taskId);
    if (!run) {
      throw new TaskClientError({
        kind: "http",
        status: 404,
        code: "task_not_found",
        message: "That task no longer exists.",
      });
    }
    return run;
  }

  /** Schedules the next scripted step, unless paused, ended, or nobody is listening. */
  private advance(run: MockRun): void {
    if (run.ended || run.timer !== null || run.waitingFor !== null || run.listener === null) return;
    const next = run.queue[0];
    if (next === undefined) return;

    if (next.kind === "await_approval") {
      run.queue.shift();
      run.waitingFor = { kind: "approval", step: next };
      return;
    }
    if (next.kind === "await_resume") {
      run.queue.shift();
      run.waitingFor = { kind: "resume", step: next };
      return;
    }
    run.timer = this.scheduler.setTimeout(() => {
      run.timer = null;
      run.queue.shift();
      this.emit(run, next.event);
      this.advance(run);
    }, next.delayMs * this.speed);
  }

  private record(run: MockRun, scripted: ScriptedEvent): TaskEvent {
    run.seq += 1;
    // Validating here keeps every scripted scenario honest against the contract.
    const event = taskEventSchema.parse({
      ...scripted,
      taskId: run.taskId,
      seq: run.seq,
      at: new Date(this.scheduler.now()).toISOString(),
    });
    run.history.push(event);
    if (isTerminalEvent(event)) {
      run.ended = true;
      run.queue = [];
    }
    return event;
  }

  private emit(run: MockRun, scripted: ScriptedEvent): void {
    const event = this.record(run, scripted);
    run.listener?.onEvent(event);
  }

  private clearTimer(run: MockRun): void {
    if (run.timer !== null) {
      this.scheduler.clearTimeout(run.timer);
      run.timer = null;
    }
  }

  private delay(): Promise<void> {
    if (this.latencyMs <= 0) return Promise.resolve();
    return new Promise((resolve) => this.scheduler.setTimeout(resolve, this.latencyMs));
  }
}
