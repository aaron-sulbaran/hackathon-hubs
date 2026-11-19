import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eventRelPath } from "@/lib/hub/schema.mjs";
import { explainGitHub, hubRepo, localRoot, writesToDisk } from "./source";
import type { HubEvent, Result } from "./types";

// Every web write is one new file, events/YYYY-MM-DD/<id>.json, never an edit.
// Writes land wherever reads come from: the disk checkout in development, the
// GitHub repo (contents API, HUB_WRITE_TOKEN) in production.

const RETRY_STATUSES = new Set([409, 500, 502, 503, 504]);
const ATTEMPTS = 4;

function commitMessage(event: HubEvent): string {
  const title = event.title.length > 60 ? `${event.title.slice(0, 57)}...` : event.title;
  return `hub(web): ${event.by} ${event.type}${event.ref ? ` ${event.ref}` : ""} "${title}"`;
}

async function writeToDisk(event: HubEvent): Promise<Result<string>> {
  const relative = eventRelPath(event);
  const absolute = path.join(/* turbopackIgnore: true */ localRoot(), relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(event, null, 2)}\n`, { flag: "wx" });
  return { data: relative, error: null };
}

type Fetcher = typeof fetch;

export async function writeToGitHub(event: HubEvent, fetcher: Fetcher = fetch, waitMs = 400): Promise<Result<string>> {
  const repo = hubRepo();
  const token = process.env.HUB_WRITE_TOKEN;
  if (!repo || !token) return { data: null, error: "Writes are off: HUB_REPO and HUB_WRITE_TOKEN must be set." };
  const relative = eventRelPath(event);
  const body = JSON.stringify({
    message: commitMessage(event),
    content: Buffer.from(`${JSON.stringify(event, null, 2)}\n`).toString("base64"),
    branch: "main",
  });
  // main moves every few seconds while agents push; a write that lands mid-push
  // can get a 409, and trying again a moment later goes through.
  let status = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, waitMs * attempt));
    const response = await fetcher(`https://api.github.com/repos/${repo}/contents/${relative}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    }).catch(() => null);
    status = response?.status ?? 0;
    if (response?.ok) return { data: relative, error: null };
    if (response && !RETRY_STATUSES.has(response.status)) break;
  }
  return { data: null, error: status ? explainGitHub(status, "HUB_WRITE_TOKEN") : "Could not reach GitHub." };
}

export async function writeEvent(event: HubEvent): Promise<Result<string>> {
  try {
    return writesToDisk() ? await writeToDisk(event) : await writeToGitHub(event);
  } catch (error) {
    console.error("[hub] event write failed:", error);
    return { data: null, error: "Could not store the event." };
  }
}
