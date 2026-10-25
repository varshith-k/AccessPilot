import { STATUS_GLANCE_MAX, documentTitle, glance, statusSentence } from "@/lib/client/statusText";
import { initialTaskState, type TaskState } from "@/lib/client/taskState";
import {
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
  stopped,
} from "./fixtures";

describe("statusSentence", () => {
  it.each<[string, () => TaskState, string | RegExp]>([
    ["idle", () => initialTaskState, /^Ready\./],
    ["starting", startingNoId, "Starting your task…"],
    ["planning", planning, "Looking at the page…"],
    ["running without a step", running, "Working…"],
    [
      "running a step",
      () => reach([makeEvent("step.started")], running()),
      "Step 1 of about 6: Filling in your name",
    ],
    ["stopping", () => reach([makeUiAction("ui/stop_requested")], running()), "Stopping…"],
    ["awaiting approval", awaitingApproval, /^Waiting for your approval\./],
    ["awaiting the user", awaitingUser, /^Your turn/],
    ["completed", completed, "Submitted. Confirmation number 4821."],
    ["completed without outcome", () => ({ ...completed(), outcome: null }), "Done."],
    ["failed", failed, "It broke."],
    ["failed without error", () => ({ ...failed(), error: null }), /problem/],
    ["stopped", stopped, /^Stopped\./],
  ])("describes %s", (_label, make, expected) => {
    const sentence = statusSentence(make());
    if (typeof expected === "string") expect(sentence).toBe(expected);
    else expect(sentence).toMatch(expected);
  });
});

describe("documentTitle", () => {
  it.each<[() => TaskState, string]>([
    [() => initialTaskState, "AccessPilot"],
    [startingNoId, "Starting — AccessPilot"],
    [planning, "Looking at the page — AccessPilot"],
    [running, "Working — AccessPilot"],
    [awaitingApproval, "Waiting for your approval — AccessPilot"],
    [awaitingUser, "Your turn — AccessPilot"],
    [completed, "Done — AccessPilot"],
    [failed, "Problem — AccessPilot"],
    [stopped, "Stopped — AccessPilot"],
  ])("titles the page", (make, title) => {
    expect(documentTitle(make())).toBe(title);
  });
});

describe("glance", () => {
  it("keeps short outcomes exactly as they are", () => {
    expect(glance("Submitted. Confirmation number 4821.")).toBe(
      "Submitted. Confirmation number 4821.",
    );
  });

  it("shortens a long answer to its first sentence and points to the full answer", () => {
    const answer =
      "You can choose bacon, extra cheese, onion, or mushroom as toppings. There are 12 form fields on the whole page. This page is an order form for a pizza, and you can set a delivery time.";
    expect(glance(answer)).toBe(
      "You can choose bacon, extra cheese, onion, or mushroom as toppings. The full answer is in the conversation below.",
    );
  });

  it("cuts a long first sentence at a word boundary", () => {
    const result = glance(`${"word ".repeat(60)}end.`);
    expect(result).toMatch(/^word( word)*… The full answer is in the conversation below\.$/);
    expect(result.length).toBeLessThan(STATUS_GLANCE_MAX + 60);
  });
});
