import {
  browserActionSchema,
  type ActionResult,
  type ActionType,
  type BrowserAction,
  type BrowserPageContext,
  type NarrationPriority,
} from "@/lib/contracts";
import { AbortedError, abortable, withTimeout } from "./errors";
import { detectHandoff, elementAt, handoffInstructions, maskIfSensitive } from "./sensitive";
import {
  DEFAULT_LIMITS,
  type ActionHistoryItem,
  type AgentDeps,
  type AgentLimits,
  type BrowserDriver,
  type Observation,
  type PageMap,
  type Plan,
  type Progress,
  type TaskControl,
} from "./types";

const ASSERTIVE: ReadonlySet<Progress["kind"]> = new Set([
  "needs_info",
  "needs_approval",
  "action_failed",
  "failed",
]);

/** Plain text view of the page for the model. The browser already excludes sensitive values. */
export function serializePage(page: BrowserPageContext): string {
  const lines = page.elements.map((el) => `- ${el.role}: ${el.label}`);
  return [`Page: ${page.title} (${page.url})`, ...lines].join("\n");
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the page";
  }
}

/** Never includes typed text: descriptions go into events and logs. */
function describe(action: BrowserAction, past: boolean): string {
  const label = action.label?.trim();
  switch (action.type) {
    case "click":
    case "double_click":
      return label
        ? `${past ? "Clicked" : "Clicking"} ${label}`
        : past
          ? "Clicked on the page"
          : "Clicking on the page";
    case "type":
      return label
        ? `${past ? "Filled in" : "Filling in"} ${label}`
        : past
          ? "Typed your answer"
          : "Typing your answer";
    case "key":
      return `${past ? "Pressed" : "Pressing"} ${action.key}`;
    case "scroll":
      return past ? "Scrolled the page" : "Scrolling the page";
    case "navigate":
      return `${past ? "Opened" : "Opening"} ${host(action.url)}`;
    case "wait":
      return past ? "Waited for the page" : "Waiting for the page";
  }
}

/** The event contract has no `navigate` type; it is reported as a wait with a descriptive label. */
function eventActionType(action: BrowserAction): ActionType {
  return action.type === "navigate" ? "wait" : action.type;
}

function humanize(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface RunInput {
  url: string;
  goal: string;
}

/**
 * Runs one task from start to a terminal event. Never throws: every failure becomes `task.failed`,
 * and a stop ends quietly because the store has already emitted `task.stopped`.
 *
 * Safety rules enforced here, whatever the other modules return:
 * - an action with `commits: true` (or one the browser flags) waits for the user's exact approval;
 * - password, card and CAPTCHA fields are handed to the user and never typed;
 * - nothing runs in the browser after a stop;
 * - typed text and keys never appear in events.
 */
export async function runTask(
  deps: AgentDeps,
  ctl: TaskControl,
  input: RunInput,
  limits: AgentLimits = DEFAULT_LIMITS,
): Promise<void> {
  const { signal } = ctl;
  let browser: BrowserDriver | undefined;
  let approvalCounter = 0;

  const guard = <T>(promise: Promise<T>) => abortable(promise, signal);

  const say = async (progress: Progress, fallback: string): Promise<void> => {
    const fallbackPriority: NarrationPriority = ASSERTIVE.has(progress.kind)
      ? "assertive"
      : "polite";
    let narration = { text: fallback, priority: fallbackPriority };
    try {
      const result = await guard(
        withTimeout(deps.planner.narrate(progress), limits.narrationTimeoutMs),
      );
      if (result.text.trim()) narration = result;
    } catch (error) {
      if (error instanceof AbortedError) throw error;
    }
    ctl.emit({ type: "narration", text: narration.text, priority: narration.priority });
  };

  const fail = (code: string, message: string, recoverable: boolean): void => {
    ctl.emit({ type: "task.failed", code, message, recoverable });
  };

  const sendScreenshot = (step: number, obs: Observation, caption: string): void => {
    const { imageDataUrl } = obs.screenshot;
    if (imageDataUrl.length > limits.maxScreenshotChars) return;
    ctl.emit({
      type: "screenshot",
      step,
      imageDataUrl,
      alt: `${obs.pageContext.title || "Page"}. ${caption}.`,
    });
  };

  /** Asks the user and waits. Returns the approval to pass to the browser, or why not. */
  const requestApproval = async (
    action: BrowserAction,
    obs: Observation,
    knownId?: string,
  ): Promise<{ approvalId: string; actionId: string } | "denied" | "stopped"> => {
    const approvalId = knownId ?? `appr_${++approvalCounter}`;
    const what = action.label?.trim() || describe(action, false);
    const fields = [
      { label: "Website", value: host(obs.pageContext.url) },
      ...Object.entries(deps.userDetails ?? {}).map(([key, value]) => ({
        label: humanize(key),
        value: maskIfSensitive(key, value),
      })),
    ];
    await say(
      { kind: "needs_approval", detail: what },
      `I'm ready to do this: ${what}. Please review the details and tell me whether to go ahead.`,
    );
    ctl.emit({
      type: "approval.required",
      approvalId,
      action: what,
      summary: `Do you want me to go ahead? ${what}`,
      fields,
    });
    const decision = await ctl.waitForApproval(approvalId);
    if (decision === "stopped") return "stopped";
    if (decision === "deny") return "denied";
    return { approvalId, actionId: action.id };
  };

  const execute = (action: BrowserAction, approval?: { approvalId: string; actionId: string }) => {
    // The last gate before the browser: nothing runs once the task has been stopped.
    if (signal.aborted) throw new AbortedError();
    return guard(browser!.execute(action, { signal, ...(approval ? { approval } : {}) }));
  };

  try {
    ctl.emit({ type: "task.started", url: input.url, goal: input.goal });

    browser = await guard(deps.createBrowser());
    let obs = await guard(browser.open(input.url, signal));
    sendScreenshot(0, obs, "Before any steps");

    // Understand the page and make a plan.
    const pageText = serializePage(obs.pageContext);
    let map: PageMap;
    try {
      map = await guard(deps.planner.mapPage(pageText));
    } catch (error) {
      if (error instanceof AbortedError) throw error;
      map = {
        title: obs.pageContext.title || "This page",
        summary: `This page has ${obs.pageContext.elements.length} items I can work with.`,
        regions: [],
      };
    }
    ctl.emit({ type: "page.map", ...map });

    let plan: Plan;
    try {
      plan = await guard(deps.planner.planTask(input.goal, pageText, deps.userDetails));
    } catch (error) {
      if (error instanceof AbortedError) throw error;
      fail(
        "planning_failed",
        "I couldn't work out a plan for that. Please try again or word it differently.",
        true,
      );
      return;
    }
    if (plan.clarifyingQuestion) {
      fail("needs_clarification", plan.clarifyingQuestion, true);
      return;
    }
    await say({ kind: "started", detail: plan.summary }, plan.summary);

    const known = new Set(Object.keys(deps.userDetails ?? {}).map((k) => k.toLowerCase()));
    const missing = plan.missingInfo.filter((m) => !known.has(m.field.toLowerCase()));
    if (missing.length > 0) {
      const questions = missing.map((m) => m.question).join(" ");
      await say(
        { kind: "needs_info", detail: questions },
        `I need a few details from you first. ${questions}`,
      );
      ctl.emit({
        type: "user_input.required",
        reason: "other",
        instructions: `${questions} Please type your answers in the browser window, then press Continue.`,
      });
      if ((await ctl.waitForResume()) === "stopped") return;
      obs = await guard(browser.observe());
    }

    // Look, act, check, repeat.
    const history: ActionHistoryItem[] = [];
    let step = 0;
    let failures = 0;
    let lastTarget: string | undefined;

    while (step < limits.maxSteps) {
      const next = await guard(
        deps.actions.nextAction({ goal: input.goal, screenshot: obs.screenshot, history, signal }),
      );

      if (next.kind === "done") {
        await say({ kind: "finished", detail: next.summary }, next.summary);
        ctl.emit({ type: "task.completed", summary: next.summary });
        return;
      }
      if (next.kind === "fail") {
        fail("cannot_continue", next.message, true);
        return;
      }

      const parsed = browserActionSchema.safeParse(next.action);
      if (!parsed.success) {
        // A malformed proposal never reaches the browser.
        if (++failures >= limits.maxConsecutiveFailures) {
          fail(
            "invalid_action",
            "I kept getting instructions I couldn't carry out. Please try again.",
            true,
          );
          return;
        }
        continue;
      }
      const action = parsed.data;
      step++;
      const totalSteps = Math.max(plan.steps.length, step);
      ctl.emit({ type: "step.started", step, description: describe(action, false), totalSteps });

      // Passwords, card numbers and CAPTCHAs are the user's to handle.
      const handoff = detectHandoff(action, obs.pageContext, lastTarget);
      if (handoff) {
        history.push({ action, outcome: "skipped" });
        const instructions = handoffInstructions(handoff);
        await say({ kind: "needs_info", detail: `A ${handoff.what} needs you.` }, instructions);
        ctl.emit({ type: "user_input.required", reason: handoff.reason, instructions });
        if ((await ctl.waitForResume()) === "stopped") return;
        obs = await guard(browser.observe());
        lastTarget = undefined;
        ctl.emit({
          type: "step.completed",
          step,
          description: `You handled the ${handoff.what}`,
          action: { type: "wait", label: "Handed to you" },
        });
        sendScreenshot(step, obs, `After you handled the ${handoff.what}`);
        continue;
      }

      // Consequential actions need the user's exact approval.
      let approval: { approvalId: string; actionId: string } | undefined;
      if (action.commits) {
        const decision = await requestApproval(action, obs);
        if (decision === "stopped") return;
        if (decision === "denied") {
          await finishDenied(action);
          return;
        }
        approval = decision;
      }

      let result: ActionResult = await execute(action, approval);
      if (result.status === "approval_required") {
        // The browser's own safety check flagged an action Twinly did not.
        if (approval) {
          fail(
            "approval_mismatch",
            "The browser did not accept the approval. Nothing was done.",
            true,
          );
          return;
        }
        const decision = await requestApproval(action, obs, result.approvalId);
        if (decision === "stopped") return;
        if (decision === "denied") {
          await finishDenied(action);
          return;
        }
        result = await execute(action, decision);
      }

      if (result.status === "cancelled") return;

      const worked = result.status === "executed" && result.verification !== "failed";
      if (!worked) {
        history.push({ action, outcome: "failed" });
        if (++failures >= limits.maxConsecutiveFailures) {
          fail(
            "action_failed",
            "I couldn't complete that step after several tries. Nothing was submitted.",
            true,
          );
          return;
        }
        await say(
          { kind: "action_failed", detail: describe(action, true) },
          "That didn't work. I'll try another way.",
        );
        obs = await guard(browser.observe());
        continue;
      }

      failures = 0;
      history.push({ action, outcome: "executed" });
      obs = {
        screenshot: result.screenshot ?? obs.screenshot,
        pageContext: result.pageContext ?? obs.pageContext,
      };
      if (!result.screenshot || !result.pageContext) {
        const fresh = await guard(browser.observe());
        obs = {
          screenshot: result.screenshot ?? fresh.screenshot,
          pageContext: result.pageContext ?? fresh.pageContext,
        };
      }
      if (action.type === "click" || action.type === "double_click") {
        lastTarget = elementAt(obs.pageContext, action.x, action.y)?.label ?? action.label;
      } else if (action.type !== "type" && action.type !== "key") {
        lastTarget = undefined;
      }

      const done = describe(action, true);
      ctl.emit({
        type: "step.completed",
        step,
        description: done,
        action: { type: eventActionType(action), ...(action.label ? { label: action.label } : {}) },
      });
      sendScreenshot(step, obs, `After: ${done}`);
      await say(
        { kind: "action_done", detail: done, pageContext: serializePage(obs.pageContext) },
        `${done}.`,
      );
    }

    fail(
      "step_limit",
      `I couldn't finish within ${limits.maxSteps} steps, so I stopped. Nothing was submitted.`,
      true,
    );
  } catch (error) {
    if (error instanceof AbortedError) return;
    // Log the kind of failure only: messages from other modules might carry page text or keys.
    console.error("[agent] task failed:", error instanceof Error ? error.name : "unknown");
    fail("internal_error", "Something went wrong on my side. Please try again.", true);
  } finally {
    try {
      await browser?.close();
    } catch {
      // Closing is best effort; the task outcome is already decided.
    }
  }

  async function finishDenied(action: BrowserAction): Promise<void> {
    const what = action.label?.trim() || describe(action, false).toLowerCase();
    await say({ kind: "finished", detail: `The user declined: ${what}` }, "Okay, I won't do that.");
    ctl.emit({
      type: "task.completed",
      summary: `Not done: ${what}. Nothing was submitted and your answers are still filled in.`,
    });
  }
}
