"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { StartTaskRequest } from "@/lib/contracts";
import { createTaskClientFromEnvironment } from "@/lib/client/createTaskClient";
import { HttpTaskClient } from "@/lib/client/HttpTaskClient";
import { documentTitle, statusSentence } from "@/lib/client/statusText";
import type { NarrationPriority } from "@/lib/contracts";
import { builtInSpeechEnabled } from "@/lib/client/settings";
import { isActiveStatus } from "@/lib/client/taskState";
import type { TaskClient } from "@/lib/client/types";
import { parseVoiceCommand } from "@/lib/client/voiceCommands";
import { AnnouncerProvider, useAnnouncer } from "@/hooks/useAnnouncer";
import { SHORTCUT_LABELS, useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettings } from "@/hooks/useSettings";
import { profileForTask, profileStore } from "@/lib/client/profile";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { useStillWorking } from "@/hooks/useStillWorking";
import { useStoredFlag } from "@/hooks/useStoredFlag";
import { useTaskSession } from "@/hooks/useTaskSession";
import { useTheme } from "@/hooks/useTheme";
import { ApprovalDialog } from "./ApprovalDialog";
import { BrowserWorkspace } from "./BrowserWorkspace";
import { Chat } from "./Chat";
import { ErrorBoundary } from "./ErrorBoundary";
import { HandoffPanel } from "./HandoffPanel";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { SettingsDialog } from "./SettingsDialog";
import { FirstRunSpeechPrompt } from "./SettingsPanel";
import { Sidebar } from "./shell/Sidebar";
import { TopBar } from "./shell/TopBar";
import { StatusAnnouncer } from "./StatusAnnouncer";
import { StopButton } from "./StopButton";
import { TaskForm } from "./TaskForm";
import { VOICE_UNSUPPORTED_MESSAGE, VoiceControl } from "./VoiceControl";
import { WarningList } from "./WarningList";
import {
  AlertIcon,
  BrowserIcon,
  CheckIcon,
  MessageIcon,
  PlusIcon,
  ShieldIcon,
  Spinner,
  StopIcon,
} from "./ui/icons";
import { buttonStyles, eyebrowStyles, kbdStyles } from "./ui/styles";

export interface AccessPilotAppProps {
  /** Injected in tests; otherwise chosen from NEXT_PUBLIC_TASK_CLIENT and ?mock=. */
  client?: TaskClient;
}

/** Example goals offered before the first task. Choosing one only fills in the goal box. */
const SUGGESTED_GOALS = [
  "Help me complete this scholarship application.",
  "Find the application deadline on this page.",
  "Fill in my contact details, then stop before submitting.",
];

export function AccessPilotApp({ client }: AccessPilotAppProps) {
  return (
    <AnnouncerProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-control focus:bg-accent focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-on-accent focus:shadow-elevated"
      >
        Skip to main content
      </a>
      <ErrorBoundary>
        <TaskWorkspace client={client} />
      </ErrorBoundary>
      <StatusAnnouncer />
    </AnnouncerProvider>
  );
}

interface TaskWorkspaceProps {
  client?: TaskClient | undefined;
}

type MobilePane = "chat" | "browser";

function TaskWorkspace({ client: injected }: TaskWorkspaceProps) {
  const [client] = useState<TaskClient>(() => injected ?? createTaskClientFromEnvironment());
  const mode = client instanceof HttpTaskClient ? "live" : "demo";
  const { announce } = useAnnouncer();
  const [settings, updateSettings] = useSettings();
  const [theme, setTheme] = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredFlag(
    "accesspilot.sidebar.collapsed",
    false,
  );
  const [browserPanelHidden, setBrowserPanelHidden] = useStoredFlag(
    "accesspilot.browserPanel.hidden",
    false,
  );
  const [chosenPane, setChosenPane] = useState<MobilePane>("chat");
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
  const statusRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const sidebarId = `${id}-sidebar`;
  const browserPanelId = `${id}-browser`;

  // On small screens the conversation pane must be showing whenever something needs the user,
  // so focus can move to it and nothing important is hidden behind the Browser tab.
  const needsUser = state.approval !== null || state.handoff !== null || state.status === "failed";
  const pane: MobilePane = needsUser ? "chat" : chosenPane;
  const [seenScreenshots, setSeenScreenshots] = useState(0);
  const unseenScreenshots =
    pane === "browser" ? 0 : Math.max(0, state.screenshots.length - seenScreenshots);
  const choosePane = (next: MobilePane) => {
    setSeenScreenshots(state.screenshots.length);
    setChosenPane(next);
  };

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

  /** Shows in the live region and, unless the user's own screen reader is on, speaks it. */
  const say = useCallback(
    (text: string, priority: NarrationPriority) => {
      announce(text, priority);
      speak(text, priority);
    },
    [announce, speak],
  );

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
      case "none":
        if (active) {
          say(
            "AccessPilot is working on a task. Say “stop” to stop it, or wait for it to finish.",
            "polite",
          );
          return;
        }
        setGoal(command.text);
        say(
          `Heard: ${command.text}. It's in the goal box. Edit it if you need to, then press Start task.`,
          "polite",
        );
    }
  };

  const recognition = useSpeechRecognition({
    onFinal: handleTranscript,
    onSpeechStart: cancelSpeech,
    onListeningChange: (listening) => {
      // Never talk over the microphone: hold speech while listening, resume after.
      holdSpeech(listening);
      if (listening) announce("Listening…", "polite");
    },
    onError: (error) => announce(error.message, "assertive"),
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
    if (!session.repeatLastNarration()) say("There's nothing to repeat yet.", "polite");
  };

  const { stop: stopSession } = session;
  const stop = useCallback(() => {
    abortListening();
    void stopSession();
  }, [abortListening, stopSession]);

  const showHelp = useCallback(() => setHelpOpen(true), []);

  useKeyboardShortcuts([
    { code: "KeyS", alt: true, shift: true, allowInTextFields: true, handler: stop },
    { code: "KeyM", alt: true, shift: true, handler: toggleMic },
    { code: "KeyR", alt: true, shift: true, handler: repeat },
    {
      code: "Slash",
      key: "?",
      // Never stack a second dialog on top of an approval question.
      handler: () => {
        if (state.approval === null) showHelp();
      },
    },
  ]);

  // The composer moves below the conversation once a task starts, so focus moves after React
  // has committed the new layout rather than to a node that is about to be replaced.
  const pendingComposerFocus = useRef(false);
  const focusComposer = useCallback(() => {
    setChosenPane("chat");
    pendingComposerFocus.current = true;
  }, []);
  useEffect(() => {
    if (!pendingComposerFocus.current) return;
    pendingComposerFocus.current = false;
    document.getElementById(`${id}-form-heading`)?.focus();
  });

  // Starting a task replaces the Start button the user just pressed. Put focus on the status,
  // which says what is happening, instead of letting it fall back to the page.
  const taskStarted = state.request !== null;
  const wasStarted = useRef(taskStarted);
  useEffect(() => {
    if (taskStarted && !wasStarted.current) statusRef.current?.focus();
    wasStarted.current = taskStarted;
  }, [taskStarted]);

  const chooseSpeechMode = (screenReaderMode: boolean) => {
    updateSettings({ screenReaderMode, firstRunDone: true });
    announce(
      screenReaderMode
        ? "Screen reader mode is on. AccessPilot will stay silent and your screen reader will read updates."
        : "AccessPilot will read updates aloud.",
      "polite",
    );
    focusComposer();
  };

  // The details saved in Settings travel with each new task; nothing is sent when they are empty.
  const start = (input: StartTaskRequest) => {
    const details = profileForTask(profileStore.getSnapshot());
    void session.start(details ? { ...input, details } : input);
  };

  const { reset: resetSession } = session;
  const startOver = useCallback(() => {
    resetSession();
    focusComposer();
  }, [resetSession, focusComposer]);

  const newTask = useCallback(() => {
    if (active) {
      announce("A task is running. Press Stop before starting a new one.", "assertive");
      return;
    }
    startOver();
  }, [active, announce, startOver]);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const toggleSidebar = useCallback(
    () => setSidebarCollapsed(!sidebarCollapsed),
    [setSidebarCollapsed, sidebarCollapsed],
  );
  const toggleBrowserPanel = useCallback(
    () => setBrowserPanelHidden(!browserPanelHidden),
    [setBrowserPanelHidden, browserPanelHidden],
  );
  const currentTask = useMemo(
    () =>
      state.request
        ? { goal: state.request.goal, url: state.request.url, status: state.status }
        : null,
    [state.request, state.status],
  );

  const suggest = (text: string) => {
    setGoal(text);
    announce(`Goal filled in: ${text} Add the website address, then press Start task.`, "polite");
  };

  const title = state.request?.goal ?? "New task";
  const showSuggestions = !active && state.request === null && goal.trim() === "";

  const composer = (
    <section
      aria-labelledby={`${id}-form-heading`}
      className="rounded-card border border-border bg-elevated shadow-elevated"
    >
      <div className="space-y-1 border-b border-border px-5 py-4 sm:px-6">
        <h2
          id={`${id}-form-heading`}
          tabIndex={-1}
          className="text-base font-semibold tracking-tight focus:outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
        >
          Start a task
        </h2>
        <p className="text-sm text-muted">
          Tell me a website and a goal. I&apos;ll do the steps, tell you what I&apos;m doing, and
          ask before anything important.
        </p>
      </div>
      <div className="space-y-5 px-5 py-5 sm:px-6">
        <VoiceControl
          supported={recognition.supported}
          listening={recognition.listening}
          interim={recognition.interim}
          transcript={recognition.transcript}
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
      </div>
      {showSuggestions && (
        <div className="space-y-2 border-t border-border px-5 py-4 sm:px-6">
          <p className={eyebrowStyles}>Try a goal</p>
          <ul className="flex flex-wrap gap-2">
            {SUGGESTED_GOALS.map((text) => (
              <li key={text}>
                <button
                  type="button"
                  onClick={() => suggest(text)}
                  className="min-h-9 rounded-full border border-border bg-subtle px-3.5 text-left text-[13px] text-fg transition-colors duration-150 hover:border-border-strong/60 hover:bg-hover"
                >
                  {text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );

  return (
    <div className="lg:flex lg:h-dvh lg:overflow-hidden">
      <Sidebar
        id={sidebarId}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        onNewTask={newTask}
        newTaskBlocked={active}
        onOpenSettings={openSettings}
        onOpenShortcuts={showHelp}
        currentTask={currentTask}
      />

      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        <TopBar
          title={title}
          status={state.status}
          mode={mode}
          theme={theme}
          onThemeChange={setTheme}
          onNewTask={newTask}
          newTaskBlocked={active}
          onOpenSettings={openSettings}
          onOpenShortcuts={showHelp}
          browserPanelId={browserPanelId}
          browserPanelOpen={!browserPanelHidden}
          onToggleBrowserPanel={toggleBrowserPanel}
        />

        <div
          role="group"
          aria-label="Show"
          className="grid grid-cols-2 gap-1 border-b border-border bg-bg p-2 lg:hidden"
        >
          {(
            [
              { value: "chat", label: "Conversation", Icon: MessageIcon },
              { value: "browser", label: "Browser", Icon: BrowserIcon },
            ] as const
          ).map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={pane === value}
              onClick={() => choosePane(value)}
              className="flex min-h-10 items-center justify-center gap-2 rounded-control text-sm font-medium text-muted transition-colors duration-150 hover:bg-hover hover:text-fg aria-pressed:bg-hover aria-pressed:text-fg [&_svg]:size-4"
            >
              <Icon />
              {label}
              {value === "browser" && unseenScreenshots > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-5 text-on-accent">
                  {unseenScreenshots}
                  <span className="sr-only"> new screenshots</span>
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="lg:flex lg:min-h-0 lg:flex-1">
          <main
            id="main"
            tabIndex={-1}
            className={`min-w-0 flex-1 focus:outline-none lg:overflow-y-auto ${pane === "chat" ? "" : "max-lg:hidden"}`}
          >
            <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
              {!settings.firstRunDone && <FirstRunSpeechPrompt onChoose={chooseSpeechMode} />}

              {!taskStarted && composer}

              <section
                aria-labelledby={`${id}-status-heading`}
                className={`rounded-card border bg-elevated p-5 transition-shadow duration-200 sm:px-6 ${
                  active
                    ? "z-10 border-accent/30 shadow-elevated [@media(min-height:36rem)]:sticky [@media(min-height:36rem)]:top-0"
                    : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={`mt-1 flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4 ${
                        state.status === "completed"
                          ? "bg-success-soft text-success"
                          : state.status === "failed"
                            ? "bg-danger-soft text-danger"
                            : state.status === "stopped"
                              ? "bg-subtle text-muted"
                              : active
                                ? "bg-accent-soft text-accent"
                                : "bg-subtle text-muted"
                      }`}
                    >
                      {state.status === "completed" ? (
                        <CheckIcon strokeWidth={2.25} />
                      ) : state.status === "failed" ? (
                        <AlertIcon />
                      ) : state.status === "stopped" ? (
                        <StopIcon />
                      ) : working || state.status === "starting" ? (
                        <Spinner />
                      ) : (
                        <i className="size-2 rounded-full bg-current" />
                      )}
                    </span>
                    <div className="min-w-0 space-y-0.5">
                      <h2
                        ref={statusRef}
                        id={`${id}-status-heading`}
                        tabIndex={-1}
                        className={`${eyebrowStyles} focus:outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus`}
                      >
                        Status
                      </h2>
                      <p className="text-lg font-medium leading-snug tracking-tight">
                        {statusSentence(state)}
                      </p>
                    </div>
                  </div>
                  {active && <StopButton onStop={stop} stopping={state.stopping} />}
                </div>
              </section>

              {state.handoff && (
                <HandoffPanel
                  handoff={state.handoff}
                  onContinue={() => void session.resume()}
                  onStop={stop}
                />
              )}

              <WarningList warnings={state.warnings} onDismiss={session.dismissWarning} />

              {state.status === "failed" && state.error && (
                <section
                  aria-labelledby={`${id}-error-heading`}
                  className="animate-enter space-y-4 rounded-card border border-danger/50 bg-danger-soft p-5 sm:px-6"
                >
                  <div className="flex items-start gap-3">
                    <AlertIcon className="mt-0.5 size-5 shrink-0 text-danger" />
                    <div className="space-y-1">
                      <h2 id={`${id}-error-heading`} className="text-base font-semibold">
                        The task didn&apos;t finish
                      </h2>
                      <p className="text-sm">{state.error.message}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:pl-8">
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
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={startOver} className={buttonStyles.secondary}>
                    <PlusIcon />
                    Start a new task
                  </button>
                </div>
              )}

              <Chat entries={state.log} busy={active} onSend={session.sendFollowUp} />

              {taskStarted && composer}
            </div>
          </main>

          <aside
            id={browserPanelId}
            aria-label="Browser preview"
            className={`min-w-0 border-border bg-subtle lg:w-[42%] lg:max-w-[40rem] lg:shrink-0 lg:overflow-y-auto lg:border-l xl:w-[40%] ${
              pane === "browser" ? "" : "max-lg:hidden"
            } ${browserPanelHidden ? "lg:hidden" : ""}`}
          >
            <BrowserWorkspace state={state} stillWorking={stillWorking} mode={mode} />
          </aside>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-xs text-muted sm:px-6">
          <p className="flex items-center gap-2">
            <ShieldIcon className="size-3.5 shrink-0" />
            AccessPilot never types passwords or card numbers, and never submits without your
            approval.
          </p>
          <p className="max-sm:hidden">
            Press <kbd className={kbdStyles}>?</kbd> for keyboard shortcuts
          </p>
        </footer>
      </div>

      <ApprovalDialog
        approval={state.approval}
        onApprove={() => void session.approve()}
        onDeny={() => void session.deny()}
        returnFocusRef={statusRef}
        voiceHint={
          recognition.supported
            ? `You can also press ${SHORTCUT_LABELS.mic} and say “approve” or “don't submit”.`
            : undefined
        }
      />
      <KeyboardShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeChange={setTheme}
        settings={settings}
        onChange={updateSettings}
        voices={speech.voices}
        speechSupported={speech.supported}
        onTestVoice={() => speak("This is how AccessPilot sounds.", "assertive")}
      />
    </div>
  );
}
