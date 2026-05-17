/**
 * Tool-router regression tests.
 *
 * The Ask pipeline used to hand local 1-3B models a flat list of 31 tools.
 * Small models picked adjacent-but-wrong ops on a predictable set of queries
 * (MARK_DONE vs UPDATE_TASK{status:done}, ARCHIVE_TASK vs DELETE_TASK,
 * SNOOZE_TASK vs UPDATE_TASK{hiddenUntil}, etc.). These tests pin the
 * deterministic intent router that narrows the schema BEFORE the LLM sees it.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'js', 'tool-schema.js'), 'utf8');

function loadSchema() {
  const win = {};
  const fn = new Function('window', src);
  fn(win);
  return win;
}

test('classifyAskIntent: empty / non-string returns []', () => {
  const { classifyAskIntent } = loadSchema();
  assert.deepEqual(classifyAskIntent(''), []);
  assert.deepEqual(classifyAskIntent('   '), []);
  assert.deepEqual(classifyAskIntent(null), []);
  assert.deepEqual(classifyAskIntent(42), []);
});

test('classifyAskIntent: complete-style queries route to "complete"', () => {
  const { classifyAskIntent } = loadSchema();
  for (const q of [
    'mark task 5 done',
    'I finished the dentist',
    'tick off the laundry',
    'cross off buy milk',
    'mark all my errands complete',
  ]) {
    assert.ok(classifyAskIntent(q).includes('complete'), 'missed complete: ' + q);
  }
});

test('classifyAskIntent: archive vs delete are kept distinct', () => {
  const { classifyAskIntent } = loadSchema();
  // "archive" / "trash" routes to archive only — not delete
  const arc = classifyAskIntent('archive the old grocery list');
  assert.ok(arc.includes('archive'));
  assert.ok(!arc.includes('delete'));

  // "delete forever" / "permanently" routes to delete
  const del = classifyAskIntent('delete forever the spam task');
  assert.ok(del.includes('delete'));

  // Bare "delete" without "forever" stays out of the destructive path
  const soft = classifyAskIntent('delete the rent task');
  assert.ok(!soft.includes('delete'), 'bare "delete" should not match destructive intent');
});

test('classifyAskIntent: snooze vs schedule are routed separately', () => {
  const { classifyAskIntent } = loadSchema();
  assert.ok(classifyAskIntent('snooze task 7 for a week').includes('snooze'));
  assert.ok(classifyAskIntent('hide until friday').includes('snooze'));
  assert.ok(classifyAskIntent('reschedule the dentist to next monday').includes('schedule'));
});

test('classifyAskIntent: questions route to "query"', () => {
  const { classifyAskIntent } = loadSchema();
  for (const q of [
    "what's overdue?",
    'how many tasks did I finish this week?',
    'list my errands',
    'show me everything tagged shopping',
    'summarise my week',
    'do i have anything due today?',
  ]) {
    assert.ok(classifyAskIntent(q).includes('query'), 'missed query: ' + q);
  }
});

test('classifyAskIntent: create-style imperatives route to "create"', () => {
  const { classifyAskIntent } = loadSchema();
  for (const q of [
    'add buy milk to my shopping list',
    'create a task to call mom',
    'new task: review PR',
    'book the dentist for next monday',
    'log a workout for today',
  ]) {
    assert.ok(classifyAskIntent(q).includes('create'), 'missed create: ' + q);
  }
});

test('classifyAskIntent: tag intent matches both #shorthand and "tag" verb', () => {
  const { classifyAskIntent } = loadSchema();
  assert.ok(classifyAskIntent('mark all my #errands as done').includes('tag'));
  assert.ok(classifyAskIntent('untag the rent task').includes('tag'));
});

test('classifyAskIntent: reminder routes only to reminder (not recur)', () => {
  const { classifyAskIntent } = loadSchema();
  const r = classifyAskIntent('remind me to call mom tomorrow at 9am');
  assert.ok(r.includes('reminder'));
  assert.ok(!r.includes('recur'));
});

test('classifyAskIntent: recur is recognised', () => {
  const { classifyAskIntent } = loadSchema();
  assert.ok(classifyAskIntent('repeats weekly').includes('recur'));
  assert.ok(classifyAskIntent('every monday').includes('recur'));
});

test('toolNamesForIntents: empty intents → full schema (no silent drops)', () => {
  const { toolNamesForIntents, TOOL_SCHEMA } = loadSchema();
  const all = Object.keys(TOOL_SCHEMA);
  const got = toolNamesForIntents([]);
  assert.equal(got.length, all.length, 'empty intents must include every op');
});

test('toolNamesForIntents: always includes the read-only baseline', () => {
  const { toolNamesForIntents, TOOL_INTENT_BASELINE } = loadSchema();
  const got = new Set(toolNamesForIntents(['create']));
  for (const t of TOOL_INTENT_BASELINE) {
    assert.ok(got.has(t), 'baseline tool missing from "create" subset: ' + t);
  }
});

test('toolNamesForIntents: "complete" surfaces MARK_DONE, suppresses CHANGE_LIST / SPLIT_TASK', () => {
  const { toolNamesForIntents } = loadSchema();
  const got = new Set(toolNamesForIntents(['complete']));
  assert.ok(got.has('MARK_DONE'), 'MARK_DONE must be in the complete subset');
  assert.ok(!got.has('CHANGE_LIST'), 'CHANGE_LIST should NOT be in complete subset');
  assert.ok(!got.has('SPLIT_TASK'), 'SPLIT_TASK should NOT be in complete subset');
});

test('toolNamesForIntents: "delete" surfaces all three of archive/restore/delete', () => {
  const { toolNamesForIntents } = loadSchema();
  const got = new Set(toolNamesForIntents(['delete']));
  for (const t of ['ARCHIVE_TASK', 'RESTORE_TASK', 'DELETE_TASK']) {
    assert.ok(got.has(t), t + ' missing from delete subset');
  }
});

test('toolSchemaPromptBlock: subsetted output is materially shorter', () => {
  const { toolSchemaPromptBlock } = loadSchema();
  const full = toolSchemaPromptBlock();
  const completeSubset = toolSchemaPromptBlock({ intents: ['complete'] });
  assert.ok(completeSubset.length < full.length, 'subset should be smaller than full');
  // Sanity: subset must contain the tool the intent is named for.
  assert.match(completeSubset, /- MARK_DONE\(/);
  // And must NOT contain unrelated destructive ops.
  assert.doesNotMatch(completeSubset, /- DELETE_TASK\(/);
});

test('toolSchemaPromptBlock: inline hints disambiguate the confused pairs', () => {
  const { toolSchemaPromptBlock } = loadSchema();
  const full = toolSchemaPromptBlock();
  assert.match(full, /MARK_DONE.*NOT UPDATE_TASK/i, 'MARK_DONE needs anti-UPDATE_TASK hint');
  assert.match(full, /DELETE_TASK.*ARCHIVED/i,    'DELETE_TASK needs "must be archived" hint');
  assert.match(full, /SNOOZE_TASK.*hiddenUntil/i, 'SNOOZE_TASK needs hint vs UPDATE_TASK{hiddenUntil}');
  assert.match(full, /REMOVE_CHECK.*NOT REMOVE_TAG/i, 'REMOVE_CHECK needs anti-REMOVE_TAG hint');
});

test('toolSchemaPromptBlock: explicit name array overrides intent routing', () => {
  const { toolSchemaPromptBlock } = loadSchema();
  const out = toolSchemaPromptBlock(['MARK_DONE', 'REOPEN']);
  assert.match(out, /- MARK_DONE\(/);
  assert.match(out, /- REOPEN\(/);
  assert.doesNotMatch(out, /- CREATE_TASK\(/);
});

test('toolSchemaPromptBlock: unknown tool names are silently filtered, never crash', () => {
  const { toolSchemaPromptBlock } = loadSchema();
  // Empty after filtering → falls back to full schema, not an empty prompt
  const out = toolSchemaPromptBlock(['NOT_A_REAL_OP']);
  assert.ok(out.length > 0, 'should not return empty');
  assert.match(out, /- CREATE_TASK\(/);
});

test('buildOpenAIToolsFromToolSchema: subset matches names; description carries pick-hint', () => {
  const { buildOpenAIToolsFromToolSchema } = loadSchema();
  const subset = buildOpenAIToolsFromToolSchema({ intents: ['complete'] });
  const names = subset.map(t => t.function.name);
  assert.ok(names.includes('MARK_DONE'));
  assert.ok(!names.includes('DELETE_TASK'));
  const markDone = subset.find(t => t.function.name === 'MARK_DONE');
  assert.match(markDone.function.description, /NOT UPDATE_TASK/i, 'description must carry pick-hint');
});

test('buildOpenAIToolsFromToolSchema: undefined opts preserves full backward-compat behaviour', () => {
  const { buildOpenAIToolsFromToolSchema, TOOL_SCHEMA } = loadSchema();
  const all = buildOpenAIToolsFromToolSchema();
  assert.equal(all.length, Object.keys(TOOL_SCHEMA).length);
});

test('end-to-end: confused queries narrow to the right subset', () => {
  const { classifyAskIntent, toolNamesForIntents } = loadSchema();

  // "mark dentist done" → must surface MARK_DONE (not UPDATE_TASK alone)
  const a = new Set(toolNamesForIntents(classifyAskIntent('mark the dentist task done')));
  assert.ok(a.has('MARK_DONE'));

  // "snooze task 7 for a week" → must surface SNOOZE_TASK (not just UPDATE_TASK)
  const b = new Set(toolNamesForIntents(classifyAskIntent('snooze task 7 for a week')));
  assert.ok(b.has('SNOOZE_TASK'));

  // "reschedule the dentist" → must surface RESCHEDULE
  const c = new Set(toolNamesForIntents(classifyAskIntent('reschedule the dentist to next monday')));
  assert.ok(c.has('RESCHEDULE'));

  // "move rent to Personal" → must surface CHANGE_LIST
  const d = new Set(toolNamesForIntents(classifyAskIntent('move the rent task to Personal list')));
  assert.ok(d.has('CHANGE_LIST'));

  // "what did I finish last week?" → must surface QUERY_TASKS, not write ops
  const e = new Set(toolNamesForIntents(classifyAskIntent('what did I finish last week?')));
  assert.ok(e.has('QUERY_TASKS'));
  assert.ok(!e.has('UPDATE_TASK'), 'questions should not surface write ops');
});
