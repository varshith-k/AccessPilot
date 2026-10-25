import { describeStep } from "./announcements";
import type { TaskState } from "./taskState";

/** Longest outcome shown whole in the status area; longer answers live in the conversation. */
export const STATUS_GLANCE_MAX = 160;

/**
 * The status area is a glance. A long answer ("You can choose bacon, extra cheese… There are 12
 * fields…") is shortened to its first sentence there; the full text stays in the conversation.
 */
export function glance(outcome: string): string {
  const text = outcome.trim();
  if (text.length <= STATUS_GLANCE_MAX) return text;
  const first = /^[\s\S]*?[.!?](?=\s|$)/.exec(text)?.[0] ?? "";
  const lead =
    first && first.length <= STATUS_GLANCE_MAX
      ? first
      : `${text.slice(0, STATUS_GLANCE_MAX - 1).replace(/\s+\S*$/, "")}…`;
  return `${lead} The full answer is in the conversation below.`;
}

/** One plain sentence describing where the task is, for the status area. */
export function statusSentence(state: TaskState): string {
  if (state.stopping && state.status !== "idle") return "Stopping…";
  switch (state.status) {
    case "idle":
      return "Ready. Enter a website address and what you want to get done.";
    case "starting":
      return "Starting your task…";
    case "planning":
      return "Looking at the page…";
    case "running": {
      if (state.pendingResume !== null) return "Continuing. AccessPilot is taking over again…";
      const current = state.steps.find((entry) => entry.step === state.currentStep);
      if (current && state.currentStep !== null) {
        const described = describeStep(state.currentStep, state.totalSteps, current.description);
        return current.status === "completed"
          ? `${described} (done). Working on the next step…`
          : described;
      }
      return "Working…";
    }
    case "awaiting_approval":
      return "Waiting for your approval. Nothing happens until you choose.";
    case "awaiting_user":
      return "Your turn: finish the step in the browser window, then press Continue.";
    case "completed":
      return state.outcome ? glance(state.outcome) : "Done.";
    case "failed":
      return state.error?.message ?? "The task stopped because of a problem.";
    case "stopped":
      return "Stopped. AccessPilot will not do anything else on this page.";
  }
}

const TITLE_PREFIX: Record<TaskState["status"], string | null> = {
  idle: null,
  starting: "Starting",
  planning: "Looking at the page",
  running: "Working",
  awaiting_approval: "Waiting for your approval",
  awaiting_user: "Your turn",
  completed: "Done",
  failed: "Problem",
  stopped: "Stopped",
};

export function documentTitle(state: TaskState): string {
  const prefix =
    state.status === "completed" && state.declined ? "Not submitted" : TITLE_PREFIX[state.status];
  return prefix === null ? "AccessPilot" : `${prefix} — AccessPilot`;
}
