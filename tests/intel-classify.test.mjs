/**
 * predictMetadataFromVec must not auto-assign category "general" (manual bucket only).
 * predictClassifyCategory (ai.js) preview must match apply when _previewCategory is set.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadPredictClassifyCategoryFromAi(){
  const aiSrc = readFileSync(join(root, 'js', 'ai.js'), 'utf8');
  const region = /\/\/ region predictClassifyCategory-test-extract\s*([\s\S]*?)\/\/ endregion predictClassifyCategory-test-extract/;
  const m = aiSrc.match(region);
  assert.ok(m, 'ai.js must contain predictClassifyCategory test region');
  return new Function(
    'findTask',
    'embedStore',
    'isIntelReady',
    'ensureCategoryCentroids',
    'predictMetadataFromVec',
    'hasClassificationCategory',
    'console',
    `${m[1]}\nreturn predictClassifyCategory;`,
  );
}

function cosine(a, b){
  let d = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for(let i = 0; i < n; i++){
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const dn = Math.sqrt(na) * Math.sqrt(nb);
  return dn ? d / dn : 0;
}

function loadIntel(windowPatch = {}) {
  const win = {};
  const embedStore = { get: async () => null, all: async () => new Map(), setMeta: async () => {} };
  const defaultFind = (id) => {
    const t = { id, category: 'bodyMindSpirit', archived: false, tags: [] };
    if(id === 2) t.category = 'jobLearningFinances';
    if(id === 1) t.category = 'general';
    return t;
  };
  const ctx = {
    window: win,
    console,
    cfg: { categories: [] },
    tasks: [1, 2].map((id) => defaultFind(id)),
    lists: [],
    findTask: windowPatch.findTask || defaultFind,
    embedText: async () => new Float32Array(4),
    embedStore,
    isIntelReady: () => true,
    cosine,
  };
  const src = readFileSync(join(root, 'js', 'intel-features.js'), 'utf8');
  new Function(...Object.keys(ctx), src)(...Object.values(ctx));
  return win;
}

test('predictMetadataFromVec: centroid does not assign "general" even if closest to query', () => {
  const win = loadIntel();
  const e2 = (a, b) => {
    const v = new Float32Array(2);
    v[0] = a;
    v[1] = b;
    return v;
  };
  const store = new Map([
    [1, { vec: e2(0.1, 0.2), textHash: 'a' }],
  ]);
  const centroids = {
    general: e2(0.01, 0.02),
    bodyMindSpirit: e2(5, 5),
  };
  const q = e2(0.0, 0.0);
  const meta = win.predictMetadataFromVec(q, {
    store,
    k: 2,
    categoryCentroidVecs: centroids,
  });
  if(meta.category) assert.notEqual(meta.category, 'general');
});

test('predictMetadataFromVec: kNN must not return general as winning category from neighbors', () => {
  const win = loadIntel();
  const e2 = (a, b) => {
    const v = new Float32Array(2);
    v[0] = a;
    v[1] = b;
    return v;
  };
  const store = new Map([
    [1, { vec: e2(0.1, 0.2), textHash: 'a' }],
    [2, { vec: e2(0.12, 0.21), textHash: 'b' }],
  ]);
  const q = e2(0.11, 0.2);
  const meta = win.predictMetadataFromVec(q, { store, k: 2 });
  if(meta.category) assert.notEqual(meta.category, 'general');
});

test('predictClassifyCategory preview matches execute path for same embedding prediction', async () => {
  const makePredict = loadPredictClassifyCategoryFromAi();
  const task = { id: 42, name: 'Quarterly review', category: null, archived: false };
  const findTask = (id) => (id === 42 ? task : null);
  const embedStore = {
    ensure: async () => {},
    get: async () => ({ vec: new Float32Array([1, 0, 0]), textHash: 'x' }),
    all: async () => new Map(),
  };
  const predictMetadataFromVec = () => ({
    category: 'jobLearningFinances',
    _confidence: { category: { confidence: 0.82, margin: 0.2, value: 'jobLearningFinances' } },
  });
  const predictClassifyCategory = makePredict(
    findTask,
    embedStore,
    () => true,
    async () => ({}),
    predictMetadataFromVec,
    () => true,
    console,
  );
  const pred = await predictClassifyCategory(42);
  assert.ok(pred && pred.nextCat, JSON.stringify(pred));
  assert.equal(pred.nextCat, 'jobLearningFinances');
  assert.equal(pred.skip, undefined);
  const op = { name: 'CLASSIFY_TASK', args: { id: 42 }, _previewCategory: { nextCat: pred.nextCat, beforeCat: pred.beforeCat, confidence: pred.confidence } };
  task.category = null;
  const applyLike = async () => {
    const t = findTask(op.args.id);
    const pc = op._previewCategory;
    if(!pc || pc.skip) return null;
    if(pc.nextCat){
      const beforeCat = t.category;
      t.category = pc.nextCat;
      return { before: beforeCat, after: t.category };
    }
    return null;
  };
  const snap = await applyLike();
  assert.equal(snap.after, pred.nextCat);
  assert.equal(snap.before, pred.beforeCat);
});

test('predictMetadataFromVec: stale heuristic category id is dropped', () => {
  const win = loadIntel({
    findTask: () => ({ id: 1, archived: false, category: 'ghostCat', tags: [] }),
  });
  // Only bodyMindSpirit / jobLearningFinances "exist" in default hasClassificationCategory stub
  const e2 = (a, b) => {
    const v = new Float32Array(2);
    v[0] = a;
    v[1] = b;
    return v;
  };
  const meta = win.predictMetadataFromVec(e2(1, 0), {
    store: new Map([[1, { vec: e2(1, 0), textHash: 'h' }]]),
    k: 3,
    heuristic: { category: 'ghostCat' },
  });
  assert.equal(meta.category, undefined);
});
