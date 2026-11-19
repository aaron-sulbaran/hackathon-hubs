import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { unstable_cache } from "next/cache";
import { loadEventsFromDir } from "@/lib/hub/load.mjs";
import { CONFIG_FILE } from "@/lib/hub/config.mjs";
import { AGENT_PROMPT_FILE } from "./onboarding";
import { extractTar } from "./tar";
import type { Result } from "./types";

// Where the board's files come from. In development, or with HUB_LOCAL_DIR set,
// or without a read token, they are read from a checkout on disk. In production
// the whole private repo is fetched as one tarball per revalidation window and
// unpacked in memory, so a single GitHub API call serves every page.

export const CACHE_TAG = "hub";
export const REVALIDATE_SECONDS = 30;

export type EventEntry = { file: string; event?: unknown; error?: string };

export interface Snapshot {
  events: EventEntry[];
  kb: Record<string, string>;
  team: unknown;
  /** hub.config.json as written, or null if the file is missing; lib/web/event-config.ts checks it. */
  configText: string | null;
  /** docs/agent-prompt.md as written, or null if the file is missing. */
  agentPrompt: string | null;
  from: "disk" | "github";
  /** When this copy was read (ms since epoch). The last good copy keeps the time of its read, so its age shows. */
  readAt?: number;
}



const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/**
 * owner/name of the hub repo, from the first of: HUB_REPO on the deployment,
 * hub.repo in hub.config.json (next.config.ts passes it in as HUB_CONFIG_REPO
 * at build time), or the repo Vercel built from (VERCEL_GIT_REPO_OWNER and
 * VERCEL_GIT_REPO_SLUG), so a deploy-button clone works with only HUB_KEY set.
 */
export function hubRepo(): string | null {
  const vercelOwner = process.env.VERCEL_GIT_REPO_OWNER?.trim();
  const vercelSlug = process.env.VERCEL_GIT_REPO_SLUG?.trim();
  const candidates = [process.env.HUB_REPO, process.env.HUB_CONFIG_REPO, vercelOwner && vercelSlug ? `${vercelOwner}/${vercelSlug}` : undefined];
  for (const candidate of candidates) {
    const repo = candidate?.trim();
    if (repo && REPO_PATTERN.test(repo)) return repo;
  }
  return null;
}

/**
 * The token that reads the repo. Contents write includes read, so one token
 * set as HUB_WRITE_TOKEN is enough; HUB_READ_TOKEN, when set, is a separate
 * read-only token for teams that want least privilege.
 */
export function readToken(): string | undefined {
  return process.env.HUB_READ_TOKEN || process.env.HUB_WRITE_TOKEN || undefined;
}

export function readsFromDisk(): boolean {
  if (process.env.HUB_LOCAL_DIR) return true;
  if (process.env.NODE_ENV === "development") return true;
  return !readToken() || !hubRepo();
}

/** Writes go to the checkout on disk only in development or with HUB_LOCAL_DIR; a deployed board never writes to its own files. */
export function writesToDisk(): boolean {
  return Boolean(process.env.HUB_LOCAL_DIR) || process.env.NODE_ENV === "development";
}

/** Why saving from the web would fail right now, said before anyone presses a button; null when writes work. */
export function writesOffReason(): string | null {
  if (writesToDisk()) return null;
  if (!hubRepo() || !process.env.HUB_WRITE_TOKEN) return "Saving from this page is off until HUB_WRITE_TOKEN is set on the deployment. Agents still write with ./hub.";
  return null;
}

export function localRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.HUB_LOCAL_DIR || process.cwd());
}

export function explainGitHub(status: number, token: string): string {
  if (status === 401) return `GitHub rejected ${token} (expired, revoked, or mistyped).`;
  if (status === 403) return `GitHub refused the request (rate limit, or ${token} lacks permission).`;
  if (status === 404) return `${token} cannot see ${hubRepo() ?? "HUB_REPO"}. It needs Contents access on that one repo.`;
  return `GitHub answered ${status}.`;
}

async function walkMarkdown(dir: string, base: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relative = path.posix.join(base, entry.name);
      if (entry.isDirectory()) return walkMarkdown(path.join(/* turbopackIgnore: true */ dir, entry.name), relative);
      return entry.name.endsWith(".md") ? [relative] : [];
    }),
  );
  return nested.flat();
}

async function snapshotFromDisk(): Promise<Snapshot> {
  const root = localRoot();
  const events = loadEventsFromDir(path.join(/* turbopackIgnore: true */ root, "events")).data as EventEntry[];
  const kbFiles = await walkMarkdown(path.join(/* turbopackIgnore: true */ root, "kb"), "kb");
  const kb: Record<string, string> = {};
  await Promise.all(
    kbFiles.map(async (file) => {
      kb[file] = await readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ root, file), "utf8");
    }),
  );
  const teamText = await readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ root, "team.json"), "utf8").catch(() => null);
  let team: unknown = { people: [] };
  if (teamText) {
    try {
      team = JSON.parse(teamText);
    } catch {
      team = { people: [] };
    }
  }
  const agentPrompt = await readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ root, AGENT_PROMPT_FILE), "utf8").catch(() => null);
  const configText = await readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ root, CONFIG_FILE), "utf8").catch(() => null);
  return { events, kb, team, configText, agentPrompt, from: "disk", readAt: Date.now() };
}

function wanted(file: string): boolean {
  return /^events\/[^/]+\/[^/]+\.json$/.test(file) || /^kb\/.+\.md$/.test(file) || file === "team.json" || file === CONFIG_FILE || file === AGENT_PROMPT_FILE;
}

export function snapshotFromFiles(files: Map<string, string>): Snapshot {
  const events: EventEntry[] = [];
  const kb: Record<string, string> = {};
  let team: unknown = { people: [] };
  let agentPrompt: string | null = null;
  let configText: string | null = null;
  for (const [file, text] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (file.startsWith("events/")) {
      try {
        events.push({ file, event: JSON.parse(text) });
      } catch (error) {
        events.push({ file, error: `unreadable JSON: ${error instanceof Error ? error.message : String(error)}` });
      }
    } else if (file.startsWith("kb/")) {
      kb[file] = text;
    } else if (file === CONFIG_FILE) {
      configText = text;
    } else if (file === AGENT_PROMPT_FILE) {
      agentPrompt = text;
    } else if (file === "team.json") {
      try {
        team = JSON.parse(text);
      } catch {
        team = { people: [] };
      }
    }
  }
  return { events, kb, team, configText, agentPrompt, from: "github" };
}

async function snapshotFromGitHub(): Promise<Snapshot> {
  const repo = hubRepo();
  const token = readToken();
  if (!repo || !token) throw new Error("The board needs a repo (HUB_REPO or hub.repo) and a token (HUB_READ_TOKEN or HUB_WRITE_TOKEN) to read from GitHub.");
  const response = await fetch(`https://api.github.com/repos/${repo}/tarball/main`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok) throw new Error(explainGitHub(response.status, process.env.HUB_READ_TOKEN ? "HUB_READ_TOKEN" : "HUB_WRITE_TOKEN"));
  const archive = Buffer.from(await response.arrayBuffer());
  return { ...snapshotFromFiles(extractTar(archive, wanted)), readAt: Date.now() };
}

const cachedGitHubSnapshot = unstable_cache(snapshotFromGitHub, ["hub-snapshot-v3"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [CACHE_TAG],
});

let lastGood: Snapshot | null = null;

async function withRetry<T>(read: () => Promise<T>, attempts = 3): Promise<T> {
  let failure: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      failure = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw failure;
}

export async function loadSnapshot(): Promise<Result<Snapshot>> {
  try {
    const data = readsFromDisk() ? await snapshotFromDisk() : await withRetry(cachedGitHubSnapshot);
    lastGood = data;
    return { data, error: null };
  } catch (error) {
    // One failed read must not blank the board for everyone looking at it:
    // serve the last snapshot this server instance saw until GitHub answers again.
    // Pages keep showing it; writes stop trusting its roster once it is old
    // (rosterIds in roster.ts reads readAt).
    if (lastGood) return { data: lastGood, error: null };
    return { data: null, error: error instanceof Error ? error.message : String(error) };
  }
}
