import {
  browserActionSchema,
  type ActionResult,
  type ActionType,
  type BrowserAction,
  type BrowserPageContext,
  type NarrationPriority,
  type UserInputReason,
} from "@/lib/contracts";
import { AbortedError, AgentError, abortable, sleep, withTimeout } from "./errors";
import {
  detectHandoff,
  elementAt,
  handoffInstructions,
  isSensitiveKey,
  maskIfSensitive,
} from "./sensitive";
import { snapClick } from "./snap";
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

/** Opt-in trace for working out why a model's step behaved as it did. Never logs typed text. */
const DEBUG = () => process.env.ACCESSPILOT_DEBUG === "1";

/** How long and how often to re-look at a page before treating it as settled. */
const SETTLE_PAUSE_MS = 150;
const SETTLE_LOOKS = 5;

const ASSERTIVE: ReadonlySet<Progress["kind"]> = new Set([
  "needs_info",
  "needs_approval",
  "action_failed",
  "failed",
]);

/** Website text can't close or reopen the untrusted-content wrapper the prompts put around it. */
function neutralize(text: string): string {
  return text.replace(/<\/?\s*page_context\s*>/gi, "");
}

/** Plain text view of the page for the model. The browser already excludes sensitive values. */
export function serializePage(page: BrowserPageContext): string {
  const lines = page.elements.map((el) => `- ${el.role}: ${el.label}`);
  const parts = [`Page: ${page.title} (${page.url})`, ...lines];
  if (page.text) {
    parts.push(
      "",
      "Page text:",
      page.text + (page.textTruncated ? "\n(More text on the page is not shown.)" : ""),
    );
  }
  return neutralize(parts.join("\n"));
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

/** Limits so the goal stays under what the action provider accepts, whatever the profile holds. */
const MAX_DETAILS_CHARS = 1200;
const MAX_VALUE_CHARS = 1000;
/** Twinly accepts goals up to 2000 characters; leave a margin. */
const MAX_GOAL_CHARS = 1900;

/**
 * The goal as the action provider sees it: the user's request plus the details they have approved
 * for use. A model that only sees "complete this application" cannot type a name it was never told.
 * Anything that looks like a password, card number or code is left out, so a secret never leaves the
 * server, and a value is never invented for a field that has none.
 */
export function composeGoal(goal: string, userDetails?: Record<string, string>): string {
  const lines: string[] = [];
  let used = 0;
  const header =
    "\n\nDetails the user has approved for this task. Use only these, and do not make up any others:\n";
  const budget = Math.min(MAX_DETAILS_CHARS, MAX_GOAL_CHARS - goal.length - header.length);
  for (const [key, value] of Object.entries(userDetails ?? {})) {
    const trimmed = value.trim();
    if (!trimmed || isSensitiveKey(key)) continue;
    const shown =
      trimmed.length > MAX_VALUE_CHARS ? `${trimmed.slice(0, MAX_VALUE_CHARS)}…` : trimmed;
    const line = `- ${humanize(key)}: ${shown}`;
    if (used + line.length + 1 > budget) continue; // skip what does not fit, keep the rest
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return goal;
  return `${goal}${header}${lines.join("\n")}`;
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
    // Stop must reach the browser at once, not wait for cleanup: it interrupts a page that is still
    // loading and any action in flight.
    const driver = browser;
    signal.addEventListener("abort", () => void driver.stop?.().catch(() => {}), { once: true });
    let obs = await guard(browser.open(input.url, signal));
    sendScreenshot(0, obs, "Before any steps");

    // Understand the page and make a plan.
    const pageText = serializePage(obs.pageContext);
    // Describing the page and planning are independent: ask for both at once.
    const planning = deps.planner.planTask(input.goal, pageText, deps.userDetails);
    planning.catch(() => {}); // handled below; avoid an unhandled rejection meanwhile
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
      plan = await guard(planning);
    } catch (error) {
      if (error instanceof AbortedError) throw error;
      // The plan helps narration and progress, but the safety rules live here, not in the plan, and
      // the action provider reads the page itself. So a planner outage is not the end of the task.
      plan = {
        intent: "other",
        summary: `I'll work on this step by step: ${input.goal}`,
        steps: [{ id: 1, description: input.goal, requiresConfirmation: true }],
        missingInfo: [],
        requiresConfirmation: true,
        clarifyingQuestion: null,
      };
    }
    if (plan.clarifyingQuestion) {
      fail("needs_clarification", plan.clarifyingQuestion, true);
      return;
    }

    // A question about the page ("how many fields are there?") is answered, not acted on. The model
    // sees an outline of the whole page, not just the part in view. If answering fails, fall through
    // and let the action provider work on it as usual.
    if (plan.intent === "explain_page" && deps.planner.explainPage) {
      let outline = pageText;
      try {
        if (browser.outline) {
          // The outline covers the whole page's structure; the page text adds what the paragraphs
          // say (a deadline, a fee), which questions usually need.
          const text = obs.pageContext.text;
          outline = neutralize(
            `${await guard(browser.outline())}${text ? `\n\nPage text:\n${text}` : ""}`,
          );
        }
      } catch (error) {
        if (error instanceof AbortedError) throw error;
      }
      let answer = "";
      try {
        answer = (await guard(deps.planner.explainPage(outline, input.goal))).trim();
      } catch (error) {
        if (error instanceof AbortedError) throw error;
      }
      if (answer) {
        ctl.emit({ type: "task.completed", summary: answer });
        return;
      }
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

    const actionGoal = composeGoal(input.goal, deps.userDetails);

    // Look, act, check, repeat.
    const history: ActionHistoryItem[] = [];
    let step = 0;
    let failures = 0;
    let lastTarget: string | undefined;

    while (step < limits.maxSteps) {
      const next = await guard(
        deps.actions.nextAction({
          goal: actionGoal,
          screenshot: obs.screenshot,
          pageContext: obs.pageContext,
          history,
          signal,
        }),
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

      if (next.kind === "handoff") {
        step++;
        ctl.emit({ type: "step.started", step, description: `Handing the ${next.what} to you` });
        const view = await handOff(
          step,
          next.reason,
          next.what,
          handoffInstructions({ reason: next.reason, what: next.what }),
        );
        if (!view) return;
        obs = view;
        lastTarget = undefined;
        continue;
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
      // Clicks are only valid against the view they were planned from, so name that view.
      const stamped: BrowserAction =
        (parsed.data.type === "click" || parsed.data.type === "double_click") &&
        obs.observationId &&
        !parsed.data.observationId
          ? { ...parsed.data, observationId: obs.observationId }
          : parsed.data;
      // A click a few pixels off its field is pulled onto it before any safety check looks at it.
      const action = snapClick(stamped, obs.pageContext);
      step++;
      if (DEBUG()) {
        const under =
          action.type === "click" || action.type === "double_click"
            ? elementAt(obs.pageContext, action.x, action.y)
            : undefined;
        console.debug("[agent] step", step, {
          type: action.type,
          label: action.label,
          commits: action.commits,
          ...(action.type === "click" || action.type === "double_click"
            ? {
                x: Math.round(action.x),
                y: Math.round(action.y),
                snapped: action !== stamped,
                under: under ? `${under.role}: ${under.label}` : "no known control",
              }
            : {}),
        });
      }
      const totalSteps = Math.max(plan.steps.length, step);
      ctl.emit({ type: "step.started", step, description: describe(action, false), totalSteps });

      // Passwords, card numbers and CAPTCHAs are the user's to handle.
      const handoff = detectHandoff(action, obs.pageContext, lastTarget);
      if (handoff) {
        history.push({ action, outcome: "skipped" });
        const next = await handOff(
          step,
          handoff.reason,
          handoff.what,
          handoffInstructions(handoff),
        );
        if (!next) return;
        obs = next;
        lastTarget = undefined;
        continue;
      }

      // Consequential actions need the user's exact approval before the browser is touched.
      let approved = false;
      if (action.commits) {
        const decision = await requestApproval(action, obs);
        if (decision === "stopped") return;
        if (decision === "denied") {
          await finishDenied(action);
          return;
        }
        approved = true;
      }

      // The first call never carries an approval. A controller that wants one answers with its own
      // id, and the user's approval (already given, or asked for below) is applied to that id.
      let result: ActionResult = await execute(action);
      if (result.status === "approval_required") {
        if (!approved) {
          const decision = await requestApproval(action, obs, result.approvalId);
          if (decision === "stopped") return;
          if (decision === "denied") {
            await finishDenied(action);
            return;
          }
        }
        result = await execute(action, { approvalId: result.approvalId, actionId: action.id });
        if (result.status === "approval_required") {
          fail(
            "approval_mismatch",
            "The browser did not accept the approval. Nothing was done.",
            true,
          );
          return;
        }
      }

      if (DEBUG()) {
        console.debug("[agent] result", step, {
          status: result.status,
          ...(result.status === "failed" ? { code: result.error.code } : {}),
          ...(result.status === "executed" ? { verification: result.verification } : {}),
        });
      }

      if (result.status === "cancelled") return;

      // The browser itself says a field is the user's to fill in.
      if (result.status === "user_input_required") {
        history.push({ action, outcome: "skipped" });
        const what = result.reason === "sensitive_value" ? "sensitive field" : "control";
        const instructions =
          result.reason === "sensitive_value"
            ? handoffInstructions({ reason: "sensitive_value", what })
            : "Please complete this control in the browser window, then press Continue.";
        const next = await handOff(step, result.reason, what, instructions);
        if (!next) return;
        obs = next;
        lastTarget = undefined;
        continue;
      }

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
        // A failed result usually carries the page as it is now; otherwise look again.
        obs = await currentView(result, obs);
        continue;
      }

      failures = 0;
      history.push({ action, outcome: "executed" });
      obs = await currentView(result, obs);
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
    // Our own errors carry plain-language, user-safe messages ("I couldn't open that page…").
    if (error instanceof AgentError) {
      fail(error.code, error.message, true);
      return;
    }
    fail("internal_error", "Something went wrong on my side. Please try again.", true);
  } finally {
    try {
      await browser?.close();
    } catch {
      // Closing is best effort; the task outcome is already decided.
    }
  }

  /**
   * The page as of this result, once it has stopped changing. A page keeps settling for a moment after
   * an action (focus, scrolling, transitions), so the view captured right after the action is not the
   * one the next click will be checked against. Clicks name the view they were planned from, so wait
   * until two looks in a row agree before planning from it.
   */
  async function currentView(result: ActionResult, previous: Observation): Promise<Observation> {
    const first: Observation | undefined =
      result.screenshot && result.pageContext
        ? {
            ...(result.observationId ? { observationId: result.observationId } : {}),
            screenshot: result.screenshot,
            pageContext: result.pageContext,
          }
        : undefined;
    if (first && !first.observationId) return first; // nothing to settle without view ids

    let latest: Observation | undefined = first;
    for (let look = 0; look < SETTLE_LOOKS; look++) {
      if (latest) await sleep(SETTLE_PAUSE_MS, signal);
      let next: Observation;
      try {
        next = await abortable(browser!.observe(), signal);
      } catch (error) {
        if (error instanceof AbortedError) throw error;
        return latest ?? previous;
      }
      if (!next.observationId || next.observationId === latest?.observationId) return next;
      latest = next;
    }
    return latest ?? previous;
  }

  /** Tells the user what to do, waits for Continue, and returns the fresh view (or null if stopped). */
  async function handOff(
    step: number,
    reason: UserInputReason,
    what: string,
    instructions: string,
  ): Promise<Observation | null> {
    await say({ kind: "needs_info", detail: `A ${what} needs you.` }, instructions);
    ctl.emit({ type: "user_input.required", reason, instructions });
    if ((await ctl.waitForResume()) === "stopped") return null;
    const fresh = await abortable(browser!.observe(), signal);
    ctl.emit({
      type: "step.completed",
      step,
      description: `You handled the ${what}`,
      action: { type: "wait", label: "Handed to you" },
    });
    sendScreenshot(step, fresh, `After you handled the ${what}`);
    return fresh;
  }

  async function finishDenied(action: BrowserAction): Promise<void> {
    const what = action.label?.trim() || describe(action, false).toLowerCase();
    await say({ kind: "finished", detail: `The user declined: ${what}` }, "Okay, I won't do that.");
    ctl.emit({
      type: "task.completed",
      summary: `Not done: ${what}. I stopped there, so nothing was submitted or changed.`,
    });
  }
}
