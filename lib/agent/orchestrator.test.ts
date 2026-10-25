import { describe, expect, it, vi } from "vitest";
import { isTerminalEvent, taskEventSchema, type ActionResult } from "@/lib/contracts";
import { runTask } from "./orchestrator";
import { TaskStore } from "./taskStore";
import { act, click, done, makeDeps, start, typeText } from "./testkit";

describe("happy path", () => {
  it("narrates the flow, asks before the consequential click, then completes", async () => {
    const submit = click("s", 200, 444, "Submit application", true);
    const { deps, execute, close } = makeDeps([
      act(click("a", 300, 120, "Full name")),
      act(typeText("b", "Alex")),
      act(submit),
      done("Submitted. Confirmation number 4821."),
    ]);
    const run = start(deps);

    await run.waitFor("approval.required");
    expect(execute).toHaveBeenCalledTimes(2); // the submit has not run
    const approval = run.find("approval.required")!;
    expect(approval.fields.map((f) => f.label)).toContain("Name");

    run.store.approve(run.task.id, approval.approvalId);
    await run.finished;

    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[2]?.[0].id).toBe("s");
    expect(run.types()).toEqual(
      expect.arrayContaining([
        "task.started",
        "page.map",
        "step.started",
        "step.completed",
        "screenshot",
        "narration",
        "approval.required",
        "task.completed",
      ]),
    );
    expect(run.types()[0]).toBe("task.started");
    expect(run.last()).toMatchObject({
      type: "task.completed",
      summary: "Submitted. Confirmation number 4821.",
    });
    expect(close).toHaveBeenCalled();
  });

  it("emits strictly increasing seq numbers, and exactly one terminal event, last", async () => {
    const { deps } = makeDeps([act(click("a", 300, 120)), done()]);
    const run = start(deps);
    await run.finished;
    const seqs = run.task.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(run.task.events.filter(isTerminalEvent)).toHaveLength(1);
    expect(isTerminalEvent(run.last()!)).toBe(true);
    for (const event of run.task.events)
      expect(taskEventSchema.safeParse(event).success).toBe(true);
  });
});

describe("approval gate", () => {
  it("does not run a committing action when the user denies", async () => {
    const { deps, execute } = makeDeps([
      act(click("s", 200, 444, "Submit application", true)),
      done(),
    ]);
    const run = start(deps);
    await run.waitFor("approval.required");
    run.store.deny(run.task.id, run.find("approval.required")!.approvalId);
    await run.finished;
    expect(execute).not.toHaveBeenCalled();
    expect(run.last()).toMatchObject({ type: "task.completed" });
    expect((run.last() as { summary: string }).summary).toMatch(/Not done: Submit application/);
  });

  it("rejects approval of a different request and acts on none", async () => {
    const { deps, execute } = makeDeps([act(click("s", 200, 444, "Submit", true)), done()]);
    const run = start(deps);
    await run.waitFor("approval.required");
    expect(() => run.store.approve(run.task.id, "appr_other")).toThrow(/no longer current/);
    expect(execute).not.toHaveBeenCalled();
    run.store.stop(run.task.id);
    await run.finished;
  });

  it("never auto-approves: it waits indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const { deps, execute } = makeDeps([act(click("s", 200, 444, "Submit", true))]);
      const run = start(deps);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(run.types()).toContain("approval.required");
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(execute).not.toHaveBeenCalled();
      expect(run.last()?.type).toBe("approval.required");
      run.store.stop(run.task.id);
      await run.finished;
    } finally {
      vi.useRealTimers();
    }
  });

  it("gates an action only the browser flagged, using the browser's approval id", async () => {
    const action = click("x", 10, 10, "Pay now", false);
    const calls: Array<{ approval?: { approvalId: string; actionId: string } } | undefined> = [];
    const { deps } = makeDeps(
      [act(action), done()],
      {},
      {
        execute: vi.fn(async (a, options) => {
          calls.push(options);
          return calls.length === 1
            ? { actionId: a.id, status: "approval_required" as const, approvalId: "browser_7" }
            : { actionId: a.id, status: "executed" as const, verification: "passed" as const };
        }),
      },
    );
    const run = start(deps);
    await run.waitFor("approval.required");
    expect(run.find("approval.required")!.approvalId).toBe("browser_7");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.approval).toBeUndefined();
    run.store.approve(run.task.id, "browser_7");
    await run.finished;
    expect(calls[1]?.approval).toEqual({ approvalId: "browser_7", actionId: "x" });
    expect(run.last()?.type).toBe("task.completed");
  });
});

describe("stop", () => {
  it("ends immediately while waiting for approval and runs nothing afterwards", async () => {
    const { deps, execute, close } = makeDeps([
      act(click("s", 200, 444, "Submit", true)),
      act(click("n", 1, 1)),
      done(),
    ]);
    const run = start(deps);
    await run.waitFor("approval.required");
    const before = run.task.events.length;
    run.store.stop(run.task.id);
    await run.finished;
    expect(run.last()).toMatchObject({ type: "task.stopped", by: "user" });
    expect(run.task.events.length).toBe(before + 1);
    expect(execute).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("ends even if Twinly is stuck, and does not act on a late answer", async () => {
    let release!: (v: unknown) => void;
    const late = new Promise((r) => (release = r));
    const { deps, execute } = makeDeps([], {
      actions: { nextAction: vi.fn(() => late.then(() => act(click("a", 1, 1)))) },
    });
    const run = start(deps);
    await vi.waitFor(() => expect(deps.actions.nextAction).toHaveBeenCalled());
    run.store.stop(run.task.id);
    await run.finished;
    release(undefined);
    await new Promise((r) => setTimeout(r, 10));
    expect(run.last()).toMatchObject({ type: "task.stopped" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not run an approved action if the user presses Stop right after approving", async () => {
    const { deps, execute } = makeDeps([act(click("s", 200, 444, "Submit", true)), done()]);
    const run = start(deps);
    await run.waitFor("approval.required");
    run.store.approve(run.task.id, run.find("approval.required")!.approvalId);
    run.store.stop(run.task.id); // same tick: the approval is already resolved
    await run.finished;
    expect(execute).not.toHaveBeenCalled();
    expect(run.last()).toMatchObject({ type: "task.stopped", by: "user" });
  });

  it("tells the browser to stop at once, while an action is still in flight", async () => {
    let finishAction!: () => void;
    const stop = vi.fn(async () => {});
    const { deps } = makeDeps(
      [act(click("a", 1, 1, "Slow thing")), done()],
      {},
      {
        execute: vi.fn(
          (a) =>
            new Promise<ActionResult>((resolve) => {
              finishAction = () =>
                resolve({
                  actionId: a.id,
                  status: "executed" as const,
                  verification: "passed" as const,
                });
            }),
        ),
        stop,
      },
    );
    const run = start(deps);
    await vi.waitFor(() => expect(finishAction).toBeTypeOf("function"));
    run.store.stop(run.task.id);
    expect(stop).toHaveBeenCalledTimes(1); // before the action finished and before cleanup
    await run.finished;
    expect(run.last()).toMatchObject({ type: "task.stopped", by: "user" });
    finishAction();
  });

  it("is idempotent and a stop after the end is harmless", async () => {
    const { deps } = makeDeps([done()]);
    const run = start(deps);
    await run.finished;
    const n = run.task.events.length;
    expect(() => run.store.stop(run.task.id)).not.toThrow();
    expect(run.task.events.length).toBe(n);
  });
});

describe("hand-off of sensitive fields", () => {
  const page = {
    url: "http://localhost:4000/login",
    title: "Sign in",
    elements: [
      { role: "textbox", label: "Email", bounds: { x: 0, y: 0, width: 300, height: 40 } },
      { role: "textbox", label: "Password", bounds: { x: 0, y: 60, width: 300, height: 40 } },
    ],
  };
  const shot = {
    imageDataUrl: "data:image/png;base64,AAAA",
    width: 10,
    height: 10,
    coordinateSpace: "viewport-css-pixels" as const,
  };
  const withLoginPage = {
    open: async () => ({ screenshot: shot, pageContext: page }),
    observe: async () => ({ screenshot: shot, pageContext: page }),
  };

  it("hands a click on the password field to the user and continues after resume", async () => {
    const { deps, execute } = makeDeps(
      [act(click("p", 100, 80, "field")), act(click("n", 100, 20, "Email")), done()],
      {},
      withLoginPage,
    );
    const run = start(deps);
    await run.waitFor("user_input.required");
    expect(run.find("user_input.required")).toMatchObject({ reason: "sensitive_value" });
    expect(execute).not.toHaveBeenCalled();
    run.store.resume(run.task.id);
    await run.finished;
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0].id).toBe("n");
  });

  it("never types into a field it just clicked if that field was sensitive", async () => {
    const { deps, execute } = makeDeps(
      [act(typeText("t", "hunter2", "Password")), done()],
      {},
      withLoginPage,
    );
    const run = start(deps);
    await run.waitFor("user_input.required");
    run.store.resume(run.task.id);
    await run.finished;
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(run.task.events)).not.toContain("hunter2");
  });

  it("hands CAPTCHAs to the user", async () => {
    const { deps, execute } = makeDeps([act(click("c", 5, 5, "I'm not a robot checkbox")), done()]);
    const run = start(deps);
    await run.waitFor("user_input.required");
    expect(run.find("user_input.required")).toMatchObject({ reason: "captcha" });
    expect(execute).not.toHaveBeenCalled();
    run.store.stop(run.task.id);
    await run.finished;
  });

  it("refuses to type something that looks like a card number, and never echoes it", async () => {
    const { deps, execute } = makeDeps([act(typeText("t", "4242 4242 4242 4242")), done()]);
    const run = start(deps);
    await run.waitFor("user_input.required");
    expect(execute).not.toHaveBeenCalled();
    run.store.stop(run.task.id);
    await run.finished;
    expect(JSON.stringify(run.task.events)).not.toContain("4242");
  });
});

describe("no leaking of what the agent types", () => {
  it("keeps typed text out of every event", async () => {
    const { deps } = makeDeps([
      act(typeText("t", "my-private-essay-text", "Essay")),
      act({ id: "k", type: "key", key: "Enter", commits: false }),
      done(),
    ]);
    const run = start(deps);
    await run.finished;
    expect(JSON.stringify(run.task.events)).not.toContain("my-private-essay-text");
  });
});

describe("unlabeled typing", () => {
  it("does not put the typed text in the step description when Twinly gives no label", async () => {
    const unlabeled = {
      id: "t",
      type: "type",
      text: "very-private-words",
      commits: false,
    } as const;
    const { deps } = makeDeps([act(unlabeled), done()]);
    const run = start(deps);
    await run.finished;
    expect(JSON.stringify(run.task.events)).not.toContain("very-private-words");
    expect(run.find("step.started")?.description).toBe("Typing your answer");
  });
});

describe("failure handling", () => {
  it("gives up after repeated action failures, recoverably", async () => {
    const failing = {
      execute: vi.fn(async (a: { id: string }) => ({
        actionId: a.id,
        status: "failed" as const,
        error: { code: "x", message: "boom" },
      })),
    };
    const { deps } = makeDeps(
      [act(click("a", 1, 1)), act(click("b", 1, 1)), act(click("c", 1, 1)), done()],
      {},
      failing,
    );
    const run = start(deps);
    await run.finished;
    expect(run.last()).toMatchObject({
      type: "task.failed",
      code: "action_failed",
      recoverable: true,
    });
    expect(failing.execute).toHaveBeenCalledTimes(3);
  });

  it("treats failed verification as a failure, not success", async () => {
    const verify = {
      execute: vi.fn(async (a: { id: string }) => ({
        actionId: a.id,
        status: "executed" as const,
        verification: "failed" as const,
      })),
    };
    const { deps } = makeDeps(
      [act(click("a", 1, 1)), act(click("b", 1, 1)), act(click("c", 1, 1))],
      {},
      verify,
    );
    const run = start(deps);
    await run.finished;
    expect(run.last()).toMatchObject({ code: "action_failed" });
  });

  it("stops at the step limit", async () => {
    const { deps } = makeDeps(Array.from({ length: 10 }, (_, i) => act(click(`a${i}`, 1, 1))));
    const run = start(deps, { maxSteps: 3 });
    await run.finished;
    expect(run.last()).toMatchObject({ type: "task.failed", code: "step_limit" });
    expect(run.task.events.filter((e) => e.type === "step.started")).toHaveLength(3);
  });

  it("never sends a malformed proposal to the browser", async () => {
    const bad = { id: "bad", type: "click", x: -5, y: 1, commits: false } as never;
    const { deps, execute } = makeDeps([act(bad), act(bad), act(bad)]);
    const run = start(deps);
    await run.finished;
    expect(execute).not.toHaveBeenCalled();
    expect(run.last()).toMatchObject({ code: "invalid_action" });
  });

  it("reports when Twinly gives up", async () => {
    const { deps } = makeDeps([{ kind: "fail", message: "I can't find the form." }]);
    const run = start(deps);
    await run.finished;
    expect(run.last()).toMatchObject({
      type: "task.failed",
      code: "cannot_continue",
      message: "I can't find the form.",
    });
  });

  it("keeps going without a plan when the planner is down, leaking nothing", async () => {
    const { deps, execute } = makeDeps([act(click("a", 1, 1, "Next")), done("Finished.")]);
    deps.planner.planTask = async () => {
      throw new Error("quota exceeded for key AIzaSECRET");
    };
    const run = start(deps);
    await run.finished;
    expect(execute).toHaveBeenCalledTimes(1);
    expect(run.last()).toMatchObject({ type: "task.completed", summary: "Finished." });
    expect(JSON.stringify(run.task.events)).not.toContain("AIzaSECRET");
  });

  it("still asks for approval for consequential actions without a plan", async () => {
    const { deps, execute } = makeDeps([act(click("s", 1, 1, "Submit", true)), done()]);
    deps.planner.planTask = async () => {
      throw new Error("down");
    };
    const run = start(deps);
    await run.waitFor("approval.required");
    expect(execute).not.toHaveBeenCalled();
    run.store.stop(run.task.id);
    await run.finished;
  });

  it("asks the user to clarify instead of guessing", async () => {
    const { deps } = makeDeps([done()]);
    const plan = await deps.planner.planTask("x", "y");
    deps.planner.planTask = async () => ({
      ...plan,
      clarifyingQuestion: "Which scholarship do you mean?",
    });
    const run = start(deps);
    await run.finished;
    expect(run.last()).toMatchObject({
      code: "needs_clarification",
      message: "Which scholarship do you mean?",
    });
  });

  it("turns an unexpected crash into a safe message and still closes the browser", async () => {
    const { deps, close } = makeDeps([done()], {
      actions: {
        nextAction: async () => {
          throw new Error("secret-token-xyz");
        },
      },
    });
    const run = start(deps);
    await run.finished;
    expect(run.last()).toMatchObject({ code: "internal_error", recoverable: true });
    expect(JSON.stringify(run.task.events)).not.toContain("secret-token-xyz");
    expect(close).toHaveBeenCalled();
  });

  it("passes on our own plain-language errors instead of blaming itself", async () => {
    const { AgentError } = await import("./errors");
    const { deps } = makeDeps([done()], {
      actions: {
        nextAction: async () => {
          throw new AgentError(
            "invalid_request",
            "I couldn't open that page. Please check the address and try again.",
          );
        },
      },
    });
    const run = start(deps);
    await run.finished;
    expect(run.last()).toMatchObject({
      code: "invalid_request",
      message: "I couldn't open that page. Please check the address and try again.",
      recoverable: true,
    });
  });

  it("fails cleanly if the browser cannot start", async () => {
    const { deps } = makeDeps([done()], {
      createBrowser: async () => {
        throw new Error("no chromium");
      },
    });
    const run = start(deps);
    await run.finished;
    expect(run.last()).toMatchObject({ type: "task.failed" });
  });
});

describe("narration and screenshots", () => {
  it("falls back to template text when Gemma fails, and still narrates", async () => {
    const { deps } = makeDeps([act(click("a", 1, 1, "Next")), done("Finished.")]);
    deps.planner.narrate = async () => {
      throw new Error("down");
    };
    const run = start(deps);
    await run.finished;
    expect(run.types()).toContain("narration");
    expect(run.last()?.type).toBe("task.completed");
  });

  it("falls back when Gemma is too slow", async () => {
    const { deps } = makeDeps([done()]);
    deps.planner.narrate = () => new Promise(() => {});
    const run = start(deps, { narrationTimeoutMs: 20 });
    await run.finished;
    expect(run.last()?.type).toBe("task.completed");
  });

  it("skips screenshots that are too big for the stream", async () => {
    const { deps } = makeDeps([act(click("a", 1, 1)), done()]);
    const run = start(deps, { maxScreenshotChars: 10 });
    await run.finished;
    expect(run.types()).not.toContain("screenshot");
  });

  it("asks for details it does not have, and waits for the user", async () => {
    const { deps } = makeDeps([done()]);
    const plan = await deps.planner.planTask("x", "y");
    deps.planner.planTask = async () => ({
      ...plan,
      missingInfo: [{ field: "gpa", question: "What is your GPA?" }],
    });
    const run = start(deps);
    await run.waitFor("user_input.required");
    expect(run.find("user_input.required")).toMatchObject({ reason: "other" });
    run.store.resume(run.task.id);
    await run.finished;
    expect(run.last()?.type).toBe("task.completed");
  });
});

describe("working with the real browser controller's protocol", () => {
  const shot = {
    imageDataUrl: "data:image/png;base64,AAAA",
    width: 10,
    height: 10,
    coordinateSpace: "viewport-css-pixels" as const,
  };
  const page = {
    url: "http://localhost:4000/s",
    title: "Form",
    elements: [
      { role: "textbox", label: "Name", bounds: { x: 0, y: 0, width: 200, height: 40 } },
      {
        role: "textbox",
        label: "Code",
        sensitive: true,
        bounds: { x: 0, y: 50, width: 200, height: 40 },
      },
    ],
  };
  const view = (observationId: string) => ({ observationId, screenshot: shot, pageContext: page });

  it("asks the user once, then applies that approval to the controller's own id", async () => {
    const calls: Array<{ approval?: { approvalId: string; actionId: string } } | undefined> = [];
    const submit = click("s", 5, 5, "Submit application", true);
    const { deps } = makeDeps(
      [act(submit), done()],
      {},
      {
        execute: vi.fn(async (a, options) => {
          calls.push(options);
          if (!options?.approval)
            return { actionId: a.id, status: "approval_required" as const, approvalId: "ctl-9" };
          return options.approval.approvalId === "ctl-9"
            ? { actionId: a.id, status: "executed" as const, verification: "passed" as const }
            : {
                actionId: a.id,
                status: "failed" as const,
                error: { code: "invalid_approval", message: "no" },
              };
        }),
      },
    );
    const run = start(deps);
    await run.waitFor("approval.required");
    const asked = run.task.events.filter((e) => e.type === "approval.required");
    expect(asked).toHaveLength(1);
    expect(calls).toHaveLength(0); // nothing reaches the browser before the user answers
    run.store.approve(run.task.id, run.find("approval.required")!.approvalId);
    await run.finished;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.approval).toBeUndefined();
    expect(calls[1]?.approval).toEqual({ approvalId: "ctl-9", actionId: "s" });
    expect(run.last()?.type).toBe("task.completed");
  });

  it("gives up cleanly if the controller keeps asking for approval after it was applied", async () => {
    const { deps } = makeDeps(
      [act(click("s", 5, 5, "Submit", true)), done()],
      {},
      {
        execute: vi.fn(async (a) => ({
          actionId: a.id,
          status: "approval_required" as const,
          approvalId: "ctl-1",
        })),
      },
    );
    const run = start(deps);
    await run.waitFor("approval.required");
    run.store.approve(run.task.id, run.find("approval.required")!.approvalId);
    await run.finished;
    expect(run.last()).toMatchObject({ type: "task.failed", code: "approval_mismatch" });
  });

  it("hands over when the browser says a field is the user's, using its own plain wording", async () => {
    const calls: string[] = [];
    const { deps } = makeDeps(
      [act(click("p", 5, 5, "Field")), act(click("n", 5, 5, "Next")), done()],
      {},
      {
        execute: vi.fn(async (a) => {
          calls.push(a.id);
          return a.id === "p"
            ? {
                actionId: a.id,
                status: "user_input_required" as const,
                reason: "sensitive_value" as const,
                instructions: "ask for a fresh observation",
              }
            : { actionId: a.id, status: "executed" as const, verification: "passed" as const };
        }),
      },
    );
    const run = start(deps);
    await run.waitFor("user_input.required");
    const ask = run.find("user_input.required")!;
    expect(ask.reason).toBe("sensitive_value");
    expect(ask.instructions).toMatch(/press Continue/);
    expect(ask.instructions).not.toContain("fresh observation");
    run.store.resume(run.task.id);
    await run.finished;
    expect(calls).toEqual(["p", "n"]);
    expect(run.last()?.type).toBe("task.completed");
  });

  it("hands over at once when the page marks the element under the click as sensitive", async () => {
    const { deps, execute } = makeDeps(
      [act(click("c", 10, 60, "Field")), done()],
      {},
      {
        open: async () => view("obs-1"),
        observe: async () => view("obs-1"),
      },
    );
    const run = start(deps);
    await run.waitFor("user_input.required");
    expect(execute).not.toHaveBeenCalled();
    run.store.stop(run.task.id);
    await run.finished;
  });

  it("names the view each click was planned from, and moves on to the newest one", async () => {
    let n = 1;
    const seen: Array<string | undefined> = [];
    const { deps } = makeDeps(
      [act(click("a", 5, 5, "Name")), act(click("b", 5, 5, "Name")), done()],
      {},
      {
        open: async () => view("obs-1"),
        observe: async () => view(`obs-${n}`),
        execute: vi.fn(async (a) => {
          seen.push("observationId" in a ? a.observationId : undefined);
          n++;
          return {
            actionId: a.id,
            status: "executed" as const,
            verification: "passed" as const,
            ...view(`obs-${n}`),
          };
        }),
      },
    );
    const run = start(deps);
    await run.finished;
    expect(seen).toEqual(["obs-1", "obs-2"]);
  });

  it("waits for the page to settle before planning from it", async () => {
    // The page keeps changing for a moment after an action: obs-2 is the early view, obs-3 the settled one.
    const looks = ["obs-3", "obs-3"];
    const stamped: Array<string | undefined> = [];
    const { deps } = makeDeps(
      [act(click("a", 5, 5, "Name")), act(click("b", 5, 5, "Name")), done()],
      {},
      {
        open: async () => view("obs-1"),
        observe: vi.fn(async () => view(looks.shift() ?? "obs-3")),
        execute: vi.fn(async (a) => {
          stamped.push("observationId" in a ? a.observationId : undefined);
          return {
            actionId: a.id,
            status: "executed" as const,
            verification: "passed" as const,
            ...view("obs-2"),
          };
        }),
      },
    );
    const run = start(deps);
    await run.finished;
    expect(stamped).toEqual(["obs-1", "obs-3"]); // the second click names the settled view, not the early one
  });

  it("still moves on if the page never settles", async () => {
    let n = 0;
    const { deps } = makeDeps(
      [act(click("a", 5, 5, "Name")), done()],
      {},
      {
        open: async () => view("obs-0"),
        observe: vi.fn(async () => view(`obs-${++n}`)),
      },
    );
    const run = start(deps);
    await run.finished;
    expect(run.last()?.type).toBe("task.completed");
  });
});

describe("handing over when Twinly says a secret is needed", () => {
  it("asks the user, waits for Continue, then carries on, and runs nothing in between", async () => {
    const { deps, execute } = makeDeps([
      { kind: "handoff", reason: "sensitive_value", what: "sensitive field" },
      act(click("n", 1, 1, "Next")),
      done(),
    ]);
    const run = start(deps);
    await run.waitFor("user_input.required");
    expect(run.find("user_input.required")).toMatchObject({ reason: "sensitive_value" });
    expect(execute).not.toHaveBeenCalled();
    run.store.resume(run.task.id);
    await run.finished;
    expect(execute).toHaveBeenCalledTimes(1);
    expect(run.last()?.type).toBe("task.completed");
  });
});

describe("the goal the action provider sees", () => {
  it("carries the user's approved details, so a real model can fill the form", async () => {
    const { deps } = makeDeps([done()], {
      userDetails: { name: "Alex Morgan", email: "alex@example.com", start_date: "2027-01-15" },
    });
    const run = start(deps);
    await run.finished;
    const goal = (deps.actions.nextAction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .goal as string;
    expect(goal).toContain("Apply for the scholarship");
    expect(goal).toContain("- Name: Alex Morgan");
    expect(goal).toContain("- Start date: 2027-01-15");
    expect(goal).toMatch(/do not make up any others/);
  });

  it("never sends anything that looks like a password, card number or code", async () => {
    const { deps } = makeDeps([done()], {
      userDetails: {
        name: "Alex",
        password: "hunter2",
        card_number: "4242 4242 4242 4242",
        "one-time code": "123456",
        cvv: "999",
      },
    });
    const run = start(deps);
    await run.finished;
    const goal = (deps.actions.nextAction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .goal as string;
    expect(goal).toContain("Alex");
    for (const secret of ["hunter2", "4242", "123456", "999"]) expect(goal).not.toContain(secret);
  });

  it("leaves the goal alone when there are no details, and stays within the length limit", async () => {
    const plain = makeDeps([done()], { userDetails: {} });
    await start(plain.deps).finished;
    expect(
      (plain.deps.actions.nextAction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].goal,
    ).toBe("Apply for the scholarship");

    const huge = makeDeps([done()], { userDetails: { essay: "word ".repeat(2000), name: "Alex" } });
    await start(huge.deps).finished;
    const goal = (huge.deps.actions.nextAction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .goal as string;
    expect(goal.length).toBeLessThan(1500);
    expect(goal).toContain("- Name: Alex"); // the long value did not push the short one out
  });

  it("keeps the whole goal under Twinly's 2000-character limit, even with a long request", async () => {
    const { deps } = makeDeps([done()], { userDetails: { notes: "n".repeat(1000), name: "Alex" } });
    const store = new TaskStore();
    const longGoal = "g".repeat(1000);
    const task = store.create("http://localhost:4000/s", longGoal);
    await runTask(deps, task, { url: "http://localhost:4000/s", goal: longGoal });
    const goal = (deps.actions.nextAction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .goal as string;
    expect(goal.length).toBeLessThanOrEqual(1900);
    expect(goal).toContain("- Name: Alex");
  });
});

describe("a click that lands beside the field Twinly named", () => {
  const shot = {
    imageDataUrl: "data:image/png;base64,AAAA",
    width: 10,
    height: 10,
    coordinateSpace: "viewport-css-pixels" as const,
  };
  const formPage = {
    url: "http://localhost:4000/s",
    title: "Form",
    elements: [
      {
        role: "textbox",
        label: "Full name (required)",
        bounds: { x: 100, y: 200, width: 300, height: 40 },
      },
    ],
  };

  it("is moved onto the field before it reaches the browser, so no approval is needed", async () => {
    const { deps, execute } = makeDeps(
      [act(click("c", 150, 170, "Full name textbox")), done()],
      {},
      {
        open: async () => ({ screenshot: shot, pageContext: formPage }),
        observe: async () => ({ screenshot: shot, pageContext: formPage }),
      },
    );
    const run = start(deps);
    await run.finished;
    expect(run.types()).not.toContain("approval.required");
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ x: 250, y: 220 });
  });
});

describe("questions about the page", () => {
  const asQuestion = (deps: ReturnType<typeof makeDeps>["deps"]) => {
    const plan = deps.planner.planTask;
    deps.planner.planTask = async (goal, page, details) => ({
      ...(await plan(goal, page, details)),
      intent: "explain_page",
    });
  };

  it("answers from an outline of the whole page, without clicking anything or asking Twinly", async () => {
    const outline = vi.fn(async () => "Form fields on the whole page (27):");
    const { deps, execute } = makeDeps([act(click("a", 1, 1))], {}, { outline });
    asQuestion(deps);
    deps.planner.explainPage = vi.fn(async (pageText: string) =>
      pageText.includes("(27)") ? "There are 27 fields." : "?",
    );
    const run = start(deps);
    await run.finished;
    expect(run.last()).toMatchObject({ type: "task.completed", summary: "There are 27 fields." });
    expect(execute).not.toHaveBeenCalled();
    expect(deps.actions.nextAction).not.toHaveBeenCalled();
  });

  it("uses the visible page when there is no outline", async () => {
    const { deps } = makeDeps([]);
    asQuestion(deps);
    deps.planner.explainPage = vi.fn(async () => "It's a scholarship form.");
    const run = start(deps);
    await run.finished;
    expect((deps.planner.explainPage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      "Page: Scholarship application",
    );
    expect(run.last()).toMatchObject({ summary: "It's a scholarship form." });
  });

  it("falls back to working on the page if answering fails or the outline breaks", async () => {
    const { deps, execute } = makeDeps(
      [act(click("a", 1, 1)), done("Did it.")],
      {},
      {
        outline: async () => {
          throw new Error("page gone");
        },
      },
    );
    asQuestion(deps);
    deps.planner.explainPage = async () => {
      throw new Error("Gemma down");
    };
    const run = start(deps);
    await run.finished;
    expect(execute).toHaveBeenCalledTimes(1);
    expect(run.last()).toMatchObject({ summary: "Did it." });
  });

  it("acts as usual for ordinary tasks, even when it could answer questions", async () => {
    const { deps, execute } = makeDeps([act(click("a", 1, 1)), done()]);
    deps.planner.explainPage = vi.fn(async () => "never");
    const run = start(deps);
    await run.finished;
    expect(deps.planner.explainPage).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
