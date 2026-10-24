import { describe, expect, it } from "vitest";
import { browserActionSchema } from "@/lib/contracts/browser";

describe("browser action contract", () => {
  const metadata = { id: "action-1", commits: false };

  it.each([
    { type: "click", x: 120, y: 240 },
    { type: "double_click", x: 0, y: 0 },
    { type: "type", text: "Ada Lovelace" },
    { type: "key", key: "Tab" },
    { type: "scroll", deltaX: 0, deltaY: -300 },
    { type: "navigate", url: "http://localhost:4000/apply" },
    { type: "wait", durationMs: 500 },
  ])("accepts $type", (action) => {
    expect(browserActionSchema.safeParse({ ...metadata, ...action }).success).toBe(true);
  });

  it.each([
    { type: "click", x: -1, y: 0 },
    { type: "click", x: Infinity, y: 0 },
    { type: "wait", durationMs: 10_001 },
    { type: "scroll", deltaY: 100 },
    { type: "navigate", url: "not a URL" },
    { type: "submit" },
  ])("rejects malformed actions: %j", (action) => {
    expect(browserActionSchema.safeParse({ ...metadata, ...action }).success).toBe(false);
  });

  it("requires explicit consequential-action metadata", () => {
    expect(browserActionSchema.safeParse({ id: "a", type: "key", key: "Enter" }).success).toBe(
      false,
    );
  });
});
