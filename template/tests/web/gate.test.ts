import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "@/lib/web/auth";
import { realFileInside } from "@/lib/web/disk-path";
import { sessionAllows } from "@/lib/web/gate";
import { createRateLimiter } from "@/lib/web/rate-limit";
import { NO_ROSTER, ROSTER_CLOCK_SKEW_MS, ROSTER_MAX_AGE_MS, STALE_ROSTER, rosterIds } from "@/lib/web/roster";
import { buildWebEvent } from "@/lib/web/event-input";
import { buildClockEvent } from "@/lib/web/pitch-clock";

const KEY = "test-key-not-a-real-one";
const ORIGIN = "https://board.example";

function request(pathname: string, { cookie, basePath, method = "GET" }: { cookie?: string; basePath?: string; method?: string } = {}): NextRequest {
  const headers = new Headers({ "content-type": "application/json", "sec-fetch-site": "same-origin" });
  if (cookie) headers.set("cookie", `${SESSION_COOKIE}=${cookie}`);
  return new NextRequest(`${ORIGIN}${basePath ?? ""}${pathname}`, { method, headers, body: method === "POST" ? "{}" : undefined, nextConfig: { basePath } });
}

async function loadProxy(basePath: string) {
  vi.resetModules();
  vi.stubEnv("HUB_BASE_PATH", basePath);
  return (await import("@/proxy")).proxy;
}

afterEach(() => vi.unstubAllEnvs());

describe("sessions expire on the server", () => {
  const now = Date.parse("2027-01-16T12:00:00Z");

  it("accepts a fresh cookie and refuses it after 14 days, whatever the browser keeps", async () => {
    const cookie = await signSession(KEY, now);
    expect(await verifySession(cookie, KEY, now + 1000)).toBe(true);
    expect(await verifySession(cookie, KEY, now + SESSION_MAX_AGE * 1000 - 1)).toBe(true);
    expect(await verifySession(cookie, KEY, now + SESSION_MAX_AGE * 1000 + 1)).toBe(false);
  });

  it("refuses an expiry someone moved, a cookie from another key, and the old timeless format", async () => {
    const cookie = await signSession(KEY, now);
    const [expiry, mac] = cookie.split(".");
    expect(await verifySession(`${Number(expiry) + 86_400_000}.${mac}`, KEY, now)).toBe(false);
    expect(await verifySession(cookie, "another-key", now)).toBe(false);
    expect(await verifySession(mac, KEY, now)).toBe(false);
    expect(await verifySession("", KEY, now)).toBe(false);
  });

  it("refuses a signed expiry further out than one session, so a leaked key cannot mint a forever cookie quietly", async () => {
    const far = await signSession(KEY, now + 365 * 86_400_000);
    expect(await verifySession(far, KEY, now)).toBe(false);
  });
});

describe("the server-side gate (layout and route handlers)", () => {
  it("follows the same modes as the proxy", async () => {
    const cookie = await signSession(KEY);
    expect(await sessionAllows(undefined, { NODE_ENV: "development" })).toBe(true);
    expect(await sessionAllows(cookie, { NODE_ENV: "production" })).toBe(false);
    expect(await sessionAllows(undefined, { HUB_KEY: KEY, NODE_ENV: "production" })).toBe(false);
    expect(await sessionAllows(cookie, { HUB_KEY: KEY, NODE_ENV: "production" })).toBe(true);
  });

  it("route handlers answer a bare 404 without the cookie, before touching the hub", async () => {
    vi.stubEnv("HUB_KEY", KEY);
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { POST: postEvent } = await import("@/app/api/event/route");
    const { GET: getClock, POST: postClock } = await import("@/app/api/clock/route");
    const { GET: getScript } = await import("@/app/script/route");
    for (const response of [await postEvent(request("/api/event", { method: "POST" })), await getClock(request("/api/clock")), await postClock(request("/api/clock", { method: "POST" })), await getScript(request("/script"))]) {
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    }
  });
});

describe("the proxy covers every path", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "production"));

  it("matches everything, assets included", async () => {
    vi.resetModules();
    const { config } = await import("@/proxy");
    expect(config.matcher).toEqual(["/", "/:path*"]);
  });

  it("answers 404 to everything in production with no HUB_KEY, the unlock link and the icon included", async () => {
    vi.stubEnv("HUB_KEY", "");
    const proxy = await loadProxy("");
    for (const pathname of ["/", "/unlock?key=x", "/icon.svg", "/favicon.ico", "/_next/static/chunks/main.js", "/brand/x.png", "/no-such-page"]) {
      expect((await proxy(request(pathname))).status).toBe(404);
    }
  });

  it("hides assets and unknown paths from a visitor without the cookie", async () => {
    vi.stubEnv("HUB_KEY", KEY);
    const proxy = await loadProxy("");
    for (const pathname of ["/icon.svg", "/favicon.ico", "/_next/static/chunks/main.js", "/no-such-page"]) {
      const response = await proxy(request(pathname));
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    }
  });

  it("refuses an expired cookie", async () => {
    vi.stubEnv("HUB_KEY", KEY);
    const proxy = await loadProxy("");
    const old = await signSession(KEY, Date.now() - (SESSION_MAX_AGE + 60) * 1000);
    expect((await proxy(request("/board", { cookie: old }))).status).toBe(404);
  });

  it("fails closed when the request's base path is not the one it was built for, even with a good cookie or in development", async () => {
    vi.stubEnv("HUB_KEY", KEY);
    const cookie = await signSession(KEY);
    const builtForHub = await loadProxy("/hub");
    expect((await builtForHub(request("/board", { cookie, basePath: "/other" }))).status).toBe(404);
    expect((await builtForHub(request("/board", { cookie }))).status).toBe(404);
    const builtForRoot = await loadProxy("");
    expect((await builtForRoot(request("/board", { cookie, basePath: "/hub" }))).status).toBe(404);
    vi.stubEnv("HUB_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    expect((await builtForRoot(request("/board", { basePath: "/hub" }))).status).toBe(404);
  });
});

describe("writes need the team list", () => {
  it("refuses every write when the roster is empty, instead of skipping the check", () => {
    expect(buildWebEvent({ by: "ada", type: "comment", ref: "t-abcd", title: "hi" }, []).error).toBe(NO_ROSTER);
    expect(buildClockEvent({ by: "ada", state: { action: "start", running: true, base: 0, current: 0, partStart: 0, splits: [], atMs: Date.now() } }, []).error).toBe(NO_ROSTER);
  });

  it("reads the roster from a snapshot, and refuses a failed read or an empty list", () => {
    const readAt = Date.now();
    expect(rosterIds({ data: { team: { people: [{ id: "ada" }, { id: "grace" }, { name: "no id" }] }, readAt }, error: null })).toEqual({ data: ["ada", "grace"], error: null });
    expect(rosterIds({ data: { team: { people: [] }, readAt }, error: null }).error).toBe(NO_ROSTER);
    expect(rosterIds({ data: { team: null, readAt }, error: null }).error).toBe(NO_ROSTER);
    expect(rosterIds({ data: null, error: "GitHub answered 503." }).error).toBe(NO_ROSTER);
  });

  it("counts a copy with a missing, NaN, or future read time as stale", () => {
    const now = 1_800_000_000_000;
    const team = { people: [{ id: "ada" }] };
    expect(rosterIds({ data: { team }, error: null }, now)).toEqual({ data: null, error: STALE_ROSTER });
    expect(rosterIds({ data: { team, readAt: Number.NaN }, error: null }, now)).toEqual({ data: null, error: STALE_ROSTER });
    expect(rosterIds({ data: { team, readAt: Number.POSITIVE_INFINITY }, error: null }, now)).toEqual({ data: null, error: STALE_ROSTER });
    expect(rosterIds({ data: { team, readAt: now + 24 * 60 * 60 * 1000 }, error: null }, now)).toEqual({ data: null, error: STALE_ROSTER });
    expect(rosterIds({ data: { team, readAt: now + ROSTER_CLOCK_SKEW_MS + 1 }, error: null }, now)).toEqual({ data: null, error: STALE_ROSTER });
    expect(rosterIds({ data: { team, readAt: now + ROSTER_CLOCK_SKEW_MS }, error: null }, now)).toEqual({ data: ["ada"], error: null });
    expect(rosterIds({ data: { team, readAt: now + 1_000 }, error: null }, now)).toEqual({ data: ["ada"], error: null });
  });

  it("stops trusting a roster copy older than the bound, as when refreshes keep failing", () => {
    const now = 1_800_000_000_000;
    const team = { people: [{ id: "ada" }] };
    expect(rosterIds({ data: { team, readAt: now - 30_000 }, error: null }, now)).toEqual({ data: ["ada"], error: null });
    expect(rosterIds({ data: { team, readAt: now - ROSTER_MAX_AGE_MS }, error: null }, now).data).toEqual(["ada"]);
    expect(rosterIds({ data: { team, readAt: now - ROSTER_MAX_AGE_MS - 1 }, error: null }, now)).toEqual({ data: null, error: STALE_ROSTER });
  });
});

describe("the rate limiter stays small", () => {
  it("still trips past the limit", () => {
    const limited = createRateLimiter(2, 60_000);
    expect([limited("a", 0), limited("a", 1), limited("a", 2), limited("a", 3)]).toEqual([false, false, true, true]);
    expect(limited("a", 61_000)).toBe(false);
  });

  it("does not grow while an address keeps hammering, and forgets quiet addresses", () => {
    const limited = createRateLimiter(2, 60_000, 100);
    for (let i = 0; i < 1000; i++) limited("a", i);
    for (let i = 0; i < 500; i++) limited(`addr-${i}`, 1000);
    expect(limited.size()).toBeLessThanOrEqual(101);
    limited("late", 200_000);
    expect(limited.size()).toBe(1);
  });
});

describe("design images on disk", () => {
  it("serves a real file under the allowed folder and refuses a symlink that leads out", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "hub-img-"));
    mkdirSync(path.join(root, "design", "review"), { recursive: true });
    writeFileSync(path.join(root, "design", "review", "a.png"), "png");
    writeFileSync(path.join(root, "team.json"), "{}");
    symlinkSync(path.join(root, "team.json"), path.join(root, "design", "review", "b.png"));
    expect(await realFileInside(root, "design/review", "design/review/a.png")).toMatch(/a\.png$/);
    expect(await realFileInside(root, "design/review", "design/review/b.png")).toBeNull();
    expect(await realFileInside(root, "design/review", "design/review/missing.png")).toBeNull();
  });

  it("refuses an allowed folder that is itself a link outside the hub", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "hub-img-"));
    const root = path.join(base, "hub");
    const outside = path.join(base, "outside");
    mkdirSync(path.join(root, "design"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(outside, "secret.png"), "png");
    symlinkSync(outside, path.join(root, "design", "review"));
    expect(await realFileInside(root, "design/review", "design/review/secret.png")).toBeNull();
  });

  it("does not take a sibling folder sharing a prefix as inside", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "hub-img-"));
    mkdirSync(path.join(root, "design", "review"), { recursive: true });
    mkdirSync(path.join(root, "design", "review-evil"), { recursive: true });
    writeFileSync(path.join(root, "design", "review-evil", "x.png"), "png");
    symlinkSync(path.join(root, "design", "review-evil", "x.png"), path.join(root, "design", "review", "x.png"));
    expect(await realFileInside(root, "design/review", "design/review/x.png")).toBeNull();
    expect(await realFileInside(root, "design/review", "design/review-evil/x.png")).toBeNull();
  });

  it("allows a link that stays inside the allowed folder, and a hub root reached through a link", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "hub-img-"));
    const root = path.join(base, "hub");
    mkdirSync(path.join(root, "design", "review", "old"), { recursive: true });
    writeFileSync(path.join(root, "design", "review", "old", "a.png"), "png");
    symlinkSync(path.join(root, "design", "review", "old", "a.png"), path.join(root, "design", "review", "c.png"));
    expect(await realFileInside(root, "design/review", "design/review/c.png")).toMatch(/old[\\/]a\.png$/);
    symlinkSync(root, path.join(base, "hub-link"));
    expect(await realFileInside(path.join(base, "hub-link"), "design/review", "design/review/c.png")).toMatch(/old[\\/]a\.png$/);
  });

  it("returns null without throwing for a missing file, folder, or root", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "hub-img-"));
    await expect(realFileInside(root, "design/review", "design/review/none.png")).resolves.toBeNull();
    await expect(realFileInside(path.join(root, "nope"), "design/review", "design/review/none.png")).resolves.toBeNull();
  });
});
