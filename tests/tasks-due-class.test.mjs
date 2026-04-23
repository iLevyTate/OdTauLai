/**
 * getDueClass uses local calendar-day math (js/tasks.js).
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadGetDueClass(fixedToday) {
  const src = readFileSync(join(root, 'js', 'tasks.js'), 'utf8');
  const s = src.indexOf('function todayISO(){');
  const e = src.indexOf('// Subtask UI', s);
  assert.ok(s >= 0 && e > s, 'slice todayISO..fmtDue');
  const block = src.slice(s, e);
  return new Function(
    'todayKey',
    `
    ${block}
    return { getDueClass, todayISO, describeDue, fmtDue };
  `,
  )(() => fixedToday);
}

test('getDueClass: buckets from fixed today (local T00:00:00)', () => {
  const { getDueClass } = loadGetDueClass('2026-04-20');
  assert.equal(getDueClass('2026-04-19'), 'overdue');
  assert.equal(getDueClass('2026-04-20'), 'today');
  assert.equal(getDueClass('2026-04-23'), 'soon');
  assert.equal(getDueClass('2026-04-30'), 'future');
});

test('getDueClass: empty / null', () => {
  const { getDueClass } = loadGetDueClass('2026-01-01');
  assert.equal(getDueClass(''), null);
  assert.equal(getDueClass(null), null);
});
