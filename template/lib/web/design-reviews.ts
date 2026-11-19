import { withBasePath } from "./base-path";
import type { Question } from "./types";

// A design review is an ordinary board question whose title starts with
// "Design review:". Its text is markdown with one or more images from the hub
// repo (design/review, design/reference, or design/mockups) and optional
// notes; teammates' feedback is the question's answers, and settling it marks
// the review resolved. The images are served by app/design/img/[...path].

export const DESIGN_PAGE = "/design";

const PREFIX = /^\s*design review:\s*/i;

/** True when a question's title marks it as a design review. */
export function isDesignReview(title: string): boolean {
  return PREFIX.test(title);
}

/** The title without its "Design review:" prefix. */
export function stripDesignPrefix(title: string): string {
  return title.replace(PREFIX, "").trim();
}

const IMAGE_TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

// Each folder name starts with a letter, digit, or underscore, so "." and ".."
// never match; only letters, digits, dot, underscore, and hyphen are allowed.
const SAFE_PATH = /^design\/(review|reference|mockups)\/(?:[A-Za-z0-9_][A-Za-z0-9._-]*\/)*[A-Za-z0-9_][A-Za-z0-9._-]*\.(webp|png|jpg|jpeg)$/i;

/**
 * The repo path of a design image, or null when the path is not one the board
 * may serve. Accepts "design/review/x.webp" or "./design/review/x.webp".
 */
export function designImagePath(value: string): string | null {
  const candidate = value.trim().replace(/^\.\//, "");
  if (candidate.length > 300 || candidate.includes("..") || candidate.includes("//")) return null;
  return SAFE_PATH.test(candidate) ? candidate : null;
}

/** The content type for an allowed design image path. */
export function imageContentType(repoPath: string): string {
  const extension = repoPath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_TYPES[extension] ?? "application/octet-stream";
}

/** The board URL that serves an allowed design image, with the base path applied. */
export function designImageUrl(repoPath: string): string {
  return withBasePath(`/design/img/${repoPath.slice("design/".length)}`);
}

type ReviewLike = Pick<Question, "status" | "askedAt">;

/** Open reviews first, newest first within each group. */
export function orderDesignReviews<T extends ReviewLike>(reviews: T[]): T[] {
  const newestFirst = [...reviews].sort((a, b) => b.askedAt.localeCompare(a.askedAt));
  return [...newestFirst.filter((review) => review.status !== "settled"), ...newestFirst.filter((review) => review.status === "settled")];
}
