import { TASK_EVENT_TYPES, type TaskEventType } from "@/lib/contracts";
import {
  initialTaskState,
  isActiveStatus,
  isTerminalStatus,
  MAX_WARNINGS,
  STOPPED_BY_USER_TEXT,
  taskReducer,
  transition,
  type TaskState,
  type TaskStatus,
  type UiActionType,
} from "@/lib/client/taskState";
import {
  AT,
  awaitingApproval,
  awaitingUser,
  completed,
  failed,
  makeEvent,
  makeUiAction,
  planning,
  reach,
  running,
  startingNoId,
  startingWithId,
  stopped,
  TASK_ID,
} from "./fixtures";

type FixtureName =
  | "idle"
  | "starting (no id)"
  | "starting (with id)"
  | "planning"
  | "running"
  | "awaiting_approval"
  | "awaiting_user"
  | "completed"
  | "failed"
  | "stopped";

const fixtures: Record<FixtureName, () => TaskState> = {
  idle: () => initialTaskState,
  "starting (no id)": startingNoId,
  "starting (with id)": startingWithId,
  planning,
  running,
  awaiting_approval: awaitingApproval,
  awaiting_user: awaitingUser,
  completed,
  failed,
  stopped,
};

const FIXTURE_NAMES = Object.keys(fixtures) as FixtureName[];

/** Expected status after each event, or null when the event must be ignored. */
const EVENT_MATRIX: Record<TaskEventType, Partial<Record<FixtureName, TaskStatus>>> = {
  "task.started": { "starting (with id)": "planning" },
  "page.map": { planning: "running", running: "running" },
  "step.started": { planning: "running", running: "running" },
  "step.completed": { running: "running" },
  narration: {
    planning: "planning",
    running: "running",
    awaiting_approval: "awaiting_approval",
    awaiting_user: "awaiting_user",
  },
  screenshot: {
    planning: "planning",
    running: "running",
    awaiting_approval: "awaiting_approval",
    awaiting_user: "awaiting_user",
  },
  "approval.required": { planning: "awaiting_approval", running: "awaiting_approval" },
  "user_input.required": { planning: "awaiting_user", running: "awaiting_user" },
  "task.completed": { planning: "completed", running: "completed" },
  "task.failed": {
    "starting (with id)": "failed",
    planning: "failed",
    running: "failed",
    awaiting_approval: "failed",
    awaiting_user: "failed",
  },
  "task.stopped": {
    "starting (with id)": "stopped",
    planning: "stopped",
    running: "stopped",
    awaiting_approval: "stopped",
    awaiting_user: "stopped",
  },
};

const ALL_ACTIVE: Partial<Record<FixtureName, TaskStatus>> = {
  "starting (no id)": "starting",
  "starting (with id)": "starting",
  planning: "planning",
  running: "running",
  awaiting_approval: "awaiting_approval",
  awaiting_user: "awaiting_user",
};

const SAME_STATUS_EVERYWHERE = Object.fromEntries(
  FIXTURE_NAMES.map((name) => [name, fixtures[name]().status]),
) as Record<FixtureName, TaskStatus>;

/** Expected status after each UI action from the fixtures, or null when ignored. */
const UI_MATRIX: Record<UiActionType, Partial<Record<FixtureName, TaskStatus>>> = {
  "ui/start_requested": {
    idle: "starting",
    completed: "starting",
    failed: "starting",
    stopped: "starting",
  },
  "ui/start_succeeded": { "starting (no id)": "starting" },
  "ui/start_failed": { "starting (no id)": "failed", "starting (with id)": "failed" },
  "ui/decision_sent": { awaiting_approval: "running" },
  "ui/decision_succeeded": {},
  "ui/decision_failed": {},
  "ui/resume_sent": { awaiting_user: "running" },
  "ui/resume_succeeded": {},
  "ui/resume_failed": {},
  "ui/stop_requested": ALL_ACTIVE,
  "ui/stop_succeeded": Object.fromEntries(Object.keys(ALL_ACTIVE).map((name) => [name, "stopped"])),
  "ui/stop_failed": {},
  "ui/connection_lost": {
    "starting (with id)": "failed",
    planning: "failed",
    running: "failed",
    awaiting_approval: "failed",
    awaiting_user: "failed",
  },
  "ui/warning": SAME_STATUS_EVERYWHERE,
  "ui/warning_dismissed": {},
  "ui/user_message": SAME_STATUS_EVERYWHERE,
  "ui/reset": { idle: "idle", completed: "idle", failed: "idle", stopped: "idle" },
};

const UI_ACTION_TYPES = Object.keys(UI_MATRIX) as UiActionType[];

describe("taskReducer transition matrix", () => {
  describe.each(TASK_EVENT_TYPES)("event %s", (type) => {
    it.each(FIXTURE_NAMES)("from %s", (fixtureName) => {
      const before = fixtures[fixtureName]();
      const result = transition(before, makeEvent(type));
      const expected = EVENT_MATRIX[type][fixtureName];
      if (expected === undefined) {
        expect(result.ignored).not.toBeNull();
        expect(result.state.status).toBe(before.status);
        expect(result.state.log).toBe(before.log);
      } else {
        expect(result.ignored).toBeNull();
        expect(result.state.status).toBe(expected);
      }
    });
  });

  describe.each(UI_ACTION_TYPES)("action %s", (type) => {
    it.each(FIXTURE_NAMES)("from %s", (fixtureName) => {
      const before = fixtures[fixtureName]();
      const result = transition(before, makeUiAction(type));
      const expected = UI_MATRIX[type][fixtureName];
      if (expected === undefined) {
        expect(result.ignored).not.toBeNull();
        expect(result.state).toBe(before);
      } else {
        expect(result.ignored).toBeNull();
        expect(result.state.status).toBe(expected);
      }
    });
  });
});

describe("event gating", () => {
  it("ignores every event while idle because there is no task id", () => {
    for (const type of TASK_EVENT_TYPES) {
      const result = transition(initialTaskState, makeEvent(type));
      expect(result.state).toBe(initialTaskState);
      expect(result.ignored).toMatch(/does not match/);
    }
  });

  it("ignores events for a different task", () => {
    const state = running();
    const result = transition(state, makeEvent("narration", { taskId: "other-task" }));
    expect(result.state).toBe(state);
    expect(result.ignored).toMatch(/other-task/);
  });

  it("ignores events with a seq at or below the last one seen (reconnect replay)", () => {
    const state = running();
    const same = transition(state, makeEvent("narration", { seq: state.lastSeq }));
    const older = transition(state, makeEvent("narration", { seq: state.lastSeq - 1 }));
    expect(same.state).toBe(state);
    expect(older.state).toBe(state);
    expect(same.ignored).toMatch(/duplicate or out-of-order/);
  });

  it("records the seq of a well-formed event that does not fit the state so it is not re-applied", () => {
    const state = running();
    const event = makeEvent("task.started");
    const result = transition(state, event);
    expect(result.ignored).toMatch(/not valid while running/);
    expect(result.state.lastSeq).toBe(event.seq);
    expect(result.state.status).toBe("running");
  });

  it("dedupes a full replay of the same events", () => {
    const events = [
      makeEvent("task.started"),
      makeEvent("page.map"),
      makeEvent("step.started"),
      makeEvent("narration"),
    ];
    const once = events.reduce(taskReducer, startingWithId());
    const twice = events.reduce(taskReducer, once);
    expect(twice).toBe(once);
    expect(once.log.filter((entry) => entry.speaker === "assistant")).toHaveLength(2);
  });
});

describe("event effects", () => {
  it("task.started records the request and moves to planning", () => {
    const state = planning();
    expect(state.request).toEqual({ url: "https://example.edu/apply", goal: "Apply" });
  });

  it("page.map stores the map and logs its summary", () => {
    const state = running();
    expect(state.pageMap?.title).toBe("Scholarship");
    expect(state.log.at(-1)).toMatchObject({ speaker: "assistant", text: "This page has a form." });
  });

  it("step.started adds an active step and tracks totals; step.completed marks it done", () => {
    let state = reach([makeEvent("step.started")], running());
    expect(state.currentStep).toBe(1);
    expect(state.totalSteps).toBe(6);
    expect(state.steps).toEqual([
      { step: 1, description: "Filling in your name", status: "active", action: null },
    ]);

    state = reach([makeEvent("step.completed")], state);
    expect(state.steps[0]).toMatchObject({
      status: "completed",
      description: "Filled in your name",
      action: { type: "type", label: "Full name" },
    });
  });

  it("keeps the previous total when a step omits totalSteps, and keeps steps sorted", () => {
    const state = reach(
      [
        makeEvent("step.started", { step: 2, description: "Two" }),
        makeEvent("step.started", { step: 1, description: "One", totalSteps: undefined }),
      ],
      running(),
    );
    expect(state.totalSteps).toBe(6);
    expect(state.steps.map((s) => s.step)).toEqual([1, 2]);
    expect(state.currentStep).toBe(1);
  });

  it("step.completed for an unseen step adds it as completed", () => {
    const state = reach([makeEvent("step.completed", { step: 4 })], running());
    expect(state.steps).toEqual([expect.objectContaining({ step: 4, status: "completed" })]);
  });

  it("narration logs text, remembers it for repeat, and marks assertive narration as a warning", () => {
    let state = reach([makeEvent("narration")], running());
    expect(state.lastNarration).toBe("Typing your name.");
    expect(state.log.at(-1)?.tone).toBe("info");
    state = reach([makeEvent("narration", { text: "Careful!", priority: "assertive" })], state);
    expect(state.log.at(-1)).toMatchObject({ text: "Careful!", tone: "warning" });
  });

  it("screenshot is appended to history", () => {
    const state = reach(
      [makeEvent("screenshot"), makeEvent("screenshot", { step: 2, alt: "Second" })],
      running(),
    );
    expect(state.screenshots.map((s) => s.alt)).toEqual(["Name filled in", "Second"]);
    expect(new Set(state.screenshots.map((s) => s.id)).size).toBe(2);
  });

  it("approval.required stores the approval and logs it", () => {
    const state = awaitingApproval();
    expect(state.approval?.approvalId).toBe("approval-1");
    expect(state.log.at(-1)?.text).toBe("Waiting for your approval: Submit the application?");
  });

  it("user_input.required stores the hand-off", () => {
    const state = awaitingUser();
    expect(state.handoff).toEqual({
      reason: "sensitive_value",
      instructions: "Type your password, then press Continue.",
    });
  });

  it("task.completed stores the outcome and closes unfinished steps", () => {
    const state = reach([makeEvent("step.started"), makeEvent("task.completed")], running());
    expect(state.outcome).toBe("Submitted. Confirmation number 4821.");
    expect(state.steps[0]?.status).toBe("incomplete");
    expect(state.log.at(-1)?.tone).toBe("success");
  });

  it("task.failed stores the error and clears pending approval", () => {
    const state = reach([makeEvent("task.failed")], awaitingApproval());
    expect(state.error).toEqual({ code: "boom", message: "It broke.", recoverable: true });
    expect(state.approval).toBeNull();
    expect(state.log.at(-1)).toMatchObject({ speaker: "system", tone: "error" });
  });

  it("task.stopped records who stopped it and clears the hand-off", () => {
    const byUser = reach([makeEvent("task.stopped")], awaitingUser());
    expect(byUser.stoppedBy).toBe("user");
    expect(byUser.handoff).toBeNull();
    expect(byUser.log.at(-1)?.text).toBe(STOPPED_BY_USER_TEXT);

    const bySystem = reach([makeEvent("task.stopped", { by: "system" })], running());
    expect(bySystem.stoppedBy).toBe("system");
    expect(bySystem.log.at(-1)?.text).toBe("AccessPilot stopped the task.");
  });
});

describe("UI action effects", () => {
  it("start_requested resets task data but keeps the conversation log", () => {
    const previous = completed();
    const state = reach([makeUiAction("ui/start_requested")], previous);
    expect(state.taskId).toBeNull();
    expect(state.steps).toEqual([]);
    expect(state.outcome).toBeNull();
    expect(state.lastSeq).toBe(-1);
    expect(state.log.slice(0, previous.log.length)).toEqual(previous.log);
    expect(state.log.at(-1)).toMatchObject({ speaker: "user", text: "Apply" });
  });

  it("start_failed records a recoverable error", () => {
    const state = reach([makeUiAction("ui/start_failed")], startingNoId());
    expect(state.error).toEqual({
      code: "start_failed",
      message: "Something failed.",
      recoverable: true,
    });
  });

  describe("approval decisions", () => {
    it("decision_sent moves on optimistically and remembers the approval", () => {
      const state = reach([makeUiAction("ui/decision_sent")], awaitingApproval());
      expect(state.approval).toBeNull();
      expect(state.pendingDecision?.decision).toBe("approve");
      expect(state.log.at(-1)).toMatchObject({
        speaker: "user",
        text: "Approved: Submit application",
      });
    });

    it("logs a deny decision as declined", () => {
      const state = reach(
        [{ type: "ui/decision_sent", decision: "deny", at: AT }],
        awaitingApproval(),
      );
      expect(state.log.at(-1)?.text).toBe("Declined: Submit application");
    });

    it("ignores a second decision while one is in flight", () => {
      const state = reach([makeUiAction("ui/decision_sent")], awaitingApproval());
      const forced = {
        ...state,
        status: "awaiting_approval" as const,
        approval: state.pendingDecision!.approval,
      };
      expect(transition(forced, makeUiAction("ui/decision_sent")).ignored).not.toBeNull();
    });

    it("decision_succeeded clears the pending decision", () => {
      const state = reach(
        [makeUiAction("ui/decision_sent"), makeUiAction("ui/decision_succeeded")],
        awaitingApproval(),
      );
      expect(state.pendingDecision).toBeNull();
      expect(state.status).toBe("running");
    });

    it("decision_failed restores the dialog with the same approval", () => {
      const before = awaitingApproval();
      const state = reach(
        [makeUiAction("ui/decision_sent"), makeUiAction("ui/decision_failed")],
        before,
      );
      expect(state.status).toBe("awaiting_approval");
      expect(state.approval).toEqual(before.approval);
      expect(state.log.at(-1)).toMatchObject({ speaker: "system", tone: "error" });
    });

    it("any accepted event clears the pending decision so a late failure cannot reopen the dialog", () => {
      const state = reach(
        [makeUiAction("ui/decision_sent"), makeEvent("narration")],
        awaitingApproval(),
      );
      expect(state.pendingDecision).toBeNull();
      expect(transition(state, makeUiAction("ui/decision_failed")).ignored).not.toBeNull();
    });

    it("decision_failed after the task ended does nothing", () => {
      const sent = reach([makeUiAction("ui/decision_sent")], awaitingApproval());
      const ended = { ...sent, status: "stopped" as const };
      expect(transition(ended, makeUiAction("ui/decision_failed")).ignored).not.toBeNull();
    });
  });

  describe("hand-off resume", () => {
    it("resume_sent and resume_succeeded", () => {
      const sent = reach([makeUiAction("ui/resume_sent")], awaitingUser());
      expect(sent.handoff).toBeNull();
      expect(sent.pendingResume).not.toBeNull();
      expect(sent.log.at(-1)).toMatchObject({ speaker: "user", text: "Continue" });
      const done = reach([makeUiAction("ui/resume_succeeded")], sent);
      expect(done.pendingResume).toBeNull();
    });

    it("resume_failed restores the hand-off", () => {
      const before = awaitingUser();
      const state = reach(
        [makeUiAction("ui/resume_sent"), makeUiAction("ui/resume_failed")],
        before,
      );
      expect(state.status).toBe("awaiting_user");
      expect(state.handoff).toEqual(before.handoff);
    });

    it("resume_failed is ignored once the server has moved on", () => {
      const state = reach([makeUiAction("ui/resume_sent"), makeEvent("narration")], awaitingUser());
      expect(transition(state, makeUiAction("ui/resume_failed")).ignored).not.toBeNull();
      const ended = {
        ...reach([makeUiAction("ui/resume_sent")], awaitingUser()),
        status: "failed" as const,
      };
      expect(transition(ended, makeUiAction("ui/resume_failed")).ignored).not.toBeNull();
    });
  });

  describe("stop", () => {
    it("stop_requested sets stopping and a second request is ignored", () => {
      const state = reach([makeUiAction("ui/stop_requested")], running());
      expect(state.stopping).toBe(true);
      expect(transition(state, makeUiAction("ui/stop_requested")).ignored).not.toBeNull();
    });

    it("stop_succeeded ends the task immediately and clears pending prompts", () => {
      const state = reach(
        [makeUiAction("ui/stop_requested"), makeUiAction("ui/stop_succeeded")],
        awaitingApproval(),
      );
      expect(state.status).toBe("stopped");
      expect(state.stoppedBy).toBe("user");
      expect(state.stopping).toBe(false);
      expect(state.approval).toBeNull();
      expect(state.log.at(-1)?.text).toBe(STOPPED_BY_USER_TEXT);
    });

    it("a task.stopped event arriving after a local stop is ignored, not logged twice", () => {
      const state = reach([makeUiAction("ui/stop_succeeded")], running());
      const result = transition(state, makeEvent("task.stopped"));
      expect(result.ignored).not.toBeNull();
      expect(result.state.log).toBe(state.log);
    });

    it("stop_failed still stops the UI and explains the server may not have stopped", () => {
      const state = reach(
        [makeUiAction("ui/stop_requested"), makeUiAction("ui/stop_failed")],
        awaitingApproval(),
      );
      expect(state.stopping).toBe(false);
      expect(state.status).toBe("stopped");
      expect(state.approval).toBeNull();
      expect(state.log.at(-1)).toMatchObject({ text: "Something failed.", tone: "warning" });
    });
  });

  it("connection_lost fails the task with a recoverable error", () => {
    const state = reach([makeUiAction("ui/connection_lost")], running());
    expect(state.error).toEqual({
      code: "connection_lost",
      message: "Something failed.",
      recoverable: true,
    });
  });

  describe("warnings", () => {
    it("adds warnings with unique ids and keeps only the most recent few", () => {
      let state = running();
      for (let i = 0; i < MAX_WARNINGS + 2; i++) {
        state = reach([{ type: "ui/warning", message: `w${i}` }], state);
      }
      expect(state.warnings).toHaveLength(MAX_WARNINGS);
      expect(state.warnings.at(-1)?.message).toBe(`w${MAX_WARNINGS + 1}`);
      expect(new Set(state.warnings.map((w) => w.id)).size).toBe(MAX_WARNINGS);
    });

    it("dismisses a warning by id", () => {
      const state = reach([makeUiAction("ui/warning")], running());
      const id = state.warnings[0]!.id;
      const dismissed = reach([{ type: "ui/warning_dismissed", id }], state);
      expect(dismissed.warnings).toEqual([]);
    });
  });

  it("user_message logs the text from the user", () => {
    const state = reach([makeUiAction("ui/user_message")], running());
    expect(state.log.at(-1)).toMatchObject({ speaker: "user", text: "Also check the deadline" });
  });

  it("reset returns to idle and keeps the conversation", () => {
    const previous = failed();
    const state = reach([makeUiAction("ui/reset")], previous);
    expect(state.status).toBe("idle");
    expect(state.error).toBeNull();
    expect(state.log).toEqual(previous.log);
  });

  it("log ids stay unique across events and UI actions", () => {
    const state = reach(
      [
        makeUiAction("ui/user_message"),
        makeEvent("narration"),
        makeUiAction("ui/user_message"),
        makeEvent("narration"),
      ],
      running(),
    );
    expect(new Set(state.log.map((entry) => entry.id)).size).toBe(state.log.length);
  });
});

describe("status helpers", () => {
  it.each([
    ["idle", false, false],
    ["starting", true, false],
    ["planning", true, false],
    ["running", true, false],
    ["awaiting_approval", true, false],
    ["awaiting_user", true, false],
    ["completed", false, true],
    ["failed", false, true],
    ["stopped", false, true],
  ] as const)("%s active=%s terminal=%s", (status, active, terminal) => {
    expect(isActiveStatus(status)).toBe(active);
    expect(isTerminalStatus(status)).toBe(terminal);
  });
});

describe("taskReducer logging", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    vi.unstubAllEnvs();
    expect(process.env.NODE_ENV).toBe(originalEnv);
  });

  it("logs ignored inputs in development only", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    taskReducer(initialTaskState, makeEvent("narration"));
    expect(debug).not.toHaveBeenCalled();

    vi.stubEnv("NODE_ENV", "development");
    const state = taskReducer(initialTaskState, makeEvent("narration"));
    expect(state).toBe(initialTaskState);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("ignored narration"));
  });

  it("returns the next state for applied inputs", () => {
    const state = taskReducer(startingNoId(), { type: "ui/start_succeeded", taskId: TASK_ID });
    expect(state.taskId).toBe(TASK_ID);
  });
});
