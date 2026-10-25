import { z } from "zod";

/** Maximum goal length in characters, enforced by both the form and the API. */
export const GOAL_MAX_LENGTH = 1000;

const LOCALHOST_NAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Only `https:` URLs, plus `http:` on the local machine for the demo site, may be automated. */
export function isAllowedTaskUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return url.hostname !== "";
  return url.protocol === "http:" && LOCALHOST_NAMES.has(url.hostname);
}

export const taskUrlSchema = z
  .string()
  .trim()
  .min(1, { message: "Enter a website address." })
  .refine(isAllowedTaskUrl, {
    message: "Use a full address starting with https://, or http://localhost for local testing.",
  });

export const goalSchema = z
  .string()
  .trim()
  .min(1, { message: "Describe what you want to get done." })
  .max(GOAL_MAX_LENGTH, { message: `Keep the goal under ${GOAL_MAX_LENGTH} characters.` });

const idSchema = z.string().trim().min(1);

/** Longest free-text notes a user can save in "Your details". */
export const PROFILE_NOTES_MAX_LENGTH = 1000;

const profileText = (max: number) => z.string().trim().max(max).optional();

/**
 * Details the user saved in Settings ("Your details") to be used when filling in forms. All fields
 * are optional; empty ones are ignored. Never passwords or card numbers: the agent hands those back.
 */
export const profileDetailsSchema = z.object({
  name: profileText(200),
  email: profileText(200),
  phone: profileText(50),
  notes: profileText(PROFILE_NOTES_MAX_LENGTH),
});

/** `POST /api/tasks` */
export const startTaskRequestSchema = z.object({
  url: taskUrlSchema,
  goal: goalSchema,
  details: profileDetailsSchema.optional(),
});
export const startTaskResponseSchema = z.object({
  taskId: idSchema,
});

/** `POST /api/tasks/:id/approve` */
export const approveRequestSchema = z.object({
  approvalId: idSchema,
});

/** `POST /api/tasks/:id/deny` */
export const denyRequestSchema = z.object({
  approvalId: idSchema,
  reason: z.string().trim().max(500).optional(),
});

/** `POST /api/tasks/:id/resume` and `POST /api/tasks/:id/stop` take an empty object. */
export const emptyRequestSchema = z.object({});

/** Body of every non-2xx response. `message` must be safe to show to the user. */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: idSchema,
    message: idSchema,
  }),
});

export const API_ERROR_CODES = [
  "invalid_request",
  "task_not_found",
  "approval_not_found",
  "invalid_state",
  "internal_error",
] as const;

export type StartTaskRequest = z.infer<typeof startTaskRequestSchema>;
export type ProfileDetails = z.infer<typeof profileDetailsSchema>;
export type StartTaskResponse = z.infer<typeof startTaskResponseSchema>;
export type ApproveRequest = z.infer<typeof approveRequestSchema>;
export type DenyRequest = z.infer<typeof denyRequestSchema>;
export type EmptyRequest = z.infer<typeof emptyRequestSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const taskPath = (taskId: string) => `/api/tasks/${encodeURIComponent(taskId)}`;

/** Paths relative to the API origin. Task ids are URL-encoded. */
export const apiPaths = {
  tasks: () => "/api/tasks",
  events: (taskId: string) => `${taskPath(taskId)}/events`,
  approve: (taskId: string) => `${taskPath(taskId)}/approve`,
  deny: (taskId: string) => `${taskPath(taskId)}/deny`,
  resume: (taskId: string) => `${taskPath(taskId)}/resume`,
  stop: (taskId: string) => `${taskPath(taskId)}/stop`,
} as const;
