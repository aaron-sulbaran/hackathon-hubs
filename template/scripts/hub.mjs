#!/usr/bin/env node
// The hub CLI. Every agent reads and writes the hub through this file. Zero dependencies, Node 20+.
// Run `./hub help` for the command list. Contract: docs/CONTRACT.md.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEvent, validateEvent, eventRelPath, newRefId, clip, refKind, LANES, TITLE_MAX, HUMAN_ONLY_TYPES } from '../lib/hub/schema.mjs';
import { loadBoard, loadTeam } from '../lib/hub/load.mjs';
import { CONFIG_FILE, configOrDefault, loadConfig } from '../lib/hub/config.mjs';
import { checkIdentity, creditReport, renderCredit, gatherPulse, findPr, parsePrFlag, pullAdvice, prAdvice, overlapLines, topFolders, identityProblem, cleanGitEnv } from './team-git.mjs';

export const HUB_ROOT = process.env.HUB_DIR ? resolve(process.env.HUB_DIR) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ME_FILE = join(HUB_ROOT, '.hub-me');
const STATE_FILE = join(HUB_ROOT, '.hub-state.json');
/** @param {string} zone */
function isTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// The event's zone reads every --due without an offset, so a deadline means one moment on every machine.
const EVENT_ZONE = configOrDefault(HUB_ROOT).event.timezone;
// HUB_TZ changes only how times are shown (a teammate abroad who wants local times), never how --due is read.
const DISPLAY_ZONE = (() => {
  const wanted = process.env.HUB_TZ;
  if (!wanted) return EVENT_ZONE;
  if (isTimeZone(wanted)) return wanted;
  process.stderr.write(`hub: HUB_TZ="${wanted}" is not a time zone; showing times in ${EVENT_ZONE}.\n`);
  return EVENT_ZONE;
})();
const PUSH_ATTEMPTS = 6;
const HUB = (() => {
  try {
    return realpathSync(process.cwd()) === realpathSync(HUB_ROOT) ? './hub' : `"${join(HUB_ROOT, 'hub')}"`;
  } catch {
    return './hub';
  }
})();

// ---------- small utilities ----------

/** @param {string[]} args @param {{ cwd?: string, timeoutMs?: number, env?: Record<string, string|undefined> }} [options] */
function git(args, options = {}) {
  // Never inherit GIT_DIR and friends: this CLI is also started from git hooks in other repositories.
  const env = cleanGitEnv(options.env);
  const result = spawnSync('git', args, {
    cwd: options.cwd ?? HUB_ROOT,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30000,
    env,
  });
  return {
    ok: result.status === 0,
    out: (result.stdout || '').trim(),
    err: (result.stderr || (result.error ? String(result.error.message) : '')).trim(),
  };
}

/** @param {number} ms */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** @param {string} path @param {any} fallback */
function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/** @param {string} path @param {any} value */
function writeJsonAtomic(path, value) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  renameSync(temp, path);
}

export function loadState() {
  return readJson(STATE_FILE, {});
}

/** @param {(state: any) => void} mutate */
export function updateState(mutate) {
  const state = loadState();
  mutate(state);
  try {
    writeJsonAtomic(STATE_FILE, state);
  } catch {
    // state is a convenience; never fail a command over it
  }
  return state;
}

class UsageError extends Error {}

/**
 * Parse argv into positionals and flags. Repeated flags become arrays.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const booleans = new Set(['human', 'json', 'mine', 'quiet-if-unchanged', 'claim', 'take', 'no-commit', 'help', 'all', 'uninstall', 'auto', 'quiet']);
  const aliases = { m: 'text', h: 'help' };
  /** @type {{ _: string[], [key: string]: any }} */
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      parsed._.push(...argv.slice(i + 1));
      break;
    }
    const match = /^--?([a-zA-Z][\w-]*)(?:=(.*))?$/.exec(arg);
    if (!match || /^-\d/.test(arg)) {
      parsed._.push(arg);
      continue;
    }
    const key = aliases[match[1]] ?? match[1];
    let value;
    if (booleans.has(key)) value = match[2] === undefined ? true : match[2] !== 'false';
    else if (match[2] !== undefined) value = match[2];
    else if (i + 1 < argv.length) value = argv[++i];
    else throw new UsageError(`--${key} needs a value`);
    if (parsed[key] === undefined) parsed[key] = value;
    else parsed[key] = [].concat(parsed[key], value);
  }
  return parsed;
}

/** @param {any} value */
function asList(value) {
  if (value === undefined || value === null) return [];
  return [].concat(value).flatMap((entry) => String(entry).split(',')).map((entry) => entry.trim()).filter(Boolean);
}

/** @param {any} value */
function lastValue(value) {
  return Array.isArray(value) ? value[value.length - 1] : value;
}

// ---------- time formatting ----------

/** @param {string|number|Date} when */
export function formatWhen(when) {
  const date = new Date(when);
  if (Number.isNaN(date.getTime())) return String(when);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_ZONE,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
  return parts;
}

/** @param {number} ms */
export function formatSpan(ms) {
  const minutes = Math.round(Math.abs(ms) / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** @param {string} iso @param {number} [now] */
function ago(iso, now = Date.now()) {
  return `${formatSpan(now - Date.parse(iso))} ago`;
}

/** @param {string} iso @param {number} [now] */
function until(iso, now = Date.now()) {
  const delta = Date.parse(iso) - now;
  return delta >= 0 ? `in ${formatSpan(delta)}` : `${formatSpan(delta)} overdue`;
}

/**
 * The zone's UTC offset at one moment, as "+HH:MM" or "-HH:MM".
 * @param {number} ms @param {string} [timeZone]
 */
export function offsetAt(ms, timeZone = EVENT_ZONE) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(ms).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
  if (!match) return '+00:00';
  return `${match[1]}${match[2].padStart(2, '0')}:${match[3] ?? '00'}`;
}

/** @param {string} offset "+HH:MM" */
function offsetMinutes(offset) {
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(':').map(Number);
  return sign * (hours * 60 + minutes);
}

const DUE_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?\s*(Z|[+-]\d{2}:?\d{2})$/i;
const DUE_WALL_CLOCK = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\s*(\d{1,2})(?::(\d{2}))?(?::(\d{2})(\.\d{1,3})?)?\s*(am|pm)?)?$/i;

/** @param {number|string} value */
function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Read a --due value and return one fixed moment: an ISO time that always carries its offset.
 * A time without an offset is wall time in the event's zone (event.timezone in hub.config.json),
 * with the offset that zone has on that date. Accepts "2027-01-17T13:30", "2027-01-17 13:30",
 * "2027-01-17 1:30 pm", seconds and milliseconds, and a bare date (read as 23:59 that day).
 * Anything else is refused rather than stored as text each machine would read differently.
 * @param {string} input @param {string} [timeZone]
 */
export function normalizeDue(input, timeZone = EVENT_ZONE) {
  const text = String(input ?? '').trim();
  const example = `Use a date and time, e.g. 2027-01-17T13:30 or "2027-01-17 1:30 pm" (read in ${timeZone}), or one with its offset, e.g. 2027-01-17T13:30-05:00.`;
  const fixed = DUE_WITH_OFFSET.exec(text);
  if (fixed) {
    const [, year, month, day, hour, minute, second, fraction, rawOffset] = fixed;
    const offset = rawOffset.toUpperCase() === 'Z' ? 'Z' : rawOffset.includes(':') ? rawOffset : `${rawOffset.slice(0, 3)}:${rawOffset.slice(3)}`;
    const iso = `${year}-${month}-${day}T${hour}:${minute}${second ? `:${second}${fraction ?? ''}` : ''}${offset}`;
    if (Number.isNaN(Date.parse(iso))) throw new UsageError(`"${input}" is not a real time. ${example}`);
    return iso;
  }
  const wall = DUE_WALL_CLOCK.exec(text);
  if (!wall) throw new UsageError(`"${input}" is not a time. ${example}`);
  const [, year, month, day, hourText, minuteText, secondText, fraction, meridiem] = wall;
  const dateOnly = hourText === undefined;
  let hour = dateOnly ? 23 : Number(hourText);
  const minute = dateOnly ? 59 : Number(minuteText ?? 0);
  const second = secondText === undefined ? null : Number(secondText);
  if (meridiem) {
    if (hour < 1 || hour > 12) throw new UsageError(`"${input}" has an hour that does not fit am or pm. ${example}`);
    hour = (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || (second ?? 0) > 59) throw new UsageError(`"${input}" is not a time of day. ${example}`);
  const wallMs = Date.UTC(Number(year), Number(month) - 1, Number(day), hour, minute, second ?? 0);
  const check = new Date(wallMs);
  if (check.getUTCFullYear() !== Number(year) || check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day)) {
    throw new UsageError(`"${input}" is not a real date. ${example}`);
  }
  // Two passes settle the offset across a daylight saving change.
  let offset = offsetAt(wallMs, timeZone);
  offset = offsetAt(wallMs - offsetMinutes(offset) * 60000, timeZone);
  const clock = `${pad2(hour)}:${pad2(minute)}${second === null ? '' : `:${pad2(second)}${fraction ?? ''}`}`;
  return `${year}-${pad2(month)}-${pad2(day)}T${clock}${offset}`;
}

// ---------- identity ----------

function teamIds() {
  return loadTeam(HUB_ROOT).data.people.map((person) => person.id);
}

function teamPeople() {
  return loadTeam(HUB_ROOT).data.people;
}

/** The git repo the agent works in (from --repo or the current folder), when it is not the hub. @param {any} [args] */
function projectClone(args = {}) {
  const wanted = args.repo ? resolve(String(lastValue(args.repo))) : process.cwd();
  const top = git(['rev-parse', '--show-toplevel'], { cwd: wanted });
  if (!top.ok) {
    if (args.repo) throw new UsageError(`${wanted} is not a git clone.`);
    return null;
  }
  try {
    if (realpathSync(top.out) === realpathSync(HUB_ROOT)) return null;
  } catch {
    return null;
  }
  return top.out;
}

function detectAgent() {
  if (process.env.HUB_AGENT) return process.env.HUB_AGENT;
  const saved = readJson(ME_FILE, null);
  if (saved && saved.agent) return saved.agent;
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT) return 'claude-code';
  if (process.env.CURSOR_TRACE_ID || process.env.CURSOR_AGENT) return 'cursor';
  if (Object.keys(process.env).some((key) => key.startsWith('CODEX_'))) return 'codex';
  return 'agent';
}

export function identity() {
  const saved = readJson(ME_FILE, null);
  const me = process.env.HUB_ME || (saved && saved.me) || null;
  return { me, agent: detectAgent() };
}

function requireMe() {
  const { me } = identity();
  const ids = teamIds();
  if (!me) throw new UsageError(`Identity not set. Ask your person which one they are, then run: ${HUB} me <id>   (ids: ${ids.join(', ')})`);
  if (ids.length && !ids.includes(me)) throw new UsageError(`"${me}" is not in team.json. Run: ${HUB} me <id>   (ids: ${ids.join(', ')})`);
  return me;
}

/** @param {string} value */
function resolvePerson(value, { allowTeam = false } = {}) {
  const ids = teamIds();
  if (value === 'me') return requireMe();
  if (allowTeam && value === 'team') return 'team';
  if (ids.length && !ids.includes(value)) {
    throw new UsageError(`"${value}" is not a team id. Use one of: ${ids.join(', ')}${allowTeam ? ', team' : ''}`);
  }
  return value;
}

// ---------- git plumbing ----------

const LOCK_DIR = join(HUB_ROOT, '.git', 'hub-cli.lock');
const LOCK_STALE_MS = 120000;
const LOCK_WAIT_MS = 90000;

/**
 * Serialize git writes between hub processes on this clone (several agents, one checkout).
 * @template T @param {() => T} work @returns {T}
 */
export function withRepoLock(work) {
  const started = Date.now();
  let held = false;
  while (!held) {
    try {
      mkdirSync(LOCK_DIR);
      held = true;
    } catch (error) {
      if (!existsSync(join(HUB_ROOT, '.git'))) return work();
      try {
        if (Date.now() - statSync(LOCK_DIR).mtimeMs > LOCK_STALE_MS) rmSync(LOCK_DIR, { recursive: true, force: true });
      } catch {
        // lock vanished between checks; try again
      }
      if (Date.now() - started > LOCK_WAIT_MS) throw new UsageError('Another hub command has held the hub lock for 90s. If nothing else is running, delete .git/hub-cli.lock in the hub.');
      sleep(80 + Math.floor(Math.random() * 120));
    }
  }
  try {
    return work();
  } finally {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}

function hasRemote() {
  return git(['remote', 'get-url', 'origin']).ok;
}

/** True when the hub folder is the top of its own git repo, not a folder inside another one. */
function isOwnRepo() {
  const top = git(['rev-parse', '--show-toplevel']);
  if (!top.ok) return false;
  try {
    return realpathSync(top.out) === realpathSync(HUB_ROOT);
  } catch {
    return false;
  }
}

/**
 * `owner/name` (lowercase) from a git remote: the last two segments of a URL, an scp-style
 * address, or a local path, without `.git`. Credentials in the URL are ignored.
 * @param {string} url
 */
export function repoFromUrl(url) {
  const cleaned = String(url ?? '').trim().replace(/[/\\]+$/, '').replace(/\.git$/i, '');
  const parts = cleaned.split(/[/:\\]/).filter(Boolean);
  return parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`.toLowerCase() : '';
}

/**
 * Whether this folder is a real team hub, the only place the automatic hooks may act:
 * hub.repo is set in hub.config.json, the folder is the top of its own git repo, and origin
 * is that repo. A checkout of the template inside another repo, or a fork, fails the check.
 * HUB_HOOKS=off turns the hooks off on one machine.
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function hubCheck() {
  if (/^(0|off|false|no)$/i.test(process.env.HUB_HOOKS ?? '')) return { ok: false, reason: 'HUB_HOOKS is off' };
  const config = loadConfig(HUB_ROOT);
  if (config.error || !config.data) return { ok: false, reason: `${CONFIG_FILE} does not load` };
  const repo = config.data.hub.repo;
  if (!repo) return { ok: false, reason: `hub.repo is not set in ${CONFIG_FILE}` };
  if (!isOwnRepo()) return { ok: false, reason: 'the hub folder is not the top of its own git repo' };
  const origin = git(['remote', 'get-url', 'origin']);
  if (!origin.ok) return { ok: false, reason: 'no origin remote' };
  if (repoFromUrl(origin.out) !== repo.toLowerCase()) return { ok: false, reason: `origin is not ${repo}` };
  return { ok: true, reason: null };
}

/** A git operation left half done in a clone, or null. @param {string} [cwd] */
function stuckOperation(cwd = HUB_ROOT) {
  for (const [marker, what] of [['rebase-merge', 'a rebase'], ['rebase-apply', 'a rebase'], ['MERGE_HEAD', 'a merge'], ['CHERRY_PICK_HEAD', 'a cherry-pick']]) {
    const path = git(['rev-parse', '--git-path', marker], { cwd });
    if (path.ok && existsSync(resolve(cwd, path.out))) return what;
  }
  return null;
}

/** The fix for local hub commits that conflict with origin. @param {string[]} files @param {string} branch */
function conflictFix(files, branch) {
  return [
    `your hub commits conflict with origin in ${files.length ? files.join(', ') : 'a file someone else edited too'}. They are safe on this machine but NOT shared, and every later write stays local until this is fixed.`,
    `Fix by hand: cd "${HUB_ROOT}"; git pull --rebase origin ${branch}; edit each conflicting file to keep both changes; git add <file>; git rebase --continue; then ${HUB} sync.`,
  ].join('\n');
}

function currentBranch() {
  const result = git(['symbolic-ref', '--short', 'HEAD']);
  return result.ok ? result.out : 'main';
}

function headSha() {
  const result = git(['rev-parse', '-q', '--verify', 'HEAD']);
  return result.ok ? result.out : null;
}

function remoteBranchExists(branch) {
  return git(['rev-parse', '-q', '--verify', `refs/remotes/origin/${branch}`]).ok;
}

function aheadBehind(branch) {
  const result = git(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`]);
  if (!result.ok) return { ahead: 0, behind: 0 };
  const [ahead, behind] = result.out.split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}

/** Rebase local commits onto origin. Never force. @returns {{ ok: boolean, error: string|null }} */
function pullRebase(branch) {
  const pulled = git(['pull', '--rebase', '--autostash', '-q', 'origin', branch], { timeoutMs: 60000 });
  if (pulled.ok) return { ok: true, error: null };
  if (/couldn't find remote ref/i.test(pulled.err)) return { ok: true, error: null };
  if (stuckOperation()) {
    const files = git(['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
    git(['rebase', '--abort']);
    return { ok: false, error: conflictFix(files, branch) };
  }
  return { ok: false, error: pulled.err.split('\n').slice(-2).join(' ') || 'git pull failed' };
}

/** Make sure origin has this branch; the hub only ever pushes a branch origin already has. @param {string} branch */
function originHasBranch(branch) {
  if (remoteBranchExists(branch)) return true;
  git(['fetch', '-q', 'origin'], { timeoutMs: 20000 });
  return remoteBranchExists(branch);
}

/**
 * Push HEAD with pull --rebase and jittered retry. Never force-pushes, and never pushes a branch
 * origin does not already have (a local work branch stays local).
 * `beforeRetry` runs after each rebase onto origin; returning a message stops the push.
 * @param {{ beforeRetry?: () => string|null }} [options]
 * @returns {{ pushed: boolean, error: string|null, note: string|null, aborted?: string }}
 */
export function pushWithRetry(options = {}) {
  if (!hasRemote()) return { pushed: false, error: null, note: 'No remote "origin" yet, so it is committed locally only. Once origin is added, ./hub sync pushes it.' };
  const branch = currentBranch();
  if (!originHasBranch(branch)) {
    return { pushed: false, error: `the hub is on branch ${branch}, which origin does not have, and the hub never pushes a new branch. Switch back: git -C "${HUB_ROOT}" checkout main, then ${HUB} sync.`, note: null };
  }
  let lastError = '';
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    const pushed = git(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], { timeoutMs: 60000 });
    if (pushed.ok) return { pushed: true, error: null, note: attempt > 1 ? `pushed on attempt ${attempt}` : null };
    lastError = pushed.err.split('\n').filter(Boolean).slice(-2).join(' ');
    if (/rejected|fetch first|non-fast-forward|failed to push some refs|cannot lock ref|stale info/i.test(pushed.err)) {
      const rebased = pullRebase(branch);
      if (!rebased.ok) return { pushed: false, error: rebased.error, note: null };
      const stop = options.beforeRetry ? options.beforeRetry() : null;
      if (stop) return { pushed: false, error: null, note: null, aborted: stop };
    }
    if (attempt < PUSH_ATTEMPTS) sleep(Math.min(4000, 250 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400));
  }
  return { pushed: false, error: lastError || 'push failed', note: null };
}

/** Bring the hub up to date before writing, quietly. Offline is fine. */
function freshen() {
  if (!hasRemote()) return;
  withRepoLock(freshenUnlocked);
}

function freshenUnlocked() {
  const branch = currentBranch();
  if (!git(['fetch', '-q', 'origin'], { timeoutMs: 20000 }).ok) return;
  if (!remoteBranchExists(branch)) return;
  const { behind } = aheadBehind(branch);
  if (behind > 0) pullRebase(branch);
}

/** @param {string} by */
function commitPaths(paths, message, by) {
  // A hub folder inside another repo (the template in its source repo, say) must never commit there.
  if (!isOwnRepo()) return { ok: false, error: `${HUB_ROOT} is not the top of its own git repo, so the hub will not commit or push from it. A team hub is its own repo: create one with the scaffolder, or run git init here.` };
  const added = git(['add', '--', ...paths]);
  if (!added.ok) return { ok: false, error: added.err };
  const identityArgs = [];
  /** @type {Record<string, string|undefined>} */
  let env = {};
  const person = teamPeople().find((entry) => entry.id === by);
  if (person && person.commitEmail) {
    // Author every hub commit as the acting person, so GitHub credits their account.
    identityArgs.push('-c', `user.name=${person.name || by}`, '-c', `user.email=${person.commitEmail}`);
    env = { GIT_AUTHOR_NAME: undefined, GIT_AUTHOR_EMAIL: undefined, GIT_COMMITTER_NAME: undefined, GIT_COMMITTER_EMAIL: undefined };
  } else {
    if (!git(['config', 'user.email']).ok) identityArgs.push('-c', `user.email=${by}@hub.invalid`);
    if (!git(['config', 'user.name']).ok) identityArgs.push('-c', `user.name=${by}`);
  }
  const committed = git([...identityArgs, 'commit', '-q', '--no-verify', '-m', message, '--', ...paths], { env });
  if (!committed.ok) return { ok: false, error: committed.err || committed.out };
  return { ok: true, error: null };
}

/** What a Stop check needs: local hub commits not on origin, and event files never committed. */
export function pendingHubWork() {
  const dirtyEvents = git(['status', '--porcelain', '--untracked-files=all', '--', 'events']).out.split('\n').filter(Boolean).length;
  let unpushed = 0;
  if (hasRemote()) {
    const branch = currentBranch();
    if (remoteBranchExists(branch)) unpushed = aheadBehind(branch).ahead;
    else if (headSha()) unpushed = Number(git(['rev-list', '--count', 'HEAD']).out) || 0;
  }
  return { unpushed, dirtyEvents };
}

// ---------- the board ----------

function board() {
  const loaded = loadBoard(HUB_ROOT);
  return loaded.data;
}

/** @param {any} b @param {string} id */
function findObject(b, id) {
  const kind = refKind(id);
  const lists = { item: b.items, question: b.questions, decision: b.decisions, gate: b.gates, session: b.sessions };
  return kind ? { kind, object: lists[kind].find((entry) => entry.id === id) ?? null } : { kind: null, object: null };
}

/** @param {string} id @param {string} expectedKind */
function requireObject(id, expectedKind) {
  if (!id) throw new UsageError(`Missing the ${expectedKind} id.`);
  if (refKind(id) !== expectedKind) throw new UsageError(`"${id}" is not a ${expectedKind} id (${expectedKind} ids start with ${expectedKind[0]}-).`);
  const b = board();
  const found = findObject(b, id);
  if (!found.object) throw new UsageError(`No ${expectedKind} ${id} on the board. Run ${HUB} sync, then ${HUB} status.`);
  return { b, object: found.object };
}

/** Parse `## Deadlines` from kb/playbook.md. */
export function readDeadlines(root = HUB_ROOT) {
  const path = join(root, 'kb', 'playbook.md');
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n');
  const deadlines = [];
  let inDeadlines = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) inDeadlines = /^##\s+Deadlines\b/i.test(line);
    if (!inDeadlines) continue;
    const match = /^\s*-\s*([^|]+?)\s*\|\s*([^|]+?)\s*(?:\|\s*kind:\s*(\S+))?\s*$/.exec(line);
    if (!match || Number.isNaN(Date.parse(match[1]))) continue;
    deadlines.push({ at: match[1], title: match[2], kind: match[3] ?? 'deadline' });
  }
  return deadlines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const SUBMIT_TITLE = /\bsubmi(t|ssion)/i;

/**
 * The playbook's deadlines plus event.submitBy from hub.config.json, unless the playbook already
 * lists a submission deadline (the same rule the board follows).
 * @param {{ at: string, title: string, kind: string }[]} deadlines @param {string} [root]
 */
export function withSubmitBy(deadlines, root = HUB_ROOT) {
  const submitBy = configOrDefault(root).event.submitBy;
  if (!submitBy || Number.isNaN(Date.parse(submitBy)) || deadlines.some((d) => SUBMIT_TITLE.test(d.title))) return deadlines;
  return [...deadlines, { at: submitBy, title: 'Submissions due', kind: 'deadline' }].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// ---------- event descriptions ----------

const VERBS = {
  'item.add': 'added',
  'item.claim': 'claimed',
  'item.update': 'updated',
  'item.block': 'is blocked on',
  'item.done': 'finished',
  note: 'noted',
  'question.ask': 'asked',
  'question.answer': 'answered',
  'question.settle': 'settled',
  'decision.propose': 'proposed decision',
  'decision.accept': 'accepted decision',
  'decision.reject': 'rejected decision',
  'gate.add': 'added gate',
  'gate.propose': 'says this gate is ready:',
  'gate.pass': 'passed gate',
  'gate.fail': 'failed gate',
  'kb.update': 'updated',
  'session.start': 'started working on',
  'session.end': 'ended session',
  comment: 'commented on',
};

/** @param {any} event @param {any} b */
export function describeEvent(event, b) {
  const verb = VERBS[event.type] ?? event.type;
  const target = event.ref ? findObject(b, event.ref).object : null;
  const targetTitle = target ? target.title ?? target.focus : null;
  let line;
  if (event.type === 'kb.update') line = `${event.data.change === 'new' ? 'added' : 'updated'} [[${event.data.page}]]: "${event.title}"`;
  else if (event.type === 'note') line = `noted${event.ref ? ` on ${event.ref}` : ''}: "${event.title}"`;
  else if (event.type === 'question.answer' || event.type === 'comment') line = `${verb} ${event.ref}${targetTitle ? ` "${clip(targetTitle, 60)}"` : ''}: "${clip(event.title, 100)}"`;
  else if (['item.add', 'question.ask', 'decision.propose', 'gate.add', 'session.start'].includes(event.type)) line = `${verb} ${event.ref} "${event.title}"`;
  else line = `${verb} ${event.ref ?? ''} "${clip(targetTitle ?? event.title, 80)}"`;
  if (event.type === 'question.ask' && event.data.for) line += ` (for ${event.data.for})`;
  if (event.type === 'item.block' && event.data.needs) line += ` (needs ${event.data.needs})`;
  if (event.type === 'item.claim' && event.data.why) line += `, why: ${clip(event.data.why, 80)}`;
  if (event.via === 'human') line += ' [by hand]';
  return line;
}

/** @param {any} event */
function actorLabel(event) {
  return event.via === 'agent' ? `${event.by} (${event.agent ?? 'agent'})` : `${event.by} (${event.via})`;
}

// ---------- write path ----------

/** Human-only types need --human, typed by a person. @param {string} type @param {any} flags */
function refuseUnlessHuman(type, flags) {
  if (HUMAN_ONLY_TYPES.includes(type) && !flags.human) {
    throw new UsageError(
      'That one is for a person, and it is optional.',
    );
  }
}

/**
 * Create, commit, and push one event. `silent` prints nothing and returns the outcome instead.
 * `guard` runs after each rebase onto origin, before the push is retried; a message it returns
 * withdraws the local commit and fails the command with that message.
 * @param {{ type: string, ref?: string, title: string, text?: string, data?: any, extraPaths?: string[], flags: any, successLine: (id: string) => string, silent?: boolean, guard?: (event: any) => string|null }} spec
 * @returns {{ event: any, pushed: boolean, error?: string|null, aborted?: boolean }}
 */
function postEvent(spec) {
  const me = requireMe();
  refuseUnlessHuman(spec.type, spec.flags);
  const envVia = process.env.HUB_VIA;
  const via = spec.flags.human ? 'human' : envVia === 'web' || envVia === 'human' ? envVia : 'agent';
  const made = makeEvent({
    by: me,
    via,
    agent: identity().agent,
    type: spec.type,
    ref: spec.ref,
    title: spec.title,
    text: spec.text,
    data: spec.data ?? {},
  });
  if (made.error || !made.data) throw new UsageError(`Event not written: ${made.error}`);
  const event = made.data;
  const relPath = eventRelPath(event);
  mkdirSync(dirname(join(HUB_ROOT, relPath)), { recursive: true });
  writeFileSync(join(HUB_ROOT, relPath), JSON.stringify(event, null, 2) + '\n');

  const headline = spec.successLine(event.ref ?? event.id);
  if (spec.silent) {
    const paths = [relPath, ...(spec.extraPaths ?? [])];
    const message = `hub: ${event.by} ${event.type}${event.ref ? ` ${event.ref}` : ''} ${clip(event.title, 72)}`;
    return withRepoLock(() => {
      const commitResult = commitPaths(paths, message, me);
      if (!commitResult.ok) return { event, pushed: false, error: commitResult.error };
      const push = pushWithRetry();
      return { event, pushed: push.pushed, error: push.error };
    });
  }
  if (spec.flags['no-commit']) {
    console.log(`${headline}\nWrote ${relPath} (not committed, --no-commit).`);
    return { event, pushed: false };
  }
  const paths = [relPath, ...(spec.extraPaths ?? [])];
  const message = `hub: ${event.by} ${event.type}${event.ref ? ` ${event.ref}` : ''} ${clip(event.title, 72)}`;
  const { committed, push } = withRepoLock(() => {
    const commitResult = commitPaths(paths, message, me);
    if (!commitResult.ok) return { committed: commitResult, push: null };
    const pushResult = pushWithRetry({ beforeRetry: spec.guard ? () => spec.guard(event) : undefined });
    if (pushResult.aborted) withdrawLastCommit(relPath);
    return { committed: commitResult, push: pushResult };
  });
  if (!committed.ok || !push) {
    console.log(headline);
    console.error(`Wrote ${relPath} but git commit failed: ${committed.error}\nRun ${HUB} doctor.`);
    process.exitCode = 2;
    return { event, pushed: false };
  }
  if (push.aborted) {
    console.error(push.aborted);
    process.exitCode = 1;
    return { event, pushed: false, aborted: true };
  }
  console.log(headline);
  if (push.pushed) console.log(`Pushed. Teammates see it on their next sync.${push.note ? ` (${push.note})` : ''}`);
  else if (push.error) {
    console.error(`Committed locally but NOT pushed: ${push.error}\nThe event is safe in your clone. Run ${HUB} sync to retry, or ${HUB} doctor to diagnose.`);
    process.exitCode = 2;
  } else console.log(push.note);
  return { event, pushed: push.pushed };
}

/**
 * Take back the event commit a guard refused, before it was ever pushed. Only when HEAD is
 * exactly that commit; anything else stays as it is.
 * @param {string} relPath
 */
function withdrawLastCommit(relPath) {
  const touched = git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).out.split('\n').filter(Boolean);
  if (touched.length !== 1 || touched[0] !== relPath) return;
  if (!git(['reset', '-q', 'HEAD~1']).ok) return;
  rmSync(join(HUB_ROOT, relPath), { force: true });
}

/** Title from the first line of text; the rest goes to text. @param {string} input */
function splitTitle(input, extraText) {
  const full = String(input ?? '').trim();
  const [firstLine, ...rest] = full.split('\n');
  const title = clip(firstLine.trim(), TITLE_MAX);
  const overflow = firstLine.trim().length > TITLE_MAX || rest.join('\n').trim();
  const pieces = [];
  if (overflow) pieces.push(full);
  if (extraText) pieces.push(String(extraText));
  return { title, text: pieces.length ? pieces.join('\n\n') : undefined };
}

/** @param {any} args @param {number} index @param {string} what */
function needText(args, index, what) {
  const value = args._.slice(index).join(' ').trim() || (args.text !== undefined ? String(lastValue(args.text)) : '');
  if (!value) throw new UsageError(`Missing ${what}.`);
  return value;
}

/** Repo, branch, commit of the git repo the agent is standing in, if it is not the hub. */
function workingRepoContext() {
  const cwd = process.cwd();
  const top = git(['rev-parse', '--show-toplevel'], { cwd });
  if (!top.ok || resolve(top.out) === resolve(HUB_ROOT)) return {};
  const remote = git(['remote', 'get-url', 'origin'], { cwd });
  const repo = remote.ok ? basename(remote.out).replace(/\.git$/, '') : basename(top.out);
  const branch = git(['symbolic-ref', '--short', 'HEAD'], { cwd });
  const commit = git(['rev-parse', '--short', 'HEAD'], { cwd });
  return { repo, ...(branch.ok ? { branch: branch.out } : {}), ...(commit.ok ? { commit: commit.out } : {}) };
}

const LANE_ALIASES = { next: 'up_next', up: 'up_next', todo: 'up_next', flight: 'in_flight', doing: 'in_flight', wip: 'in_flight', blocked: 'needs_human', human: 'needs_human', needs: 'needs_human' };

/** @param {string} value */
function normalizeLane(value) {
  const lane = LANE_ALIASES[value] ?? String(value).replace('-', '_');
  if (!LANES.includes(lane)) throw new UsageError(`Lane must be one of ${LANES.join(', ')}.`);
  return lane;
}

// ---------- commands ----------

/** @type {Record<string, { usage: string, summary: string, details?: string, run: (args: any) => void }>} */
const COMMANDS = {};

COMMANDS.me = {
  usage: 'hub me <id> [--agent <tool name, for example claude-code, devin, cursor, codex>]',
  summary: 'Set who you are on this machine (stored in .hub-me, never committed).',
  details: 'Env overrides: HUB_ME (id), HUB_AGENT (tool name), HUB_VIA (agent|human). On a machine that does not keep files between sessions (a cloud agent), set HUB_ME and HUB_AGENT instead of running this. With no id, prints the current identity.',
  run(args) {
    const id = args._[0];
    if (!id) {
      const current = identity();
      console.log(current.me ? `You are ${current.me} (agent: ${current.agent}).` : `Identity not set. Run: ${HUB} me <id>   (ids: ${teamIds().join(', ')})`);
      return;
    }
    const ids = teamIds();
    if (ids.length && !ids.includes(id)) throw new UsageError(`"${id}" is not in team.json. Use one of: ${ids.join(', ')}`);
    const saved = { me: id, ...(args.agent ? { agent: String(args.agent) } : {}) };
    writeJsonAtomic(ME_FILE, saved);
    console.log(`You are ${id}. Saved to .hub-me (gitignored).`);
  },
};

COMMANDS.sync = {
  usage: 'hub sync [--quiet-if-unchanged]',
  summary: 'Pull the hub and say in plain words what changed since you last synced.',
  details: 'Fetches, fast-forwards or rebases (never force), pushes any waiting local hub commits, then lists new events by person, kb pages and protocol files that changed, questions for you and the team, and calls on record that are new since your last sync.',
  run(args) {
    const report = syncReport({ quiet: Boolean(args['quiet-if-unchanged']), key: args.key ? String(args.key) : 'cli' });
    if (report.text) console.log(report.text);
    if (!report.ok) process.exitCode = 2;
  },
};

/** @param {{ quiet?: boolean, key?: string, now?: number }} options @returns {string} */
export function runSync(options = {}) {
  return syncReport(options).text;
}

/**
 * @param {{ quiet?: boolean, key?: string, now?: number }} options
 * @returns {{ text: string, ok: boolean }} text to show (empty when quiet and nothing changed);
 *   ok is false when local hub commits could not be shared
 */
export function syncReport(options = {}) {
  const key = options.key ?? 'cli';
  const now = options.now ?? Date.now();
  const warnings = [];
  const lines = [];
  /** @type {string[]} */
  const failures = [];
  const branch = currentBranch();

  withRepoLock(() => syncWithOrigin(branch, warnings, lines, failures));

  const head = headSha();
  const state = loadState();
  const seenEntries = Object.values(state.seen ?? {}).filter((entry) => entry && entry.sha);
  const latestSeenOnClone = seenEntries.sort((x, y) => (x.at < y.at ? 1 : -1))[0]?.sha ?? null;
  const lastSeen = state.seen?.[key]?.sha ?? latestSeenOnClone;
  const lastSyncAt = state.seen?.[key]?.at ?? null;
  const b = board();
  const me = identity().me;
  let changed = false;

  if (head && lastSeen && lastSeen !== head && git(['cat-file', '-e', `${lastSeen}^{commit}`]).ok) {
    changed = true;
    const diff = git(['diff', '--name-status', '--no-renames', lastSeen, head]);
    const entries = diff.ok ? diff.out.split('\n').filter(Boolean).map((row) => row.split('\t')) : [];
    const newEvents = [];
    for (const [status, path] of entries) {
      if (status === 'A' && /^events\/.+\.json$/.test(path)) {
        const parsed = readJson(join(HUB_ROOT, path), null);
        const valid = validateEvent(parsed);
        if (valid.ok && valid.event.type !== 'pulse') newEvents.push(valid.event);
      }
    }
    newEvents.sort((x, y) => (x.at < y.at ? -1 : 1));
    if (newEvents.length) {
      lines.push(`New on the hub (${newEvents.length} event${newEvents.length === 1 ? '' : 's'}):`);
      const byActor = new Map();
      for (const event of newEvents) {
        const label = actorLabel(event);
        if (!byActor.has(label)) byActor.set(label, []);
        byActor.get(label).push(event);
      }
      const maxPerPerson = 6;
      for (const [label, events] of byActor) {
        const shown = events.slice(-maxPerPerson);
        for (const event of shown) lines.push(`  ${label} ${describeEvent(event, b)}`);
        if (events.length > shown.length) lines.push(`  ${label} ... and ${events.length - shown.length} earlier event(s); see ${HUB} status`);
      }
    }
    const kbChanged = entries.filter(([, path]) => /^kb\/.+\.md$/.test(path));
    if (kbChanged.length) {
      const labels = kbChanged.slice(0, 8).map(([status, path]) => `${path.replace(/\.md$/, '')}${status === 'A' ? ' (new)' : status === 'D' ? ' (deleted)' : ''}`);
      lines.push(`KB pages changed: ${labels.join(', ')}${kbChanged.length > 8 ? ` and ${kbChanged.length - 8} more` : ''}. Read the ones that touch your work.`);
    }
    const protocol = entries.map(([, path]) => path).filter((path) => path === 'AGENTS.md' || path === 'docs/CONTRACT.md');
    if (protocol.length) lines.push(`PROTOCOL CHANGED: ${protocol.join(' and ')}. Re-read before your next action.`);
    if (entries.some(([, path]) => path.startsWith('scripts/') || path.startsWith('lib/hub/'))) lines.push('The hub CLI was updated; it applies on your next command.');
    if (entries.some(([, path]) => path === 'team.json')) lines.push('team.json changed.');
  } else if (head && !lastSeen) {
    changed = true;
    lines.push(`First sync from here. The hub has ${b.items.length} item(s), ${b.questions.filter((q) => q.status === 'open').length} open question(s), ${b.gates.length} gate(s). Run ${HUB} status for the board.`);
    const recent = b.activity.slice(0, 8).reverse();
    if (recent.length) {
      lines.push('Most recent on the hub:');
      for (const event of recent) lines.push(`  ${actorLabel(event)} ${describeEvent(event, b)} (${ago(event.at, now)})`);
    }
  }

  if (head) {
    updateState((s) => {
      s.seen = s.seen ?? {};
      s.seen[key] = { sha: head, at: new Date(now).toISOString() };
      const cutoff = now - 3 * 24 * 3600 * 1000;
      for (const [seenKey, value] of Object.entries(s.seen)) {
        if (seenKey !== 'cli' && Date.parse(value.at) < cutoff) delete s.seen[seenKey];
      }
    });
  }

  if (options.quiet && !changed && warnings.length === 0 && failures.length === 0) return { text: '', ok: true };

  const forMe = me ? b.questions.filter((q) => q.status === 'open' && q.for === me) : [];
  const forTeam = b.questions.filter((q) => q.status === 'open' && q.for === 'team' && q.askedBy !== me);
  if (forMe.length) {
    lines.push(`Questions for you (${me}):`);
    for (const q of forMe.slice(0, 5)) lines.push(`  ${q.id} from ${q.askedBy}: "${q.title}" (${q.answers.length} answer(s), ${ago(q.askedAt, now)})`);
  }
  if (forTeam.length) {
    lines.push('Questions for the team (answer with hub answer <q-id> "..." if the code or KB tells you):');
    for (const q of forTeam.slice(0, 5)) lines.push(`  ${q.id} from ${q.askedBy}: "${q.title}" (${q.answers.length} answer(s))`);
    if (forTeam.length > 5) lines.push(`  ... and ${forTeam.length - 5} more`);
  }
  const newCalls = b.decisions
    .filter((d) => d.status === 'proposed' && (!lastSyncAt || d.proposedAt > lastSyncAt))
    .sort((x, y) => (x.proposedAt < y.proposedAt ? 1 : -1));
  if (newCalls.length) {
    lines.push('Calls on record (object on the board if you disagree):');
    for (const d of newCalls.slice(0, 3)) lines.push(`  ${d.id} "${clip(d.title, 80)}" (from ${d.proposedBy})`);
  }
  if (b.rejected.length) lines.push(`${b.rejected.length} event file(s) fail validation; see ${HUB} status --json (rejected).`);
  if (!me) lines.push(`Identity not set. Ask your person which teammate they are, then run: ${HUB} me <id>`);
  if (me) {
    try {
      const clone = projectClone();
      if (clone) lines.push(...pulseAdvice(clone, me, b, { now, withPr: false }).filter((line) => !/^(Local|Pushed|PR #)/.test(line)));
    } catch {
      // advice is a convenience; never fail a sync over it
    }
  }

  const sha = head ? head.slice(0, 7) : 'no commits yet';
  if (failures.length) {
    const header = `Hub NOT synced (local state at ${sha}): ${failures.join('\n')}`;
    return { text: [header, ...warnings, ...lines].join('\n'), ok: false };
  }
  const header = `Hub synced at ${sha}.${changed ? '' : ' Nothing new since your last sync.'}`;
  return { text: [header, ...warnings, ...lines].join('\n'), ok: true };
}


/**
 * Fetch, fast-forward or rebase, and push waiting commits. Caller holds the repo lock.
 * Anything that leaves local hub commits unshared goes in `failures`.
 * @param {string} branch @param {string[]} warnings @param {string[]} lines @param {string[]} failures
 */
function syncWithOrigin(branch, warnings, lines, failures) {
  if (!hasRemote()) {
    warnings.push('No remote "origin" yet; the hub is local only. Nothing is shared until origin is added.');
    return;
  }
  const stuck = stuckOperation();
  if (stuck) {
    failures.push(`the hub clone is in the middle of ${stuck}, so nothing can be pulled or pushed. Finish it (git -C "${HUB_ROOT}" status shows how) or undo it (git -C "${HUB_ROOT}" ${stuck === 'a merge' ? 'merge' : stuck === 'a rebase' ? 'rebase' : 'cherry-pick'} --abort), then ${HUB} sync.`);
    return;
  }
  const fetched = git(['fetch', '-q', 'origin'], { timeoutMs: 25000 });
  if (!fetched.ok) warnings.push(`Could not reach origin (${clip(fetched.err.split('\n').pop() ?? '', 120)}). Showing local state.`);
  else if (remoteBranchExists(branch)) {
    let { ahead, behind } = aheadBehind(branch);
    if (behind > 0) {
      const merged = ahead === 0 ? git(['merge', '-q', '--ff-only', `origin/${branch}`]) : { ok: false };
      if (!merged.ok) {
        const rebased = pullRebase(branch);
        if (!rebased.ok) {
          failures.push(rebased.error ?? 'git pull failed');
          return;
        }
      }
      ({ ahead, behind } = aheadBehind(branch));
    }
    if (ahead > 0) {
      const push = pushWithRetry();
      if (push.pushed) lines.push(`Pushed ${ahead} hub commit(s) that were waiting on this machine.`);
      else failures.push(`${ahead} hub commit(s) on this machine are not pushed: ${push.error}`);
    }
  } else if (headSha()) {
    // Never push a branch origin does not have: it is someone's local work, not the hub.
    warnings.push(`This clone is on branch ${branch}, which origin does not have; nothing was pushed. The hub lives on main: git -C "${HUB_ROOT}" checkout main`);
  }
}

// ---------- pulses ----------

const PULSE_FETCH_EVERY_MS = 2 * 60 * 1000;
const PULSE_RESEND_AFTER_MS = 5 * 60 * 1000;

/** Fetch the clone's origin at most once every 2 minutes (remembered in .hub-state.json). @param {string} clone @param {number} now */
function fetchProjectThrottled(clone, now) {
  const last = loadState().pulse?.[clone]?.fetchedAt;
  if (last && now - Date.parse(last) < PULSE_FETCH_EVERY_MS) return;
  git(['fetch', '-q', 'origin'], { cwd: clone, timeoutMs: 20000 });
  updateState((state) => {
    state.pulse = state.pulse ?? {};
    state.pulse[clone] = { ...(state.pulse[clone] ?? {}), fetchedAt: new Date(now).toISOString() };
  });
}

/**
 * The few lines that matter to `me` in this clone: overlaps, pull advice, PR advice.
 * @param {string} clone @param {string} me @param {any} b folded board @param {{ now?: number, gathered?: any, withPr?: boolean }} [options]
 */
function pulseAdvice(clone, me, b, options = {}) {
  const now = options.now ?? Date.now();
  if (!options.gathered) fetchProjectThrottled(clone, now);
  const gathered = options.gathered ?? gatherPulse(clone);
  const lines = overlapLines(b, me, gathered.repo, gathered.files, { now, hub: HUB });
  const pull = pullAdvice(gathered);
  if (pull) lines.push(pull);
  if (options.withPr !== false) {
    const pr = prAdvice(gathered, HUB);
    if (pr) lines.push(pr);
  }
  return lines;
}

COMMANDS.pulse = {
  usage: 'hub pulse ["<what and why, one line>"] [--repo <path>] [--pr <number|url>] [--auto] [--quiet]',
  summary: 'Tell the hub what this clone is working on (branch, files, PR), and get back only what matters to you: overlaps, when to rebase, when to merge.',
  details: [
    'Run inside the project clone, or pass --repo. Fetches origin at most every 2 minutes. Finds the PR with gh when it answers within 5 seconds.',
    'Skips the write when branch, pushed state, and PR are unchanged and the last pulse is under 5 minutes old, unless you give a message.',
    '--auto is for git hooks: prints only when the advice changed, fixes a bot or placeholder git identity silently, never fails. --quiet drops the receipt line.',
  ].join('\n'),
  run(args) {
    if (!args.auto) return runPulse(args);
    try {
      runPulse(args);
    } catch {
      // hooks never fail
    }
    process.exitCode = 0;
  },
};

/** @param {any} args */
function runPulse(args) {
  const auto = Boolean(args.auto);
  const now = Date.now();
  const people = teamPeople();
  let me;
  if (auto) {
    // Started by a hook: act only for a real hub, never for a template checkout or a fork.
    if (!hubCheck().ok) return;
    me = identity().me;
    if (!me || !people.some((person) => person.id === me)) return;
  } else me = requireMe();
  const clone = projectClone(args);
  if (!clone) {
    if (auto) return;
    const hubPath = `"${join(HUB_ROOT, 'hub')}"`;
    throw new UsageError(`Run pulse inside the project clone (not the hub), because a pulse reports what a project clone is working on. From the clone: ${hubPath} pulse "<what and why>". From anywhere: ${HUB} pulse --repo <path to the clone>. No project clone yet (kb/project-repo.md names the repo once it exists)? There is nothing to pulse; skip it.`);
  }
  const cloneState = () => loadState().pulse?.[clone] ?? {};
  if (auto) {
    for (const marker of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD']) {
      const path = git(['rev-parse', '--git-path', marker], { cwd: clone });
      if (path.ok && existsSync(resolve(clone, path.out))) return;
    }
    const running = cloneState().runningAt;
    if (running && now - Date.parse(running) < 20000) return;
    updateState((state) => {
      state.pulse = state.pulse ?? {};
      state.pulse[clone] = { ...(state.pulse[clone] ?? {}), runningAt: new Date(now).toISOString() };
    });
    checkIdentity(clone, me, people);
  }
  fetchProjectThrottled(clone, now);
  const gathered = gatherPulse(clone);
  const pr = args.pr ? parsePrFlag(String(lastValue(args.pr))) : gathered.branch && gathered.branch !== 'main' ? findPr(clone) : null;
  if (args.pr && !pr) throw new UsageError('--pr takes a PR number or its URL.');
  const message = args._.join(' ').trim();
  const flying = board().items.filter((item) => item.owner === me && item.lane === 'in_flight');
  const data = {
    repo: gathered.repo,
    ...(gathered.branch ? { branch: gathered.branch } : {}),
    pushed: gathered.pushed,
    ahead: gathered.ahead,
    behind: gathered.behind,
    files: gathered.files,
    ...(pr ? { pr: { number: pr.number, url: pr.url, ...(pr.state !== 'open' ? { state: pr.state } : {}) } } : {}),
    ...(flying.length === 1 ? { item: flying[0].id } : {}),
    ...(message ? { note: clip(message, 200) } : {}),
  };
  const last = cloneState().last;
  const unchanged = last && last.branch === (gathered.branch ?? null) && last.pushed === gathered.pushed && (last.pr ?? null) === (pr ? `${pr.number}:${pr.state}` : null) && now - Date.parse(last.at) < PULSE_RESEND_AFTER_MS;
  let receipt;
  if (unchanged && !message) receipt = `Pulse unchanged since ${formatSpan(now - Date.parse(last.at))} ago; not re-sent.`;
  else {
    const title = message || `${gathered.branch ?? 'detached HEAD'}: ${gathered.files.length} file${gathered.files.length === 1 ? '' : 's'}${gathered.pushed ? ', pushed' : ''}`;
    const result = postEvent({ type: 'pulse', title, data, flags: args, silent: true, successLine: () => '' });
    updateState((state) => {
      state.pulse = state.pulse ?? {};
      state.pulse[clone] = { ...(state.pulse[clone] ?? {}), last: { branch: gathered.branch ?? null, pushed: gathered.pushed, pr: pr ? `${pr.number}:${pr.state}` : null, at: new Date(now).toISOString() } };
    });
    const where = `${gathered.branch ?? 'detached HEAD'}, ${gathered.files.length} file${gathered.files.length === 1 ? '' : 's'}, ${gathered.pushed ? 'pushed' : 'local'}${pr ? `, PR #${pr.number}` : ''}`;
    if (result.error && !result.pushed) {
      receipt = `Pulse saved in the hub clone but not pushed (${clip(result.error, 100)}); ${HUB} sync retries.`;
      if (!auto) process.exitCode = 2;
    } else receipt = `Pulse sent (${where}).`;
  }
  const advice = pulseAdvice(clone, me, board(), { now, gathered: { ...gathered, pr } });
  const adviceText = advice.join('\n');
  if (auto) {
    const previous = cloneState().advice ?? '';
    updateState((state) => {
      state.pulse[clone] = { ...(state.pulse[clone] ?? {}), advice: adviceText, runningAt: null };
    });
    if (adviceText && adviceText !== previous) console.log(adviceText);
    return;
  }
  const out = args.quiet ? advice : [receipt, ...advice];
  if (out.length) console.log(out.join('\n'));
}

COMMANDS.who = {
  usage: 'hub who [--json]',
  summary: 'One line per teammate: agent, item, branch, PR, files, how far behind main, last pulse. Then any overlaps. Read this before touching a shared file or another lane.',
  run(args) {
    console.log(renderWho({ json: Boolean(args.json) }));
  },
};

/** @param {{ json?: boolean, now?: number }} options */
export function renderWho(options = {}) {
  const now = options.now ?? Date.now();
  const b = loadBoard(HUB_ROOT, { now }).data;
  if (options.json) return JSON.stringify({ people: b.people.map((person) => ({ id: person.id, pulse: person.pulses[0] ?? null, inFlight: b.items.filter((item) => item.owner === person.id && item.lane === 'in_flight').map((item) => item.id) })), overlaps: b.overlaps }, null, 2);
  const out = [];
  for (const person of b.people) {
    const pulse = person.pulses[0];
    const flying = b.items.filter((item) => item.owner === person.id && item.lane === 'in_flight').map((item) => item.id);
    if (!pulse) {
      out.push(`${person.id.padEnd(6)} no pulse yet${flying.length ? `; in flight: ${flying.join(', ')}` : ''}${person.lastSeenAt ? `; last seen ${ago(person.lastSeenAt, now)}` : ''}`);
      continue;
    }
    const parts = [
      pulse.agent ?? 'agent',
      pulse.item ?? (flying.length ? flying.join(',') : 'no item'),
      `${pulse.branch ?? 'detached'} (${pulse.pushed ? 'pushed' : 'local'})`,
      pulse.pr ? `PR #${pulse.pr.number}${pulse.pr.state ? ` ${pulse.pr.state}` : ''}` : 'no PR',
      pulse.files.length ? `${pulse.files.length} file${pulse.files.length === 1 ? '' : 's'} in ${topFolders(pulse.files).join(', ')}` : 'no files',
      ...(pulse.behind ? [`behind ${pulse.behind}`] : []),
      ago(pulse.at, now),
    ];
    out.push(`${person.id.padEnd(6)} ${parts.join('  ')}${pulse.note ? `\n       "${clip(pulse.note, 90)}"` : ''}`);
  }
  if (b.overlaps.length) {
    out.push('Overlaps:');
    for (const overlap of b.overlaps.slice(0, 10)) out.push(`  ${overlap.file}: ${overlap.pulses.map((entry) => `${entry.by} (${entry.branch ?? 'detached'})`).join(', ')}`);
    if (b.overlaps.length > 10) out.push(`  ... and ${b.overlaps.length - 10} more (${HUB} who --json)`);
  }
  return out.join('\n');
}

COMMANDS.status = {
  usage: 'hub status [--mine] [--json]',
  summary: 'The board: who is working on what, open items by lane, questions, decisions, gates, deadlines.',
  details: '--mine narrows items to yours and questions to yours plus team-wide ones; who is working now always shows everyone. --json prints the folded board.',
  run(args) {
    console.log(renderStatus({ mine: Boolean(args.mine), json: Boolean(args.json) }));
  },
};

/** @param {{ mine?: boolean, json?: boolean, now?: number }} options */
export function renderStatus(options = {}) {
  const now = options.now ?? Date.now();
  const b = loadBoard(HUB_ROOT, { now }).data;
  const me = identity().me;
  const mine = Boolean(options.mine && me);
  const items = mine ? b.items.filter((item) => item.owner === me) : b.items;
  const questions = mine ? b.questions.filter((q) => q.for === me || q.for === 'team' || q.askedBy === me) : b.questions;
  const sessions = b.sessions;
  if (options.json) {
    return JSON.stringify(mine ? { ...b, items, questions, sessions: b.sessions.filter((entry) => entry.by === me), activity: b.activity.filter((e) => e.by === me).slice(0, 50) } : b, null, 2);
  }

  const out = [];
  out.push(`Hub board${mine ? ` for ${me}` : ''} at ${formatWhen(now)}${me ? ` (you are ${me})` : ' (identity not set: ./hub me <id>)'}`);

  out.push('Working now:');
  const recentCutoff = now - 3 * 3600 * 1000;
  for (const person of b.people) {
    const live = sessions.filter((s) => s.by === person.id && !s.endedAt && Date.parse(s.lastAt) > recentCutoff);
    const flying = b.items.filter((item) => item.owner === person.id && item.lane === 'in_flight').map((item) => item.id);
    const parts = live.map((s) => `${s.id} ${s.agent ?? ''} "${clip(s.focus, 50)}"${s.repo ? ` [${s.repo}${s.branch ? `@${s.branch}` : ''}]` : ''} ${s.idle ? `idle ${formatSpan(now - Date.parse(s.lastAt))}` : `active ${ago(s.lastAt, now)}`}`.replace(/\s+/g, ' '));
    if (flying.length) parts.push(`in flight: ${flying.join(', ')}`);
    if (!parts.length) parts.push(person.lastSeenAt ? `last seen ${ago(person.lastSeenAt, now)}` : 'nothing posted yet');
    out.push(`  ${person.id.padEnd(6)} ${parts.join('; ')}`);
  }

  const laneOrder = [
    ['needs_human', 'Needs a human'],
    ['in_flight', 'In flight'],
    ['up_next', 'Up next'],
  ];
  for (const [lane, label] of laneOrder) {
    const inLane = items.filter((item) => item.lane === lane).sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : -1));
    if (!inLane.length) continue;
    out.push(`${label} (${inLane.length}):`);
    const limit = lane === 'up_next' ? 8 : 10;
    for (const item of inLane.slice(0, limit)) {
      const bits = [item.owner ? `owner ${item.owner}` : 'unowned'];
      if (item.due) bits.push(`due ${formatWhen(item.due)}`);
      if (lane === 'needs_human') bits.push(`needs ${item.needs}: ${clip(item.blocker ?? '', 70)}`);
      else if (lane === 'in_flight') bits.push(`updated ${ago(item.updatedAt, now)}`);
      out.push(`  ${item.id} ${clip(item.title, 70)} (${bits.join(', ')})`);
    }
    if (inLane.length > limit) out.push(`  ... and ${inLane.length - limit} more (hub status --json)`);
  }
  const done = items.filter((item) => item.lane === 'done');
  if (done.length) {
    const latest = done.sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : -1))[0];
    out.push(`Done: ${done.length} (latest ${latest.id} "${clip(latest.title, 60)}", ${ago(latest.updatedAt, now)})`);
  }

  const openQuestions = questions.filter((q) => q.status === 'open');
  if (openQuestions.length) {
    out.push(`Open questions (${openQuestions.length}):`);
    for (const q of openQuestions.slice(0, 6)) out.push(`  ${q.id} for ${q.for}: "${clip(q.title, 80)}" (from ${q.askedBy}, ${q.answers.length} answer(s)${q.blocking ? `, blocks ${q.blocking}` : ''})`);
    if (openQuestions.length > 6) out.push(`  ... and ${openQuestions.length - 6} more`);
  }

  const proposed = b.decisions.filter((d) => d.status === 'proposed');
  if (proposed.length) {
    out.push(`Calls on record (object on the board if you disagree) (${proposed.length}):`);
    for (const d of proposed.slice(0, 5)) out.push(`  ${d.id} "${clip(d.title, 80)}" (from ${d.proposedBy})`);
    if (proposed.length > 5) out.push(`  ... and ${proposed.length - 5} more`);
  }
  const accepted = b.decisions.filter((d) => d.status === 'accepted');
  if (accepted.length) out.push(`Accepted decisions: ${accepted.slice(-4).map((d) => `${d.id} "${clip(d.title, 40)}"`).join('; ')}`);

  const gates = [...b.gates].sort((x, y) => (Date.parse(x.due ?? '9999') || 0) - (Date.parse(y.due ?? '9999') || 0));
  if (gates.length) {
    out.push('Gates:');
    for (const g of gates) {
      const due = g.due ? `due ${formatWhen(g.due)} (${g.status === 'passed' ? 'done' : until(g.due, now)})` : 'no due time';
      out.push(`  ${g.id} [${g.status}] ${clip(g.title, 50)}, ${due}, ${g.criteria.length} criteria`);
    }
  }

  const upcoming = withSubmitBy(readDeadlines()).filter((d) => Date.parse(d.at) > now).slice(0, 3);
  if (upcoming.length) {
    out.push('Next deadlines:');
    for (const d of upcoming) out.push(`  ${formatWhen(d.at)} ${d.title} (${until(d.at, now)})`);
  } else out.push('Next deadlines: none set (event.submitBy in hub.config.json, or ## Deadlines in kb/playbook.md).');

  if (b.rejected.length) out.push(`Rejected event files: ${b.rejected.length} (see --json, "rejected")`);
  out.push(`Details: ${HUB} show <id>. Recent activity: ${HUB} feed.`);
  return out.join('\n');
}

COMMANDS.feed = {
  usage: 'hub feed [--n 20] [--by <id>]',
  summary: 'Recent activity, newest first.',
  run(args) {
    const count = Number(lastValue(args.n) ?? 20) || 20;
    const b = board();
    const events = b.activity.filter((event) => !args.by || event.by === args.by).slice(0, count);
    if (!events.length) console.log('No activity yet.');
    for (const event of events) console.log(`${formatWhen(event.at)}  ${actorLabel(event)} ${describeEvent(event, b)}`);
  },
};

COMMANDS.show = {
  usage: 'hub show <id>',
  summary: 'Full detail and history of an item, question, decision, gate, session, or event id.',
  run(args) {
    const id = args._[0];
    if (!id) throw new UsageError('Which id? e.g. hub show t-a3f9');
    const b = board();
    const found = findObject(b, id);
    if (!found.object) {
      const event = b.activity.find((entry) => entry.id === id);
      if (event) return console.log(JSON.stringify(event, null, 2));
      throw new UsageError(`Nothing with id ${id} on the board. Run ${HUB} sync, then try again.`);
    }
    const object = found.object;
    const out = [`${found.kind} ${id}: ${object.title ?? object.focus}`];
    const skip = new Set(['id', 'title', 'notes', 'comments', 'history', 'answers', 'settled', 'resolved', 'text']);
    for (const [field, value] of Object.entries(object)) {
      if (skip.has(field) || value === null || value === undefined || (Array.isArray(value) && !value.length) || value === '') continue;
      const shown = Array.isArray(value) ? value.map((entry) => `\n    - ${entry}`).join('') : field.endsWith('At') || field === 'due' ? `${formatWhen(value)} (${value})` : value;
      out.push(`  ${field}: ${shown}`);
    }
    if (object.text) out.push(`  text:\n${object.text.split('\n').map((line) => `    ${line}`).join('\n')}`);
    const timeline = b.activity.filter((event) => event.ref === id).reverse();
    if (timeline.length) {
      out.push('History:');
      for (const event of timeline) {
        out.push(`  ${formatWhen(event.at)}  ${actorLabel(event)} ${event.type}: ${event.title}`);
        if (event.text) out.push(event.text.split('\n').slice(0, 12).map((line) => `      ${line}`).join('\n'));
        const extras = Object.entries(event.data ?? {}).filter(([, value]) => value !== undefined && value !== '');
        if (extras.length) out.push(`      data: ${JSON.stringify(Object.fromEntries(extras))}`);
      }
    }
    const mentions = b.activity.filter((event) => event.ref !== id && (event.text ?? '').includes(`[[${id}]]`));
    if (mentions.length) out.push(`Mentioned in: ${mentions.slice(0, 8).map((event) => `${event.ref ?? event.id} (${event.by})`).join(', ')}`);
    console.log(out.join('\n'));
  },
};

COMMANDS.add = {
  usage: 'hub add "<title>" --why "<why it matters>" [--claim] [--owner <id>|me] [--lane up_next] [--due <ISO>] [--area <word>] [-m "<detail>"]',
  summary: 'Add a work item. --claim makes it yours and in flight in one step.',
  details: 'Check hub status first so you do not duplicate an existing item. Prints the new t- id.',
  run(args) {
    const { title, text } = splitTitle(needText(args, 0, 'the item title'), undefined);
    const extra = args._.length && args.text !== undefined ? String(lastValue(args.text)) : undefined;
    const data = {};
    if (args.why) data.why = String(lastValue(args.why));
    if (args.claim) {
      data.owner = requireMe();
      data.lane = 'in_flight';
    }
    if (args.owner) data.owner = resolvePerson(String(lastValue(args.owner)));
    if (args.lane) data.lane = normalizeLane(String(lastValue(args.lane)));
    if (args.due) data.due = normalizeDue(String(lastValue(args.due)));
    if (args.area) data.area = String(lastValue(args.area));
    const ref = newRefId('t');
    const result = postEvent({ type: 'item.add', ref, title, text: [text, extra].filter(Boolean).join('\n\n') || undefined, data, flags: args, successLine: (id) => `${id} added: "${title}"${data.lane === 'in_flight' ? ' (claimed, in flight)' : ''}` });
    if (args.claim && result.pushed) reportLostClaim(ref, data.owner);
  },
};

COMMANDS.claim = {
  usage: 'hub claim <t-id> --why "<why you are taking it>" [--take]',
  summary: 'Take an item: you become owner, lane in_flight.',
  details: 'Refuses if someone else already has it in flight; pick something else, or pass --take if they agreed.',
  run(args) {
    freshen();
    const id = args._[0];
    const { object } = requireObject(id, 'item');
    const me = requireMe();
    if (object.owner && object.owner !== me && object.lane === 'in_flight' && !args.take) {
      throw new UsageError(`${id} is already in flight with ${object.owner}. Ask them: hub ask "Can I take ${id}?" --for ${object.owner}. If they agree, rerun with --take.`);
    }
    if (object.lane === 'done') throw new UsageError(`${id} is already done. Add a new item instead.`);
    const data = args.why ? { why: String(lastValue(args.why)) } : {};
    if (args.take) data.take = true;
    // Compare and swap: if someone else claimed, reassigned, or finished the item after this
    // clone last saw it, the claim is withdrawn before it is ever pushed.
    const seen = new Set(object.history.map((event) => event.id));
    const guard = (/** @type {any} */ mine) => {
      if (args.take) return null;
      const now = findObject(board(), id).object;
      const rival = now?.history.find((event) => event.id !== mine.id && !seen.has(event.id) && event.by !== me && takesOwnership(event));
      if (!rival) return null;
      return `${id} was ${rival.type === 'item.done' ? 'finished' : 'claimed'} by ${rival.by} while you were claiming it, so your claim was withdrawn and nothing was pushed. Pick something else, or ask them: ${HUB} ask "Can I take ${id}?" --for ${rival.by}`;
    };
    const result = postEvent({ type: 'item.claim', ref: id, title: object.title, text: args.text ? String(lastValue(args.text)) : undefined, data, flags: args, guard, successLine: (ref) => `${ref} claimed by ${me}: "${object.title}"` });
    if (result.pushed) reportLostClaim(id, me);
  },
};

/** Events that change who holds an item. @param {any} event */
function takesOwnership(event) {
  return event.type === 'item.claim' || event.type === 'item.done' || (event.type === 'item.update' && event.data?.owner !== undefined);
}

/**
 * After a pushed claim, read the board as everyone will fold it. Two claims written at once can
 * both land (one from the web board, say); the fold keeps the first, and the loser hears it here.
 * @param {string} id @param {string} me
 */
function reportLostClaim(id, me) {
  const item = findObject(board(), id).object;
  if (!item || item.owner === me) return;
  console.error(`But ${id} is ${item.lane === 'done' ? 'done' : `in flight with ${item.owner}`}: their claim came first, so yours does not count. Do not build it. Pick something else, or ask them: ${HUB} ask "Can I take ${id}?" --for ${item.owner}`);
  process.exitCode = 1;
}

COMMANDS.update = {
  usage: 'hub update <t-id> [--status "<short status>"] [--title ..] [--owner <id>] [--lane ..] [--due <ISO>] [--area ..] [-m "<what changed>"]',
  summary: 'Patch an item (status line, owner, lane, due, title).',
  run(args) {
    freshen();
    const id = args._[0];
    const { object } = requireObject(id, 'item');
    const data = {};
    if (args.title) data.title = clip(String(lastValue(args.title)), TITLE_MAX);
    if (args.owner) data.owner = resolvePerson(String(lastValue(args.owner)));
    if (args.lane) data.lane = normalizeLane(String(lastValue(args.lane)));
    if (args.status) data.status = String(lastValue(args.status));
    if (args.due) data.due = normalizeDue(String(lastValue(args.due)));
    if (args.area) data.area = String(lastValue(args.area));
    const message = args._.slice(1).join(' ') || (args.text ? String(lastValue(args.text)) : '');
    if (!Object.keys(data).length && !message) throw new UsageError('Nothing to update. Pass --status, --owner, --lane, --due, --title, or --area.');
    const summary = message || Object.entries(data).map(([key, value]) => `${key}: ${value}`).join(', ');
    const { title, text } = splitTitle(summary);
    postEvent({ type: 'item.update', ref: id, title, text, data, flags: args, successLine: (ref) => `${ref} updated: "${clip(data.title ?? object.title, 80)}"` });
  },
};

COMMANDS.block = {
  usage: 'hub block <t-id> "<what you need>" [--needs <id>|team]',
  summary: 'Mark an item blocked on a person or the team (lane needs_human). Then work on something else.',
  run(args) {
    freshen();
    const id = args._[0];
    requireObject(id, 'item');
    const needed = needText(args, 1, 'what you need (a sentence)');
    const needs = args.needs ? resolvePerson(String(lastValue(args.needs)), { allowTeam: true }) : 'team';
    const { title, text } = splitTitle(needed);
    postEvent({ type: 'item.block', ref: id, title, text, data: { needs }, flags: args, successLine: (ref) => `${ref} blocked, needs ${needs}: "${title}"` });
  },
};

COMMANDS.done = {
  usage: 'hub done <t-id> [--link <url or path>]... [-m "<what shipped>"]',
  summary: 'Finish an item, with links to the PR, commit, page, or kb page.',
  run(args) {
    freshen();
    const id = args._[0];
    const { object } = requireObject(id, 'item');
    const links = asList(args.link).concat(asList(args.links));
    const message = args._.slice(1).join(' ') || (args.text ? String(lastValue(args.text)) : '');
    const { title, text } = splitTitle(message || `Done: ${object.title}`);
    postEvent({ type: 'item.done', ref: id, title, text, data: links.length ? { links } : {}, flags: args, successLine: (ref) => `${ref} done: "${object.title}"` });
  },
};

COMMANDS.onboarded = {
  usage: 'hub onboarded ["<tool and where, for example devin (REMOTE)>"]',
  summary: 'Check off your onboarding item (area onboarding, owned by you) and prove the round trip.',
  details: 'Run once at the end of docs/agent-prompt.md. Marks your open onboarding item done. If it is already done, or you have none, posts a note instead, so one pushed event always proves you can write.',
  run(args) {
    freshen();
    const me = requireMe();
    const detail = args._.join(' ').trim() || identity().agent || '';
    const line = `Onboarding done: ${me}${detail ? ` on ${detail}` : ''}`;
    const mine = board().items.filter((item) => item.area === 'onboarding' && item.owner === me);
    const open = mine.find((item) => item.lane !== 'done');
    if (open) {
      postEvent({ type: 'item.done', ref: open.id, title: line, data: {}, flags: args, successLine: (ref) => `${ref} done: "${open.title}"` });
      return;
    }
    const ref = mine[0]?.id;
    postEvent({ type: 'note', ref, title: line, data: {}, flags: args, successLine: () => (ref ? `${ref} was already done. Noted: "${line}"` : `No onboarding item for ${me} on the board. Noted: "${line}"`) });
  },
};

COMMANDS.note = {
  usage: 'hub note "<what changed, which files, which branch>" [--ref <id>] [--files a,b] [--repo ..] [--branch ..] [--commit ..]',
  summary: 'Post a progress line. Repo, branch, and commit fill in from the git repo you stand in.',
  run(args) {
    const message = needText(args, 0, 'the note text');
    const { title, text } = splitTitle(message);
    const context = workingRepoContext();
    const data = { ...context };
    if (args.files) data.files = asList(args.files);
    for (const key of ['repo', 'branch', 'commit']) if (args[key]) data[key] = String(lastValue(args[key]));
    const ref = args.ref ? String(lastValue(args.ref)) : undefined;
    if (ref && refKind(ref) && !findObject(board(), ref).object) throw new UsageError(`No ${ref} on the board. Check the id with hub status.`);
    postEvent({ type: 'note', ref, title, text, data, flags: args, successLine: () => `Noted${ref ? ` on ${ref}` : ''}: "${title}"` });
  },
};

COMMANDS.ask = {
  usage: 'hub ask "<question>" [--for <id>|team] [--blocking <t-id>] [-m "<context>"]',
  summary: 'Ask a teammate (or the team) instead of guessing. Keep working on something else meanwhile.',
  run(args) {
    const question = args._.join(' ').trim();
    if (!question) throw new UsageError('Missing the question text.');
    const { title, text } = splitTitle(question, args.text ? String(lastValue(args.text)) : undefined);
    const data = { for: args.for ? resolvePerson(String(lastValue(args.for)), { allowTeam: true }) : 'team' };
    if (args.blocking) data.blocking = String(lastValue(args.blocking));
    postEvent({ type: 'question.ask', ref: newRefId('q'), title, text, data, flags: args, successLine: (id) => `${id} asked (for ${data.for}): "${title}"` });
  },
};

const DESIGN_IMAGE_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg'];
const DESIGN_IMAGE_MAX_BYTES = 600 * 1024;

/** A file-name-safe slug: lowercase letters, digits, and single hyphens. @param {string} value */
function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'image';
}

COMMANDS.design = {
  usage: 'hub design <image-file> "<title>" [--image <another-file>]... [-m "<notes>"] [--for <id>|team]',
  summary: 'Post a screenshot or mockup for design feedback. It shows on the board\'s Design page; feedback comes back as answers.',
  details: [
    'Copies each image into design/review/<timestamp>-<slug>.<ext> and asks the question "Design review: <title>", whose text is the image markdown plus your notes.',
    'The images and the event are committed together in one commit, then pushed.',
    'Images must be webp, png, jpg, or jpeg and at most 600 KB each. To shrink one on a Mac:',
    '  sips -s format jpeg -s formatOptions 80 --resampleWidth 1200 in.png --out out.jpg',
  ].join('\n'),
  run(args) {
    requireMe();
    const [first, ...titleWords] = args._;
    const files = [first, ...[].concat(args.image ?? [])].filter((value) => value !== undefined && String(value).trim() !== '').map(String);
    const title = titleWords.join(' ').trim();
    if (files.length === 0) throw new UsageError('Missing the image file.');
    if (!title) throw new UsageError('Missing the title, in quotes after the image file.');
    for (const file of files) {
      const source = resolve(file);
      const extension = file.split('.').pop()?.toLowerCase() ?? '';
      if (!DESIGN_IMAGE_EXTENSIONS.includes(extension)) throw new UsageError(`${file}: only ${DESIGN_IMAGE_EXTENSIONS.join(', ')} images are accepted.`);
      if (!existsSync(source) || !statSync(source).isFile()) throw new UsageError(`${file}: no such file.`);
      const size = statSync(source).size;
      if (size > DESIGN_IMAGE_MAX_BYTES) {
        throw new UsageError(`${file} is ${Math.ceil(size / 1024)} KB; the limit is 600 KB. Convert it first, for example:\n  sips -s format jpeg -s formatOptions 80 --resampleWidth 1200 "${file}" --out smaller.jpg`);
      }
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const slug = slugify(title);
    const reviewDir = join(HUB_ROOT, 'design', 'review');
    mkdirSync(reviewDir, { recursive: true });
    /** @type {string[]} */
    const copied = [];
    try {
      files.forEach((file, index) => {
        const extension = file.split('.').pop().toLowerCase();
        let name = `${stamp}-${slug}${files.length > 1 ? `-${index + 1}` : ''}.${extension}`;
        for (let n = 2; existsSync(join(reviewDir, name)); n++) name = `${stamp}-${slug}-${files.length > 1 ? `${index + 1}-` : ''}${n}.${extension}`;
        copyFileSync(resolve(file), join(reviewDir, name));
        copied.push(`design/review/${name}`);
      });
      const altText = title.replace(/[\[\]\\]/g, '');
      const images = copied.map((path, index) => `![${altText}${copied.length > 1 ? ` (${index + 1} of ${copied.length})` : ''}](${path})`);
      const notes = args.text !== undefined ? String(lastValue(args.text)).trim() : '';
      const text = [...images, ...(notes ? [notes] : [])].join('\n\n');
      const data = { for: args.for ? resolvePerson(String(lastValue(args.for)), { allowTeam: true }) : 'team' };
      postEvent({
        type: 'question.ask',
        ref: newRefId('q'),
        title: clip(`Design review: ${title}`, TITLE_MAX),
        text,
        data,
        extraPaths: copied,
        flags: args,
        successLine: (id) => `${id} posted for design review (${copied.length} image${copied.length > 1 ? 's' : ''}, for ${data.for}): "${title}"\nIt shows on the board's Design page; feedback arrives as answers (${HUB} show ${id}).`,
      });
    } catch (error) {
      // Nothing was committed, so leave no stray copies behind.
      for (const path of copied) rmSync(join(HUB_ROOT, path), { force: true });
      throw error;
    }
  },
};

COMMANDS.answer = {
  usage: 'hub answer <q-id> "<answer>"',
  summary: 'Answer a question. It stays open until someone settles it.',
  run(args) {
    freshen();
    const id = args._[0];
    requireObject(id, 'question');
    const { title, text } = splitTitle(needText(args, 1, 'the answer'));
    postEvent({ type: 'question.answer', ref: id, title, text, flags: args, successLine: (ref) => `${ref} answered: "${title}"` });
  },
};

COMMANDS.settle = {
  usage: 'hub settle <q-id> "<final answer>"',
  summary: 'Close a question with the final answer (usually the asker, once they have what they need).',
  run(args) {
    freshen();
    const id = args._[0];
    requireObject(id, 'question');
    const answer = needText(args, 1, 'the final answer');
    const { title, text } = splitTitle(answer);
    postEvent({ type: 'question.settle', ref: id, title, text, data: { answer }, flags: args, successLine: (ref) => `${ref} settled: "${title}"` });
  },
};

COMMANDS.propose = {
  usage: 'hub propose "<decision>" --why "<reason>" [--affects t-a3f9,kb/rules] [-m "<options considered>"]',
  summary: 'Record a big call (a design direction, a new dependency, a feature in or out). It is a record, not a request: keep building.',
  run(args) {
    const statement = args._.join(' ').trim();
    if (!statement) throw new UsageError('Missing the decision text.');
    if (!args.why) throw new UsageError('A decision needs --why "<reason>".');
    const { title, text } = splitTitle(statement, args.text ? String(lastValue(args.text)) : undefined);
    const data = { why: String(lastValue(args.why)) };
    const affects = asList(args.affects);
    if (affects.length) data.affects = affects;
    postEvent({ type: 'decision.propose', ref: newRefId('d'), title, text, data, flags: args, successLine: (id) => `Recorded ${id}. It is a record, not a request: keep building.` });
  },
};

for (const [name, type] of [['accept', 'decision.accept'], ['reject', 'decision.reject']]) {
  COMMANDS[name] = {
    usage: `hub ${name} <d-id> --human [-m "<note>"]`,
    summary: `For a person, and optional. ${name === 'accept' ? 'Accept' : 'Reject'} a call on record.`,
    run(args) {
      refuseUnlessHuman(type, args);
      freshen();
      const id = args._[0];
      const { object } = requireObject(id, 'decision');
      const note = args._.slice(1).join(' ') || (args.text ? String(lastValue(args.text)) : '');
      postEvent({ type, ref: id, title: note || `${name === 'accept' ? 'Accepted' : 'Rejected'}: ${object.title}`, flags: args, successLine: (ref) => `${ref} ${name}ed: "${object.title}"` });
    },
  };
}

COMMANDS.gate = {
  usage: 'hub gate add "<title>" --criterion "<check>" [--criterion ..] [--due <ISO>]\n       hub gate propose <g-id> --evidence "<link or fact>" [--evidence ..]\n       hub gate pass|fail <g-id> --human [-m "<note>"]',
  summary: 'Milestone gates. Agents add and propose; a person marks them passed or failed. Gates never block a push.',
  run(args) {
    const sub = args._[0];
    const rest = { ...args, _: args._.slice(1) };
    if (sub === 'add') {
      const { title, text } = splitTitle(needText(rest, 0, 'the gate title'));
      const criteria = [].concat(args.criterion ?? [], args.criteria ?? []).map(String).filter(Boolean);
      if (!criteria.length) throw new UsageError('A gate needs at least one --criterion "<check>".');
      const data = { criteria };
      if (args.due) data.due = normalizeDue(String(lastValue(args.due)));
      postEvent({ type: 'gate.add', ref: newRefId('g'), title, text, data, flags: args, successLine: (id) => `${id} gate added: "${title}"` });
    } else if (sub === 'propose') {
      freshen();
      const id = rest._[0];
      const { object } = requireObject(id, 'gate');
      const evidence = [].concat(args.evidence ?? []).map(String);
      const message = rest._.slice(1).join(' ') || (args.text ? String(lastValue(args.text)) : `Ready: ${object.title}`);
      postEvent({ type: 'gate.propose', ref: id, title: message, data: evidence.length ? { evidence } : {}, flags: args, successLine: (ref) => `${ref} proposed as ready: "${object.title}". Keep building; a person marks it passed.` });
    } else if (sub === 'pass' || sub === 'fail') {
      const type = `gate.${sub}`;
      refuseUnlessHuman(type, args);
      freshen();
      const id = rest._[0];
      const { object } = requireObject(id, 'gate');
      const note = rest._.slice(1).join(' ') || (args.text ? String(lastValue(args.text)) : '');
      postEvent({ type, ref: id, title: note || `${sub === 'pass' ? 'Passed' : 'Failed'}: ${object.title}`, flags: args, successLine: (ref) => `${ref} ${sub === 'pass' ? 'passed' : 'failed'}: "${object.title}"` });
    } else {
      throw new UsageError('Use: hub gate add | propose | pass | fail');
    }
  },
};

COMMANDS.learn = {
  usage: 'hub learn kb/<slug>.md "<what changed>"',
  summary: 'Commit a kb page you wrote or edited, with a kb.update event, so every agent hears about it.',
  details: [
    'Write or edit the page first: frontmatter with a one line summary, under about 400 words, one topic.',
    'learn commits only that page. No index to edit: hub kb lists every page from its frontmatter, so two',
    'people adding pages at once never touch the same file.',
  ].join('\n'),
  run(args) {
    const target = args._[0];
    if (!target) throw new UsageError('Which page? e.g. hub learn kb/logistics.md "Wi-Fi password is on the badge"');
    const slug = `kb/${String(target).replace(/^\.?\/?/, '').replace(/^kb\//, '').replace(/\.md$/, '')}`;
    const relFile = `${slug}.md`;
    if (!existsSync(join(HUB_ROOT, relFile))) throw new UsageError(`${relFile} does not exist in the hub. Write it first (path is relative to the hub root).`);
    const tracked = git(['ls-files', '--error-unmatch', relFile]).ok;
    const change = tracked ? 'edit' : 'new';
    const message = args._.slice(1).join(' ') || (args.text ? String(lastValue(args.text)) : `${change === 'new' ? 'New page' : 'Updated'} ${slug}`);
    const { title, text } = splitTitle(message);
    postEvent({ type: 'kb.update', title, text, data: { page: slug, change }, extraPaths: [relFile], flags: args, successLine: () => `[[${slug}]] ${change === 'new' ? 'added' : 'updated'}: "${title}"` });
    if (!readKbPage(join(HUB_ROOT, relFile)).summary) console.log(`Tip: give ${relFile} a "summary:" line in its frontmatter; hub kb shows it to every agent looking for a page.`);
  },
};

/**
 * Frontmatter fields and the first prose line of one kb page.
 * @param {string} path @returns {{ title: string, summary: string, group: string }}
 */
export function readKbPage(path) {
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { title: '', summary: '', group: '' };
  }
  /** @type {Record<string, string>} */
  const fields = {};
  let body = raw;
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (front) {
    body = raw.slice(front[0].length);
    for (const line of front[1].split(/\r?\n/)) {
      const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (match) fields[match[1].toLowerCase()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  const firstProse = body.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('```') && !line.startsWith('|')) ?? '';
  return { title: fields.title ?? '', summary: fields.summary || clip(firstProse, 110), group: fields.group ?? '' };
}

COMMANDS.kb = {
  usage: 'hub kb [<word>]',
  summary: 'List every kb page with its one line summary, read from the pages themselves. With a word, only pages that mention it in the name, title, or summary.',
  run(args) {
    const dir = join(HUB_ROOT, 'kb');
    const word = args._.join(' ').trim().toLowerCase();
    const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.md')).sort() : [];
    const rows = files.map((name) => ({ slug: `kb/${name.replace(/\.md$/, '')}`, ...readKbPage(join(dir, name)) }));
    const shown = word ? rows.filter((row) => `${row.slug} ${row.title} ${row.summary}`.toLowerCase().includes(word)) : rows;
    if (!shown.length) {
      console.log(word ? `No kb page mentions "${word}".` : 'No kb pages yet.');
      return;
    }
    for (const row of shown) console.log(`[[${row.slug}]] ${row.title || row.slug}${row.summary ? `: ${row.summary}` : ''}`);
  },
};

COMMANDS.start = {
  usage: 'hub start "<focus>" [--repo <name>] [--branch <name>]',
  summary: 'Open a work session so the team sees what you are on right now. Prints the s- id.',
  run(args) {
    const { title, text } = splitTitle(needText(args, 0, 'what this session is about'));
    const context = workingRepoContext();
    const data = { focus: title };
    if (args.repo || context.repo) data.repo = String(lastValue(args.repo) ?? context.repo);
    if (args.branch || context.branch) data.branch = String(lastValue(args.branch) ?? context.branch);
    const result = postEvent({ type: 'session.start', ref: newRefId('s'), title, text, data, flags: args, successLine: (id) => `${id} session started: "${title}"` });
    updateState((state) => {
      state.lastSession = result.event.ref;
    });
  },
};

COMMANDS.end = {
  usage: 'hub end [s-id] "<summary, five lines max>"',
  summary: 'Close your session with a short summary. Without an id, closes your latest open session.',
  run(args) {
    freshen();
    const me = requireMe();
    let id = args._[0];
    let messageStart = 1;
    if (!id || refKind(id) !== 'session') {
      messageStart = 0;
      const b = board();
      const open = b.sessions.filter((s) => s.by === me && !s.endedAt).sort((x, y) => (x.lastAt < y.lastAt ? 1 : -1));
      const remembered = loadState().lastSession;
      id = open.find((s) => s.id === remembered)?.id ?? open[0]?.id;
      if (!id) throw new UsageError('You have no open session. Nothing to end.');
    } else requireObject(id, 'session');
    const summary = args._.slice(messageStart).join(' ') || (args.text ? String(lastValue(args.text)) : '');
    if (!summary) throw new UsageError('End needs a summary: what changed, what is left, where it lives.');
    const lines = summary.split('\n').slice(0, 5).join('\n');
    const { title } = splitTitle(lines);
    postEvent({ type: 'session.end', ref: id, title, text: lines, flags: args, successLine: (ref) => `${ref} session ended.` });
  },
};

COMMANDS.comment = {
  usage: 'hub comment <id> "<text>"',
  summary: 'Comment on any item, question, decision, gate, or session.',
  run(args) {
    const id = args._[0];
    if (!id) throw new UsageError('Which id?');
    if (refKind(id) && !findObject(board(), id).object) throw new UsageError(`No ${id} on the board.`);
    const { title, text } = splitTitle(needText(args, 1, 'the comment'));
    postEvent({ type: 'comment', ref: id, title, text, flags: args, successLine: (ref) => `Commented on ${ref}: "${title}"` });
  },
};

COMMANDS.setup = {
  usage: 'hub setup [options for scripts/setup.mjs]',
  passThrough: true,
  summary: 'Set up a new hub (owner, once): event, team, GitHub repo, invites, board deploy. Runs node scripts/setup.mjs.',
  details: 'Every argument after "setup" goes to scripts/setup.mjs unchanged. Run it from the hub folder. ./hub setup --help lists its options.',
  run(args) {
    const script = join(HUB_ROOT, 'scripts', 'setup.mjs');
    if (!existsSync(script)) {
      console.error(`scripts/setup.mjs is missing from this hub, so setup cannot run; copy it from the hackathon-hubs template.`);
      process.exitCode = 1;
      return;
    }
    const result = spawnSync(process.execPath, [script, ...args.raw], { cwd: HUB_ROOT, stdio: 'inherit', env: process.env });
    process.exitCode = result.status ?? 1;
  },
};

COMMANDS.doctor = {
  usage: 'hub doctor [--repo <project clone>]',
  summary: 'Check node, git identity, remote, push permission, hub identity, and hooks; print fixes.',
  details: 'The git identity check also runs on the project clone when you stand in one or pass --repo. A bot, placeholder, or teammate\'s address is replaced in that clone\'s LOCAL config with your name and GitHub no-reply address (team.json commitEmail), so your commits credit your account. A personal email is left alone.',
  run(args) {
    const checks = runDoctor(args);
    for (const check of checks) console.log(`${check.ok ? 'ok  ' : 'FIX '} ${check.name}: ${check.detail}${!check.ok && check.fix ? `\n     fix: ${check.fix}` : ''}`);
    const failed = checks.filter((check) => !check.ok);
    console.log(failed.length ? `${failed.length} thing(s) to fix.` : 'All good.');
    if (failed.length) process.exitCode = 1;
  },
};

/**
 * The fix for a project clone identity the hub could not set, by its cause.
 * @param {{ cause?: string }} check @param {any} person
 */
export function identityFix(check, person) {
  if (check.cause === 'no-commit-email') {
    return [
      `Ask the hub owner to fill in commitEmail for ${person.id} in team.json (./hub setup does it when gh is logged in; the address is on github.com/settings/emails).`,
      'Or set it in this clone yourself, never --global: git config user.name "<your name>" && git config user.email "<your GitHub email or no-reply address>"',
    ].join('\n     ');
  }
  return `${HUB} me <id>, then rerun ${HUB} doctor here`;
}

/** Hide a username or token embedded in a git URL. @param {string} url */
export function redactUrl(url) {
  return String(url).replace(/\/\/[^/@\s]+@/, '//***@');
}

/** @param {any} [args] */
export function runDoctor(args = {}) {
  const checks = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  checks.push({ name: 'node', ok: major > 20 || (major === 20 && minor >= 9), detail: process.versions.node, fix: 'The hub needs Node 20.9 or newer. Install the current LTS: brew install node, or nvm install 22 && nvm use 22.' });
  const gitVersion = git(['--version']);
  checks.push({ name: 'git', ok: gitVersion.ok, detail: gitVersion.ok ? gitVersion.out : 'not found', fix: 'Install git (xcode-select --install on macOS).' });
  const config = loadConfig(HUB_ROOT);
  checks.push({ name: 'hub config', ok: !config.error, detail: config.error ?? `${CONFIG_FILE}: ${config.data.event.name} (${config.data.event.timezone})`, fix: `${HUB} setup writes ${CONFIG_FILE}. A teammate who is not the owner: ${HUB} sync, then ask the owner.` });
  const userName = git(['config', 'user.name']);
  const userEmail = git(['config', 'user.email']);
  const { me, agent } = identity();
  const ids = teamIds();
  const people = teamPeople();
  const person = people.find((entry) => entry.id === me);
  if (person && person.commitEmail) {
    const hubCheck = checkIdentity(HUB_ROOT, me, people);
    checks.push({ name: 'git identity (hub)', ok: hubCheck.ok, detail: `${hubCheck.line}; hub commits are authored as ${person.name} with the commitEmail team.json has for ${person.id}`, fix: 'git config --local user.email <your GitHub no-reply address from team.json>' });
  } else {
    // Not a failure when unset: commitPaths signs hub commits with the hub identity instead.
    checks.push({ name: 'git identity', ok: true, detail: userName.ok && userEmail.ok ? `${userName.out}, with an email set` : `not set; hub commits are signed as ${me ?? '<your id>'}@hub.invalid, which is fine` });
  }
  const project = projectClone(args);
  if (project) {
    const projectCheck = checkIdentity(project, me, people);
    checks.push({ name: `git identity (${basename(project)})`, ok: projectCheck.ok, detail: projectCheck.line, fix: identityFix(projectCheck, person) });
  }
  checks.push({ name: 'hub identity', ok: Boolean(me && (!ids.length || ids.includes(me))), detail: me ? `${me} (agent ${agent})` : 'not set', fix: `${HUB} me <id>   (ids: ${ids.join(', ')})` });
  const remote = git(['remote', 'get-url', 'origin']);
  checks.push({ name: 'remote', ok: remote.ok, detail: remote.ok ? redactUrl(remote.out) : 'no origin', fix: 'git remote add origin <HUB_REPO_URL>' });
  if (remote.ok) {
    const reach = git(['ls-remote', '-q', '--heads', 'origin'], { timeoutMs: 20000 });
    checks.push({ name: 'remote reachable', ok: reach.ok, detail: reach.ok ? 'yes' : clip(reach.err.split('\n').pop() ?? '', 140), fix: 'Git cannot log in to GitHub, or you have not accepted the invite. 1) Accept the invite at github.com/notifications. 2) On your own computer: gh auth login. On a cloud agent such as Devin: save a GitHub token as the secret HUB_GIT_TOKEN (docs/setup.md, "Cloud agents"). Then run this again.' });
    if (reach.ok) {
      const branch = currentBranch();
      const dry = git(['push', '--dry-run', '-q', 'origin', `HEAD:refs/heads/${branch}`], { timeoutMs: 30000 });
      const behindOnly = /rejected|fetch first|non-fast-forward/i.test(dry.err);
      checks.push({ name: 'push permission', ok: dry.ok || behindOnly, detail: dry.ok ? 'dry run ok' : behindOnly ? 'allowed (you are behind; hub sync fixes that)' : clip(dry.err.split('\n').pop() ?? '', 140), fix: 'You can read the hub but not write to it. Accept the invite at github.com/notifications, or ask the hub owner (hub.owner in hub.config.json) to add your GitHub account with write access. If you use a token, it needs write access to this repo.' });
    }
  }
  checks.push(hubCloneCheck());
  const dirty = git(['status', '--porcelain', '--untracked-files=all', '--', 'events']).out;
  checks.push({ name: 'uncommitted events', ok: !dirty, detail: dirty ? dirty.split('\n').length + ' file(s)' : 'none', fix: 'Commit them: git add events && git commit -m "hub: recover events" && ./hub sync' });
  const settingsFile = join(HUB_ROOT, '.claude', 'settings.json');
  const hooked = existsSync(settingsFile) && readFileSync(settingsFile, 'utf8').includes('scripts/hooks/');
  checks.push({ name: 'claude code hooks (hub)', ok: hooked, detail: hooked ? 'installed in .claude/settings.json' : 'not installed', fix: 'node scripts/install-hooks.mjs   Only Claude Code uses these; every other agent can ignore this line.' });
  return checks;
}

/**
 * Can this clone's hub commits reach origin? Catches a clone stuck mid-rebase or mid-merge, a
 * work branch origin does not have, and local commits that conflict with origin, all of which
 * keep every later write on this machine while sync and push keep failing.
 */
function hubCloneCheck() {
  const name = 'hub clone in step with origin';
  if (!isOwnRepo()) return { name, ok: false, detail: `${HUB_ROOT} sits inside another git repo`, fix: 'A team hub is its own repo. Create one with the scaffolder, or git init here.' };
  const stuck = stuckOperation();
  if (stuck) return { name, ok: false, detail: `stuck in the middle of ${stuck}; nothing can be pulled or pushed`, fix: `cd "${HUB_ROOT}" && git status shows the files; finish it, or undo it with git ${stuck === 'a merge' ? 'merge' : stuck === 'a rebase' ? 'rebase' : 'cherry-pick'} --abort. Then ${HUB} sync.` };
  if (!hasRemote()) return { name, ok: true, detail: 'no origin yet' };
  const branch = currentBranch();
  git(['fetch', '-q', 'origin'], { timeoutMs: 20000 });
  if (!remoteBranchExists(branch)) return { name, ok: false, detail: `on branch ${branch}, which origin does not have; hub writes stay on this machine`, fix: `git -C "${HUB_ROOT}" checkout main, then ${HUB} sync` };
  const { ahead, behind } = aheadBehind(branch);
  if (!ahead || !behind) return { name, ok: true, detail: ahead ? `${ahead} commit(s) to push; ${HUB} sync pushes them` : behind ? `behind by ${behind}; ${HUB} sync catches up` : 'yes' };
  const trial = git(['merge-tree', '--write-tree', '--name-only', 'HEAD', `origin/${branch}`]);
  if (trial.ok || !/^\w+/.test(trial.out)) return { name, ok: true, detail: `${ahead} local, ${behind} new on origin; ${HUB} sync combines them` };
  const listed = trial.out.split('\n').slice(1);
  const files = listed.slice(0, Math.max(0, listed.indexOf('')) || listed.length).slice(0, 8);
  return { name, ok: false, detail: `${ahead} local commit(s) conflict with origin in ${files.join(', ') || 'a shared file'}; ${HUB} sync cannot combine them`, fix: conflictFix(files, branch).split('\n')[1] };
}

COMMANDS['pre-push'] = {
  usage: 'hub pre-push <remote> <url>   (run by the pre-push git hook; reads the refs on stdin)',
  summary: 'Refuses a push only when an outgoing commit is authored as a bot, a placeholder, Claude, or another teammate. Prints the fix.',
  run(args) {
    try {
      runPrePush(args);
    } catch {
      // a hook failure must never block a push
      process.exitCode = 0;
    }
  },
};

/** @param {any} args */
function runPrePush(args) {
  const clone = projectClone();
  if (!clone) return;
  const people = teamPeople();
  const me = identity().me;
  const person = people.find((entry) => entry.id === me) ?? null;
  const check = checkIdentity(clone, me, people);
  if (check.fixed) console.error(`hub: git identity ${check.line}`);
  let stdin = '';
  try {
    if (!process.stdin.isTTY) stdin = readFileSync(0, 'utf8');
  } catch {
    stdin = '';
  }
  const zero = /^0+$/;
  const bad = [];
  const seen = new Set();
  for (const row of stdin.split('\n')) {
    const [, localSha, , remoteSha] = row.trim().split(/\s+/);
    if (!localSha || zero.test(localSha)) continue;
    // Only commits no origin ref has yet. A branch that merged origin/main
    // carries teammates' commits that are already published; those are theirs.
    const knownRemote = remoteSha && !zero.test(remoteSha) && git(['cat-file', '-e', `${remoteSha}^{commit}`], { cwd: clone }).ok;
    const range = [localSha, '--not', '--remotes=origin', ...(knownRemote ? [remoteSha] : [])];
    const log = git(['log', '-n', '500', '--format=%h%x09%an%x09%ae', ...range], { cwd: clone });
    for (const line of log.out.split('\n').filter(Boolean)) {
      const [sha, name, email] = line.split('\t');
      if (seen.has(sha)) continue;
      seen.add(sha);
      const problem = identityProblem(email, me, me ? people : []);
      if (problem) bad.push({ sha, name, email, problem });
    }
  }
  if (!bad.length) return;
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: clone });
  const base = upstream.ok ? upstream.out : 'origin/main';
  const out = [`hub: push refused. ${bad.length} outgoing commit(s) would not credit anyone's GitHub account:`];
  for (const entry of bad.slice(0, 8)) out.push(`  ${entry.sha} ${entry.name} <${entry.email}> (${entry.problem})`);
  if (bad.length > 8) out.push(`  ... and ${bad.length - 8} more`);
  out.push('Fix, in this clone only (never --global), then push again:');
  if (person && person.commitEmail) out.push(`  git config user.name "${person.name}"`, `  git config user.email "${person.commitEmail}"`);
  else out.push('  git config user.name "<your name>"', '  git config user.email "<your GitHub no-reply address from the hub team.json>"');
  out.push(`  git rebase ${base} --exec 'git commit --amend --no-edit --reset-author'`);
  console.error(out.join('\n'));
  process.exitCode = 1;
}

COMMANDS.credit = {
  usage: 'hub credit [--repo <project clone>]',
  summary: 'List who gets GitHub credit for recent project commits; flags bot and unknown identities.',
  details: 'Uses local git only, after one git fetch. Covers every origin/* branch not yet on main plus the last 30 commits on main. A commit credits a teammate when its author email is their team.json commitEmail or one of their emails. Exits 1 when any identity is unknown or a bot.',
  run(args) {
    const clone = projectClone(args);
    if (!clone) throw new UsageError('Run this inside the project clone, or pass --repo <path>.');
    const remote = git(['remote', 'get-url', 'origin'], { cwd: clone });
    const repoName = remote.ok ? basename(remote.out).replace(/\.git$/, '') : basename(clone);
    const report = creditReport(clone, teamPeople());
    console.log(renderCredit(report, repoName));
    if (report.unknown.length) process.exitCode = 1;
  },
};

COMMANDS.help = {
  usage: 'hub help [command]',
  summary: 'This list, or details for one command.',
  run(args) {
    const name = args._[0];
    if (name && COMMANDS[name]) {
      const command = COMMANDS[name];
      console.log(`${command.usage}\n\n${command.summary}${command.details ? `\n${command.details}` : ''}`);
      return;
    }
    console.log(renderHelp());
  },
};

function renderHelp() {
  const groups = [
    ['Read', ['sync', 'status', 'who', 'show', 'feed']],
    ['Pulses', ['pulse']],
    ['Work items', ['add', 'claim', 'update', 'note', 'block', 'done']],
    ['Questions', ['ask', 'answer', 'settle', 'comment']],
    ['Design feedback', ['design']],
    ['Calls on record and gates', ['propose', 'accept', 'reject', 'gate']],
    ['Knowledge and sessions', ['kb', 'learn', 'start', 'end']],
    ['Setup', ['setup', 'me', 'onboarded', 'doctor', 'credit', 'help']],
  ];
  const out = ['hub: the shared team board. Run from the hub folder as ./hub, or from anywhere as <path-to-hub>/hub.', ''];
  for (const [label, names] of groups) {
    out.push(`${label}:`);
    for (const name of names) out.push(`  ${COMMANDS[name].usage.split('\n')[0]}\n      ${COMMANDS[name].summary}`);
  }
  out.push('', 'Every write prints the new or touched id, commits one file, and pushes (retrying on races).', 'Text flags: -m "<text>" adds detail. Ids look like t-a3f9 (item), q- question, d- decision, g- gate, s- session.', 'Agents: build, push, and merge without waiting for anyone. Record a big call with propose and keep building. See "How decisions work" in AGENTS.md.', '--human means a person typed the command; accept, reject, and gate pass are for people and are optional.');
  return out.join('\n');
}

// ---------- entry ----------

export function main(argv) {
  let args;
  try {
    const [name = 'help', ...rest] = argv;
    const command = COMMANDS[name];
    if (!command) {
      console.error(`Unknown command "${name}".\n`);
      console.error(renderHelp());
      return 1;
    }
    // setup takes its own flags, --help included, so its arguments pass through untouched.
    if (command.passThrough) {
      command.run({ _: [], raw: rest });
      return typeof process.exitCode === 'number' ? process.exitCode : 0;
    }
    args = parseArgs(rest);
    if (args.help) {
      COMMANDS.help.run({ _: [name] });
      return 0;
    }
    command.run(args);
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      const name = argv[0];
      if (COMMANDS[name] && name !== 'help') console.error(`Usage: ${COMMANDS[name].usage}`);
      return 1;
    }
    console.error(`hub failed: ${error instanceof Error ? error.stack : error}`);
    return 3;
  }
}

function isInvokedDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
const invokedDirectly = isInvokedDirectly();
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
