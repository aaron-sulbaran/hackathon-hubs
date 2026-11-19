// Fold hub events into board state. Zero dependencies, pure, safe for Node and the browser.
// Contract: docs/CONTRACT.md, section "fold.mjs API".

import { validateEvent, refKind, LANES, CREATING_TYPES, SETUP_AGENT } from './schema.mjs';

export { validateEvent } from './schema.mjs';

/** Minutes without an event from its author before a live session reads as idle. */
export const IDLE_AFTER_MINUTES = 45;

/** Pulses older than this do not count toward overlaps. */
export const OVERLAP_WINDOW_HOURS = 4;

/**
 * An entry may be a raw event object, or a wrapper from loadEventsFromDir:
 * `{ file, event }` for a parsed file, `{ file, error }` for one that failed to read or parse.
 * @typedef {any} EventEntry
 */

/** @param {any} team */
function normalizeTeam(team) {
  if (Array.isArray(team)) return team;
  if (team && Array.isArray(team.people)) return team.people;
  return [];
}

/** @param {any} entry */
function unwrapEntry(entry) {
  if (entry && typeof entry === 'object' && typeof entry.file === 'string' && ('event' in entry || 'error' in entry)) {
    if (entry.error) return { file: entry.file, event: null, parseError: String(entry.error) };
    return { file: entry.file, event: entry.event, parseError: null };
  }
  return { file: null, event: entry, parseError: null };
}

/** @param {string} file */
function baseName(file) {
  const last = file.split(/[\\/]/).pop() || file;
  return last.replace(/\.json$/i, '');
}

/** @param {any} a @param {any} b */
function compareEvents(a, b) {
  const timeA = Date.parse(a.at);
  const timeB = Date.parse(b.at);
  if (timeA !== timeB) return timeA - timeB;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Validate a list of entries. Returns sorted valid events (oldest first) and rejected files.
 * @param {EventEntry[]} entries
 * @param {any} [team]
 */
export function sortAndValidate(entries, team) {
  const teamIds = normalizeTeam(team).map((person) => person.id).filter(Boolean);
  /** @type {any[]} */
  const valid = [];
  /** @type {{ file: string, reason: string }[]} */
  const rejected = [];
  const seenIds = new Set();
  for (const entry of entries || []) {
    const { file, event, parseError } = unwrapEntry(entry);
    const label = file ?? (event && typeof event.id === 'string' ? event.id : '(unnamed event)');
    if (parseError) {
      rejected.push({ file: label, reason: parseError });
      continue;
    }
    const result = validateEvent(event, { teamIds });
    if (!result.ok) {
      rejected.push({ file: label, reason: result.reason });
      continue;
    }
    if (file && baseName(file) !== result.event.id) {
      rejected.push({ file: label, reason: `id "${result.event.id}" does not match the file name` });
      continue;
    }
    if (seenIds.has(result.event.id)) {
      rejected.push({ file: label, reason: `duplicate event id ${result.event.id}` });
      continue;
    }
    seenIds.add(result.event.id);
    valid.push(result.event);
  }
  valid.sort(compareEvents);
  return { events: valid, rejected };
}

/**
 * Replay events into the board.
 * @param {EventEntry[]} events raw events or loader entries, any order
 * @param {any} team team.json contents (`{ people: [...] }`) or a people array
 * @param {{ now?: number|Date }} [options] `now` decides which sessions are idle (default: current time)
 */
export function foldEvents(events, team, options = {}) {
  const nowMs = options.now instanceof Date ? options.now.getTime() : typeof options.now === 'number' ? options.now : Date.now();
  const people = normalizeTeam(team);
  const { events: ordered, rejected } = sortAndValidate(events, team);

  /** @type {Map<string, any>} */ const items = new Map();
  /** @type {Map<string, any>} */ const questions = new Map();
  /** @type {Map<string, any>} */ const decisions = new Map();
  /** @type {Map<string, any>} */ const gates = new Map();
  /** @type {Map<string, any>} */ const sessions = new Map();
  /** @type {Map<string, any>} */ const kbPages = new Map();
  /** @type {Map<string, string>} */ const lastSeenBy = new Map();
  /** Latest pulse per person per repo, keyed `${by}\u0000${repo}`. @type {Map<string, any>} */ const pulses = new Map();
  /** Events whose target did not exist yet (clock skew between machines); replayed when it appears. */
  /** @type {Map<string, any[]>} */ const waitingForRef = new Map();

  const collections = { item: items, question: questions, decision: decisions, gate: gates, session: sessions };

  /** @param {string} ref */
  function lookup(ref) {
    const kind = refKind(ref);
    return kind ? collections[kind].get(ref) : undefined;
  }

  /** @param {any} event */
  function touchSession(event) {
    for (const session of sessions.values()) {
      if (session.by === event.by && !session.endedAt && event.at > session.lastAt) session.lastAt = event.at;
    }
  }

  /** @param {any} event */
  function create(event) {
    const { type, ref, data } = event;
    const collection = collections[refKind(ref)];
    if (collection.has(ref)) return false;
    if (type === 'item.add') {
      items.set(ref, {
        id: ref,
        title: event.title,
        text: event.text ?? '',
        lane: LANES.includes(data.lane) ? data.lane : 'up_next',
        owner: data.owner ?? null,
        status: data.status ?? null,
        due: data.due ?? null,
        area: data.area ?? null,
        why: data.why ?? null,
        needs: null,
        blocker: null,
        links: [],
        createdAt: event.at,
        updatedAt: event.at,
        createdBy: event.by,
        notes: [],
        comments: [],
        history: [event],
      });
    } else if (type === 'question.ask') {
      questions.set(ref, {
        id: ref,
        title: event.title,
        text: event.text ?? '',
        for: data.for ?? 'team',
        blocking: data.blocking ?? null,
        status: 'open',
        askedBy: event.by,
        askedAt: event.at,
        answers: [],
        settled: null,
        answer: null,
        comments: [],
      });
    } else if (type === 'decision.propose') {
      decisions.set(ref, {
        id: ref,
        title: event.title,
        text: event.text ?? '',
        why: data.why ?? '',
        affects: Array.isArray(data.affects) ? data.affects : [],
        status: 'proposed',
        proposedBy: event.by,
        proposedAt: event.at,
        resolved: null,
        comments: [],
      });
    } else if (type === 'gate.add') {
      gates.set(ref, {
        id: ref,
        title: event.title,
        text: event.text ?? '',
        criteria: Array.isArray(data.criteria) ? data.criteria.map(String) : [],
        due: data.due ?? null,
        status: 'open',
        addedBy: event.by,
        addedAt: event.at,
        history: [event],
        comments: [],
      });
    } else if (type === 'session.start') {
      sessions.set(ref, {
        id: ref,
        by: event.by,
        agent: event.agent ?? null,
        focus: data.focus ?? event.title,
        repo: data.repo ?? null,
        branch: data.branch ?? null,
        startedAt: event.at,
        lastAt: event.at,
        endedAt: null,
        summary: null,
        idle: false,
      });
    }
    return true;
  }

  /** @param {any} event @param {any} target */
  function act(event, target) {
    const { type, data } = event;
    switch (type) {
      case 'item.claim':
        // First claim wins. An agent's claim on an item someone else has in flight does not take
        // it unless it says take (they agreed); a person's claim from the board does.
        if (target.lane === 'in_flight' && target.owner && target.owner !== event.by && data.take !== true && event.via === 'agent') {
          if (target.history && !target.history.includes(event)) target.history.push(event);
          return;
        }
        target.owner = event.by;
        target.lane = 'in_flight';
        if (data.why) target.why = data.why;
        break;
      case 'item.update':
        for (const key of ['title', 'owner', 'lane', 'status', 'due', 'area', 'why']) {
          if (data[key] !== undefined) target[key] = data[key];
        }
        if (target.lane !== 'needs_human') {
          target.needs = null;
          target.blocker = null;
        }
        break;
      case 'item.block':
        target.lane = 'needs_human';
        target.needs = data.needs ?? 'team';
        target.blocker = event.text || event.title;
        break;
      case 'item.done':
        target.lane = 'done';
        target.needs = null;
        target.blocker = null;
        if (Array.isArray(data.links)) target.links = [...target.links, ...data.links];
        break;
      case 'question.answer':
        target.answers.push(event);
        break;
      case 'question.settle':
        target.status = 'settled';
        target.settled = event;
        target.answer = data.answer ?? event.text ?? event.title;
        break;
      case 'decision.accept':
        target.status = 'accepted';
        target.resolved = event;
        break;
      case 'decision.reject':
        target.status = 'rejected';
        target.resolved = event;
        break;
      case 'gate.propose':
        if (target.status !== 'passed') target.status = 'proposed';
        break;
      case 'gate.pass':
        target.status = 'passed';
        break;
      case 'gate.fail':
        target.status = 'failed';
        break;
      case 'session.end':
        target.endedAt = event.at;
        target.lastAt = event.at > target.lastAt ? event.at : target.lastAt;
        target.summary = event.text ?? event.title;
        break;
      case 'note':
        if (target.notes) target.notes.push(event);
        else if (target.comments) target.comments.push(event);
        break;
      case 'comment':
        if (target.comments) target.comments.push(event);
        break;
      default:
        if (target.comments) target.comments.push(event);
    }
    if (target.history && !target.history.includes(event)) target.history.push(event);
    if ('updatedAt' in target) target.updatedAt = event.at;
  }

  /** @param {any} event */
  function apply(event) {
    // Last seen means a person did something. Events setup writes under its owner's name
    // (the onboarding tasks) are bookkeeping and say nothing about who is at work.
    if (event.agent !== SETUP_AGENT) {
      const prev = lastSeenBy.get(event.by);
      if (!prev || event.at > prev) lastSeenBy.set(event.by, event.at);
    }

    if (event.type === 'pulse') {
      const key = `${event.by}\u0000${event.data.repo}`;
      pulses.set(key, {
        id: event.id,
        by: event.by,
        agent: event.agent ?? null,
        at: event.at,
        note: event.data.note ?? null,
        repo: event.data.repo,
        branch: event.data.branch ?? null,
        pushed: event.data.pushed === true,
        ahead: event.data.ahead ?? 0,
        behind: event.data.behind ?? 0,
        files: event.data.files ?? [],
        pr: event.data.pr ?? null,
        item: event.data.item ?? null,
      });
      touchSession(event);
      return;
    }

    if (CREATING_TYPES[event.type]) {
      if (create(event)) {
        const waiting = waitingForRef.get(event.ref);
        if (waiting) {
          waitingForRef.delete(event.ref);
          for (const pending of waiting) apply(pending);
        }
      }
      touchSession(event);
      return;
    }

    if (event.type === 'kb.update') {
      const page = event.data.page;
      const existing = kbPages.get(page) ?? { page, firstAt: event.at, lastAt: event.at, lastBy: event.by, changes: [] };
      existing.lastAt = event.at;
      existing.lastBy = event.by;
      existing.changes.push(event);
      kbPages.set(page, existing);
    }

    if (event.ref && refKind(event.ref)) {
      const target = lookup(event.ref);
      if (target) act(event, target);
      else {
        const list = waitingForRef.get(event.ref) ?? [];
        list.push(event);
        waitingForRef.set(event.ref, list);
      }
    }
    touchSession(event);
  }

  for (const event of ordered) apply(event);

  for (const session of sessions.values()) {
    session.idle = !session.endedAt && nowMs - Date.parse(session.lastAt) > IDLE_AFTER_MINUTES * 60 * 1000;
  }

  const itemList = [...items.values()];
  const questionList = [...questions.values()];
  const sessionList = [...sessions.values()];

  const pulseList = [...pulses.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
  const overlapCutoff = nowMs - OVERLAP_WINDOW_HOURS * 3600 * 1000;
  /** @type {Map<string, any>} */
  const overlapMap = new Map();
  for (const pulse of pulseList) {
    if (Date.parse(pulse.at) < overlapCutoff) continue;
    for (const file of pulse.files) {
      const key = `${pulse.repo}\u0000${file}`;
      const entry = overlapMap.get(key) ?? { repo: pulse.repo, file, people: [], pulses: [] };
      if (!entry.people.includes(pulse.by)) {
        entry.people.push(pulse.by);
        entry.pulses.push({ by: pulse.by, branch: pulse.branch, pushed: pulse.pushed, at: pulse.at, pr: pulse.pr });
      }
      overlapMap.set(key, entry);
    }
  }
  const overlaps = [...overlapMap.values()].filter((entry) => entry.people.length > 1).sort((a, b) => (a.repo + a.file < b.repo + b.file ? -1 : 1));

  const peopleOut = people.map((person) => {
    const live = sessionList
      .filter((session) => session.by === person.id && !session.endedAt)
      .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    return {
      ...person,
      openItems: itemList.filter((item) => item.owner === person.id && item.lane !== 'done').map((item) => item.id),
      openQuestions: questionList.filter((q) => q.status === 'open' && q.for === person.id).map((q) => q.id),
      activeSession: live[0]?.id ?? null,
      lastSeenAt: lastSeenBy.get(person.id) ?? null,
      pulses: pulseList.filter((pulse) => pulse.by === person.id),
    };
  });

  return {
    items: itemList,
    questions: questionList,
    decisions: [...decisions.values()],
    gates: [...gates.values()],
    sessions: sessionList,
    people: peopleOut,
    kb: [...kbPages.values()],
    activity: ordered.filter((event) => event.type !== 'pulse').reverse(),
    pulses: pulseList,
    overlaps,
    rejected,
  };
}
