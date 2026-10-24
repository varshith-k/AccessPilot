import type { BrowserAction, BrowserPageContext, ActionResult } from "@/lib/contracts";
import type {
  ActionHistoryItem,
  ActionProvider,
  AgentDeps,
  BrowserDriver,
  NextAction,
  Observation,
  Planner,
} from "./types";

/** A 1x1 PNG: enough to exercise the screenshot path without a real browser. */
export const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const PAGE: BrowserPageContext = {
  url: "http://localhost:4000/scholarship",
  title: "Scholarship application",
  elements: [
    { role: "textbox", label: "Full name", bounds: { x: 100, y: 100, width: 400, height: 40 } },
    { role: "textbox", label: "Email", bounds: { x: 100, y: 160, width: 400, height: 40 } },
    { role: "combobox", label: "Program", bounds: { x: 100, y: 220, width: 400, height: 40 } },
    { role: "textbox", label: "Essay", bounds: { x: 100, y: 280, width: 400, height: 120 } },
    {
      role: "button",
      label: "Submit application",
      bounds: { x: 100, y: 420, width: 200, height: 48 },
    },
  ],
};

const observation = (): Observation => ({
  screenshot: {
    imageDataUrl: TINY_PNG,
    width: 1280,
    height: 720,
    coordinateSpace: "viewport-css-pixels",
  },
  pageContext: PAGE,
});

const meta = (id: string, label: string, commits = false) => ({ id, label, commits });

/** The scholarship flow, as Twinly would propose it. */
const SCRIPT: BrowserAction[] = [
  { ...meta("a1", "Full name field"), type: "click", x: 300, y: 120 },
  { ...meta("a2", "Full name field"), type: "type", text: "Alex Morgan" },
  { ...meta("a3", "Email field"), type: "click", x: 300, y: 180 },
  { ...meta("a4", "Email field"), type: "type", text: "alex@example.com" },
  { ...meta("a5", "Program dropdown"), type: "click", x: 300, y: 240 },
  { ...meta("a6", "Computer Science option"), type: "click", x: 300, y: 300 },
  { ...meta("a7", "Submit application", true), type: "click", x: 200, y: 444 },
];

export interface FakeOptions {
  /** Pause between steps so the UI is watchable. Default 400 ms. */
  stepDelayMs?: number;
  script?: BrowserAction[];
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Scripted stand-ins for Gemma, Twinly and Playwright that follow the same interfaces as the real
 * modules. They let the whole backend and the UI run end to end before those modules are wired in.
 */
export function createFakeDeps(options: FakeOptions = {}): AgentDeps {
  const delay = options.stepDelayMs ?? 400;
  const script = options.script ?? SCRIPT;

  const planner: Planner = {
    async planTask() {
      return {
        intent: "fill_application",
        summary: "I'll fill in your scholarship application, then ask you before submitting.",
        steps: script.map((a, i) => ({
          id: i + 1,
          description: a.label ?? a.type,
          requiresConfirmation: a.commits,
        })),
        missingInfo: [],
        requiresConfirmation: true,
        clarifyingQuestion: null,
      };
    },
    async mapPage() {
      return {
        title: "Scholarship application",
        summary: "This page has a 4-field form and a Submit button.",
        regions: [{ name: "Application form", description: "Name, email, program, essay" }],
      };
    },
    async narrate(progress) {
      const urgent = ["needs_info", "needs_approval", "action_failed", "failed"].includes(
        progress.kind,
      );
      return { text: progress.detail, priority: urgent ? "assertive" : "polite" };
    },
  };

  const actions: ActionProvider = {
    async nextAction({
      history,
      signal,
    }: {
      history: readonly ActionHistoryItem[];
      signal?: AbortSignal;
    }): Promise<NextAction> {
      await sleep(delay, signal);
      const action = script[history.length];
      if (action) return { kind: "action", action };
      return { kind: "done", summary: "Submitted. Confirmation number 4821." };
    },
  };

  return {
    planner,
    actions,
    userDetails: { name: "Alex Morgan", email: "alex@example.com", program: "Computer Science" },
    async createBrowser(): Promise<BrowserDriver> {
      return {
        open: async () => observation(),
        observe: async () => observation(),
        execute: async (action): Promise<ActionResult> => ({
          actionId: action.id,
          status: "executed",
          verification: "unverified",
          ...observation(),
        }),
        close: async () => {},
      };
    },
  };
}
