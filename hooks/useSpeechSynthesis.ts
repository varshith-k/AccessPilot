"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { NarrationPriority } from "@/lib/contracts";

export interface SpeechSynthesisOptions {
  /** False in screen reader mode or when reading aloud is off: nothing is spoken. */
  enabled: boolean;
  rate: number;
  voiceURI: string | null;
  lang?: string;
}

export interface SpeechSynthesisControls {
  supported: boolean;
  voices: readonly SpeechSynthesisVoice[];
  /** Polite text waits its turn; assertive text interrupts and clears the queue. */
  speak(text: string, priority: NarrationPriority): void;
  /** Silences everything immediately and clears the queue. */
  cancel(): void;
  /** While held (e.g. the microphone is listening) nothing plays; queued text waits. */
  hold(held: boolean): void;
  isSpeaking(): boolean;
}

function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
    return null;
  }
  return window.speechSynthesis;
}

const noopSubscribe = () => () => undefined;
const EMPTY_VOICES: readonly SpeechSynthesisVoice[] = [];

/** Voices load asynchronously in most browsers; cache them so snapshots stay referentially stable. */
let cachedVoices: readonly SpeechSynthesisVoice[] = EMPTY_VOICES;

function refreshVoices(synth: SpeechSynthesis): boolean {
  const next = synth.getVoices();
  const same =
    next.length === cachedVoices.length &&
    next.every((voice, index) => voice.voiceURI === cachedVoices[index]?.voiceURI);
  if (same) return false;
  cachedVoices = next.length === 0 ? EMPTY_VOICES : [...next];
  return true;
}

function subscribeVoices(listener: () => void): () => void {
  const synth = getSynth();
  if (!synth) return () => undefined;
  const onChange = () => {
    if (refreshVoices(synth)) listener();
  };
  synth.addEventListener("voiceschanged", onChange);
  onChange();
  return () => synth.removeEventListener("voiceschanged", onChange);
}

interface QueueItem {
  text: string;
}

export function useSpeechSynthesis(options: SpeechSynthesisOptions): SpeechSynthesisControls {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => getSynth() !== null,
    () => false,
  );
  const voices = useSyncExternalStore(
    subscribeVoices,
    () => cachedVoices,
    () => EMPTY_VOICES,
  );

  const optionsRef = useRef(options);
  const voicesRef = useRef(voices);
  useLayoutEffect(() => {
    optionsRef.current = options;
    voicesRef.current = voices;
  });

  const queue = useRef<QueueItem[]>([]);
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  const held = useRef(false);
  /** Bumped on every cancel so callbacks from cancelled utterances are ignored (Chrome fires them). */
  const generation = useRef(0);
  /** Lets an utterance's end handler start the next one without a self-referencing callback. */
  const playNextRef = useRef<() => void>(() => undefined);

  const playNext = useCallback(() => {
    const synth = getSynth();
    if (!synth || held.current || current.current !== null) return;
    const item = queue.current.shift();
    if (!item) return;
    const { rate, voiceURI, lang } = optionsRef.current;
    const utterance = new window.SpeechSynthesisUtterance(item.text);
    utterance.rate = rate;
    utterance.lang = lang ?? "en-US";
    const voice = voiceURI ? voicesRef.current.find((v) => v.voiceURI === voiceURI) : undefined;
    if (voice) utterance.voice = voice;
    const started = generation.current;
    const finished = () => {
      if (started !== generation.current || current.current !== utterance) return;
      current.current = null;
      playNextRef.current();
    };
    utterance.onend = finished;
    utterance.onerror = finished;
    current.current = utterance;
    synth.speak(utterance);
  }, []);

  useLayoutEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  const cancel = useCallback(() => {
    generation.current += 1;
    queue.current = [];
    current.current = null;
    getSynth()?.cancel();
  }, []);

  const speak = useCallback(
    (raw: string, priority: NarrationPriority) => {
      const text = raw.trim();
      if (text === "" || !optionsRef.current.enabled || !getSynth()) return;
      if (priority === "assertive") cancel();
      queue.current.push({ text });
      playNext();
    },
    [cancel, playNext],
  );

  const hold = useCallback(
    (next: boolean) => {
      held.current = next;
      if (next) {
        // Stop talking over the user, but keep what was queued for afterwards.
        if (current.current !== null) {
          generation.current += 1;
          current.current = null;
          getSynth()?.cancel();
        }
      } else {
        playNext();
      }
    },
    [playNext],
  );

  const isSpeaking = useCallback(() => current.current !== null, []);

  const { enabled } = options;
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);

  useEffect(() => cancel, [cancel]);

  return { supported, voices, speak, cancel, hold, isSpeaking };
}
