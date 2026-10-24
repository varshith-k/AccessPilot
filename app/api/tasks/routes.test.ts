import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { taskEventSchema, type TaskEvent } from "@/lib/contracts";
import { POST as startTask } from "./route";
import { GET as getEvents } from "./[id]/events/route";
import { POST as approve } from "./[id]/approve/route";
import { POST as deny } from "./[id]/deny/route";
import { POST as resume } from "./[id]/resume/route";
import { POST as stop } from "./[id]/stop/route";

const post = (path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const start = (body: unknown) => startTask(post("/api/tasks", body));
const URL_OK = "http://localhost:4000/scholarship";

beforeEach(() => {
  vi.stubEnv("ACCESSPILOT_AGENT", "fake");
  vi.stubEnv("ACCESSPILOT_FAKE_DELAY_MS", "0");
});
afterEach(() => vi.unstubAllEnvs());

/** Reads an SSE response into parsed events, calling `onEvent` as each arrives. */
async function readEvents(
  res: Response,
  onEvent: (e: TaskEvent) => void | Promise<void> = () => {},
) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: TaskEvent[] = [];
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return events;
    buffer += decoder.decode(value);
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      const message = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = message.split("\n").find((l) => l.startsWith("data: "));
      if (!data) continue;
      const event = taskEventSchema.parse(JSON.parse(data.slice(6)));
      events.push(event);
      await onEvent(event);
    }
  }
}

describe("POST /api/tasks", () => {
  it("rejects bad requests with the contract's error body", async () => {
    for (const body of [
      {},
      { url: "ftp://x", goal: "g" },
      { url: URL_OK, goal: "" },
      { url: "https://user:pw@x.com", goal: "g" },
    ]) {
      const res = await start(body);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("invalid_request");
      expect(json.error.message.length).toBeGreaterThan(0);
    }
    expect(
      (await startTask(new Request("http://localhost/api/tasks", { method: "POST", body: "{bad" })))
        .status,
    ).toBe(400);
  });

  it("says plainly when the agent is not set up, without internals", async () => {
    vi.unstubAllEnvs();
    const res = await start({ url: URL_OK, goal: "Apply" });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe("internal_error");
    expect(json.error.message).toMatch(/isn't set up/);
  });
});

describe("full flow through the routes", () => {
  it("starts, streams, waits for approval, approves, completes, and closes the stream", async () => {
    const res = await start({ url: URL_OK, goal: "Complete this scholarship application" });
    expect(res.status).toBe(201);
    const { taskId } = await res.json();

    const stream = await getEvents(
      new Request(`http://localhost/api/tasks/${taskId}/events`),
      ctx(taskId),
    );
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.headers.get("cache-control")).toContain("no-cache");

    let approvalId = "";
    const events = await readEvents(stream, async (event) => {
      if (event.type !== "approval.required") return;
      approvalId = event.approvalId;
      const wrong = await approve(
        post(`/api/tasks/${taskId}/approve`, { approvalId: "appr_wrong" }),
        ctx(taskId),
      );
      expect(wrong.status).toBe(404);
      expect((await wrong.json()).error.code).toBe("approval_not_found");
      const ok = await approve(post(`/api/tasks/${taskId}/approve`, { approvalId }), ctx(taskId));
      expect(ok.status).toBe(204);
    });

    expect(events[0]?.type).toBe("task.started");
    expect(events.at(-1)).toMatchObject({
      type: "task.completed",
      summary: "Submitted. Confirmation number 4821.",
    });
    expect(events.map((e) => e.seq)).toEqual([...events.map((e) => e.seq)].sort((a, b) => a - b));
    expect(events.some((e) => e.type === "screenshot")).toBe(true);

    const again = await approve(post(`/api/tasks/${taskId}/approve`, { approvalId }), ctx(taskId));
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("invalid_state");

    // A late client replays everything after its last seq, then the stream closes.
    const replay = await readEvents(
      await getEvents(
        new Request(`http://localhost/x?lastEventId=${events.length - 1}`),
        ctx(taskId),
      ),
    );
    expect(replay.map((e) => e.type)).toEqual(["task.completed"]);
  });

  it("deny ends the task as not submitted", async () => {
    const { taskId } = await (await start({ url: URL_OK, goal: "Apply" })).json();
    const events = await readEvents(
      await getEvents(new Request("http://localhost/x"), ctx(taskId)),
      async (event) => {
        if (event.type !== "approval.required") return;
        const res = await deny(
          post(`/api/tasks/${taskId}/deny`, { approvalId: event.approvalId, reason: "Not yet" }),
          ctx(taskId),
        );
        expect(res.status).toBe(204);
      },
    );
    expect(events.at(-1)).toMatchObject({ type: "task.completed" });
    expect((events.at(-1) as { summary: string }).summary).toMatch(/Not done/);
  });

  it("stop is immediate and idempotent", async () => {
    const { taskId } = await (await start({ url: URL_OK, goal: "Apply" })).json();
    const events = await readEvents(
      await getEvents(new Request("http://localhost/x"), ctx(taskId)),
      async (event) => {
        if (event.type === "approval.required") {
          expect((await stop(post(`/api/tasks/${taskId}/stop`, {}), ctx(taskId))).status).toBe(204);
        }
      },
    );
    expect(events.at(-1)).toMatchObject({ type: "task.stopped", by: "user" });
    expect((await stop(post(`/api/tasks/${taskId}/stop`), ctx(taskId))).status).toBe(204);
  });

  it("resume with nothing pending is a 409", async () => {
    const { taskId } = await (await start({ url: URL_OK, goal: "Apply" })).json();
    const res = await resume(post(`/api/tasks/${taskId}/resume`, {}), ctx(taskId));
    expect(res.status).toBe(409);
    await stop(post(`/api/tasks/${taskId}/stop`, {}), ctx(taskId));
  });
});

describe("unknown tasks", () => {
  it("answer 404 task_not_found on every route", async () => {
    const id = "task_missing";
    const results = await Promise.all([
      getEvents(new Request("http://localhost/x"), ctx(id)),
      approve(post("/x", { approvalId: "a" }), ctx(id)),
      deny(post("/x", { approvalId: "a" }), ctx(id)),
      resume(post("/x", {}), ctx(id)),
      stop(post("/x", {}), ctx(id)),
    ]);
    for (const res of results) {
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("task_not_found");
    }
  });

  it("validates approve bodies", async () => {
    const res = await approve(post("/x", {}), ctx("task_x"));
    expect(res.status).toBe(400);
  });
});
