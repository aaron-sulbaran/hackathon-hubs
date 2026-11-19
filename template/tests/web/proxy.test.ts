import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, signSession } from "@/lib/web/auth";
import { joinBasePath } from "@/lib/web/base-path";

// The gate is tested twice: standalone (hub.basePath "", the default) and
// mounted under a parent site (hub.basePath "/hub"). next.config.ts hands the
// base path to the app as HUB_BASE_PATH, read when the module loads, so each
// run loads fresh copies of the proxy and the unlock route.
// Behind a parent site's rewrite, the host on the request is this project's
// own origin. Nothing the gate sends back may name it.
const DEPLOY_ORIGIN = "https://hub-zone.example.vercel.app";
const KEY = "test-key-not-a-real-one";

async function loadGate(basePath: string) {
  vi.resetModules();
  vi.stubEnv("HUB_BASE_PATH", basePath);
  const { GET: unlock } = await import("@/app/unlock/route");
  const { proxy } = await import("@/proxy");
  return { unlock, proxy };
}

for (const basePath of ["", "/hub"]) {
  const label = basePath || "the root";
  const appRoot = basePath || "/";

  function request(path: string, cookie?: string): NextRequest {
    const headers = new Headers({ "x-forwarded-host": "public.example" });
    if (cookie) headers.set("cookie", `${SESSION_COOKIE}=${cookie}`);
    return new NextRequest(`${DEPLOY_ORIGIN}${basePath}${path}`, { headers, nextConfig: { basePath: basePath || undefined } });
  }

  describe(`the unlock gate at ${label}`, () => {
    let gate: Awaited<ReturnType<typeof loadGate>>;
    beforeEach(async () => {
      gate = await loadGate(basePath);
      vi.stubEnv("HUB_KEY", KEY);
      vi.stubEnv("NODE_ENV", "production");
    });
    afterEach(() => vi.unstubAllEnvs());

    it("redirects a good unlock link with a path-only Location, so the visitor stays on the public host", async () => {
      const response = await gate.unlock(request(`/unlock?key=${KEY}`));
      expect(response.status).toBe(307);
      const location = response.headers.get("location");
      expect(location).toBe(appRoot);
      expect(location).not.toMatch(/^[a-z]+:|^\/\//i);
      expect(location).not.toContain("vercel.app");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    });

    it("scopes the cookie to the app and keeps it HttpOnly, Secure, SameSite=Lax", async () => {
      const response = await gate.unlock(request(`/unlock?key=${KEY}`));
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toContain(`${SESSION_COOKIE}=`);
      expect(cookie).toMatch(new RegExp(`; Path=${appRoot}(;|$)`));
      expect(cookie).toMatch(/; HttpOnly/i);
      expect(cookie).toMatch(/; Secure/i);
      expect(cookie).toMatch(/; SameSite=lax/i);
    });

    it("answers a wrong key with a bare 404 and no cookie", async () => {
      for (const path of ["/unlock?key=wrong", "/unlock"]) {
        const response = await gate.unlock(request(path));
        expect(response.status).toBe(404);
        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      }
    });

    it("hides every other path without the cookie: a bare 404, never a redirect", async () => {
      for (const path of ["", "/board", "/api/event", "/unlocked", "/design", "/design/img/review/a.png"]) {
        const response = await gate.proxy(request(path));
        expect(response.status).toBe(404);
        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      }
    });

    it("serves nothing, the unlock link included, in production with no key", async () => {
      vi.stubEnv("HUB_KEY", "");
      expect((await gate.proxy(request("/unlock?key="))).status).toBe(404);
      expect((await gate.unlock(request("/unlock?key="))).status).toBe(404);
    });

    it("lets a valid cookie through", async () => {
      const response = await gate.proxy(request("/board", await signSession(KEY)));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });

    if (basePath) {
      it("routes the home page again under its own path, so a refresh through the parent site resolves", async () => {
        const response = await gate.proxy(request("", await signSession(KEY)));
        expect(response.status).toBe(200);
        expect(new URL(response.headers.get("x-middleware-rewrite") ?? "").pathname).toBe(basePath);
        expect(response.headers.get("x-middleware-next")).toBeNull();
      });
    } else {
      it("passes the home page straight through when there is no parent site", async () => {
        const response = await gate.proxy(request("/", await signSession(KEY)));
        expect(response.status).toBe(200);
        expect(response.headers.get("x-middleware-rewrite")).toBeNull();
        expect(response.headers.get("x-middleware-next")).toBe("1");
      });
    }
  });
}

describe("joinBasePath", () => {
  it("prefixes app paths under a base path", () => {
    expect(joinBasePath("/hub", "/")).toBe("/hub");
    expect(joinBasePath("/hub", "/board?item=t-a3f9")).toBe("/hub/board?item=t-a3f9");
    expect(joinBasePath("/hub", "/#s-ab12")).toBe("/hub#s-ab12");
    expect(joinBasePath("/hub", "/brand/x.png")).toBe("/hub/brand/x.png");
  });

  it("leaves app paths alone with no base path, and never returns an empty path", () => {
    expect(joinBasePath("", "/")).toBe("/");
    expect(joinBasePath("", "")).toBe("/");
    expect(joinBasePath("", "/board?item=t-a3f9")).toBe("/board?item=t-a3f9");
    expect(joinBasePath("", "/#s-ab12")).toBe("/#s-ab12");
    expect(joinBasePath("", "board")).toBe("/board");
  });
});
