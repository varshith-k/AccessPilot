import {
  builtInSpeechEnabled,
  createSettingsStore,
  DEFAULT_SETTINGS,
  parseStoredSettings,
  SETTINGS_STORAGE_KEY,
} from "@/lib/client/settings";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("parseStoredSettings", () => {
  it("returns defaults for missing, malformed, or non-object data", () => {
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings("[1,2]")).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings("42")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid fields and replaces only the invalid ones", () => {
    const stored = JSON.stringify({
      rate: 9,
      voiceURI: "fake:Ava",
      readAloud: "yes",
      screenReaderMode: true,
      firstRunDone: true,
      extra: "ignored",
    });
    expect(parseStoredSettings(stored)).toEqual({
      rate: DEFAULT_SETTINGS.rate,
      voiceURI: "fake:Ava",
      readAloud: DEFAULT_SETTINGS.readAloud,
      screenReaderMode: true,
      firstRunDone: true,
    });
  });
});

describe("builtInSpeechEnabled", () => {
  it("is on only when reading aloud and not in screen reader mode", () => {
    expect(builtInSpeechEnabled(DEFAULT_SETTINGS)).toBe(true);
    expect(builtInSpeechEnabled({ ...DEFAULT_SETTINGS, screenReaderMode: true })).toBe(false);
    expect(builtInSpeechEnabled({ ...DEFAULT_SETTINGS, readAloud: false })).toBe(false);
  });
});

describe("createSettingsStore", () => {
  it("loads from storage, persists updates, and notifies subscribers", () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ rate: 1.5 }),
    });
    const store = createSettingsStore(() => storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getSnapshot().rate).toBe(1.5);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    store.update({ screenReaderMode: true });
    expect(store.getSnapshot()).toMatchObject({ rate: 1.5, screenReaderMode: true });
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      screenReaderMode: true,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("clamps invalid updates back to safe values", () => {
    const store = createSettingsStore(() => memoryStorage());
    store.update({ rate: 10 });
    expect(store.getSnapshot().rate).toBe(DEFAULT_SETTINGS.rate);
  });

  it("works when storage is missing or throws", () => {
    const throwing = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    } as Storage;
    const store = createSettingsStore(() => throwing);
    expect(store.getSnapshot()).toEqual(DEFAULT_SETTINGS);
    store.update({ readAloud: false });
    expect(store.getSnapshot().readAloud).toBe(false);

    const none = createSettingsStore(() => null);
    none.update({ rate: 1.2 });
    expect(none.getSnapshot().rate).toBe(1.2);
  });

  it("renders defaults on the server, without the first-run question", () => {
    const store = createSettingsStore(() =>
      memoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ rate: 2 }) }),
    );
    expect(store.getServerSnapshot()).toEqual({ ...DEFAULT_SETTINGS, firstRunDone: true });
  });

  it("picks up changes made in another tab", () => {
    const storage = memoryStorage();
    const store = createSettingsStore(() => storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.getSnapshot().readAloud).toBe(true);

    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ readAloud: false }));
    window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: SETTINGS_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().readAloud).toBe(false);

    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reload re-reads storage", () => {
    const storage = memoryStorage();
    const store = createSettingsStore(() => storage);
    expect(store.getSnapshot().rate).toBe(1);
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ rate: 0.8 }));
    store.reload();
    expect(store.getSnapshot().rate).toBe(0.8);
  });

  it("defaults to window.localStorage", () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ rate: 1.7 }));
    expect(createSettingsStore().getSnapshot().rate).toBe(1.7);
    window.localStorage.clear();
  });
});
