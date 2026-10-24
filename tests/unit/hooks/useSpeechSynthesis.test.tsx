import { act, renderHook } from "@testing-library/react";
import { useSpeechSynthesis, type SpeechSynthesisOptions } from "@/hooks/useSpeechSynthesis";
import {
  fakeVoice,
  installSpeechSynthesis,
  uninstallSpeechSynthesis,
  type FakeSpeechSynthesis,
} from "../../fakes/speech";

const defaults: SpeechSynthesisOptions = { enabled: true, rate: 1, voiceURI: null };

function renderSpeech(options: Partial<SpeechSynthesisOptions> = {}) {
  return renderHook((props: SpeechSynthesisOptions) => useSpeechSynthesis(props), {
    initialProps: { ...defaults, ...options },
  });
}

let synth: FakeSpeechSynthesis;

beforeEach(() => {
  synth = installSpeechSynthesis();
});
afterEach(() => {
  uninstallSpeechSynthesis();
});

describe("useSpeechSynthesis", () => {
  it("reports unsupported browsers and does nothing", () => {
    uninstallSpeechSynthesis();
    const { result } = renderSpeech();
    expect(result.current.supported).toBe(false);
    expect(result.current.voices).toEqual([]);
    expect(() => result.current.speak("Hello", "polite")).not.toThrow();
    expect(() => result.current.cancel()).not.toThrow();
    expect(() => result.current.hold(false)).not.toThrow();
  });

  it("queues polite speech and plays it in order", () => {
    const { result } = renderSpeech();
    expect(result.current.supported).toBe(true);
    result.current.speak("One", "polite");
    result.current.speak("Two", "polite");
    expect(synth.texts).toEqual(["One"]);
    expect(result.current.isSpeaking()).toBe(true);
    synth.finishCurrent();
    expect(synth.texts).toEqual(["One", "Two"]);
    synth.finishCurrent();
    expect(result.current.isSpeaking()).toBe(false);
  });

  it("assertive speech interrupts and clears the queue", () => {
    const { result } = renderSpeech();
    result.current.speak("One", "polite");
    result.current.speak("Two", "polite");
    result.current.speak("Approval needed", "assertive");
    expect(synth.cancelCount).toBe(1);
    expect(synth.texts).toEqual(["One", "Approval needed"]);
    synth.finishCurrent();
    expect(synth.texts).toEqual(["One", "Approval needed"]);
  });

  it("ignores the end event of an utterance that was cancelled", () => {
    const { result } = renderSpeech();
    result.current.speak("One", "polite");
    const first = synth.current;
    result.current.speak("Two", "assertive");
    result.current.speak("Three", "polite");
    first?.onend?.();
    expect(synth.texts).toEqual(["One", "Two"]);
  });

  it("cancel silences immediately", () => {
    const { result } = renderSpeech();
    result.current.speak("One", "polite");
    result.current.speak("Two", "polite");
    result.current.cancel();
    expect(synth.current).toBeNull();
    expect(result.current.isSpeaking()).toBe(false);
    synth.finishCurrent();
    expect(synth.texts).toEqual(["One"]);
  });

  it("ignores empty text", () => {
    const { result } = renderSpeech();
    result.current.speak("   ", "polite");
    expect(synth.spoken).toHaveLength(0);
  });

  it("applies the rate and the chosen voice", () => {
    const ava = fakeVoice("Ava");
    synth.setVoices([fakeVoice("Bo"), ava]);
    const { result } = renderSpeech({ rate: 1.5, voiceURI: ava.voiceURI });
    expect(result.current.voices.map((v) => v.name)).toEqual(["Bo", "Ava"]);
    result.current.speak("Hi", "polite");
    expect(synth.spoken[0]).toMatchObject({ rate: 1.5, voice: ava, lang: "en-US" });
  });

  it("falls back to the default voice when the saved one is gone", () => {
    const { result } = renderSpeech({ voiceURI: "fake:Missing" });
    result.current.speak("Hi", "polite");
    expect(synth.spoken[0]?.voice).toBeNull();
  });

  it("updates the voice list when voices load later", () => {
    const { result } = renderSpeech();
    const before = result.current.voices;
    act(() => synth.setVoices([fakeVoice("Late")]));
    expect(result.current.voices.map((v) => v.name)).toEqual(["Late"]);
    expect(result.current.voices).not.toBe(before);
    const after = result.current.voices;
    act(() => synth.setVoices([fakeVoice("Late")]));
    expect(result.current.voices).toBe(after);
  });

  it("speaks nothing when disabled (screen reader mode) and stops when disabled mid-speech", () => {
    const { result, rerender } = renderSpeech();
    result.current.speak("One", "polite");
    rerender({ ...defaults, enabled: false });
    expect(synth.current).toBeNull();
    result.current.speak("Two", "assertive");
    result.current.speak("Three", "polite");
    expect(synth.texts).toEqual(["One"]);
  });

  it("holds playback while listening and resumes afterwards", () => {
    const { result } = renderSpeech();
    result.current.speak("One", "polite");
    result.current.hold(true);
    expect(synth.current).toBeNull();
    result.current.speak("Two", "polite");
    expect(synth.texts).toEqual(["One"]);
    result.current.hold(false);
    expect(synth.texts).toEqual(["One", "Two"]);
  });

  it("holding with nothing playing just pauses the queue", () => {
    const { result } = renderSpeech();
    result.current.hold(true);
    expect(synth.cancelCount).toBe(0);
    result.current.hold(false);
  });

  it("cancels speech on unmount", () => {
    const { result, unmount } = renderSpeech();
    result.current.speak("One", "polite");
    unmount();
    expect(synth.current).toBeNull();
  });
});
