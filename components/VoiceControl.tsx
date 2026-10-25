"use client";

import { useId } from "react";
import type { RecognitionError } from "@/hooks/useSpeechRecognition";
import { SHORTCUT_LABELS } from "@/hooks/useKeyboardShortcuts";
import { AlertIcon, MicIcon } from "./ui/icons";
import { errorTextStyles, hintStyles, shortcutHint } from "./ui/styles";

export interface VoiceControlProps {
  supported: boolean;
  listening: boolean;
  interim: string;
  transcript: string;
  error: RecognitionError | null;
  onToggle(): void;
  /**
   * Small inline version for use beside Stop while a task runs: the usage hint is kept for
   * screen readers only, and the last transcript is not shown.
   */
  compact?: boolean;
}

export const VOICE_UNSUPPORTED_MESSAGE = "Voice input works in Chrome. You can type instead.";

/** Push-to-talk microphone. The button keeps one name; its pressed state says whether it listens. */
export function VoiceControl({
  supported,
  listening,
  interim,
  transcript,
  error,
  onToggle,
  compact = false,
}: VoiceControlProps) {
  const id = useId();
  const hintId = `${id}-hint`;

  if (!supported) {
    if (compact) return null;
    return (
      <p className={`${hintStyles} flex items-center gap-2`}>
        <MicIcon className="size-4 shrink-0" />
        {VOICE_UNSUPPORTED_MESSAGE}
      </p>
    );
  }

  const hint = (
    <>
      Say your goal, or a command: “stop”, “repeat”, or “what&apos;s on this page”. While asked to
      approve, say “approve” or “don&apos;t submit”.
    </>
  );

  if (compact) {
    return (
      <div className="min-w-0 space-y-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={listening}
          aria-keyshortcuts={SHORTCUT_LABELS.mic}
          aria-describedby={hintId}
          className={`inline-flex min-h-12 max-w-full flex-wrap items-center justify-center gap-x-2 rounded-control border px-4 text-center text-sm font-medium transition-[background-color,border-color,color] duration-150 [&_svg]:size-4 ${
            listening
              ? "border-accent bg-accent text-on-accent"
              : "border-border-strong/60 bg-elevated text-fg hover:bg-hover"
          }`}
        >
          {listening ? (
            <span aria-hidden="true" className="relative flex size-2.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-on-accent opacity-60 motion-reduce:animate-none" />
              <span className="relative size-2.5 rounded-full bg-on-accent" />
            </span>
          ) : (
            <MicIcon />
          )}
          Microphone{" "}
          <span className={`text-xs ${shortcutHint} ${listening ? "opacity-80" : "text-muted"}`}>
            ({SHORTCUT_LABELS.mic})
          </span>
        </button>
        <p id={hintId} className="sr-only">
          {hint}
        </p>
        {listening && (
          <p className="text-[13px] text-muted">
            {interim === "" ? "Listening… press again when you finish" : `Hearing: ${interim}`}
          </p>
        )}
        {error && (
          <p className={errorTextStyles}>
            <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {error.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={listening}
          aria-keyshortcuts={SHORTCUT_LABELS.mic}
          aria-describedby={hintId}
          className={`inline-flex min-h-11 max-w-full flex-wrap items-center justify-center gap-x-2 rounded-full border px-4 text-center text-sm font-medium break-words transition-[background-color,border-color,color] duration-150 [&_svg]:size-4 ${
            listening
              ? "border-accent bg-accent text-on-accent"
              : "border-border-strong/60 bg-elevated text-fg hover:bg-hover"
          }`}
        >
          <MicIcon />
          Microphone{" "}
          <span className={`text-xs ${shortcutHint} ${listening ? "opacity-80" : "text-muted"}`}>
            ({SHORTCUT_LABELS.mic})
          </span>
        </button>
        <p className="flex items-center gap-2 text-sm font-medium">
          {listening ? (
            <>
              <span aria-hidden="true" className="relative flex size-2.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60 motion-reduce:animate-none" />
                <span className="relative size-2.5 rounded-full bg-accent" />
              </span>
              Listening… press again when you finish
            </>
          ) : (
            <span className="text-muted">Not listening</span>
          )}
        </p>
      </div>
      <p id={hintId} className={hintStyles}>
        {hint}
      </p>
      {listening && interim !== "" && (
        <p className="rounded-control border border-dashed border-accent/40 bg-accent-soft/50 px-3 py-2 text-sm">
          <span className="font-medium">Hearing: </span>
          <span className="text-muted">{interim}</span>
        </p>
      )}
      {!listening && transcript !== "" && (
        <p className="rounded-control border border-border bg-subtle px-3 py-2 text-sm">
          <span className="font-medium">Heard: </span>“{transcript}”
        </p>
      )}
      {error && (
        <p className={errorTextStyles}>
          <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
          {error.message}
        </p>
      )}
    </div>
  );
}
