"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  goalSchema,
  taskUrlSchema,
  type NarrationPriority,
  type StartTaskRequest,
  type TaskEvent,
} from "@/lib/contracts";
import { announcementFor } from "@/lib/client/announcements";
import {
  actionFailureFor,
  isRetryable,
  isTaskClientError,
  userMessageFor,
} from "@/lib/client/errors";
import {
  initialTaskState,
  isActiveStatus,
  isTerminalStatus,
  STOPPED_BY_USER_TEXT,
  transition,
  type TaskInput,
  type TaskState,
  type TransitionResult,
} from "@/lib/client/taskState";
import type { TaskClient } from "@/lib/client/types";

/** Side effects the session triggers. Defaults are no-ops so the hook works on its own. */
export interface SessionEffects {
  announce(text: string, priority: NarrationPriority, options?: { force?: boolean }): void;
  speak(text: string, priority: NarrationPriority, options?: { front?: boolean }): void;
  cancelSpeech(): void;
}

/** A direct answer to the user: never de-duplicated away, and spoken before queued narration. */
const REPLY = { force: true, front: true } as const;

export interface UseTaskSessionOptions {
  client: TaskClient;
  effects?: Partial<SessionEffects>;
  now?: () => Date;
}

export type FollowUpResult =
  | { ok: true }
  | { ok: false; reason: "empty" | "busy" | "no_url" }
  | { ok: false; reason: "invalid"; message: string };

export interface TaskSession {
  state: TaskState;
  start(input: StartTaskRequest): Promise<void>;
  approve(): Promise<void>;
  deny(reason?: string): Promise<void>;
  resume(answer?: string): Promise<void>;
  stop(): Promise<void>;
  retry(): Promise<void>;
  reset(): void;
  /**
   * Sends a typed or spoken follow-up. When nothing is running it starts a new task with the
   * last task's URL, or with `fallbackUrl` (the form's address) if there was no task yet.
   */
  sendFollowUp(
    text: string,
    fallbackUrl?: string,
    details?: StartTaskRequest["details"],
  ): FollowUpResult;
  dismissWarning(id: string): void;
  /**
   * Re-reads what matters most right now: the open approval question, the hand-off
   * instructions, the outcome, or the error; otherwise the latest narration or page map.
   * Returns false when there is nothing to repeat.
   */
  repeatLast(): boolean;
  /** Re-reads the page map; returns false when there is none yet. */
  describePage(): boolean;
}

const noop = () => undefined;

export const STOP_UNCONFIRMED_TEXT =
  "Stopped here, but AccessPilot couldn't reach its server to confirm. If the browser window is still doing something, close it.";
export const TASK_GONE_TEXT =
  "AccessPilot's server no longer has this task, so it can't continue. Nothing more will happen. Start the task again if you still need it.";

/** What "repeat" should say: the thing the user most needs to hear again in this state. */
export function mostImportantMessage(state: TaskState): string | null {
  switch (state.status) {
    case "awaiting_approval":
      if (state.approval) {
        const fields = state.approval.fields
          .map((field) => `${field.label}: ${field.value === "" ? "empty" : field.value}.`)
          .join(" ");
        return `Approval needed. ${state.approval.summary} ${fields} Nothing happens until you choose.`.replace(
          /\s+/g,
          " ",
        );
      }
      break;
    case "awaiting_user":
      if (state.handoff) return `Your turn. ${state.handoff.instructions}`;
      break;
    case "completed":
      if (state.outcome) return state.outcome;
      break;
    case "failed":
      if (state.error) return state.error.message;
      break;
    case "stopped":
      return state.stoppedBy === "system" ? "AccessPilot stopped the task." : STOPPED_BY_USER_TEXT;
    default:
      break;
  }
  if (state.lastNarration !== null) return state.lastNarration;
  return state.pageMap ? `${state.pageMap.title}. ${state.pageMap.summary}` : null;
}

export function useTaskSession({ client, effects, now }: UseTaskSessionOptions): TaskSession {
  const [state, setState] = useState<TaskState>(initialTaskState);
  const stateRef = useRef<TaskState>(initialTaskState);
  const stopRequestedRef = useRef(false);
  const mountedRef = useRef(true);

  const effectsRef = useRef<SessionEffects>({ announce: noop, speak: noop, cancelSpeech: noop });
  const clockRef = useRef<() => Date>(() => new Date());
  const announce = effects?.announce;
  const speak = effects?.speak;
  const cancelSpeech = effects?.cancelSpeech;
  useLayoutEffect(() => {
    effectsRef.current = {
      announce: announce ?? noop,
      speak: speak ?? noop,
      cancelSpeech: cancelSpeech ?? noop,
    };
    clockRef.current = now ?? (() => new Date());
  }, [announce, speak, cancelSpeech, now]);
  const timestamp = useCallback(() => clockRef.current().toISOString(), []);

  const dispatch = useCallback((input: TaskInput): TransitionResult => {
    const result = transition(stateRef.current, input);
    if (result.ignored !== null && process.env.NODE_ENV === "development") {
      console.debug(`[useTaskSession] ignored ${input.type}: ${result.ignored}`);
    }
    if (result.state !== stateRef.current && mountedRef.current) {
      stateRef.current = result.state;
      setState(result.state);
    }
    return result;
  }, []);

  const tell = useCallback(
    (
      text: string,
      priority: NarrationPriority,
      speak: boolean,
      options?: { force?: boolean; front?: boolean },
    ) => {
      if (options) {
        effectsRef.current.announce(text, priority, { force: options.force ?? false });
        if (speak) effectsRef.current.speak(text, priority, { front: options.front ?? false });
        return;
      }
      effectsRef.current.announce(text, priority);
      if (speak) effectsRef.current.speak(text, priority);
    },
    [],
  );

  const handleEvent = useCallback(
    (event: TaskEvent) => {
      const previousTotal = stateRef.current.totalSteps;
      const result = dispatch(event);
      if (result.ignored !== null) return;
      const announcement = announcementFor(event, previousTotal);
      if (announcement) tell(announcement.text, announcement.priority, announcement.speak);
    },
    [dispatch, tell],
  );

  const handleStreamError = useCallback(
    (error: Error) => {
      if (isTaskClientError(error) && !error.fatal) {
        const result = dispatch({ type: "ui/warning", message: error.message });
        // Announce a warning the first time; repeats only update its count on screen.
        if (result.state.warnings.at(-1)?.count === 1) tell(error.message, "polite", false);
        return;
      }
      const message = userMessageFor(error, "Lost the connection to AccessPilot.");
      const result = dispatch({ type: "ui/connection_lost", message, at: timestamp() });
      if (result.ignored === null) tell(message, "assertive", true);
    },
    [dispatch, tell, timestamp],
  );

  const { taskId, status } = state;
  const subscribed = taskId !== null && !isTerminalStatus(status);

  useEffect(() => {
    if (!subscribed || taskId === null) return;
    return client.subscribe(taskId, handleEvent, handleStreamError);
  }, [client, taskId, subscribed, handleEvent, handleStreamError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      effectsRef.current.cancelSpeech();
    };
  }, []);

  const sendStop = useCallback(
    async (id: string) => {
      try {
        await client.stop(id);
        const result = dispatch({ type: "ui/stop_succeeded", at: timestamp() });
        if (result.ignored === null) tell(STOPPED_BY_USER_TEXT, "assertive", true);
      } catch (error) {
        const message = STOP_UNCONFIRMED_TEXT;
        const failed = dispatch({ type: "ui/stop_failed", message, at: timestamp() });
        if (failed.ignored === null) tell(message, "assertive", true);
      }
    },
    [client, dispatch, tell, timestamp],
  );

  const start = useCallback(
    async (input: StartTaskRequest) => {
      const result = dispatch({ type: "ui/start_requested", ...input, at: timestamp() });
      if (result.ignored !== null) return;
      stopRequestedRef.current = false;
      tell("Starting your task.", "polite", false);
      try {
        const { taskId: newTaskId } = await client.start(input);
        if (stateRef.current.status !== "starting" || stateRef.current.taskId !== null) return;
        dispatch({ type: "ui/start_succeeded", taskId: newTaskId });
        if (stopRequestedRef.current) await sendStop(newTaskId);
      } catch (error) {
        const message = userMessageFor(error, "AccessPilot couldn't start the task. Try again.");
        const failed = dispatch({
          type: "ui/start_failed",
          message,
          at: timestamp(),
          recoverable: isRetryable(error),
        });
        if (failed.ignored === null) tell(message, "assertive", true);
      }
    },
    [client, dispatch, sendStop, tell, timestamp],
  );

  const decide = useCallback(
    async (decision: "approve" | "deny", reason?: string) => {
      const { approval, taskId: id } = stateRef.current;
      if (approval === null || id === null) return;
      const result = dispatch({ type: "ui/decision_sent", decision, at: timestamp() });
      if (result.ignored !== null) return;
      tell(decision === "approve" ? "Approved." : "Not submitting.", "polite", false);
      try {
        if (decision === "approve") await client.approve(id, approval.approvalId);
        else await client.deny(id, approval.approvalId, reason);
        dispatch({ type: "ui/decision_succeeded" });
      } catch (error) {
        const message = userMessageFor(
          error,
          "AccessPilot couldn't send your answer. Please choose again.",
        );
        const failure = actionFailureFor(error);
        const failed = dispatch({
          type: "ui/decision_failed",
          message: failure === "gone" ? TASK_GONE_TEXT : message,
          at: timestamp(),
          failure,
        });
        if (failed.ignored === null) tell(message, "assertive", true);
      }
    },
    [client, dispatch, tell, timestamp],
  );

  const approve = useCallback(() => decide("approve"), [decide]);
  const deny = useCallback((reason?: string) => decide("deny", reason), [decide]);

  const resume = useCallback(
    async (answer?: string) => {
      const id = stateRef.current.taskId;
      if (id === null) return;
      const result = dispatch({ type: "ui/resume_sent", at: timestamp() });
      if (result.ignored !== null) return;
      tell("Continuing.", "polite", false);
      try {
        await client.resume(id, answer);
        dispatch({ type: "ui/resume_succeeded" });
      } catch (error) {
        const message = userMessageFor(
          error,
          "AccessPilot couldn't continue. Press Continue again.",
        );
        const failure = actionFailureFor(error);
        const failed = dispatch({
          type: "ui/resume_failed",
          message: failure === "gone" ? TASK_GONE_TEXT : message,
          at: timestamp(),
          failure,
        });
        if (failed.ignored === null) tell(message, "assertive", true);
      }
    },
    [client, dispatch, tell, timestamp],
  );

  const stop = useCallback(async () => {
    // Silence first: stopping must feel instant even if the network is slow.
    effectsRef.current.cancelSpeech();
    const result = dispatch({ type: "ui/stop_requested" });
    if (result.ignored !== null) return;
    effectsRef.current.announce("Stopping.", "assertive");
    const id = stateRef.current.taskId;
    if (id === null) {
      // Still waiting for the task id; start() stops it as soon as the id arrives.
      stopRequestedRef.current = true;
      return;
    }
    await sendStop(id);
  }, [dispatch, sendStop]);

  const retry = useCallback(async () => {
    const { request, status: current } = stateRef.current;
    if (request === null || current !== "failed") return;
    await start(request);
  }, [start]);

  const reset = useCallback(() => {
    dispatch({ type: "ui/reset" });
  }, [dispatch]);

  const sendFollowUp = useCallback(
    (text: string, fallbackUrl?: string, details?: StartTaskRequest["details"]): FollowUpResult => {
      if (text.trim() === "") return { ok: false, reason: "empty" };
      const { status: current, request } = stateRef.current;
      if (isActiveStatus(current)) return { ok: false, reason: "busy" };
      const goal = goalSchema.safeParse(text);
      if (!goal.success) {
        return {
          ok: false,
          reason: "invalid",
          message: goal.error.issues[0]?.message ?? "That message can't be used as a goal.",
        };
      }
      let url = request?.url;
      if (url === undefined && fallbackUrl !== undefined && fallbackUrl.trim() !== "") {
        const parsed = taskUrlSchema.safeParse(fallbackUrl);
        if (!parsed.success) {
          return {
            ok: false,
            reason: "invalid",
            message:
              `The website address in the task form isn't valid. ${parsed.error.issues[0]?.message ?? ""}`.trim(),
          };
        }
        url = parsed.data;
      }
      if (url === undefined) return { ok: false, reason: "no_url" };
      void start(details ? { url, goal: goal.data, details } : { url, goal: goal.data });
      return { ok: true };
    },
    [start],
  );

  const dismissWarning = useCallback(
    (id: string) => {
      dispatch({ type: "ui/warning_dismissed", id });
    },
    [dispatch],
  );

  const repeatLast = useCallback(() => {
    const text = mostImportantMessage(stateRef.current);
    if (text === null) return false;
    tell(text, "polite", true, REPLY);
    return true;
  }, [tell]);

  const describePage = useCallback(() => {
    const map = stateRef.current.pageMap;
    if (map === null) return false;
    tell(`${map.title}. ${map.summary}`, "polite", true, REPLY);
    return true;
  }, [tell]);

  return useMemo(
    () => ({
      state,
      start,
      approve,
      deny,
      resume,
      stop,
      retry,
      reset,
      sendFollowUp,
      dismissWarning,
      repeatLast,
      describePage,
    }),
    [
      state,
      start,
      approve,
      deny,
      resume,
      stop,
      retry,
      reset,
      sendFollowUp,
      dismissWarning,
      repeatLast,
      describePage,
    ],
  );
}
