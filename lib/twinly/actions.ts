import { z } from "zod";
import type { ActionType } from "@/lib/contracts";

/**
 * Twinly computer-use actions, as returned by `POST /v1/computer/next-action`, and their
 * normalized form for the executor (Person 4).
 *
 * Twinly places points on a 0 to 1000 grid over the screenshot: x=0 is the left edge, x=1000 the
 * right, y=0 the top, y=1000 the bottom. The executor works in browser pixels, so every proposed
 * action is converted to the viewport the screenshot was taken from. Reference:
 * https://www.twinly.tech/docs/developer-api and https://www.twinly.tech/openapi.yaml
 */

export const TWINLY_GRID_MAX = 1000;

export const twinlyActionTypeSchema = z.enum([
  "click",
  "double_click",
  "type",
  "key",
  "scroll",
  "wait",
  "done",
  "fail",
]);

export const scrollDirectionSchema = z.enum(["up", "down", "left", "right"]);

/**
 * One action exactly as Twinly sends it. Field presence per type is checked in
 * `normalizeTwinlyAction`, so a malformed action is reported with a useful message rather than a
 * union mismatch. Numbers are accepted as floats and clamped later; the spec says integers, but
 * rejecting 412.5 would only throw away a usable answer.
 */
export const twinlyActionSchema = z.looseObject({
  type: twinlyActionTypeSchema,
  x: z.number().optional(),
  y: z.number().optional(),
  text: z.string().optional(),
  keys: z.string().optional(),
  direction: scrollDirectionSchema.optional(),
  amount: z.number().optional(),
  seconds: z.number().optional(),
  label: z.string().optional(),
  reason: z.string().default(""),
  commits: z.boolean().default(false),
});

export const twinlyNextActionResponseSchema = z.looseObject({
  object: z.literal("computer.action").optional(),
  model: z.string().optional(),
  coordinates: z.literal("0-1000").optional(),
  action: twinlyActionSchema,
  /** `sensitive_value` when the action is a `fail` because a field needs a password, card or ID number. */
  blocked: z.string().optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
});

export type TwinlyAction = z.infer<typeof twinlyActionSchema>;
export type TwinlyActionType = z.infer<typeof twinlyActionTypeSchema>;
export type TwinlyNextActionResponse = z.infer<typeof twinlyNextActionResponseSchema>;
export type ScrollDirection = z.infer<typeof scrollDirectionSchema>;

/** Width and height of the browser viewport the screenshot shows, in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

interface BaseProposedAction {
  /** Twinly's one-line explanation, useful for narration and logs. */
  reason: string;
  /** What Twinly says it is acting on, e.g. "Submit button". Not always present. */
  label?: string;
  /**
   * True when the step sends, posts, pays, books, deletes or submits. The executor must get the
   * user's approval (an `approval.required` event) before performing it.
   */
  requiresApproval: boolean;
  /** The action as Twinly sent it, on the 0 to 1000 grid. Send it back in `steps` on the next call. */
  raw: TwinlyAction;
}

export type ProposedAction =
  | (BaseProposedAction & { type: "click" | "double_click"; point: Point })
  | (BaseProposedAction & { type: "type"; text: string })
  | (BaseProposedAction & { type: "key"; keys: string })
  | (BaseProposedAction & {
      type: "scroll";
      point: Point;
      direction: ScrollDirection;
      /** Twinly's scroll units, 1 to 20. The executor decides how many pixels one unit is. */
      amount: number;
    })
  | (BaseProposedAction & { type: "wait"; seconds: number })
  | (BaseProposedAction & { type: "done"; text?: string })
  | (BaseProposedAction & {
      type: "fail";
      /** `sensitive_value` means the page needs a secret: hand control to the user. */
      blocked?: string;
    });

export type ProposedActionOf<T extends ProposedAction["type"]> = Extract<
  ProposedAction,
  { type: T }
>;

/** Raised when Twinly's action can't be turned into something the executor can perform. */
export class TwinlyActionError extends Error {
  override readonly name = "TwinlyActionError";
}

export const DEFAULT_SCROLL_AMOUNT = 3;
export const DEFAULT_WAIT_SECONDS = 1;
const MIN_SCROLL_AMOUNT = 1;
const MAX_SCROLL_AMOUNT = 20;
const MIN_WAIT_SECONDS = 0.2;
const MAX_WAIT_SECONDS = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function assertViewport(viewport: Viewport): void {
  const valid = (n: number) => Number.isFinite(n) && n > 0;
  if (!valid(viewport.width) || !valid(viewport.height)) {
    throw new TwinlyActionError(
      `Viewport must have a positive width and height, got ${viewport.width}x${viewport.height}.`,
    );
  }
}

/**
 * Grid point to viewport pixels. The result is rounded and kept inside the viewport, so x=1000
 * lands on the last pixel column rather than one past it.
 */
export function gridToPixels(point: Point, viewport: Viewport): Point {
  assertViewport(viewport);
  const toPixel = (value: number, size: number) =>
    clamp(Math.round((clamp(value, 0, TWINLY_GRID_MAX) / TWINLY_GRID_MAX) * size), 0, size - 1);
  return { x: toPixel(point.x, viewport.width), y: toPixel(point.y, viewport.height) };
}

/** Viewport pixels to the grid, for the `elements` hint. Rounded to one decimal place. */
export function pixelsToGrid(point: Point, viewport: Viewport): Point {
  assertViewport(viewport);
  const toGrid = (value: number, size: number) =>
    Math.round(clamp((value / size) * TWINLY_GRID_MAX, 0, TWINLY_GRID_MAX) * 10) / 10;
  return { x: toGrid(point.x, viewport.width), y: toGrid(point.y, viewport.height) };
}

function requirePoint(action: TwinlyAction): Point {
  if (action.x === undefined || action.y === undefined) {
    throw new TwinlyActionError(`Twinly sent a "${action.type}" action without x and y.`);
  }
  return { x: action.x, y: action.y };
}

function requireText(action: TwinlyAction, field: "text" | "keys"): string {
  const value = action[field];
  if (value === undefined || value === "") {
    throw new TwinlyActionError(`Twinly sent a "${action.type}" action without ${field}.`);
  }
  return value;
}

/** Converts one Twinly action to pixel space and checks it has the fields its type needs. */
export function normalizeTwinlyAction(
  action: TwinlyAction,
  viewport: Viewport,
  blocked?: string,
): ProposedAction {
  const base: BaseProposedAction = {
    reason: action.reason,
    requiresApproval: action.commits,
    raw: action,
    ...(action.label === undefined ? {} : { label: action.label }),
  };

  switch (action.type) {
    case "click":
    case "double_click":
      return { ...base, type: action.type, point: gridToPixels(requirePoint(action), viewport) };
    case "type":
      return { ...base, type: "type", text: requireText(action, "text") };
    case "key":
      return { ...base, type: "key", keys: requireText(action, "keys") };
    case "scroll":
      if (action.direction === undefined) {
        throw new TwinlyActionError('Twinly sent a "scroll" action without a direction.');
      }
      return {
        ...base,
        type: "scroll",
        point: gridToPixels(requirePoint(action), viewport),
        direction: action.direction,
        amount: Math.round(
          clamp(action.amount ?? DEFAULT_SCROLL_AMOUNT, MIN_SCROLL_AMOUNT, MAX_SCROLL_AMOUNT),
        ),
      };
    case "wait":
      return {
        ...base,
        type: "wait",
        seconds: clamp(action.seconds ?? DEFAULT_WAIT_SECONDS, MIN_WAIT_SECONDS, MAX_WAIT_SECONDS),
      };
    case "done":
      return { ...base, type: "done", ...(action.text ? { text: action.text } : {}) };
    case "fail":
      return { ...base, type: "fail", ...(blocked === undefined ? {} : { blocked }) };
  }
}

/** One earlier action, sent back to Twinly in `steps` so it knows what has already happened. */
export type TwinlyStep = TwinlyAction & { result?: string };

/** Builds the history entry for an action the executor performed, with what happened if known. */
export function toTwinlyStep(action: ProposedAction, result?: string): TwinlyStep {
  return result === undefined ? { ...action.raw } : { ...action.raw, result };
}

/** Maps a proposed action to the `step.completed` action type in the UI contract. */
export function toContractActionType(action: ProposedAction): ActionType | null {
  return action.type === "done" || action.type === "fail" ? null : action.type;
}

/** True for `done` and `fail`: the loop should stop asking Twinly for more actions. */
export function isFinalAction(
  action: ProposedAction,
): action is ProposedActionOf<"done"> | ProposedActionOf<"fail"> {
  return action.type === "done" || action.type === "fail";
}
