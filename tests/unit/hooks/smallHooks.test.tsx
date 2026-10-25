import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import {
  isTextField,
  matchesShortcut,
  useKeyboardShortcuts,
  type Shortcut,
} from "@/hooks/useKeyboardShortcuts";
import {
  STILL_WORKING_AFTER_MS,
  STILL_WORKING_REPEAT_MS,
  stillWorkingMessage,
  useStillWorking,
} from "@/hooks/useStillWorking";

function ShortcutHarness({ shortcuts }: { shortcuts: Shortcut[] }) {
  useKeyboardShortcuts(shortcuts);
  return (
    <>
      <input aria-label="Text" />
      <input aria-label="Box" type="checkbox" />
      <textarea aria-label="Area" />
      <select aria-label="Pick">
        <option>One</option>
      </select>
      <div aria-label="Editable" contentEditable suppressContentEditableWarning>
        x
      </div>
      <button type="button">Plain</button>
    </>
  );
}

describe("useKeyboardShortcuts", () => {
  const stop = vi.fn();
  const repeat = vi.fn();
  const help = vi.fn();
  const shortcuts: Shortcut[] = [
    { code: "KeyS", alt: true, shift: true, allowInTextFields: true, handler: stop },
    { code: "KeyR", alt: true, shift: true, handler: repeat },
    { code: "Slash", key: "?", handler: help },
  ];

  beforeEach(() => {
    stop.mockClear();
    repeat.mockClear();
    help.mockClear();
  });

  it("fires shortcuts from anywhere outside text fields and prevents the default", () => {
    render(<ShortcutHarness shortcuts={shortcuts} />);
    const button = screen.getByRole("button", { name: "Plain" });
    const event = new KeyboardEvent("keydown", {
      code: "KeyR",
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(event);
    expect(repeat).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.keyDown(document.body, { key: "?", code: "Slash", shiftKey: true });
    expect(help).toHaveBeenCalledTimes(1);
  });

  it("only lets Stop through while typing", () => {
    render(<ShortcutHarness shortcuts={shortcuts} />);
    for (const name of ["Text", "Area", "Pick", "Editable"]) {
      const field = screen.getByLabelText(name);
      fireEvent.keyDown(field, { code: "KeyR", altKey: true, shiftKey: true });
      fireEvent.keyDown(field, { key: "?", code: "Slash" });
      fireEvent.keyDown(field, { code: "KeyS", altKey: true, shiftKey: true });
    }
    expect(repeat).not.toHaveBeenCalled();
    expect(help).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(4);
    fireEvent.keyDown(screen.getByLabelText("Box"), { code: "KeyR", altKey: true, shiftKey: true });
    expect(repeat).toHaveBeenCalledTimes(1);
  });

  it("ignores wrong modifiers, Ctrl/Cmd combinations, key repeats, and handled events", () => {
    render(<ShortcutHarness shortcuts={shortcuts} />);
    fireEvent.keyDown(document.body, { code: "KeyS", altKey: true });
    fireEvent.keyDown(document.body, { code: "KeyS", altKey: true, shiftKey: true, ctrlKey: true });
    fireEvent.keyDown(document.body, { code: "KeyS", altKey: true, shiftKey: true, metaKey: true });
    fireEvent.keyDown(document.body, { code: "KeyS", altKey: true, shiftKey: true, repeat: true });
    fireEvent.keyDown(document.body, { key: "?", altKey: true });
    const handled = new KeyboardEvent("keydown", {
      code: "KeyS",
      altKey: true,
      shiftKey: true,
      cancelable: true,
    });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(stop).not.toHaveBeenCalled();
    expect(help).not.toHaveBeenCalled();
  });

  it("uses the latest handlers and removes the listener on unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const make = (handler: () => void): Shortcut[] => [
      { code: "KeyS", alt: true, shift: true, handler },
    ];
    const { rerender, unmount } = render(<ShortcutHarness shortcuts={make(first)} />);
    rerender(<ShortcutHarness shortcuts={make(second)} />);
    fireEvent.keyDown(document.body, { code: "KeyS", altKey: true, shiftKey: true });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(document.body, { code: "KeyS", altKey: true, shiftKey: true });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("exposes its matching helpers", () => {
    expect(isTextField(null)).toBe(false);
    expect(isTextField(window)).toBe(false);
    const event = new KeyboardEvent("keydown", { code: "KeyM", altKey: true, shiftKey: true });
    expect(matchesShortcut(event, { code: "KeyM", alt: true, shift: true, handler: vi.fn() })).toBe(
      true,
    );
  });
});

describe("useStillWorking", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("announces after a quiet period, repeats, and resets when activity happens", () => {
    const announce = vi.fn();
    const { result, rerender } = renderHook(
      ({ active, key }) => useStillWorking(active, key, announce),
      { initialProps: { active: true, key: 1 } },
    );
    expect(result.current).toBeNull();
    act(() => vi.advanceTimersByTime(STILL_WORKING_AFTER_MS));
    expect(result.current).toBe("Still working. The website is taking a while to respond.");
    expect(announce).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(STILL_WORKING_REPEAT_MS));
    expect(result.current).toBe(
      "Still working. No update for 23 seconds. You can keep waiting or press Stop.",
    );
    // Shown, but not re-announced within 30 seconds of the last announcement.
    expect(announce).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(STILL_WORKING_REPEAT_MS));
    expect(announce).toHaveBeenCalledTimes(2);

    rerender({ active: true, key: 2 });
    expect(result.current).toBeNull();
    act(() => vi.advanceTimersByTime(STILL_WORKING_AFTER_MS - 1));
    expect(announce).toHaveBeenCalledTimes(2);

    rerender({ active: false, key: 2 });
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBeNull();
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it("does not flood the live region when the backend has regular gaps", () => {
    const announce = vi.fn();
    const { rerender } = renderHook(({ key }) => useStillWorking(true, key, announce), {
      initialProps: { key: 1 },
    });
    for (let key = 2; key <= 9; key++) {
      act(() => vi.advanceTimersByTime(STILL_WORKING_AFTER_MS + 1000));
      rerender({ key });
    }
    // Eight 9-second gaps (72s) produce at most three announcements, 30s apart.
    expect(announce.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("words the message by elapsed time", () => {
    expect(stillWorkingMessage(8000)).toMatch(/taking a while/);
    expect(stillWorkingMessage(38_000)).toMatch(/No update for 38 seconds/);
  });
});
