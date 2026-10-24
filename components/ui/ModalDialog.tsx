"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { XIcon } from "./icons";
import { IconButton } from "./IconButton";

export interface ModalDialogProps {
  open: boolean;
  onClose(): void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Tailwind width class. */
  widthClass?: string;
}

/**
 * A native modal <dialog>: focus is trapped by the browser, Escape closes it, and focus returns
 * to whatever opened it. Focus starts on the heading so screen readers announce the title first.
 */
export function ModalDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  widthClass = "w-[min(36rem,calc(100vw-2rem))]",
}: ModalDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      headingRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleClose = () => {
    returnFocus.current?.focus();
    returnFocus.current = null;
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-heading`}
      aria-describedby={description ? `${id}-description` : undefined}
      onClose={handleClose}
      className={`m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card border border-border bg-elevated p-0 text-fg shadow-dialog ${widthClass}`}
    >
      {open && (
        <div>
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div className="min-w-0 space-y-0.5">
              <h2
                ref={headingRef}
                id={`${id}-heading`}
                tabIndex={-1}
                className="text-base font-semibold tracking-tight focus:outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
              >
                {title}
              </h2>
              {description && (
                <p id={`${id}-description`} className="text-[13px] text-muted">
                  {description}
                </p>
              )}
            </div>
            <IconButton
              label={`Close ${title.toLowerCase()}`}
              onClick={onClose}
              className="-mr-2 -mt-1"
            >
              <XIcon />
            </IconButton>
          </div>
          <div className="space-y-6 px-6 py-5">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>
          )}
        </div>
      )}
    </dialog>
  );
}
