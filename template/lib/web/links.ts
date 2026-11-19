// Where each kind of id opens on the board. Shared by markdown rendering, the
// feed, and the knowledge graph so a link means the same thing everywhere.

export type RefKind = "item" | "question" | "decision" | "gate" | "session" | "kb" | "person";

export function refKindOf(ref: string, peopleIds: string[] = []): RefKind | null {
  if (ref.startsWith("kb/")) return "kb";
  if (peopleIds.includes(ref)) return "person";
  const prefix = ref.slice(0, 2);
  if (prefix === "t-") return "item";
  if (prefix === "q-") return "question";
  if (prefix === "d-") return "decision";
  if (prefix === "g-") return "gate";
  if (prefix === "s-") return "session";
  return null;
}

export function hrefFor(ref: string, peopleIds: string[] = []): string | null {
  switch (refKindOf(ref, peopleIds)) {
    case "kb":
      return `/${ref}`;
    case "person":
      return `/p/${ref}`;
    case "item":
      return `/board?item=${encodeURIComponent(ref)}`;
    case "question":
    case "decision":
    case "gate":
      return `/decide#${ref}`;
    case "session":
      return `/#${ref}`;
    default:
      return null;
  }
}
