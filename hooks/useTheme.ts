"use client";

import { useSyncExternalStore } from "react";
import {
  readThemePreference,
  saveThemePreference,
  THEME_CHANGE_EVENT,
  type ThemePreference,
} from "@/lib/client/theme";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

/** The saved theme preference. The server and first client render use "system". */
export function useTheme(): [ThemePreference, (next: ThemePreference) => void] {
  const theme = useSyncExternalStore(subscribe, readThemePreference, () => "system" as const);
  return [theme, saveThemePreference];
}
