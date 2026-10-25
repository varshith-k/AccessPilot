import { profileDetailsSchema, type ProfileDetails } from "@/lib/contracts";

export const PROFILE_STORAGE_KEY = "accesspilot.profile.v1";

export const EMPTY_PROFILE: Required<ProfileDetails> = {
  name: "",
  email: "",
  phone: "",
  notes: "",
};

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Access can throw when site data is blocked.
    return null;
  }
}

/** The details saved in this browser. Anything unreadable falls back to empty fields. */
export function loadProfile(getStorage: () => Storage | null = storage): Required<ProfileDetails> {
  try {
    const raw = getStorage()?.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return EMPTY_PROFILE;
    const parsed = profileDetailsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { ...EMPTY_PROFILE, ...parsed.data } : EMPTY_PROFILE;
  } catch {
    return EMPTY_PROFILE;
  }
}

/** Saves the details in this browser. Never throws; without storage they last for this page only. */
export function saveProfile(
  profile: ProfileDetails,
  getStorage: () => Storage | null = storage,
): void {
  try {
    getStorage()?.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Quota or blocked storage: the form still shows what was typed.
  }
}

/** The non-empty details to send with a task, or undefined when nothing was filled in. */
export function profileForTask(profile: ProfileDetails): ProfileDetails | undefined {
  const filled = Object.fromEntries(
    Object.entries(profile).flatMap(([key, value]) =>
      typeof value === "string" && value.trim() ? [[key, value.trim()]] : [],
    ),
  ) as ProfileDetails;
  return Object.keys(filled).length > 0 ? filled : undefined;
}

/** A tiny store over the saved profile, for `useSyncExternalStore`. Snapshots are cached. */
export function createProfileStore(getStorage: () => Storage | null = storage) {
  const listeners = new Set<() => void>();
  let current: Required<ProfileDetails> | null = null;
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): Required<ProfileDetails> {
      current ??= loadProfile(getStorage);
      return current;
    },
    getServerSnapshot(): Required<ProfileDetails> {
      return EMPTY_PROFILE;
    },
    update(patch: Partial<ProfileDetails>) {
      current = { ...this.getSnapshot(), ...patch };
      saveProfile(current, getStorage);
      for (const listener of [...listeners]) listener();
    },
  };
}

export const profileStore = createProfileStore();
