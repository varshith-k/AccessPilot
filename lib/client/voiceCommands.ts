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
  /** An approve or deny phrase when nothing is waiting for approval. */
  | { kind: "no_approval_pending" }
  /** A continue phrase when nothing is waiting for the user. */
  | { kind: "nothing_to_continue" }
  /** Not a command; treat the words as dictation. */
  | { kind: "none"; text: string };

export interface VoiceCommandContext {
  approvalOpen: boolean;
  handoffActive: boolean;
  /**
   * Whether a task is running (or starting, or waiting on the user). While it is, "stop"
   * anywhere in an utterance stops it. When nothing is running, only a whole stop phrase counts,
   * so a goal like "help me stop my subscription" is dictation. Defaults to true, the safe side.
   */
  taskActive?: boolean;
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

/** Whole utterances that mean Stop, recognized when nothing is running. */
const STOP_PHRASES = new Set([
  "stop",
  "stop it",
  "stop now",
  "stop that",
  "stop the task",
  "stop everything",
  "please stop",
]);

const CLEAR_GOAL_PHRASES = new Set(["clear goal", "clear the goal", "clear my goal"]);

/** Hesitations and politeness that should not change the meaning. */
function stripFillers(text: string): string {
  return text
    .replace(/^((ok|okay|uh|uhm|um|umm|er|erm|hmm|so|well|hey accesspilot|accesspilot) )+/, "")
    .replace(/( please| thanks| thank you)+$/, "")
    .trim();
}

/**
 * Turns a final transcript into a command. While a task is active, "stop" anywhere in the
 * utterance always wins; with nothing running, only a whole stop phrase does. Approve and deny are recognized only while the approval dialog is open, and only
 * as exact phrases; anything else said while it is open asks again instead of guessing.
 */
export function parseVoiceCommand(transcript: string, context: VoiceCommandContext): VoiceCommand {
  const normalized = normalizeTranscript(transcript);
  if (normalized === "") return { kind: "none", text: "" };

  const phrase = stripFillers(normalized);
  const taskActive = context.taskActive ?? true;
  if (taskActive || context.approvalOpen || context.handoffActive) {
    if (/\bstop\b/.test(normalized)) return { kind: "stop" };
  } else if (STOP_PHRASES.has(phrase) || STOP_PHRASES.has(normalized)) {
    return { kind: "stop" };
  }

  if (REPEAT_PHRASES.has(phrase) || REPEAT_PHRASES.has(normalized)) return { kind: "repeat" };
  if (DESCRIBE_PAGE_PHRASES.has(phrase) || DESCRIBE_PAGE_PHRASES.has(normalized)) {
    return { kind: "describe_page" };
  }

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

  return { kind: "none", text: transcript.trim() };
}
