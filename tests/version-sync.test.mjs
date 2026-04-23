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

test('pwa.js inline SW cache uses release swCache + -inline (same source as version.js)', () => {
  const pwa = readFileSync(join(root, 'js', 'pwa.js'), 'utf8');
  const ver = readFileSync(join(root, 'js', 'version.js'), 'utf8');
  const m = ver.match(/swCache:\s*['"]([^'"]+)['"]/);
  assert.ok(m, 'version.js should define swCache');
  assert.ok(
    pwa.includes('ODTAULAI_RELEASE') && pwa.includes('swCache') && pwa.includes('swBase') && pwa.includes('-inline'),
    'inline SW must derive CACHE from ODTAULAI_RELEASE.swCache with a -inline suffix',
  );
  assert.match(pwa, /\$\{swBase\}-inline|swBase.+-inline/);
  assert.ok(
    pwa.includes(`'${m[1]}'`) || pwa.includes(`"${m[1]}"`),
    'pwa.js string fallback when ODTAULAI_RELEASE is missing must match version.js swCache',
  );
});
