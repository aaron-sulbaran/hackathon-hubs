import type { KbPage } from "./types";

// kb/*.md pages: a small frontmatter block (docs/CONTRACT.md, "KB pages") then
// markdown. Only flat `key: value` lines are read; anything else in the block
// is ignored rather than failing the page.

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** `title: "Idea: Lantern"` reads as Idea: Lantern. */
function unquote(value: string): string {
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  return quoted ? (quoted[1] ?? "") : value;
}

export function parseFrontmatter(markdown: string): { fields: Record<string, string>; body: string } {
  const match = FRONTMATTER.exec(markdown);
  if (!match) return { fields: {}, body: markdown };
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (pair?.[1]) fields[pair[1]] = unquote((pair[2] ?? "").trim());
  }
  return { fields, body: markdown.slice(match[0].length) };
}

export function slugFromPath(path: string): string | null {
  const match = /^kb\/(.+)\.md$/.exec(path);
  if (!match?.[1]) return null;
  return /^[a-z0-9][a-z0-9/_-]*$/i.test(match[1]) ? match[1] : null;
}

export function parseKbPage(slug: string, markdown: string): KbPage {
  const { fields, body } = parseFrontmatter(markdown);
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return {
    slug,
    title: fields.title || heading || slug,
    kind: fields.kind || null,
    updated: fields.updated || null,
    by: fields.by || null,
    group: fields.group || null,
    body,
  };
}

/** Wiki links `[[kb/slug]]` and `[[t-a3f9]]`, as written (without brackets). */
export function wikiLinks(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((match) => (match[1] ?? "").trim()).filter(Boolean);
}

/** `@grace` style mentions that name someone in `ids`. */
export function mentions(text: string, ids: string[]): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/(^|[^\w@])@([a-z][a-z0-9_]*)/g)) {
    const id = match[2];
    if (id && ids.includes(id)) found.add(id);
  }
  return [...found];
}
