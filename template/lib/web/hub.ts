import "server-only";
import { foldEvents } from "@/lib/hub/fold.mjs";
import { eventConfigFrom, withConfigDates, type EventConfig } from "./event-config";
import { MENTOR_QUESTIONS_FILE, parseQuestionOrder } from "./mentor-questions";
import { extractPromptText } from "./onboarding";
import { parseKbPage, slugFromPath } from "./kb";
import { parsePlaybook, type AgendaEntry } from "./playbook";
import { PITCH_SCRIPT_FILE, scriptForPage, type ShownScript } from "./pitch-script";
import { DEFAULT_PITCH_SCRIPT } from "./pitch-script-default";
import { hubRepo, loadSnapshot, writesOffReason } from "./source";
import type { Board, KbPage } from "./types";
import { withoutWithdrawn } from "./withdrawn";

// Everything a page needs, from one snapshot: the folded board, the kb pages,
// and the schedule. foldEvents (lib/hub/fold.mjs) is the only fold; this file
// just feeds it and types its output.

export interface Hub {
  board: Board;
  pages: KbPage[];
  agenda: AgendaEntry[];
  /** The onboarding prompt to copy, from docs/agent-prompt.md, or null if it could not be read. */
  agentPrompt: string | null;
  /** Question ids in the order kb/mentor-questions.md lists them, or null if the page is missing. */
  mentorOrder: string[] | null;
  /** The pitch script from kb/pitch-script.md with saved edits; `problem` says why the built-in copy is shown instead. */
  pitchScript: { script: ShownScript; problem: string | null };
  nowIso: string;
  /** hub.config.json; the build-time config when it is missing or broken (then `configError` says why). */
  config: EventConfig;
  /** owner/name of the hub repo: HUB_REPO on the deployment, else hub.repo from the config. */
  repo: string | null;
  /** Why web writes would fail right now (no write token), or null when they work. */
  writesOff: string | null;
  error: string | null;
  /** Why hub.config.json in the data could not be used, or null. */
  configError: string | null;
  from: "disk" | "github" | null;
}

const EMPTY_BOARD: Board = { items: [], questions: [], decisions: [], gates: [], sessions: [], people: [], activity: [], rejected: [] };

export function agendaWithGates(agenda: AgendaEntry[], board: Board): AgendaEntry[] {
  const gates = board.gates
    .filter((gate) => gate.due && !Number.isNaN(Date.parse(gate.due)))
    .map(
      (gate): AgendaEntry => ({
        id: gate.id,
        title: gate.title,
        kind: "gate",
        startMs: Date.parse(gate.due as string),
        endMs: Date.parse(gate.due as string),
        point: true,
        where: null,
        source: "gate",
      }),
    );
  return [...agenda, ...gates].sort((a, b) => a.startMs - b.startMs || Number(b.point) - Number(a.point));
}

export async function loadHub(): Promise<Hub> {
  const now = Date.now();
  const snapshot = await loadSnapshot();
  if (!snapshot.data) {
    const config = eventConfigFrom(null).data;
    return { board: EMPTY_BOARD, pages: [], agenda: [], agentPrompt: null, mentorOrder: null, pitchScript: scriptForPage(null, [], DEFAULT_PITCH_SCRIPT), nowIso: new Date(now).toISOString(), config, repo: repoFor(config), writesOff: writesOffReason(), error: snapshot.error, configError: null, from: null };
  }
  const { data: config, error: configError } = eventConfigFrom(snapshot.data.configText);
  const board = foldEvents(withoutWithdrawn(snapshot.data.events), snapshot.data.team, { now }) as unknown as Board;
  const pages = Object.entries(snapshot.data.kb)
    .map(([file, markdown]) => {
      const slug = slugFromPath(file);
      return slug ? parseKbPage(slug, markdown) : null;
    })
    .filter((page): page is KbPage => page !== null)
    .sort((a, b) => (a.slug === "index" ? -1 : b.slug === "index" ? 1 : a.title.localeCompare(b.title)));
  const playbook = snapshot.data.kb["kb/playbook.md"] ?? null;
  const agenda = agendaWithGates(withConfigDates(parsePlaybook(playbook), config), board);
  return { board, pages, agenda, agentPrompt: extractPromptText(snapshot.data.agentPrompt), mentorOrder: parseQuestionOrder(snapshot.data.kb[MENTOR_QUESTIONS_FILE]), pitchScript: scriptForPage(snapshot.data.kb[PITCH_SCRIPT_FILE], board.activity, DEFAULT_PITCH_SCRIPT, board.people.map((person) => person.id)), nowIso: new Date(now).toISOString(), config, repo: repoFor(config), writesOff: writesOffReason(), error: null, configError, from: snapshot.data.from };
}

function repoFor(config: EventConfig): string | null {
  return hubRepo() ?? (config.hub.repo || null);
}
