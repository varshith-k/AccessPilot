import { z } from "zod";
import { realScheduler, type Scheduler } from "@/lib/client/scheduler";
import {
  normalizeTwinlyAction,
  pixelsToGrid,
  TwinlyActionError,
  twinlyNextActionResponseSchema,
  type ProposedAction,
  type TwinlyStep,
  type Viewport,
} from "./actions";

/**
 * Server-side client for Twinly's computer-use endpoint, `POST /v1/computer/next-action`.
 *
 * It sends the goal and the current screenshot, and returns the next action in viewport pixels.
 * It never performs the action: the caller (the executor) does that, takes a new screenshot and
 * calls again until the action is `done` or `fail`. Twinly refuses browser origins, so this must
 * only run in route handlers or the orchestrator, never in client components.
 */

export const TWINLY_DEFAULT_BASE_URL =
  "https://advktwnedlgnhswpxokg.supabase.co/functions/v1/twinly-api/v1";

export const GOAL_MAX_LENGTH = 2000;
/** Twinly limit for each screenshot, decoded. */
export const SCREENSHOT_MAX_BYTES = 4 * 1024 * 1024;
/** Twinly limit for the whole request body. */
export const REQUEST_MAX_BYTES = 6 * 1024 * 1024;
/** Twinly accepts 50 steps but only reads the last 20, so there is no point sending more. */
export const STEPS_SENT = 20;
export const ELEMENTS_MAX = 300;

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_INITIAL_BACKOFF_MS = 1000;
export const DEFAULT_MAX_BACKOFF_MS = 8000;
/** A `Retry-After` longer than this is not waited out; the error goes to the caller instead. */
export const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;

export type TwinlyErrorKind =
  /** Missing or malformed API key or options. */
  | "config"
  /** The input was rejected before sending, e.g. a screenshot that is too large. */
  | "invalid_request"
  /** Twinly answered with a non-2xx status. */
  | "http"
  /** The request never reached Twinly, or the response never came back. */
  | "network"
  /** No response within `timeoutMs`. */
  | "timeout"
  /** The caller's `AbortSignal` fired. */
  | "aborted"
  /** Twinly answered 2xx with a body or action this adapter can't use. */
  | "invalid_response";

interface TwinlyErrorInit {
  kind: TwinlyErrorKind;
  message: string;
  status?: number;
  code?: string;
  type?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  cause?: unknown;
}

/** Messages are for logs and the orchestrator, not the user. They never contain the API key. */
export class TwinlyError extends Error {
  override readonly name = "TwinlyError";
  readonly kind: TwinlyErrorKind;
  readonly status: number | null;
  /** Twinly's `error.code`, e.g. `rate_limited`, `scope_missing`, `invalid_model_output`. */
  readonly code: string | null;
  readonly type: string | null;
  readonly retryable: boolean;
  /** From the `Retry-After` header, when Twinly sent one. */
  readonly retryAfterMs: number | null;

  constructor(init: TwinlyErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.type = init.type ?? null;
    this.retryable = init.retryable ?? false;
    this.retryAfterMs = init.retryAfterMs ?? null;
  }
}

export function isTwinlyError(value: unknown): value is TwinlyError {
  return value instanceof TwinlyError;
}

/** Something on screen the executor already knows about, with its center in viewport pixels. */
export interface ScreenElement {
  id?: string | number;
  role?: string;
  label?: string;
  x: number;
  y: number;
}

export interface NextActionInput {
  /** What the user wants done, up to 2000 characters. */
  goal: string;
  /** The current screen: a base64 PNG, JPEG or WebP, as a data URL or bare base64. */
  screenshot: string;
  /** The screen before the last action, so Twinly can tell whether it worked. */
  previousScreenshot?: string;
  /** Size of the viewport the screenshot shows, in CSS pixels. Proposed points use this space. */
  viewport: Viewport;
  /** Actions performed so far, oldest first. Build each with `toTwinlyStep`. */
  steps?: readonly TwinlyStep[];
  /** Optional hints from the DOM or accessibility tree, in viewport pixels. */
  elements?: readonly ScreenElement[];
  signal?: AbortSignal;
}

export interface NextActionResult {
  action: ProposedAction;
  model: string | null;
  usage: Record<string, unknown> | null;
  /** 1 when the first request succeeded. */
  attempts: number;
  /** Wall time across all attempts, including waits between retries. */
  latencyMs: number;
}

export interface RetryInfo {
  /** The attempt that just failed, starting at 1. */
  attempt: number;
  delayMs: number;
  error: TwinlyError;
}

export interface TwinlyClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  scheduler?: Scheduler;
  timeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  maxRetryAfterMs?: number;
  /** Called before each retry, for logging latency and rate limits. */
  onRetry?: (info: RetryInfo) => void;
}

const meResponseSchema = z.looseObject({
  key: z.looseObject({ scopes: z.array(z.string()).optional() }).optional(),
  can: z.looseObject({ cloud: z.array(z.string()).optional() }).optional(),
});
export type TwinlyMe = z.infer<typeof meResponseSchema>;

const errorBodySchema = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional(),
    code: z.string().optional(),
  }),
});

/** Codes Twinly says must never be retried automatically, even on a retryable status. */
const NEVER_RETRY_CODES: ReadonlySet<string> = new Set([
  "job_unverified",
  "billing_record_failed",
  "billing_unverified",
]);

const DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function backoffDelay(attempt: number, initialMs: number, maxMs: number): number {
  return Math.min(initialMs * 2 ** (attempt - 1), maxMs);
}

/** `Retry-After` as seconds or an HTTP date, in milliseconds from `now`. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null || value.trim() === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function isRetryableStatus(status: number, code: string | null): boolean {
  if (code !== null && NEVER_RETRY_CODES.has(code)) return false;
  return status === 429 || status === 502 || status === 503;
}

function invalidRequest(message: string): TwinlyError {
  return new TwinlyError({ kind: "invalid_request", message });
}

function checkScreenshot(value: string, field: string): void {
  const base64 = DATA_URL_PATTERN.exec(value)?.[2] ?? (BASE64_PATTERN.test(value) ? value : null);
  if (base64 === null) {
    throw invalidRequest(
      `${field} must be a base64 PNG, JPEG or WebP, as a data URL or bare base64.`,
    );
  }
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = (base64.length * 3) / 4 - padding;
  if (bytes > SCREENSHOT_MAX_BYTES) {
    throw invalidRequest(
      `${field} is ${(bytes / 1024 / 1024).toFixed(1)} MB; Twinly accepts up to 4 MB. Send a JPEG about 1280 px wide.`,
    );
  }
}

export class TwinlyClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly scheduler: Scheduler;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxRetryAfterMs: number;
  private readonly onRetry: ((info: RetryInfo) => void) | undefined;

  constructor(options: TwinlyClientOptions) {
    if (typeof window !== "undefined") {
      throw new TwinlyError({
        kind: "config",
        message:
          "TwinlyClient is server-only. Twinly refuses browser origins and the key must stay secret.",
      });
    }
    const apiKey = options.apiKey.trim();
    if (!apiKey.startsWith("twk_")) {
      throw new TwinlyError({
        kind: "config",
        message: "Twinly API key is missing or malformed. Keys start with twk_live_.",
      });
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? TWINLY_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.scheduler = options.scheduler ?? realScheduler;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
    this.onRetry = options.onRetry;
  }

  /** Asks Twinly for the single next action toward `goal` on the given screen. */
  async nextAction(input: NextActionInput): Promise<NextActionResult> {
    const body = JSON.stringify(this.buildRequestBody(input));
    if (body.length > REQUEST_MAX_BYTES) {
      throw invalidRequest("Request is larger than Twinly's 6 MB limit. Send smaller screenshots.");
    }

    const started = this.scheduler.now();
    const { value, attempts } = await this.withRetries(input.signal, () =>
      this.send("/computer/next-action", { method: "POST", body }, input.signal),
    );

    const parsed = twinlyNextActionResponseSchema.safeParse(value);
    if (!parsed.success) {
      throw new TwinlyError({
        kind: "invalid_response",
        message: `Twinly's response did not match the computer.action shape: ${z.prettifyError(parsed.error)}`,
        cause: parsed.error,
      });
    }

    let action: ProposedAction;
    try {
      action = normalizeTwinlyAction(parsed.data.action, input.viewport, parsed.data.blocked);
    } catch (cause) {
      if (!(cause instanceof TwinlyActionError)) throw cause;
      throw new TwinlyError({ kind: "invalid_response", message: cause.message, cause });
    }

    return {
      action,
      model: parsed.data.model ?? null,
      usage: parsed.data.usage ?? null,
      attempts,
      latencyMs: this.scheduler.now() - started,
    };
  }

  /** `GET /v1/me`. Free; use it to check the key works and has the `computer` scope. */
  async me(signal?: AbortSignal): Promise<TwinlyMe> {
    const { value } = await this.withRetries(signal, () =>
      this.send("/me", { method: "GET" }, signal),
    );
    const parsed = meResponseSchema.safeParse(value);
    if (!parsed.success) {
      throw new TwinlyError({
        kind: "invalid_response",
        message: "Twinly's /me response was malformed.",
      });
    }
    return parsed.data;
  }

  private buildRequestBody(input: NextActionInput): Record<string, unknown> {
    const goal = input.goal.trim();
    if (goal === "") throw invalidRequest("Goal is empty.");
    if (goal.length > GOAL_MAX_LENGTH) {
      throw invalidRequest(
        `Goal is ${goal.length} characters; Twinly accepts up to ${GOAL_MAX_LENGTH}.`,
      );
    }
    checkScreenshot(input.screenshot, "screenshot");
    if (input.previousScreenshot !== undefined) {
      checkScreenshot(input.previousScreenshot, "previousScreenshot");
    }
    if (input.elements !== undefined && input.elements.length > ELEMENTS_MAX) {
      throw invalidRequest(
        `Twinly accepts up to ${ELEMENTS_MAX} elements, got ${input.elements.length}.`,
      );
    }

    const body: Record<string, unknown> = { goal, screenshot: input.screenshot };
    if (input.previousScreenshot !== undefined) body.previous_screenshot = input.previousScreenshot;
    if (input.steps !== undefined && input.steps.length > 0) {
      body.steps = input.steps.slice(-STEPS_SENT);
    }
    if (input.elements !== undefined && input.elements.length > 0) {
      body.elements = input.elements.map(({ x, y, ...rest }) => ({
        ...rest,
        ...pixelsToGrid({ x, y }, input.viewport),
      }));
    }
    return body;
  }

  private async withRetries(
    signal: AbortSignal | undefined,
    attempt: () => Promise<unknown>,
  ): Promise<{ value: unknown; attempts: number }> {
    for (let attempts = 1; ; attempts++) {
      try {
        return { value: await attempt(), attempts };
      } catch (cause) {
        if (!isTwinlyError(cause) || !cause.retryable || attempts > this.maxRetries) throw cause;
        const delayMs =
          cause.retryAfterMs ?? backoffDelay(attempts, this.initialBackoffMs, this.maxBackoffMs);
        if (delayMs > this.maxRetryAfterMs) throw cause;
        this.onRetry?.({ attempt: attempts, delayMs, error: cause });
        await this.sleep(delayMs, signal);
      }
    }
  }

  private async send(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw this.abortedError(signal.reason);

    const controller = new AbortController();
    let timedOut = false;
    const timer = this.scheduler.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        signal: controller.signal,
      });
    } catch (cause) {
      if (signal?.aborted) throw this.abortedError(cause);
      if (timedOut) {
        throw new TwinlyError({
          kind: "timeout",
          message: `Twinly did not answer within ${this.timeoutMs} ms.`,
          retryable: true,
          cause,
        });
      }
      throw new TwinlyError({
        kind: "network",
        message: "Could not reach Twinly.",
        retryable: true,
        cause,
      });
    } finally {
      this.scheduler.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    if (!response.ok) throw await this.httpError(response);

    try {
      return await response.json();
    } catch (cause) {
      throw new TwinlyError({
        kind: "invalid_response",
        message: "Twinly answered with a body that is not JSON.",
        status: response.status,
        cause,
      });
    }
  }

  private async httpError(response: Response): Promise<TwinlyError> {
    let detail: z.infer<typeof errorBodySchema>["error"] | null = null;
    try {
      const parsed = errorBodySchema.safeParse(await response.json());
      if (parsed.success) detail = parsed.data.error;
    } catch {
      // Fall back to the status alone.
    }
    const code = detail?.code ?? null;
    const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"), this.scheduler.now());
    return new TwinlyError({
      kind: "http",
      status: response.status,
      message: `Twinly returned ${response.status}${code === null ? "" : ` ${code}`}: ${detail?.message ?? response.statusText}`,
      ...(code === null ? {} : { code }),
      ...(detail?.type === undefined ? {} : { type: detail.type }),
      ...(retryAfterMs === null ? {} : { retryAfterMs }),
      retryable: isRetryableStatus(response.status, code),
    });
  }

  private abortedError(cause: unknown): TwinlyError {
    return new TwinlyError({ kind: "aborted", message: "The Twinly request was canceled.", cause });
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(this.abortedError(signal.reason));
        return;
      }
      const onAbort = () => {
        this.scheduler.clearTimeout(timer);
        reject(this.abortedError(signal?.reason));
      };
      const timer = this.scheduler.setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

/** Builds a client from `TWINLY_API_KEY` and, optionally, `TWINLY_BASE_URL`. */
export function createTwinlyClientFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: Omit<TwinlyClientOptions, "apiKey" | "baseUrl"> = {},
): TwinlyClient {
  const apiKey = env.TWINLY_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new TwinlyError({
      kind: "config",
      message:
        "TWINLY_API_KEY is not set. Create a key in Twinly, Settings, Developer API, with the computer scope.",
    });
  }
  const baseUrl = env.TWINLY_BASE_URL?.trim();
  return new TwinlyClient({ ...options, apiKey, ...(baseUrl ? { baseUrl } : {}) });
}
