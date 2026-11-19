// The parts of setup that only compute: no files, no processes, no prompts.
// Kept apart so the tests can cover them without a fake machine.
import { randomBytes } from "node:crypto";

const PERSON_ID = /^[a-z][a-z0-9_]*$/;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const SLUG_MAX = 40;

export const ONBOARDING_TITLE = "Connect your coding agent to the hub";
export const ONBOARDING_WHY = "Agents coordinate only through the hub; one paste, about five minutes";
export const OWNER_LINK_FILE = ".hub-owner.local";
export const STATE_FILE = ".hub-setup.local.json";
export const IGNORED_BY_SETUP = [OWNER_LINK_FILE, STATE_FILE, ".vercel", ".env*.local"];
// The Vercel CLI never reads .gitignore, so every machine-local file is listed
// again for it; it already skips .git, .vercel, node_modules, and .env*.local.
export const VERCEL_IGNORED = [OWNER_LINK_FILE, STATE_FILE, ".hub-me", ".hub-state.json", ".claude/settings.local.json", ".env*", "shots/", "out/", "*.tsbuildinfo"];

function asciiFold(text) {
  return String(text).normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function slugify(name) {
  const slug = asciiFold(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  return slug || "hackathon";
}

export function isPersonId(value) {
  return typeof value === "string" && PERSON_ID.test(value);
}

export function isGithubLogin(value) {
  return typeof value === "string" && GITHUB_LOGIN.test(value) && !value.endsWith("-") && !value.includes("--");
}

// "Ada Lovelace" becomes ada; a taken id grows the last name's initial, then a number.
export function personIdFor(name, takenIds = []) {
  const words = asciiFold(name)
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  let base = (words[0] ?? "").replace(/^[0-9_]+/, "") || "person";
  const taken = new Set(takenIds);
  if (!taken.has(base)) return base;
  const initial = words.length > 1 ? words[words.length - 1][0] : "";
  if (initial && !taken.has(base + initial)) return base + initial;
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

export function commitEmailFor(githubId, login) {
  return `${githubId}+${login}@users.noreply.github.com`;
}

export function machineTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// Minutes east of UTC for a zone at one instant, read from Intl ("GMT-05:00").
export function zoneOffsetMinutes(timeZone, epochMs) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(epochMs));
  const label = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(label);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

function pad(number, width = 2) {
  return String(number).padStart(width, "0");
}

function formatOffset(minutes) {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const WALL_CLOCK = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?)?$/i;

// "2027-01-17 09:00" read as wall-clock time in timeZone, returned with that
// zone's offset on that date: 2027-01-17T09:00:00-05:00. Empty stays empty.
export function parseLocalTime(input, timeZone) {
  const text = String(input ?? "").trim();
  if (text === "") return { data: "", error: null };
  if (WITH_OFFSET.test(text) && !Number.isNaN(Date.parse(text))) return { data: text, error: null };
  const match = WALL_CLOCK.exec(text);
  const example = 'Use a date and time like "2027-01-17 09:00" or "2027-01-17 9:00 pm".';
  if (!match) return { data: null, error: `"${text}" is not a time. ${example}` };
  const [, year, month, day, hourText, minuteText, secondText, meridiem] = match;
  let hour = Number(hourText ?? 0);
  const minute = Number(minuteText ?? 0);
  const second = Number(secondText ?? 0);
  if (meridiem) {
    if (hour < 1 || hour > 12) return { data: null, error: `"${text}" has an hour that does not fit am or pm. ${example}` };
    hour = (hour % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return { data: null, error: `"${text}" is not a time of day. ${example}` };
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), hour, minute, second);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== Number(year) || check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day)) {
    return { data: null, error: `"${text}" is not a real date.` };
  }
  // Two passes settle the offset across a daylight saving change.
  let offset = zoneOffsetMinutes(timeZone, wall);
  const corrected = zoneOffsetMinutes(timeZone, wall - offset * 60000);
  if (corrected !== offset) offset = corrected;
  const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${formatOffset(offset)}`;
  return { data: iso, error: null };
}

// --person "name=Ada Lovelace;github=ada-l;focus=Frontend, design;id=ada", or just a name.
export function parsePersonSpec(spec) {
  const text = String(spec ?? "").trim();
  if (text === "") return { data: null, error: "--person is empty." };
  if (!text.includes("=")) return { data: { name: text }, error: null };
  const person = {};
  for (const part of text.split(";")) {
    if (part.trim() === "") continue;
    const at = part.indexOf("=");
    if (at < 0) return { data: null, error: `--person "${text}": "${part.trim()}" needs key=value.` };
    const key = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim();
    if (!["name", "id", "focus", "github"].includes(key)) {
      return { data: null, error: `--person "${text}": unknown key "${key}". Use name, id, focus, github.` };
    }
    person[key] = value;
  }
  if (!person.name) return { data: null, error: `--person "${text}" needs name=.` };
  return { data: person, error: null };
}

// Turns loose entries into team.json people, filling ids and keeping known GitHub facts.
export function buildPeople(entries, previous = []) {
  const people = [];
  const taken = [];
  for (const entry of entries) {
    const name = String(entry.name ?? "").trim();
    if (!name) return { data: null, error: "Every person needs a name." };
    const id = entry.id ? String(entry.id).trim() : personIdFor(name, taken);
    if (!isPersonId(id)) return { data: null, error: `"${id}" is not a usable id: lowercase letters, digits, and _, starting with a letter.` };
    if (taken.includes(id)) return { data: null, error: `Two people have the id "${id}".` };
    const github = String(entry.github ?? "").trim().replace(/^@/, "");
    if (github && !isGithubLogin(github)) return { data: null, error: `"${github}" is not a GitHub username.` };
    const before = previous.find((person) => person.id === id);
    const sameAccount = before && before.github && before.github.toLowerCase() === github.toLowerCase();
    taken.push(id);
    people.push({
      id,
      name,
      focus: String(entry.focus ?? before?.focus ?? "").trim(),
      github,
      githubId: sameAccount ? before.githubId ?? null : null,
      commitEmail: sameAccount ? before.commitEmail ?? "" : "",
      emails: Array.isArray(before?.emails) ? before.emails : [],
    });
  }
  if (people.length === 0) return { data: null, error: "The team needs at least one person." };
  return { data: people, error: null };
}

// --person entries laid over the people already in team.json: a match by id,
// GitHub username, or name updates that person; anyone else is added. Nobody
// is dropped, so adding a late teammate never removes the others.
export function mergePeople(existing, entries) {
  const merged = existing.map((person) => ({ id: person.id, name: person.name, focus: person.focus, github: person.github }));
  const lower = (value) => String(value ?? "").trim().toLowerCase();
  for (const entry of entries) {
    const github = lower(entry.github).replace(/^@/, "");
    const match = merged.find((person) =>
      (entry.id && person.id === entry.id) ||
      (!entry.id && github && lower(person.github) === github) ||
      (!entry.id && lower(person.name) === lower(entry.name)));
    if (match) {
      if (entry.name) match.name = entry.name;
      if (entry.focus !== undefined) match.focus = entry.focus;
      if (entry.github !== undefined) match.github = entry.github;
    } else {
      merged.push({ ...entry, id: entry.id || personIdFor(entry.name, merged.map((person) => person.id)) });
    }
  }
  return merged;
}

export function isSampleEvent(event) {
  return event?.name === "Sample Hackathon" || event?.slug === "sample-hackathon";
}

export function checkTeam(team) {
  if (!team || !Array.isArray(team.people) || team.people.length === 0) return "team.json has nobody in it.";
  const seen = new Set();
  for (const person of team.people) {
    if (!isPersonId(person.id)) return `team.json: "${person.id}" is not a usable id.`;
    if (seen.has(person.id)) return `team.json: the id "${person.id}" appears twice.`;
    seen.add(person.id);
    if (typeof person.name !== "string" || person.name.trim() === "") return `team.json: ${person.id} has no name.`;
  }
  return null;
}

// The people shipped in the template: "<Name> Example" with no GitHub account.
export function looksLikeSampleTeam(team) {
  return Boolean(team?.people?.length) && team.people.every((person) => /\bExample$/.test(person.name ?? "") && !person.github);
}

export function generateHubKey() {
  return randomBytes(32).toString("base64url");
}

// The text the owner pastes in the team chat. The invite step is only there when an
// invite was sent or is still pending; a team of one, or --skip-github, has none to accept.
export function teamMessageLines({ repo, branch, inviteOutstanding }) {
  const steps = [];
  if (inviteOutstanding) steps.push(`Accept the GitHub invite to ${repo} (github.com/notifications).`);
  steps.push(`Open your coding agent and paste the prompt from docs/agent-prompt.md: https://github.com/${repo}/blob/${branch}/docs/agent-prompt.md`);
  steps.push("Open the board once with this link, then tap your name: <UNLOCK_LINK>");
  return ["Hub is ready. About five minutes:", ...steps.map((step, index) => `${index + 1}. ${step}`), "Your agent asks who you are and tells you if it needs anything else."];
}

/**
 * Whether setup prints the unlock link or only writes it to OWNER_LINK_FILE.
 * Output that is not a terminal (a pipe, a log, a coding agent's transcript)
 * never gets the reusable link unless --print-link asks for it; neither does
 * a --yes run, which is how coding agents call setup.
 */
export function shouldPrintLink({ stdoutIsTTY, yes, printLink }) {
  if (printLink) return true;
  return Boolean(stdoutIsTTY) && !yes;
}

export function unlockLink(boardUrl, basePath, key) {
  const origin = String(boardUrl).replace(/\/+$/, "");
  return `${origin}${basePath}/unlock?key=${encodeURIComponent(key)}`;
}

// GitHub prefills name, description, owner, expiry, and permissions from the
// URL. It cannot preselect the repository; the owner picks that by hand.
export function tokenPageUrl({ name, description, owner, contents, expiresInDays }) {
  const params = new URLSearchParams({
    name,
    description,
    target_name: owner,
    expires_in: String(expiresInDays),
    contents,
  });
  return `https://github.com/settings/personal-access-tokens/new?${params.toString()}`;
}

// Days from now until a few days after the deadline, so the token dies soon
// after the event; a week when no deadline is set.
export function tokenExpiryDays(submitBy, now = Date.now()) {
  const deadline = Date.parse(submitBy);
  if (Number.isNaN(deadline)) return 7;
  const days = Math.ceil((deadline - now) / 86400000) + 3;
  return Math.min(366, Math.max(1, days));
}

export function withIgnoreLines(text, names) {
  const lines = String(text ?? "").split("\n").map((line) => line.trim());
  const missing = names.filter((name) => !lines.includes(name) && !lines.includes(`/${name}`));
  if (missing.length === 0) return { text, added: [] };
  const base = text && !text.endsWith("\n") ? `${text}\n` : text ?? "";
  return { text: `${base}${base ? "\n" : ""}# Written by ./hub setup: local secrets and state\n${missing.join("\n")}\n`, added: missing };
}

// The repo GitHub shows for an origin URL, or "" when origin is not on GitHub.
export function repoFromRemote(url) {
  const match = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(url ?? "").trim());
  return match ? `${match[1]}/${match[2]}` : "";
}

// Picks the address teammates open: the shortest production alias, a custom
// domain before a vercel.app one, and the deployment URL only as a last resort.
export function pickBoardUrl(aliases, deploymentUrl) {
  const hosts = [...new Set(aliases.map((alias) => String(alias).replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean))];
  const custom = hosts.filter((host) => !host.endsWith(".vercel.app")).sort((a, b) => a.length - b.length);
  const vercel = hosts.filter((host) => host.endsWith(".vercel.app")).sort((a, b) => a.length - b.length);
  const host = custom[0] ?? vercel[0];
  if (host) return `https://${host}`;
  return deploymentUrl ? String(deploymentUrl).replace(/\/+$/, "") : "";
}

// Every string under a key named alias or aliases, at any depth, because the
// shape of `vercel inspect --json` is not documented.
export function collectAliases(value, found = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectAliases(entry, found);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (/^alias(es)?$/i.test(key)) {
        for (const alias of [].concat(entry)) {
          if (typeof alias === "string") found.push(alias);
          else if (alias && typeof alias.alias === "string") found.push(alias.alias);
          else if (alias && typeof alias.domain === "string") found.push(alias.domain);
        }
      } else collectAliases(entry, found);
    }
  }
  return found;
}

// JSON from a CLI's stdout, tolerating a line of chatter around it.
export function parseJsonOutput(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

// `vercel whoami --json`: {username, team: {slug} | null}, or {loggedIn: false}.
export function parseVercelWhoami(result) {
  const json = result.ok ? parseJsonOutput(result.out) : null;
  if (!json || json.loggedIn === false) return { loggedIn: false, username: "", teamSlug: "" };
  return { loggedIn: true, username: String(json.username ?? ""), teamSlug: String(json.team?.slug ?? "") };
}

// `vercel deploy --json`: {url, productionUrl, ...}. A coding agent's run wraps
// it as {status, deployment: {...}}. productionUrl is null until the alias is set.
export function parseDeployOutput(text) {
  const json = parseJsonOutput(text);
  const deployment = json?.deployment ?? json;
  if (!deployment || typeof deployment !== "object") return { url: "", productionUrl: "" };
  const https = (value) => (typeof value === "string" && value ? (value.startsWith("http") ? value : `https://${value}`).replace(/\/+$/, "") : "");
  return { url: https(deployment.url), productionUrl: https(deployment.productionUrl) };
}

// The reason a vercel command failed. Under a coding agent the CLI writes a
// JSON error to stdout and leaves stderr nearly empty.
export function vercelFailure(result) {
  const json = parseJsonOutput(result.out);
  if (json && typeof json.message === "string") {
    const next = Array.isArray(json.next) && json.next[0]?.command ? ` (try: ${json.next[0].command})` : "";
    return `${json.message}${next}`;
  }
  const lines = String(result.err || result.out || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const useful = lines.filter((line) => !/^Vercel CLI \d/.test(line));
  return useful.pop() ?? lines.pop() ?? "no output";
}

// Names of the variables in `vercel env list --json`, whatever wraps them.
export function envNamesFrom(json) {
  const names = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      if (typeof value.key === "string" && /^[A-Z][A-Z0-9_]*$/.test(value.key)) names.add(value.key);
      Object.values(value).forEach(visit);
    }
  };
  visit(json);
  return [...names];
}

const STEP_TITLES = {
  preflight: "Check the tools",
  event: "Event details",
  team: "Team",
  prompt: "Onboarding prompt",
  seed: "Onboarding tasks",
  github: "Git and GitHub",
  board: "Board on Vercel",
  tokens: "Live mode token",
  message: "Message for the team",
};

export const STEP_ORDER = Object.keys(STEP_TITLES);

// What each step will do, from facts gathered without changing anything.
// status: done (already true), todo (setup does it), manual (a person must), skip,
// stop (the real run would stop here with this message).
export function buildPlan(facts) {
  const plan = [];
  const add = (key, status, detail) => plan.push({ key, title: STEP_TITLES[key], status, detail });

  const identitySet = Boolean(facts.gitName && facts.gitEmail);
  add("preflight", facts.nodeOk && facts.gitOk && identitySet ? "done" : "manual",
    [
      `node ${facts.nodeVersion}${facts.nodeOk ? "" : " (needs 20.9 or newer)"}`,
      facts.gitOk ? (identitySet ? "git ok" : "git ok, but user.name or user.email is not set (git config --global)") : "git missing",
      facts.gh.installed ? (facts.gh.loggedIn ? `gh logged in${facts.gh.login ? ` as ${facts.gh.login}` : ""}` : "gh not logged in") : "gh not installed",
      facts.vercel.installed ? (facts.vercel.loggedIn ? `vercel logged in as ${facts.vercel.username || "?"}, scope ${facts.vercel.scope || "?"}` : "vercel not logged in") : "vercel not installed",
    ].join(", "));

  const stopFor = (pattern) => (facts.stops ?? []).find((message) => pattern.test(message));
  const eventStop = stopFor(/event|--slug|--timezone|--starts|--submit-by/);
  if (eventStop) add("event", "stop", eventStop);
  else add("event", facts.eventConfirmed && !facts.eventChanges ? "done" : "todo",
    facts.eventConfirmed && !facts.eventChanges ? `${facts.eventName}, already set` : `write hub.config.json for ${facts.eventName}`);

  const teamStop = stopFor(/team|--person|--owner/);
  if (teamStop) add("team", "stop", teamStop);
  else add("team", facts.teamConfirmed && !facts.teamChanges ? "done" : "todo",
    `${facts.teamIds.join(", ")}${facts.githubLookups.length ? `; look up GitHub ids for ${facts.githubLookups.join(", ")}` : ""}`);

  add("prompt", facts.promptCurrent ? "done" : "todo", facts.promptCurrent ? "docs/agent-prompt.md is current" : "render docs/agent-prompt.md");

  if (!facts.hubCliPresent) add("seed", "skip", "scripts/hub.mjs is not in this folder yet");
  else add("seed", facts.onboardingMissing.length ? "todo" : "done",
    facts.onboardingMissing.length ? `add a task for ${facts.onboardingMissing.join(", ")}` : "every person has one");

  const githubTodo = [];
  if (!facts.gitRepo) githubTodo.push("git init");
  if (facts.uncommitted) githubTodo.push("commit");
  if (!facts.originExists) githubTodo.push(facts.skipGithub ? "" : `create private repo ${facts.plannedRepo}`);
  if (facts.originExists && facts.unpushed) githubTodo.push("push");
  if (facts.invitesToSend.length) githubTodo.push(`check or send invites for ${facts.invitesToSend.join(", ")}`);
  const githubNeedsPerson = !facts.originExists && (!facts.gh.loggedIn || facts.skipGithub);
  const githubSteps = githubTodo.filter(Boolean);
  add("github", githubNeedsPerson ? "manual" : githubSteps.length ? "todo" : "done",
    githubNeedsPerson ? `${githubSteps.join(", ")}${githubSteps.length ? "; " : ""}create the repo by hand (steps printed below)` : githubSteps.length ? githubSteps.join(", ") : `${facts.repo} is set up`);

  if (facts.skipVercel) add("board", "skip", "--skip-vercel");
  else if (!facts.vercel.installed || !facts.vercel.loggedIn) add("board", "manual", "install and log in to the Vercel CLI, then run ./hub setup again");
  else {
    const boardTodo = [];
    if (!facts.vercelLinked) boardTodo.push(`create or link Vercel project ${facts.vercelProject ?? "?"} in scope ${facts.vercel.scope || "?"}`);
    if (!facts.hubKeySet || facts.newKey) boardTodo.push("set HUB_KEY");
    if (facts.repo && !facts.hubRepoSet) boardTodo.push("set HUB_REPO");
    if (!facts.deployed || boardTodo.length || facts.forceDeploy) boardTodo.push(`deploy, ${facts.printLink ? "print the unlock link" : `save the unlock link in ${OWNER_LINK_FILE}`}, and check it from outside`);
    add("board", boardTodo.length ? "todo" : "done", boardTodo.length ? boardTodo.join(", ") : `deployed at ${facts.boardUrl}`);
  }

  if (facts.tokensSet) add("tokens", "done", "HUB_READ_TOKEN and HUB_WRITE_TOKEN are set");
  else if (!facts.wantTokens) add("tokens", "skip", "optional; later: ./hub setup --tokens");
  else if (!facts.repo) add("tokens", "skip", "needs the GitHub repo first");
  else if (!facts.vercel.installed || !facts.vercel.loggedIn) add("tokens", "manual", "needs the Vercel CLI");
  else add("tokens", "todo", "make two tokens, set them on Vercel, redeploy");

  add("message", "todo", "print the message for the team chat");
  if (!facts.deployOnly) return plan;
  // The real run goes straight to the board, so the plan says so instead of listing steps that will not run.
  return plan.map((step) => (["preflight", "board"].includes(step.key) ? step : { ...step, status: "skip", detail: "--deploy on a finished hub only redeploys the board" }));
}

export function renderPlan(plan) {
  const width = Math.max(...plan.map((step) => step.title.length));
  return plan
    .map((step, index) => `${String(index + 1).padStart(2)}. ${step.title.padEnd(width)}  ${step.status.padEnd(6)} ${step.detail}`)
    .join("\n");
}
