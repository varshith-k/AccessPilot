import type { BrowserAction, BrowserPageContext } from "@/lib/contracts";
import { toTwinlyStep, type ProposedAction, type TwinlyStep } from "@/lib/twinly/actions";
import {
  ELEMENTS_MAX,
  isTwinlyError,
  type NextActionInput,
  type NextActionResult,
  type ScreenElement,
} from "@/lib/twinly/client";
import type { ActionHistoryItem, ActionProvider, NextAction } from "./types";

/** The part of `TwinlyClient` the agent uses, so tests can stand in for the network. */
export interface TwinlyLike {
  nextAction(input: NextActionInput): Promise<NextActionResult>;
}

export interface TwinlyActionsOptions {
  /**
   * Hard cap on Twinly requests for one task. Every step is a billed request, and plans have
   * small daily quotas, so a confused run must not burn through them.
   */
  maxRequests?: number;
}

/** One Twinly scroll unit, in CSS pixels. */
const PIXELS_PER_SCROLL_UNIT = 100;

/** Centres of the page's controls in viewport pixels: the hint Twinly can use besides the pixels. */
function toElements(page: BrowserPageContext | undefined): ScreenElement[] {
  return (page?.elements ?? [])
    .flatMap((el) =>
      el.bounds && el.label.trim()
        ? [
            {
              role: el.role,
              label: el.label,
              x: Math.round(el.bounds.x + el.bounds.width / 2),
              y: Math.round(el.bounds.y + el.bounds.height / 2),
            },
          ]
        : [],
    )
    .slice(0, ELEMENTS_MAX);
}

/** What the user can be told when Twinly cannot be used. Never includes keys or raw error text. */
function describeFailure(error: unknown): string {
  if (!isTwinlyError(error)) return "I couldn't get the next step from Twinly. Please try again.";
  if (error.status === 429 || error.code === "rate_limited") {
    return "Twinly's usage limit has been reached for now. Please try again later.";
  }
  if (error.status === 401 || error.status === 403 || error.kind === "config") {
    return "I can't use Twinly with the current settings. Ask the person running AccessPilot to check the Twinly key.";
  }
  if (error.kind === "network" || error.kind === "timeout") {
    return "I couldn't reach Twinly. Please check the connection and try again.";
  }
  if (error.kind === "invalid_response") {
    return "Twinly gave an answer I couldn't use. Please try again.";
  }
  return "I couldn't get the next step from Twinly. Please try again.";
}

function toBrowserAction(proposed: ProposedAction, id: string): BrowserAction | null {
  const meta = {
    id,
    commits: proposed.requiresApproval,
    reason: proposed.reason,
    ...(proposed.label ? { label: proposed.label } : {}),
  };
  switch (proposed.type) {
    case "click":
    case "double_click":
      return { ...meta, type: proposed.type, x: proposed.point.x, y: proposed.point.y };
    case "type":
      return { ...meta, type: "type", text: proposed.text };
    case "key":
      return { ...meta, type: "key", key: proposed.keys };
    case "scroll": {
      const distance = proposed.amount * PIXELS_PER_SCROLL_UNIT;
      return {
        ...meta,
        type: "scroll",
        deltaX:
          proposed.direction === "left" ? -distance : proposed.direction === "right" ? distance : 0,
        deltaY:
          proposed.direction === "up" ? -distance : proposed.direction === "down" ? distance : 0,
      };
    }
    case "wait":
      return { ...meta, type: "wait", durationMs: Math.round(proposed.seconds * 1000) };
    case "done":
    case "fail":
      return null;
  }
}

const OUTCOME_TEXT: Record<ActionHistoryItem["outcome"], string> = {
  executed: "done",
  failed: "failed",
  skipped: "handed to the user",
};

/**
 * Twinly as the agent's eyes: it looks at the screenshot and proposes the next click, keystroke or
 * scroll. `done` and `fail` are completion states, never browser actions. One instance per task: it
 * remembers the previous screenshot and what it proposed, to tell Twinly how its last step went.
 */
export function createTwinlyActions(
  client: TwinlyLike,
  options: TwinlyActionsOptions = {},
): ActionProvider {
  const maxRequests = options.maxRequests ?? 30;
  const proposedById = new Map<string, ProposedAction>();
  let requests = 0;
  let previousScreenshot: string | undefined;

  return {
    async nextAction({ goal, screenshot, pageContext, history, signal }): Promise<NextAction> {
      if (requests >= maxRequests) {
        return {
          kind: "fail",
          message: "I used up the number of Twinly requests allowed for one task, so I stopped.",
        };
      }
      requests++;

      const steps: TwinlyStep[] = history.flatMap((item) => {
        const proposed = proposedById.get(item.action.id);
        return proposed ? [toTwinlyStep(proposed, OUTCOME_TEXT[item.outcome])] : [];
      });

      let result: NextActionResult;
      try {
        result = await client.nextAction({
          goal,
          screenshot: screenshot.imageDataUrl,
          ...(previousScreenshot ? { previousScreenshot } : {}),
          viewport: { width: screenshot.width, height: screenshot.height },
          steps,
          elements: toElements(pageContext),
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        // A stop is not a failure: let the orchestrator see the abort.
        if (isTwinlyError(error) && error.kind === "aborted") throw error;
        return { kind: "fail", message: describeFailure(error) };
      }
      previousScreenshot = screenshot.imageDataUrl;

      const proposed = result.action;
      if (proposed.type === "done") {
        return { kind: "done", summary: proposed.text?.trim() || proposed.reason || "All done." };
      }
      if (proposed.type === "fail") {
        return proposed.blocked === "sensitive_value"
          ? { kind: "handoff", reason: "sensitive_value", what: "sensitive field" }
          : { kind: "fail", message: proposed.reason || "I couldn't find a way to continue." };
      }

      const id = `twinly_${requests}`;
      const action = toBrowserAction(proposed, id);
      if (!action)
        return { kind: "fail", message: "I couldn't use Twinly's answer. Please try again." };
      proposedById.set(id, proposed);
      return { kind: "action", action };
    },
  };
}
