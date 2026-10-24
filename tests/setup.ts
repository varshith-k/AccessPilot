import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";
import * as axeMatchers from "vitest-axe/matchers";

expect.extend(axeMatchers);

// jsdom has no canvas; axe probes it for color-contrast checks and logs noise otherwise.
HTMLCanvasElement.prototype.getContext = () => null;

afterEach(() => {
  cleanup();
});
