import { randomUUID } from "node:crypto";
import { createBrowserController, type BrowserController } from "@/lib/browser";
import { AgentError } from "./errors";
import type { BrowserDriver, Observation } from "./types";

/** Which browser the agent drives: installed Google Chrome unless configured otherwise. */
function browserChannel(): { channel?: string; channelFallback: boolean } {
  const configured = process.env.ACCESSPILOT_BROWSER_CHANNEL?.trim();
  if (configured === "chromium") return { channelFallback: false };
  return { channel: configured || "chrome", channelFallback: true };
}

export interface RealBrowserOptions {
  /** Watch Chromium work. Defaults to headless. */
  headed?: boolean;
  /**
   * After a task ends, leave the window open this long so the user can look at the result, instead of
   * it vanishing the moment the task finishes. Opening the next task's browser closes it sooner, and
   * Stop still closes at once. Off (0) by default; meant for the visible window.
   */
  keepOpenMs?: number;
}

/** Longest outline sent to the model, so a huge page cannot blow the prompt. */
const MAX_OUTLINE_CHARS = 20_000;

/**
 * Lists the whole page, not just what is in view: headings, then every visible form field and button
 * with its label. Reads labels only, never what is typed into a field. Runs in the page, read-only.
 */
function outlinePage(): string {
  const clean = (text: string | null | undefined) =>
    (text ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  // Opacity is not checked: custom radios and checkboxes are often drawn over a transparent input.
  const visible = (el: Element) =>
    el instanceof HTMLElement &&
    el.checkVisibility({ checkVisibilityCSS: true }) &&
    !el.closest('[hidden], [aria-hidden="true"], [inert]');
  const labelOf = (el: HTMLElement): string => {
    const byId = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const wrapping = el.closest("label");
    const labelledBy = (el.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    return (
      clean(el.getAttribute("aria-label")) ||
      clean(labelledBy) ||
      clean(byId?.textContent) ||
      clean(wrapping?.textContent) ||
      clean(el.getAttribute("placeholder")) ||
      clean(el.getAttribute("name")) ||
      "unlabeled"
    );
  };
  const kindOf = (el: HTMLElement): string => {
    if (el instanceof HTMLSelectElement) return "dropdown";
    if (el instanceof HTMLTextAreaElement) return "text area";
    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") return el.type;
      return el.type === "text" ? "text field" : `${el.type} field`;
    }
    return "editable area";
  };

  const headings = [...document.querySelectorAll("h1, h2, h3")]
    .filter(visible)
    .map((h) => `- ${h.tagName.toLowerCase()}: ${clean(h.textContent)}`)
    .slice(0, 40);
  const fields = [
    ...document.querySelectorAll<HTMLElement>('input, select, textarea, [contenteditable="true"]'),
  ]
    .filter(
      (el) =>
        visible(el) &&
        !(
          el instanceof HTMLInputElement &&
          ["hidden", "submit", "button", "reset", "image"].includes(el.type)
        ),
    )
    .map((el) => `- ${kindOf(el)}: ${labelOf(el)}${el.matches(":required") ? " (required)" : ""}`);
  const buttons = [
    ...document.querySelectorAll<HTMLElement>(
      'button, input[type="submit"], input[type="button"], [role="button"]',
    ),
  ]
    .filter(visible)
    .map(
      (el) =>
        `- ${clean(el.textContent) || clean(el.getAttribute("value")) || clean(el.getAttribute("aria-label")) || "unlabeled"}`,
    )
    .slice(0, 60);

  // Readable text of the main content, so questions about what the page says can be answered.
  // innerText never includes what is typed into fields.
  const main = document.querySelector("main, [role='main'], article") ?? document.body;
  const text = (main instanceof HTMLElement ? main.innerText : "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 8000);

  return [
    `Page: ${clean(document.title)}`,
    `Headings:`,
    ...headings,
    `Form fields on the whole page (${fields.length}):`,
    ...fields,
    `Buttons (${buttons.length}):`,
    ...buttons,
    `Readable text of the page:`,
    text,
  ].join("\n");
}

/** Windows kept open for review after their task ended. One more task closes them. */
const lingering = new Set<BrowserController>();

async function closeLingering(): Promise<void> {
  const windows = [...lingering];
  lingering.clear();
  await Promise.all(windows.map((window) => window.close().catch(() => {})));
}

/**
 * One Chromium per task, behind the controller in lib/browser. The browser may only visit the
 * origin of the address the user gave, so a page cannot send the agent somewhere else.
 */
export function createRealBrowserFactory(
  options: RealBrowserOptions = {},
): () => Promise<BrowserDriver> {
  return async () => {
    let controller: BrowserController | undefined;
    let stopped = false;
    const current = () => {
      if (!controller) throw new Error("Browser not opened");
      return controller;
    };

    return {
      async open(url, signal): Promise<Observation> {
        await closeLingering();
        controller = await createBrowserController({
          allowedOrigins: [new URL(url).origin],
          // Real sites hop between www and the bare domain and load files from CDNs. Navigation
          // stays within the site; outside files are GET-only from public addresses.
          sameSiteNavigation: true,
          thirdPartySubresources: true,
          headless: !options.headed,
          // Google Chrome by default (ACCESSPILOT_BROWSER_CHANNEL=chromium for the bundled one);
          // falls back to bundled Chromium where Chrome isn't installed.
          ...browserChannel(),
        });
        if (stopped) {
          // Stop arrived while Chromium was starting.
          await controller.stop();
          throw new Error("Cancelled");
        }
        const result = await controller.execute(
          { id: `open_${randomUUID()}`, type: "navigate", url, commits: false },
          { signal },
        );
        if (result.status === "cancelled") throw new Error("Cancelled");
        if (result.status !== "executed") {
          throw new AgentError(
            "internal_error",
            "I couldn't open that page. Please check the address and try again.",
          );
        }
        return result.screenshot && result.pageContext
          ? {
              ...(result.observationId ? { observationId: result.observationId } : {}),
              screenshot: result.screenshot,
              pageContext: result.pageContext,
            }
          : controller.observe();
      },
      observe: () => current().observe(),
      // Trusted, read-only use of the page: it only reads labels, and never runs model actions.
      outline: async () => (await current().page.evaluate(outlinePage)).slice(0, MAX_OUTLINE_CHARS),
      execute: (action, executeOptions) => current().execute(action, executeOptions),
      stop: async () => {
        stopped = true;
        await controller?.stop();
      },
      close: async () => {
        const window = controller;
        if (!window) return;
        if (stopped || !options.keepOpenMs || window.isStopped) {
          await window.close();
          return;
        }
        lingering.add(window);
        const timer = setTimeout(() => {
          if (lingering.delete(window)) void window.close().catch(() => {});
        }, options.keepOpenMs);
        timer.unref?.();
      },
    };
  };
}
