import type { BrowserAction, BrowserPageContext, UserInputReason } from "@/lib/contracts";

/** Things the agent must never type for the user: the user does these themselves. */
const CAPTCHA = /captcha|i['’]?m not a robot|recaptcha|hcaptcha|turnstile/i;
const SECRET =
  /password|passcode|passphrase|\bpin\b|card number|credit card|debit card|\bcvv\b|\bcvc\b|security code|one[- ]time|\botp\b|verification code|2fa|\bssn\b|social security/i;
/** 13 to 19 digits, optionally spaced or dashed: looks like a card number. */
const CARD_LIKE = /^\D*(?:\d[ -]?){13,19}\D*$/;

export interface Handoff {
  reason: UserInputReason;
  /** Short, value-free name of what the user must handle ("password field"). */
  what: string;
}

function classify(text: string | undefined): Handoff | null {
  if (!text) return null;
  if (CAPTCHA.test(text)) return { reason: "captcha", what: "CAPTCHA" };
  if (SECRET.test(text)) return { reason: "sensitive_value", what: "sensitive field" };
  return null;
}

/** Smallest element whose bounds contain the point, so a button inside a form wins over the form. */
export function elementAt(page: BrowserPageContext | undefined, x: number, y: number) {
  let best: BrowserPageContext["elements"][number] | undefined;
  let bestArea = Infinity;
  for (const el of page?.elements ?? []) {
    const b = el.bounds;
    if (!b || x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height) continue;
    const area = b.width * b.height;
    if (area < bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Decides whether an action touches something the agent must hand to the user. Looks at what
 * Twinly says it is acting on, at the page element under a click, and at the text to be typed.
 * `lastTarget` is the label of the last element clicked, so a `type` after clicking the password
 * field is caught even though the type action itself carries no position.
 */
export function detectHandoff(
  action: BrowserAction,
  page: BrowserPageContext | undefined,
  lastTarget: string | undefined,
): Handoff | null {
  const fromLabels = classify(`${action.label ?? ""} ${action.reason ?? ""}`);
  if (fromLabels) return fromLabels;

  if (action.type === "click" || action.type === "double_click") {
    const el = elementAt(page, action.x, action.y);
    // The browser knows more than a label: it flags password inputs and other private fields itself.
    if (el?.sensitive || el?.inputType === "password") {
      return { reason: "sensitive_value", what: "sensitive field" };
    }
    return classify(el ? `${el.role} ${el.label}` : undefined);
  }
  if (action.type === "type") {
    if (CARD_LIKE.test(action.text)) return { reason: "sensitive_value", what: "card number" };
    return classify(lastTarget);
  }
  return null;
}

export function handoffInstructions(handoff: Handoff): string {
  return handoff.reason === "captcha"
    ? "Please solve the CAPTCHA in the browser window, then press Continue."
    : `I don't type passwords, card numbers or codes. Please fill in the ${handoff.what} in the browser window, then press Continue.`;
}

/** Hides the value of anything secret-looking when it is shown in an approval dialog. */
export function maskIfSensitive(label: string, value: string): string {
  return SECRET.test(label) || CAPTCHA.test(label) ? "••••" : value;
}

/** True for a profile key whose value must never leave the server (passwords, card numbers, codes). */
export function isSensitiveKey(key: string): boolean {
  return SECRET.test(key.replace(/[_-]+/g, " ")) || CAPTCHA.test(key);
}
