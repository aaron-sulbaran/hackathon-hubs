// CLI integration tests against a throwaway bare remote and clones. Run: node --test tests/hub/*-test.mjs
// Set HUB_TEST_TMP to choose where the throwaway repos go (default: the OS temp folder).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBoard } from '../../lib/hub/load.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_TMP = process.env.HUB_TEST_TMP ?? tmpdir();
const gitEnv = {
  GIT_AUTHOR_NAME: 'Hub Test',
  GIT_AUTHOR_EMAIL: 'hub-test@example.com',
  GIT_COMMITTER_NAME: 'Hub Test',
  GIT_COMMITTER_EMAIL: 'hub-test@example.com',
  GIT_TERMINAL_PROMPT: '0',
};

function sh(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...gitEnv } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** Run the hub CLI in a clone as a teammate. */
function hub(clone, me, args, extraEnv = {}) {
  const env = { ...process.env, ...gitEnv, HUB_ME: me, HUB_AGENT: 'test', HUB_DIR: '', ...extraEnv };
  delete env.HUB_DIR;
  delete env.HUB_VIA;
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(clone, 'scripts', 'hub.mjs'), ...args], { cwd: clone, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

let root;
let remote;
let cloneA;
let cloneB;

function makeClone(name) {
  const path = join(root, name);
  sh(['clone', '-q', remote, path], root);
  return path;
}

function eventFilesIn(clone) {
  const dir = join(clone, 'events');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((day) => readdirSync(join(dir, day)).map((file) => `${day}/${file}`));
}

before(() => {
  mkdirSync(BASE_TMP, { recursive: true });
  root = mkdtempSync(join(BASE_TMP, 'hub-cli-'));
  remote = join(root, 'remote.git');
  sh(['init', '-q', '--bare', '-b', 'main', remote], root);
  sh(['config', 'receive.denyNonFastForwards', 'true'], remote);
  sh(['config', 'core.logAllRefUpdates', 'true'], remote);
  const seed = join(root, 'seed');
  mkdirSync(seed);
  sh(['init', '-q', '-b', 'main'], seed);
  for (const part of ['lib/hub', 'scripts', 'hub']) cpSync(join(REPO, part), join(seed, part), { recursive: true });
  // The sample team and event, with identities filled in (the template's own team.json has none yet).
  for (const part of ['team.json', 'hub.config.json']) cpSync(join(REPO, 'tests/fixtures/demo-hub', part), join(seed, part));
  writeFileSync(join(seed, '.gitignore'), '.hub-me\n.hub-state.json\n');
  sh(['add', '-A'], seed);
  sh(['commit', '-q', '-m', 'seed'], seed);
  sh(['remote', 'add', 'origin', remote], seed);
  sh(['push', '-q', 'origin', 'main'], seed);
  cloneA = makeClone('a');
  cloneB = makeClone('b');
});

test('two clones posting concurrently: every event lands, history only fast-forwards', async () => {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    runs.push(hub(cloneA, 'ada', ['note', `ada concurrent note ${i}`]));
    runs.push(hub(cloneB, 'grace', ['note', `grace concurrent note ${i}`]));
  }
  const results = await Promise.all(runs);
  for (const result of results) assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  for (const result of results) assert.match(result.stdout, /Pushed\./);

  const fresh = makeClone('verify');
  const files = eventFilesIn(fresh);
  assert.equal(files.length, 6, files.join('\n'));
  const board = loadBoard(fresh).data;
  assert.equal(board.rejected.length, 0);
  const titles = board.activity.map((event) => event.title).sort();
  assert.deepEqual(titles, [0, 1, 2].flatMap((i) => [`ada concurrent note ${i}`, `grace concurrent note ${i}`]).sort());

  const updates = sh(['reflog', 'show', '--format=%H', 'refs/heads/main'], remote).split('\n').filter(Boolean).reverse();
  for (let i = 1; i < updates.length; i++) {
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', updates[i - 1], updates[i]], { cwd: remote });
    assert.equal(ancestor.status, 0, `ref update ${i} was not a fast-forward`);
  }
});

test('sync tells the other clone what changed, in plain words', async () => {
  await hub(cloneA, 'ada', ['sync']);
  await hub(cloneB, 'grace', ['sync']);
  const added = await hub(cloneA, 'ada', ['add', 'Feed parser', '--why', 'core of the demo']);
  assert.equal(added.code, 0, added.stderr);
  const itemId = added.stdout.split(/\s/)[0];
  assert.match(itemId, /^t-[a-z0-9]{4}$/);
  const claimed = await hub(cloneB, 'grace', ['claim', itemId, '--why', 'I know the API']);
  assert.equal(claimed.code, 0, claimed.stderr);
  const synced = await hub(cloneA, 'ada', ['sync']);
  assert.match(synced.stdout, new RegExp(`grace \\(test\\) claimed ${itemId} "Feed parser"`));
  const status = await hub(cloneA, 'ada', ['status']);
  assert.match(status.stdout, /In flight \(1\)/);
  assert.ok(status.stdout.split('\n').length < 60);
  const stolen = await hub(cloneA, 'ada', ['claim', itemId]);
  assert.equal(stolen.code, 1);
  assert.match(stolen.stderr, /already in flight with grace/);
});

test('two clones claiming one item at once: exactly one gets it, the other is told and keeps nothing', async () => {
  for (let round = 0; round < 3; round++) {
    const added = await hub(cloneA, 'ada', ['add', `Race item ${round}`, '--why', 'race']);
    assert.equal(added.code, 0, added.stderr);
    const itemId = added.stdout.split(/\s/)[0];
    await hub(cloneB, 'grace', ['sync']);
    const [ada, grace] = await Promise.all([hub(cloneA, 'ada', ['claim', itemId, '--why', 'mine']), hub(cloneB, 'grace', ['claim', itemId, '--why', 'mine'])]);
    const winners = [ada, grace].filter((result) => result.code === 0);
    assert.equal(winners.length, 1, `${ada.code} ${ada.stdout}${ada.stderr}\n${grace.code} ${grace.stdout}${grace.stderr}`);
    const [loser, loserClone] = winners[0] === ada ? [grace, cloneB] : [ada, cloneA];
    assert.equal(loser.code, 1);
    assert.match(loser.stderr, /already in flight with|while you were claiming it|their claim came first/);
    const owner = winners[0] === ada ? 'ada' : 'grace';
    const verify = makeClone(`race-verify-${round}`);
    assert.equal(loadBoard(verify).data.items.find((item) => item.id === itemId).owner, owner);
    await hub(loserClone, owner === 'ada' ? 'grace' : 'ada', ['sync']);
    assert.equal(sh(['status', '--porcelain', '--untracked-files=all'], loserClone), '');
  }
});

test('a claim that loses the race after a rebase is withdrawn before it is pushed', async () => {
  const added = await hub(cloneA, 'ada', ['add', 'Contested item', '--why', 'race']);
  const itemId = added.stdout.split(/\s/)[0];
  await hub(cloneB, 'grace', ['sync']);
  // Ada's claim lands on origin the moment Grace's claim is committed, after Grace's freshen:
  // Grace's first push is rejected, she rebases, and the guard sees Ada's claim.
  const hookPath = join(cloneB, '.git', 'hooks', 'post-commit');
  const cli = join(cloneA, 'scripts', 'hub.mjs');
  writeFileSync(hookPath, `#!/bin/sh\nrm -f "$0"\nunset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE\ncd "${cloneA}" && HUB_ME=ada "${process.execPath}" "${cli}" claim ${itemId} --why first >/dev/null 2>&1\nexit 0\n`, { mode: 0o755 });
  const headBefore = sh(['rev-parse', 'HEAD'], cloneB);
  const lost = await hub(cloneB, 'grace', ['claim', itemId, '--why', 'second']);
  assert.equal(lost.code, 1, lost.stdout + lost.stderr);
  assert.match(lost.stderr, new RegExp(`${itemId} was claimed by ada while you were claiming it, so your claim was withdrawn and nothing was pushed`));
  assert.doesNotMatch(lost.stdout, /claimed by grace/);
  assert.equal(sh(['status', '--porcelain', '--untracked-files=all'], cloneB), '');
  assert.equal(sh(['rev-parse', 'HEAD'], cloneB), sh(['rev-parse', 'origin/main'], cloneB));
  assert.notEqual(sh(['rev-parse', 'HEAD'], cloneB), headBefore);
  const item = loadBoard(makeClone('contested-verify')).data.items.find((entry) => entry.id === itemId);
  assert.equal(item.owner, 'ada');
  assert.ok(item.history.every((event) => event.by !== 'grace'));
});

test('two clones adding new kb pages at once both push: no shared index file to collide on', async () => {
  await hub(cloneA, 'ada', ['sync']);
  await hub(cloneB, 'grace', ['sync']);
  for (const clone of [cloneA, cloneB]) mkdirSync(join(clone, 'kb'), { recursive: true });
  writeFileSync(join(cloneA, 'kb', 'venue-wifi.md'), '---\ntitle: Venue Wi-Fi\nkind: reference\nsummary: how to get online at the venue\n---\nThe network name is on the badge.\n');
  writeFileSync(join(cloneB, 'kb', 'judging-rubric.md'), '---\ntitle: Judging rubric\nkind: reference\n---\nFour criteria, equal weight.\n');
  const [ada, grace] = await Promise.all([hub(cloneA, 'ada', ['learn', 'kb/venue-wifi.md', 'Wi-Fi']), hub(cloneB, 'grace', ['learn', 'kb/judging-rubric.md', 'Rubric'])]);
  assert.equal(ada.code, 0, ada.stderr);
  assert.equal(grace.code, 0, grace.stderr);
  const fresh = makeClone('kb-verify');
  const listed = await hub(fresh, 'linus', ['kb']);
  assert.match(listed.stdout, /\[\[kb\/venue-wifi\]\] Venue Wi-Fi: how to get online at the venue/);
  assert.match(listed.stdout, /\[\[kb\/judging-rubric\]\] Judging rubric: Four criteria, equal weight\./);
  const filtered = await hub(fresh, 'linus', ['kb', 'wi-fi']);
  assert.doesNotMatch(filtered.stdout, /judging-rubric/);
});

test('a clone whose hub commits conflict with origin: sync says NOT synced and fails, doctor says FIX', async () => {
  await hub(cloneA, 'ada', ['sync']);
  await hub(cloneB, 'grace', ['sync']);
  writeFileSync(join(cloneA, 'kb', 'venue-wifi.md'), '---\ntitle: Venue Wi-Fi\nkind: reference\n---\nThe network is HALL-A.\n');
  writeFileSync(join(cloneB, 'kb', 'venue-wifi.md'), '---\ntitle: Venue Wi-Fi\nkind: reference\n---\nThe network is HALL-B.\n');
  const ada = await hub(cloneA, 'ada', ['learn', 'kb/venue-wifi.md', 'A']);
  assert.equal(ada.code, 0, ada.stderr);
  const grace = await hub(cloneB, 'grace', ['learn', 'kb/venue-wifi.md', 'B']);
  assert.equal(grace.code, 2);
  assert.match(grace.stderr, /NOT pushed: your hub commits conflict with origin in kb\/venue-wifi\.md/);

  const synced = await hub(cloneB, 'grace', ['sync']);
  assert.equal(synced.code, 2, synced.stdout);
  assert.match(synced.stdout, /^Hub NOT synced \(local state at [0-9a-f]{7}\): your hub commits conflict with origin in kb\/venue-wifi\.md/);
  assert.doesNotMatch(synced.stdout, /Hub synced at/);
  const doctor = await hub(cloneB, 'grace', ['doctor']);
  assert.equal(doctor.code, 1);
  assert.match(doctor.stdout, /FIX {2}hub clone in step with origin: 1 local commit\(s\) conflict with origin in kb\/venue-wifi\.md/);

  // Left mid-rebase by hand: sync and doctor both name it.
  spawnSync('git', ['pull', '-q', '--rebase', 'origin', 'main'], { cwd: cloneB, env: { ...process.env, ...gitEnv } });
  const stuck = await hub(cloneB, 'grace', ['sync']);
  assert.equal(stuck.code, 2);
  assert.match(stuck.stdout, /in the middle of a rebase/);
  const stuckDoctor = await hub(cloneB, 'grace', ['doctor']);
  assert.match(stuckDoctor.stdout, /FIX {2}hub clone in step with origin: stuck in the middle of a rebase/);

  // The fix doctor prints works: keep both lines, continue, sync.
  writeFileSync(join(cloneB, 'kb', 'venue-wifi.md'), '---\ntitle: Venue Wi-Fi\nkind: reference\n---\nThe network is HALL-A, or HALL-B upstairs.\n');
  sh(['add', 'kb/venue-wifi.md'], cloneB);
  spawnSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: cloneB, env: { ...process.env, ...gitEnv } });
  const fixed = await hub(cloneB, 'grace', ['sync']);
  assert.equal(fixed.code, 0, fixed.stdout);
  assert.match(fixed.stdout, /^Hub synced at/);
});

test('status shows the submission deadline from hub.config.json when the playbook has none', async () => {
  const status = await hub(cloneA, 'ada', ['status']);
  assert.match(status.stdout, /Next deadlines:\n {2}Sun, 9:00\sAM EST Submissions due \(in /);
});

test('a hub folder inside another repo never commits or pushes there', async () => {
  const outer = join(root, 'outer');
  mkdirSync(outer);
  sh(['init', '-q', '-b', 'main'], outer);
  const inner = join(outer, 'template');
  for (const part of ['lib/hub', 'scripts', 'hub']) cpSync(join(REPO, part), join(inner, part), { recursive: true });
  for (const part of ['team.json', 'hub.config.json']) cpSync(join(REPO, 'tests/fixtures/demo-hub', part), join(inner, part));
  sh(['add', '-A'], outer);
  sh(['commit', '-q', '-m', 'outer'], outer);
  const head = sh(['rev-parse', 'HEAD'], outer);
  const noted = await hub(inner, 'ada', ['note', 'should not commit']);
  assert.equal(noted.code, 2);
  assert.match(noted.stderr, /is not the top of its own git repo/);
  assert.equal(sh(['rev-parse', 'HEAD'], outer), head);
});

test('human-only commands refuse without --human and write via human with it', async () => {
  const proposed = await hub(cloneA, 'ada', ['propose', 'Use Next.js', '--why', 'the team knows it']);
  assert.equal(proposed.code, 0, proposed.stderr);
  const decisionId = /\b(d-[0-9a-z]{4})\b/.exec(proposed.stdout)?.[1];
  const refused = await hub(cloneA, 'ada', ['accept', decisionId]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /That one is for a person, and it is optional\./);
  const gateRefused = await hub(cloneA, 'ada', ['gate', 'pass', 'g-zzzz']);
  assert.equal(gateRefused.code, 1);
  assert.match(gateRefused.stderr, /That one is for a person, and it is optional\./);
  const accepted = await hub(cloneA, 'ada', ['accept', decisionId, '--human']);
  assert.equal(accepted.code, 0, accepted.stderr);
  const decision = loadBoard(cloneA).data.decisions.find((d) => d.id === decisionId);
  assert.equal(decision.status, 'accepted');
  assert.equal(decision.resolved.via, 'human');
  assert.equal(decision.resolved.agent, undefined);
});

test('learn commits the kb page together with its kb.update event', async () => {
  mkdirSync(join(cloneB, 'kb'), { recursive: true });
  writeFileSync(join(cloneB, 'kb', 'feed-api.md'), '---\ntitle: Feed API\nkind: reference\n---\nRate limit is 60 per minute.\n');
  const learned = await hub(cloneB, 'grace', ['learn', 'kb/feed-api.md', 'Feed API rate limit']);
  assert.equal(learned.code, 0, learned.stderr);
  const changed = sh(['show', '--name-only', '--format=', 'HEAD'], cloneB).split('\n');
  assert.ok(changed.includes('kb/feed-api.md'));
  assert.ok(changed.some((path) => path.startsWith('events/')));
  const kb = loadBoard(cloneB).data.kb;
  assert.ok(kb.some((page) => page.page === 'kb/feed-api'));
});

test('onboarded checks off the caller\'s own onboarding item, then only notes', async () => {
  for (const owner of ['grace', 'linus']) {
    const added = await hub(cloneA, 'ada', ['add', 'Connect your coding agent to the hub', '--owner', owner, '--area', 'onboarding', '--why', 'first task']);
    assert.equal(added.code, 0, added.stderr);
  }
  await hub(cloneB, 'grace', ['sync']);
  const first = await hub(cloneB, 'grace', ['onboarded', 'devin (REMOTE)']);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /^t-[a-z0-9]{4} done: "Connect your coding agent to the hub"/);
  assert.match(first.stdout, /Pushed\./);
  const onboarding = () => loadBoard(cloneB).data.items.filter((item) => item.area === 'onboarding');
  const grace = onboarding().find((item) => item.owner === 'grace');
  assert.equal(grace.lane, 'done');
  assert.equal(grace.history.at(-1).title, 'Onboarding done: grace on devin (REMOTE)');
  assert.equal(onboarding().find((item) => item.owner === 'linus').lane, 'up_next');

  const again = await hub(cloneB, 'grace', ['onboarded']);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /was already done\. Noted: "Onboarding done: grace on test"/);
  assert.match(again.stdout, /Pushed\./);

  const none = await hub(cloneB, 'ada', ['onboarded']);
  assert.equal(none.code, 0, none.stderr);
  assert.match(none.stdout, /No onboarding item for ada/);
  assert.equal(onboarding().find((item) => item.owner === 'linus').lane, 'up_next');
});

test('without a remote, a write commits locally and says so', async () => {
  const lonely = makeClone('lonely');
  sh(['remote', 'remove', 'origin'], lonely);
  const noted = await hub(lonely, 'linus', ['note', 'offline note']);
  assert.equal(noted.code, 0, noted.stderr);
  assert.match(noted.stdout, /committed locally only/);
  assert.match(sh(['log', '-1', '--format=%s'], lonely), /^hub: linus note offline note/);
});

test('missing identity gives a clear instruction', async () => {
  const env = { ...process.env, ...gitEnv };
  delete env.HUB_ME;
  const result = spawnSync(process.execPath, [join(cloneA, 'scripts', 'hub.mjs'), 'note', 'x'], { cwd: cloneA, env: { ...env, HUB_ME: '' }, encoding: 'utf8' });
  if (!existsSync(join(cloneA, '.hub-me'))) {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /hub me <id>/);
  }
});

test('doctor passes on a fresh machine: no git identity, no .hub-me, identity from env only', async () => {
  const fresh = makeClone('fresh');
  const emptyConfig = join(root, 'empty-gitconfig');
  writeFileSync(emptyConfig, '');
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', HUB_ME: 'grace', HUB_AGENT: 'devin' };
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'HUB_VIA', 'HUB_DIR']) delete env[key];
  const run = (args) => spawnSync(process.execPath, [join(fresh, 'scripts', 'hub.mjs'), ...args], { cwd: fresh, env, encoding: 'utf8' });
  const doctor = run(['doctor']);
  assert.match(doctor.stdout, /ok {3}git identity \(hub\): was not set \(no email set\); set this clone's local config to Grace Example and the commitEmail team\.json has for grace/);
  assert.match(doctor.stdout, /ok {3}hub identity: grace \(agent devin\)/);
  assert.doesNotMatch(doctor.stdout, /FIX {2}(git identity|hub identity|remote|push permission)/);
  assert.doesNotMatch(doctor.stdout, /@/, 'doctor prints no email address');
  assert.equal(sh(['config', '--local', 'user.email'], fresh), 'grace@example.com');
  const noted = run(['note', 'env only note']);
  assert.equal(noted.status, 0, noted.stderr);
  assert.match(noted.stdout, /Pushed\./);
  assert.equal(existsSync(join(fresh, '.hub-me')), false);
  assert.equal(sh(['log', '-1', '--format=%an <%ae>'], fresh), 'Grace Example <grace@example.com>');
  const eventPath = sh(['show', '--name-only', '--format=', 'HEAD'], fresh).split('\n').find((line) => line.startsWith('events/'));
  const event = JSON.parse(readFileSync(join(fresh, eventPath), 'utf8'));
  assert.equal(event.by, 'grace');
  assert.equal(event.agent, 'devin');
});

test('doctor never prints a token that is embedded in the remote URL', async () => {
  const { redactUrl } = await import('../../scripts/hub.mjs');
  assert.equal(redactUrl('https://x-access-token:ghp_secret@github.com/o/r.git'), 'https://***@github.com/o/r.git');
  assert.equal(redactUrl('https://github.com/o/r.git'), 'https://github.com/o/r.git');
  assert.equal(redactUrl('git@github.com:o/r.git'), 'git@github.com:o/r.git');
});

test('design copies the images and commits them with the question in one commit', async () => {
  const clone = makeClone('design');
  const small = join(root, 'shot.png');
  const second = join(root, 'shot2.webp');
  writeFileSync(small, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  writeFileSync(second, Buffer.from('RIFFxxxxWEBP'));
  const before = sh(['rev-list', '--count', 'HEAD'], clone);
  const result = await hub(clone, 'grace', ['design', small, 'Home feed: v2!', '--image', second, '-m', 'Look at the header.', '--for', 'linus']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /q-[a-z0-9]{4} posted for design review \(2 images, for linus\)/);
  assert.equal(Number(sh(['rev-list', '--count', 'HEAD'], clone)), Number(before) + 1);
  const files = sh(['show', '--name-only', '--format=', 'HEAD'], clone).split('\n');
  const images = files.filter((file) => file.startsWith('design/review/'));
  assert.equal(images.length, 2);
  assert.ok(images.every((file) => /^design\/review\/\d{8}-\d{6}-home-feed-v2-\d\.(png|webp)$/.test(file)), images.join(' '));
  assert.equal(files.filter((file) => file.startsWith('events/')).length, 1);
  assert.equal(sh(['rev-parse', 'HEAD'], clone), sh(['rev-parse', 'main'], remote));
  const question = loadBoard(clone).data.questions.find((q) => q.title === 'Design review: Home feed: v2!');
  assert.ok(question);
  assert.equal(question.for, 'linus');
  assert.ok(question.text.startsWith(`![Home feed: v2! (1 of 2)](${images.find((file) => file.endsWith('.png'))})`));
  assert.ok(question.text.endsWith('Look at the header.'));
});

test('design refuses big files and other formats, and leaves nothing behind', async () => {
  const clone = makeClone('design-refuse');
  const big = join(root, 'big.png');
  writeFileSync(big, Buffer.alloc(601 * 1024));
  const tooBig = await hub(clone, 'grace', ['design', big, 'Too big']);
  assert.equal(tooBig.code, 1);
  assert.match(tooBig.stderr, /limit is 600 KB/);
  assert.match(tooBig.stderr, /sips -s format jpeg/);
  const gif = join(root, 'anim.gif');
  writeFileSync(gif, 'GIF89a');
  const wrong = await hub(clone, 'grace', ['design', gif, 'Wrong type']);
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /only webp, png, jpg, jpeg/);
  const missingTitle = await hub(clone, 'grace', ['design', join(root, 'shot.png')]);
  assert.equal(missingTitle.code, 1);
  assert.equal(sh(['status', '--porcelain', '--untracked-files=all'], clone), '');
});


test('started from a git hook in another repository, hub commits still land in the hub', async () => {
  // Git exports GIT_DIR, GIT_INDEX_FILE, and GIT_WORK_TREE to hooks. A hook in a project
  // worktree starts this CLI, and those variables must not steer its commits into the project.
  const project = join(root, 'project-with-hook');
  mkdirSync(project);
  sh(['init', '-q', '-b', 'main'], project);
  writeFileSync(join(project, 'README.md'), 'a project\n');
  sh(['add', 'README.md'], project);
  sh(['commit', '-q', '-m', 'init'], project);
  const projectHead = sh(['rev-parse', 'HEAD'], project);
  const hubHead = sh(['rev-parse', 'HEAD'], cloneA);

  const hookEnv = { GIT_DIR: join(project, '.git'), GIT_INDEX_FILE: join(project, '.git', 'index'), GIT_WORK_TREE: project, GIT_PREFIX: '' };
  const result = await hub(cloneA, 'ada', ['note', 'written while a hook environment was set'], hookEnv);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pushed\./);
  assert.equal(sh(['rev-parse', 'HEAD'], project), projectHead, 'the project repository got no commit');
  assert.equal(sh(['status', '--porcelain'], project), '', 'the project index and tree are untouched');
  assert.notEqual(sh(['rev-parse', 'HEAD'], cloneA), hubHead, 'the hub clone got the event commit');
  assert.match(sh(['log', '-1', '--format=%s'], cloneA), /note/);
});
