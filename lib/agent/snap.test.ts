import { describe, expect, it } from "vitest";
import type { BrowserAction, BrowserPageContext } from "@/lib/contracts";
import { snapClick } from "./snap";

const page: BrowserPageContext = {
  url: "http://localhost:4000/s",
  title: "Form",
  elements: [
    {
      role: "textbox",
      label: "Full name (required)",
      bounds: { x: 100, y: 200, width: 300, height: 40 },
    },
    {
      role: "textbox",
      label: "Email (required)",
      bounds: { x: 100, y: 300, width: 300, height: 40 },
    },
    {
      role: "button",
      label: "Submit application",
      bounds: { x: 100, y: 500, width: 200, height: 48 },
    },
    {
      role: "textbox",
      label: "Disabled thing",
      disabled: true,
      bounds: { x: 500, y: 200, width: 100, height: 40 },
    },
  ],
};
const click = (x: number, y: number, label?: string, commits = false): BrowserAction => ({
  id: "c",
  type: "click",
  x,
  y,
  commits,
  ...(label ? { label } : {}),
});

describe("snapClick", () => {
  it("pulls a click that landed on the label text onto the field Twinly named", () => {
    // y=170 is the label above the box, on no control
    expect(snapClick(click(150, 170, "Full name textbox"), page)).toMatchObject({ x: 250, y: 220 });
  });

  it("leaves a click that is already on a control alone, even a different one", () => {
    const onEmail = click(150, 320, "Full name textbox");
    expect(snapClick(onEmail, page)).toBe(onEmail);
  });

  it("leaves a consequential click alone when it is already on the control it names", () => {
    const submit = click(150, 520, "Submit application button", true);
    expect(snapClick(submit, page)).toBe(submit);
  });

  it("moves a consequential click onto the control it names, from nothing or from another control, at any distance", () => {
    expect(snapClick(click(150, 470, "Submit application", true), page)).toMatchObject({
      x: 200,
      y: 524,
    });
    expect(snapClick(click(150, 320, "Submit application", true), page)).toMatchObject({
      x: 200,
      y: 524,
    }); // was on Email
    expect(snapClick(click(1200, 20, "Submit application", true), page)).toMatchObject({
      x: 200,
      y: 524,
    });
  });

  it("leaves a consequential click to the browser's own checks when its name matches nothing or several", () => {
    const stranger = click(150, 470, "Delete everything", true);
    expect(snapClick(stranger, page)).toBe(stranger);
    const twins: BrowserPageContext = {
      ...page,
      elements: [
        { role: "button", label: "Submit", bounds: { x: 0, y: 0, width: 50, height: 20 } },
        { role: "button", label: "Submit", bounds: { x: 0, y: 100, width: 50, height: 20 } },
      ],
    };
    const ambiguous = click(500, 500, "Submit button", true);
    expect(snapClick(ambiguous, twins)).toBe(ambiguous);
  });

  it("does nothing without a label, or when the label names nothing on the page", () => {
    const unnamed = click(150, 170);
    expect(snapClick(unnamed, page)).toBe(unnamed);
    const stranger = click(150, 170, "Phone number field");
    expect(snapClick(stranger, page)).toBe(stranger);
  });

  it("does nothing when the label is ambiguous", () => {
    const twins: BrowserPageContext = {
      ...page,
      elements: [
        { role: "textbox", label: "Name", bounds: { x: 0, y: 200, width: 100, height: 40 } },
        { role: "textbox", label: "Name", bounds: { x: 0, y: 300, width: 100, height: 40 } },
      ],
    };
    const ambiguous = click(500, 500, "Name field");
    expect(snapClick(ambiguous, twins)).toBe(ambiguous);
  });

  it("does not drag a click across the page, or onto a disabled control", () => {
    const far = click(900, 650, "Full name textbox");
    expect(snapClick(far, page)).toBe(far);
    const disabled = click(450, 150, "Disabled thing");
    expect(snapClick(disabled, page)).toBe(disabled);
  });

  it("only touches clicks", () => {
    const typing: BrowserAction = {
      id: "t",
      type: "type",
      text: "x",
      commits: false,
      label: "Full name",
    };
    expect(snapClick(typing, page)).toBe(typing);
  });

  it("keeps the action's identity: same id and label, only the point moves", () => {
    const moved = snapClick(click(150, 170, "Full name textbox"), page);
    expect(moved).toMatchObject({
      id: "c",
      type: "click",
      label: "Full name textbox",
      commits: false,
    });
  });
});
