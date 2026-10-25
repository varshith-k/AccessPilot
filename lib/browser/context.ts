import type { Page } from "playwright";
import type { BrowserPageContext } from "../contracts/browser";
import { SENSITIVE_FIELD_SELECTOR } from "./screenshot";

/**
 * A bounded map of visible, in-viewport controls, plus the page's readable text. Never reads form
 * values.
 */
export async function extractPageContext(
  page: Page,
  options: { maxElements?: number; maxTextChars?: number } = {},
): Promise<BrowserPageContext> {
  const maxElements = options.maxElements ?? 200;
  if (!Number.isInteger(maxElements) || maxElements < 1 || maxElements > 1000) {
    throw new RangeError("maxElements must be an integer from 1 to 1000.");
  }
  const maxTextChars = options.maxTextChars ?? 4000;
  if (!Number.isInteger(maxTextChars) || maxTextChars < 0 || maxTextChars > 20_000) {
    throw new RangeError("maxTextChars must be an integer from 0 to 20000.");
  }
  return page.evaluate(
    ({ limit, textLimit, sensitiveSelector }) => {
      const clean = (text: string | null | undefined) =>
        (text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      // A wrapping label can contain a textarea's initial value. Read only
      // ordinary text nodes, excluding editable/private/hidden descendants.
      const labelText = (root: Element | null): string => {
        if (!root) return "";
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const parts: string[] = [];
        while (walker.nextNode()) {
          const parent = walker.currentNode.parentElement;
          if (
            parent &&
            !parent.closest(
              `input, textarea, select, [contenteditable], [hidden], [aria-hidden="true"], ${sensitiveSelector}`,
            )
          )
            parts.push(walker.currentNode.textContent ?? "");
        }
        return clean(parts.join(" "));
      };
      const elements: BrowserPageContext["elements"] = [];
      const errors: string[] = [];
      const selector =
        'button, a[href], input, select, textarea, [role], [contenteditable="true"], [tabindex]';
      let truncated = false;
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        const rect = element.getBoundingClientRect();
        if (
          !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
          element.closest('[hidden], [aria-hidden="true"], [inert]') ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.bottom <= 0 ||
          rect.right <= 0 ||
          rect.top >= innerHeight ||
          rect.left >= innerWidth
        )
          continue;
        if (elements.length >= limit) {
          truncated = true;
          break;
        }
        const input = element instanceof HTMLInputElement ? element : null;
        const control =
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
            ? element
            : null;
        const labelledBy = element
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .map((id) => labelText(document.getElementById(id)))
          .join(" ");
        const label =
          clean(labelledBy) ||
          clean(element.getAttribute("aria-label")) ||
          clean(
            control
              ? Array.from(control.labels ?? [])
                  .map((item) => labelText(item))
                  .join(" ")
              : "",
          ) ||
          clean(!control && !element.isContentEditable ? labelText(element) : "") ||
          clean(element.getAttribute("title")) ||
          clean(element.getAttribute("placeholder"));
        let role = element.getAttribute("role")?.split(/\s+/)[0] ?? "";
        if (!role) {
          if (element instanceof HTMLButtonElement) role = "button";
          else if (element instanceof HTMLAnchorElement) role = "link";
          else if (element instanceof HTMLSelectElement)
            role = element.multiple ? "listbox" : "combobox";
          else if (input && ["checkbox", "radio", "range", "number"].includes(input.type)) {
            role =
              { checkbox: "checkbox", radio: "radio", range: "slider", number: "spinbutton" }[
                input.type
              ] ?? "textbox";
          } else if (input && ["submit", "button", "reset", "image"].includes(input.type))
            role = "button";
          else role = control || element.isContentEditable ? "textbox" : "generic";
        }
        const errorIds = element.getAttribute("aria-errormessage")?.split(/\s+/) ?? [];
        const validationErrors = errorIds
          .map((id) => labelText(document.getElementById(id)))
          .filter(Boolean);
        errors.push(...validationErrors);
        elements.push({
          role,
          label,
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          ...(input ? { inputType: input.type } : {}),
          disabled:
            element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
          required: Boolean(control?.required) || element.getAttribute("aria-required") === "true",
          sensitive: Boolean(element.closest(sensitiveSelector)),
          invalid:
            element.getAttribute("aria-invalid") === "true" ||
            Boolean(control?.validity && !control.validity.valid),
        });
      }
      // Readable text for the model: the whole page (not just the viewport), main content first
      // when the page marks it. Controls are already listed above, so their text and every form
      // value, hidden node, and private field is skipped.
      const textParts: string[] = [];
      let textLength = 0;
      let textTruncated = false;
      if (textLimit > 0) {
        const root =
          document.querySelector<HTMLElement>("main, [role='main'], article") ?? document.body;
        const skip = `script, style, noscript, template, svg, button, select, option, input, textarea, [contenteditable]:not([contenteditable="false"]), [role="button"], [hidden], [aria-hidden="true"], [inert], ${sensitiveSelector}`;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const parent = walker.currentNode.parentElement;
          const raw = (walker.currentNode.textContent ?? "").replace(/\s+/g, " ").trim();
          if (!parent || raw === "" || parent.closest(skip)) continue;
          if (!parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
          const heading = parent.closest("h1, h2, h3, h4, h5, h6");
          const piece = heading ? `\n${"#".repeat(Number(heading.tagName[1]))} ${raw}\n` : raw;
          if (textLength + piece.length > textLimit) {
            textTruncated = true;
            break;
          }
          textParts.push(piece);
          textLength += piece.length + 1;
        }
      }
      const text = textParts
        .join(" ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return {
        url: location.href,
        title: document.title.slice(0, 300),
        elements,
        validationErrors: [...new Set(errors)].slice(0, 50),
        truncated,
        ...(text ? { text } : {}),
        ...(textTruncated ? { textTruncated } : {}),
      };
    },
    { limit: maxElements, textLimit: maxTextChars, sensitiveSelector: SENSITIVE_FIELD_SELECTOR },
  );
}
