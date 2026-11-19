import { rosterIds } from "@/lib/web/roster";
import { hiddenResponse, requestAllowed } from "@/lib/web/gate";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { buildClockEvent, clockFromEvent, latestClock, newerClock, type SharedClock } from "@/lib/web/pitch-clock";
import { createRateLimiter } from "@/lib/web/rate-limit";
import { CACHE_TAG, loadSnapshot } from "@/lib/web/source";
import { writeEvent } from "@/lib/web/write";

// The pitch script page's shared clock (lib/web/pitch-clock.ts). Phones poll
// GET about every 1.5 s; a press is a POST. The latest state lives in this
// instance's memory, so a press shows on every phone this instance serves at
// the next poll. Each press is also stored as a script.clock event, and the
// log is re-read at most every 15 s, so other instances and a fresh start
// still find the clock. proxy.ts has already checked the unlock cookie.

const LOG_REFRESH_MS = 15_000;
const limited = createRateLimiter(60, 60_000);

let remembered: SharedClock | null = null;
let fromLog: { clock: SharedClock | null; readAtMs: number } = { clock: null, readAtMs: 0 };

async function currentClock(): Promise<SharedClock | null> {
  const now = Date.now();
  if (now - fromLog.readAtMs > LOG_REFRESH_MS) {
    const snapshot = await loadSnapshot();
    if (snapshot.data) fromLog = { clock: latestClock(snapshot.data.events.map((entry) => entry.event)), readAtMs: now };
  }
  return newerClock(remembered, fromLog.clock);
}

function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const hosts = [request.nextUrl.host, request.headers.get("x-forwarded-host"), request.headers.get("host")];
  return URL.canParse(origin) && hosts.includes(new URL(origin).host);
}

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ...body, serverNowMs: Date.now() }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: NextRequest) {
  if (!(await requestAllowed(request))) return hiddenResponse();
  return reply({ clock: await currentClock() });
}

export async function POST(request: NextRequest) {
  if (!(await requestAllowed(request))) return hiddenResponse();
  if (!sameOrigin(request)) return reply({ error: "Cross-site requests are not accepted." }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return reply({ error: "Send JSON." }, 415);
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(address)) return reply({ error: "Slow down: too many clock presses in a minute." }, 429);

  const body = await request.json().catch(() => null);
  const snapshot = await loadSnapshot();
  const roster = rosterIds(snapshot);
  if (!roster.data) return reply({ error: roster.error }, 503);
  const teamIds = roster.data;
  const built = buildClockEvent(body, teamIds);
  if (!built.data) return reply({ error: built.error }, 400);

  remembered = newerClock(remembered, clockFromEvent(built.data));
  const written = await writeEvent(built.data);
  if (written.error === null) revalidateTag(CACHE_TAG, { expire: 0 });
  // The clock already moved for every phone this instance serves; a failed write only means
  // another instance learns about it late. Say so, but do not undo the press.
  return reply({ clock: await currentClock(), stored: written.error === null, warning: written.error });
}
