import { Marked, type Tokens, type TokenizerAndRendererExtension } from "marked";
import { withBasePath } from "./base-path";
import { DESIGN_PAGE, designImagePath, designImageUrl } from "./design-reviews";
import { hrefFor } from "./links";

// Markdown from kb pages and event text. Agents write it, so raw HTML is
// escaped, never passed through. `[[kb/rules]]`, `[[t-a3f9]]` and `@grace`
// become board links; repo-relative links (`prompt.md`, `../sources/x.md`)
// open the kb page or the file on GitHub. This is raw HTML, not <Link>, so
// links into the board carry the base path here.

/**
 * Whether a link from markdown may become a clickable href: http, https, and
 * mailto, or a relative path or #anchor. Browsers drop whitespace and control
 * characters inside a scheme ("java\tscript:"), so the check does too.
 */
export function isSafeHref(href: string): boolean {
  const decoded = href
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&colon;/gi, ":");
  const squeezed = decoded.replace(/[\u0000- \u007f]/g, "").toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(squeezed)?.[1];
  if (!scheme) return true;
  return scheme === "http" || scheme === "https" || scheme === "mailto";
}

/** An href for a plain <a>: board paths ("/kb/x") get the base path, everything else is untouched. */
export function anchorHref(href: string): string {
  return href.startsWith("/") && !href.startsWith("//") ? withBasePath(href) : href;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface MarkdownOptions {
  peopleIds: string[];
  repo?: string | null;
  /** kb slug to page title, so `[[kb/slug]]` reads as the title. */
  titles?: Record<string, string>;
  /**
   * How an allowed design image (`![alt](design/review/x.webp)`) renders:
   * "inline" as a lazy <img> that opens full size (design review cards),
   * "link" as a text link to the Design page (feeds, threads, kb), the default.
   * Any other image source is plain text either way.
   */
  images?: "inline" | "link";
}

export function resolveRepoHref(href: string, repo: string | null | undefined): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
  const [target = "", hash] = href.split("#");
  const sibling = /^(?:\.\/)?(?:kb\/)?([a-z0-9][a-z0-9/_-]*)\.md$/i.exec(target);
  if (sibling && !target.startsWith("../")) return `/kb/${sibling[1]}${hash ? `#${hash}` : ""}`;
  const repoPath = target.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
  return repo ? `https://github.com/${repo}/blob/main/${encodeURI(repoPath)}` : `#${repoPath}`;
}

function buildMarked(options: MarkdownOptions): Marked {
  const wikiLink: TokenizerAndRendererExtension = {
    name: "wikiLink",
    level: "inline",
    start: (src: string) => src.indexOf("[["),
    tokenizer(src: string) {
      const match = /^\[\[([^\]\n]+)\]\]/.exec(src);
      if (!match) return undefined;
      return { type: "wikiLink", raw: match[0], target: (match[1] ?? "").trim() };
    },
    renderer(token) {
      const target = String(token.target);
      const href = hrefFor(target, options.peopleIds);
      // A page link reads as the page's title; the slug is only the fallback.
      const slug = target.replace(/^kb\//, "").replace(/\.md$/, "");
      const label = escapeHtml((target.startsWith("kb/") ? options.titles?.[slug] : undefined) ?? slug);
      if (!href) return `<span class="ref-chip">${label}</span>`;
      return `<a class="ref-chip" href="${escapeHtml(anchorHref(href))}">${label}</a>`;
    },
  };

  const mention: TokenizerAndRendererExtension = {
    name: "mention",
    level: "inline",
    start(src: string) {
      const match = /(^|[^\w@])@[a-z]/.exec(src);
      return match ? match.index + (match[1]?.length ?? 0) : undefined;
    },
    tokenizer(src: string) {
      const match = /^@([a-z][a-z0-9_]*)/.exec(src);
      if (!match?.[1] || !options.peopleIds.includes(match[1])) return undefined;
      return { type: "mention", raw: match[0], id: match[1] };
    },
    renderer(token) {
      const id = escapeHtml(String(token.id));
      return `<a class="mention" href="${withBasePath(`/p/${id}`)}">@${id}</a>`;
    },
  };

  return new Marked({
    gfm: true,
    breaks: false,
    extensions: [wikiLink, mention],
    renderer: {
      link(this: { parser: { parseInline: (tokens: Tokens.Generic[]) => string } }, token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens);
        // Text from kb pages and events is not trusted: a javascript: or data: link would run in the board's origin.
        if (!isSafeHref(token.href)) return `<span class="unsafe-link">${text}</span>`;
        const href = resolveRepoHref(token.href, options.repo);
        const external = /^https?:/i.test(href);
        const rel = external ? ' target="_blank" rel="noopener noreferrer"' : "";
        return `<a href="${escapeHtml(anchorHref(href))}"${rel}>${text}</a>`;
      },
      image(token: Tokens.Image) {
        const repoPath = designImagePath(token.href);
        if (!repoPath) return escapeHtml(token.raw);
        const alt = escapeHtml(token.text || "Design image");
        const src = escapeHtml(designImageUrl(repoPath));
        if (options.images !== "inline") return `<a href="${escapeHtml(withBasePath(DESIGN_PAGE))}">Image: ${alt} (see it on Design)</a>`;
        return `<a class="design-image" href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${alt}" loading="lazy" decoding="async"></a>`;
      },
      html(token: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(token.text);
      },
    },
  });
}

const cache = new Map<string, Marked>();

export function renderMarkdown(markdown: string, options: MarkdownOptions): string {
  const titles = options.titles ? Object.entries(options.titles).map(([slug, title]) => `${slug}=${title}`).join("\u0001") : "";
  const key = `${options.peopleIds.join(",")}|${options.repo ?? ""}|${options.images ?? "link"}|${titles}`;
  let marked = cache.get(key);
  if (!marked) {
    marked = buildMarked(options);
    cache.set(key, marked);
  }
  return marked.parse(markdown, { async: false });
}
