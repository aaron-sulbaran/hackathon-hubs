import type { Board, Gate, HubEvent, Question } from "./types";

// How each event reads as a post in the feed, and which filter it falls under.
// Unknown types are kept (the contract says never drop them) and read as their
// raw type name.

const VERBS: Record<string, string> = {
  "item.add": "added an item",
  "item.claim": "picked up",
  "item.update": "updated",
  "item.block": "needs a hand with",
  "item.done": "finished",
  note: "posted progress",
  "question.ask": "asked",
  "question.answer": "answered",
  "question.settle": "settled",
  "decision.propose": "proposed a decision",
  "decision.accept": "accepted",
  "decision.reject": "rejected",
  "gate.add": "added a gate",
  "gate.propose": "says a gate is ready",
  "gate.pass": "passed a gate",
  "gate.fail": "failed a gate",
  "kb.update": "updated the knowledge base",
  "script.edit": "edited the pitch script",
  "session.start": "started a session",
  "session.end": "wrapped a session",
  comment: "commented",
};

export function verbFor(type: string): string {
  return VERBS[type] ?? type;
}

export const FEED_FILTERS = [
  { id: "all", label: "Everything" },
  { id: "work", label: "Work" },
  { id: "questions", label: "Questions" },
  { id: "decisions", label: "Decisions and gates" },
  { id: "sessions", label: "Sessions" },
  { id: "kb", label: "Knowledge" },
] as const;

export type FeedFilter = (typeof FEED_FILTERS)[number]["id"];

export function filterOf(type: string): Exclude<FeedFilter, "all"> | "other" {
  if (type.startsWith("item.") || type === "note") return "work";
  if (type.startsWith("question.")) return "questions";
  if (type.startsWith("decision.") || type.startsWith("gate.")) return "decisions";
  if (type.startsWith("session.")) return "sessions";
  if (type === "kb.update" || type === "script.edit") return "kb";
  return "other";
}

export function matchesFilter(event: HubEvent, filter: FeedFilter, person: string | null): boolean {
  if (person && event.by !== person) return false;
  if (filter === "all") return true;
  return filterOf(event.type) === filter;
}

export interface NeedsYou {
  gates: Gate[];
  questions: Question[];
}

/** What a person may want to act on: gates an agent says are ready, and open questions for this person or the team. Calls on record are not listed; they block nobody. */
export function needsYou(board: Board, who: string | null): NeedsYou {
  return {
    gates: board.gates.filter((gate) => gate.status === "proposed"),
    questions: board.questions.filter(
      (question) => question.status === "open" && (question.for === who || (who !== null && question.for === "team")),
    ),
  };
}

/** Title of whatever an event's ref points at, for the "on ..." line of a post. */
export function refTitle(board: Board, ref: string | undefined): string | null {
  if (!ref) return null;
  const found =
    board.items.find((item) => item.id === ref) ??
    board.questions.find((question) => question.id === ref) ??
    board.decisions.find((decision) => decision.id === ref) ??
    board.gates.find((gate) => gate.id === ref);
  if (found) return found.title;
  const session = board.sessions.find((candidate) => candidate.id === ref);
  return session ? session.focus : null;
}
