import type { BrowserAction, BrowserPageContext } from "@/lib/contracts";
import { elementAt } from "./sensitive";

/** How far from the named control a stray click may be pulled back to it. */
const MAX_SNAP_PX = 150;

/** Words that describe the kind of control rather than which one it is. */
const FILLER = new Set([
  "the",
  "a",
  "field",
  "input",
  "box",
  "textbox",
  "text",
  "button",
  "link",
  "area",
  "control",
  "required",
  "optional",
  "your",
  "enter",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !FILLER.has(word));
}

const covers = (outer: string[], inner: string[]) => inner.every((word) => outer.includes(word));

/** True when two labels name the same control ("Full name textbox" and "Full name (required)"). */
export function labelsMatch(a: string, b: string): boolean {
  const first = words(a);
  const second = words(b);
  return first.length > 0 && second.length > 0 && (covers(first, second) || covers(second, first));
}

/**
 * A model that reads a screenshot is sometimes a few pixels off: it clicks the label text above a
 * field instead of the field. The browser then (rightly) treats the click as an unknown target and asks
 * for approval, and the field is not focused. If a click lands on no control at all, and the label the
 * model gave names exactly one control nearby, the click is moved to the middle of that control.
 *
 * A click the model marked as consequential is held to a stricter standard, because the user is
 * asked to approve it by name ("Submit application"): it must land on the control it names. If it
 * lands elsewhere, on nothing or on a different control, and exactly one control carries that name,
 * it is moved there, whatever the distance, so what runs is what the user approved. With no unique
 * match it is left to the browser's own checks.
 *
 * The hand-over and approval checks run on the moved click, not around it.
 */
export function snapClick(
  action: BrowserAction,
  page: BrowserPageContext | undefined,
): BrowserAction {
  if (action.type !== "click" && action.type !== "double_click") return action;
  if (!action.label || !page) return action;

  const under = elementAt(page, action.x, action.y);
  if (under && !action.commits) return action;
  if (under && action.commits && labelsMatch(action.label, under.label)) return action;

  const matches = page.elements.filter(
    (el) => el.bounds && !el.disabled && labelsMatch(action.label ?? "", el.label),
  );
  const target = matches.length === 1 ? matches[0]?.bounds : undefined;
  if (!target) return action;

  const x = target.x + target.width / 2;
  const y = target.y + target.height / 2;
  const near = Math.hypot(x - action.x, y - action.y) <= MAX_SNAP_PX;
  return action.commits || near ? { ...action, x, y } : action;
}
