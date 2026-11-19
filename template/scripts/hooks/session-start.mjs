#!/usr/bin/env node
// SessionStart hook: sync the hub, then hand the agent its slice of the board as context.
// It acts only in a real hub (hub.repo set, the folder is its own repo, origin is hub.repo), so
// opening a session in a template checkout or a fork runs no git at all. It never pushes a branch
// origin does not have. HUB_HOOKS=off turns it off.

import { join } from 'node:path';
import { readHookInput, emitContext, sessionKey } from './hook-io.mjs';

const input = readHookInput();
try {
  const { HUB_ROOT, hubCheck, runSync, renderStatus, updateState, identity } = await import('../hub.mjs');
  if (!hubCheck().ok) process.exit(0);
  const now = Date.now();
  const sessionId = input.session_id || 'unknown';
  updateState((state) => {
    state.hookSessions = state.hookSessions ?? {};
    const existing = state.hookSessions[sessionId];
    if (!existing) state.hookSessions[sessionId] = { startedAt: new Date(now).toISOString(), reminded: false };
    for (const [id, value] of Object.entries(state.hookSessions)) {
      if (now - Date.parse(value.startedAt) > 3 * 24 * 3600 * 1000) delete state.hookSessions[id];
    }
  });
  const hubCli = join(HUB_ROOT, 'hub');
  const syncText = runSync({ key: sessionKey(input), now });
  const statusText = renderStatus({ mine: Boolean(identity().me), now });
  const intro = [
    `[hub] This team coordinates through a shared hub at ${HUB_ROOT}. Follow the working loop in its AGENTS.md:`,
    'claim before you build, post notes as you go, ask instead of guessing, done with links.',
    `Hub CLI: "${hubCli}" (help: "${hubCli}" help).`,
  ].join(' ');
  emitContext('SessionStart', `${intro}\n\n${syncText}\n\n${statusText}`);
} catch (error) {
  emitContext('SessionStart', `[hub] Hub sync failed at session start (${error instanceof Error ? error.message : error}). Run ./hub doctor in the hub folder.`);
}
process.exit(0);
