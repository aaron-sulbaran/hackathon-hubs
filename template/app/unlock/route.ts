import { NextResponse, type NextRequest } from "next/server";
import { keyMatches, SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/web/auth";
import { APP_ROOT } from "@/lib/web/base-path";

// The unlock link: <base path>/unlock?key=<HUB_KEY> sets the signed cookie and
// sends the visitor home. proxy.ts lets this one path through without a cookie.
//
// The Location is a path, never a full URL. When a parent site rewrites to this
// deployment (docs/deploy.md), the host on request.url is this project's own origin, not the
// public one; a redirect built from it would move the visitor off the public
// host. It lives in a route handler because a proxy redirect must be absolute.
//
// The key is in this URL's query string, so both answers say no-referrer
// themselves, on top of the same header next.config.ts sets on every path.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.HUB_KEY;
  if (!keyMatches(request.nextUrl.searchParams.get("key"), secret)) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" },
    });
  }
  const response = new NextResponse(null, { status: 307, headers: { Location: APP_ROOT, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await signSession(secret as string),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: APP_ROOT,
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
