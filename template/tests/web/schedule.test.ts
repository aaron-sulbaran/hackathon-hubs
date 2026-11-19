import { describe, expect, it } from "vitest";
import { formatCountdown, formatRelative, startOfEventDay, dayKey, formatStamp } from "@/lib/web/format";
import { finalDeadline, hackingStart, nextDeadline, parsePlaybook, parseScheduleLine } from "@/lib/web/playbook";

// The shape of kb/playbook.md for a sample weekend, in the default zone (America/New_York).
const PLAYBOOK = `# Playbook

## Deadlines

- 2027-01-16T11:00-05:00 | Team photo at the stage | kind: deadline
- 2027-01-17T07:00-05:00 | Demo video saved (our own target) | kind: checkpoint
- 2027-01-17T09:00-05:00 | Project submission due (two documents give different times) | kind: deadline
- 2027-01-17T10:30-05:00 | Table set up for the expo | kind: deadline
- not a date | skipped

## Calendar

- 2027-01-16T12:30-05:00 | Lunch | kind: meal | where: Main hall
- 2027-01-15T20:00-05:00 | Hacking began (a 37 hour build) | kind: event
- 2027-01-16T14:00-05:00 | Workshop: Pitching in two minutes | kind: workshop | where: Room 101 | until: 2027-01-16T15:00-05:00

## Notes
- 2027-01-16T09:00-05:00 | not schedule
`;

describe("playbook", () => {
  it("parses a line with fields", () => {
    expect(parseScheduleLine("2027-01-16T13:00-05:00 | Workshop | kind: workshop | where: Room 101")).toMatchObject({ title: "Workshop", fields: { kind: "workshop", where: "Room 101" } });
    expect(parseScheduleLine("garbage")).toBeNull();
  });

  it("reads only the two sections, sorted, with sensible ends", () => {
    const entries = parsePlaybook(PLAYBOOK);
    expect(entries.map((entry) => entry.title)).toEqual([
      "Hacking began (a 37 hour build)",
      "Team photo at the stage",
      "Lunch",
      "Workshop: Pitching in two minutes",
      "Demo video saved (our own target)",
      "Project submission due (two documents give different times)",
      "Table set up for the expo",
    ]);
    const began = entries[0]!;
    expect(began.endMs - began.startMs).toBe(60 * 60 * 1000);
    const workshop = entries.find((entry) => entry.title.startsWith("Workshop"))!;
    expect(workshop.endMs).toBe(Date.parse("2027-01-16T15:00-05:00"));
    expect(workshop.where).toBe("Room 101");
    expect(entries.at(-1)!.point).toBe(true);
  });

  it("finds the next deadline", () => {
    const entries = parsePlaybook(PLAYBOOK);
    expect(nextDeadline(entries, Date.parse("2027-01-16T07:00-05:00"))?.title).toBe("Team photo at the stage");
    expect(nextDeadline(entries, Date.parse("2027-01-17T11:00-05:00"))).toBeNull();
  });

  it("counts down to the submission deadline, not a checkpoint that names the demo", () => {
    const entries = parsePlaybook(PLAYBOOK);
    expect(finalDeadline(entries)?.startMs).toBe(Date.parse("2027-01-17T09:00-05:00"));
    expect(hackingStart(entries)?.startMs).toBe(Date.parse("2027-01-15T20:00-05:00"));
    expect(finalDeadline(parsePlaybook("## Deadlines\n- 2027-01-17T09:30-05:00 | Demo | kind: deadline\n"))?.title).toBe("Demo");
    expect(finalDeadline([])).toBeNull();
  });
});

describe("format", () => {
  const now = Date.parse("2027-01-16T12:00:00-05:00");
  it("counts down", () => {
    expect(formatCountdown(now + (26 * 60 + 5) * 60_000, now)).toBe("1d 2h");
    expect(formatCountdown(now + 65 * 60_000, now)).toBe("1h 5m");
    expect(formatCountdown(now + 4 * 60_000 + 3000, now)).toBe("4m 03s");
    expect(formatCountdown(now - 1, now)).toBeNull();
  });

  it("reads relative time", () => {
    expect(formatRelative(new Date(now - 10_000).toISOString(), now)).toBe("just now");
    expect(formatRelative(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5m");
    expect(formatRelative(new Date(now - 3 * 3600_000).toISOString(), now)).toBe("3h");
  });

  it("reads every time on the event clock", () => {
    expect(startOfEventDay(now)).toBe(Date.parse("2027-01-16T00:00:00-05:00"));
    expect(dayKey(Date.parse("2027-01-16T23:30:00-05:00"))).toBe("2027-01-16");
    expect(dayKey(Date.parse("2027-01-17T04:30:00Z"))).toBe("2027-01-16");
    expect(formatStamp(Date.parse("2027-01-17T13:00:00Z"))).toBe("Sun 8:00 AM");
  });
});
