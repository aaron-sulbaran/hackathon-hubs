// Identity check and credit grouping against throwaway repos. Run: node --test tests/hub/*-test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkIdentity, creditReport, identityProblem, renderCredit } from '../../scripts/team-git.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_TMP = process.env.HUB_TEST_TMP ?? tmpdir();
const people = JSON.parse(readFileSync(join(REPO, 'tests/fixtures/demo-hub/team.json'), 'utf8')).people;
const cleanEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };
for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete cleanEnv[key];

let root;
function sh(args, cwd, env = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...cleanEnv, GIT_CONFIG_GLOBAL: join(root, 'empty-gitconfig'), ...env } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}
function commitAs(cwd, name, email, file) {
  writeFileSync(join(cwd, file), `${file} ${Math.random()}\n`);
  sh(['add', file], cwd);
  sh(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', file], cwd);
}

before(() => {
  mkdirSync(BASE_TMP, { recursive: true });
  root = mkdtempSync(join(BASE_TMP, 'hub-credit-'));
  writeFileSync(join(root, 'empty-gitconfig'), '');
});

test('identityProblem flags bots, placeholders, Claude, and a teammate address, not personal ones', () => {
  assert.equal(identityProblem('', 'grace', people), 'no email set');
  assert.equal(identityProblem('grace@hub.invalid', 'grace', people), 'a placeholder @hub.invalid address');
  assert.equal(identityProblem('158243242+devin-ai-integration[bot]@users.noreply.github.com', 'grace', people), 'a bot identity');
  assert.equal(identityProblem('noreply@anthropic.com', 'grace', people), 'the Claude address');
  assert.equal(identityProblem('ada@example.com', 'grace', people), "ada's address");
  assert.equal(identityProblem('grace@example.edu', 'grace', people), null);
  assert.equal(identityProblem('someone@example.com', 'grace', people), null);
});

test('checkIdentity fixes a bot identity in the LOCAL config only, and leaves a personal email alone', () => {
  const clone = join(root, 'ident');
  mkdirSync(clone);
  sh(['init', '-q', '-b', 'main'], clone);
  sh(['config', '--local', 'user.name', 'Devin AI'], clone);
  sh(['config', '--local', 'user.email', '158243242+devin-ai-integration[bot]@users.noreply.github.com'], clone);
  const env = { GIT_CONFIG_GLOBAL: join(root, 'empty-gitconfig') };
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const fixed = checkIdentity(clone, 'grace', people);
    assert.equal(fixed.ok, true);
    assert.equal(fixed.fixed, true);
    assert.match(fixed.line, /^was Devin AI, with an email set \(a bot identity\); set this clone's local config to Grace Example and the commitEmail team\.json has for grace$/);
    assert.equal(sh(['config', '--local', 'user.email'], clone), 'grace@example.com');
    assert.equal(readFileSync(join(root, 'empty-gitconfig'), 'utf8'), '');
    sh(['config', '--local', 'user.email', 'grace.home@example.org'], clone);
    const personal = checkIdentity(clone, 'grace', people);
    assert.equal(personal.fixed, false);
    assert.equal(sh(['config', '--local', 'user.email'], clone), 'grace.home@example.org');
  } finally {
    process.env = saved;
  }
});

test('checkIdentity names the real cause when it cannot fix: no person known, or no commitEmail in team.json', async () => {
  const { identityFix } = await import('../../scripts/hub.mjs');
  const clone = join(root, 'ident-cause');
  mkdirSync(clone);
  sh(['init', '-q', '-b', 'main'], clone);
  const saved = { ...process.env };
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: join(root, 'empty-gitconfig') });
  try {
    const withoutEmail = people.map((person) => (person.id === 'grace' ? { ...person, commitEmail: '' } : person));
    const known = checkIdentity(clone, 'grace', withoutEmail);
    assert.equal(known.ok, false);
    assert.equal(known.cause, 'no-commit-email');
    assert.match(known.line, /team\.json has no commitEmail for grace/);
    const fix = identityFix(known, withoutEmail.find((person) => person.id === 'grace'));
    assert.match(fix, /fill in commitEmail for grace in team\.json/);
    assert.match(fix, /git config user\.email/);
    assert.doesNotMatch(fix, /hub me/);
    const unknown = checkIdentity(clone, null, people);
    assert.equal(unknown.cause, 'no-person');
    assert.match(identityFix(unknown, null), /me <id>/);
  } finally {
    process.env = saved;
  }
});

test('credit groups authors by person and lists unknown and bot identities with branch and shas', () => {
  const remote = join(root, 'project.git');
  sh(['init', '-q', '--bare', '-b', 'main', remote], root);
  const seed = join(root, 'project');
  mkdirSync(seed);
  sh(['init', '-q', '-b', 'main'], seed);
  commitAs(seed, 'Ada Example', 'ada@example.com', 'a.txt');
  commitAs(seed, 'grace', 'grace@example.edu', 'b.txt');
  sh(['remote', 'add', 'origin', remote], seed);
  sh(['push', '-q', 'origin', 'main'], seed);
  sh(['checkout', '-q', '-b', 'grace/search-rank'], seed);
  commitAs(seed, 'Grace Example', 'grace@example.com', 'c.txt');
  commitAs(seed, 'Devin AI', '158243242+devin-ai-integration[bot]@users.noreply.github.com', 'd.txt');
  sh(['push', '-q', 'origin', 'grace/search-rank'], seed);
  const clone = join(root, 'project-clone');
  sh(['clone', '-q', remote, clone], root);
  const report = creditReport(clone, people);
  assert.equal(report.total, 4);
  assert.deepEqual(report.credited.map((entry) => entry.person.id).sort(), ['ada', 'grace']);
  assert.equal(report.unknown.length, 1);
  assert.match(report.unknown[0].identity, /^Devin AI </);
  assert.deepEqual([...report.unknown[0].branches.keys()], ['grace/search-rank']);
  const text = renderCredit(report, 'project');
  assert.match(text, /UNKNOWN, will not be credited:\n  Devin AI <158243242\+devin-ai-integration\[bot\]@users\.noreply\.github\.com> \(a bot identity\) on grace\/search-rank: [0-9a-f]{7}/);
});
