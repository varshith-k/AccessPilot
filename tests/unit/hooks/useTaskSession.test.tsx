import { act, renderHook } from "@testing-library/react";
import type { TaskEvent } from "@/lib/contracts";
import { TaskClientError } from "@/lib/client/errors";
import { MockTaskClient } from "@/lib/client/MockTaskClient";
import type { MockScenarioName, ScriptedEvent } from "@/lib/client/mock/scenarios";
import { STOPPED_BY_USER_TEXT } from "@/lib/client/taskState";
import type { TaskClient } from "@/lib/client/types";
import { useTaskSession, type SessionEffects } from "@/hooks/useTaskSession";

const INPUT = {
  url: "http://localhost:4000/scholarship",
  goal: "Complete this scholarship application",
};
const NOW = new Date("2026-10-25T14:00:00.000Z");

function makeEffects() {
  return {
    announce: vi.fn<SessionEffects["announce"]>(),
    speak: vi.fn<SessionEffects["speak"]>(),
    cancelSpeech: vi.fn<SessionEffects["cancelSpeech"]>(),
  };
}

function renderSession(client: TaskClient) {
  const effects = makeEffects();
  const hook = renderHook(() => useTaskSession({ client, effects, now: () => NOW }));
  return { ...hook, effects };
}

/**
 * Runs timers inside act. Without `ms`, repeats until no timers remain, because React only
 * commits effects (such as subscribing to the stream) when each act() finishes.
 */
async function flush(ms?: number) {
  if (ms !== undefined) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    return;
  }
  for (let round = 0; round < 50 && vi.getTimerCount() > 0; round++) {
    await act(async () => {
      await vi.runAllTimersAsync();
    });
  }
}

function mockSession(scenario: MockScenarioName) {
  const client = new MockTaskClient({ scenario });
  return { client, ...renderSession(client) };
}

/** A client whose calls the test controls directly. */
function stubClient() {
  let onEvent: ((event: TaskEvent) => void) | null = null;
  let onError: ((error: Error) => void) | null = null;
  const unsubscribe = vi.fn();
  const client = {
    start: vi.fn<TaskClient["start"]>().mockResolvedValue({ taskId: "t1" }),
    subscribe: vi.fn<TaskClient["subscribe"]>((_id, eventCb, errorCb) => {
      onEvent = eventCb;
      onError = errorCb;
      return unsubscribe;
    }),
    approve: vi.fn<TaskClient["approve"]>().mockResolvedValue(undefined),
    deny: vi.fn<TaskClient["deny"]>().mockResolvedValue(undefined),
    resume: vi.fn<TaskClient["resume"]>().mockResolvedValue(undefined),
    stop: vi.fn<TaskClient["stop"]>().mockResolvedValue(undefined),
  };
  let seq = 0;
  const base = () => ({ taskId: "t1", seq: ++seq, at: NOW.toISOString() });
  return {
    client,
    unsubscribe,
    send(event: ScriptedEvent) {
      act(() => onEvent?.({ ...base(), ...event } as TaskEvent));
    },
    fail(error: Error) {
      act(() => onError?.(error));
    },
    base,
  };
}

const httpError = (message: string) => new TaskClientError({ kind: "http", status: 409, message });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTaskSession with MockTaskClient", () => {
  it("runs the happy path: start, page map, steps, approval, approve, completed", async () => {
    const { result, effects } = mockSession("scholarship-happy");
    expect(result.current.state.status).toBe("idle");

    await act(async () => {
      void result.current.start(INPUT);
    });
    expect(result.current.state.status).toBe("starting");
    expect(effects.announce).toHaveBeenCalledWith("Starting your task.", "polite");

    await flush();
    const { state } = result.current;
    expect(state.status).toBe("awaiting_approval");
    expect(state.pageMap?.title).toBe("Gator Futures Scholarship application");
    expect(state.steps.filter((s) => s.status === "completed")).toHaveLength(5);
    expect(state.currentStep).toBe(6);
    expect(state.screenshots.length).toBeGreaterThanOrEqual(6);
    expect(effects.announce).toHaveBeenCalledWith(
      expect.stringContaining("This page has a login link"),
      "polite",
    );
    expect(effects.announce).toHaveBeenCalledWith(
      "Step 3 of about 6: Choosing a program",
      "polite",
    );
    expect(effects.speak).not.toHaveBeenCalledWith(
      expect.stringMatching(/^Step \d/),
      expect.anything(),
    );
    expect(effects.speak).toHaveBeenCalledWith("Selected Computer Science.", "polite");
    expect(effects.announce).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Approval needed\./),
      "assertive",
    );

    await act(async () => {
      void result.current.approve();
    });
    expect(result.current.state.status).toBe("running");
    await flush();
    expect(result.current.state.status).toBe("completed");
    expect(result.current.state.outcome).toBe("Submitted. Confirmation number 4821.");
    expect(effects.announce).toHaveBeenLastCalledWith(
      "Submitted. Confirmation number 4821.",
      "assertive",
    );
    expect(result.current.state.log.map((entry) => entry.text)).toContain(
      "Approved: Submit application",
    );
  });

  it("deny ends with not submitted", async () => {
    const { result } = mockSession("scholarship-deny");
    await act(async () => {
      void result.current.start(INPUT);
    });
    await flush();
    await act(async () => {
      void result.current.deny("Wrong program");
    });
    await flush();
    expect(result.current.state.status).toBe("completed");
    expect(result.current.state.outcome).toMatch(/^Not submitted/);
    expect(result.current.state.steps.find((s) => s.step === 6)?.status).toBe("incomplete");
  });

  it("password hand-off waits for resume", async () => {
    const { result, effects } = mockSession("password-handoff");
    await act(async () => {
      void result.current.start(INPUT);
    });
    await flush();
    expect(result.current.state.status).toBe("awaiting_user");
    expect(result.current.state.handoff?.reason).toBe("sensitive_value");
    expect(effects.announce).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Your turn\. .*password/),
      "assertive",
    );
    await act(async () => {
      void result.current.resume();
    });
    await flush();
    expect(result.current.state.status).toBe("completed");
  });

  it("stop mid-run silences speech first, calls stop, and announces it once", async () => {
    const { result, effects, client } = mockSession("scholarship-happy");
    const stopSpy = vi.spyOn(client, "stop");
    await act(async () => {
      void result.current.start(INPUT);
    });
    await flush(200);
    await flush(6000);
    expect(result.current.state.status).toBe("running");

    await act(async () => {
      void result.current.stop();
    });
    expect(effects.cancelSpeech).toHaveBeenCalledTimes(1);
    expect(effects.announce).toHaveBeenLastCalledWith("Stopping.", "assertive");
    expect(result.current.state.stopping).toBe(true);
    expect(stopSpy).toHaveBeenCalledWith(result.current.state.taskId);
    expect(effects.cancelSpeech.mock.invocationCallOrder[0]).toBeLessThan(
      stopSpy.mock.invocationCallOrder[0]!,
    );

    await flush();
    expect(result.current.state.status).toBe("stopped");
    const stoppedAnnouncements = effects.announce.mock.calls.filter(([text]) =>
      text.startsWith("Stopped"),
    );
    expect(stoppedAnnouncements).toEqual([[STOPPED_BY_USER_TEXT, "assertive"]]);
    const eventsAfterStop = result.current.state.log.length;
    await flush(60_000);
    expect(result.current.state.log).toHaveLength(eventsAfterStop);
  });

  it("failure ends in a recoverable error and retry starts again", async () => {
    const { result, effects } = mockSession("failure");
    await act(async () => {
      void result.current.start(INPUT);
    });
    await flush();
    expect(result.current.state.status).toBe("failed");
    expect(result.current.state.error?.recoverable).toBe(true);
    expect(effects.announce).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Task failed\..*You can try again\.$/),
      "assertive",
    );

    await act(async () => {
      void result.current.retry();
    });
    expect(result.current.state.status).toBe("starting");
    expect(result.current.state.request).toEqual(INPUT);
  });
});

describe("useTaskSession with a stub client", () => {
  async function startStub() {
    const stub = stubClient();
    const session = renderSession(stub.client);
    await act(async () => {
      await session.result.current.start(INPUT);
    });
    stub.send({ type: "task.started", ...INPUT });
    return { ...stub, ...session };
  }

  it("subscribes once the task id arrives and unsubscribes when the task ends", async () => {
    const { client, unsubscribe, send, result } = await startStub();
    expect(client.subscribe).toHaveBeenCalledWith("t1", expect.any(Function), expect.any(Function));
    expect(result.current.state.status).toBe("planning");
    send({ type: "task.completed", summary: "Done." });
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("unsubscribes and cancels speech on unmount", async () => {
    const { unsubscribe, unmount, effects } = await startStub();
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
    expect(effects.cancelSpeech).toHaveBeenCalled();
  });

  it("does not announce duplicate events", async () => {
    const { client, effects, result } = await startStub();
    const onEvent = client.subscribe.mock.calls[0]![1];
    const narration: TaskEvent = {
      type: "narration",
      taskId: "t1",
      seq: 50,
      at: NOW.toISOString(),
      text: "Hello",
      priority: "polite",
    };
    act(() =>
      onEvent({
        type: "page.map",
        taskId: "t1",
        seq: 49,
        at: NOW.toISOString(),
        title: "T",
        summary: "S",
        regions: [],
      }),
    );
    act(() => onEvent(narration));
    act(() => onEvent(narration));
    expect(effects.speak.mock.calls.filter(([text]) => text === "Hello")).toHaveLength(1);
    expect(result.current.state.log.filter((e) => e.text === "Hello")).toHaveLength(1);
  });

  it("turns a failed start into a recoverable error with a plain message", async () => {
    const stub = stubClient();
    stub.client.start.mockRejectedValue(
      new TaskClientError({ kind: "network", message: "AccessPilot couldn't reach its server." }),
    );
    const { result, effects } = renderSession(stub.client);
    await act(async () => {
      await result.current.start(INPUT);
    });
    expect(result.current.state.status).toBe("failed");
    expect(result.current.state.error?.message).toBe("AccessPilot couldn't reach its server.");
    expect(effects.announce).toHaveBeenLastCalledWith(
      "AccessPilot couldn't reach its server.",
      "assertive",
    );
  });

  it("uses a generic message when start throws something unexpected", async () => {
    const stub = stubClient();
    stub.client.start.mockRejectedValue(new Error("TypeError at line 4"));
    const { result } = renderSession(stub.client);
    await act(async () => {
      await result.current.start(INPUT);
    });
    expect(result.current.state.error?.message).toBe(
      "AccessPilot couldn't start the task. Try again.",
    );
  });

  it("ignores start while a task is active", async () => {
    const { client, result } = await startStub();
    await act(async () => {
      await result.current.start(INPUT);
    });
    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it("stop before the task id arrives stops the task as soon as it exists", async () => {
    const stub = stubClient();
    let resolveStart: (value: { taskId: string }) => void = () => undefined;
    stub.client.start.mockReturnValue(new Promise((resolve) => (resolveStart = resolve)));
    const { result } = renderSession(stub.client);
    let starting: Promise<void> = Promise.resolve();
    act(() => {
      starting = result.current.start(INPUT);
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(stub.client.stop).not.toHaveBeenCalled();
    await act(async () => {
      resolveStart({ taskId: "t1" });
      await starting;
    });
    expect(stub.client.stop).toHaveBeenCalledWith("t1");
    expect(result.current.state.status).toBe("stopped");
  });

  it("a failed stop explains what to do and allows another try", async () => {
    const { client, result, effects } = await startStub();
    client.stop.mockRejectedValueOnce(httpError("Couldn't confirm. Press Stop again."));
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.state.status).toBe("planning");
    expect(result.current.state.stopping).toBe(false);
    expect(effects.announce).toHaveBeenLastCalledWith(
      "Couldn't confirm. Press Stop again.",
      "assertive",
    );
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.state.status).toBe("stopped");
  });

  it("stop is ignored when nothing is running", async () => {
    const stub = stubClient();
    const { result, effects } = renderSession(stub.client);
    await act(async () => {
      await result.current.stop();
    });
    expect(effects.cancelSpeech).toHaveBeenCalled();
    expect(stub.client.stop).not.toHaveBeenCalled();
  });

  async function reachApproval() {
    const stub = await startStub();
    stub.send({ type: "page.map", title: "T", summary: "S", regions: [] });
    stub.send({
      type: "approval.required",
      approvalId: "a1",
      action: "Submit",
      summary: "Submit?",
      fields: [],
    });
    return stub;
  }

  it("sends approve and deny with the current approval id", async () => {
    const stub = await reachApproval();
    await act(async () => {
      await stub.result.current.deny("Wrong program");
    });
    expect(stub.client.deny).toHaveBeenCalledWith("t1", "a1", "Wrong program");
    expect(stub.result.current.state.pendingDecision).toBeNull();

    const again = await reachApproval();
    await act(async () => {
      await again.result.current.approve();
    });
    expect(again.client.approve).toHaveBeenCalledWith("t1", "a1");
  });

  it("restores the approval dialog when sending the decision fails", async () => {
    const stub = await reachApproval();
    stub.client.approve.mockRejectedValue(httpError("Couldn't send your answer."));
    await act(async () => {
      await stub.result.current.approve();
    });
    expect(stub.result.current.state.status).toBe("awaiting_approval");
    expect(stub.result.current.state.approval?.approvalId).toBe("a1");
    expect(stub.effects.announce).toHaveBeenLastCalledWith(
      "Couldn't send your answer.",
      "assertive",
    );
  });

  it("approve does nothing without a pending approval", async () => {
    const { client, result } = await startStub();
    await act(async () => {
      await result.current.approve();
    });
    expect(client.approve).not.toHaveBeenCalled();
  });

  it("restores the hand-off when resume fails", async () => {
    const stub = await startStub();
    stub.send({ type: "user_input.required", reason: "captcha", instructions: "Solve it." });
    stub.client.resume.mockRejectedValue(httpError("Couldn't continue."));
    await act(async () => {
      await stub.result.current.resume();
    });
    expect(stub.result.current.state.status).toBe("awaiting_user");
    expect(stub.result.current.state.handoff?.reason).toBe("captcha");
  });

  it("resume is ignored when not waiting for the user", async () => {
    const { client, result } = await startStub();
    await act(async () => {
      await result.current.resume();
    });
    expect(client.resume).not.toHaveBeenCalled();
  });

  it("resume is ignored before a task exists", async () => {
    const idle = stubClient();
    const { result } = renderSession(idle.client);
    await act(async () => {
      await result.current.resume();
    });
    expect(idle.client.resume).not.toHaveBeenCalled();
  });

  it("non-fatal stream errors become dismissible warnings", async () => {
    const { fail, result } = await startStub();
    fail(new TaskClientError({ kind: "invalid_event", message: "Skipped an update." }));
    expect(result.current.state.status).toBe("planning");
    const warning = result.current.state.warnings[0];
    expect(warning?.message).toBe("Skipped an update.");
    act(() => result.current.dismissWarning(warning!.id));
    expect(result.current.state.warnings).toEqual([]);
  });

  it("fatal stream errors fail the task and announce it", async () => {
    const { fail, result, effects } = await startStub();
    fail(new TaskClientError({ kind: "connection_lost", message: "Lost the connection." }));
    expect(result.current.state.status).toBe("failed");
    expect(result.current.state.error?.code).toBe("connection_lost");
    expect(effects.announce).toHaveBeenLastCalledWith("Lost the connection.", "assertive");
    const announcements = effects.announce.mock.calls.length;
    fail(new Error("raw"));
    expect(effects.announce).toHaveBeenCalledTimes(announcements);
  });

  describe("follow-up messages", () => {
    it("rejects empty text and messages before any URL is known", () => {
      const { result } = renderSession(stubClient().client);
      expect(result.current.sendFollowUp("   ")).toEqual({ ok: false, reason: "empty" });
      expect(result.current.sendFollowUp("Do it")).toEqual({ ok: false, reason: "no_url" });
    });

    it("is busy while a task runs", async () => {
      const { result } = await startStub();
      expect(result.current.sendFollowUp("Also this")).toEqual({ ok: false, reason: "busy" });
    });

    it("starts a new task with the same URL when the last one ended", async () => {
      const stub = await startStub();
      stub.send({ type: "task.completed", summary: "Done." });
      let outcome: ReturnType<typeof stub.result.current.sendFollowUp> | null = null;
      await act(async () => {
        outcome = stub.result.current.sendFollowUp("  Now find the deadline ");
      });
      expect(outcome).toEqual({ ok: true });
      expect(stub.client.start).toHaveBeenLastCalledWith({
        url: INPUT.url,
        goal: "Now find the deadline",
      });
    });
  });

  it("repeats the last narration and re-reads the page map", async () => {
    const { send, result, effects } = await startStub();
    expect(result.current.repeatLastNarration()).toBe(false);
    expect(result.current.describePage()).toBe(false);
    send({ type: "page.map", title: "Form", summary: "Has fields.", regions: [] });
    send({ type: "narration", text: "Typing.", priority: "polite" });
    effects.speak.mockClear();
    expect(result.current.repeatLastNarration()).toBe(true);
    expect(effects.speak).toHaveBeenLastCalledWith("Typing.", "polite");
    expect(result.current.describePage()).toBe(true);
    expect(effects.speak).toHaveBeenLastCalledWith("Form. Has fields.", "polite");
  });

  it("reset returns to idle after a task ends, and retry only works after a failure", async () => {
    const stub = await startStub();
    await act(async () => {
      await stub.result.current.retry();
    });
    expect(stub.client.start).toHaveBeenCalledTimes(1);
    stub.send({ type: "task.completed", summary: "Done." });
    act(() => stub.result.current.reset());
    expect(stub.result.current.state.status).toBe("idle");
  });

  it("works without effects", async () => {
    const stub = stubClient();
    const { result } = renderHook(() => useTaskSession({ client: stub.client }));
    await act(async () => {
      await result.current.start(INPUT);
    });
    expect(result.current.state.status).toBe("starting");
    expect(result.current.state.log[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("logs ignored inputs in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const { result } = renderSession(stubClient().client);
    act(() => result.current.reset());
    act(() => result.current.dismissWarning("missing"));
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("ignored ui/warning_dismissed"));
    vi.unstubAllEnvs();
  });
});
