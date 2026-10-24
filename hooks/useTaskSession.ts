"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { NarrationPriority, StartTaskRequest, TaskEvent } from "@/lib/contracts";
import { announcementFor } from "@/lib/client/announcements";
import { isTaskClientError, userMessageFor } from "@/lib/client/errors";
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
  announce(text: string, priority: NarrationPriority): void;
  speak(text: string, priority: NarrationPriority): void;
  cancelSpeech(): void;
}

export interface UseTaskSessionOptions {
  client: TaskClient;
  effects?: Partial<SessionEffects>;
  now?: () => Date;
}

export type FollowUpResult = { ok: true } | { ok: false; reason: "empty" | "busy" | "no_url" };

export interface TaskSession {
  state: TaskState;
  start(input: StartTaskRequest): Promise<void>;
  approve(): Promise<void>;
  deny(reason?: string): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  retry(): Promise<void>;
  reset(): void;
  /** Sends a typed or spoken follow-up. Starts a new task with the same URL when nothing is running. */
  sendFollowUp(text: string): FollowUpResult;
  dismissWarning(id: string): void;
  /** Re-reads the most recent narration; returns false when there is nothing to repeat. */
  repeatLastNarration(): boolean;
  /** Re-reads the page map; returns false when there is none yet. */
  describePage(): boolean;
}

const noop = () => undefined;

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

  const tell = useCallback((text: string, priority: NarrationPriority, speak: boolean) => {
    effectsRef.current.announce(text, priority);
    if (speak) effectsRef.current.speak(text, priority);
  }, []);

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
        dispatch({ type: "ui/warning", message: error.message });
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
        const message = userMessageFor(
          error,
          "AccessPilot couldn't confirm the stop. Press Stop again.",
        );
        dispatch({ type: "ui/stop_failed", message, at: timestamp() });
        tell(message, "assertive", true);
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
        const failed = dispatch({ type: "ui/start_failed", message, at: timestamp() });
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
        const failed = dispatch({ type: "ui/decision_failed", message, at: timestamp() });
        if (failed.ignored === null) tell(message, "assertive", true);
      }
    },
    [client, dispatch, tell, timestamp],
  );

  const approve = useCallback(() => decide("approve"), [decide]);
  const deny = useCallback((reason?: string) => decide("deny", reason), [decide]);

  const resume = useCallback(async () => {
    const id = stateRef.current.taskId;
    if (id === null) return;
    const result = dispatch({ type: "ui/resume_sent", at: timestamp() });
    if (result.ignored !== null) return;
    tell("Continuing.", "polite", false);
    try {
      await client.resume(id);
      dispatch({ type: "ui/resume_succeeded" });
    } catch (error) {
      const message = userMessageFor(error, "AccessPilot couldn't continue. Press Continue again.");
      const failed = dispatch({ type: "ui/resume_failed", message, at: timestamp() });
      if (failed.ignored === null) tell(message, "assertive", true);
    }
  }, [client, dispatch, tell, timestamp]);

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
    (text: string): FollowUpResult => {
      const goal = text.trim();
      if (goal === "") return { ok: false, reason: "empty" };
      const { status: current, request } = stateRef.current;
      if (isActiveStatus(current)) return { ok: false, reason: "busy" };
      if (request === null) return { ok: false, reason: "no_url" };
      void start({ url: request.url, goal });
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

  const repeatLastNarration = useCallback(() => {
    const text = stateRef.current.lastNarration;
    if (text === null) return false;
    tell(text, "polite", true);
    return true;
  }, [tell]);

  const describePage = useCallback(() => {
    const map = stateRef.current.pageMap;
    if (map === null) return false;
    tell(`${map.title}. ${map.summary}`, "polite", true);
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
      repeatLastNarration,
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
      repeatLastNarration,
      describePage,
    ],
  );
}
