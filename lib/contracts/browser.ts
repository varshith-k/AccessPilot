import { z } from "zod";

const coordinate = z.number().finite().nonnegative();
const metadata = {
  id: z.string().min(1),
  label: z.string().optional(),
  reason: z.string().optional(),
  commits: z.boolean(),
  observationId: z.string().min(1).optional(),
};

/** Internal contract: coordinates are viewport CSS pixels, never Twinly's raw units. */
export const browserActionSchema = z.discriminatedUnion("type", [
  z.object({ ...metadata, type: z.literal("click"), x: coordinate, y: coordinate }),
  z.object({ ...metadata, type: z.literal("double_click"), x: coordinate, y: coordinate }),
  z.object({ ...metadata, type: z.literal("type"), text: z.string().max(10_000) }),
  z.object({ ...metadata, type: z.literal("key"), key: z.string().min(1).max(100) }),
  z.object({
    ...metadata,
    type: z.literal("scroll"),
    deltaX: z.number().finite(),
    deltaY: z.number().finite(),
  }),
  z.object({ ...metadata, type: z.literal("navigate"), url: z.string().url() }),
  z.object({
    ...metadata,
    type: z.literal("wait"),
    durationMs: z.number().int().min(0).max(10_000),
  }),
]);

export type BrowserAction = z.infer<typeof browserActionSchema>;

export interface BrowserScreenshot {
  url?: string;
  capturedAt?: string;
  imageDataUrl: string;
  width: number;
  height: number;
  coordinateSpace: "viewport-css-pixels";
}

export interface BrowserPageContext {
  url: string;
  title: string;
  elements: Array<{
    role: string;
    label: string;
    bounds?: { x: number; y: number; width: number; height: number };
    inputType?: string;
    disabled?: boolean;
    required?: boolean;
    sensitive?: boolean;
    invalid?: boolean;
  }>;
  validationErrors?: string[];
  truncated?: boolean;
  /**
   * The page's readable text (headings, paragraphs, list items, link text), bounded. Excludes
   * form values, button labels, hidden and private content. Untrusted website content.
   */
  text?: string;
  textTruncated?: boolean;
}

export type ActionResult = {
  actionId: string;
  observationId?: string;
  pageContext?: BrowserPageContext;
  screenshot?: BrowserScreenshot;
} & (
  | { status: "executed"; verification: "unverified" | "passed" | "failed" }
  | { status: "approval_required"; approvalId: string }
  | { status: "cancelled" }
  | { status: "user_input_required"; reason: "sensitive_value" | "other"; instructions: string }
  | { status: "failed"; error: { code: string; message: string } }
);

/** Trusted orchestrator input; never copy approval from model-generated content. */
export interface ExecuteActionOptions {
  signal?: AbortSignal;
  approval?: { approvalId: string; actionId: string };
  expected?:
    | { type: "url"; url: string }
    | { type: "visible"; selector: string; text?: string }
    | { type: "field"; selector: string; value: string };
  verificationTimeoutMs?: number;
}

export interface BrowserObservation {
  observationId: string;
  screenshot: BrowserScreenshot;
  pageContext: BrowserPageContext;
}

export type ExecuteBrowserAction = (
  action: BrowserAction,
  options?: ExecuteActionOptions,
) => Promise<ActionResult>;
