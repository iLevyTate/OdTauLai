/**
 * SW-update notification + cal-feed retry feedback guards.
 *
 * - sw.js used to swap caches silently; users ran stale code until a
 *   manual refresh. Now it posts on the existing odtaulai-sw-status
 *   BroadcastChannel and pwa.js shows a "New version ready / Refresh"
 *   sticky toast.
 * - retryFailedCalFeeds used `Promise.all(... .catch(()=>{}))` which
 *   gave no signal whether the retry succeeded. Now uses allSettled and
 *   re-evaluates the failed set after each round.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw  = readFileSync(join(root, 'sw.js'), 'utf8');
const pwa = readFileSync(join(root, 'js', 'pwa.js'), 'utf8');
const cal = readFileSync(join(root, 'js', 'calfeeds.js'), 'utf8');

test('sw.js activate posts sw-update-ready on the existing channel', () => {
  const idx = sw.indexOf("self.addEventListener('activate'");
  assert.ok(idx > 0, 'activate handler not found');
  const body = sw.slice(idx, idx + 1500);
  assert.match(body, /odtaulai-sw-status/, 'must reuse the precache-status channel');
  assert.match(body, /sw-update-ready/, 'must post the sw-update-ready type');
  // We only notify when stale caches existed — first install isn't an
  // "update" because there's no incumbent version to replace.
  assert.match(body, /stale\.length/, 'must guard the post on actually-swept caches');
});

test('pwa.js handles sw-update-ready with a sticky Refresh toast', () => {
  const idx = pwa.indexOf('sw-update-ready');
  assert.ok(idx > 0, 'pwa.js does not handle sw-update-ready');
  const body = pwa.slice(Math.max(0, idx - 200), idx + 1000);
  assert.match(body, /showActionToast/, 'must surface a toast');
  // ms=0 means sticky — the user must explicitly act, otherwise the toast
  // would vanish before they noticed it.
  assert.match(body, /,\s*0\s*\)/, 'toast must be sticky (ms=0)');
  // Refresh action sends SKIP_WAITING so the new SW takes over immediately.
  assert.match(body, /SKIP_WAITING/, 'Refresh must tell waiting SW to skip waiting');
  assert.match(body, /location\.reload\(\)/, 'Refresh must reload the page');
});

test('retryFailedCalFeeds reports lingering failures', () => {
  const idx = cal.indexOf('async function retryFailedCalFeeds');
  assert.ok(idx > 0, 'retryFailedCalFeeds not found');
  const body = cal.slice(idx, idx + 1500);
  assert.match(body, /Promise\.allSettled/,
    'must use allSettled so one rejection does not short-circuit others');
  assert.match(body, /still failing/i,
    'must surface a follow-up toast when feeds remain broken');
  assert.match(body, /reconnected/i,
    'must surface a success toast when all feeds recover');
});
