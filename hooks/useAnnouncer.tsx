"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { NarrationPriority } from "@/lib/contracts";

export interface Announcer {
  announce(text: string, priority?: NarrationPriority): void;
}

interface LiveMessages {
  polite: string;
  assertive: string;
  /** Incremented on every update, so a region mounted later can tell old messages from new. */
  politeVersion: number;
  assertiveVersion: number;
}

const EMPTY_MESSAGES: LiveMessages = {
  polite: "",
  assertive: "",
  politeVersion: 0,
  assertiveVersion: 0,
};

/** Coalesced messages must still read as separate sentences. */
function asSentence(text: string): string {
  return /[.!?…:]["”’)]?$/.test(text) ? text : `${text}.`;
}

/** Polite messages arriving within this window are joined into one announcement. */
export const POLITE_COALESCE_MS = 400;
/** The same text in the same region within this window is announced only once. */
export const DEDUPE_WINDOW_MS = 2000;
/** At most this many polite messages are joined; older ones in a burst are dropped. */
export const MAX_COALESCED = 3;

const AnnouncerContext = createContext<Announcer | null>(null);
const LiveMessagesContext = createContext<LiveMessages>(EMPTY_MESSAGES);

/**
 * Owns the app's two live regions. Every component announces through `useAnnouncer` so that
 * messages are de-duplicated, rapid polite updates are coalesced, and assertive ones go first.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<LiveMessages>(EMPTY_MESSAGES);
  const pendingPolite = useRef<string[]>([]);
  const politeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpoken = useRef<Record<NarrationPriority, { text: string; at: number }>>({
    polite: { text: "", at: 0 },
    assertive: { text: "", at: 0 },
  });
  const assertiveToggle = useRef(false);
  const politeToggle = useRef(false);

  const isDuplicate = useCallback((text: string, priority: NarrationPriority) => {
    const last = lastSpoken.current[priority];
    const now = Date.now();
    if (last.text === text && now - last.at < DEDUPE_WINDOW_MS) return true;
    lastSpoken.current[priority] = { text, at: now };
    return false;
  }, []);

  // A trailing zero-width space alternates so a repeated message still changes the DOM text,
  // which is what makes screen readers announce it again. It is computed outside state updaters
  // because React may run an updater twice.
  const marked = (text: string, toggle: { current: boolean }) => {
    toggle.current = !toggle.current;
    return toggle.current ? text : `${text}​`;
  };

  const flushPolite = useCallback(() => {
    politeTimer.current = null;
    const batch = pendingPolite.current.slice(-MAX_COALESCED);
    pendingPolite.current = [];
    if (batch.length === 0) return;
    const polite = marked(batch.map(asSentence).join(" "), politeToggle);
    setMessages((current) => ({
      ...current,
      polite,
      politeVersion: current.politeVersion + 1,
    }));
  }, []);

  const announce = useCallback(
    (raw: string, priority: NarrationPriority = "polite") => {
      const text = raw.trim();
      if (text === "" || isDuplicate(text, priority)) return;
      if (priority === "assertive") {
        // Assertive news makes pending polite chatter stale.
        pendingPolite.current = [];
        if (politeTimer.current !== null) {
          clearTimeout(politeTimer.current);
          politeTimer.current = null;
        }
        const assertive = marked(text, assertiveToggle);
        setMessages((current) => ({
          ...current,
          polite: "",
          assertive,
          assertiveVersion: current.assertiveVersion + 1,
        }));
        return;
      }
      pendingPolite.current.push(text);
      if (politeTimer.current === null) {
        politeTimer.current = setTimeout(flushPolite, POLITE_COALESCE_MS);
      }
    },
    [flushPolite, isDuplicate],
  );

  useEffect(
    () => () => {
      if (politeTimer.current !== null) clearTimeout(politeTimer.current);
    },
    [],
  );

  const announcer = useMemo(() => ({ announce }), [announce]);

  return (
    <AnnouncerContext.Provider value={announcer}>
      <LiveMessagesContext.Provider value={messages}>{children}</LiveMessagesContext.Provider>
    </AnnouncerContext.Provider>
  );
}

export function useAnnouncer(): Announcer {
  const announcer = useContext(AnnouncerContext);
  if (announcer === null) {
    throw new Error("useAnnouncer must be used inside <AnnouncerProvider>.");
  }
  return announcer;
}

export function useLiveMessages(): LiveMessages {
  return useContext(LiveMessagesContext);
}
