import { describe, expect, it } from "vitest";
import { mentions, parseKbPage, slugFromPath, wikiLinks } from "@/lib/web/kb";
import { hrefFor } from "@/lib/web/links";
import { renderMarkdown, resolveRepoHref } from "@/lib/web/markdown";

const people = ["ada", "grace"];

describe("kb pages", () => {
  it("reads frontmatter and falls back to the heading", () => {
    const page = parseKbPage("prompt", "---\ntitle: The prompt\nkind: brief\nby: ada\n---\n# Heading\nBody");
    expect(page).toMatchObject({ slug: "prompt", title: "The prompt", kind: "brief", by: "ada" });
    expect(parseKbPage("x", "# Only heading\n").title).toBe("Only heading");
  });

  it("maps kb paths to slugs", () => {
    expect(slugFromPath("kb/prompt.md")).toBe("prompt");
    expect(slugFromPath("kb/../secret.md")).toBeNull();
    expect(slugFromPath("events/a.json")).toBeNull();
  });

  it("finds wiki links and known mentions only", () => {
    expect(wikiLinks("see [[kb/rules]] and [[t-a3f9]]")).toEqual(["kb/rules", "t-a3f9"]);
    expect(mentions("ping @grace and @nobody, not email a@grace", people)).toEqual(["grace"]);
  });
});

describe("links and markdown", () => {
  it("routes each kind of id", () => {
    expect(hrefFor("kb/prompt")).toBe("/kb/prompt");
    expect(hrefFor("t-a3f9")).toBe("/board?item=t-a3f9");
    expect(hrefFor("q-zz11")).toBe("/decide#q-zz11");
    expect(hrefFor("grace", people)).toBe("/p/grace");
  });

  it("renders wiki links and mentions, and escapes raw html", () => {
    const html = renderMarkdown("Read [[kb/rules]], ask @grace. <script>x</script>", { peopleIds: people });
    expect(html).toContain('href="/kb/rules"');
    expect(html).toContain('href="/p/grace"');
    expect(html).not.toContain("<script>");
  });

  it("resolves repo-relative links", () => {
    expect(resolveRepoHref("rules.md", "o/r")).toBe("/kb/rules");
    expect(resolveRepoHref("../sources/a.md", "o/r")).toBe("https://github.com/o/r/blob/main/sources/a.md");
    expect(resolveRepoHref("https://x.dev", "o/r")).toBe("https://x.dev");
  });
});
