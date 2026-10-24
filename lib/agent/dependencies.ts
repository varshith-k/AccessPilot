import { AgentError } from "./errors";
import { createFakeDeps } from "./fakes";
import type { AgentDeps } from "./types";

/**
 * Builds the real modules for one task.
 *
 * Today only the scripted fakes exist (`ACCESSPILOT_AGENT=fake`). To integrate, replace the
 * throw below with the real wiring described in docs/AGENT.md:
 *   planner: { planTask, mapPage, narrate } from "@/lib/ai"
 *   actions: the Twinly adapter from "@/lib/twinly"
 *   createBrowser: an adapter around createBrowserSession + the executor from "@/lib/browser"
 */
export function getAgentDeps(): AgentDeps {
  if (process.env.ACCESSPILOT_AGENT === "fake") {
    const delay = Number(process.env.ACCESSPILOT_FAKE_DELAY_MS);
    return createFakeDeps(
      Number.isFinite(delay) && delay >= 0 && process.env.ACCESSPILOT_FAKE_DELAY_MS
        ? { stepDelayMs: delay }
        : {},
    );
  }
  throw new AgentError(
    "internal_error",
    "The AccessPilot agent isn't set up on this server yet. Ask the person running it to finish the setup.",
  );
}
