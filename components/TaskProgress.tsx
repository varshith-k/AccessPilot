import type { StepEntry, StepStatus } from "@/lib/client/taskState";

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

const STATUS_ICON: Record<DisplayStatus, string> = {
  completed: "✓",
  active: "▸",
  incomplete: "✕",
  pending: "○",
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

export function TaskProgress({ steps, totalSteps, stillWorking }: TaskProgressProps) {
  const rows = displaySteps(steps, totalSteps);
  const done = steps.filter((entry) => entry.status === "completed").length;

  return (
    <div className="space-y-3">
      {stillWorking && (
        <p className="rounded-md border-2 border-warning p-2 font-semibold">
          <span aria-hidden="true">⏳ </span>
          {stillWorking}
        </p>
      )}
      {totalSteps !== null && (
        <div className="space-y-1">
          <label htmlFor="task-progress" className="block text-sm font-semibold">
            Progress: {done} of about {totalSteps} steps done
          </label>
          <progress
            id="task-progress"
            max={totalSteps}
            value={Math.min(done, totalSteps)}
            className="h-3 w-full"
          />
        </div>
      )}
      {rows.length > 0 && (
        <ol aria-label="Steps" className="space-y-1">
          {rows.map((row) => (
            <li
              key={row.step}
              aria-current={row.status === "active" ? "step" : undefined}
              className={`flex gap-2 ${row.status === "active" ? "font-semibold" : ""} ${row.status === "pending" ? "text-muted" : ""}`}
            >
              <span aria-hidden="true" className="w-5 shrink-0 text-center">
                {STATUS_ICON[row.status]}
              </span>
              <span>
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
