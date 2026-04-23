/**
 * Habit hide rule: keep in sync with habitVisibilityOk in js/tasks.js
 */
import test from 'node:test';
import assert from 'node:assert';

function habitVisibilityOk(smartView, hideHabitsInMainViews, t) {
  if (smartView === 'habits') return true;
  if (hideHabitsInMainViews === false) return true;
  const mainHide = ['all', 'today', 'week', 'unscheduled', 'starred', 'impact'];
  if (mainHide.includes(smartView) && t.recur) return false;
  return true;
}

const recur = { recur: 'daily' };
const non = {};

test('habit: hidden from main when hide on', () => {
  assert.equal(habitVisibilityOk('all', true, recur), false);
  assert.equal(habitVisibilityOk('today', true, recur), false);
  assert.equal(habitVisibilityOk('impact', true, recur), false);
});

test('habit: shown when hide off', () => {
  assert.equal(habitVisibilityOk('all', false, recur), true);
});

test('habit: overdue/archive/completed not in mainHide (habit rule does not apply)', () => {
  assert.equal(habitVisibilityOk('overdue', true, recur), true);
  assert.equal(habitVisibilityOk('archived', true, recur), true);
  assert.equal(habitVisibilityOk('completed', true, recur), true);
});
test('habit: week is in mainHide — recurring hidden', () => {
  assert.equal(habitVisibilityOk('week', true, recur), false);
});

test('habits view: any task passes to filter layer (recur checked elsewhere)', () => {
  assert.equal(habitVisibilityOk('habits', true, non), true);
  assert.equal(habitVisibilityOk('habits', true, recur), true);
});

test('non-recurring always visible in main with hide on', () => {
  assert.equal(habitVisibilityOk('all', true, non), true);
});
