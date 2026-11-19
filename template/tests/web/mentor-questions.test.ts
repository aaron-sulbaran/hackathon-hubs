import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MENTOR_QUESTIONS_FILE, askKind, fullAsk, listStartsOpen, orderMentorQuestions, parseQuestionOrder, stripAskPrefix } from "@/lib/web/mentor-questions";

const PAGE = [
  "---",
  "title: Questions to ask mentors",
  "---",
  "",
  "# Questions to ask mentors",
  "",
  "Post what they said with `./hub answer <q-id>`. See [[q-zzzz]] for context.",
  "",
  "## Questions to ask",
  "",
  "1. [[q-bbbb]] Second asked, first on the page?",
  "2. [[q-aaaa]] (Organizer) First asked?",
  "- [[q-cccc]] A bullet works too",
  "3. [[q-bbbb]] A repeat is ignored",
  "4. Not a question line, [[q-dddd]] is mid sentence",
  "",
  "## Related",
  "",
  "1. [[q-eeee]] outside the section",
].join("\n");

describe("parseQuestionOrder", () => {
  it("reads the ids under the heading, in page order, and nothing outside it", () => {
    expect(parseQuestionOrder(PAGE)).toEqual(["q-bbbb", "q-aaaa", "q-cccc"]);
  });

  it("handles CRLF and a deeper heading level", () => {
    expect(parseQuestionOrder("### Questions to ask\r\n1. [[q-ab12]] One\r\n2) [[q-cd34]] Two\r\n")).toEqual(["q-ab12", "q-cd34"]);
  });

  it("is null when the page or the heading is missing, or the section lists nothing", () => {
    expect(parseQuestionOrder(null)).toBeNull();
    expect(parseQuestionOrder("")).toBeNull();
    expect(parseQuestionOrder("# Questions to ask mentors\n\n1. [[q-aaaa]] under the page title only\n")).toBeNull();
    expect(parseQuestionOrder("## Questions to ask\n\nNone yet.\n")).toBeNull();
  });

  it("reads the real kb page without duplicates, list or not", () => {
    const file = path.resolve(import.meta.dirname, "../..", MENTOR_QUESTIONS_FILE);
    if (!existsSync(file)) return;
    const order = parseQuestionOrder(readFileSync(file, "utf8"));
    if (order) expect(new Set(order).size).toBe(order.length);
  });
});

describe("askKind and stripAskPrefix", () => {
  it("reads the kind from the title prefix", () => {
    expect(askKind("Mentor question: Why?")).toBe("mentor");
    expect(askKind("Organizer question: May we?")).toBe("organizer");
    expect(askKind("organizer Question:May we?")).toBe("organizer");
    expect(askKind("Which mentor question matters most?")).toBeNull();
  });

  it("strips only the prefix", () => {
    expect(stripAskPrefix("Mentor question: Why? Mentor question: again")).toBe("Why? Mentor question: again");
    expect(stripAskPrefix("Organizer question:   May we?")).toBe("May we?");
    expect(stripAskPrefix("An ordinary title")).toBe("An ordinary title");
  });
});

describe("fullAsk", () => {
  it("uses the title when there is no text, and keeps unrelated text as detail", () => {
    expect(fullAsk("Mentor question: Why?", "")).toEqual({ ask: "Why?", detail: null });
    expect(fullAsk("Mentor question: Why?", "Some background.")).toEqual({ ask: "Why?", detail: "Some background." });
  });

  it("recovers a clipped title from the first paragraph of the text", () => {
    const text = "Mentor question: Do judges prefer a live demo or a video (option one, option two, etc.)?\n\nFrom the kickoff.\n\nAsk every mentor.";
    expect(fullAsk("Mentor question: Do judges prefer a live demo or a video (option one, option two...", text)).toEqual({
      ask: "Do judges prefer a live demo or a video (option one, option two, etc.)?",
      detail: "From the kickoff.\n\nAsk every mentor.",
    });
  });

  it("does not repeat a question the text only restates", () => {
    expect(fullAsk("Mentor question: Why?", "Mentor question: Why?\n\nContext.")).toEqual({ ask: "Why?", detail: "Context." });
    expect(fullAsk("Mentor question: Why...", "Something else entirely.")).toEqual({ ask: "Why...", detail: "Something else entirely." });
  });
});

describe("orderMentorQuestions", () => {
  const question = (id: string, title: string, askedAt: string, status: "open" | "settled" = "open") => ({ id, title, askedAt, status });
  const board = [
    question("q-aaaa", "Organizer question: First asked?", "2027-01-14T01:00:00Z"),
    question("q-bbbb", "Mentor question: Second asked?", "2027-01-14T02:00:00Z"),
    question("q-cccc", "Mentor question: Third asked?", "2027-01-14T03:00:00Z"),
    question("q-xxxx", "Which database?", "2027-01-14T04:00:00Z"),
    question("q-eeee", "Mentor question: Not on the page, asked later", "2027-01-14T06:00:00Z"),
    question("q-dddd", "Mentor question: Not on the page, asked earlier", "2027-01-14T05:00:00Z"),
  ];
  const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

  it("follows the page, then appends unlisted mentor and organizer questions in asked order", () => {
    expect(ids(orderMentorQuestions(board, ["q-cccc", "q-aaaa", "q-bbbb"]))).toEqual(["q-cccc", "q-aaaa", "q-bbbb", "q-dddd", "q-eeee"]);
  });

  it("falls back to the prefix match in asked order when there is no page", () => {
    expect(ids(orderMentorQuestions(board, null))).toEqual(["q-aaaa", "q-bbbb", "q-cccc", "q-dddd", "q-eeee"]);
  });

  it("leaves ordinary questions out unless the page lists them, and skips ids that are not on the board", () => {
    expect(ids(orderMentorQuestions(board, ["q-0000", "q-bbbb"]))).not.toContain("q-xxxx");
    expect(ids(orderMentorQuestions(board, ["q-0000", "q-xxxx", "q-bbbb"])).slice(0, 2)).toEqual(["q-xxxx", "q-bbbb"]);
  });

  it("drops settled questions to the bottom, keeping their order", () => {
    const withSettled = board.map((entry) => (entry.id === "q-cccc" || entry.id === "q-dddd" ? { ...entry, status: "settled" as const } : entry));
    expect(ids(orderMentorQuestions(withSettled, ["q-cccc", "q-aaaa", "q-bbbb"]))).toEqual(["q-aaaa", "q-bbbb", "q-eeee", "q-cccc", "q-dddd"]);
  });
});

describe("listStartsOpen", () => {
  it("opens when something is left to ask and folds when nothing is", () => {
    expect(listStartsOpen(2, null)).toBe(true);
    expect(listStartsOpen(0, null)).toBe(false);
  });

  it("keeps the viewer's choice while the count to ask is the same", () => {
    expect(listStartsOpen(0, { open: true, toAsk: 0 })).toBe(true);
    expect(listStartsOpen(3, { open: false, toAsk: 3 })).toBe(false);
  });

  it("drops the choice when the count changes: a new question opens it, the last answer folds it", () => {
    expect(listStartsOpen(1, { open: false, toAsk: 0 })).toBe(true);
    expect(listStartsOpen(0, { open: true, toAsk: 1 })).toBe(false);
  });

  it("ignores a saved value of the wrong shape", () => {
    expect(listStartsOpen(0, { open: "yes", toAsk: 0 })).toBe(false);
    expect(listStartsOpen(0, "open")).toBe(false);
  });
});
