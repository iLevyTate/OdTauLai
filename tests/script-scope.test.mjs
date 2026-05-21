/**
 * Regression guard: classic <script> tags in index.html share one global
 * lexical scope, so a `let` or `const` with the same name in two different
 * js/*.js files throws `SyntaxError: Identifier '<name>' has already been
 * declared` at parse time — silently killing every function in the second
 * file.
 *
 * This test reproduces the browser-level collision by:
 *   1. Reading index.html and extracting the <script src="js/*.js"> load order.
 *   2. Concatenating those files into one program body.
 *   3. Parsing the body with `new Function` (same top-level scope semantics).
 *
 * A duplicate top-level `let`/`const`/`class` declaration will fail parsing
 * here the same way it does in the browser.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function getLocalScriptOrder() {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  // Match only src="js/*.js" — skip CDN scripts and inline blocks.
  const rx = /<script\s+src="(js\/[^"]+\.js)"[^>]*><\/script>/g;
  const out = [];
  let m;
  while ((m = rx.exec(html)) !== null) out.push(m[1]);
  return out;
}

test('index.html loads at least the core classic scripts', () => {
  const order = getLocalScriptOrder();
  assert.ok(order.length >= 5, `expected several js/*.js scripts, got ${order.length}`);
  assert.ok(order.includes('js/version.js'), 'version.js must be loaded');
  assert.ok(order.includes('js/ai.js'), 'ai.js must be loaded');
  assert.ok(order.includes('js/intel.js'), 'intel.js must be loaded');
});

test('classic scripts share one lexical scope without duplicate let/const/class', () => {
  const order = getLocalScriptOrder();
  const parts = [];
  for (const rel of order) {
    const src = readFileSync(join(root, rel), 'utf8');
    // Browser-shaped header so parse errors point at the offending file.
    parts.push(`\n// ==== ${rel} ====\n`, src, '\n');
  }
  const program = parts.join('');

  // `new Function(body)` evaluates body in its own outer lexical scope,
  // which mirrors the browser's script-global scope for classic scripts.
  // Any `let`/`const`/`class` collision between concatenated files throws
  // SyntaxError at construction time.
  try {
    // eslint-disable-next-line no-new-func
    new Function(program);
  } catch (err) {
    const name = err && err.name;
    const msg = err && err.message;
    // Common failure mode: "Identifier 'X' has already been declared".
    // Surface the offending identifier so the fix is obvious.
    const dup = msg && msg.match(/Identifier ['"]([^'"]+)['"] has already been declared/);
    if (dup) {
      assert.fail(
        `Duplicate top-level declaration across classic scripts: '${dup[1]}'. ` +
        `Two of ${order.join(', ')} declare '${dup[1]}' with let/const/class at ` +
        `the top level — rename one of them to avoid the browser-level collision.`
      );
    }
    assert.fail(`Parse error across concatenated scripts: ${name}: ${msg}`);
  }
});
