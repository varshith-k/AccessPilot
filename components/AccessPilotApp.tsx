"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { startTaskRequestSchema, type StartTaskRequest } from "@/lib/contracts";
import { createTaskClientFromEnvironment } from "@/lib/client/createTaskClient";
import { documentTitle, statusSentence } from "@/lib/client/statusText";
import type { NarrationPriority } from "@/lib/contracts";
import { builtInSpeechEnabled } from "@/lib/client/settings";
import { isActiveStatus } from "@/lib/client/taskState";
import type { TaskClient } from "@/lib/client/types";
import { parseVoiceCommand } from "@/lib/client/voiceCommands";
import { AnnouncerProvider, useAnnouncer } from "@/hooks/useAnnouncer";
import { SHORTCUT_LABELS, useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useFocusRescue } from "@/hooks/useFocusRescue";
import { useSettings } from "@/hooks/useSettings";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { useStickyFits } from "@/hooks/useStickyFits";
import { useStillWorking } from "@/hooks/useStillWorking";
import { useTaskSession } from "@/hooks/useTaskSession";
import { ApprovalDialog } from "./ApprovalDialog";
import { BrowserPreview } from "./BrowserPreview";
import { Chat } from "./Chat";
import { ErrorBoundary } from "./ErrorBoundary";
import { HandoffPanel } from "./HandoffPanel";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { FirstRunSpeechPrompt, SettingsPanel } from "./SettingsPanel";
import { StatusAnnouncer } from "./StatusAnnouncer";
import { StopButton } from "./StopButton";
import { TaskForm } from "./TaskForm";
import { TaskProgress } from "./TaskProgress";
import { VOICE_UNSUPPORTED_MESSAGE, VoiceControl } from "./VoiceControl";
import { WarningList } from "./WarningList";
import { buttonStyles, panelStyles } from "./ui/styles";

export interface AccessPilotAppProps {
  /** Injected in tests; otherwise chosen from NEXT_PUBLIC_TASK_CLIENT and ?mock=. */
  client?: TaskClient;
}

export function AccessPilotApp({ client }: AccessPilotAppProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const showHelp = useCallback(() => setHelpOpen(true), []);
  return (
    <AnnouncerProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent"
      >
        Skip to main content
      </a>
      <header className="border-b border-border px-4 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="text-3xl font-bold">AccessPilot</h1>
            <p className="text-muted">
              Tell me a website and a goal. I&apos;ll do the steps, tell you what I&apos;m doing,
              and ask before anything important.
            </p>
          </div>
          <button
            type="button"
            onClick={showHelp}
            aria-keyshortcuts="?"
            className={buttonStyles.secondary}
          >
            Keyboard shortcuts <span className="text-sm font-normal">(?)</span>
          </button>
        </div>
      </header>
      <ErrorBoundary>
        <TaskWorkspace
          client={client}
          onShowHelp={showHelp}
          onCloseHelp={() => setHelpOpen(false)}
        />
      </ErrorBoundary>
      <footer className="border-t border-border px-4 py-4 text-sm text-muted">
        <div className="mx-auto max-w-7xl">
          AccessPilot never types passwords or card numbers, and never submits without your
          approval.
        </div>
      </footer>
      <KeyboardShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <StatusAnnouncer />
    </AnnouncerProvider>
  );
}

interface TaskWorkspaceProps {
  client?: TaskClient | undefined;
  onShowHelp(): void;
  onCloseHelp(): void;
}

function TaskWorkspace({ client: injected, onShowHelp, onCloseHelp }: TaskWorkspaceProps) {
  const [client] = useState<TaskClient>(() => injected ?? createTaskClientFromEnvironment());
  const { announce } = useAnnouncer();
  const [settings, updateSettings] = useSettings();
  const speech = useSpeechSynthesis({
    enabled: builtInSpeechEnabled(settings),
    rate: settings.rate,
    voiceURI: settings.voiceURI,
  });
  const { speak, cancel: cancelSpeech, hold: holdSpeech } = speech;
  const effects = useMemo(
    () => ({ announce, speak, cancelSpeech }),
    [announce, speak, cancelSpeech],
  );
  const session = useTaskSession({ client, effects });
  const { state } = session;
  const active = isActiveStatus(state.status);

  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  // Words heard during a hand-off may be a spoken password; never echo them on screen.
  const [hideHeard, setHideHeard] = useState(false);
  const statusRef = useRef<HTMLHeadingElement>(null);
  const statusPanelRef = useRef<HTMLElement>(null);
  const errorHeadingRef = useRef<HTMLHeadingElement>(null);
  const tipShown = useRef(false);
  const id = useId();
  const stickyFits = useStickyFits(statusPanelRef, active);

  useFocusRescue(() => (state.status === "failed" ? errorHeadingRef : statusRef), [state]);

  // A new failure takes focus from the status area so "Try again" is one Tab away.
  const failed = state.status === "failed";
  useEffect(() => {
    if (!failed) return;
    const focused = document.activeElement;
    const inStatus = focused === document.body || statusPanelRef.current?.contains(focused);
    if (inStatus && !document.querySelector("dialog[open]")) errorHeadingRef.current?.focus();
  }, [failed]);

  // An approval question always comes first; close the shortcuts list if it is open.
  const approvalOpen = state.approval !== null;
  useEffect(() => {
    if (approvalOpen) onCloseHelp();
  }, [approvalOpen, onCloseHelp]);

  // Leaving mid-task loses the user's view of a browser that may still be acting for them.
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  useEffect(() => {
    document.title = documentTitle(state);
  }, [state]);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-task-active", stickyFits);
    return () => document.documentElement.removeAttribute("data-task-active");
  }, [stickyFits]);

  /** Shows in the live region and, unless the user's own screen reader is on, speaks it. */
  const say = useCallback(
    (text: string, priority: NarrationPriority) => {
      announce(text, priority);
      speak(text, priority);
    },
    [announce, speak],
  );

  const sayPolite = useCallback((text: string) => say(text, "polite"), [say]);
  const working = state.status === "planning" || state.status === "running";
  const stillWorking = useStillWorking(working, state.lastSeq, sayPolite);

  const handleTranscript = (text: string) => {
    const command = parseVoiceCommand(text, {
      approvalOpen: state.approval !== null,
      handoffActive: state.handoff !== null,
    });
    switch (command.kind) {
      case "stop":
        if (active) void session.stop();
        else say("Nothing is running.", "polite");
        return;
      case "approve":
        void session.approve();
        return;
      case "deny":
        void session.deny("Declined by voice");
        return;
      case "unclear_approval":
        say(
          `I heard “${text}”, which isn't a clear yes or no, so nothing was submitted. Say “approve” to submit, or “don't submit”.`,
          "assertive",
        );
        return;
      case "repeat":
        repeat();
        return;
      case "describe_page":
        if (!session.describePage()) {
          say("I haven't looked at a page yet. Start a task first.", "polite");
        }
        return;
      case "continue":
        void session.resume();
        return;
      case "no_approval_pending":
        say("There's nothing waiting for your approval right now.", "polite");
        return;
      case "nothing_to_continue":
        say("AccessPilot isn't waiting for you right now.", "polite");
        return;
      case "start_task":
        startFromVoice();
        return;
      case "clear_goal":
        if (active) break;
        setGoal("");
        say("Cleared the goal box.", "polite");
        return;
      case "none":
        break;
    }
    if (state.status === "awaiting_user") {
      setHideHeard(true);
      say(
        "AccessPilot is waiting for you. Finish the step in the browser window, then say “continue”, or say “stop”.",
        "polite",
      );
      return;
    }
    if (active) {
      say(
        "AccessPilot is working on a task. Say “stop” to stop it, or wait for it to finish.",
        "polite",
      );
      return;
    }
    if (command.kind !== "none") return;
    const added = goal.trim() !== "";
    const next = added ? `${goal.trim()} ${command.text}` : command.text;
    setGoal(next);
    say(
      added
        ? `Added to the goal: ${command.text}. Say “start task” or press Start task when it's ready, or say “clear the goal” to start over.`
        : `Heard: ${command.text}. It's in the goal box. Edit it if you need to, then say “start task” or press Start task.`,
      "polite",
    );
  };

  const startFromVoice = () => {
    if (active) {
      say("A task is already running. Say “stop” first if you want to start over.", "polite");
      return;
    }
    const parsed = startTaskRequestSchema.safeParse({ url, goal });
    if (!parsed.success) {
      say(
        `I can't start yet. ${parsed.error.issues.map((issue) => issue.message).join(" ")}`,
        "assertive",
      );
      return;
    }
    start(parsed.data);
  };

  const recognition = useSpeechRecognition({
    onFinal: handleTranscript,
    onListeningChange: (listening) => {
      // Never talk over the microphone: hold speech while listening (keeping what was queued)
      // and resume afterwards.
      holdSpeech(listening);
      if (listening) {
        setHideHeard(false);
        announce("Listening…", "polite");
      }
    },
    onNothingHeard: () => say("I didn't hear anything. Try again, or type instead.", "polite"),
    onError: (error) => say(error.message, "assertive"),
  });
  const { abort: abortListening } = recognition;

  const toggleMic = () => {
    if (!recognition.supported) {
      announce(VOICE_UNSUPPORTED_MESSAGE, "assertive");
      return;
    }
    if (!recognition.listening) cancelSpeech();
    recognition.toggle();
  };

  const repeat = () => {
    if (!session.repeatLast()) say("There's nothing to repeat yet.", "polite");
  };

  const { stop: stopSession } = session;
  const stop = useCallback(() => {
    abortListening();
    if (!active) {
      say("Nothing is running.", "polite");
      return;
    }
    void stopSession();
  }, [abortListening, active, say, stopSession]);

  useKeyboardShortcuts([
    { code: "KeyS", alt: true, shift: true, allowInTextFields: true, handler: stop },
    { code: "KeyM", alt: true, shift: true, handler: toggleMic },
    { code: "KeyR", alt: true, shift: true, handler: repeat },
    {
      code: "Slash",
      key: "?",
      // Never stack a second dialog on top of an approval question.
      handler: () => {
        if (state.approval === null) onShowHelp();
        else
          announce("Answer the approval question first. Escape means don't submit.", "assertive");
      },
    },
  ]);

  const chooseSpeechMode = (screenReaderMode: boolean) => {
    updateSettings({ screenReaderMode, firstRunDone: true });
    announce(
      screenReaderMode
        ? "Screen reader mode is on. AccessPilot will stay silent and your screen reader will read updates."
        : "AccessPilot will read updates aloud.",
      "polite",
    );
    document.getElementById(`${id}-form-heading`)?.focus();
  };

  const start = (input: StartTaskRequest) => {
    if (!settings.firstRunDone && speech.supported && !tipShown.current) {
      tipShown.current = true;
      announce(
        "Tip: if you use a screen reader, turn on “I use my own screen reader” in Speech settings so you don't hear everything twice.",
        "polite",
      );
    }
    void session.start(input);
  };

  const sendFollowUp = (text: string) => {
    const result = session.sendFollowUp(text, url);
    if (result.ok) setGoal(text.trim());
    return result;
  };

  const startOver = () => {
    session.reset();
    document.getElementById(`${id}-form-heading`)?.focus();
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <main id="main" tabIndex={-1} className="min-w-0 space-y-6 focus:outline-none">
        {!settings.firstRunDone && speech.supported && (
          <FirstRunSpeechPrompt onChoose={chooseSpeechMode} />
        )}

        <section className="space-y-3">
          <h2 id={`${id}-form-heading`} tabIndex={-1} className="text-xl font-bold">
            Start a task
          </h2>
          <VoiceControl
            supported={recognition.supported}
            listening={recognition.listening}
            interim={recognition.interim}
            transcript={hideHeard ? "" : recognition.transcript}
            error={recognition.error}
            onToggle={toggleMic}
          />
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
          ref={statusPanelRef}
          className={`${panelStyles} space-y-4 ${stickyFits ? "sticky top-0 z-10 shadow-md" : ""}`}
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
            {active && <StopButton onStop={stop} stopping={state.stopping} />}
          </div>
        </section>

        {(active || state.steps.length > 0 || state.totalSteps !== null) &&
          state.status !== "starting" && (
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
            onStop={stop}
          />
        )}

        <WarningList warnings={state.warnings} onDismiss={session.dismissWarning} />

        {state.status === "failed" && state.error && (
          <section className={`${panelStyles} space-y-3 border-2 border-danger`}>
            <h2
              ref={errorHeadingRef}
              id={`${id}-error-heading`}
              tabIndex={-1}
              className="text-xl font-bold"
            >
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

        <Chat entries={state.log} busy={active} onSend={sendFollowUp} />

        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          voices={speech.voices}
          speechSupported={speech.supported}
          onTestVoice={() => speak("This is how AccessPilot sounds.", "assertive")}
        />
      </main>

      <aside aria-label="Browser preview" className="min-w-0">
        <BrowserPreview key={state.taskId ?? "none"} screenshots={state.screenshots} />
      </aside>

      <ApprovalDialog
        approval={state.approval}
        onApprove={() => void session.approve()}
        onDeny={() => void session.deny()}
        returnFocusRef={statusRef}
        voiceHint={
          recognition.supported
            ? `You can also answer by voice: press Answer by voice or ${SHORTCUT_LABELS.mic} and say “approve” or “don't submit”.`
            : undefined
        }
        voice={
          recognition.supported
            ? {
                listening: recognition.listening,
                error: recognition.error?.message ?? null,
                onToggle: toggleMic,
              }
            : undefined
        }
      />
    </div>
  );
}
