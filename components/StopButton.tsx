import { SHORTCUT_LABELS } from "@/hooks/useKeyboardShortcuts";
import { buttonStyles, shortcutHint } from "./ui/styles";

export interface StopButtonProps {
  onStop(): void;
  stopping: boolean;
}

/** Large, always-labelled Stop control. It stays enabled so a failed stop can be retried. */
export function StopButton({ onStop, stopping }: StopButtonProps) {
  return (
    <button
      type="button"
      onClick={onStop}
      aria-keyshortcuts={SHORTCUT_LABELS.stop}
      className={`${buttonStyles.danger} min-h-12 min-w-24 text-lg`}
    >
      <span aria-hidden="true">■</span>
      {stopping ? "Stopping…" : "Stop"}{" "}
      <span className={shortcutHint}>({SHORTCUT_LABELS.stop})</span>
    </button>
  );
}
