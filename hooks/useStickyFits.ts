"use client";

import { useEffect, useState, type RefObject } from "react";

/** The sticky status panel may use at most this share of the viewport height. */
export const MAX_STICKY_SHARE = 0.3;

/**
 * True when `ref`'s element is short enough to stay pinned to the top without covering the page.
 * With large text or zoom the panel grows, so it stops sticking rather than hiding what has focus.
 */
export function useStickyFits(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [fits, setFits] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const measure = () => setFits(element.offsetHeight <= window.innerHeight * MAX_STICKY_SHARE);
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, enabled]);

  return enabled && fits;
}
