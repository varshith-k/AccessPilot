import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HandoffPanel } from "@/components/HandoffPanel";

const asked = {
  reason: "other" as const,
  instructions:
    "What is your phone number? Answer here, or type it in the browser window, then press Continue.",
};

describe("HandoffPanel answers", () => {
  it("sends the typed answer with Continue when AccessPilot asked a question", async () => {
    const onContinue = vi.fn();
    render(<HandoffPanel handoff={asked as never} onContinue={onContinue} onStop={() => {}} />);
    await userEvent.type(screen.getByLabelText("Your answer"), "  555-0100 ");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledWith("555-0100");
  });

  it("continues without an answer when the box is empty", async () => {
    const onContinue = vi.fn();
    render(<HandoffPanel handoff={asked as never} onContinue={onContinue} onStop={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledWith(undefined);
  });

  it("shows no answer box for passwords and CAPTCHAs", () => {
    render(
      <HandoffPanel
        handoff={
          { reason: "sensitive_value", instructions: "Type your password in the browser." } as never
        }
        onContinue={() => {}}
        onStop={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Your answer")).toBeNull();
  });
});
