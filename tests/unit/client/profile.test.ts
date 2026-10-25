import {
  EMPTY_PROFILE,
  PROFILE_STORAGE_KEY,
  createProfileStore,
  loadProfile,
  profileForTask,
  saveProfile,
} from "@/lib/client/profile";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
}

describe("profile storage", () => {
  it("round-trips saved details", () => {
    const store = memoryStorage();
    saveProfile({ name: "Ada", email: "ada@example.com", phone: "", notes: "CS" }, () => store);
    expect(loadProfile(() => store)).toEqual({
      name: "Ada",
      email: "ada@example.com",
      phone: "",
      notes: "CS",
    });
  });

  it("falls back to empty for missing, broken or invalid data, and never throws", () => {
    const store = memoryStorage();
    expect(loadProfile(() => store)).toEqual(EMPTY_PROFILE);
    store.setItem(PROFILE_STORAGE_KEY, "{not json");
    expect(loadProfile(() => store)).toEqual(EMPTY_PROFILE);
    store.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ name: "x".repeat(500) }));
    expect(loadProfile(() => store)).toEqual(EMPTY_PROFILE);
    expect(loadProfile(() => null)).toEqual(EMPTY_PROFILE);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    } as unknown as Storage;
    expect(loadProfile(() => throwing)).toEqual(EMPTY_PROFILE);
    expect(() => saveProfile(EMPTY_PROFILE, () => throwing)).not.toThrow();
  });
});

describe("profileForTask", () => {
  it("sends only the fields that are filled in, trimmed", () => {
    expect(profileForTask({ name: "  Ada ", email: "", phone: "  ", notes: "CS" })).toEqual({
      name: "Ada",
      notes: "CS",
    });
  });

  it("sends nothing when everything is empty", () => {
    expect(profileForTask(EMPTY_PROFILE)).toBeUndefined();
  });
});

describe("createProfileStore", () => {
  it("caches the snapshot, saves updates and tells subscribers", () => {
    const store = memoryStorage();
    const profile = createProfileStore(() => store);
    expect(profile.getSnapshot()).toBe(profile.getSnapshot());
    expect(profile.getServerSnapshot()).toEqual(EMPTY_PROFILE);
    const seen: string[] = [];
    const off = profile.subscribe(() => seen.push(profile.getSnapshot().name));
    profile.update({ name: "Ada" });
    off();
    profile.update({ name: "Grace" });
    expect(seen).toEqual(["Ada"]);
    expect(loadProfile(() => store).name).toBe("Grace");
  });
});
