import { errors, type Page } from "playwright";
import type { ExecuteActionOptions } from "../contracts/browser";
import { SENSITIVE_FIELD_SELECTOR } from "./screenshot";

export async function verifyOutcome(
  page: Page,
  expected: ExecuteActionOptions["expected"],
  timeout: number,
): Promise<"unverified" | "passed" | "failed"> {
  if (!expected) return "unverified";
  try {
    if (expected.type === "url") {
      await page.waitForURL(new URL(expected.url).href, { timeout, waitUntil: "domcontentloaded" });
    } else {
      await page.waitForFunction(
        ({ condition, sensitiveSelector }) => {
          const element = document.querySelector(condition.selector);
          if (!(element instanceof HTMLElement) || !element.checkVisibility()) return false;
          if (condition.type === "visible")
            return !condition.text || element.innerText.includes(condition.text);
          if (element.closest(sensitiveSelector)) return false;
          return (
            (element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement ||
              element instanceof HTMLSelectElement) &&
            element.value === condition.value
          );
        },
        { condition: expected, sensitiveSelector: SENSITIVE_FIELD_SELECTOR },
        { timeout },
      );
    }
    return "passed";
  } catch (error) {
    if (error instanceof errors.TimeoutError) return "failed";
    throw error;
  }
}
