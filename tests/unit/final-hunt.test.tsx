/** Regression tests for the final bug hunt (simulated users on the redesigned app). */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileSection } from "@/components/ProfileSection";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { describeStep } from "@/lib/client/announcements";
import { isAllowedTaskUrl } from "@/lib/contracts";
import { statusSentence } from "@/lib/client/statusText";
import { parseVoiceCommand } from "@/lib/client/voiceCommands";
import { makeEvent, reach, running } from "./client/fixtures";
import { liveText, renderWithAnnouncer } from "./components/helpers";

const approval = { approvalOpen: true, handoffActive: false };
const idle = { approvalOpen: false, handoffActive: false };

describe("voice", () => {
  it.each(["submit it?", "Approve?", "yes?", "go ahead?"])(
    "a question never approves: %s",
    (text) => {
      expect(parseVoiceCommand(text, approval)).toEqual({ kind: "unclear_approval" });
    },
  );

  it("still approves the same words said as an answer", () => {
    expect(parseVoiceCommand("Submit it.", approval)).toEqual({ kind: "approve" });
  });

  it.each(["start a new task", "new task", "start over"])("%s starts a new task", (text) => {
    expect(parseVoiceCommand(text, idle)).toEqual({ kind: "new_task" });
  });
});

describe("wording", () => {
  it("drops 'of about N' when the estimate isn't ahead of the step", () => {
    expect(describeStep(4, 4, "Typing")).toBe("Step 4: Typing");
    expect(describeStep(5, 4, "Typing")).toBe("Step 5: Typing");
    expect(describeStep(2, 6, "Typing")).toBe("Step 2 of about 6: Typing");
  });

  it("doesn't promise a next step after the last one", () => {
    const state = reach(
      [
        makeEvent("step.started", { step: 6, totalSteps: 6, description: "Submitting" }),
        makeEvent("step.completed", { step: 6, description: "Submitted" }),
      ],
      running(),
    );
    expect(statusSentence(state)).toBe("Step 6: Submitted (done). Finishing up…");
  });

  it("a declined task's badge says Not submitted, not Completed", () => {
    render(<StatusBadge status="completed" declined hidden={false} />);
    expect(screen.getByText("Not submitted")).toBeInTheDocument();
    expect(screen.queryByText("Completed")).toBeNull();
  });
});

describe("addresses", () => {
  it.each([
    "https://169.254.169.254/latest/meta-data/",
    "https://10.0.0.5/",
    "https://172.20.1.1/",
  ])("refuses private and cloud-metadata addresses up front: %s", (url) => {
    expect(isAllowedTaskUrl(url)).toBe(false);
  });

  it("still allows public addresses and local testing", () => {
    expect(isAllowedTaskUrl("https://8.8.8.8/")).toBe(true);
    expect(isAllowedTaskUrl("http://localhost:4000/scholarship")).toBe(true);
  });
});

describe("Your details", () => {
  beforeEach(() => window.localStorage.clear());

  it("flags an invalid email and phone, linked to the field", async () => {
    const user = userEvent.setup();
    renderWithAnnouncer(<ProfileSection />);
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription(/doesn't look like an email address/);
    await user.type(screen.getByLabelText("Phone"), "abc!!");
    expect(screen.getByLabelText("Phone")).toHaveAttribute("aria-invalid", "true");
    await user.clear(email);
    await user.type(email, "ada@example.edu");
    expect(email).not.toHaveAttribute("aria-invalid");
  });

  it("announces when details are cleared", async () => {
    const user = userEvent.setup();
    renderWithAnnouncer(<ProfileSection />);
    await user.type(screen.getByLabelText("Full name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Clear my details" }));
    await waitFor(() => expect(liveText("polite")).toBe("Your details were cleared."));
    expect(screen.getByLabelText("Full name")).toHaveValue("");
  });
});
