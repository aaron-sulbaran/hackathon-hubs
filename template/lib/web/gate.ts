import { gateMode, SESSION_COOKIE, verifySession } from "./auth";

// The unlock gate, checked twice. proxy.ts answers every request first; the
// gated layout (app/(hub)/layout.tsx) and every route handler that serves
// team data check again here. The second check is what keeps the board
// closed if the proxy ever does not run, for example when a self-hosted
// `next start` is given a base path that differs from the build's.

/** Whether a request carrying this unlock cookie value may see the board. */
export async function sessionAllows(cookie: string | undefined, env: { HUB_KEY?: string; NODE_ENV?: string } = process.env): Promise<boolean> {
  const secret = env.HUB_KEY;
  const mode = gateMode(secret, env.NODE_ENV);
  if (mode === "open") return true;
  if (mode === "closed") return false;
  return verifySession(cookie, secret);
}

/** The same check for a route handler's request. */
export function requestAllowed(request: { cookies: { get(name: string): { value: string } | undefined } }): Promise<boolean> {
  return sessionAllows(request.cookies.get(SESSION_COOKIE)?.value);
}

/** The bare 404 every refused request gets: it names nothing, not even a host. */
export function hiddenResponse(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
