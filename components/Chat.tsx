"use client";

import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useAnnouncer } from "@/hooks/useAnnouncer";
import type { LogEntry, LogTone, Speaker } from "@/lib/client/taskState";
import type { FollowUpResult } from "@/hooks/useTaskSession";
import { buttonStyles, inputStyles } from "./ui/styles";

export interface ChatProps {
  entries: LogEntry[];
  /** True while a task runs; follow-ups are disabled with an explanation. */
  busy: boolean;
  onSend(text: string): FollowUpResult;
}

const SPEAKER_LABEL: Record<Speaker, string> = {
  user: "You",
  assistant: "AccessPilot",
  system: "AccessPilot status",
};

/** Text label for tones, so color is never the only signal. */
const TONE_LABEL: Record<LogTone, string | null> = {
  info: null,
  success: "Done",
  warning: "Needs attention",
  error: "Problem",
};

const TONE_CLASS: Record<LogTone, string> = {
  info: "border-border",
  success: "border-success",
  warning: "border-warning",
  error: "border-danger",
};

/** How close to the bottom (px) still counts as "following" the conversation. */
const STICK_THRESHOLD = 48;

const FOLLOW_UP_ERRORS: Record<Exclude<FollowUpResult, { ok: true }>["reason"], string> = {
  invalid: "That message can't be used as a goal.",
  empty: "Type a message first.",
  busy: "AccessPilot is working on a task. Wait for it to finish, or press Stop.",
  no_url: "Enter a website address in the task form above first, then start a task.",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function Chat({ entries, busy, onSend }: ChatProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  const inputId = `${id}-message`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const logRef = useRef<HTMLDivElement>(null);
  // null while following the conversation; otherwise how many entries existed when the user
  // scrolled away from the bottom.
  const [scrolledAwayAt, setScrolledAwayAt] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { announce } = useAnnouncer();
  const hasUnseen = scrolledAwayAt !== null && entries.length > scrolledAwayAt;

  const scrollToLatest = () => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
    setScrolledAwayAt(null);
  };

  // Follow new entries only while the user is at the bottom; never move focus.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && scrolledAwayAt === null) log.scrollTop = log.scrollHeight;
  }, [entries.length, scrolledAwayAt]);

  const handleScroll = () => {
    const log = logRef.current;
    if (!log) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight <= STICK_THRESHOLD;
    if (atBottom) setScrolledAwayAt(null);
    else if (scrolledAwayAt === null) setScrolledAwayAt(entries.length);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = onSend(draft);
    if (result.ok) {
      setDraft("");
      setError(null);
      scrollToLatest();
    } else {
      const message = "message" in result ? result.message : FOLLOW_UP_ERRORS[result.reason];
      setError(message);
      announce(message, "assertive");
    }
  };

  return (
    <section className="space-y-3">
      <h2 id={headingId} className="text-xl font-bold">
        Conversation
      </h2>
      <div
        ref={logRef}
        onScroll={handleScroll}
        tabIndex={0}
        role="region"
        aria-label="Conversation history"
        className="max-h-[min(28rem,60dvh)] min-h-24 overflow-y-auto rounded-lg border border-border bg-bg p-3"
      >
        {entries.length === 0 ? (
          <p className="text-muted">
            Nothing yet. When you start a task, what AccessPilot does and says appears here.
          </p>
        ) : (
          <ol className="space-y-3">
            {entries.map((entry) => {
              const toneLabel = TONE_LABEL[entry.tone];
              return (
                <li
                  key={entry.id}
                  className={`border-l-4 pl-3 ${TONE_CLASS[entry.tone]} ${entry.speaker === "user" ? "bg-surface py-1" : ""}`}
                >
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-bold">{SPEAKER_LABEL[entry.speaker]}</span>{" "}
                    {toneLabel && <span className="font-semibold">({toneLabel}) </span>}
                    <time dateTime={entry.at} className="text-muted">
                      {formatTime(entry.at)}
                    </time>
                  </p>
                  <p className="whitespace-pre-wrap break-words">{entry.text}</p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {hasUnseen && (
        <button type="button" onClick={scrollToLatest} className={buttonStyles.secondary}>
          New messages below. Show latest
        </button>
      )}

      <form method="post" onSubmit={handleSubmit} noValidate className="space-y-2">
        <label htmlFor={inputId} className="block font-semibold">
          Message AccessPilot
        </label>
        <p id={hintId} className="text-sm text-muted">
          {busy
            ? "You can send a message when the current task finishes. To change course now, press Stop."
            : "Send a new goal for the same website, like “Now find the deadline.”"}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={inputId}
            type="text"
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={error ? true : undefined}
            className={inputStyles}
          />
          <button type="submit" disabled={busy} className={buttonStyles.secondary}>
            Send
          </button>
        </div>
        {error && (
          <p id={errorId} className="font-semibold text-danger">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
