#!/usr/bin/env node
// Stop hook: once per session, if this session changed files but posted nothing to the hub
// (or left hub commits unpushed), remind the agent. Never loops: it checks stop_hook_active
// and remembers that it already reminded.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHookInput, emitContext } from './hook-io.mjs';

const WORK_TOOL_PATTERN = /"name"\s*:\s*"(Edit|Write|MultiEdit|NotebookEdit)"/;

/** @param {any} input */
function sessionDidWork(input) {
  if (!input.transcript_path) return true;
  try {
    return WORK_TOOL_PATTERN.test(readFileSync(input.transcript_path, 'utf8'));
  } catch {
    return true;
  }
}

const input = readHookInput();
// Only in a real hub (see hubCheck in hub.mjs); HUB_HOOKS=off turns it off.
try {
  const { hubCheck } = await import('../hub.mjs');
  if (!hubCheck().ok) process.exit(0);
} catch {
  process.exit(0);
}
try {
  // Same background pulse the git hooks send: detached, output discarded, never waited on.
  const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'hub.mjs');
  spawn(process.execPath, [cli, 'pulse', '--auto', '--quiet'], { cwd: input.cwd || process.cwd(), detached: true, stdio: 'ignore' }).unref();
} catch {
  // a pulse is a convenience
}
try {
  if (input.stop_hook_active) process.exit(0);
  const { loadState, updateState, pendingHubWork, identity, HUB_ROOT } = await import('../hub.mjs');
  const { loadBoard } = await import('../../lib/hub/load.mjs');
  const sessionId = input.session_id || 'unknown';
  const sessionState = loadState().hookSessions?.[sessionId];
  if (sessionState?.reminded) process.exit(0);

  const hubCli = `"${join(HUB_ROOT, 'hub')}"`;
  const problems = [];
  const pending = pendingHubWork();
  if (pending.unpushed > 0) problems.push(`the hub has ${pending.unpushed} commit(s) on this machine that are not pushed (run: ${hubCli} sync)`);
  if (pending.dirtyEvents > 0) problems.push(`${pending.dirtyEvents} hub event file(s) were never committed (run: ${hubCli} doctor)`);

  const { me } = identity();
  if (sessionState?.startedAt && sessionDidWork(input)) {
    const board = loadBoard(HUB_ROOT).data;
    const postedSinceStart = board.activity.some((event) => event.by === me && event.at >= sessionState.startedAt);
    if (!me) problems.push(`your hub identity is not set (ask your person which teammate they are, then run: ${hubCli} me <id>)`);
    else if (!postedSinceStart) problems.push('this session changed files but posted nothing to the hub');
  }

  if (problems.length) {
    updateState((state) => {
      state.hookSessions = state.hookSessions ?? {};
      state.hookSessions[sessionId] = { ...(state.hookSessions[sessionId] ?? { startedAt: new Date().toISOString() }), reminded: true };
    });
    emitContext(
      'Stop',
      `[hub] Before you stop: ${problems.join('; ')}. Post what you did so teammates' agents know: ${hubCli} note "<what changed, files, branch>" or ${hubCli} done <t-id> --link <url>. If nothing here is worth posting, say so in one line and stop. This reminder shows once per session.`,
    );
  }
} catch {
  // never block a stop on a hook failure
}
process.exit(0);
