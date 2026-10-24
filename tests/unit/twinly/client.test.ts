import {
  backoffDelay,
  createTwinlyClientFromEnv,
  parseRetryAfter,
  TWINLY_DEFAULT_BASE_URL,
  TwinlyClient,
  TwinlyError,
  type TwinlyClientOptions,
} from "@/lib/twinly/client";

const KEY = "twk_live_" + "a".repeat(43);
const SCREENSHOT = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const viewport = { width: 1280, height: 800 };

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function twinlyError(status: number, code: string, headers: Record<string, string> = {}) {
  return jsonResponse(
    status,
    { error: { message: `${code} happened`, type: "api_error", code, param: null } },
    headers,
  );
}

function actionResponse(action: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return jsonResponse(200, {
    object: "computer.action",
    model: "twinly-core",
    coordinates: "0-1000",
    action: { reason: "The unlabeled button applies the filter.", commits: false, ...action },
    usage: { prompt_tokens: 900 },
    ...extra,
  });
}

function makeClient(
  fetchMock: ReturnType<typeof vi.fn>,
  options: Partial<TwinlyClientOptions> = {},
) {
  return new TwinlyClient({
    apiKey: KEY,
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    ...options,
  });
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

const input = { goal: "Click Apply", screenshot: SCREENSHOT, viewport };

beforeEach(() => {
  vi.useFakeTimers();
  // The client is server-only; hide jsdom's window so it can be constructed.
  vi.stubGlobal("window", undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TwinlyClient construction", () => {
  it("rejects malformed keys", () => {
    expect(() => new TwinlyClient({ apiKey: "sk-123" })).toThrow(/malformed/);
  });

  it("refuses to run in a browser", () => {
    vi.stubGlobal("window", {});
    expect(() => new TwinlyClient({ apiKey: KEY })).toThrow(/server-only/);
  });

  it("builds from env", async () => {
    expect(() => createTwinlyClientFromEnv({})).toThrow(/TWINLY_API_KEY/);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { key: { scopes: ["computer"] } }));
    const client = createTwinlyClientFromEnv(
      { TWINLY_API_KEY: KEY, TWINLY_BASE_URL: "https://twinly.test/v1/" },
      { fetch: fetchMock as unknown as typeof globalThis.fetch },
    );
    await expect(client.me()).resolves.toMatchObject({ key: { scopes: ["computer"] } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://twinly.test/v1/me");
  });
});

describe("nextAction", () => {
  it("sends the goal and screenshot and returns a pixel-space action", async () => {
    const fetchMock = vi.fn().mockResolvedValue(actionResponse({ type: "click", x: 500, y: 250 }));
    const result = await makeClient(fetchMock).nextAction(input);

    const { url, init, body } = requestOf(fetchMock);
    expect(url).toBe(`${TWINLY_DEFAULT_BASE_URL}/computer/next-action`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    });
    expect(body).toEqual({ goal: "Click Apply", screenshot: SCREENSHOT });

    expect(result.action).toMatchObject({
      type: "click",
      point: { x: 640, y: 200 },
      requiresApproval: false,
      reason: "The unlabeled button applies the filter.",
    });
    expect(result).toMatchObject({
      model: "twinly-core",
      usage: { prompt_tokens: 900 },
      attempts: 1,
    });
  });

  it("sends history, the previous screen and elements on the grid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(actionResponse({ type: "done", text: "Applied" }));
    const steps = Array.from({ length: 25 }, (_, i) => ({
      type: "wait" as const,
      seconds: 1,
      reason: `step ${i}`,
      commits: false,
    }));
    await makeClient(fetchMock).nextAction({
      ...input,
      goal: "  Click Apply  ",
      previousScreenshot: "iVBORw0KGgo=",
      steps,
      elements: [{ id: "btn-1", role: "button", label: "", x: 640, y: 400 }],
    });

    const { body } = requestOf(fetchMock);
    expect(body.goal).toBe("Click Apply");
    expect(body.previous_screenshot).toBe("iVBORw0KGgo=");
    expect(body.steps).toHaveLength(20);
    expect((body.steps as { reason: string }[])[0]?.reason).toBe("step 5");
    expect(body.elements).toEqual([{ id: "btn-1", role: "button", label: "", x: 500, y: 500 }]);
  });

  it("surfaces blocked sensitive values", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(actionResponse({ type: "fail" }, { blocked: "sensitive_value" }));
    const { action } = await makeClient(fetchMock).nextAction(input);
    expect(action).toMatchObject({ type: "fail", blocked: "sensitive_value" });
  });

  it.each([
    [{ ...input, goal: "   " }, /empty/],
    [{ ...input, goal: "x".repeat(2001) }, /2000/],
    [{ ...input, screenshot: "https://example.com/a.png" }, /base64/],
    [{ ...input, screenshot: "data:image/svg+xml;base64,AAAA" }, /base64/],
    [{ ...input, previousScreenshot: "not base64!" }, /previousScreenshot/],
    [{ ...input, screenshot: "A".repeat(6 * 1024 * 1024) }, /4 MB/],
    [{ ...input, elements: Array.from({ length: 301 }, () => ({ x: 1, y: 1 })) }, /300/],
  ])("rejects bad input before sending (%#)", async (bad, message) => {
    const fetchMock = vi.fn();
    const error = await makeClient(fetchMock)
      .nextAction(bad)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TwinlyError);
    expect(error).toMatchObject({
      kind: "invalid_request",
      message: expect.stringMatching(message),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request over the 6 MB body limit", async () => {
    const big = "A".repeat(3.5 * 1024 * 1024);
    const fetchMock = vi.fn();
    await expect(
      makeClient(fetchMock).nextAction({ ...input, screenshot: big, previousScreenshot: big }),
    ).rejects.toThrow(/6 MB/);
  });

  it("reports malformed responses and actions as invalid_response", async () => {
    const shape = vi.fn().mockResolvedValue(jsonResponse(200, { object: "computer.action" }));
    await expect(makeClient(shape).nextAction(input)).rejects.toMatchObject({
      kind: "invalid_response",
    });

    const missingPoint = vi.fn().mockResolvedValue(actionResponse({ type: "click" }));
    await expect(makeClient(missingPoint).nextAction(input)).rejects.toMatchObject({
      kind: "invalid_response",
      message: expect.stringMatching(/without x and y/),
    });

    const notJson = vi.fn().mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(makeClient(notJson).nextAction(input)).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});

describe("errors and retries", () => {
  it("does not retry client errors and keeps Twinly's code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(twinlyError(403, "scope_missing"));
    await expect(makeClient(fetchMock).nextAction(input)).rejects.toMatchObject({
      kind: "http",
      status: 403,
      code: "scope_missing",
      type: "api_error",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never puts the API key in error messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(twinlyError(401, "invalid_api_key"));
    const error = (await makeClient(fetchMock)
      .nextAction(input)
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain(KEY);
  });

  it("waits out Retry-After on 429 and then succeeds", async () => {
    const onRetry = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(twinlyError(429, "rate_limited", { "Retry-After": "2" }))
      .mockResolvedValueOnce(actionResponse({ type: "key", keys: "tab" }));
    const pending = makeClient(fetchMock, { onRetry }).nextAction(input);

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.latencyMs).toBe(2000);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, delayMs: 2000, error: expect.any(TwinlyError) }),
    );
  });

  it("backs off exponentially on 502 and 503 and gives up after maxRetries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(twinlyError(502, "upstream_timeout"))
      .mockResolvedValueOnce(twinlyError(503, "engine_busy"))
      .mockResolvedValueOnce(twinlyError(502, "invalid_model_output"));
    const onRetry = vi.fn();
    const pending = makeClient(fetchMock, { maxRetries: 2, onRetry })
      .nextAction(input)
      .catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    expect(await pending).toMatchObject({ status: 502, code: "invalid_model_output" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map(([info]) => (info as { delayMs: number }).delayMs)).toEqual([
      1000, 2000,
    ]);
  });

  it("never retries billing or unverified codes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(twinlyError(503, "billing_unverified"));
    await expect(makeClient(fetchMock).nextAction(input)).rejects.toMatchObject({
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not wait out a Retry-After longer than the cap", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(twinlyError(429, "fair_share_exceeded", { "Retry-After": "120" }));
    await expect(makeClient(fetchMock).nextAction(input)).rejects.toMatchObject({
      code: "fair_share_exceeded",
      retryAfterMs: 120_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles error bodies that are not Twinly's shape", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Bad gateway", { status: 400, statusText: "Bad Request" }));
    await expect(makeClient(fetchMock).nextAction(input)).rejects.toMatchObject({
      status: 400,
      code: null,
      message: "Twinly returned 400: Bad Request",
    });
  });

  it("retries network failures", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(actionResponse({ type: "wait", seconds: 1 }));
    const pending = makeClient(fetchMock).nextAction(input);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
  });

  it("times out slow requests and retries them", async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    const pending = makeClient(fetchMock, { timeoutMs: 5000, maxRetries: 1 })
      .nextAction(input)
      .catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ kind: "timeout", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops when the caller aborts, during a request or a backoff", async () => {
    const already = new AbortController();
    already.abort();
    await expect(
      makeClient(vi.fn()).nextAction({ ...input, signal: already.signal }),
    ).rejects.toMatchObject({ kind: "aborted" });

    const during = new AbortController();
    const hanging = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    const p1 = makeClient(hanging).nextAction({ ...input, signal: during.signal });
    during.abort();
    await expect(p1).rejects.toMatchObject({ kind: "aborted" });

    const backoff = new AbortController();
    const failing = vi.fn().mockResolvedValue(twinlyError(503, "engine_busy"));
    const p2 = makeClient(failing).nextAction({ ...input, signal: backoff.signal });
    await vi.advanceTimersByTimeAsync(10);
    backoff.abort();
    await expect(p2).rejects.toMatchObject({ kind: "aborted" });
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe("me", () => {
  it("sends a GET without a body content type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { can: { cloud: ["computer"] } }));
    await expect(makeClient(fetchMock).me()).resolves.toMatchObject({
      can: { cloud: ["computer"] },
    });
    const { init } = { init: fetchMock.mock.calls[0]?.[1] as RequestInit };
    expect(init.method).toBe("GET");
    expect(init.headers).not.toHaveProperty("Content-Type");
  });

  it("rejects a malformed /me body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { key: "nope" }));
    await expect(makeClient(fetchMock).me()).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("helpers", () => {
  it("computes backoff", () => {
    expect([1, 2, 3, 4, 5].map((n) => backoffDelay(n, 1000, 8000))).toEqual([
      1000, 2000, 4000, 8000, 8000,
    ]);
  });

  it("parses Retry-After seconds and dates", () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    expect(parseRetryAfter("3", now)).toBe(3000);
    expect(parseRetryAfter("Sat, 24 Oct 2026 12:00:05 GMT", now)).toBe(5000);
    expect(parseRetryAfter("Sat, 24 Oct 2026 11:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("soon", now)).toBeNull();
  });
});
