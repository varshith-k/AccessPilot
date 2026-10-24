import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDemoServer } from "./scholarship-server.mjs";

const server = createDemoServer();
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const submit = (fields: Record<string, string>) =>
  fetch(`${base}/submit`, { method: "POST", body: new URLSearchParams(fields) });

describe("demo scholarship site", () => {
  it("serves the form with labelled fields and a submit button", async () => {
    const html = await (await fetch(`${base}/scholarship`)).text();
    for (const id of ["name", "email", "program", "start", "essay"])
      expect(html).toContain(`for="${id}"`);
    expect(html).toContain("Submit application");
    expect(html).toContain('lang="en"');
  });

  it("confirms a complete application with the confirmation number", async () => {
    const res = await submit({
      name: "Alex Morgan",
      email: "alex@example.com",
      program: "Computer Science",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Confirmation number 4821");
    expect(html).toContain("Alex Morgan");
  });

  it("rejects an application with required fields missing", async () => {
    const res = await submit({ name: "Alex", email: "", program: "" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Please fill in");
  });

  it("escapes what the user typed, so the confirmation page cannot run script", async () => {
    const html = await (
      await submit({ name: "<script>alert(1)</script>", email: "a@b.co", program: "x" })
    ).text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
  });

  it("returns 404 for unknown pages and ok for health", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect(await (await fetch(`${base}/health`)).text()).toBe("ok");
  });
});
