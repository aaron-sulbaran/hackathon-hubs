import { describe, expect, it } from "vitest";
import { foldEvents } from "@/lib/hub/fold.mjs";
import { makeEvent } from "@/lib/hub/schema.mjs";
import { gateMode, keyMatches, signSession, verifySession } from "@/lib/web/auth";
import { buildWebEvent } from "@/lib/web/event-input";
import { needsYou, filterOf } from "@/lib/web/feed";
import { buildGraph, HUB_NODE, mapLayout, NARROW, shortLabel, WIDE } from "@/lib/web/graph";
import { parseKbPage } from "@/lib/web/kb";
import { createRateLimiter } from "@/lib/web/rate-limit";
import type { Board, HubEvent } from "@/lib/web/types";

const team = { people: [{ id: "ada", name: "Ada Example" }, { id: "grace", name: "Grace Example" }, { id: "linus", name: "Linus Example" }] };
const ids = team.people.map((person) => person.id);
let clock = Date.parse("2027-01-16T10:00:00-05:00");

function ev(input: Parameters<typeof makeEvent>[0]): HubEvent {
  clock += 60_000;
  const made = makeEvent({ ...input, now: clock });
  if (!made.data) throw new Error(made.error ?? "bad event");
  return made.data as HubEvent;
}

const events = [
  ev({ by: "ada", via: "agent", agent: "claude-code", type: "item.add", ref: "t-aaaa", title: "Pick a track", text: "see [[kb/track-acme]] with @grace" }),
  ev({ by: "grace", via: "agent", agent: "cursor", type: "question.ask", ref: "q-bbbb", title: "Which API?", data: { for: "ada", blocking: "t-aaaa" } }),
  ev({ by: "grace", via: "agent", agent: "cursor", type: "decision.propose", ref: "d-cccc", title: "Build for the Acme track", data: { why: "stacks with anything", affects: ["kb/track-acme", "t-aaaa"] } }),
  ev({ by: "ada", via: "agent", agent: "claude-code", type: "gate.add", ref: "g-dddd", title: "Demo works", data: { criteria: ["runs"] } }),
  ev({ by: "ada", via: "agent", agent: "claude-code", type: "gate.propose", ref: "g-dddd", title: "Ready" }),
];
const board = foldEvents(events, team, { now: clock }) as unknown as Board;
const page = (slug: string, markdown: string) => parseKbPage(slug, markdown);
const pages = [
  page("index", "---\ntitle: Knowledge base index\n---\n[[kb/rules]] [[kb/tracks]] [[kb/track-acme]] [[kb/idea-lantern]] [[kb/team]] [[kb/bus-times]]"),
  page("rules", "---\ntitle: Rules to check\nkind: reference\n---\nSee [[kb/tracks]]."),
  page("tracks", "---\ntitle: Tracks overview\n---\n[[kb/track-acme]]"),
  page("track-acme", "---\ntitle: Acme track\n---\nBack to [[kb/tracks]]."),
  page("idea-lantern", '---\ntitle: "Idea: Lantern"\nkind: idea\n---\nFor [[kb/track-acme]].'),
  page("team", "---\ntitle: Team\n---\n@ada @grace @linus"),
  page("sponsor-swag", "---\ntitle: Sponsor swag\n---\n[[kb/tracks]] and [[kb/track-acme]]"),
  page("bus-times", "---\ntitle: Bus times\ngroup: logistics\n---\nNo links."),
];

describe("graph", () => {
  const { nodes, edges } = buildGraph(board, pages);
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const has = (a: string, b: string) => edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

  it("links pages, open work that names a page, and people", () => {
    expect(nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["kb/index", "kb/track-acme", "ada", "grace", "linus", "t-aaaa", "d-cccc"]));
    expect(has("t-aaaa", "kb/track-acme")).toBe(true);
    expect(has("t-aaaa", "grace")).toBe(true);
    expect(has("d-cccc", "kb/track-acme")).toBe(true);
    expect(has("kb/index", "kb/rules")).toBe(true);
  });

  it("leaves off open work that names no page", () => {
    expect(byId["q-bbbb"]).toBeUndefined();
    expect(byId["g-dddd"]).toBeUndefined();
  });

  it("puts every node in one of five groups, the index in none", () => {
    expect(byId["kb/index"]?.group).toBeNull();
    expect(byId["kb/rules"]?.group).toBe("rules");
    expect(byId["kb/track-acme"]?.group).toBe("tracks");
    expect(byId["kb/idea-lantern"]?.group).toBe("ideas");
    expect(byId["kb/bus-times"]?.group).toBe("logistics");
    expect(byId["kb/sponsor-swag"]?.group).toBe("tracks");
    expect(byId.linus?.group).toBe("team");
    expect(byId["t-aaaa"]?.group).toBe("tracks");
  });

  it("names nodes briefly on the map and in full elsewhere", () => {
    expect(byId["kb/idea-lantern"]?.label).toBe("Idea: Lantern");
    expect(byId["kb/idea-lantern"]?.short).toBe("Lantern");
    expect(byId["kb/track-acme"]?.short).toBe("Acme");
    expect(shortLabel("Earlier work (notes only, never code)", "team")).toBe("Earlier work");
    expect(shortLabel("Questions for organizers and sponsors", "rules").length).toBeLessThanOrEqual(22);
  });

  it("lays out the same way every time, inside the frame, the index in the middle", () => {
    for (const frame of [WIDE, NARROW]) {
      const first = mapLayout(nodes, frame);
      expect(mapLayout(nodes, frame)).toEqual(first);
      expect(first.nodes[HUB_NODE]).toMatchObject(frame.hub);
      expect(first.nodes["kb/tracks"]).toMatchObject(frame.centers.tracks);
      expect(Object.keys(first.nodes).sort()).toEqual(nodes.map((node) => node.id).sort());
      for (const point of Object.values(first.nodes)) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(frame.width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(frame.height);
      }
    }
  });
});

describe("needs you", () => {
  it("collects ready gates and questions for the person, not calls on record", () => {
    const needs = needsYou(board, "ada");
    expect("decisions" in needs).toBe(false);
    expect(needs.gates.map((gate) => gate.id)).toEqual(["g-dddd"]);
    expect(needs.questions.map((question) => question.id)).toEqual(["q-bbbb"]);
    expect(needsYou(board, "grace").questions).toEqual([]);
    expect(filterOf("gate.pass")).toBe("decisions");
  });
});

describe("web event input", () => {
  it("builds a web event and mints refs for creating types", () => {
    const built = buildWebEvent({ by: "ada", type: "item.add", title: "New thing" }, ids);
    expect(built.error).toBeNull();
    expect(built.data).toMatchObject({ via: "web", by: "ada", type: "item.add" });
    expect(built.data?.ref).toMatch(/^t-[a-z0-9]{4}$/);
    expect(built.data?.id).toMatch(/^\d{13}-ada-[a-z0-9]{4}$/);
  });

  it("lets a person pass a gate from the web", () => {
    expect(buildWebEvent({ by: "grace", type: "gate.pass", ref: "g-dddd", title: "Passed" }, ids).data?.via).toBe("web");
  });

  it("refuses strangers, agent-only types, and missing refs", () => {
    expect(buildWebEvent({ by: "mallory", type: "comment", ref: "t-aaaa", title: "hi" }, ids).error).toMatch(/not on the team/);
    expect(buildWebEvent({ by: "ada", type: "session.start", title: "x" }, ids).error).toBeTruthy();
    expect(buildWebEvent({ by: "ada", type: "comment", title: "x" }, ids).error).toMatch(/needs a ref/);
    expect(buildWebEvent({ by: "ada", type: "comment", ref: "t-aaaa", title: "" }, ids).error).toBeTruthy();
  });

  it("the folded board accepts what it builds", () => {
    const pass = buildWebEvent({ by: "grace", type: "gate.pass", ref: "g-dddd", title: "Passed" }, ids).data!;
    const after = foldEvents([...events, pass], team) as unknown as Board;
    expect(after.gates[0]?.status).toBe("passed");
  });
});

describe("auth", () => {
  it("signs and verifies the unlock cookie", async () => {
    const cookie = await signSession("s3cret");
    expect(await verifySession(cookie, "s3cret")).toBe(true);
    expect(await verifySession(cookie, "other")).toBe(false);
    expect(await verifySession(undefined, "s3cret")).toBe(false);
    expect(keyMatches("s3cret", "s3cret")).toBe(true);
    expect(keyMatches("s3cre", "s3cret")).toBe(false);
  });

  it("is open only in development without a key", () => {
    expect(gateMode(undefined, "development")).toBe("open");
    expect(gateMode(undefined, "production")).toBe("closed");
    expect(gateMode("k", "production")).toBe("locked");
  });
});

describe("rate limit", () => {
  it("trips past the window maximum and recovers", () => {
    const limited = createRateLimiter(2, 1000);
    expect([limited("a", 0), limited("a", 1), limited("a", 2)]).toEqual([false, false, true]);
    expect(limited("a", 5000)).toBe(false);
    expect(limited("b", 2)).toBe(false);
  });
});
