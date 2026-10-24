import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDemoSite } from "../../demo-site/server";
import { createBrowserController, type BrowserController } from "../../lib/browser/executor";
import type { BrowserAction, ActionResult } from "../../lib/contracts/browser";

describe("browser controller", () => {
  let demo: Awaited<ReturnType<typeof startDemoSite>>;
  let serial = 0;
  const id = () => `proposal-${++serial}`;
  const navigate = (controller: BrowserController, path = "/controls") =>
    controller.execute({ id: id(), type: "navigate", url: demo.origin + path, commits: false });
  const click = async (
    controller: BrowserController,
    selector: string,
    type = "click",
    commits = false,
  ) => {
    await controller.page.locator(selector).scrollIntoViewIfNeeded();
    const box = await controller.page.locator(selector).boundingBox();
    if (!box) throw new Error("No test target");
    const observation = await controller.observe();
    return {
      id: id(),
      type,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      commits,
      observationId: observation.observationId,
    };
  };
  const create = (options: Parameters<typeof createBrowserController>[0] = {}) =>
    createBrowserController({ allowedOrigins: [demo.origin], ...options });

  beforeAll(async () => {
    demo = await startDemoSite();
  });
  afterAll(async () => {
    await demo.close();
  });

  it("executes all action types, serializes typing and returns verified observations", async () => {
    const controller = await create();
    try {
      expect(await navigate(controller)).toMatchObject({
        status: "executed",
        verification: "unverified",
      });
      expect(await controller.execute(await click(controller, "#notes"))).toMatchObject({
        status: "executed",
      });
      const results = await Promise.all(
        ["Ada", " Lovelace"].map((text) =>
          controller.execute({ id: id(), type: "type", text, commits: false }),
        ),
      );
      expect(results.map((result) => result.status)).toEqual(["executed", "executed"]);
      expect(await controller.page.locator("#notes").inputValue()).toBe("Ada Lovelace");
      const keyResult = await controller.execute(
        { id: id(), type: "key", key: "Backspace", commits: false },
        { expected: { type: "field", selector: "#notes", value: "Ada Lovelac" } },
      );
      expect(keyResult).toMatchObject({
        status: "executed",
        verification: "passed",
        screenshot: { width: 1280 },
        pageContext: { url: demo.origin + "/controls" },
      });
      expect(
        await controller.execute(await click(controller, "#double", "double_click"), {
          expected: { type: "visible", selector: "#double", text: "Double clicked" },
        }),
      ).toMatchObject({ status: "executed", verification: "passed" });
      expect(
        await controller.execute({
          id: id(),
          type: "scroll",
          deltaX: 0,
          deltaY: 600,
          commits: false,
        }),
      ).toMatchObject({ status: "executed" });
      expect(await controller.page.evaluate(() => scrollY)).toBeGreaterThan(0);
      expect(
        await controller.execute({ id: id(), type: "wait", durationMs: 1, commits: false }),
      ).toMatchObject({ status: "executed" });
    } finally {
      await controller.close();
    }
  });

  it("clicks a standard field after hover changes its pixels between observation and execution", async () => {
    const controller = await create();
    try {
      await navigate(controller, "/scholarship");
      await controller.page.addStyleTag({ content: "#email:hover{background:rgb(255,0,0)}" });
      await controller.page.mouse.move(0, 0);
      const action = await click(controller, "#email");
      await controller.page.locator("#email").hover();
      expect(await controller.execute(action)).toMatchObject({ status: "executed" });
      expect(
        await controller.execute({
          id: id(),
          type: "type",
          text: "ada@example.test",
          commits: false,
        }),
      ).toMatchObject({ status: "executed" });
    } finally {
      await controller.close();
    }
  });

  it("still rejects a visually changed canvas target", async () => {
    const controller = await create();
    try {
      await navigate(controller);
      await controller.page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.id = "visual-control";
        canvas.width = 120;
        canvas.height = 50;
        document.body.prepend(canvas);
        canvas.getContext("2d")!.fillRect(0, 0, 120, 50);
      });
      const action = await click(controller, "#visual-control");
      await controller.page.evaluate(() => {
        const canvas = document.getElementById("visual-control") as HTMLCanvasElement;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "red";
        context.fillRect(0, 0, 120, 50);
      });
      expect(await controller.execute(action)).toMatchObject({
        status: "failed",
        error: { code: "stale_observation" },
      });
    } finally {
      await controller.close();
    }
  });

  it("requires approval for a native submit even when commits is false; consumes approval once", async () => {
    const controller = await create();
    try {
      await navigate(controller, "/scholarship");
      // Trusted setup; the full workflow test below fills through the controller.
      await controller.page.locator("#name").fill("Ada Lovelace");
      await controller.page.locator("#email").fill("ada@example.test");
      await controller.page.locator("#program").fill("Computer Science");
      const action = await click(controller, "#submit");
      const before = demo.submissions;
      const pending = await controller.execute(action);
      expect(pending.status).toBe("approval_required");
      if (pending.status !== "approval_required") throw new Error(JSON.stringify(pending));
      expect(demo.submissions).toBe(before);
      expect(
        await controller.execute(action, {
          approval: { approvalId: "wrong", actionId: action.id },
        }),
      ).toMatchObject({ status: "failed", error: { code: "invalid_approval" } });
      const approved = await controller.execute(action, {
        approval: { approvalId: pending.approvalId, actionId: action.id },
        expected: { type: "visible", selector: "#confirmation", text: "Application received" },
      });
      expect(approved).toMatchObject({ status: "executed", verification: "passed" });
      expect(demo.submissions).toBe(before + 1);
      expect(await controller.execute(action)).toMatchObject({
        status: "failed",
        error: { code: "duplicate_action" },
      });
    } finally {
      await controller.close();
    }
  });

  it("rejects changed proposals, stale pages, stale approvals and denial replays", async () => {
    const controller = await create();
    try {
      await navigate(controller);
      const stale = await click(controller, "#notes");
      await controller.page.locator("#notes").fill("Manual update");
      expect(await controller.execute(stale)).toMatchObject({
        status: "failed",
        error: { code: "stale_observation" },
      });
      const action = await click(controller, "#double", "click", true);
      const pending = await controller.execute(action);
      if (pending.status !== "approval_required") throw new Error(JSON.stringify(pending));
      expect(
        await controller.execute(
          { ...action, commits: false },
          { approval: { approvalId: pending.approvalId, actionId: action.id } },
        ),
      ).toMatchObject({ status: "failed" });
      expect(await controller.denyApproval("stale-id")).toBe(false);
      expect(await controller.denyApproval(pending.approvalId)).toBe(true);
      expect(await controller.execute(action)).toMatchObject({
        status: "failed",
        error: { code: "duplicate_action" },
      });
      const wait: BrowserAction = { id: id(), type: "wait", durationMs: 1, commits: true };
      const waitPending = await controller.execute(wait);
      if (waitPending.status !== "approval_required") throw new Error(JSON.stringify(waitPending));
      await controller.page.locator("#notes").fill("Changed after review");
      expect(
        await controller.execute(wait, {
          approval: { approvalId: waitPending.approvalId, actionId: wait.id },
        }),
      ).toMatchObject({ status: "failed", error: { code: "stale_approval" } });
    } finally {
      await controller.close();
    }
  });

  it("accepts reviewed native submit after hover and focus change without changing the form", async () => {
    const controller = await create();
    try {
      await navigate(controller, "/scholarship");
      await controller.page.addStyleTag({ content: "#submit:hover{background:rgb(255,0,0)}" });
      await controller.page.locator("#name").fill("Ada Lovelace");
      await controller.page.locator("#email").fill("ada@example.test");
      await controller.page.locator("#program").fill("Computer Science");
      const action = await click(controller, "#submit");
      const pending = await controller.execute(action);
      expect(pending.status).toBe("approval_required");
      if (pending.status !== "approval_required") throw new Error("Missing approval");
      await controller.page.locator("#submit").hover();
      await controller.page.locator("#name").focus();
      const result = await controller.execute(action, {
        approval: { approvalId: pending.approvalId, actionId: action.id },
        expected: { type: "visible", selector: "#confirmation", text: "Application received" },
      });
      expect(result).toMatchObject({ status: "executed", verification: "passed" });
    } finally {
      await controller.close();
    }
  });

  it.each(["field", "destination", "position"])(
    "rejects reviewed native submit when its %s changes",
    async (change) => {
      const controller = await create();
      try {
        await navigate(controller, "/scholarship");
        const action = await click(controller, "#submit");
        const pending = await controller.execute(action);
        if (pending.status !== "approval_required") throw new Error("Missing approval");
        expect(pending).not.toHaveProperty("fingerprint");
        expect(pending).not.toHaveProperty("nativeSubmitFingerprint");
        expect(pending).not.toHaveProperty("domFingerprint");
        const before = demo.submissions;
        await controller.page.evaluate((kind) => {
          if (kind === "field")
            (document.getElementById("name") as HTMLInputElement).value = "Changed during review";
          if (kind === "destination")
            document.querySelector("form")!.setAttribute("action", "/different-submit");
          if (kind === "position") document.getElementById("submit")!.style.marginLeft = "100px";
        }, change);
        const result = await controller.execute(action, {
          approval: { approvalId: pending.approvalId, actionId: action.id },
        });
        expect(result).toMatchObject({ status: "failed", error: { code: "stale_observation" } });
        expect(demo.submissions).toBe(before);
      } finally {
        await controller.close();
      }
    },
  );

  it("hands off sensitive controls and blocks invalid coordinates, keys and URLs", async () => {
    const controller = await create();
    try {
      await navigate(controller);
      for (const selector of ["#password", "#card", "#file"]) {
        expect(await controller.execute(await click(controller, selector))).toMatchObject({
          status: "user_input_required",
        });
      }
      await controller.page.locator("#password").focus();
      expect(
        await controller.execute({ id: id(), type: "type", text: "do-not-type", commits: false }),
      ).toMatchObject({ status: "user_input_required" });
      expect(await controller.page.locator("#password").inputValue()).toBe("");
      expect(
        await controller.execute({ id: id(), type: "key", key: "Tab", commits: false }),
      ).toMatchObject({ status: "executed" });
      expect(
        await controller.execute({ id: id(), type: "key", key: "Control+L", commits: false }),
      ).toMatchObject({ status: "failed", error: { code: "unsupported_key" } });
      expect(
        await controller.execute({ id: id(), type: "click", x: 1280, y: 10, commits: false }),
      ).toMatchObject({ status: "failed", error: { code: "invalid_coordinates" } });
      expect(
        await controller.execute({
          id: id(),
          type: "navigate",
          url: "https://not-permitted.example",
          commits: false,
        }),
      ).toMatchObject({ status: "failed", error: { code: "url_not_allowed" } });
      expect(await controller.execute({ type: "type" })).toMatchObject({
        status: "failed",
        error: { code: "invalid_action" },
      });
      expect(await controller.execute(await click(controller, "#disabled"))).toMatchObject({
        status: "failed",
        error: { code: "disabled_target" },
      });
    } finally {
      await controller.close();
    }
  });

  it("blocks implicit, requestSubmit, native submit and unapproved mutation requests", async () => {
    const controller = await create();
    try {
      await navigate(controller);
      const before = demo.mutationRequests;
      for (const selector of ["#script-submit", "#native-submit", "#fetch"]) {
        expect(await controller.execute(await click(controller, selector))).toMatchObject({
          status: "failed",
          error: { code: "approval_required_by_page" },
        });
      }
      await controller.page.locator("#implicit").focus();
      const enter = await controller.execute({
        id: id(),
        type: "key",
        key: "Enter",
        commits: false,
      });
      expect(enter.status).toBe("approval_required");
      expect(demo.mutationRequests).toBe(before);
    } finally {
      await controller.close();
    }
  });

  it("reports failed outcome verification without claiming task success", async () => {
    const controller = await create();
    try {
      await navigate(controller);
      const result = await controller.execute(
        { id: id(), type: "wait", durationMs: 1, commits: false },
        { expected: { type: "visible", selector: "#not-there" }, verificationTimeoutMs: 50 },
      );
      expect(result).toMatchObject({
        status: "executed",
        verification: "failed",
        screenshot: { coordinateSpace: "viewport-css-pixels" },
      });
    } finally {
      await controller.close();
    }
  });

  it("follows a permitted redirect caused by a click", async () => {
    const controller = await create();
    try {
      await navigate(controller);
      const result = await controller.execute(await click(controller, "#redirect"), {
        expected: { type: "url", url: `${demo.origin}/scholarship` },
      });
      if (result.status === "failed")
        throw new Error(`${result.error.code}: ${result.error.message}`);
      expect(result).toMatchObject({ status: "executed", verification: "passed" });
    } finally {
      await controller.close();
    }
  });

  it("allows safe editing and focus movement while blocking unsafe link activation", async () => {
    const controller = await create();
    try {
      await navigate(controller);
      await controller.page.evaluate(() => {
        const input = document.createElement("input");
        input.id = "confirm-name";
        input.setAttribute("aria-label", "Confirm name");
        document.body.prepend(input);
        const link = document.createElement("a");
        link.id = "unsafe-link";
        link.href = "https://not-permitted.example/delete";
        link.textContent = "Delete";
        document.body.prepend(link);
        input.focus();
      });
      expect(
        await controller.execute({ id: id(), type: "type", text: "Ada", commits: false }),
      ).toMatchObject({ status: "executed" });
      await controller.page.locator("#unsafe-link").focus();
      expect(
        await controller.execute({ id: id(), type: "key", key: "Tab", commits: false }),
      ).toMatchObject({ status: "executed" });
      await controller.page.locator("#unsafe-link").focus();
      expect(
        await controller.execute({ id: id(), type: "key", key: "Enter", commits: false }),
      ).toMatchObject({ status: "failed", error: { code: "url_not_allowed" } });
    } finally {
      await controller.close();
    }
  });

  it("invalidates approval when hidden form data changes without a visual change", async () => {
    const controller = await create();
    try {
      await navigate(controller, "/scholarship");
      const action: BrowserAction = { id: id(), type: "wait", durationMs: 1, commits: true };
      const pending = await controller.execute(action);
      if (pending.status !== "approval_required") throw new Error("Missing approval");
      await controller.page.locator('input[type="hidden"]').evaluate((element) => {
        (element as HTMLInputElement).value = "changed";
      });
      expect(
        await controller.execute(action, {
          approval: { approvalId: pending.approvalId, actionId: action.id },
        }),
      ).toMatchObject({ status: "failed", error: { code: "stale_approval" } });
    } finally {
      await controller.close();
    }
  });

  it("cancels an in-flight navigation when its AbortSignal fires", async () => {
    const controller = await create();
    const abort = new AbortController();
    try {
      await navigate(controller);
      const started = controller.page.waitForEvent("request", {
        predicate: (request) => request.url() === `${demo.origin}/slow`,
      });
      const active = controller.execute(
        { id: id(), type: "navigate", url: `${demo.origin}/slow`, commits: false },
        { signal: abort.signal },
      );
      await started;
      abort.abort();
      expect(await active).toMatchObject({ status: "cancelled" });
      expect(controller.isStopped).toBe(true);
    } finally {
      await controller.close();
    }
  });

  it("stops active and queued actions promptly, with no later typing", async () => {
    const controller = await create();
    await navigate(controller);
    const started = controller.page.waitForEvent("request", {
      predicate: (request) => request.url() === `${demo.origin}/slow`,
    });
    const active = controller.execute({
      id: id(),
      type: "navigate",
      url: `${demo.origin}/slow`,
      commits: false,
    });
    const queued = controller.execute({
      id: id(),
      type: "type",
      text: "Must not run",
      commits: false,
    });
    await started;
    await controller.stop();
    expect(await active).toMatchObject({ status: "cancelled" });
    expect(await queued).toMatchObject({ status: "cancelled" });
    expect(controller.isStopped).toBe(true);
    await controller.stop();
  });

  it("cancels on AbortSignal and stops on action deadline and action limits", async () => {
    const controller = await create();
    const abort = new AbortController();
    abort.abort();
    expect(
      await controller.execute(
        { id: id(), type: "wait", durationMs: 1, commits: false },
        { signal: abort.signal },
      ),
    ).toMatchObject({ status: "cancelled" });
    await controller.close();
    const timed = await create({ executionTimeoutMs: 500 });
    try {
      const timeout = await timed.execute({
        id: id(),
        type: "wait",
        durationMs: 10_000,
        commits: false,
      });
      expect(timeout).toMatchObject({ status: "failed", error: { code: "action_timeout" } });
      expect(timed.isStopped).toBe(true);
    } finally {
      await timed.close();
    }
    const limited = await create({ maxActions: 1 });
    try {
      expect((await navigate(limited)).status).toBe("executed");
      expect(
        await limited.execute({ id: id(), type: "wait", durationMs: 1, commits: false }),
      ).toMatchObject({ status: "failed", error: { code: "action_limit" } });
    } finally {
      await limited.close();
    }
  });

  it("completes the scholarship workflow with mocked Twinly actions and explicit approval", async () => {
    const controller = await create();
    try {
      expect((await navigate(controller, "/")).status).toBe("executed");
      expect(
        await controller.execute(await click(controller, "#apply"), {
          expected: { type: "url", url: `${demo.origin}/scholarship` },
        }),
      ).toMatchObject({ status: "executed", verification: "passed" });
      for (const [selector, value] of [
        ["#name", "Ada Lovelace"],
        ["#email", "ada@example.test"],
        ["#program", "Computer Science"],
      ]) {
        expect((await controller.execute(await click(controller, selector!))).status).toBe(
          "executed",
        );
        expect(
          await controller.execute(
            { id: id(), type: "type", text: value, commits: false },
            { expected: { type: "field", selector: selector!, value: value! } },
          ),
        ).toMatchObject({ status: "executed", verification: "passed" });
      }
      const action = await click(controller, "#submit");
      const pending: ActionResult = await controller.execute(action);
      if (pending.status !== "approval_required") throw new Error(JSON.stringify(pending));
      const final = await controller.execute(action, {
        approval: { approvalId: pending.approvalId, actionId: action.id },
        expected: { type: "visible", selector: "#confirmation", text: "Application received" },
      });
      expect(final).toMatchObject({
        status: "executed",
        verification: "passed",
        pageContext: { url: `${demo.origin}/submit` },
      });
    } finally {
      await controller.close();
    }
  });
});
