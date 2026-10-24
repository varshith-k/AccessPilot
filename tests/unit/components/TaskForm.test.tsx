import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "vitest-axe";
import { TaskForm, type TaskFormProps } from "@/components/TaskForm";
import { liveText, renderWithAnnouncer } from "./helpers";

function Harness(props: Partial<TaskFormProps> & { onSubmit?: TaskFormProps["onSubmit"] }) {
  const [url, setUrl] = useState(props.url ?? "");
  const [goal, setGoal] = useState(props.goal ?? "");
  return (
    <TaskForm
      url={url}
      goal={goal}
      onUrlChange={setUrl}
      onGoalChange={setGoal}
      onSubmit={props.onSubmit ?? vi.fn()}
      starting={props.starting ?? false}
      busy={props.busy ?? false}
    />
  );
}

const urlField = () => screen.getByRole("textbox", { name: "Website address" });
const goalField = () => screen.getByRole("textbox", { name: "What do you want to get done?" });

describe("TaskForm", () => {
  it("has labelled fields with hints and no axe violations", async () => {
    const { container } = renderWithAnnouncer(<Harness />);
    expect(urlField()).toHaveAccessibleDescription(/Starts with https:\/\//);
    expect(goalField()).toHaveAccessibleDescription(/scholarship application/);
    expect(screen.getByRole("button", { name: "Start task" })).toBeEnabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submits trimmed values", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithAnnouncer(<Harness onSubmit={onSubmit} />);
    await user.type(urlField(), "  https://example.edu/apply ");
    await user.type(goalField(), " Apply for me ");
    await user.keyboard("{Tab}{Enter}");
    expect(onSubmit).toHaveBeenCalledWith({
      url: "https://example.edu/apply",
      goal: "Apply for me",
    });
  });

  it("shows linked, announced errors and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = renderWithAnnouncer(<Harness onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Start task" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(urlField()).toHaveAttribute("aria-invalid", "true");
    expect(urlField()).toHaveAccessibleDescription(/Enter a website address\./);
    expect(goalField()).toHaveAccessibleDescription(/Describe what you want to get done\./);
    expect(urlField()).toHaveFocus();
    expect(liveText("assertive")).toBe(
      "Please fix 2 problems. Enter a website address. Describe what you want to get done.",
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("explains disallowed URLs and focuses the goal when only it is wrong", async () => {
    const user = userEvent.setup();
    renderWithAnnouncer(<Harness url="http://example.edu" goal="Apply" />);
    await user.click(screen.getByRole("button", { name: "Start task" }));
    expect(urlField()).toHaveAccessibleDescription(/http:\/\/localhost for local testing/);
    expect(liveText("assertive")).toMatch(/^Please fix this: Use a full address/);

    await user.clear(urlField());
    await user.type(urlField(), "https://example.edu");
    await user.clear(goalField());
    await user.click(screen.getByRole("button", { name: "Start task" }));
    expect(goalField()).toHaveFocus();
    expect(urlField()).not.toHaveAttribute("aria-invalid");
  });

  it("disables submit only while starting, and says so", () => {
    renderWithAnnouncer(<Harness starting />);
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    expect(screen.getByText(/Starting your task\./)).toBeVisible();
  });

  it("explains instead of silently ignoring a submit while a task runs", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithAnnouncer(<Harness busy url="https://a.b" goal="x" onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Start task" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/already running\. Press Stop/, { selector: "p" })).toBeVisible();
    expect(liveText("assertive")).toMatch(/already running/);
  });
});
