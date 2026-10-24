import { normalizeTranscript, parseVoiceCommand } from "@/lib/client/voiceCommands";

const idle = { approvalOpen: false, handoffActive: false };
const approval = { approvalOpen: true, handoffActive: false };
const handoff = { approvalOpen: false, handoffActive: true };

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
      "",
    ])("never approves ambiguous input: %j", (text) => {
      const result = parseVoiceCommand(text, approval);
      expect(result.kind).not.toBe("approve");
      if (text !== "") expect(result).toEqual({ kind: "unclear_approval" });
    });

    it("ignores approval words when no dialog is open", () => {
      expect(parseVoiceCommand("yes", idle)).toEqual({ kind: "none", text: "yes" });
      expect(parseVoiceCommand("approve", handoff)).toEqual({ kind: "none", text: "approve" });
      expect(parseVoiceCommand("don't submit", idle).kind).toBe("none");
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
      expect(parseVoiceCommand("continue", idle)).toEqual({ kind: "none", text: "continue" });
      expect(parseVoiceCommand("continue", approval)).toEqual({ kind: "unclear_approval" });
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
