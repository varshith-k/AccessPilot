export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "accesspilot.theme";
/** Fired on window when the preference changes in this tab. */
export const THEME_CHANGE_EVENT = "accesspilot:theme";
/** Used when localStorage is unavailable, so a change still applies for this visit. */
let memoryPreference: ThemePreference | null = null;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    // Fall through to memory.
  }
  return memoryPreference ?? "system";
}

/** `system` removes the override so `prefers-color-scheme` decides. */
export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;
}

export function saveThemePreference(preference: ThemePreference): void {
  applyThemePreference(preference);
  memoryPreference = preference;
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode); the choice still applies for this visit.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/**
 * Runs before first paint (inlined in the root layout) so a saved theme never flashes the
 * system one. Keep it dependency-free.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
