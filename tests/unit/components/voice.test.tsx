import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { FirstRunSpeechPrompt, SettingsPanel } from "@/components/SettingsPanel";
import {
  VOICE_UNSUPPORTED_MESSAGE,
  VoiceControl,
  type VoiceControlProps,
} from "@/components/VoiceControl";
import { RECOGNITION_ERROR_MESSAGES } from "@/hooks/useSpeechRecognition";
import { DEFAULT_SETTINGS, type SpeechSettings } from "@/lib/client/settings";
import { fakeVoice } from "../../fakes/speech";

const voiceProps: VoiceControlProps = {
  supported: true,
  listening: false,
  interim: "",
  transcript: "",
  error: null,
  onToggle: () => undefined,
};

describe("VoiceControl", () => {
  it("explains unsupported browsers instead of hiding voice silently", async () => {
    const { container } = render(<VoiceControl {...voiceProps} supported={false} />);
    expect(screen.getByText(VOICE_UNSUPPORTED_MESSAGE)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is a named toggle button with its shortcut and usage hint", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { container } = render(<VoiceControl {...voiceProps} onToggle={onToggle} />);
    const mic = screen.getByRole("button", { name: "Microphone (Alt+Shift+M)" });
    expect(mic).toHaveAttribute("aria-pressed", "false");
    expect(mic).toHaveAttribute("aria-keyshortcuts", "Alt+Shift+M");
    expect(mic).toHaveAccessibleDescription(/Say your goal, or a command/);
    expect(screen.getByText("Not listening")).toBeVisible();
    await user.tab();
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows listening state and the interim transcript", async () => {
    const { container } = render(<VoiceControl {...voiceProps} listening interim="help me" />);
    expect(screen.getByRole("button", { name: /Microphone/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/Listening… press again/)).toBeVisible();
    expect(screen.getByText("help me")).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows the final transcript and errors", () => {
    render(
      <VoiceControl
        {...voiceProps}
        transcript="Help me apply"
        error={{ code: "not-allowed", message: RECOGNITION_ERROR_MESSAGES["not-allowed"] }}
      />,
    );
    expect(screen.getByText("“Help me apply”")).toBeVisible();
    expect(screen.getByText(/Microphone access is blocked/)).toBeVisible();
  });
});

function renderSettings(settings: Partial<SpeechSettings> = {}, speechSupported = true) {
  const onChange = vi.fn();
  const onTestVoice = vi.fn();
  const view = render(
    <SettingsPanel
      settings={{ ...DEFAULT_SETTINGS, ...settings }}
      onChange={onChange}
      voices={[fakeVoice("Ava"), fakeVoice("Bo", "en-GB")]}
      speechSupported={speechSupported}
      onTestVoice={onTestVoice}
    />,
  );
  return { ...view, onChange, onTestVoice };
}

describe("SettingsPanel", () => {
  it("labels every control and has no axe violations", async () => {
    const { container } = renderSettings();
    expect(screen.getByRole("checkbox", { name: "I use my own screen reader" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Read narration aloud" })).toBeChecked();
    expect(screen.getByRole("slider", { name: /Speech rate/ })).toHaveAttribute(
      "aria-valuetext",
      "1.0 times normal speed",
    );
    expect(screen.getByRole("combobox", { name: "Voice" })).toHaveValue("");
    expect(screen.getByRole("option", { name: "Bo (en-GB)" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("reports changes", async () => {
    const user = userEvent.setup();
    const { onChange, onTestVoice } = renderSettings();
    await user.click(screen.getByRole("checkbox", { name: "I use my own screen reader" }));
    expect(onChange).toHaveBeenLastCalledWith({ screenReaderMode: true, firstRunDone: true });
    await user.click(screen.getByRole("checkbox", { name: "Read narration aloud" }));
    expect(onChange).toHaveBeenLastCalledWith({ readAloud: false });
    await user.selectOptions(screen.getByRole("combobox", { name: "Voice" }), "fake:Ava");
    expect(onChange).toHaveBeenLastCalledWith({ voiceURI: "fake:Ava" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Voice" }), "");
    expect(onChange).toHaveBeenLastCalledWith({ voiceURI: null });
    fireEvent.change(screen.getByRole("slider", { name: /Speech rate/ }), {
      target: { value: "1.1" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ rate: 1.1 });
    await user.click(screen.getByRole("button", { name: "Test voice" }));
    expect(onTestVoice).toHaveBeenCalled();
  });

  it("turns built-in speech controls off in screen reader mode, and says why", () => {
    renderSettings({ screenReaderMode: true });
    const aloud = screen.getByRole("checkbox", { name: "Read narration aloud" });
    expect(aloud).toBeDisabled();
    expect(aloud).not.toBeChecked();
    expect(aloud).toHaveAccessibleDescription("Off because you use your own screen reader.");
    expect(screen.getByRole("slider", { name: /Speech rate/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test voice" })).toBeDisabled();
  });

  it("explains when the browser can't speak", () => {
    renderSettings({}, false);
    expect(
      screen.getByRole("checkbox", { name: "Read narration aloud" }),
    ).toHaveAccessibleDescription(/This browser can't read aloud/);
  });
});

describe("FirstRunSpeechPrompt", () => {
  it("asks prominently and reports the choice", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const { container } = render(<FirstRunSpeechPrompt onChoose={onChoose} />);
    expect(
      screen.getByRole("heading", { name: "Do you use your own screen reader?" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "I use a screen reader" }));
    await user.click(screen.getByRole("button", { name: "Read aloud for me" }));
    expect(onChoose.mock.calls).toEqual([[true], [false]]);
    expect(await axe(container)).toHaveNoViolations();
  });
});
