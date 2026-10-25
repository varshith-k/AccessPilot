import type {
  BrowserAction,
  BrowserPageContext,
  BrowserScreenshot,
  ExecuteBrowserAction,
  NarrationPriority,
  TaskEvent,
  UserInputReason,
} from "@/lib/contracts";

/**
 * Ports: the only things the orchestrator knows about the other modules. Each is satisfied
 * structurally, so lib/ai (Gemma), lib/twinly and lib/browser plug in without adapters
 * beyond a few lines (see lib/agent/dependencies.ts and docs/AGENT.md).
 */

// ---- Gemma (lib/ai) ----------------------------------------------------------------------------

export interface PlanStep {
  id: number;
  description: string;
  requiresConfirmation: boolean;
}

export interface Plan {
  intent: string;
  summary: string;
  steps: PlanStep[];
  missingInfo: { field: string; question: string }[];
  requiresConfirmation: boolean;
  clarifyingQuestion: string | null;
}

export interface PageMap {
  title: string;
  summary: string;
  regions: { name: string; description: string }[];
}

export interface Progress {
  kind:
    | "started"
    | "action_done"
    | "action_failed"
    | "needs_info"
    | "needs_approval"
    | "finished"
    | "failed";
  detail: string;
  pageContext?: string;
}

export interface Planner {
  planTask(goal: string, pageContext: string, userDetails?: Record<string, string>): Promise<Plan>;
  mapPage(pageContext: string): Promise<PageMap>;
  narrate(progress: Progress): Promise<{ text: string; priority: NarrationPriority }>;
  /** Answers a question about the page ("how many fields are there?") from a text outline of it. */
  explainPage?(pageText: string, question: string): Promise<string>;
}

// ---- Twinly (lib/twinly) -----------------------------------------------------------------------

export interface ActionHistoryItem {
  action: BrowserAction;
  outcome: "executed" | "failed" | "skipped";
}

/** What Twinly decided. `done` and `fail` are model completion states, never browser actions. */
export type NextAction =
  | { kind: "action"; action: BrowserAction }
  | { kind: "done"; summary: string }
  | { kind: "fail"; message: string }
  /** The page needs something only the user can give (a password, card number or code). */
  | { kind: "handoff"; reason: UserInputReason; what: string };

export interface ActionProvider {
  nextAction(input: {
    goal: string;
    screenshot: BrowserScreenshot;
    /** Element labels and bounds for the same view, for providers that want more than pixels. */
    pageContext?: BrowserPageContext;
    history: readonly ActionHistoryItem[];
    signal?: AbortSignal;
  }): Promise<NextAction>;
}

// ---- Playwright (lib/browser) ------------------------------------------------------------------

export interface Observation {
  /** Identifies this exact view of the page. Click actions are only accepted against the latest one. */
  observationId?: string;
  screenshot: BrowserScreenshot;
  pageContext: BrowserPageContext;
}

/** One driver per task. `close` must be safe to call more than once. */
export interface BrowserDriver {
  open(url: string, signal?: AbortSignal): Promise<Observation>;
  observe(): Promise<Observation>;
  execute: ExecuteBrowserAction;
  /**
   * A read-only text outline of the whole page (headings, every form field and button, with labels,
   * never values), not just the part in view. Used to answer questions about the page.
   */
  outline?(): Promise<string>;
  /** Cancels whatever the browser is doing right now and refuses further work. Safe to call at any time. */
  stop?(): Promise<void>;
  close(): Promise<void>;
}

// ---- Orchestrator ------------------------------------------------------------------------------

export interface AgentDeps {
  planner: Planner;
  actions: ActionProvider;
  createBrowser(): Promise<BrowserDriver>;
  /** Server-side demo profile (name, email…). Never sent to the model beyond planTask, never put in events unmasked. */
  userDetails?: Record<string, string>;
}

export interface AgentLimits {
  maxSteps: number;
  maxConsecutiveFailures: number;
  /** Narration is a nicety: if Gemma is slow the template text is used instead. */
  narrationTimeoutMs: number;
  /** Screenshots whose data URL is longer than this are skipped (the contract asks for under about 500 KB). */
  maxScreenshotChars: number;
}

export const DEFAULT_LIMITS: AgentLimits = {
  maxSteps: 25,
  maxConsecutiveFailures: 3,
  narrationTimeoutMs: 8_000,
  maxScreenshotChars: 700_000,
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A task event before the store stamps `taskId`, `seq` and `at` on it. */
export type EventInput = DistributiveOmit<TaskEvent, "taskId" | "seq" | "at">;

export type ApprovalDecision = "approve" | "deny" | "stopped";
export type ResumeDecision = "resume" | "stopped";

/** What the orchestrator may do to its task. Implemented by the task store. */
export interface TaskControl {
  readonly signal: AbortSignal;
  /** Validates against the contract and streams the event. Ignored once the task has ended. */
  emit(event: EventInput): void;
  waitForApproval(approvalId: string): Promise<ApprovalDecision>;
  waitForResume(): Promise<ResumeDecision>;
}
