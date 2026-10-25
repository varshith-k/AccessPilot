import type { TaskEvent, TaskEventType } from "@/lib/contracts";
import {
  initialTaskState,
  transition,
  type TaskInput,
  type TaskState,
  type UiAction,
  type UiActionType,
} from "@/lib/client/taskState";

export const TASK_ID = "task-1";
export const AT = "2026-10-25T14:00:00.000Z";
export const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** Every seq handed out, by makeEvent or by re-stamping, is larger than all earlier ones. */
let seq = 1000;

/** Builds an event for TASK_ID with an increasing seq. */
export function makeEvent<T extends TaskEventType>(
  type: T,
  overrides: Partial<Extract<TaskEvent, { type: T }>> = {},
): Extract<TaskEvent, { type: T }> {
  seq += 1;
  const base = { taskId: TASK_ID, seq, at: AT };
  const payloads: {
    [K in TaskEventType]: Omit<Extract<TaskEvent, { type: K }>, "taskId" | "seq" | "at">;
  } = {
    "task.started": { type: "task.started", url: "https://example.edu/apply", goal: "Apply" },
    "page.map": {
      type: "page.map",
      title: "Scholarship",
      summary: "This page has a form.",
      regions: [{ name: "Form", description: "Five fields" }],
    },
    "step.started": {
      type: "step.started",
      step: 1,
      description: "Filling in your name",
      totalSteps: 6,
    },
    "step.completed": {
      type: "step.completed",
      step: 1,
      description: "Filled in your name",
      action: { type: "type", label: "Full name" },
    },
    narration: { type: "narration", text: "Typing your name.", priority: "polite" },
    screenshot: { type: "screenshot", step: 1, imageDataUrl: PNG, alt: "Name filled in" },
    "approval.required": {
      type: "approval.required",
      approvalId: "approval-1",
      action: "Submit application",
      summary: "Submit the application?",
      fields: [{ label: "Name", value: "Ada" }],
    },
    "user_input.required": {
      type: "user_input.required",
      reason: "sensitive_value",
      instructions: "Type your password, then press Continue.",
    },
    "task.completed": { type: "task.completed", summary: "Submitted. Confirmation number 4821." },
    "task.failed": { type: "task.failed", code: "boom", message: "It broke.", recoverable: true },
    "task.stopped": { type: "task.stopped", by: "user" },
  };
  return { ...base, ...payloads[type], ...overrides } as unknown as Extract<TaskEvent, { type: T }>;
}

export function makeUiAction(type: UiActionType): UiAction {
  switch (type) {
    case "ui/start_requested":
      return { type, url: "https://example.edu/apply", goal: "Apply", at: AT };
    case "ui/start_succeeded":
      return { type, taskId: TASK_ID };
    case "ui/decision_failed":
    case "ui/resume_failed":
      return { type, message: "Something failed.", at: AT, failure: "retry" };
    case "ui/start_failed":
    case "ui/stop_failed":
    case "ui/connection_lost":
      return { type, message: "Something failed.", at: AT };
    case "ui/decision_sent":
      return { type, decision: "approve", at: AT };
    case "ui/resume_sent":
    case "ui/stop_succeeded":
      return { type, at: AT };
    case "ui/decision_succeeded":
    case "ui/resume_succeeded":
    case "ui/stop_requested":
    case "ui/reset":
      return { type };
    case "ui/warning":
      return { type, message: "Skipped an unreadable update." };
    case "ui/warning_dismissed":
      return { type, id: "warning-404" };
    case "ui/user_message":
      return { type, text: "Also check the deadline", at: AT };
  }
}

/**
 * Applies inputs in order and fails loudly if any of them is ignored. Events built before the
 * starting state (argument evaluation order) are re-stamped with the next seq.
 */
export function reach(inputs: TaskInput[], from: TaskState = initialTaskState): TaskState {
  return inputs.reduce((state, input) => {
    const next =
      !input.type.startsWith("ui/") && "seq" in input && input.seq <= state.lastSeq
        ? { ...input, seq: ++seq }
        : input;
    const result = transition(state, next);
    if (result.ignored !== null) {
      throw new Error(`fixture input ${input.type} was ignored: ${result.ignored}`);
    }
    return result.state;
  }, from);
}

export const startingNoId = () => reach([makeUiAction("ui/start_requested")]);
export const startingWithId = () => reach([makeUiAction("ui/start_succeeded")], startingNoId());
export const planning = () => reach([makeEvent("task.started")], startingWithId());
export const running = () => reach([makeEvent("page.map")], planning());
export const awaitingApproval = () => reach([makeEvent("approval.required")], running());
export const awaitingUser = () => reach([makeEvent("user_input.required")], running());
export const completed = () => reach([makeEvent("task.completed")], running());
export const failed = () => reach([makeEvent("task.failed")], running());
export const stopped = () => reach([makeEvent("task.stopped")], running());
