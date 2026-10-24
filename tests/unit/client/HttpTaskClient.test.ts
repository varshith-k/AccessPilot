import { backoffDelay, HttpTaskClient, type EventSourceLike } from "@/lib/client/HttpTaskClient";
import { TaskClientError } from "@/lib/client/errors";
import type { TaskEvent } from "@/lib/contracts";

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(data: unknown) {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent("message", { data: text }));
  }

  fail() {
    this.onerror?.(new Event("error"));
  }

  static latest(): FakeEventSource {
    const instance = FakeEventSource.instances.at(-1);
    if (!instance) throw new Error("no EventSource created");
    return instance;
  }
}

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(fetchImpl: typeof fetch = vi.fn(), options = {}) {
  return new HttpTaskClient({
    baseUrl: "https://api.test/",
    fetch: fetchImpl,
    createEventSource: (url) => new FakeEventSource(url),
    ...options,
  });
}

const narration = (seq: number, taskId = "t1"): TaskEvent => ({
  type: "narration",
  taskId,
  seq,
  at: "2026-10-25T14:00:00.000Z",
  text: `Event ${seq}`,
  priority: "polite",
});

beforeEach(() => {
  FakeEventSource.instances = [];
});

describe("HttpTaskClient requests", () => {
  it("starts a task with a JSON POST and returns the task id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(201, { taskId: "t1" }));
    const client = makeClient(fetchImpl);
    await expect(client.start({ url: "https://example.edu", goal: "Apply" })).resolves.toEqual({
      taskId: "t1",
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.test/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ url: "https://example.edu", goal: "Apply" }),
    });
  });

  it.each([
    [
      "approve",
      (c: HttpTaskClient) => c.approve("t 1", "a1"),
      "/api/tasks/t%201/approve",
      { approvalId: "a1" },
    ],
    ["deny", (c: HttpTaskClient) => c.deny("t1", "a1"), "/api/tasks/t1/deny", { approvalId: "a1" }],
    [
      "deny with reason",
      (c: HttpTaskClient) => c.deny("t1", "a1", "Wrong program"),
      "/api/tasks/t1/deny",
      { approvalId: "a1", reason: "Wrong program" },
    ],
    ["resume", (c: HttpTaskClient) => c.resume("t1"), "/api/tasks/t1/resume", {}],
    ["stop", (c: HttpTaskClient) => c.stop("t1"), "/api/tasks/t1/stop", {}],
  ] as const)("%s posts to the right endpoint", async (_name, call, path, body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await call(makeClient(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.test${path}`,
      expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
    );
  });

  it("uses the server's error message and code when present", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(409, {
        error: { code: "invalid_state", message: "Not waiting for approval." },
      }),
    );
    const error = await makeClient(fetchImpl)
      .approve("t1", "a1")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TaskClientError);
    expect(error).toMatchObject({
      kind: "http",
      status: 409,
      code: "invalid_state",
      message: "Not waiting for approval.",
      fatal: true,
    });
  });

  it.each([
    [400, /couldn't understand/],
    [404, /no longer exists/],
    [429, /busy/],
    [500, /server/],
    [503, /server/],
    [418, /couldn't complete/],
  ])("falls back to a plain message for HTTP %i without a valid body", async (status, message) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>oops</html>", { status }));
    await expect(makeClient(fetchImpl).stop("t1")).rejects.toMatchObject({
      status,
      code: null,
      message: expect.stringMatching(message),
    });
  });

  it("ignores an error body that does not match the contract", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(404, { message: "nope" }));
    await expect(makeClient(fetchImpl).stop("t1")).rejects.toMatchObject({
      message: expect.stringMatching(/no longer exists/),
    });
  });

  it("wraps network failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(
      makeClient(fetchImpl).start({ url: "https://a.b", goal: "x" }),
    ).rejects.toMatchObject({
      kind: "network",
      message: expect.stringContaining("internet connection"),
    });
  });

  it("rejects a 2xx start response that is not JSON or not the right shape", async () => {
    const notJson = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok", { status: 200 }));
    await expect(
      makeClient(notJson).start({ url: "https://a.b", goal: "x" }),
    ).rejects.toMatchObject({
      kind: "invalid_response",
    });
    const wrongShape = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { id: "t1" }));
    await expect(
      makeClient(wrongShape).start({ url: "https://a.b", goal: "x" }),
    ).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("defaults to the global fetch on the same origin", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    await new HttpTaskClient().stop("t1");
    expect(fetchSpy).toHaveBeenCalledWith("/api/tasks/t1/stop", expect.anything());
  });
});

describe("HttpTaskClient event stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers validated events and closes after a terminal event", () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    makeClient().subscribe("t1", onEvent, onError);
    const source = FakeEventSource.latest();
    expect(source.url).toBe("https://api.test/api/tasks/t1/events");

    source.emit(narration(1));
    source.emit({
      type: "task.completed",
      taskId: "t1",
      seq: 2,
      at: "2026-10-25T14:00:01Z",
      summary: "Done.",
    });
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(source.closed).toBe(true);
    source.fail();
    vi.runAllTimers();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports malformed events as non-fatal and keeps streaming", () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    makeClient().subscribe("t1", onEvent, onError);
    const source = FakeEventSource.latest();
    source.emit("{broken");
    source.emit({ ...narration(1), priority: "urgent" });
    source.emit(narration(2));
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ kind: "invalid_event", fatal: false });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(source.closed).toBe(false);
  });

  it("ignores unknown event types and events for other tasks", () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const onUnknownEvent = vi.fn();
    makeClient(vi.fn(), { onUnknownEvent }).subscribe("t1", onEvent, onError);
    const source = FakeEventSource.latest();
    source.emit({ type: "task.paused", taskId: "t1", seq: 1 });
    source.emit(narration(2, "other"));
    expect(onUnknownEvent).toHaveBeenCalledWith("task.paused");
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("logs unknown event types only in development by default", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    makeClient().subscribe("t1", vi.fn(), vi.fn());
    FakeEventSource.latest().emit({ type: "heartbeat" });
    expect(debug).not.toHaveBeenCalled();

    vi.stubEnv("NODE_ENV", "development");
    FakeEventSource.latest().emit({ type: "heartbeat" });
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("heartbeat"));
    vi.unstubAllEnvs();
  });

  it("reconnects with exponential backoff and resumes from the last seq", () => {
    const onError = vi.fn();
    makeClient(vi.fn(), { initialBackoffMs: 100, maxBackoffMs: 1000 }).subscribe(
      "t1",
      vi.fn(),
      onError,
    );
    FakeEventSource.latest().emit(narration(7));

    FakeEventSource.latest().fail();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    vi.advanceTimersByTime(99);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.latest().url).toBe("https://api.test/api/tasks/t1/events?lastEventId=7");

    FakeEventSource.latest().fail();
    vi.advanceTimersByTime(199);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);
    expect(onError).not.toHaveBeenCalled();
  });

  it("resets the attempt count after an event arrives", () => {
    const onError = vi.fn();
    makeClient(vi.fn(), { initialBackoffMs: 100, maxReconnectAttempts: 2 }).subscribe(
      "t1",
      vi.fn(),
      onError,
    );
    for (let seq = 1; seq <= 4; seq++) {
      FakeEventSource.latest().fail();
      vi.advanceTimersByTime(100);
      FakeEventSource.latest().emit(narration(seq));
    }
    expect(onError).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(5);
  });

  it("gives up after the maximum attempts with a fatal connection_lost error", () => {
    const onError = vi.fn();
    makeClient(vi.fn(), { initialBackoffMs: 100, maxBackoffMs: 250 }).subscribe(
      "t1",
      vi.fn(),
      onError,
    );
    for (let attempt = 1; attempt <= 5; attempt++) {
      FakeEventSource.latest().fail();
      vi.advanceTimersByTime(250);
    }
    expect(FakeEventSource.instances).toHaveLength(6);
    FakeEventSource.latest().fail();
    vi.runAllTimers();
    expect(FakeEventSource.instances).toHaveLength(6);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ kind: "connection_lost", fatal: true });
    expect(FakeEventSource.latest().closed).toBe(true);
  });

  it("unsubscribe closes the stream and cancels a pending reconnect", () => {
    const onEvent = vi.fn();
    const unsubscribe = makeClient().subscribe("t1", onEvent, vi.fn());
    const first = FakeEventSource.latest();
    first.fail();
    unsubscribe();
    vi.runAllTimers();
    expect(FakeEventSource.instances).toHaveLength(1);

    const unsubscribe2 = makeClient().subscribe("t1", onEvent, vi.fn());
    const second = FakeEventSource.latest();
    unsubscribe2();
    expect(second.closed).toBe(true);
    second.emit(narration(1));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("ignores messages and errors from a stale source after reconnecting", () => {
    const onEvent = vi.fn();
    makeClient(vi.fn(), { initialBackoffMs: 10 }).subscribe("t1", onEvent, vi.fn());
    const stale = FakeEventSource.latest();
    stale.fail();
    vi.advanceTimersByTime(10);
    stale.emit(narration(1));
    stale.fail();
    expect(onEvent).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});

describe("backoffDelay", () => {
  it("doubles from the initial delay and caps at the maximum", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, 500, 8000))).toEqual([
      500, 1000, 2000, 4000, 8000, 8000,
    ]);
  });
});
