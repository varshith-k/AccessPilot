import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createDemoServer } from "../../demo-site/scholarship-server.mjs";
import { startDemoSite } from "../../demo-site/browser-demo-server";
import { createRealBrowserFactory } from "../../lib/agent/browserDriver";
import { SCHOLARSHIP_STEPS, createFakeDeps, createLabelDrivenActions } from "../../lib/agent/fakes";
import { runTask } from "../../lib/agent/orchestrator";
import { TaskStore } from "../../lib/agent/taskStore";
import { DEFAULT_LIMITS, type AgentDeps } from "../../lib/agent/types";
import type { TaskEvent } from "../../lib/contracts";

/**
 * The orchestrator driving real Chromium on the local demo site, with only Twinly and Gemma
 * stood in. This is the whole backend minus the two remote models.
 */
let site: Awaited<ReturnType<typeof startDemoSite>>;

beforeEach(async () => {
  site = await startDemoSite();
});
afterEach(async () => {
  await site?.close();
});

function run(path: string, steps = SCHOLARSHIP_STEPS) {
  const store = new TaskStore();
  const url = `${site.origin}${path}`;
  const task = store.create(url, "Apply for the scholarship");
  const base = createFakeDeps({ stepDelayMs: 0 });
  const deps: AgentDeps = {
    ...base,
    userDetails: { name: "Alex Morgan", email: "alex@example.com", program: "Computer Science" },
    createBrowser: createRealBrowserFactory(),
    actions: createLabelDrivenActions(steps, "Done."),
  };
  const finished = runTask(
    deps,
    task,
    { url, goal: task.goal },
    { ...DEFAULT_LIMITS, narrationTimeoutMs: 500 },
  );
  const waitFor = (type: TaskEvent["type"]) =>
    vi.waitFor(
      () => {
        if (!task.events.some((e) => e.type === type)) throw new Error(`no ${type} yet`);
      },
      { timeout: 25_000, interval: 100 },
    );
  return { store, task, finished, waitFor, last: () => task.events.at(-1) };
}

describe("orchestrator + real Chromium + demo site", () => {
  it("fills the form, waits for approval, submits once, and ends with the page's own confirmation", async () => {
    const r = run("/scholarship");
    await r.waitFor("approval.required");
    expect(site.submissions).toBe(0); // nothing was submitted before the user answered

    const approval = r.task.events.find((e) => e.type === "approval.required");
    expect(approval && "fields" in approval ? approval.fields.map((f) => f.label) : []).toContain(
      "Name",
    );
    r.store.approve(r.task.id, approval && "approvalId" in approval ? approval.approvalId : "");
    await r.finished;

    expect(site.submissions).toBe(1);
    expect(r.last()?.type).toBe("task.completed");
    expect(r.task.events.some((e) => e.type === "screenshot")).toBe(true);
    // Typed values never appear in events.
    expect(JSON.stringify(r.task.events)).not.toContain('alex@example.com","alt');
  });

  it("does not submit when the user says no", async () => {
    const r = run("/scholarship");
    await r.waitFor("approval.required");
    const approval = r.task.events.find((e) => e.type === "approval.required");
    r.store.deny(r.task.id, approval && "approvalId" in approval ? approval.approvalId : "");
    await r.finished;
    expect(site.submissions).toBe(0);
    expect(r.last()).toMatchObject({ type: "task.completed" });
    expect((r.last() as { summary: string }).summary).toMatch(/Not done/);
  });

  it("does not submit when Stop is pressed while waiting for approval", async () => {
    const r = run("/scholarship");
    await r.waitFor("approval.required");
    r.store.stop(r.task.id);
    await r.finished;
    expect(site.submissions).toBe(0);
    expect(r.last()).toMatchObject({ type: "task.stopped", by: "user" });
  });

  it("hands a password field to the user instead of typing into it", async () => {
    const r = run("/controls", [
      { click: "Private password" },
      { type: "hunter2", into: "Password" },
    ]);
    await r.waitFor("user_input.required");
    expect(r.task.events.find((e) => e.type === "user_input.required")).toMatchObject({
      reason: "sensitive_value",
    });
    r.store.resume(r.task.id);
    await r.waitFor("task.completed").catch(() => {});
    r.store.stop(r.task.id);
    await r.finished;
    expect(JSON.stringify(r.task.events)).not.toContain("hunter2");
  });

  it("Stop interrupts a page that never finishes loading, quickly, and submits nothing", async () => {
    const r = run("/slow"); // the demo site never answers this route
    await new Promise((resolve) => setTimeout(resolve, 800)); // Chromium is up and waiting on the page
    const started = Date.now();
    r.store.stop(r.task.id);
    await r.finished;
    expect(Date.now() - started).toBeLessThan(5_000); // not the 30 s navigation timeout
    expect(r.last()).toMatchObject({ type: "task.stopped", by: "user" });
    expect(site.submissions).toBe(0);
  });

  it("fails clearly when the page has no such control", async () => {
    const r = run("/scholarship", [{ click: "Nonexistent control" }]);
    await r.finished;
    expect(r.last()).toMatchObject({
      type: "task.failed",
      code: "cannot_continue",
      recoverable: true,
    });
  });
});

describe("the scholarship form that needs scrolling and a settled page", () => {
  it("really submits: the browser ends on the confirmation page, not just a 'done' message", async () => {
    const server = createDemoServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/scholarship`;
    try {
      const store = new TaskStore();
      const task = store.create(url, "Apply");
      const deps: AgentDeps = {
        ...createFakeDeps({ stepDelayMs: 0 }),
        createBrowser: createRealBrowserFactory(),
        actions: createLabelDrivenActions(SCHOLARSHIP_STEPS, "Submitted."),
      };
      const finished = runTask(
        deps,
        task,
        { url, goal: "Apply" },
        { ...DEFAULT_LIMITS, narrationTimeoutMs: 300 },
      );

      await vi.waitFor(
        () => {
          if (!task.events.some((e) => e.type === "approval.required")) throw new Error("not yet");
        },
        { timeout: 25_000, interval: 100 },
      );
      const approval = task.events.find((e) => e.type === "approval.required");
      expect(
        task.events.some((e) => e.type === "step.completed" && e.description.includes("Scrolled")),
      ).toBe(true);
      store.approve(task.id, approval && "approvalId" in approval ? approval.approvalId : "");
      await finished;

      const alts = task.events.flatMap((e) => (e.type === "screenshot" ? [e.alt] : []));
      expect(alts.at(-1)).toMatch(/^Application submitted\./);
      expect(task.events.at(-1)?.type).toBe("task.completed");
      expect(task.events.some((e) => e.type === "task.failed")).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
