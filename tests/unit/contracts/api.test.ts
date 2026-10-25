import {
  GOAL_MAX_LENGTH,
  apiErrorResponseSchema,
  apiPaths,
  approveRequestSchema,
  denyRequestSchema,
  emptyRequestSchema,
  isAllowedTaskUrl,
  startTaskRequestSchema,
  startTaskResponseSchema,
} from "@/lib/contracts";

describe("isAllowedTaskUrl", () => {
  it.each([
    "https://example.edu/apply",
    "https://sub.example.com:8443/path?q=1#frag",
    "http://localhost:4000/demo",
    "http://127.0.0.1:3001",
    "http://[::1]:3001/",
    "https://localhost:8443",
    "https://bücher.example",
  ])("allows %s", (url) => {
    expect(isAllowedTaskUrl(url)).toBe(true);
  });

  it.each([
    "http://example.edu",
    "http://localhost.evil.test",
    "ftp://example.edu",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "example.edu",
    "https://user:pass@example.edu",
    "",
    // Found by user testing: spaces and invisible characters that browsers silently "fix".
    "https://exa mple.com",
    "https://exa\u200bmple.com",
    "https://example.com/\u202Egpj.exe",
    "https://exa%20mple.com",
    "https://.",
    "https://example",
    "https://-bad-.com",
    "https://bad..com",
    // Round 2: percent-encoded hosts decode to a different site than the one shown.
    "https://example.org%2Eevil.com",
    "https://%65xample.org",
    // Final hunt: private and cloud-metadata addresses are refused up front.
    "https://192.168.1.10/form",
    "https://169.254.169.254/latest/meta-data/",
    "https://10.0.0.5/",
  ])("rejects %s", (url) => {
    expect(isAllowedTaskUrl(url)).toBe(false);
  });
});

describe("startTaskRequestSchema", () => {
  it("accepts and trims a valid request", () => {
    expect(
      startTaskRequestSchema.parse({
        url: "  https://example.edu/apply ",
        goal: " Complete the application ",
      }),
    ).toEqual({ url: "https://example.edu/apply", goal: "Complete the application" });
  });

  it("gives plain-language messages for each problem", () => {
    const result = startTaskRequestSchema.safeParse({ url: "", goal: "" });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => issue.message);
    expect(messages).toEqual(
      expect.arrayContaining(["Enter a website address.", "Describe what you want to get done."]),
    );
  });

  it("explains which URLs are allowed", () => {
    const result = startTaskRequestSchema.safeParse({ url: "http://example.edu", goal: "Apply" });
    expect(result.error?.issues[0]?.message).toMatch(/https:\/\/.*localhost/);
  });

  it("still allows percent-encoding in the path and query", () => {
    expect(isAllowedTaskUrl("https://example.org/a%20b?q=%2F")).toBe(true);
  });

  it("rejects goals made only of invisible characters", () => {
    const url = "https://example.edu";
    for (const goal of ["\u200b\u200b", "\u200b \u200b", "\ufeff", "\u202e"]) {
      expect(startTaskRequestSchema.safeParse({ url, goal }).success).toBe(false);
    }
    expect(startTaskRequestSchema.safeParse({ url, goal: "Apply \u200b" }).success).toBe(true);
  });

  it("enforces the goal length limit", () => {
    const url = "https://example.edu";
    expect(
      startTaskRequestSchema.safeParse({ url, goal: "a".repeat(GOAL_MAX_LENGTH) }).success,
    ).toBe(true);
    expect(
      startTaskRequestSchema.safeParse({ url, goal: "a".repeat(GOAL_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });
});

describe("response and action schemas", () => {
  it("validates the start response", () => {
    expect(startTaskResponseSchema.safeParse({ taskId: "task_1" }).success).toBe(true);
    expect(startTaskResponseSchema.safeParse({ taskId: "" }).success).toBe(false);
    expect(startTaskResponseSchema.safeParse({}).success).toBe(false);
  });

  it("validates approve and deny bodies", () => {
    expect(approveRequestSchema.safeParse({ approvalId: "appr_1" }).success).toBe(true);
    expect(approveRequestSchema.safeParse({}).success).toBe(false);
    expect(denyRequestSchema.safeParse({ approvalId: "appr_1" }).success).toBe(true);
    expect(
      denyRequestSchema.safeParse({ approvalId: "appr_1", reason: "Wrong program" }).success,
    ).toBe(true);
    expect(
      denyRequestSchema.safeParse({ approvalId: "appr_1", reason: "x".repeat(501) }).success,
    ).toBe(false);
  });

  it("accepts an empty body for resume and stop", () => {
    expect(emptyRequestSchema.safeParse({}).success).toBe(true);
  });

  it("validates the error envelope", () => {
    expect(
      apiErrorResponseSchema.safeParse({
        error: { code: "task_not_found", message: "That task no longer exists." },
      }).success,
    ).toBe(true);
    expect(apiErrorResponseSchema.safeParse({ message: "nope" }).success).toBe(false);
  });
});

describe("apiPaths", () => {
  it("builds every endpoint path", () => {
    expect(apiPaths.tasks()).toBe("/api/tasks");
    expect(apiPaths.events("t1")).toBe("/api/tasks/t1/events");
    expect(apiPaths.approve("t1")).toBe("/api/tasks/t1/approve");
    expect(apiPaths.deny("t1")).toBe("/api/tasks/t1/deny");
    expect(apiPaths.resume("t1")).toBe("/api/tasks/t1/resume");
    expect(apiPaths.stop("t1")).toBe("/api/tasks/t1/stop");
  });

  it("URL-encodes task ids", () => {
    expect(apiPaths.stop("a/b?c")).toBe("/api/tasks/a%2Fb%3Fc/stop");
  });
});

describe("startTaskRequestSchema details", () => {
  const base = { url: "https://example.com", goal: "Apply" };

  it("accepts optional, trimmed profile details", () => {
    const parsed = startTaskRequestSchema.parse({
      ...base,
      details: { name: "  Ada  ", notes: "CS" },
    });
    expect(parsed.details).toEqual({ name: "Ada", notes: "CS" });
    expect(startTaskRequestSchema.parse(base).details).toBeUndefined();
  });

  it("rejects details that are too long", () => {
    expect(
      startTaskRequestSchema.safeParse({ ...base, details: { notes: "x".repeat(1001) } }).success,
    ).toBe(false);
    expect(
      startTaskRequestSchema.safeParse({ ...base, details: { name: "x".repeat(201) } }).success,
    ).toBe(false);
  });
});
