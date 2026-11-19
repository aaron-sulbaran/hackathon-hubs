import { describe, expect, it } from "vitest";
import { BASE_PATH } from "@/lib/web/base-path";
import { designImagePath, designImageUrl, imageContentType, isDesignReview, orderDesignReviews, stripDesignPrefix } from "@/lib/web/design-reviews";
import { renderMarkdown } from "@/lib/web/markdown";

describe("design image paths", () => {
  it("accepts images under design/review, design/reference, and design/mockups", () => {
    expect(designImagePath("design/review/20270114-0930-nav.webp")).toBe("design/review/20270114-0930-nav.webp");
    expect(designImagePath("./design/reference/event/cover_1.PNG")).toBe("design/reference/event/cover_1.PNG");
    expect(designImagePath("design/mockups/a.jpeg")).toBe("design/mockups/a.jpeg");
  });

  it("refuses traversal, other folders, other extensions, and odd characters", () => {
    for (const bad of [
      "design/../team.json",
      "design/review/../../team.json",
      "design/review/..png",
      "design/review/.hidden.png",
      "design/review//a.png",
      "design/other/a.png",
      "design/review/a.svg",
      "design/review/a.html",
      "design/review/a png.png",
      "design/review/a%2e.png",
      "/design/review/a.png",
      "https://example.com/design/review/a.png",
      "design/review/a.png?x=1",
      "events/2027-01-14/x.json",
      "",
    ]) {
      expect(designImagePath(bad), bad).toBeNull();
    }
  });

  it("maps to the image route under the base path, with the right content type", () => {
    expect(designImageUrl("design/review/a.webp")).toBe(`${BASE_PATH}/design/img/review/a.webp`);
    expect(imageContentType("design/review/a.JPG")).toBe("image/jpeg");
    expect(imageContentType("design/review/a.webp")).toBe("image/webp");
    expect(imageContentType("design/review/a.png")).toBe("image/png");
  });
});

describe("design review questions", () => {
  it("are found by title prefix and lose it in the heading", () => {
    expect(isDesignReview("Design review: Settings page v2")).toBe(true);
    expect(isDesignReview("design REVIEW:x")).toBe(true);
    expect(isDesignReview("Is the design review done?")).toBe(false);
    expect(stripDesignPrefix("Design review:  Settings page v2 ")).toBe("Settings page v2");
  });

  it("order open ones first, newest first", () => {
    const rows = [
      { id: "a", status: "open" as const, askedAt: "2027-01-14T10:00:00Z" },
      { id: "b", status: "settled" as const, askedAt: "2027-01-14T12:00:00Z" },
      { id: "c", status: "open" as const, askedAt: "2027-01-14T11:00:00Z" },
      { id: "d", status: "settled" as const, askedAt: "2027-01-14T09:00:00Z" },
    ];
    expect(orderDesignReviews(rows).map((row) => row.id)).toEqual(["c", "a", "b", "d"]);
  });
});

describe("markdown images", () => {
  const options = { peopleIds: ["grace"], repo: "owner/hub" };

  it("renders an allowed design image inline as a lazy img linked to full size", () => {
    const html = renderMarkdown("![Settings page](design/review/a.webp)", { ...options, images: "inline" });
    const src = `${BASE_PATH}/design/img/review/a.webp`;
    expect(html).toContain(`<img src="${src}" alt="Settings page" loading="lazy"`);
    expect(html).toContain(`<a class="design-image" href="${src}" target="_blank"`);
  });

  it("renders an allowed image as a text link to Design by default", () => {
    const html = renderMarkdown("![Settings page](design/review/a.webp)", options);
    expect(html).not.toContain("<img");
    expect(html).toContain(`href="${BASE_PATH}/design"`);
    expect(html).toContain("see it on Design");
  });

  it("never renders an external URL or a traversal path as an image", () => {
    for (const source of ["![x](https://evil.example/a.png)", "![x](design/../team.json)", "![x](javascript:alert(1))", "![x](//evil.example/a.png)"]) {
      const html = renderMarkdown(source, { ...options, images: "inline" });
      expect(html, source).not.toContain("<img");
      expect(html, source).not.toContain("<a");
    }
  });

  it("keeps alt text escaped", () => {
    const html = renderMarkdown('![<b>"hi"</b>](design/review/a.png)', { ...options, images: "inline" });
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("still escapes raw HTML", () => {
    expect(renderMarkdown('<img src="design/review/a.png">', { ...options, images: "inline" })).not.toContain("<img");
  });
});
