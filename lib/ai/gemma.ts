import { ZodError, type ZodType } from "zod";
import {
  EXPLAIN_SYSTEM_PROMPT,
  NARRATE_SYSTEM_PROMPT,
  PAGE_MAP_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
  REPAIR_PROMPT,
  buildExplainPrompt,
  buildNarratePrompt,
  buildPageMapPrompt,
  buildPlanPrompt,
} from "./prompts";
import {
  PageMapSchema,
  TaskPlanSchema,
  type AgentProgress,
  type Narration,
  type PageMap,
  type TaskPlan,
} from "./schema";

const DEFAULT_MODEL = "gemma-4-26b-a4b-it";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** Page text beyond this is cut so a huge page cannot blow the context or the latency budget. */
const MAX_PAGE_CHARS = 24_000;
/** Steps containing these words always need user approval, whatever the model said. */
/**
 * Statuses worth another try. The hosted Gemma endpoint has been seen answering 500 and even 404 for
 * a model that works a second later, so a single bad answer must not end a task.
 */
const RETRYABLE_STATUS = new Set([404, 408, 429, 500, 502, 503, 504]);

const COMMIT_PATTERN =
  /\b(submit|pay|purchase|buy|checkout|send|delete|remove|book|confirm order|place order|sign up|register)\b/i;
/** Narration kinds that need the user's attention right now rather than at the next pause. */
const ASSERTIVE_KINDS = new Set<AgentProgress["kind"]>([
  "needs_info",
  "needs_approval",
  "action_failed",
  "failed",
]);

/** "minimal" turns Gemma's reasoning off (about 5x faster); "high" lets it think before answering. */
export type ThinkingLevel = "minimal" | "high";

export interface GemmaOptions {
  apiKey?: string;
  /** Overrides the per-call default: planning thinks, narration and page maps do not. */
  thinking?: ThinkingLevel;
  model?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Waits before each retry of a transient failure. Default [800, 2000]: up to three attempts. */
  retryDelaysMs?: readonly number[];
}

export class GemmaError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "GemmaError";
  }
}

interface Turn {
  role: "user" | "model";
  text: string;
}

async function generate(
  system: string,
  turns: Turn[],
  opts: GemmaOptions,
  temperature: number,
  thinking: ThinkingLevel,
): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GemmaError("GEMINI_API_KEY is not set");
  const model = opts.model ?? process.env.GEMMA_MODEL ?? DEFAULT_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;

  const delays = opts.retryDelaysMs ?? [800, 2000];
  let res: Response | undefined;
  let lastError: GemmaError | undefined;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1]));
    try {
      res = await doFetch(`${ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
          generationConfig: {
            temperature,
            thinkingConfig: { thinkingLevel: opts.thinking ?? thinking },
          },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
    } catch (err) {
      lastError = new GemmaError("Could not reach the Gemma API", err);
      continue;
    }
    if (res.ok) break;
    lastError = new GemmaError(
      `Gemma API returned ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
    if (!RETRYABLE_STATUS.has(res.status)) throw lastError;
    res = undefined;
  }
  if (!res) throw lastError ?? new GemmaError("Could not reach the Gemma API");

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  // Skip thinking parts if the API returns them; keep only the answer text.
  const text = data.candidates?.[0]?.content?.parts
    ?.filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new GemmaError("Gemma returned an empty response");
  return text;
}

/** Pulls the first balanced JSON object out of a reply, tolerating ```json fences and prose around it. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) throw new SyntaxError("No JSON object found in reply");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new SyntaxError("Unterminated JSON object in reply");
}

/** Deterministic safety net: never rely on the model alone to flag irreversible steps. */
export function enforceConfirmation(plan: TaskPlan): TaskPlan {
  const steps = plan.steps.map((s) => ({
    ...s,
    requiresConfirmation: s.requiresConfirmation || COMMIT_PATTERN.test(s.description),
  }));
  return {
    ...plan,
    steps,
    requiresConfirmation: plan.requiresConfirmation || steps.some((s) => s.requiresConfirmation),
  };
}

function truncate(pageContext: string): string {
  return pageContext.length > MAX_PAGE_CHARS
    ? `${pageContext.slice(0, MAX_PAGE_CHARS)}\n[page truncated]`
    : pageContext;
}

/** Asks for JSON, validates it, and retries once with the validation errors fed back to the model. */
async function generateValidated<T>(
  system: string,
  prompt: string,
  schema: ZodType<T>,
  what: string,
  opts: GemmaOptions,
  thinking: ThinkingLevel,
): Promise<T> {
  const turns: Turn[] = [{ role: "user", text: prompt }];
  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await generate(system, turns, opts, 0.2, thinking);
    try {
      return schema.parse(extractJson(reply));
    } catch (err) {
      if (!(err instanceof SyntaxError || err instanceof ZodError)) throw err;
      lastProblem =
        err instanceof ZodError
          ? err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n")
          : err.message;
      turns.push(
        { role: "model", text: reply },
        { role: "user", text: REPAIR_PROMPT(lastProblem) },
      );
    }
  }
  throw new GemmaError(`Gemma did not return a valid ${what} after retry: ${lastProblem}`);
}

/** Turns a request plus the current page into a validated plan. */
export async function planTask(
  goal: string,
  pageContext: string,
  userDetails?: Record<string, string>,
  opts: GemmaOptions = {},
): Promise<TaskPlan> {
  if (!goal.trim()) throw new GemmaError("Goal is empty");
  const plan = await generateValidated(
    PLAN_SYSTEM_PROMPT,
    buildPlanPrompt(goal, truncate(pageContext), userDetails),
    TaskPlanSchema,
    "plan",
    opts,
    // Fast mode: plans in a few seconds instead of up to a minute, with the same intent accuracy
    // in our measurements. The plan only drives narration, questions and missing details.
    "minimal",
  );
  return enforceConfirmation(plan);
}

/** Describes the layout of a page for the `page.map` event. */
export async function mapPage(pageContext: string, opts: GemmaOptions = {}): Promise<PageMap> {
  return generateValidated(
    PAGE_MAP_SYSTEM_PROMPT,
    buildPageMapPrompt(truncate(pageContext)),
    PageMapSchema,
    "page map",
    opts,
    "minimal",
  );
}

/** Short spoken-style message for the `narration` event. Urgent kinds are `assertive`. */
export async function narrate(event: AgentProgress, opts: GemmaOptions = {}): Promise<Narration> {
  const safe = { ...event, pageContext: event.pageContext && truncate(event.pageContext) };
  const text = await generate(
    NARRATE_SYSTEM_PROMPT,
    [{ role: "user", text: buildNarratePrompt(safe) }],
    opts,
    0.4,
    "minimal",
  );
  return { text, priority: ASSERTIVE_KINDS.has(event.kind) ? "assertive" : "polite" };
}

/** Plain-language explanation of a page, or an answer to a question about it. */
export async function explainPage(
  pageContext: string,
  question?: string,
  opts: GemmaOptions = {},
): Promise<string> {
  return generate(
    EXPLAIN_SYSTEM_PROMPT,
    [{ role: "user", text: buildExplainPrompt(truncate(pageContext), question) }],
    opts,
    0.3,
    "minimal",
  );
}
