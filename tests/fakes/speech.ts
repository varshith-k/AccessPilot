import type { RecognitionLike } from "@/hooks/useSpeechRecognition";

/** Minimal stand-in for SpeechSynthesisUtterance. */
export class FakeUtterance {
  text: string;
  rate = 1;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

export function fakeVoice(name: string, lang = "en-US"): SpeechSynthesisVoice {
  return {
    name,
    lang,
    voiceURI: `fake:${name}`,
    default: false,
    localService: true,
  } as SpeechSynthesisVoice;
}

/**
 * Fake speechSynthesis that records what was spoken. Utterances finish only when the test calls
 * `finishCurrent()`. Like Chrome, `cancel()` fires `onerror` on the utterance being spoken.
 */
export class FakeSpeechSynthesis extends EventTarget {
  spoken: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  cancelCount = 0;
  private voices: SpeechSynthesisVoice[] = [];

  getVoices(): SpeechSynthesisVoice[] {
    return [...this.voices];
  }

  setVoices(voices: SpeechSynthesisVoice[]): void {
    this.voices = voices;
    this.dispatchEvent(new Event("voiceschanged"));
  }

  speak(utterance: FakeUtterance): void {
    this.spoken.push(utterance);
    this.current = utterance;
  }

  cancel(): void {
    this.cancelCount += 1;
    const interrupted = this.current;
    this.current = null;
    interrupted?.onerror?.();
  }

  finishCurrent(): void {
    const done = this.current;
    this.current = null;
    done?.onend?.();
  }

  /** Finishes utterances until nothing is playing, so everything queued gets spoken. */
  drain(limit = 100): void {
    for (let i = 0; i < limit && this.current !== null; i++) this.finishCurrent();
  }

  get texts(): string[] {
    return this.spoken.map((utterance) => utterance.text);
  }
}

export function installSpeechSynthesis(): FakeSpeechSynthesis {
  const synth = new FakeSpeechSynthesis();
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: FakeUtterance,
    configurable: true,
  });
  return synth;
}

export function uninstallSpeechSynthesis(): void {
  Reflect.deleteProperty(window, "speechSynthesis");
  Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
}

/** Fake recognition engine; tests drive it with `hear`, `fail`, and `end`. */
export class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = [];
  static startError: Error | null = null;

  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: RecognitionLike["onresult"] = null;
  onerror: RecognitionLike["onerror"] = null;
  onend: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  started = false;
  stopped = false;
  aborted = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  static get latest(): FakeRecognition {
    const latest = FakeRecognition.instances.at(-1);
    if (!latest) throw new Error("No recognition session was started");
    return latest;
  }

  start(): void {
    if (FakeRecognition.startError) throw FakeRecognition.startError;
    this.started = true;
    this.onstart?.();
  }

  stop(): void {
    this.stopped = true;
  }

  abort(): void {
    this.aborted = true;
    this.onerror?.({ error: "aborted" });
  }

  speechStart(): void {
    this.onspeechstart?.();
  }

  /** Delivers one result; interim results are replaced by later ones like the real engine. */
  hear(transcript: string, isFinal: boolean): void {
    const result = Object.assign([{ transcript }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: Object.assign([result], { length: 1 }) });
  }

  fail(error: string): void {
    this.onerror?.({ error });
  }

  end(): void {
    this.onend?.();
  }

  /** Hears final words and ends the session, as when the user stops talking. */
  say(transcript: string): void {
    this.speechStart();
    this.hear(transcript, true);
    this.end();
  }
}

export function installSpeechRecognition(prefixed = false): typeof FakeRecognition {
  FakeRecognition.instances = [];
  FakeRecognition.startError = null;
  Object.defineProperty(window, prefixed ? "webkitSpeechRecognition" : "SpeechRecognition", {
    value: FakeRecognition,
    configurable: true,
  });
  return FakeRecognition;
}

export function uninstallSpeechRecognition(): void {
  Reflect.deleteProperty(window, "SpeechRecognition");
  Reflect.deleteProperty(window, "webkitSpeechRecognition");
}
