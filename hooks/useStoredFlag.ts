"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE_EVENT = "accesspilot:stored-flag";
/** Used when localStorage is unavailable, so a change still applies for this visit. */
const memory = new Map<string, boolean>();

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function read(key: string, initial: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === "true" || stored === "false") return stored === "true";
  } catch {
    // Fall through to memory.
  }
  return memory.get(key) ?? initial;
}

/**
 * A boolean layout preference remembered in localStorage, such as a collapsed panel. The server
 * and first client render use `initial`, so hydration always matches; it is a convenience,
 * never required state.
 */
export function useStoredFlag(key: string, initial: boolean): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, initial),
    () => initial,
  );

  const update = useCallback(
    (next: boolean) => {
      memory.set(key, next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Not remembered, but still applied for this visit via `memory`.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key],
  );

  return [value, update];
}
