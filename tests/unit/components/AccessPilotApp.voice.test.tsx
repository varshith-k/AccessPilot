import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccessPilotApp } from "@/components/AccessPilotApp";
import { MockTaskClient } from "@/lib/client/MockTaskClient";
import type { MockScenarioName } from "@/lib/client/mock/scenarios";
import { settingsStore } from "@/lib/client/settings";
import {
  FakeRecognition,
  installSpeechRecognition,
  installSpeechSynthesis,
  uninstallSpeechRecognition,
  uninstallSpeechSynthesis,
  type FakeSpeechSynthesis,
} from "../../fakes/speech";
import { liveText } from "./helpers";

let synth: FakeSpeechSynthesis;

async function flush() {
  for (let round = 0; round < 50 && vi.getTimerCount() > 0; round++) {
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
  }
}

/** Advances time in steps so React commits effects (like subscribing) between them. */
async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 500) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(500, ms - elapsed));
    });
  }
}

const pressShortcut = (code: string, target: Element = document.body) =>
  fireEvent.keyDown(target, { code, altKey: true, shiftKey: true });

/** Presses the mic shortcut and says the words, as the user would. */
function speak(words: string) {
  act(() => {
    pressShortcut("KeyM");
  });
  act(() => FakeRecognition.latest.say(words));
}

function renderApp(scenario: MockScenarioName = "scholarship-happy") {
  const client = new MockTaskClient({ scenario });
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  const view = render(<AccessPilotApp client={client} />);
  return { client, user, ...view };
}

async function startByVoice(scenario: MockScenarioName) {
  const app = renderApp(scenario);
  await app.user.type(
    screen.getByRole("textbox", { name: "Website address" }),
    "http://localhost:4000/scholarship",
  );
  speak("Help me complete this scholarship application");
  await app.user.click(screen.getByRole("button", { name: "Start task" }));
  return app;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  settingsStore.reload();
  synth = installSpeechSynthesis();
  installSpeechRecognition(true);
});

afterEach(() => {
  vi.useRealTimers();
  uninstallSpeechSynthesis();
  uninstallSpeechRecognition();
});

describe("AccessPilotApp voice", () => {
  it("asks about screen readers on first load and remembers the answer", async () => {
    const { user, unmount } = renderApp();
    await user.click(screen.getByRole("button", { name: "I use a screen reader" }));
    expect(screen.queryByRole("heading", { name: /Do you use your own screen reader/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Start a task" })).toHaveFocus();
    await user.click(screen.getAllByRole("button", { name: "Settings" })[0]!);
    expect(screen.getByRole("checkbox", { name: "I use my own screen reader" })).toBeChecked();
    unmount();

    renderApp();
    expect(screen.queryByRole("heading", { name: /Do you use your own screen reader/ })).toBeNull();
  });

  it("dictation fills the goal box for editing, and the task runs with narration spoken aloud", async () => {
    await startByVoice("scholarship-happy");
    // The dictated goal became the task's goal (the form steps aside while the task runs).
    expect(
      within(screen.getByRole("region", { name: "Conversation history" })).getByText(
        "Help me complete this scholarship application",
      ),
    ).toBeVisible();
    expect(synth.texts).toContain(
      "Heard: Help me complete this scholarship application. It's in the goal box. Edit it if you need to, then say “start task” or press Start task.",
    );
    await advance(9000);
    act(() => synth.drain());
    expect(synth.texts.some((text) => text.includes("This page has a login link"))).toBe(true);
  });

  it("approves by voice only with a clear phrase; ambiguous words re-ask and never approve", async () => {
    const { client } = await startByVoice("scholarship-happy");
    const approve = vi.spyOn(client, "approve");
    await flush();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Alt\+Shift\+M and say “approve”/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Answer by voice" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    speak("yes but change the program");
    expect(approve).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(liveText("assertive")).toMatch(/isn't a clear yes or no, so nothing was submitted/);

    speak("Approve and submit");
    expect(approve).toHaveBeenCalledWith(expect.any(String), "approval-submit");
    await flush();
    expect(liveText("assertive")).toBe("Submitted. Confirmation number 4821.");
  });

  it('"don\'t submit" by voice denies', async () => {
    const { client } = await startByVoice("scholarship-deny");
    const deny = vi.spyOn(client, "deny");
    await flush();
    speak("don't submit");
    expect(deny).toHaveBeenCalledWith(expect.any(String), "approval-submit", "Declined by voice");
    await flush();
    expect(screen.getByText(/^Not done/, { selector: "p.text-lg" })).toBeVisible();
  });

  it('"stop" by voice stops the task and silences speech', async () => {
    const { client } = await startByVoice("scholarship-happy");
    const stop = vi.spyOn(client, "stop");
    await advance(9000);
    expect(synth.current).not.toBeNull();
    speak("stop");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(synth.current).toBeNull();
    await flush();
    expect(document.title).toBe("Stopped — AccessPilot");
  });

  it("says when there is nothing to stop, repeat, or describe yet", () => {
    renderApp();
    speak("stop");
    speak("repeat");
    speak("what's on this page");
    expect(synth.texts).toEqual([
      "Nothing is running.",
      "There's nothing to repeat yet.",
      "I haven't looked at a page yet. Start a task first.",
    ]);
  });

  it("repeat, describe page, and hand-off continue work by voice and shortcut", async () => {
    const { client } = await startByVoice("password-handoff");
    const resume = vi.spyOn(client, "resume");
    await flush();
    act(() => synth.drain());
    synth.spoken = [];
    pressShortcut("KeyR");
    // Repeat reads the hand-off instructions, the thing the user needs right now.
    expect(synth.texts.at(-1)).toBe(
      "Your turn. I don't type passwords. Please type your password in the browser window, then press Continue.",
    );
    speak("what's on this page");
    expect(synth.texts.at(-1)).toMatch(/^Student portal sign in\./);
    speak("continue");
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("tells the user to wait or stop when dictating while a task runs", async () => {
    await startByVoice("scholarship-happy");
    await advance(3000);
    speak("also find the deadline");
    await advance(500);
    expect(liveText("polite")).toMatch(/working on a task. Say “stop”/);
  });

  it("silences built-in speech before listening and holds it while the mic is on", async () => {
    await startByVoice("scholarship-happy");
    await advance(9000);
    const cancelsBefore = synth.cancelCount;
    act(() => {
      pressShortcut("KeyM");
    });
    expect(synth.cancelCount).toBeGreaterThan(cancelsBefore);
    expect(synth.current).toBeNull();
    await advance(500);
    expect(liveText("polite")).toMatch(/Listening…/);
    const spokenWhileListening = synth.spoken.length;
    await advance(5000);
    expect(synth.spoken.length).toBe(spokenWhileListening);
    act(() => FakeRecognition.latest.end());
    await advance(10);
  });

  it("screen reader mode uses only live regions, never built-in speech", async () => {
    settingsStore.update({ screenReaderMode: true, firstRunDone: true });
    await startByVoice("scholarship-happy");
    await flush();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(liveText("assertive")).toMatch(/^Approval needed\./);
    expect(synth.spoken).toEqual([]);
  });

  it("announces microphone errors", () => {
    renderApp();
    act(() => {
      pressShortcut("KeyM");
    });
    act(() => FakeRecognition.latest.fail("not-allowed"));
    expect(liveText("assertive")).toMatch(/^Microphone access is blocked/);
    expect(screen.getByText(/^Microphone access is blocked/, { selector: "p" })).toBeVisible();
  });

  it("explains voice support when the browser has no speech recognition", () => {
    uninstallSpeechRecognition();
    renderApp();
    expect(screen.getByText("Voice input works in Chrome. You can type instead.")).toBeVisible();
    act(() => {
      pressShortcut("KeyM");
    });
    expect(liveText("assertive")).toBe("Voice input works in Chrome. You can type instead.");
  });

  it("the mic shortcut does nothing while typing; Stop still works", async () => {
    const { client } = await startByVoice("scholarship-happy");
    const stop = vi.spyOn(client, "stop");
    await advance(3000);
    // Any text field: the form itself steps aside while a task runs.
    const field = document.body.appendChild(document.createElement("input"));
    const sessions = FakeRecognition.instances.length;
    pressShortcut("KeyM", field);
    expect(FakeRecognition.instances).toHaveLength(sessions);
    pressShortcut("KeyS", field);
    expect(stop).toHaveBeenCalled();
  });

  it("pressing Stop while listening also stops the microphone", async () => {
    await startByVoice("scholarship-happy");
    await advance(3000);
    act(() => {
      pressShortcut("KeyM");
    });
    const engine = FakeRecognition.latest;
    await act(async () => {
      screen.getByRole("button", { name: /^Stop/ }).click();
    });
    expect(engine.aborted).toBe(true);
    expect(screen.getByRole("button", { name: /Microphone/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("Test voice speaks a sample and settings changes apply", async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole("button", { name: "Read aloud for me" }));
    await user.click(screen.getAllByRole("button", { name: "Settings" })[0]!);
    await user.click(screen.getByRole("button", { name: "Test voice" }));
    expect(synth.texts.at(-1)).toBe("This is how AccessPilot sounds.");
    await user.click(screen.getByRole("checkbox", { name: "Read narration aloud" }));
    expect(screen.getByRole("button", { name: "Test voice" })).toBeDisabled();
  });
});
