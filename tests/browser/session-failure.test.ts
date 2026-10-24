import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  newContext: vi.fn(),
  newPage: vi.fn(),
  contextClose: vi.fn(),
  browserClose: vi.fn(),
}));

vi.mock("playwright", () => ({ chromium: { launch: mocks.launch } }));

import { createBrowserSession } from "../../lib/browser/session";

describe("session startup failure cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.launch.mockResolvedValue({ newContext: mocks.newContext, close: mocks.browserClose });
    mocks.newContext.mockResolvedValue({
      newPage: mocks.newPage,
      close: mocks.contextClose,
      setDefaultTimeout: vi.fn(),
      setDefaultNavigationTimeout: vi.fn(),
    });
  });

  it("closes the browser when context creation fails", async () => {
    const failure = new Error("context failed");
    mocks.newContext.mockRejectedValue(failure);
    await expect(createBrowserSession()).rejects.toBe(failure);
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });

  it("attempts both cleanup operations and preserves the original error", async () => {
    const failure = new Error("page failed");
    mocks.newPage.mockRejectedValue(failure);
    mocks.contextClose.mockRejectedValue(new Error("context cleanup failed"));
    mocks.browserClose.mockRejectedValue(new Error("browser cleanup failed"));
    await expect(createBrowserSession()).rejects.toBe(failure);
    expect(mocks.contextClose).toHaveBeenCalledOnce();
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });
});
