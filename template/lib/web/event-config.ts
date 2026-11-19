import { CONFIG_FILE, defaultConfig, parseConfig } from "@/lib/hub/config.mjs";
import type { AgendaEntry } from "./playbook";

// hub.config.json as the board uses it. The board reads the file with the
// data, so a data commit can rename the event or move its dates. The file is
// checked by the same reader the CLI uses (lib/hub/config.mjs). When it is
// missing, the board uses the config it was built with; when it is present
// but broken, it does the same and says why, so a typo shows on the board
// instead of silently renaming the event.

export interface EventConfig {
  event: {
    name: string;
    slug: string;
    timezone: string;
    startsAt: string;
    submitBy: string;
    location: string;
    url: string;
  };
  hub: { repo: string; basePath: string; owner: string };
}

/** The config this deployment was built with (next.config.ts passes it as HUB_BUILD_CONFIG), else the defaults. */
export function buildConfig(raw: string | undefined = process.env.HUB_BUILD_CONFIG): EventConfig {
  if (raw) {
    try {
      const parsed = parseConfig(JSON.parse(raw));
      if (parsed.data) return parsed.data as EventConfig;
    } catch {
      // fall through to the defaults
    }
  }
  return defaultConfig() as EventConfig;
}

/** The config from the text of hub.config.json (null when the file is missing), with the reason when it cannot be used. */
export function eventConfigFrom(text: string | null, fallback: EventConfig = buildConfig()): { data: EventConfig; error: string | null } {
  if (text === null) return { data: fallback, error: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { data: fallback, error: `${CONFIG_FILE} is not valid JSON (${error instanceof Error ? error.message : "parse error"}). The board shows the settings it was deployed with until it is fixed; ./hub doctor checks it.` };
  }
  const parsed = parseConfig(raw);
  if (parsed.error || !parsed.data) return { data: fallback, error: `${CONFIG_FILE}: ${parsed.error ?? "unreadable"} The board shows the settings it was deployed with until it is fixed; ./hub doctor checks it.` };
  return { data: parsed.data as EventConfig, error: null };
}

const SUBMIT_TITLE = /\bsubmi(t|ssion)/i;
const HACKING_START = /hacking (began|begins|starts|started)|hack(ing)? time begins/i;

/**
 * The schedule from kb/playbook.md, filled in from hub.config.json where the
 * playbook is silent: event.submitBy becomes the submission deadline and
 * event.startsAt the start of hacking, so a fresh hub counts down as soon as
 * setup writes the config.
 */
export function withConfigDates(agenda: AgendaEntry[], config: EventConfig): AgendaEntry[] {
  const extra: AgendaEntry[] = [];
  const submitMs = Date.parse(config.event.submitBy);
  if (!Number.isNaN(submitMs) && !agenda.some((entry) => entry.source === "deadline" && SUBMIT_TITLE.test(entry.title))) {
    extra.push({ id: "config-submit", title: "Submissions due", kind: "deadline", startMs: submitMs, endMs: submitMs, point: true, where: null, source: "deadline" });
  }
  const startMs = Date.parse(config.event.startsAt);
  if (!Number.isNaN(startMs) && !agenda.some((entry) => entry.source === "calendar" && HACKING_START.test(entry.title))) {
    extra.push({ id: "config-start", title: "Hacking starts", kind: "event", startMs, endMs: startMs + 15 * 60_000, point: false, where: config.event.location || null, source: "calendar" });
  }
  if (!extra.length) return agenda;
  return [...agenda, ...extra].sort((a, b) => a.startMs - b.startMs || Number(b.point) - Number(a.point));
}
