"use client";

import { useEffect, useId, useRef } from "react";
import type { Handoff } from "@/lib/client/taskState";
import { buttonStyles, panelStyles } from "./ui/styles";

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
    <section className={`${panelStyles} space-y-3 border-2 border-warning`}>
      <h3 ref={headingRef} id={`${id}-heading`} tabIndex={-1} className="text-lg font-bold">
        Your turn
      </h3>
      <p>{REASON_TEXT[handoff.reason]}</p>
      <p className="font-semibold">{handoff.instructions}</p>
      <p className="text-sm text-muted">
        AccessPilot is waiting and will not do anything until you press Continue.
      </p>
      <div className="flex flex-wrap gap-3">
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
