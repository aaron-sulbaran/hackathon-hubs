// Git helpers the hub CLI uses on a teammate's clone: commit identity (credit) and, for pulses,
// what this clone is working on. Zero dependencies. Every function takes the clone path explicitly.

import { spawnSync } from 'node:child_process';

// Git exports these to every hook it runs so the hook's own git commands find the same
// repository. The hub CLI is started from hooks in project clones and worktrees, and its git
// commands must act on the folder they are pointed at, never on the repository that fired the
// hook. Inherited, they would send hub event commits into a project worktree's branch.
const GIT_REPOSITORY_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_PREFIX',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_NAMESPACE',
  'GIT_GRAFT_FILE',
  'GIT_SHALLOW_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
];

/** The current environment without git's repository-locating variables, plus `extra` (an undefined value removes a key). @param {Record<string, string|undefined>} [extra] */
export function cleanGitEnv(extra = {}) {
  /** @type {Record<string, string|undefined>} */
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  for (const key of GIT_REPOSITORY_ENV) delete env[key];
  for (const key of Object.keys(env)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) delete env[key];
  Object.assign(env, extra);
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return env;
}

/** @param {string[]} args @param {string} cwd @param {{ timeoutMs?: number, env?: Record<string, string|undefined>, raw?: boolean }} [options] */
export function gitIn(args, cwd, options = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30000,
    env: cleanGitEnv(options.env),
  });
  return {
    ok: result.status === 0,
    out: options.raw ? result.stdout || '' : (result.stdout || '').trim(),
    err: (result.stderr || (result.error ? String(result.error.message) : '')).trim(),
  };
}

// ---------- identity and credit ----------

/** @param {any} person */
function personEmails(person) {
  return [person.commitEmail, ...(Array.isArray(person.emails) ? person.emails : [])].filter(Boolean).map((email) => String(email).toLowerCase());
}

/**
 * Why an author email will not credit `personId` on GitHub, or null when it is fine.
 * @param {string} email @param {string|null} personId @param {any[]} people
 */
export function identityProblem(email, personId, people) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!value) return 'no email set';
  if (value.endsWith('@hub.invalid')) return 'a placeholder @hub.invalid address';
  if (value.includes('devin-ai-integration') || value.includes('[bot]')) return 'a bot identity';
  if (value === 'noreply@anthropic.com') return 'the Claude address';
  const other = people.find((person) => person.id !== personId && personEmails(person).includes(value));
  if (other) return `${other.id}'s address`;
  return null;
}

/** Find the teammate an email belongs to. @param {string} email @param {any[]} people */
export function personForEmail(email, people) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!value || identityProblem(value, null, []) !== null) return null;
  return people.find((person) => personEmails(person).includes(value)) ?? null;
}

/**
 * Check the effective git identity of a clone for the acting person, and fix a BAD one in the
 * clone's LOCAL config (never --global). A personal email that is not BAD is left alone.
 * @param {string} cwd @param {string|null} personId @param {any[]} people @param {{ fix?: boolean }} [options]
 * `cause` says why a bad identity was not fixed: no person known (HUB_ME unset), or no commitEmail for them.
 * @returns {{ ok: boolean, fixed: boolean, name: string, email: string, problem: string|null, line: string, cause?: 'no-person'|'no-commit-email' }}
 */
export function checkIdentity(cwd, personId, people, options = {}) {
  const fix = options.fix !== false;
  const name = gitIn(['config', 'user.name'], cwd).out;
  const email = gitIn(['config', 'user.email'], cwd).out;
  const person = people.find((entry) => entry.id === personId) ?? null;
  const problem = identityProblem(email, personId, people);
  // Names only: a doctor log gets pasted into chats, so it says an email is set without printing it.
  const shown = email ? `${name || '(no name)'}, with an email set` : 'not set';
  if (!problem) return { ok: true, fixed: false, name, email, problem: null, line: `${shown}, credits ${person ? person.github || person.id : 'its owner'}` };
  if (!person) {
    return { ok: false, fixed: false, name, email, problem, cause: 'no-person', line: `${shown} is ${problem}, and the hub does not know who you are, so it cannot set your name` };
  }
  if (!person.commitEmail) {
    return { ok: false, fixed: false, name, email, problem, cause: 'no-commit-email', line: `${shown} is ${problem}, and team.json has no commitEmail for ${person.id}, so the hub cannot set it for you` };
  }
  if (!fix) return { ok: false, fixed: false, name, email, problem, line: `${shown} is ${problem}` };
  const setName = gitIn(['config', '--local', 'user.name', person.name], cwd);
  const setEmail = gitIn(['config', '--local', 'user.email', person.commitEmail], cwd);
  if (!setName.ok || !setEmail.ok) return { ok: false, fixed: false, name, email, problem, line: `${shown} is ${problem}, and setting the local config failed: ${setEmail.err || setName.err}` };
  return { ok: true, fixed: true, name: person.name, email: person.commitEmail, problem, line: `was ${shown} (${problem}); set this clone's local config to ${person.name} and the commitEmail team.json has for ${person.id}` };
}

/**
 * Author identities of commits on every origin/* branch not yet on origin/main, plus the last 30 on main.
 * @param {string} cwd @param {any[]} people @param {{ fetch?: boolean }} [options]
 */
export function creditReport(cwd, people, options = {}) {
  if (options.fetch !== false) gitIn(['fetch', '-q', 'origin'], cwd, { timeoutMs: 30000 });
  const refs = gitIn(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/'], cwd).out.split('\n').filter((ref) => ref && ref !== 'origin/HEAD' && ref !== 'origin' && ref !== 'origin/main');
  /** @type {Map<string, { sha: string, name: string, email: string, branch: string }>} */
  const commits = new Map();
  /** @param {string[]} args @param {string} branch */
  const collect = (args, branch) => {
    const log = gitIn(['log', '--format=%h%x09%an%x09%ae', ...args], cwd);
    if (!log.ok) return;
    for (const row of log.out.split('\n').filter(Boolean)) {
      const [sha, name, email] = row.split('\t');
      if (!commits.has(sha)) commits.set(sha, { sha, name, email, branch });
    }
  };
  for (const ref of refs) collect([ref, '--not', 'origin/main'], ref.replace(/^origin\//, ''));
  collect(['-30', 'origin/main'], 'main');

  /** @type {Map<string, { person: any, count: number, emails: Set<string> }>} */
  const credited = new Map();
  /** @type {Map<string, { identity: string, problem: string, branches: Map<string, string[]> }>} */
  const unknown = new Map();
  for (const commit of commits.values()) {
    const person = personForEmail(commit.email, people);
    if (person) {
      const entry = credited.get(person.id) ?? { person, count: 0, emails: new Set() };
      entry.count += 1;
      entry.emails.add(commit.email);
      credited.set(person.id, entry);
      continue;
    }
    const identity = `${commit.name} <${commit.email}>`;
    const entry = unknown.get(identity) ?? { identity, problem: identityProblem(commit.email, null, []) ?? 'not in team.json', branches: new Map() };
    entry.branches.set(commit.branch, [...(entry.branches.get(commit.branch) ?? []), commit.sha]);
    unknown.set(identity, entry);
  }
  return { credited: [...credited.values()], unknown: [...unknown.values()], total: commits.size };
}

/** @param {ReturnType<typeof creditReport>} report @param {string} repoName */
export function renderCredit(report, repoName) {
  const out = [`Credit check, ${repoName}: ${report.total} commit(s) (branches not on main, plus the last 30 on main).`];
  for (const entry of report.credited.sort((a, b) => b.count - a.count)) {
    out.push(`  ${entry.person.id.padEnd(6)} ${String(entry.count).padStart(3)} commit(s) credit ${entry.person.github || entry.person.id}`);
  }
  if (report.unknown.length) {
    out.push('UNKNOWN, will not be credited:');
    for (const entry of report.unknown) {
      const where = [...entry.branches].map(([branch, shas]) => `${branch}: ${shas.slice(0, 6).join(' ')}${shas.length > 6 ? ` +${shas.length - 6}` : ''}`).join('; ');
      out.push(`  ${entry.identity} (${entry.problem}) on ${where}`);
    }
    out.push('Fix: the author runs ./hub doctor in their clone, then rewrites unpushed commits (git rebase <upstream> --exec \'git commit --amend --no-edit --reset-author\'). A personal email can be added to their "emails" in team.json if it is verified on their GitHub account.');
  } else out.push('Every commit is credited to a teammate.');
  return out.join('\n');
}

// ---------- pulses: what this clone is working on ----------

/**
 * The project's lanes and shared files, from the project repo's AGENTS.md ("Lanes and the folders
 * each owns"). The one place the CLI decides "in your lane". Longest matching prefix wins; shared wins over all.
 */
export const LANE_TABLE = {
  shared: ['package.json', 'pnpm-lock.yaml', 'app/layout.tsx', 'app/globals.css', 'components/ui/'],
  // Filled in once the product repo exists and its AGENTS.md names the lanes.
  lanes: {},
};

/** @param {string} file @param {string} prefix */
function under(file, prefix) {
  return prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix;
}

/** Lane key from a branch named <id>/<lane>-<slug>, or null. @param {string|null} branch */
export function laneForBranch(branch) {
  const slug = String(branch ?? '').split('/')[1];
  if (!slug) return null;
  const word = slug.split('-')[0].toLowerCase();
  for (const [key, lane] of Object.entries(LANE_TABLE.lanes)) if (key === word || lane.aliases.includes(word)) return key;
  return null;
}

/** Which lane owns a file: 'shared', a lane key, or null. @param {string} file */
export function laneOfFile(file) {
  if (LANE_TABLE.shared.some((prefix) => under(file, prefix))) return 'shared';
  let best = null;
  let bestLength = -1;
  for (const [key, lane] of Object.entries(LANE_TABLE.lanes)) {
    if ((lane.except ?? []).includes(file)) continue;
    for (const prefix of [...lane.owns, `components/${key}/`]) {
      if (under(file, prefix) && prefix.length > bestLength) {
        best = key;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/**
 * What a pulse reports about a clone. Reads local git only; fetching is the caller's call.
 * @param {string} cwd
 */
export function gatherPulse(cwd) {
  const remote = gitIn(['remote', 'get-url', 'origin'], cwd);
  const top = gitIn(['rev-parse', '--show-toplevel'], cwd).out || cwd;
  const repo = (remote.ok ? remote.out : top).split(/[\\/:]/).pop()?.replace(/\.git$/, '') || 'repo';
  const branchResult = gitIn(['symbolic-ref', '--short', 'HEAD'], cwd);
  const branch = branchResult.ok ? branchResult.out : null;
  const hasMain = gitIn(['rev-parse', '-q', '--verify', 'refs/remotes/origin/main'], cwd).ok;
  let ahead = 0;
  let behind = 0;
  let base = null;
  if (hasMain) {
    const counts = gitIn(['rev-list', '--left-right', '--count', 'HEAD...origin/main'], cwd);
    if (counts.ok) [ahead, behind] = counts.out.split(/\s+/).map((value) => Number(value) || 0);
    const mergeBase = gitIn(['merge-base', 'HEAD', 'origin/main'], cwd);
    if (mergeBase.ok) base = mergeBase.out;
  }
  const pushed = Boolean(branch) && gitIn(['rev-parse', '-q', '--verify', `refs/remotes/origin/${branch}`], cwd).ok && gitIn(['merge-base', '--is-ancestor', 'HEAD', `origin/${branch}`], cwd).ok;
  const remoteBranch = Boolean(branch) && gitIn(['rev-parse', '-q', '--verify', `refs/remotes/origin/${branch}`], cwd).ok;
  const files = new Set();
  if (base) for (const file of gitIn(['diff', '--name-only', '--no-renames', base, 'HEAD'], cwd).out.split('\n')) if (file) files.add(file);
  const entries = gitIn(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd, { raw: true }).out.split('\0');
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.length < 4) continue;
    files.add(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') index += 1; // the next field is the old path
  }
  const mainChanged = base && behind > 0 ? gitIn(['diff', '--name-only', '--no-renames', base, 'origin/main'], cwd).out.split('\n').filter(Boolean) : [];
  return { repo, branch, pushed, remoteBranch, ahead, behind, files: [...files].sort().slice(0, 60), mainChanged };
}

/** Find the branch's PR with gh, within 5 seconds; null on any failure. @param {string} cwd */
export function findPr(cwd) {
  const result = spawnSync('gh', ['pr', 'view', '--json', 'number,url,state'], { cwd, encoding: 'utf8', timeout: 5000, env: cleanGitEnv({ GH_PROMPT_DISABLED: '1' }) });
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    return Number.isInteger(parsed.number) ? { number: parsed.number, url: String(parsed.url ?? ''), state: String(parsed.state ?? 'OPEN').toLowerCase() } : null;
  } catch {
    return null;
  }
}

/** @param {string} value */
export function parsePrFlag(value) {
  const text = String(value).trim();
  const match = /(?:^#?|\/pull\/)(\d+)\/?$/.exec(text);
  if (!match) return null;
  return { number: Number(match[1]), url: /^https?:\/\//.test(text) ? text : '', state: 'open' };
}

/** @param {string[]} list @param {number} [max] */
function nameFiles(list, max = 3) {
  return `${list.slice(0, max).join(', ')}${list.length > max ? ` and ${list.length - max} more` : ''}`;
}

/** @param {{ behind: number, files: string[], mainChanged: string[] }} pulse */
export function pullAdvice(pulse) {
  if (!pulse.behind) return null;
  const mine = new Set(pulse.files);
  const touched = pulse.mainChanged.filter((file) => mine.has(file));
  if (touched.length) return `Rebase now: main changed ${touched.length} of your files (${nameFiles(touched)}).`;
  return `main moved ${pulse.behind} commit${pulse.behind === 1 ? '' : 's'}, none touch your files. Rebase before you open or update a PR.`;
}

/** @param {{ branch: string|null, pushed: boolean, remoteBranch?: boolean, behind: number, files: string[], pr: any }} pulse @param {string} [hub] */
export function prAdvice(pulse, hub = './hub') {
  if (!pulse.branch || pulse.branch === 'main') return null;
  const pr = pulse.pr;
  if (pr && pr.state === 'merged') return `PR #${pr.number} merged. Pulse again, and ${hub} done <t-id> if the item is finished.`;
  if (pr && pr.state === 'closed') return `PR #${pr.number} is closed without merging.`;
  if (!pulse.pushed) return pulse.remoteBranch ? 'Local commits not pushed: push so teammates can see them.' : 'Local only: push the branch so teammates can see it.';
  if (!pr) return 'Pushed, no PR: open one when checks are green.';
  if (pulse.behind > 0) return `PR #${pr.number} open and behind main: rebase and push.`;
  const shared = pulse.files.filter((file) => laneOfFile(file) === 'shared');
  if (shared.length) return `PR #${pr.number} touches shared files (${nameFiles(shared)}): merge it, and say so in your pulse so others pull.`;
  return `PR #${pr.number}: merge it when your checks pass.`;
}

/** @param {number} ms */
function shortSpan(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * One line per teammate whose latest pulse in this repo lists a file I list too.
 * @param {any} board folded board @param {string} me @param {string} repo @param {string[]} myFiles @param {{ now?: number, hub?: string }} [options]
 */
export function overlapLines(board, me, repo, myFiles, options = {}) {
  const now = options.now ?? Date.now();
  const hub = options.hub ?? './hub';
  const mine = new Set(myFiles);
  /** @type {Map<string, { pulse: any, files: string[] }>} */
  const byPerson = new Map();
  for (const overlap of board.overlaps ?? []) {
    if (overlap.repo !== repo || !mine.has(overlap.file)) continue;
    for (const other of overlap.pulses) {
      if (other.by === me) continue;
      const entry = byPerson.get(other.by) ?? { pulse: other, files: [] };
      entry.files.push(overlap.file);
      byPerson.set(other.by, entry);
    }
  }
  return [...byPerson.entries()].slice(0, 3).map(([person, { pulse, files }]) => {
    const where = pulse.branch ? ` on ${pulse.branch}` : '';
    return `${person} is editing ${nameFiles(files, 2)}${where} (${pulse.pushed ? 'pushed' : 'local'}, ${shortSpan(now - Date.parse(pulse.at))} ago). Pull before you push.`;
  });
}

/** Top two folders of a file list, for one-line summaries. @param {string[]} files */
export function topFolders(files) {
  const counts = new Map();
  for (const file of files) {
    const parts = file.split('/');
    const folder = parts.length === 1 ? '(root)' : parts.slice(0, Math.min(2, parts.length - 1)).join('/');
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 2).map(([folder]) => folder);
}
