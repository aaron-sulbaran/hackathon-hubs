#!/usr/bin/env node
// Scrub check: keeps private things out of a public repo, where every commit is permanent.
//
//   node scripts/scrub-check.mjs --tracked
//       Scans every file git tracks, as it is on disk.
//   node scripts/scrub-check.mjs --pre-push <remote> [<url>]
//       Run by .githooks/pre-push. Reads git's pre-push lines from stdin. For each pushed
//       ref it checks the ref name, every tag object on the way to the commit, the tree of
//       the pushed commit, and, for every commit the remote does not have yet: its
//       identity, headers, and message, and every path and blob it changed against each
//       of its parents (so content that lives only in a merge resolution is seen too).
//
// Built-in checks always run. Private terms run only when a terms file is found:
// $SCRUB_TERMS, else .private/scrub-terms.txt in the main worktree. One term per line,
// case-insensitive; lines starting with # are comments; lines starting with ! are allowed
// terms, and a hit that lies entirely inside an allowed term's match is ignored.
//
// Every path is checked every time it appears. Only the content scan of a blob is
// deduplicated, since it depends on nothing but the bytes. Binary files are scanned too:
// decoded as latin1 and as UTF-16, with hits reported at a byte offset. A file larger
// than MAX_SCAN_BYTES is a hit unless its path is listed in $SCRUB_ALLOW_LARGE.
//
// A line containing "scrub-check: allow" is skipped by the built-in checks, never by the
// private terms. Exit 0 when clean, 1 on any hit, 2 on a usage error, a git error, or
// anything the check cannot vouch for. Node built-ins only. This script never writes.

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Addresses that may appear in a tracked file. Add a shape here, not a one-off escape.
export const ALLOWED_EMAIL_SHAPES = [
  /@users\.noreply\.github\.com$/,
  /^noreply@anthropic\.com$/,
  /^noreply@github\.com$/,
  /^git@github\.com$/,
  /@example\.(com|org|net|edu)$/,
  /\.(example|test|invalid)$/,
];

// Author, committer, and tagger emails that count as noreply. Every pushed commit uses one.
export const NOREPLY_EMAIL_SHAPES = [
  /@users\.noreply\.github\.com$/,
  /^noreply@anthropic\.com$/,
  /^noreply@github\.com$/,
];

// Larger files are not scanned; they are a hit unless listed in LARGE_FILE_OVERRIDE.
export const MAX_SCAN_BYTES = 5 * 1024 * 1024;
// Comma-separated repo paths of deliberate large files that may go out unscanned.
export const LARGE_FILE_OVERRIDE = "SCRUB_ALLOW_LARGE";

// One `git cat-file --batch` call reads at most this many bytes of blobs.
const BATCH_BYTES = 256 * 1024 * 1024;

const ESCAPE_HATCH = "scrub-check: allow";
const ZERO_SHA = /^0+$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SUBMODULE_MODE = "160000";
const TREE_MODE = "040000";

// The lookbehind skips URL credentials such as "token:%s@github.com".
const EMAIL = /(?<![A-Za-z0-9._%+:\/-])[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

const SECRET_SHAPES = [
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: "GitHub token", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "Slack token", pattern: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g },
  { name: "Anthropic key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { name: "Stripe live key", pattern: /\b[rs]k_live_[A-Za-z0-9]{16,}/g },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { name: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: "private key", pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
];

// A token that says it is an example is a test fixture, not a leak.
const PLACEHOLDER_SECRET = /example|placeholder|redacted|x{8,}/i;

const UNLOCK_LINK = /unlock\?key=([^\s"'`<>)\]]*|<[^>]*>)/g;
const KEY_CHARS = /^[A-Za-z0-9_-]+/;
const PLACEHOLDER_KEY = /^[<${]|your|example|placeholder|redacted|^x+$/i;

const HOME_PATHS = [
  /(?<![A-Za-z0-9_.-])\/Users\/([^/\s"'`]+)\//g,
  /(?<![A-Za-z0-9_.-])\/home\/([^/\s"'`]+)\//g,
  /\b[A-Za-z]:\\{1,2}Users\\{1,2}([^\\\s"'`]+)\\/g,
];
const PLACEHOLDER_HOMES = new Set([
  "you", "user", "username", "me", "name", "yourname", "your-name", "your_name",
  "example", "someone", "runner", "shared", "public", "default",
]);
const PLACEHOLDER_HOME_START = /^[<${*.~]/;

const ARTIFACT_LINK = /claude\.ai\/artifact\//g;

class UsageError extends Error {}
class GitError extends Error {}
// Something the check cannot vouch for, so the push stops instead of passing.
class CannotVouch extends Error {}

// Replace objects would let git show this script a different object than the one a
// push sends, so they are always off here.
const GIT_ENV = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" };

function git(args, options = {}) {
  const result = spawnSync("git", args, { maxBuffer: 1 << 30, env: GIT_ENV, ...options });
  if (result.error) throw new GitError(`git ${args[0]}: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new GitError(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
  return result.stdout;
}

function gitText(args, options) {
  return git(args, options).toString("utf8");
}

function excerpt(line, index, length) {
  const start = Math.max(0, index - 30);
  const end = Math.min(line.length, index + length + 30);
  const text = line
    .slice(start, end)
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
  return (start > 0 ? "..." : "") + text + (end < line.length ? "..." : "");
}

function masked(value) {
  return value.length <= 10 ? value : `${value.slice(0, 8)}...`;
}

// Built-in checks for one line. Returns [{ check, excerpt, index }].
export function builtinHits(line) {
  if (line.includes(ESCAPE_HATCH)) return [];
  const hits = [];

  for (const match of line.matchAll(EMAIL)) {
    const address = match[0].toLowerCase();
    if (ALLOWED_EMAIL_SHAPES.some((shape) => shape.test(address))) continue;
    hits.push({ check: "email", excerpt: excerpt(line, match.index, match[0].length), index: match.index });
  }

  for (const { name, pattern } of SECRET_SHAPES) {
    for (const match of line.matchAll(pattern)) {
      if (PLACEHOLDER_SECRET.test(match[0])) continue;
      hits.push({ check: `secret (${name})`, excerpt: masked(match[0]), index: match.index });
    }
  }

  for (const match of line.matchAll(UNLOCK_LINK)) {
    const raw = match[1];
    if (PLACEHOLDER_KEY.test(raw)) continue;
    const key = (raw.match(KEY_CHARS) || [""])[0];
    if (key.length < 16 || /^(.)\1*$/.test(key)) continue;
    hits.push({ check: "unlock link", excerpt: `unlock?key=${masked(key)}`, index: match.index });
  }

  for (const pattern of HOME_PATHS) {
    for (const match of line.matchAll(pattern)) {
      const name = match[1];
      if (PLACEHOLDER_HOME_START.test(name) || PLACEHOLDER_HOMES.has(name.toLowerCase())) continue;
      hits.push({ check: "home path", excerpt: excerpt(line, match.index, match[0].length), index: match.index });
    }
  }

  for (const match of line.matchAll(ARTIFACT_LINK)) {
    hits.push({ check: "private artifact link", excerpt: excerpt(line, match.index, match[0].length), index: match.index });
  }

  return hits;
}

function occurrences(haystack, needle) {
  const spans = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return spans;
    spans.push([index, index + needle.length]);
    from = index + 1;
  }
}

// Private terms for one string. Returns the terms that hit outside every allowed span.
export function termHits(text, terms) {
  if (!terms || terms.blocked.length === 0) return [];
  const lower = text.toLowerCase();
  const allowedSpans = terms.allowed.flatMap((term) => occurrences(lower, term));
  const hits = [];
  for (const term of terms.blocked) {
    const outside = occurrences(lower, term).some(
      ([start, end]) => !allowedSpans.some(([allowStart, allowEnd]) => allowStart <= start && end <= allowEnd),
    );
    if (outside) hits.push(term);
  }
  return hits;
}

export function parseTerms(text) {
  const blocked = [];
  const allowed = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!")) {
      const term = line.slice(1).trim().toLowerCase();
      if (term) allowed.push(term);
    } else {
      blocked.push(line.toLowerCase());
    }
  }
  return { blocked, allowed };
}

function findTermsFile(cwd) {
  if (process.env.SCRUB_TERMS) {
    if (!existsSync(process.env.SCRUB_TERMS)) {
      throw new UsageError(`SCRUB_TERMS points at a file that does not exist: ${process.env.SCRUB_TERMS}`);
    }
    return process.env.SCRUB_TERMS;
  }
  const commonDir = gitText(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd }).trim();
  const mainWorktree = path.dirname(commonDir);
  const candidate = path.join(mainWorktree, ".private", "scrub-terms.txt");
  return existsSync(candidate) ? candidate : null;
}

function termHit(term) {
  return { check: "private term", excerpt: term };
}

// One scan per run: what it found, what it has already looked at, and what it scanned.
function makeScan(terms) {
  const hits = [];
  return {
    terms,
    hits,
    report: (line) => hits.push(line),
    seenPaths: new Set(),
    seenBlobs: new Set(),
    seenCommits: new Set(),
    seenTags: new Set(),
    scannedFiles: 0,
    largeAllowed: new Set(
      String(process.env[LARGE_FILE_OVERRIDE] || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  };
}

// Checks a short public string (a path, a ref name, an identity) with both kinds of check.
function checkName(scan, label, value) {
  for (const hit of builtinHits(value)) scan.report(`${label}: ${hit.check}: ${hit.excerpt}`);
  for (const term of termHits(value, scan.terms)) scan.report(`${label}: private term: ${term}`);
}

function checkPath(scan, file, label) {
  if (scan.seenPaths.has(file)) return;
  scan.seenPaths.add(file);
  for (const hit of [...builtinHits(file), ...termHits(file, scan.terms).map(termHit)]) {
    scan.report(`${label}: path: ${hit.check}: ${hit.excerpt}`);
  }
}

function isBinary(buffer) {
  return buffer.includes(0);
}

// Splits on line breaks and NUL bytes and reports each hit at its byte offset.
function scanDecoded(scan, label, text, bytesPerChar, encoding) {
  for (const match of text.matchAll(/[^\0\r\n]+/g)) {
    const segment = match[0];
    const at = (index) => `byte ${(match.index + index) * bytesPerChar}${encoding}`;
    for (const hit of builtinHits(segment)) scan.report(`${label}: ${at(hit.index)}: ${hit.check}: ${hit.excerpt}`);
    const lower = segment.toLowerCase();
    for (const term of termHits(segment, scan.terms)) scan.report(`${label}: ${at(lower.indexOf(term))}: private term: ${term}`);
  }
}

function scanContent(scan, label, buffer) {
  scan.scannedFiles++;
  if (isBinary(buffer)) {
    // Lenient decodes, so a token next to a stray NUL byte, or in UTF-16 text, is still seen.
    scanDecoded(scan, label, buffer.toString("latin1"), 1, " (binary)");
    scanDecoded(scan, label, buffer.subarray(0, buffer.length - (buffer.length % 2)).toString("utf16le"), 2, " (binary, utf-16)");
    return;
  }
  buffer
    .toString("utf8")
    .split(/\r\n|\r|\n/)
    .forEach((line, index) => {
      const hits = [...builtinHits(line), ...termHits(line, scan.terms).map(termHit)];
      for (const hit of hits) scan.report(`${label}:${index + 1}: ${hit.check}: ${hit.excerpt}`);
    });
}

// A file over the limit is a hit, unless it is named in the override, which warns loudly.
function checkLarge(scan, file, label, size) {
  if (size <= MAX_SCAN_BYTES) return false;
  const limit = `${MAX_SCAN_BYTES / (1024 * 1024)} MB`;
  if (scan.largeAllowed.has(file)) {
    console.error(`scrub-check: WARNING: ${label} is ${size} bytes, over the ${limit} scan limit, and goes out UNSCANNED because ${LARGE_FILE_OVERRIDE} names it.`);
  } else {
    scan.report(`${label}: too large to scan (${size} bytes, over the ${limit} limit). If it is a deliberate large file, push it with ${LARGE_FILE_OVERRIDE}=${file}`);
  }
  return true;
}

function readWorkingFile(root, file) {
  const full = path.join(root, file);
  let stat;
  try {
    stat = lstatSync(full);
  } catch {
    return { kind: "gone" }; // deleted in the working tree
  }
  if (stat.isSymbolicLink()) return { kind: "file", size: 0, read: () => Buffer.from(readlinkSync(full)) };
  if (!stat.isFile()) return { kind: "other" }; // a submodule folder: its path is still checked
  return { kind: "file", size: stat.size, read: () => readFileSync(full) };
}

function scanTracked(scan, root) {
  const files = gitText(["ls-files", "-z"], { cwd: root }).split("\0").filter(Boolean);
  for (const file of files) {
    checkPath(scan, file, file);
    const found = readWorkingFile(root, file);
    if (found.kind !== "file") continue;
    if (checkLarge(scan, file, file, found.size)) continue;
    scanContent(scan, file, found.read());
  }
}

// Sizes and types for many objects through one `git cat-file --batch-check`.
function objectSizes(cwd, shas) {
  const sizes = new Map();
  if (shas.length === 0) return sizes;
  const output = gitText(["cat-file", "--batch-check"], { cwd, input: shas.join("\n") + "\n" });
  for (const line of output.split("\n").filter(Boolean)) {
    const [sha, type, size] = line.split(" ");
    if (type === "missing") throw new CannotVouch(`object ${sha} is missing from this clone, so it cannot be scanned. Run git fetch, then push again.`);
    sizes.set(sha, { type, size: Number(size) });
  }
  return sizes;
}

// Reads many blobs through `git cat-file --batch`, a bounded number of bytes per call.
function readBlobs(cwd, wanted) {
  const blobs = new Map();
  let start = 0;
  while (start < wanted.length) {
    let end = start;
    let bytes = 0;
    while (end < wanted.length && (end === start || bytes + wanted[end].size <= BATCH_BYTES)) bytes += wanted[end++].size;
    const output = git(["cat-file", "--batch"], { cwd, input: wanted.slice(start, end).map((blob) => blob.sha).join("\n") + "\n" });
    let offset = 0;
    while (offset < output.length) {
      const newline = output.indexOf(10, offset);
      const header = output.subarray(offset, newline).toString("utf8").split(" ");
      offset = newline + 1;
      if (header[1] === "missing") throw new CannotVouch(`object ${header[0]} is missing from this clone, so it cannot be scanned.`);
      const size = Number(header[2]);
      blobs.set(header[0], output.subarray(offset, offset + size));
      offset += size + 1;
    }
    start = end;
  }
  return blobs;
}

// Checks every entry's path, then scans each blob not scanned before, once.
function scanEntries(scan, cwd, entries, short) {
  const pending = new Map();
  for (const entry of entries) {
    const label = `${entry.path}@${short}`;
    checkPath(scan, entry.path, label);
    // A submodule entry names a commit in another repo; nothing of it is pushed with this one.
    if (entry.mode === SUBMODULE_MODE || entry.mode === TREE_MODE) continue;
    if (scan.seenBlobs.has(entry.sha) || pending.has(entry.sha)) continue;
    pending.set(entry.sha, { ...entry, label });
  }
  const sizes = objectSizes(cwd, [...pending.keys()]);
  const wanted = [];
  for (const [sha, entry] of pending) {
    const { type, size } = sizes.get(sha) ?? {};
    if (type !== "blob") throw new CannotVouch(`${entry.label} has mode ${entry.mode} but object ${sha} is a ${type ?? "unknown object"}, so it cannot be scanned.`);
    scan.seenBlobs.add(sha);
    if (checkLarge(scan, entry.path, entry.label, size)) continue;
    wanted.push({ ...entry, size });
  }
  const blobs = readBlobs(cwd, wanted);
  for (const entry of wanted) scanContent(scan, entry.label, blobs.get(entry.sha));
}

function treeEntries(cwd, commit) {
  // -t lists folders too, so a folder name is checked even when the folder holds nothing.
  const raw = gitText(["ls-tree", "-r", "-t", "-z", "--full-tree", commit], { cwd });
  return raw
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const [mode, , sha] = entry.slice(0, tab).split(" ");
      return { mode, sha, path: entry.slice(tab + 1) };
    });
}

// Every path and blob a commit changed against each of its parents. -m makes a merge
// show its changes against every parent, so a file that differs from any parent is seen.
function changedEntries(cwd, commit) {
  const raw = gitText(
    ["diff-tree", "-r", "-t", "-z", "-m", "--root", "--no-renames", "--ignore-submodules=none", "--no-commit-id", commit],
    { cwd },
  );
  const parts = raw.split("\0");
  const entries = [];
  for (let index = 0; index < parts.length; index++) {
    const meta = parts[index];
    if (!meta) continue;
    if (!meta.startsWith(":")) throw new CannotVouch(`unexpected git diff-tree output for ${commit.slice(0, 10)}: ${meta.slice(0, 60)}`);
    const [, mode, , sha, status = ""] = meta.slice(1).split(" ");
    const file = parts[++index];
    if (status.startsWith("R") || status.startsWith("C")) index++; // never with --no-renames
    if (status === "D") continue;
    entries.push({ mode, sha, path: file });
  }
  return entries;
}

// Headers and message of a raw commit or tag object. Continuation lines join their header.
function parseObject(raw) {
  const split = raw.indexOf("\n\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const message = split === -1 ? "" : raw.slice(split + 2);
  const headers = [];
  for (const line of head.split("\n")) {
    if (line.startsWith(" ") && headers.length) headers[headers.length - 1].value += `\n${line.slice(1)}`;
    else {
      const space = line.indexOf(" ");
      headers.push(space === -1 ? { name: line, value: "" } : { name: line.slice(0, space), value: line.slice(space + 1) });
    }
  }
  return { headers, message };
}

function parseIdent(value) {
  const match = /^(.*?) ?<([^>]*)>/.exec(value);
  return match ? { name: match[1], email: match[2] } : { name: value, email: "" };
}

function checkIdent(scan, label, role, value, allowIdentity) {
  const { name, email } = parseIdent(value);
  if (!allowIdentity && !NOREPLY_EMAIL_SHAPES.some((shape) => shape.test(email.trim().toLowerCase()))) {
    scan.report(`${label}: identity: ${role} email ${email} is not a noreply address`);
  }
  for (const term of termHits(name, scan.terms)) scan.report(`${label}: ${role} name: private term: ${term}`);
  for (const term of termHits(email, scan.terms)) scan.report(`${label}: ${role} email: private term: ${term}`);
}

function checkMessage(scan, label, message, allowIdentity) {
  message.split(/\r\n|\r|\n/).forEach((line, index) => {
    const builtins = builtinHits(line).filter((hit) => !(allowIdentity && hit.check === "email"));
    for (const hit of builtins) scan.report(`${label} message:${index + 1}: ${hit.check}: ${hit.excerpt}`);
    for (const term of termHits(line, scan.terms)) scan.report(`${label} message:${index + 1}: private term: ${term}`);
  });
}

// Any header beyond the structural ones (a mergetag holds a whole tag; encoding; a
// signature) is public too, so it gets both kinds of check, line by line.
function checkExtraHeader(scan, label, header, allowIdentity) {
  header.value.split("\n").forEach((line, index) => {
    const builtins = builtinHits(line).filter((hit) => !(allowIdentity && hit.check === "email"));
    for (const hit of builtins) scan.report(`${label} ${header.name}:${index + 1}: ${hit.check}: ${hit.excerpt}`);
    for (const term of termHits(line, scan.terms)) scan.report(`${label} ${header.name}:${index + 1}: private term: ${term}`);
  });
}

function scanCommitObject(scan, cwd, sha, allowIdentity) {
  const label = `commit ${sha.slice(0, 10)}`;
  const { headers, message } = parseObject(gitText(["cat-file", "commit", sha], { cwd }));
  for (const header of headers) {
    if (header.name === "tree" || header.name === "parent") continue;
    if (header.name === "author" || header.name === "committer") checkIdent(scan, label, header.name, header.value, allowIdentity);
    else checkExtraHeader(scan, label, header, allowIdentity);
  }
  checkMessage(scan, label, message, allowIdentity);
}

// Follows tags down to the commit they name, checking each tag object on the way.
function peelToCommit(scan, cwd, sha, ref, allowIdentity) {
  for (let depth = 0; depth < 32; depth++) {
    const type = gitText(["cat-file", "-t", sha], { cwd }).trim();
    if (type === "commit") return sha;
    if (type !== "tag") {
      throw new CannotVouch(`${ref} points at a ${type}, not a commit or a tag. scrub-check does not vouch for that, so the push stops here.`);
    }
    const label = `tag ${sha.slice(0, 10)}`;
    const { headers, message } = parseObject(gitText(["cat-file", "tag", sha], { cwd }));
    let target = null;
    for (const header of headers) {
      if (header.name === "object") target = header.value.trim();
      else if (header.name === "type") continue;
      else if (header.name === "tagger") checkIdent(scan, label, "tagger", header.value, allowIdentity);
      else if (header.name === "tag") checkName(scan, `${label} name`, header.value);
      else checkExtraHeader(scan, label, header, allowIdentity);
    }
    if (!scan.seenTags.has(sha)) checkMessage(scan, label, message, allowIdentity);
    scan.seenTags.add(sha);
    if (!target || !OBJECT_ID.test(target)) throw new CannotVouch(`${label} does not name a valid object.`);
    sha = target;
  }
  throw new CannotVouch(`${ref} is a chain of more than 32 tags.`);
}

// The commits the push sends: everything reachable from the pushed commit that the
// remote's old value does not reach. For a new ref, the remote-tracking refs stand in.
function newCommits(cwd, remote, commit, remoteRef, remoteSha) {
  if (ZERO_SHA.test(remoteSha)) {
    return gitText(["rev-list", commit, "--not", `--remotes=${remote}`], { cwd }).split("\n").filter(Boolean);
  }
  const known = spawnSync("git", ["cat-file", "-e", `${remoteSha}^{commit}`], { cwd, env: GIT_ENV });
  if (known.error || known.status !== 0) {
    throw new CannotVouch(
      `${remote} has ${remoteRef} at ${remoteSha.slice(0, 10)}, which this clone does not have, so scrub-check cannot tell which commits are new. Run git fetch ${remote}, then push again.`,
    );
  }
  // Correct for a force push too: commits the old remote value reaches are public already.
  return gitText(["rev-list", commit, "--not", remoteSha], { cwd }).split("\n").filter(Boolean);
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch (error) {
    if (error.code === "EOF") return "";
    throw new UsageError(`could not read the pushed refs from stdin: ${error.message}`);
  }
}

function scanPrePush(scan, root, remote) {
  const allowIdentity = process.env.SCRUB_ALLOW_IDENTITY === "1";
  if (allowIdentity) {
    console.error("scrub-check: WARNING: SCRUB_ALLOW_IDENTITY=1 is set. Author, committer, and tagger emails are NOT being checked.");
    console.error("scrub-check: WARNING: use this only to push a contributor's commits, never your own.");
  }
  // Grafts change what rev-list sees but not what a push sends.
  const grafts = gitText(["rev-parse", "--path-format=absolute", "--git-path", "info/grafts"], { cwd: root }).trim();
  if (existsSync(grafts)) throw new CannotVouch(`${grafts} exists, so git history here is not what a push sends. Remove it, then push again.`);

  for (const line of readStdin().split("\n")) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !OBJECT_ID.test(fields[1]) || !OBJECT_ID.test(fields[3])) {
      throw new UsageError(`unexpected pre-push line from git: ${line.trim().slice(0, 120)}`);
    }
    const [, localSha, remoteRef, remoteSha] = fields;
    if (ZERO_SHA.test(localSha)) continue; // a deleted ref pushes no content

    checkName(scan, `ref ${remoteRef}`, remoteRef);
    const commit = peelToCommit(scan, root, localSha, remoteRef, allowIdentity);
    const short = commit.slice(0, 10);
    scanEntries(scan, root, treeEntries(root, commit), short);

    for (const each of newCommits(root, remote, commit, remoteRef, remoteSha)) {
      if (scan.seenCommits.has(each)) continue;
      scan.seenCommits.add(each);
      scanCommitObject(scan, root, each, allowIdentity);
      scanEntries(scan, root, changedEntries(root, each), each.slice(0, 10));
    }
  }
}

function run(argv) {
  const mode = argv[0];
  if (mode !== "--tracked" && mode !== "--pre-push") {
    throw new UsageError("usage: scrub-check.mjs --tracked | --pre-push <remote> [<url>]");
  }
  if (mode === "--pre-push" && !argv[1]) throw new UsageError("usage: scrub-check.mjs --pre-push <remote> [<url>]");

  const root = gitText(["rev-parse", "--show-toplevel"]).trim();
  const termsFile = findTermsFile(root);
  const terms = termsFile ? parseTerms(readFileSync(termsFile, "utf8")) : null;
  if (!terms) console.log("scrub-check: no private terms file found; only the built-in checks ran.");

  const scan = makeScan(terms);
  if (mode === "--tracked") scanTracked(scan, root);
  else scanPrePush(scan, root, argv[1]);

  for (const hit of scan.hits) console.log(hit);
  const termsNote = terms ? "built-in checks and private terms" : "built-in checks only";
  const count = scan.hits.length;
  console.log(`scrub-check: ${scan.scannedFiles} files scanned (${termsNote}), ${count} hit${count === 1 ? "" : "s"}.`);
  return count === 0 ? 0 : 1;
}

function main() {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    // Anything unexpected stops the push too: exit 2, never 0.
    const known = error instanceof UsageError || error instanceof GitError || error instanceof CannotVouch;
    console.error(`scrub-check: ${known ? error.message : `unexpected error: ${error?.stack || error}`}`);
    process.exitCode = 2;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
