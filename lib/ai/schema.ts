import { z } from "zod";

export const INTENTS = [
  "fill_application",
  "fill_form",
  "search",
  "navigate",
  "explain_page",
  "fix_form_errors",
  "other",
] as const;

export const StepSchema = z.object({
  id: z.number().int().positive(),
  description: z.string().min(1),
  /** True when this step changes something for real (submit, pay, send, delete). */
  requiresConfirmation: z.boolean().default(false),
});

export const MissingInfoSchema = z.object({
  /** Machine-friendly field name, e.g. "gpa". */
  field: z.string().min(1),
  /** Plain-language question to ask the user. */
  question: z.string().min(1),
});

export const TaskPlanSchema = z.object({
  intent: z.enum(INTENTS),
  /** One plain-language sentence suitable for being read aloud. */
  summary: z.string().min(1),
  steps: z.array(StepSchema).min(1).max(15),
  missingInfo: z.array(MissingInfoSchema).default([]),
  requiresConfirmation: z.boolean(),
  /** Set when the request is too ambiguous to plan; ask this before doing anything. */
  clarifyingQuestion: z.string().nullable().default(null),
});

export type TaskPlan = z.infer<typeof TaskPlanSchema>;
export type TaskStep = z.infer<typeof StepSchema>;
export type MissingInfo = z.infer<typeof MissingInfoSchema>;

/** Events the orchestrator can ask Gemma to narrate to the user. */
export const ProgressEventSchema = z.object({
  kind: z.enum([
    "started",
    "action_done",
    "action_failed",
    "needs_info",
    "needs_approval",
    "finished",
    "failed",
  ]),
  /** What happened, from the system's point of view (e.g. "Clicked 'Apply now'"). */
  detail: z.string(),
  /** Optional page text after the action, to describe what the user would now see. */
  pageContext: z.string().optional(),
});

export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
