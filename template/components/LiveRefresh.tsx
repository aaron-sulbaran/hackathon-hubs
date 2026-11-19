"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

// Asks the server for a fresh render about every 20 seconds while the tab is
// visible, and straight away when the reader comes back to it or reconnects.
// Client state (an open sheet, a typed comment, a hovered node) survives.

const REFRESH_MS = 20_000;
const MIN_GAP_MS = 5_000;

export function LiveRefresh() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const lastAsk = useRef(0);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastAsk.current < MIN_GAP_MS) return;
      lastAsk.current = now;
      startTransition(() => router.refresh());
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [router]);

  return null;
}
