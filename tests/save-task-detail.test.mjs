/**
 * saveTaskDetail validation guards.
 *
 * Pre-fix: `t.name = gid('mdName').value.trim() || t.name` silently restored
 * the old name when the user cleared the field. Looked like the edit saved
 * when it didn't. The fix refuses the save with a toast and bounces focus
 * back to the input.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ui = readFileSync(join(root, 'js', 'ui.js'), 'utf8');

test('saveTaskDetail rejects empty name with a toast', () => {
  const idx = ui.indexOf('function saveTaskDetail(');
  assert.ok(idx > 0, 'saveTaskDetail not found');
  const body = ui.slice(idx, idx + 2000);
  // The validation must fire BEFORE any other field write so a partial save
  // never leaves the task in a half-updated state.
  assert.match(body, /Task name cannot be empty/, 'must surface a toast on empty name');
  // The previous "|| t.name" silent fallback must be gone — replaced with
  // an explicit assignment from the validated name.
  const guardIdx = body.indexOf('Task name cannot be empty');
  const tNameAssignIdx = body.indexOf('t.name=');
  assert.ok(guardIdx < tNameAssignIdx,
    'empty-name guard must execute before t.name assignment');
  assert.ok(!/t\.name\s*=\s*gid\(['"]mdName['"]\)\.value\.trim\(\)\s*\|\|\s*t\.name/.test(body),
    'silent fallback `|| t.name` must be removed');
});

test('saveTaskDetail empty-name guard returns early (no partial save)', () => {
  // Guarantees the function bails before modifying any other field. If a
  // future patch moves the guard after the activity-snapshot, partial
  // saves can land — catch that here.
  const idx = ui.indexOf('function saveTaskDetail(');
  const body = ui.slice(idx, idx + 1500);
  // The early return after the toast must exist.
  assert.match(body, /showExportToast\([^)]*Task name cannot be empty[^)]*\)[\s\S]{0,200}return\s*;/,
    'guard must call return after the toast');
});

test('closeTaskDetail recovers from cross-tab task delete', () => {
  // If `tasks.findIndex` returns -1 because another tab deleted the task,
  // the snapshot revert silently no-op'd and the user's edits vanished.
  // The new branch surfaces a Restore toast.
  const idx = ui.indexOf('async function closeTaskDetail(');
  assert.ok(idx > 0, 'closeTaskDetail not found');
  const body = ui.slice(idx, idx + 2000);
  // The branch is `if(si>=0){...} else {...}` — proves missing-task path exists.
  assert.match(body, /si\s*>=\s*0[\s\S]{0,500}\}\s*else\s*\{/, 'must branch on missing task index');
  assert.match(body, /deleted in another tab/i,
    'must inform the user the task was deleted elsewhere');
  assert.match(body, /tasks\.push\(\s*lost\s*\)/,
    'Restore action must re-add the snapshot under a fresh id');
});
