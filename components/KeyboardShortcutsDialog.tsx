"use client";

import { useEffect, useId, useRef } from "react";
import { SHORTCUT_LABELS } from "@/hooks/useKeyboardShortcuts";
import { buttonStyles } from "./ui/styles";

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose(): void;
}

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: SHORTCUT_LABELS.stop, action: "Stop the task. Works anywhere, even while typing." },
  { keys: SHORTCUT_LABELS.mic, action: "Turn the microphone on or off." },
  { keys: SHORTCUT_LABELS.repeat, action: "Repeat the last thing AccessPilot said." },
  { keys: SHORTCUT_LABELS.help, action: "Show this list of shortcuts." },
  { keys: "Escape", action: "In the approval dialog: don't submit. Here: close this list." },
];

/**
 * Lists the global shortcuts. They use Alt+Shift so they stay clear of screen reader keys
 * (NVDA/JAWS Insert, VoiceOver Control+Option) and common browser shortcuts. On a Mac, Alt is
 * the Option key.
 */
export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      headingRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleClose = () => {
    returnFocus.current?.focus();
    returnFocus.current = null;
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-heading`}
      onClose={handleClose}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border-2 border-border bg-bg p-0 text-fg backdrop:bg-black/60"
    >
      {open && (
        <div className="space-y-4 p-5">
          <h2 ref={headingRef} id={`${id}-heading`} tabIndex={-1} className="text-2xl font-bold">
            Keyboard shortcuts
          </h2>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.keys} className="contents">
                <dt className="font-semibold">
                  <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono">
                    {shortcut.keys}
                  </kbd>
                </dt>
                <dd className="mb-2 sm:mb-0">{shortcut.action}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted">
            On a Mac, Alt is the Option key. Shortcuts other than Stop don&apos;t work while
            you&apos;re typing in a text box, so they never get in the way of what you type.
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={buttonStyles.primary}>
              Close
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
