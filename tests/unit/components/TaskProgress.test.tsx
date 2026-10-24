import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { StopButton } from "@/components/StopButton";
import { TaskProgress } from "@/components/TaskProgress";
import { WarningList } from "@/components/WarningList";
import type { StepEntry } from "@/lib/client/taskState";

const steps: StepEntry[] = [
  { step: 1, description: "Filled in your name", status: "completed", action: { type: "type" } },
  { step: 2, description: "Filling in your email", status: "active", action: null },
];

describe("TaskProgress", () => {
  it("states each step's status in words, including pending placeholders", async () => {
    const { container } = render(<TaskProgress steps={steps} totalSteps={4} stillWorking={null} />);
    const items = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "✓Step 1: Filled in your name — Done",
      "▸Step 2: Filling in your email — In progress",
      "○Step 3 — Not started",
      "○Step 4 — Not started",
    ]);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a labelled progress bar when the total is known", () => {
    render(<TaskProgress steps={steps} totalSteps={4} stillWorking={null} />);
    const bar = screen.getByRole("progressbar", { name: "Progress: 1 of about 4 steps done" });
    expect(bar).toHaveAttribute("max", "4");
    expect(bar).toHaveAttribute("value", "1");
  });

  it("omits the bar without a total and marks unfinished steps", () => {
    render(
      <TaskProgress
        steps={[{ step: 1, description: "Submitting", status: "incomplete", action: null }]}
        totalSteps={null}
        stillWorking={null}
      />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("Step 1: Submitting — Didn't finish")).toBeVisible();
  });

  it("shows a still-working message", () => {
    render(<TaskProgress steps={[]} totalSteps={null} stillWorking="Still working." />);
    expect(screen.getByText("Still working.")).toBeVisible();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("StopButton", () => {
  it("is a large, named button with its shortcut", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const { container } = render(<StopButton onStop={onStop} stopping={false} />);
    const button = screen.getByRole("button", { name: "Stop (Alt+Shift+S)" });
    expect(button).toHaveAttribute("aria-keyshortcuts", "Alt+Shift+S");
    expect(button.className).toMatch(/min-h-12/);
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onStop).toHaveBeenCalledTimes(2);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("stays enabled while stopping so it can be pressed again", () => {
    render(<StopButton onStop={vi.fn()} stopping />);
    expect(screen.getByRole("button", { name: /^Stopping…/ })).toBeEnabled();
  });
});

describe("WarningList", () => {
  it("renders nothing without warnings", () => {
    const { container } = render(<WarningList warnings={[]} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists warnings with a dismiss button each", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const { container } = render(
      <WarningList
        warnings={[{ id: "w1", message: "Skipped an update.", count: 1 }]}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText("Skipped an update.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Dismiss warning: Skipped an update." }));
    expect(onDismiss).toHaveBeenCalledWith("w1");
    expect(await axe(container)).toHaveNoViolations();
  });
});
