/**
 * js/intel.js and js/embed-store.js must agree on the embedding schema version
 * so IndexedDB migration clears stale vectors and Schwartz caches.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('INTEL_EMBED_MODEL_VER matches embed-store EMBED_SCHEMA_VER', () => {
  const intel = readFileSync(join(root, 'js', 'intel.js'), 'utf8');
  const store = readFileSync(join(root, 'js', 'embed-store.js'), 'utf8');
  const m1 = intel.match(/const EMBED_MODEL_VER\s*=\s*['"]([^'"]+)['"]/);
  const m2 = store.match(/const EMBED_SCHEMA_VER\s*=\s*['"]([^'"]+)['"]/);
  assert.ok(m1, 'expected INTEL_EMBED_MODEL_VER in intel.js');
  assert.ok(m2, 'expected EMBED_SCHEMA_VER in embed-store.js');
  assert.equal(m1[1], m2[1], 'embedding version strings must match for migration');
});

test('SCHWARTZ_MODEL_VER matches EMBED_SCHEMA_VER in embed-store', () => {
  const store = readFileSync(join(root, 'js', 'embed-store.js'), 'utf8');
  const sch = store.match(/const SCHWARTZ_MODEL_VER\s*=\s*['"]([^'"]+)['"]/);
  const emb = store.match(/const EMBED_SCHEMA_VER\s*=\s*['"]([^'"]+)['"]/);
  assert.ok(sch && emb, 'expected SCHWARTZ_MODEL_VER and EMBED_SCHEMA_VER');
  assert.equal(sch[1], emb[1], 'Schwartz cache should invalidate with embed upgrade');
});
