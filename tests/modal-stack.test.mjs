/**
 * Modal-stack hygiene guards.
 *
 * Two prior bugs:
 *   1. showTab() left an open task-detail modal floating over the new tab —
 *      user couldn't reach the timer / settings under it.
 *   2. openTaskDetail() didn't close the Cmd-K palette — opening a task from
 *      a search result left the palette behind, eating focus.
 *
 * These static guards lock in the fixes so a future refactor that drops the
 * close-call from either path fails CI before reaching users.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ui = readFileSync(join(root, 'js', 'ui.js'), 'utf8');

test('showTab closes any open task-detail modal', () => {
  const idx = ui.indexOf('function showTab(');
  assert.ok(idx > 0, 'showTab not found');
  const body = ui.slice(idx, idx + 1500);
  assert.match(body, /closeCmdK\s*\(\s*\)/, 'showTab must still close cmdK');
  assert.match(body, /closeTaskDetail\s*\(\s*\{\s*skipRevert\s*:\s*true/,
    'showTab must close task modal with skipRevert:true (no confirm during nav)');
});

test('openTaskDetail closes the Cmd-K palette', () => {
  const idx = ui.indexOf('function openTaskDetail(');
  assert.ok(idx > 0, 'openTaskDetail not found');
  // Only need to look at the first few hundred chars — the close call
  // should be at the very top, before any work begins.
  const head = ui.slice(idx, idx + 400);
  assert.match(head, /closeCmdK\s*\(\s*\)/, 'openTaskDetail must close the palette early');
});
