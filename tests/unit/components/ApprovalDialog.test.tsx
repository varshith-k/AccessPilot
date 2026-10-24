import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { axe } from "vitest-axe";
import { ApprovalDialog } from "@/components/ApprovalDialog";
import type { PendingApproval } from "@/lib/client/taskState";

const approval: PendingApproval = {
  approvalId: "a1",
  action: "Submit application",
  summary: "Submit the scholarship application with these details?",
  fields: [
    { label: "Full name", value: "Ada Lovelace" },
    { label: "Program", value: "Computer Science" },
    { label: "Middle name", value: "" },
  ],
};

/** Mirrors the app: deciding clears the approval, which closes the dialog. */
function Harness({ onApprove = vi.fn(), onDeny = vi.fn() }) {
  const [current, setCurrent] = useState<PendingApproval | null>(null);
  const statusRef = useRef<HTMLHeadingElement>(null);
  return (
    <>
      <h2 ref={statusRef} tabIndex={-1}>
        Status
      </h2>
      <button type="button" onClick={() => setCurrent(approval)}>
        Open
      </button>
      <ApprovalDialog
        approval={current}
        onApprove={() => {
          onApprove();
          setCurrent(null);
        }}
        onDeny={() => {
          onDeny();
          setCurrent(null);
        }}
        returnFocusRef={statusRef}
      />
    </>
  );
}

async function openDialog(props: Parameters<typeof Harness>[0] = {}) {
  const user = userEvent.setup();
  const view = render(<Harness {...props} />);
  await user.click(screen.getByRole("button", { name: "Open" }));
  return { user, ...view, dialog: screen.getByRole("dialog") };
}

describe("ApprovalDialog", () => {
  it("is closed while there is nothing to approve", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens modally with focus on the heading, never on Approve", async () => {
    const { dialog } = await openDialog();
    const heading = within(dialog).getByRole("heading", {
      name: "Approval needed: Submit application",
    });
    expect(dialog).toHaveAttribute("open");
    expect(heading).toHaveFocus();
    expect(dialog).toHaveAccessibleName("Approval needed: Submit application");
    expect(dialog).toHaveAccessibleDescription(approval.summary);
    expect(within(dialog).getByRole("button", { name: "Approve and submit" })).not.toHaveFocus();
  });

  it("lists every field as a definition list, marking empty values", async () => {
    const { dialog, container } = await openDialog();
    const terms = within(dialog)
      .getAllByRole("term")
      .map((term) => term.textContent);
    const definitions = within(dialog)
      .getAllByRole("definition")
      .map((d) => d.textContent);
    expect(terms).toEqual(["Full name", "Program", "Middle name"]);
    expect(definitions).toEqual(["Ada Lovelace", "Computer Science", "(empty)"]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("puts Don't submit before Approve in tab order", async () => {
    const { dialog, user } = await openDialog();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Don't submit" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Approve and submit" })).toHaveFocus();
  });

  it("approves only through the Approve button, then returns focus to the status area", async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const { dialog, user } = await openDialog({ onApprove, onDeny });
    await user.click(within(dialog).getByRole("button", { name: "Approve and submit" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDeny).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Status" })).toHaveFocus();
  });

  it("treats Escape as Don't submit and never approves", async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const { user } = await openDialog({ onApprove, onDeny });
    await user.keyboard("{Escape}");
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Status" })).toHaveFocus();
  });

  it("denies with the Don't submit button via keyboard", async () => {
    const onDeny = vi.fn();
    const { user } = await openDialog({ onDeny });
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("treats a browser-initiated close while pending as a refusal", async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const { dialog } = await openDialog({ onApprove, onDeny });
    fireEvent(dialog, new Event("close"));
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("never times out into an approval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onApprove = vi.fn();
    await openDialog({ onApprove });
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    vi.useRealTimers();
  });

  it("omits the list when there are no fields", () => {
    const statusRef = { current: null };
    render(
      <ApprovalDialog
        approval={{ ...approval, fields: [] }}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        returnFocusRef={statusRef}
      />,
    );
    expect(screen.queryByRole("term")).toBeNull();
  });
});
