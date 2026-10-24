import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  browserActionSchema,
  type ActionResult,
  type BrowserAction,
  type BrowserObservation,
  type ExecuteActionOptions,
} from "../contracts/browser";
import { BrowserSession, type BrowserSessionOptions } from "./session";
import { captureScreenshot } from "./screenshot";
import { extractPageContext } from "./context";
import { NavigationPolicyError } from "./policy";
import {
  inspectTarget,
  installSafetyGuards,
  readSafetyState,
  setPagePermission,
  SUPPORTED_KEYS,
} from "./safety";
import { verifyOutcome } from "./verification";

const executionOptionsSchema = z.object({
  approval: z.object({ approvalId: z.string().min(1), actionId: z.string().min(1) }).optional(),
  expected: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("url"), url: z.string().url() }),
      z.object({
        type: z.literal("visible"),
        selector: z.string().min(1).max(500),
        text: z.string().max(1000).optional(),
      }),
      z.object({
        type: z.literal("field"),
        selector: z.string().min(1).max(500),
        value: z.string().max(10_000),
      }),
    ])
    .optional(),
  verificationTimeoutMs: z.number().int().min(1).max(10_000).optional(),
});

interface SavedObservation extends BrowserObservation {
  fingerprint: string;
  domFingerprint: string;
}
interface PendingApproval {
  domTarget: boolean;
  id: string;
  action: string;
  actionId: string;
  fingerprint: string;
}

export interface BrowserControllerOptions extends BrowserSessionOptions {
  /** Deadline includes validation, interaction, verification and observations. */
  executionTimeoutMs?: number;
  maxActions?: number;
}

class ExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Server-side, single-task controller. All interactions go through execute(). */
export class BrowserController {
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private stopPromise?: Promise<void>;
  private observation?: SavedObservation;
  private pending?: PendingApproval;
  private readonly completedIds = new Set<string>();
  private readonly stopSignal = new AbortController();
  private actions = 0;
  private readonly guardKey = `accesspilot_${randomUUID().replaceAll("-", "")}`;

  private constructor(
    private readonly session: BrowserSession,
    private readonly executionTimeoutMs: number,
    private readonly maxActions: number,
  ) {}

  static async create(options: BrowserControllerOptions = {}): Promise<BrowserController> {
    const executionTimeoutMs = options.executionTimeoutMs ?? 20_000;
    const maxActions = options.maxActions ?? 100;
    for (const [name, value] of Object.entries({ executionTimeoutMs, maxActions })) {
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new RangeError(`${name} must be a positive safe integer.`);
    }
    const session = await BrowserSession.create(options);
    const controller = new BrowserController(session, executionTimeoutMs, maxActions);
    try {
      session.setActionPermission(false);
      await installSafetyGuards(session.page, controller.guardKey);
      return controller;
    } catch (error) {
      await session.close();
      throw error;
    }
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  /** Trusted manual handoff/diagnostics only. Model actions must use execute(). */
  get page() {
    return this.session.page;
  }

  /** Cancels current and queued work. Closing Chromium interrupts active I/O. */
  stop(): Promise<void> {
    this.stopped = true;
    this.stopSignal.abort();
    this.pending = undefined;
    this.stopPromise ??= this.session.close();
    return this.stopPromise;
  }

  close(): Promise<void> {
    return this.stop();
  }

  observe(): Promise<BrowserObservation> {
    return this.enqueue(() =>
      this.withDeadline(async () => {
        if (this.stopped) throw new ExecutionError("cancelled", "This browser task has stopped.");
        const observation = this.publicObservation(await this.readObservation());
        return observation;
      }),
    );
  }

  /** Declining is terminal for this proposal. It never executes an interaction. */
  denyApproval(approvalId: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.pending || this.pending.id !== approvalId || this.stopped) return false;
      this.completedIds.add(this.pending.actionId);
      this.pending = undefined;
      return true;
    });
  }

  async execute(input: unknown, options: ExecuteActionOptions = {}): Promise<ActionResult> {
    const parsed = browserActionSchema.safeParse(input);
    if (!parsed.success)
      return this.failure("invalid", "invalid_action", "The proposed browser action is invalid.");
    const action = parsed.data;
    const parsedOptions = executionOptionsSchema.safeParse(options);
    if (!parsedOptions.success)
      return this.failure(action.id, "invalid_options", "The execution options are invalid.");
    // Snapshot trusted inputs before queuing: callers cannot mutate pending work.
    const settings: ExecuteActionOptions = { ...parsedOptions.data, signal: options.signal };
    const abort = () => {
      void this.stop().catch(() => {});
    };
    settings.signal?.addEventListener("abort", abort, { once: true });
    if (settings.signal?.aborted) abort();
    try {
      return await this.enqueue(async () => {
        if (this.stopped) return { actionId: action.id, status: "cancelled" };
        if (this.actions >= this.maxActions) {
          await this.stop();
          return this.failure(
            action.id,
            "action_limit",
            "The browser task reached its action limit and was stopped.",
          );
        }
        try {
          return await this.withDeadline(() => this.runAction(action, settings));
        } catch (error) {
          if (error instanceof ExecutionError && error.code === "cancelled")
            return { actionId: action.id, status: "cancelled" };
          if (error instanceof ExecutionError)
            return this.failure(action.id, error.code, error.message);
          if (this.stopped) return { actionId: action.id, status: "cancelled" };
          if (error instanceof NavigationPolicyError)
            return this.failure(action.id, error.code, error.message);
          return this.failure(
            action.id,
            "execution_failed",
            "The browser action could not be completed. Inspect the page before trying again.",
          );
        }
      });
    } finally {
      settings.signal?.removeEventListener("abort", abort);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }

  private async withDeadline<T>(operation: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new ExecutionError(
            "action_timeout",
            "The browser action timed out. The session was stopped.",
          ),
        );
        void this.stop().catch(() => {});
      }, this.executionTimeoutMs);
    });
    let cancel: () => void = () => {};
    const cancellation = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new ExecutionError("cancelled", "This browser task has stopped."));
      this.stopSignal.signal.addEventListener("abort", cancel, { once: true });
      if (this.stopped) cancel();
    });
    try {
      return await Promise.race([operation(), timeout, cancellation]);
    } finally {
      clearTimeout(timer);
      this.stopSignal.signal.removeEventListener("abort", cancel);
    }
  }

  private failure(actionId: string, code: string, message: string): ActionResult {
    return { actionId, status: "failed", error: { code, message } };
  }

  private async readObservation(): Promise<SavedObservation> {
    if (this.stopped) throw new ExecutionError("cancelled", "This browser task has stopped.");
    const page = this.session.page;
    const screenshot = await captureScreenshot(page);
    const pageContext = await extractPageContext(page);
    const { blocked: _blocked, ...state } = await readSafetyState(page, this.guardKey);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ image: screenshot.imageDataUrl, pageContext, state }))
      .digest("hex");
    // Standard DOM controls retain their meaning across hover and focus changes.
    // Bind approval to DOM, values, layout, viewport and scroll instead of pixels.
    const domFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          pageContext,
          documentDigest: state.documentDigest,
          formDigest: state.formDigest,
          scrollX: state.scrollX,
          scrollY: state.scrollY,
          width: screenshot.width,
          height: screenshot.height,
        }),
      )
      .digest("hex");
    const observationId =
      this.observation?.fingerprint === fingerprint ? this.observation.observationId : randomUUID();
    const observation = {
      observationId,
      screenshot,
      pageContext,
      fingerprint,
      domFingerprint,
    };
    this.observation = observation;
    return observation;
  }

  private publicObservation({
    observationId,
    screenshot,
    pageContext,
  }: SavedObservation): BrowserObservation {
    return { observationId, screenshot, pageContext };
  }

  private async runAction(
    action: BrowserAction,
    options: ExecuteActionOptions,
  ): Promise<ActionResult> {
    if (this.completedIds.has(action.id))
      throw new ExecutionError(
        "duplicate_action",
        "This action was already attempted. Create a new proposal after inspecting the page.",
      );
    const previous = this.observation;
    const before = await this.readObservation();
    const canonical = JSON.stringify(action);
    const coordinateAction = action.type === "click" || action.type === "double_click";
    const targetAction = coordinateAction || action.type === "type" || action.type === "key";
    const target = targetAction ? await inspectTarget(this.session.page, action) : undefined;
    if (coordinateAction) {
      const viewport = this.session.page.viewportSize()!;
      if (action.x >= viewport.width || action.y >= viewport.height)
        throw new ExecutionError(
          "invalid_coordinates",
          "The click is outside the browser viewport.",
        );
      const reviewedDomAction =
        this.pending?.domTarget &&
        this.pending.action === canonical &&
        this.pending.fingerprint === before.domFingerprint;
      if (
        !reviewedDomAction &&
        (!previous ||
          action.observationId !== previous.observationId ||
          (target?.domTarget
            ? previous.domFingerprint !== before.domFingerprint
            : previous.fingerprint !== before.fingerprint))
      ) {
        this.pending = undefined;
        throw new ExecutionError(
          "stale_observation",
          "The page changed or the click has no current observation. Request a new screenshot and action.",
        );
      }
    }
    if (action.type === "key" && !SUPPORTED_KEYS.has(action.key))
      throw new ExecutionError("unsupported_key", "This keyboard shortcut is not supported.");
    if (
      action.type === "scroll" &&
      Math.max(Math.abs(action.deltaX), Math.abs(action.deltaY)) > 10_000
    )
      throw new ExecutionError("invalid_scroll", "Scroll by at most 10000 pixels per action.");
    if (action.type === "navigate") this.session.assertUrlAllowed(action.url);

    const leavingField =
      action.type === "key" && ["Tab", "Shift+Tab", "Escape"].includes(action.key);
    const activatesTarget =
      coordinateAction || (action.type === "key" && ["Enter", "Space"].includes(action.key));
    if (target?.sensitive && !leavingField) {
      return {
        actionId: action.id,
        status: "user_input_required",
        reason: "sensitive_value",
        instructions:
          "Enter this private value directly in the browser, then ask for a fresh observation.",
      };
    }
    if (target?.manual)
      return {
        actionId: action.id,
        status: "user_input_required",
        reason: "other",
        instructions:
          "Complete this control directly in the browser, then ask for a fresh observation.",
      };
    if (target?.disabled && !leavingField)
      throw new ExecutionError("disabled_target", "This control is disabled or read-only.");
    if (action.type === "type" && !target?.editable)
      throw new ExecutionError("no_editable_target", "Focus an editable field before typing.");
    if (target?.href && activatesTarget) this.session.assertUrlAllowed(target.href);

    const riskyNavigation = /\b(delete|remove|send|pay|purchase|confirm|submit)\b/i.test(
      action.type === "navigate"
        ? new URL(action.url).pathname
        : target?.href && activatesTarget
          ? new URL(target.href).pathname
          : "",
    );
    const needsApproval =
      action.commits || Boolean(target?.consequential && activatesTarget) || riskyNavigation;
    if (action.type === "double_click" && needsApproval)
      throw new ExecutionError(
        "unsafe_double_click",
        "Use a single click for a consequential control.",
      );
    if (
      this.pending &&
      (this.pending.fingerprint !==
        (this.pending.domTarget ? before.domFingerprint : before.fingerprint) ||
        this.pending.action !== canonical)
    ) {
      if (this.pending.action !== canonical)
        throw new ExecutionError(
          "approval_pending",
          "Resolve the pending approval before proposing another action.",
        );
      this.pending = undefined;
      throw new ExecutionError(
        "stale_approval",
        "The page changed since approval was requested. Create a new proposal.",
      );
    }
    if (
      options.approval &&
      (!this.pending ||
        options.approval.approvalId !== this.pending.id ||
        options.approval.actionId !== action.id ||
        this.pending.action !== canonical)
    ) {
      throw new ExecutionError(
        "invalid_approval",
        "This approval does not match the pending browser action.",
      );
    }
    if (needsApproval && !options.approval) {
      this.pending ??= {
        domTarget: coordinateAction && Boolean(target?.domTarget),
        id: randomUUID(),
        action: canonical,
        actionId: action.id,
        fingerprint:
          coordinateAction && target?.domTarget ? before.domFingerprint : before.fingerprint,
      };
      const observation = this.publicObservation(before);
      return {
        actionId: action.id,
        status: "approval_required",
        approvalId: this.pending.id,
        ...observation,
      };
    }

    this.pending = undefined;
    this.completedIds.add(action.id);
    this.actions++;
    const approved = needsApproval && Boolean(options.approval);
    this.session.setActionPermission(approved);
    try {
      await setPagePermission(this.session.page, this.guardKey, approved);
      if (this.stopped) return { actionId: action.id, status: "cancelled" };
      await this.interact(action);
      if (this.stopped) return { actionId: action.id, status: "cancelled" };
      await this.session.followPendingRedirect();
      const safety = await readSafetyState(this.session.page, this.guardKey);
      if (safety.blocked || this.session.blockedMutation)
        throw new ExecutionError(
          "approval_required_by_page",
          "The page attempted an unapproved submission or request. It was blocked. Inspect the page and propose an action requiring approval.",
        );
      const verification = await verifyOutcome(
        this.session.page,
        options.expected,
        options.verificationTimeoutMs ?? 2000,
      );
      const observation = this.publicObservation(await this.readObservation());
      const after = await readSafetyState(this.session.page, this.guardKey);
      if (after.blocked || this.session.blockedMutation)
        throw new ExecutionError(
          "approval_required_by_page",
          "An unapproved submission or request was blocked. Inspect the page before proposing another action.",
        );
      return { actionId: action.id, status: "executed", verification, ...observation };
    } catch (error) {
      if (error instanceof ExecutionError && !this.stopped && !this.session.isClosed) {
        const observation = this.publicObservation(await this.readObservation());
        return { ...this.failure(action.id, error.code, error.message), ...observation };
      }
      throw error;
    } finally {
      this.session.setActionPermission(false);
      if (!this.session.isClosed)
        await setPagePermission(this.session.page, this.guardKey, false).catch(() => {});
    }
  }

  private async interact(action: BrowserAction): Promise<void> {
    const page = this.session.page;
    switch (action.type) {
      case "navigate":
        await this.session.navigate(action.url);
        break;
      case "click":
      case "double_click": {
        const handle = await page.evaluateHandle(
          ({ x, y }) => document.elementFromPoint(x, y),
          action,
        );
        try {
          const element = handle.asElement();
          const box = await element?.boundingBox();
          if (!element || !box)
            throw new ExecutionError(
              "missing_target",
              "There is no clickable element at these coordinates.",
            );
          await element.click({
            position: { x: action.x - box.x, y: action.y - box.y },
            clickCount: action.type === "double_click" ? 2 : 1,
          });
        } finally {
          await handle.dispose();
        }
        break;
      }
      case "type":
        await page.keyboard.insertText(action.text);
        break;
      case "key": {
        const key = action.key === "Space" ? " " : action.key;
        if (await page.locator(":focus").count()) await page.locator(":focus").press(key);
        else await page.keyboard.press(key);
        break;
      }
      case "scroll":
        await page.mouse.move(page.viewportSize()!.width / 2, page.viewportSize()!.height / 2);
        await page.mouse.wheel(action.deltaX, action.deltaY);
        // Wait for the browser's next paint rather than observing before wheel dispatch.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        break;
      case "wait":
        await delay(action.durationMs, undefined, { signal: this.stopSignal.signal });
        break;
    }
  }
}

export const createBrowserController = BrowserController.create;
