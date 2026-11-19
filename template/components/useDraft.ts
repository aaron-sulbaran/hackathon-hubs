"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// State that outlives a remount or a full reload of this tab: a half typed
// answer, which rows are open. Kept in sessionStorage under `key`. The first
// render returns `initial` so it matches the server HTML; the saved value
// arrives right after. Storage failures (private mode) fall back to plain state.

const PREFIX = "hub-draft:";

export function useDraft<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const initialRef = useRef(initial);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(PREFIX + key);
      setValue(saved === null ? initialRef.current : (JSON.parse(saved) as T));
    } catch {
      setValue(initialRef.current);
    }
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        const text = JSON.stringify(next);
        if (text === JSON.stringify(initialRef.current)) window.sessionStorage.removeItem(PREFIX + key);
        else window.sessionStorage.setItem(PREFIX + key, text);
      } catch {
        // Nothing to do: the value still lives in memory.
      }
    },
    [key],
  );

  return [value, update];
}
