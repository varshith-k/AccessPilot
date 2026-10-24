import {
  apiErrorResponseSchema,
  apiPaths,
  isTerminalEvent,
  parseTaskEventData,
  startTaskResponseSchema,
  type StartTaskRequest,
  type TaskEvent,
} from "@/lib/contracts";
import { TaskClientError } from "./errors";
import { realScheduler, type Scheduler, type TimerHandle } from "./scheduler";
import type { TaskClient } from "./types";

/** The parts of `EventSource` this client uses, so tests can supply a fake. */
export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface HttpTaskClientOptions {
  /** Origin and path prefix for the API, e.g. "https://api.example.com". Defaults to same origin. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  createEventSource?: EventSourceFactory;
  scheduler?: Scheduler;
  maxReconnectAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** Called for event types this frontend does not know. Defaults to a dev-only console message. */
  onUnknownEvent?: (type: string) => void;
}

export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
export const DEFAULT_INITIAL_BACKOFF_MS = 500;
export const DEFAULT_MAX_BACKOFF_MS = 8000;

const STATUS_MESSAGES: Record<number, string> = {
  400: "AccessPilot couldn't understand that request. Check the address and goal, then try again.",
  404: "That task no longer exists. Start a new one.",
  409: "That action doesn't apply right now. The task may have moved on.",
  429: "AccessPilot is busy. Wait a moment, then try again.",
};
const SERVER_ERROR_MESSAGE =
  "Something went wrong on the AccessPilot server. Try again in a moment.";
const NETWORK_ERROR_MESSAGE =
  "AccessPilot couldn't reach its server. Check your internet connection, then try again.";
const CONNECTION_LOST_MESSAGE =
  "Lost the connection to AccessPilot and couldn't reconnect. The task may still be running. Try again to start over.";

function logUnknownEvent(type: string): void {
  if (process.env.NODE_ENV === "development") {
    console.debug(`[HttpTaskClient] ignored unknown event type "${type}"`);
  }
}

export function backoffDelay(attempt: number, initialMs: number, maxMs: number): number {
  return Math.min(initialMs * 2 ** (attempt - 1), maxMs);
}

export class HttpTaskClient implements TaskClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly createEventSource: EventSourceFactory;
  private readonly scheduler: Scheduler;
  private readonly maxReconnectAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly onUnknownEvent: (type: string) => void;

  constructor(options: HttpTaskClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.createEventSource = options.createEventSource ?? ((url) => new EventSource(url));
    this.scheduler = options.scheduler ?? realScheduler;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.onUnknownEvent = options.onUnknownEvent ?? logUnknownEvent;
  }

  async start(input: StartTaskRequest): Promise<{ taskId: string }> {
    const response = await this.request(apiPaths.tasks(), input);
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw this.invalidResponse(cause);
    }
    const parsed = startTaskResponseSchema.safeParse(body);
    if (!parsed.success) throw this.invalidResponse(parsed.error);
    return parsed.data;
  }

  async approve(taskId: string, approvalId: string): Promise<void> {
    await this.request(apiPaths.approve(taskId), { approvalId });
  }

  async deny(taskId: string, approvalId: string, reason?: string): Promise<void> {
    await this.request(
      apiPaths.deny(taskId),
      reason === undefined ? { approvalId } : { approvalId, reason },
    );
  }

  async resume(taskId: string): Promise<void> {
    await this.request(apiPaths.resume(taskId), {});
  }

  async stop(taskId: string): Promise<void> {
    await this.request(apiPaths.stop(taskId), {});
  }

  subscribe(
    taskId: string,
    onEvent: (event: TaskEvent) => void,
    onError: (error: Error) => void,
  ): () => void {
    let source: EventSourceLike | null = null;
    let retryTimer: TimerHandle | null = null;
    let failedAttempts = 0;
    let lastSeq = -1;
    let closed = false;

    const close = () => {
      closed = true;
      source?.close();
      source = null;
      if (retryTimer !== null) {
        this.scheduler.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const connect = () => {
      retryTimer = null;
      if (closed) return;
      // A fresh EventSource does not send Last-Event-ID, so pass it as a query parameter.
      const query = lastSeq >= 0 ? `?lastEventId=${lastSeq}` : "";
      const current = this.createEventSource(`${this.baseUrl}${apiPaths.events(taskId)}${query}`);
      source = current;

      current.onmessage = (message) => {
        if (closed || source !== current) return;
        const parsed = parseTaskEventData(message.data);
        if (parsed.kind === "unknown") {
          this.onUnknownEvent(parsed.type);
          return;
        }
        if (parsed.kind === "invalid") {
          onError(
            new TaskClientError({
              kind: "invalid_event",
              message: "AccessPilot received an update it couldn't read and skipped it.",
              cause: parsed.message,
            }),
          );
          return;
        }
        const { event } = parsed;
        if (event.taskId !== taskId) return;
        failedAttempts = 0;
        lastSeq = Math.max(lastSeq, event.seq);
        onEvent(event);
        if (isTerminalEvent(event)) close();
      };

      current.onerror = () => {
        if (closed || source !== current) return;
        current.close();
        source = null;
        failedAttempts += 1;
        if (failedAttempts > this.maxReconnectAttempts) {
          close();
          onError(
            new TaskClientError({ kind: "connection_lost", message: CONNECTION_LOST_MESSAGE }),
          );
          return;
        }
        retryTimer = this.scheduler.setTimeout(
          connect,
          backoffDelay(failedAttempts, this.initialBackoffMs, this.maxBackoffMs),
        );
      };
    };

    connect();
    return close;
  }

  private async request(path: string, body: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new TaskClientError({ kind: "network", message: NETWORK_ERROR_MESSAGE, cause });
    }
    if (!response.ok) throw await this.httpError(response);
    return response;
  }

  private async httpError(response: Response): Promise<TaskClientError> {
    let code: string | undefined;
    let message: string | undefined;
    try {
      const parsed = apiErrorResponseSchema.safeParse(await response.json());
      if (parsed.success) {
        code = parsed.data.error.code;
        message = parsed.data.error.message;
      }
    } catch {
      // The status code alone is enough to build a message.
    }
    return new TaskClientError({
      kind: "http",
      status: response.status,
      ...(code === undefined ? {} : { code }),
      message:
        message ??
        STATUS_MESSAGES[response.status] ??
        (response.status >= 500
          ? SERVER_ERROR_MESSAGE
          : "AccessPilot couldn't complete that request."),
    });
  }

  private invalidResponse(cause: unknown): TaskClientError {
    return new TaskClientError({
      kind: "invalid_response",
      message: "AccessPilot's server sent an unexpected reply. Try again in a moment.",
      cause,
    });
  }
}
