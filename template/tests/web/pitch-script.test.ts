import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { foldEvents } from "@/lib/hub/fold.mjs";
import { buildWebEvent } from "@/lib/web/event-input";
import {
  PITCH_SCRIPT_FILE,
  applyScriptEdits,
  parsePitchScriptPage,
  pitchScriptSchema,
  scriptEditTitle,
  scriptEditsFrom,
  scriptForPage,
  type PitchScriptInput,
  type ScriptCue,
} from "@/lib/web/pitch-script";
import { DEFAULT_PITCH_SCRIPT } from "@/lib/web/pitch-script-default";

const SMALL: PitchScriptInput = {
  totalTarget: "5:00",
  beforeYouStart: "Clear the search box before you start.",
  measured: "Tap **Cut** to strike a cue.",
  footer: "Last timed run: 2:10.",
  parts: [
    {
      id: "p1",
      title: "The problem",
      by: "Ada",
      target: "0:45",
      cues: [
        { n: "1", who: "ada", kind: "say", line: "Lost a phone on campus? Today that takes three offices." },
        { n: "2", who: "ada", kind: "quiet", dir: "The search page fills in as we type." },
      ],
    },
    { id: "p3", title: "The walkthrough", by: "Grace", target: 150, cues: [{ sub: "Grace" }, { n: "2a", who: "grace", kind: "say", line: "Here is the desk, on a phone.", tap: "Search" }] },
  ],
};

function page(json: unknown): string {
  return `---\ntitle: Pitch dry run script\nkind: reference\n---\n\n# Pitch\n\nSome prose.\n\n\`\`\`json\n${JSON.stringify(json, null, 2)}\n\`\`\`\n`;
}

function edit(by: string, at: string, data: Record<string, unknown>) {
  return { type: "script.edit", by, at, data };
}

function cueOf(script: ReturnType<typeof applyScriptEdits>, part: string, n: string): ScriptCue {
  const cue = script.parts.find((candidate) => candidate.id === part)?.cues.find((entry) => "n" in entry && entry.n === n);
  if (!cue || !("n" in cue)) throw new Error(`no cue ${part}:${n}`);
  return cue;
}

describe("parsePitchScriptPage", () => {
  it("reads the json block and turns m:ss into seconds", () => {
    const parsed = parsePitchScriptPage(page(SMALL));
    expect(parsed.error).toBeNull();
    expect(parsed.data?.totalTarget).toBe(300);
    expect(parsed.data?.parts[0]?.target).toBe(45);
    expect(parsed.data?.parts[1]?.target).toBe(150);
  });

  it("names the problem when the page is missing, has no block, or is not valid JSON", () => {
    expect(parsePitchScriptPage(null).error).toMatch(/missing/);
    expect(parsePitchScriptPage("# Just prose").error).toMatch(/no fenced json block/);
    expect(parsePitchScriptPage("```json\n{ not json }\n```\n").error).toMatch(/not valid JSON/);
  });

  it("refuses a presenter that is not a team id and repeated cue numbers, saying where", () => {
    const badWho = structuredClone(SMALL);
    (badWho.parts[0]!.cues[0] as { who: string }).who = "Not An Id";
    expect(parsePitchScriptPage(page(badWho)).error).toMatch(/parts\.0\.cues\.0/);
    const repeated = structuredClone(SMALL);
    repeated.parts[0]!.cues.push({ n: "1", who: "ada", kind: "say", line: "Again." });
    expect(parsePitchScriptPage(page(repeated)).error).toMatch(/two cues numbered 1/);
  });

  it("parses the real kb page once it exists, and the built-in copy always", () => {
    const file = path.join(process.cwd(), PITCH_SCRIPT_FILE);
    if (existsSync(file)) {
      const real = parsePitchScriptPage(readFileSync(file, "utf8"));
      expect(real.error).toBeNull();
      expect(real.data?.parts.length).toBeGreaterThan(0);
    }
    expect(pitchScriptSchema.safeParse(DEFAULT_PITCH_SCRIPT).success).toBe(true);
  });
});

describe("applyScriptEdits", () => {
  const base = pitchScriptSchema.parse(SMALL);

  it("applies the latest edit per cue and field, and remembers the kb text", () => {
    const edits = scriptEditsFrom([
      edit("grace", "2027-01-15T12:00:00Z", { cue: "p3:2a", field: "line", text: "First try." }),
      edit("grace", "2027-01-15T12:05:00Z", { cue: "p3:2a", field: "line", text: "Wait, here it is on a phone." }),
    ]);
    const cue = cueOf(applyScriptEdits(base, edits), "p3", "2a");
    expect(cue.line).toBe("Wait, here it is on a phone.");
    expect(cue.base).toEqual({ line: "Here is the desk, on a phone." });
    expect(cue.edited).toEqual({ by: "grace", at: "2027-01-15T12:05:00Z" });
    expect(cue.tap).toBe("Search");
  });

  it("goes back to the kb text after a revert, and an empty edit removes the field", () => {
    const reverted = applyScriptEdits(
      base,
      scriptEditsFrom([
        edit("ada", "2027-01-15T12:00:00Z", { cue: "p1:1", field: "line", text: "Changed." }),
        edit("ada", "2027-01-15T12:01:00Z", { cue: "p1:1", field: "line", text: "", revert: true }),
      ]),
    );
    const back = cueOf(reverted, "p1", "1");
    expect(back.line).toBe("Lost a phone on campus? Today that takes three offices.");
    expect(back.base).toBeUndefined();
    expect(back.edited).toBeUndefined();

    const removed = cueOf(applyScriptEdits(base, scriptEditsFrom([edit("ada", "2027-01-15T12:00:00Z", { cue: "p1:2", field: "dir", text: "  " })])), "p1", "2");
    expect(removed.dir).toBeUndefined();
    expect(removed.base).toEqual({ dir: "The search page fills in as we type." });
  });

  it("orders edits by time, skips malformed ones, and ignores cues that are not in the script", () => {
    const edits = scriptEditsFrom([
      edit("grace", "2027-01-15T12:09:00Z", { cue: "p3:2a", field: "line", text: "Newest." }),
      edit("grace", "2027-01-15T12:01:00Z", { cue: "p3:2a", field: "line", text: "Older." }),
      edit("grace", "2027-01-15T12:02:00Z", { cue: "p3:2a", field: "tap", text: "Not editable." }),
      edit("grace", "2027-01-15T12:03:00Z", { cue: "p9:Z9", field: "line", text: "Nowhere." }),
      { type: "comment", by: "grace", at: "2027-01-15T12:04:00Z", data: { cue: "p3:2a", field: "line", text: "Not an edit." } },
    ]);
    expect(edits).toHaveLength(3);
    const shown = applyScriptEdits(base, edits);
    expect(cueOf(shown, "p3", "2a").line).toBe("Newest.");
    expect(JSON.stringify(shown)).not.toContain("Nowhere.");
  });
});

describe("scriptForPage", () => {
  it("falls back to the built-in copy and says why when the kb page does not parse", () => {
    const shown = scriptForPage("```json\n{\n```\n", [edit("ada", "2027-01-15T12:00:00Z", { cue: "p1:1", field: "line", text: "Kept." })], SMALL);
    expect(shown.problem).toMatch(/not valid JSON/);
    expect(cueOf(shown.script, "p1", "1").line).toBe("Kept.");
  });
});

describe("script.edit from the web", () => {
  const ids = ["ada", "grace"];

  it("is accepted without a ref, and the server writes the title", () => {
    const built = buildWebEvent({ by: "grace", type: "script.edit", title: "Script edit", data: { cue: "p3:2a", field: "line", text: "  New line.  " } }, ids);
    expect(built.error).toBeNull();
    expect(built.data?.ref).toBeUndefined();
    expect(built.data?.via).toBe("web");
    expect(built.data?.title).toBe('Script part 3, cue 2a: "New line."');
    expect(built.data?.data).toEqual({ cue: "p3:2a", field: "line", text: "New line." });
  });

  it("refuses a ref, a bad cue, a field that is not editable, and someone off the team", () => {
    expect(buildWebEvent({ by: "grace", type: "script.edit", ref: "t-abcd", title: "x", data: { cue: "p3:2a", field: "line", text: "x" } }, ids).error).toMatch(/no ref/);
    expect(buildWebEvent({ by: "grace", type: "script.edit", title: "x", data: { cue: "2a", field: "line", text: "x" } }, ids).error).toMatch(/Not a script cue/);
    expect(buildWebEvent({ by: "grace", type: "script.edit", title: "x", data: { cue: "p3:2a", field: "tap", text: "x" } }, ids).error).not.toBeNull();
    expect(buildWebEvent({ by: "zed", type: "script.edit", title: "x", data: { cue: "p3:2a", field: "line", text: "x" } }, ids).error).toMatch(/not on the team/);
  });

  it("clips long titles and names reverts", () => {
    expect(scriptEditTitle("p1:17", "line", "x".repeat(300)).length).toBeLessThanOrEqual(140);
    expect(scriptEditTitle("p1:17", "dir", "", true)).toBe("Script part 1, cue 17: back to the script's direction");
  });

  it("folds into the activity feed without touching any board object", () => {
    const built = buildWebEvent({ by: "ada", type: "script.edit", title: "x", data: { cue: "p1:1", field: "line", text: "Hi." } }, ids);
    const board = foldEvents([built.data], { people: [{ id: "ada", name: "Ada" }, { id: "grace", name: "Grace" }] }) as unknown as {
      activity: Array<{ type: string }>;
      items: unknown[];
      questions: unknown[];
    };
    expect(board.activity.map((event) => event.type)).toEqual(["script.edit"]);
    expect(board.items).toHaveLength(0);
    expect(board.questions).toHaveLength(0);
  });
});
