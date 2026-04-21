import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('sw.js CACHE_NAME matches version.js swCache', () => {
  const ver = readFileSync(join(root, 'js', 'version.js'), 'utf8');
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const m = ver.match(/swCache:\s*['"]([^'"]+)['"]/);
  assert.ok(m, 'version.js should define swCache');
  assert.match(sw, new RegExp(m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'sw.js CACHE_NAME must match version.js swCache');
});

test('pwa.js inline fallback cache matches version family', () => {
  const ver = readFileSync(join(root, 'js', 'version.js'), 'utf8');
  const pwa = readFileSync(join(root, 'js', 'pwa.js'), 'utf8');
  const m = ver.match(/swCache:\s*['"]([^'"]+)['"]/);
  assert.ok(m);
  assert.ok(pwa.includes(m[1] + '-inline'), 'pwa.js should use swCache + "-inline"');
});
