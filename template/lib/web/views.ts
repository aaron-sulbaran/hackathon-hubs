import "server-only";
import { toEntry, type FeedEntry } from "./entries";
import { renderMarkdown } from "./markdown";
import { isDesignReview, orderDesignReviews, stripDesignPrefix } from "./design-reviews";
import { askKind, fullAsk, orderMentorQuestions, type AskKind } from "./mentor-questions";
import type { Board, Decision, Gate, Item, Question } from "./types";

// Board objects with their markdown and threads rendered on the server.

export interface ItemView {
  item: Item;
  textHtml: string | null;
  thread: FeedEntry[];
  history: FeedEntry[];
}

export interface QuestionView {
  question: Question;
  textHtml: string | null;
  answers: FeedEntry[];
  comments: FeedEntry[];
}

export interface DecisionView {
  decision: Decision;
  textHtml: string | null;
  comments: FeedEntry[];
}

export interface GateView {
  gate: Gate;
  textHtml: string | null;
  history: FeedEntry[];
  comments: FeedEntry[];
}

function md(board: Board, text: string | null | undefined, repo: string | null, images: "inline" | "link" = "link"): string | null {
  return text ? renderMarkdown(text, { peopleIds: board.people.map((person) => person.id), repo, images }) : null;
}

export function itemViews(board: Board, repo: string | null): ItemView[] {
  return board.items.map((item) => ({
    item,
    textHtml: md(board, item.text, repo),
    thread: [...item.notes, ...item.comments].sort((a, b) => a.at.localeCompare(b.at)).map((event) => toEntry(board, event, repo)),
    history: item.history.map((event) => toEntry(board, event, repo)),
  }));
}

export function questionViews(board: Board, repo: string | null): QuestionView[] {
  return board.questions.map((question) => ({
    question,
    textHtml: md(board, question.text, repo),
    answers: question.answers.map((event) => toEntry(board, event, repo)),
    comments: question.comments.map((event) => toEntry(board, event, repo)),
  }));
}

export function decisionViews(board: Board, repo: string | null): DecisionView[] {
  return board.decisions.map((decision) => ({
    decision,
    textHtml: md(board, [decision.text, decision.why && decision.why !== decision.text ? `**Why:** ${decision.why}` : ""].filter(Boolean).join("\n\n"), repo),
    comments: decision.comments.map((event) => toEntry(board, event, repo)),
  }));
}

export function gateViews(board: Board, repo: string | null): GateView[] {
  return board.gates.map((gate) => ({
    gate,
    textHtml: md(board, gate.text, repo),
    history: gate.history.map((event) => toEntry(board, event, repo)),
    comments: gate.comments.map((event) => toEntry(board, event, repo)),
  }));
}

/** One row of the "Questions to ask mentors" list: a question view plus the text to read aloud. */
export interface MentorQuestionView extends QuestionView {
  /** The whole question, without its "Mentor question:" or "Organizer question:" prefix. textHtml holds only the detail after it. */
  ask: string;
  kind: AskKind;
}

/** The mentor and organizer questions, in the order kb/mentor-questions.md gives (see orderMentorQuestions). */
export function mentorQuestionViews(board: Board, order: string[] | null, repo: string | null): MentorQuestionView[] {
  const ordered = new Set(orderMentorQuestions(board.questions, order).map((question) => question.id));
  const views = new Map(questionViews({ ...board, questions: board.questions.filter((question) => ordered.has(question.id)) }, repo).map((view) => [view.question.id, view]));
  return [...ordered].flatMap((id) => {
    const view = views.get(id);
    if (!view) return [];
    const { ask, detail } = fullAsk(view.question.title, view.question.text);
    return [{ ...view, ask, textHtml: md(board, detail, repo), kind: askKind(view.question.title) ?? "mentor" }];
  });
}

/** One card on the Design page: a question view with images shown inline and the title without its prefix. */
export interface DesignReviewView extends QuestionView {
  heading: string;
}

/** Every "Design review:" question, open ones first, newest first. */
export function designReviewViews(board: Board, repo: string | null): DesignReviewView[] {
  return orderDesignReviews(board.questions.filter((question) => isDesignReview(question.title))).map((question) => ({
    question,
    heading: stripDesignPrefix(question.title) || "Untitled",
    textHtml: md(board, question.text, repo, "inline"),
    answers: question.answers.map((event) => toEntry(board, event, repo)),
    comments: question.comments.map((event) => toEntry(board, event, repo)),
  }));
}

/** What the home page row needs: open reviews and the feedback on them. */
export function designReviewSummary(board: Board): { open: number; comments: number } {
  const open = board.questions.filter((question) => isDesignReview(question.title) && question.status !== "settled");
  return { open: open.length, comments: open.reduce((sum, question) => sum + question.answers.length + question.comments.length, 0) };
}
