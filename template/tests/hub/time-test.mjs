// A --due value becomes one fixed moment: always stored with an offset, read in the event's zone
// when it has none (daylight saving included), and refused when it cannot be read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDue, offsetAt } from '../../scripts/hub.mjs';
import { validateEvent } from '../../lib/hub/schema.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a time without an offset gets the zone offset for that date', () => {
  assert.equal(normalizeDue('2027-01-17T09:00', 'America/New_York'), '2027-01-17T09:00-05:00');
  assert.equal(normalizeDue('2027-07-17T09:00', 'America/New_York'), '2027-07-17T09:00-04:00');
  assert.equal(normalizeDue('2027-01-17T09:00:30', 'Europe/Berlin'), '2027-01-17T09:00:30+01:00');
  assert.equal(normalizeDue('2027-01-17T09:00', 'Asia/Kolkata'), '2027-01-17T09:00+05:30');
  assert.equal(normalizeDue('2027-01-17T09:00', 'UTC'), '2027-01-17T09:00+00:00');
});

test('the common forms are read as wall time in the event zone, never as UTC or the machine zone', () => {
  assert.equal(normalizeDue('2027-01-17 13:30', 'Europe/Berlin'), '2027-01-17T13:30+01:00');
  assert.equal(normalizeDue('2027-01-17T13:30:00.000', 'Europe/Berlin'), '2027-01-17T13:30:00.000+01:00');
  assert.equal(normalizeDue('2027-01-17 1:30 pm', 'America/New_York'), '2027-01-17T13:30-05:00');
  assert.equal(normalizeDue('2027-1-7 9:05am', 'America/New_York'), '2027-01-07T09:05-05:00');
  assert.equal(normalizeDue('2027-01-17', 'America/Los_Angeles'), '2027-01-17T23:59-08:00', 'a bare date means the end of that day');
});

test('a time with an offset is kept as that moment, and garbage is refused', () => {
  assert.equal(normalizeDue('2027-01-17T09:00-08:00', 'America/New_York'), '2027-01-17T09:00-08:00');
  assert.equal(normalizeDue('2027-01-17 09:00Z', 'America/New_York'), '2027-01-17T09:00Z');
  assert.equal(normalizeDue('2027-01-17T09:00+0530', 'America/New_York'), '2027-01-17T09:00+05:30');
  for (const bad of ['tomorrow', 'Jan 17 2027', '17/01/2027', '2027-02-30 09:00', '2027-01-17 25:00', '2027-01-17 13:00 pm', '1737100000000']) {
    assert.throws(() => normalizeDue(bad, 'America/New_York'), /is not a|does not fit/, bad);
  }
});

test('the stored value means the same moment whatever zone the reading machine is in', () => {
  const stored = normalizeDue('2027-01-17 13:30', 'Europe/Berlin');
  for (const TZ of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const read = spawnSync(process.execPath, ['-e', `process.stdout.write(new Date(${JSON.stringify(stored)}).toISOString())`], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(read.stdout, '2027-01-17T12:30:00.000Z', TZ);
  }
});

test('the schema refuses a due time without an offset', () => {
  const base = { v: 1, id: '1794947902509-ada-vj8s', at: '2026-11-17T12:00:00.000Z', by: 'ada', via: 'agent', type: 'item.add', ref: 't-ab12', title: 'x' };
  assert.equal(validateEvent({ ...base, data: { due: '2027-01-17T09:00-05:00' } }).ok, true);
  assert.equal(validateEvent({ ...base, data: { due: '2027-01-17 09:00' } }).ok, false);
  assert.equal(validateEvent({ ...base, type: 'gate.add', ref: 'g-ab12', data: { due: '2027-01-17' } }).ok, false);
});

test('HUB_TZ only changes how times are shown; a bad value is ignored with a warning', () => {
  const hubUrl = JSON.stringify(new URL('../../scripts/hub.mjs', import.meta.url).href);
  /** @param {string} zone @param {string} code */
  const run = (zone, code) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, HUB_TZ: zone, HUB_DIR: join(REPO, 'tests/fixtures/demo-hub') }, encoding: 'utf8', cwd: REPO });
  const due = run('Asia/Tokyo', `const { normalizeDue, formatWhen } = await import(${hubUrl}); console.log(normalizeDue('2027-01-17 09:00')); console.log(formatWhen('2027-01-17T09:00-05:00'));`);
  assert.equal(due.status, 0, due.stderr);
  const [stored, shown] = due.stdout.trim().split('\n');
  assert.equal(stored, '2027-01-17T09:00-05:00', 'read in the event zone (America/New_York), not HUB_TZ');
  assert.match(shown, /11:00\sPM GMT\+9/);
  const typo = run('Europe/Berln', `const { formatWhen } = await import(${hubUrl}); console.log(formatWhen('2027-01-17T09:00-05:00'));`);
  assert.equal(typo.status, 0, typo.stderr);
  assert.match(typo.stderr, /HUB_TZ="Europe\/Berln" is not a time zone/);
  assert.match(typo.stdout, /9:00\sAM EST/);
});

test('offsetAt names the offset in force at a moment', () => {
  assert.equal(offsetAt(Date.parse('2027-03-14T12:00:00Z'), 'America/New_York'), '-04:00');
  assert.equal(offsetAt(Date.parse('2027-03-14T06:00:00Z'), 'America/New_York'), '-05:00');
});
