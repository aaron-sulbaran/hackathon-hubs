// Events the web board leaves out. Event files are append-only, so text that
// should never have been posted (a typo that changes the meaning, a private
// detail) cannot be edited away; the board drops these events before the fold instead, and
// the files stay in events/ untouched. The CLI still prints them in its feed.
// This is for withdrawn text, not for changing your mind: settle, reject, or
// comment for that.

/** Board objects hidden along with every event about them. */
export const WITHDRAWN_REFS: ReadonlySet<string> = new Set([
  // One id per line with the reason beside it, for example: "q-ab12", // title had a typo in a name
]);

/** Single events hidden by their event id. */
export const WITHDRAWN_EVENTS: ReadonlySet<string> = new Set([]);

/** The event entries the board should fold: everything except withdrawn events and events about withdrawn objects. */
export function withoutWithdrawn<T extends { event?: unknown }>(
  entries: T[],
  refs: ReadonlySet<string> = WITHDRAWN_REFS,
  ids: ReadonlySet<string> = WITHDRAWN_EVENTS,
): T[] {
  return entries.filter((entry) => {
    const event = entry.event as { id?: unknown; ref?: unknown } | null | undefined;
    if (!event || typeof event !== "object") return true;
    if (typeof event.id === "string" && ids.has(event.id)) return false;
    if (typeof event.ref === "string" && refs.has(event.ref)) return false;
    return true;
  });
}
