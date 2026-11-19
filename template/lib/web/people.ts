import type { Person, Presence, Session } from "./types";

// Each teammate gets one pastel from the board's palette and keeps it
// everywhere: their avatar, their boarding pass, their node on the map. The
// initials are navy on every one.

export interface Accent {
  fill: string;
  ink: string;
}

const NAVY = "#26345B";

// Six pastels, all with navy initials at 7:1 or better, handed out by each
// person's place in team.json: the first six people never share a color, and
// the pitch script page uses the same order (app/script/html.ts).
export const PALETTE: readonly string[] = ["#A9C9EE", "#E7AAB4", "#F2C89D", "#BCD9C6", "#F3DA97", "#D5C8EE"];

/** The pastel for the person at this place in team.json. */
export function fillAt(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length]!;
}

/**
 * CSS custom properties, one per person, in team.json order. The gated layout
 * puts them on the page, so a server or client component only needs the id
 * to draw someone's color.
 */
export function accentCss(ids: string[]): string {
  const rules = ids.flatMap((id, index) => (/^[a-z][a-z0-9_]*$/.test(id) ? [`--accent-${id}:${fillAt(index)};`] : []));
  return `:root{${rules.join("")}}`;
}

/** A person's accent: their team.json color, or, for an id not on the team, one picked from the id. */
export function accentFor(id: string): Accent {
  const hash = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const safe = /^[a-z][a-z0-9_]*$/.test(id);
  return { fill: safe ? `var(--accent-${id}, ${fillAt(hash)})` : fillAt(hash), ink: NAVY };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "?").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

export function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

/** A person is active with an open, non-idle session; idle with an open idle one; away otherwise. */
export function presenceOf(person: Person, sessions: Session[]): Presence {
  const session = person.activeSession ? sessions.find((candidate) => candidate.id === person.activeSession) : undefined;
  if (!session) return "away";
  return session.idle ? "idle" : "active";
}
