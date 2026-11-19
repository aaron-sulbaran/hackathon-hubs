import { z } from "zod";
import type { Board } from "./types";

// Pulses come from event files anyone on the team can write, so the board
// parses them with zod rather than trusting the fold's shape. A malformed
// pulse is dropped, never thrown.

const prSchema = z.object({ number: z.number().int().positive(), url: z.string().catch(""), state: z.string().optional() });

const pulseSchema = z.object({
  id: z.string(),
  by: z.string(),
  agent: z.string().nullable().catch(null),
  at: z.string(),
  note: z.string().nullable().catch(null),
  repo: z.string(),
  branch: z.string().nullable().catch(null),
  pushed: z.boolean().catch(false),
  ahead: z.number().catch(0),
  behind: z.number().catch(0),
  files: z.array(z.string()).catch([]),
  pr: prSchema.nullable().catch(null),
  item: z.string().nullable().catch(null),
});

const overlapSchema = z.object({
  repo: z.string(),
  file: z.string(),
  people: z.array(z.string()),
});

export type Pulse = z.infer<typeof pulseSchema>;
export type Overlap = z.infer<typeof overlapSchema>;

function parseList<T>(schema: z.ZodType<T>, list: unknown): T[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const parsed = schema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The latest pulse of each person (across repos), newest first. */
export function latestPulses(board: Board): Pulse[] {
  const seen = new Set<string>();
  return parseList(pulseSchema, board.pulses)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .filter((pulse) => (seen.has(pulse.by) ? false : (seen.add(pulse.by), true)));
}

export function overlapsOf(board: Board): Overlap[] {
  return parseList(overlapSchema, board.overlaps);
}

/** Only https PR links are rendered as links. */
export function safePrUrl(url: string): string | null {
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url) ? url : null;
}

/** The top two folders of a file list, for a one-line summary. */
export function topFolders(files: string[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const parts = file.split("/");
    const folder = parts.length === 1 ? "(root)" : parts.slice(0, Math.min(2, parts.length - 1)).join("/");
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 2)
    .map(([folder]) => folder);
}
