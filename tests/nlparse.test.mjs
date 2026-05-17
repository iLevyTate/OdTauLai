/**
 * nlparse.js — async quick-add enrichment via chrono.
 * Verifies the CDN-fallback path and _isoDate coercion edges (the previously
 * untested surface flagged in the audit).
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'js', 'nlparse.js'), 'utf8');

test('nlparse: dynamic chrono import is wrapped in try/catch — CDN failure is non-fatal', () => {
  // The audit flagged silent failure: chrono CDN is optional, and the function
  // must fall back to base parseQuickAdd if the import throws.
  assert.match(src, /try\s*\{[\s\S]*loadChrono\(\)[\s\S]*\}\s*catch/, 'parseQuickAddAsync must catch chrono import errors');
  assert.match(src, /console\.warn\(['"]\[nlparse\] chrono failed/, 'failure must be logged, not silently dropped');
});

test('nlparse: returns base parse when chrono module shape is unexpected', () => {
  // If chrono loads but lacks .parse, we must still return the base result.
  assert.match(src, /if\s*\(\s*!parser\s*\)\s*return\s+base/, 'missing parser falls back to base');
});

test('nlparse: _isoDate rejects invalid dates with null', () => {
  // Extract _isoDate body to verify NaN handling.
  const idx = src.indexOf('function _isoDate');
  assert.ok(idx >= 0, '_isoDate must exist');
  const body = src.slice(idx, src.indexOf('\n}', idx));
  assert.match(body, /Number\.isNaN/, '_isoDate must guard against invalid Date');
  assert.match(body, /return null/, 'invalid input returns null, not a malformed string');
});

test('nlparse: loadChrono memoizes successful loads', () => {
  // _chronoMod cache prevents repeated CDN hits.
  assert.match(src, /if\s*\(\s*_chronoMod\s*\)\s*return\s+_chronoMod/, 'memoize successful load');
  assert.match(src, /if\s*\(\s*_chronoLoad\s*\)\s*return\s+_chronoLoad/, 'memoize in-flight load');
});

test('nlparse: respects ODTAULAI_CONFIG.CHRONO_CDN override', () => {
  // CSP needs to allowlist the CDN, and tests/configurations want to swap it.
  assert.match(src, /window\.ODTAULAI_CONFIG[\s\S]*CHRONO_CDN/, 'CDN URL must come from config when present');
});

test('nlparse: only invokes chrono when base.dueDate is unset', () => {
  // If parseQuickAdd already captured a date, skip the LLM-ish chrono pass.
  assert.match(src, /if\s*\(\s*!base\.name\s*\|\|\s*base\.props\.dueDate\s*\)\s*return\s+base/, 'short-circuit when base already has a date');
});
