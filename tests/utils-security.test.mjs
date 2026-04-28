/**
 * Security-critical pure helpers in js/utils.js:
 *   escAttr           — HTML attribute escape (XSS gate for title="...", etc.)
 *   sanitizeListColor — only allow safe hex colors as inline styles
 *   completionDateKey — parse legacy and current completedAt formats
 *
 * These functions are direct security boundaries; regressions here are
 * exploitable. Pure inputs/outputs — no DOM needed.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'js', 'utils.js'), 'utf8');

function sliceBetween(start, end) {
  const s = src.indexOf(start);
  const e = src.indexOf(end, s);
  assert.ok(s >= 0 && e > s, `failed to slice ${start}..${end}`);
  return src.slice(s, e);
}

function loadFns(fixedToday) {
  const escAttrSrc = sliceBetween('function escAttr', '/** Local completion');
  const completionSrc = sliceBetween('function completionDateKey', '\nfunction showExportToast');
  const sanitizeSrc = sliceBetween('function sanitizeListColor', '\nfunction fmt(s)');
  const block = `${escAttrSrc}\n${completionSrc}\n${sanitizeSrc}`;
  return new Function('todayKey',
    `${block}\nreturn { escAttr, sanitizeListColor, completionDateKey };`
  )(() => fixedToday);
}

test('escAttr: escapes the five XSS-relevant chars', () => {
  const { escAttr } = loadFns('2026-04-27');
  assert.equal(escAttr('"onclick=alert(1)'), '&quot;onclick=alert(1)');
  assert.equal(escAttr("' OR 1=1"), '&#39; OR 1=1');
  assert.equal(escAttr('<script>'), '&lt;script&gt;');
  assert.equal(escAttr('a & b'), 'a &amp; b');
});

test('escAttr: order matters — & escaped first so &lt; becomes &amp;lt;', () => {
  // Locks in non-idempotent behavior: passing already-escaped input
  // double-escapes. Callers must pass raw text, never pre-escaped HTML.
  const { escAttr } = loadFns('2026-04-27');
  assert.equal(escAttr('&lt;'), '&amp;lt;');
});

test('escAttr: null and undefined return empty string', () => {
  const { escAttr } = loadFns('2026-04-27');
  assert.equal(escAttr(null), '');
  assert.equal(escAttr(undefined), '');
});

test('escAttr: non-string inputs are stringified', () => {
  const { escAttr } = loadFns('2026-04-27');
  assert.equal(escAttr(42), '42');
  assert.equal(escAttr(true), 'true');
});

test('sanitizeListColor: accepts #abc and #aabbcc (3- and 6-char hex)', () => {
  const { sanitizeListColor } = loadFns('2026-04-27');
  assert.equal(sanitizeListColor('#fff'), '#fff');
  assert.equal(sanitizeListColor('#FFFFFF'), '#FFFFFF');
  assert.equal(sanitizeListColor('#a1B2c3'), '#a1B2c3');
});

test('sanitizeListColor: rejects css-injection vectors (named, rgb, url, expression, css smuggling)', () => {
  const { sanitizeListColor } = loadFns('2026-04-27');
  assert.equal(sanitizeListColor('red'), '#888888');
  assert.equal(sanitizeListColor('rgb(255,0,0)'), '#888888');
  assert.equal(sanitizeListColor('url(javascript:alert(1))'), '#888888');
  assert.equal(sanitizeListColor('expression(alert(1))'), '#888888');
  // Trailing CSS smuggling: anchored regex (^...$) rejects it
  assert.equal(sanitizeListColor('#fff;background:red'), '#888888');
});

test('sanitizeListColor: empty / nullish / non-strings fall back to default', () => {
  const { sanitizeListColor } = loadFns('2026-04-27');
  assert.equal(sanitizeListColor(''), '#888888');
  assert.equal(sanitizeListColor(null), '#888888');
  assert.equal(sanitizeListColor(undefined), '#888888');
  assert.equal(sanitizeListColor(0xff), '#888888');  // number 255 stringifies to "255", no match
});

test('completionDateKey: ISO date prefix returned verbatim (10 chars)', () => {
  const { completionDateKey } = loadFns('2026-04-27');
  assert.equal(completionDateKey('2026-04-25T13:14:15'), '2026-04-25');
  assert.equal(completionDateKey('2026-12-31'), '2026-12-31');
});

test('completionDateKey: legacy HH:MM is treated as today (back-compat)', () => {
  const { completionDateKey } = loadFns('2026-04-27');
  assert.equal(completionDateKey('14:30'), '2026-04-27');
  assert.equal(completionDateKey('9:05'), '2026-04-27');
});

test('completionDateKey: empty / unrecognized formats return null', () => {
  const { completionDateKey } = loadFns('2026-04-27');
  assert.equal(completionDateKey(''), null);
  assert.equal(completionDateKey(null), null);
  assert.equal(completionDateKey(undefined), null);
  assert.equal(completionDateKey('garbage'), null);
  assert.equal(completionDateKey('2026/04/25'), null);  // wrong separator
});
