import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "vitest-axe";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open help
      </button>
      <KeyboardShortcutsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe("KeyboardShortcutsDialog", () => {
  it("lists every shortcut, focuses its heading, and has no axe violations", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open help" }));

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(dialog).getByRole("heading", { name: "Keyboard shortcuts" })).toHaveFocus();
    for (const keys of ["Alt+Shift+S", "Alt+Shift+M", "Alt+Shift+R", "?", "Escape"]) {
      expect(within(dialog).getByText(keys, { selector: "kbd" })).toBeVisible();
    }
    expect(within(dialog).getByText(/Works anywhere, even while typing/)).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("closes with the Close button and returns focus to where it was", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open help" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes with Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open help" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Open help" })).toHaveFocus();
  });
});
