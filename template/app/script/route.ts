import type { NextRequest } from "next/server";
import { withBasePath } from "@/lib/web/base-path";
import { hiddenResponse, requestAllowed } from "@/lib/web/gate";
import { latestClock } from "@/lib/web/pitch-clock";
import { PITCH_SCRIPT_FILE, scriptForPage } from "@/lib/web/pitch-script";
import { DEFAULT_PITCH_SCRIPT } from "@/lib/web/pitch-script-default";
import { loadSnapshot, writesOffReason } from "@/lib/web/source";
import { withoutWithdrawn } from "@/lib/web/withdrawn";
import { SCRIPT_BODY, SCRIPT_HEAD } from "./html";

// GET /script: the whole pitch as a read-aloud run sheet with a clock, for the
// team's timed dry runs. The lines come from kb/pitch-script.md plus the edits
// teammates save on the page (script.edit events); see lib/web/pitch-script.ts.
// It sits behind the same unlock cookie as every page (proxy.ts). Served as one
// self-contained document so it opens fast on a phone.

type ScriptEvent = { type: string; by: string; at: string; data?: unknown };

function isScriptEvent(value: unknown): value is ScriptEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return typeof event.type === "string" && typeof event.by === "string" && typeof event.at === "string";
}

/** The team as the page labels presenters: id and first name, in team.json order. */
function presentersFrom(team: unknown): Array<{ id: string; name: string }> {
  const people = (team as { people?: unknown } | null)?.people;
  if (!Array.isArray(people)) return [];
  return people
    .filter((person): person is { id: string; name?: unknown } => typeof person?.id === "string")
    .map((person) => ({ id: person.id, name: (typeof person.name === "string" && person.name.trim() ? person.name : person.id).split(" ")[0] ?? person.id }));
}

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export async function GET(request: NextRequest) {
  if (!(await requestAllowed(request))) return hiddenResponse();
  const snapshot = await loadSnapshot();
  const markdown = snapshot.data?.kb[PITCH_SCRIPT_FILE] ?? null;
  const events = snapshot.data ? withoutWithdrawn(snapshot.data.events).map((entry) => entry.event).filter(isScriptEvent) : [];
  const people = presentersFrom(snapshot.data?.team);
  const shown = scriptForPage(markdown, events, DEFAULT_PITCH_SCRIPT, people.map((person) => person.id));
  const problem = snapshot.data ? shown.problem : `Could not read the hub (${snapshot.error ?? "unknown error"}).`;
  const clock = snapshot.data ? latestClock(snapshot.data.events.map((entry) => entry.event)) : null;
  const config = { script: shown.script, people, problem, apiUrl: withBasePath("/api/event"), homeUrl: withBasePath("/"), clockUrl: withBasePath("/api/clock"), clock, serverNowMs: Date.now(), writesOff: writesOffReason() };

  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    '<meta name="robots" content="noindex, nofollow">' +
    SCRIPT_HEAD +
    '</head><body style="margin:0">' +
    `<script type="application/json" id="script-data">${scriptJson(config)}</script>` +
    SCRIPT_BODY +
    "</body></html>";
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}
