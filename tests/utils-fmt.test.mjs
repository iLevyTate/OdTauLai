/**
 * Pure number→string formatters in js/utils.js used across timer/task UI:
 *   fmt(s)      — adaptive: "MM:SS" until 1h, then "H:MM:SS"
 *   fmtHMS(s)   — always "HH:MM:SS"
 *   fmtShort(s) — "Xh Ym" or "Ym" (drops seconds)
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadFns() {
  const src = readFileSync(join(root, 'js', 'utils.js'), 'utf8');
  const s = src.indexOf('function fmt(s)');
  const e = src.indexOf('function timeNow()');
  assert.ok(s >= 0 && e > s, 'slice fmt..timeNow');
  const block = src.slice(s, e);
  return new Function(`${block}\nreturn { fmt, fmtHMS, fmtShort };`)();
}

test('fmt: under 1 hour returns MM:SS', () => {
  const { fmt } = loadFns();
  assert.equal(fmt(0), '00:00');
  assert.equal(fmt(5), '00:05');
  assert.equal(fmt(60), '01:00');
  assert.equal(fmt(125), '02:05');
  assert.equal(fmt(3599), '59:59');
});

test('fmt: 1 hour and over switches to H:MM:SS (hours not zero-padded)', () => {
  const { fmt } = loadFns();
  assert.equal(fmt(3600), '1:00:00');
  assert.equal(fmt(3661), '1:01:01');
  assert.equal(fmt(7200), '2:00:00');
  assert.equal(fmt(36000), '10:00:00');
});

test('fmtHMS: always returns HH:MM:SS (zero-padded hours, even at 0)', () => {
  const { fmtHMS } = loadFns();
  assert.equal(fmtHMS(0), '00:00:00');
  assert.equal(fmtHMS(125), '00:02:05');
  assert.equal(fmtHMS(3661), '01:01:01');
  assert.equal(fmtHMS(36000), '10:00:00');
});

test('fmtShort: drops seconds, omits hours when zero', () => {
  const { fmtShort } = loadFns();
  assert.equal(fmtShort(0), '0m');
  assert.equal(fmtShort(59), '0m');           // <60s rounds down to 0m (locked-in contract)
  assert.equal(fmtShort(125), '2m');          // 2m05s → 2m (seconds dropped)
  assert.equal(fmtShort(3600), '1h 0m');
  assert.equal(fmtShort(3661), '1h 1m');      // 1h01m01s → 1h 1m
  assert.equal(fmtShort(7320), '2h 2m');
});
