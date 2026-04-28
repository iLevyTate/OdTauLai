/**
 * Guard against drift between the canonical manifest.json and the inline
 * file:// fallback manifest constructed in js/pwa.js.
 *
 * The inline manifest exists because file:// can't reliably load relative
 * manifest assets. We can't dedupe the source, but we can fail CI when the
 * two go out of sync on the visible-to-users fields.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pwaSrc = readFileSync(join(root, 'js', 'pwa.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

function pwaInlineField(name) {
  // Match `name: 'value'` or `name: "value"` inside the inline manifest object.
  const re = new RegExp(`${name}\\s*:\\s*['"]([^'"]+)['"]`);
  const m = pwaSrc.match(re);
  return m ? m[1] : null;
}

test('pwa.js inline manifest "name" matches manifest.json', () => {
  assert.equal(pwaInlineField('name'), manifest.name);
});

test('pwa.js inline manifest "short_name" matches manifest.json', () => {
  assert.equal(pwaInlineField('short_name'), manifest.short_name);
});

test('pwa.js inline manifest "theme_color" matches manifest.json', () => {
  assert.equal(pwaInlineField('theme_color'), manifest.theme_color);
});

test('pwa.js inline manifest "background_color" matches manifest.json', () => {
  assert.equal(pwaInlineField('background_color'), manifest.background_color);
});

test('pwa.js inline manifest "display" matches manifest.json', () => {
  assert.equal(pwaInlineField('display'), manifest.display);
});

test('pwa.js inline manifest "orientation" matches manifest.json', () => {
  assert.equal(pwaInlineField('orientation'), manifest.orientation);
});
