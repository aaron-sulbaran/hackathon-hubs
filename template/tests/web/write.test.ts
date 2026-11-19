import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { snapshotFromFiles } from "@/lib/web/source";
import { writeToGitHub } from "@/lib/web/write";
import type { HubEvent } from "@/lib/web/types";

const event: HubEvent = { v: 1, id: "1799902800000-ada-k3x9", at: "2027-01-14T05:00:00.000Z", by: "ada", via: "web", type: "comment", ref: "t-a3f9", title: "hi", data: {} };

describe("writeToGitHub", () => {
  beforeEach(() => {
    process.env.HUB_REPO = "team/hub";
    process.env.HUB_WRITE_TOKEN = "test-token";
  });
  afterEach(() => {
    delete process.env.HUB_REPO;
    delete process.env.HUB_WRITE_TOKEN;
  });

  it("retries a 409 and writes one new file under the UTC date", async () => {
    const calls: string[] = [];
    const statuses = [409, 502, 201];
    const fake = (async (url: string) => {
      calls.push(url);
      const status = statuses.shift() ?? 201;
      return new Response("{}", { status });
    }) as unknown as typeof fetch;
    const result = await writeToGitHub(event, fake, 0);
    expect(result).toEqual({ data: "events/2027-01-14/1799902800000-ada-k3x9.json", error: null });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe("https://api.github.com/repos/team/hub/contents/events/2027-01-14/1799902800000-ada-k3x9.json");
  });

  it("does not retry a permission error and says which token", async () => {
    let count = 0;
    const fake = (async () => {
      count += 1;
      return new Response("{}", { status: 403 });
    }) as unknown as typeof fetch;
    const result = await writeToGitHub(event, fake, 0);
    expect(count).toBe(1);
    expect(result.error).toMatch(/HUB_WRITE_TOKEN/);
  });
});

describe("snapshotFromFiles", () => {
  it("sorts files into events, kb, and team, keeping unreadable events as rejects", () => {
    const snapshot = snapshotFromFiles(
      new Map([
        ["team.json", '{"people":[{"id":"ada"}]}'],
        ["kb/prompt.md", "# Prompt"],
        ["events/2027-01-14/a.json", '{"v":1}'],
        ["events/2027-01-14/b.json", "{broken"],
      ]),
    );
    expect(snapshot.team).toEqual({ people: [{ id: "ada" }] });
    expect(Object.keys(snapshot.kb)).toEqual(["kb/prompt.md"]);
    expect(snapshot.events[0]).toEqual({ file: "events/2027-01-14/a.json", event: { v: 1 } });
    expect(snapshot.events[1]?.error).toMatch(/unreadable/);
  });
});
