// Every time on the board reads in the event's own time zone, the way the
// event's schedule is written. next.config.ts passes event.timezone from
// hub.config.json in as HUB_TIME_ZONE at build time.

const DEFAULT_TIME_ZONE = "America/New_York";

function readTimeZone(value: string | undefined): string {
  if (!value) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export const EVENT_TIME_ZONE = readTimeZone(process.env.HUB_TIME_ZONE);

function zoneName(style: "shortGeneric" | "short" | "long", atMs: number, timeZone: string): string {
  const at = Number.isNaN(atMs) ? Date.now() : atMs;
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: style }).formatToParts(at).find((piece) => piece.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/**
 * The zone as a short tag after a time, as it reads at that moment: "ET" or
 * "PT" where a short generic name exists, else the offset in force then, such
 * as "GMT+2" for a July time in Berlin (never "Germany Time").
 */
export function zoneShort(atMs: number, timeZone = EVENT_TIME_ZONE): string {
  const generic = zoneName("shortGeneric", atMs, timeZone);
  return /\s/.test(generic) ? zoneName("short", atMs, timeZone) : generic;
}

/** The zone in a sentence, with daylight saving as it is at that moment: "Eastern Standard Time", "Central European Summer Time". */
export function zoneLong(atMs: number, timeZone = EVENT_TIME_ZONE): string {
  return zoneName("long", atMs, timeZone);
}

const STAMP = new Intl.DateTimeFormat("en-US", { timeZone: EVENT_TIME_ZONE, weekday: "short", hour: "numeric", minute: "2-digit" });
const TIME_ONLY = new Intl.DateTimeFormat("en-US", { timeZone: EVENT_TIME_ZONE, hour: "numeric", minute: "2-digit" });
const HOUR_23 = new Intl.DateTimeFormat("en-US", { timeZone: EVENT_TIME_ZONE, hour: "numeric", hourCycle: "h23" });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: EVENT_TIME_ZONE, weekday: "short", month: "short", day: "numeric" });
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: EVENT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** "Wed 7:45 PM" */
export function formatStamp(ms: number): string {
  return Number.isNaN(ms) ? "" : STAMP.format(ms);
}

/** "7:45 PM" */
export function formatTime(ms: number): string {
  return TIME_ONLY.format(ms);
}

/** "Sat Jan 16" */
export function formatDay(ms: number): string {
  return DAY.format(ms).replace(",", "");
}

const CALENDAR_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

/** A date with no time ("2027-01-16", a kb page's `updated:`) as "Sat Jan 16", the same in every zone; anything else as written. */
export function formatDateOnly(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(ms) ? value : CALENDAR_DATE.format(ms).replace(",", "");
}

/** "2027-01-16", the event calendar day, for grouping. */
export function dayKey(ms: number): string {
  return DAY_KEY.format(ms);
}

/** 0 to 23 on the event clock. */
export function eventHour(ms: number): number {
  return Number(HOUR_23.format(ms)) % 24;
}

/** "6 PM", "12 AM" */
export function formatHourTick(ms: number): string {
  const hour = eventHour(ms);
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

/** "just now", "4m", "2h", "Wed 7:45 PM" past a day. */
export function formatRelative(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((nowMs - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return formatStamp(then);
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function countdownParts(targetMs: number, nowMs: number): CountdownParts | null {
  const total = Math.floor((targetMs - nowMs) / 1000);
  if (Number.isNaN(total) || total < 0) return null;
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** "1d 4h", "4h 12m", "12m 04s", "9s" */
export function formatCountdown(targetMs: number, nowMs: number): string | null {
  const parts = countdownParts(targetMs, nowMs);
  if (!parts) return null;
  if (parts.days > 0) return `${parts.days}d ${parts.hours}h`;
  if (parts.hours > 0) return `${parts.hours}h ${parts.minutes}m`;
  if (parts.minutes > 0) return `${parts.minutes}m ${String(parts.seconds).padStart(2, "0")}s`;
  return `${parts.seconds}s`;
}

const MINUTE = new Intl.DateTimeFormat("en-US", { timeZone: EVENT_TIME_ZONE, minute: "numeric" });

/** Milliseconds at the start of the event calendar day that contains `ms`. */
export function startOfEventDay(ms: number): number {
  const hour = eventHour(ms);
  const minute = Number(MINUTE.format(ms));
  const seconds = Math.floor(ms / 1000) % 60;
  return ms - ((hour * 60 + minute) * 60 + seconds) * 1000 - (ms % 1000);
}
