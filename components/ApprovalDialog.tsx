"use client";

import { useEffect, useId, useRef, type RefObject, type SyntheticEvent } from "react";
import type { PendingApproval } from "@/lib/client/taskState";
import { buttonStyles } from "./ui/styles";

export interface ApprovalDialogProps {
  /** The pending approval; the dialog is open exactly while this is non-null. */
  approval: PendingApproval | null;
  onApprove(): void;
  onDeny(): void;
  /** Where focus goes when the dialog closes. */
  returnFocusRef: RefObject<HTMLElement | null>;
  /** How to answer by voice, shown when voice input is available. */
  voiceHint?: string | undefined;
}

/**
 * Modal confirmation before anything consequential. Focus starts on the heading, never on
 * Approve. Escape always means "Don't submit". There is no timeout.
 */
export function ApprovalDialog({
  approval,
  onApprove,
  onDeny,
  returnFocusRef,
  voiceHint,
}: ApprovalDialogProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  const summaryId = `${id}-summary`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const open = approval !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      headingRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocusRef.current?.focus();
    }
  }, [open, returnFocusRef]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    // Escape: keep control of closing, and treat it as a refusal.
    event.preventDefault();
    onDeny();
  };

  const handleClose = () => {
    // Browsers may close a modal without a cancel event (repeated Escape). Never leave an
    // approval pending behind a closed dialog: that counts as a refusal too.
    if (approval !== null) onDeny();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      aria-describedby={summaryId}
      onCancel={handleCancel}
      onClose={handleClose}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border-2 border-border bg-bg p-0 text-fg backdrop:bg-black/60"
    >
      {approval && (
        <div className="space-y-4 p-5">
          <h2 ref={headingRef} id={headingId} tabIndex={-1} className="text-2xl font-bold">
            Approval needed: {approval.action}
          </h2>
          <p id={summaryId}>{approval.summary}</p>
          {approval.fields.length > 0 && (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-md border border-border bg-surface p-3 sm:grid-cols-[max-content_1fr]">
              {approval.fields.map((field, index) => (
                <div key={`${field.label}-${index}`} className="contents">
                  <dt className="font-semibold">{field.label}</dt>
                  <dd className="mb-2 break-words sm:mb-0">
                    {field.value === "" ? <span className="text-muted">(empty)</span> : field.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-sm text-muted">
            Nothing is submitted until you choose. Pressing Escape means Don&apos;t submit.
            {voiceHint && ` ${voiceHint}`}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onDeny} className={buttonStyles.secondary}>
              Don&apos;t submit
            </button>
            <button type="button" onClick={onApprove} className={buttonStyles.primary}>
              Approve and submit
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
