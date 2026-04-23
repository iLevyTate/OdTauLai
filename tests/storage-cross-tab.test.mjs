/**
 * Cross-tab localStorage merge: concurrent edits when this tab is "dirty" (js/storage.js).
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('storage: dirty tab still merges when remote stateEpoch is not higher', () => {
  const src = readFileSync(join(root, 'js', 'storage.js'), 'utf8');
  const i = src.indexOf('function _onStorageFromOtherTab(');
  assert.ok(i >= 0);
  const j = src.indexOf('// ── Load — with multi-layer', i);
  assert.ok(j > i);
  const body = src.slice(i, j);
  assert.match(
    body,
    /const\s+dirty\s*=\s*!!window\._stateDirty/,
    'handler should branch on _stateDirty explicitly',
  );
  assert.doesNotMatch(
    body,
    /if\s*\(\s*re\s*<=\s*le\s*\)\s*return/,
    'must not return early on re <= le when other paths handle dirty',
  );
  assert.match(
    body,
    /if\s*\(\s*!dirty\s*&&\s*re\s*<=\s*le\s*\)\s*return/,
    'non-dirty tabs only skip when remote epoch is not newer',
  );
  assert.match(
    body,
    /if\s*\(\s*dirty\s*&&\s*re\s*<=\s*0\s*\)\s*return/,
    'without a usable remote epoch, skip merge to avoid bad ordering',
  );
  assert.match(
    body,
    /if\s*\(\s*dirty\s*\)\s*ok\s*=\s*_mergeRemoteStateLww/,
    'dirty: always LWW merge when remote has epoch',
  );
  assert.match(
    body,
    /queueAutoSave/,
    'persist merged in-memory state after a successful cross-tab apply',
  );
});
