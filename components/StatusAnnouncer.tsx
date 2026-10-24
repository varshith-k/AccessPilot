"use client";

import { useState } from "react";
import { useLiveMessages } from "@/hooks/useAnnouncer";

export interface StatusAnnouncerProps {
  /**
   * Render inside a modal dialog. While a modal is open, browsers hide everything outside it from
   * assistive technology, including the page's live regions, so each dialog carries its own copy.
   * A local copy only speaks messages announced after it mounted, so nothing is read twice.
   */
  local?: boolean;
}

/** The two visually hidden live regions. Render once in the page and once in each modal dialog. */
export function StatusAnnouncer({ local = false }: StatusAnnouncerProps) {
  const messages = useLiveMessages();
  const [mountedAt] = useState(() => ({
    polite: messages.politeVersion,
    assertive: messages.assertiveVersion,
  }));
  const polite = !local || messages.politeVersion > mountedAt.polite ? messages.polite : "";
  const assertive =
    !local || messages.assertiveVersion > mountedAt.assertive ? messages.assertive : "";

  return (
    <>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid={local ? "live-polite-local" : "live-polite"}
      >
        {polite}
      </div>
      <div
        className="sr-only"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        data-testid={local ? "live-assertive-local" : "live-assertive"}
      >
        {assertive}
      </div>
    </>
  );
}
