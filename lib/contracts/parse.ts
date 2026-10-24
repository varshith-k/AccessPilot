import { z } from "zod";
import { isKnownEventType, taskEventSchema, type TaskEvent } from "./events";

/**
 * Outcome of validating one incoming event.
 * - `event`: valid, safe to hand to the reducer.
 * - `unknown`: well-formed envelope with a `type` this frontend does not know. Ignore it (log in dev only).
 * - `invalid`: not JSON, not an object, or a known type that fails validation. Surface a non-fatal warning.
 */
export type ParsedTaskEvent =
  | { kind: "event"; event: TaskEvent }
  | { kind: "unknown"; type: string }
  | { kind: "invalid"; type: string | null; message: string };

function readType(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("type" in value)) return null;
  const type: unknown = value.type;
  return typeof type === "string" ? type : null;
}

export function parseTaskEvent(value: unknown): ParsedTaskEvent {
  const type = readType(value);
  if (type === null) {
    return { kind: "invalid", type: null, message: "Event is missing a string `type` field." };
  }
  if (!isKnownEventType(type)) {
    return { kind: "unknown", type };
  }
  const result = taskEventSchema.safeParse(value);
  if (!result.success) {
    return { kind: "invalid", type, message: z.prettifyError(result.error) };
  }
  return { kind: "event", event: result.data };
}

/** Parses the `data` payload of one Server-Sent Event message. */
export function parseTaskEventData(data: string): ParsedTaskEvent {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return { kind: "invalid", type: null, message: "Event data is not valid JSON." };
  }
  return parseTaskEvent(value);
}
