import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// next.config.ts runs at `next build` and again at `next start`, in the app
// folder. Load it the same way, in a scratch folder, with Node's own
// TypeScript support, and look at what it decides.
const CONFIG_MODULE = path.resolve(import.meta.dirname, "../../next.config.ts");

function loadIn(configText: string | null, env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-next-config-"));
  if (configText !== null) writeFileSync(path.join(dir, "hub.config.json"), configText);
  const script = `import(${JSON.stringify(CONFIG_MODULE)}).then((m) => m.default.headers().then((headers) => console.log(JSON.stringify({ basePath: m.default.basePath ?? "", env: m.default.env, headers }))), (e) => { console.log(JSON.stringify({ error: e.message })); })`;
  const result = spawnSync(process.execPath, ["-e", script], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
  return JSON.parse(result.stdout.trim().split("\n").pop() ?? "{}") as {
    basePath?: string;
    env?: Record<string, string>;
    headers?: { source: string; basePath?: boolean; headers: { key: string; value: string }[] }[];
    error?: string;
  };
}

const good = (hub: Record<string, string>, event: Record<string, string> = {}) => JSON.stringify({ v: 1, event: { name: "Sample Hackathon", slug: "sample-hackathon", timezone: "Europe/Berlin", ...event }, hub: { repo: "", basePath: "", owner: "ada", ...hub } });

describe("next.config.ts", () => {
  it("builds with the defaults when the hub has no config yet", () => {
    expect(loadIn(null)).toMatchObject({ basePath: "", env: { HUB_BASE_PATH: "", HUB_TIME_ZONE: "America/New_York" } });
  });

  it("takes the base path and zone from this folder's config", () => {
    expect(loadIn(good({ basePath: "/hub" }))).toMatchObject({ basePath: "/hub", env: { HUB_BASE_PATH: "/hub", HUB_TIME_ZONE: "Europe/Berlin" } });
  });

  it("stops with the reason when the config is present but broken, instead of building with defaults", () => {
    expect(loadIn('{ "v": 1, ').error).toMatch(/Cannot build the board: hub\.config\.json is not valid JSON/);
    expect(loadIn(good({ owner: "Ada" })).error).toMatch(/Cannot build the board: .*hub\.owner/);
  });

  it("sends no-referrer and noindex on every path, inside the base path or not", () => {
    const [rule] = loadIn(good({ basePath: "/hub" })).headers ?? [];
    expect(rule).toMatchObject({ source: "/:path*", basePath: false });
    expect(rule?.headers).toEqual(expect.arrayContaining([{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }]));
  });

  it("never takes the base path from HUB_LOCAL_DIR", () => {
    const other = mkdtempSync(path.join(tmpdir(), "hub-other-"));
    writeFileSync(path.join(other, "hub.config.json"), good({ basePath: "/elsewhere" }));
    expect(loadIn(good({}), { HUB_LOCAL_DIR: other })).toMatchObject({ basePath: "" });
  });
});
