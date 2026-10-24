"use client";

import { useCallback, useSyncExternalStore } from "react";
import { settingsStore, type SettingsStore, type SpeechSettings } from "@/lib/client/settings";

export function useSettings(
  store: SettingsStore = settingsStore,
): [SpeechSettings, (patch: Partial<SpeechSettings>) => void] {
  const settings = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const update = useCallback((patch: Partial<SpeechSettings>) => store.update(patch), [store]);
  return [settings, update];
}
