#!/usr/bin/env node
// UserPromptSubmit hook: at most every 3 minutes per session, pull the hub and mention anything new.
// Only in a real hub (see hubCheck in hub.mjs); HUB_HOOKS=off turns it off.

import { readHookInput, emitContext, sessionKey } from './hook-io.mjs';

const MIN_INTERVAL_MS = 3 * 60 * 1000;
const input = readHookInput();
try {
  const { hubCheck, runSync, loadState, updateState } = await import('../hub.mjs');
  if (!hubCheck().ok) process.exit(0);
  const now = Date.now();
  const sessionId = input.session_id || 'unknown';
  const last = loadState().hookSessions?.[sessionId]?.lastPromptSyncAt;
  if (!last || now - Date.parse(last) >= MIN_INTERVAL_MS) {
    updateState((state) => {
      state.hookSessions = state.hookSessions ?? {};
      const entry = state.hookSessions[sessionId] ?? { startedAt: new Date(now).toISOString(), reminded: false };
      entry.lastPromptSyncAt = new Date(now).toISOString();
      state.hookSessions[sessionId] = entry;
    });
    const text = runSync({ quiet: true, key: sessionKey(input), now });
    if (text) emitContext('UserPromptSubmit', `[hub] ${text}`);
  }
} catch {
  // stay silent; a failed background sync must not block the prompt
}
process.exit(0);
