import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { AccessPilotApp } from "@/components/AccessPilotApp";
import { MockTaskClient } from "@/lib/client/MockTaskClient";
import type { MockScenarioName } from "@/lib/client/mock/scenarios";
import type { TaskClient } from "@/lib/client/types";
import { liveText } from "./helpers";

async function flush() {
  for (let round = 0; round < 50 && vi.getTimerCount() > 0; round++) {
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
  }
}

/** Advances time in 500ms steps so React commits effects (like subscribing) between steps. */
async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 500) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(500, ms - elapsed));
    });
  }
}

async function startApp(scenario: MockScenarioName) {
  const client = new MockTaskClient({ scenario });
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  const view = render(<AccessPilotApp client={client} />);
  await user.type(
    screen.getByRole("textbox", { name: "Website address" }),
    "http://localhost:4000/scholarship",
  );
  await user.type(
    screen.getByRole("textbox", { name: "What do you want to get done?" }),
    "Help me complete this scholarship application.",
  );
  await user.click(screen.getByRole("button", { name: "Start task" }));
  return { client, user, ...view };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.title = "";
});

describe("AccessPilotApp", () => {
  it("renders the idle layout without axe violations", async () => {
    vi.useRealTimers();
    const { container } = render(<AccessPilotApp client={new MockTaskClient()} />);
    expect(screen.getByText(/^Ready\./)).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Stop/ })).toBeNull();
    expect(screen.getByText(/No screenshots yet/)).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("runs the happy path to an approval and completes after Approve", async () => {
    const { user, container } = await startApp("scholarship-happy");
    expect(screen.getByRole("button", { name: /^Stop/ })).toBeVisible();
    await flush();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveFocus();
    expect(document.title).toBe("Waiting for your approval — AccessPilot");
    expect(liveText("assertive")).toMatch(/^Approval needed\./);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "?", code: "Slash" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByRole("img", { name: /Submit button is focused but not pressed/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "Progress: 5 of about 6 steps done" }),
    ).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Approve and submit" }));
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Status" })).toHaveFocus();
    expect(document.title).toBe("Done — AccessPilot");
    expect(liveText("assertive")).toBe("Submitted. Confirmation number 4821.");
    expect(screen.queryByRole("button", { name: /^Stop/ })).toBeNull();
    vi.useRealTimers();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("stops from the global shortcut, even while typing in a field", async () => {
    const { client } = await startApp("scholarship-happy");
    const stop = vi.spyOn(client, "stop");
    await advance(5000);
    expect(screen.getByText(/^Step 1 of about 6/, { selector: "p.text-lg" })).toBeVisible();
    // Any text field: the form itself steps aside while a task runs.
    const field = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(field, {
      code: "KeyS",
      altKey: true,
      shiftKey: true,
    });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(liveText("assertive")).toBe("Stopping.");
    await flush();
    expect(
      screen.getByText(/^Stopped\. AccessPilot will not do anything else/, {
        selector: "p.text-lg",
      }),
    ).toBeVisible();
    expect(document.title).toBe("Stopped — AccessPilot");
  });

  it("hands off, moves focus to the panel, and Continue resumes", async () => {
    const { client, user } = await startApp("password-handoff");
    const resume = vi.spyOn(client, "resume");
    await flush();
    expect(screen.getByRole("heading", { name: "Your turn" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(resume).toHaveBeenCalledTimes(1);
    await flush();
    expect(
      screen.getByText("Signed in. You're on your dashboard.", { selector: "p.text-lg" }),
    ).toBeVisible();
  });

  it("shows a recoverable failure with Try again, and Start a different task resets", async () => {
    const { user } = await startApp("failure");
    await flush();
    expect(screen.getByRole("heading", { name: /The task didn't finish/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Start a different task" }));
    expect(screen.getByText(/^Ready\./)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Start a task" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Start task" }));
    await flush();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Starting your task…")).toBeVisible();
  });

  it("offers Start a new task after completion", async () => {
    const { user } = await startApp("scholarship-deny");
    await flush();
    await user.keyboard("{Escape}");
    await flush();
    expect(screen.getByText(/^Not submitted/, { selector: "p.text-lg" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Start a new task" }));
    expect(screen.getByText(/^Ready\./)).toBeVisible();
  });

  it("shows and announces still-working messages when the backend goes quiet", async () => {
    const quiet: TaskClient = {
      start: async () => ({ taskId: "quiet" }),
      subscribe: (taskId, onEvent) => {
        const timer = setTimeout(
          () =>
            onEvent({
              type: "task.started",
              taskId,
              seq: 1,
              at: new Date().toISOString(),
              url: "https://example.edu",
              goal: "Wait",
            }),
          0,
        );
        return () => clearTimeout(timer);
      },
      approve: async () => undefined,
      deny: async () => undefined,
      resume: async () => undefined,
      stop: async () => undefined,
    };
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(<AccessPilotApp client={quiet} />);
    await user.type(
      screen.getByRole("textbox", { name: "Website address" }),
      "https://example.edu",
    );
    await user.type(screen.getByRole("textbox", { name: "What do you want to get done?" }), "Wait");
    await user.click(screen.getByRole("button", { name: "Start task" }));
    await advance(1000);
    expect(screen.queryByText(/Still working/)).toBeNull();
    await advance(8000);
    expect(
      screen.getByText(/Still working\. The website is taking a while to respond\./),
    ).toBeVisible();
    await advance(500);
    expect(liveText("polite")).toMatch(/Still working/);
  });
});
