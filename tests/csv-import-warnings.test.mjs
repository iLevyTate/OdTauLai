/**
 * CSV import warnings.
 *
 * Pre-fix: invalid blockedBy IDs silently dropped from rows; orphaned
 * references to non-existent tasks survived but pointed nowhere; user
 * had no idea data was lost on import. The fix accumulates per-row
 * warnings and surfaces them via console.group + an action toast.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const storage = readFileSync(join(root, 'js', 'storage.js'), 'utf8');

test('CSV row helper records dropped blockedBy IDs', () => {
  // The previous `.filter(x => x > 0)` silently dropped invalid values.
  // Now we capture the dropped set into _csvRowWarnings.
  const idx = storage.indexOf('function _csvRowToTask(');
  assert.ok(idx > 0, '_csvRowToTask not found');
  const body = storage.slice(idx, idx + 3000);
  assert.match(body, /_csvRowWarnings\.push/,
    'invalid blockedBy entries must record a warning, not silently drop');
  assert.match(body, /invalid IDs dropped/i, 'warning message names the issue');
});

test('post-pass validates blockedBy targets exist after merge', () => {
  // Forward refs (target imported later in same CSV) are valid; targets
  // that still don't exist after the full merge are real broken deps.
  const idx = storage.indexOf('function _importTasksFromCSV(');
  assert.ok(idx > 0, '_importTasksFromCSV not found');
  const body = storage.slice(idx, idx + 2500);
  assert.match(body, /liveIds/, 'post-pass must check live id set');
  assert.match(body, /non-existent IDs/i, 'post-pass surfaces unresolvable refs');
});

test('importTasks surfaces warnings via console.group + action toast', () => {
  const idx = storage.indexOf('function importTasks(');
  assert.ok(idx > 0, 'importTasks not found');
  const body = storage.slice(idx, idx + 2500);
  assert.match(body, /console\.group\(/, 'warnings must be grouped in console for power users');
  assert.match(body, /showActionToast/, 'user-visible toast surfaces warning count');
});
