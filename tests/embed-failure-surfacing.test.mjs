/**
 * embed-failure surfacing guards.
 *
 * Pre-fix: `embedStore.ensure(t).catch(()=>{})` silently swallowed IDB
 * write errors — semantic search degraded with zero user signal. Now
 * coalesces failures per flush and surfaces ONE toast with a Retry,
 * escalating to console.error after 4 consecutive failed bursts.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const storage = readFileSync(join(root, 'js', 'storage.js'), 'utf8');

test('embedStore.ensure failures are no longer silently caught', () => {
  // The literal pattern .catch(()=>{}) at the call site was the smoking
  // gun. After the fix, ensure().catch should reference the burst handler.
  const idx = storage.indexOf('function _flushEmbedEnsure');
  assert.ok(idx > 0, '_flushEmbedEnsure not found');
  const body = storage.slice(idx, idx + 2000);
  assert.ok(!/\.ensure\(t\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(body),
    'silent catch ()=>{} on embedStore.ensure must be removed');
  assert.match(body, /showActionToast/, 'must surface failures via showActionToast');
  assert.match(body, /Semantic search index/, 'toast text identifies the failing surface');
});

test('embed-failure path coalesces toasts per burst', () => {
  // If the toast fires per-task instead of per-burst, a 50-task save flush
  // produces 50 toasts. The `burstFailed` flag is what prevents that.
  const idx = storage.indexOf('function _flushEmbedEnsure');
  const body = storage.slice(idx, idx + 2000);
  assert.match(body, /burstFailed/, 'must coalesce via per-burst flag');
  assert.match(body, /_embedFailureCount/, 'must track cross-burst failure count for escalation');
});
