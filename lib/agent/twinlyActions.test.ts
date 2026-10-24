import { describe, expect, it, vi } from "vitest";
import type { BrowserPageContext, BrowserScreenshot } from "@/lib/contracts";
import { normalizeTwinlyAction, type TwinlyAction } from "@/lib/twinly/actions";
import { TwinlyError, type NextActionInput, type NextActionResult } from "@/lib/twinly/client";
import { createTwinlyActions, resolveClickPoint, type TwinlyLike } from "./twinlyActions";

const shot: BrowserScreenshot = {
  imageDataUrl: "data:image/png;base64,AAAA",
  width: 1280,
  height: 720,
  coordinateSpace: "viewport-css-pixels",
};
const page: BrowserPageContext = {
  url: "http://localhost:4000/s",
  title: "Form",
  elements: [
    { role: "button", label: "Submit", bounds: { x: 100, y: 200, width: 100, height: 50 } },
    { role: "text", label: "No box" },
    { role: "textbox", label: "  ", bounds: { x: 0, y: 0, width: 1, height: 1 } },
  ],
};

/** A Twinly answer as the client would return it: already converted to pixels. */
function answer(
  raw: Partial<TwinlyAction> & { type: TwinlyAction["type"] },
  blocked?: string,
): NextActionResult {
  const action = normalizeTwinlyAction(
    { reason: "because", commits: false, ...raw },
    { width: 1280, height: 720 },
    blocked,
  );
  return { action, model: "twinly-core", usage: null, attempts: 1, latencyMs: 5 };
}

function fakeClient(...answers: Array<NextActionResult | Error>) {
  const queue = [...answers];
  const nextAction = vi.fn(async (_input: NextActionInput) => {
    const next = queue.shift();
    if (!next) throw new Error("no more answers");
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { nextAction } satisfies TwinlyLike, nextAction };
}
const ask = (
  provider: ReturnType<typeof createTwinlyActions>,
  history: Parameters<ReturnType<typeof createTwinlyActions>["nextAction"]>[0]["history"] = [],
) => provider.nextAction({ goal: "Apply", screenshot: shot, pageContext: page, history });

describe("createTwinlyActions: what is sent", () => {
  it("sends the screenshot, viewport, goal and only real labelled controls as hints", async () => {
    const { client, nextAction } = fakeClient(answer({ type: "done", text: "ok" }));
    await ask(createTwinlyActions(client));
    expect(nextAction).toHaveBeenCalledTimes(1);
    const sent = nextAction.mock.calls[0]![0];
    expect(sent.goal).toBe("Apply");
    expect(sent.screenshot).toBe(shot.imageDataUrl);
    expect(sent.viewport).toEqual({ width: 1280, height: 720 });
    expect(sent.elements).toEqual([{ role: "button", label: "Submit", x: 150, y: 225 }]);
    expect(sent.previousScreenshot).toBeUndefined();
  });

  it("remembers the previous screenshot and reports how each earlier step went", async () => {
    const { client, nextAction } = fakeClient(
      answer({ type: "click", x: 500, y: 500, label: "Name" }),
      answer({ type: "done" }),
    );
    const provider = createTwinlyActions(client);
    const first = await ask(provider);
    if (first.kind !== "action") throw new Error("expected an action");
    await ask(provider, [{ action: first.action, outcome: "failed" }]);
    const second = nextAction.mock.calls[1]![0];
    expect(second.previousScreenshot).toBe(shot.imageDataUrl);
    expect(second.steps).toHaveLength(1);
    expect(second.steps?.[0]).toMatchObject({ type: "click", result: "failed" });
  });
});

describe("createTwinlyActions: what comes back", () => {
  it("turns a click into pixels, carrying Twinly's approval flag as `commits`", async () => {
    const { client } = fakeClient(
      answer({ type: "click", x: 500, y: 500, label: "Submit button", commits: true }),
    );
    expect(await ask(createTwinlyActions(client))).toMatchObject({
      kind: "action",
      action: { type: "click", x: 640, y: 360, commits: true, label: "Submit button" },
    });
  });

  it("maps typing, keys, scrolling and waiting", async () => {
    const { client } = fakeClient(
      answer({ type: "type", text: "Alex" }),
      answer({ type: "key", keys: "Enter" }),
      answer({ type: "scroll", x: 500, y: 500, direction: "up", amount: 2 }),
      answer({ type: "scroll", x: 500, y: 500, direction: "right", amount: 1 }),
      answer({ type: "wait", seconds: 1.5 }),
    );
    const provider = createTwinlyActions(client);
    const kinds = [];
    for (let i = 0; i < 5; i++) {
      const next = await ask(provider);
      kinds.push(next.kind === "action" ? next.action : next);
    }
    expect(kinds[0]).toMatchObject({ type: "type", text: "Alex" });
    expect(kinds[1]).toMatchObject({ type: "key", key: "Enter" });
    expect(kinds[2]).toMatchObject({ type: "scroll", deltaX: 0, deltaY: -200 });
    expect(kinds[3]).toMatchObject({ type: "scroll", deltaX: 100, deltaY: 0 });
    expect(kinds[4]).toMatchObject({ type: "wait", durationMs: 1500 });
  });

  it("gives every proposal a fresh id", async () => {
    const { client } = fakeClient(answer({ type: "wait" }), answer({ type: "wait" }));
    const provider = createTwinlyActions(client);
    const a = await ask(provider);
    const b = await ask(provider);
    if (a.kind !== "action" || b.kind !== "action") throw new Error("expected actions");
    expect(a.action.id).not.toBe(b.action.id);
  });

  it("treats done and fail as completion states, never as browser actions", async () => {
    const { client } = fakeClient(
      answer({ type: "done", text: "Submitted." }),
      answer({ type: "fail", reason: "Cannot find the form." }),
    );
    const provider = createTwinlyActions(client);
    expect(await ask(provider)).toEqual({ kind: "done", summary: "Submitted." });
    expect(await ask(provider)).toEqual({ kind: "fail", message: "Cannot find the form." });
  });

  it("hands over to the user when Twinly says a secret is needed", async () => {
    const { client } = fakeClient(
      answer({ type: "fail", reason: "Password needed" }, "sensitive_value"),
    );
    expect(await ask(createTwinlyActions(client))).toEqual({
      kind: "handoff",
      reason: "sensitive_value",
      what: "sensitive field",
    });
  });
});

describe("createTwinlyActions: when Twinly cannot be used", () => {
  const failure = async (error: Error) => {
    const { client } = fakeClient(error);
    return ask(createTwinlyActions(client));
  };

  it("says plainly that a usage limit was reached, without raw error text", async () => {
    const next = await failure(
      new TwinlyError({
        kind: "http",
        status: 429,
        code: "rate_limited",
        message: "secret details twk_live_abc",
      }),
    );
    expect(next).toMatchObject({ kind: "fail", message: expect.stringMatching(/usage limit/) });
    expect(JSON.stringify(next)).not.toContain("twk_live");
  });

  it("explains a bad key, a network problem and a bad answer", async () => {
    expect(
      await failure(new TwinlyError({ kind: "http", status: 401, message: "no" })),
    ).toMatchObject({ message: expect.stringMatching(/Twinly key/) });
    expect(await failure(new TwinlyError({ kind: "timeout", message: "slow" }))).toMatchObject({
      message: expect.stringMatching(/reach Twinly/),
    });
    expect(
      await failure(new TwinlyError({ kind: "invalid_response", message: "junk" })),
    ).toMatchObject({ message: expect.stringMatching(/couldn't use/) });
    expect(await failure(new Error("boom"))).toMatchObject({ kind: "fail" });
  });

  it("lets a stop through instead of calling it a failure", async () => {
    const { client } = fakeClient(new TwinlyError({ kind: "aborted", message: "stopped" }));
    await expect(ask(createTwinlyActions(client))).rejects.toThrow("stopped");
  });

  it("stops asking once the per-task request cap is reached", async () => {
    const { client, nextAction } = fakeClient(
      answer({ type: "wait" }),
      answer({ type: "wait" }),
      answer({ type: "wait" }),
    );
    const provider = createTwinlyActions(client, { maxRequests: 2 });
    await ask(provider);
    await ask(provider);
    const third = await ask(provider);
    expect(third).toMatchObject({
      kind: "fail",
      message: expect.stringMatching(/allowed for one task/),
    });
    expect(nextAction).toHaveBeenCalledTimes(2);
  });
});

describe("resolveClickPoint: Twinly sometimes answers in image pixels instead of its 0 to 1000 grid", () => {
  const size = { width: 1280, height: 720 };
  const form: BrowserPageContext = {
    url: "http://localhost:4000/s",
    title: "Form",
    elements: [
      {
        role: "textbox",
        label: "Full name (required)",
        bounds: { x: 340, y: 326, width: 600, height: 40 },
      },
      {
        role: "button",
        label: "Submit application",
        bounds: { x: 100, y: 600, width: 200, height: 48 },
      },
    ],
  };
  const clickAnswer = (raw: { x: number; y: number }, label = "Full name textbox") => {
    const result = answer({ type: "click", ...raw, label });
    if (result.action.type !== "click") throw new Error("expected a click");
    return result.action;
  };

  it("uses the grid reading when it lands on the named control", () => {
    expect(resolveClickPoint(clickAnswer({ x: 500, y: 481 }), form, size)).toEqual({
      x: 640,
      y: 346,
    });
  });

  it("uses the pixel reading when only that one lands on the named control", () => {
    // 640,346 as a grid point is (819, 249): nothing there. As pixels it is the middle of the field.
    expect(resolveClickPoint(clickAnswer({ x: 640, y: 346 }), form, size)).toEqual({
      x: 640,
      y: 346,
    });
  });

  it("prefers the reading on the control that carries the name over one on some other control", () => {
    const crowded: BrowserPageContext = {
      ...form,
      elements: [
        ...form.elements,
        {
          role: "textbox",
          label: "Email (required)",
          bounds: { x: 760, y: 220, width: 120, height: 60 },
        }, // under the grid reading
      ],
    };
    expect(resolveClickPoint(clickAnswer({ x: 640, y: 346 }), crowded, size)).toEqual({
      x: 640,
      y: 346,
    });
  });

  it("falls back to the documented grid reading when neither reading lands on a control", () => {
    expect(resolveClickPoint(clickAnswer({ x: 100, y: 100 }), form, size)).toEqual({
      x: 128,
      y: 72,
    });
  });

  it("does not guess when the page is unknown", () => {
    expect(resolveClickPoint(clickAnswer({ x: 640, y: 346 }), undefined, size)).toEqual({
      x: 819,
      y: 249,
    });
  });

  it("is used end to end: a pixel-style answer still clicks the right field", async () => {
    const { client } = fakeClient(
      answer({ type: "click", x: 640, y: 346, label: "Full name textbox" }),
    );
    const provider = createTwinlyActions(client);
    const next = await provider.nextAction({
      goal: "g",
      screenshot: shot,
      pageContext: form,
      history: [],
    });
    expect(next).toMatchObject({ kind: "action", action: { type: "click", x: 640, y: 346 } });
  });
});
