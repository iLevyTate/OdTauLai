/**
 * describeDue / relDays (js/tasks.js) — same slice loader as tasks-due-class.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadDescribeDue(fixedToday) {
  const src = readFileSync(join(root, 'js', 'tasks.js'), 'utf8');
  const s = src.indexOf('function todayISO(){');
  const e = src.indexOf('// Subtask UI', s);
  assert.ok(s >= 0 && e > s, 'slice');
  const block = src.slice(s, e);
  return new Function(
    'todayKey',
    `
    ${block}
    return { describeDue, todayISO };
  `,
  )(() => fixedToday);
}

test('describeDue: today / tomorrow / overdue / future', () => {
  const { describeDue } = loadDescribeDue('2026-01-15');
  assert.equal(describeDue('2026-01-15').cls, 'today');
  assert.equal(describeDue('2026-01-16').label, 'Tomorrow');
  assert.equal(describeDue('2026-01-16').cls, 'soon');
  assert.equal(describeDue('2026-01-14').relDays, -1);
  assert.equal(describeDue('2026-01-14').cls, 'overdue');
  const five = describeDue('2026-01-20');
  assert.equal(five.cls, 'soon');
  assert.equal(five.relDays, 5);
  const far = describeDue('2026-03-15');
  assert.equal(far.cls, 'future');
  assert.match(far.label, /Mar/);
});

test('describeDue: different year includes year in label', () => {
  const { describeDue } = loadDescribeDue('2026-01-15');
  const d = describeDue('2027-06-22');
  assert.equal(d.cls, 'future');
  assert.ok(String(d.label).includes('2027'), d.label);
});
