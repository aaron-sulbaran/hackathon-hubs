// Fold and schema tests. Run: node --test tests/hub/*-test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldEvents } from '../../lib/hub/fold.mjs';
import { validateEvent, makeEvent, TITLE_MAX, SETUP_AGENT } from '../../lib/hub/schema.mjs';

const team = {
  people: ['ada', 'grace', 'linus', 'hedy', 'alan'].map((id) => ({ id, name: id })),
};
const T0 = Date.parse('2026-11-12T05:00:00.000Z');
let counter = 0;

/** Build a valid event at T0 + minutes. */
function ev(minutes, by, type, ref, title, data = {}, extra = {}) {
  counter += 1;
  const rand = counter.toString(36).padStart(4, '0').slice(-4);
  const at = T0 + minutes * 60000;
  return {
    v: 1,
    id: `${at}-${by}-${rand}`,
    at: new Date(at).toISOString(),
    by,
    via: 'agent',
    agent: 'claude-code',
    type,
    ...(ref ? { ref } : {}),
    title,
    data,
    ...extra,
  };
}

const NOW = T0 + 60 * 60000;

test('item lifecycle: add, claim, update, note, comment, block, done', () => {
  const events = [
    ev(0, 'ada', 'item.add', 't-aaaa', 'Feed parser', { why: 'demo core', area: 'backend' }),
    ev(1, 'grace', 'item.claim', 't-aaaa', 'Feed parser', { why: 'I know the API' }),
    ev(2, 'grace', 'item.update', 't-aaaa', 'status', { status: 'half done', due: '2026-11-12T13:30-05:00' }),
    ev(3, 'grace', 'note', 't-aaaa', 'parser in src/feed.ts', { files: ['src/feed.ts'], branch: 'feat/feed' }),
    ev(4, 'ada', 'comment', 't-aaaa', 'nice'),
    ev(5, 'grace', 'item.block', 't-aaaa', 'Need API key', { needs: 'ada' }, { text: 'Need the API key' }),
  ];
  let board = foldEvents(events, team, { now: NOW });
  let item = board.items[0];
  assert.equal(item.lane, 'needs_human');
  assert.equal(item.needs, 'ada');
  assert.equal(item.blocker, 'Need the API key');
  assert.equal(item.owner, 'grace');
  assert.equal(item.status, 'half done');
  assert.equal(item.area, 'backend');
  assert.equal(item.why, 'I know the API');
  assert.equal(item.createdBy, 'ada');
  assert.equal(item.notes.length, 1);
  assert.equal(item.comments.length, 1);
  assert.equal(item.updatedAt, events[5].at);

  events.push(ev(6, 'grace', 'item.done', 't-aaaa', 'Merged', { links: ['https://example.com/pr/1'] }));
  board = foldEvents(events, team, { now: NOW });
  item = board.items[0];
  assert.equal(item.lane, 'done');
  assert.equal(item.needs, null);
  assert.deepEqual(item.links, ['https://example.com/pr/1']);
  assert.deepEqual(board.people.find((p) => p.id === 'grace').openItems, []);
});

test('item.add defaults to up_next and honours owner and lane', () => {
  const board = foldEvents(
    [
      ev(0, 'ada', 'item.add', 't-bbbb', 'One'),
      ev(1, 'ada', 'item.add', 't-cccc', 'Two', { owner: 'ada', lane: 'in_flight' }),
    ],
    team,
    { now: NOW },
  );
  assert.equal(board.items.find((i) => i.id === 't-bbbb').lane, 'up_next');
  assert.equal(board.items.find((i) => i.id === 't-cccc').lane, 'in_flight');
  assert.deepEqual(board.people.find((p) => p.id === 'ada').openItems, ['t-cccc']);
});

test('questions: ask, answers keep it open, settle closes it', () => {
  const events = [
    ev(0, 'grace', 'question.ask', 'q-aaaa', 'Which key?', { for: 'ada', blocking: 't-aaaa' }),
    ev(1, 'hedy', 'question.answer', 'q-aaaa', 'The team key'),
  ];
  let board = foldEvents(events, team, { now: NOW });
  let question = board.questions[0];
  assert.equal(question.status, 'open');
  assert.equal(question.for, 'ada');
  assert.equal(question.blocking, 't-aaaa');
  assert.equal(question.answers.length, 1);
  assert.deepEqual(board.people.find((p) => p.id === 'ada').openQuestions, ['q-aaaa']);

  events.push(ev(2, 'grace', 'question.settle', 'q-aaaa', 'Use the team key', { answer: 'Team key in 1Password' }));
  board = foldEvents(events, team, { now: NOW });
  question = board.questions[0];
  assert.equal(question.status, 'settled');
  assert.equal(question.answer, 'Team key in 1Password');
  assert.equal(question.settled.by, 'grace');
  assert.deepEqual(board.people.find((p) => p.id === 'ada').openQuestions, []);
});

test('decisions: propose, human accept, human reject', () => {
  const board = foldEvents(
    [
      ev(0, 'alan', 'decision.propose', 'd-aaaa', 'Use Next.js', { why: 'speed', affects: ['t-aaaa', 'kb/stack'] }),
      ev(1, 'ada', 'decision.accept', 'd-aaaa', 'yes', {}, { via: 'human', agent: undefined }),
      ev(2, 'alan', 'decision.propose', 'd-bbbb', 'Use Rust', { why: 'fun' }),
      ev(3, 'hedy', 'decision.reject', 'd-bbbb', 'no', {}, { via: 'web' }),
      ev(4, 'alan', 'decision.propose', 'd-cccc', 'Use Go', { why: 'x' }),
    ],
    team,
    { now: NOW },
  );
  const byId = Object.fromEntries(board.decisions.map((d) => [d.id, d]));
  assert.equal(byId['d-aaaa'].status, 'accepted');
  assert.deepEqual(byId['d-aaaa'].affects, ['t-aaaa', 'kb/stack']);
  assert.equal(byId['d-aaaa'].resolved.by, 'ada');
  assert.equal(byId['d-bbbb'].status, 'rejected');
  assert.equal(byId['d-cccc'].status, 'proposed');
  assert.equal(byId['d-cccc'].why, 'x');
});

test('gates: add, propose, pass, fail, history', () => {
  const board = foldEvents(
    [
      ev(0, 'ada', 'gate.add', 'g-aaaa', 'Idea locked', { due: '2026-11-12T10:15-05:00', criteria: ['pitch', 'track'] }),
      ev(1, 'grace', 'gate.propose', 'g-aaaa', 'ready', { evidence: ['kb/idea'] }),
      ev(2, 'ada', 'gate.pass', 'g-aaaa', 'ok', {}, { via: 'human' }),
      ev(3, 'ada', 'gate.add', 'g-bbbb', 'Demo', { criteria: ['runs'] }),
      ev(4, 'linus', 'gate.fail', 'g-bbbb', 'broken', {}, { via: 'web' }),
    ],
    team,
    { now: NOW },
  );
  const byId = Object.fromEntries(board.gates.map((g) => [g.id, g]));
  assert.equal(byId['g-aaaa'].status, 'passed');
  assert.deepEqual(byId['g-aaaa'].criteria, ['pitch', 'track']);
  assert.equal(byId['g-aaaa'].due, '2026-11-12T10:15-05:00');
  assert.equal(byId['g-aaaa'].history.length, 3);
  assert.equal(byId['g-bbbb'].status, 'failed');
});

test('human-only rule: agent accept, reject, pass, fail are rejected and have no effect', () => {
  const board = foldEvents(
    [
      ev(0, 'alan', 'decision.propose', 'd-aaaa', 'Use Next.js', { why: 'speed' }),
      ev(1, 'alan', 'decision.accept', 'd-aaaa', 'self-approve'),
      ev(2, 'alan', 'decision.reject', 'd-aaaa', 'self-reject'),
      ev(3, 'ada', 'gate.add', 'g-aaaa', 'Gate', { criteria: ['x'] }),
      ev(4, 'grace', 'gate.pass', 'g-aaaa', 'self-pass'),
      ev(5, 'grace', 'gate.fail', 'g-aaaa', 'self-fail'),
    ],
    team,
    { now: NOW },
  );
  assert.equal(board.decisions[0].status, 'proposed');
  assert.equal(board.gates[0].status, 'open');
  assert.equal(board.rejected.length, 4);
  for (const rejection of board.rejected) assert.match(rejection.reason, /human only/);
  const direct = validateEvent(ev(6, 'grace', 'gate.pass', 'g-aaaa', 'x'));
  assert.equal(direct.ok, false);
});

test('kb.update, sessions, idle detection, unknown types kept', () => {
  const events = [
    ev(0, 'hedy', 'session.start', 's-aaaa', 'Build parser', { focus: 'Build parser', repo: 'app', branch: 'feat/x' }),
    ev(5, 'hedy', 'kb.update', null, 'Feed API limits', { page: 'kb/feed-api', change: 'new' }),
    ev(6, 'hedy', 'future.thing', null, 'Something new', { extra: 1 }),
    ev(10, 'alan', 'session.start', 's-bbbb', 'Design', { focus: 'Design' }),
    ev(20, 'alan', 'session.end', 's-bbbb', 'done', {}, { text: 'line one\nline two' }),
  ];
  const board = foldEvents(events, team, { now: T0 + 5 * 60000 + 46 * 60000 });
  const hedySession = board.sessions.find((s) => s.id === 's-aaaa');
  assert.equal(hedySession.repo, 'app');
  assert.equal(hedySession.lastAt, events[2].at, 'any event by the author refreshes lastAt');
  assert.equal(hedySession.idle, false);
  const later = foldEvents(events, team, { now: T0 + 6 * 60000 + 46 * 60000 });
  assert.equal(later.sessions.find((s) => s.id === 's-aaaa').idle, true);
  const alanSession = board.sessions.find((s) => s.id === 's-bbbb');
  assert.equal(alanSession.endedAt, events[4].at);
  assert.equal(alanSession.summary, 'line one\nline two');
  assert.equal(board.people.find((p) => p.id === 'hedy').activeSession, 's-aaaa');
  assert.equal(board.people.find((p) => p.id === 'alan').activeSession, null);
  assert.equal(board.kb[0].page, 'kb/feed-api');
  assert.ok(board.activity.some((e) => e.type === 'future.thing' && e.data.extra === 1));
  assert.equal(board.rejected.length, 0);
});

test('activity is newest first; ordering uses at, then id', () => {
  const a = ev(0, 'ada', 'item.add', 't-aaaa', 'A');
  const b = ev(0, 'grace', 'note', 't-aaaa', 'same time');
  const c = ev(3, 'ada', 'note', null, 'later');
  const board = foldEvents([c, b, a], team, { now: NOW });
  assert.deepEqual(board.activity.map((e) => e.id), [c.id, ...[a.id, b.id].sort().reverse()]);
});

test('input order does not matter, and a claim that sorts before its add (clock skew) still applies', () => {
  const add = ev(10, 'ada', 'item.add', 't-aaaa', 'Feed parser');
  const claim = ev(9, 'grace', 'item.claim', 't-aaaa', 'Feed parser');
  const forward = foldEvents([add, claim], team, { now: NOW });
  const backward = foldEvents([claim, add], team, { now: NOW });
  assert.equal(forward.items[0].owner, 'grace');
  assert.equal(forward.items[0].lane, 'in_flight');
  assert.deepEqual(JSON.parse(JSON.stringify(forward.items)), JSON.parse(JSON.stringify(backward.items)));
});

test('two claims of one item: the first wins on every machine, in any input order', () => {
  const add = ev(0, 'ada', 'item.add', 't-race', 'Feed parser');
  const first = ev(1, 'grace', 'item.claim', 't-race', 'Feed parser');
  const second = ev(1.5, 'linus', 'item.claim', 't-race', 'Feed parser');
  for (const order of [[add, first, second], [second, first, add], [first, add, second]]) {
    const item = foldEvents(order, team, { now: NOW }).items[0];
    assert.equal(item.owner, 'grace');
    assert.equal(item.lane, 'in_flight');
    assert.equal(item.history.length, 3, 'the losing claim stays in the history');
  }
});

test('a claim takes an item someone else has in flight only with take, or from a person on the board', () => {
  const add = ev(0, 'ada', 'item.add', 't-take', 'Feed parser');
  const held = ev(1, 'grace', 'item.claim', 't-take', 'Feed parser');
  const agreed = ev(2, 'linus', 'item.claim', 't-take', 'Feed parser', { take: true });
  assert.equal(foldEvents([add, held, agreed], team, { now: NOW }).items[0].owner, 'linus');
  const fromBoard = ev(2, 'linus', 'item.claim', 't-take', 'Feed parser', {}, { via: 'web', agent: undefined });
  assert.equal(foldEvents([add, held, fromBoard], team, { now: NOW }).items[0].owner, 'linus');
  const released = ev(2, 'grace', 'item.update', 't-take', 'back to up next', { lane: 'up_next', owner: null });
  const after = ev(3, 'linus', 'item.claim', 't-take', 'Feed parser');
  assert.equal(foldEvents([add, held, released, after], team, { now: NOW }).items[0].owner, 'linus');
});

test('later events win: update after claim moves the lane back', () => {
  const board = foldEvents(
    [
      ev(0, 'ada', 'item.add', 't-aaaa', 'X'),
      ev(1, 'grace', 'item.claim', 't-aaaa', 'X'),
      ev(2, 'grace', 'item.update', 't-aaaa', 'unclaim', { lane: 'up_next', owner: null }),
    ],
    team,
    { now: NOW },
  );
  assert.equal(board.items[0].lane, 'up_next');
  assert.equal(board.items[0].owner, null);
});

test('rejected: bad files and bad events are listed, never thrown', () => {
  const good = ev(0, 'ada', 'item.add', 't-aaaa', 'Good');
  const entries = [
    { file: `events/2026-11-12/${good.id}.json`, event: good },
    { file: 'events/2026-11-12/broken.json', error: 'unreadable JSON: Unexpected token' },
    { file: 'events/2026-11-12/wrong-name.json', event: ev(1, 'ada', 'note', null, 'x') },
    ev(2, 'stranger', 'note', null, 'not on the team'),
    { ...ev(3, 'ada', 'note', null, 'x'), by: 'grace' },
    { ...ev(4, 'ada', 'note', null, 'x'), title: '' },
    { ...ev(5, 'ada', 'note', null, 'x'), via: 'robot' },
    { ...ev(6, 'ada', 'note', null, 'x'), v: 2 },
    ev(7, 'ada', 'item.add', 'x-1234', 'bad ref'),
    ev(8, 'ada', 'item.claim', null, 'no ref'),
    ev(9, 'ada', 'kb.update', null, 'no page'),
    ev(10, 'ada', 'gate.add', 'g-aaaa', 'bad criteria', { criteria: 'one' }),
    ev(11, 'ada', 'item.update', 't-aaaa', 'bad lane', { lane: 'someday' }),
    'not an object',
    null,
    good,
  ];
  let board;
  assert.doesNotThrow(() => {
    board = foldEvents(entries, team, { now: NOW });
  });
  assert.equal(board.items.length, 1);
  assert.equal(board.rejected.length, entries.length - 1);
  const reasons = board.rejected.map((r) => r.reason).join('\n');
  for (const fragment of ['unreadable JSON', 'file name', 'not in team.json', 'id names', 'title missing', 'via must', 'v must', 'needs a new t- ref', 'needs a t- ref', 'needs data.page', 'criteria must be an array', 'lane must', 'not a JSON object', 'duplicate']) {
    assert.match(reasons, new RegExp(fragment), fragment);
  }
  assert.equal(board.rejected[0].file, 'events/2026-11-12/broken.json');
});

test('titles and text over the limits are clipped, not rejected', () => {
  const long = 'x'.repeat(500);
  const result = validateEvent({ ...ev(0, 'ada', 'note', null, long), text: 'y'.repeat(5000) });
  assert.equal(result.ok, true);
  assert.equal(result.event.title.length, TITLE_MAX);
  assert.equal(result.event.text.length, 4000);
  const made = makeEvent({ by: 'ada', via: 'agent', agent: 'codex', type: 'note', title: long });
  assert.equal(made.error, null);
  assert.equal(made.data.title.length, TITLE_MAX);
  assert.match(made.data.id, /^\d{13}-ada-[a-z0-9]{4}$/);
});

test('makeEvent drops agent for non-agent via and returns errors as data', () => {
  const human = makeEvent({ by: 'ada', via: 'human', agent: 'claude-code', type: 'gate.pass', ref: 'g-aaaa', title: 'ok' });
  assert.equal(human.error, null);
  assert.equal(human.data.agent, undefined);
  const refused = makeEvent({ by: 'ada', via: 'agent', type: 'gate.pass', ref: 'g-aaaa', title: 'ok' });
  assert.equal(refused.data, null);
  assert.match(refused.error, /human only/);
});

test('events written by setup do not count as last seen', () => {
  const events = [
    ev(0, 'ada', 'item.add', 't-setu', 'Connect your coding agent to the hub', { owner: 'grace', area: 'onboarding' }, { agent: SETUP_AGENT }),
    ev(5, 'grace', 'item.add', 't-real', 'Feed parser', { why: 'demo core' }),
  ];
  const board = foldEvents(events, team, { now: NOW });
  const person = (id) => board.people.find((candidate) => candidate.id === id);
  assert.equal(person('ada').lastSeenAt, null, 'the setup owner was not seen by writing setup events');
  assert.equal(person('grace').lastSeenAt, events[1].at, 'a real event still counts');
});
