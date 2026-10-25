"use client";

import { useEffect, useId, useRef } from "react";
import type { Handoff } from "@/lib/client/taskState";
import { HandIcon } from "./ui/icons";
import { buttonStyles } from "./ui/styles";

export interface HandoffPanelProps {
  handoff: Handoff;
  onContinue(): void;
  onStop(): void;
}

const REASON_TEXT: Record<Handoff["reason"], string> = {
  sensitive_value:
    "This needs private information, like a password or card number. AccessPilot never types those for you.",
  captcha: "The page is asking for a CAPTCHA, which AccessPilot cannot solve.",
  login: "The page needs you to sign in yourself.",
  other: "This step needs you.",
};

/** Shown when the agent hands control back. Focus moves here so the user knows it is their turn. */
export function HandoffPanel({ handoff, onContinue, onStop }: HandoffPanelProps) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [handoff]);

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="animate-enter space-y-4 rounded-card border border-warning/50 bg-warning-soft p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-warning/40 bg-elevated text-warning">
          <HandIcon className="size-[18px]" />
        </span>
        <div className="min-w-0 space-y-1.5">
          <h2
            ref={headingRef}
            id={`${id}-heading`}
            tabIndex={-1}
            className="text-base font-semibold focus:outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            Your turn
          </h2>
          <p className="text-sm">{REASON_TEXT[handoff.reason]}</p>
          <p className="text-sm font-medium">{handoff.instructions}</p>
          <p className="text-[13px] text-fg/75">
            The browser window is the separate window AccessPilot opened for this task. Switch to it
            with Alt+Tab (Command+Tab on a Mac), finish the step there, then come back. AccessPilot
            is waiting and will not do anything until you press Continue or say “continue”.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:pl-12">
        <button type="button" onClick={onContinue} className={buttonStyles.primary}>
          Continue
        </button>
        <button type="button" onClick={onStop} className={buttonStyles.secondary}>
          Stop the task instead
        </button>
      </div>
    </section>
  );
}
