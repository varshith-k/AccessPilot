import { IMAGE_DATA_URL_PATTERN, type TaskEvent } from "@/lib/contracts";
import { announcementFor, describeStep } from "@/lib/client/announcements";
import {
  createTaskClient,
  createTaskClientFromEnvironment,
  resolveTaskClientConfig,
} from "@/lib/client/createTaskClient";
import { isTaskClientError, TaskClientError, userMessageFor } from "@/lib/client/errors";
import { HttpTaskClient } from "@/lib/client/HttpTaskClient";
import { MockTaskClient } from "@/lib/client/MockTaskClient";
import { isMockScenarioName, MOCK_SCENARIO_NAMES } from "@/lib/client/mock/scenarios";
import { mockScreenshots } from "@/lib/client/mock/screenshots";
import { realScheduler } from "@/lib/client/scheduler";
import { STOPPED_BY_USER_TEXT } from "@/lib/client/taskState";
import { makeEvent } from "./fixtures";

describe("resolveTaskClientConfig", () => {
  it("defaults to mock with the happy scenario", () => {
    expect(
      resolveTaskClientConfig({ envMode: undefined, search: "", nodeEnv: "development" }),
    ).toEqual({
      mode: "mock",
      scenario: "scholarship-happy",
      mockSpeed: 1,
    });
  });

  it("uses http when NEXT_PUBLIC_TASK_CLIENT=http", () => {
    expect(
      resolveTaskClientConfig({ envMode: "http", search: "", nodeEnv: "production" }).mode,
    ).toBe("http");
  });

  it("treats unknown modes as mock", () => {
    expect(
      resolveTaskClientConfig({ envMode: "grpc", search: "", nodeEnv: "development" }).mode,
    ).toBe("mock");
  });

  it("lets ?mock= pick a scenario outside production, even over http mode", () => {
    expect(
      resolveTaskClientConfig({ envMode: "http", search: "?mock=failure", nodeEnv: "development" }),
    ).toEqual({ mode: "mock", scenario: "failure", mockSpeed: 1 });
  });

  it("ignores ?mock= in production and for unknown scenarios", () => {
    expect(
      resolveTaskClientConfig({ envMode: "http", search: "?mock=failure", nodeEnv: "production" }),
    ).toEqual({ mode: "http", scenario: "scholarship-happy", mockSpeed: 1 });
    expect(
      resolveTaskClientConfig({ envMode: undefined, search: "?mock=nope", nodeEnv: "test" })
        .scenario,
    ).toBe("scholarship-happy");
  });
});

describe("mockSpeed", () => {
  const resolve = (search: string, nodeEnv = "development") =>
    resolveTaskClientConfig({ envMode: undefined, search, nodeEnv }).mockSpeed;

  it("reads ?mockSpeed= outside production", () => {
    expect(resolve("?mockSpeed=0.05")).toBe(0.05);
    expect(resolve("?mock=failure&mockSpeed=0")).toBe(0);
  });

  it("ignores invalid values and production", () => {
    expect(resolve("?mockSpeed=fast")).toBe(1);
    expect(resolve("?mockSpeed=-1")).toBe(1);
    expect(resolve("?mockSpeed=50")).toBe(1);
    expect(resolve("?mockSpeed=0.1", "production")).toBe(1);
  });
});

describe("createTaskClient", () => {
  it("builds the matching client", () => {
    expect(createTaskClient({ mode: "http", scenario: "failure", mockSpeed: 1 })).toBeInstanceOf(
      HttpTaskClient,
    );
    const mock = createTaskClient({ mode: "mock", scenario: "failure", mockSpeed: 1 });
    expect(mock).toBeInstanceOf(MockTaskClient);
    expect((mock as MockTaskClient).scenarioName).toBe("failure");
  });

  it("reads the environment and the page URL", () => {
    window.history.replaceState(null, "", "/?mock=password-handoff");
    const client = createTaskClientFromEnvironment();
    expect((client as MockTaskClient).scenarioName).toBe("password-handoff");
    window.history.replaceState(null, "", "/");
  });
});

describe("mock scenarios and screenshots", () => {
  it("recognizes scenario names", () => {
    expect(MOCK_SCENARIO_NAMES).toHaveLength(5);
    expect(isMockScenarioName("failure")).toBe(true);
    expect(isMockScenarioName("Failure")).toBe(false);
  });

  it.each(Object.entries(mockScreenshots))("%s is a valid inline PNG", (_name, dataUrl) => {
    expect(dataUrl).toMatch(IMAGE_DATA_URL_PATTERN);
    const bytes = Uint8Array.from(atob(dataUrl.split(",")[1] ?? ""), (c) => c.charCodeAt(0));
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.length).toBeLessThan(5000);
  });
});

describe("announcementFor", () => {
  it.each([
    ["task.started", { text: "Looking at the page.", priority: "polite", speak: true }],
    ["page.map", { text: "Scholarship. This page has a form.", priority: "polite", speak: true }],
    [
      "step.started",
      { text: "Step 1 of about 6: Filling in your name", priority: "polite", speak: false },
    ],
    ["narration", { text: "Typing your name.", priority: "polite", speak: true }],
    [
      "approval.required",
      {
        text: "Approval needed. Submit the application? Nothing happens until you choose.",
        priority: "assertive",
        speak: true,
      },
    ],
    [
      "user_input.required",
      {
        text: "Your turn. Type your password, then press Continue.",
        priority: "assertive",
        speak: true,
      },
    ],
    [
      "task.completed",
      { text: "Submitted. Confirmation number 4821.", priority: "assertive", speak: true },
    ],
    [
      "task.failed",
      { text: "Task failed. It broke. You can try again.", priority: "assertive", speak: true },
    ],
    ["task.stopped", { text: STOPPED_BY_USER_TEXT, priority: "assertive", speak: true }],
  ] as const)("announces %s", (type, expected) => {
    expect(announcementFor(makeEvent(type), null)).toEqual(expected);
  });

  it("stays silent for step.completed and screenshots", () => {
    expect(announcementFor(makeEvent("step.completed"), 6)).toBeNull();
    expect(announcementFor(makeEvent("screenshot"), 6)).toBeNull();
  });

  it("uses the assertive priority from narration", () => {
    expect(announcementFor(makeEvent("narration", { priority: "assertive" }), null)?.priority).toBe(
      "assertive",
    );
  });

  it("falls back to the known total and to no total", () => {
    const withoutTotal = makeEvent("step.started", { totalSteps: undefined });
    expect(announcementFor(withoutTotal, 4)?.text).toBe("Step 1 of about 4: Filling in your name");
    expect(announcementFor(withoutTotal, null)?.text).toBe("Step 1: Filling in your name");
    expect(describeStep(2, null, "Two")).toBe("Step 2: Two");
  });

  it.each([
    ["captcha", "Your turn: there's a CAPTCHA."],
    ["login", "Your turn: please sign in."],
    ["other", "Your turn."],
  ] as const)("prefixes %s hand-offs", (reason, prefix) => {
    const event: TaskEvent = makeEvent("user_input.required", { reason });
    expect(announcementFor(event, null)?.text.startsWith(prefix)).toBe(true);
  });

  it("words unrecoverable failures and system stops", () => {
    expect(announcementFor(makeEvent("task.failed", { recoverable: false }), null)?.text).toBe(
      "Task failed. It broke.",
    );
    expect(announcementFor(makeEvent("task.stopped", { by: "system" }), null)?.text).toBe(
      "AccessPilot stopped the task.",
    );
  });
});

describe("errors", () => {
  it("TaskClientError carries its details and defaults", () => {
    const error = new TaskClientError({ kind: "network", message: "Offline", cause: "x" });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "TaskClientError", status: null, code: null, fatal: true });
    expect(error.cause).toBe("x");
    expect(new TaskClientError({ kind: "invalid_event", message: "x" }).fatal).toBe(false);
  });

  it("userMessageFor only trusts TaskClientError messages", () => {
    expect(userMessageFor(new TaskClientError({ kind: "http", message: "Nice" }), "Fallback")).toBe(
      "Nice",
    );
    expect(userMessageFor(new Error("stack trace"), "Fallback")).toBe("Fallback");
    expect(isTaskClientError("nope")).toBe(false);
  });
});

describe("realScheduler", () => {
  it("delegates to the global timers", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const handle = realScheduler.setTimeout(callback, 50);
    realScheduler.clearTimeout(handle);
    realScheduler.setTimeout(callback, 50);
    vi.advanceTimersByTime(50);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(realScheduler.now()).toBe(Date.now());
    vi.useRealTimers();
  });
});
