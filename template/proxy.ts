import { NextResponse, type NextRequest } from "next/server";
import { gateMode, SESSION_COOKIE, verifySession } from "@/lib/web/auth";
import { BASE_PATH } from "@/lib/web/base-path";
import { hiddenResponse } from "@/lib/web/gate";

// Every request sits behind the unlock link: pages, the write API, the icon,
// and Next's own assets. The unlock route (app/unlock/route.ts) checks the key
// and mints the cookie; anything else without a valid cookie gets a bare 404
// so the URL says nothing about what lives here. Production with no HUB_KEY
// answers 404 to everything, the unlock link included. This never redirects,
// so it never names a host. request.nextUrl.pathname has the base path
// already removed. The gated layout and the route handlers check the cookie
// again (lib/web/gate.ts), so the board stays closed even if this does not run.

export async function proxy(request: NextRequest) {
  const secret = process.env.HUB_KEY;
  const mode = gateMode(secret, process.env.NODE_ENV);
  if (mode === "closed") return hide();
  // A request routed under a different base path than this build's means the
  // build and the running config disagree: refuse rather than guess.
  if ((request.nextUrl.basePath ?? "") !== BASE_PATH) return hide();
  if (mode === "open") return NextResponse.next();

  if (request.nextUrl.pathname === "/unlock") return NextResponse.next();
  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret)) return rootToItself(request);
  return hide();
}

// Only for a board mounted under a parent site's path (hub.basePath set, see
// docs/deploy.md). The parent's rewrite adds Next's .rsc suffix to its target,
// so a refresh of the home page arrives as <basePath>.rsc, outside the base
// path (deeper pages arrive as <basePath>/board.rsc and resolve). Next strips
// the suffix before this runs, but routing afterwards still looks for
// <basePath>.rsc, finds nothing, and the browser falls back to a full page
// load: the home page reloaded every 20 seconds. Rewriting the root to itself
// sends the request back through routing under the real home path. A
// standalone board has no base path and no such rewrite, so it skips this.
function rootToItself(request: NextRequest) {
  if (!BASE_PATH || request.nextUrl.pathname !== "/") return NextResponse.next();
  return NextResponse.rewrite(request.nextUrl);
}

function hide() {
  return hiddenResponse() as NextResponse;
}

// Matcher sources are relative to the base path; Next adds it. "/" is listed
// on its own because the pattern alone does not match the base path root.
// Nothing is excluded: assets cost one HMAC each, and a visitor without the
// cookie learns nothing, not even that this is a Next.js app.
export const config = {
  matcher: ["/", "/:path*"],
};
