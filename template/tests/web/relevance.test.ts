import { describe, expect, it } from "vitest";
import { nextFor } from "@/lib/web/next-up";
import { byRelevance, isLongPastDue } from "@/lib/web/relevance";
import type { Board, Item, Question } from "@/lib/web/types";

// A Saturday, 4:20 PM in the default event zone (America/New_York).
const NOW = Date.parse("2027-01-16T16:20:00-05:00");

function item(id: string, fields: Partial<Item> = {}): Item {
  return {
    id,
    title: id,
    text: "",
    lane: "up_next",
    owner: null,
    status: null,
    due: null,
    area: null,
    why: null,
    needs: null,
    blocker: null,
    links: [],
    createdAt: "2027-01-16T12:00:00.000Z",
    updatedAt: "2027-01-16T12:00:00.000Z",
    createdBy: "ada",
    notes: [],
    comments: [],
    history: [],
    ...fields,
  } as Item;
}

function question(id: string, fields: Partial<Question> = {}): Question {
  return {
    id,
    title: id,
    text: "",
    for: "team",
    blocking: null,
    status: "open",
    askedBy: "ada",
    askedAt: "2027-01-16T12:00:00.000Z",
    answers: [],
    settled: null,
    answer: null,
    comments: [],
    ...fields,
  } as Question;
}

function board(items: Item[], questions: Question[] = []): Board {
  const people = ["ada", "grace", "linus"].map((id) => ({ id, name: `${id.charAt(0).toUpperCase()}${id.slice(1)} Test` }));
  return { people, items, questions, decisions: [], gates: [] } as unknown as Board;
}

const answer = (by: string) => ({ by, title: "done" }) as unknown as Question["answers"][number];

describe("byRelevance", () => {
  it("puts what is due soonest on top, then undated work, then work long past due", () => {
    const items = [
      item("checkin", { due: "2027-01-16T10:30-05:00" }),
      item("undated", { updatedAt: "2027-01-16T20:00:00.000Z" }),
      item("ui", { due: "2027-01-16T22:00-05:00" }),
      item("api", { due: "2027-01-16T18:00-05:00" }),
      item("schema", { due: "2027-01-16T15:45-05:00" }),
    ];
    expect(items.sort(byRelevance(NOW)).map((entry) => entry.id)).toEqual(["schema", "api", "ui", "undated", "checkin"]);
  });

  it("orders undated work newest first", () => {
    const items = [item("old", { updatedAt: "2027-01-16T12:00:00.000Z" }), item("new", { updatedAt: "2027-01-16T20:00:00.000Z" })];
    expect(items.sort(byRelevance(NOW)).map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  it("calls work long past due only after two hours", () => {
    expect(isLongPastDue("2027-01-16T15:45-05:00", NOW)).toBe(false);
    expect(isLongPastDue("2027-01-16T10:30-05:00", NOW)).toBe(true);
    expect(isLongPastDue(null, NOW)).toBe(false);
  });
});

describe("nextFor", () => {
  it("skips unclaimed work long past due", () => {
    const hub = board([item("checkin", { title: "Check-in desk", due: "2027-01-16T10:30-05:00" }), item("api", { title: "API lane", due: "2027-01-16T18:00-05:00" })]);
    expect(nextFor(hub, "grace", [], NOW).title).toBe("API lane");
  });

  it("skips a question asked of you that you already answered", () => {
    const hub = board([item("api", { title: "API lane", due: "2027-01-16T18:00-05:00" })], [question("q-done", { title: "Ada: invite the team", for: "ada", answers: [answer("ada")] })]);
    expect(nextFor(hub, "ada", [], NOW).title).toBe("API lane");
  });

  it("still leads with a question asked of you that you have not answered", () => {
    const hub = board([item("api", { due: "2027-01-16T18:00-05:00" })], [question("q-open", { title: "Ada: pick a track", for: "ada", answers: [answer("grace")] })]);
    expect(nextFor(hub, "ada", [], NOW)).toMatchObject({ title: "Pick a track", why: "asked of you" });
  });

  it("offers your own queued work by due time", () => {
    const hub = board([item("later", { owner: "linus", title: "Later", due: "2027-01-16T21:00-05:00" }), item("sooner", { owner: "linus", title: "Sooner", due: "2027-01-16T18:00-05:00" })]);
    expect(nextFor(hub, "linus", [], NOW).title).toBe("Sooner");
  });
});

describe("an item tagged now", () => {
  const demo = () => item("t-demo", { title: "Do the demo", area: "now", lane: "up_next" });

  it("is everyone's next step, ahead of questions and their own work", () => {
    const hub = board(
      [demo(), item("mine", { owner: "grace", lane: "in_flight", title: "Grace's work", due: "2027-01-16T17:00-05:00" })],
      [question("q-team", { title: "A team question", for: "team" }), question("q-grace", { title: "Grace: a question", for: "grace" })],
    );
    for (const id of ["ada", "grace", "linus"]) expect(nextFor(hub, id, [], NOW)).toMatchObject({ title: "Do the demo", href: "/board?item=t-demo", why: "the whole team, now" });
  });

  it("stops leading once it is done", () => {
    const hub = board([{ ...demo(), lane: "done" }, item("api", { title: "API lane", due: "2027-01-16T18:00-05:00" })]);
    expect(nextFor(hub, "linus", [], NOW).title).toBe("API lane");
  });

  it("sorts first in its lane", () => {
    const items = [item("soon", { due: "2027-01-16T16:30-05:00" }), demo(), item("undated", { updatedAt: "2027-01-16T21:00:00.000Z" })];
    expect(items.sort(byRelevance(NOW)).map((entry) => entry.id)).toEqual(["t-demo", "soon", "undated"]);
  });
});
