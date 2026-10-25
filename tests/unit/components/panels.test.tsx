import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "vitest-axe";
import { BrowserPreview } from "@/components/BrowserPreview";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HandoffPanel } from "@/components/HandoffPanel";
import { mockScreenshots } from "@/lib/client/mock/screenshots";
import type { ScreenshotEntry } from "@/lib/client/taskState";

describe("HandoffPanel", () => {
  it("moves focus to its heading and explains exactly what to do", async () => {
    const { container } = render(
      <HandoffPanel
        handoff={{
          reason: "sensitive_value",
          instructions: "Please type your password in the browser window, then press Continue.",
        }}
        onContinue={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Your turn" })).toHaveFocus();
    expect(screen.getByText(/never types those for you/)).toBeVisible();
    expect(screen.getByText(/type your password in the browser window/)).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each([
    ["captcha", /CAPTCHA/],
    ["login", /sign in yourself/],
    ["other", /This step needs you/],
  ] as const)("describes the %s reason", (reason, text) => {
    render(
      <HandoffPanel
        handoff={{ reason, instructions: "Do it." }}
        onContinue={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText(text)).toBeVisible();
  });

  it("Continue resumes and the Stop option stops", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onStop = vi.fn();
    render(
      <HandoffPanel
        handoff={{ reason: "captcha", instructions: "Solve it." }}
        onContinue={onContinue}
        onStop={onStop}
      />,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Stop the task instead" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

const shot = (n: number, overrides: Partial<ScreenshotEntry> = {}): ScreenshotEntry => ({
  id: `s${n}`,
  step: n,
  imageDataUrl: mockScreenshots.formName,
  alt: `Screenshot description ${n}`,
  at: "2026-10-25T14:00:00.000Z",
  ...overrides,
});

function PreviewHarness({ initial }: { initial: ScreenshotEntry[] }) {
  const [shots, setShots] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setShots((s) => [...s, shot(s.length + 1)])}>
        Add
      </button>
      <BrowserPreview screenshots={shots} />
    </>
  );
}

describe("BrowserPreview", () => {
  it("shows an informative empty state", async () => {
    const { container } = render(<BrowserPreview screenshots={[]} />);
    expect(screen.getByText(/No screenshots yet/)).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows the latest screenshot with its alt text and a visible caption", async () => {
    const { container } = render(<BrowserPreview screenshots={[shot(0), shot(1), shot(2)]} />);
    const image = screen.getByRole("img", { name: "Screenshot description 2" });
    expect(image).toHaveAttribute("src", mockScreenshots.formName);
    expect(screen.getByText("Screenshot 3 of 3, from step 2 (latest)")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next screenshot" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("reviews history with Previous and Next, and returns to the latest", async () => {
    const user = userEvent.setup();
    render(<BrowserPreview screenshots={[shot(0), shot(1), shot(2)]} />);
    await user.click(screen.getByRole("button", { name: "Previous screenshot" }));
    await user.click(screen.getByRole("button", { name: "Previous screenshot" }));
    expect(screen.getByText("Screenshot 1 of 3, before the first step")).toBeVisible();
    const previous = screen.getByRole("button", { name: "Previous screenshot" });
    expect(previous).toHaveAttribute("aria-disabled", "true");
    // Stays focusable at the first screenshot, and pressing it again does nothing.
    expect(previous).toHaveFocus();
    await user.click(previous);
    expect(screen.getByText("Screenshot 1 of 3, before the first step")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show latest" }));
    expect(screen.getByText("Screenshot 3 of 3, from step 2 (latest)")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Previous screenshot" }));
    await user.click(screen.getByRole("button", { name: "Next screenshot" }));
    expect(screen.queryByRole("button", { name: "Show latest" })).toBeNull();
  });

  it("follows new screenshots only when already on the latest", async () => {
    const user = userEvent.setup();
    render(<PreviewHarness initial={[shot(1), shot(2)]} />);
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("img")).toHaveAccessibleName("Screenshot description 3");

    await user.click(screen.getByRole("button", { name: "Previous screenshot" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("img")).toHaveAccessibleName("Screenshot description 2");
    expect(screen.getByText("Screenshot 2 of 4, from step 2")).toBeVisible();
  });

  it("refuses to render an image that is not an allowed data URL", () => {
    render(
      <BrowserPreview
        screenshots={[shot(1, { imageDataUrl: "https://evil.test/x.png", alt: "A form" })]}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.getByText("This screenshot could not be shown. Description: A form"),
    ).toBeVisible();
  });
});

function Bomb({ explode }: { explode: boolean }): React.ReactElement {
  if (explode) throw new Error("boom");
  return <p>All good</p>;
}

describe("ErrorBoundary", () => {
  it("shows a recoverable fallback and remounts on reload", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let explode = true;
    function Toggle() {
      return <Bomb explode={explode} />;
    }
    const { container } = render(
      <ErrorBoundary>
        <Toggle />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong in AccessPilot");
    expect(await axe(container)).toHaveNoViolations();

    explode = false;
    await user.click(screen.getByRole("button", { name: "Reload the assistant" }));
    expect(screen.getByText("All good")).toBeVisible();
    expect(console.error).toHaveBeenCalledWith(
      "AccessPilot crashed while rendering",
      expect.any(Error),
      expect.anything(),
    );
  });
});
