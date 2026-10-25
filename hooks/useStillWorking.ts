"use client";

import { useEffect, useRef, useState } from "react";

/** Quiet time before the first "still working" message. */
export const STILL_WORKING_AFTER_MS = 8000;
/** How often the message is refreshed after that. */
export const STILL_WORKING_REPEAT_MS = 15000;
/** Announcements are spaced at least this far apart, even across short quiet spells. */
export const STILL_WORKING_ANNOUNCE_EVERY_MS = 30000;

export function stillWorkingMessage(elapsedMs: number): string {
  const seconds = Math.round(elapsedMs / 1000);
  return seconds < 15
    ? "Still working. The website is taking a while to respond."
    : `Still working. No update for ${seconds} seconds. You can keep waiting or press Stop.`;
}

/**
 * Returns a reassurance message once the task has been quiet for a while, and announces it at
 * most every 30 seconds so a backend with regular gaps doesn't flood the live region.
 * `activityKey` must change whenever something happens (for example the last event seq).
 */
export function useStillWorking(
  active: boolean,
  activityKey: number,
  announce: (text: string) => void,
): string | null {
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);
  const lastAnnouncedAt = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    if (!active) return;
    let elapsed = STILL_WORKING_AFTER_MS;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const text = stillWorkingMessage(elapsed);
      setNotice({ key: activityKey, text });
      const now = Date.now();
      if (now - lastAnnouncedAt.current >= STILL_WORKING_ANNOUNCE_EVERY_MS) {
        lastAnnouncedAt.current = now;
        announce(text);
      }
      elapsed += STILL_WORKING_REPEAT_MS;
      timer = setTimeout(tick, STILL_WORKING_REPEAT_MS);
    };
    timer = setTimeout(tick, STILL_WORKING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [active, activityKey, announce]);

  return active && notice?.key === activityKey ? notice.text : null;
}
