import type { StepEntry, StepStatus } from "@/lib/client/taskState";
import { CheckIcon, Spinner, XIcon } from "./ui/icons";

export interface TaskProgressProps {
  steps: StepEntry[];
  totalSteps: number | null;
  /** Shown when the backend has been quiet for a while. */
  stillWorking: string | null;
}

type DisplayStatus = StepStatus | "pending";

const STATUS_TEXT: Record<DisplayStatus, string> = {
  completed: "Done",
  active: "In progress",
  incomplete: "Didn't finish",
  pending: "Not started",
};

const MARKER_CLASS: Record<DisplayStatus, string> = {
  completed: "border-success bg-success text-bg",
  active: "border-accent bg-accent-soft text-accent",
  incomplete: "border-danger bg-danger-soft text-danger",
  pending: "border-border-strong/60 bg-elevated text-muted",
};

interface DisplayStep {
  step: number;
  description: string | null;
  status: DisplayStatus;
}

function displaySteps(steps: StepEntry[], totalSteps: number | null): DisplayStep[] {
  const highest = Math.max(totalSteps ?? 0, ...steps.map((entry) => entry.step));
  const byNumber = new Map(steps.map((entry) => [entry.step, entry]));
  return Array.from({ length: highest }, (_, index) => {
    const number = index + 1;
    const entry = byNumber.get(number);
    return entry
      ? { step: number, description: entry.description, status: entry.status }
      : { step: number, description: null, status: "pending" };
  });
}

function Marker({ status, step }: { status: DisplayStatus; step: number }) {
  return (
    <span
      aria-hidden="true"
      data-step={status === "pending" ? step : undefined}
      className={`relative z-10 flex size-6 before:content-[attr(data-step)] shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors duration-200 [&_svg]:size-3.5 ${MARKER_CLASS[status]}`}
    >
      {status === "completed" ? (
        <CheckIcon strokeWidth={2.5} />
      ) : status === "active" ? (
        <Spinner className="size-3.5" />
      ) : status === "incomplete" ? (
        <XIcon strokeWidth={2.5} />
      ) : null}
    </span>
  );
}

export function TaskProgress({ steps, totalSteps, stillWorking }: TaskProgressProps) {
  const rows = displaySteps(steps, totalSteps);
  const done = steps.filter((entry) => entry.status === "completed").length;

  return (
    <div className="space-y-4">
      {stillWorking && (
        <p className="flex items-start gap-2 rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-sm font-medium text-fg">
          <Spinner className="mt-0.5 size-4 shrink-0 text-warning" />
          {stillWorking}
        </p>
      )}
      {totalSteps !== null && (
        <div className="space-y-2">
          <label htmlFor="task-progress" className="flex justify-between text-[13px] font-medium">
            <span>
              Progress: {done} of about {totalSteps} steps done
            </span>
          </label>
          <progress
            id="task-progress"
            max={totalSteps}
            value={Math.min(done, totalSteps)}
            className="block h-1.5 w-full appearance-none overflow-hidden rounded-full bg-border [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-accent [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-300"
          />
        </div>
      )}
      {rows.length > 0 && (
        <ol aria-label="Steps" className="relative">
          {rows.map((row, index) => (
            <li
              key={row.step}
              aria-current={row.status === "active" ? "step" : undefined}
              className={`relative flex gap-3 pb-4 last:pb-0 ${row.status === "active" ? "font-medium" : ""} ${row.status === "pending" ? "text-muted" : ""}`}
            >
              {index < rows.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`absolute left-3 top-6 -bottom-0 w-px -translate-x-1/2 ${row.status === "completed" ? "bg-success/50" : "bg-border"}`}
                />
              )}
              <Marker status={row.status} step={row.step} />
              <span className="min-w-0 pt-0.5 text-sm leading-5">
                Step {row.step}
                {row.description ? `: ${row.description}` : ""} — {STATUS_TEXT[row.status]}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
