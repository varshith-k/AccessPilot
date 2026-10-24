"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { goalSchema, taskUrlSchema, type StartTaskRequest } from "@/lib/contracts";
import { useAnnouncer } from "@/hooks/useAnnouncer";
import { buttonStyles, inputStyles } from "./ui/styles";

export interface TaskFormProps {
  url: string;
  goal: string;
  onUrlChange(value: string): void;
  onGoalChange(value: string): void;
  onSubmit(input: StartTaskRequest): void;
  /** True only while the task is being created; the button says why it is unavailable. */
  starting: boolean;
  /** True while a task runs; submitting explains that it must be stopped first. */
  busy: boolean;
}

interface FieldErrors {
  url?: string;
  goal?: string;
}

export function TaskForm({
  url,
  goal,
  onUrlChange,
  onGoalChange,
  onSubmit,
  starting,
  busy,
}: TaskFormProps) {
  const id = useId();
  const ids = {
    url: `${id}-url`,
    urlHint: `${id}-url-hint`,
    urlError: `${id}-url-error`,
    goal: `${id}-goal`,
    goalHint: `${id}-goal-hint`,
    goalError: `${id}-goal-error`,
    busy: `${id}-busy`,
  };
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const { announce } = useAnnouncer();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) {
      const message = "A task is already running. Press Stop before starting a new one.";
      setBusyMessage(message);
      announce(message, "assertive");
      return;
    }
    setBusyMessage(null);
    const urlResult = taskUrlSchema.safeParse(url);
    const goalResult = goalSchema.safeParse(goal);
    const next: FieldErrors = {};
    if (!urlResult.success) next.url = urlResult.error.issues[0]?.message;
    if (!goalResult.success) next.goal = goalResult.error.issues[0]?.message;
    setErrors(next);

    if (!urlResult.success || !goalResult.success) {
      const problems = [next.url, next.goal].filter(Boolean);
      announce(
        problems.length === 1
          ? `Please fix this: ${problems[0]}`
          : `Please fix ${problems.length} problems. ${problems.join(" ")}`,
        "assertive",
      );
      (next.url ? urlRef : goalRef).current?.focus();
      return;
    }
    onSubmit({ url: urlResult.data, goal: goalResult.data });
  };

  const describedBy = (...parts: (string | false)[]) => parts.filter(Boolean).join(" ");

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="space-y-4"
      aria-describedby={busy && busyMessage ? ids.busy : undefined}
    >
      <div className="space-y-1">
        <label htmlFor={ids.url} className="block font-semibold">
          Website address
        </label>
        <p id={ids.urlHint} className="text-sm text-muted">
          Starts with https://. Use http://localhost only for local testing.
        </p>
        <input
          ref={urlRef}
          id={ids.url}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://example.edu/apply"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          aria-invalid={errors.url ? true : undefined}
          aria-describedby={describedBy(ids.urlHint, Boolean(errors.url) && ids.urlError)}
          className={inputStyles}
        />
        {errors.url && (
          <p id={ids.urlError} className="font-semibold text-danger">
            <span aria-hidden="true">⚠ </span>
            {errors.url}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor={ids.goal} className="block font-semibold">
          What do you want to get done?
        </label>
        <p id={ids.goalHint} className="text-sm text-muted">
          For example: Help me complete this scholarship application. Press Enter to start, or
          Shift+Enter for a new line.
        </p>
        <textarea
          ref={goalRef}
          id={ids.goal}
          name="goal"
          rows={3}
          value={goal}
          onChange={(event) => onGoalChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          aria-invalid={errors.goal ? true : undefined}
          aria-describedby={describedBy(ids.goalHint, Boolean(errors.goal) && ids.goalError)}
          className={inputStyles}
        />
        {errors.goal && (
          <p id={ids.goalError} className="font-semibold text-danger">
            <span aria-hidden="true">⚠ </span>
            {errors.goal}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={starting} className={buttonStyles.primary}>
          {starting ? "Starting…" : "Start task"}
        </button>
        {starting && (
          <p className="text-sm text-muted">
            Starting your task. This usually takes a few seconds.
          </p>
        )}
      </div>
      {busy && busyMessage && (
        <p id={ids.busy} className="font-semibold text-danger">
          {busyMessage}
        </p>
      )}
    </form>
  );
}
