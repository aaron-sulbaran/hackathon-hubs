// Best effort: a fixed number of writes per minute per address, per server
// instance. Serverless instances do not share memory, so this brakes a runaway
// client; the unlock cookie is the real protection.
//
// Memory stays bounded: each address keeps at most maxPerWindow + 1 times
// (enough to tell "over the limit"), refused requests add nothing once an
// address is over, and addresses with nothing left in the window are dropped.
// Past maxKeys addresses the oldest ones go first.

export function createRateLimiter(maxPerWindow: number, windowMs: number, maxKeys = 5000) {
  const hits = new Map<string, number[]>();
  let lastSweepMs = 0;

  function sweep(nowMs: number) {
    if (nowMs - lastSweepMs < windowMs && hits.size <= maxKeys) return;
    lastSweepMs = nowMs;
    for (const [key, times] of hits) if (!times.some((time) => nowMs - time < windowMs)) hits.delete(key);
    // A Map iterates in insertion order, so the first keys are the oldest.
    for (const key of hits.keys()) {
      if (hits.size <= maxKeys) break;
      hits.delete(key);
    }
  }

  function limited(key: string, nowMs = Date.now()): boolean {
    sweep(nowMs);
    const recent = (hits.get(key) ?? []).filter((time) => nowMs - time < windowMs);
    if (recent.length > maxPerWindow) {
      hits.set(key, recent);
      return true;
    }
    recent.push(nowMs);
    hits.delete(key);
    hits.set(key, recent);
    return recent.length > maxPerWindow;
  }

  /** How many addresses are remembered, for tests. */
  limited.size = () => hits.size;
  return limited;
}
