import { randomUUID } from "node:crypto";
import { isTerminalEvent, taskEventSchema, type TaskEvent } from "@/lib/contracts";
import { AgentError } from "./errors";
import type { ApprovalDecision, EventInput, ResumeDecision, TaskControl } from "./types";

type Pending =
  | { kind: "approval"; approvalId: string; resolve: (decision: ApprovalDecision) => void }
  | { kind: "input"; resolve: (decision: ResumeDecision) => void };

export interface TaskRecord extends TaskControl {
  readonly id: string;
  readonly url: string;
  readonly goal: string;
  readonly events: readonly TaskEvent[];
  readonly ended: boolean;
}

interface InternalRecord extends TaskRecord {
  events: TaskEvent[];
  ended: boolean;
  listeners: Set<(event: TaskEvent) => void>;
  controller: AbortController;
  pending: Pending | null;
}

/** Finished tasks kept for replay; the oldest are dropped beyond this. */
const MAX_KEPT_TASKS = 50;

/**
 * In-memory registry of tasks. It owns the event log (so a reconnecting client can replay),
 * the sequence numbers, and the gates the user opens with approve, deny, resume and stop.
 */
export class TaskStore {
  private readonly tasks = new Map<string, InternalRecord>();

  create(url: string, goal: string): TaskRecord {
    const id = `task_${randomUUID().slice(0, 8)}`;
    const controller = new AbortController();
    let seq = 0;

    const record: InternalRecord = {
      id,
      url,
      goal,
      events: [],
      ended: false,
      listeners: new Set(),
      controller,
      pending: null,
      signal: controller.signal,
      emit: (input: EventInput) => {
        if (record.ended) return;
        const event = taskEventSchema.parse({
          ...input,
          taskId: id,
          seq: ++seq,
          at: new Date().toISOString(),
        });
        record.events.push(event);
        if (isTerminalEvent(event)) record.ended = true;
        for (const listener of [...record.listeners]) listener(event);
      },
      waitForApproval: (approvalId) =>
        new Promise<ApprovalDecision>((resolve) => {
          record.pending = { kind: "approval", approvalId, resolve };
        }),
      waitForResume: () =>
        new Promise<ResumeDecision>((resolve) => {
          record.pending = { kind: "input", resolve };
        }),
    };

    this.tasks.set(id, record);
    this.evict();
    return record;
  }

  private evict(): void {
    if (this.tasks.size <= MAX_KEPT_TASKS) return;
    for (const [id, task] of this.tasks) {
      if (this.tasks.size <= MAX_KEPT_TASKS) break;
      if (task.ended) this.tasks.delete(id);
    }
  }

  private get(taskId: string): InternalRecord {
    const task = this.tasks.get(taskId);
    if (!task)
      throw new AgentError("task_not_found", "I can't find that task. Please start a new one.");
    return task;
  }

  /** Throws `task_not_found` for an unknown id. */
  assertExists(taskId: string): void {
    this.get(taskId);
  }

  /** Number of tasks that have not reached a terminal event. */
  activeCount(): number {
    let count = 0;
    for (const task of this.tasks.values()) if (!task.ended) count++;
    return count;
  }

  /** Replays events after `afterSeq`, then streams new ones. Returns an unsubscribe function. */
  subscribe(taskId: string, afterSeq: number, listener: (event: TaskEvent) => void): () => void {
    const task = this.get(taskId);
    for (const event of [...task.events]) if (event.seq > afterSeq) listener(event);
    if (task.ended) return () => {};
    task.listeners.add(listener);
    return () => task.listeners.delete(listener);
  }

  approve(taskId: string, approvalId: string): void {
    this.decide(taskId, approvalId, "approve");
  }

  deny(taskId: string, approvalId: string): void {
    this.decide(taskId, approvalId, "deny");
  }

  private decide(taskId: string, approvalId: string, decision: "approve" | "deny"): void {
    const task = this.get(taskId);
    const pending = task.pending;
    if (task.ended || pending?.kind !== "approval") {
      throw new AgentError("invalid_state", "This task is no longer waiting for approval.");
    }
    // Never act on a different pending approval than the one the user was shown.
    if (pending.approvalId !== approvalId) {
      throw new AgentError("approval_not_found", "That approval request is no longer current.");
    }
    task.pending = null;
    pending.resolve(decision);
  }

  resume(taskId: string): void {
    const task = this.get(taskId);
    const pending = task.pending;
    if (task.ended || pending?.kind !== "input") {
      throw new AgentError("invalid_state", "This task is not waiting for you right now.");
    }
    task.pending = null;
    pending.resolve("resume");
  }

  /** Ends the task immediately. Safe to call on a task that already ended. */
  stop(taskId: string, by: "user" | "system" = "user"): void {
    const task = this.get(taskId);
    if (task.ended) return;
    task.emit({ type: "task.stopped", by });
    task.controller.abort();
    const pending = task.pending;
    task.pending = null;
    pending?.resolve("stopped");
  }
}
