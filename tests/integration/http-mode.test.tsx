import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccessPilotApp } from "@/components/AccessPilotApp";
import { isTerminalEvent, type TaskEvent } from "@/lib/contracts";
import { HttpTaskClient, type EventSourceLike } from "@/lib/client/HttpTaskClient";
import { MockTaskClient } from "@/lib/client/MockTaskClient";
import { settingsStore } from "@/lib/client/settings";
import { liveText } from "../unit/components/helpers";

/**
 * A fake backend that follows docs/CONTRACT.md: JSON bodies, 204 for actions, `{ error }` bodies
 * on failure, and an SSE stream where each message is one JSON TaskEvent with id = seq. It runs
 * the scripted mock scenario behind the HTTP surface, so the UI is exercised end to end through
 * the real HttpTaskClient, exactly as with NEXT_PUBLIC_TASK_CLIENT=http.
 */
function createContractBackend() {
  const engine = new MockTaskClient({ scenario: "scholarship-happy", latencyMs: 0 });
  const requests: { method: string; path: string; body: unknown }[] = [];
  const streams: FakeServerEventSource[] = [];

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method: init?.method ?? "GET", path, body });
    const action = path.match(/^\/api\/tasks\/([^/]+)\/(approve|deny|resume|stop)$/);
    try {
      if (path === "/api/tasks") {
        const { url, goal } = body as { url: string; goal: string };
        return json(201, await engine.start({ url, goal }));
      }
      if (action) {
        const [, id = "", verb] = action;
        const taskId = decodeURIComponent(id);
        const { approvalId } = (body ?? {}) as { approvalId?: string };
        if (verb === "approve") await engine.approve(taskId, approvalId ?? "");
        if (verb === "deny") await engine.deny(taskId, approvalId ?? "");
        if (verb === "resume") await engine.resume(taskId);
        if (verb === "stop") await engine.stop(taskId);
        return new Response(null, { status: 204 });
      }
      return json(404, { error: { code: "not_found", message: "No such route." } });
    } catch (error) {
      return json(409, {
        error: { code: "invalid_state", message: (error as Error).message },
      });
    }
  };

  class FakeServerEventSource implements EventSourceLike {
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    closed = false;
    private readonly unsubscribe: () => void;

    constructor(readonly url: string) {
      streams.push(this);
      const taskId = decodeURIComponent(
        new URL(url, "http://localhost").pathname.split("/")[3] ?? "",
      );
      this.unsubscribe = engine.subscribe(
        taskId,
        (event: TaskEvent) => {
          if (this.closed) return;
          // Serialize exactly as the SSE `data:` line would carry it.
          this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
          if (isTerminalEvent(event)) this.close();
        },
        () => this.onerror?.(new Event("error")),
      );
    }

    close() {
      this.closed = true;
      this.unsubscribe();
    }
  }

  const client = new HttpTaskClient({
    fetch: fetchImpl,
    createEventSource: (url) => new FakeServerEventSource(url),
  });
  return { client, requests, streams };
}

async function advanceUntil(check: () => boolean, limitMs = 120_000) {
  for (let elapsed = 0; elapsed < limitMs && !check(); elapsed += 250) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  }
  expect(check()).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  settingsStore.update({ firstRunDone: true, readAloud: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("http mode against a contract-following backend", () => {
  it("runs the scholarship flow through HttpTaskClient: start, stream, approve, complete", async () => {
    const backend = createContractBackend();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(<AccessPilotApp client={backend.client} />);

    await user.type(
      screen.getByRole("textbox", { name: "Website address" }),
      "http://localhost:4000/scholarship",
    );
    await user.type(
      screen.getByRole("textbox", { name: "What do you want to get done?" }),
      "Help me complete this scholarship application.",
    );
    await user.click(screen.getByRole("button", { name: "Start task" }));

    await advanceUntil(() => screen.queryByRole("dialog") !== null);
    expect(backend.requests[0]).toEqual({
      method: "POST",
      path: "/api/tasks",
      body: {
        url: "http://localhost:4000/scholarship",
        goal: "Help me complete this scholarship application.",
      },
    });
    expect(backend.streams[0]?.url).toMatch(/^\/api\/tasks\/[^/]+\/events$/);
    expect(screen.getAllByRole("img").length).toBeGreaterThan(0);

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Approve and submit" }),
    );
    expect(backend.requests.at(-1)).toMatchObject({
      method: "POST",
      path: expect.stringMatching(/\/approve$/),
      body: { approvalId: "approval-submit" },
    });

    await advanceUntil(() => liveText("assertive") === "Submitted. Confirmation number 4821.");
    expect(backend.streams.every((stream) => stream.closed)).toBe(true);
  });

  it("shows the backend's plain-language error message when an action is rejected", async () => {
    const backend = createContractBackend();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(<AccessPilotApp client={backend.client} />);

    await user.type(
      screen.getByRole("textbox", { name: "Website address" }),
      "http://localhost:4000/scholarship",
    );
    await user.type(
      screen.getByRole("textbox", { name: "What do you want to get done?" }),
      "Apply",
    );
    await user.click(screen.getByRole("button", { name: "Start task" }));
    await advanceUntil(() => screen.queryByRole("dialog") !== null);

    // Simulate the task having moved on server-side: the next approve gets a 409 error body.
    const approve = vi
      .spyOn(MockTaskClient.prototype, "approve")
      .mockRejectedValueOnce(new Error("This task is no longer waiting for approval."));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Approve and submit" }),
    );
    await advanceUntil(() => liveText("assertive").includes("no longer waiting for approval"));
    expect(approve).toHaveBeenCalled();
    // The server said the question is closed, so the dialog must not ask it again.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
