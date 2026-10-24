import { z } from "zod";

/**
 * Task events streamed from `GET /api/tasks/:id/events`.
 *
 * Object schemas strip unknown keys rather than rejecting them, so the backend
 * can add fields without breaking older frontends. Removing or renaming a field
 * is a breaking change and must be recorded in docs/CONTRACT.md.
 */

const nonEmptyText = z.string().trim().min(1);

/** Screenshots must be inline base64 images; anything else (http URLs, SVG, scripts) is rejected. */
export const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const baseEventShape = {
  taskId: nonEmptyText,
  /** Monotonic per task, starting at 0 or 1. The client ignores any event whose seq is <= the last one seen. */
  seq: z.int().nonnegative(),
  /** ISO 8601 timestamp; a UTC `Z` or a numeric offset are both accepted. */
  at: z.iso.datetime({ offset: true }),
};

export const actionTypeSchema = z.enum(["click", "double_click", "type", "key", "scroll", "wait"]);

export const narrationPrioritySchema = z.enum(["polite", "assertive"]);

export const userInputReasonSchema = z.enum(["sensitive_value", "captcha", "login", "other"]);

export const taskStartedEventSchema = z.object({
  ...baseEventShape,
  type: z.literal("task.started"),
  url: nonEmptyText,
  goal: nonEmptyText,
});

export const pageMapEventSchema = z.object({
  ...baseEventShape,
  type: z.literal("page.map"),
  title: nonEmptyText,
  summary: nonEmptyText,
  regions: z.array(
    z.object({
      name: nonEmptyText,
      description: z.string(),
    }),
  ),
});

const stepNumber = z.int().positive();

export const stepStartedEventSchema = z.object({
  ...baseEventShape,
  type: z.literal("step.started"),
  step: stepNumber,
  description: nonEmptyText,
  /** Optional estimate of total steps. It may change between events; the UI words it as "about N". */
  totalSteps: z.int().positive().optional(),
});

export const stepCompletedEventSchema = z.object({
  ...baseEventShape,
  type: z.literal("step.completed"),
  step: stepNumber,
  description: nonEmptyText,
  action: z.object({
    type: actionTypeSchema,
    label: z.string().optional(),
  }),
});

export const narrationEventSchema = z.object({
  ...baseEventShape,
  type: z.literal("narration"),
  text: nonEmptyText,
  priority: narrationPrioritySchema,
});

export const screenshotEventSchema = z.object({
  ...baseEventShape,
  type: z.literal("screenshot"),
  step: z.int().nonnegative(),
  imageDataUrl: z.string().regex(IMAGE_DATA_URL_PATTERN, {
    message: "imageDataUrl must be a base64 data URL of type png, jpeg, or webp",
  }),
  alt: nonEmptyText,
});

export const approvalRequiredEventSchema = z.object({
  ...baseEventShape,
  type: z.literal("approval.required"),
  approvalId: nonEmptyText,
  action: nonEmptyText,
  summary: nonEmptyText,
  fields: z.array(
    z.object({
      label: nonEmptyText,
      value: z.string(),
    }),
  ),
});

export const userInputRequiredEventSchema = z.object({
  ...baseEventShape,
  type: z.literal("user_input.required"),
  reason: userInputReasonSchema,
  instructions: nonEmptyText,
});

export const taskCompletedEventSchema = z.object({
  ...baseEventShape,
  type: z.literal("task.completed"),
  summary: nonEmptyText,
});

export const taskFailedEventSchema = z.object({
  ...baseEventShape,
  type: z.literal("task.failed"),
  code: nonEmptyText,
  message: nonEmptyText,
  recoverable: z.boolean(),
});

export const taskStoppedEventSchema = z.object({
  ...baseEventShape,
  type: z.literal("task.stopped"),
  by: z.enum(["user", "system"]),
});

export const taskEventSchema = z.discriminatedUnion("type", [
  taskStartedEventSchema,
  pageMapEventSchema,
  stepStartedEventSchema,
  stepCompletedEventSchema,
  narrationEventSchema,
  screenshotEventSchema,
  approvalRequiredEventSchema,
  userInputRequiredEventSchema,
  taskCompletedEventSchema,
  taskFailedEventSchema,
  taskStoppedEventSchema,
]);

export type TaskEvent = z.infer<typeof taskEventSchema>;
export type TaskEventType = TaskEvent["type"];
export type TaskEventOf<T extends TaskEventType> = Extract<TaskEvent, { type: T }>;
export type ActionType = z.infer<typeof actionTypeSchema>;
export type NarrationPriority = z.infer<typeof narrationPrioritySchema>;
export type UserInputReason = z.infer<typeof userInputReasonSchema>;

export type TaskStartedEvent = TaskEventOf<"task.started">;
export type PageMapEvent = TaskEventOf<"page.map">;
export type StepStartedEvent = TaskEventOf<"step.started">;
export type StepCompletedEvent = TaskEventOf<"step.completed">;
export type NarrationEvent = TaskEventOf<"narration">;
export type ScreenshotEvent = TaskEventOf<"screenshot">;
export type ApprovalRequiredEvent = TaskEventOf<"approval.required">;
export type UserInputRequiredEvent = TaskEventOf<"user_input.required">;
export type TaskCompletedEvent = TaskEventOf<"task.completed">;
export type TaskFailedEvent = TaskEventOf<"task.failed">;
export type TaskStoppedEvent = TaskEventOf<"task.stopped">;

export const TASK_EVENT_TYPES = [
  "task.started",
  "page.map",
  "step.started",
  "step.completed",
  "narration",
  "screenshot",
  "approval.required",
  "user_input.required",
  "task.completed",
  "task.failed",
  "task.stopped",
] as const satisfies readonly TaskEventType[];

export const TERMINAL_EVENT_TYPES = [
  "task.completed",
  "task.failed",
  "task.stopped",
] as const satisfies readonly TaskEventType[];

export type TerminalEvent = TaskEventOf<(typeof TERMINAL_EVENT_TYPES)[number]>;

const knownTypes: ReadonlySet<string> = new Set(TASK_EVENT_TYPES);
const terminalTypes: ReadonlySet<string> = new Set(TERMINAL_EVENT_TYPES);

export function isKnownEventType(type: string): type is TaskEventType {
  return knownTypes.has(type);
}

/** After a terminal event the server closes the stream and no further events are sent for that task. */
export function isTerminalEvent(event: TaskEvent): event is TerminalEvent {
  return terminalTypes.has(event.type);
}
