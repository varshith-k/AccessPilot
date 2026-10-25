import { explainPage, mapPage, narrate, planTask } from "@/lib/ai";
import { createTwinlyClientFromEnv, isTwinlyError } from "@/lib/twinly/client";
import { AgentError } from "./errors";
import { createTwinlyActions } from "./twinlyActions";
import { createRealBrowserFactory } from "./browserDriver";
import { SCHOLARSHIP_STEPS, createFakeDeps, createLabelDrivenActions } from "./fakes";
import type { AgentDeps, Planner } from "./types";

/** Real Gemma 4 for planning, page maps and narration. Needs `GEMINI_API_KEY` on the server. */
const gemmaPlanner: Planner = {
  planTask,
  mapPage,
  narrate,
  explainPage: (pageText, question) => explainPage(pageText, question),
};

function fakeDelay(): { stepDelayMs: number } | Record<string, never> {
  const raw = process.env.ACCESSPILOT_FAKE_DELAY_MS;
  const delay = Number(raw);
  return raw && Number.isFinite(delay) && delay >= 0 ? { stepDelayMs: delay } : {};
}

function twinlyActions() {
  if (process.env.ACCESSPILOT_BROWSER !== "real") {
    throw new AgentError(
      "internal_error",
      "Twinly needs a real browser to look at. Ask the person running AccessPilot to turn the real browser on.",
    );
  }
  try {
    const budget = Number(process.env.ACCESSPILOT_TWINLY_MAX_REQUESTS);
    return createTwinlyActions(
      createTwinlyClientFromEnv(),
      Number.isInteger(budget) && budget > 0 ? { maxRequests: budget } : {},
    );
  } catch (error) {
    if (!isTwinlyError(error)) throw error;
    throw new AgentError(
      "internal_error",
      "Twinly isn't set up on this server yet. Ask the person running it to add the Twinly key.",
    );
  }
}

/**
 * Builds the modules for one task.
 *
 * - `ACCESSPILOT_AGENT=fake` runs scripted stand-ins for Gemma, Twinly and the browser.
 * - `ACCESSPILOT_BROWSER=real` swaps the scripted browser for real Chromium (lib/browser). The scripted
 *   Twinly then finds the form controls by name on the live page. `ACCESSPILOT_BROWSER_HEADED=1`
 *   shows the window.
 * - `ACCESSPILOT_ACTIONS=twinly` swaps the scripted Twinly stand-in for the real Twinly computer-use API
 *   (needs `TWINLY_API_KEY` and `ACCESSPILOT_BROWSER=real`: Twinly reads real screenshots).
 * - `ACCESSPILOT_PLANNER=gemma` swaps in the real Gemma planner (lib/ai) for the fake one, so Gemma
 *   plans, describes pages and narrates while Twinly and the browser are still scripted.
 *
 * Still to wire, per docs/AGENT.md, when their PRs land:
 *   actions: the Twinly adapter from "@/lib/twinly"
 *   createBrowser: an adapter around createBrowserSession + the executor from "@/lib/browser"
 */
export function getAgentDeps(): AgentDeps {
  if (process.env.ACCESSPILOT_AGENT !== "fake") {
    throw new AgentError(
      "internal_error",
      "The AccessPilot agent isn't set up on this server yet. Ask the person running it to finish the setup.",
    );
  }
  let deps = createFakeDeps(fakeDelay());
  if (process.env.ACCESSPILOT_BROWSER === "real") {
    deps = {
      ...deps,
      createBrowser: createRealBrowserFactory(
        process.env.ACCESSPILOT_BROWSER_HEADED === "1"
          ? { headed: true, keepOpenMs: 10 * 60_000 }
          : {},
      ),
      actions: createLabelDrivenActions(SCHOLARSHIP_STEPS, "Submitted. Confirmation number 4821."),
    };
  }
  if (process.env.ACCESSPILOT_ACTIONS === "twinly") deps = { ...deps, actions: twinlyActions() };
  if (process.env.ACCESSPILOT_PLANNER !== "gemma") return deps;

  if (!process.env.GEMINI_API_KEY) {
    throw new AgentError(
      "internal_error",
      "The AI model isn't set up on this server yet. Ask the person running it to add the Gemini key.",
    );
  }
  return { ...deps, planner: gemmaPlanner };
}
