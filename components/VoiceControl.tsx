"use client";

import { useId } from "react";
import type { RecognitionError } from "@/hooks/useSpeechRecognition";
import { SHORTCUT_LABELS } from "@/hooks/useKeyboardShortcuts";
import { buttonStyles, shortcutHint } from "./ui/styles";

export interface VoiceControlProps {
  supported: boolean;
  listening: boolean;
  interim: string;
  transcript: string;
  error: RecognitionError | null;
  onToggle(): void;
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
}: VoiceControlProps) {
  const id = useId();
  const hintId = `${id}-hint`;

  if (!supported) {
    return (
      <p className="text-muted">
        <span aria-hidden="true">🎤 </span>
        {VOICE_UNSUPPORTED_MESSAGE}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={listening}
          aria-keyshortcuts={SHORTCUT_LABELS.mic}
          aria-describedby={hintId}
          className={`${listening ? buttonStyles.primary : buttonStyles.secondary} min-h-12 min-w-12`}
        >
          <span aria-hidden="true">🎤</span>
          Microphone <span className={shortcutHint}>({SHORTCUT_LABELS.mic})</span>
        </button>
        <p className="font-semibold">
          {listening ? (
            <>
              <span aria-hidden="true">● </span>Listening… press again when you finish
            </>
          ) : (
            "Not listening"
          )}
        </p>
      </div>
      <p id={hintId} className="text-sm text-muted">
        Say your goal, or a command: “stop”, “repeat”, or “what&apos;s on this page”. While asked to
        approve, say “approve” or “don&apos;t submit”.
      </p>
      {listening && interim !== "" && (
        <p>
          <span className="font-semibold">Hearing: </span>
          {interim}
        </p>
      )}
      {!listening && transcript !== "" && (
        <p>
          <span className="font-semibold">Heard: </span>“{transcript}”
        </p>
      )}
      {error && (
        <p className="font-semibold text-danger">
          <span aria-hidden="true">⚠ </span>
          {error.message}
        </p>
      )}
    </div>
  );
}
