"use client";

import { memo, useId, useState } from "react";
import { isTerminalStatus, type TaskState } from "@/lib/client/taskState";
import { BrowserPreview } from "./BrowserPreview";
import { TaskProgress } from "./TaskProgress";
import { ChevronRightIcon, Spinner } from "./ui/icons";
import { StatusBadge } from "./ui/StatusBadge";
import { eyebrowStyles } from "./ui/styles";

export interface BrowserWorkspaceProps {
  state: TaskState;
  stillWorking: string | null;
  mode: "demo" | "live";
}

const ACTION_LABEL: Record<string, string> = {
  click: "Clicked",
  double_click: "Double-clicked",
  type: "Typed into",
  key: "Pressed a key",
  scroll: "Scrolled",
  wait: "Waited",
};

/**
 * Everything about the controlled browser: the live preview, what is happening now, the step
 * timeline, what the page contains, and (collapsed) technical details for debugging.
 */
export const BrowserWorkspace = memo(function BrowserWorkspace({
  state,
  stillWorking,
  mode,
}: BrowserWorkspaceProps) {
  const id = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const waiting = state.status === "awaiting_approval" || state.status === "awaiting_user";
  const current = state.steps.find(
    (entry) => entry.step === state.currentStep && entry.status === "active",
  );
  const showProgress = state.steps.length > 0 || stillWorking !== null || state.totalSteps !== null;
  const actions = state.steps.filter((entry) => entry.action !== null);

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:py-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 id={`${id}-heading`} className="text-sm font-semibold">
          Live browser
        </h2>
        <StatusBadge
          status={state.status}
          declined={state.declined}
          className="h-6 px-2 text-[11px]"
        />
      </div>

      <BrowserPreview
        key={`${state.taskId ?? "none"}-${isTerminalStatus(state.status) ? "end" : "run"}`}
        screenshots={state.screenshots}
        url={state.request?.url}
      />

      {current && (
        <div className="flex animate-enter items-start gap-3 rounded-card border border-accent/30 bg-accent-soft/50 p-4">
          {waiting ? null : <Spinner className="mt-0.5 size-4 shrink-0 text-accent" />}
          <div className="min-w-0 space-y-0.5">
            <p className={eyebrowStyles}>Current action</p>
            <p className="text-sm font-medium">
              {state.status === "awaiting_approval"
                ? `Paused before: ${current.description}. Waiting for your approval.`
                : state.status === "awaiting_user"
                  ? `Paused: ${current.description}. Waiting for you.`
                  : current.description}
            </p>
          </div>
        </div>
      )}

      <section aria-labelledby={`${id}-progress`} className="space-y-3">
        <h2 id={`${id}-progress`} className={eyebrowStyles}>
          Progress
        </h2>
        {showProgress ? (
          <div className="rounded-card border border-border bg-elevated p-4">
            <TaskProgress
              steps={state.steps}
              totalSteps={state.totalSteps}
              stillWorking={stillWorking}
            />
          </div>
        ) : (
          <p className="rounded-card border border-dashed border-border px-4 py-5 text-center text-sm text-muted">
            {isTerminalStatus(state.status)
              ? "No steps were needed for this task."
              : "Steps appear here as AccessPilot works, so you can follow along."}
          </p>
        )}
      </section>

      {state.pageMap && (
        <section aria-labelledby={`${id}-page`} className="space-y-3">
          <h2 id={`${id}-page`} className={eyebrowStyles}>
            On this page
          </h2>
          <div className="space-y-3 rounded-card border border-border bg-elevated p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">{state.pageMap.title}</p>
              <p className="text-sm text-muted">{state.pageMap.summary}</p>
            </div>
            {state.pageMap.regions.length > 0 && (
              <ul className="space-y-1.5 border-t border-border pt-3">
                {state.pageMap.regions.map((region, index) => (
                  <li key={`${region.name}-${index}`} className="text-sm">
                    <span className="font-medium">{region.name}</span>
                    {region.description && (
                      <span className="text-muted"> — {region.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <details
        className="group rounded-card border border-border bg-elevated"
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-card px-4 text-[13px] font-medium text-muted transition-colors hover:text-fg [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon className="size-4 transition-transform duration-150 group-open:rotate-90" />
          Technical details
        </summary>
        {detailsOpen && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 border-t border-border px-4 py-3 font-mono text-xs">
            <dt className="text-muted">Mode</dt>
            <dd>{mode === "live" ? "Live backend" : "Scripted demo"}</dd>
            <dt className="text-muted">Status</dt>
            <dd>{state.status}</dd>
            <dt className="text-muted">Task id</dt>
            <dd className="break-all">{state.taskId ?? "—"}</dd>
            <dt className="text-muted">Last event</dt>
            <dd>{state.lastSeq >= 0 ? `#${state.lastSeq}` : "—"}</dd>
            <dt className="text-muted">Screenshots</dt>
            <dd>{state.screenshots.length}</dd>
            <dt className="self-start text-muted">Actions</dt>
            <dd>
              {actions.length === 0 ? (
                "—"
              ) : (
                <ol className="space-y-1">
                  {actions.map((entry) => (
                    <li key={entry.step} className="break-words">
                      {entry.step}. {ACTION_LABEL[entry.action?.type ?? ""] ?? entry.action?.type}
                      {entry.action?.label ? ` “${entry.action.label}”` : ""}
                    </li>
                  ))}
                </ol>
              )}
            </dd>
          </dl>
        )}
      </details>
    </div>
  );
});
