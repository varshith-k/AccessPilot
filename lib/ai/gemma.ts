import { ZodError } from "zod";
import {
  EXPLAIN_SYSTEM_PROMPT,
  NARRATE_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
  REPAIR_PROMPT,
  buildExplainPrompt,
  buildNarratePrompt,
  buildPlanPrompt,
} from "./prompts";
import { TaskPlanSchema, type ProgressEvent, type TaskPlan } from "./schema";

const DEFAULT_MODEL = "gemma-4-26b-a4b-it";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** Page text beyond this is cut so a huge page cannot blow the context or the latency budget. */
const MAX_PAGE_CHARS = 24_000;
/** Steps containing these words always need user approval, whatever the model said. */
const COMMIT_PATTERN = /\b(submit|pay|purchase|buy|checkout|send|delete|remove|book|confirm order|place order|sign up|register)\b/i;

export interface GemmaOptions {
  apiKey?: string;
  model?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class GemmaError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GemmaError";
  }
}

interface Turn {
  role: "user" | "model";
  text: string;
}

async function generate(system: string, turns: Turn[], opts: GemmaOptions, temperature: number): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GemmaError("GEMINI_API_KEY is not set");
  const model = opts.model ?? process.env.GEMMA_MODEL ?? DEFAULT_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        generationConfig: { temperature },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
  } catch (err) {
    throw new GemmaError("Could not reach the Gemma API", err);
  }
  if (!res.ok) {
    throw new GemmaError(`Gemma API returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  // Skip thinking parts if the API returns them; keep only the answer text.
  const text = data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
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
  return { ...plan, steps, requiresConfirmation: plan.requiresConfirmation || steps.some((s) => s.requiresConfirmation) };
}

function truncate(pageContext: string): string {
  return pageContext.length > MAX_PAGE_CHARS ? `${pageContext.slice(0, MAX_PAGE_CHARS)}\n[page truncated]` : pageContext;
}

/**
 * Turns a request plus the current page into a validated plan.
 * Retries once, feeding validation errors back to the model.
 */
export async function planTask(
  goal: string,
  pageContext: string,
  userDetails?: Record<string, string>,
  opts: GemmaOptions = {},
): Promise<TaskPlan> {
  if (!goal.trim()) throw new GemmaError("Goal is empty");
  const turns: Turn[] = [{ role: "user", text: buildPlanPrompt(goal, truncate(pageContext), userDetails) }];

  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await generate(PLAN_SYSTEM_PROMPT, turns, opts, 0.2);
    try {
      return enforceConfirmation(TaskPlanSchema.parse(extractJson(reply)));
    } catch (err) {
      if (!(err instanceof SyntaxError || err instanceof ZodError)) throw err;
      lastProblem = err instanceof ZodError
        ? err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n")
        : err.message;
      turns.push({ role: "model", text: reply }, { role: "user", text: REPAIR_PROMPT(lastProblem) });
    }
  }
  throw new GemmaError(`Gemma did not return a valid plan after retry: ${lastProblem}`);
}

/** Short spoken-style message for the user about what the agent just did or needs. */
export async function narrate(event: ProgressEvent, opts: GemmaOptions = {}): Promise<string> {
  const safe = { ...event, pageContext: event.pageContext && truncate(event.pageContext) };
  return generate(NARRATE_SYSTEM_PROMPT, [{ role: "user", text: buildNarratePrompt(safe) }], opts, 0.4);
}

/** Plain-language explanation of a page, or an answer to a question about it. */
export async function explainPage(pageContext: string, question?: string, opts: GemmaOptions = {}): Promise<string> {
  return generate(
    EXPLAIN_SYSTEM_PROMPT,
    [{ role: "user", text: buildExplainPrompt(truncate(pageContext), question) }],
    opts,
    0.3,
  );
}
