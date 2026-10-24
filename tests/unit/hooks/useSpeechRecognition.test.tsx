import { act, renderHook } from "@testing-library/react";
import {
  RECOGNITION_ERROR_MESSAGES,
  useSpeechRecognition,
  type SpeechRecognitionOptions,
} from "@/hooks/useSpeechRecognition";
import {
  FakeRecognition,
  installSpeechRecognition,
  uninstallSpeechRecognition,
} from "../../fakes/speech";

function renderRecognition(overrides: Partial<SpeechRecognitionOptions> = {}) {
  const options = {
    onFinal: vi.fn<SpeechRecognitionOptions["onFinal"]>(),
    onSpeechStart: vi.fn(),
    onListeningChange: vi.fn<(listening: boolean) => void>(),
    onError: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(() => useSpeechRecognition(options));
  return { ...hook, options };
}

beforeEach(() => {
  installSpeechRecognition();
});
afterEach(() => {
  uninstallSpeechRecognition();
});

describe("useSpeechRecognition", () => {
  it("reports unsupported browsers and ignores start", () => {
    uninstallSpeechRecognition();
    const { result } = renderRecognition();
    expect(result.current.supported).toBe(false);
    act(() => result.current.start());
    expect(result.current.listening).toBe(false);
  });

  it("uses the webkit-prefixed constructor in Chrome", () => {
    uninstallSpeechRecognition();
    installSpeechRecognition(true);
    const { result } = renderRecognition();
    expect(result.current.supported).toBe(true);
  });

  it("starts push-to-talk with interim results and delivers the final transcript once", () => {
    const { result, options } = renderRecognition();
    act(() => result.current.start());
    const engine = FakeRecognition.latest;
    expect(engine).toMatchObject({
      started: true,
      continuous: false,
      interimResults: true,
      lang: "en-US",
      maxAlternatives: 1,
    });
    expect(result.current.listening).toBe(true);
    expect(options.onListeningChange).toHaveBeenLastCalledWith(true);

    act(() => engine.speechStart());
    expect(options.onSpeechStart).toHaveBeenCalled();
    act(() => engine.hear("help me", false));
    expect(result.current.interim).toBe("help me");
    act(() => engine.hear("Help me apply", true));
    expect(result.current.interim).toBe("");
    act(() => engine.end());

    expect(result.current.listening).toBe(false);
    expect(result.current.transcript).toBe("Help me apply");
    expect(options.onFinal).toHaveBeenCalledTimes(1);
    expect(options.onFinal).toHaveBeenCalledWith("Help me apply");
    expect(options.onListeningChange).toHaveBeenLastCalledWith(false);
  });

  it("does not call onFinal when nothing was heard", () => {
    const { result, options } = renderRecognition();
    act(() => result.current.start());
    act(() => FakeRecognition.latest.end());
    expect(options.onFinal).not.toHaveBeenCalled();
    expect(result.current.transcript).toBe("");
  });

  it("toggle starts, then stops, letting the engine finish the utterance", () => {
    const { result, options } = renderRecognition();
    act(() => result.current.toggle());
    const engine = FakeRecognition.latest;
    act(() => engine.hear("stop", true));
    act(() => result.current.toggle());
    expect(engine.stopped).toBe(true);
    act(() => engine.end());
    expect(options.onFinal).toHaveBeenCalledWith("stop");
  });

  it("ignores start while already listening", () => {
    const { result } = renderRecognition();
    act(() => result.current.start());
    act(() => result.current.start());
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it.each([
    ["not-allowed", "not-allowed"],
    ["service-not-allowed", "not-allowed"],
    ["no-speech", "no-speech"],
    ["network", "network"],
    ["audio-capture", "audio-capture"],
    ["language-not-supported", "unknown"],
  ] as const)("maps the %s error to a specific, actionable message", (engineError, code) => {
    const { result, options } = renderRecognition();
    act(() => result.current.start());
    const engine = FakeRecognition.latest;
    act(() => engine.hear("partial words", true));
    act(() => engine.fail(engineError));
    act(() => engine.end());
    expect(result.current.error).toEqual({ code, message: RECOGNITION_ERROR_MESSAGES[code] });
    expect(options.onError).toHaveBeenCalledWith(result.current.error);
    expect(options.onFinal).not.toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
  });

  it("reports aborted when the engine aborts on its own", () => {
    const { result } = renderRecognition();
    act(() => result.current.start());
    act(() => FakeRecognition.latest.fail("aborted"));
    expect(result.current.error?.code).toBe("aborted");
    expect(result.current.error?.message).toMatch(/interrupted/);
  });

  it("clears the previous error when listening starts again", () => {
    const { result } = renderRecognition();
    act(() => result.current.start());
    act(() => FakeRecognition.latest.fail("no-speech"));
    act(() => FakeRecognition.latest.end());
    act(() => result.current.start());
    expect(result.current.error).toBeNull();
  });

  it("abort stops immediately, discards what was heard, and reports nothing", () => {
    const { result, options } = renderRecognition();
    act(() => result.current.start());
    const engine = FakeRecognition.latest;
    act(() => engine.hear("yes", true));
    act(() => result.current.abort());
    expect(engine.aborted).toBe(true);
    expect(result.current.listening).toBe(false);
    act(() => engine.end());
    expect(options.onFinal).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    act(() => result.current.abort());
    act(() => result.current.stop());
  });

  it("reports a problem if the engine refuses to start", () => {
    FakeRecognition.startError = new Error("InvalidStateError");
    const { result } = renderRecognition();
    act(() => result.current.start());
    expect(result.current.listening).toBe(false);
    expect(result.current.error?.code).toBe("unknown");
  });

  it("aborts listening on unmount", () => {
    const { result, unmount } = renderRecognition();
    act(() => result.current.start());
    const engine = FakeRecognition.latest;
    unmount();
    expect(engine.aborted).toBe(true);
  });

  it("works without optional callbacks", () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onFinal }));
    act(() => result.current.start());
    act(() => FakeRecognition.latest.say("hello"));
    act(() => result.current.start());
    act(() => FakeRecognition.latest.fail("network"));
    expect(onFinal).toHaveBeenCalledWith("hello");
  });
});

describe("result ordering", () => {
  beforeEach(() => {
    installSpeechRecognition();
  });

  it("delivers the transcript before reporting that listening ended", () => {
    const order: string[] = [];
    const { result } = renderRecognition({
      onFinal: (text) => order.push(`final:${text}`),
      onNothingHeard: () => order.push("nothing"),
      onListeningChange: (listening) => order.push(`listening:${listening}`),
    });
    act(() => result.current.start());
    act(() => FakeRecognition.latest.say("repeat"));
    act(() => result.current.start());
    act(() => FakeRecognition.latest.end());
    expect(order).toEqual([
      "listening:true",
      "final:repeat",
      "listening:false",
      "listening:true",
      "nothing",
      "listening:false",
    ]);
  });
});
