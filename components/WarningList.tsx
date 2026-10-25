import type { Warning } from "@/lib/client/taskState";
import { AlertIcon } from "./ui/icons";
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
          className="flex animate-enter flex-wrap items-center justify-between gap-2 rounded-control border border-warning/40 bg-warning-soft py-1.5 pl-3 pr-1.5 text-sm"
        >
          <span className="flex min-w-0 items-start gap-2">
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              <span className="font-medium">Warning: </span>
              {warning.message}
              {warning.count > 1 && ` (${warning.count} times)`}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onDismiss(warning.id)}
            className={`${buttonStyles.ghost} min-h-9 px-3`}
            aria-label={`Dismiss warning: ${warning.message}`}
          >
            Dismiss
          </button>
        </li>
      ))}
    </ul>
  );
}
