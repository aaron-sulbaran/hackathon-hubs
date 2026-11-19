import { describe, expect, it } from "vitest";
import { withoutWithdrawn } from "@/lib/web/withdrawn";

describe("withoutWithdrawn", () => {
  const hiddenRef = "q-slip";
  const hiddenEvent = "1800000000000-ada-slip";
  const refs = new Set([hiddenRef]);
  const ids = new Set([hiddenEvent]);

  it("drops events about a withdrawn object and withdrawn events by id", () => {
    const entries = [
      { file: "a.json", event: { id: "e1", type: "question.ask", ref: hiddenRef } },
      { file: "b.json", event: { id: "e2", type: "question.settle", ref: hiddenRef } },
      { file: "c.json", event: { id: hiddenEvent, type: "comment", ref: "d-aaaa" } },
      { file: "d.json", event: { id: "e4", type: "comment", ref: "d-aaaa" } },
    ];
    expect(withoutWithdrawn(entries, refs, ids).map((entry) => entry.file)).toEqual(["d.json"]);
    expect(withoutWithdrawn(entries)).toHaveLength(4);
  });

  it("keeps unreadable entries so the board still reports them", () => {
    const entries = [{ file: "bad.json", error: "unreadable JSON" }, { file: "null.json", event: null }];
    expect(withoutWithdrawn(entries)).toEqual(entries);
  });
});
