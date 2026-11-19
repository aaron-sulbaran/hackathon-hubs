// Shared helpers for the Claude Code hook scripts. A hook must never break the agent's turn,
// so every helper here swallows its own errors.

import { readFileSync } from 'node:fs';

export const CONTEXT_LIMIT = 9500;

/** Read the hook's JSON from stdin. Returns {} when run by hand with a terminal attached. */
export function readHookInput() {
  if (process.stdin.isTTY) return {};
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** @param {string} text */
export function clipContext(text) {
  if (text.length <= CONTEXT_LIMIT) return text;
  return `${text.slice(0, CONTEXT_LIMIT - 60)}\n... (clipped; run ./hub status for the rest)`;
}

/**
 * Print the hook JSON that adds context for Claude.
 * @param {'SessionStart'|'UserPromptSubmit'|'Stop'} hookEventName
 * @param {string} additionalContext
 */
export function emitContext(hookEventName, additionalContext) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: clipContext(additionalContext) } }) + '\n');
}

/** @param {any} input */
export function sessionKey(input) {
  return `session:${input.session_id || 'unknown'}`;
}
