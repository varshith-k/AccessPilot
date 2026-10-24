import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Chat } from "@/components/Chat";
import type { LogEntry } from "@/lib/client/taskState";
import { liveText, renderWithAnnouncer } from "./helpers";

const entry = (id: number, overrides: Partial<LogEntry> = {}): LogEntry => ({
  id: `e${id}`,
  speaker: "assistant",
  text: `Message ${id}`,
  at: "2026-10-25T14:00:00.000Z",
  tone: "info",
  ...overrides,
});

const log = () => screen.getByRole("region", { name: "Conversation history" });

/** jsdom has no layout; give the log a scroll geometry. */
function setGeometry(
  element: HTMLElement,
  { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number },
) {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: clientHeight });
}

describe("Chat", () => {
  it("shows an empty state", async () => {
    const { container } = renderWithAnnouncer(<Chat entries={[]} busy={false} onSend={vi.fn()} />);
    expect(screen.getByText(/Nothing yet/)).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders an ordered log with speaker, text, timestamp, and a text label for tone", async () => {
    const entries = [
      entry(1, { speaker: "user", text: "Apply for me" }),
      entry(2, { text: "Submitted.", tone: "success" }),
      entry(3, { speaker: "system", text: "It broke.", tone: "error" }),
      entry(4, { text: "Check this.", tone: "warning" }),
    ];
    const { container } = renderWithAnnouncer(
      <Chat entries={entries} busy={false} onSend={vi.fn()} />,
    );
    const items = within(log()).getAllByRole("listitem");
    expect(within(log()).getByRole("list").tagName).toBe("OL");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent(/^You.*Apply for me$/);
    expect(items[1]).toHaveTextContent("AccessPilot (Done)");
    expect(items[2]).toHaveTextContent("AccessPilot status (Problem)");
    expect(items[3]).toHaveTextContent("(Needs attention)");
    const time = items[0]!.querySelector("time");
    expect(time).toHaveAttribute("dateTime", "2026-10-25T14:00:00.000Z");
    expect(time?.textContent).not.toBe("");
    expect(log()).toHaveAttribute("tabindex", "0");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders event text as text, never as HTML", () => {
    renderWithAnnouncer(
      <Chat
        entries={[entry(1, { text: "<img src=x onerror=alert(1)>" })]}
        busy={false}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(log().querySelector("img")).toBeNull();
  });

  it("sends a follow-up and clears the field", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockReturnValue({ ok: true });
    renderWithAnnouncer(<Chat entries={[]} busy={false} onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "Message AccessPilot" });
    await user.type(input, "Now find the deadline{Enter}");
    expect(onSend).toHaveBeenCalledWith("Now find the deadline");
    expect(input).toHaveValue("");
  });

  it.each([
    ["empty", "Type a message first."],
    ["no_url", "Enter a website address in the task form above first, then start a task."],
    ["busy", "AccessPilot is working on a task. Wait for it to finish, or press Stop."],
  ] as const)("explains a %s follow-up", async (reason, message) => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockReturnValue({ ok: false, reason });
    renderWithAnnouncer(<Chat entries={[]} busy={false} onSend={onSend} />);
    await user.click(screen.getByRole("button", { name: "Send" }));
    const input = screen.getByRole("textbox", { name: "Message AccessPilot" });
    expect(input).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(liveText("assertive")).toBe(message);
  });

  it("disables follow-ups while busy and explains why", () => {
    renderWithAnnouncer(<Chat entries={[]} busy onSend={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Message AccessPilot" });
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(input).toHaveAccessibleDescription(/when the current task finishes.*press Stop/);
  });

  it("follows new messages at the bottom, pauses when scrolled up, and never moves focus", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithAnnouncer(
      <Chat entries={[entry(1)]} busy={false} onSend={vi.fn()} />,
    );
    const region = log();
    setGeometry(region, { scrollHeight: 1000, clientHeight: 200 });
    const input = screen.getByRole("textbox", { name: "Message AccessPilot" });
    input.focus();

    rerender(<Chat entries={[entry(1), entry(2)]} busy={false} onSend={vi.fn()} />);
    expect(region.scrollTop).toBe(1000);
    expect(input).toHaveFocus();

    region.scrollTop = 100;
    fireEvent.scroll(region);
    setGeometry(region, { scrollHeight: 1200, clientHeight: 200 });
    rerender(<Chat entries={[entry(1), entry(2), entry(3)]} busy={false} onSend={vi.fn()} />);
    expect(region.scrollTop).toBe(100);
    expect(input).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "New messages below. Show latest" }));
    expect(region.scrollTop).toBe(1200);
    expect(screen.queryByRole("button", { name: /Show latest/ })).toBeNull();
  });

  it("resumes following when the user scrolls back to the bottom", () => {
    const { rerender } = renderWithAnnouncer(
      <Chat entries={[entry(1)]} busy={false} onSend={vi.fn()} />,
    );
    const region = log();
    setGeometry(region, { scrollHeight: 1000, clientHeight: 200 });
    region.scrollTop = 0;
    fireEvent.scroll(region);
    rerender(<Chat entries={[entry(1), entry(2)]} busy={false} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Show latest/ })).toBeVisible();

    region.scrollTop = 800;
    fireEvent.scroll(region);
    expect(screen.queryByRole("button", { name: /Show latest/ })).toBeNull();
    setGeometry(region, { scrollHeight: 1300, clientHeight: 200 });
    rerender(<Chat entries={[entry(1), entry(2), entry(3)]} busy={false} onSend={vi.fn()} />);
    expect(region.scrollTop).toBe(1300);
  });

  it("shows no time for an invalid timestamp", () => {
    renderWithAnnouncer(
      <Chat entries={[entry(1, { at: "not a date" })]} busy={false} onSend={vi.fn()} />,
    );
    expect(log().querySelector("time")?.textContent).toBe("");
  });
});
