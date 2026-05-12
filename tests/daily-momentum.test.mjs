/**
 * Daily momentum stats — streak math + 7-day completion sparkline.
 * Slices the _dailyMomentumStats helper out of js/tasks.js and runs it
 * against synthetic task fixtures so the streak rules (today doesn't break
 * yesterday's streak; gaps end it; archived/non-archived parity) stay
 * stable across refactors.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const full = readFileSync(join(root, 'js', 'tasks.js'), 'utf8');

// Slice the momentum block out: from the section header to renderDailyMomentum.
const sIdx = full.indexOf('// ── Daily momentum');
const eIdx = full.indexOf('function renderDailyMomentum');
if(sIdx < 0 || eIdx < 0) throw new Error('momentum block markers not found in tasks.js (update test bounds)');
const block = full.slice(sIdx, eIdx);

function ymd(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function loadStats(tasks){
  // Same shape completionDateKey returns: ISO date prefix (10 chars) or null.
  const completionDateKey = (s) => {
    if(!s) return null;
    if(/^\d{4}-\d{2}-\d{2}/.test(String(s))) return String(s).slice(0, 10);
    return null;
  };
  const todayISO = () => ymd(new Date());
  return new Function(
    'tasks', 'completionDateKey', 'todayISO',
    block + '\nreturn _dailyMomentumStats();'
  )(tasks, completionDateKey, todayISO);
}

const today = new Date();
const ago = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return ymd(d); };
const stamp = (n) => ago(n) + 'T12:00:00';

test('momentum: today done count + dueToday open count', () => {
  const tasks = [
    { id:1, status:'done', completedAt: stamp(0), archived:false },
    { id:2, status:'done', completedAt: stamp(0), archived:false },
    { id:3, status:'open', dueDate: ago(0),       archived:false },
    { id:4, status:'open', dueDate: ago(1),       archived:false }, // overdue, still open — counts as today's bucket
    { id:5, status:'open', dueDate: ago(-3),      archived:false }, // future — doesn't count
  ];
  const s = loadStats(tasks);
  assert.equal(s.doneToday, 2);
  assert.equal(s.dueToday, 2);
  assert.equal(s.total, 4);
  assert.equal(s.pct, 50);
});

test('momentum: streak counts consecutive days backward from today', () => {
  // 4-day streak: today, yesterday, 2-ago, 3-ago. Gap at 4-ago breaks it.
  const tasks = [0, 1, 2, 3, 5].map((n, i) => ({
    id: i+1, status:'done', completedAt: stamp(n), archived:false,
  }));
  const s = loadStats(tasks);
  assert.equal(s.streak, 4);
});

test('momentum: streak is preserved if today is empty but yesterday is done', () => {
  // Today done = 0; streak should still report yesterday-anchored count.
  const tasks = [1, 2, 3].map((n, i) => ({
    id: i+1, status:'done', completedAt: stamp(n), archived:false,
  }));
  const s = loadStats(tasks);
  assert.equal(s.doneToday, 0);
  assert.equal(s.streak, 3);
});

test('momentum: archived tasks are excluded from every count', () => {
  const tasks = [
    { id:1, status:'done', completedAt: stamp(0), archived:true },
    { id:2, status:'open', dueDate: ago(0),       archived:true },
  ];
  const s = loadStats(tasks);
  assert.equal(s.doneToday, 0);
  assert.equal(s.dueToday, 0);
  assert.equal(s.streak, 0);
});

test('momentum: 7-day sparkline has 7 entries, today is rightmost', () => {
  const tasks = [
    { id:1, status:'done', completedAt: stamp(0), archived:false },
    { id:2, status:'done', completedAt: stamp(0), archived:false },
    { id:3, status:'done', completedAt: stamp(6), archived:false },
  ];
  const s = loadStats(tasks);
  assert.equal(s.days.length, 7);
  assert.equal(s.dayKeys.length, 7);
  assert.equal(s.days[6], 2,   'today bucket has 2');
  assert.equal(s.days[0], 1,   '6-days-ago bucket has 1');
});

test('momentum: 0 / 0 today reports pct=0 (no NaN)', () => {
  const s = loadStats([]);
  assert.equal(s.pct, 0);
  assert.equal(s.total, 0);
  assert.equal(s.streak, 0);
});
