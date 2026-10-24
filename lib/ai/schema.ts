import { z } from "zod";
import { pageMapEventSchema, type narrationEventSchema } from "@/lib/contracts";

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
  id: z.int().positive(),
  description: z.string().trim().min(1),
  /** True when this step changes something for real (submit, pay, send, delete). */
  requiresConfirmation: z.boolean().default(false),
});

export const MissingInfoSchema = z.object({
  /** Machine-friendly field name, e.g. "gpa". */
  field: z.string().trim().min(1),
  /** Plain-language question to ask the user. */
  question: z.string().trim().min(1),
});

export const TaskPlanSchema = z.object({
  intent: z.enum(INTENTS),
  /** One plain-language sentence suitable for being read aloud. */
  summary: z.string().trim().min(1),
  steps: z.array(StepSchema).min(1).max(15),
  missingInfo: z.array(MissingInfoSchema).default([]),
  requiresConfirmation: z.boolean(),
  /** Set when the request is too ambiguous to plan; ask this before doing anything. */
  clarifyingQuestion: z.string().nullable().default(null),
});

export type TaskPlan = z.infer<typeof TaskPlanSchema>;
export type TaskStep = z.infer<typeof StepSchema>;
export type MissingInfo = z.infer<typeof MissingInfoSchema>;

/** The `page.map` event minus its envelope, so the orchestrator can spread it straight into the event. */
export const PageMapSchema = pageMapEventSchema.pick({ title: true, summary: true, regions: true });
export type PageMap = z.infer<typeof PageMapSchema>;

/** Things the orchestrator can ask Gemma to put into words for the user. */
export const AgentProgressSchema = z.object({
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

export type AgentProgress = z.infer<typeof AgentProgressSchema>;

/** Matches the payload of the `narration` event. */
export type Narration = Pick<z.infer<typeof narrationEventSchema>, "text" | "priority">;
