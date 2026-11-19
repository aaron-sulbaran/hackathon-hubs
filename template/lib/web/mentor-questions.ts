import type { Question } from "./types";

// The questions the team wants to ask mentors and organizers are ordinary board
// questions whose titles start with "Mentor question:" or "Organizer question:".
// The board shows them as one list. kb/mentor-questions.md decides the order:
// each line under its "Questions to ask" heading starts with [[q-xxxx]], and
// the page is read from the hub snapshot, so editing it reorders the list
// without a deploy.

export const MENTOR_QUESTIONS_FILE = "kb/mentor-questions.md";
export const MENTOR_QUESTIONS_SLUG = "mentor-questions";
export const MENTOR_LIST_TITLE = "Questions to ask mentors";

export type AskKind = "mentor" | "organizer";

const PREFIX = /^\s*(mentor|organizer) question:\s*/i;

/** Who a question is meant for, read from its title prefix, or null for an ordinary question. */
export function askKind(title: string): AskKind | null {
  const match = PREFIX.exec(title);
  if (!match) return null;
  return match[1]?.toLowerCase() === "organizer" ? "organizer" : "mentor";
}

/** The title without its "Mentor question:" or "Organizer question:" prefix. */
export function stripAskPrefix(title: string): string {
  return title.replace(PREFIX, "").trim();
}

/**
 * The whole question and whatever detail follows it. Board titles are clipped
 * at 140 characters (ending in "..."); when that happened and the question's
 * text opens with the same words, the first paragraph of the text is the full
 * question. `detail` is the rest of the text, or null.
 */
export function fullAsk(title: string, text: string | null | undefined): { ask: string; detail: string | null } {
  const ask = stripAskPrefix(title);
  const body = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) return { ask, detail: null };
  const [first = "", ...rest] = body.split(/\n\s*\n/);
  const opening = stripAskPrefix(first.replace(/\s*\n\s*/g, " "));
  const clipped = /(\.\.\.|\u2026)$/.test(ask);
  const stem = clipped ? ask.replace(/(\.\.\.|\u2026)$/, "").trimEnd() : ask;
  const sameQuestion = clipped ? opening.startsWith(stem) : opening === ask;
  if (!sameQuestion) return { ask, detail: body };
  return { ask: opening, detail: rest.join("\n\n").trim() || null };
}

/** The viewer's last open or closed choice for the list, and how many questions were left to ask then. */
export interface ListChoice {
  open: boolean;
  toAsk: number;
}

function isListChoice(value: unknown): value is ListChoice {
  if (typeof value !== "object" || value === null) return false;
  const choice = value as Record<string, unknown>;
  return typeof choice.open === "boolean" && typeof choice.toAsk === "number";
}

/**
 * Whether the list starts open. The viewer's last choice holds while the count
 * left to ask is the same; when it changes (a new question, the last one
 * answered) the list goes back to open when something is left to ask and
 * folded to one line when nothing is.
 */
export function listStartsOpen(toAsk: number, saved: unknown): boolean {
  if (isListChoice(saved) && saved.toAsk === toAsk) return saved.open;
  return toAsk > 0;
}

/**
 * The question ids listed under the "Questions to ask" heading, in page order.
 * Null when the page is missing or lists nothing, so the caller falls back to the title prefix.
 */
export function parseQuestionOrder(markdown: string | null | undefined): string[] | null {
  if (!markdown) return null;
  const ids: string[] = [];
  let inSection = false;
  let sectionDepth = 0;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const depth = heading[1]?.length ?? 0;
      if (inSection && depth <= sectionDepth) break;
      if (!inSection && depth >= 2 && /^questions to ask$/i.test(heading[2] ?? "")) {
        inSection = true;
        sectionDepth = depth;
      }
      continue;
    }
    if (!inSection) continue;
    const item = /^\s*(?:\d+[.)]|[-*+])\s+\[\[(q-[a-z0-9]{4})\]\]/.exec(line);
    const id = item?.[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.length > 0 ? ids : null;
}

type QuestionLike = Pick<Question, "id" | "title" | "status" | "askedAt">;

/**
 * The questions that belong in the one list, in the order to show them:
 * the ones the page lists (page order), then any other mentor or organizer
 * question (asked order). Settled questions keep that order but drop below
 * every open one. Ids on the page that are not on the board are skipped.
 */
export function orderMentorQuestions<T extends QuestionLike>(questions: T[], order: string[] | null): T[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const listed = (order ?? []).map((id) => byId.get(id)).filter((question): question is T => question !== undefined);
  const listedIds = new Set(listed.map((question) => question.id));
  const unlisted = questions
    .filter((question) => !listedIds.has(question.id) && askKind(question.title) !== null)
    .sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  const all = [...listed, ...unlisted];
  return [...all.filter((question) => question.status !== "settled"), ...all.filter((question) => question.status === "settled")];
}
