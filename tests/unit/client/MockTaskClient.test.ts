import { taskEventSchema, type TaskEvent } from "@/lib/contracts";
import { MockTaskClient } from "@/lib/client/MockTaskClient";
import { TaskClientError } from "@/lib/client/errors";
import {
  DEMO_FOLLOW_UP_SUMMARY,
  MOCK_SCENARIO_NAMES,
  type MockScenarioName,
} from "@/lib/client/mock/scenarios";

const INPUT = {
  url: "http://localhost:4000/scholarship",
  goal: "Complete this scholarship application",
};

async function startScenario(scenario: MockScenarioName) {
  const client = new MockTaskClient({ scenario });
  const startPromise = client.start(INPUT);
  await vi.advanceTimersByTimeAsync(150);
  const { taskId } = await startPromise;
  const events: TaskEvent[] = [];
  const errors: Error[] = [];
  const unsubscribe = client.subscribe(
    taskId,
    (event) => events.push(event),
    (error) => errors.push(error),
  );
  return { client, taskId, events, errors, unsubscribe };
}

/** Runs the script until it pauses or ends. */
async function settle() {
  await vi.runAllTimersAsync();
}

async function settled<T>(promise: Promise<T>): Promise<T> {
  const [result] = await Promise.all([promise, settle()]);
  return result;
}

const types = (events: TaskEvent[]) => events.map((event) => event.type);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T14:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MockTaskClient scenarios", () => {
  it.each(MOCK_SCENARIO_NAMES)("%s emits valid, strictly increasing events", async (name) => {
    const { client, taskId, events } = await startScenario(name);
    await settle();
    const last = events.at(-1);
    if (last?.type === "approval.required") await settled(client.approve(taskId, last.approvalId));
    if (last?.type === "user_input.required") await settled(client.resume(taskId));

    expect(events[0]).toMatchObject({ type: "task.started", ...INPUT, seq: 1 });
    events.forEach((event, index) => {
      expect(taskEventSchema.safeParse(event).success).toBe(true);
      expect(event.taskId).toBe(taskId);
      expect(event.seq).toBe(index + 1);
    });
    expect(["task.completed", "task.failed"]).toContain(events.at(-1)?.type);
  });

  it("scholarship-happy: page map, six steps, approval, then confirmation on approve", async () => {
    const { client, taskId, events } = await startScenario("scholarship-happy");
    await settle();

    const beforeApproval = types(events);
    expect(beforeApproval.indexOf("page.map")).toBeLessThan(beforeApproval.indexOf("step.started"));
    expect(beforeApproval.at(-1)).toBe("approval.required");
    const started = events.filter((e) => e.type === "step.started");
    expect(started.map((e) => e.step)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(started.every((e) => e.totalSteps === 6)).toBe(true);
    expect(events.filter((e) => e.type === "screenshot").length).toBeGreaterThanOrEqual(6);
    const narration = events.filter((e) => e.type === "narration").map((e) => e.text);
    expect(narration).toContain("Selected Computer Science.");

    const approval = events.at(-1);
    if (approval?.type !== "approval.required") throw new Error("expected approval");
    expect(approval.fields).toContainEqual({ label: "Program", value: "Computer Science" });
    expect(approval.fields.map((f) => f.label)).toEqual([
      "Full name",
      "Email",
      "Program",
      "Start date",
      "Essay",
    ]);

    // Nothing more happens while waiting, however long the user takes.
    const count = events.length;
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(events).toHaveLength(count);

    await settled(client.approve(taskId, approval.approvalId));
    expect(types(events.slice(count))).toEqual([
      "narration",
      "step.completed",
      "screenshot",
      "task.completed",
    ]);
    expect(events.at(-1)).toMatchObject({ summary: "Submitted. Confirmation number 4821." });
  });

  it("scholarship-deny: denying ends with a not-submitted narration and task.completed", async () => {
    const { client, taskId, events } = await startScenario("scholarship-deny");
    await settle();
    const approval = events.at(-1);
    if (approval?.type !== "approval.required") throw new Error("expected approval");
    expect(approval.fields).toContainEqual({ label: "Program", value: "Computer Engineering" });

    const count = events.length;
    await settled(client.deny(taskId, approval.approvalId, "Wrong program"));
    const after = events.slice(count);
    expect(types(after)).toEqual(["narration", "task.completed"]);
    expect(after[0]).toMatchObject({ text: "Okay, I won't do that." });
    expect(after[1]).toMatchObject({
      summary: expect.stringMatching(/^Not done: Submit application\. I stopped there/),
    });
    expect(after.some((e) => e.type === "step.completed" && e.step === 6)).toBe(false);
  });

  it("a follow-up with a different goal gets a demo notice instead of replaying the form", async () => {
    const { client, taskId, events } = await startScenario("scholarship-happy");
    await settle();
    const approval = events.at(-1);
    if (approval?.type !== "approval.required") throw new Error("expected approval");
    await settled(client.approve(taskId, approval.approvalId));

    const followUp = await settled(client.start({ ...INPUT, goal: "Now find the deadline" }));
    const after: TaskEvent[] = [];
    client.subscribe(
      followUp.taskId,
      (event) => after.push(event),
      () => undefined,
    );
    await settle();
    expect(types(after)).toEqual(["task.started", "narration", "task.completed"]);
    expect(after.at(-1)).toMatchObject({ summary: DEMO_FOLLOW_UP_SUMMARY });
    expect(after.some((event) => event.type === "approval.required")).toBe(false);
  });

  it("starting again with the original goal replays the scripted example", async () => {
    const { client } = await startScenario("scholarship-happy");
    const again = await settled(client.start({ ...INPUT, goal: `  ${INPUT.goal.toUpperCase()} ` }));
    const after: TaskEvent[] = [];
    client.subscribe(
      again.taskId,
      (event) => after.push(event),
      () => undefined,
    );
    await settle();
    expect(after.at(-1)?.type).toBe("approval.required");
  });

  it("password-handoff: waits for resume after asking for the password", async () => {
    const { client, taskId, events } = await startScenario("password-handoff");
    await settle();
    expect(events.at(-1)).toMatchObject({
      type: "user_input.required",
      reason: "sensitive_value",
      instructions: expect.stringContaining("password in the browser window"),
    });
    const count = events.length;
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(events).toHaveLength(count);

    await settled(client.resume(taskId));
    expect(events.at(-1)).toMatchObject({ type: "task.completed" });
    expect(events.slice(count)[0]).toMatchObject({
      type: "narration",
      text: "Thanks. Signing you in.",
    });
  });

  it("failure: fails mid-run with a recoverable, plain-language error", async () => {
    const { events } = await startScenario("failure");
    await settle();
    expect(events.some((e) => e.type === "step.started")).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "task.failed",
      recoverable: true,
      message: expect.stringContaining("try again"),
    });
  });

  it("slow-network: leaves long gaps between events", async () => {
    const { events } = await startScenario("slow-network");
    await vi.advanceTimersByTimeAsync(8999);
    expect(types(events)).toEqual(["task.started"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(types(events)).toEqual(["task.started", "page.map"]);
    await settle();
    const times = events.map((e) => Date.parse(e.at));
    for (let i = 2; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(9000);
    }
    expect(events.at(-1)?.type).toBe("task.completed");
  });

  it("stamps events with the injected clock", async () => {
    const { events } = await startScenario("scholarship-happy");
    await vi.advanceTimersByTimeAsync(1200);
    expect(events[0]?.at).toBe("2026-10-25T14:00:00.150Z");
    expect(events[1]?.at).toBe("2026-10-25T14:00:01.350Z");
  });
});

describe("MockTaskClient controls", () => {
  it("stop ends the run immediately with task.stopped and nothing after it", async () => {
    const { client, taskId, events } = await startScenario("scholarship-happy");
    await vi.advanceTimersByTimeAsync(5000);
    await settled(client.stop(taskId));
    expect(events.at(-1)).toMatchObject({ type: "task.stopped", by: "user" });
    const count = events.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toHaveLength(count);
  });

  it("stop while waiting for approval never submits", async () => {
    const { client, taskId, events } = await startScenario("scholarship-happy");
    await settle();
    await settled(client.stop(taskId));
    expect(events.at(-1)?.type).toBe("task.stopped");
    expect(events.some((e) => e.type === "task.completed")).toBe(false);
    await expect(settled(client.approve(taskId, "approval-submit"))).rejects.toMatchObject({
      status: 409,
    });
  });

  it("stop after the task ended is a harmless no-op", async () => {
    const { client, taskId, events } = await startScenario("failure");
    await settle();
    const count = events.length;
    await expect(settled(client.stop(taskId))).resolves.toBeUndefined();
    expect(events).toHaveLength(count);
  });

  it("rejects approve and deny when not waiting, and with the wrong approval id", async () => {
    const { client, taskId, events } = await startScenario("scholarship-happy");
    await vi.advanceTimersByTimeAsync(2000);
    await expect(settled(client.approve(taskId, "approval-submit"))).rejects.toMatchObject({
      kind: "http",
      status: 409,
      code: "invalid_state",
    });
    await settle();
    expect(events.at(-1)?.type).toBe("approval.required");
    await expect(settled(client.deny(taskId, "approval-other"))).rejects.toMatchObject({
      status: 404,
      code: "approval_not_found",
    });
    expect(events.at(-1)?.type).toBe("approval.required");
  });

  it("rejects resume when not waiting for the user", async () => {
    const { client, taskId } = await startScenario("scholarship-happy");
    await expect(settled(client.resume(taskId))).rejects.toBeInstanceOf(TaskClientError);
  });

  it("rejects actions on unknown tasks", async () => {
    const client = new MockTaskClient();
    await expect(settled(client.stop("nope"))).rejects.toMatchObject({
      status: 404,
      code: "task_not_found",
    });
  });

  it("rejects invalid start input with the contract's message", async () => {
    const client = new MockTaskClient();
    await expect(
      settled(client.start({ url: "http://example.com", goal: "x" })),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("https://"),
    });
  });

  it("reports an error when subscribing to an unknown task", async () => {
    const client = new MockTaskClient();
    const onError = vi.fn();
    client.subscribe("missing", vi.fn(), onError);
    await settle();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: "connection_lost" }));
  });

  it("pauses while unsubscribed and replays history on resubscribe, like a server", async () => {
    const { client, taskId, events, unsubscribe } = await startScenario("scholarship-happy");
    await vi.advanceTimersByTimeAsync(3000);
    const seen = events.length;
    unsubscribe();
    unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toHaveLength(seen);

    const replayed: TaskEvent[] = [];
    client.subscribe(taskId, (event) => replayed.push(event), vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(replayed.map((e) => e.seq)).toEqual(events.map((e) => e.seq));
    await settle();
    expect(replayed.length).toBeGreaterThan(seen);
  });

  it("only the latest subscriber receives events", async () => {
    const { client, taskId, events } = await startScenario("scholarship-happy");
    const second: TaskEvent[] = [];
    client.subscribe(taskId, (event) => second.push(event), vi.fn());
    await vi.advanceTimersByTimeAsync(5000);
    expect(events).toHaveLength(0);
    expect(second.length).toBeGreaterThan(1);
  });

  it("speed 0 plays the whole script without waiting", async () => {
    const client = new MockTaskClient({ scenario: "failure", speed: 0, latencyMs: 0 });
    const { taskId } = await client.start(INPUT);
    const events: TaskEvent[] = [];
    const startedAt = Date.now();
    client.subscribe(taskId, (event) => events.push(event), vi.fn());
    await vi.runAllTimersAsync();
    expect(events.at(-1)?.type).toBe("task.failed");
    expect(Date.now() - startedAt).toBeLessThan(50);
    expect(client.scenarioName).toBe("failure");
  });

  it("issues a new task id per start", async () => {
    const client = new MockTaskClient({ latencyMs: 0 });
    const a = await client.start(INPUT);
    const b = await client.start(INPUT);
    expect(a.taskId).not.toBe(b.taskId);
  });
});
