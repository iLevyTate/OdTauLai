// ========== AMBIENT INTELLIGENCE (embeddings + rules — no generative LLM) ==========
// Preview/undo, Schwartz values UI, smart-add chips. Task mutations via executeIntelOp.

const INTEL_CFG_KEY = 'stupind_intel_cfg';

// LIFE_CATS, CAT_ICON, SCHWARTZ, VALUE_KEYS — globals from intel-features.js

let _cfg = null;
let _pendingOps = [];
let _undoStack = [];
let _intelBusy = false;

function _loadCfg(){
  try{ _cfg = JSON.parse(localStorage.getItem(INTEL_CFG_KEY) || '{}'); }
  catch(e){ _cfg = {}; }
  _cfg.dominant = Array.isArray(_cfg.dominant) ? _cfg.dominant : [];
  return _cfg;
}
function _saveCfg(){ try{ localStorage.setItem(INTEL_CFG_KEY, JSON.stringify(_cfg)); }catch(e){} }

/** Header pill: model load / ready / error — visible on every tab */
function syncHeaderAIChip(state, msg){
  const chip = document.getElementById('headerAIChip');
  if(!chip) return;
  chip.classList.remove('ai-chip--idle','ai-chip--syncing','ai-chip--ok','ai-chip--err');
  let cls = 'ai-chip--idle';
  if(state === 'loading' || state === 'working' || state === 'syncing') cls = 'ai-chip--syncing';
  else if(state === 'ready' || state === 'ok') cls = 'ai-chip--ok';
  else if(state === 'error') cls = 'ai-chip--err';
  chip.classList.add(cls);
  const busy = state === 'loading' || state === 'working' || state === 'syncing';
  chip.setAttribute('aria-busy', busy ? 'true' : 'false');
  const label = chip.querySelector('.ai-chip-label');
  if(label){
    if(state === 'loading' || state === 'working' || state === 'syncing'){
      const m = (msg || '').trim();
      const pct = m.match(/^(\d+)%/);
      label.textContent = pct ? pct[1] + '%' : '…';
    }else if(state === 'ready' || state === 'ok') label.textContent = '✓';
    else if(state === 'error') label.textContent = '!';
    else label.textContent = 'AI';
  }
  let desc = 'Task understanding (on-device)';
  if(state === 'loading' || state === 'working' || state === 'syncing'){
    const m = (msg || '').trim();
    desc = m ? 'Loading model: ' + m.slice(0, 100) : 'Loading model…';
  }else if(state === 'ready' || state === 'ok'){
    desc = (msg && String(msg).trim()) ? String(msg).slice(0, 120) : 'Embeddings ready';
  }else if(state === 'error'){
    desc = (msg && String(msg).trim()) ? String(msg).slice(0, 100) + '. Tap to retry.' : 'Model load failed. Tap to retry.';
  }
  chip.setAttribute('aria-label', desc);
  const live = document.getElementById('aiChipLive');
  if(live) live.textContent = desc;
  if(state === 'error'){
    chip.title = (msg && String(msg).trim()) ? String(msg).slice(0, 72) + ' — tap to retry' : 'Model load failed — tap to retry';
  }else if(busy){
    chip.title = (msg && String(msg).length < 80) ? String(msg) : 'Loading embedding model…';
  }else if(state === 'ready' || state === 'ok'){
    chip.title = (msg && String(msg).length < 80) ? String(msg) : 'Task understanding — open Tools';
  }else{
    chip.title = 'Task understanding (on-device) — open Tools';
  }
}

/** Semantic search checkbox: disabled until embeddings are ready (avoids silent no-op). */
function syncSemanticSearchUi(){
  const cb = document.getElementById('taskSearchSemantic');
  const lab = cb && cb.closest('.task-search-semantic');
  if(!cb) return;
  const ready = typeof isIntelReady === 'function' && isIntelReady();
  if(!ready){
    const hadChecked = cb.checked;
    cb.disabled = true;
    cb.checked = false;
    window._taskSearchSemantic = false;
    if(hadChecked) window._semanticScores = null;
    if(lab){
      lab.title = 'Load the embedding model first (header AI chip or Tools tab)';
      lab.classList.add('task-search-semantic--disabled');
    }
    if(hadChecked && typeof updateTaskFilters === 'function') updateTaskFilters();
  }else{
    cb.disabled = false;
    if(lab){
      lab.title = 'Rank by meaning (requires model loaded)';
      lab.classList.remove('task-search-semantic--disabled');
    }
  }
}

function headerAIClick(){
  const chip = document.getElementById('headerAIChip');
  if(chip && chip.classList.contains('ai-chip--err') && typeof intelRetryLoad === 'function'){
    intelRetryLoad();
    return;
  }
  if(typeof showTab === 'function') showTab('tools');
}

// ══════════════════════════════════════════════════════════════════════════════
// TASK MUTATIONS (used by pending ops + duplicate merge)
// ══════════════════════════════════════════════════════════════════════════════
function executeIntelOp(op){
  const a = op.args;
  let snap = null;
  switch(op.name){
    case 'CREATE_TASK':{
      const id = ++taskIdCtr;
      const nt = Object.assign({
        id, name: String(a.name || 'Untitled'),
        totalSec: 0, sessions: 0, created: timeNowFull(),
        parentId: a.parentId || null, collapsed: false,
      }, defaultTaskProps(), {
        priority: a.priority || 'none',
        category: a.category || null,
        dueDate: a.dueDate || null,
        description: a.description || '',
        tags: a.tags ? String(a.tags).split(',').map(s => s.trim()).filter(Boolean) : [],
        effort: a.effort || null,
        type: a.type || 'task',
        listId: a.listId || activeListId,
      });
      tasks.push(nt);
      snap = { type: 'created', id };
      break;
    }
    case 'UPDATE_TASK':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { ...t } };
      const allow = ['name','priority','status','dueDate','startDate','effort','energyLevel','context','category','description','url','estimateMin','starred','type','valuesAlignment','valuesNote','tags'];
      allow.forEach(f => { if(a[f] !== undefined) t[f] = a[f]; });
      if(t.status === 'done' && !t.completedAt) t.completedAt = timeNow();
      if(t.status !== 'done') t.completedAt = null;
      break;
    }
    case 'MARK_DONE':{
      const t = findTask(a.id); if(!t) return null;
      const beforeLen = tasks.length;
      snap = { type: 'updated', id: t.id, before: { ...t } };
      t.status = 'done'; t.completedAt = timeNow();
      if(a.completionNote) t.completionNote = String(a.completionNote);
      if(t.recur){
        spawnRecurringClone(t);
        if(tasks.length > beforeLen){
          const cloneId = tasks[tasks.length - 1].id;
          snap = { type: 'batch', snaps: [
            { type: 'updated', id: t.id, before: snap.before },
            { type: 'created', id: cloneId },
          ] };
        }
      }
      break;
    }
    case 'REOPEN':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { ...t } };
      t.status = 'open'; t.completedAt = null;
      break;
    }
    case 'TOGGLE_STAR':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { ...t } };
      t.starred = !t.starred;
      break;
    }
    case 'ARCHIVE_TASK':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { ...t } };
      t.archived = true;
      getTaskDescendantIds(t.id).forEach(did => { const d = findTask(did); if(d) d.archived = true; });
      break;
    }
    case 'RESTORE_TASK':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { ...t } };
      t.archived = false;
      getTaskDescendantIds(t.id).forEach(did => { const d = findTask(did); if(d) d.archived = false; });
      break;
    }
    case 'DELETE_TASK':{
      const t = findTask(a.id); if(!t || !t.archived) return null;
      snap = { type: 'deleted', before: { ...t } };
      const desc = getTaskDescendantIds(t.id);
      tasks = tasks.filter(x => x.id !== t.id && !desc.includes(x.id));
      break;
    }
    case 'DUPLICATE_TASK':{
      const src = findTask(a.id); if(!src) return null;
      const id = ++taskIdCtr;
      tasks.push(Object.assign({}, src, {
        id, name: src.name + ' (copy)',
        totalSec: 0, sessions: 0, created: timeNowFull(),
        completedAt: null, status: 'open', archived: false,
        tags: [...(src.tags || [])], blockedBy: [],
        checklist: (src.checklist || []).map(c => ({ ...c, done: false, doneAt: null })),
        notes: [],
      }));
      snap = { type: 'created', id };
      break;
    }
    case 'MOVE_TASK':{
      const t = findTask(a.id); if(!t) return null;
      if(a.newParentId && getTaskDescendantIds(t.id).includes(a.newParentId)) return null;
      snap = { type: 'updated', id: t.id, before: { ...t } };
      t.parentId = a.newParentId || null;
      break;
    }
    case 'CHANGE_LIST':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { ...t } };
      t.listId = a.listId;
      break;
    }
    case 'ADD_NOTE':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { notes: [...(t.notes || [])] } };
      if(!t.notes) t.notes = [];
      t.notes.unshift({ id: Date.now() + Math.random(), text: '[Intel] ' + String(a.text || ''), createdAt: timeNow() });
      break;
    }
    case 'ADD_CHECKLIST':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { checklist: [...(t.checklist || [])] } };
      if(!t.checklist) t.checklist = [];
      t.checklist.push({ id: Date.now() + Math.random(), text: String(a.text || ''), done: false, doneAt: null });
      break;
    }
    case 'TOGGLE_CHECK':{
      const t = findTask(a.id); if(!t) return null;
      const it = (t.checklist || []).find(c => c.id === a.checkId);
      if(!it) return null;
      snap = { type: 'updated', id: t.id, before: { checklist: JSON.parse(JSON.stringify(t.checklist)) } };
      it.done = !it.done;
      it.doneAt = it.done ? timeNow() : null;
      break;
    }
    case 'REMOVE_CHECK':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { checklist: [...(t.checklist || [])] } };
      t.checklist = (t.checklist || []).filter(c => c.id !== a.checkId);
      break;
    }
    case 'ADD_TAG':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { tags: [...(t.tags || [])] } };
      if(!t.tags) t.tags = [];
      const tag = String(a.tag || '').trim();
      if(tag && !t.tags.includes(tag)) t.tags.push(tag);
      break;
    }
    case 'REMOVE_TAG':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { tags: [...(t.tags || [])] } };
      t.tags = (t.tags || []).filter(x => x !== a.tag);
      break;
    }
    case 'ADD_BLOCKER':{
      const t = findTask(a.id); if(!t || a.blockerId === a.id) return null;
      snap = { type: 'updated', id: t.id, before: { blockedBy: [...(t.blockedBy || [])] } };
      if(!t.blockedBy) t.blockedBy = [];
      if(!t.blockedBy.includes(a.blockerId)) t.blockedBy.push(a.blockerId);
      break;
    }
    case 'REMOVE_BLOCKER':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { blockedBy: [...(t.blockedBy || [])] } };
      t.blockedBy = (t.blockedBy || []).filter(x => x !== a.blockerId);
      break;
    }
    case 'SET_REMINDER':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { ...t } };
      t.remindAt = a.remindAt || null;
      t.reminderFired = false;
      break;
    }
    case 'SET_RECUR':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { ...t } };
      t.recur = a.recur || null;
      break;
    }
    default: return null;
  }
  return snap;
}

function _describeOp(op){
  const a = op.args;
  const t = a.id ? findTask(a.id) : null;
  const nm = t ? `"${t.name.slice(0,40)}"` : (a.name ? `"${String(a.name).slice(0,40)}"` : '');
  switch(op.name){
    case 'CREATE_TASK': return `Create ${nm}` + _flds(a, ['priority','category','dueDate','effort']);
    case 'UPDATE_TASK': return `✎ Update ${nm}` + _chgs(t, a);
    case 'MARK_DONE': return `✓ Done: ${nm}` + (a.completionNote ? ` — "${String(a.completionNote).slice(0,40)}"` : '');
    case 'REOPEN': return `↻ Reopen: ${nm}`;
    case 'TOGGLE_STAR': return `${t?.starred ? '☆ Unstar' : '★ Star'}: ${nm}`;
    case 'ARCHIVE_TASK': return `Archive: ${nm}`;
    case 'RESTORE_TASK': return `♻ Restore: ${nm}`;
    case 'DELETE_TASK': return `DELETE FOREVER: ${nm}`;
    case 'DUPLICATE_TASK': return `⎘ Duplicate: ${nm}`;
    case 'MOVE_TASK': return `↱ Move ${nm} → parent #${a.newParentId || '(top)'}`;
    case 'CHANGE_LIST': { const l = lists.find(x => x.id === a.listId); return `↦ Move ${nm} → "${l?.name || '#' + a.listId}"`; }
    case 'ADD_NOTE': return `📝 Note on ${nm}: "${String(a.text || '').slice(0,50)}"`;
    case 'ADD_CHECKLIST': return `☐ Checklist on ${nm}: "${String(a.text || '').slice(0,50)}"`;
    case 'TOGGLE_CHECK': return `☑ Toggle check #${a.checkId} on ${nm}`;
    case 'REMOVE_CHECK': return `✕ Remove check #${a.checkId} from ${nm}`;
    case 'ADD_TAG': return `🏷 +tag "${a.tag}" on ${nm}`;
    case 'REMOVE_TAG': return `✕ -tag "${a.tag}" from ${nm}`;
    case 'ADD_BLOCKER': { const b = findTask(a.blockerId); return `🚫 Block ${nm} by "${b?.name.slice(0,30) || '#' + a.blockerId}"`; }
    case 'REMOVE_BLOCKER': return `✓ Unblock ${nm} from #${a.blockerId}`;
    case 'SET_REMINDER': return `⏰ Remind ${nm}: ${a.remindAt}`;
    case 'SET_RECUR': return a.recur ? `↻ ${a.recur} recurrence on ${nm}` : `✕ Clear recurrence on ${nm}`;
    default: return op.name + '(...)';
  }
}
function _flds(a, keys){
  const p = keys.filter(k => a[k] != null).map(k => `${k}=${a[k]}`);
  return p.length ? ` [${p.join(', ')}]` : '';
}
function _chgs(t, a){
  if(!t) return ' (task not found)';
  const skip = new Set(['id']);
  const d = [];
  Object.entries(a).forEach(([k, v]) => {
    if(skip.has(k)) return;
    const o = t[k];
    if(o !== v){
      const os = o == null ? '∅' : String(o).slice(0, 40);
      const ns = v == null ? '∅' : String(v).slice(0, 40);
      d.push(`${k}: ${os}→${ns}`);
    }
  });
  return d.length ? ' — ' + d.join(', ') : ' (no change)';
}

function _pushUndo(label, snaps){
  _undoStack.unshift({ timestamp: Date.now(), label, snapshots: snaps });
  if(_undoStack.length > 10) _undoStack.pop();
}

function aiUndo(){
  const b = _undoStack.shift();
  if(!b){ _setIntelStatus('idle', 'Nothing to undo'); _renderUndoBtn(); return; }
  const flat = [];
  b.snapshots.forEach(s => {
    if(s.type === 'batch' && Array.isArray(s.snaps)) flat.push(...s.snaps);
    else flat.push(s);
  });
  flat.forEach(s => {
    if(s.type === 'created') tasks = tasks.filter(t => t.id !== s.id);
    else if(s.type === 'updated'){ const t = findTask(s.id); if(t) Object.assign(t, s.before); }
    else if(s.type === 'deleted') tasks.push(s.before);
  });
  saveState('user');
  if(typeof renderTaskList === 'function') renderTaskList();
  _renderUndoBtn();
  _setIntelStatus('ready', `↩ Reverted ${flat.length} change${flat.length !== 1 ? 's' : ''}`);
}

function _intelIc(paths){
  return '<svg class="intel-action-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
}
const _IC = {
  bolt: _intelIc('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>'),
  harmonize: _intelIc('<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/>'),
  folder: _intelIc('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  duplicate: _intelIc('<rect x="8" y="8" width="13" height="13" rx="2" ry="2"/><path d="M4 16H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1"/>'),
  refresh: _intelIc('<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/>'),
  undo: _intelIc('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
  search: _intelIc('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  spark: _intelIc('<path d="M12 3c.5 2.5 2 4 4.5 4.5-2.5.5-4 2-4.5 4.5-.5-2.5-2-4-4.5-4.5 2.5-.5 4-2 4.5-4.5z"/>'),
};

function _renderUndoBtn(){
  const btn = document.getElementById('intelUndoBtn');
  if(!btn) return;
  btn.style.display = _undoStack.length ? '' : 'none';
  btn.innerHTML = _IC.undo + '<span>Undo (' + _undoStack.length + ')</span>';
}

function _renderPendingOps(){
  const wrap = document.getElementById('intelPendingOps');
  if(!wrap) return;
  if(!_pendingOps.length){ wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const rows = _pendingOps.map((op, i) => {
    const desc = _describeOp(op);
    const danger = op.name === 'DELETE_TASK';
    return `<label class="pending-op-row ${danger ? 'pending-danger' : ''}">
      <input type="checkbox" class="pending-op-check" data-idx="${i}" checked>
      <span class="pending-op-desc">${esc(desc)}</span>
    </label>`;
  }).join('');
  wrap.innerHTML = `
    <div class="pending-hdr">
      <span class="pending-title">Proposed Changes (${_pendingOps.length})</span>
      <button class="pending-toggle-all" onclick="intelToggleAllPending()">Toggle all</button>
    </div>
    <div class="pending-list">${rows}</div>
    <div class="pending-actions">
      <button class="btn-ghost btn-sm" onclick="intelRejectPending()">✕ Reject All</button>
      <button class="btn-primary" onclick="intelApplyPending()">✓ Apply Selected</button>
    </div>`;
  _setIntelStatus('idle', 'Review proposed changes below');
}

function intelToggleAllPending(){
  const cs = document.querySelectorAll('#intelPendingOps .pending-op-check');
  const all = [...cs].every(c => c.checked);
  cs.forEach(c => { c.checked = !all; });
}

function intelRejectPending(){
  _pendingOps = [];
  _renderPendingOps();
  _setIntelStatus('ready', 'Ready');
}

function intelApplyPending(){
  const cs = [...document.querySelectorAll('#intelPendingOps .pending-op-check')];
  const sel = cs.filter(c => c.checked).map(c => _pendingOps[parseInt(c.dataset.idx, 10)]);
  if(!sel.length){ intelRejectPending(); return; }

  const snaps = [];
  let applied = 0;
  const failures = [];
  sel.forEach(op => {
    try{
      const s = executeIntelOp(op);
      if(s){ snaps.push(s); applied++; }
      else {
        let reason = 'unknown';
        if(op.args.id && !findTask(op.args.id)) reason = `task #${op.args.id} not found`;
        else if(op.name === 'DELETE_TASK' && op.args.id){
          const t = findTask(op.args.id);
          if(t && !t.archived) reason = 'task must be archived before permanent delete';
        }
        failures.push(`${op.name}: ${reason}`);
      }
    }catch(e){
      failures.push(`${op.name}: ${(e.message || 'error').slice(0, 50)}`);
    }
  });

  if(snaps.length){
    _pushUndo(`${applied} change${applied !== 1 ? 's' : ''}`, snaps);
    saveState('user');
    if(typeof renderTaskList === 'function') renderTaskList();
    if(typeof renderBanner === 'function') renderBanner();
    if(typeof renderLists === 'function') renderLists();
    _renderUndoBtn();
    const changedIds = new Set();
    snaps.forEach(s => {
      if(s.type === 'batch' && Array.isArray(s.snaps)) s.snaps.forEach(x => x.id && changedIds.add(x.id));
      else if(s.id) changedIds.add(s.id);
    });
    setTimeout(() => {
      changedIds.forEach(id => {
        const row = document.querySelector('.task-item[data-task-id="' + id + '"]');
        if(row){
          row.classList.add('intel-modified');
          setTimeout(() => row.classList.remove('intel-modified'), 1500);
        }
      });
    }, 50);
  }

  _pendingOps = [];
  _renderPendingOps();
  _setIntelStatus('ready', failures.length ? `Applied ${applied}, ${failures.length} failed` : `✓ Applied ${applied}`);
}

function _setIntelStateClass(el, state){
  el.className = 'intel-status intel-status-chip intel-status--' + (
    state === 'ready' ? 'ok' : state === 'error' ? 'error' :
      state === 'working' ? 'syncing' : state === 'loading' ? 'syncing' : 'idle');
}

function _setIntelStatus(state, msg){
  const el = document.getElementById('intelStatus');
  if(el){
    el.textContent = msg;
    _setIntelStateClass(el, state);
  }
  syncHeaderAIChip(state, msg);
}

async function aiAlign(){
  if(typeof isIntelReady !== 'function' || !isIntelReady()){
    _setIntelStatus('error', 'Load the model first (AI chip or Tools)');
    return;
  }
  if(_intelBusy){ _setIntelStatus('error', 'Busy — try again'); return; }
  _loadCfg();
  if(_cfg.dominant.length < 2){ _setIntelStatus('error', 'Pick 2–3 values first'); return; }
  _intelBusy = true;
  _setIntelStatus('working', 'Aligning…');

  try{
    await ensureSchwartzEmbeddings();
    const active = tasks.filter(t => !t.archived && t.status !== 'done').slice(0, 200);
    const ops = [];
    for(const t of active){
      const vals = await alignValuesForTask(t.id);
      if(!vals.length) continue;
      const filtered = vals.filter(v => _cfg.dominant.includes(v));
      const use = filtered.length ? filtered : vals.slice(0, 2);
      if(!use.length) continue;
      const before = JSON.stringify([...(t.valuesAlignment || [])].map(String).sort());
      const after = JSON.stringify([...use].map(String).sort());
      if(before === after) continue;
      ops.push({
        name: 'UPDATE_TASK',
        args: {
          id: t.id,
          valuesAlignment: use,
          valuesNote: 'Cosine similarity vs Schwartz value descriptions',
        },
      });
    }
    if(!ops.length){
      _setIntelStatus('ready', 'No alignment suggestions');
      return;
    }
    _pendingOps = ops;
    _renderPendingOps();
    _setIntelStatus('ready', `Review ${ops.length} proposed updates`);
  }catch(err){
    console.warn('[aiAlign]', err);
    _setIntelStatus('error', (err.message || String(err)).slice(0, 80));
  }finally{
    _intelBusy = false;
  }
}

function aiToggleValue(key){
  _loadCfg();
  const i = _cfg.dominant.indexOf(key);
  if(i >= 0) _cfg.dominant.splice(i, 1);
  else {
    if(_cfg.dominant.length >= 3){ _setIntelStatus('error', 'Max 3'); return; }
    _cfg.dominant.push(key);
  }
  _saveCfg();
  _renderValuesGrid();
}

function _renderBreakdown(){
  const el = document.getElementById('intelBreakdown');
  if(!el) return;
  const a = tasks.filter(t => t.status !== 'done' && !t.archived && t.category);
  const by = {};
  a.forEach(t => {
    if(!by[t.category]) by[t.category] = { count: 0, urgent: 0, high: 0 };
    by[t.category].count++;
    if(t.priority === 'urgent') by[t.category].urgent++;
    if(t.priority === 'high') by[t.category].high++;
  });
  const rows = Object.entries(by).sort((x, y) => y[1].count - x[1].count).map(([c, s]) => `
    <div class="breakdown-row">
      <span class="breakdown-cat"><span class="breakdown-cat-ic">${(window.icon && window.icon(CAT_ICON[c] || 'pin', {size:14})) || ''}</span> ${c}</span>
      <span class="breakdown-count">${s.count}</span>
      ${s.urgent ? `<span class="breakdown-badge urgent">${s.urgent}!</span>` : ''}
      ${s.high ? `<span class="breakdown-badge high">${s.high}↑</span>` : ''}
    </div>`).join('');
  el.innerHTML = rows || '<span style="color:var(--text-3);font-size:12px">Run alignment to see</span>';
}

function _renderValuesGrid(){
  const el = document.getElementById('intelValuesGrid');
  if(!el) return;
  _loadCfg();
  el.innerHTML = VALUE_KEYS.map(key => {
    const v = SCHWARTZ[key];
    const sel = _cfg.dominant.includes(key);
    const rank = sel ? _cfg.dominant.indexOf(key) + 1 : null;
    return `<div class="schwartz-card ${sel ? 'selected' : ''}" onclick="aiToggleValue('${key}')">
      <div class="schwartz-card-top">
        <span class="schwartz-icon">${(window.icon && window.icon(v.icon, {size:16})) || ''}</span>
        <span class="schwartz-name">${key}</span>
        ${sel ? `<span class="schwartz-rank">#${rank}</span>` : ''}
      </div>
      <div class="schwartz-short">${v.def.slice(0, 55)}</div>
    </div>`;
  }).join('');
}

function renderAIPanel(){
  const panel = document.getElementById('intelPanel');
  if(!panel) return;
  _loadCfg();
  const ready = typeof isIntelReady === 'function' && isIntelReady();
  const dev = typeof getIntelDevice === 'function' ? getIntelDevice() : null;

  const embedModel = (typeof window !== 'undefined' && window.INTEL_EMBED_MODEL) || 'Xenova/gte-small';
  panel.innerHTML = `
    <div class="intel-card">
      <div class="intel-card-head">
        <div class="intel-card-titles">
          <h3 class="intel-card-h3">Task understanding</h3>
          <span class="intel-card-badge">On device</span>
        </div>
        <div id="intelStatus" class="intel-status intel-status-chip intel-status--${ready ? 'ok' : 'idle'}" role="status">
          ${ready ? 'Ready · ' + (dev || 'CPU') : 'Loading model…'}
        </div>
      </div>
      <div class="intel-card-body">
        <div class="intel-desc intel-desc-short">
          <p class="intel-lead"><strong>Understand your tasks</strong> — runs on this device. <span class="intel-nogen">No cloud LLM, no chat.</span></p>
          <div class="intel-feature-grid">
            <div class="intel-feature">
              <span class="intel-feature-ic" aria-hidden="true">${_IC.search}</span>
              <div class="intel-feature-txt"><strong>Semantic search</strong><span class="intel-feature-sub">Tasks tab — toggle next to search</span></div>
            </div>
            <div class="intel-feature">
              <span class="intel-feature-ic" aria-hidden="true">${_IC.spark}</span>
              <div class="intel-feature-txt"><strong>Smart-add</strong><span class="intel-feature-sub">Button beside the new-task field</span></div>
            </div>
            <div class="intel-feature">
              <span class="intel-feature-ic" aria-hidden="true">${_IC.harmonize}</span>
              <div class="intel-feature-txt"><strong>Bulk cleanup</strong><span class="intel-feature-sub">Preview changes before you apply</span></div>
            </div>
          </div>
          <details class="intel-details"><summary>How it works</summary>
            <p class="intel-details-body">A small on-device embedding model (<strong>${embedModel}</strong>, ~33 MB) encodes each task’s meaning as a vector. Cosine similarity drives semantic search, duplicate detection, smart-add hints, list routing, similar tasks, and harmonize proposals. Your task text stays local.</p>
          </details>
        </div>
        <div id="intelProgressWrap" class="intel-progress-wrap" style="display:none">
          <div class="intel-progress-track"><div class="intel-progress-bar" id="intelProgressBar" style="width:0%"></div></div>
          <div class="intel-progress-info"><span id="intelProgressPct">0%</span> <span id="intelProgressTxt"></span></div>
        </div>
        <div class="intel-toolbar-row">
          <button class="intel-tool-btn intel-tool-btn--primary" type="button" onclick="intelRetryLoad()" id="intelRetryBtn" style="display:none">${_IC.refresh}<span>Retry load</span></button>
          <button class="intel-tool-btn" type="button" id="intelUndoBtn" onclick="aiUndo()" style="display:${_undoStack.length ? '' : 'none'}">${_IC.undo}<span>Undo</span></button>
        </div>
        <div class="intel-action-grid">
          <button type="button" class="intel-action-btn intel-action-btn--primary" onclick="aiAlign()" ${!ready || _cfg.dominant.length < 2 ? 'disabled' : ''}>
            ${_IC.bolt}
            <span class="intel-action-btn-text"><span class="intel-action-btn-lbl">Align values only</span><span class="intel-action-btn-sub">Requires 2–3 dominant values selected below</span></span>
          </button>
          <button type="button" class="intel-action-btn intel-action-btn--primary" onclick="intelHarmonizeFields()" ${!ready ? 'disabled' : ''}
            title="Propose updates using values, category, priority, effort, context, energy, and tags from embeddings and similar tasks. Review before apply.">
            ${_IC.harmonize}
            <span class="intel-action-btn-text"><span class="intel-action-btn-lbl">Harmonize all fields</span><span class="intel-action-btn-sub">Preview field updates from the embedding model</span></span>
          </button>
          <button type="button" class="intel-action-btn" onclick="intelAutoOrganize()" ${!ready || (typeof lists === 'undefined' || lists.length < 2) ? 'disabled' : ''}
            title="Route tasks into the list whose name and description match best. Edit a list description to tune routing.">
            ${_IC.folder}
            <span class="intel-action-btn-text"><span class="intel-action-btn-lbl">Auto-organize into lists</span><span class="intel-action-btn-sub">Needs at least two lists</span></span>
          </button>
          <button type="button" class="intel-action-btn" onclick="intelFindDuplicatesUI()">
            ${_IC.duplicate}
            <span class="intel-action-btn-text"><span class="intel-action-btn-lbl">Find duplicates</span><span class="intel-action-btn-sub">Near-duplicate pairs by embedding similarity</span></span>
          </button>
          <button type="button" class="intel-action-btn" onclick="intelReembedAll()">
            ${_IC.refresh}
            <span class="intel-action-btn-text"><span class="intel-action-btn-lbl">Re-embed all tasks</span><span class="intel-action-btn-sub">Refresh vectors after bulk edits</span></span>
          </button>
        </div>
        <div id="intelDupSection" class="intel-dup-section" style="display:none"></div>
        <div id="intelPendingOps" class="pending-ops-wrap" style="display:none"></div>
        <div class="intel-section-hdr">
          <span class="intel-section-title">Dominant values</span>
          <span class="intel-section-hint">Pick 2–3 to steer alignment</span>
        </div>
        <div class="schwartz-grid" id="intelValuesGrid"></div>
        <div class="intel-breakdown-section">
          <div class="intel-section-hdr">
            <span class="intel-section-title">Category breakdown</span>
          </div>
          <div id="intelBreakdown"></div>
        </div>
        <p class="intel-hint intel-hint-foot">
          Batches are undoable (last 10). Alignment proposes <code>UPDATE_TASK</code> previews — apply when ready.
        </p>
      </div>
    </div>`;

  _renderValuesGrid();
  _renderBreakdown();
  _renderUndoBtn();
  if(ready) syncHeaderAIChip('ready', `Ready via ${dev || 'CPU'}`);
  else syncHeaderAIChip('loading', 'Loading model…');
  syncSemanticSearchUi();
}

/**
 * Aggregates Transformers.js v3 progress callbacks.
 * The callback fires per file (tokenizer.json, config.json, onnx/model_fp16.onnx…)
 * with events { status, name, file, loaded, total, progress }.
 * `progress` is already a percentage (0..100) per file — so showing it directly
 * makes the bar reset each time a new file starts. Aggregating by bytes across
 * files gives a single monotonic 0..100 for the whole model download.
 */
function _makeProgressAggregator(onUpdate){
  const files = new Map(); // file path -> {loaded, total, done}
  let lastEmittedPct = -1;
  return function(ev){
    if(!ev || typeof ev !== 'object') return;
    const file = ev.file || ev.name || '_';
    const entry = files.get(file) || {loaded: 0, total: 0, done: false};
    if(ev.status === 'progress'){
      if(Number.isFinite(ev.loaded)) entry.loaded = ev.loaded;
      if(Number.isFinite(ev.total) && ev.total > 0) entry.total = ev.total;
      // Fallback when byte counts missing: convert per-file percent into synthetic bytes.
      if((!entry.total || !entry.loaded) && Number.isFinite(ev.progress)){
        entry.total = 100;
        entry.loaded = Math.min(100, Math.max(0, ev.progress));
      }
    }else if(ev.status === 'done'){
      entry.done = true;
      if(entry.total > 0) entry.loaded = entry.total;
    }else if(ev.status === 'initiate' || ev.status === 'download'){
      // seed entry so the file counts toward the total as soon as we know it exists
    }
    files.set(file, entry);

    let sumLoaded = 0, sumTotal = 0;
    for(const v of files.values()){
      if(v.total > 0){ sumLoaded += v.loaded; sumTotal += v.total; }
    }
    // If we truly have no byte counts yet, fall back to count-of-files progress.
    let pct;
    if(sumTotal > 0){
      pct = Math.max(0, Math.min(100, Math.round((sumLoaded / sumTotal) * 100)));
    }else{
      const doneCount = [...files.values()].filter(v => v.done).length;
      pct = files.size ? Math.round((doneCount / files.size) * 100) : 0;
    }
    // Never go backwards once we've emitted a higher number — avoids visual jitter
    // when Transformers.js emits `initiate` for a new file mid-stream.
    if(pct < lastEmittedPct) pct = lastEmittedPct;
    lastEmittedPct = pct;
    onUpdate(pct, ev, entry);
  };
}

function intelRetryLoad(){
  if(typeof intelLoad !== 'function') return;
  const w = document.getElementById('intelProgressWrap');
  const bar = document.getElementById('intelProgressBar');
  const pct = document.getElementById('intelProgressPct');
  const txt = document.getElementById('intelProgressTxt');
  const btn = document.getElementById('intelRetryBtn');
  if(btn) btn.style.display = 'none';
  if(w) w.style.display = '';
  const onProgress = _makeProgressAggregator((v, ev) => {
    if(bar) bar.style.width = v + '%';
    if(pct) pct.textContent = v + '%';
    const status = ev && ev.status ? String(ev.status) : '';
    const file = ev && ev.file ? ' · ' + String(ev.file).split('/').pop() : '';
    if(txt) txt.textContent = (status + file).slice(0, 80);
    syncHeaderAIChip('loading', v + '%');
  });
  intelLoad(onProgress).then(() => {
    if(w) w.style.display = 'none';
    if(typeof ensureSchwartzEmbeddings === 'function'){
      ensureSchwartzEmbeddings().catch(() => {});
    }
    renderAIPanel();
    if(typeof maybeShowEnhanceBtn === 'function') maybeShowEnhanceBtn();
  }).catch(() => {
    if(w) w.style.display = 'none';
    if(btn) btn.style.display = '';
    _setIntelStatus('error', 'Could not load model');
    syncSemanticSearchUi();
  });
}

async function intelFindDuplicatesUI(){
  if(!isIntelReady()){ _setIntelStatus('error', 'Model not ready'); return; }
  const sec = document.getElementById('intelDupSection');
  if(!sec) return;
  sec.style.display = '';
  sec.innerHTML = '<span style="font-size:12px;color:var(--text-3)">Scanning…</span>';
  try{
    const pairs = await findDuplicates(0.9);
    if(!pairs.length){
      sec.innerHTML = '<span style="font-size:12px;color:var(--text-3)">No near-duplicate pairs (≥0.9) found.</span>';
      window._dupSimMap = null;
      return;
    }
    window._dupSimMap = new Map();
    pairs.forEach(p => {
      window._dupSimMap.set(p.idA, Math.max(window._dupSimMap.get(p.idA) || 0, p.sim));
      window._dupSimMap.set(p.idB, Math.max(window._dupSimMap.get(p.idB) || 0, p.sim));
    });
    if(typeof renderTaskList === 'function') renderTaskList();
    sec.innerHTML = '<div class="intel-dup-hdr">Near duplicates</div>' + pairs.slice(0, 30).map(p => `
      <div class="intel-dup-row">
        <span class="intel-dup-pair">${esc(p.taskA.name.slice(0, 32))} ↔ ${esc(p.taskB.name.slice(0, 32))}</span>
        <span class="intel-dup-sim">${p.sim.toFixed(2)}</span>
        <button type="button" class="btn-ghost btn-sm" onclick="intelMergeDuplicatePair(${p.idA},${p.idB})">Archive 2nd</button>
      </div>`).join('');
  }catch(e){
    sec.innerHTML = '<span style="color:var(--danger)">Failed to scan</span>';
  }
}

function intelMergeDuplicatePair(idA, idB){
  const ta = findTask(idA), tb = findTask(idB);
  if(!ta || !tb) return;
  const first = ta.name.length <= tb.name.length ? ta : tb;
  const second = first === ta ? tb : ta;
  _pendingOps = [
    { name: 'ADD_NOTE', args: { id: first.id, text: `Merged duplicate: ${second.name}` } },
    { name: 'ARCHIVE_TASK', args: { id: second.id } },
  ];
  _renderPendingOps();
  _setIntelStatus('idle', 'Review merge (archive duplicate)');
}

async function intelHarmonizeFields(){
  if(typeof isIntelReady !== 'function' || !isIntelReady()){
    _setIntelStatus('error', 'Model not ready');
    return;
  }
  if(_intelBusy) return;
  _loadCfg();
  _intelBusy = true;
  _setIntelStatus('working', 'Scanning tasks (values, category, priority, tags…)…');
  try{
    const ops = await proposeHarmonizeUpdates({ dominant: _cfg.dominant, maxTasks: 200 });
    if(!ops.length){
      _setIntelStatus('ready', 'No changes suggested — fields already match the model');
      return;
    }
    _pendingOps = ops;
    _renderPendingOps();
    _setIntelStatus('ready', `Review ${ops.length} proposed field update${ops.length === 1 ? '' : 's'}`);
  }catch(err){
    console.warn('[harmonize]', err);
    _setIntelStatus('error', 'Harmonize failed');
  }finally{
    _intelBusy = false;
  }
}

async function intelAutoOrganize(){
  if(!isIntelReady()){ _setIntelStatus('error', 'Model not ready'); return; }
  if(typeof lists === 'undefined' || lists.length < 2){
    _setIntelStatus('error', 'Need at least 2 lists');
    return;
  }
  const withDesc = lists.filter(l => (l.description || '').trim().length >= 4).length;
  if(withDesc === 0){
    if(!confirm(
      'None of your lists have descriptions yet — routing will use list names alone, which can be noisy.\n\n'
      + 'Tip: click the ✎ on a list chip to add a short description like "bills, taxes, budgets" for Finance.\n\n'
      + 'Continue anyway?'
    )) return;
  }
  _setIntelStatus('working', 'Scoring tasks against lists…');
  try{
    const proposals = await autoOrganizeIntoLists();
    if(!proposals.length){
      _setIntelStatus('ready', 'Every task is already in its best list');
      return;
    }
    _pendingOps = proposals.map(p => ({ name: 'CHANGE_LIST', args: { id: p.id, listId: p.toListId } }));
    _renderPendingOps();
    _setIntelStatus('idle', `Proposed ${proposals.length} move${proposals.length === 1 ? '' : 's'} — review & apply`);
  }catch(err){
    console.warn('[auto-organize]', err);
    _setIntelStatus('error', 'Auto-organize failed');
  }
}

async function intelReembedAll(){
  if(!isIntelReady()) return;
  _setIntelStatus('working', 'Re-embedding…');
  const list = tasks.filter(t => !t.archived);
  let i = 0;
  const step = async () => {
    if(i >= list.length){
      _setIntelStatus('ready', `Re-embedded ${list.length} tasks`);
      if(typeof invalidateDupMap === 'function') invalidateDupMap();
      return;
    }
    try{
      await embedStore.ensure(list[i]);
    }catch(e){ console.warn(e); }
    i++;
    if(i % 3 === 0) _setIntelStatus('working', `Re-embedding… ${i}/${list.length}`);
    setTimeout(step, 0);
  };
  step();
}

window._smartAddPreview = null;

function maybeShowEnhanceBtn(){
  const btn = document.getElementById('taskEnhanceBtn');
  const inp = document.getElementById('taskInput');
  if(!btn || !inp) return;
  const len = inp.value.trim().length;
  const showable = (typeof isIntelReady === 'function' && isIntelReady()) && len >= 3;
  btn.style.display = showable ? '' : 'none';
  if((len < 3 || window._smartAddPreview) && !btn.disabled){
    window._smartAddPreview = null;
    const prev = document.getElementById('smartAddPreview');
    if(prev){ prev.innerHTML = ''; prev.style.display = 'none'; }
  }
}

document.addEventListener('visibilitychange', () => {
  if(document.hidden && window._smartAddPreview){
    window._smartAddPreview = null;
    const prev = document.getElementById('smartAddPreview');
    if(prev){ prev.innerHTML = ''; prev.style.display = 'none'; }
  }
});

async function smartAddEnhance(){
  if(typeof isIntelReady !== 'function' || !isIntelReady()){
    _setIntelStatus('error', 'Model still loading — check the AI chip or open Tools');
    return;
  }
  if(_intelBusy) return;
  const inp = document.getElementById('taskInput');
  const btn = document.getElementById('taskEnhanceBtn');
  const prev = document.getElementById('smartAddPreview');
  const raw = (inp?.value || '').trim();
  if(!raw || raw.length < 3) return;

  _intelBusy = true;
  if(btn){ btn.disabled = true; btn.textContent = '⚙'; }

  try{
    const sugg = await predictMetadata(raw, 5);
    const PR = ['urgent','high','normal','low','none'];
    const CAT = LIFE_CATS;
    const EFF = ['xs','s','m','l','xl'];
    const CTX = ['work','home','phone','computer','errands'];
    const EN = ['high','low'];

    const cleaned = {};
    if(sugg.priority && PR.includes(sugg.priority) && sugg.priority !== 'none') cleaned.priority = sugg.priority;
    if(sugg.category && CAT.includes(sugg.category)) cleaned.category = sugg.category;
    if(sugg.effort && EFF.includes(sugg.effort)) cleaned.effort = sugg.effort;
    if(sugg.context && CTX.includes(sugg.context)) cleaned.context = sugg.context;
    if(sugg.energyLevel && EN.includes(sugg.energyLevel)) cleaned.energyLevel = sugg.energyLevel;
    if(Array.isArray(sugg.tags)) cleaned.tags = sugg.tags.filter(t => typeof t === 'string' && t.length && t.length < 25).slice(0, 5);
    if(sugg.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(sugg.dueDate)) cleaned.dueDate = sugg.dueDate;

    if(Object.keys(cleaned).length === 0){
      if(prev){
        prev.innerHTML = '<span class="smart-add-empty">No confident suggestions — add manually or keep typing</span>';
        prev.style.display = '';
      }
    } else {
      window._smartAddPreview = cleaned;
      _renderSmartAddChips(cleaned);
    }
  }catch(err){
    console.warn('[smart-add]', err);
  }finally{
    _intelBusy = false;
    if(btn){ btn.disabled = false; btn.innerHTML = (window.icon && window.icon('sparkles')) || ''; }
  }
}

function _renderSmartAddChips(s){
  const prev = document.getElementById('smartAddPreview');
  if(!prev) return;
  const effortTips = { xs:'Extra small — ~15 min', s:'Small — ~1 hr', m:'Medium — ~half day', l:'Large — ~full day', xl:'Extra large — multi-day' };
  const ctxTips = { work:'At your desk/workplace', home:'At home', phone:'Requires a phone call', computer:'Requires a computer', errands:'Out and about' };
  const chips = [];
  if(s.priority) chips.push(`<span class="sa-chip sa-priority sa-p-${s.priority}" data-tip="Priority — tap to remove" onclick="smartAddRemove('priority')">priority: ${s.priority} ×</span>`);
  const ic = (n, size) => (window.icon && window.icon(n, {size: size||13})) || '';
  if(s.category) chips.push(`<span class="sa-chip" data-tip="Category — tap to remove" onclick="smartAddRemove('category')"><span class="sa-chip-ic">${ic(CAT_ICON[s.category] || 'pin')}</span> ${s.category} ×</span>`);
  if(s.effort) chips.push(`<span class="sa-chip" data-tip="${effortTips[s.effort] || 'Effort'} — tap to remove" onclick="smartAddRemove('effort')">effort: ${s.effort.toUpperCase()} ×</span>`);
  if(s.context) chips.push(`<span class="sa-chip" data-tip="${ctxTips[s.context] || 'Context'} — tap to remove" onclick="smartAddRemove('context')">${s.context} ×</span>`);
  if(s.energyLevel) chips.push(`<span class="sa-chip" data-tip="Energy — tap to remove" onclick="smartAddRemove('energyLevel')"><span class="sa-chip-ic">${ic(s.energyLevel === 'high' ? 'flame' : 'leaf')}</span> ${s.energyLevel} ×</span>`);
  if(s.dueDate) chips.push(`<span class="sa-chip" data-tip="Due date — tap to remove" onclick="smartAddRemove('dueDate')"><span class="sa-chip-ic">${ic('calendar')}</span> ${s.dueDate} ×</span>`);
  if(s.tags && s.tags.length) s.tags.forEach(tag => chips.push(`<span class="sa-chip" data-tip="Tag — tap to remove" onclick="smartAddRemoveTag('${esc(tag)}')">#${esc(tag)} ×</span>`));
  prev.innerHTML = `
    <span class="smart-add-hint">Suggestions — tap to remove, Enter to add:</span>
    <div class="sa-chips">${chips.join('')}</div>`;
  prev.style.display = '';
}

function smartAddRemove(field){
  if(!window._smartAddPreview) return;
  delete window._smartAddPreview[field];
  if(Object.keys(window._smartAddPreview).length === 0 ||
     (Object.keys(window._smartAddPreview).length === 1 && window._smartAddPreview.tags && !window._smartAddPreview.tags.length)){
    window._smartAddPreview = null;
    const prev = document.getElementById('smartAddPreview');
    if(prev){ prev.innerHTML = ''; prev.style.display = 'none'; }
  } else {
    _renderSmartAddChips(window._smartAddPreview);
  }
}

function smartAddRemoveTag(tag){
  if(!window._smartAddPreview?.tags) return;
  window._smartAddPreview.tags = window._smartAddPreview.tags.filter(t => t !== tag);
  if(!window._smartAddPreview.tags.length) delete window._smartAddPreview.tags;
  if(Object.keys(window._smartAddPreview).length === 0){
    window._smartAddPreview = null;
    const prev = document.getElementById('smartAddPreview');
    if(prev){ prev.innerHTML = ''; prev.style.display = 'none'; }
  } else {
    _renderSmartAddChips(window._smartAddPreview);
  }
}

async function applySmartAddAndSubmit(){
  const inp = gid('taskInput');
  const raw = (inp?.value || '').trim();
  if(!raw){ window._smartAddPreview = null; return; }
  const sugg = window._smartAddPreview || {};

  ensureDefaultList();
  let parsed;
  if(typeof parseQuickAddAsync === 'function'){
    parsed = await parseQuickAddAsync(raw);
  } else {
    parsed = parseQuickAdd(raw);
  }
  if(!parsed.name) return;

  const merged = Object.assign({}, defaultTaskProps(), sugg, parsed.props);

  tasks.push(Object.assign({
    id: ++taskIdCtr, name: parsed.name,
    totalSec: 0, sessions: 0, created: timeNowFull(),
    parentId: null, collapsed: false,
  }, merged));

  inp.value = '';
  window._smartAddPreview = null;
  const prev = document.getElementById('smartAddPreview');
  if(prev){ prev.innerHTML = ''; prev.style.display = 'none'; }
  const btn = document.getElementById('taskEnhanceBtn');
  if(btn) btn.style.display = 'none';

  renderTaskList();
  if(typeof renderBanner === 'function') renderBanner();
  if(typeof renderLists === 'function') renderLists();
  saveState('user');
}

function openWhatNext(){
  const o = document.getElementById('whatNextOverlay');
  if(!o) return;
  const timeSel = document.getElementById('whatNextTime');
  const enSel = document.getElementById('whatNextEnergy');
  const timeMin = timeSel ? parseInt(timeSel.value, 10) : 0;
  const energy = enSel ? enSel.value : '';
  const opts = {};
  if(timeMin > 0) opts.timeMin = timeMin;
  if(energy === 'high' || energy === 'low') opts.energy = energy;

  const ranked = rankWhatNext(tasks, opts).slice(0, 3);
  const body = document.getElementById('whatNextBody');
  if(body){
    body.innerHTML = ranked.length
      ? ranked.map(x => `
        <button type="button" class="what-next-item" onclick="openTaskDetail(${x.t.id});closeWhatNext();">
          <span class="wn-name">${esc(x.t.name)}</span>
          <span class="wn-meta">${x.t.dueDate ? esc(x.t.dueDate) : 'no date'} · ${esc(x.t.priority || 'none')}</span>
        </button>`).join('')
      : '<span style="color:var(--text-3);font-size:12px">Nothing queued — add tasks or clear filters.</span>';
  }
  o.style.display = '';
}

function closeWhatNext(){
  const o = document.getElementById('whatNextOverlay');
  if(o) o.style.display = 'none';
}

function toggleTaskSearchSemantic(){
  const cb = document.getElementById('taskSearchSemantic');
  if(!cb || cb.disabled) return;
  if(typeof isIntelReady === 'function' && !isIntelReady()) return;
  window._taskSearchSemantic = cb ? cb.checked : false;
  if(!window._taskSearchSemantic){
    window._semanticScores = null;
  }
  updateTaskFilters();
}

window.executeIntelOp = executeIntelOp;
window.renderAIPanel = renderAIPanel;
window.smartAddEnhance = smartAddEnhance;
window.applySmartAddAndSubmit = applySmartAddAndSubmit;
window.maybeShowEnhanceBtn = maybeShowEnhanceBtn;
window.aiAlign = aiAlign;
window.aiToggleValue = aiToggleValue;
window.aiUndo = aiUndo;
window.openWhatNext = openWhatNext;
window.closeWhatNext = closeWhatNext;
window.toggleTaskSearchSemantic = toggleTaskSearchSemantic;
window.intelFindDuplicatesUI = intelFindDuplicatesUI;
window.intelMergeDuplicatePair = intelMergeDuplicatePair;
window.intelReembedAll = intelReembedAll;
window.intelAutoOrganize = intelAutoOrganize;
window.intelHarmonizeFields = intelHarmonizeFields;
window.intelRetryLoad = intelRetryLoad;
window.intelApplyPending = intelApplyPending;
window.intelRejectPending = intelRejectPending;
window.intelToggleAllPending = intelToggleAllPending;
window.syncHeaderAIChip = syncHeaderAIChip;
window.syncSemanticSearchUi = syncSemanticSearchUi;
window.headerAIClick = headerAIClick;
