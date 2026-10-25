import { normalizeTranscript, parseVoiceCommand } from "@/lib/client/voiceCommands";

const idle = { approvalOpen: false, handoffActive: false };
const approval = { approvalOpen: true, handoffActive: false };
const handoff = { approvalOpen: false, handoffActive: true };
const running = { approvalOpen: false, handoffActive: false, taskActive: true };
const nothingRunning = { approvalOpen: false, handoffActive: false, taskActive: false };

describe("normalizeTranscript", () => {
  it("lowercases, straightens apostrophes, and drops punctuation", () => {
    expect(normalizeTranscript("  Don’t   SUBMIT!! ")).toBe("don't submit");
    expect(normalizeTranscript("What's on this page?")).toBe("what's on this page");
  });
});

describe("parseVoiceCommand", () => {
  describe('"stop" always wins', () => {
    it.each([
      ["stop", idle],
      ["Stop!", approval],
      ["please stop now", handoff],
      ["yes stop", approval],
      ["approve no wait stop", approval],
      ["stop it", idle],
    ] as const)("%s", (text, context) => {
      expect(parseVoiceCommand(text, context)).toEqual({ kind: "stop" });
    });

    it("stops a running task even when stop is mid-sentence", () => {
      expect(parseVoiceCommand("help me stop my subscription", running)).toEqual({
        kind: "stop",
      });
      expect(parseVoiceCommand("wait stop that", running)).toEqual({ kind: "stop" });
    });

    it.each(["stop", "Stop!", "stop it", "please stop", "okay stop now", "stop the task"])(
      "with nothing running, the whole phrase %s still means stop",
      (text) => {
        expect(parseVoiceCommand(text, nothingRunning)).toEqual({ kind: "stop" });
      },
    );

    it.each(["help me stop my subscription", "find the bus stop", "Stop my newsletter emails"])(
      "with nothing running, %s is a goal, not a command",
      (text) => {
        expect(parseVoiceCommand(text, nothingRunning)).toEqual({ kind: "none", text });
      },
    );

    it("does not match words that merely contain stop", () => {
      expect(parseVoiceCommand("unstoppable", idle).kind).toBe("none");
      expect(parseVoiceCommand("bus stops nearby", idle).kind).toBe("none");
    });
  });

  describe("approval words", () => {
    it.each([
      "yes",
      "Yes.",
      "approve",
      "Approve and submit",
      "submit it",
      "yes submit it",
      "yes please",
      "okay approve",
      "go ahead and submit",
      // Clear intents found by user testing that used to re-ask.
      "yeah sure",
      "sure",
      "go ahead",
      "I approve this",
      "approved approved",
      "yes yes",
      "yep yep",
      "uh yes",
      "um approve",
    ])("approves on %s while the dialog is open", (text) => {
      expect(parseVoiceCommand(text, approval)).toEqual({ kind: "approve" });
    });

    it.each([
      "no",
      "cancel",
      "don't submit",
      "Do not submit.",
      "dont submit it",
      "no thank you",
      "no, don't submit",
      "please don't",
      "cancel that",
      "nah",
      "uh no",
    ])("denies on %s while the dialog is open", (text) => {
      expect(parseVoiceCommand(text, approval)).toEqual({ kind: "deny" });
    });

    it.each([
      "yes but don't submit",
      "yes no",
      "maybe",
      "submit what",
      "I think so",
      "approve the other one",
      "yes I want to change the program",
      "approve... no wait",
      "no yes",
      "yes no",
      "sure, but not yet",
      "go ahead and change it",
      "okay",
      "uh",
      "",
    ])("never approves ambiguous input: %j", (text) => {
      const result = parseVoiceCommand(text, approval);
      expect(result.kind).not.toBe("approve");
      if (text !== "") expect(result).toEqual({ kind: "unclear_approval" });
    });

    it("explains approval words when no dialog is open instead of treating them as dictation", () => {
      expect(parseVoiceCommand("yes", idle)).toEqual({ kind: "no_approval_pending" });
      expect(parseVoiceCommand("approve", handoff)).toEqual({ kind: "no_approval_pending" });
      expect(parseVoiceCommand("don't submit", idle)).toEqual({ kind: "no_approval_pending" });
    });
  });

  describe("other commands", () => {
    it.each([
      ["repeat", idle],
      ["Say that again", approval],
      ["repeat that please", handoff],
    ] as const)("repeat: %s", (text, context) => {
      expect(parseVoiceCommand(text, context)).toEqual({ kind: "repeat" });
    });

    it.each([
      ["What's on this page?", idle],
      ["what is on the page", approval],
      ["describe the page", handoff],
    ] as const)("describe page: %s", (text, context) => {
      expect(parseVoiceCommand(text, context)).toEqual({ kind: "describe_page" });
    });

    it("continue works only during a hand-off", () => {
      expect(parseVoiceCommand("Continue", handoff)).toEqual({ kind: "continue" });
      expect(parseVoiceCommand("I'm done", handoff)).toEqual({ kind: "continue" });
      expect(parseVoiceCommand("continue", idle)).toEqual({ kind: "nothing_to_continue" });
      expect(parseVoiceCommand("continue", approval)).toEqual({ kind: "unclear_approval" });
    });

    it("start task and clear goal", () => {
      expect(parseVoiceCommand("Start task", idle)).toEqual({ kind: "start_task" });
      expect(parseVoiceCommand("start the task please", idle)).toEqual({ kind: "start_task" });
      expect(parseVoiceCommand("start", approval)).toEqual({ kind: "unclear_approval" });
      expect(parseVoiceCommand("clear the goal", idle)).toEqual({ kind: "clear_goal" });
    });
  });

  it("returns other words as dictation, trimmed but otherwise unchanged", () => {
    expect(parseVoiceCommand("  Help me complete this scholarship application. ", idle)).toEqual({
      kind: "none",
      text: "Help me complete this scholarship application.",
    });
  });

  it("treats empty input as nothing", () => {
    expect(parseVoiceCommand("   ", idle)).toEqual({ kind: "none", text: "" });
  });
});
