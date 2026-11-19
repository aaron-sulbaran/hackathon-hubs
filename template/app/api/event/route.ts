import { rosterIds } from "@/lib/web/roster";
import { hiddenResponse, requestAllowed } from "@/lib/web/gate";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { buildWebEvent } from "@/lib/web/event-input";
import { createRateLimiter } from "@/lib/web/rate-limit";
import { CACHE_TAG, loadSnapshot } from "@/lib/web/source";
import { writeEvent } from "@/lib/web/write";

// The board's one write endpoint. proxy.ts has already checked the unlock
// cookie; this refuses cross-site requests and bad bodies, stores one new event
// file, and drops the cached snapshot so the next render includes it.

const limited = createRateLimiter(30, 60_000);

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return true;
  // Behind the main site's rewrite the browser's origin is the public host,
  // which arrives as x-forwarded-host; the host this app sees is its own.
  const hosts = [request.nextUrl.host, request.headers.get("x-forwarded-host"), request.headers.get("host")];
  return URL.canParse(origin) && hosts.includes(new URL(origin).host);
}

export async function POST(request: NextRequest) {
  if (!(await requestAllowed(request))) return hiddenResponse();
  if (!sameOrigin(request)) return fail(403, "Cross-site requests are not accepted.");
  if (!request.headers.get("content-type")?.includes("application/json")) return fail(415, "Send JSON.");
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(address)) return fail(429, "Slow down: too many writes in a minute.");

  const body = await request.json().catch(() => null);
  const snapshot = await loadSnapshot();
  const roster = rosterIds(snapshot);
  if (!roster.data) return fail(503, roster.error);
  const teamIds = roster.data;

  const built = buildWebEvent(body, teamIds);
  if (!built.data) return fail(400, built.error);

  const written = await writeEvent(built.data);
  if (written.error !== null) return fail(502, written.error);

  revalidateTag(CACHE_TAG, { expire: 0 });
  return NextResponse.json({ event: built.data, file: written.data });
}
