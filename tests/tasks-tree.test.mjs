/**
 * Tree helpers: load the real `// Tree helpers` block from js/tasks.js (same
 * source as the browser) so renames/bugs in production are caught.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const full = readFileSync(join(root, 'js', 'tasks.js'), 'utf8');
const s = full.indexOf('// Tree helpers');
const e = full.indexOf('/** Non-archived tasks');
if (s < 0 || e < 0) throw new Error('tasks.js: tree block markers not found (update test slice bounds)');

const treeBlock = full.slice(s, e);

function loadTreeHelpers(tasks) {
  const findTask = (id) => tasks.find((t) => t.id === id);
  return new Function('tasks', 'findTask', treeBlock + '\nreturn { getTaskDescendantIds, getTaskPath };')(
    tasks,
    findTask,
  );
}

test('getTaskDescendantIds: terminates on child-link cycle 1↔2', () => {
  const tasks = [
    { id: 1, name: 'A', parentId: 2 },
    { id: 2, name: 'B', parentId: 1 },
  ];
  const { getTaskDescendantIds } = loadTreeHelpers(tasks);
  const out = getTaskDescendantIds(1);
  assert.ok(out.length < 100, 'should not explode');
  assert.deepEqual(new Set(out), new Set([2, 1]));
});

test('getTaskPath: stops on ancestor cycle', () => {
  const tasks = [
    { id: 1, name: 'A', parentId: 2 },
    { id: 2, name: 'B', parentId: 1 },
  ];
  const { getTaskPath } = loadTreeHelpers(tasks);
  const p = getTaskPath(1);
  assert.ok(p.length <= 64);
  assert.ok(p.includes('A'));
});
