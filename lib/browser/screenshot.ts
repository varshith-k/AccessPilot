import type { Page } from "playwright";
import type { BrowserScreenshot } from "../contracts/browser";

/** Also used by context extraction; applications can mark additional private controls. */
export const SENSITIVE_FIELD_SELECTOR = [
  'input[type="password"]',
  '[autocomplete*="cc-" i]',
  '[autocomplete*="password" i]',
  '[autocomplete*="one-time-code" i]',
  "[data-accesspilot-sensitive]",
].join(",");

export interface ScreenshotOptions {
  format?: "png" | "jpeg";
  quality?: number;
  timeoutMs?: number;
}

/** Viewport only; pixels align with page.mouse coordinates even on HiDPI displays. */
export async function captureScreenshot(
  page: Page,
  options: ScreenshotOptions = {},
): Promise<BrowserScreenshot> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("A fixed viewport is required for screenshot coordinates.");
  const format = options.format ?? "jpeg";
  const quality = options.quality ?? 75;
  if (!Number.isInteger(quality) || quality < 0 || quality > 100) {
    throw new RangeError("Screenshot quality must be an integer from 0 to 100.");
  }
  const timeout = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new RangeError("Screenshot timeout must be a positive safe integer.");
  }
  const buffer = await page.screenshot({
    type: format,
    ...(format === "jpeg" ? { quality } : {}),
    fullPage: false,
    scale: "css",
    caret: "hide",
    timeout,
    mask: [page.locator(SENSITIVE_FIELD_SELECTOR)],
    maskColor: "#000000",
  });
  return {
    imageDataUrl: `data:image/${format};base64,${buffer.toString("base64")}`,
    width: viewport.width,
    height: viewport.height,
    coordinateSpace: "viewport-css-pixels",
    url: page.url(),
    capturedAt: new Date().toISOString(),
  };
}
