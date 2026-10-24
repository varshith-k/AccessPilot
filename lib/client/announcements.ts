import type { NarrationPriority, TaskEvent } from "@/lib/contracts";
import { STOPPED_BY_USER_TEXT } from "./taskState";

export interface Announcement {
  text: string;
  priority: NarrationPriority;
  /** Whether built-in speech should read it aloud (live regions always get it). */
  speak: boolean;
}

const HANDOFF_PREFIX: Record<
  Extract<TaskEvent, { type: "user_input.required" }>["reason"],
  string
> = {
  sensitive_value: "Your turn.",
  captcha: "Your turn: there's a CAPTCHA.",
  login: "Your turn: please sign in.",
  other: "Your turn.",
};

export function describeStep(step: number, totalSteps: number | null, description: string): string {
  return totalSteps === null
    ? `Step ${step}: ${description}`
    : `Step ${step} of about ${totalSteps}: ${description}`;
}

/**
 * What to tell the user when an event is applied. Step progress goes only to the polite live
 * region (narration already says it aloud); everything that needs a decision is assertive.
 */
export function announcementFor(event: TaskEvent, totalSteps: number | null): Announcement | null {
  switch (event.type) {
    case "task.started":
      return { text: "Looking at the page.", priority: "polite", speak: true };
    case "page.map":
      return { text: `${event.title}. ${event.summary}`, priority: "polite", speak: true };
    case "step.started":
      return {
        text: describeStep(event.step, event.totalSteps ?? totalSteps, event.description),
        priority: "polite",
        speak: false,
      };
    case "step.completed":
      return null;
    case "narration":
      return { text: event.text, priority: event.priority, speak: true };
    case "screenshot":
      return null;
    case "approval.required":
      return {
        text: `Approval needed. ${event.summary} Nothing happens until you choose.`,
        priority: "assertive",
        speak: true,
      };
    case "user_input.required":
      return {
        text: `${HANDOFF_PREFIX[event.reason]} ${event.instructions}`,
        priority: "assertive",
        speak: true,
      };
    case "task.completed":
      return { text: event.summary, priority: "assertive", speak: true };
    case "task.failed":
      return {
        text:
          event.recoverable && !/\btry again\b/i.test(event.message)
            ? `Task failed. ${event.message} You can try again.`
            : `Task failed. ${event.message}`,
        priority: "assertive",
        speak: true,
      };
    case "task.stopped":
      return {
        text: event.by === "user" ? STOPPED_BY_USER_TEXT : "AccessPilot stopped the task.",
        priority: "assertive",
        speak: true,
      };
  }
}
