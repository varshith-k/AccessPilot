import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBrowserSession, DEFAULT_VIEWPORT } from "../../lib/browser/session";

describe("real Chromium sessions", () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end('<title>Session demo</title><label>Name<input id="name"></label>');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local test port");
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("loads a local page, retains state and closes idempotently", async () => {
    const session = await createBrowserSession();
    const page = session.page;
    try {
      await page.goto(url);
      expect(await page.title()).toBe("Session demo");
      expect(page.viewportSize()).toEqual(DEFAULT_VIEWPORT);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
      await page.locator("#name").fill("Ada");
      expect(session.page).toBe(page);
      expect(await session.page.locator("#name").inputValue()).toBe("Ada");
      await session.page.evaluate(() => localStorage.setItem("task", "one"));
      await page.reload();
      expect(await page.evaluate(() => localStorage.getItem("task"))).toBe("one");
    } finally {
      await Promise.all([session.close(), session.close()]);
    }
    expect(page.isClosed()).toBe(true);
    expect(session.isClosed).toBe(true);
    expect(() => session.page).toThrow("closed");
  });

  it("isolates task storage and supports a custom viewport", async () => {
    const first = await createBrowserSession();
    let second: Awaited<ReturnType<typeof createBrowserSession>> | undefined;
    try {
      second = await createBrowserSession({ viewport: { width: 800, height: 600 } });
      await first.page.goto(url);
      await first.page.evaluate(() => localStorage.setItem("task", "private"));
      await second.page.goto(url);
      expect(await second.page.evaluate(() => localStorage.getItem("task"))).toBeNull();
      expect(second.page.viewportSize()).toEqual({ width: 800, height: 600 });
      await first.close();
      expect(await second.page.title()).toBe("Session demo");
    } finally {
      await first.close();
      await second?.close();
    }
  });

  it("reports externally closed pages", async () => {
    const session = await createBrowserSession();
    try {
      await session.page.close();
      expect(session.isClosed).toBe(true);
      expect(() => session.page).toThrow("closed");
    } finally {
      await session.close();
    }
  });

  it("rejects unbounded timeouts and invalid dimensions before launching", async () => {
    await expect(createBrowserSession({ actionTimeoutMs: 0 })).rejects.toThrow(RangeError);
    await expect(createBrowserSession({ viewport: { width: -1, height: 720 } })).rejects.toThrow(
      RangeError,
    );
  });
});
