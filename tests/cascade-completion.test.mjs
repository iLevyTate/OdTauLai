/**
 * Parent/subtask completion-cascade rules. Loads the helper block from
 * js/tasks.js into a fresh Function scope with minimal stubs so the
 * real production code is exercised (not a paraphrase). Verifies:
 *   - Marking a parent done auto-completes its open, non-recurring kids.
 *   - Marking the last open subtask done auto-completes the parent
 *     and bubbles upward.
 *   - cfg.cascadeCompletion === false disables both rules.
 *   - Recurring tasks are skipped (they own their own completion cycle).
 *   - The returned snapshot list restores prior state via _restoreCascade.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const full = readFileSync(join(root, 'js', 'tasks.js'), 'utf8');

// Slice the cascade helpers + the few referenced helpers out of tasks.js.
// The cascade block is bounded by `// ── Parent/subtask completion cascade ──`
// and the `// Status/Priority quick-change` marker that follows it.
const sIdx = full.indexOf('// ── Parent/subtask completion cascade');
const eIdx = full.indexOf('// Status/Priority quick-change');
if(sIdx < 0 || eIdx < 0) throw new Error('cascade markers not found in tasks.js (update test bounds)');
const cascadeSrc = full.slice(sIdx, eIdx);

function makeScope(tasks, cfg){
  const findTask = (id) => tasks.find(t => t.id === id) || null;
  const getTaskChildren = (parentId) => tasks.filter(t => (t.parentId || null) === parentId);
  const stampCompletion = () => '2026-05-11T12:00:00';
  const factory = new Function(
    'tasks', 'cfg', 'findTask', 'getTaskChildren', 'stampCompletion',
    cascadeSrc + '\nreturn { _cascadeOnDone, _maybeAutoCompleteParent, _restoreCascade };'
  );
  return factory(tasks, cfg, findTask, getTaskChildren, stampCompletion);
}

test('cascade: parent done propagates to open subtasks', () => {
  const tasks = [
    { id: 1, name: 'P',  status: 'done', parentId: null,  archived: false },
    { id: 2, name: 'C1', status: 'open', parentId: 1,     archived: false },
    { id: 3, name: 'C2', status: 'open', parentId: 1,     archived: false },
    { id: 4, name: 'C3', status: 'done', parentId: 1,     archived: false }, // already done — untouched
  ];
  const { _cascadeOnDone } = makeScope(tasks, { cascadeCompletion: true });
  const snap = _cascadeOnDone(1);
  assert.equal(snap.length, 2);
  assert.equal(tasks.find(t => t.id === 2).status, 'done');
  assert.equal(tasks.find(t => t.id === 3).status, 'done');
  // The already-done child must NOT be in the snapshot — we didn't mutate it.
  assert.ok(!snap.some(s => s.id === 4));
});

test('cascade: parent done skips recurring + archived children', () => {
  const tasks = [
    { id: 1, name: 'P',  status: 'done', parentId: null, archived: false },
    { id: 2, name: 'R',  status: 'open', parentId: 1,    archived: false, recur: 'daily' },
    { id: 3, name: 'A',  status: 'open', parentId: 1,    archived: true },
  ];
  const { _cascadeOnDone } = makeScope(tasks, { cascadeCompletion: true });
  const snap = _cascadeOnDone(1);
  assert.equal(snap.length, 0);
  assert.equal(tasks.find(t => t.id === 2).status, 'open', 'recur child stays open');
  assert.equal(tasks.find(t => t.id === 3).status, 'open', 'archived child stays open');
});

test('cascade: last subtask done bubbles parent + grandparent up', () => {
  const tasks = [
    { id: 1, name: 'G',  status: 'open', parentId: null, archived: false },
    { id: 2, name: 'P',  status: 'open', parentId: 1,    archived: false },
    { id: 3, name: 'C1', status: 'done', parentId: 2,    archived: false },
    { id: 4, name: 'C2', status: 'done', parentId: 2,    archived: false }, // just completed
  ];
  const { _maybeAutoCompleteParent } = makeScope(tasks, { cascadeCompletion: true });
  const snap = _maybeAutoCompleteParent(4);
  // Both parent (2) and grandparent (1) flip to done — grandparent has only one child.
  assert.equal(tasks.find(t => t.id === 2).status, 'done');
  assert.equal(tasks.find(t => t.id === 1).status, 'done');
  assert.equal(snap.length, 2);
});

test('cascade: bubble stops at a parent with an open sibling', () => {
  const tasks = [
    { id: 1, name: 'G',  status: 'open', parentId: null, archived: false },
    { id: 2, name: 'P',  status: 'open', parentId: 1,    archived: false },
    { id: 5, name: 'P2', status: 'open', parentId: 1,    archived: false }, // open sibling
    { id: 3, name: 'C1', status: 'done', parentId: 2,    archived: false },
    { id: 4, name: 'C2', status: 'done', parentId: 2,    archived: false },
  ];
  const { _maybeAutoCompleteParent } = makeScope(tasks, { cascadeCompletion: true });
  const snap = _maybeAutoCompleteParent(4);
  // P auto-completes; G doesn't because P2 is still open.
  assert.equal(tasks.find(t => t.id === 2).status, 'done');
  assert.equal(tasks.find(t => t.id === 1).status, 'open');
  assert.equal(snap.length, 1);
});

test('cascade: cfg.cascadeCompletion=false disables both rules', () => {
  const tasks = [
    { id: 1, name: 'P',  status: 'done', parentId: null, archived: false },
    { id: 2, name: 'C',  status: 'open', parentId: 1,    archived: false },
  ];
  const { _cascadeOnDone, _maybeAutoCompleteParent } = makeScope(tasks, { cascadeCompletion: false });
  const down = _cascadeOnDone(1);
  const up = _maybeAutoCompleteParent(2);
  assert.equal(down.length, 0);
  assert.equal(up.length, 0);
  assert.equal(tasks.find(t => t.id === 2).status, 'open');
});

test('cascade: _restoreCascade rolls back the snapshot', () => {
  const tasks = [
    { id: 1, name: 'P',  status: 'done', parentId: null, archived: false },
    { id: 2, name: 'C',  status: 'open', parentId: 1,    archived: false, completedAt: null },
  ];
  const { _cascadeOnDone, _restoreCascade } = makeScope(tasks, { cascadeCompletion: true });
  const snap = _cascadeOnDone(1);
  assert.equal(tasks.find(t => t.id === 2).status, 'done');
  _restoreCascade(snap);
  assert.equal(tasks.find(t => t.id === 2).status, 'open');
  assert.equal(tasks.find(t => t.id === 2).completedAt, null);
});
