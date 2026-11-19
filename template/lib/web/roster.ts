import type { Result } from "./types";

// Who may write from the board: the ids in team.json. A write is refused when
// the list could not be read or is empty, so a failed read can never let an
// event through under an id that is not on the team. It is also refused when
// the copy is too old: when refreshes keep failing, pages go on showing the
// last good snapshot, but a person removed from team.json since then must not
// keep writing on its word for ever.

export const NO_ROSTER = "The team list (team.json) could not be read or is empty, so the board cannot check who you are. Try again in a minute; agents can still write with ./hub.";

/** Ten times the 30 second refresh (REVALIDATE_SECONDS in source.ts): a few failed refreshes pass, an outage does not. */
export const ROSTER_MAX_AGE_MS = 5 * 60 * 1000;

export const STALE_ROSTER = "The board has not been able to refresh the team list (team.json) for over five minutes, so it cannot check who you are. Saving works again once GitHub answers; agents can still write with ./hub.";

/** How far in the future a read time may be and still count, for clocks that disagree a little. */
export const ROSTER_CLOCK_SKEW_MS = 60 * 1000;

/** A copy is fresh only with a real read time: not missing, not NaN, not old, not from the future. */
function rosterFresh(readAt: unknown, now: number): boolean {
  if (typeof readAt !== "number" || !Number.isFinite(readAt)) return false;
  return now - readAt <= ROSTER_MAX_AGE_MS && readAt - now <= ROSTER_CLOCK_SKEW_MS;
}

/** The team ids from a snapshot read, or why there are none. */
export function rosterIds(snapshot: Result<{ team: unknown; readAt?: number }>, now: number = Date.now()): Result<string[]> {
  if (!snapshot.data) return { data: null, error: NO_ROSTER };
  if (!rosterFresh(snapshot.data.readAt, now)) return { data: null, error: STALE_ROSTER };
  const people = (snapshot.data.team as { people?: unknown } | null)?.people;
  const ids = Array.isArray(people) ? people.map((person) => (person as { id?: unknown } | null)?.id).filter((id): id is string => typeof id === "string" && id !== "") : [];
  return ids.length ? { data: ids, error: null } : { data: null, error: NO_ROSTER };
}
