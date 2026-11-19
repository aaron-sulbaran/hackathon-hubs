import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConfig, eventConfigFrom, withConfigDates } from "@/lib/web/event-config";
import { finalDeadline, hackingStart, parsePlaybook } from "@/lib/web/playbook";
import { hubRepo, readToken, snapshotFromFiles } from "@/lib/web/source";

const CONFIG = {
  v: 1,
  event: { name: "Sample Hackathon", slug: "sample-hackathon", timezone: "America/New_York", startsAt: "2027-01-15T20:00:00-05:00", submitBy: "2027-01-17T09:00:00-05:00", location: "Main hall", url: "" },
  hub: { repo: "team/hub", basePath: "", owner: "ada" },
};

const TEXT = JSON.stringify(CONFIG);
const BUILT = { ...CONFIG, event: { ...CONFIG.event, name: "Built Hackathon", timezone: "Europe/Berlin" } };

describe("hub.config.json on the board", () => {
  it("reads a good config from the data", () => {
    expect(eventConfigFrom(TEXT, buildConfig(JSON.stringify(BUILT)))).toMatchObject({ data: { event: { name: "Sample Hackathon" } }, error: null });
  });

  it("uses the deployed config, quietly, when the file is missing", () => {
    expect(eventConfigFrom(null, buildConfig(JSON.stringify(BUILT)))).toMatchObject({ data: { event: { name: "Built Hackathon" } }, error: null });
  });

  it("uses the deployed config and says why when the file is not JSON or does not check out", () => {
    const notJson = eventConfigFrom("{ \"v\": 1,", buildConfig(JSON.stringify(BUILT)));
    expect(notJson.data.event.name).toBe("Built Hackathon");
    expect(notJson.error).toMatch(/hub\.config\.json is not valid JSON/);
    const badZone = eventConfigFrom(JSON.stringify({ event: { timezone: "Not/AZone" } }), buildConfig(JSON.stringify(BUILT)));
    expect(badZone.data.event.timezone).toBe("Europe/Berlin");
    expect(badZone.error).toMatch(/hub\.config\.json: .*time zone/);
  });

  it("falls back to the defaults only when there is no usable build config either", () => {
    expect(buildConfig(undefined).event.name).toBe("Sample Hackathon");
    expect(buildConfig("{broken").event.name).toBe("Sample Hackathon");
  });

  it("travels in the snapshot as written", () => {
    expect(snapshotFromFiles(new Map([["hub.config.json", TEXT]])).configText).toBe(TEXT);
    expect(snapshotFromFiles(new Map([["hub.config.json", "{not json"]])).configText).toBe("{not json");
    expect(snapshotFromFiles(new Map()).configText).toBeNull();
  });

  it("counts down to event.submitBy and starts at event.startsAt when the playbook is empty", () => {
    const { data } = eventConfigFrom(TEXT);
    const agenda = withConfigDates(parsePlaybook("## Deadlines\n\n## Calendar\n"), data);
    expect(finalDeadline(agenda)?.startMs).toBe(Date.parse("2027-01-17T09:00:00-05:00"));
    expect(hackingStart(agenda)?.startMs).toBe(Date.parse("2027-01-15T20:00:00-05:00"));
  });

  it("lets the playbook win when it names its own submission deadline", () => {
    const { data } = eventConfigFrom(TEXT);
    const agenda = withConfigDates(parsePlaybook("## Deadlines\n- 2027-01-17T08:00-05:00 | Submission due | kind: deadline\n"), data);
    expect(agenda.filter((entry) => entry.source === "deadline")).toHaveLength(1);
    expect(finalDeadline(agenda)?.startMs).toBe(Date.parse("2027-01-17T08:00-05:00"));
  });
});

describe("repo and token", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("takes HUB_REPO, then hub.repo, then the repo Vercel built from", () => {
    vi.stubEnv("HUB_REPO", "");
    vi.stubEnv("HUB_CONFIG_REPO", "");
    vi.stubEnv("VERCEL_GIT_REPO_OWNER", "");
    vi.stubEnv("VERCEL_GIT_REPO_SLUG", "");
    expect(hubRepo()).toBeNull();
    vi.stubEnv("VERCEL_GIT_REPO_OWNER", "vercel-owner");
    vi.stubEnv("VERCEL_GIT_REPO_SLUG", "hub");
    expect(hubRepo()).toBe("vercel-owner/hub");
    vi.stubEnv("HUB_CONFIG_REPO", "config-owner/hub");
    expect(hubRepo()).toBe("config-owner/hub");
    vi.stubEnv("HUB_REPO", "env-owner/hub");
    expect(hubRepo()).toBe("env-owner/hub");
  });

  it("reads with the write token when there is no read token", () => {
    vi.stubEnv("HUB_READ_TOKEN", "");
    vi.stubEnv("HUB_WRITE_TOKEN", "write");
    expect(readToken()).toBe("write");
    vi.stubEnv("HUB_READ_TOKEN", "read");
    expect(readToken()).toBe("read");
  });
});
