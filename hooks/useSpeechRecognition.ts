"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/** The parts of the Web Speech recognition API this hook uses. TypeScript's DOM types omit it. */
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative | undefined;
}
interface RecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResult | undefined };
}
interface RecognitionErrorEvent {
  readonly error: string;
}
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionConstructor = new () => RecognitionLike;

export function getRecognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate: unknown =
    (window as unknown as Record<string, unknown>).SpeechRecognition ??
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  return typeof candidate === "function" ? (candidate as RecognitionConstructor) : null;
}

export type RecognitionErrorCode =
  "not-allowed" | "no-speech" | "network" | "aborted" | "audio-capture" | "unknown";

export interface RecognitionError {
  code: RecognitionErrorCode;
  message: string;
}

export const RECOGNITION_ERROR_MESSAGES: Record<RecognitionErrorCode, string> = {
  "not-allowed":
    "Microphone access is blocked. Allow the microphone for this site in your browser's address bar, then press the microphone button again. You can also type instead.",
  "no-speech":
    "I didn't hear anything. Press the microphone button and try again, or type instead.",
  network:
    "Voice input needs an internet connection in this browser. Check your connection and try again, or type instead.",
  aborted: "Listening was interrupted. Press the microphone button (Alt+Shift+M) to try again.",
  "audio-capture": "No microphone was found. Connect a microphone and try again, or type instead.",
  unknown: "Voice input stopped because of a problem. Try again, or type instead.",
};

function toErrorCode(error: string): RecognitionErrorCode {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "not-allowed";
    case "no-speech":
    case "network":
    case "aborted":
    case "audio-capture":
      return error;
    default:
      return "unknown";
  }
}

export interface SpeechRecognitionOptions {
  lang?: string;
  /** Called once per listening session with the final words, if any were recognized. */
  onFinal(transcript: string): void;
  /** The user started talking: a good moment to silence built-in speech. */
  onSpeechStart?(): void;
  /** Listening ended normally but no words were recognized. */
  onNothingHeard?(): void;
  onListeningChange?(listening: boolean): void;
  onError?(error: RecognitionError): void;
}

export interface SpeechRecognitionControls {
  supported: boolean;
  listening: boolean;
  interim: string;
  /** The last final transcript, kept so the user can see what was heard. */
  transcript: string;
  error: RecognitionError | null;
  start(): void;
  stop(): void;
  /** Stops listening without processing anything that was heard. */
  abort(): void;
  toggle(): void;
}

const noopSubscribe = () => () => undefined;

/** Push-to-talk speech recognition: one utterance per start, ending on silence or `stop()`. */
export function useSpeechRecognition(options: SpeechRecognitionOptions): SpeechRecognitionControls {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => getRecognitionConstructor() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<RecognitionError | null>(null);

  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  const recognitionRef = useRef<RecognitionLike | null>(null);
  /** Stop and abort for the active session; they share its closure state. */
  const stopHandlers = useRef<{ stop(): void; abort(): void } | null>(null);

  const setListeningState = useCallback((next: boolean) => {
    setListening(next);
    optionsRef.current.onListeningChange?.(next);
  }, []);

  const fail = useCallback((code: RecognitionErrorCode) => {
    const next = { code, message: RECOGNITION_ERROR_MESSAGES[code] };
    setError(next);
    optionsRef.current.onError?.(next);
  }, []);

  const start = useCallback(() => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition || recognitionRef.current !== null) return;

    const recognition = new Recognition();
    recognition.lang = optionsRef.current.lang ?? "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalText = "";
    let discard = false;
    let stoppedByUser = false;

    recognition.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalText += text;
        else pending += text;
      }
      setInterim(pending.trim());
    };
    recognition.onspeechstart = () => optionsRef.current.onSpeechStart?.();
    recognition.onerror = (event) => {
      const code = toErrorCode(event.error);
      // Aborting on purpose (Stop, unmount) is not a problem worth reporting.
      if (code === "aborted" && stoppedByUser) return;
      discard = true;
      fail(code);
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setInterim("");
      const heard = finalText.trim();
      // Report the result before announcing that listening ended: the reply is then queued
      // ahead of narration that was held while the microphone was on.
      if (!discard) {
        if (heard === "") {
          optionsRef.current.onNothingHeard?.();
        } else {
          setTranscript(heard);
          optionsRef.current.onFinal(heard);
        }
      }
      setListeningState(false);
    };

    recognitionRef.current = recognition;
    setError(null);
    setInterim("");
    setTranscript("");
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      fail("unknown");
      return;
    }
    setListeningState(true);

    stopHandlers.current = {
      stop: () => {
        stoppedByUser = true;
        recognition.stop();
      },
      abort: () => {
        stoppedByUser = true;
        discard = true;
        recognition.abort();
      },
    };
  }, [fail, setListeningState]);

  const stop = useCallback(() => {
    if (recognitionRef.current !== null) stopHandlers.current?.stop();
  }, []);

  const abort = useCallback(() => {
    if (recognitionRef.current === null) return;
    stopHandlers.current?.abort();
    // Some engines never fire onend after abort; finish the session here.
    recognitionRef.current = null;
    setInterim("");
    setListeningState(false);
  }, [setListeningState]);

  const toggle = useCallback(() => {
    if (recognitionRef.current !== null) stop();
    else start();
  }, [start, stop]);

  useEffect(
    () => () => {
      if (recognitionRef.current !== null) {
        stopHandlers.current?.abort();
        recognitionRef.current = null;
      }
    },
    [],
  );

  return { supported, listening, interim, transcript, error, start, stop, abort, toggle };
}
