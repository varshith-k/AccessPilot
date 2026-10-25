import { z } from "zod";

export const SETTINGS_STORAGE_KEY = "accesspilot.settings.v1";
export const MIN_SPEECH_RATE = 0.5;
export const MAX_SPEECH_RATE = 2;

export interface SpeechSettings {
  /** Built-in speech rate, 0.5 to 2. */
  rate: number;
  /** `SpeechSynthesisVoice.voiceURI`, or null for the browser default. */
  voiceURI: string | null;
  readAloud: boolean;
  /** The user's own screen reader speaks the live regions; built-in speech stays silent. */
  screenReaderMode: boolean;
  /** Whether the first-load speech question has been answered. */
  firstRunDone: boolean;
}

export const DEFAULT_SETTINGS: SpeechSettings = {
  rate: 1,
  voiceURI: null,
  readAloud: true,
  screenReaderMode: false,
  firstRunDone: false,
};

/**
 * What the server renders before the browser's saved settings are known. The first-run question
 * appears after hydration for new users instead of flashing away for returning ones.
 */
const SERVER_SETTINGS: SpeechSettings = { ...DEFAULT_SETTINGS, firstRunDone: true };

// Each field falls back to its default on its own, so one bad value never resets the rest.
const storedSettingsSchema = z.object({
  rate: z.number().min(MIN_SPEECH_RATE).max(MAX_SPEECH_RATE).catch(DEFAULT_SETTINGS.rate),
  voiceURI: z.string().min(1).nullable().catch(DEFAULT_SETTINGS.voiceURI),
  readAloud: z.boolean().catch(DEFAULT_SETTINGS.readAloud),
  screenReaderMode: z.boolean().catch(DEFAULT_SETTINGS.screenReaderMode),
  firstRunDone: z.boolean().catch(DEFAULT_SETTINGS.firstRunDone),
});

/** Built-in speech is used only when reading aloud is on and screen reader mode is off. */
export function builtInSpeechEnabled(settings: SpeechSettings): boolean {
  return settings.readAloud && !settings.screenReaderMode;
}

export function parseStoredSettings(raw: string | null): SpeechSettings {
  if (raw === null) return DEFAULT_SETTINGS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_SETTINGS;
  return storedSettingsSchema.parse({ ...DEFAULT_SETTINGS, ...value });
}

type StorageGetter = () => Storage | null;

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Access can throw when site data is blocked.
    return null;
  }
}

export interface SettingsStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SpeechSettings;
  getServerSnapshot(): SpeechSettings;
  update(patch: Partial<SpeechSettings>): void;
  /** Re-reads storage, e.g. after another tab changed it. */
  reload(): void;
}

/**
 * Settings persisted to localStorage. Reads and writes never throw; without storage the
 * settings still work for the current page and fall back to defaults next time.
 */
export function createSettingsStore(getStorage: StorageGetter = browserStorage): SettingsStore {
  const listeners = new Set<() => void>();
  let current: SpeechSettings | null = null;

  const read = (): SpeechSettings => {
    try {
      return parseStoredSettings(getStorage()?.getItem(SETTINGS_STORAGE_KEY) ?? null);
    } catch {
      return DEFAULT_SETTINGS;
    }
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SETTINGS_STORAGE_KEY) return;
    current = read();
    notify();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== "undefined") {
          window.removeEventListener("storage", onStorage);
        }
      };
    },
    getSnapshot() {
      current ??= read();
      return current;
    },
    getServerSnapshot() {
      return SERVER_SETTINGS;
    },
    update(patch) {
      const next = storedSettingsSchema.parse({ ...(current ?? read()), ...patch });
      current = next;
      try {
        getStorage()?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage full or blocked: keep the in-memory value.
      }
      notify();
    },
    reload() {
      current = read();
      notify();
    },
  };
}

export const settingsStore = createSettingsStore();
