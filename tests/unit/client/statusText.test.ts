import { documentTitle, statusSentence } from "@/lib/client/statusText";
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
