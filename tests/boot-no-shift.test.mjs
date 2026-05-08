/**
 * Static contract guards on the boot sequence. Pre-fix, every top-level
 * data-tab panel rendered visible during first paint; then app.js:529 ran
 * el.hidden = !(el.dataset.tab===activeTab) and four of five panels collapsed
 * — the visible page snapped shorter and content jumped upwards. The fix
 * adds `hidden` to every non-default panel statically so first paint matches
 * the post-JS layout for the default tab.
 *
 * If a future edit drops the `hidden` attribute or adds a new top-level
 * panel without `hidden`, this test fails before the regression ships.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

/** Match the *opening tag* of every element bearing data-tab="<value>". */
function tagsForTab(tab){
  const re = new RegExp('<[^>]*\\bdata-tab="' + tab + '"[^>]*>', 'g');
  return html.match(re) || [];
}

test('top-level non-default panels start hidden', () => {
  // The default activeTab when no saved state exists is "tasks" (see
  // js/storage.js — VALID_MAIN_TABS list and the activeTab default).
  // Every other top-level panel must carry the `hidden` attribute so the
  // first paint already matches what app.js will set on line 529.
  for (const tab of ['tools', 'settings']) {
    const tags = tagsForTab(tab);
    assert.ok(tags.length >= 1, `expected at least one data-tab="${tab}" element`);
    for (const t of tags) {
      assert.match(t, /\bhidden\b/, `panel data-tab="${tab}" must start hidden — found: ${t}`);
    }
  }
});

test('all data-tab="data" sections start hidden', () => {
  const tags = tagsForTab('data');
  assert.ok(tags.length >= 4, 'expected ≥4 data sub-sections (stats/log/archive/export)');
  for (const t of tags) {
    assert.match(t, /\bhidden\b/, `data section must start hidden — found: ${t}`);
  }
});

test('focus subnav + active timer-sub start hidden', () => {
  // The focus tab has a subnav element + four sub-panels. Pre-fix the subnav
  // and the pomo sub-panel rendered visible during boot. Now every focus
  // element must start hidden; setTimerSub() flips the right one on after
  // app.js applies activeTab.
  const tags = tagsForTab('focus');
  assert.ok(tags.length >= 5, 'expected subnav + 4 timer-sub panels');
  for (const t of tags) {
    assert.match(t, /\bhidden\b/, `focus element must start hidden — found: ${t}`);
  }
});

test('default tasks panel does NOT start hidden', () => {
  // The first-paint visible panel must remain `tasks` so the user sees
  // content immediately when they open the app with default state.
  const tags = tagsForTab('tasks');
  assert.ok(tags.length >= 1, 'tasks panel not found');
  for (const t of tags) {
    assert.doesNotMatch(t, /\bhidden\b/, `tasks panel must not be hidden by default — found: ${t}`);
  }
});

test('app.js still drives runtime tab visibility via the hidden attribute', () => {
  // Defense: the static `hidden` attrs only fix first paint. Runtime tab
  // switches still rely on app.js setting el.hidden on every [data-tab].
  const appSrc = readFileSync(join(root, 'js', 'app.js'), 'utf8');
  assert.match(appSrc, /querySelectorAll\(['"]\[data-tab\]['"]\)\.forEach[^]+?\.hidden\s*=\s*!/, 'app.js must still toggle hidden on every [data-tab]');
});
