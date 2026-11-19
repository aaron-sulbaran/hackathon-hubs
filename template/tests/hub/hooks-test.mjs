// Git hooks for any agent: install, never overwrite a foreign hook, pre-push refuses bad identities.
// Everything runs against a temp copy of the hub with a temp remote, never the real hub.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_TMP = process.env.HUB_TEST_TMP ?? tmpdir();
let root;
let hubClone;
let project;
let env;
// A runner with no git identity (CI) cannot commit; every commit here names one.
const WIP_IDENT = { GIT_AUTHOR_NAME: 'Wip', GIT_AUTHOR_EMAIL: 'wip@example.com', GIT_COMMITTER_NAME: 'Wip', GIT_COMMITTER_EMAIL: 'wip@example.com' };

function sh(args, cwd, extraEnv = {}) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...env, ...extraEnv } });
}
function ok(args, cwd, extraEnv) {
  const result = sh(args, cwd, extraEnv);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

before(() => {
  mkdirSync(BASE_TMP, { recursive: true });
  root = mkdtempSync(join(BASE_TMP, 'hub-hooks-'));
  writeFileSync(join(root, 'empty-gitconfig'), '');
  env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: join(root, 'empty-gitconfig'), GIT_CONFIG_NOSYSTEM: '1', HUB_ME: 'grace', HUB_AGENT: 'test' };
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'HUB_DIR', 'HUB_VIA']) delete env[key];
  const ident = { GIT_AUTHOR_NAME: 'Seed', GIT_AUTHOR_EMAIL: 'seed@example.com', GIT_COMMITTER_NAME: 'Seed', GIT_COMMITTER_EMAIL: 'seed@example.com' };
  const hubRemote = join(root, 'hub.git');
  ok(['init', '-q', '--bare', '-b', 'main', hubRemote], root);
  const seed = join(root, 'hub-seed');
  mkdirSync(seed);
  ok(['init', '-q', '-b', 'main'], seed);
  for (const part of ['lib/hub', 'scripts', 'hub']) cpSync(join(REPO, part), join(seed, part), { recursive: true });
  // The sample team and event, with identities filled in (the template's own team.json has none yet).
  for (const part of ['team.json', 'hub.config.json']) cpSync(join(REPO, 'tests/fixtures/demo-hub', part), join(seed, part));
  writeFileSync(join(seed, '.gitignore'), '.hub-me\n.hub-state.json\n');
  ok(['add', '-A'], seed);
  ok(['commit', '-q', '-m', 'seed'], seed, ident);
  ok(['remote', 'add', 'origin', hubRemote], seed);
  ok(['push', '-q', 'origin', 'main'], seed);
  hubClone = join(root, 'hub');
  ok(['clone', '-q', hubRemote, hubClone], root);

  const projectRemote = join(root, 'proj.git');
  ok(['init', '-q', '--bare', '-b', 'main', projectRemote], root);
  const projectSeed = join(root, 'proj-seed');
  mkdirSync(projectSeed);
  ok(['init', '-q', '-b', 'main'], projectSeed);
  writeFileSync(join(projectSeed, 'a.txt'), 'a\n');
  ok(['add', '-A'], projectSeed);
  ok(['commit', '-q', '-m', 'seed'], projectSeed, ident);
  ok(['remote', 'add', 'origin', projectRemote], projectSeed);
  ok(['push', '-q', 'origin', 'main'], projectSeed);
  project = join(root, 'proj');
  ok(['clone', '-q', projectRemote, project], root);
});

test('installer writes marked git hooks, keeps a foreign hook, and is idempotent', () => {
  const hooksDir = join(project, '.git', 'hooks');
  writeFileSync(join(hooksDir, 'post-checkout'), '#!/bin/sh\necho mine\n');
  const install = () => spawnSync(process.execPath, [join(hubClone, 'scripts', 'install-hooks.mjs'), project], { encoding: 'utf8', env });
  const first = install();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Skipped git hook post-checkout: .+ exists and is not the hub's/);
  assert.match(first.stdout, /Git hooks installed in .+: post-commit, pre-push/);
  assert.equal(readFileSync(join(hooksDir, 'post-checkout'), 'utf8'), '#!/bin/sh\necho mine\n');
  const preCommit = readFileSync(join(hooksDir, 'post-commit'), 'utf8');
  assert.match(preCommit, /# hub-managed hook \(hackathon hub\)/);
  assert.match(preCommit, /pulse --auto --quiet/);
  assert.ok(statSync(join(hooksDir, 'pre-push')).mode & 0o100);
  const second = install();
  assert.match(second.stdout, /post-commit, pre-push/);
  assert.ok(existsSync(join(project, '.claude', 'settings.local.json')));
});

test('a commit returns at once, and pre-push refuses a bot identity with the exact fix, then lets the fixed commit through', () => {
  ok(['checkout', '-q', '-b', 'grace/search-box'], project);
  writeFileSync(join(project, 'b.txt'), 'b\n');
  ok(['add', 'b.txt'], project);
  // The commit never waits on the hub: every tool call in post-commit is backgrounded in a
  // subshell with its output discarded. Checked on the script itself, not on a clock.
  const postCommit = readFileSync(join(project, '.git', 'hooks', 'post-commit'), 'utf8');
  const toolCalls = postCommit.split('\n').filter((line) => line.includes('node "$HUB_CLI"'));
  assert.ok(toolCalls.length > 0);
  for (const line of toolCalls) assert.match(line, /^\( node "\$HUB_CLI" [^)]*<\/dev\/null >\/dev\/null 2>&1 & \) >\/dev\/null 2>&1$/, line);
  ok(['-c', 'user.name=Devin AI', '-c', 'user.email=158243242+devin-ai-integration[bot]@users.noreply.github.com', 'commit', '-q', '-m', 'bot commit'], project);
  const refused = sh(['push', '-q', '-u', 'origin', 'grace/search-box'], project);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /hub: push refused\. 1 outgoing commit\(s\) would not credit anyone's GitHub account:\n  [0-9a-f]{7} Devin AI <158243242\+devin-ai-integration\[bot\]@users\.noreply\.github\.com> \(a bot identity\)/);
  assert.match(refused.stderr, /git config user\.email "grace@example\.com"/);
  assert.match(refused.stderr, /git rebase origin\/main --exec 'git commit --amend --no-edit --reset-author'/);
  // the check already set this clone's local identity
  assert.equal(ok(['config', '--local', 'user.email'], project), 'grace@example.com');
  ok(['rebase', '-q', 'origin/main', '--exec', 'git commit --amend --no-edit --reset-author'], project);
  assert.equal(ok(['log', '-1', '--format=%an <%ae>'], project), 'Grace Example <grace@example.com>');
  const pushed = sh(['push', '-q', '-u', 'origin', 'grace/search-box'], project);
  assert.equal(pushed.status, 0, pushed.stderr);
});

test('pre-push checks only commits origin lacks: merging a teammate\'s main into a pushed branch goes through, a local commit as a teammate does not', () => {
  // Ada's commit lands on origin/main from her own clone.
  const adaClone = join(root, 'proj-ada');
  ok(['clone', '-q', join(root, 'proj.git'), adaClone], root);
  writeFileSync(join(adaClone, 'c.txt'), 'c\n');
  ok(['add', 'c.txt'], adaClone);
  const ada = { GIT_AUTHOR_NAME: 'Ada Example', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada Example', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  ok(['commit', '-q', '-m', 'ada on main'], adaClone, ada);
  ok(['push', '-q', 'origin', 'main'], adaClone);

  // Grace's branch already exists on origin; she adds work and merges main in.
  ok(['checkout', '-q', 'grace/search-box'], project);
  ok(['fetch', '-q', 'origin'], project);
  writeFileSync(join(project, 'd.txt'), 'd\n');
  ok(['add', 'd.txt'], project);
  ok(['commit', '-q', '-m', 'grace work'], project);
  ok(['merge', '-q', '--no-edit', 'origin/main'], project);
  const merged = sh(['push', '-q', 'origin', 'grace/search-box'], project);
  assert.equal(merged.status, 0, merged.stderr);

  // A commit authored as Ada that only Grace's clone has is still refused.
  writeFileSync(join(project, 'e.txt'), 'e\n');
  ok(['add', 'e.txt'], project);
  ok(['commit', '-q', '-m', 'as ada'], project, ada);
  const refused = sh(['push', '-q', 'origin', 'grace/search-box'], project);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /hub: push refused\. 1 outgoing commit\(s\)[^\n]*\n  [0-9a-f]{7} Ada Example <[^>]+> \(ada's address\)/);
});

/** Run one Claude Code hook script from a hub folder, the way Claude Code does. */
function runHook(hubDir, script, extraEnv = {}) {
  const hookEnv = { ...env, CLAUDE_PROJECT_DIR: hubDir, ...extraEnv };
  return spawnSync(process.execPath, [join(hubDir, 'scripts', 'hooks', script)], { cwd: hubDir, encoding: 'utf8', env: hookEnv, input: JSON.stringify({ session_id: 'test-session', cwd: hubDir }) });
}

/** Seed a bare remote with a hub (hub.repo set to `repo`) inside `subdir` of the repo, and clone it. */
function seedHub(name, { subdir = '', repo = '' } = {}) {
  const ident = { GIT_AUTHOR_NAME: 'Seed', GIT_AUTHOR_EMAIL: 'seed@example.com', GIT_COMMITTER_NAME: 'Seed', GIT_COMMITTER_EMAIL: 'seed@example.com' };
  const remote = join(root, `${name}.git`);
  ok(['init', '-q', '--bare', '-b', 'main', remote], root);
  const seed = join(root, `${name}-seed`);
  const hubDir = join(seed, subdir);
  mkdirSync(hubDir, { recursive: true });
  ok(['init', '-q', '-b', 'main'], seed);
  for (const part of ['lib/hub', 'scripts', 'hub', '.claude']) cpSync(join(REPO, part), join(hubDir, part), { recursive: true });
  cpSync(join(REPO, 'tests/fixtures/demo-hub/team.json'), join(hubDir, 'team.json'));
  const config = JSON.parse(readFileSync(join(REPO, 'tests/fixtures/demo-hub/hub.config.json'), 'utf8'));
  config.hub.repo = repo;
  writeFileSync(join(hubDir, 'hub.config.json'), JSON.stringify(config, null, 2) + '\n');
  writeFileSync(join(seed, '.gitignore'), '.hub-me\n.hub-state.json\n');
  ok(['add', '-A'], seed);
  ok(['commit', '-q', '-m', 'seed'], seed, ident);
  ok(['remote', 'add', 'origin', remote], seed);
  ok(['push', '-q', 'origin', 'main'], seed);
  const clone = join(root, name);
  ok(['clone', '-q', remote, clone], root);
  return { remote, clone, hubDir: join(clone, subdir) };
}

function originBranches(remote) {
  return ok(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], remote).split('\n').filter(Boolean).sort();
}

test('in a template checkout inside another repo, the hooks run no git at all and push nothing', () => {
  const { remote, clone, hubDir } = seedHub('outer', { subdir: 'template', repo: '' });
  ok(['checkout', '-q', '-b', 'my-wip'], clone);
  writeFileSync(join(clone, 'wip.txt'), 'work in progress\n');
  ok(['add', 'wip.txt'], clone);
  ok(['commit', '-q', '-m', 'wip'], clone, WIP_IDENT);
  for (const script of ['session-start.mjs', 'prompt-sync.mjs', 'stop-check.mjs']) {
    const result = runHook(hubDir, script);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '', `${script} said something`);
  }
  assert.deepEqual(originBranches(remote), ['main']);
  assert.equal(existsSync(join(hubDir, '.hub-state.json')), false, 'no state written either');
});

test('in a real hub the hooks sync and push the hub\'s own waiting commit, never a local branch', () => {
  const name = 'realhub';
  const { remote, clone } = seedHub(name, { repo: `${basename(root)}/${name}` });
  // A waiting hub commit on main, as if an earlier push had failed.
  const cli = join(clone, 'scripts', 'hub.mjs');
  const offline = spawnSync(process.execPath, [cli, 'note', 'written offline', '--no-commit'], { cwd: clone, encoding: 'utf8', env });
  assert.equal(offline.status, 0, offline.stderr);
  ok(['add', 'events'], clone);
  ok(['commit', '-q', '-m', 'hub: waiting note'], clone, { GIT_AUTHOR_NAME: 'Grace Example', GIT_AUTHOR_EMAIL: 'grace@example.com', GIT_COMMITTER_NAME: 'Grace Example', GIT_COMMITTER_EMAIL: 'grace@example.com' });
  const started = runHook(clone, 'session-start.mjs');
  assert.equal(started.status, 0, started.stderr);
  assert.match(started.stdout, /This team coordinates through a shared hub/);
  assert.match(started.stdout, /Pushed 1 hub commit\(s\) that were waiting/);
  assert.equal(ok(['rev-parse', 'main'], remote), ok(['rev-parse', 'HEAD'], clone));

  ok(['checkout', '-q', '-b', 'my-wip'], clone);
  writeFileSync(join(clone, 'wip.txt'), 'work in progress\n');
  ok(['add', 'wip.txt'], clone);
  ok(['commit', '-q', '-m', 'wip'], clone, WIP_IDENT);
  const again = runHook(clone, 'session-start.mjs');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /branch my-wip, which origin does not have; nothing was pushed/);
  assert.deepEqual(originBranches(remote), ['main']);

  const off = runHook(clone, 'session-start.mjs', { HUB_HOOKS: 'off' });
  assert.equal(off.stdout, '');
  ok(['checkout', '-q', 'main'], clone);
});
