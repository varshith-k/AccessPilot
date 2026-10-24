import type { ApiErrorCode } from "@/lib/contracts";

const STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  task_not_found: 404,
  approval_not_found: 404,
  invalid_state: 409,
  internal_error: 500,
};

/** An error whose message is safe to show to the user, per docs/CONTRACT.md. */
export class AgentError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
    this.status = STATUS[code];
  }
}

/** Thrown inside the orchestrator when the task is stopped; never reaches the user. */
export class AbortedError extends Error {
  constructor() {
    super("Task stopped");
    this.name = "AbortedError";
  }
}

/** Rejects with `AbortedError` as soon as `signal` aborts, whatever `promise` is doing. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new AbortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AbortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Waits `ms`, or rejects with `AbortedError` as soon as `signal` aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return abortable(new Promise<void>((resolve) => setTimeout(resolve, ms)), signal);
}
