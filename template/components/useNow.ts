"use client";

import { useEffect, useState } from "react";

// The page is rendered on the server, so anything computed from the clock is
// stale on arrival. This seeds from the server's clock (first client render
// matches the HTML), then ticks: every second when `fast`, else every 15s.

export function useNow(serverNowIso: string, fast = false): number {
  const [nowMs, setNowMs] = useState(() => Date.parse(serverNowIso));
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = window.setInterval(tick, fast ? 1000 : 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fast]);
  return nowMs;
}
