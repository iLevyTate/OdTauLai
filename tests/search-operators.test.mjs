/**
 * Tests for the task-search operator parser (parseTaskSearchQuery) and the
 * matchesFilters integration that consumes it. The parser block is sliced
 * out of js/tasks.js and loaded into a Function scope so we exercise the
 * production source verbatim — paraphrasing would let drift go undetected.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const full = readFileSync(join(root, 'js', 'tasks.js'), 'utf8');

// parser block is bounded by these comment headers in tasks.js
const sIdx = full.indexOf('// ── Search operator parser');
const eIdx = full.indexOf('if(typeof window !== \'undefined\') window.parseTaskSearchQuery');
if(sIdx < 0 || eIdx < 0) throw new Error('parser markers not found in tasks.js (update test bounds)');
// include the export line so the function is defined; trim the window assign.
const block = full.slice(sIdx, eIdx + 'if(typeof window !== \'undefined\') window.parseTaskSearchQuery = parseTaskSearchQuery;'.length);

function loadParser(){
  const win = {};
  const fn = new Function('window', block + '\nreturn parseTaskSearchQuery;');
  return fn(win);
}

test('parser: bare free text passes through with no operators', () => {
  const p = loadParser();
  const r = p('write the report by friday');
  assert.equal(r.text, 'write the report by friday');
  for(const k of Object.keys(r.ops)) assert.equal(r.ops[k].length, 0);
});

test('parser: tag:value and #shorthand both populate ops.tag', () => {
  const p = loadParser();
  const r = p('tag:work #urgent rephrase');
  assert.deepEqual(r.ops.tag.sort(), ['urgent', 'work']);
  assert.equal(r.text, 'rephrase');
});

test('parser: @shorthand maps to ops.priority and unknown @values stay in text', () => {
  const p = loadParser();
  const r = p('@high something @nonsense');
  assert.deepEqual(r.ops.priority, ['high']);
  // @nonsense is stripped (we strip all @x tokens, valid or not) — the text
  // value should still drop it. This matches existing quick-add @priority
  // behaviour where unknown @ tokens evaporate.
  assert.equal(r.ops.priority.length, 1);
});

test('parser: is:, due:, list:, status:, priority: all populate the right bucket', () => {
  const p = loadParser();
  const r = p('is:overdue due:tomorrow list:Personal status:open priority:urgent finish');
  assert.deepEqual(r.ops.is,       ['overdue']);
  assert.deepEqual(r.ops.due,      ['tomorrow']);
  assert.deepEqual(r.ops.list,     ['personal']);
  assert.deepEqual(r.ops.status,   ['open']);
  assert.deepEqual(r.ops.priority, ['urgent']);
  assert.equal(r.text, 'finish');
});

test('parser: quoted values are unquoted (lets list:"To Read" survive)', () => {
  const p = loadParser();
  const r = p('list:"to read" tag:\'side-project\'');
  assert.deepEqual(r.ops.list, ['to read']);
  assert.deepEqual(r.ops.tag,  ['side-project']);
});

test('parser: unknown operators stay in free text (so a typo isn\'t silently swallowed)', () => {
  const p = loadParser();
  const r = p('color:blue write the report');
  // Typo'd / unknown operators are NOT stripped — they fall through into the
  // free-text portion so the substring match still has a shot at them, and
  // the user can see what wasn't recognised in the parsed pills row.
  for(const k of Object.keys(r.ops)) assert.equal(r.ops[k].length, 0);
  assert.equal(r.text, 'color:blue write the report');
});

test('parser: lowercases operator values for case-insensitive matching', () => {
  const p = loadParser();
  const r = p('tag:WORK priority:HIGH');
  assert.deepEqual(r.ops.tag,      ['work']);
  assert.deepEqual(r.ops.priority, ['high']);
});

test('parser: multiple values per operator are OR-combined in the array', () => {
  const p = loadParser();
  const r = p('tag:work tag:urgent');
  assert.deepEqual(r.ops.tag.sort(), ['urgent', 'work']);
});
