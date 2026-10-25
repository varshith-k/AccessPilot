"use client";

import { SHORTCUT_LABELS } from "@/hooks/useKeyboardShortcuts";
import { ModalDialog } from "./ui/ModalDialog";
import { buttonStyles, kbdStyles } from "./ui/styles";

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
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      footer={
        <button type="button" onClick={onClose} className={buttonStyles.primary}>
          Close
        </button>
      }
    >
      <dl className="divide-y divide-border">
        {SHORTCUTS.map((shortcut) => (
          <div
            key={shortcut.keys}
            className="grid grid-cols-1 gap-x-6 gap-y-1.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[9rem_1fr] sm:items-center"
          >
            <dt>
              <kbd className={kbdStyles}>{shortcut.keys}</kbd>
            </dt>
            <dd className="text-sm">{shortcut.action}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[13px] leading-5 text-muted">
        On a Mac, Alt is the Option key. Shortcuts other than Stop don&apos;t work while you&apos;re
        typing in a text box, so they never get in the way of what you type.
      </p>
    </ModalDialog>
  );
}
