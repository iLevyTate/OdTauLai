/**
 * SPLIT_TASK must deep-copy tags/valuesAlignment so siblings are independent (js/ai.js).
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadExecuteIntelOp() {
  const aiSrc = readFileSync(join(root, 'js', 'ai.js'), 'utf8');
  const start = aiSrc.indexOf('function executeIntelOp(op){');
  const end = aiSrc.indexOf('\nfunction _pendingStableArrJson', start);
  assert.ok(start >= 0 && end > start, 'slice executeIntelOp');
  let body = aiSrc.slice(start, end);
  body = body.replace(/\btasks\b/g, 'state.tasks').replace(/\+\+taskIdCtr/g, '++state.taskIdCtr');
  const factory = new Function(
    'state',
    `
    const activeListId = state.activeListId;
    function findTask(id){ return state.tasks.find(t => t.id === id); }
    function getTaskDescendantIds(taskId){
      const result=[],seen=new Set(),queue=[taskId];
      while(queue.length){
        const id=queue.shift();
        for(const t of state.tasks){
          if(t.parentId!==id)continue;
          const cid=t.id;
          if(seen.has(cid))continue;
          seen.add(cid);
          result.push(cid);
          queue.push(cid);
        }
      }
      return result;
    }
    function _taskIndexRegister(){}
    function _taskIndexRemove(){}
    function rebuildTaskIdIndex(){}
    function defaultTaskProps(){ return {
      status:'open',priority:'none',tags:[],dueDate:null,startDate:null,
      estimateMin:0,description:'',starred:false,completedAt:null,
      listId:activeListId,archived:false,
      recur:null,order:Date.now(),
      remindAt:null,reminderFired:false,
      type:'task',effort:null,energyLevel:null,
      blockedBy:[],checklist:[],notes:[],url:null,completionNote:null,
      category:null,valuesAlignment:[],valuesNote:null,completions:[],habitLastRecordedTotalSec:null
    }; }
    function timeNowFull(){ return 'tf'; }
    function stampCompletion(){ return 'sc'; }
    function completeHabitCycle(){}
    function timeNow(){ return 1; }
    const createTaskFromCalEventCore = undefined;
    ${body}
    return executeIntelOp;
  `,
  );
  return factory;
}

test('SPLIT_TASK: sibling tags are independent; lastModified set on source and siblings', () => {
  const state = {
    tasks: [{
      id: 1,
      name: 'Original',
      parentId: null,
      totalSec: 10,
      sessions: 2,
      created: 'old',
      collapsed: false,
      tags: ['alpha'],
      valuesAlignment: ['security'],
      completions: [{ date: 'x', sec: 1 }],
      checklist: [{ id: 1, text: 'c', done: true }],
      notes: [{ id: 1, text: 'n' }],
      blockedBy: [9],
      lastModified: null,
      _ext: { calFeedId: 'f', calEventUid: 'e', other: 1 },
      status: 'open',
      priority: 'none',
      dueDate: null,
      startDate: null,
      estimateMin: 0,
      description: '',
      starred: false,
      completedAt: null,
      listId: 1,
      archived: false,
      recur: null,
      order: 1,
      remindAt: null,
      reminderFired: false,
      type: 'task',
      effort: null,
      energyLevel: null,
      category: null,
      valuesNote: null,
      habitLastRecordedTotalSec: null,
      url: null,
      completionNote: null,
    }],
    taskIdCtr: 1,
    activeListId: 1,
  };
  const executeIntelOp = loadExecuteIntelOp()(state);
  const beforeMod = Date.now() - 60_000;
  state.tasks[0].lastModified = beforeMod;

  const r = executeIntelOp({
    name: 'SPLIT_TASK',
    args: {
      id: 1,
      parts: [{ name: 'First' }, { name: 'Second' }, { name: 'Third' }],
    },
  });
  assert.equal(r.type, 'batch');
  assert.equal(state.tasks.length, 3);
  const src = state.tasks.find((t) => t.id === 1);
  const s2 = state.tasks.find((t) => t.id === 2);
  const s3 = state.tasks.find((t) => t.id === 3);
  assert.ok(src && s2 && s3);
  assert.equal(src.name, 'First');
  assert.ok(typeof src.lastModified === 'number' && src.lastModified >= beforeMod);
  s2.tags.push('mut');
  assert.deepEqual(src.tags, ['alpha']);
  assert.deepEqual(s3.tags, ['alpha']);
  assert.equal(s2.completions.length, 0);
  assert.equal(src.completions.length, 1);
  assert.deepEqual(s2._ext, { other: 1 });
  assert.ok(typeof s2.lastModified === 'number');
});
