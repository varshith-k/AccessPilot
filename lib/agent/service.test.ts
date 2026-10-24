import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskEvent } from "@/lib/contracts";
import { AgentError } from "./errors";
import { createFakeDeps } from "./fakes";
import { TaskService } from "./service";
import { TaskStore } from "./taskStore";
import { act, click, done, makeDeps } from "./testkit";

afterEach(() => vi.useRealTimers());

const input = { url: "http://localhost:4000/scholarship", goal: "Apply" };

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof AgentError ? error.code : "other";
  }
  return undefined;
}

describe("TaskStore answers", () => {
  function waiting() {
    const store = new TaskStore();
    const task = store.create(input.url, input.goal);
    void task.waitForApproval("appr_1");
    return { store, task };
  }

  it("uses the contract's error codes", () => {
    const { store, task } = waiting();
    expect(codeOf(() => store.approve("task_nope", "appr_1"))).toBe("task_not_found");
    expect(codeOf(() => store.approve(task.id, "appr_2"))).toBe("approval_not_found");
    expect(codeOf(() => store.resume(task.id))).toBe("invalid_state"); // waiting for approval, not input
    store.approve(task.id, "appr_1");
    expect(codeOf(() => store.approve(task.id, "appr_1"))).toBe("invalid_state"); // already answered
  });

  it("refuses answers once the task has ended", () => {
    const { store, task } = waiting();
    store.stop(task.id);
    expect(codeOf(() => store.approve(task.id, "appr_1"))).toBe("invalid_state");
    expect(codeOf(() => store.stop(task.id))).toBeUndefined();
  });

  it("resolves a pending approval as stopped when stopped", async () => {
    const store = new TaskStore();
    const task = store.create(input.url, input.goal);
    const decision = task.waitForApproval("a");
    store.stop(task.id);
    await expect(decision).resolves.toBe("stopped");
  });
});

describe("TaskStore events", () => {
  it("replays only what a reconnecting client missed, then streams live", () => {
    const store = new TaskStore();
    const task = store.create(input.url, input.goal);
    task.emit({ type: "task.started", url: input.url, goal: input.goal });
    task.emit({ type: "narration", text: "One", priority: "polite" });
    task.emit({ type: "narration", text: "Two", priority: "polite" });

    const seen: number[] = [];
    store.subscribe(task.id, 1, (e: TaskEvent) => seen.push(e.seq));
    expect(seen).toEqual([2, 3]);
    task.emit({ type: "narration", text: "Three", priority: "polite" });
    expect(seen).toEqual([2, 3, 4]);
  });

  it("replays a finished task, terminal event included, and then nothing more", () => {
    const store = new TaskStore();
    const task = store.create(input.url, input.goal);
    task.emit({ type: "task.started", url: input.url, goal: input.goal });
    task.emit({ type: "task.completed", summary: "Done" });
    const seen: string[] = [];
    store.subscribe(task.id, 0, (e) => seen.push(e.type));
    task.emit({ type: "narration", text: "late", priority: "polite" });
    expect(seen).toEqual(["task.started", "task.completed"]);
  });

  it("rejects an event that breaks the contract instead of sending it", () => {
    const task = new TaskStore().create(input.url, input.goal);
    expect(() => task.emit({ type: "narration", text: "   ", priority: "polite" })).toThrow();
    expect(task.events).toHaveLength(0);
  });

  it("stops listening when unsubscribed", () => {
    const store = new TaskStore();
    const task = store.create(input.url, input.goal);
    const seen: number[] = [];
    const off = store.subscribe(task.id, 0, (e) => seen.push(e.seq));
    task.emit({ type: "narration", text: "a", priority: "polite" });
    off();
    task.emit({ type: "narration", text: "b", priority: "polite" });
    expect(seen).toEqual([1]);
  });
});

describe("TaskService", () => {
  it("refuses new tasks beyond the concurrency limit, with a plain message", () => {
    const service = new TaskService({
      getDeps: () => makeDeps([act(click("s", 1, 1, "Submit", true))]).deps,
      maxConcurrent: 1,
    });
    const first = service.start(input);
    expect(() => service.start(input)).toThrow(/already busy/);
    service.stop(first.taskId);
  });

  it("stops a task that runs past its time limit, as the system", async () => {
    vi.useFakeTimers();
    const events: TaskEvent[] = [];
    const service = new TaskService({
      getDeps: () => makeDeps([act(click("s", 1, 1, "Submit", true))]).deps,
      maxDurationMs: 1_000,
    });
    const { taskId } = service.start(input);
    service.subscribe(taskId, 0, (e) => events.push(e));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(events.at(-1)).toMatchObject({ type: "task.stopped", by: "system" });
  });

  it("surfaces missing configuration when the task starts", () => {
    const service = new TaskService({
      getDeps: () => {
        throw new AgentError("internal_error", "Not set up.");
      },
    });
    expect(() => service.start(input)).toThrow("Not set up.");
  });

  it("runs the scripted flow end to end", async () => {
    const service = new TaskService({ getDeps: () => createFakeDeps({ stepDelayMs: 0 }) });
    const { taskId } = service.start(input);
    const events: TaskEvent[] = [];
    service.subscribe(taskId, 0, (e) => events.push(e));
    await vi.waitFor(() => expect(events.some((e) => e.type === "approval.required")).toBe(true));
    const approval = events.find((e) => e.type === "approval.required");
    service.approve(taskId, approval && "approvalId" in approval ? approval.approvalId : "");
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe("task.completed"));
    expect(done().kind).toBe("done");
  });
});
