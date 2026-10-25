import { randomUUID } from "node:crypto";
import { createBrowserController, type BrowserController } from "@/lib/browser";
import { AgentError } from "./errors";
import type { BrowserDriver, Observation } from "./types";

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
