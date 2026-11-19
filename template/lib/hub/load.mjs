// Node-only loaders for the hub. Kept apart from fold.mjs so a web bundle can skip node:fs.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { foldEvents } from './fold.mjs';

/**
 * Read every events/<date>/<id>.json under `dir`. Never throws.
 * Files that fail to read or parse come back as `{ file, error }` so the fold can list them as rejected.
 * @param {string} dir the events/ directory
 * @returns {{ data: Array<{ file: string, event?: any, error?: string }>, error: string|null }}
 */
export function loadEventsFromDir(dir) {
  if (!existsSync(dir)) return { data: [], error: null };
  /** @type {Array<{ file: string, event?: any, error?: string }>} */
  const entries = [];
  try {
    for (const dayFolder of readdirSync(dir).sort()) {
      const dayPath = join(dir, dayFolder);
      if (!statSync(dayPath).isDirectory()) continue;
      for (const fileName of readdirSync(dayPath).sort()) {
        if (!fileName.endsWith('.json')) continue;
        const relFile = `events/${dayFolder}/${fileName}`;
        try {
          entries.push({ file: relFile, event: JSON.parse(readFileSync(join(dayPath, fileName), 'utf8')) });
        } catch (readError) {
          entries.push({ file: relFile, error: `unreadable JSON: ${readError instanceof Error ? readError.message : readError}` });
        }
      }
    }
  } catch (dirError) {
    return { data: entries, error: `could not read ${dir}: ${dirError instanceof Error ? dirError.message : dirError}` };
  }
  return { data: entries, error: null };
}

/**
 * Read team.json at the hub root. Never throws; a missing file yields an empty team.
 * @param {string} root
 * @returns {{ data: { people: any[] }, error: string|null }}
 */
export function loadTeam(root) {
  const path = join(root, 'team.json');
  if (!existsSync(path)) return { data: { people: [] }, error: null };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return { data: { people: Array.isArray(parsed.people) ? parsed.people : [] }, error: null };
  } catch (parseError) {
    return { data: { people: [] }, error: `team.json is not valid JSON: ${parseError instanceof Error ? parseError.message : parseError}` };
  }
}

/**
 * Load team and events from a hub checkout and fold them.
 * @param {string} root hub repo root
 * @param {{ now?: number|Date }} [options]
 */
export function loadBoard(root, options = {}) {
  const team = loadTeam(root);
  const events = loadEventsFromDir(join(root, 'events'));
  const board = foldEvents(events.data, team.data, options);
  const error = [team.error, events.error].filter(Boolean).join('; ') || null;
  return { data: board, team: team.data, error };
}
