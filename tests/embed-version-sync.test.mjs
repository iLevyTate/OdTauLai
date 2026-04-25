/**
 * js/config.js, js/intel.js and js/embed-store.js must agree on the embedding
 * schema version so IndexedDB migration clears stale vectors and Schwartz caches.
 *
 * With the centralised config.js, the runtime values come from ODTAULAI_CONFIG.
 * The fallback strings in intel.js and embed-store.js MUST still match so that
 * the app works even if config.js fails to load (defensive fallback).
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Extract the fallback value from patterns like:
 *    const X = _C.Y || 'value'
 *    const X = 'value'
 */
function extractFallback(src, constName) {
  // Match either:  const X = '...'  or  const X = _C.Y || '...'
  const re = new RegExp(`const\\s+${constName}\\s*=\\s*(?:[^'"\n]*\\|\\|\\s*)?['"]([^'"]+)['"]`);
  return src.match(re);
}

test('INTEL_EMBED_MODEL_VER matches embed-store EMBED_SCHEMA_VER', () => {
  const intel = readFileSync(join(root, 'js', 'intel.js'), 'utf8');
  const store = readFileSync(join(root, 'js', 'embed-store.js'), 'utf8');
  const m1 = extractFallback(intel, 'EMBED_MODEL_VER');
  const m2 = extractFallback(store, 'EMBED_SCHEMA_VER');
  assert.ok(m1, 'expected EMBED_MODEL_VER in intel.js');
  assert.ok(m2, 'expected EMBED_SCHEMA_VER in embed-store.js');
  assert.equal(m1[1], m2[1], 'embedding version strings must match for migration');
});

test('SCHWARTZ_MODEL_VER matches EMBED_SCHEMA_VER in embed-store', () => {
  const store = readFileSync(join(root, 'js', 'embed-store.js'), 'utf8');
  const sch = extractFallback(store, 'SCHWARTZ_MODEL_VER');
  const emb = extractFallback(store, 'EMBED_SCHEMA_VER');
  assert.ok(sch && emb, 'expected SCHWARTZ_MODEL_VER and EMBED_SCHEMA_VER');
  assert.equal(sch[1], emb[1], 'Schwartz cache should invalidate with embed upgrade');
});

test('config.js EMBED_MODEL_VER matches intel.js fallback', () => {
  const config = readFileSync(join(root, 'js', 'config.js'), 'utf8');
  const intel = readFileSync(join(root, 'js', 'intel.js'), 'utf8');
  const cm = config.match(/EMBED_MODEL_VER\s*:\s*['"]([^'"]+)['"]/);
  const im = extractFallback(intel, 'EMBED_MODEL_VER');
  assert.ok(cm, 'expected EMBED_MODEL_VER in config.js');
  assert.ok(im, 'expected EMBED_MODEL_VER fallback in intel.js');
  assert.equal(cm[1], im[1], 'config.js and intel.js fallback must match');
});
