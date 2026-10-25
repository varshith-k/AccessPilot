"use client";

import { useId } from "react";
import { MAX_SPEECH_RATE, MIN_SPEECH_RATE, type SpeechSettings } from "@/lib/client/settings";
import { VolumeIcon } from "./ui/icons";
import { buttonStyles, hintStyles, inputStyles, labelStyles } from "./ui/styles";

export interface SettingsPanelProps {
  settings: SpeechSettings;
  onChange(patch: Partial<SpeechSettings>): void;
  voices: readonly SpeechSynthesisVoice[];
  speechSupported: boolean;
  onTestVoice(): void;
}

function rateLabel(rate: number): string {
  return `${rate.toFixed(1)} times normal speed`;
}

const checkboxStyles =
  "mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-accent disabled:cursor-not-allowed";

export function SettingsPanel({
  settings,
  onChange,
  voices,
  speechSupported,
  onTestVoice,
}: SettingsPanelProps) {
  const id = useId();
  const builtInOff = settings.screenReaderMode || !speechSupported;
  const voiceControlsOff = builtInOff || !settings.readAloud;

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4">
      <h3 id={`${id}-heading`} className="text-sm font-semibold">
        Speech settings
      </h3>

      <div className="divide-y divide-border rounded-control border border-border">
        <div className="space-y-1 p-4">
          <div className="flex items-start gap-3">
            <input
              id={`${id}-sr`}
              type="checkbox"
              checked={settings.screenReaderMode}
              onChange={(event) =>
                onChange({ screenReaderMode: event.target.checked, firstRunDone: true })
              }
              aria-describedby={`${id}-sr-hint`}
              className={checkboxStyles}
            />
            <div className="space-y-1">
              <label htmlFor={`${id}-sr`} className="text-sm font-medium">
                I use my own screen reader
              </label>
              <p id={`${id}-sr-hint`} className={hintStyles}>
                AccessPilot stays silent and your screen reader reads its updates, so you don&apos;t
                hear everything twice.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-1 p-4">
          <div className="flex items-start gap-3">
            <input
              id={`${id}-aloud`}
              type="checkbox"
              checked={settings.readAloud && !builtInOff}
              disabled={builtInOff}
              onChange={(event) => onChange({ readAloud: event.target.checked })}
              aria-describedby={`${id}-aloud-hint`}
              className={checkboxStyles}
            />
            <div className="space-y-1">
              <label htmlFor={`${id}-aloud`} className="text-sm font-medium">
                Read narration aloud
              </label>
              <p id={`${id}-aloud-hint`} className={hintStyles}>
                {!speechSupported
                  ? "This browser can't read aloud. Updates still appear on screen and reach screen readers."
                  : settings.screenReaderMode
                    ? "Off because you use your own screen reader."
                    : "AccessPilot speaks each step in its own voice."}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${id}-rate`} className={labelStyles}>
          Speech rate: {rateLabel(settings.rate)}
        </label>
        <input
          id={`${id}-rate`}
          type="range"
          min={MIN_SPEECH_RATE}
          max={MAX_SPEECH_RATE}
          step={0.1}
          value={settings.rate}
          disabled={voiceControlsOff}
          onChange={(event) => onChange({ rate: Number(event.target.value) })}
          aria-valuetext={rateLabel(settings.rate)}
          className="block min-h-11 w-full cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${id}-voice`} className={labelStyles}>
          Voice
        </label>
        <select
          id={`${id}-voice`}
          value={settings.voiceURI ?? ""}
          disabled={voiceControlsOff}
          onChange={(event) => onChange({ voiceURI: event.target.value || null })}
          className={`${inputStyles} min-h-11`}
        >
          <option value="">Browser default</option>
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={onTestVoice}
        disabled={voiceControlsOff}
        className={buttonStyles.secondary}
      >
        <VolumeIcon />
        Test voice
      </button>
    </section>
  );
}

export interface FirstRunSpeechPromptProps {
  onChoose(screenReaderMode: boolean): void;
}

/** Asked once, prominently, so screen reader users can avoid hearing everything twice. */
export function FirstRunSpeechPrompt({ onChoose }: FirstRunSpeechPromptProps) {
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="animate-enter space-y-4 rounded-card border border-accent/40 bg-accent-soft/40 p-5"
    >
      <div className="space-y-1.5">
        <h2 id={`${id}-heading`} className="text-base font-semibold">
          Do you use your own screen reader?
        </h2>
        <p className="text-sm">
          AccessPilot reads its updates aloud. If you already use a screen reader, choose{" "}
          <strong className="font-semibold">I use a screen reader</strong> so you don&apos;t hear
          everything twice. You can change this any time in Settings.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onChoose(true)} className={buttonStyles.primary}>
          I use a screen reader
        </button>
        <button type="button" onClick={() => onChoose(false)} className={buttonStyles.secondary}>
          Read aloud for me
        </button>
      </div>
    </section>
  );
}
