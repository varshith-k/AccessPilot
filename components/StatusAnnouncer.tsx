"use client";

import { useLiveMessages } from "@/hooks/useAnnouncer";

/** The two visually hidden live regions. Render once, inside AnnouncerProvider. */
export function StatusAnnouncer() {
  const { polite, assertive } = useLiveMessages();
  return (
    <>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="live-polite"
      >
        {polite}
      </div>
      <div
        className="sr-only"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        data-testid="live-assertive"
      >
        {assertive}
      </div>
    </>
  );
}
