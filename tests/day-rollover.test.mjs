/**
 * buildYesterdaySnapshot — pure helper extracted from the day-rollover path
 * in js/app.js. Validates that the snapshot shape matches what archiveDay
 * expects, and that it normalizes missing/non-numeric fields safely.
 *
 * Slices just the helper out of storage.js (mirrors the pattern in
 * tests/destructive-confirm.test.mjs) so we don't trigger the file's
 * top-level setInterval / DOM listeners that would keep the process alive.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadBuildYesterdaySnapshot() {
  const src = readFileSync(join(root, 'js', 'storage.js'), 'utf8');
  // Pull in the two tiny coercion helpers and the function under test.
  const intM = src.match(/const\s+_int\s*=\s*[^\n]+/);
  const arrM = src.match(/const\s+_arr\s*=\s*[^\n]+/);
  assert.ok(intM && arrM, 'slice _int/_arr helpers');
  const start = src.indexOf('function buildYesterdaySnapshot(');
  const end = src.indexOf('function archiveDay(', start);
  assert.ok(start >= 0 && end > start, 'slice buildYesterdaySnapshot');
  const slice = `${intM[0]};\n${arrM[0]};\n${src.slice(start, end)}\nreturn buildYesterdaySnapshot;`;
  return new Function(slice)();
}

test('buildYesterdaySnapshot copies date and numeric counters', () => {
  const f = loadBuildYesterdaySnapshot();
  assert.equal(typeof f, 'function');
  const out = f('2026-04-27', {
    totalPomos: 6,
    totalBreaks: 5,
    totalFocusSec: 1500,
    goals: [{ text: 'g1', done: true }],
    tasks: [{ id: 1, name: 't' }],
    timeLog: [{ time: '12:00', name: 't' }],
    sessionHistory: [{ type: 'work', durSec: 1500 }],
  });
  assert.equal(out.date, '2026-04-27');
  assert.equal(out.totalPomos, 6);
  assert.equal(out.totalBreaks, 5);
  assert.equal(out.totalFocusSec, 1500);
  assert.equal(out.goals.length, 1);
  assert.equal(out.tasks.length, 1);
  assert.equal(out.timeLog.length, 1);
  assert.equal(out.sessionHistory.length, 1);
});

test('buildYesterdaySnapshot coerces non-numeric counters to 0', () => {
  const f = loadBuildYesterdaySnapshot();
  const out = f('2026-04-27', {
    totalPomos: 'oops',
    totalBreaks: undefined,
    totalFocusSec: null,
  });
  assert.equal(out.totalPomos, 0);
  assert.equal(out.totalBreaks, 0);
  assert.equal(out.totalFocusSec, 0);
});

test('buildYesterdaySnapshot coerces non-array collections to []', () => {
  const f = loadBuildYesterdaySnapshot();
  const out = f('2026-04-27', {
    goals: null,
    tasks: undefined,
    timeLog: 'not an array',
    sessionHistory: { 0: 'fake' },
  });
  assert.deepEqual(out.goals, []);
  assert.deepEqual(out.tasks, []);
  assert.deepEqual(out.timeLog, []);
  assert.deepEqual(out.sessionHistory, []);
});

test('buildYesterdaySnapshot tolerates an empty/missing state', () => {
  const f = loadBuildYesterdaySnapshot();
  const a = f('2026-04-27', undefined);
  assert.equal(a.date, '2026-04-27');
  assert.equal(a.totalPomos, 0);
  assert.deepEqual(a.tasks, []);
  const b = f(null, {});
  assert.equal(b.date, null);
});

// Static contract guards on _handleDayRollover. A previous version reset
// pomosInCycle on rollover and let tick() finish on today, splitting the
// in-flight session and bumping users out of mid-cycle. The fix calls
// pauseTimer before archiving and removes the pomosInCycle=0 reset.
test('_handleDayRollover preserves pomosInCycle across midnight', () => {
  const src = readFileSync(join(root, 'js', 'app.js'), 'utf8');
  const start = src.indexOf('function _handleDayRollover');
  assert.ok(start > 0, '_handleDayRollover not found');
  const body = src.slice(start, start + 2200);
  assert.ok(!/pomosInCycle\s*=\s*0/.test(body), 'rollover must not reset pomosInCycle');
  assert.match(body, /pauseTimer\(\)/, 'rollover must call pauseTimer when running');
  assert.match(body, /totalPomos\s*=\s*0/, 'rollover must reset totalPomos');
  assert.match(body, /totalBreaks\s*=\s*0/, 'rollover must reset totalBreaks');
});
