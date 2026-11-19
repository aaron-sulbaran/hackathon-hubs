import type { Item } from "./types";

// What belongs at the top of a list of open work: whatever is due soonest,
// including work a little past due, which is the most urgent of all. Undated
// work follows, newest first. Work long past due sinks to the end, so a
// morning task nobody closed stops crowding out the afternoon. An item tagged
// with the area "now" (one thing the whole team does next) always comes first.

export const NOW_AREA = "now";

export const LONG_PAST_DUE_MS = 2 * 60 * 60 * 1000;

function dueMs(due: string | null): number | null {
  if (!due) return null;
  const ms = Date.parse(due);
  return Number.isFinite(ms) ? ms : null;
}

export function isLongPastDue(due: string | null, nowMs: number): boolean {
  const ms = dueMs(due);
  return ms !== null && ms < nowMs - LONG_PAST_DUE_MS;
}

type Ranked = Pick<Item, "due" | "updatedAt"> & { area?: string | null };

/** A sort comparator: anything tagged now first, then due soonest, then undated (newest first), then long past due (most recent first). */
export function byRelevance(nowMs: number) {
  const bucket = (entry: Ranked) => {
    if (entry.area === NOW_AREA) return -1;
    const ms = dueMs(entry.due);
    if (ms === null) return 1;
    return ms < nowMs - LONG_PAST_DUE_MS ? 2 : 0;
  };
  return (a: Ranked, b: Ranked): number => {
    const rankA = bucket(a);
    const rankB = bucket(b);
    if (rankA !== rankB) return rankA - rankB;
    if (rankA === -1) return b.updatedAt.localeCompare(a.updatedAt);
    if (rankA === 0) return (dueMs(a.due) as number) - (dueMs(b.due) as number);
    if (rankA === 2) return (dueMs(b.due) as number) - (dueMs(a.due) as number);
    return b.updatedAt.localeCompare(a.updatedAt);
  };
}
