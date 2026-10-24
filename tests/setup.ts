import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";
import * as axeMatchers from "vitest-axe/matchers";

expect.extend(axeMatchers);

// jsdom has no canvas; axe probes it for color-contrast checks and logs noise otherwise.
HTMLCanvasElement.prototype.getContext = () => null;

// jsdom implements <dialog> without showModal/close. Mimic the browser closely enough for unit
// tests: Escape fires a cancelable `cancel` event, and close() fires `close`. Focus containment
// is verified in real browsers by the Playwright tests.
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  const onEscape = function (this: HTMLDialogElement, event: KeyboardEvent) {
    if (event.key !== "Escape" || !this.open) return;
    const cancel = new Event("cancel", { cancelable: true });
    if (this.dispatchEvent(cancel)) this.close();
  };
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    if (this.open) return;
    this.setAttribute("open", "");
    this.addEventListener("keydown", onEscape);
  };
  HTMLDialogElement.prototype.show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute("open");
    this.removeEventListener("keydown", onEscape);
    this.dispatchEvent(new Event("close"));
  };
}

// Testing Library detects fake timers through a global `jest` and advances them while it awaits
// user-event; without this shim, user-event hangs under Vitest's fake timers.
Object.assign(globalThis, {
  jest: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) },
});

afterEach(() => {
  cleanup();
});
