import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBrowserSession } from "../../lib/browser/session";
import { createUrlPolicy, NavigationPolicyError } from "../../lib/browser/policy";
import { captureScreenshot } from "../../lib/browser/screenshot";
import { extractPageContext } from "../../lib/browser/context";

describe("navigation and observation in Chromium", () => {
  let permitted: Server;
  let forbidden: Server;
  let origin: string;
  let forbiddenOrigin: string;
  let forbiddenRequests = 0;

  const listen = async (server: Server) => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    return `http://127.0.0.1:${address.port}`;
  };

  beforeAll(async () => {
    forbidden = createServer((_request, response) => {
      forbiddenRequests++;
      response.end("Must never be reached");
    });
    forbiddenOrigin = await listen(forbidden);
    permitted = createServer((request, response) => {
      if (request.url === "/redirect" || request.url === "/chain") {
        response.writeHead(302, {
          Location: request.url === "/chain" ? "/redirect" : forbiddenOrigin,
        });
        response.end();
      } else if (request.url === "/loop") {
        response.writeHead(302, { Location: "/loop" });
        response.end();
      } else if (request.url === "/allowed-redirect") {
        response.writeHead(302, { Location: "/form" });
        response.end();
      } else if (request.url === "/missing") {
        response.writeHead(404, { "Content-Type": "text/html" });
        response.end("Missing");
      } else {
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><title>Scholarship demo</title>
          <style>body {margin: 10px} input {display: block} #below {position:absolute;top:2000px}</style>
          <label for="name">Full name</label><input id="name" required value="PRIVATE_NAME">
          <span id="program-label">Program</span><select aria-labelledby="program-label"><option>CS</option></select>
          <input aria-label="Email" aria-invalid="true" aria-errormessage="email-error" value="PRIVATE_EMAIL">
          <p id="email-error">Enter a valid email.</p>
          <label>Password<input id="password" type="password" value="PRIVATE_PASSWORD"></label>
          <input id="card" aria-label="Card" autocomplete="cc-number" value="4111111111111111">
          <button id="apply">Apply</button><button disabled>Unavailable</button>
          <a href="/form">Application</a><input type="checkbox" aria-label="Agree">
          <label>Essay<textarea>PRIVATE_ESSAY</textarea></label><div role="button" tabindex="0">Custom control</div>
          <button hidden>Hidden</button><div aria-hidden="true"><button>Aria hidden</button></div>
          <button style="opacity:0">Transparent</button><button id="below">Below fold</button>
          <div style="height:2500px"></div>`);
      }
    });
    origin = await listen(permitted);
  });

  afterAll(async () => {
    await Promise.all(
      [permitted, forbidden].map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
  });

  it("requires exact trusted origins and rejects unsafe URLs", () => {
    const policy = createUrlPolicy([origin, "https://demo.example"]);
    expect(policy.allows(`${origin}/form`)).toBe(true);
    for (const url of [
      forbiddenOrigin,
      "https://sub.demo.example",
      "https://demo.example.evil/",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,hello",
      "https://user:pass@demo.example/",
      "http://demo.example/",
      "broken",
    ]) {
      expect(policy.allows(url)).toBe(false);
      expect(() => policy.assertAllowed(url)).toThrow(NavigationPolicyError);
    }
    expect(() => createUrlPolicy([`${origin}/path`])).toThrow(NavigationPolicyError);
    expect(createUrlPolicy().allows(origin)).toBe(false);
  });

  it("opens allowed pages and redirects, rejects invalid targets and HTTP errors", async () => {
    const session = await createBrowserSession({ allowedOrigins: [origin] });
    try {
      expect(await session.navigate(`${origin}/allowed-redirect`)).toEqual({
        url: `${origin}/form`,
        status: 200,
      });
      await expect(session.navigate(forbiddenOrigin)).rejects.toThrow(NavigationPolicyError);
      expect(session.page.url()).toBe(`${origin}/form`);
      await expect(session.navigate(`${origin}/missing`)).rejects.toThrow("HTTP 404");
      await expect(session.navigate(`${origin}/loop`)).rejects.toThrow("10 redirects");
    } finally {
      await session.close();
    }
  });

  it("denies network access by default and closes non-network navigations", async () => {
    const locked = await createBrowserSession();
    try {
      await expect(locked.navigate(origin)).rejects.toThrow(NavigationPolicyError);
      await expect(locked.page.goto(origin)).rejects.toThrow();
    } finally {
      await locked.close();
    }
    const session = await createBrowserSession({ allowedOrigins: [origin] });
    try {
      await session.navigate(origin);
      const page = session.page;
      await page.evaluate(() => {
        location.href = "about:blank";
      });
      await expect.poll(() => page.isClosed()).toBe(true);
    } finally {
      await session.close();
    }
  });

  it("blocks direct and chained redirects without contacting the forbidden server", async () => {
    const session = await createBrowserSession({ allowedOrigins: [origin] });
    try {
      const before = forbiddenRequests;
      await expect(session.navigate(`${origin}/redirect`)).rejects.toThrow();
      await expect(session.navigate(`${origin}/chain`)).rejects.toThrow();
      expect(forbiddenRequests).toBe(before);
    } finally {
      await session.close();
    }
  });

  it("blocks disallowed subresources, frames and popups", async () => {
    const session = await createBrowserSession({ allowedOrigins: [origin] });
    try {
      await session.navigate(origin);
      const before = forbiddenRequests;
      const popupEvent = session.page.context().waitForEvent("page", { timeout: 5000 });
      const frameBlocked = session.page.waitForEvent("requestfailed", {
        predicate: (request) => request.url() === `${forbiddenOrigin}/frame`,
        timeout: 5000,
      });
      await session.page.evaluate(async (destination) => {
        const frame = document.createElement("iframe");
        frame.src = `${destination}/frame`;
        document.body.append(frame);
        window.open(`${destination}/popup`, "_blank");
        await fetch(`${destination}/fetch`).catch(() => {});
      }, forbiddenOrigin);
      const popup = await popupEvent;
      await frameBlocked;
      await expect.poll(() => popup.isClosed()).toBe(true);
      expect(forbiddenRequests).toBe(before);
      expect(session.page.context().pages()).toHaveLength(1);
    } finally {
      await session.close();
    }
  });

  it("captures correctly sized viewport images, masks private controls and aligns coordinates", async () => {
    const session = await createBrowserSession({
      allowedOrigins: [origin],
      viewport: { width: 800, height: 600 },
    });
    try {
      await session.navigate(origin);
      const shot = await captureScreenshot(session.page, { format: "png" });
      expect(shot.width).toBe(800);
      expect(shot.height).toBe(600);
      expect(shot.coordinateSpace).toBe("viewport-css-pixels");
      expect(shot.url).toBe(`${origin}/`);
      const bytes = Buffer.from(shot.imageDataUrl.split(",")[1]!, "base64");
      expect(bytes.readUInt32BE(16)).toBe(800);
      expect(bytes.readUInt32BE(20)).toBe(600);
      const maskedPixels = await session.page.evaluate(async (dataUrl) => {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        return ["password", "card"].map((id) => {
          const rect = document.getElementById(id)!.getBoundingClientRect();
          return Array.from(
            ctx.getImageData(Math.floor(rect.x + 5), Math.floor(rect.y + 5), 1, 1).data,
          );
        });
      }, shot.imageDataUrl);
      expect(maskedPixels).toEqual([
        [0, 0, 0, 255],
        [0, 0, 0, 255],
      ]);
      const context = await extractPageContext(session.page);
      const apply = context.elements.find((element) => element.label === "Apply")!;
      await session.page.evaluate(() =>
        document.getElementById("apply")!.addEventListener("click", () => {
          document.title = "Clicked";
        }),
      );
      await session.page.mouse.click(
        apply.bounds!.x + apply.bounds!.width / 2,
        apply.bounds!.y + apply.bounds!.height / 2,
      );
      expect(await session.page.title()).toBe("Clicked");
      expect((await captureScreenshot(session.page)).imageDataUrl).toMatch(
        /^data:image\/jpeg;base64,/,
      );
      await expect(captureScreenshot(session.page, { quality: 101 })).rejects.toThrow(RangeError);
    } finally {
      await session.close();
    }
  });

  it("extracts visible labels and validation state, omitting values and hidden controls", async () => {
    const session = await createBrowserSession({ allowedOrigins: [origin] });
    try {
      await session.navigate(origin);
      const context = await extractPageContext(session.page);
      expect(context.title).toBe("Scholarship demo");
      expect(context.elements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: "textbox", label: "Full name", required: true }),
          expect.objectContaining({ role: "combobox", label: "Program" }),
          expect.objectContaining({ label: "Password", sensitive: true }),
          expect.objectContaining({ label: "Unavailable", disabled: true }),
          expect.objectContaining({ role: "checkbox", label: "Agree" }),
          expect.objectContaining({ role: "textbox", label: "Essay" }),
          expect.objectContaining({ role: "button", label: "Custom control" }),
        ]),
      );
      expect(context.validationErrors).toEqual(["Enter a valid email."]);
      const json = JSON.stringify(context);
      for (const text of [
        "PRIVATE_NAME",
        "PRIVATE_EMAIL",
        "PRIVATE_PASSWORD",
        "PRIVATE_ESSAY",
        "4111111111111111",
        "Hidden",
        "Aria hidden",
        "Transparent",
        "Below fold",
      ])
        expect(json).not.toContain(text);
      const bounded = await extractPageContext(session.page, { maxElements: 2 });
      expect(bounded.elements).toHaveLength(2);
      expect(bounded.truncated).toBe(true);
      await expect(extractPageContext(session.page, { maxElements: 0 })).rejects.toThrow(
        RangeError,
      );
    } finally {
      await session.close();
    }
  });
});
