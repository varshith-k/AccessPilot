"use client";

import { useId } from "react";
import { MAX_SPEECH_RATE, MIN_SPEECH_RATE, type SpeechSettings } from "@/lib/client/settings";
import { buttonStyles, inputStyles, panelStyles } from "./ui/styles";

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
    <section className={`${panelStyles} space-y-4`}>
      <h2 className="text-xl font-bold">Speech settings</h2>

      <div className="space-y-1">
        <div className="flex items-start gap-3">
          <input
            id={`${id}-sr`}
            type="checkbox"
            checked={settings.screenReaderMode}
            onChange={(event) =>
              onChange({ screenReaderMode: event.target.checked, firstRunDone: true })
            }
            aria-describedby={`${id}-sr-hint`}
            className="mt-1 size-6 shrink-0 accent-accent"
          />
          <label htmlFor={`${id}-sr`} className="font-semibold">
            I use my own screen reader
          </label>
        </div>
        <p id={`${id}-sr-hint`} className="text-sm text-muted">
          AccessPilot stays silent and your screen reader reads its updates, so you don&apos;t hear
          everything twice.
        </p>
      </div>

      <div className="space-y-1">
        <div className="flex items-start gap-3">
          <input
            id={`${id}-aloud`}
            type="checkbox"
            checked={settings.readAloud && !builtInOff}
            disabled={builtInOff}
            onChange={(event) => onChange({ readAloud: event.target.checked })}
            aria-describedby={`${id}-aloud-hint`}
            className="mt-1 size-6 shrink-0 accent-accent"
          />
          <label htmlFor={`${id}-aloud`} className="font-semibold">
            Read narration aloud
          </label>
        </div>
        <p id={`${id}-aloud-hint`} className="text-sm text-muted">
          {!speechSupported
            ? "This browser can't read aloud. Updates still appear on screen and reach screen readers."
            : settings.screenReaderMode
              ? "Off because you use your own screen reader."
              : "AccessPilot speaks each step in its own voice."}
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-rate`} className="block font-semibold">
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
          className="block min-h-11 w-full accent-accent"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-voice`} className="block font-semibold">
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
  return (
    <section className={`${panelStyles} space-y-3 border-2 border-accent`}>
      <h2 className="text-xl font-bold">Do you use your own screen reader?</h2>
      <p>
        AccessPilot reads its updates aloud. If you already use a screen reader, choose{" "}
        <strong>I use a screen reader</strong> so you don&apos;t hear everything twice. You can
        change this any time in Speech settings.
      </p>
      <div className="flex flex-wrap gap-3">
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
