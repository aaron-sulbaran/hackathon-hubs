// kb/playbook.md holds the schedule in two sections, `## Deadlines` and
// `## Calendar`, one line per entry (docs/CONTRACT.md):
//   - 2027-01-17T09:00-05:00 | Submissions due | kind: deadline
// Extra `key: value` fields after the title are kept. A calendar line may give
// `until: <ISO>`; without one it runs an hour or until the next entry starts,
// whichever comes first. Deadlines are moments, not stretches.

export interface AgendaEntry {
  id: string;
  title: string;
  kind: string;
  startMs: number;
  endMs: number;
  point: boolean;
  where: string | null;
  source: "deadline" | "calendar" | "gate";
}

const DEFAULT_MINUTES = 60;
const MIN_MINUTES = 15;

function sectionLines(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`);
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    if (/^\s*[-*]\s+/.test(line)) out.push(line.replace(/^\s*[-*]\s+/, ""));
  }
  return out;
}

export function parseScheduleLine(line: string): { at: number; title: string; fields: Record<string, string> } | null {
  const parts = line.split("|").map((part) => part.trim());
  const at = Date.parse(parts[0] ?? "");
  const title = parts[1];
  if (Number.isNaN(at) || !title) return null;
  const fields: Record<string, string> = {};
  for (const part of parts.slice(2)) {
    const pair = /^([a-z][\w-]*):\s*(.*)$/i.exec(part);
    if (pair?.[1]) fields[pair[1].toLowerCase()] = (pair[2] ?? "").trim();
  }
  return { at, title, fields };
}

export function parsePlaybook(markdown: string | null): AgendaEntry[] {
  if (!markdown) return [];
  const deadlines = sectionLines(markdown, "deadlines")
    .map(parseScheduleLine)
    .filter((line): line is NonNullable<typeof line> => line !== null)
    .map(
      (line, i): AgendaEntry => ({
        id: `deadline-${i}`,
        title: line.title,
        kind: line.fields.kind || "deadline",
        startMs: line.at,
        endMs: line.at,
        point: true,
        where: line.fields.where ?? null,
        source: "deadline",
      }),
    );

  const calendarLines = sectionLines(markdown, "calendar")
    .map(parseScheduleLine)
    .filter((line): line is NonNullable<typeof line> => line !== null)
    .sort((a, b) => a.at - b.at);
  const calendar = calendarLines.map((line, i): AgendaEntry => {
    const stated = line.fields.until ? Date.parse(line.fields.until) : NaN;
    const nextStart = calendarLines.slice(i + 1).find((other) => other.at > line.at)?.at ?? Infinity;
    const natural = Math.min(line.at + DEFAULT_MINUTES * 60_000, nextStart);
    const endMs = Number.isNaN(stated) || stated <= line.at ? Math.max(natural, line.at + MIN_MINUTES * 60_000) : stated;
    return {
      id: `calendar-${i}`,
      title: line.title,
      kind: line.fields.kind || "event",
      startMs: line.at,
      endMs,
      point: false,
      where: line.fields.where ?? null,
      source: "calendar",
    };
  });

  return [...deadlines, ...calendar].sort((a, b) => a.startMs - b.startMs || Number(b.point) - Number(a.point));
}

export function nextDeadline(entries: AgendaEntry[], nowMs: number): AgendaEntry | null {
  return entries.find((entry) => entry.point && entry.startMs > nowMs) ?? null;
}

export function upcoming(entries: AgendaEntry[], nowMs: number, count: number): AgendaEntry[] {
  return entries.filter((entry) => entry.endMs > nowMs).slice(0, count);
}

/** The deadline the whole weekend counts down to: the submission one, else the last deadline. */
export function finalDeadline(entries: AgendaEntry[]): AgendaEntry | null {
  const deadlines = entries.filter((entry) => entry.point && entry.source === "deadline");
  return (
    deadlines.find((entry) => /\bsubmission/i.test(entry.title)) ??
    deadlines.find((entry) => /\bsubmit/i.test(entry.title)) ??
    deadlines[deadlines.length - 1] ??
    null
  );
}

/** When hacking began, from the calendar line that says so ("Hacking began", "Hacking starts"). */
export function hackingStart(entries: AgendaEntry[]): AgendaEntry | null {
  return entries.find((entry) => entry.source === "calendar" && /hacking (began|begins|starts|started)|hack(ing)? time begins/i.test(entry.title)) ?? null;
}
