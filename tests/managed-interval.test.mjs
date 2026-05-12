/**
 * Managed interval helper (utils.js setManagedInterval / onBfcacheRestore).
 * The runtime contract:
 *   - setManagedInterval(key, fn, ms) registers a single timer per key;
 *     calling it again with the same key clears the previous handle so
 *     module re-init doesn't leak doubled tickers.
 *   - clearAllManagedIntervals clears every tracked timer (pagehide hook).
 *   - onBfcacheRestore registers a callback that fires on pageshow when
 *     e.persisted is true so each subsystem can reinstate its timer.
 *
 * Slice the helper block out of js/utils.js so we exercise the production
 * source verbatim, with a stub `window` carrying minimal event-listener
 * support.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const full = readFileSync(join(root, 'js', 'utils.js'), 'utf8');

const startMarker = '// ── Managed setInterval lifecycle';
const sIdx = full.indexOf(startMarker);
if(sIdx < 0) throw new Error('managed-interval block not found in utils.js (update test bounds)');
const blockStart = full.indexOf('(function(){', sIdx);
const blockEnd = full.indexOf('})();', blockStart) + '})();'.length;
const block = full.slice(blockStart, blockEnd);

function loadHelpers(){
  const listeners = {};
  const win = {
    addEventListener(name, fn){ (listeners[name] = listeners[name] || []).push(fn); },
    dispatchEvent(name, payload){ (listeners[name] || []).forEach(fn => fn(payload)); },
  };
  // Provide setInterval/clearInterval refs that route through real Node
  // timers so we can observe scheduling/cancellation behaviour.
  const created = [];
  const cleared = [];
  win.setInterval = (fn, ms) => { const id = setInterval(fn, ms); created.push(id); return id; };
  win.clearInterval = (id) => { clearInterval(id); cleared.push(id); };
  // The block references the global `setInterval` / `clearInterval`. Pass
  // them as locals so the captured Function scope uses our instrumented
  // versions; this mirrors how the browser hands the timer functions to
  // any module.
  const factory = new Function('window', 'setInterval', 'clearInterval', block);
  factory(win, win.setInterval, win.clearInterval);
  return { win, listeners, created, cleared };
}

test('setManagedInterval registers a single timer per key', () => {
  const { win, created } = loadHelpers();
  const fn = () => {};
  win.setManagedInterval('k1', fn, 100000);
  win.setManagedInterval('k2', fn, 100000);
  assert.equal(win._managedIntervals.size, 2);
  assert.equal(created.length, 2);
  win.clearAllManagedIntervals();
});

test('setManagedInterval re-registering the same key clears the previous handle', () => {
  const { win, created, cleared } = loadHelpers();
  const fn = () => {};
  win.setManagedInterval('dup', fn, 100000);
  const firstId = win._managedIntervals.get('dup');
  win.setManagedInterval('dup', fn, 100000);
  const secondId = win._managedIntervals.get('dup');
  assert.notEqual(firstId, secondId, 'second call must produce a new handle');
  assert.ok(cleared.includes(firstId), 'first handle must have been cleared');
  win.clearAllManagedIntervals();
});

test('clearManagedInterval clears + removes one key without touching others', () => {
  const { win, cleared } = loadHelpers();
  win.setManagedInterval('a', () => {}, 100000);
  win.setManagedInterval('b', () => {}, 100000);
  const aId = win._managedIntervals.get('a');
  win.clearManagedInterval('a');
  assert.ok(!win._managedIntervals.has('a'));
  assert.ok(win._managedIntervals.has('b'));
  assert.ok(cleared.includes(aId));
  win.clearAllManagedIntervals();
});

test('clearAllManagedIntervals wipes every tracked timer', () => {
  const { win, cleared } = loadHelpers();
  win.setManagedInterval('a', () => {}, 100000);
  win.setManagedInterval('b', () => {}, 100000);
  win.setManagedInterval('c', () => {}, 100000);
  const ids = [...win._managedIntervals.values()];
  win.clearAllManagedIntervals();
  assert.equal(win._managedIntervals.size, 0);
  for(const id of ids) assert.ok(cleared.includes(id));
});

test('pagehide event clears all managed intervals', () => {
  const { win } = loadHelpers();
  win.setManagedInterval('a', () => {}, 100000);
  win.setManagedInterval('b', () => {}, 100000);
  assert.equal(win._managedIntervals.size, 2);
  win.dispatchEvent('pagehide', {});
  assert.equal(win._managedIntervals.size, 0);
});

test('onBfcacheRestore + pageshow persisted=true runs every resumer', () => {
  const { win } = loadHelpers();
  let aRan = 0, bRan = 0;
  win.onBfcacheRestore(() => { aRan++; });
  win.onBfcacheRestore(() => { bRan++; });
  // Non-bfcache pageshow: resumers should NOT run.
  win.dispatchEvent('pageshow', { persisted: false });
  assert.equal(aRan, 0);
  assert.equal(bRan, 0);
  // bfcache pageshow: every resumer runs once.
  win.dispatchEvent('pageshow', { persisted: true });
  assert.equal(aRan, 1);
  assert.equal(bRan, 1);
});

test('onBfcacheRestore: resumer throw doesn\'t abort the rest', () => {
  const { win } = loadHelpers();
  let bRan = 0;
  win.onBfcacheRestore(() => { throw new Error('boom'); });
  win.onBfcacheRestore(() => { bRan++; });
  win.dispatchEvent('pageshow', { persisted: true });
  assert.equal(bRan, 1, 'second resumer still ran despite first throwing');
});
