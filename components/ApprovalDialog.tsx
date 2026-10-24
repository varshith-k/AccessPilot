"use client";

import { useEffect, useId, useRef, type RefObject, type SyntheticEvent } from "react";
import type { PendingApproval } from "@/lib/client/taskState";
import { ShieldIcon } from "./ui/icons";
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

const dialogStyles =
  "m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card border border-border bg-elevated p-0 text-fg shadow-dialog";

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
      className={`${dialogStyles} w-[min(36rem,calc(100vw-2rem))]`}
    >
      {approval && (
        <div className="space-y-5 p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
              <ShieldIcon className="size-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <h2
                ref={headingRef}
                id={headingId}
                tabIndex={-1}
                className="text-lg font-semibold leading-snug tracking-tight focus:outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
              >
                Approval needed: {approval.action}
              </h2>
              <p id={summaryId} className="text-sm text-muted">
                {approval.summary}
              </p>
            </div>
          </div>
          {approval.fields.length > 0 && (
            <dl className="divide-y divide-border overflow-hidden rounded-control border border-border bg-subtle text-sm">
              {approval.fields.map((field, index) => (
                <div
                  key={`${field.label}-${index}`}
                  className="grid grid-cols-1 gap-x-4 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[minmax(7rem,max-content)_1fr]"
                >
                  <dt className="text-muted">{field.label}</dt>
                  <dd className="break-words font-medium">
                    {field.value === "" ? (
                      <span className="font-normal text-muted">(empty)</span>
                    ) : (
                      field.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-[13px] leading-5 text-muted">
            Nothing is submitted until you choose. Pressing Escape means Don&apos;t submit.
            {voiceHint && ` ${voiceHint}`}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
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
