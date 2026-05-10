/**
 * Static contract guards on toast positioning. Pre-fix, .export-toast and
 * .action-toast were anchored `left:50%; transform:translateX(-50%)` near
 * the bottom centre — on desktop with the empty Tasks state the pill
 * landed directly over the welcome card / "+ Add your first task" button,
 * blocking taps on the central interaction column. Toasts now anchor
 * bottom-right on desktop, re-centre on mobile (≤640px) where corners
 * read as cramped, and lift above the mini-timer when it's visible.
 *
 * Modals (.modal-overlay, .cmdk-overlay, .what-next-overlay) are NOT
 * toasts and must remain centred — the negative-regression block below
 * locks that explicitly.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'css', 'main.css'), 'utf8');

/** Slice the CSS body of the first rule whose selector list starts with `selector`. */
function ruleBody(selector){
  const idx = css.indexOf(selector + '{');
  if (idx < 0) return null;
  const end = css.indexOf('}', idx);
  return end < 0 ? null : css.slice(idx, end + 1);
}

test('.export-toast anchors bottom-right at default breakpoint', () => {
  const body = ruleBody('.export-toast');
  assert.ok(body, '.export-toast rule not found');
  assert.match(body, /right:\s*calc\(/, 'must use right: calc(...) for safe-area-aware corner anchor');
  assert.match(body, /left:\s*auto/, 'must explicitly clear left so it does not centre');
  assert.doesNotMatch(body, /left:\s*50%/, 'must not anchor left:50% at default breakpoint');
  assert.doesNotMatch(body, /transform:[^;}]*translateX\(-50%\)/, 'must not translateX(-50%) at default breakpoint');
});

test('.action-toast anchors bottom-right and stacks above .export-toast', () => {
  const body = ruleBody('.action-toast');
  assert.ok(body, '.action-toast rule not found');
  assert.match(body, /right:\s*calc\(/, 'must anchor right with safe-area inset');
  assert.match(body, /left:\s*auto/, 'must clear left');
  // The action-toast carries the Undo button — it must sit above .export-toast
  // (bottom:16px) so users can reach Undo without it being occluded.
  const m = body.match(/bottom:\s*calc\(\s*(\d+)px/);
  assert.ok(m, 'action-toast must use calc(Npx + safe-area-inset-bottom)');
  assert.ok(parseInt(m[1], 10) >= 48, `action-toast bottom must be ≥48px (was ${m[1]}px) — should sit above .export-toast`);
});

test('mini-timer presence lifts both toasts above its corner', () => {
  // body:has(.mini-timer.visible) selectors must exist for both toasts so
  // the toast doesn't land behind the mini-timer pill.
  assert.match(css, /body:has\(\.mini-timer\.visible\)\s*\.export-toast\s*\{[^}]*bottom:/, 'export-toast missing mini-timer lift rule');
  assert.match(css, /body:has\(\.mini-timer\.visible\)\s*\.action-toast\s*\{[^}]*bottom:/, 'action-toast missing mini-timer lift rule');
});

test('mobile (max-width:640px) re-centres toasts horizontally', () => {
  // The corner anchor reads as cramped on a phone where the body is already
  // narrow. The mobile media query restores the centred bottom pill.
  const idx = css.indexOf('@media (max-width:640px)');
  assert.ok(idx > 0, '@media (max-width:640px) block not found');
  // Find a block that contains both toast selectors centred.
  // Walk through every max-width:640 block and check at least one has the
  // re-centring rules — simpler: regex the whole stylesheet.
  assert.match(
    css,
    /@media \(max-width:640px\)\s*\{[^]*?\.export-toast\s*\{[^}]*left:\s*50%[^}]*\}[^]*?\}/,
    'mobile breakpoint must re-centre .export-toast'
  );
  assert.match(
    css,
    /@media \(max-width:640px\)\s*\{[^]*?\.action-toast\s*\{[^}]*left:\s*50%[^}]*\}[^]*?\}/,
    'mobile breakpoint must re-centre .action-toast'
  );
});

test('modal overlays remain centred (negative regression)', () => {
  // The toast move must not have leaked into modal selectors. Modals are
  // a different surface and must keep their existing centred layout.
  for (const sel of ['.modal-overlay', '.cmdk-overlay', '.what-next-overlay']) {
    const body = ruleBody(sel);
    assert.ok(body, sel + ' rule not found');
    // Each of these overlays must still claim the full viewport (top:0;left:0;
    // right:0;bottom:0 OR inset:0) and centre their content via flex.
    const fullViewport = /(?:top:\s*0\b[^}]*left:\s*0\b)|(?:inset:\s*0\b)/;
    assert.match(body, fullViewport, sel + ' must still cover the viewport');
    assert.match(body, /justify-content:\s*center/, sel + ' must still centre horizontally');
  }
});
