import { afterEach, describe, expect, it, vi } from "vitest";
import { mapPage, narrate, planTask } from "@/lib/ai";
import { getAgentDeps } from "./dependencies";
import { AgentError } from "./errors";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getAgentDeps", () => {
  it("refuses to run unconfigured, with a plain message", () => {
    vi.stubEnv("ACCESSPILOT_AGENT", "");
    expect(() => getAgentDeps()).toThrow(AgentError);
    expect(() => getAgentDeps()).toThrow(/isn't set up/);
  });

  it("uses the scripted planner by default in fake mode", () => {
    vi.stubEnv("ACCESSPILOT_AGENT", "fake");
    vi.stubEnv("ACCESSPILOT_PLANNER", "");
    expect(getAgentDeps().planner.planTask).not.toBe(planTask);
  });

  it("swaps in the real Gemma functions when asked and a key is present", () => {
    vi.stubEnv("ACCESSPILOT_AGENT", "fake");
    vi.stubEnv("ACCESSPILOT_PLANNER", "gemma");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const { planner } = getAgentDeps();
    expect(planner.planTask).toBe(planTask);
    expect(planner.mapPage).toBe(mapPage);
    expect(planner.narrate).toBe(narrate);
  });

  it("explains a missing Gemini key without naming internals", () => {
    vi.stubEnv("ACCESSPILOT_AGENT", "fake");
    vi.stubEnv("ACCESSPILOT_PLANNER", "gemma");
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => getAgentDeps()).toThrow(/Gemini key/);
  });

  it("honours the fake step delay and ignores nonsense", () => {
    vi.stubEnv("ACCESSPILOT_AGENT", "fake");
    vi.stubEnv("ACCESSPILOT_FAKE_DELAY_MS", "abc");
    expect(() => getAgentDeps()).not.toThrow();
  });

  it("will not use Twinly without the real browser, or without a key", () => {
    vi.stubEnv("ACCESSPILOT_AGENT", "fake");
    vi.stubEnv("ACCESSPILOT_ACTIONS", "twinly");
    vi.stubEnv("ACCESSPILOT_BROWSER", "");
    expect(() => getAgentDeps()).toThrow(/real browser/);
    vi.stubEnv("ACCESSPILOT_BROWSER", "real");
    vi.stubEnv("TWINLY_API_KEY", "");
    expect(() => getAgentDeps()).toThrow(/Twinly key/);
  });

  it("uses the real Twinly provider when configured", () => {
    vi.stubEnv("ACCESSPILOT_AGENT", "fake");
    vi.stubEnv("ACCESSPILOT_ACTIONS", "twinly");
    vi.stubEnv("ACCESSPILOT_BROWSER", "real");
    vi.stubEnv("TWINLY_API_KEY", "twk_live_" + "a".repeat(43));
    // The Twinly client is server-only; hide jsdom's window so it can be constructed.
    vi.stubGlobal("window", undefined);
    const { actions } = getAgentDeps();
    expect(actions).toBeDefined();
    expect(actions.nextAction).toBeTypeOf("function");
  });
});
