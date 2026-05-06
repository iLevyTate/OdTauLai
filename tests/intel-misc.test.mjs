/**
 * Misc intel-pipeline guards.
 *
 * - ensureSchwartzEmbeddings used to await embedText with no timeout — a
 *   hung embed pipeline froze harmonize / value alignment forever.
 * - Tool-result truncation in ask.js was hardcoded to 6 KB and silent.
 * - hasClassificationCategory used to accept hidden categories, so the AI
 *   pipeline could propose a category the user had explicitly hidden.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const intel = readFileSync(join(root, 'js', 'intel-features.js'), 'utf8');
const ask   = readFileSync(join(root, 'js', 'ask.js'), 'utf8');

test('ensureSchwartzEmbeddings races each embedText against a timeout', () => {
  const idx = intel.indexOf('async function ensureSchwartzEmbeddings');
  assert.ok(idx > 0, 'ensureSchwartzEmbeddings not found');
  const body = intel.slice(idx, idx + 2000);
  assert.match(body, /Promise\.race/, 'must use Promise.race against a timeout');
  // Timeout must be a real number ≥ 10s — too tight and value alignment
  // breaks on slow machines; too loose and the freeze is back.
  const m = body.match(/SCHWARTZ_EMBED_TIMEOUT_MS\s*=\s*(\d[\d_]*)/);
  assert.ok(m, 'timeout constant must be defined');
  const ms = parseInt(m[1].replace(/_/g, ''), 10);
  assert.ok(ms >= 10000 && ms <= 60000, 'timeout should be in [10s, 60s]');
  // Don't persist a partial cache — incomplete vecs would poison future calls.
  assert.match(body, /incomplete vectors/i, 'must guard against partial-cache persist');
});

test('Ask tool-result truncation is bumped and disclosed to the LLM', () => {
  const idx = ask.indexOf('TOOL_RESULT_LIMIT');
  assert.ok(idx > 0, 'TOOL_RESULT_LIMIT not declared');
  const body = ask.slice(idx, idx + 1200);
  // Cap is at least 16 KB now — the previous 6 KB silently dropped most
  // tool output for any non-trivial task list.
  const m = body.match(/TOOL_RESULT_LIMIT\s*=\s*(\d+)/);
  assert.ok(m && parseInt(m[1], 10) >= 16000, 'tool-result limit must be ≥ 16000 bytes');
  // When truncation happens, the LLM is told so it can ask for a narrower
  // query — silent slice would have it confidently operate on partial data.
  assert.match(body, /tool results truncated/i,
    'truncation must produce a literal note appended to the payload');
});

test('hasClassificationCategory rejects hidden categories', () => {
  const idx = intel.indexOf('function hasClassificationCategory(');
  assert.ok(idx > 0, 'hasClassificationCategory not found');
  const body = intel.slice(idx, idx + 1200);
  // The .some() predicate must check the !c.hidden flag — without it,
  // proposeReclassifyUncategorized can suggest a hidden category.
  assert.match(body, /!c\.hidden/, 'must filter out c.hidden');
});
