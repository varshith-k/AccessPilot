import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { axe } from "vitest-axe";
import { StatusAnnouncer } from "@/components/StatusAnnouncer";
import {
  AnnouncerProvider,
  DEDUPE_WINDOW_MS,
  MAX_COALESCED,
  POLITE_COALESCE_MS,
  useAnnouncer,
} from "@/hooks/useAnnouncer";

function setup() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AnnouncerProvider>
      {children}
      <StatusAnnouncer />
    </AnnouncerProvider>
  );
  const hook = renderHook(() => useAnnouncer(), { wrapper });
  return {
    announce: (text: string, priority?: "polite" | "assertive") =>
      act(() => hook.result.current.announce(text, priority)),
    polite: () => screen.getByTestId("live-polite"),
    assertive: () => screen.getByTestId("live-assertive"),
    advance: (ms: number) => act(() => vi.advanceTimersByTime(ms)),
    unmount: hook.unmount,
  };
}

/** Live region text without the zero-width marker used to force re-announcement. */
const text = (element: HTMLElement) => element.textContent?.replace(/​/g, "") ?? "";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("StatusAnnouncer and useAnnouncer", () => {
  it("renders a polite status region and an assertive alert region", async () => {
    vi.useRealTimers();
    const { container } = render(
      <AnnouncerProvider>
        <StatusAnnouncer />
      </AnnouncerProvider>,
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByRole("status")).toHaveClass("sr-only");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("coalesces rapid polite messages into one announcement", () => {
    const { announce, polite, advance } = setup();
    announce("Step 1.");
    announce("Step 2.");
    expect(text(polite())).toBe("");
    advance(POLITE_COALESCE_MS);
    expect(text(polite())).toBe("Step 1. Step 2.");
  });

  it("keeps only the most recent messages from a long burst", () => {
    const { announce, polite, advance } = setup();
    for (let i = 1; i <= MAX_COALESCED + 2; i++) announce(`m${i}.`);
    advance(POLITE_COALESCE_MS);
    expect(text(polite())).toBe("m3. m4. m5.");
  });

  it("announces assertive messages immediately and drops stale polite ones", () => {
    const { announce, polite, assertive, advance } = setup();
    announce("Typing your name.");
    announce("Approval needed.", "assertive");
    expect(text(assertive())).toBe("Approval needed.");
    advance(POLITE_COALESCE_MS * 2);
    expect(text(polite())).toBe("");
  });

  it("de-duplicates identical messages within the window, then allows them again", () => {
    const { announce, assertive } = setup();
    announce("Stopped.", "assertive");
    const first = assertive().textContent;
    announce("Stopped.", "assertive");
    expect(assertive().textContent).toBe(first);
    act(() => vi.advanceTimersByTime(DEDUPE_WINDOW_MS));
    announce("Stopped.", "assertive");
    expect(assertive().textContent).not.toBe(first);
    expect(text(assertive())).toBe("Stopped.");
  });

  it("changes the DOM text for a repeated polite message so it is read again", () => {
    const { announce, polite, advance } = setup();
    announce("Hello.");
    advance(POLITE_COALESCE_MS);
    const first = polite().textContent;
    advance(DEDUPE_WINDOW_MS);
    announce("Hello.");
    advance(POLITE_COALESCE_MS);
    expect(polite().textContent).not.toBe(first);
  });

  it("ignores blank messages and defaults to polite", () => {
    const { announce, polite, assertive, advance } = setup();
    announce("   ");
    announce("Ready.");
    advance(POLITE_COALESCE_MS);
    expect(text(polite())).toBe("Ready.");
    expect(text(assertive())).toBe("");
  });

  it("clears a pending timer on unmount", () => {
    const { announce, unmount } = setup();
    announce("Pending.");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("throws a helpful error outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useAnnouncer())).toThrow(/AnnouncerProvider/);
  });
});
