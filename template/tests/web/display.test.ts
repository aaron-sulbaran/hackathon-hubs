import { describe, expect, it } from "vitest";
import { formatDateOnly, zoneLong, zoneShort } from "@/lib/web/format";
import { isSafeHref, renderMarkdown } from "@/lib/web/markdown";
import { accentCss, accentFor, fillAt, PALETTE } from "@/lib/web/people";
import { parsePitchScriptPage, unknownPresenter, scriptForPage } from "@/lib/web/pitch-script";
import { DEFAULT_PITCH_SCRIPT } from "@/lib/web/pitch-script-default";

describe("links in markdown", () => {
  it("allows web, mail, relative, and anchor links", () => {
    for (const href of ["https://example.com", "http://example.com/a", "mailto:team@example.com", "kb/rules.md", "../sources/a.md", "#notes", "/board"]) expect(isSafeHref(href)).toBe(true);
  });

  it("refuses script and data links, however they are spelled", () => {
    for (const href of ["javascript:alert(1)", "JavaScript:alert(1)", "java\tscript:alert(1)", " javascript:alert(1)", "&#106;avascript:alert(1)", "javascript&colon;alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "file:///etc/passwd"]) expect(isSafeHref(href)).toBe(false);
  });

  it("renders a refused link as plain text, never as an href", () => {
    for (const source of ["[click](javascript:alert(1))", "[click](JAVASCRIPT:alert(1))", "[click](data:text/html;base64,PGI+)"]) {
      const html = renderMarkdown(source, { peopleIds: [] });
      expect(html).not.toMatch(/href="(javascript|data)/i);
      expect(html).toContain("click");
    }
    expect(renderMarkdown("[ok](https://example.com)", { peopleIds: [] })).toContain('href="https://example.com"');
  });
});

describe("dates and zones", () => {
  it("shows a date-only value as written, in every zone", () => {
    expect(formatDateOnly("2027-01-16")).toBe("Sat Jan 16");
    expect(formatDateOnly("2027-12-31")).toBe("Fri Dec 31");
    expect(formatDateOnly("next week")).toBe("next week");
  });

  it("names the zone as it is on the event's date, summer time included", () => {
    const july = Date.parse("2027-07-15T12:00:00Z");
    const january = Date.parse("2027-01-15T12:00:00Z");
    expect(zoneLong(july, "Europe/Berlin")).toBe("Central European Summer Time");
    expect(zoneLong(january, "Europe/Berlin")).toBe("Central European Standard Time");
    expect(zoneLong(january, "Australia/Sydney")).toBe("Australian Eastern Daylight Time");
    expect(zoneShort(january, "America/New_York")).toBe("ET");
    expect(zoneShort(july, "Europe/London")).toBe("GMT+1");
    expect(zoneShort(july, "Europe/Berlin")).toBe("GMT+2");
  });
});

describe("people colors", () => {
  it("hands out colors by place in team.json, so the first six never share one", () => {
    const css = accentCss(["ada", "grace", "linus", "sam", "kim", "lee", "max"]);
    expect(css).toContain(`--accent-ada:${PALETTE[0]};`);
    expect(css).toContain(`--accent-sam:${PALETTE[3]};`);
    expect(css).toContain(`--accent-max:${PALETTE[0]};`);
    expect(new Set(["ada", "grace", "linus", "sam", "kim", "lee"].map((_, index) => fillAt(index))).size).toBe(6);
  });

  it("draws a person's color from their variable, with a fallback for an id off the team", () => {
    expect(accentFor("ada").fill).toMatch(/^var\(--accent-ada, #[0-9A-F]{6}\)$/);
    expect(accentCss(["Bad Id", "ada"])).toBe(`:root{--accent-ada:${PALETTE[1]};}`);
  });
});

describe("pitch script presenters", () => {
  const script = (who: string) => ({ ...DEFAULT_PITCH_SCRIPT, parts: [{ id: "p1", title: "Open", by: "x", target: 10, cues: [{ n: "1", who, kind: "say" as const }] }] });
  const page = (json: unknown) => `\`\`\`json\n${JSON.stringify(json)}\n\`\`\`\n`;

  it("names a cue whose presenter is not on the team", () => {
    const parsed = parsePitchScriptPage(page(script("graec")));
    expect(unknownPresenter(parsed.data!, ["ada", "grace"])).toMatch(/part p1, cue 1 names "graec", who is not in team\.json/);
    expect(unknownPresenter(parsed.data!, [])).toBeNull();
    expect(unknownPresenter(parsePitchScriptPage(page(script("open"))).data!, ["ada"])).toBeNull();
    expect(unknownPresenter(parsePitchScriptPage(page(script("grace"))).data!, ["ada", "grace"])).toBeNull();
  });

  it("reports it through the page's problem line, keeping the script", () => {
    const shown = scriptForPage(page(script("graec")), [], DEFAULT_PITCH_SCRIPT, ["ada", "grace"]);
    expect(shown.problem).toMatch(/graec/);
    expect(shown.script.parts[0]?.title).toBe("Open");
  });
});
