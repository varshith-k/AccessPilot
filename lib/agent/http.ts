import { ZodError, z, type ZodType } from "zod";
import { AgentError } from "./errors";
import type { TaskService } from "./service";
import type { TaskEvent } from "@/lib/contracts";
import { isTerminalEvent } from "@/lib/contracts";

/** The `{ error: { code, message } }` body every non-2xx response carries. */
export function errorResponse(error: unknown): Response {
  if (error instanceof AgentError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? "That request wasn't valid.";
    return Response.json({ error: { code: "invalid_request", message } }, { status: 400 });
  }
  console.error("[api] unexpected error:", error instanceof Error ? error.name : "unknown");
  return Response.json(
    {
      error: {
        code: "internal_error",
        message: "Something went wrong on our side. Please try again.",
      },
    },
    { status: 500 },
  );
}

/** Parses a JSON body. An empty body counts as `{}`, which the stop and resume routes send. */
export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const text = await request.text();
  let value: unknown = {};
  if (text.trim() !== "") {
    try {
      value = JSON.parse(text);
    } catch {
      throw new AgentError("invalid_request", "That request wasn't valid JSON.");
    }
  }
  return schema.parse(value);
}

export const idParams = z.object({ id: z.string().trim().min(1) });
export type RouteParams = { params: Promise<{ id: string }> };

/** Parses `?lastEventId=` (or the Last-Event-ID header) into the last seq the client has. */
export function readLastEventId(request: Request): number {
  const raw =
    new URL(request.url).searchParams.get("lastEventId") ?? request.headers.get("last-event-id");
  const parsed = Number(raw);
  return raw !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

const encoder = new TextEncoder();

/**
 * Server-sent events for one task: `id:` is the seq, `data:` is one compact JSON line, no `event:`
 * name, a comment heartbeat while idle, and the stream closes after the terminal event.
 */
export function createEventStream(
  service: TaskService,
  taskId: string,
  afterSeq: number,
  signal: AbortSignal,
  heartbeatMs = 10_000,
): ReadableStream<Uint8Array> {
  let cleanup = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, heartbeatMs);
      heartbeat.unref?.();

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the consumer.
        }
      };
      signal.addEventListener("abort", cleanup, { once: true });

      const send = (event: TaskEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`));
        if (isTerminalEvent(event)) queueMicrotask(cleanup);
      };
      unsubscribe = service.subscribe(taskId, afterSeq, send);
      if (closed) unsubscribe();
    },
    cancel() {
      cleanup();
    },
  });
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;
