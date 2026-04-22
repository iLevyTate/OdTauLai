// ========== AMBIENT INTELLIGENCE (embeddings + rules — no generative LLM) ==========
// Preview/undo, Schwartz values UI, smart-add chips. Task mutations via executeIntelOp.

const INTEL_CFG_KEY = 'stupind_intel_cfg';

// LIFE_CATS, CAT_ICON, SCHWARTZ, VALUE_KEYS — globals from intel-features.js

let _cfg = null;
let _pendingOps = [];
let _pendingDestructive = 'none'; // 'none' | 'warn' | 'hard' — set by acceptProposedOps()
let _pendingSource = null;        // tag for UI ('ask', 'harmonize', …)
let _undoStack = [];
let _intelBusy = false;

function _loadCfg(){
  try{ _cfg = JSON.parse(localStorage.getItem(INTEL_CFG_KEY) || '{}'); }
  catch(e){ _cfg = {}; }
  _cfg.dominant = Array.isArray(_cfg.dominant) ? _cfg.dominant : [];
  return _cfg;
}
function _saveCfg(){ try{ localStorage.setItem(INTEL_CFG_KEY, JSON.stringify(_cfg)); }catch(e){} }

// Track the two model states independently so the header chip can show
// both without one stomping the other (embedding = ambient/always-on,
// generative = opt-in LLM for Ask mode).
let _embedChipState = 'idle';
let _embedChipMsg = '';
let _genChipState = 'idle';
let _genChipMsg = '';

function _composeChipState(){
  // Error wins. Then loading. Then ready. Otherwise idle.
  if(_embedChipState === 'error' || _genChipState === 'error'){
    const which = _genChipState === 'error' ? 'LLM' : 'Embedding';
    const raw = _genChipState === 'error' ? _genChipMsg : _embedChipMsg;
    return { state: 'error', msg: `${which}: ${raw || 'load failed'}` };
  }
  if(_embedChipState === 'loading' || _embedChipState === 'working' || _embedChipState === 'syncing' ||
     _genChipState === 'loading' || _genChipState === 'working' || _genChipState === 'syncing'){
    if(_genChipState === 'loading' || _genChipState === 'working' || _genChipState === 'syncing'){
      return { state: 'loading', msg: _genChipMsg || 'Loading LLM…' };
    }
    return { state: 'loading', msg: _embedChipMsg || 'Loading model…' };
  }
  if(_embedChipState === 'ready' || _genChipState === 'ready'){
    const embedOk = _embedChipState === 'ready';
    const genOk = _genChipState === 'ready';
    let summary = 'Task understanding ready';
    if(embedOk && genOk) summary = 'Embeddings + LLM ready';
    else if(genOk) summary = 'LLM ready';
    return { state: 'ready', msg: summary };
  }
  return { state: 'idle', msg: 'Task understanding (on-device)' };
}

/** Set the generative-LLM chip sub-state without affecting embedding state. */
function syncGenChip(state, msg){
  _genChipState = state || 'idle';
  _genChipMsg = msg || '';
  const c = _composeChipState();
  _renderHeaderAIChip(c.state, c.msg);
}

/** Header pill: model load / ready / error — visible on every tab */
function syncHeaderAIChip(state, msg){
  // Record embedding state (legacy callers pass embedding updates here), then
  // re-render the composed chip.
  _embedChipState = state || 'idle';
  _embedChipMsg = msg || '';
  const c = _composeChipState();
  _renderHeaderAIChip(c.state, c.msg);
}

function _renderHeaderAIChip(state, msg){
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
      const allow = ['name','priority','status','dueDate','startDate','effort','energyLevel','category','description','url','estimateMin','starred','type','valuesAlignment','valuesNote','tags'];
      allow.forEach(f => { if(a[f] !== undefined) t[f] = a[f]; });
      if(t.status === 'done' && !t.completedAt) t.completedAt = stampCompletion();
      if(t.status !== 'done') t.completedAt = null;
      break;
    }
    case 'MARK_DONE':{
      const t = findTask(a.id); if(!t) return null;
      snap = { type: 'updated', id: t.id, before: { ...t } };
      if(a.completionNote) t.completionNote = String(a.completionNote);
      if(t.recur && typeof completeHabitCycle === 'function'){
        completeHabitCycle(t);
      } else {
        t.status = 'done'; t.completedAt = stampCompletion();
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

function _pendingStableArrJson(arr){
  return JSON.stringify([...(arr || [])].map(String).sort());
}

function _pendingValsEqual(field, cur, next){
  if(cur === next) return true;
  if(Array.isArray(cur) && Array.isArray(next)){
    return _pendingStableArrJson(cur) === _pendingStableArrJson(next);
  }
  const c = cur == null || cur === '' ? null : cur;
  const n = next == null || next === '' ? null : next;
  return c === n;
}

function _humanizeFieldKey(k){
  const map = {
    priority: 'Priority',
    category: 'Life area',
    effort: 'Effort',
    energyLevel: 'Energy',
    tags: 'Tags',
    valuesAlignment: 'Values alignment',
    name: 'Name',
    status: 'Status',
    dueDate: 'Due date',
    startDate: 'Start date',
    description: 'Description',
    starred: 'Starred',
    listId: 'List',
  };
  if(map[k]) return map[k];
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

function _formatFieldDisplay(field, val){
  if(val == null || val === '') return '—';
  if(field === 'category'){
    const d = (typeof getCategoryDef === 'function') ? getCategoryDef(val) : null;
    return d ? d.label : String(val);
  }
  if(field === 'valuesAlignment' && Array.isArray(val)){
    return val.map(k => (SCHWARTZ[k] ? k.replace(/-/g, ' ') : k)).join(', ') || '—';
  }
  if(field === 'tags' && Array.isArray(val)){
    return val.length ? val.map(t => '#' + t).join(', ') : '—';
  }
  if(field === 'starred') return val ? 'Yes' : 'No';
  return String(val).slice(0, 120);
}

function _fieldConfidenceScore(fc, field){
  if(!fc || !fc[field]) return null;
  const o = fc[field];
  if(typeof o.confidence === 'number') return o.confidence;
  return null;
}

function _updateTaskFieldChanges(t, args, fieldConfidence){
  const skip = new Set(['id', 'valuesNote']);
  const out = [];
  if(!t){
    out.push({ field: '_missing', fromVal: null, toVal: null, confidence: null, note: 'Task not found' });
    return out;
  }
  Object.keys(args).forEach(k => {
    if(skip.has(k)) return;
    const v = args[k];
    const cur = t[k];
    if(_pendingValsEqual(k, cur, v)) return;
    let conf = _fieldConfidenceScore(fieldConfidence, k);
    const row = { field: k, fromVal: cur, toVal: v, confidence: conf, note: '' };
    out.push(row);
  });
  if(args.valuesNote && args.valuesAlignment){
    const row = out.find(x => x.field === 'valuesAlignment');
    if(row) row.note = String(args.valuesNote).slice(0, 200);
  }
  return out;
}

function _pendingConfPill(confidence){
  if(confidence == null || typeof confidence !== 'number') return '';
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  return `<span class="pending-confidence-pill" title="Model vote confidence">${pct}%</span>`;
}

function _pendingIcon(name){
  return (window.icon && window.icon(name, { size: 14, cls: 'pending-simple-ic-svg' })) || '';
}

/**
 * @returns {{ kind:'update' } | { kind:'simple', title:string, taskName:string, detail:string, icon:string, danger:boolean }}
 */
function _describeOpStructured(op){
  const a = op.args || {};
  const t = a.id ? findTask(a.id) : null;
  const taskName = t ? t.name.slice(0, 56) : (a.name ? String(a.name).slice(0, 56) : '');
  const parts = keys => keys.filter(k => a[k] != null).map(k => _humanizeFieldKey(k) + ': ' + _formatFieldDisplay(k, a[k])).join(' · ');

  switch(op.name){
    case 'UPDATE_TASK': return { kind: 'update' };
    case 'CREATE_TASK': return { kind: 'simple', title: 'Create task', taskName, detail: parts(['priority','category','dueDate','effort']), icon: 'plus', danger: false };
    case 'MARK_DONE': return { kind: 'simple', title: 'Mark done', taskName, detail: a.completionNote ? String(a.completionNote).slice(0, 72) : '', icon: 'check', danger: false };
    case 'REOPEN': return { kind: 'simple', title: 'Reopen', taskName, detail: '', icon: 'rotateCcw', danger: false };
    case 'TOGGLE_STAR': return { kind: 'simple', title: t?.starred ? 'Unstar' : 'Star', taskName, detail: '', icon: 'star', danger: false };
    case 'ARCHIVE_TASK': return { kind: 'simple', title: 'Archive', taskName, detail: '', icon: 'archive', danger: false };
    case 'RESTORE_TASK': return { kind: 'simple', title: 'Restore', taskName, detail: '', icon: 'refresh', danger: false };
    case 'DELETE_TASK': return { kind: 'simple', title: 'Delete forever', taskName, detail: 'Permanent removal (task must be archived)', icon: 'alertTriangle', danger: true };
    case 'DUPLICATE_TASK': return { kind: 'simple', title: 'Duplicate', taskName, detail: '', icon: 'copy', danger: false };
    case 'MOVE_TASK': return { kind: 'simple', title: 'Move in tree', taskName, detail: 'Parent #' + (a.newParentId || 'top'), icon: 'chevronRight', danger: false };
    case 'CHANGE_LIST': {
      const l = typeof lists !== 'undefined' ? lists.find(x => x.id === a.listId) : null;
      return { kind: 'simple', title: 'Move to list', taskName, detail: l ? l.name : ('List #' + a.listId), icon: 'folder', danger: false };
    }
    case 'ADD_NOTE': return { kind: 'simple', title: 'Add note', taskName, detail: String(a.text || '').slice(0, 72), icon: 'clipboard', danger: false };
    case 'ADD_CHECKLIST': return { kind: 'simple', title: 'Add checklist item', taskName, detail: String(a.text || '').slice(0, 72), icon: 'list', danger: false };
    case 'TOGGLE_CHECK': return { kind: 'simple', title: 'Toggle checklist item', taskName, detail: 'Item #' + a.checkId, icon: 'check', danger: false };
    case 'REMOVE_CHECK': return { kind: 'simple', title: 'Remove checklist item', taskName, detail: 'Item #' + a.checkId, icon: 'close', danger: false };
    case 'ADD_TAG': return { kind: 'simple', title: 'Add tag', taskName, detail: String(a.tag || ''), icon: 'plus', danger: false };
    case 'REMOVE_TAG': return { kind: 'simple', title: 'Remove tag', taskName, detail: String(a.tag || ''), icon: 'close', danger: false };
    case 'ADD_BLOCKER': {
      const b = findTask(a.blockerId);
      return { kind: 'simple', title: 'Add blocker', taskName, detail: b ? b.name.slice(0, 48) : ('#' + a.blockerId), icon: 'alertTriangle', danger: false };
    }
    case 'REMOVE_BLOCKER': return { kind: 'simple', title: 'Remove blocker', taskName, detail: 'Blocker #' + a.blockerId, icon: 'close', danger: false };
    case 'SET_REMINDER': return { kind: 'simple', title: 'Set reminder', taskName, detail: String(a.remindAt || ''), icon: 'timer', danger: false };
    case 'SET_RECUR': return { kind: 'simple', title: a.recur ? 'Set recurrence' : 'Clear recurrence', taskName, detail: a.recur ? String(a.recur) : '', icon: 'refresh', danger: false };
    default: return { kind: 'simple', title: op.name, taskName, detail: '', icon: 'gear', danger: false };
  }
}

function _renderPendingSimpleCard(op, idx){
  const st = _describeOpStructured(op);
  if(st.kind === 'update') return '';
  const ic = st.icon ? _pendingIcon(st.icon) : '';
  const rat = op._rationale ? `<span class="pending-rationale" title="LLM rationale">${esc(op._rationale)}</span>` : '';
  return `<div class="pending-simple-card${st.danger ? ' pending-simple-card--danger' : ''}">
    <label class="pending-simple-row">
      <input type="checkbox" class="pending-op-master" data-op-idx="${idx}" checked>
      <span class="pending-simple-ic-wrap" aria-hidden="true">${ic}</span>
      <span class="pending-simple-text">
        <span class="pending-simple-title">${esc(st.title)}</span>
        ${st.taskName ? `<span class="pending-simple-target">"${esc(st.taskName)}"</span>` : ''}
        ${st.detail ? `<span class="pending-simple-detail">${esc(st.detail)}</span>` : ''}
        ${rat}
      </span>
    </label>
  </div>`;
}

function _renderPendingUpdateCard(op, idx){
  const t = findTask(op.args.id);
  const nm = t ? t.name.slice(0, 56) : ('Task #' + op.args.id);
  const changes = _updateTaskFieldChanges(t, op.args, op._fieldConfidence);
  if(!changes.length) return '';
  const rows = changes.map(ch => {
    if(ch.field === '_missing'){
      return `<div class="pending-change-row pending-change-row--warn">
        <span class="pending-field-lbl">Issue</span>
        <span class="pending-field-val">${esc(ch.note || '')}</span>
      </div>`;
    }
    const fromDisp = esc(_formatFieldDisplay(ch.field, ch.fromVal));
    const toDisp = esc(_formatFieldDisplay(ch.field, ch.toVal));
    const pill = _pendingConfPill(ch.confidence);
    const tip = ch.note ? esc(ch.note) : '';
    return `<label class="pending-change-row" ${tip ? `title="${tip}"` : ''}>
      <input type="checkbox" class="pending-field-check" data-op-idx="${idx}" data-field="${esc(ch.field)}" checked>
      <span class="pending-field-lbl">${esc(_humanizeFieldKey(ch.field))}</span>
      <span class="pending-field-vals"><span class="pending-field-val pending-field-from">${fromDisp}</span>
      <span class="pending-field-arrow" aria-hidden="true">→</span>
      <span class="pending-field-val pending-field-to">${toDisp}</span></span>
      ${pill}
    </label>`;
  }).join('');
  const rat = op._rationale ? `<div class="pending-rationale pending-rationale--card" title="LLM rationale">${esc(op._rationale)}</div>` : '';
  return `<div class="pending-task-card">
    <div class="pending-card-head">
      <label class="pending-card-head-lbl">
        <input type="checkbox" class="pending-op-master" data-op-idx="${idx}" checked>
        <span class="pending-card-title">${esc(nm)}</span>
      </label>
      <span class="pending-card-badge">${changes.length} field update${changes.length !== 1 ? 's' : ''}</span>
    </div>
    ${rat}
    <div class="pending-change-list">${rows}</div>
  </div>`;
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
  _setIntelStatus('ready', `Reverted ${flat.length} change${flat.length !== 1 ? 's' : ''}`);
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
  if(_undoStack.length){
    const top = _undoStack[0];
    btn.title = 'Undo: ' + (top.label || 'last batch');
  } else {
    btn.title = '';
  }
}

function _renderPendingOps(){
  const wrap = document.getElementById('intelPendingOps');
  if(!wrap) return;
  if(!_pendingOps.length){ wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  const normalParts = [];
  const dangerIdx = [];
  _pendingOps.forEach((op, i) => {
    if(op.name === 'DELETE_TASK') dangerIdx.push(i);
    else if(op.name === 'UPDATE_TASK') normalParts.push(_renderPendingUpdateCard(op, i));
    else normalParts.push(_renderPendingSimpleCard(op, i));
  });

  let dangerHtml = '';
  if(dangerIdx.length){
    dangerHtml = `
    <div class="pending-section-danger">
      <div class="pending-section-danger-hdr">
        <span class="pending-section-danger-ic" aria-hidden="true">${_pendingIcon('alertTriangle')}</span>
        <span class="pending-section-danger-title">Destructive actions</span>
      </div>
      <p class="pending-section-danger-copy">Permanent delete cannot be undone. Confirm to enable applying those rows.</p>
      <label class="pending-danger-ack-lbl">
        <input type="checkbox" id="pendingDangerAck" autocomplete="off">
        <span>I understand — allow permanent delete</span>
      </label>
      <div class="pending-danger-list">
        ${dangerIdx.map(i => _renderPendingSimpleCard(_pendingOps[i], i)).join('')}
      </div>
    </div>`;
  }

  const sourceBadge = _pendingSource ? `<span class="pending-source-badge" title="Proposed via ${esc(_pendingSource)}">via ${esc(_pendingSource)}</span>` : '';
  const massWarn = (_pendingDestructive === 'hard' && !dangerIdx.length) ? `
    <div class="pending-mass-warn" role="note">
      <strong>Heads up:</strong> this batch contains multiple destructive actions (archive / move across lists). Review carefully before applying — you can undo, but it affects many tasks at once.
    </div>` : '';

  wrap.innerHTML = `
    <div class="pending-hdr">
      <span class="pending-title">Proposed changes (${_pendingOps.length})${sourceBadge}</span>
      <button type="button" class="pending-toggle-all" onclick="intelToggleAllPending()">Toggle all</button>
    </div>
    ${massWarn}
    <div class="pending-list">${normalParts.join('')}</div>
    ${dangerHtml}
    <div class="pending-actions">
      <button type="button" class="btn-ghost btn-sm" onclick="intelRejectPending()">Reject all</button>
      <button type="button" class="btn-primary" onclick="intelApplyPending()">Apply selected</button>
    </div>`;
  _setIntelStatus('idle', 'Review proposed changes below');
}

function intelToggleAllPending(){
  const masters = document.querySelectorAll('#intelPendingOps .pending-op-master');
  if(!masters.length) return;
  const allOn = [...masters].every(c => c.checked);
  masters.forEach(c => { c.checked = !allOn; });
}

function intelRejectPending(){
  _pendingOps = [];
  _pendingDestructive = 'none';
  _pendingSource = null;
  _renderPendingOps();
  _setIntelStatus('ready', 'Ready');
}

/**
 * Hook used by js/ask.js (and future callers) to seed the existing preview
 * pipeline with externally-proposed ops. Respects the same checkbox/undo
 * machinery as harmonize/auto-organize. Never auto-applies.
 *
 * @param {Array<{name:string,args:object}>} ops
 * @param {{ source?:string, destructiveLevel?:'none'|'warn'|'hard' }} [meta]
 */
function acceptProposedOps(ops, meta){
  const list = Array.isArray(ops) ? ops.slice(0, 50) : [];
  _pendingOps = list;
  _pendingDestructive = (meta && meta.destructiveLevel) || 'none';
  _pendingSource = (meta && meta.source) || null;
  _renderPendingOps();
  if(list.length && typeof showTab === 'function') showTab('tools');
  if(list.length){
    setTimeout(() => {
      const wrap = document.getElementById('intelPendingOps');
      if(wrap && typeof wrap.scrollIntoView === 'function') wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    _setIntelStatus('idle', `Review ${list.length} proposed change${list.length !== 1 ? 's' : ''}`);
  } else {
    _setIntelStatus('ready', 'No changes proposed');
  }
}

async function intelApplyPending(){
  const hasDelete = _pendingOps.some(o => o.name === 'DELETE_TASK');
  const dangerAck = document.getElementById('pendingDangerAck');
  if(hasDelete && (!dangerAck || !dangerAck.checked)){
    _setIntelStatus('error', 'Confirm permanent delete below');
    return;
  }
  if(_pendingDestructive === 'hard' && !hasDelete){
    const msg = 'Proposed changes include bulk destructive actions (archive/move to list). Apply anyway?';
    if(typeof showAppConfirm === 'function'){
      if(!(await showAppConfirm(msg))){ _setIntelStatus('ready', 'Cancelled'); return; }
    }else if(typeof window !== 'undefined' && typeof window.confirm === 'function'){
      if(!window.confirm(msg)){ _setIntelStatus('ready', 'Cancelled'); return; }
    }
  }

  const selOps = [];
  for(let idx = 0; idx < _pendingOps.length; idx++){
    const master = document.querySelector('#intelPendingOps .pending-op-master[data-op-idx="' + idx + '"]');
    if(!master || !master.checked) continue;
    const op = _pendingOps[idx];

    if(op.name !== 'UPDATE_TASK'){
      selOps.push({ name: op.name, args: { ...op.args } });
      continue;
    }

    const nextArgs = { id: op.args.id };
    document.querySelectorAll('#intelPendingOps .pending-field-check[data-op-idx="' + idx + '"]').forEach(fc => {
      if(!fc.checked) return;
      const f = fc.getAttribute('data-field');
      if(!f || f === '_missing') return;
      if(op.args[f] !== undefined) nextArgs[f] = op.args[f];
    });
    if(nextArgs.valuesAlignment !== undefined && op.args.valuesNote){
      nextArgs.valuesNote = op.args.valuesNote;
    }
    if(Object.keys(nextArgs).length <= 1) continue;
    selOps.push({ name: 'UPDATE_TASK', args: nextArgs });
  }

  if(!selOps.length){ intelRejectPending(); return; }

  const snaps = [];
  let applied = 0;
  const failures = [];
  selOps.forEach(op => {
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
    const sourceTag = _pendingSource ? ` via ${_pendingSource}` : '';
    _pushUndo(`${applied} change${applied !== 1 ? 's' : ''}${sourceTag}`, snaps);
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
  _pendingDestructive = 'none';
  _pendingSource = null;
  _renderPendingOps();
  _setIntelStatus('ready', failures.length ? `Applied ${applied}, ${failures.length} failed` : `Applied ${applied}`);
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

// ─── Hybrid AI helpers ─────────────────────────────────────────────────────
// Embeddings drive the fast always-on path; the optional LLM (loaded from
// Settings → GenAI) refines low-confidence outputs and supplies per-task
// rationale. These helpers encapsulate the "try LLM → fall back silently"
// pattern so each feature wires it in a single line.

/** Race a promise against a timeout. Returns null on timeout/throw. */
function _llmWithTimeout(promise, ms){
  if(!promise || typeof promise.then !== 'function') return Promise.resolve(null);
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), ms));
  return Promise.race([
    promise.then(v => v == null ? null : v, () => null),
    timeout,
  ]);
}

/** Min per-field confidence across the fields actually being changed by this op. */
function _opMinFieldConfidence(op){
  const fc = op && op._fieldConfidence;
  if(!fc || !op.args) return 1;
  let min = 1;
  for(const k of Object.keys(op.args)){
    if(k === 'id') continue;
    const entry = fc[k];
    if(entry && typeof entry.confidence === 'number' && entry.confidence < min){
      min = entry.confidence;
    }
  }
  return min;
}

/**
 * Walk `ops` (UPDATE_TASK) and ask the LLM to prune low-confidence fields
 * plus attach a short rationale. Only runs when the LLM is loaded and when
 * at least one field on that op scored < `lowConfThreshold`. Hard-capped at
 * `maxRefines` calls so harmonize doesn't hang for a minute on a 500-task
 * workspace. Silently no-ops on any failure.
 */
async function _refineOpsWithLLM(ops, { lowConfThreshold = 0.7, maxRefines = 6, perCallMs = 12000 } = {}){
  if(typeof isGenReady !== 'function' || !isGenReady()) return 0;
  if(typeof genRefineTaskUpdate !== 'function') return 0;
  let refined = 0;
  let attempts = 0;
  for(const op of ops){
    if(op.name !== 'UPDATE_TASK') continue;
    if(attempts >= maxRefines) break;
    if(_opMinFieldConfidence(op) >= lowConfThreshold) continue;
    const t = findTask(op.args.id);
    if(!t) continue;
    const proposed = { ...op.args };
    delete proposed.id;
    const fieldConfMap = {};
    if(op._fieldConfidence){
      for(const k of Object.keys(proposed)){
        const e = op._fieldConfidence[k];
        fieldConfMap[k] = e && typeof e.confidence === 'number' ? Number(e.confidence.toFixed(2)) : null;
      }
    }
    attempts++;
    const res = await _llmWithTimeout(
      genRefineTaskUpdate({ name: t.name, description: t.description, tags: t.tags }, proposed, fieldConfMap),
      perCallMs,
    );
    if(!res) continue;
    // Prune fields the LLM dropped; keep `id` and `valuesNote` (tied to valuesAlignment).
    const nextArgs = { id: op.args.id };
    for(const [k, v] of Object.entries(res.accept || {})) nextArgs[k] = v;
    if(nextArgs.valuesAlignment && op.args.valuesNote) nextArgs.valuesNote = op.args.valuesNote;
    // An LLM that drops everything is a strong "no" — skip the op entirely.
    const kept = Object.keys(nextArgs).filter(k => k !== 'id');
    if(!kept.length){
      op._rejectedByLLM = true;
      op._rationale = res.rationale || 'LLM suggested no change';
      continue;
    }
    op.args = nextArgs;
    if(res.rationale) op._rationale = res.rationale;
    refined++;
  }
  return refined;
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
    const SCHWARTZ_LOCAL = window.SCHWARTZ || {};
    const llmOn = typeof isGenReady === 'function' && isGenReady() && typeof genValuesNote === 'function';
    let notesWritten = 0;
    const MAX_LLM_NOTES = 8;
    for(const t of active){
      const vals = await alignValuesForTask(t.id);
      if(!vals.length) continue;
      const filtered = vals.filter(v => _cfg.dominant.includes(v));
      const use = filtered.length ? filtered : vals.slice(0, 2);
      if(!use.length) continue;
      const before = JSON.stringify([...(t.valuesAlignment || [])].map(String).sort());
      const after = JSON.stringify([...use].map(String).sort());
      if(before === after) continue;
      // Prefer an LLM-written rationale for the top value; fall back to a
      // generic note so behavior is unchanged when the LLM is absent.
      let note = 'Cosine similarity vs Schwartz value descriptions';
      if(llmOn && notesWritten < MAX_LLM_NOTES){
        const topKey = use[0];
        const meta = SCHWARTZ_LOCAL[topKey] || {};
        const explanation = await _llmWithTimeout(
          genValuesNote({ name: t.name, description: t.description }, { key: topKey, label: meta.def ? topKey : topKey, score: 1 }),
          8000,
        );
        if(explanation){ note = explanation; notesWritten++; }
      }
      ops.push({
        name: 'UPDATE_TASK',
        args: {
          id: t.id,
          valuesAlignment: use,
          valuesNote: note,
        },
        _rationale: note !== 'Cosine similarity vs Schwartz value descriptions' ? note : undefined,
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
  const rows = Object.entries(by).sort((x, y) => y[1].count - x[1].count).map(([c, s]) => {
    const def = (typeof getCategoryDef === 'function') ? getCategoryDef(c) : null;
    const lbl = def ? def.label : c;
    const icn = def ? def.icon : (CAT_ICON[c] || 'pin');
    return `
    <div class="breakdown-row">
      <span class="breakdown-cat"><span class="breakdown-cat-ic">${(window.icon && window.icon(icn, {size:14})) || ''}</span> ${esc(lbl)}</span>
      <span class="breakdown-count">${s.count}</span>
      ${s.urgent ? `<span class="breakdown-badge urgent">${s.urgent}!</span>` : ''}
      ${s.high ? `<span class="breakdown-badge high">${s.high}↑</span>` : ''}
    </div>`;
  }).join('');
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
            title="Propose updates using values, life area, priority, effort, energy, and tags from embeddings and similar tasks. Review before apply.">
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

/**
 * LLM-powered task breakdown. Opens from the task-detail modal's
 * "Break down with AI" accordion. Silently no-ops if the LLM isn't ready.
 *
 * UX: list the suggested subtasks with checkboxes (all selected by default)
 * plus an "Add as subtasks" button that creates the chosen items as children
 * of the currently-open task. No speculative mutation — user confirms.
 */
async function runMdBreakdown(){
  const body = document.getElementById('mdBreakdownBody');
  if(!body) return;
  if(typeof isGenReady !== 'function' || !isGenReady()){
    body.innerHTML = '<span class="intel-muted">Load the on-device LLM (Settings → Generative Ask) to break tasks down.</span>';
    return;
  }
  const id = typeof editingTaskId !== 'undefined' ? editingTaskId : null;
  const t = id != null && typeof findTask === 'function' ? findTask(id) : null;
  if(!t){
    body.innerHTML = '<span class="intel-muted">Open a task first.</span>';
    return;
  }

  body.dataset.loaded = '1';
  body.innerHTML = '<span class="intel-muted">Thinking through subtasks…</span>';

  try{
    const res = await _llmWithTimeout(
      genBreakdownTask({ name: t.name, description: t.description }, { maxSubtasks: 6 }),
      20000,
    );
    if(!res || !Array.isArray(res.subtasks) || !res.subtasks.length){
      body.innerHTML = '<span class="intel-muted">LLM didn\u2019t return usable subtasks. Try adding a short description and retry.</span>'
        + ' <button type="button" class="md-breakdown-btn" onclick="runMdBreakdown()" style="margin-top:8px">Retry</button>';
      return;
    }
    window._mdBreakdownSuggestion = { taskId: t.id, subtasks: res.subtasks };
    const rows = res.subtasks.map((s, i) => `
      <label class="md-breakdown-row">
        <input type="checkbox" data-idx="${i}" checked>
        <span class="md-breakdown-name">${esc(s.name)}</span>
        ${s.effort ? `<span class="md-breakdown-effort">${esc(String(s.effort).toUpperCase())}</span>` : ''}
      </label>`).join('');
    body.innerHTML = `
      <div class="md-breakdown-list">${rows}</div>
      ${res.rationale ? `<div class="pending-rationale" style="margin-top:8px">${esc(res.rationale)}</div>` : ''}
      <div class="md-breakdown-actions">
        <button type="button" class="md-breakdown-btn" onclick="runMdBreakdown()">Re-run</button>
        <button type="button" class="md-breakdown-btn md-breakdown-btn--primary" onclick="acceptMdBreakdown()">Add as subtasks</button>
      </div>`;
  }catch(err){
    console.warn('[breakdown]', err);
    body.innerHTML = '<span class="intel-muted">Something went wrong. Try again.</span>'
      + ' <button type="button" class="md-breakdown-btn" onclick="runMdBreakdown()" style="margin-top:8px">Retry</button>';
  }
}

function acceptMdBreakdown(){
  const sugg = window._mdBreakdownSuggestion;
  const body = document.getElementById('mdBreakdownBody');
  if(!sugg || !body) return;
  const parent = typeof findTask === 'function' ? findTask(sugg.taskId) : null;
  if(!parent){ body.innerHTML = '<span class="intel-muted">Parent task not found.</span>'; return; }

  const selected = Array.from(body.querySelectorAll('input[type="checkbox"][data-idx]'))
    .filter(cb => cb.checked)
    .map(cb => sugg.subtasks[parseInt(cb.dataset.idx, 10)])
    .filter(Boolean);
  if(!selected.length){ return; }

  const defaults = typeof defaultTaskProps === 'function' ? defaultTaskProps() : {};
  const nowStr = typeof timeNowFull === 'function' ? timeNowFull() : new Date().toISOString();
  const added = [];
  for(const s of selected){
    const id = (typeof taskIdCtr === 'number') ? (++taskIdCtr) : (Date.now() + Math.floor(Math.random() * 1000));
    const child = Object.assign(
      { id, name: s.name, totalSec: 0, sessions: 0, created: nowStr, parentId: parent.id, collapsed: false },
      defaults,
      { listId: parent.listId, effort: s.effort || null },
    );
    tasks.push(child);
    added.push(child.id);
  }
  if(parent.collapsed) parent.collapsed = false;

  body.innerHTML = `<span class="intel-muted">Added ${added.length} subtask${added.length === 1 ? '' : 's'}.</span>`;
  window._mdBreakdownSuggestion = null;

  if(typeof renderTaskList === 'function') renderTaskList();
  if(typeof saveState === 'function') saveState('user');
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

    const shown = pairs.slice(0, 30);
    // Optional LLM adjudication for the top-N pairs: "same / partial /
    // different" with a short reason. Bounded to keep this interactive.
    const verdicts = new Map();
    if(typeof isGenReady === 'function' && isGenReady() && typeof genDedupeJudge === 'function'){
      sec.innerHTML = '<span style="font-size:12px;color:var(--text-3)">Asking LLM to adjudicate top pairs…</span>';
      const JUDGE = Math.min(6, shown.length);
      for(let i = 0; i < JUDGE; i++){
        const p = shown[i];
        const v = await _llmWithTimeout(
          genDedupeJudge(
            { name: p.taskA.name, description: p.taskA.description },
            { name: p.taskB.name, description: p.taskB.description },
          ),
          10000,
        );
        if(v) verdicts.set(p.idA + '-' + p.idB, v);
      }
    }
    sec.innerHTML = '<div class="intel-dup-hdr">Near duplicates</div>' + shown.map(p => {
      const v = verdicts.get(p.idA + '-' + p.idB);
      const verdict = v ? `<span class="intel-dup-verdict intel-dup-verdict--${esc(v.verdict)}" title="${esc(v.reason)}">${esc(v.verdict)}</span>` : '';
      const reason = v && v.reason ? `<div class="intel-dup-reason">${esc(v.reason)}</div>` : '';
      return `<div class="intel-dup-row">
        <span class="intel-dup-pair">${esc(p.taskA.name.slice(0, 32))} ↔ ${esc(p.taskB.name.slice(0, 32))}</span>
        <span class="intel-dup-sim">${p.sim.toFixed(2)}</span>
        ${verdict}
        <button type="button" class="btn-ghost btn-sm" onclick="intelMergeDuplicatePair(${p.idA},${p.idB})">Archive 2nd</button>
        ${reason}
      </div>`;
    }).join('');
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
    // Optional LLM refinement: prunes low-confidence field changes and
    // attaches a short rationale per op. No-op if the LLM isn't loaded.
    if(typeof isGenReady === 'function' && isGenReady()){
      _setIntelStatus('working', 'Refining low-confidence suggestions with LLM…');
      try{
        const refined = await _refineOpsWithLLM(ops);
        if(refined) console.info(`[harmonize] LLM refined ${refined} op(s)`);
      }catch(e){ console.warn('[harmonize] LLM refine failed', e); }

      // For the handful of ops that set valuesAlignment, upgrade the
      // boilerplate valuesNote to an LLM-generated one-liner so the stored
      // explanation is useful to the human user later.
      try{
        const SCHWARTZ_LOCAL = window.SCHWARTZ || {};
        const valueOps = ops.filter(op => op.name === 'UPDATE_TASK' && Array.isArray(op.args.valuesAlignment) && op.args.valuesAlignment.length).slice(0, 6);
        for(const op of valueOps){
          const t = findTask(op.args.id);
          if(!t) continue;
          const topKey = op.args.valuesAlignment[0];
          const note = await _llmWithTimeout(
            genValuesNote({ name: t.name, description: t.description }, { key: topKey, label: topKey, score: 1 }),
            7000,
          );
          if(note){
            op.args.valuesNote = note;
            if(!op._rationale) op._rationale = note;
          }
        }
      }catch(e){ console.warn('[harmonize] values-note upgrade failed', e); }
    }
    // Drop any ops the LLM marked as rejected (_rejectedByLLM) or whose args
    // have shrunk to just {id} after refinement.
    const filtered = ops.filter(op => !op._rejectedByLLM && Object.keys(op.args).some(k => k !== 'id'));
    if(!filtered.length){
      _setIntelStatus('ready', 'LLM review rejected all suggestions — nothing to apply');
      return;
    }
    _pendingOps = filtered;
    _renderPendingOps();
    _setIntelStatus('ready', `Review ${filtered.length} proposed update${filtered.length === 1 ? '' : 's'}`);
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
    const msg = 'None of your lists have descriptions yet — routing will use list names alone, which can be noisy.\n\n'
      + 'Tip: click the ✎ on a list chip to add a short description like "bills, taxes, budgets" for Finance.\n\n'
      + 'Continue anyway?';
    if(typeof showAppConfirm === 'function'){
      if(!(await showAppConfirm(msg))) return;
    }else if(!confirm(msg)) return;
  }
  _setIntelStatus('working', 'Scoring tasks against lists…');
  try{
    const proposals = await autoOrganizeIntoLists();
    if(!proposals.length){
      _setIntelStatus('ready', 'Every task is already in its best list');
      return;
    }
    const listById = new Map(lists.map(l => [l.id, l]));
    const ops = proposals.map(p => ({ name: 'CHANGE_LIST', args: { id: p.id, listId: p.toListId } }));
    // Optional LLM rationale, bounded: annotate up to 8 proposals so the
    // preview can show "why this list?" without blocking large batches.
    if(typeof isGenReady === 'function' && isGenReady() && typeof genExplainMove === 'function'){
      _setIntelStatus('working', 'Explaining moves with LLM…');
      const MAX = 8;
      const slice = ops.slice(0, MAX);
      for(let i = 0; i < slice.length; i++){
        const op = slice[i];
        const t = findTask(op.args.id);
        const dest = listById.get(op.args.listId);
        if(!t || !dest) continue;
        const note = await _llmWithTimeout(
          genExplainMove({ name: t.name }, dest.name || ''),
          8000,
        );
        if(note) op._rationale = note;
      }
    }
    _pendingOps = ops;
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
  // LLM freeform parse button: only offered when a generative model is loaded.
  // Shown for longer inputs (≥8 chars) where nlparse + embeddings struggle.
  const parseBtn = document.getElementById('taskParseBtn');
  if(parseBtn){
    const llmOn = typeof isGenReady === 'function' && isGenReady();
    const canParse = llmOn && len >= 8;
    parseBtn.style.display = canParse ? '' : 'none';
  }
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
  if(btn){
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.dataset.prevHtml = btn.innerHTML;
    btn.innerHTML = (window.icon && window.icon('harmonize', { size: 14, cls: 'is-spin' })) || '';
  }

  try{
    const sugg = await predictMetadata(raw, 5);
    const PR = ['urgent','high','normal','low','none'];
    const EFF = ['xs','s','m','l','xl'];
    const EN = ['high','low'];

    const cleaned = {};
    if(sugg.priority && PR.includes(sugg.priority) && sugg.priority !== 'none') cleaned.priority = sugg.priority;
    if(sugg.category && typeof hasClassificationCategory === 'function' && hasClassificationCategory(sugg.category)) cleaned.category = sugg.category;
    if(sugg.effort && EFF.includes(sugg.effort)) cleaned.effort = sugg.effort;
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
    if(btn){
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if(btn.dataset.prevHtml != null){
        btn.innerHTML = btn.dataset.prevHtml;
        delete btn.dataset.prevHtml;
      } else {
        btn.innerHTML = (window.icon && window.icon('sparkles')) || '';
      }
    }
  }
}

/**
 * LLM-only companion to smartAddEnhance(). Takes a freeform sentence the
 * deterministic parser can't confidently crack (e.g. "remind me when i get
 * home to call mom about thanksgiving") and uses the on-device LLM to
 * extract a cleaner task name plus optional metadata. Silently no-ops if
 * the LLM isn't loaded.
 */
async function smartAddParseWithLLM(){
  if(_intelBusy) return;
  if(typeof isGenReady !== 'function' || !isGenReady()) return;
  if(typeof genParseFreeform !== 'function') return;

  const inp = document.getElementById('taskInput');
  const btn = document.getElementById('taskParseBtn');
  const prev = document.getElementById('smartAddPreview');
  const raw = (inp?.value || '').trim();
  if(!raw || raw.length < 8) return;

  _intelBusy = true;
  if(btn){
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.dataset.prevHtml = btn.innerHTML;
    btn.innerHTML = (window.icon && window.icon('harmonize', { size: 14, cls: 'is-spin' })) || '';
  }

  try{
    const parsed = await _llmWithTimeout(genParseFreeform(raw), 12000);
    if(!parsed || !parsed.name){
      if(prev){
        prev.innerHTML = '<span class="smart-add-empty">LLM couldn\u2019t parse that — try adding more context.</span>';
        prev.style.display = '';
      }
      return;
    }

    // Rewrite the input to the cleaner imperative name so parseQuickAdd
    // handles submit cleanly. Keep the cursor at end of the new name.
    if(parsed.name && parsed.name !== raw){
      inp.value = parsed.name;
      try{ inp.setSelectionRange(parsed.name.length, parsed.name.length); }catch(_){}
    }

    const PR = ['urgent','high','normal','low'];
    const EFF = ['xs','s','m','l','xl'];
    const cleaned = {};
    if(parsed.priority && PR.includes(parsed.priority)) cleaned.priority = parsed.priority;
    if(parsed.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate)) cleaned.dueDate = parsed.dueDate;
    if(parsed.effort && EFF.includes(parsed.effort)) cleaned.effort = parsed.effort;
    if(Array.isArray(parsed.tags) && parsed.tags.length) cleaned.tags = parsed.tags.slice(0, 5);

    if(Object.keys(cleaned).length === 0){
      window._smartAddPreview = null;
      if(prev){
        prev.innerHTML = parsed.rationale
          ? `<span class="smart-add-empty">${esc(parsed.rationale)}</span>`
          : '<span class="smart-add-empty">Parsed — press Enter to add.</span>';
        prev.style.display = '';
      }
    } else {
      window._smartAddPreview = cleaned;
      _renderSmartAddChips(cleaned);
      if(parsed.rationale && prev){
        prev.insertAdjacentHTML(
          'beforeend',
          `<div class="pending-rationale" style="margin-top:6px">${esc(parsed.rationale)}</div>`,
        );
      }
    }
  }catch(err){
    console.warn('[smart-add:llm]', err);
  }finally{
    _intelBusy = false;
    if(btn){
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if(btn.dataset.prevHtml != null){
        btn.innerHTML = btn.dataset.prevHtml;
        delete btn.dataset.prevHtml;
      } else {
        btn.innerHTML = (window.icon && window.icon('wand')) || '';
      }
    }
  }
}

function _renderSmartAddChips(s){
  const prev = document.getElementById('smartAddPreview');
  if(!prev) return;
  const effortTips = { xs:'Extra small — ~15 min', s:'Small — ~1 hr', m:'Medium — ~half day', l:'Large — ~full day', xl:'Extra large — multi-day' };
  const chips = [];
  if(s.priority) chips.push(`<span class="sa-chip sa-priority sa-p-${esc(s.priority)}" data-tip="Priority — tap to remove" onclick="smartAddRemove('priority')">priority: ${esc(s.priority)} ×</span>`);
  const ic = (n, size) => (window.icon && window.icon(n, {size: size||13})) || '';
  if(s.category){
    const cdef = (typeof getCategoryDef === 'function') ? getCategoryDef(s.category) : null;
    const catLbl = cdef ? cdef.label : s.category;
    const catIc = (cdef && cdef.icon) || CAT_ICON[s.category] || 'pin';
    chips.push(`<span class="sa-chip" data-tip="Category — tap to remove" onclick="smartAddRemove('category')"><span class="sa-chip-ic">${ic(catIc)}</span> ${esc(catLbl)} ×</span>`);
  }
  if(s.effort) chips.push(`<span class="sa-chip" data-tip="${escAttr(effortTips[s.effort] || 'Effort')} — tap to remove" onclick="smartAddRemove('effort')">effort: ${esc(String(s.effort).toUpperCase())} ×</span>`);
  if(s.energyLevel) chips.push(`<span class="sa-chip" data-tip="Energy — tap to remove" onclick="smartAddRemove('energyLevel')"><span class="sa-chip-ic">${ic(s.energyLevel === 'high' ? 'flame' : 'leaf')}</span> ${esc(s.energyLevel)} ×</span>`);
  if(s.dueDate) chips.push(`<span class="sa-chip" data-tip="Due date — tap to remove" onclick="smartAddRemove('dueDate')"><span class="sa-chip-ic">${ic('calendar')}</span> ${esc(s.dueDate)} ×</span>`);
  if(s.tags && s.tags.length) s.tags.forEach(tag => chips.push(`<span class="sa-chip" data-tip="Tag — tap to remove" data-sa-tag="${encodeURIComponent(tag)}">#${esc(tag)} ×</span>`));
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
      ? ranked.map((x, i) => `
        <button type="button" class="what-next-item" onclick="openTaskDetail(${x.t.id});closeWhatNext();">
          <span class="wn-name">${esc(x.t.name)}</span>
          <span class="wn-meta">${x.t.dueDate ? esc(x.t.dueDate) : 'no date'} · ${esc(x.t.priority || 'none')}</span>
          ${i === 0 ? '<span class="wn-why" id="wnWhy" style="display:none"></span>' : ''}
        </button>`).join('')
      : '<span style="color:var(--text-3);font-size:12px">Nothing queued — add tasks or clear filters.</span>';
  }
  o.style.display = '';

  // Opt-in LLM rationale for the top pick. Runs after the modal is visible
  // so the user sees the ranking instantly; explanation appears when ready.
  if(ranked.length >= 1 && typeof isGenReady === 'function' && isGenReady() && typeof genExplainRanking === 'function'){
    const top = ranked[0].t;
    const alts = ranked.slice(1).map(x => ({ name: x.t.name }));
    _llmWithTimeout(genExplainRanking({ name: top.name }, alts), 9000).then(note => {
      if(!note) return;
      const el = document.getElementById('wnWhy');
      if(el){
        el.textContent = note;
        el.style.display = '';
      }
    }).catch(() => {});
  }
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
window.smartAddParseWithLLM = smartAddParseWithLLM;
window.applySmartAddAndSubmit = applySmartAddAndSubmit;
window.maybeShowEnhanceBtn = maybeShowEnhanceBtn;
window.aiAlign = aiAlign;
window.aiToggleValue = aiToggleValue;
window.aiUndo = aiUndo;
window.openWhatNext = openWhatNext;
window.closeWhatNext = closeWhatNext;
window.toggleTaskSearchSemantic = toggleTaskSearchSemantic;
window.intelFindDuplicatesUI = intelFindDuplicatesUI;
window.runMdBreakdown = runMdBreakdown;
window.acceptMdBreakdown = acceptMdBreakdown;
window.intelMergeDuplicatePair = intelMergeDuplicatePair;
window.intelReembedAll = intelReembedAll;
window.intelAutoOrganize = intelAutoOrganize;
window.intelHarmonizeFields = intelHarmonizeFields;
window.intelRetryLoad = intelRetryLoad;
window.intelApplyPending = intelApplyPending;
window.intelRejectPending = intelRejectPending;
window.intelToggleAllPending = intelToggleAllPending;
window.syncHeaderAIChip = syncHeaderAIChip;
window.syncGenChip = syncGenChip;
window.syncSemanticSearchUi = syncSemanticSearchUi;
window.headerAIClick = headerAIClick;
window.acceptProposedOps = acceptProposedOps;

// ========== GENERATIVE AI (Ask) — Settings UI ==========
// All LLM state lives in js/gen.js and js/ask.js. These functions just
// render the Settings subsection and wire the Download button.

// Last failed load, shown inline until the user retries or changes model.
// Keyed by modelId so switching presets clears stale error messages.
// NOTE: named `_askLoadError` (not `_genLastError`) to avoid colliding with
// the top-level `let _genLastError` declared in js/gen.js — both files share
// the same script scope, and a duplicate `let` throws a SyntaxError that
// silently nukes every function in this file (Tools panel + GenAI settings
// never mount). The authoritative plain-string error lives in gen.js and
// is read here via getGenLastError(); this object just lets us scope the
// UI message to the model it was actually about.
let _askLoadError = null;

function renderGenSettings(){
  const host = document.getElementById('genAISettings');
  if(!host) return;
  const cfg = (typeof getGenCfg === 'function') ? getGenCfg() : { enabled:false, modelId:'', dtype:'q4', timeoutSec:30, downloadedIds:[] };
  const presets = (typeof getGenPresets === 'function') ? getGenPresets() : [];
  const ready = typeof isGenReady === 'function' && isGenReady();
  const loading = typeof isGenLoading === 'function' && isGenLoading();
  const dev = typeof getGenDevice === 'function' ? getGenDevice() : null;
  const ramHint = typeof window._mobileRamHint === 'function' ? window._mobileRamHint() : null;
  const cached = typeof isGenDownloaded === 'function' ? isGenDownloaded(cfg.modelId) : !!cfg.downloaded;
  const liveModel = typeof getGenModel === 'function' ? getGenModel() : null;
  const readyThisModel = ready && liveModel === cfg.modelId;

  const preset = presets.find(p => p.id === cfg.modelId) || presets[0];
  const sizeMb = preset ? preset.sizeMb : 230;
  const lastErr = typeof getGenLastError === 'function' ? getGenLastError() : null;

  let statusText;
  if(!cfg.enabled) statusText = 'Disabled — toggle on to download & use.';
  else if(readyThisModel) statusText = `Ready · ${dev || 'CPU'} · ${preset ? preset.label : cfg.modelId}`;
  else if(loading) statusText = 'Loading weights…';
  else if(lastErr) statusText = 'Load failed — see details below.';
  else if(cached) statusText = 'Cached in this browser — click Load to use.';
  else statusText = `Not downloaded (~${sizeMb} MB one-time fetch).`;

  let actionLabel;
  if(!cfg.enabled) actionLabel = 'Enable above first';
  else if(loading) actionLabel = 'Loading…';
  else if(readyThisModel) actionLabel = 'Reload model';
  else if(cached) actionLabel = 'Load model';
  else actionLabel = `Download model (~${sizeMb} MB)`;
  const actionDisabled = !cfg.enabled || loading;

  // Prefer the per-model cached error (hides stale errors after switching presets);
  // fall back to gen.js's last error for load failures that happen before we
  // had a chance to key them by model (e.g. alt-slug retry failures).
  const errForThisModel = (_askLoadError && _askLoadError.modelId === cfg.modelId)
    ? _askLoadError.message
    : (lastErr || '');

  const busy = loading || (typeof isGenGenerating === 'function' && isGenGenerating());
  const disableSelect = !cfg.enabled || busy;
  const historySize = (typeof getAskHistory === 'function') ? getAskHistory().length : 0;

  host.innerHTML = `
    <div class="gen-settings">
      <div class="srow" style="justify-content:space-between;gap:10px">
        <span class="sr-lbl" style="font-size:13px">Enable generative Ask (beta)</span>
        <div class="toggle ${cfg.enabled ? 'on' : ''}" id="genEnableToggle" onclick="toggleGenEnabled()" role="switch" aria-checked="${cfg.enabled}"><div class="tknob"></div></div>
      </div>
      <p class="gen-settings-lead">
        Adds an <strong>Ask</strong> mode to the command palette (<kbd>Ctrl/⌘ + K</kbd>, then prefix <code>?</code>). A tiny instruct-tuned model runs <em>on this device</em>; nothing you type leaves the browser. Proposed changes always preview before anything is applied.
      </p>
      <div class="gen-settings-row">
        <label for="genModelSelect" class="gen-settings-lbl">Model</label>
        <select id="genModelSelect" onchange="selectGenModel(this.value)" ${disableSelect ? 'disabled' : ''} title="${busy ? 'Disabled while busy' : ''}">
          ${presets.map(p => {
            const pCached = typeof isGenDownloaded === 'function' && isGenDownloaded(p.id);
            const tag = pCached ? ' ✓ cached' : '';
            return `<option value="${esc(p.id)}" ${p.id === cfg.modelId ? 'selected' : ''}>${esc(p.label)} · ${p.sizeMb} MB${esc(tag)}</option>`;
          }).join('')}
        </select>
      </div>
      ${preset ? `<div class="gen-settings-note">${esc(preset.note)}</div>` : ''}
      ${ramHint === 'low' ? `<div class="gen-settings-warn">Your device reports low RAM. The 135M preset is recommended.</div>` : ''}
      ${ramHint === 'ios-unknown' && (preset && preset.sizeMb > 150) ? `<div class="gen-settings-warn">On iOS the WASM fallback uses extra RAM. If the tab reloads during generation, switch to the 135M preset.</div>` : ''}
      <div class="gen-settings-row">
        <label for="genTimeout" class="gen-settings-lbl">Timeout (sec)</label>
        <input type="number" id="genTimeout" class="sinput" min="5" max="120" value="${cfg.timeoutSec}" onchange="setGenTimeout(this.value)" ${cfg.enabled ? '' : 'disabled'}>
      </div>
      <div class="gen-settings-status" id="genSettingsStatus">${esc(statusText)}</div>
      <div id="genProgressWrap" class="intel-progress-wrap" style="display:${loading ? '' : 'none'}">
        <div class="intel-progress-track"><div class="intel-progress-bar" id="genProgressBar" style="width:0%"></div></div>
        <div class="intel-progress-info"><span id="genProgressPct">0%</span> <span id="genProgressTxt"></span></div>
      </div>
      ${errForThisModel ? `<div class="gen-settings-warn" id="genSettingsError" role="alert">${esc(errForThisModel)}</div>` : ''}
      <div class="gen-settings-actions">
        ${loading
          ? '<button type="button" class="btn-ghost btn-sm" onclick="genAbortLoad()">Cancel download</button>'
          : `<button type="button" class="btn-primary btn-sm" id="genDownloadBtn" onclick="genDownloadClick()" ${actionDisabled ? 'disabled' : ''}>
              ${esc(actionLabel)}
            </button>`}
        ${readyThisModel && !loading ? '<button type="button" class="btn-ghost btn-sm" onclick="genAbort()">Abort generation</button>' : ''}
      </div>
      <div class="gen-settings-actions gen-settings-actions--secondary">
        <button type="button" class="btn-ghost btn-sm" onclick="genClearAskHistory()" ${historySize ? '' : 'disabled'}>Clear Ask history (${historySize})</button>
        <button type="button" class="btn-ghost btn-sm" onclick="genClearCache()">Clear LLM cache</button>
      </div>
      <p class="gen-settings-hint">
        Weights live in the browser HTTP cache. "Clear LLM cache" removes any caches we control; to force a full purge use the browser's own "Clear site data".
      </p>
    </div>`;

  // Keep the task-input promo chip in sync with gen state on every render
  // (toggle, model switch, download, error, clear — all route through here).
  if(typeof syncAskPromoChip === 'function') syncAskPromoChip();
}

function toggleGenEnabled(){
  if(typeof getGenCfg !== 'function') return;
  const cfg = getGenCfg();
  cfg.enabled = !cfg.enabled;
  saveGenCfg(cfg);
  if(!cfg.enabled){
    // Disabling must stop any in-flight generation and clear stale errors so
    // re-enabling later starts from a clean slate.
    _askLoadError = null;
    if(typeof clearGenLastError === 'function') clearGenLastError();
    if(typeof genAbort === 'function'){ try{ genAbort(); }catch(e){} }
    if(typeof genAbortLoad === 'function'){ try{ genAbortLoad(); }catch(e){} }
  } else if(typeof intelLoad === 'function' && typeof isIntelReady === 'function' && !isIntelReady()){
    // When enabling, warm up the embedding loader in the background so the
    // first Ask turn has semantic retrieval ready. Cheap no-op if loaded.
    intelLoad(() => {}).catch(() => {});
  }
  renderGenSettings();
}

function selectGenModel(id){
  const cfg = getGenCfg();
  const presets = getGenPresets();
  const p = presets.find(x => x.id === id);
  if(!p) return;
  if(cfg.modelId === p.id) return;
  cfg.modelId = p.id;
  cfg.dtype = p.dtype;
  // Do NOT clear the per-model download record — `isGenDownloaded(id)` is the
  // source of truth. Legacy `cfg.downloaded` is re-derived by _loadGenCfg().
  saveGenCfg(cfg);
  _askLoadError = null; // errors were about the previous model
  if(typeof clearGenLastError === 'function') clearGenLastError();
  renderGenSettings();
}

function setGenTimeout(v){
  const cfg = getGenCfg();
  const n = parseInt(v, 10);
  if(!Number.isFinite(n) || n < 5 || n > 120) return;
  cfg.timeoutSec = n;
  saveGenCfg(cfg);
}

async function genDownloadClick(){
  if(typeof genLoad !== 'function') return;
  const cfg = getGenCfg();
  if(!cfg.enabled){ cfg.enabled = true; saveGenCfg(cfg); }
  _askLoadError = null;
  if(typeof clearGenLastError === 'function') clearGenLastError();

  const targetModelId = cfg.modelId;

  // Render once up-front so the Cancel button replaces the Download button
  // and the progress track appears immediately (not after the first chunk).
  renderGenSettings();

  const bar = () => document.getElementById('genProgressBar');
  const pct = () => document.getElementById('genProgressPct');
  const txt = () => document.getElementById('genProgressTxt');
  const statusEl = () => document.getElementById('genSettingsStatus');

  const initTxt = txt(); if(initTxt) initTxt.textContent = 'preparing…';
  syncGenChip('loading', 'Loading LLM…');

  // Monotonic aggregator: HF emits per-file progress that would otherwise snap
  // back to 0% each time a new shard starts downloading.
  const onProgress = _makeProgressAggregator((v, ev) => {
    const b = bar(); if(b) b.style.width = v + '%';
    const p = pct(); if(p) p.textContent = v + '%';
    const status = ev && ev.status ? String(ev.status) : '';
    const file = ev && ev.file ? ' · ' + String(ev.file).split('/').pop() : '';
    const t = txt(); if(t) t.textContent = (status + file).slice(0, 80);
    const s = statusEl(); if(s) s.textContent = `Downloading · ${v}%`;
  });

  try{
    await genLoad(targetModelId, cfg.dtype, onProgress);
    // gen.js.markGenDownloaded() was already called by genLoad for whichever
    // slug actually resolved (primary or alt), so we just mirror the legacy
    // boolean for any external readers still consulting it.
    const freshCfg = getGenCfg();
    freshCfg.downloaded = true;
    saveGenCfg(freshCfg);
    syncGenChip('ready', 'LLM ready');
    if(typeof syncAskPromoChip === 'function') syncAskPromoChip();
    // LLM-dependent surfaces (parse-with-LLM button) may need to appear now.
    if(typeof maybeShowEnhanceBtn === 'function') maybeShowEnhanceBtn();
  }catch(e){
    const msg = (e && e.message) ? e.message : 'Load failed';
    _askLoadError = { modelId: targetModelId, message: msg };
    syncGenChip('error', 'LLM load failed');
  }finally{
    renderGenSettings();
  }
}

/** Called from the Ask palette "Open Settings" fallback so the user lands
 *  directly on the LLM section (G6). */
function openGenSettingsFromAsk(){
  try{
    if(typeof showTab === 'function') showTab('settings');
    if(typeof closeCmdK === 'function') closeCmdK();
    const host = document.getElementById('genAISettings');
    if(!host) return;
    // Expand the Integrations accordion if it's collapsed.
    const details = host.closest('details');
    if(details && !details.open) details.open = true;
    requestAnimationFrame(() => {
      host.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const btn = document.getElementById('genDownloadBtn');
      if(btn && !btn.disabled) btn.focus();
    });
  }catch(e){ /* best-effort */ }
}

async function genClearAskHistory(){
  if(typeof clearAskHistory === 'function'){ clearAskHistory(); }
  renderGenSettings();
  _setIntelStatus('ready', 'Ask history cleared');
}

async function genClearCache(){
  if(typeof clearLLMCache !== 'function') return;
  // Clearing cached weights invalidates our per-model downloaded record — the
  // next Load will actually hit the network again.
  try{
    const cfg = getGenCfg();
    cfg.downloadedIds = [];
    cfg.downloaded = false;
    saveGenCfg(cfg);
  }catch(_){ /* best-effort */ }
  let removed = 0;
  try{ removed = await clearLLMCache(); }catch(e){}
  const msg = removed
    ? `Removed ${removed} cached LLM entr${removed === 1 ? 'y' : 'ies'}. For a full purge use "Clear site data".`
    : 'No app-owned LLM caches to remove. Weights may still be in the browser HTTP cache — use "Clear site data" to purge.';
  _setIntelStatus('ready', msg.slice(0, 120));
  renderGenSettings();
}

window.renderGenSettings = renderGenSettings;
window.toggleGenEnabled = toggleGenEnabled;
window.selectGenModel = selectGenModel;
window.setGenTimeout = setGenTimeout;
window.genDownloadClick = genDownloadClick;
window.openGenSettingsFromAsk = openGenSettingsFromAsk;
window.genClearAskHistory = genClearAskHistory;
window.genClearCache = genClearCache;

document.addEventListener('click', function _smartAddTagDelegate(e){
  const prev = document.getElementById('smartAddPreview');
  if(!prev || !prev.contains(e.target)) return;
  const chip = e.target.closest('[data-sa-tag]');
  if(!chip) return;
  e.preventDefault();
  const enc = chip.getAttribute('data-sa-tag');
  if(enc == null) return;
  try{
    smartAddRemoveTag(decodeURIComponent(enc));
  }catch(_){}
});
