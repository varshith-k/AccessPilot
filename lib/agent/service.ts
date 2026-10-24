import { AgentError } from "./errors";
import { runTask } from "./orchestrator";
import { TaskStore } from "./taskStore";
import { DEFAULT_LIMITS, type AgentDeps, type AgentLimits } from "./types";
import type { TaskEvent } from "@/lib/contracts";

export interface TaskServiceOptions {
  /** Called once per task, so a missing configuration surfaces as a plain error when the task starts. */
  getDeps: () => AgentDeps;
  limits?: AgentLimits;
  /** Hard cap on how long one task may run. At the limit it is stopped by the system. */
  maxDurationMs?: number;
  /** Each task launches a browser, so only a few may run at once. */
  maxConcurrent?: number;
}

/** What the API routes talk to: start a task, watch its events, answer its questions, stop it. */
export class TaskService {
  private readonly store = new TaskStore();

  constructor(private readonly options: TaskServiceOptions) {}

  start(input: { url: string; goal: string }): { taskId: string } {
    if (this.store.activeCount() >= (this.options.maxConcurrent ?? 2)) {
      throw new AgentError(
        "invalid_state",
        "AccessPilot is already busy with other tasks. Please wait for one to finish, then try again.",
      );
    }
    const deps = this.options.getDeps();
    const task = this.store.create(input.url, input.goal);

    const deadline = setTimeout(
      () => this.store.stop(task.id, "system"),
      this.options.maxDurationMs ?? 5 * 60_000,
    );
    deadline.unref?.();

    void runTask(deps, task, input, this.options.limits ?? DEFAULT_LIMITS).finally(() =>
      clearTimeout(deadline),
    );
    return { taskId: task.id };
  }

  assertExists(taskId: string): void {
    this.store.assertExists(taskId);
  }

  subscribe(taskId: string, afterSeq: number, listener: (event: TaskEvent) => void): () => void {
    return this.store.subscribe(taskId, afterSeq, listener);
  }

  approve(taskId: string, approvalId: string): void {
    this.store.approve(taskId, approvalId);
  }

  deny(taskId: string, approvalId: string): void {
    this.store.deny(taskId, approvalId);
  }

  resume(taskId: string): void {
    this.store.resume(taskId);
  }

  stop(taskId: string): void {
    this.store.stop(taskId, "user");
  }
}
