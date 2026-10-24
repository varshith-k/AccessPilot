import {
  IMAGE_DATA_URL_PATTERN,
  TASK_EVENT_TYPES,
  TERMINAL_EVENT_TYPES,
  isKnownEventType,
  isTerminalEvent,
  taskEventSchema,
  type TaskEvent,
  type TaskEventType,
} from "@/lib/contracts";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const base = { taskId: "task_1", seq: 1, at: "2026-10-25T14:00:00.000Z" };

const validEvents: { [T in TaskEventType]: Extract<TaskEvent, { type: T }> } = {
  "task.started": {
    ...base,
    type: "task.started",
    url: "https://example.edu/apply",
    goal: "Complete the scholarship application",
  },
  "page.map": {
    ...base,
    type: "page.map",
    title: "Scholarship application",
    summary: "This page has a login, a 6-field form, and a Submit button.",
    regions: [{ name: "Application form", description: "6 fields" }],
  },
  "step.started": {
    ...base,
    type: "step.started",
    step: 3,
    description: "Choosing a program",
    totalSteps: 6,
  },
  "step.completed": {
    ...base,
    type: "step.completed",
    step: 3,
    description: "Selected Computer Science",
    action: { type: "click", label: "Computer Science" },
  },
  narration: {
    ...base,
    type: "narration",
    text: "Opening the program dropdown.",
    priority: "polite",
  },
  screenshot: {
    ...base,
    type: "screenshot",
    step: 3,
    imageDataUrl: PNG,
    alt: "Program dropdown open with Computer Science highlighted",
  },
  "approval.required": {
    ...base,
    type: "approval.required",
    approvalId: "appr_1",
    action: "Submit application",
    summary: "Submit the scholarship application for Ada Lovelace?",
    fields: [
      { label: "Name", value: "Ada Lovelace" },
      { label: "Essay", value: "" },
    ],
  },
  "user_input.required": {
    ...base,
    type: "user_input.required",
    reason: "sensitive_value",
    instructions: "Please type your password in the browser window, then press Continue.",
  },
  "task.completed": {
    ...base,
    type: "task.completed",
    summary: "Submitted. Confirmation number 4821.",
  },
  "task.failed": {
    ...base,
    type: "task.failed",
    code: "page_unreachable",
    message: "The website did not respond.",
    recoverable: true,
  },
  "task.stopped": { ...base, type: "task.stopped", by: "user" },
};

/** For every event type, at least one payload that must be rejected and why. */
const invalidEvents: { [T in TaskEventType]: [string, Record<string, unknown>][] } = {
  "task.started": [
    ["missing goal", { ...validEvents["task.started"], goal: undefined }],
    ["blank url", { ...validEvents["task.started"], url: "   " }],
  ],
  "page.map": [
    ["regions not an array", { ...validEvents["page.map"], regions: "form" }],
    ["region without name", { ...validEvents["page.map"], regions: [{ description: "x" }] }],
  ],
  "step.started": [
    ["step zero", { ...validEvents["step.started"], step: 0 }],
    ["fractional step", { ...validEvents["step.started"], step: 1.5 }],
    ["totalSteps zero", { ...validEvents["step.started"], totalSteps: 0 }],
  ],
  "step.completed": [
    [
      "unknown action type",
      { ...validEvents["step.completed"], action: { type: "drag_and_drop" } },
    ],
    ["missing action", { ...validEvents["step.completed"], action: undefined }],
  ],
  narration: [
    ["unknown priority", { ...validEvents.narration, priority: "urgent" }],
    ["empty text", { ...validEvents.narration, text: "" }],
  ],
  screenshot: [
    ["remote URL", { ...validEvents.screenshot, imageDataUrl: "https://evil.test/x.png" }],
    [
      "svg data URL",
      { ...validEvents.screenshot, imageDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" },
    ],
    [
      "script smuggled after base64",
      { ...validEvents.screenshot, imageDataUrl: `${PNG}"><script>alert(1)</script>` },
    ],
    ["empty alt", { ...validEvents.screenshot, alt: "" }],
  ],
  "approval.required": [
    ["missing approvalId", { ...validEvents["approval.required"], approvalId: undefined }],
    [
      "field value not a string",
      { ...validEvents["approval.required"], fields: [{ label: "Amount", value: 5 }] },
    ],
  ],
  "user_input.required": [
    ["unknown reason", { ...validEvents["user_input.required"], reason: "biometric" }],
    ["empty instructions", { ...validEvents["user_input.required"], instructions: "" }],
  ],
  "task.completed": [["missing summary", { ...validEvents["task.completed"], summary: undefined }]],
  "task.failed": [
    ["recoverable as string", { ...validEvents["task.failed"], recoverable: "yes" }],
    ["missing message", { ...validEvents["task.failed"], message: undefined }],
  ],
  "task.stopped": [["unknown actor", { ...validEvents["task.stopped"], by: "admin" }]],
};

describe("taskEventSchema", () => {
  it.each(TASK_EVENT_TYPES)("accepts a valid %s event", (type) => {
    const result = taskEventSchema.safeParse(validEvents[type]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(validEvents[type]);
  });

  describe.each(TASK_EVENT_TYPES)("rejects invalid %s events", (type) => {
    it.each(invalidEvents[type])("%s", (_label, payload) => {
      expect(taskEventSchema.safeParse(payload).success).toBe(false);
    });
  });

  describe("shared envelope", () => {
    const sample = validEvents.narration;

    it.each([
      ["missing taskId", { ...sample, taskId: undefined }],
      ["blank taskId", { ...sample, taskId: "" }],
      ["negative seq", { ...sample, seq: -1 }],
      ["fractional seq", { ...sample, seq: 1.5 }],
      ["seq as string", { ...sample, seq: "1" }],
      ["non-ISO at", { ...sample, at: "yesterday" }],
      ["missing at", { ...sample, at: undefined }],
    ])("rejects %s", (_label, payload) => {
      expect(taskEventSchema.safeParse(payload).success).toBe(false);
    });

    it("accepts timestamps with a numeric offset", () => {
      expect(
        taskEventSchema.safeParse({ ...sample, at: "2026-10-25T10:00:00-04:00" }).success,
      ).toBe(true);
    });

    it("strips unknown fields instead of rejecting them, so additive changes are safe", () => {
      const result = taskEventSchema.parse({ ...sample, futureField: 42 });
      expect(result).not.toHaveProperty("futureField");
      expect(result).toEqual(sample);
    });

    it("treats step.started totalSteps as optional", () => {
      const { totalSteps: _omitted, ...withoutTotal } = validEvents["step.started"];
      expect(taskEventSchema.safeParse(withoutTotal).success).toBe(true);
    });

    it("treats step.completed action label as optional", () => {
      const event = { ...validEvents["step.completed"], action: { type: "wait" } };
      expect(taskEventSchema.safeParse(event).success).toBe(true);
    });
  });
});

describe("IMAGE_DATA_URL_PATTERN", () => {
  it.each(["png", "jpeg", "webp"])("accepts image/%s", (format) => {
    expect(IMAGE_DATA_URL_PATTERN.test(`data:image/${format};base64,AAAA`)).toBe(true);
  });

  it.each([
    "data:image/gif;base64,AAAA",
    "data:image/png,rawbytes",
    "data:image/png;base64,",
    "DATA:image/png;base64,AAAA",
    " data:image/png;base64,AAAA",
    "javascript:alert(1)",
  ])("rejects %s", (value) => {
    expect(IMAGE_DATA_URL_PATTERN.test(value)).toBe(false);
  });
});

describe("event type helpers", () => {
  it("lists exactly the event types in the schema", () => {
    const schemaTypes = taskEventSchema.options.map((option) => option.shape.type.value);
    expect([...TASK_EVENT_TYPES].sort()).toEqual([...schemaTypes].sort());
  });

  it("recognizes known and unknown types", () => {
    expect(isKnownEventType("narration")).toBe(true);
    expect(isKnownEventType("task.paused")).toBe(false);
    expect(isKnownEventType("")).toBe(false);
  });

  it.each(TASK_EVENT_TYPES)("classifies %s as terminal or not", (type) => {
    const expected = (TERMINAL_EVENT_TYPES as readonly string[]).includes(type);
    expect(isTerminalEvent(validEvents[type])).toBe(expected);
  });
});
