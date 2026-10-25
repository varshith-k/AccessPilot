export type TaskClientErrorKind =
  /** The server answered with a non-2xx status. */
  | "http"
  /** The request never reached the server, or the response never came back. */
  | "network"
  /** The server answered 2xx with a body that does not match the contract. */
  | "invalid_response"
  /** One streamed event failed validation. Non-fatal: the stream keeps going. */
  | "invalid_event"
  /** The event stream dropped and could not be re-established. */
  | "connection_lost";

interface TaskClientErrorInit {
  kind: TaskClientErrorKind;
  /** Plain-language text that is safe to show and speak to the user. */
  message: string;
  status?: number;
  code?: string;
  fatal?: boolean;
  cause?: unknown;
}

export class TaskClientError extends Error {
  override readonly name = "TaskClientError";
  readonly kind: TaskClientErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  /** Fatal errors end the task in the UI; non-fatal ones become dismissible warnings. */
  readonly fatal: boolean;

  constructor(init: TaskClientErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.fatal = init.fatal ?? init.kind !== "invalid_event";
  }
}

export function isTaskClientError(value: unknown): value is TaskClientError {
  return value instanceof TaskClientError;
}

/** Turns anything thrown into a message fit for the user. */
export function userMessageFor(error: unknown, fallback: string): string {
  if (isTaskClientError(error)) return error.message;
  return fallback;
}

/** How a failed approve, deny, or resume should be handled; see `ActionFailure`. */
export function actionFailureFor(error: unknown): "retry" | "gone" | "moved_on" {
  if (!isTaskClientError(error) || error.kind !== "http") return "retry";
  if (error.status === 404) return "gone";
  if (error.status === 409) return "moved_on";
  return "retry";
}

/** A request the server rejected as invalid will fail the same way if retried unchanged. */
export function isRetryable(error: unknown): boolean {
  return !(isTaskClientError(error) && error.kind === "http" && error.status === 400);
}
