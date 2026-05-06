/**
 * Theme FOUC mitigation guards.
 *
 * applyTheme() previously ran from app.js after JS parsed — light-theme
 * users saw a flash of dark on every cold load. The fix is a synchronous
 * inline <head> script that reads the saved theme out of stupind_state and
 * toggles .light-theme on <html> before paint. CSS selectors are now
 * rooted at .light-theme (not body.light-theme) so the html-class works.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css  = readFileSync(join(root, 'css', 'main.css'), 'utf8');
const ui   = readFileSync(join(root, 'js', 'ui.js'), 'utf8');

test('index.html has a pre-paint theme bootstrap script', () => {
  // The script must run before the stylesheet link. We don't need a strict
  // ordering test — proving the script exists with the right shape catches
  // regressions where someone removes it.
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /localStorage\.getItem\(['"]stupind_state['"]\)/,
    'pre-paint script must read the existing storage key');
  assert.match(head, /classList\.add\(['"]light-theme['"]\)/,
    'pre-paint script must apply light-theme class');
  assert.match(head, /document\.documentElement/,
    'pre-paint script must target documentElement (body does not exist yet)');
});

test('applyTheme toggles class on both documentElement and body', () => {
  const idx = ui.indexOf('function applyTheme(');
  assert.ok(idx > 0, 'applyTheme not found');
  const body = ui.slice(idx, idx + 600);
  assert.match(body, /documentElement\.classList\.toggle\(['"]light-theme['"]/,
    'applyTheme must toggle on documentElement so it agrees with the pre-paint class');
  assert.match(body, /body\.classList\.toggle\(['"]light-theme['"]/,
    'applyTheme must still toggle on body for legacy selectors');
});

test('CSS selectors are root-anchored, not body-anchored', () => {
  // A single `body.light-theme` would mean the pre-paint class on <html>
  // doesn't trigger that rule, defeating the FOUC fix. Allow zero matches.
  const matches = css.match(/body\.light-theme\b/g) || [];
  assert.equal(matches.length, 0,
    'no `body.light-theme` selectors should remain — use `.light-theme` so the pre-paint class on <html> matches');
});
