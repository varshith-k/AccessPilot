import type {
  ApprovalRequiredEvent,
  PageMapEvent,
  StepCompletedEvent,
  TaskEvent,
  TaskEventType,
  UserInputRequiredEvent,
} from "@/lib/contracts";

export type TaskStatus =
  | "idle"
  | "starting"
  | "planning"
  | "running"
  | "awaiting_approval"
  | "awaiting_user"
  | "completed"
  | "failed"
  | "stopped";

export const TASK_STATUSES = [
  "idle",
  "starting",
  "planning",
  "running",
  "awaiting_approval",
  "awaiting_user",
  "completed",
  "failed",
  "stopped",
] as const satisfies readonly TaskStatus[];

const TERMINAL: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "stopped"]);

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}

/** A task is active from the moment the user asks to start it until it reaches a terminal state. */
export function isActiveStatus(status: TaskStatus): boolean {
  return status !== "idle" && !isTerminalStatus(status);
}

export type StepStatus = "active" | "completed" | "incomplete";

export interface StepEntry {
  step: number;
  description: string;
  status: StepStatus;
  action: StepCompletedEvent["action"] | null;
}

export type Speaker = "user" | "assistant" | "system";
export type LogTone = "info" | "success" | "warning" | "error";

export interface LogEntry {
  id: string;
  speaker: Speaker;
  text: string;
  at: string;
  tone: LogTone;
}

export interface ScreenshotEntry {
  id: string;
  step: number;
  imageDataUrl: string;
  alt: string;
  at: string;
}

export type PageMap = Pick<PageMapEvent, "title" | "summary" | "regions">;
export type PendingApproval = Pick<
  ApprovalRequiredEvent,
  "approvalId" | "action" | "summary" | "fields"
>;
export type Handoff = Pick<UserInputRequiredEvent, "reason" | "instructions">;

export interface TaskError {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface Warning {
  id: string;
  message: string;
}

export interface TaskState {
  status: TaskStatus;
  taskId: string | null;
  request: { url: string; goal: string } | null;
  /** Highest event seq applied for the current task; -1 before any event. */
  lastSeq: number;
  pageMap: PageMap | null;
  steps: StepEntry[];
  currentStep: number | null;
  totalSteps: number | null;
  /** Conversation and narration history. Kept across tasks so the user can review it. */
  log: LogEntry[];
  screenshots: ScreenshotEntry[];
  approval: PendingApproval | null;
  /** The decision the user sent and is waiting on, kept so a failed request can restore the dialog. */
  pendingDecision: { decision: "approve" | "deny"; approval: PendingApproval } | null;
  handoff: Handoff | null;
  pendingResume: Handoff | null;
  stopping: boolean;
  stoppedBy: "user" | "system" | null;
  outcome: string | null;
  error: TaskError | null;
  warnings: Warning[];
  lastNarration: string | null;
  nextLocalId: number;
}

export type UiAction =
  | { type: "ui/start_requested"; url: string; goal: string; at: string }
  | { type: "ui/start_succeeded"; taskId: string }
  | { type: "ui/start_failed"; message: string; at: string }
  | { type: "ui/decision_sent"; decision: "approve" | "deny"; at: string }
  | { type: "ui/decision_succeeded" }
  | { type: "ui/decision_failed"; message: string; at: string }
  | { type: "ui/resume_sent"; at: string }
  | { type: "ui/resume_succeeded" }
  | { type: "ui/resume_failed"; message: string; at: string }
  | { type: "ui/stop_requested" }
  | { type: "ui/stop_succeeded"; at: string }
  | { type: "ui/stop_failed"; message: string; at: string }
  | { type: "ui/connection_lost"; message: string; at: string }
  | { type: "ui/warning"; message: string }
  | { type: "ui/warning_dismissed"; id: string }
  | { type: "ui/user_message"; text: string; at: string }
  | { type: "ui/reset" };

export type UiActionType = UiAction["type"];
export type TaskInput = TaskEvent | UiAction;

export const MAX_WARNINGS = 5;

export const initialTaskState: TaskState = {
  status: "idle",
  taskId: null,
  request: null,
  lastSeq: -1,
  pageMap: null,
  steps: [],
  currentStep: null,
  totalSteps: null,
  log: [],
  screenshots: [],
  approval: null,
  pendingDecision: null,
  handoff: null,
  pendingResume: null,
  stopping: false,
  stoppedBy: null,
  outcome: null,
  error: null,
  warnings: [],
  lastNarration: null,
  nextLocalId: 1,
};

export interface TransitionResult {
  state: TaskState;
  /** Why the input was ignored, or null when it was applied. */
  ignored: string | null;
}

function isUiAction(input: TaskInput): input is UiAction {
  return input.type.startsWith("ui/");
}

const applied = (state: TaskState): TransitionResult => ({ state, ignored: null });
const ignore = (state: TaskState, reason: string): TransitionResult => ({ state, ignored: reason });

function withLocalLog(state: TaskState, entry: Omit<LogEntry, "id">): TaskState {
  return {
    ...state,
    log: [...state.log, { ...entry, id: `local-${state.nextLocalId}` }],
    nextLocalId: state.nextLocalId + 1,
  };
}

function withEventLog(
  state: TaskState,
  event: TaskEvent,
  speaker: Speaker,
  text: string,
  tone: LogTone,
): TaskState {
  return {
    ...state,
    log: [...state.log, { id: `${event.taskId}-${event.seq}`, speaker, text, at: event.at, tone }],
  };
}

function withWarning(state: TaskState, message: string): TaskState {
  const warning = { id: `warning-${state.nextLocalId}`, message };
  return {
    ...state,
    warnings: [...state.warnings, warning].slice(-MAX_WARNINGS),
    nextLocalId: state.nextLocalId + 1,
  };
}

/** Steps still marked active when a task ends did not finish. */
function closeOpenSteps(steps: StepEntry[]): StepEntry[] {
  return steps.map((entry) =>
    entry.status === "active" ? { ...entry, status: "incomplete" } : entry,
  );
}

function upsertStep(steps: StepEntry[], next: StepEntry): StepEntry[] {
  const index = steps.findIndex((entry) => entry.step === next.step);
  if (index === -1) return [...steps, next].sort((a, b) => a.step - b.step);
  return steps.map((entry, i) => (i === index ? next : entry));
}

/** Leaves the task in a terminal status and drops anything that was waiting on the user. */
function finish(state: TaskState, status: "completed" | "failed" | "stopped"): TaskState {
  return {
    ...state,
    status,
    steps: closeOpenSteps(state.steps),
    approval: null,
    pendingDecision: null,
    handoff: null,
    pendingResume: null,
    stopping: false,
  };
}

const EVENT_ALLOWED_IN: { [T in TaskEventType]: ReadonlySet<TaskStatus> } = {
  "task.started": new Set(["starting"]),
  "page.map": new Set(["planning", "running"]),
  "step.started": new Set(["planning", "running"]),
  "step.completed": new Set(["running"]),
  narration: new Set(["planning", "running", "awaiting_approval", "awaiting_user"]),
  screenshot: new Set(["planning", "running", "awaiting_approval", "awaiting_user"]),
  "approval.required": new Set(["running"]),
  "user_input.required": new Set(["planning", "running"]),
  "task.completed": new Set(["planning", "running"]),
  "task.failed": new Set(["starting", "planning", "running", "awaiting_approval", "awaiting_user"]),
  "task.stopped": new Set([
    "starting",
    "planning",
    "running",
    "awaiting_approval",
    "awaiting_user",
  ]),
};

function applyEvent(state: TaskState, event: TaskEvent): TransitionResult {
  if (state.taskId === null || event.taskId !== state.taskId) {
    return ignore(state, `event for task "${event.taskId}" does not match the current task`);
  }
  if (event.seq <= state.lastSeq) {
    return ignore(state, `duplicate or out-of-order event (seq ${event.seq} <= ${state.lastSeq})`);
  }
  if (!EVENT_ALLOWED_IN[event.type].has(state.status)) {
    return ignore(
      { ...state, lastSeq: event.seq },
      `${event.type} is not valid while ${state.status}`,
    );
  }

  // Any accepted event means the server has moved past an in-flight approve, deny, or resume.
  const base: TaskState = {
    ...state,
    lastSeq: event.seq,
    pendingDecision: null,
    pendingResume: null,
  };

  switch (event.type) {
    case "task.started":
      return applied({
        ...base,
        status: "planning",
        request: { url: event.url, goal: event.goal },
      });

    case "page.map":
      return applied(
        withEventLog(
          {
            ...base,
            status: "running",
            pageMap: { title: event.title, summary: event.summary, regions: event.regions },
          },
          event,
          "assistant",
          event.summary,
          "info",
        ),
      );

    case "step.started":
      return applied({
        ...base,
        status: "running",
        steps: upsertStep(base.steps, {
          step: event.step,
          description: event.description,
          status: "active",
          action: null,
        }),
        currentStep: event.step,
        totalSteps: event.totalSteps ?? base.totalSteps,
      });

    case "step.completed":
      return applied({
        ...base,
        steps: upsertStep(base.steps, {
          step: event.step,
          description: event.description,
          status: "completed",
          action: event.action,
        }),
      });

    case "narration":
      return applied(
        withEventLog(
          { ...base, lastNarration: event.text },
          event,
          "assistant",
          event.text,
          event.priority === "assertive" ? "warning" : "info",
        ),
      );

    case "screenshot":
      return applied({
        ...base,
        screenshots: [
          ...base.screenshots,
          {
            id: `${event.taskId}-${event.seq}`,
            step: event.step,
            imageDataUrl: event.imageDataUrl,
            alt: event.alt,
            at: event.at,
          },
        ],
      });

    case "approval.required":
      return applied(
        withEventLog(
          {
            ...base,
            status: "awaiting_approval",
            approval: {
              approvalId: event.approvalId,
              action: event.action,
              summary: event.summary,
              fields: event.fields,
            },
          },
          event,
          "assistant",
          `Waiting for your approval: ${event.summary}`,
          "warning",
        ),
      );

    case "user_input.required":
      return applied(
        withEventLog(
          {
            ...base,
            status: "awaiting_user",
            handoff: { reason: event.reason, instructions: event.instructions },
          },
          event,
          "assistant",
          event.instructions,
          "warning",
        ),
      );

    case "task.completed":
      return applied(
        withEventLog(
          { ...finish(base, "completed"), outcome: event.summary },
          event,
          "assistant",
          event.summary,
          "success",
        ),
      );

    case "task.failed":
      return applied(
        withEventLog(
          {
            ...finish(base, "failed"),
            error: { code: event.code, message: event.message, recoverable: event.recoverable },
          },
          event,
          "system",
          event.message,
          "error",
        ),
      );

    case "task.stopped":
      return applied(
        withEventLog(
          { ...finish(base, "stopped"), stoppedBy: event.by },
          event,
          "system",
          event.by === "user" ? STOPPED_BY_USER_TEXT : "AccessPilot stopped the task.",
          "warning",
        ),
      );
  }
}

export const STOPPED_BY_USER_TEXT = "Stopped. AccessPilot will not do anything else on this page.";

function applyUiAction(state: TaskState, action: UiAction): TransitionResult {
  switch (action.type) {
    case "ui/start_requested": {
      if (isActiveStatus(state.status)) {
        return ignore(state, `cannot start a task while ${state.status}`);
      }
      const fresh: TaskState = {
        ...initialTaskState,
        status: "starting",
        request: { url: action.url, goal: action.goal },
        log: state.log,
        nextLocalId: state.nextLocalId,
      };
      return applied(
        withLocalLog(fresh, { speaker: "user", text: action.goal, at: action.at, tone: "info" }),
      );
    }

    case "ui/start_succeeded":
      if (state.status !== "starting" || state.taskId !== null) {
        return ignore(state, `start_succeeded is not valid while ${state.status}`);
      }
      return applied({ ...state, taskId: action.taskId });

    case "ui/start_failed":
      if (state.status !== "starting") {
        return ignore(state, `start_failed is not valid while ${state.status}`);
      }
      return applied(
        withLocalLog(
          {
            ...finish(state, "failed"),
            error: { code: "start_failed", message: action.message, recoverable: true },
          },
          { speaker: "system", text: action.message, at: action.at, tone: "error" },
        ),
      );

    case "ui/decision_sent": {
      if (
        state.status !== "awaiting_approval" ||
        state.approval === null ||
        state.pendingDecision !== null
      ) {
        return ignore(state, `decision_sent is not valid while ${state.status}`);
      }
      const text =
        action.decision === "approve"
          ? `Approved: ${state.approval.action}`
          : `Declined: ${state.approval.action}`;
      return applied(
        withLocalLog(
          {
            ...state,
            status: "running",
            approval: null,
            pendingDecision: { decision: action.decision, approval: state.approval },
          },
          { speaker: "user", text, at: action.at, tone: "info" },
        ),
      );
    }

    case "ui/decision_succeeded":
      if (state.pendingDecision === null) {
        return ignore(state, "no decision is in flight");
      }
      return applied({ ...state, pendingDecision: null });

    case "ui/decision_failed":
      if (state.pendingDecision === null || state.status !== "running") {
        return ignore(state, "no decision is in flight to roll back");
      }
      return applied(
        withLocalLog(
          {
            ...state,
            status: "awaiting_approval",
            approval: state.pendingDecision.approval,
            pendingDecision: null,
          },
          { speaker: "system", text: action.message, at: action.at, tone: "error" },
        ),
      );

    case "ui/resume_sent":
      if (state.status !== "awaiting_user" || state.handoff === null) {
        return ignore(state, `resume_sent is not valid while ${state.status}`);
      }
      return applied(
        withLocalLog(
          { ...state, status: "running", handoff: null, pendingResume: state.handoff },
          { speaker: "user", text: "Continue", at: action.at, tone: "info" },
        ),
      );

    case "ui/resume_succeeded":
      if (state.pendingResume === null) {
        return ignore(state, "no resume is in flight");
      }
      return applied({ ...state, pendingResume: null });

    case "ui/resume_failed":
      if (state.pendingResume === null || state.status !== "running") {
        return ignore(state, "no resume is in flight to roll back");
      }
      return applied(
        withLocalLog(
          {
            ...state,
            status: "awaiting_user",
            handoff: state.pendingResume,
            pendingResume: null,
          },
          { speaker: "system", text: action.message, at: action.at, tone: "error" },
        ),
      );

    case "ui/stop_requested":
      if (!isActiveStatus(state.status) || state.stopping) {
        return ignore(state, `stop_requested is not valid while ${state.status}`);
      }
      return applied({ ...state, stopping: true });

    case "ui/stop_succeeded":
      if (!isActiveStatus(state.status)) {
        return ignore(state, `stop_succeeded is not valid while ${state.status}`);
      }
      return applied(
        withLocalLog(
          { ...finish(state, "stopped"), stoppedBy: "user" },
          { speaker: "system", text: STOPPED_BY_USER_TEXT, at: action.at, tone: "warning" },
        ),
      );

    case "ui/stop_failed":
      if (!state.stopping) {
        return ignore(state, "no stop is in flight");
      }
      return applied(
        withLocalLog(
          { ...state, stopping: false },
          { speaker: "system", text: action.message, at: action.at, tone: "error" },
        ),
      );

    case "ui/connection_lost":
      if (!isActiveStatus(state.status) || state.taskId === null) {
        return ignore(state, `connection_lost is not valid while ${state.status}`);
      }
      return applied(
        withLocalLog(
          {
            ...finish(state, "failed"),
            error: { code: "connection_lost", message: action.message, recoverable: true },
          },
          { speaker: "system", text: action.message, at: action.at, tone: "error" },
        ),
      );

    case "ui/warning":
      return applied(withWarning(state, action.message));

    case "ui/warning_dismissed": {
      if (!state.warnings.some((warning) => warning.id === action.id)) {
        return ignore(state, `no warning with id ${action.id}`);
      }
      return applied({
        ...state,
        warnings: state.warnings.filter((warning) => warning.id !== action.id),
      });
    }

    case "ui/user_message":
      return applied(
        withLocalLog(state, { speaker: "user", text: action.text, at: action.at, tone: "info" }),
      );

    case "ui/reset":
      if (isActiveStatus(state.status)) {
        return ignore(state, `cannot reset while ${state.status}; stop the task first`);
      }
      return applied({ ...initialTaskState, log: state.log, nextLocalId: state.nextLocalId });
  }
}

/** Pure transition function. Ignored inputs return the same state object and a reason. */
export function transition(state: TaskState, input: TaskInput): TransitionResult {
  return isUiAction(input) ? applyUiAction(state, input) : applyEvent(state, input);
}

export function taskReducer(state: TaskState, input: TaskInput): TaskState {
  const result = transition(state, input);
  if (result.ignored !== null && process.env.NODE_ENV === "development") {
    console.debug(`[taskReducer] ignored ${input.type}: ${result.ignored}`);
  }
  return result.state;
}
