// Hub event schema. Zero dependencies, plain ESM. Safe to import from Node and from a Next.js bundle.
// The binding definition lives in docs/CONTRACT.md; keep this file in step with it.

/** @typedef {'agent'|'web'|'human'} Via */

/**
 * @typedef {Object} HubEvent
 * @property {1} v
 * @property {string} id
 * @property {string} at
 * @property {string} by
 * @property {Via} via
 * @property {string} [agent]
 * @property {string} type
 * @property {string} [ref]
 * @property {string} title
 * @property {string} [text]
 * @property {Record<string, any>} data
 */

export const SCHEMA_VERSION = 1;
export const TITLE_MAX = 140;
export const TEXT_MAX = 4000;
export const VIA_VALUES = ['agent', 'web', 'human'];
/** The agent name `./hub setup` stamps on the events it writes. They are bookkeeping, not a person at work. */
export const SETUP_AGENT = 'hub-setup';
export const LANES = ['needs_human', 'in_flight', 'up_next', 'done'];
/** Most files a pulse lists. */
export const PULSE_FILES_MAX = 60;

/** Types only a person (via human or web) may write. */
export const HUMAN_ONLY_TYPES = ['decision.accept', 'decision.reject', 'gate.pass', 'gate.fail'];

/** Types that create a new object: the event's ref is the new id and must carry this prefix. */
export const CREATING_TYPES = {
  'item.add': 't',
  'question.ask': 'q',
  'decision.propose': 'd',
  'gate.add': 'g',
  'session.start': 's',
};

/** Types that act on an existing object of a known kind. */
export const ACTING_TYPES = {
  'item.claim': 't',
  'item.update': 't',
  'item.block': 't',
  'item.done': 't',
  'question.answer': 'q',
  'question.settle': 'q',
  'decision.accept': 'd',
  'decision.reject': 'd',
  'gate.propose': 'g',
  'gate.pass': 'g',
  'gate.fail': 'g',
  'session.end': 's',
};

const EVENT_ID_PATTERN = /^(\d{13})-([a-z][a-z0-9_]*)-([a-z0-9]{4})$/;
const REF_PATTERN = /^[tqdgs]-[a-z0-9]{4,12}$/;
const DUE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** @param {number} length */
export function randomBase36(length = 4) {
  let out = '';
  const cryptoSource = globalThis.crypto;
  if (cryptoSource && typeof cryptoSource.getRandomValues === 'function') {
    const bytes = new Uint8Array(length);
    cryptoSource.getRandomValues(bytes);
    for (const byte of bytes) out += BASE36[byte % 36];
    return out;
  }
  for (let i = 0; i < length; i++) out += BASE36[Math.floor(Math.random() * 36)];
  return out;
}

/** @param {string} by @param {number} [epochMs] */
export function newEventId(by, epochMs = Date.now()) {
  return `${String(epochMs).padStart(13, '0')}-${by}-${randomBase36(4)}`;
}

/** @param {'t'|'q'|'d'|'g'|'s'} prefix */
export function newRefId(prefix) {
  return `${prefix}-${randomBase36(4)}`;
}

/** Path of an event file relative to the hub root, e.g. events/2026-11-12/<id>.json (UTC date folder). */
export function eventRelPath(event) {
  return `events/${String(event.at).slice(0, 10)}/${event.id}.json`;
}

/** @param {unknown} value @param {number} max */
export function clip(value, max) {
  const text = String(value ?? '').replace(/\s+$/u, '');
  if (text.length <= max) return text;
  return text.slice(0, max - 3).trimEnd() + '...';
}

/** @param {string} id */
export function refKind(id) {
  if (typeof id !== 'string') return null;
  const prefix = id.slice(0, 2);
  if (prefix === 't-') return 'item';
  if (prefix === 'q-') return 'question';
  if (prefix === 'd-') return 'decision';
  if (prefix === 'g-') return 'gate';
  if (prefix === 's-') return 'session';
  return null;
}

/** @param {any} x */
function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Validate and normalize one event. Never throws.
 * Titles and text over the limits are clipped, not rejected.
 * @param {any} obj
 * @param {{ teamIds?: string[] }} [options] when teamIds is a non-empty list, `by` must be in it
 * @returns {{ ok: true, event: HubEvent } | { ok: false, reason: string }}
 */
export function validateEvent(obj, options = {}) {
  if (!isPlainObject(obj)) return { ok: false, reason: 'event is not a JSON object' };
  if (obj.v !== SCHEMA_VERSION) return { ok: false, reason: `v must be ${SCHEMA_VERSION}` };

  if (typeof obj.id !== 'string') return { ok: false, reason: 'id missing' };
  const idMatch = EVENT_ID_PATTERN.exec(obj.id);
  if (!idMatch) return { ok: false, reason: `id "${obj.id}" is not <epochms>-<by>-<rand4>` };

  if (typeof obj.by !== 'string' || !obj.by) return { ok: false, reason: 'by missing' };
  if (idMatch[2] !== obj.by) return { ok: false, reason: `id names "${idMatch[2]}" but by is "${obj.by}"` };
  const teamIds = options.teamIds;
  if (Array.isArray(teamIds) && teamIds.length > 0 && !teamIds.includes(obj.by)) {
    return { ok: false, reason: `by "${obj.by}" is not in team.json` };
  }

  if (typeof obj.at !== 'string' || Number.isNaN(Date.parse(obj.at))) {
    return { ok: false, reason: 'at is not an ISO timestamp' };
  }
  if (!VIA_VALUES.includes(obj.via)) return { ok: false, reason: `via must be one of ${VIA_VALUES.join(', ')}` };
  if (typeof obj.type !== 'string' || !/^[a-z][a-z0-9_.-]*$/.test(obj.type)) {
    return { ok: false, reason: 'type missing or malformed' };
  }
  if (typeof obj.title !== 'string' || !obj.title.trim()) return { ok: false, reason: 'title missing' };
  if (obj.text !== undefined && obj.text !== null && typeof obj.text !== 'string') {
    return { ok: false, reason: 'text must be a string' };
  }
  if (obj.data !== undefined && obj.data !== null && !isPlainObject(obj.data)) {
    return { ok: false, reason: 'data must be an object' };
  }

  if (HUMAN_ONLY_TYPES.includes(obj.type) && obj.via === 'agent') {
    return { ok: false, reason: `${obj.type} is human only; an agent cannot write it` };
  }

  const ref = obj.ref ?? undefined;
  if (ref !== undefined && (typeof ref !== 'string' || !ref)) return { ok: false, reason: 'ref must be a string' };

  const createdPrefix = CREATING_TYPES[obj.type];
  if (createdPrefix) {
    if (!ref || !REF_PATTERN.test(ref) || ref[0] !== createdPrefix) {
      return { ok: false, reason: `${obj.type} needs a new ${createdPrefix}- ref` };
    }
  }
  const actedPrefix = ACTING_TYPES[obj.type];
  if (actedPrefix) {
    if (!ref || ref[0] !== actedPrefix || ref[1] !== '-') {
      return { ok: false, reason: `${obj.type} needs a ${actedPrefix}- ref` };
    }
  }
  if (obj.type === 'comment' && !ref) return { ok: false, reason: 'comment needs a ref' };

  const data = isPlainObject(obj.data) ? { ...obj.data } : {};

  if (obj.type === 'kb.update' && (typeof data.page !== 'string' || !data.page)) {
    return { ok: false, reason: 'kb.update needs data.page' };
  }
  if (obj.type === 'pulse') {
    if (typeof data.repo !== 'string' || !data.repo) return { ok: false, reason: 'pulse needs data.repo' };
    data.files = Array.isArray(data.files) ? data.files.filter((file) => typeof file === 'string' && file).slice(0, PULSE_FILES_MAX) : [];
    data.pushed = data.pushed === true;
    for (const key of ['ahead', 'behind']) data[key] = Number.isFinite(data[key]) && data[key] >= 0 ? Math.floor(data[key]) : 0;
    if (data.pr !== undefined && data.pr !== null && !isPlainObject(data.pr)) return { ok: false, reason: 'pulse data.pr must be { number, url }' };
  }
  if (obj.type === 'gate.add') {
    if (data.criteria === undefined) data.criteria = [];
    if (!Array.isArray(data.criteria)) return { ok: false, reason: 'gate.add data.criteria must be an array' };
  }
  // A due time without its offset would mean a different moment on every machine that reads it.
  if (['item.add', 'item.update', 'gate.add'].includes(obj.type) && data.due !== undefined && data.due !== null) {
    if (typeof data.due !== 'string' || !DUE_PATTERN.test(data.due) || Number.isNaN(Date.parse(data.due))) {
      return { ok: false, reason: `due "${data.due}" must be an ISO time with its offset, e.g. 2027-01-17T09:00-05:00` };
    }
  }
  if (obj.type === 'item.update' && data.lane !== undefined && !LANES.includes(data.lane)) {
    return { ok: false, reason: `lane must be one of ${LANES.join(', ')}` };
  }
  if (obj.type === 'item.add' && data.lane !== undefined && !LANES.includes(data.lane)) {
    return { ok: false, reason: `lane must be one of ${LANES.join(', ')}` };
  }

  /** @type {HubEvent} */
  const event = {
    ...obj,
    v: 1,
    title: clip(obj.title.trim(), TITLE_MAX),
    data,
  };
  if (typeof obj.text === 'string') event.text = clip(obj.text, TEXT_MAX);
  else delete event.text;
  if (ref === undefined) delete event.ref;
  if (obj.via !== 'agent') delete event.agent;
  return { ok: true, event };
}

/**
 * Build a new event and validate it. Never throws.
 * @param {{ by: string, via: Via, agent?: string, type: string, ref?: string, title: string, text?: string, data?: Record<string, any>, now?: Date|number }} input
 * @returns {{ data: HubEvent|null, error: string|null }}
 */
export function makeEvent(input) {
  const nowMs = input.now instanceof Date ? input.now.getTime() : typeof input.now === 'number' ? input.now : Date.now();
  const draft = {
    v: 1,
    id: newEventId(input.by, nowMs),
    at: new Date(nowMs).toISOString(),
    by: input.by,
    via: input.via,
    ...(input.via === 'agent' && input.agent ? { agent: input.agent } : {}),
    type: input.type,
    ...(input.ref ? { ref: input.ref } : {}),
    title: clip(String(input.title ?? '').trim(), TITLE_MAX),
    ...(input.text ? { text: clip(input.text, TEXT_MAX) } : {}),
    data: input.data ?? {},
  };
  const result = validateEvent(draft);
  if (!result.ok) return { data: null, error: result.reason };
  return { data: result.event, error: null };
}
