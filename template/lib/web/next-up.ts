import type { OnboardingEntry } from "./onboarding";
import { byRelevance, isLongPastDue, NOW_AREA } from "./relevance";
import type { Board } from "./types";

// What each teammate should do next, in the order it matters: an open item
// tagged "now" is everyone's next step; then a question asked
// of them that they have not answered, their agent setup, a team question,
// their item in flight, their next item, then the most urgent unclaimed item.
// Items are ordered by when they are due (lib/web/relevance.ts), and unclaimed
// work long past due is skipped. There is always an answer, so the greeting
// never says hi and then nothing.

export interface NextUp {
  title: string;
  href: string;
  why: string;
}

/** "Grace: make two tokens" reads as "make two tokens" on Grace's own line. */
function withoutOwnName(title: string, firstName: string): string {
  const prefix = new RegExp(`^${firstName}:\\s*`, "i");
  const trimmed = title.replace(prefix, "");
  return trimmed === title ? title : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

export function nextFor(board: Board, id: string, onboarding: OnboardingEntry[], nowMs: number, isQuietQuestion: (title: string) => boolean = () => false): NextUp {
  const first = board.people.find((person) => person.id === id)?.name.split(" ")[0] ?? id;
  const relevance = byRelevance(nowMs);
  const teamNow = board.items.filter((item) => item.area === NOW_AREA && item.lane !== "done").sort(relevance)[0];
  if (teamNow) return { title: teamNow.title, href: `/board?item=${teamNow.id}`, why: "the whole team, now" };
  const open = board.questions.filter((question) => question.status === "open" && !isQuietQuestion(question.title));
  // Once you have answered, the question waits on its asker to settle it.
  const mine = open
    .filter((question) => question.for === id && !question.answers.some((answer) => answer.by === id))
    .sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  if (mine[0]) return { title: withoutOwnName(mine[0].title, first), href: `/decide#${mine[0].id}`, why: "asked of you" };
  const setup = onboarding.find((entry) => entry.owner === id && !entry.done);
  if (setup) return { title: "Connect your coding agent to the hub", href: "/#first-task", why: "about five minutes" };
  const team = open
    .filter((question) => question.for === "team" && !question.answers.some((answer) => answer.by === id))
    .sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  if (team[0]) return { title: team[0].title, href: `/decide#${team[0].id}`, why: "asked of the team" };
  const flying = board.items.filter((item) => item.owner === id && item.lane === "in_flight").sort(relevance);
  if (flying[0]) return { title: flying[0].title, href: `/board?item=${flying[0].id}`, why: "yours, in flight" };
  const queued = board.items.filter((item) => item.owner === id && (item.lane === "up_next" || item.lane === "needs_human")).sort(relevance);
  if (queued[0]) return { title: queued[0].title, href: `/board?item=${queued[0].id}`, why: "yours, up next" };
  const unclaimed = board.items.filter((item) => !item.owner && item.lane === "up_next" && !isLongPastDue(item.due, nowMs)).sort(relevance);
  if (unclaimed[0]) return { title: unclaimed[0].title, href: `/board?item=${unclaimed[0].id}`, why: "nobody has it yet" };
  return { title: "Pick something on the Board, or add what you are building", href: "/board", why: "the board is clear" };
}
