"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { goalSchema, taskUrlSchema, type StartTaskRequest } from "@/lib/contracts";
import { useAnnouncer } from "@/hooks/useAnnouncer";
import { AlertIcon, ArrowUpIcon, GlobeIcon, Spinner } from "./ui/icons";
import { buttonStyles, errorTextStyles, hintStyles, inputStyles, labelStyles } from "./ui/styles";

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

  // POST keeps the typed goal out of the URL and history if the form is submitted before the
  // page's scripts load; afterwards onSubmit handles everything.
  return (
    <form
      method="post"
      noValidate
      onSubmit={handleSubmit}
      className="space-y-4"
      aria-describedby={busy && busyMessage ? ids.busy : undefined}
    >
      <div className="space-y-1.5">
        <label htmlFor={ids.url} className={labelStyles}>
          Website address
        </label>
        <div className="relative">
          <GlobeIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
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
            className={`${inputStyles} pl-10 font-mono text-sm`}
          />
        </div>
        <p id={ids.urlHint} className={hintStyles}>
          Starts with https://. Use http://localhost only for local testing.
        </p>
        {errors.url && (
          <p id={ids.urlError} className={errorTextStyles}>
            <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {errors.url}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={ids.goal} className={labelStyles}>
          What do you want to get done?
        </label>
        <textarea
          ref={goalRef}
          id={ids.goal}
          name="goal"
          rows={3}
          value={goal}
          placeholder="Describe the task in your own words…"
          onChange={(event) => onGoalChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          aria-invalid={errors.goal ? true : undefined}
          aria-describedby={describedBy(ids.goalHint, Boolean(errors.goal) && ids.goalError)}
          className={`${inputStyles} min-h-24 resize-y leading-6`}
        />
        <p id={ids.goalHint} className={hintStyles}>
          For example: Help me complete this scholarship application. Press Enter to start, or
          Shift+Enter for a new line.
        </p>
        {errors.goal && (
          <p id={ids.goalError} className={errorTextStyles}>
            <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {errors.goal}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {starting && (
          <p className={`${hintStyles} mr-auto`}>
            Starting your task. This usually takes a few seconds.
          </p>
        )}
        <button type="submit" disabled={starting} className={buttonStyles.primary}>
          {starting ? <Spinner /> : <ArrowUpIcon />}
          {starting ? "Starting…" : "Start task"}
        </button>
      </div>
      {busy && busyMessage && (
        <p id={ids.busy} className={errorTextStyles}>
          <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
          {busyMessage}
        </p>
      )}
    </form>
  );
}
