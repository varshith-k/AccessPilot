import {
  gridToPixels,
  isFinalAction,
  normalizeTwinlyAction,
  pixelsToGrid,
  toContractActionType,
  toTwinlyStep,
  TwinlyActionError,
  twinlyActionSchema,
  type TwinlyAction,
} from "@/lib/twinly/actions";

const viewport = { width: 1280, height: 800 };

function action(fields: Record<string, unknown>): TwinlyAction {
  return twinlyActionSchema.parse({ reason: "because", commits: false, ...fields });
}

describe("gridToPixels", () => {
  it("scales the 0-1000 grid to the viewport", () => {
    expect(gridToPixels({ x: 500, y: 500 }, viewport)).toEqual({ x: 640, y: 400 });
    expect(gridToPixels({ x: 0, y: 0 }, viewport)).toEqual({ x: 0, y: 0 });
    expect(gridToPixels({ x: 250, y: 125 }, viewport)).toEqual({ x: 320, y: 100 });
  });

  it("keeps the far edge inside the viewport", () => {
    expect(gridToPixels({ x: 1000, y: 1000 }, viewport)).toEqual({ x: 1279, y: 799 });
  });

  it("clamps out-of-range values", () => {
    expect(gridToPixels({ x: -20, y: 1400 }, viewport)).toEqual({ x: 0, y: 799 });
  });

  it("rejects an empty viewport", () => {
    expect(() => gridToPixels({ x: 1, y: 1 }, { width: 0, height: 800 })).toThrow(
      TwinlyActionError,
    );
    expect(() => gridToPixels({ x: 1, y: 1 }, { width: 10, height: Number.NaN })).toThrow(
      TwinlyActionError,
    );
  });
});

describe("pixelsToGrid", () => {
  it("is the inverse of gridToPixels for interior points", () => {
    expect(pixelsToGrid({ x: 640, y: 400 }, viewport)).toEqual({ x: 500, y: 500 });
    expect(pixelsToGrid({ x: 100, y: 3 }, viewport)).toEqual({ x: 78.1, y: 3.8 });
  });

  it("clamps points outside the viewport", () => {
    expect(pixelsToGrid({ x: -5, y: 9000 }, viewport)).toEqual({ x: 0, y: 1000 });
  });
});

describe("normalizeTwinlyAction", () => {
  it("converts a click to viewport pixels and keeps the raw grid action", () => {
    const raw = action({ type: "click", x: 812, y: 455, label: "Apply" });
    const result = normalizeTwinlyAction(raw, viewport);
    expect(result).toEqual({
      type: "click",
      point: { x: 1039, y: 364 },
      label: "Apply",
      reason: "because",
      requiresApproval: false,
      raw,
    });
  });

  it("marks committing actions as needing approval", () => {
    const result = normalizeTwinlyAction(
      action({ type: "click", x: 1, y: 1, commits: true }),
      viewport,
    );
    expect(result.requiresApproval).toBe(true);
  });

  it("defaults reason and commits when Twinly leaves them out", () => {
    const raw = twinlyActionSchema.parse({ type: "key", keys: "tab" });
    expect(normalizeTwinlyAction(raw, viewport)).toMatchObject({
      reason: "",
      requiresApproval: false,
    });
  });

  it("handles double_click, type and key", () => {
    expect(
      normalizeTwinlyAction(action({ type: "double_click", x: 0, y: 0 }), viewport),
    ).toMatchObject({ type: "double_click", point: { x: 0, y: 0 } });
    expect(normalizeTwinlyAction(action({ type: "type", text: "Ada" }), viewport)).toMatchObject({
      type: "type",
      text: "Ada",
    });
    expect(normalizeTwinlyAction(action({ type: "key", keys: "return" }), viewport)).toMatchObject({
      type: "key",
      keys: "return",
    });
  });

  it("converts scroll points and clamps the amount", () => {
    expect(
      normalizeTwinlyAction(
        action({ type: "scroll", x: 500, y: 500, direction: "down", amount: 99 }),
        viewport,
      ),
    ).toMatchObject({ type: "scroll", point: { x: 640, y: 400 }, direction: "down", amount: 20 });
    expect(
      normalizeTwinlyAction(action({ type: "scroll", x: 1, y: 1, direction: "up" }), viewport),
    ).toMatchObject({ amount: 3 });
  });

  it("clamps wait seconds", () => {
    expect(normalizeTwinlyAction(action({ type: "wait", seconds: 60 }), viewport)).toMatchObject({
      seconds: 10,
    });
    expect(normalizeTwinlyAction(action({ type: "wait" }), viewport)).toMatchObject({ seconds: 1 });
  });

  it("passes through done text and fail blocked", () => {
    expect(normalizeTwinlyAction(action({ type: "done", text: "4821" }), viewport)).toMatchObject({
      type: "done",
      text: "4821",
    });
    expect(normalizeTwinlyAction(action({ type: "done" }), viewport)).not.toHaveProperty("text");
    expect(
      normalizeTwinlyAction(action({ type: "fail" }), viewport, "sensitive_value"),
    ).toMatchObject({ type: "fail", blocked: "sensitive_value" });
  });

  it.each([
    [{ type: "click", x: 5 }, /without x and y/],
    [{ type: "type" }, /without text/],
    [{ type: "type", text: "" }, /without text/],
    [{ type: "key" }, /without keys/],
    [{ type: "scroll", x: 1, y: 1 }, /without a direction/],
  ])("rejects %j", (fields, message) => {
    expect(() => normalizeTwinlyAction(action(fields), viewport)).toThrow(message);
  });

  it("rejects unknown action types at the schema", () => {
    expect(twinlyActionSchema.safeParse({ type: "drag" }).success).toBe(false);
  });
});

describe("helpers", () => {
  const click = normalizeTwinlyAction(action({ type: "click", x: 10, y: 10 }), viewport);
  const done = normalizeTwinlyAction(action({ type: "done" }), viewport);

  it("builds steps from the raw grid action", () => {
    expect(toTwinlyStep(click)).toEqual(click.raw);
    expect(toTwinlyStep(click, "menu opened")).toEqual({ ...click.raw, result: "menu opened" });
    expect(toTwinlyStep(click)).not.toBe(click.raw);
  });

  it("maps to contract action types", () => {
    expect(toContractActionType(click)).toBe("click");
    expect(toContractActionType(done)).toBeNull();
  });

  it("detects final actions", () => {
    expect(isFinalAction(click)).toBe(false);
    expect(isFinalAction(done)).toBe(true);
  });
});
