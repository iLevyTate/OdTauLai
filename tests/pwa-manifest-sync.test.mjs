/**
 * Guard against drift between the canonical manifest.json and the minimal
 * file:// fallback manifest constructed in js/pwa.js.
 *
 * History: the inline manifest used to duplicate ~10 fields from
 * manifest.json — they drifted during the v48 cleanup. Audit finding M-2
 * trimmed the stub to the 5 essentials needed for file:// install
 * (name, short_name, display, theme_color, background_color); this test
 * pins those so the stub can't silently diverge from manifest.json on the
 * fields that ARE still duplicated.
 *
 * The omitted fields (description, display_override, categories,
 * orientation, etc.) intentionally live only in manifest.json — file://
 * install gets a degraded but coherent metadata set.
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

test('pwa.js inline manifest does NOT redeclare fields that drifted in v48', () => {
  // Regression guard for AUDIT.md M-2: these fields used to be duplicated
  // in the inline stub and silently drifted from manifest.json. After M-2
  // they live only in manifest.json. If someone re-adds them to the inline
  // stub, this fails so we notice before they drift again.
  const inlineStart = pwaSrc.indexOf('const manifest = {');
  const inlineEnd = pwaSrc.indexOf('};', inlineStart);
  assert.ok(inlineStart > 0 && inlineEnd > inlineStart, 'inline manifest block not found');
  const block = pwaSrc.slice(inlineStart, inlineEnd);
  for (const field of ['description', 'display_override', 'categories', 'orientation']) {
    assert.ok(
      !new RegExp(`\\b${field}\\b\\s*:`).test(block),
      `${field} should not be redeclared in the file:// stub — manifest.json is the only source`,
    );
  }
});
