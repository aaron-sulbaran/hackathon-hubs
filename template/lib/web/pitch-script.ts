import { z } from "zod";

// The pitch dry run script (GET /script). The lines live in kb/pitch-script.md,
// in one fenced json block, so an agent edits them with a data commit and the
// page shows the change within about 30 seconds, no deploy. Teammates can also
// edit their own lines on the page: each save is a "script.edit" event, and the
// latest edit of a cue's line or direction wins over the kb page until someone
// reverts it. If the kb page is missing or does not parse, the page shows the
// built-in copy (pitch-script-default.ts) and says why.

export const PITCH_SCRIPT_FILE = "kb/pitch-script.md";
export const PITCH_SCRIPT_SLUG = "pitch-script";
export const SCRIPT_EDIT_TYPE = "script.edit";

/** Who holds a cue: a team.json id, or "open" for a cue with no presenter yet (anyone may edit it). */
export const OPEN_CUE = "open";
const PRESENTER = /^[a-z][a-z0-9_]*$/;
export const EDITABLE_FIELDS = ["line", "dir"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

const LINE_MAX = 1000;

function toSeconds(clock: string): number {
  const [minutes = "0", seconds = "0"] = clock.split(":");
  return Number(minutes) * 60 + Number(seconds);
}

/** A duration as seconds, or as "m:ss" (easier to write by hand). */
const duration = z.union([z.number().int().min(0).max(3600), z.string().regex(/^\d{1,2}:[0-5]\d$/, 'Write a time as "m:ss".').transform(toSeconds)]);

const cueSchema = z
  .object({
    n: z.string().regex(/^[A-Za-z0-9]{1,12}$/, "A cue number is letters and digits, like 7 or U2b."),
    who: z.string().regex(PRESENTER, "A presenter is a team id from team.json, or \"open\"."),
    kind: z.enum(["say", "quiet", "both"]),
    dir: z.string().max(LINE_MAX).optional(),
    line: z.string().max(LINE_MAX).optional(),
    tap: z.string().max(200).optional(),
    wait: z.string().max(200).optional(),
    cut: z.boolean().optional(),
    noline: z.boolean().optional(),
    draft: z.boolean().optional(),
  })
  .strict();

const subSchema = z.object({ sub: z.string().min(1).max(LINE_MAX) }).strict();

const partSchema = z
  .object({
    id: z.string().regex(/^p\d{1,2}$/, 'A part id is "p" and a number, like p3.'),
    title: z.string().min(1).max(200),
    by: z.string().max(200),
    target: duration,
    cues: z.array(z.union([subSchema, cueSchema])),
  })
  .strict()
  .superRefine((part, context) => {
    const seen = new Set<string>();
    for (const cue of part.cues) {
      if (!("n" in cue)) continue;
      if (seen.has(cue.n)) context.addIssue({ code: "custom", message: `Part ${part.id} has two cues numbered ${cue.n}.` });
      seen.add(cue.n);
    }
  });

export const pitchScriptSchema = z
  .object({
    totalTarget: duration,
    beforeYouStart: z.string().max(4000),
    measured: z.string().max(4000),
    footer: z.string().max(2000),
    parts: z.array(partSchema).min(1),
  })
  .strict()
  .superRefine((script, context) => {
    const ids = script.parts.map((part) => part.id);
    const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
    if (repeated) context.addIssue({ code: "custom", message: `Two parts have the id ${repeated}.` });
  });

export type PitchScriptInput = z.input<typeof pitchScriptSchema>;
export type PitchScript = z.output<typeof pitchScriptSchema>;
export type ScriptPart = PitchScript["parts"][number];
type ParsedCue = z.output<typeof cueSchema>;

/** A cue as the page gets it: the kb text with any saved edits applied. */
export interface ScriptCue extends ParsedCue {
  /** The kb page's own text for the fields an edit replaced, so Revert can restore it. */
  base?: Partial<Record<EditableField, string | null>>;
  /** The latest saved edit on this cue. */
  edited?: { by: string; at: string };
}

export interface ShownScript extends Omit<PitchScript, "parts"> {
  parts: Array<Omit<ScriptPart, "cues"> & { cues: Array<ScriptCue | { sub: string }> }>;
}

type Result<T> = { data: T; error: null } | { data: null; error: string };

/** Reads the first fenced json block of the kb page into a checked script. */
export function parsePitchScriptPage(markdown: string | null | undefined): Result<PitchScript> {
  if (!markdown) return { data: null, error: `${PITCH_SCRIPT_FILE} is missing.` };
  const block = /^```json[^\n]*\n([\s\S]*?)\n```\s*$/m.exec(markdown.replace(/\r\n/g, "\n"));
  if (!block?.[1]) return { data: null, error: `${PITCH_SCRIPT_FILE} has no fenced json block.` };
  let raw: unknown;
  try {
    raw = JSON.parse(block[1]);
  } catch (error) {
    return { data: null, error: `${PITCH_SCRIPT_FILE} is not valid JSON: ${error instanceof Error ? error.message : "parse error"}.` };
  }
  const parsed = pitchScriptSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (at ${issue.path.join(".")})` : "";
    return { data: null, error: `${PITCH_SCRIPT_FILE} does not fit the script format: ${issue?.message ?? "unknown problem"}${where}.` };
  }
  return { data: parsed.data, error: null };
}

/** What a script.edit event carries in data. Empty text removes the line or direction. */
export const scriptEditDataSchema = z
  .object({
    cue: z.string().regex(/^p\d{1,2}:[A-Za-z0-9]{1,12}$/, "Not a script cue."),
    field: z.enum(EDITABLE_FIELDS),
    text: z.string().max(LINE_MAX, `Keep a line under ${LINE_MAX} characters.`),
    revert: z.boolean().optional(),
  })
  .strict();

export interface ScriptEdit {
  cue: string;
  field: EditableField;
  text: string;
  revert: boolean;
  by: string;
  at: string;
}

/** The script.edit events among the board's events, oldest first; malformed ones are skipped. */
export function scriptEditsFrom(events: Array<{ type: string; by: string; at: string; data?: unknown }>): ScriptEdit[] {
  const edits: ScriptEdit[] = [];
  for (const event of events) {
    if (event.type !== SCRIPT_EDIT_TYPE) continue;
    const parsed = scriptEditDataSchema.safeParse(event.data);
    if (!parsed.success) continue;
    edits.push({ ...parsed.data, revert: parsed.data.revert === true, by: event.by, at: event.at });
  }
  return edits.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** The script with saved edits applied: per cue and field, the latest edit wins; a revert goes back to the kb text. */
export function applyScriptEdits(script: PitchScript, edits: ScriptEdit[]): ShownScript {
  const latest = new Map<string, ScriptEdit>();
  const lastByCue = new Map<string, ScriptEdit>();
  for (const edit of edits) {
    latest.set(`${edit.cue}\u0000${edit.field}`, edit);
    lastByCue.set(edit.cue, edit);
  }
  return {
    ...script,
    parts: script.parts.map((part) => ({
      ...part,
      cues: part.cues.map((entry) => {
        if (!("n" in entry)) return entry;
        const key = `${part.id}:${entry.n}`;
        const cue: ScriptCue = { ...entry };
        for (const field of EDITABLE_FIELDS) {
          const edit = latest.get(`${key}\u0000${field}`);
          if (!edit || edit.revert) continue;
          cue.base = { ...cue.base, [field]: entry[field] ?? null };
          if (edit.text.trim()) cue[field] = edit.text.trim();
          else delete cue[field];
        }
        const last = lastByCue.get(key);
        if (cue.base && last) cue.edited = { by: last.by, at: last.at };
        return cue;
      }),
    })),
  };
}

/** A short feed title for an edit: which cue, and the new text. */
export function scriptEditTitle(cue: string, field: EditableField, text: string, revert = false): string {
  const [part = "", n = ""] = cue.split(":");
  const where = `Script part ${part.replace(/^p/, "")}, cue ${n}`;
  if (revert) return `${where}: back to the script's ${field === "line" ? "line" : "direction"}`;
  const what = text.trim() ? `"${text.trim()}"` : field === "line" ? "line removed" : "direction removed";
  const title = `${where}: ${what}`;
  return title.length > 140 ? `${title.slice(0, 136)}..."` : title;
}

/**
 * Everything the page shows: the kb script (or the built-in copy, with the
 * reason) with saved edits applied. `fallback` is the built-in script.
 */
export function scriptForPage(
  markdown: string | null | undefined,
  events: Array<{ type: string; by: string; at: string; data?: unknown }>,
  fallback: PitchScriptInput,
  teamIds: string[] = [],
): { script: ShownScript; problem: string | null } {
  const fromKb = parsePitchScriptPage(markdown);
  const base = fromKb.data ?? pitchScriptSchema.parse(fallback);
  const problem = fromKb.error ?? (fromKb.data ? unknownPresenter(fromKb.data, teamIds) : null);
  return { script: applyScriptEdits(base, scriptEditsFrom(events)), problem };
}

/** The first cue whose presenter is not on the team, said the way a parse error is; null when every cue is fine or the team is unknown. */
export function unknownPresenter(script: PitchScript, teamIds: string[]): string | null {
  if (teamIds.length === 0) return null;
  for (const part of script.parts) {
    for (const cue of part.cues) {
      if ("n" in cue && cue.who !== OPEN_CUE && !teamIds.includes(cue.who)) {
        return `${PITCH_SCRIPT_FILE}: part ${part.id}, cue ${cue.n} names "${cue.who}", who is not in team.json (ids: ${teamIds.join(", ")}, or "${OPEN_CUE}"). Nobody can edit that cue until it is fixed.`;
      }
    }
  }
  return null;
}
