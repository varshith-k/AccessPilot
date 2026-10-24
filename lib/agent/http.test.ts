import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentError } from "./errors";
import { createEventStream, errorResponse, readJson, readLastEventId } from "./http";
import { TaskService } from "./service";
import { makeDeps } from "./testkit";
import { act, click } from "./testkit";

afterEach(() => vi.useRealTimers());

describe("errorResponse", () => {
  it("shapes AgentErrors as the contract describes", async () => {
    const res = errorResponse(new AgentError("task_not_found", "No such task."));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "task_not_found", message: "No such task." },
    });
  });

  it("turns validation failures into 400 with the first friendly message", async () => {
    const result = z
      .object({ goal: z.string().min(1, { message: "Describe what you want to get done." }) })
      .safeParse({ goal: "" });
    const res = errorResponse(result.error);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "invalid_request", message: "Describe what you want to get done." },
    });
  });

  it("hides the details of unexpected errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorResponse(new Error("db password is hunter2"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
    spy.mockRestore();
  });
});

describe("readJson / readLastEventId", () => {
  const post = (body: string) => new Request("http://x/api", { method: "POST", body });

  it("treats an empty body as {} and rejects bad JSON", async () => {
    await expect(readJson(post(""), z.object({}))).resolves.toEqual({});
    await expect(readJson(post("{nope"), z.object({}))).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("reads lastEventId from the query or header, ignoring junk", () => {
    expect(readLastEventId(new Request("http://x/e?lastEventId=7"))).toBe(7);
    expect(readLastEventId(new Request("http://x/e", { headers: { "Last-Event-ID": "4" } }))).toBe(
      4,
    );
    expect(readLastEventId(new Request("http://x/e?lastEventId=-3"))).toBe(0);
    expect(readLastEventId(new Request("http://x/e?lastEventId=abc"))).toBe(0);
    expect(readLastEventId(new Request("http://x/e"))).toBe(0);
  });
});

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += decoder.decode(value);
  }
}

describe("createEventStream", () => {
  it("frames events as id + one data line, with no event name, and closes after the terminal event", async () => {
    const service = new TaskService({ getDeps: () => makeDeps([]).deps });
    const { taskId } = service.start({ url: "http://localhost:4000/s", goal: "g" });
    const text = await drain(createEventStream(service, taskId, 0, new AbortController().signal));
    const messages = text.trim().split("\n\n");
    expect(messages.length).toBeGreaterThan(2);
    for (const [i, message] of messages.entries()) {
      const lines = message.split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^id: \d+$/);
      expect(lines[1]).toMatch(/^data: \{.*\}$/);
      expect(message).not.toContain("event:");
      expect(JSON.parse(lines[1]!.slice(6)).seq).toBe(Number(lines[0]!.slice(4)));
      if (i === 0) expect(JSON.parse(lines[1]!.slice(6)).type).toBe("task.started");
    }
    expect(JSON.parse(messages.at(-1)!.split("\n")[1]!.slice(6)).type).toBe("task.completed");
  });

  it("resumes after lastEventId without repeating earlier events", async () => {
    const service = new TaskService({ getDeps: () => makeDeps([]).deps });
    const { taskId } = service.start({ url: "http://localhost:4000/s", goal: "g" });
    await drain(createEventStream(service, taskId, 0, new AbortController().signal));
    const text = await drain(createEventStream(service, taskId, 2, new AbortController().signal));
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThan(0);
    expect(Math.min(...ids)).toBe(3);
  });

  it("sends a keep-alive comment while the task is idle, then stops cleanly", async () => {
    vi.useFakeTimers();
    const service = new TaskService({
      getDeps: () => makeDeps([act(click("s", 1, 1, "Submit", true))]).deps,
    });
    const { taskId } = service.start({ url: "http://localhost:4000/s", goal: "g" });
    const abort = new AbortController();
    const stream = createEventStream(service, taskId, 0, abort.signal, 15_000);
    const reader = stream.getReader();
    await vi.advanceTimersByTimeAsync(31_000);
    let text = "";
    for (let i = 0; i < 20; i++) {
      const next = await Promise.race([reader.read(), Promise.resolve("pending" as const)]);
      if (next === "pending" || next.done) break;
      text += new TextDecoder().decode(next.value);
    }
    expect(text).toContain(": keep-alive");
    abort.abort();
    service.stop(taskId);
  });
});
