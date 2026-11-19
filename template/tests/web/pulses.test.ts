import { describe, expect, it } from "vitest";
import { foldEvents } from "@/lib/hub/fold.mjs";
import { makeEvent } from "@/lib/hub/schema.mjs";
import { latestPulses, overlapsOf, safePrUrl, topFolders } from "@/lib/web/pulses";
import type { Board } from "@/lib/web/types";

const team = { people: [{ id: "ada", name: "Ada Example" }, { id: "grace", name: "Grace Example" }] };
const t0 = Date.parse("2027-01-14T10:00:00-05:00");

function pulse(minutes: number, by: string, data: Record<string, unknown>) {
  const made = makeEvent({ by, via: "agent", agent: "test", type: "pulse", title: "pulse", data, now: t0 + minutes * 60_000 });
  if (!made.data) throw new Error(made.error ?? "bad event");
  return made.data;
}

describe("pulses on the board", () => {
  const board = foldEvents(
    [
      pulse(0, "grace", { repo: "proj", branch: "grace/old", files: ["a.ts"] }),
      pulse(5, "grace", { repo: "proj", branch: "grace/search-filters", pushed: true, files: ["app/page.tsx"], pr: { number: 3, url: "https://github.com/o/r/pull/3" } }),
      pulse(6, "ada", { repo: "proj", branch: "ada/home", files: ["app/page.tsx", "lib/x.ts"] }),
    ],
    team,
    { now: t0 + 10 * 60_000 },
  ) as unknown as Board;

  it("keeps the latest pulse per person and leaves pulses out of the feed", () => {
    expect(board.activity).toHaveLength(0);
    expect(latestPulses(board).map((entry) => [entry.by, entry.branch])).toEqual([
      ["ada", "ada/home"],
      ["grace", "grace/search-filters"],
    ]);
    expect(overlapsOf(board)).toEqual([{ repo: "proj", file: "app/page.tsx", people: ["ada", "grace"] }]);
  });

  it("drops malformed pulses instead of throwing, and links only GitHub PR urls", () => {
    expect(latestPulses({ ...board, pulses: [{ by: 3 }, null] })).toEqual([]);
    expect(safePrUrl("https://github.com/o/r/pull/3")).toBe("https://github.com/o/r/pull/3");
    expect(safePrUrl("javascript:alert(1)")).toBeNull();
    expect(topFolders(["app/search/a.tsx", "app/search/b.tsx", "lib/query.ts"])).toEqual(["app/search", "lib"]);
  });
});
