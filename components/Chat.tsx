"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useAnnouncer } from "@/hooks/useAnnouncer";
import type { LogEntry, LogTone, Speaker } from "@/lib/client/taskState";
import type { FollowUpResult } from "@/hooks/useTaskSession";
import {
  AlertIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  InfoIcon,
  LogoMark,
  MessageIcon,
} from "./ui/icons";
import { IconButton } from "./ui/IconButton";
import { buttonStyles, eyebrowStyles, errorTextStyles, hintStyles, labelStyles } from "./ui/styles";

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

const TONE_STYLE: Record<LogTone, { chip: string; icon: string; Icon: typeof InfoIcon }> = {
  info: { chip: "", icon: "text-muted", Icon: InfoIcon },
  success: { chip: "bg-success-soft text-success", icon: "text-success", Icon: CheckIcon },
  warning: { chip: "bg-warning-soft text-warning", icon: "text-warning", Icon: AlertIcon },
  error: { chip: "bg-danger-soft text-danger", icon: "text-danger", Icon: AlertIcon },
};

/** How close to the bottom (px) still counts as "following" the conversation. */
const STICK_THRESHOLD = 48;
const COPIED_MS = 1500;

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

function Meta({ entry, align = "start" }: { entry: LogEntry; align?: "start" | "end" }) {
  const toneLabel = TONE_LABEL[entry.tone];
  return (
    <p
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted ${align === "end" ? "justify-end" : ""}`}
    >
      <span className="font-medium text-fg">{SPEAKER_LABEL[entry.speaker]}</span>{" "}
      {toneLabel && (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_STYLE[entry.tone].chip}`}
        >
          <span className="sr-only">(</span>
          {toneLabel}
          <span className="sr-only">) </span>
        </span>
      )}
      <time dateTime={entry.at}>{formatTime(entry.at)}</time>
    </p>
  );
}

interface MessageProps {
  entry: LogEntry;
  copied: boolean;
  onCopy(entry: LogEntry): void;
}

function Message({ entry, copied, onCopy }: MessageProps) {
  if (entry.speaker === "user") {
    return (
      <li className="flex animate-enter flex-col items-end gap-1.5">
        <Meta entry={entry} align="end" />
        <p className="max-w-[min(85%,36rem)] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-[15px] text-on-accent-soft">
          {entry.text}
        </p>
      </li>
    );
  }

  if (entry.speaker === "system") {
    const { Icon, icon } = TONE_STYLE[entry.tone];
    return (
      <li className="flex animate-enter gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-subtle">
          <Icon className={`size-3.5 ${icon}`} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <Meta entry={entry} />
          <p className="whitespace-pre-wrap break-words text-sm">{entry.text}</p>
        </div>
      </li>
    );
  }

  return (
    <li className="group/message relative flex animate-enter gap-3">
      <LogoMark className="mt-0.5 size-7" />
      <div className="min-w-0 flex-1 space-y-1 pr-9">
        <Meta entry={entry} />
        <p className="whitespace-pre-wrap break-words text-[15px]">{entry.text}</p>
      </div>
      <div className="absolute -top-1.5 right-0 transition-opacity duration-150 sm:opacity-0 sm:group-focus-within/message:opacity-100 sm:group-hover/message:opacity-100">
        <IconButton
          label={copied ? "Copied" : "Copy message"}
          tooltipSide="left"
          className="size-8 [&_svg]:size-3.5"
          onClick={() => onCopy(entry)}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </IconButton>
      </div>
    </li>
  );
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
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

  useEffect(() => {
    if (copiedId === null) return;
    const timer = setTimeout(() => setCopiedId(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copiedId]);

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

  const copy = async (entry: LogEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopiedId(entry.id);
      announce("Message copied.", "polite");
    } catch {
      announce("Couldn't copy. Select the text and copy it instead.", "assertive");
    }
  };

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className={eyebrowStyles}>
        Conversation
      </h2>
      <div className="relative">
        <div
          ref={logRef}
          onScroll={handleScroll}
          tabIndex={0}
          role="region"
          aria-label="Conversation history"
          className="max-h-[min(34rem,65dvh)] min-h-28 overflow-y-auto overscroll-contain rounded-card border border-border bg-elevated p-4 sm:p-5"
        >
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
              <span className="flex size-10 items-center justify-center rounded-full border border-border bg-subtle text-muted">
                <MessageIcon className="size-[18px]" />
              </span>
              <p className="max-w-sm text-sm text-muted">
                Nothing yet. When you start a task, what AccessPilot does and says appears here.
              </p>
            </div>
          ) : (
            <ol className="space-y-5">
              {entries.map((entry) => (
                <Message
                  key={entry.id}
                  entry={entry}
                  copied={copiedId === entry.id}
                  onCopy={(target) => void copy(target)}
                />
              ))}
            </ol>
          )}
        </div>
        {hasUnseen && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <button
              type="button"
              onClick={scrollToLatest}
              className={`${buttonStyles.secondary} pointer-events-auto min-h-9 rounded-full shadow-elevated`}
            >
              <ChevronDownIcon />
              New messages below. Show latest
            </button>
          </div>
        )}
      </div>

      <form method="post" onSubmit={handleSubmit} noValidate className="space-y-2">
        <label htmlFor={inputId} className={labelStyles}>
          Message AccessPilot
        </label>
        <div
          className={`flex items-center gap-2 rounded-card border bg-elevated p-1.5 pl-4 transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-focus/25 ${error ? "border-danger" : "border-border-strong"} ${busy ? "opacity-60" : ""}`}
        >
          <input
            id={inputId}
            type="text"
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={error ? true : undefined}
            placeholder={busy ? "Waiting for the task to finish…" : "Ask a follow-up…"}
            className="min-h-10 min-w-0 flex-1 bg-transparent text-[15px] text-fg placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={busy}
            aria-label="Send"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-accent text-on-accent transition-[filter,opacity] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-[18px]"
          >
            <ArrowUpIcon />
          </button>
        </div>
        <p id={hintId} className={hintStyles}>
          {busy
            ? "You can send a message when the current task finishes. To change course now, press Stop."
            : "Send a new goal for the same website, like “Now find the deadline.”"}
        </p>
        {error && (
          <p id={errorId} className={errorTextStyles}>
            <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
