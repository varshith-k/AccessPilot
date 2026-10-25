export type VoiceCommand =
  | { kind: "stop" }
  | { kind: "approve" }
  | { kind: "deny" }
  /** The approval dialog is open but the words were not a clear yes or no: ask again. */
  | { kind: "unclear_approval" }
  | { kind: "repeat" }
  | { kind: "describe_page" }
  | { kind: "continue" }
  | { kind: "start_task" }
  | { kind: "clear_goal" }
  | { kind: "new_task" }
  /** An approve or deny phrase when nothing is waiting for approval. */
  | { kind: "no_approval_pending" }
  /** A continue phrase when nothing is waiting for the user. */
  | { kind: "nothing_to_continue" }
  /** Not a command; treat the words as dictation. */
  | { kind: "none"; text: string };

export interface VoiceCommandContext {
  approvalOpen: boolean;
  handoffActive: boolean;
}

/** Lowercase, straighten apostrophes, drop punctuation, and collapse whitespace. */
export function normalizeTranscript(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/[^a-z0-9' ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      // "yes yes" and "approved approved" mean the same as saying it once.
      .replace(/\b(\w[\w']*)(?: \1\b)+/g, "$1")
  );
}

/**
 * Whole utterances that approve. Approval needs one of these exactly, so a phrase that merely
 * contains "yes" or "submit" ("yes but don't submit", "submit what?") can never approve.
 */
const APPROVE_PHRASES = new Set([
  "yes",
  "yeah",
  "yep",
  "approve",
  "approved",
  "i approve",
  "approve it",
  "approve and submit",
  "yes approve",
  "yes approve it",
  "submit",
  "submit it",
  "yes submit",
  "yes submit it",
  "yes please submit",
  "yes please submit it",
  "please submit",
  "please submit it",
  "go ahead and submit",
  "go ahead and submit it",
  "go ahead",
  "sure",
  "yes sure",
  "yeah sure",
  "i approve this",
  "i approve it",
  "approve this",
]);

const DENY_PHRASES = new Set([
  "no",
  "nope",
  "no thanks",
  "no thank you",
  "cancel",
  "cancel it",
  "deny",
  "don't",
  "dont",
  "do not",
  "don't submit",
  "dont submit",
  "do not submit",
  "don't submit it",
  "dont submit it",
  "do not submit it",
  "no don't submit",
  "no dont submit",
  "no do not submit",
  "no don't submit it",
  "no dont submit it",
  "no do not submit it",
  "not now",
  "nah",
  "no way",
  "please don't",
  "please dont",
  "please do not",
  "please don't submit",
  "please dont submit",
  "please do not submit",
  "cancel that",
]);

const REPEAT_PHRASES = new Set([
  "repeat",
  "repeat that",
  "repeat please",
  "please repeat",
  "say that again",
  "say it again",
  "what did you say",
]);

const DESCRIBE_PAGE_PHRASES = new Set([
  "what's on this page",
  "whats on this page",
  "what is on this page",
  "what's on the page",
  "whats on the page",
  "what is on the page",
  "describe the page",
  "describe this page",
  "read the page map",
]);

const CONTINUE_PHRASES = new Set([
  "continue",
  "continue please",
  "please continue",
  "i'm done",
  "im done",
  "i am done",
  "done",
  "go on",
]);

const START_PHRASES = new Set([
  "start",
  "start task",
  "start the task",
  "start my task",
  "start it",
  "begin",
  "begin the task",
]);

const CLEAR_GOAL_PHRASES = new Set(["clear goal", "clear the goal", "clear my goal"]);

const NEW_TASK_PHRASES = new Set([
  "new task",
  "start a new task",
  "start new task",
  "start over",
  "start a different task",
]);

/** Hesitations and politeness that should not change the meaning. */
function stripFillers(text: string): string {
  return text
    .replace(/^((ok|okay|uh|uhm|um|umm|er|erm|hmm|so|well|hey accesspilot|accesspilot) )+/, "")
    .replace(/( please| thanks| thank you)+$/, "")
    .trim();
}

/**
 * Turns a final transcript into a command. "Stop" anywhere in the utterance always wins, in
 * every state. Approve and deny are recognized only while the approval dialog is open, and only
 * as exact phrases; anything else said while it is open asks again instead of guessing.
 */
export function parseVoiceCommand(transcript: string, context: VoiceCommandContext): VoiceCommand {
  const normalized = normalizeTranscript(transcript);
  if (normalized === "") return { kind: "none", text: "" };

  if (/\bstop\b/.test(normalized)) return { kind: "stop" };

  const phrase = stripFillers(normalized);
  // A question ("submit it?") is never an answer, however its words read once punctuation is gone.
  const isQuestion = /\?\s*$/.test(transcript.trim());

  if (REPEAT_PHRASES.has(phrase) || REPEAT_PHRASES.has(normalized)) return { kind: "repeat" };
  if (DESCRIBE_PAGE_PHRASES.has(phrase) || DESCRIBE_PAGE_PHRASES.has(normalized)) {
    return { kind: "describe_page" };
  }

  if (context.approvalOpen && isQuestion) return { kind: "unclear_approval" };
  if (context.approvalOpen) {
    const approves = APPROVE_PHRASES.has(phrase) || APPROVE_PHRASES.has(normalized);
    const denies = DENY_PHRASES.has(phrase) || DENY_PHRASES.has(normalized);
    if (approves && !denies) return { kind: "approve" };
    if (denies && !approves) return { kind: "deny" };
    return { kind: "unclear_approval" };
  }

  const has = (phrases: ReadonlySet<string>) => phrases.has(phrase) || phrases.has(normalized);

  if (has(CONTINUE_PHRASES)) {
    return context.handoffActive ? { kind: "continue" } : { kind: "nothing_to_continue" };
  }
  if (has(APPROVE_PHRASES) || has(DENY_PHRASES)) return { kind: "no_approval_pending" };
  if (has(START_PHRASES)) return { kind: "start_task" };
  if (has(CLEAR_GOAL_PHRASES)) return { kind: "clear_goal" };
  if (has(NEW_TASK_PHRASES)) return { kind: "new_task" };

  return { kind: "none", text: transcript.trim() };
}
