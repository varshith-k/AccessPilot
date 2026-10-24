import { parseTaskEvent, parseTaskEventData } from "@/lib/contracts";

const narration = {
  type: "narration",
  taskId: "task_1",
  seq: 4,
  at: "2026-10-25T14:00:00.000Z",
  text: "Selected Computer Science.",
  priority: "polite",
};

describe("parseTaskEvent", () => {
  it("returns a typed event for valid input", () => {
    const result = parseTaskEvent(narration);
    expect(result).toEqual({ kind: "event", event: narration });
  });

  it("reports unknown event types without validating their payload", () => {
    expect(parseTaskEvent({ type: "task.paused", whatever: true })).toEqual({
      kind: "unknown",
      type: "task.paused",
    });
  });

  it.each([
    ["null", null],
    ["a string", "narration"],
    ["an array", [narration]],
    ["an object without type", { ...narration, type: undefined }],
    ["a numeric type", { ...narration, type: 7 }],
  ])("rejects %s as invalid with no type", (_label, value) => {
    const result = parseTaskEvent(value);
    expect(result.kind).toBe("invalid");
    expect(result).toMatchObject({ type: null });
  });

  it("rejects a known type with a bad payload and explains which field failed", () => {
    const result = parseTaskEvent({ ...narration, priority: "urgent" });
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") throw new Error("expected invalid");
    expect(result.type).toBe("narration");
    expect(result.message).toContain("priority");
  });
});

describe("parseTaskEventData", () => {
  it("parses SSE data strings", () => {
    expect(parseTaskEventData(JSON.stringify(narration))).toEqual({
      kind: "event",
      event: narration,
    });
  });

  it("reports malformed JSON as invalid", () => {
    expect(parseTaskEventData("{not json")).toEqual({
      kind: "invalid",
      type: null,
      message: "Event data is not valid JSON.",
    });
  });

  it("passes unknown types through", () => {
    expect(parseTaskEventData('{"type":"heartbeat"}')).toEqual({
      kind: "unknown",
      type: "heartbeat",
    });
  });
});
