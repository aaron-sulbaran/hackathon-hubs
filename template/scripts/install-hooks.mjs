#!/usr/bin/env node
// Install the hub's Claude Code hooks into a PROJECT's settings (never the user-global ~/.claude).
//
//   node scripts/install-hooks.mjs                  the hub itself: .claude/settings.json, portable
//                                                   commands via $CLAUDE_PROJECT_DIR (safe to commit)
//   node scripts/install-hooks.mjs <project-repo>   your hackathon project repo: .claude/settings.local.json
//                                                   with this machine's hub path (kept out of git)
//   add --uninstall to remove the hub hooks again
//
// For a project repo it also installs git hooks, for ANY agent, in that clone's hooks folder
// (shared by its worktrees): post-commit and post-checkout send a background pulse; pre-push
// refuses only commits with a bot, placeholder, or teammate identity, then sends a pulse.
// A hook file that is not ours is never overwritten.
//
// Re-running is safe: it replaces its own entries and keeps every other setting and hook.

import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HUB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_SCRIPTS = ['session-start.mjs', 'prompt-sync.mjs', 'stop-check.mjs'];
export const GIT_HOOK_MARKER = '# hub-managed hook (hackathon hub)';
const GIT_HOOKS = ['post-commit', 'post-checkout', 'pre-push'];

/** @param {string} hookName @param {string} hubRoot */
export function gitHookScript(hookName, hubRoot) {
  const cli = join(hubRoot, 'scripts', 'hub.mjs').replace(/"/g, '\\"');
  const pulse = `( node "$HUB_CLI" pulse --auto --quiet </dev/null >/dev/null 2>&1 & ) >/dev/null 2>&1`;
  const body =
    hookName === 'pre-push'
      ? ['node "$HUB_CLI" pre-push "$@" || exit 1', pulse]
      : [pulse];
  return [
    '#!/bin/sh',
    GIT_HOOK_MARKER,
    `# ${hookName}: ${hookName === 'pre-push' ? 'refuse commits that would not credit their author, then pulse' : 'tell the hub what this clone is working on'}. Reinstall with`,
    `# node <hub>/scripts/install-hooks.mjs <this clone>; delete this file to remove it.`,
    `HUB_CLI="${cli}"`,
    'command -v node >/dev/null 2>&1 || exit 0',
    '[ -f "$HUB_CLI" ] || exit 0',
    ...body,
    'exit 0',
    '',
  ].join('\n');
}

/**
 * Install (or remove) the hub git hooks in a clone. Never touches a hook that is not ours.
 * @param {string} target @param {string} hubRoot @param {boolean} uninstall
 * @returns {{ hooksDir: string|null, installed: string[], skipped: string[], removed: string[] }}
 */
export function installGitHooks(target, hubRoot, uninstall) {
  const result = { hooksDir: null, installed: [], skipped: [], removed: [] };
  const hooksPath = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: target, encoding: 'utf8' });
  if (hooksPath.status !== 0) return result;
  const hooksDir = resolve(target, hooksPath.stdout.trim());
  result.hooksDir = hooksDir;
  mkdirSync(hooksDir, { recursive: true });
  for (const name of GIT_HOOKS) {
    const path = join(hooksDir, name);
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const ours = existing !== null && existing.includes(GIT_HOOK_MARKER);
    if (existing !== null && !ours) {
      result.skipped.push(name);
      continue;
    }
    if (uninstall) {
      if (ours) {
        rmSync(path, { force: true });
        result.removed.push(name);
      }
      continue;
    }
    writeFileSync(path, gitHookScript(name, hubRoot));
    chmodSync(path, 0o755);
    result.installed.push(name);
  }
  return result;
}

/** @param {string} path */
function realpathOrSelf(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** @param {string[]} argv */
export function installHooks(argv) {
  const uninstall = argv.includes('--uninstall');
  const targetArg = argv.find((arg) => !arg.startsWith('--'));
  const target = realpathOrSelf(targetArg ? resolve(targetArg) : HUB_ROOT);
  const hubRoot = realpathOrSelf(HUB_ROOT);

  if (!existsSync(target)) return { data: null, error: `${target} does not exist.` };
  if (target === realpathOrSelf(homedir()) || target === '/') {
    return { data: null, error: 'Refusing to write hooks into your home folder; that would be your user-global Claude settings. Pass a project repo path.' };
  }

  const isHub = target === hubRoot;
  const settingsPath = join(target, '.claude', isHub ? 'settings.json' : 'settings.local.json');
  /** @param {string} script */
  const commandFor = (script) => (isHub ? `node "$CLAUDE_PROJECT_DIR/scripts/hooks/${script}"` : `node "${join(hubRoot, 'scripts', 'hooks', script)}"`);

  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch (parseError) {
      return { data: null, error: `${settingsPath} is not valid JSON (${parseError instanceof Error ? parseError.message : parseError}). Fix it by hand, then rerun.` };
    }
  }

  /** @param {any[]} groups */
  const withoutOurs = (groups) =>
    (Array.isArray(groups) ? groups : []).filter(
      (group) => !(group.hooks ?? []).some((hook) => HOOK_SCRIPTS.some((script) => String(hook.command ?? '').includes(`scripts/hooks/${script}`))),
    );

  const hooks = settings.hooks ?? {};
  for (const eventName of ['SessionStart', 'UserPromptSubmit', 'Stop']) hooks[eventName] = withoutOurs(hooks[eventName]);
  if (!uninstall) {
    hooks.SessionStart.push({ matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: commandFor('session-start.mjs'), timeout: 45 }] });
    hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: commandFor('prompt-sync.mjs'), timeout: 25 }] });
    hooks.Stop.push({ hooks: [{ type: 'command', command: commandFor('stop-check.mjs'), timeout: 20 }] });
  }
  for (const eventName of Object.keys(hooks)) if (Array.isArray(hooks[eventName]) && hooks[eventName].length === 0) delete hooks[eventName];
  settings.hooks = hooks;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  mkdirSync(dirname(settingsPath), { recursive: true });
  const temp = `${settingsPath}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n');
  renameSync(temp, settingsPath);

  if (!isHub) {
    const gitDir = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: target, encoding: 'utf8' });
    if (gitDir.status === 0) {
      const excludePath = resolve(target, gitDir.stdout.trim(), 'info', 'exclude');
      const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
      if (!current.includes('.claude/settings.local.json')) {
        mkdirSync(dirname(excludePath), { recursive: true });
        appendFileSync(excludePath, `${current.endsWith('\n') || !current ? '' : '\n'}.claude/settings.local.json\n`);
      }
    }
  }
  const gitHooks = isHub ? null : installGitHooks(target, hubRoot, uninstall);
  return { data: { settingsPath, isHub, uninstall, gitHooks }, error: null };
}

const invokedDirectly = process.argv[1] && realpathOrSelf(process.argv[1]) === realpathOrSelf(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const { data, error } = installHooks(process.argv.slice(2));
  if (error || !data) {
    console.error(error);
    process.exit(1);
  }
  const gitHooks = data.gitHooks;
  if (gitHooks && gitHooks.hooksDir) {
    for (const name of gitHooks.skipped) console.log(`Skipped git hook ${name}: ${join(gitHooks.hooksDir, name)} exists and is not the hub's. Add a line calling the hub to it by hand if you want it.`);
    if (gitHooks.installed.length) console.log(`Git hooks installed in ${gitHooks.hooksDir}: ${gitHooks.installed.join(', ')} (for every agent; pulses run in the background, pre-push checks commit identity).`);
    if (gitHooks.removed.length) console.log(`Removed git hooks: ${gitHooks.removed.join(', ')}.`);
  }
  if (data.uninstall) console.log(`Removed the hub hooks from ${data.settingsPath}.`);
  else {
    console.log(`Hub hooks installed in ${data.settingsPath}.`);
    console.log(data.isHub ? 'They use $CLAUDE_PROJECT_DIR, so this file works on every machine.' : `They point at this hub: ${HUB_ROOT}. The file stays out of git (added to .git/info/exclude).`);
    console.log('Restart any open Claude Code session in that folder (hooks load at session start).');
  }
}
