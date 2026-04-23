/**
 * executeClassifyTaskOp must honor op._previewCategory (forwarded from intelApplyPending)
 * without re-querying embeddings.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadExecuteClassifyTaskOp() {
  const aiSrc = readFileSync(join(root, 'js', 'ai.js'), 'utf8');
  const start = aiSrc.indexOf('async function executeClassifyTaskOp(op){');
  const end = aiSrc.indexOf('function executeIntelOp(op){', start);
  assert.ok(start >= 0 && end > start, 'slice executeClassifyTaskOp');
  const body = aiSrc.slice(start, end).replace(/\s*$/, '');
  const factory = new Function(
    'task',
    'embedCalls',
    `
    function findTask(id){ return id === task.id ? task : null; }
    const embedStore = {
      ensure: async () => { embedCalls.n++; },
      get: async () => ({ vec: new Float32Array([1,0,0]) }),
      all: async () => new Map(),
    };
    function isIntelReady(){ return true; }
    async function ensureCategoryCentroids(){ return {}; }
    function predictMetadataFromVec(){
      throw new Error('predictMetadataFromVec should not run when preview is set');
    }
    function hasClassificationCategory(id){ return id === 'jobLearningFinances'; }
    ${body}
    return executeClassifyTaskOp;
  `,
  );
  return factory;
}

test('executeClassifyTaskOp uses _previewCategory and does not call embedStore.ensure', async () => {
  const task = {
    id: 42,
    category: null,
    archived: false,
  };
  const embedCalls = { n: 0 };
  const executeClassifyTaskOp = loadExecuteClassifyTaskOp()(task, embedCalls);
  const op = {
    name: 'CLASSIFY_TASK',
    args: { id: 42 },
    _previewCategory: {
      nextCat: 'jobLearningFinances',
      beforeCat: null,
      confidence: 0.9,
    },
  };
  const r = await executeClassifyTaskOp(op);
  assert.equal(embedCalls.n, 0);
  assert.equal(r.type, 'updated');
  assert.equal(task.category, 'jobLearningFinances');
});
