import { mockScreenshots } from "@/lib/client/mock/screenshots";
import { createTwinlyClientFromEnv } from "@/lib/twinly/client";

/**
 * Calls the real Twinly API. Skipped unless TWINLY_API_KEY is set, e.g.
 *   TWINLY_API_KEY=twk_live_... npx vitest run tests/integration/twinly.live.test.ts
 * Each run uses one request from the account's daily allowance.
 */
const apiKey = process.env.TWINLY_API_KEY;

describe.skipIf(!apiKey)("Twinly live", () => {
  beforeEach(() => {
    vi.stubGlobal("window", undefined);
  });

  it("has the computer scope", async () => {
    const me = await createTwinlyClientFromEnv().me();
    expect(me.key?.scopes ?? me.can?.cloud ?? []).toContain("computer");
  }, 30_000);

  it("proposes a structured action for a screenshot", async () => {
    const result = await createTwinlyClientFromEnv().nextAction({
      goal: "Find the first text field on this form and click it.",
      screenshot: mockScreenshots.formEmpty,
      viewport: { width: 480, height: 300 },
    });
    expect(["click", "double_click", "type", "key", "scroll", "wait", "done", "fail"]).toContain(
      result.action.type,
    );
    if ("point" in result.action) {
      expect(result.action.point.x).toBeLessThan(480);
      expect(result.action.point.y).toBeLessThan(300);
    }
  }, 120_000);
});
