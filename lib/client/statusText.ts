import { describeStep } from "./announcements";
import type { TaskState } from "./taskState";

/** One plain sentence describing where the task is, for the status area. */
export function statusSentence(state: TaskState): string {
  switch (state.status) {
    case "idle":
      return "Ready. Enter a website address and what you want to get done.";
    case "starting":
      return "Starting your task…";
    case "planning":
      return "Looking at the page…";
    case "running": {
      if (state.stopping) return "Stopping…";
      const current = state.steps.find((entry) => entry.step === state.currentStep);
      if (current && state.currentStep !== null) {
        return describeStep(state.currentStep, state.totalSteps, current.description);
      }
      return "Working…";
    }
    case "awaiting_approval":
      return "Waiting for your approval. Nothing happens until you choose.";
    case "awaiting_user":
      return "Your turn: finish the step in the browser window, then press Continue.";
    case "completed":
      return state.outcome ?? "Done.";
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
  const prefix = TITLE_PREFIX[state.status];
  return prefix === null ? "AccessPilot" : `${prefix} — AccessPilot`;
}
