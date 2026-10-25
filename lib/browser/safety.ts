import type { Page } from "playwright";
import { SENSITIVE_FIELD_SELECTOR } from "./screenshot";
import type { BrowserAction } from "../contracts/browser";

export const SUPPORTED_KEYS = new Set([
  "Tab",
  "Shift+Tab",
  "Enter",
  "Space",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Backspace",
  "Delete",
  "ControlOrMeta+A",
  "Control+A",
  "Meta+A",
]);

/** Defense in depth for native, implicit and programmatic form submission. */
export async function installSafetyGuards(page: Page, key: string): Promise<void> {
  const install = (guardKey: string) => {
    const globals = window as unknown as Record<string, unknown>;
    if (globals[guardKey]) return;
    const state = { approved: false, blocked: false };
    globals[guardKey] = state;
    const block = (event: Event) => {
      if (state.approved) return;
      state.blocked = true;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("submit", block, true);
    const nativeSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      if (!state.approved) {
        state.blocked = true;
        return;
      }
      nativeSubmit.call(this);
    };
  };
  await page.addInitScript(install, key);
  await page.evaluate(install, key);
}

export async function setPagePermission(page: Page, key: string, approved: boolean): Promise<void> {
  await page.evaluate(
    ({ guardKey, allowed }) => {
      const state = (window as unknown as Record<string, { approved: boolean; blocked: boolean }>)[
        guardKey
      ];
      if (!state) throw new Error("Missing browser safety guard");
      state.approved = allowed;
      state.blocked = false;
    },
    { guardKey: key, allowed: approved },
  );
}

export async function readSafetyState(page: Page, key: string) {
  return page.evaluate(async (guardKey) => {
    const state = (window as unknown as Record<string, { blocked: boolean }>)[guardKey];
    if (!state) throw new Error("Missing browser safety guard");
    const focused = document.activeElement;
    // Only a digest leaves the page. Bind approval to current form values,
    // including hidden fields, without returning them in observations or logs.
    const fields = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input,textarea,select",
      ),
    ).map((field) => [
      field.id,
      field.name,
      field.value,
      field instanceof HTMLInputElement ? field.checked : false,
    ]);
    const bytes = fields.length
      ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(fields)))
      : new ArrayBuffer(0);
    const formDigest = Array.from(new Uint8Array(bytes))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const documentBytes =
      location.href === "about:blank"
        ? new ArrayBuffer(0)
        : await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(document.documentElement.outerHTML),
          );
    const documentDigest = Array.from(new Uint8Array(documentBytes))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return {
      blocked: state.blocked,
      scrollX,
      scrollY,
      formDigest,
      documentDigest,
      selection:
        focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
          ? [focused.selectionStart, focused.selectionEnd]
          : null,
      focus: focused ? `${focused.tagName}:${focused.id}` : "",
    };
  }, key);
}

export interface TargetSafety {
  domTarget: boolean;
  sensitive: boolean;
  manual: boolean;
  editable: boolean;
  consequential: boolean;
  href: string | null;
  disabled: boolean;
}

export async function inspectTarget(page: Page, action: BrowserAction): Promise<TargetSafety> {
  return page.evaluate(
    ({ proposal, sensitiveSelector }) => {
      const hit =
        proposal.type === "click" || proposal.type === "double_click"
          ? document.elementFromPoint(proposal.x, proposal.y)
          : document.activeElement;
      const element =
        hit?.closest(
          'button, input, textarea, select, a[href], [role="button"], [contenteditable], iframe',
        ) ?? hit;
      const input = element instanceof HTMLInputElement ? element : null;
      const sensitive = Boolean(element?.closest(sensitiveSelector));
      const editable = Boolean(
        element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLElement && element.isContentEditable) ||
        (input && ["text", "email", "search", "tel", "url", "number"].includes(input.type)),
      );
      const form =
        element instanceof HTMLButtonElement || element instanceof HTMLInputElement
          ? element.form
          : element?.closest("form");
      const isSubmit = Boolean(
        (element instanceof HTMLButtonElement && element.type === "submit" && form) ||
        (input && ["submit", "image"].includes(input.type) && form),
      );
      const text = `${element?.getAttribute("aria-label") ?? ""} ${element?.textContent ?? ""} ${input?.type ?? ""}`;
      const riskyLabel =
        /\b(submit|send|pay|purchase|buy|delete|remove|confirm|book|donate|publish|transfer)\b/i.test(
          text,
        );
      const unknownClick =
        (proposal.type === "click" || proposal.type === "double_click") &&
        !(
          editable ||
          element instanceof HTMLAnchorElement ||
          element instanceof HTMLButtonElement ||
          // Opening a dropdown changes nothing; submissions it might trigger are still blocked.
          element instanceof HTMLSelectElement ||
          // Date and time pickers only open or focus a field; clicking one changes nothing.
          (input &&
            ["checkbox", "radio", "date", "time", "datetime-local", "month", "week"].includes(
              input.type,
            ))
        );
      const activatingKey = proposal.type === "key" && ["Enter", "Space"].includes(proposal.key);
      return {
        domTarget:
          editable ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLButtonElement ||
          element instanceof HTMLAnchorElement,
        sensitive,
        manual: Boolean(element instanceof HTMLIFrameElement || input?.type === "file"),
        editable,
        consequential:
          isSubmit ||
          riskyLabel ||
          unknownClick ||
          element?.getAttribute("data-accesspilot-commits") === "true" ||
          Boolean(activatingKey && (form || !editable)),
        href: element instanceof HTMLAnchorElement ? element.href : null,
        disabled: Boolean(
          element?.matches(":disabled") ||
          element?.getAttribute("aria-disabled") === "true" ||
          input?.readOnly ||
          (element instanceof HTMLTextAreaElement && element.readOnly),
        ),
      };
    },
    { proposal: action, sensitiveSelector: SENSITIVE_FIELD_SELECTOR },
  );
}
