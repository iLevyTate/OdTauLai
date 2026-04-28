/**
 * getTimerState in js/timer.js — the Pomodoro state machine.
 *
 * The source comment is explicit about why this matters:
 *   "Pause-state (the trickiest to detect) is 'not running, not finished, but
 *    progress was made' — the IDLE/PAUSED distinction wasn't being made before,
 *    which caused updateConfig to silently reset paused timers."
 *
 * Locks in idle / playing / paused / finished classification so that
 * regression doesn't sneak back in.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadGetTimerState({ running, finished, remaining, totalDuration }) {
  const src = readFileSync(join(root, 'js', 'timer.js'), 'utf8');
  const s = src.indexOf('function getTimerState()');
  const e = src.indexOf('// ========== PHASE');
  assert.ok(s >= 0 && e > s, 'slice getTimerState');
  const block = src.slice(s, e);
  // Inject the 4 module-locals that getTimerState closes over.
  return new Function(
    'running', 'finished', 'remaining', 'totalDuration',
    `${block}\nreturn getTimerState();`,
  )(running, finished, remaining, totalDuration);
}

test('getTimerState: running=true → "playing" (regardless of other fields)', () => {
  assert.equal(loadGetTimerState({ running: true,  finished: false, remaining: 1500, totalDuration: 1500 }), 'playing');
  assert.equal(loadGetTimerState({ running: true,  finished: true,  remaining: 0,    totalDuration: 1500 }), 'playing');
  assert.equal(loadGetTimerState({ running: true,  finished: false, remaining: 800,  totalDuration: 1500 }), 'playing');
});

test('getTimerState: not running, finished=true → "finished"', () => {
  assert.equal(loadGetTimerState({ running: false, finished: true, remaining: 0,    totalDuration: 1500 }), 'finished');
  assert.equal(loadGetTimerState({ running: false, finished: true, remaining: 1500, totalDuration: 1500 }), 'finished');
});

test('getTimerState: not running, not finished, partial progress → "paused"', () => {
  // The bug the source comment documents: "remaining < totalDuration"
  // is what distinguishes paused from idle. Lock this in.
  assert.equal(loadGetTimerState({ running: false, finished: false, remaining: 1499, totalDuration: 1500 }), 'paused');
  assert.equal(loadGetTimerState({ running: false, finished: false, remaining: 1,    totalDuration: 1500 }), 'paused');
  assert.equal(loadGetTimerState({ running: false, finished: false, remaining: 750,  totalDuration: 1500 }), 'paused');
});

test('getTimerState: not running, not finished, no progress (remaining == totalDuration) → "idle"', () => {
  assert.equal(loadGetTimerState({ running: false, finished: false, remaining: 1500, totalDuration: 1500 }), 'idle');
  assert.equal(loadGetTimerState({ running: false, finished: false, remaining: 300,  totalDuration: 300 }), 'idle');
});

test('getTimerState: precedence — running beats finished beats paused', () => {
  // Even with a "stale" finished=true, if running is true, we report playing.
  // (The state-machine flow normally clears finished before starting, but
  // the function should not depend on that order.)
  assert.equal(loadGetTimerState({ running: true,  finished: true, remaining: 0, totalDuration: 1500 }), 'playing');
  // running=false, finished=true wins over the partial-progress paused check
  assert.equal(loadGetTimerState({ running: false, finished: true, remaining: 750, totalDuration: 1500 }), 'finished');
});
