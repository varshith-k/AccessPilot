import type { TaskStatus } from "@/lib/client/taskState";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const STATUS: Record<TaskStatus, { label: string; tone: Tone; live: boolean }> = {
  idle: { label: "Ready", tone: "neutral", live: false },
  starting: { label: "Starting", tone: "accent", live: true },
  planning: { label: "Analyzing page", tone: "accent", live: true },
  running: { label: "Working", tone: "accent", live: true },
  awaiting_approval: { label: "Needs approval", tone: "warning", live: false },
  awaiting_user: { label: "Your turn", tone: "warning", live: false },
  completed: { label: "Completed", tone: "success", live: false },
  failed: { label: "Failed", tone: "danger", live: false },
  stopped: { label: "Stopped", tone: "neutral", live: false },
};

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-border bg-subtle text-muted [&>i]:bg-muted",
  accent: "border-accent/30 bg-accent-soft text-on-accent-soft [&>i]:bg-accent",
  success: "border-success/30 bg-success-soft text-success [&>i]:bg-success",
  warning: "border-warning/30 bg-warning-soft text-warning [&>i]:bg-warning",
  danger: "border-danger/30 bg-danger-soft text-danger [&>i]:bg-danger",
};

/**
 * Compact status pill. By default it is purely visual: the status sentence and live regions
 * carry the same information for assistive technology.
 */
export function StatusBadge({
  status,
  declined = false,
  className = "",
  hidden = true,
}: {
  status: TaskStatus;
  /** The user declined the approval, so "Completed" would read as success. */
  declined?: boolean;
  className?: string;
  /** Hide from assistive technology when the same information is available elsewhere. */
  hidden?: boolean;
}) {
  const { label, tone, live } =
    status === "completed" && declined
      ? { label: "Not submitted", tone: "neutral" as const, live: false }
      : STATUS[status];
  return (
    <span
      aria-hidden={hidden || undefined}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      <i className={`size-1.5 rounded-full ${live ? "animate-pulse-dot" : ""}`} />
      {label}
    </span>
  );
}
