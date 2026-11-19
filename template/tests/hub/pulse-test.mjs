// Pulse: fold, advice text, and the CLI against throwaway repos with a fake origin.
// Run: node --test tests/hub/*-test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldEvents } from '../../lib/hub/fold.mjs';
import { loadBoard } from '../../lib/hub/load.mjs';
import { pullAdvice, prAdvice, laneOfFile, laneForBranch } from '../../scripts/team-git.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_TMP = process.env.HUB_TEST_TMP ?? tmpdir();
const T0 = Date.parse('2026-11-12T05:00:00.000Z');
const team = { people: ['ada', 'grace', 'linus'].map((id) => ({ id, name: id })) };
let counter = 0;

function pulseEvent(minutes, by, data) {
  counter += 1;
  const at = T0 + minutes * 60000;
  return { v: 1, id: `${at}-${by}-${counter.toString(36).padStart(4, '0')}`, at: new Date(at).toISOString(), by, via: 'agent', agent: 'test', type: 'pulse', title: 'pulse', data };
}

test('fold keeps the latest pulse per person per repo, finds overlaps, and leaves pulses out of activity', () => {
  const events = [
    pulseEvent(0, 'grace', { repo: 'proj', branch: 'grace/old', files: ['a.ts'] }),
    pulseEvent(10, 'grace', { repo: 'proj', branch: 'grace/search-filters', pushed: true, files: ['app/page.tsx', 'b.ts'] }),
    pulseEvent(12, 'grace', { repo: 'other', branch: 'x', files: ['app/page.tsx'] }),
    pulseEvent(20, 'ada', { repo: 'proj', branch: 'ada/home', files: ['app/page.tsx', 'c.ts'] }),
    pulseEvent(-300, 'linus', { repo: 'proj', branch: 'linus/old', files: ['app/page.tsx'] }),
  ];
  const board = foldEvents(events, team, { now: T0 + 30 * 60000 });
  assert.equal(board.activity.length, 0);
  assert.equal(board.pulses.length, 4);
  const grace = board.people.find((person) => person.id === 'grace');
  assert.equal(grace.pulses.length, 2);
  assert.equal(grace.pulses.find((pulse) => pulse.repo === 'proj').branch, 'grace/search-filters');
  assert.equal(grace.lastSeenAt, new Date(T0 + 12 * 60000).toISOString());
  assert.deepEqual(board.overlaps.map((overlap) => [overlap.repo, overlap.file, overlap.people.sort()]), [['proj', 'app/page.tsx', ['ada', 'grace']]]);
});

test('a pulse without a repo is rejected; files are capped at 60', () => {
  const bad = foldEvents([pulseEvent(0, 'linus', { files: [] })], team, { now: T0 });
  assert.equal(bad.rejected.length, 1);
  const many = foldEvents([pulseEvent(0, 'linus', { repo: 'p', files: Array.from({ length: 80 }, (_, i) => `f${i}`) })], team, { now: T0 });
  assert.equal(many.pulses[0].files.length, 60);
});

test('advice text for every case', () => {
  assert.equal(pullAdvice({ behind: 0, files: ['a'], mainChanged: [] }), null);
  assert.equal(pullAdvice({ behind: 2, files: ['a', 'b', 'c'], mainChanged: ['a', 'b', 'z'] }), 'Rebase now: main changed 2 of your files (a, b).');
  assert.equal(pullAdvice({ behind: 4, files: ['a'], mainChanged: ['z'] }), 'main moved 4 commits, none touch your files. Rebase before you open or update a PR.');
  const base = { branch: 'grace/search-filters', pushed: true, remoteBranch: true, behind: 0, files: ['app/search/page.tsx'], pr: null };
  assert.equal(prAdvice({ ...base, pushed: false, remoteBranch: false }), 'Local only: push the branch so teammates can see it.');
  assert.equal(prAdvice(base), 'Pushed, no PR: open one when checks are green.');
  const pr = { number: 3, url: '', state: 'open' };
  assert.equal(prAdvice({ ...base, pr, behind: 2 }), 'PR #3 open and behind main: rebase and push.');
  assert.equal(prAdvice({ ...base, pr }), 'PR #3: merge it when your checks pass.');
  assert.equal(prAdvice({ ...base, pr, files: ['app/search/page.tsx', 'package.json'] }), 'PR #3 touches shared files (package.json): merge it, and say so in your pulse so others pull.');
  assert.equal(prAdvice({ ...base, pr, files: ['lib/search/rank.ts'] }), 'PR #3: merge it when your checks pass.');
  assert.equal(prAdvice({ ...base, branch: 'main' }), null);
  // LANE_TABLE.lanes is empty until this event's product repo names its lanes.
  assert.equal(laneOfFile('components/ui/button.tsx'), 'shared');
  assert.equal(laneOfFile('lib/search/feed.ts'), null);
  assert.equal(laneOfFile('lib/search/query.ts'), null);
  assert.equal(laneForBranch('linus/search-extract'), null);
});

// ---------- CLI against temp repos ----------

const gitEnv = { GIT_AUTHOR_NAME: 'Hub Test', GIT_AUTHOR_EMAIL: 'hub-test@example.com', GIT_COMMITTER_NAME: 'Hub Test', GIT_COMMITTER_EMAIL: 'hub-test@example.com', GIT_TERMINAL_PROMPT: '0' };
let root;
let hubClone;
let projectRemote;

function sh(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...gitEnv } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}
function hub(cwd, me, args) {
  const env = { ...process.env, ...gitEnv, HUB_ME: me, HUB_AGENT: 'test' };
  delete env.HUB_DIR;
  delete env.HUB_VIA;
  const result = spawnSync(process.execPath, [join(hubClone, 'scripts', 'hub.mjs'), ...args], { cwd, env, encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}
function edit(clone, file, text) {
  mkdirSync(dirname(join(clone, file)), { recursive: true });
  writeFileSync(join(clone, file), text);
}
function pulseCount() {
  return loadBoard(hubClone).data.pulses.length;
}

before(() => {
  mkdirSync(BASE_TMP, { recursive: true });
  root = mkdtempSync(join(BASE_TMP, 'hub-pulse-'));
  const hubRemote = join(root, 'hub.git');
  sh(['init', '-q', '--bare', '-b', 'main', hubRemote], root);
  const seed = join(root, 'hub-seed');
  mkdirSync(seed);
  sh(['init', '-q', '-b', 'main'], seed);
  for (const part of ['lib/hub', 'scripts', 'hub']) cpSync(join(REPO, part), join(seed, part), { recursive: true });
  // The sample team and event, with identities filled in (the template's own team.json has none yet).
  for (const part of ['team.json', 'hub.config.json']) cpSync(join(REPO, 'tests/fixtures/demo-hub', part), join(seed, part));
  writeFileSync(join(seed, '.gitignore'), '.hub-me\n.hub-state.json\n');
  sh(['add', '-A'], seed);
  sh(['commit', '-q', '-m', 'seed'], seed);
  sh(['remote', 'add', 'origin', hubRemote], seed);
  sh(['push', '-q', 'origin', 'main'], seed);
  hubClone = join(root, 'hub');
  sh(['clone', '-q', hubRemote, hubClone], root);

  projectRemote = join(root, 'proj.git');
  sh(['init', '-q', '--bare', '-b', 'main', projectRemote], root);
  const projectSeed = join(root, 'proj-seed');
  mkdirSync(projectSeed);
  sh(['init', '-q', '-b', 'main'], projectSeed);
  edit(projectSeed, 'app/(main)/page.tsx', 'v1\n');
  edit(projectSeed, 'app/search/page.tsx', 'v1\n');
  edit(projectSeed, 'package.json', '{}\n');
  sh(['add', '-A'], projectSeed);
  sh(['commit', '-q', '-m', 'seed'], projectSeed);
  sh(['remote', 'add', 'origin', projectRemote], projectSeed);
  sh(['push', '-q', 'origin', 'main'], projectSeed);
});

test('pulse writes state, warns about overlaps, throttles, and gives pull and PR advice', () => {
  const grace = join(root, 'grace-proj');
  const ada = join(root, 'ada-proj');
  sh(['clone', '-q', projectRemote, grace], root);
  sh(['clone', '-q', projectRemote, ada], root);

  sh(['checkout', '-q', '-b', 'grace/search-filters'], grace);
  edit(grace, 'app/(main)/page.tsx', 'grace\n');
  sh(['commit', '-qam', 'grace edit'], grace);
  sh(['push', '-q', '-u', 'origin', 'grace/search-filters'], grace);
  const first = hub(grace, 'grace', ['pulse', 'Filters on the search page']);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stdout, 'Pulse sent (grace/search-filters, 1 file, pushed).\nPushed, no PR: open one when checks are green.');

  sh(['checkout', '-q', '-b', 'ada/home-feed'], ada);
  edit(ada, 'app/(main)/page.tsx', 'ada\n');
  const second = hub(ada, 'ada', ['pulse']);
  assert.equal(second.code, 0, second.stderr);
  const lines = second.stdout.split('\n');
  assert.equal(lines[0], 'Pulse sent (ada/home-feed, 1 file, local).');
  assert.match(lines[1], /^grace is editing app\/\(main\)\/page\.tsx on grace\/search-filters \(pushed, 0m ago\)\. Pull before you push\.$/);
  assert.equal(lines[2], 'Local only: push the branch so teammates can see it.');
  assert.equal(pulseCount(), 2);

  const repeat = hub(ada, 'ada', ['pulse']);
  assert.match(repeat.stdout, /^Pulse unchanged since 0m ago; not re-sent\./);
  assert.equal(pulseCount(), 2);

  // main moves and touches ada's file
  const mover = join(root, 'mover');
  sh(['clone', '-q', projectRemote, mover], root);
  edit(mover, 'app/(main)/page.tsx', 'main\n');
  sh(['commit', '-qam', 'main edit'], mover);
  edit(mover, 'package.json', '{"a":1}\n');
  sh(['commit', '-qam', 'main edit 2'], mover);
  sh(['push', '-q', 'origin', 'main'], mover);
  sh(['fetch', '-q', 'origin'], ada);
  const behind = hub(ada, 'ada', ['pulse', '--quiet']);
  assert.match(behind.stdout, /^grace is editing/);
  assert.match(behind.stdout, /\nRebase now: main changed 1 of your files \(app\/\(main\)\/page\.tsx\)\./);

  const who = hub(ada, 'ada', ['who']);
  assert.match(who.stdout, /^ada    test  no item  ada\/home-feed \(local\)  no PR  1 file in app\/\(main\)  0m ago$/m);
  assert.match(who.stdout, /^grace  test  no item  grace\/search-filters \(pushed\)  no PR  1 file in app\/\(main\)  0m ago\n {7}"Filters on the search page"$/m);
  assert.match(who.stdout, /^linus  no pulse yet/m);
  assert.match(who.stdout, /Overlaps:\n  app\/\(main\)\/page\.tsx: (ada|grace) \(.+\), (ada|grace) \(.+\)$/);

  const feed = hub(hubClone, 'ada', ['feed']);
  assert.equal(feed.stdout, 'No activity yet.');

  const sync = hub(ada, 'ada', ['sync']);
  assert.match(sync.stdout, /grace is editing app\/\(main\)\/page\.tsx/);
  assert.match(sync.stdout, /Rebase now: main changed 1 of your files/);
  assert.doesNotMatch(sync.stdout, /\((test)\)|Most recent on the hub/);
});

test('pulse refuses to run in the hub itself; --auto stays silent and exits 0', () => {
  const inHub = hub(hubClone, 'grace', ['pulse']);
  assert.equal(inHub.code, 1);
  assert.match(inHub.stderr, /inside the project clone/);
  assert.match(inHub.stderr, /hub" pulse "<what and why>"/, 'names the command to run from the clone');
  assert.match(inHub.stderr, /pulse --repo <path to the clone>/);
  const auto = hub(hubClone, 'grace', ['pulse', '--auto', '--quiet']);
  assert.equal(auto.code, 0);
  assert.equal(auto.stdout, '');
});
