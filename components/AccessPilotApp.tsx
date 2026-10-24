"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { StartTaskRequest } from "@/lib/contracts";
import { createTaskClientFromEnvironment } from "@/lib/client/createTaskClient";
import { documentTitle, statusSentence } from "@/lib/client/statusText";
import { isActiveStatus } from "@/lib/client/taskState";
import type { TaskClient } from "@/lib/client/types";
import { AnnouncerProvider, useAnnouncer } from "@/hooks/useAnnouncer";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useStillWorking } from "@/hooks/useStillWorking";
import { useTaskSession } from "@/hooks/useTaskSession";
import { ApprovalDialog } from "./ApprovalDialog";
import { BrowserPreview } from "./BrowserPreview";
import { Chat } from "./Chat";
import { ErrorBoundary } from "./ErrorBoundary";
import { HandoffPanel } from "./HandoffPanel";
import { StatusAnnouncer } from "./StatusAnnouncer";
import { StopButton } from "./StopButton";
import { TaskForm } from "./TaskForm";
import { TaskProgress } from "./TaskProgress";
import { WarningList } from "./WarningList";
import { buttonStyles, panelStyles } from "./ui/styles";

export interface AccessPilotAppProps {
  /** Injected in tests; otherwise chosen from NEXT_PUBLIC_TASK_CLIENT and ?mock=. */
  client?: TaskClient;
}

export function AccessPilotApp({ client }: AccessPilotAppProps) {
  return (
    <AnnouncerProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent"
      >
        Skip to main content
      </a>
      <header className="border-b border-border px-4 py-4">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-3xl font-bold">AccessPilot</h1>
          <p className="text-muted">
            Tell me a website and a goal. I&apos;ll do the steps, tell you what I&apos;m doing, and
            ask before anything important.
          </p>
        </div>
      </header>
      <ErrorBoundary>
        <TaskWorkspace client={client} />
      </ErrorBoundary>
      <footer className="border-t border-border px-4 py-4 text-sm text-muted">
        <div className="mx-auto max-w-7xl">
          AccessPilot never types passwords or card numbers, and never submits without your
          approval.
        </div>
      </footer>
      <StatusAnnouncer />
    </AnnouncerProvider>
  );
}

function TaskWorkspace({ client: injected }: { client?: TaskClient }) {
  const [client] = useState<TaskClient>(() => injected ?? createTaskClientFromEnvironment());
  const { announce } = useAnnouncer();
  const effects = useMemo(() => ({ announce }), [announce]);
  const session = useTaskSession({ client, effects });
  const { state } = session;
  const active = isActiveStatus(state.status);

  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  const statusRef = useRef<HTMLHeadingElement>(null);
  const id = useId();

  useEffect(() => {
    document.title = documentTitle(state);
  }, [state]);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-task-active", active);
    return () => document.documentElement.removeAttribute("data-task-active");
  }, [active]);

  const announcePolite = useCallback((text: string) => announce(text, "polite"), [announce]);
  const working = state.status === "planning" || state.status === "running";
  const stillWorking = useStillWorking(working, state.lastSeq, announcePolite);

  const { stop } = session;
  useKeyboardShortcuts([
    { code: "KeyS", alt: true, shift: true, allowInTextFields: true, handler: () => void stop() },
  ]);

  const start = (input: StartTaskRequest) => void session.start(input);

  const startOver = () => {
    session.reset();
    document.getElementById(`${id}-form-heading`)?.focus();
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <main id="main" tabIndex={-1} className="min-w-0 space-y-6 focus:outline-none">
        <section className="space-y-3">
          <h2 id={`${id}-form-heading`} tabIndex={-1} className="text-xl font-bold">
            Start a task
          </h2>
          <TaskForm
            url={url}
            goal={goal}
            onUrlChange={setUrl}
            onGoalChange={setGoal}
            onSubmit={start}
            starting={state.status === "starting"}
            busy={active}
          />
        </section>

        <section
          className={`${panelStyles} space-y-4 ${active ? "z-10 shadow-md [@media(min-height:36rem)]:sticky [@media(min-height:36rem)]:top-0" : ""}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 basis-56 space-y-1">
              <h2
                ref={statusRef}
                id={`${id}-status-heading`}
                tabIndex={-1}
                className="text-xl font-bold"
              >
                Status
              </h2>
              <p className="text-lg">{statusSentence(state)}</p>
            </div>
            {active && <StopButton onStop={() => void stop()} stopping={state.stopping} />}
          </div>
        </section>

        {(state.steps.length > 0 || stillWorking || state.totalSteps !== null) && (
          <section className="space-y-2">
            <h2 id={`${id}-progress-heading`} className="text-xl font-bold">
              Progress
            </h2>
            <TaskProgress
              steps={state.steps}
              totalSteps={state.totalSteps}
              stillWorking={stillWorking}
            />
          </section>
        )}

        {state.handoff && (
          <HandoffPanel
            handoff={state.handoff}
            onContinue={() => void session.resume()}
            onStop={() => void stop()}
          />
        )}

        <WarningList warnings={state.warnings} onDismiss={session.dismissWarning} />

        {state.status === "failed" && state.error && (
          <section className={`${panelStyles} space-y-3 border-2 border-danger`}>
            <h2 id={`${id}-error-heading`} className="text-xl font-bold">
              <span aria-hidden="true">⚠ </span>
              The task didn&apos;t finish
            </h2>
            <p>{state.error.message}</p>
            <div className="flex flex-wrap gap-3">
              {state.error.recoverable && state.request && (
                <button
                  type="button"
                  onClick={() => void session.retry()}
                  className={buttonStyles.primary}
                >
                  Try again
                </button>
              )}
              <button type="button" onClick={startOver} className={buttonStyles.secondary}>
                Start a different task
              </button>
            </div>
          </section>
        )}

        {(state.status === "completed" || state.status === "stopped") && (
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={startOver} className={buttonStyles.secondary}>
              Start a new task
            </button>
          </div>
        )}

        <Chat entries={state.log} busy={active} onSend={session.sendFollowUp} />
      </main>

      <aside aria-label="Browser preview" className="min-w-0">
        <BrowserPreview key={state.taskId ?? "none"} screenshots={state.screenshots} />
      </aside>

      <ApprovalDialog
        approval={state.approval}
        onApprove={() => void session.approve()}
        onDeny={() => void session.deny()}
        returnFocusRef={statusRef}
      />
    </div>
  );
}
