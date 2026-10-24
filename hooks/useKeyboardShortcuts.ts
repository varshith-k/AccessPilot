"use client";

import { useEffect, useRef } from "react";

export interface Shortcut {
  /** `KeyboardEvent.code`, e.g. "KeyS". Codes are layout- and modifier-independent. */
  code: string;
  alt?: boolean;
  shift?: boolean;
  /** Matches on `KeyboardEvent.key` instead of code, for characters like "?". */
  key?: string;
  /** Allow while typing in a text field. Only Stop should need this. */
  allowInTextFields?: boolean;
  handler: () => void;
}

/** Display form, e.g. "Alt+Shift+S", also used for `aria-keyshortcuts`. */
export const SHORTCUT_LABELS = {
  stop: "Alt+Shift+S",
  mic: "Alt+Shift+M",
  repeat: "Alt+Shift+R",
  help: "?",
} as const;

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "email",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])')
  ) {
    return true;
  }
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (event.ctrlKey || event.metaKey) return false;
  if (shortcut.key !== undefined) {
    return event.key === shortcut.key && !event.altKey;
  }
  return (
    event.code === shortcut.code &&
    event.altKey === Boolean(shortcut.alt) &&
    event.shiftKey === Boolean(shortcut.shift)
  );
}

/**
 * Global keyboard shortcuts on `window`. Shortcuts are ignored while typing in a text field
 * unless they opt in.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
  const latest = useRef(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const typing = isTextField(event.target);
      const match = latest.current.find((shortcut) => matchesShortcut(event, shortcut));
      if (!match || (typing && !match.allowInTextFields)) return;
      event.preventDefault();
      match.handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
