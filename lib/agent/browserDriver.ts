import { randomUUID } from "node:crypto";
import { createBrowserController, type BrowserController } from "@/lib/browser";
import { AgentError } from "./errors";
import type { BrowserDriver, Observation } from "./types";

export interface RealBrowserOptions {
  /** Watch Chromium work. Defaults to headless. */
  headed?: boolean;
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
    const current = () => {
      if (!controller) throw new Error("Browser not opened");
      return controller;
    };

    return {
      async open(url, signal): Promise<Observation> {
        controller = await createBrowserController({
          allowedOrigins: [new URL(url).origin],
          headless: !options.headed,
        });
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
      close: async () => {
        await controller?.close();
      },
    };
  };
}
