"use client";

import { useEffect, useRef, type RefObject } from "react";

function isGone(element: HTMLElement): boolean {
  return (
    !element.isConnected ||
    (element as HTMLButtonElement).disabled === true ||
    element.closest("[inert]") !== null
  );
}

/**
 * When the focused control disappears or becomes disabled (Start while starting, Continue after
 * a hand-off, Try again, Stop), browsers drop focus to <body> and a keyboard or screen reader user
 * loses their place. This moves focus to `fallback()` instead. It never takes focus the user
 * placed elsewhere, and it leaves focus inside open dialogs alone.
 */
export function useFocusRescue(fallback: () => RefObject<HTMLElement | null>, deps: unknown[]) {
  const lastFocused = useRef<HTMLElement | null>(null);
  const fallbackRef = useRef(fallback);
  useEffect(() => {
    fallbackRef.current = fallback;
  });

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) lastFocused.current = event.target;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      const previous = lastFocused.current;
      const onBody = active === null || active === document.body;
      // Chrome moves focus to <body> when the focused control goes away; other engines leave it
      // on the now-disabled control. Both count as lost.
      const activeGone = !onBody && active instanceof HTMLElement && isGone(active);
      const dropped = onBody && previous !== null && isGone(previous);
      if (!activeGone && !dropped) return;
      if (document.querySelector("dialog[open]")) return;
      fallbackRef.current().current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check whenever the caller's state changes
  }, deps);
}
