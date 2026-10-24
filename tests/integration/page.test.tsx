import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "@/app/page";
import { MockTaskClient } from "@/lib/client/MockTaskClient";
import type { MockScenarioName } from "@/lib/client/mock/scenarios";
import { settingsStore } from "@/lib/client/settings";
import {
  installSpeechSynthesis,
  uninstallSpeechSynthesis,
  type FakeSpeechSynthesis,
} from "../fakes/speech";
import { liveText } from "../unit/components/helpers";

/** Advances time in steps so React commits effects (like subscribing) between them. */
async function advance(ms: number, step = 250) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(step, ms - elapsed));
    });
  }
}

/** Advances until `check` passes, so assertions don't depend on exact script timing. */
async function advanceUntil(check: () => boolean, limitMs = 120_000) {
  for (let elapsed = 0; elapsed < limitMs && !check(); elapsed += 250) await advance(250);
  expect(check()).toBe(true);
}

const polite = () => liveText("polite");
const assertive = () => liveText("assertive");

let synth: FakeSpeechSynthesis;

function openPage(scenario: MockScenarioName) {
  window.history.replaceState(null, "", `/?mock=${scenario}`);
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  render(<Home />);
  return user;
}

/** Fills the form and starts the task using only the keyboard. */
async function startWithKeyboard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Read aloud for me" }));
  screen.getByRole("textbox", { name: "Website address" }).focus();
  await user.keyboard("http://localhost:4000/scholarship");
  await user.tab();
  expect(screen.getByRole("textbox", { name: "What do you want to get done?" })).toHaveFocus();
  await user.keyboard("Help me complete this scholarship application.");
  await user.tab();
  expect(screen.getByRole("button", { name: "Start task" })).toHaveFocus();
  await user.keyboard("{Enter}");
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  settingsStore.reload();
  synth = installSpeechSynthesis();
});

afterEach(() => {
  vi.useRealTimers();
  uninstallSpeechSynthesis();
  window.history.replaceState(null, "", "/");
  document.title = "";
});

describe("AccessPilot page (integration, MockTaskClient)", () => {
  it("happy path by keyboard: page map, steps, approval, approve, completed", async () => {
    const user = openPage("scholarship-happy");
    await startWithKeyboard(user);

    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    await advance(500);
    expect(polite()).toMatch(/Starting your task\./);

    await advanceUntil(() => polite().includes("This page has a login link"));
    expect(polite()).toMatch(/^Gator Futures Scholarship application\./);

    await advanceUntil(() => polite().includes("Step 3 of about 6: Choosing a program"));
    expect(
      screen.getByText("Step 3 of about 6: Choosing a program", { selector: "p.text-lg" }),
    ).toBeVisible();
    expect(document.title).toBe("Working — AccessPilot");

    await advanceUntil(() => screen.queryByRole("dialog") !== null);
    const dialog = screen.getByRole("dialog");
    expect(assertive()).toBe(
      "Approval needed. Submit the Gator Futures Scholarship application with these details? Nothing happens until you choose.",
    );
    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveFocus();
    expect(within(dialog).getByText("Computer Science")).toBeVisible();
    expect(document.title).toBe("Waiting for your approval — AccessPilot");

    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Don't submit" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Approve and submit" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Status" })).toHaveFocus();
    await advanceUntil(() => assertive() === "Submitted. Confirmation number 4821.");
    expect(document.title).toBe("Done — AccessPilot");
    expect(screen.getByRole("img", { name: /Confirmation number 4821/ })).toBeVisible();
    expect(synth.texts).toContain(
      "Approval needed. Submit the Gator Futures Scholarship application with these details? Nothing happens until you choose.",
    );
  });

  it("deny path: Escape means don't submit and the task ends not submitted", async () => {
    const user = openPage("scholarship-deny");
    const deny = vi.spyOn(MockTaskClient.prototype, "deny");
    const approve = vi.spyOn(MockTaskClient.prototype, "approve");
    await startWithKeyboard(user);
    await advanceUntil(() => screen.queryByRole("dialog") !== null);

    await user.keyboard("{Escape}");
    expect(deny).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    await advanceUntil(() => assertive().startsWith("Not submitted."));
    expect(approve).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start a new task" })).toBeVisible();
  });

  it("stop mid-run from the global shortcut cancels speech, calls stop, and announces it", async () => {
    const user = openPage("scholarship-happy");
    const stop = vi.spyOn(MockTaskClient.prototype, "stop");
    await startWithKeyboard(user);
    await advanceUntil(() => polite().includes("Step 2 of about 6"));
    expect(synth.current).not.toBeNull();
    const cancels = synth.cancelCount;

    fireEvent.keyDown(document.activeElement ?? document.body, {
      code: "KeyS",
      altKey: true,
      shiftKey: true,
    });
    expect(synth.cancelCount).toBeGreaterThan(cancels);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(assertive()).toBe("Stopping.");

    await advanceUntil(() => assertive().startsWith("Stopped."));
    expect(document.title).toBe("Stopped — AccessPilot");
    const logLength = screen.getAllByRole("listitem").length;
    await advance(20_000, 1000);
    expect(screen.getAllByRole("listitem")).toHaveLength(logLength);
  });

  it("password hand-off: panel appears, focus moves to it, Continue resumes", async () => {
    const user = openPage("password-handoff");
    const resume = vi.spyOn(MockTaskClient.prototype, "resume");
    await startWithKeyboard(user);
    await advanceUntil(() => screen.queryByRole("heading", { name: "Your turn" }) !== null);

    expect(screen.getByRole("heading", { name: "Your turn" })).toHaveFocus();
    expect(assertive()).toBe(
      "Your turn. I don't type passwords. Please type your password in the browser window, then press Continue.",
    );
    expect(document.title).toBe("Your turn — AccessPilot");
    await user.tab();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(resume).toHaveBeenCalledTimes(1);
    await advanceUntil(() => assertive() === "Signed in. You're on your dashboard.");
  });

  it("failure path shows a recoverable error with a retry option", async () => {
    const user = openPage("failure");
    await startWithKeyboard(user);
    await advanceUntil(() => assertive().startsWith("Task failed."));
    expect(assertive()).toMatch(/couldn't open the program dropdown.*You can try again\.$/);
    expect(document.title).toBe("Problem — AccessPilot");
    expect(screen.getByRole("heading", { name: /The task didn't finish/ })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Starting your task…", { selector: "p.text-lg" })).toBeVisible();
  });

  it("slow network shows still-working messages, then finishes", async () => {
    const user = openPage("slow-network");
    await startWithKeyboard(user);
    await advanceUntil(() => screen.queryByText(/Still working/) !== null, 30_000);
    await advanceUntil(() => assertive() === "The application deadline is March 1, 2027.", 200_000);
  });

  it("? opens the keyboard shortcuts list, Escape closes it and restores focus", async () => {
    const user = openPage("scholarship-happy");
    await user.click(screen.getByRole("button", { name: "Read aloud for me" }));
    const start = screen.getByRole("button", { name: "Start task" });
    start.focus();
    await user.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(dialog).getByRole("heading", { name: "Keyboard shortcuts" })).toHaveFocus();
    expect(within(dialog).getByText("Alt+Shift+S")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(start).toHaveFocus();

    screen.getByRole("textbox", { name: "What do you want to get done?" }).focus();
    await user.keyboard("?");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: "What do you want to get done?" })).toHaveValue("?");
  });
});
