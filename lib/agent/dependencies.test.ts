import { afterEach, describe, expect, it, vi } from "vitest";
import { mapPage, narrate, planTask } from "@/lib/ai";
import { getAgentDeps } from "./dependencies";
import { AgentError } from "./errors";

afterEach(() => vi.unstubAllEnvs());

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
});
