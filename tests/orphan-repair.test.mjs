/**
 * Orphan-parent repair must persist + render.
 *
 * Pre-fix: repairOrphanedTaskParents cleared dangling parentId in memory
 * but didn't call saveState/renderTaskList. After importing a backup with
 * orphaned subtasks, the user saw "ghost" subtasks until the next save
 * happened to fire from another path.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tasks = readFileSync(join(root, 'js', 'tasks.js'), 'utf8');

test('repairOrphanedTaskParents calls saveState + renderTaskList when something changed', () => {
  const idx = tasks.indexOf('function repairOrphanedTaskParents(');
  assert.ok(idx > 0, 'repairOrphanedTaskParents not found');
  const body = tasks.slice(idx, idx + 1000);
  // The persist + render must be guarded on n > 0 — calling them on every
  // invocation would defeat the cheap "did anything change" semantics.
  assert.match(body, /if\s*\(\s*n\s*>\s*0\s*\)/, 'persist + render guarded on n > 0');
  assert.match(body, /saveState\(/, 'must save when orphans were repaired');
  assert.match(body, /renderTaskList\(/, 'must re-render so the user sees the cleaned tree');
});
