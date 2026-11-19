"use client";

import { useCallback, useSyncExternalStore } from "react";

// Which teammate is holding this device. Honor system: the board is already
// behind the unlock link, and this only decides whose name goes on web writes
// and what "needs you" shows. Kept in this browser's localStorage. The server
// snapshot is "not chosen yet", so the first paint matches the HTML.

const KEY = "hub-who";
const CHANGED = "hub-who-changed";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const noopSubscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function useWho(validIds: string[]): [string | null, (id: string | null) => void] {
  const stored = useSyncExternalStore(subscribe, read, () => null);
  // An empty team list means the hub could not be read just now, not that this
  // person left the team: keep their identity through the gap.
  const who = stored && (validIds.length === 0 || validIds.includes(stored)) ? stored : null;
  const choose = useCallback((id: string | null) => {
    try {
      if (id) window.localStorage.setItem(KEY, id);
      else window.localStorage.removeItem(KEY);
    } catch {
      // Private mode: the choice lasts until reload.
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [who, choose];
}
