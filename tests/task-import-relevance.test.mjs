/**
 * _taskImportRelevanceMs: lastModified vs created fallbacks (js/storage.js).
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadTaskImportRelevanceMs() {
  const src = readFileSync(join(root, 'js', 'storage.js'), 'utf8');
  const i = src.indexOf('function _taskImportRelevanceMs(');
  assert.ok(i >= 0, 'storage.js should define _taskImportRelevanceMs');
  const j = src.indexOf('function _taskLwwMs(', i);
  assert.ok(j > i, '_taskLwwMs should follow _taskImportRelevanceMs');
  const body = src.slice(i, j);
  return new Function(`'use strict'; ${body} return _taskImportRelevanceMs;`)();
}

const rel = loadTaskImportRelevanceMs();

test('lastModified > 0 wins over created', () => {
  const a = { lastModified: 500, created: '2000-01-01T00:00:00.000Z' };
  assert.equal(rel(a), 500);
});

test('no lastModified uses created ISO', () => {
  const t = { created: '2024-06-15T12:00:00.000Z' };
  assert.equal(rel(t), Date.parse('2024-06-15T12:00:00.000Z'));
});

test('null/empty task is 0', () => {
  assert.equal(rel(null), 0);
  assert.equal(rel(undefined), 0);
  assert.equal(rel({}), 0);
});

test('zero or missing lastModified falls through to created', () => {
  assert.equal(
    rel({ lastModified: 0, created: '2020-01-01T00:00:00.000Z' }),
    Date.parse('2020-01-01T00:00:00.000Z'),
  );
});

test('non-ISO created yields 0', () => {
  assert.equal(rel({ created: 'nope' }), 0);
});
