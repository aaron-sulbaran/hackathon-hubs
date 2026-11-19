import type { Item } from "./types";

// Each teammate has one board item with area "onboarding": connect your coding
// agent to the hub. The home page leads with it until it is done, and the
// prompt it offers to copy is the fenced text block in docs/agent-prompt.md,
// read from the hub snapshot so there is one copy of that text.

export const ONBOARDING_AREA = "onboarding";
export const AGENT_PROMPT_FILE = "docs/agent-prompt.md";
/** Where a teammate accepts the invite to the hub repo: its invitations page, or GitHub notifications before the repo is known. */
export function inviteUrlFor(repo: string | null): string {
  return repo ? `https://github.com/${repo}/invitations` : "https://github.com/notifications";
}

/** The body of the first fenced `text` block, exactly as written, or null if there is none. */
export function extractPromptText(markdown: string | null | undefined): string | null {
  if (!markdown) return null;
  const match = /^```text[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/m.exec(markdown);
  const body = match?.[1]?.replace(/\r\n/g, "\n");
  return body && body.trim() ? body : null;
}

export interface OnboardingEntry {
  owner: string;
  /** The item to check off: the person's open onboarding item, or their done one. */
  itemId: string;
  title: string;
  done: boolean;
}

/** One entry per person who has an onboarding item, in the order of `personIds`. Done if any of their onboarding items is done. */
export function onboardingEntries(items: Pick<Item, "id" | "title" | "owner" | "area" | "lane">[], personIds: string[]): OnboardingEntry[] {
  const entries: OnboardingEntry[] = [];
  for (const owner of personIds) {
    const mine = items.filter((item) => item.area === ONBOARDING_AREA && item.owner === owner);
    const finished = mine.find((item) => item.lane === "done");
    const target = finished ?? mine[0];
    if (target) entries.push({ owner, itemId: target.id, title: target.title, done: Boolean(finished) });
  }
  return entries;
}
