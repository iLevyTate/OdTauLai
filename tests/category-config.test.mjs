/**
 * ensureClassificationConfig preserves focus / coreValues / examples from DEFAULT_CATEGORY_DEFS.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadIntelFeaturesMinimal() {
  const win = {};
  const embedStore = { get: async () => null, all: async () => new Map(), setMeta: async () => {} };
  const cfg = { categories: [] };
  const ctx = {
    window: win,
    console,
    cfg,
    tasks: [],
    lists: [],
    findTask: () => null,
    embedText: async () => new Float32Array(8),
    embedStore,
    isIntelReady: () => false,
    cosine: () => 0,
  };
  const src = readFileSync(join(root, 'js', 'intel-features.js'), 'utf8');
  new Function(...Object.keys(ctx), src)(...Object.values(ctx));
  return { win, cfg };
}

test('ensureClassificationConfig seeds focus, coreValues, and examples for every default row', () => {
  const { win, cfg } = loadIntelFeaturesMinimal();
  assert.equal(typeof win.ensureClassificationConfig, 'function');
  win.ensureClassificationConfig(cfg);
  assert.equal(cfg.categories.length, 7, 'seven life areas including general');
  const b = cfg.categories.find((c) => c.id === 'bodyMindSpirit');
  assert.ok(b, 'bodyMindSpirit');
  assert.ok(b.focus && b.focus.length > 4, 'focus');
  assert.ok(Array.isArray(b.coreValues) && b.coreValues.length >= 2, 'coreValues');
  assert.ok(b.coreValues[0].key && b.coreValues[0].def, 'coreValue key/def');
  assert.ok(Array.isArray(b.examples) && b.examples.length >= 1, 'examples');
  const g = cfg.categories.find((c) => c.id === 'general');
  assert.ok(g, 'general row exists as manual bucket');
});
