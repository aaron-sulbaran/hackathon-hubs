import { z } from "zod";
import { makeEvent, validateEvent } from "@/lib/hub/schema.mjs";
import { NO_ROSTER } from "./roster";
import type { HubEvent, Result } from "./types";

// The shared clock on the pitch script page (/script). Whoever presses Start,
// End of part, Pause or Reset posts the clock's whole state, stamped with the
// server time it was taken (atMs). Every phone polls /api/clock and shows
// base + (now - atMs) while running, so all of them read the same time, even
// one that hears about a start a few seconds late. The latest state wins.
// Each press is also a "script.clock" event, so a new server instance or a
// phone opened mid-run picks the clock up from the log.

export const CLOCK_EVENT_TYPE = "script.clock";
const MAX_SECONDS = 4 * 3600;

export const clockStateSchema = z
  .object({
    action: z.enum(["start", "pause", "resume", "next", "reset"]),
    running: z.boolean(),
    /** Seconds on the clock at atMs. */
    base: z.number().min(0).max(MAX_SECONDS),
    /** Server time, in ms, when the state was taken. */
    atMs: z.number().int().positive(),
    /** Index into the timed parts; -1 before Start, the count of timed parts once done. */
    current: z.number().int().min(-1).max(50),
    /** Clock seconds when the current part started. */
    partStart: z.number().min(0).max(MAX_SECONDS),
    /** Seconds each finished part took. */
    splits: z.array(z.number().min(0).max(MAX_SECONDS)).max(50),
  })
  .strict();

export type ClockState = z.infer<typeof clockStateSchema>;
export interface SharedClock {
  state: ClockState;
  by: string;
}

/** A press stamped more than this far from the server's own time takes the server's time instead. */
const SKEW_LIMIT_MS = 10_000;

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function clockTitle(state: ClockState): string {
  switch (state.action) {
    case "start":
      return "Pitch clock started";
    case "pause":
      return `Pitch clock paused at ${fmt(state.base)}`;
    case "resume":
      return `Pitch clock resumed at ${fmt(state.base)}`;
    case "next":
      return state.running ? `Pitch clock: part ${state.current} ended at ${fmt(state.base)}` : `Pitch clock: pitch ended at ${fmt(state.base)}`;
    case "reset":
      return "Pitch clock reset";
  }
}

const bodySchema = z.object({ by: z.string().regex(/^[a-z][a-z0-9_]*$/, "Pick who you are first."), state: clockStateSchema }).strict();

/** Checks a press from the page and turns it into a script.clock event. */
export function buildClockEvent(body: unknown, teamIds: string[], nowMs = Date.now()): Result<HubEvent> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { data: null, error: parsed.error.issues[0]?.message ?? "Not a valid clock state." };
  const { by } = parsed.data;
  if (teamIds.length === 0) return { data: null, error: NO_ROSTER };
  if (!teamIds.includes(by)) return { data: null, error: `${by} is not on the team.` };
  const state = { ...parsed.data.state };
  if (Math.abs(state.atMs - nowMs) > SKEW_LIMIT_MS) state.atMs = nowMs;
  const made = makeEvent({ by, via: "web", type: CLOCK_EVENT_TYPE, title: clockTitle(state), data: state, now: nowMs });
  if (!made.data) return { data: null, error: made.error ?? "Not a valid event." };
  const checked = validateEvent(made.data, { teamIds });
  if (!checked.ok) return { data: null, error: checked.reason };
  return { data: checked.event as HubEvent, error: null };
}

/** The clock a script.clock event carries, or null if it is not one. */
export function clockFromEvent(event: unknown): SharedClock | null {
  if (typeof event !== "object" || event === null) return null;
  const candidate = event as { type?: unknown; by?: unknown; data?: unknown };
  if (candidate.type !== CLOCK_EVENT_TYPE || typeof candidate.by !== "string") return null;
  const state = clockStateSchema.safeParse(candidate.data);
  return state.success ? { state: state.data, by: candidate.by } : null;
}

/** The newer of two clocks, by when their state was taken. */
export function newerClock(a: SharedClock | null, b: SharedClock | null): SharedClock | null {
  if (!a) return b;
  if (!b) return a;
  return b.state.atMs > a.state.atMs ? b : a;
}

/** The latest clock in a list of events. */
export function latestClock(events: unknown[]): SharedClock | null {
  let latest: SharedClock | null = null;
  for (const event of events) latest = newerClock(latest, clockFromEvent(event));
  return latest;
}
