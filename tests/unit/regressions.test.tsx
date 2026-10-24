/**
 * Regression tests for problems found by simulated end-to-end user testing (screen reader,
 * voice, low-vision, adversarial, and everyday-flow personas).
 */
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useEffect, type ReactNode } from "react";
import { AccessPilotApp } from "@/components/AccessPilotApp";
import { StatusAnnouncer } from "@/components/StatusAnnouncer";
import { AnnouncerProvider, useAnnouncer, POLITE_COALESCE_MS } from "@/hooks/useAnnouncer";
import { useStickyFits } from "@/hooks/useStickyFits";
import { mostImportantMessage } from "@/hooks/useTaskSession";
import { announcementFor } from "@/lib/client/announcements";
import { MockTaskClient } from "@/lib/client/MockTaskClient";
import { settingsStore } from "@/lib/client/settings";
import { documentTitle, statusSentence } from "@/lib/client/statusText";
import { STOPPED_BY_USER_TEXT, transition } from "@/lib/client/taskState";
import type { TaskClient } from "@/lib/client/types";
import {
  FakeRecognition,
  installSpeechRecognition,
  installSpeechSynthesis,
  uninstallSpeechRecognition,
  uninstallSpeechSynthesis,
  type FakeSpeechSynthesis,
} from "../fakes/speech";
import {
  awaitingApproval,
  awaitingUser,
  completed,
  failed,
  makeEvent,
  makeUiAction,
  planning,
  reach,
  running,
} from "./client/fixtures";
import { liveText } from "./components/helpers";

describe("live regions inside modal dialogs", () => {
  function Announce({ text, when }: { text: string; when: number }) {
    const { announce } = useAnnouncer();
    useEffect(() => {
      if (when > 0) announce(text, "assertive");
    }, [announce, text, when]);
    return null;
  }

  it("a dialog's own live region carries only messages announced after it opened", () => {
    const { rerender } = render(
      <AnnouncerProvider>
        <Announce text="Approval needed." when={1} />
        <StatusAnnouncer />
      </AnnouncerProvider>,
    );
    rerender(
      <AnnouncerProvider>
        <Announce text="Approval needed." when={1} />
        <StatusAnnouncer />
        <StatusAnnouncer local />
      </AnnouncerProvider>,
    );
    expect(screen.getByTestId("live-assertive-local")).toHaveTextContent("");
    rerender(
      <AnnouncerProvider>
        <Announce text="Nothing was submitted." when={2} />
        <StatusAnnouncer />
        <StatusAnnouncer local />
      </AnnouncerProvider>,
    );
    expect(screen.getByTestId("live-assertive-local")).toHaveTextContent("Nothing was submitted.");
  });
});

describe("announcer", () => {
  it("re-announces repeated text in React strict mode (the zero-width marker alternates)", () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <AnnouncerProvider>
          {children}
          <StatusAnnouncer />
        </AnnouncerProvider>
      </StrictMode>
    );
    const { result } = renderHook(() => useAnnouncer(), { wrapper });
    const texts: string[] = [];
    for (let i = 0; i < 3; i++) {
      act(() => result.current.announce("Typing your email.", "polite"));
      act(() => vi.advanceTimersByTime(POLITE_COALESCE_MS + 2100));
      texts.push(screen.getByTestId("live-polite").textContent ?? "");
    }
    expect(texts[0]).not.toBe(texts[1]);
    expect(texts[1]).not.toBe(texts[2]);
    vi.useRealTimers();
  });

  it("merged polite messages read as separate sentences", () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AnnouncerProvider>
        {children}
        <StatusAnnouncer />
      </AnnouncerProvider>
    );
    const { result } = renderHook(() => useAnnouncer(), { wrapper });
    act(() => {
      result.current.announce("Step 1 of about 6: Filling in your name", "polite");
      result.current.announce("Typing your name: Ada Lovelace.", "polite");
    });
    act(() => vi.advanceTimersByTime(POLITE_COALESCE_MS));
    expect(liveText("polite")).toBe(
      "Step 1 of about 6: Filling in your name. Typing your name: Ada Lovelace.",
    );
    vi.useRealTimers();
  });
});

describe("wording", () => {
  it("does not say 'You can try again' twice", () => {
    const event = makeEvent("task.failed", {
      message: "Nothing was submitted. You can try again.",
    });
    expect(announcementFor(event, null)?.text).toBe(
      "Task failed. Nothing was submitted. You can try again.",
    );
  });

  it("a declined submission is titled 'Not submitted', not 'Done', and isn't marked as success", () => {
    const state = reach(
      [
        { type: "ui/decision_sent", decision: "deny", at: "2026-10-25T14:00:00.000Z" },
        makeEvent("task.completed", { summary: "Not submitted." }),
      ],
      awaitingApproval(),
    );
    expect(documentTitle(state)).toBe("Not submitted — AccessPilot");
    expect(state.log.at(-1)?.tone).toBe("info");
    expect(documentTitle(completed())).toBe("Done — AccessPilot");
  });

  it("status says Continuing after Continue, Stopping while stopping, and words a finished step", () => {
    expect(statusSentence(reach([makeUiAction("ui/resume_sent")], awaitingUser()))).toMatch(
      /^Continuing\./,
    );
    expect(statusSentence({ ...planning(), stopping: true })).toBe("Stopping…");
    const done = reach([makeEvent("step.started"), makeEvent("step.completed")], running());
    expect(statusSentence(done)).toBe(
      "Step 1 of about 6: Filled in your name (done). Working on the next step…",
    );
  });

  it("a new attempt is separated in the conversation", () => {
    const state = reach([makeUiAction("ui/start_requested")], failed());
    expect(state.log.slice(-2).map((entry) => entry.text)).toEqual(["New task.", "Apply"]);
  });

  it("identical warnings are merged with a count", () => {
    const state = reach(
      [makeUiAction("ui/warning"), makeUiAction("ui/warning"), makeUiAction("ui/warning")],
      running(),
    );
    expect(state.warnings).toEqual([expect.objectContaining({ count: 3 })]);
  });

  it("an approval that arrives before the page map still opens the dialog", () => {
    const result = transition(planning(), makeEvent("approval.required"));
    expect(result.ignored).toBeNull();
    expect(result.state.status).toBe("awaiting_approval");
  });
});

describe("repeat says what matters most", () => {
  it.each([
    [
      "approval, with every field",
      awaitingApproval,
      /^Approval needed\. Submit the application\? .*Nothing happens until you choose\.$/,
    ],
    ["hand-off instructions", awaitingUser, "Your turn. Type your password, then press Continue."],
    ["the outcome", completed, "Submitted. Confirmation number 4821."],
    ["the error", failed, "It broke."],
  ] as const)("%s", (_label, make, expected) => {
    const text = mostImportantMessage(make());
    if (typeof expected === "string") expect(text).toBe(expected);
    else expect(text).toMatch(expected);
  });

  it("falls back to narration, then the page map", () => {
    expect(mostImportantMessage(running())).toBe("Scholarship. This page has a form.");
    expect(mostImportantMessage(reach([makeEvent("narration")], running()))).toBe(
      "Typing your name.",
    );
    expect(mostImportantMessage({ ...completed(), status: "stopped", stoppedBy: "user" })).toBe(
      STOPPED_BY_USER_TEXT,
    );
  });
});

describe("sticky status panel", () => {
  it("only sticks while it fits in under 30% of the viewport", () => {
    const element = document.createElement("div");
    Object.defineProperty(element, "offsetHeight", { value: 150, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const ref = { current: element };
    const { result, rerender } = renderHook(({ on }) => useStickyFits(ref, on), {
      initialProps: { on: true },
    });
    expect(result.current).toBe(true);
    Object.defineProperty(element, "offsetHeight", { value: 542, configurable: true });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(result.current).toBe(false);
    rerender({ on: false });
    expect(result.current).toBe(false);
  });
});

describe("app flows", () => {
  let synth: FakeSpeechSynthesis;

  async function advance(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 250) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
    }
  }
  async function until(check: () => boolean) {
    for (let i = 0; i < 400 && !check(); i++) await advance(250);
    expect(check()).toBe(true);
  }
  const speak = (words: string) => {
    act(() => {
      fireEvent.keyDown(document.body, { code: "KeyM", altKey: true, shiftKey: true });
    });
    act(() => FakeRecognition.latest.say(words));
  };

  function renderApp(
    client: TaskClient = new MockTaskClient({ scenario: "scholarship-happy", speed: 0.05 }),
  ) {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(<AccessPilotApp client={client} />);
    return user;
  }

  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(
      screen.getByRole("textbox", { name: "Website address" }),
      "http://localhost:4000/scholarship",
    );
    await user.type(
      screen.getByRole("textbox", { name: "What do you want to get done?" }),
      "Apply",
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    settingsStore.update({ firstRunDone: true, readAloud: true, screenReaderMode: false });
    synth = installSpeechSynthesis();
    installSpeechRecognition();
  });
  afterEach(() => {
    vi.useRealTimers();
    uninstallSpeechSynthesis();
    uninstallSpeechRecognition();
  });

  it("focus moves to Status instead of <body> when Start task becomes disabled", async () => {
    const user = renderApp();
    await fill(user);
    screen.getByRole("button", { name: "Start task" }).focus();
    await user.keyboard("{Enter}");
    await advance(250);
    expect(screen.getByRole("heading", { name: "Status" })).toHaveFocus();
  });

  it("focus moves to the error panel on failure, and back to Status after Try again", async () => {
    const user = renderApp(new MockTaskClient({ scenario: "failure", speed: 0.05 }));
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Start task" }));
    await until(() => screen.queryByRole("heading", { name: /The task didn't finish/ }) !== null);
    await advance(250);
    expect(screen.getByRole("heading", { name: /The task didn't finish/ })).toHaveFocus();
    await user.keyboard("{Tab}{Enter}");
    await advance(250);
    expect(screen.getByRole("heading", { name: "Status" })).toHaveFocus();
  });

  it("focus moves to Status after Continue in a hand-off", async () => {
    const user = renderApp(new MockTaskClient({ scenario: "password-handoff", speed: 0.05 }));
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Start task" }));
    await until(() => screen.queryByRole("heading", { name: "Your turn" }) !== null);
    await user.keyboard("{Tab}{Enter}");
    await advance(250);
    expect(screen.getByRole("heading", { name: "Status" })).toHaveFocus();
  });

  it("the shortcuts list closes when an approval question arrives; ? during approval explains", async () => {
    const user = renderApp();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Start task" }));
    fireEvent.keyDown(document.body, { key: "?", code: "Slash" });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await until(() => screen.queryByRole("dialog", { name: /Approval needed/ }) !== null);
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "?", code: "Slash" });
    expect(liveText("assertive")).toBe(
      "Answer the approval question first. Escape means don't submit.",
    );
  });

  it("Alt+Shift+S with nothing running says so", () => {
    renderApp();
    fireEvent.keyDown(document.body, { code: "KeyS", altKey: true, shiftKey: true });
    expect(synth.texts).toContain("Nothing is running.");
  });

  it("microphone errors are spoken in read-aloud mode", () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(document.body, { code: "KeyM", altKey: true, shiftKey: true });
    });
    act(() => {
      FakeRecognition.latest.fail("not-allowed");
      FakeRecognition.latest.end();
    });
    expect(synth.texts.at(-1)).toMatch(/^Microphone access is blocked/);
  });

  it("saying nothing gets feedback; 'yes' with nothing to approve doesn't overwrite the goal", () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(document.body, { code: "KeyM", altKey: true, shiftKey: true });
    });
    act(() => FakeRecognition.latest.end());
    expect(synth.texts.at(-1)).toBe("I didn't hear anything. Try again, or type instead.");
    speak("Help me apply");
    speak("yes");
    expect(synth.texts.at(-1)).toBe("There's nothing waiting for your approval right now.");
    expect(screen.getByRole("textbox", { name: "What do you want to get done?" })).toHaveValue(
      "Help me apply",
    );
  });

  it("dictation adds to the goal, 'clear the goal' empties it, and 'start task' starts", async () => {
    const user = renderApp();
    await user.type(
      screen.getByRole("textbox", { name: "Website address" }),
      "http://localhost:4000/x",
    );
    speak("Fill in my application");
    speak("and use my school email");
    const goal = screen.getByRole("textbox", { name: "What do you want to get done?" });
    expect(goal).toHaveValue("Fill in my application and use my school email");
    speak("clear the goal");
    expect(goal).toHaveValue("");
    speak("start task");
    expect(liveText("assertive")).toMatch(
      /^I can't start yet\. Describe what you want to get done\./,
    );
    speak("Apply for me");
    speak("start task");
    expect(screen.getByText("Starting your task…", { selector: "p.text-lg" })).toBeVisible();
  });

  it("words spoken during a hand-off are never shown, and get hand-off guidance", async () => {
    const user = renderApp(new MockTaskClient({ scenario: "password-handoff", speed: 0.05 }));
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Start task" }));
    await until(() => screen.queryByRole("heading", { name: "Your turn" }) !== null);
    speak("my password is hunter2");
    expect(document.body.textContent).not.toContain("hunter2");
    expect(synth.texts.at(-1)).toMatch(/^AccessPilot is waiting for you\./);
  });

  it("follow-ups are validated like the form and can use the form's address", async () => {
    const user = renderApp();
    await user.type(
      screen.getByRole("textbox", { name: "Website address" }),
      "http://localhost:4000/x",
    );
    const message = screen.getByRole("textbox", { name: "Message AccessPilot" });
    fireEvent.change(message, { target: { value: "x".repeat(1001) } });
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(
      screen.getByText("Keep the goal under 1000 characters.", { selector: "p" }),
    ).toBeVisible();
    fireEvent.change(message, { target: { value: "Find the deadline" } });
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("textbox", { name: "What do you want to get done?" })).toHaveValue(
      "Find the deadline",
    );
    expect(screen.getByText("Starting your task…", { selector: "p.text-lg" })).toBeVisible();
  });

  it("the first-run question is skipped when the browser can't speak", () => {
    settingsStore.update({ firstRunDone: false });
    uninstallSpeechSynthesis();
    renderApp();
    expect(screen.queryByRole("heading", { name: /Do you use your own screen reader/ })).toBeNull();
  });

  it("the approval dialog has its own microphone button", async () => {
    const user = renderApp();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Start task" }));
    await until(() => screen.queryByRole("dialog") !== null);
    const mic = within(screen.getByRole("dialog")).getByRole("button", { name: "Answer by voice" });
    await user.click(mic);
    expect(mic).toHaveAttribute("aria-pressed", "true");
    act(() => FakeRecognition.latest.say("approve"));
    await until(() => liveText("assertive") === "Submitted. Confirmation number 4821.");
  });
});
