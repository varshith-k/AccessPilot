import type { Warning } from "@/lib/client/taskState";
import { buttonStyles } from "./ui/styles";

export interface WarningListProps {
  warnings: Warning[];
  onDismiss(id: string): void;
}

/** Non-fatal problems, such as an update that could not be read. The task keeps running. */
export function WarningList({ warnings, onDismiss }: WarningListProps) {
  if (warnings.length === 0) return null;
  return (
    <ul aria-label="Warnings" className="space-y-2">
      {warnings.map((warning) => (
        <li
          key={warning.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border-2 border-warning p-2"
        >
          <span>
            <span className="font-semibold">Warning: </span>
            {warning.message}
            {warning.count > 1 && ` (${warning.count} times)`}
          </span>
          <button
            type="button"
            onClick={() => onDismiss(warning.id)}
            className={buttonStyles.secondary}
            aria-label={`Dismiss warning: ${warning.message}`}
          >
            Dismiss
          </button>
        </li>
      ))}
    </ul>
  );
}
