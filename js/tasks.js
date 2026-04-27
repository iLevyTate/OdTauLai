// ========== GOALS ==========
function addGoal(){const inp=gid('goalInput');if(!inp)return;const text=inp.value.trim();if(!text)return;goals.push({id:++goalIdCtr,text,done:false,doneAt:null,addedAt:timeNow(),lastModified:Date.now()});inp.value='';renderGoalList();saveState('user')}
function toggleGoal(id){const g=goals.find(x=>x.id===id);if(g){g.done=!g.done;g.doneAt=g.done?timeNow():null;g.lastModified=Date.now()}renderGoalList();saveState('user')}
function removeGoal(id){
  if(typeof syncGoalDels==='object'&&syncGoalDels)syncGoalDels[id]=Date.now();
  goals=goals.filter(g=>g.id!==id);
  renderGoalList();
  saveState('user');
}
function renderGoalList(){
  const list=gid('goalList');if(!list)return; // panel removed — skip everything
  const cnt=gid('goalCount');if(cnt)cnt.textContent=goals.filter(g=>g.done).length+' / '+goals.length;
  list.querySelectorAll('.goal-item').forEach(e=>e.remove());
  const empty=gid('goalEmpty'),prog=gid('goalProgress');
  if(!goals.length){if(empty)empty.style.display='';if(prog)prog.style.display='none';return}
  if(empty)empty.style.display='none';if(prog)prog.style.display='flex';
  const pct=goals.length?Math.round((goals.filter(g=>g.done).length/goals.length)*100):0;
  const bar=gid('goalBar'),pctEl=gid('goalPct');
  if(bar)bar.style.width=pct+'%';if(pctEl)pctEl.textContent=pct+'%';
  [...goals.filter(g=>!g.done),...goals.filter(g=>g.done)].forEach(g=>{
    const d=document.createElement('div');d.className='goal-item'+(g.done?' checked':'');
    const chk=document.createElement('button');chk.className='goal-check'+(g.done?' on':'');chk.textContent=g.done?'✓':'';chk.onclick=function(){toggleGoal(g.id)};d.appendChild(chk);
    const txt=document.createElement('span');txt.className='goal-text';txt.textContent=g.text;d.appendChild(txt);
    if(g.doneAt){const gt=document.createElement('span');gt.className='goal-time';gt.textContent=g.doneAt;d.appendChild(gt)}
    const rm=document.createElement('button');rm.className='goal-rm';rm.textContent='×';rm.onclick=function(){removeGoal(g.id)};d.appendChild(rm);
    list.appendChild(d)
  })
}

// ========== CLICKUP-STYLE TASKS ==========
// Status definitions (colors match CSS)
const STATUSES={
  open:{label:'Open',cls:'status-open'},
  progress:{label:'In Progress',cls:'status-progress'},
  review:{label:'Review',cls:'status-review'},
  blocked:{label:'Blocked',cls:'status-blocked'},
  done:{label:'Done',cls:'status-done'}
};
const STATUS_ORDER=['open','progress','review','blocked','done'];
const PRIORITIES={
  urgent:{label:'Urgent',icon:'⚑',cls:'priority-urgent'},
  high:{label:'High',icon:'⚑',cls:'priority-high'},
  normal:{label:'Normal',icon:'⚑',cls:'priority-normal'},
  low:{label:'Low',icon:'⚑',cls:'priority-low'},
  none:{label:'None',icon:'⚐',cls:'priority-none'}
};
const PRIORITY_ORDER={urgent:0,high:1,normal:2,low:3,none:4};

// ===== Pareto / Impact scoring =====
// Derives a single "impact" score per task from existing signals only —
// no new fields, no persisted state. The 80/20 idea: high-leverage items
// (impact ÷ effort) rise to the top. All inputs already live on the task.
const _PARETO_PRIORITY_W = {urgent:4, high:3, normal:1.5, low:0.5, none:0.5};
const _PARETO_EFFORT_MULT = {xs:1.35, s:1.15, m:1.0, l:0.85, xl:0.7};

function computeImpactScore(t, ctx){
  if(!t || t.archived || t.status==='done') return 0;
  const today = ctx && ctx.today ? ctx.today : todayISO();
  const blockersMap = ctx && ctx.blockersMap ? ctx.blockersMap : null;

  const priorityW = _PARETO_PRIORITY_W[t.priority||'none'] ?? 0.5;

  let dueW = 0;
  if(t.dueDate){
    if(t.dueDate < today) dueW = 3;                 // overdue
    else if(t.dueDate === today) dueW = 2.2;        // today
    else{
      // Linear falloff over the next 7 days
      const d1 = new Date(today+'T00:00:00');
      const d2 = new Date(t.dueDate+'T00:00:00');
      const days = Math.round((d2-d1)/86400000);
      if(days <= 7) dueW = Math.max(0, 1.6 - days*0.18);
    }
  }

  // Unblocking: how many *active* tasks are blocked by this one.
  // Unblocking 1+ others is leverage; cap the contribution.
  let unblocksW = 0;
  if(blockersMap){
    const n = blockersMap.get(t.id) || 0;
    if(n > 0) unblocksW = Math.min(2, 0.8 + 0.4*n);
  }

  // Values alignment: small boost for each dominant value tagged (cap 3).
  const vals = Array.isArray(t.valuesAlignment) ? t.valuesAlignment.length : 0;
  const valuesW = Math.min(vals, 3) * 0.35;

  const starW = t.starred ? 0.6 : 0;

  const raw = priorityW + dueW + unblocksW + valuesW + starW;
  const mult = _PARETO_EFFORT_MULT[t.effort] ?? 1.0;
  return raw * mult;
}

// Per-render cache so sort + filter + badge all agree on the same top set.
let _paretoTopSet = new Set();
let _paretoScoreMap = new Map();

function refreshParetoTopSet(){
  _paretoTopSet = new Set();
  _paretoScoreMap = new Map();
  const today = todayISO();
  // Build blockersMap: id -> count of active tasks that list `id` in blockedBy
  const blockersMap = new Map();
  for(const x of tasks){
    if(x.archived || x.status==='done') continue;
    const bb = Array.isArray(x.blockedBy) ? x.blockedBy : [];
    for(const id of bb) blockersMap.set(id, (blockersMap.get(id)||0) + 1);
  }
  const ctx = {today, blockersMap};
  const pool = [];
  for(const t of tasks){
    if(t.archived || t.status==='done') continue;
    const s = computeImpactScore(t, ctx);
    _paretoScoreMap.set(t.id, s);
    pool.push(t);
  }
  if(pool.length === 0) return;
  pool.sort((a,b)=>(_paretoScoreMap.get(b.id)||0)-(_paretoScoreMap.get(a.id)||0));
  // Top 20% (min 1, max 20 so the chip stays meaningful on huge lists)
  const cut = Math.min(20, Math.max(1, Math.ceil(pool.length*0.2)));
  for(let i=0; i<cut; i++) _paretoTopSet.add(pool[i].id);
}

function isParetoTop(id){return _paretoTopSet.has(id)}
function getImpactScore(id){return _paretoScoreMap.get(id)||0}

function defaultTaskProps(){return{
  status:'open',priority:'none',tags:[],dueDate:null,startDate:null,
  estimateMin:0,description:'',starred:false,completedAt:null,
  listId:activeListId,archived:false,
  recur:null,order:Date.now(),
  remindAt:null,reminderFired:false,
  type:'task',effort:null,energyLevel:null,
  blockedBy:[],checklist:[],notes:[],url:null,completionNote:null,
  // v5 — values alignment
  category:null,        // life area id (customizable in Settings)
  valuesAlignment:[],   // which user values this task serves e.g. ['security','benevolence']
  valuesNote:null,      // Short note from values alignment
  completions:[],      // recurring habit log: { date, sec }
  habitLastRecordedTotalSec:null, // baseline for per-completion delta (see completeHabitCycle)
}}

let _dupRefreshTimer = null;
function scheduleIntelDupRefresh(){
  if(_dupRefreshTimer) return;
  _dupRefreshTimer = setTimeout(async () => {
    _dupRefreshTimer = null;
    if(typeof computeDuplicateScores !== 'function' || typeof isIntelReady !== 'function' || !isIntelReady()) return;
    try{
      window._dupSimMap = await computeDuplicateScores();
      if(typeof renderTaskList === 'function') renderTaskList();
    }catch(e){ console.warn('[tasks] duplicate score refresh failed', e); }
  }, 2000);
}
window.scheduleIntelDupRefresh = scheduleIntelDupRefresh;
window.invalidateDupMap = function(){ window._dupSimMap = null; };

// Parse natural language tokens from input: @priority, #tag, !star, ~recur, today/tomorrow/mon-sun
function parseQuickAdd(raw){
  let text=raw;
  const props={};
  // Priority @urgent @high @normal @low
  const prMatch=text.match(/\s@(urgent|high|normal|low)\b/i);
  if(prMatch){props.priority=prMatch[1].toLowerCase();text=text.replace(prMatch[0],'')}
  // Tags #tag  (multiple)
  const tagRe=/\s#(\w+)/g;const tags=[];let m;
  while((m=tagRe.exec(text))!==null)tags.push(m[1]);
  if(tags.length){props.tags=tags;text=text.replace(/\s#\w+/g,'')}
  // Star !star !pin
  if(/\s!(star|pin)\b/i.test(text)){props.starred=true;text=text.replace(/\s!(star|pin)\b/i,'')}
  // Recurrence ~daily ~weekdays ~weekly ~monthly
  const rcMatch=text.match(/\s~(daily|weekdays|weekly|monthly)\b/i);
  if(rcMatch){props.recur=rcMatch[1].toLowerCase();text=text.replace(rcMatch[0],'')}
  // Due date: today, tomorrow, mon-sun, next week
  const days={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
  const todayISOs=todayISO();
  const lower=' '+text.toLowerCase()+' ';
  if(/\btoday\b/i.test(lower)){props.dueDate=todayISOs;text=text.replace(/\btoday\b/i,'')}
  else if(/\btomorrow\b|\btmrw\b/i.test(lower)){
    const d=new Date();d.setDate(d.getDate()+1);
    props.dueDate=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    text=text.replace(/\btomorrow\b|\btmrw\b/i,'');
  }else if(/\bnext week\b/i.test(lower)){
    const d=new Date();d.setDate(d.getDate()+7);
    props.dueDate=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    text=text.replace(/\bnext week\b/i,'');
  }else{
    const dayMatch=text.match(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day)?\b/i);
    if(dayMatch){
      const target=days[dayMatch[1].toLowerCase().slice(0,3)];
      const d=new Date();const today=d.getDay();
      let diff=(target-today+7)%7;if(diff===0)diff=7;
      d.setDate(d.getDate()+diff);
      props.dueDate=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      text=text.replace(dayMatch[0],'');
    }
  }
  return{name:text.replace(/\s+/g,' ').trim(),props};
}

async function addTask(){
  const inp=gid('taskInput'),raw=inp.value.trim();if(!raw)return;
  if(/\r?\n/.test(raw)){
    const { items, skippedLong } = parseBulkTaskPaste(raw);
    if(items.length >= 2){
      openBulkImportModal(items, skippedLong);
      inp.value='';
      return;
    }
  }
  ensureDefaultList();
  let name, props;
  if(typeof parseQuickAddAsync === 'function'){
    const parsed = await parseQuickAddAsync(raw);
    name = parsed.name;
    props = parsed.props;
  } else {
    const p = parseQuickAdd(raw);
    name = p.name;
    props = p.props;
  }
  if(!name){ name = raw; props = {}; }
  const _newT=Object.assign({
    id:++taskIdCtr,name,totalSec:0,sessions:0,created:timeNowFull(),
    parentId:null,collapsed:false
  },defaultTaskProps(),props);
  tasks.push(_newT);
  _taskIndexRegister(_newT);
  inp.value='';
  // Brain-dump mode: keep focus in the input so the mobile keyboard stays up
  // and the next task can be typed immediately. Without this, every Enter
  // dismisses the keyboard on iOS/Android.
  try{ inp.focus({preventScroll:true}); }catch(_){ inp.focus(); }
  // Clear any live parse-preview chips left over from this entry.
  if(typeof clearLiveParsePreview==='function') clearLiveParsePreview();
  maybeShowSwipeTip();
  if(typeof cfg==='object'&&cfg&&!cfg.qaHintHidden){
    cfg.qaHintTaskCount=(cfg.qaHintTaskCount||0)+1;
    if(cfg.qaHintTaskCount>=3) cfg.qaHintHidden=true;
  }
  if(typeof syncQaHintVisibility==='function') syncQaHintVisibility();
  // Hint to renderTaskItem: animate this card on the upcoming render and
  // scroll it into view. The flag self-clears in the renderer.
  window._lastAddedTaskId=_newT.id;
  renderTaskList();
  // a11y: announce the add to screen readers via the polite live region.
  if(typeof announceTaskAdd==='function') announceTaskAdd(_newT.name);
  // Undo affordance: a 5-second window to recover from an accidental Enter.
  // Mirrors Gmail's "Undo Send". Captures the new ID up-front so the closure
  // doesn't go stale if the user adds another task before the undo fires.
  if(typeof showActionToast==='function'){
    const _undoId = _newT.id;
    showActionToast('Task added', 'Undo', () => {
      const idx = tasks.findIndex(x => x.id === _undoId);
      if(idx >= 0){
        tasks.splice(idx, 1);
        if(typeof _taskIndexRemove === 'function') _taskIndexRemove(_undoId);
        renderTaskList();
        saveState('user');
        if(typeof announce === 'function') announce('Task removed');
      }
    }, 5000);
  }
  saveState('user')
}

function showQaHint(){
  const h=gid('qa-hint'),r=gid('qa-hint-reveal');
  if(h) h.style.display='';
  if(r) r.style.display='none';
  if(typeof cfg==='object'&&cfg){cfg.qaHintHidden=false;saveState('user')}
}
function syncQaHintVisibility(){
  const h=gid('qa-hint'),r=gid('qa-hint-reveal');
  if(!h) return;
  if(typeof cfg==='object'&&cfg&&cfg.qaHintHidden){
    h.style.display='none';
    if(r) r.style.display='inline';
  }else{
    h.style.display='';
    if(r) r.style.display='none';
  }
}
window.showQaHint=showQaHint;
window.syncQaHintVisibility=syncQaHintVisibility;

/**
 * Keyboard handler for the task input. Centralized here so the inline HTML
 * stays small and the behavior is testable.
 *
 *   Enter         → addTask() (or applySmartAddAndSubmit when LLM preview exists)
 *   Escape        → clear the input (a quick discard of an aborted thought)
 *   Cmd/Ctrl+Enter → reserved for "add and open detail" — see follow-up
 */
function onTaskInputKey(event){
  if(event.key==='Enter' && !event.isComposing){
    if(window._smartAddPreview) applySmartAddAndSubmit();
    else addTask();
    return;
  }
  if(event.key==='Escape'){
    const inp=event.target;
    if(inp && inp.value){
      event.preventDefault();
      inp.value='';
      if(typeof clearLiveParsePreview==='function') clearLiveParsePreview();
      if(typeof maybeShowEnhanceBtn==='function') maybeShowEnhanceBtn();
    }
  }
}
window.onTaskInputKey=onTaskInputKey;

/**
 * Live parse-token preview. Runs the synchronous parseQuickAdd against the
 * current input text and renders chips for every token it matched
 * (priority, tags, star, recurrence, due-date). Gives users visible
 * confirmation that "@urgnet" (a typo) didn't match while "@urgent" did.
 *
 * All chip text is set via textContent to avoid any XSS surface — chip
 * structure is built with createElement, never innerHTML.
 */
function _qpcChip(cls, text, title){
  const s = document.createElement('span');
  s.className = 'qpc qpc--' + cls;
  if(title) s.title = title;
  s.textContent = text;
  return s;
}
function updateLiveParsePreview(){
  const inp=gid('taskInput');
  const host=gid('qaParseChips');
  if(!inp||!host) return;
  const raw=inp.value;
  if(!raw||raw.length<2){ clearLiveParsePreview(); return; }
  const {props,name}=parseQuickAdd(raw);
  // Build offline so we can decide whether to show the row at all.
  const chips=[];
  if(props.priority){
    const cls = ({urgent:'danger',high:'warning',normal:'accent',low:'muted'})[props.priority] || 'accent';
    chips.push(_qpcChip(cls, '@'+props.priority, 'Priority'));
  }
  if(props.tags && props.tags.length){
    props.tags.forEach(t => chips.push(_qpcChip('tag', '#'+t, 'Tag')));
  }
  if(props.starred) chips.push(_qpcChip('star', '★', 'Pinned to top'));
  if(props.recur)   chips.push(_qpcChip('recur', '↻ '+props.recur, 'Repeats'));
  if(props.dueDate){
    let label=props.dueDate;
    if(typeof prettyDate==='function'){ try{ label=prettyDate(props.dueDate); }catch(_){} }
    chips.push(_qpcChip('due', label, 'Due date'));
  }
  if(!chips.length){ clearLiveParsePreview(); return; }
  // Build via DOM, not innerHTML — keeps user-controlled text safe even though
  // parseQuickAdd already strips/normalizes its outputs.
  host.replaceChildren();
  if(name && name !== raw){
    const n = document.createElement('span');
    n.className = 'qpc-name';
    n.title = 'Task title (after token strip)';
    n.textContent = name;
    host.appendChild(n);
  }
  const list = document.createElement('span');
  list.className = 'qpc-list';
  chips.forEach(c => list.appendChild(c));
  host.appendChild(list);
  host.hidden = false;
}
function clearLiveParsePreview(){
  const host=gid('qaParseChips');
  if(!host) return;
  host.replaceChildren();
  host.hidden=true;
}
window.updateLiveParsePreview=updateLiveParsePreview;
window.clearLiveParsePreview=clearLiveParsePreview;

const SWIPE_TIP_KEY = (window.ODTAULAI_CONFIG && window.ODTAULAI_CONFIG.STORAGE_KEYS && window.ODTAULAI_CONFIG.STORAGE_KEYS.SWIPE_TIP_DISMISSED) || 'odtaulai_swipe_tip_dismissed';
function maybeShowSwipeTip(){
  try{
    if(localStorage.getItem(SWIPE_TIP_KEY)==='1') return;
    const tip=document.getElementById('swipeTipBanner');
    if(tip) tip.style.display='';
  }catch(e){}
}
function dismissSwipeTip(){
  try{ localStorage.setItem(SWIPE_TIP_KEY,'1'); }catch(e){}
  const tip=document.getElementById('swipeTipBanner');
  if(tip) tip.style.display='none';
}

const BULK_LINE_MAX = 200;
function parseBulkTaskPaste(raw){
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bulletRe = /^\s*(?:[-*•·]|[\d]+[.)])\s+/;
  const items = [];
  let skippedLong = 0;
  for(const line of lines){
    const cleaned = line.replace(bulletRe, '').trim();
    if(!cleaned) continue;
    if(cleaned.length > BULK_LINE_MAX){ skippedLong++; continue; }
    items.push(cleaned);
  }
  return { items, skippedLong };
}

function taskInputPaste(e){
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if(!text || !/\r?\n/.test(text)) return;
  const { items, skippedLong } = parseBulkTaskPaste(text);
  if(items.length < 2) return;
  e.preventDefault();
  openBulkImportModal(items, skippedLong);
}

function openBulkImportModal(items, skippedLong){
  const ov = gid('bulkImportModal');
  const ta = gid('bulkImportTextarea');
  const hint = gid('bulkImportHint');
  if(!ov || !ta) return;
  ta.value = items.join('\n');
  let hintHtml = 'Each line becomes one task. Quick-add tokens work per line (<code>@urgent</code>, <code>#tag</code>, <code>tomorrow</code>, etc.).';
  if(skippedLong > 0){
    hintHtml = '<strong class="bulk-import-warn">' + skippedLong + ' line(s) skipped</strong> (over ' + BULK_LINE_MAX + ' characters). ' + hintHtml;
  }
  if(hint) hint.innerHTML = hintHtml;
  _updateBulkImportButtonState();
  ta.oninput = _updateBulkImportButtonState;
  ov.classList.add('open');
  setTimeout(() => ta.focus(), 30);
  // Modal focus management — trap Tab/Shift+Tab inside the dialog so users
  // can't accidentally tab back to the page behind it.
  if(typeof installTabTrap === 'function') setTimeout(() => installTabTrap(ov), 40);
  if(typeof openFocusTrap !== 'function' && typeof installTabTrap !== 'function'){
    // Both utils unavailable — leave focus management to the user agent.
  }
  // Capture previous focus manually so we can restore on close even if the
  // trap util chose skipPrevFocus mode.
  ov._prevFocus = document.activeElement;
}

function _updateBulkImportButtonState(){
  const ta = gid('bulkImportTextarea');
  const btn = gid('bulkImportConfirm');
  const title = gid('bulkImportTitle');
  if(!ta || !btn) return;
  const n = ta.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).length;
  btn.disabled = n === 0;
  btn.textContent = n ? 'Add ' + n + ' task' + (n !== 1 ? 's' : '') : 'Add tasks';
  if(title) title.textContent = n ? 'Import ' + n + ' task' + (n !== 1 ? 's' : '') : 'Import tasks';
}

function closeBulkImportModal(){
  const ov = gid('bulkImportModal');
  if(ov) ov.classList.remove('open');
  const ta = gid('bulkImportTextarea');
  if(ta) ta.oninput = null;
  if(typeof removeTabTrap === 'function') removeTabTrap();
  // Restore focus to whatever launched the modal (the task input, typically).
  if(ov && ov._prevFocus){
    try { ov._prevFocus.focus(); } catch(_){}
    ov._prevFocus = null;
  }
}

async function confirmBulkImport(){
  const ta = gid('bulkImportTextarea');
  if(!ta) return;
  const lines = ta.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if(!lines.length) return;
  ensureDefaultList();
  closeBulkImportModal();
  for(const line of lines){
    let name, props;
    if(typeof parseQuickAddAsync === 'function'){
      const parsed = await parseQuickAddAsync(line);
      name = parsed.name;
      props = parsed.props;
    } else {
      const p = parseQuickAdd(line);
      name = p.name;
      props = p.props;
    }
    if(!name){ name = line; props = {}; }
    const _bt=Object.assign({
      id:++taskIdCtr,name,totalSec:0,sessions:0,created:timeNowFull(),
      parentId:null,collapsed:false
    },defaultTaskProps(),props);
    tasks.push(_bt);
    _taskIndexRegister(_bt);
  }
  const inp = gid('taskInput');
  if(inp) inp.value = '';
  maybeShowSwipeTip();
  renderTaskList();
  saveState('user');
  if(typeof maybeShowEnhanceBtn === 'function') maybeShowEnhanceBtn();
  if(typeof scheduleIntelDupRefresh === 'function') scheduleIntelDupRefresh();
}

window.closeBulkImportModal = closeBulkImportModal;
window.confirmBulkImport = confirmBulkImport;

const _taskById=new Map();
function _taskIndexRegister(t){
  if(t&&t.id!=null) _taskById.set(t.id,t);
}
function _taskIndexRemove(id){
  if(id!=null) _taskById.delete(id);
}
function rebuildTaskIdIndex(){
  _taskById.clear();
  if(Array.isArray(tasks)) tasks.forEach(_taskIndexRegister);
}
window.rebuildTaskIdIndex=rebuildTaskIdIndex;

function findTask(id){
  if(id==null) return undefined;
  let hit=_taskById.get(id);
  if(hit!==undefined) return hit;
  if(typeof id==='string'&&/^-?\d+$/.test(id)){
    const n=parseInt(id,10);
    hit=_taskById.get(n);
    if(hit!==undefined) return hit;
  }
  return tasks.find(t=>t.id===id);
}

// Tree helpers
function getTaskChildren(parentId){return tasks.filter(t=>(t.parentId||null)===parentId)}
function hasChildren(taskId){return tasks.some(t=>t.parentId===taskId)}
function getTaskDescendantIds(taskId){
  const result=[],seen=new Set(),queue=[taskId];
  while(queue.length){
    const id=queue.shift();
    for(const t of tasks){
      if(t.parentId!==id) continue;
      const cid=t.id;
      if(seen.has(cid)) continue;
      seen.add(cid);
      result.push(cid);
      queue.push(cid);
    }
  }
  return result;
}
function getRolledUpTime(taskId){
  const t=findTask(taskId);if(!t)return 0;
  let total=getTaskElapsed(t);
  getTaskDescendantIds(taskId).forEach(id=>{const d=findTask(id);if(d)total+=getTaskElapsed(d)});
  return total;
}
function getRolledUpSessions(taskId){
  const t=findTask(taskId);if(!t)return 0;
  let total=t.sessions||0;
  getTaskDescendantIds(taskId).forEach(id=>{const d=findTask(id);if(d)total+=d.sessions||0});
  return total;
}
const _TASK_PATH_MAX=64;
function getTaskPath(taskId){
  const path=[],seen=new Set();
  let cur=findTask(taskId),depth=0;
  while(cur&&depth<_TASK_PATH_MAX){
    if(seen.has(cur.id)) break;
    seen.add(cur.id);
    path.unshift(cur.name);
    cur=cur.parentId?findTask(cur.parentId):null;
    depth++;
  }
  return path;
}

/** Non-archived tasks pointing at a missing or archived parent become roots (sync/import repair). */
function repairOrphanedTaskParents(){
  if(!Array.isArray(tasks)) return 0;
  let n=0;
  for(const t of tasks){
    if(t.archived||t.parentId==null) continue;
    const p=findTask(t.parentId);
    if(!p||p.archived){
      console.warn('[tasks] Orphan repair: cleared parent for task',t.id);
      t.parentId=null;
      n++;
    }
  }
  return n;
}
window.repairOrphanedTaskParents=repairOrphanedTaskParents;
function getTaskElapsed(t){let s=t.totalSec;if(activeTaskId===t.id&&taskStartedAt)s+=Math.floor((Date.now()-taskStartedAt)/1000);return s}

// Due date helpers
/** Local calendar day YYYY-MM-DD — same as `todayKey()` in utils.js */
function todayISO(){
  if (typeof todayKey === 'function') return todayKey();
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
/**
 * @returns {{ label: string, cls: 'overdue'|'today'|'soon'|'future'|null, relDays: number|null }}
 */
function describeDue(dateStr){
  if(!dateStr) return { label: '', cls: null, relDays: null };
  const today = todayISO();
  const t0 = new Date(today + 'T00:00:00');
  const due = new Date(String(dateStr) + 'T00:00:00');
  if (isNaN(due.getTime())) return { label: String(dateStr), cls: null, relDays: null };
  const relDays = Math.round((due - t0) / 86400000);
  const y0 = t0.getFullYear();
  const yDue = due.getFullYear();

  if (relDays < 0) {
    const a = Math.abs(relDays);
    const label = a === 1 ? 'Yesterday' : 'Overdue ' + a + 'd';
    return { label, cls: 'overdue', relDays };
  }
  if (relDays === 0) return { label: 'Today', cls: 'today', relDays: 0 };

  const tNext = new Date(t0);
  tNext.setDate(tNext.getDate() + 1);
  const tNextISO = tNext.getFullYear() + '-' + String(tNext.getMonth() + 1).padStart(2, '0') + '-' + String(tNext.getDate()).padStart(2, '0');
  if (String(dateStr) === tNextISO) return { label: 'Tomorrow', cls: 'soon', relDays: 1 };

  if (relDays >= 2 && relDays <= 6) {
    return { label: due.toLocaleDateString(undefined, { weekday: 'short' }), cls: 'soon', relDays };
  }
  if (relDays === 7) {
    return { label: due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cls: 'soon', relDays };
  }

  const label = yDue === y0
    ? due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : due.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return { label, cls: 'future', relDays };
}

function getDueClass(dateStr) {
  if (!dateStr) return null;
  return describeDue(dateStr).cls;
}
function fmtDue(dateStr) {
  if (!dateStr) return '';
  return describeDue(dateStr).label;
}

// Subtask UI (nested)
function addSubtaskPrompt(parentId){
  event&&event.stopPropagation();
  if(subtaskPromptParent!=null&&subtaskPromptParent!==parentId) _subtaskFormDraftText='';
  subtaskPromptParent=parentId;
  _subtaskFormDraftParent=parentId;
  const p=findTask(parentId);if(p&&p.collapsed)p.collapsed=false;
  renderTaskList();
  setTimeout(()=>{const i=document.querySelector('.task-sub-input[data-parent="'+parentId+'"]');if(i)i.focus()},20);
}
function addSubtask(parentId){
  const input=document.querySelector('.task-sub-input[data-parent="'+parentId+'"]');
  if(!input)return;
  const name=input.value.trim();
  if(!name){
    subtaskPromptParent=null;
    _subtaskFormDraftText='';
    _subtaskFormDraftParent=null;
    renderTaskList();
    return;
  }
  const parent=findTask(parentId);if(!parent)return;
  const _st=Object.assign({
    id:++taskIdCtr,name,totalSec:0,sessions:0,created:timeNowFull(),
    parentId,collapsed:false
  },defaultTaskProps(),{listId:parent.listId});
  tasks.push(_st);
  _taskIndexRegister(_st);
  subtaskPromptParent=null;
  _subtaskFormDraftText='';
  _subtaskFormDraftParent=null;
  renderTaskList();saveState('user')
}
function cancelSubtaskPrompt(){
  subtaskPromptParent=null;
  _subtaskFormDraftText='';
  _subtaskFormDraftParent=null;
  renderTaskList();
}
function toggleCollapse(taskId){event&&event.stopPropagation();const t=findTask(taskId);if(!t)return;t.collapsed=!t.collapsed;renderTaskList();saveState('user')}

// Time tracking
function toggleTask(id){
  event&&event.stopPropagation();
  if(activeTaskId===id){const t=findTask(id);if(t&&taskStartedAt){t.totalSec+=Math.floor((Date.now()-taskStartedAt)/1000);taskStartedAt=null}activeTaskId=null}
  else{if(activeTaskId&&taskStartedAt){const ot=findTask(activeTaskId);if(ot)ot.totalSec+=Math.floor((Date.now()-taskStartedAt)/1000)}activeTaskId=id;taskStartedAt=Date.now();
    // Auto-set status to In Progress when starting time
    const t=findTask(id);if(t&&t.status==='open')t.status='progress';
  }
  renderTaskList();renderBanner();saveState('user');
  if(typeof window._updateActiveTaskTickSchedule==='function')window._updateActiveTaskTickSchedule();
}

async function removeTask(id){
  event&&event.stopPropagation();
  const task=findTask(id);if(!task)return;
  // If viewing archive, this is a permanent delete
  if(task.archived||smartView==='archived'){
    const descendants=getTaskDescendantIds(id);
    if(!(await showAppConfirm('Permanently delete "'+task.name+'"'+(descendants.length>0?' and '+descendants.length+' subtask'+(descendants.length!==1?'s':''):'')+'? Cannot be undone.')))return;
    const toRemove=[id,...descendants];
    if(toRemove.includes(activeTaskId)){
      if(taskStartedAt){const t=findTask(activeTaskId);if(t)t.totalSec+=Math.floor((Date.now()-taskStartedAt)/1000)}
      activeTaskId=null;taskStartedAt=null;
    }
    for(const rid of toRemove) _taskIndexRemove(rid);
    tasks=tasks.filter(t=>!toRemove.includes(t.id));
    if(typeof syncTaskDels==='object'&&syncTaskDels){
      const t = Date.now();
      for(const rid of toRemove) syncTaskDels[rid]=t;
    }
    if(typeof embedStore !== 'undefined' && embedStore && embedStore.purge){
      embedStore.purge(toRemove).catch(()=>{});
    }
  }else{
    // Archive it
    const descendants=getTaskDescendantIds(id);
    if(descendants.length>0&&!(await showAppConfirm('Archive "'+task.name+'" and '+descendants.length+' subtask'+(descendants.length!==1?'s':'')+'?')))return;
    const toArchive=[id,...descendants];
    if(toArchive.includes(activeTaskId)){
      if(taskStartedAt){const t=findTask(activeTaskId);if(t)t.totalSec+=Math.floor((Date.now()-taskStartedAt)/1000)}
      activeTaskId=null;taskStartedAt=null;
    }
    toArchive.forEach(tid=>{const t=findTask(tid);if(t)t.archived=true});
    // Undo affordance for accidental misfires (the × button is small).
    // Skip the toast when descendants forced a confirm dialog — the user
    // already deliberated. Skip in archive view too (different context).
    if(typeof showActionToast==='function' && descendants.length===0 && smartView!=='archived'){
      const _undoIds=toArchive.slice();
      const _name=task.name;
      showActionToast('Task archived', 'Undo', () => {
        _undoIds.forEach(uid => {
          const t = findTask(uid);
          if(t) t.archived = false;
        });
        renderTaskList();
        saveState('user');
        if(typeof announce === 'function') announce('Restored: ' + _name);
      }, 5000);
    }
  }
  renderTaskList();renderBanner();saveState('user')
}

function restoreTask(id){
  event&&event.stopPropagation();
  const t=findTask(id);if(!t)return;
  t.archived=false;
  // Restore any descendants too
  getTaskDescendantIds(id).forEach(did=>{const d=findTask(did);if(d)d.archived=false});
  renderTaskList();saveState('user')
}

/**
 * Snooze (defer) a task: hide it from main views until the given date.
 * Distinct from rescheduling — does NOT touch dueDate or remindAt.
 */
function snoozeTask(id, untilISO){
  if(typeof event!=='undefined' && event && event.stopPropagation) event.stopPropagation();
  const t=findTask(id); if(!t) return;
  if(typeof untilISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(untilISO)) return;
  if(untilISO <= todayISO()) { t.hiddenUntil=null; }
  else { t.hiddenUntil=untilISO; }
  t.lastModified=Date.now();
  renderTaskList(); saveState('user');
}

/**
 * Snooze N days from today. Convenience wrapper for swipe / palette actions.
 */
function snoozeTaskForDays(id, days){
  const n=parseInt(days,10);
  if(!Number.isFinite(n) || n<=0) return;
  const d=new Date();
  d.setDate(d.getDate()+n);
  const iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  snoozeTask(id, iso);
}

function unsnoozeTask(id){
  if(typeof event!=='undefined' && event && event.stopPropagation) event.stopPropagation();
  const t=findTask(id); if(!t) return;
  t.hiddenUntil=null;
  t.lastModified=Date.now();
  renderTaskList(); saveState('user');
}

function emptyArchive(){
  const removed=tasks.filter(t=>t.archived).map(t=>t.id);
  const keep=tasks.filter(t=>!t.archived);
  tasks=keep;
  if(removed.length&&typeof syncTaskDels==='object'&&syncTaskDels){
    const t=Date.now();
    for(const id of removed) syncTaskDels[id]=t;
  }
  if(removed.length&&typeof embedStore!=='undefined'&&embedStore&&embedStore.purge){
    embedStore.purge(removed).catch(()=>{});
  }
  rebuildTaskIdIndex();
  renderTaskList();saveState('user')
}
async function emptyArchiveWithConfirm(){
  const msg='Permanently delete ALL archived tasks? This cannot be undone.';
  if(typeof showAppConfirm==='function'){if(!(await showAppConfirm(msg)))return}
  else if(!confirm(msg))return;
  emptyArchive();
}
window.emptyArchiveWithConfirm=emptyArchiveWithConfirm;

// Smart Views
function setSmartView(v){
  smartView=v;
  document.querySelectorAll('.sv-chip').forEach(el=>{el.classList.toggle('active',el.dataset.view===v)});
  const notice=gid('archivedNotice');if(notice)notice.style.display=v==='archived'?'flex':'none';
  // Sync collapsed/expanded class to the user preference. By default the bar
  // is collapsed-to-active so the task header stays compact; users can opt
  // into the always-expanded layout with the `All views ▾` toggle.
  _applySmartViewsCollapsed(!smartViewsExpanded);
  renderTaskList();saveState('user')
}

/**
 * Apply or remove the collapsed-state class to the smart-views bar and sync
 * the toggle button's aria-expanded attribute. Pure DOM — does not persist.
 */
function _applySmartViewsCollapsed(collapsed){
  const root = gid('smartViews');
  if(root) root.classList.toggle('smart-views--collapsed', !!collapsed);
  const toggle = gid('svToggle');
  if(toggle){
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.title = collapsed ? 'Show all views' : 'Hide other views';
    const arrow = toggle.querySelector('.sv-toggle-arrow');
    if(arrow) arrow.textContent = collapsed ? '▾' : '▴';
  }
}

function toggleSmartViews(){
  smartViewsExpanded = !smartViewsExpanded;
  _applySmartViewsCollapsed(!smartViewsExpanded);
  if(typeof saveState === 'function') saveState('user');
}
window.toggleSmartViews = toggleSmartViews;

// Star toggle
function toggleStar(id){
  event&&event.stopPropagation();
  const t=findTask(id);if(!t)return;
  t.starred=!t.starred;
  // Star toggles can shift this card to/from the top of the list — animate.
  const list=gid('taskList');
  if(list&&typeof flipReorder==='function')flipReorder(list,()=>renderTaskList());
  else renderTaskList();
  saveState('user')
}

// Reorder (manual)
function reorderTask(id,dir){
  event&&event.stopPropagation();
  const t=findTask(id);if(!t)return;
  // Find siblings with same parentId, sorted by order
  const siblings=tasks.filter(x=>x.parentId===t.parentId&&!x.archived&&matchesFilters(x)).sort((a,b)=>(a.order||0)-(b.order||0));
  const idx=siblings.findIndex(x=>x.id===id);
  const target=idx+dir;
  if(target<0||target>=siblings.length)return;
  // Swap order values
  const a=siblings[idx],b=siblings[target];
  const tmp=a.order;a.order=b.order;b.order=tmp;
  renderTaskList();saveState('user')
}

// Drag-drop handler for list view
function handleTaskDrop(srcId,targetId,position){
  const src=findTask(srcId),target=findTask(targetId);
  if(!src||!target)return;
  // Don't allow dropping a task onto its own descendant (would create a cycle)
  if(getTaskDescendantIds(srcId).includes(targetId))return;
  // Move to same parent as target, ordered right above/below target
  src.parentId=target.parentId;
  const targetOrder=target.order||0;
  src.order=position==='before'?targetOrder-0.5:targetOrder+0.5;
  // Re-normalize order values in this sibling group
  const siblings=tasks.filter(x=>x.parentId===src.parentId).sort((a,b)=>(a.order||0)-(b.order||0));
  siblings.forEach((s,i)=>{s.order=i*10});
  // Force manual sort when user drags
  if(taskSortBy!=='manual'){taskSortBy='manual';const sel=gid('taskSortSel');if(sel)sel.value='manual'}
  // Drop landing: animate the dragged card into its new slot.
  const list=gid('taskList');
  if(list&&typeof flipReorder==='function')flipReorder(list,()=>renderTaskList());
  else renderTaskList();
  saveState('user')
}

// Subtask completion progress
function getSubtaskProgress(taskId){
  const descIds=getTaskDescendantIds(taskId);
  if(!descIds.length)return null;
  const total=descIds.length;
  const done=descIds.filter(id=>{const t=findTask(id);return t&&t.status==='done'}).length;
  return{done,total,pct:Math.round(done/total*100)};
}

// Quick date buttons
function setQuickDate(offset){
  if(offset==='clear'){gid('mdDue').value='';return}
  const d=new Date();d.setDate(d.getDate()+offset);
  gid('mdDue').value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// Quick snooze buttons (G-3) — mirrors setQuickDate but writes to mdSnoozeUntil
function setQuickSnooze(offset){
  const el=gid('mdSnoozeUntil'); if(!el) return;
  if(offset==='clear'){ el.value=''; return; }
  const d=new Date(); d.setDate(d.getDate()+parseInt(offset,10));
  el.value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
window.setQuickSnooze=setQuickSnooze;

// ========== REMINDERS ==========
function setQuickReminder(offset,hour){
  if(offset==='clear'){gid('mdRemindAt').value='';return}
  let d;
  if(offset==='due'){
    const due=gid('mdDue').value;
    if(!due){alert('Set a due date first');return}
    d=new Date(due+'T00:00:00');
  }else{
    d=new Date();d.setDate(d.getDate()+offset);
  }
  d.setHours(hour,0,0,0);
  const yr=d.getFullYear(),mo=String(d.getMonth()+1).padStart(2,'0'),da=String(d.getDate()).padStart(2,'0');
  const hh=String(d.getHours()).padStart(2,'0'),mm=String(d.getMinutes()).padStart(2,'0');
  gid('mdRemindAt').value=yr+'-'+mo+'-'+da+'T'+hh+':'+mm;
}

function checkReminders(){
  const now=Date.now();
  let fired=false;
  tasks.forEach(t=>{
    if(!t.remindAt||t.reminderFired||t.archived||t.status==='done')return;
    const remindTime=new Date(t.remindAt).getTime();
    if(!Number.isFinite(remindTime)){
      console.warn('[tasks] Invalid remindAt on task',t.id);
      return;
    }
    if(now>=remindTime){
      t.reminderFired=true;fired=true;
      const late=(now-remindTime)>5*60*1000;
      const title=(late?'Missed: ':'Task reminder: ')+t.name;
      if('Notification' in window&&Notification.permission==='granted'){
        try{
          if(typeof notify === 'function'){
            notify(title, t.dueDate?'Due '+fmtDue(t.dueDate):'No due date', {
              tag: 'task-'+t.id,
              requireInteraction: true,
              data: { action: 'openTask', taskId: t.id },
            });
          } else {
            const n=new Notification(title,{
              body:t.dueDate?'Due '+fmtDue(t.dueDate):'No due date',
              tag:'task-'+t.id,requireInteraction:true
            });
            n.onclick=function(){window.focus();showTab('tasks');openTaskDetail(t.id);n.close()};
          }
        }catch(e){ console.warn('[tasks] Notification failed for task', t.id, e); }
      }else if(cfg.sound){playChime('bell')}
    }
  });
  if(fired)saveState('auto')
}
// Check reminders every 30s (guarded against double-init)
let _reminderIntervalId = null;
if (_reminderIntervalId) clearInterval(_reminderIntervalId);
_reminderIntervalId = setInterval(checkReminders, 30000);
// And once on load
setTimeout(checkReminders, 1000);

// Recurring tasks — advance due date for habit-in-place completions
function advanceRecurringDate(dateStr,recurType){
  // C-5: "afterNd" variants schedule N days from TODAY (the completion date)
  // rather than from the previous due date. This is the "after I finish" model
  // — keep finishing late from compounding indefinitely into the future.
  const afterMatch = typeof recurType === 'string' ? recurType.match(/^after(\d+)d$/) : null;
  if(afterMatch){
    const days = parseInt(afterMatch[1], 10) || 1;
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  const d=dateStr?new Date(dateStr+'T12:00:00'):new Date();
  if(recurType==='daily')d.setDate(d.getDate()+1);
  else if(recurType==='weekdays'){
    d.setDate(d.getDate()+1);
    while(d.getDay()===0||d.getDay()===6)d.setDate(d.getDate()+1);
  }
  else if(recurType==='weekly')d.setDate(d.getDate()+7);
  else if(recurType==='monthly'){
    const day=d.getDate();
    d.setMonth(d.getMonth()+1);
    const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
    d.setDate(Math.min(day,last));
  }
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// spawnRecurringClone removed in v32 — use completeHabitCycle (single card + completions[])

/** Log one habit cycle: time since last log, stay open, next due. */
function completeHabitCycle(t){
  if(!t||!t.recur)return;
  if(!Array.isArray(t.completions))t.completions=[];
  const base=(typeof t.habitLastRecordedTotalSec==='number'&&t.habitLastRecordedTotalSec>=0)
    ?t.habitLastRecordedTotalSec:0;
  const nowSec=getTaskElapsed(t);
  const delta=Math.max(0,nowSec-base);
  t.completions.push({date:todayISO(),sec:delta});
  t.habitLastRecordedTotalSec=nowSec;
  t.status='open';
  t.completedAt=null;
  t.dueDate=advanceRecurringDate(t.dueDate||todayISO(),t.recur);
  t._habitCycledInSession = true;
  if(Array.isArray(t.checklist)){
    for(const c of t.checklist){
      if(c){ c.done=false; c.doneAt=null; }
    }
  }
}

function getHabitStreak(t){
  if(!t||!t.recur||!Array.isArray(t.completions)||!t.completions.length)return 0;
  const days=new Set(t.completions.map(c=>c&&c.date).filter(Boolean));
  const sorted=[...days].sort();
  if(!sorted.length)return 0;
  const d=new Date(sorted[sorted.length-1]+'T12:00:00');
  let streak=1;
  while(true){
    d.setDate(d.getDate()-1);
    const prev=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    if(days.has(prev))streak++;
    else break;
  }
  return streak;
}

function getHabitLoggedSecTotal(t){
  if(!t||!Array.isArray(t.completions))return 0;
  return t.completions.reduce((a,c)=>{
    const x=parseInt(c&&c.sec,10);
    return a+(isNaN(x)?0:x);
  },0);
}

// Status/Priority quick-change
function cycleStatus(id){
  event&&event.stopPropagation();
  const t=findTask(id);if(!t)return;
  const idx=STATUS_ORDER.indexOf(t.status||'open');
  const next=STATUS_ORDER[(idx+1)%STATUS_ORDER.length];
  if(next==='done'&&t.recur){completeHabitCycle(t)}
  else{
    t.status=next;
    if(t.status==='done')t.completedAt=stampCompletion();
    else t.completedAt=null;
  }
  // Status cycle may move this card under a sticky group header — FLIP it.
  const list=gid('taskList');
  if(list&&typeof flipReorder==='function')flipReorder(list,()=>renderTaskList());
  else renderTaskList();
  saveState('user')
}

function toggleTaskDoneQuick(id){
  event&&event.stopPropagation();
  const t=findTask(id);if(!t)return;
  if(t.status==='done'){t.status='open';t.completedAt=null}
  else{
    if(t.recur){
      completeHabitCycle(t);
      if(activeTaskId===id){/* keep timer running on same task */ }
    }else{
      t.status='done';t.completedAt=stampCompletion();
      if(activeTaskId===id){toggleTask(id)}
    }
    haptic(15);
    // Dopamine: animate the row + a little sparkle
    setTimeout(()=>{
      const row=document.querySelector('.task-item[data-task-id="'+id+'"]');
      if(row){
        row.classList.add('just-done');
        const spark=document.createElement('span');spark.className='done-sparkle';
        spark.textContent='';const sparkSvg=(window.icon && window.icon('sparkles',{size:20}));if(sparkSvg){const tmp=document.createElement('span');tmp.innerHTML=sparkSvg;while(tmp.firstChild)spark.appendChild(tmp.firstChild)};
        const rect=row.getBoundingClientRect();
        spark.style.cssText='left:'+(rect.left+32)+'px;top:'+(rect.top+10)+'px;position:fixed;z-index:2000';
        document.body.appendChild(spark);
        setTimeout(()=>spark.remove(),700);
      }
    },10);
  }
  renderTaskList();saveState('user')
}

// Haptic helper — vibrate on supporting devices (iOS Safari + all Android)
function haptic(ms){
  if(navigator.vibrate)try{navigator.vibrate(ms||10)}catch(e){}
}

// Lists (Projects)
// Each list: { id, name, color, description } — description is optional but feeds
// Auto-organize (embeddings route tasks to the list whose name+description they
// match best). Example: description "bills, taxes, budgets, investments" routes
// "pay rent" or "review purchases" to Finance.
function ensureDefaultList(){
  if(lists.length===0){
    const t=Date.now();
    lists.push({id:++listIdCtr,name:'Personal',color:'#2ecc71',description:'Personal life — errands, home, hobbies, relationships, health, self-care.',lastModified:t});
    lists.push({id:++listIdCtr,name:'Work',color:'#3d8bcc',description:'Work and career — projects, meetings, deadlines, professional learning.',lastModified:t});
    activeListId=lists[0].id;
  }
  if(!activeListId&&lists.length)activeListId=lists[0].id;
  // Assign orphaned tasks to the active list
  const defList=activeListId||lists[0].id;
  tasks.forEach(t=>{if(!t.listId)t.listId=defList});
  lists.forEach(l=>{if(typeof l.description!=='string')l.description=''});
  repairOrphanedTaskParents();
}
const LIST_DESC_HINT='Short description (optional) — feeds Auto-organize so new tasks get routed here.\nExamples: "bills, taxes, budgets, investments" or "household chores, repairs, cleaning".';
async function addList(){
  const name=await showAppPrompt('List name:','');
  if(name===null||!String(name).trim())return;
  const descriptionRaw=await showAppPrompt(LIST_DESC_HINT,'',{multiline:true});
  if(descriptionRaw===null)return;
  const description=String(descriptionRaw).trim();
  const colors=['#2ecc71','#3d8bcc','#e056a0','#e8a838','#9b59b6','#48b5e0','#c0392b','#1abc9c'];
  const color=colors[lists.length%colors.length];
  lists.push({id:++listIdCtr,name:String(name).trim(),color,description,lastModified:Date.now()});
  activeListId=listIdCtr;
  if(typeof invalidateListVectorCache==='function')invalidateListVectorCache();
  renderLists();renderTaskList();saveState('user');
  if(typeof renderListsManager==='function') renderListsManager();
  if(typeof renderAIPanel==='function') renderAIPanel();
}
async function editList(id){
  event&&event.stopPropagation();
  const l=lists.find(x=>x.id===id);if(!l)return;
  const name=await showAppPrompt('List name:',l.name);
  if(name===null)return;
  if(!String(name).trim()){alert('Name cannot be empty.');return}
  const descriptionRaw=await showAppPrompt(LIST_DESC_HINT,l.description||'',{multiline:true});
  if(descriptionRaw===null)return;
  l.name=String(name).trim();
  l.description=String(descriptionRaw).trim();
  l.lastModified=Date.now();
  if(typeof invalidateListVectorCache==='function')invalidateListVectorCache();
  renderLists();renderTaskList();saveState('user');
  if(typeof renderListsManager==='function') renderListsManager();
  if(typeof renderAIPanel==='function') renderAIPanel();
}
async function removeList(id){
  event&&event.stopPropagation();
  if(lists.length<=1){alert('You need at least one list.');return}
  const list=lists.find(l=>l.id===id);if(!list)return;
  const taskCount=tasks.filter(t=>t.listId===id).length;
  if(!(await showAppConfirm('Delete list "'+list.name+'"?'+(taskCount>0?' '+taskCount+' task(s) will be moved to the first remaining list.':''))))return;
  if(typeof syncListDels==='object'&&syncListDels)syncListDels[id]=Date.now();
  lists=lists.filter(l=>l.id!==id);
  const fallbackId=lists[0].id;
  tasks.forEach(t=>{if(t.listId===id)t.listId=fallbackId});
  if(activeListId===id)activeListId=fallbackId;
  if(typeof invalidateListVectorCache==='function')invalidateListVectorCache();
  renderLists();renderTaskList();saveState('user');
  if(typeof renderListsManager==='function') renderListsManager();
  if(typeof renderAIPanel==='function') renderAIPanel();
}
function switchList(id){activeListId=id;renderLists();renderTaskList();saveState('user')}
function renderLists(){
  const bar=gid('listsBar');if(!bar)return;
  ensureDefaultList();
  bar.textContent='';
  bar.style.display='';
  // Render a chip per list. Even with one list we render its chip so the user
  // can always see what list their tasks belong to and where the +List button
  // is. The ✕ delete control is suppressed when only one list exists so the
  // user can't strand themselves (removeList already guards against this, but
  // hiding the affordance is clearer).
  const onlyOne=lists.length<=1;
  lists.forEach(l=>{
    const count=tasks.filter(t=>t.listId===l.id&&(!t.parentId)).length;
    const chip=document.createElement('button');
    chip.className='list-chip'+(l.id===activeListId?' active':'');
    chip.onclick=function(){switchList(l.id)};
    chip.title=l.description?l.description+'\n\n(double-click or ✎ to edit)':'Double-click or ✎ to edit list';
    chip.ondblclick=function(e){if(e)e.stopPropagation();editList(l.id)};
    const dot=document.createElement('span');
    dot.className='lc-dot';
    dot.style.background=sanitizeListColor(l.color);
    const nameNode=document.createTextNode(l.name);
    const cnt=document.createElement('span');
    cnt.className='lc-count';
    cnt.textContent=String(count);
    const edit=document.createElement('span');
    edit.className='lc-edit';
    edit.title='Edit name + description';
    edit.textContent='✎';
    edit.onclick=function(e){if(e)e.stopPropagation();editList(l.id)};
    const kids=[dot,nameNode,cnt,edit];
    if(!onlyOne){
      const rm=document.createElement('span');
      rm.className='lc-rm';
      rm.textContent='✕';
      rm.title='Delete this list';
      rm.onclick=function(e){if(e)e.stopPropagation();removeList(l.id)};
      kids.push(rm);
    }
    chip.replaceChildren(...kids);
    bar.appendChild(chip)
  });
  const add=document.createElement('button');
  add.className='list-add';
  add.type='button';
  add.textContent='+ List';
  add.title='Add a new list (e.g. Research, School, Side Project) with an optional description that helps Auto-organize route tasks here.';
  add.onclick=addList;
  bar.appendChild(add);
  // G-7: focus-on-list toggle is meaningless with a single list — only show
  // it once there's actually something to scope to.
  if(!onlyOne){
    const focus=document.createElement('button');
    const focusOn=!!(typeof cfg==='object'&&cfg&&cfg.focusListMode);
    focus.className='list-focus-toggle'+(focusOn?' on':'');
    focus.type='button';
    focus.title=focusOn?'Exit focus-on-list mode':'Hide every list except the active one';
    focus.textContent=focusOn?'◉ Focus':'◎ Focus';
    focus.onclick=function(){ if(typeof toggleFocusListMode==='function') toggleFocusListMode(); };
    bar.appendChild(focus);
  }
}

/**
 * Settings → Lists manager. Renders one row per list (color · name · description
 * preview · Edit / Delete) plus an "+ Add list" button. Mirrors the chip-bar
 * controls so users who instinctively look in Settings (alongside Life areas)
 * can find list management there too.
 */
function renderListsManager(){
  const root=gid('listsManager');
  if(!root) return;
  ensureDefaultList();
  root.textContent='';
  const onlyOne=lists.length<=1;
  lists.forEach(l=>{
    const row=document.createElement('div');
    row.className='lists-mgr-row';
    const dot=document.createElement('span');
    dot.className='lists-mgr-dot';
    dot.style.background=sanitizeListColor(l.color);
    const meta=document.createElement('div');
    meta.className='lists-mgr-meta';
    const nm=document.createElement('div');
    nm.className='lists-mgr-name';
    nm.textContent=l.name;
    meta.appendChild(nm);
    const desc=document.createElement('div');
    desc.className='lists-mgr-desc';
    desc.textContent=l.description?l.description:'No description — add one to help Auto-organize route tasks here.';
    if(!l.description) desc.classList.add('lists-mgr-desc--empty');
    meta.appendChild(desc);
    const count=tasks.filter(t=>t.listId===l.id&&!t.archived&&!t.parentId).length;
    const cnt=document.createElement('span');
    cnt.className='lists-mgr-count';
    cnt.textContent=count+(count===1?' task':' tasks');
    const editBtn=document.createElement('button');
    editBtn.type='button';
    editBtn.className='btn-ghost btn-sm';
    editBtn.textContent='Edit';
    editBtn.onclick=function(){ editList(l.id); };
    const delBtn=document.createElement('button');
    delBtn.type='button';
    delBtn.className='btn-ghost btn-sm lists-mgr-del';
    delBtn.textContent='Delete';
    delBtn.disabled=onlyOne;
    delBtn.title=onlyOne?'You need at least one list':'Delete this list (its tasks move to the first remaining list)';
    delBtn.onclick=function(){ removeList(l.id); };
    row.replaceChildren(dot,meta,cnt,editBtn,delBtn);
    root.appendChild(row);
  });
}

// Filter/Sort/Search
function clearTaskSearch(){
  const el=gid('taskSearch');
  if(el) el.value='';
  if(typeof updateTaskFilters==='function') updateTaskFilters();
}

function updateFiltersSummary(){
  const el=gid('filtersSummary');if(!el)return;
  const so=gid('taskSortSel'),gr=gid('groupBySel');
  const sortPart=so&&so.value?(so.selectedOptions[0]&&so.selectedOptions[0].text)||'':'';
  const grpPart=gr&&gr.value&&gr.value!=='none'?(gr.selectedOptions[0]&&gr.selectedOptions[0].text)||'':'';
  el.textContent=grpPart?sortPart+' · '+grpPart:sortPart;
}

let _semanticSearchReqId=0;
let _updateTaskFiltersDebounce=null;
function updateTaskFilters(){
  taskFilters.search=gid('taskSearch').value.toLowerCase().trim();
  taskFilters.status=gid('filterStatus').value;
  taskFilters.priority=gid('filterPriority').value;
  taskFilters.category=(gid('filterCategory')||{}).value||'all';
  taskSortBy=gid('taskSortSel').value;
  const g=gid('groupBySel');if(g)taskGroupBy=g.value;
  const sem=gid('taskSearchSemantic');
  window._taskSearchSemantic=sem?sem.checked:false;
  updateFiltersActiveBadge();
  updateFiltersSummary();
  const clr=gid('taskSearchClear');
  if(clr) clr.style.display=gid('taskSearch').value.trim()?'':'none';
  const semPill=gid('taskSearchSemanticPill');
  if(semPill) semPill.style.display=(gid('taskSearchSemantic')&&gid('taskSearchSemantic').checked)?'':'none';
  if(window._taskSearchSemantic && taskFilters.search && typeof semanticSearch === 'function' && typeof isIntelReady === 'function' && isIntelReady()){
    const rawQ = gid('taskSearch').value.trim();
    const myReq=++_semanticSearchReqId;
    void (async () => {
      try{
        const results = await semanticSearch(rawQ, 800);
        if(myReq!==_semanticSearchReqId) return;
        window._semanticScores = new Map(results.map(r => [r.id, r.score]));
      }catch(e){
        if(myReq!==_semanticSearchReqId) return;
        window._semanticScores = null;
      }
      if(myReq!==_semanticSearchReqId) return;
      renderTaskList();
    })();
    return;
  }
  window._semanticScores = null;
  _semanticSearchReqId++;
  if(_updateTaskFiltersDebounce) clearTimeout(_updateTaskFiltersDebounce);
  _updateTaskFiltersDebounce=setTimeout(()=>{
    _updateTaskFiltersDebounce=null;
    renderTaskList();
  },200);
}
function setTaskView(v){
  taskView=v;
  gid('viewList').classList.toggle('active',v==='list');
  gid('viewBoard').classList.toggle('active',v==='board');
  if(gid('viewCal'))gid('viewCal').classList.toggle('active',v==='calendar');
  // Also sync mobile view-toggle buttons if they exist
  if(gid('viewListMobile'))gid('viewListMobile').classList.toggle('active',v==='list');
  if(gid('viewBoardMobile'))gid('viewBoardMobile').classList.toggle('active',v==='board');
  if(gid('viewCalMobile'))gid('viewCalMobile').classList.toggle('active',v==='calendar');
  gid('taskList').style.display=v==='list'?'':'none';
  gid('boardView').style.display=v==='board'?'flex':'none';
  if(gid('calendarView'))gid('calendarView').style.display=v==='calendar'?'':'none';
  document.body.classList.toggle('cal-active-mobile',v==='calendar');
  renderTaskList();
  saveState('user')
}
function updateMobileViewToggle(){/* alias for call sites */}
function matchesFilters(t){
  // Archive view shows ONLY archived
  if(smartView==='archived'){if(!t.archived)return false}
  else if(t.archived)return false;
  // List filter — only apply on 'all' view, not on focused smart views
  const listSensitiveViews=['all','inbox','waiting','stuck'];
  if(listSensitiveViews.includes(smartView)&&t.listId&&activeListId&&t.listId!==activeListId)return false;
  // G-7: Focus-on-list mode forces list scoping in EVERY smart view
  if(typeof cfg==='object'&&cfg&&cfg.focusListMode&&activeListId&&t.listId!==activeListId)return false;
  // Smart view filters
  const today=todayISO();
  // hiddenUntil (snooze): hide from EVERY main view except 'snoozed' and 'archived'.
  // Stays visible in completed/done if user already finished it.
  if(t.hiddenUntil && t.hiddenUntil>today && smartView!=='snoozed' && smartView!=='completed' && smartView!=='archived') return false;
  if(smartView==='today'){if(t.dueDate!==today||t.status==='done')return false}
  else if(smartView==='week'){
    if(!t.dueDate||t.status==='done')return false;
    const d=new Date();const w=new Date();w.setDate(d.getDate()+7);
    const weekEnd=w.getFullYear()+'-'+String(w.getMonth()+1).padStart(2,'0')+'-'+String(w.getDate()).padStart(2,'0');
    if(t.dueDate>weekEnd)return false;
  }
  else if(smartView==='overdue'){if(!t.dueDate||t.dueDate>=today||t.status==='done')return false}
  else if(smartView==='unscheduled'){if(t.dueDate||t.status==='done')return false}
  else if(smartView==='starred'){if(!t.starred||t.status==='done')return false}
  else if(smartView==='impact'){if(t.status==='done'||!_paretoTopSet.has(t.id))return false}
  else if(smartView==='completed'){if(t.status!=='done')return false}
  else if(smartView==='habits'){if(!t.recur||t.archived||t.status==='done')return false}
  // Inbox: untriaged — no list, no category, no due, no tags, not done.
  else if(smartView==='inbox'){
    if(t.status==='done')return false;
    if(t.listId)return false;
    if(t.category)return false;
    if(t.dueDate)return false;
    if(Array.isArray(t.tags)&&t.tags.length)return false;
  }
  // Waiting: tasks the user has flagged as blocked-on-someone-else.
  else if(smartView==='waiting'){
    if(t.type!=='waiting'||t.status==='done')return false;
  }
  // Stuck: untouched for 14+ days, still open.
  else if(smartView==='stuck'){
    if(t.status==='done')return false;
    const lm=typeof t.lastModified==='number'?t.lastModified:0;
    const cutoff=Date.now()-(14*86400000);
    if(!lm||lm>=cutoff)return false;
  }
  // Snoozed: hidden-until > today.
  else if(smartView==='snoozed'){
    if(!t.hiddenUntil||t.hiddenUntil<=today)return false;
    if(t.status==='done')return false;
  }
  if(smartView==='all'){
    const sd=gid('showCompletedAll');
    if((!sd||!sd.checked)&&t.status==='done')return false;
  }
  // Search — semantic (cosine) or substring
  if(taskFilters.search){
    const semActive = window._taskSearchSemantic && window._semanticScores && window._semanticScores.size > 0;
    if(semActive){
      if(!window._semanticScores.has(t.id))return false;
    }else{
      const hay=(t.name+' '+(t.description||'')+' '+(t.tags||[]).join(' ')+' '+(t.category||'')+' '+(t.valuesAlignment||[]).join(' ')).toLowerCase();
      if(!hay.includes(taskFilters.search))return false;
    }
  }
  if(taskFilters.status!=='all'){
    if(taskFilters.status==='active'){if(t.status==='done')return false}
    else if(t.status!==taskFilters.status)return false;
  }
  if(taskFilters.priority!=='all'&&t.priority!==taskFilters.priority)return false;
  // Category filter
  if(taskFilters.category&&taskFilters.category!=='all'&&t.category!==taskFilters.category)return false;
  if(!habitVisibilityOk(t))return false;
  return true;
}
/** Recurring tasks optional hide from main smart views (not Overdue / Done / Archive / Week …). */
function habitVisibilityOk(t){
  if(smartView==='habits') return true;
  if(typeof cfg!=='object'||!cfg||cfg.hideHabitsInMainViews===false) return true;
  const mainHide=['all','today','week','unscheduled','starred','impact','inbox','waiting','stuck'];
  if(mainHide.includes(smartView)&&t.recur) return false;
  return true;
}
/** How many recurring tasks are hidden by "hide habits" in the current smart view (for footer link). */
function countHabitsHiddenInView(){
  if(typeof cfg!=='object'||!cfg||cfg.hideHabitsInMainViews===false) return 0;
  const mainHide=['all','today','week','unscheduled','starred','impact','inbox','waiting','stuck'];
  if(!mainHide.includes(smartView)) return 0;
  const was=cfg.hideHabitsInMainViews;
  cfg.hideHabitsInMainViews=false;
  const open=tasks.filter(matchesFilters).filter(t=>t.recur);
  cfg.hideHabitsInMainViews=true;
  const hid=tasks.filter(matchesFilters);
  cfg.hideHabitsInMainViews=was;
  const idH=new Set(hid.map(t=>t.id));
  return open.filter(t=>!idH.has(t.id)).length;
}
function updateHabitsHiddenNotice(){
  const el=gid('habitsHiddenNotice');
  if(!el) return;
  const n=countHabitsHiddenInView();
  if(n>0 && typeof cfg==='object' && cfg && cfg.hideHabitsInMainViews!==false){
    el.style.display='';
    el.innerHTML=''+n+' recurring hidden — <button type="button" class="habits-hidden-link" onclick="setSmartView(&quot;habits&quot;)">View Habits</button>';
  }else{ el.style.display='none'; el.textContent=''; }
}
function onHideHabitsToggle(){
  const h=gid('hideHabitsInMain');
  if(!h||typeof cfg!=='object'||!cfg) return;
  cfg.hideHabitsInMainViews=!!h.checked;
  saveState('user');
  if(typeof updateFiltersActiveBadge==='function') updateFiltersActiveBadge();
  renderTaskList();
}
function sortTasks(arr){
  const sorted=arr.slice();
  if(window._semanticScores && window._semanticScores.size && window._taskSearchSemantic && taskFilters.search){
    return sorted.sort((a,b)=>(window._semanticScores.get(b.id)||0)-(window._semanticScores.get(a.id)||0));
  }
  const by = taskSortBy==='order'?'manual':taskSortBy;
  if(by==='manual')return sorted.sort((a,b)=>(a.order||0)-(b.order||0));
  sorted.sort((a,b)=>{
    if(by==='smart'){
      // Starred first, then overdue, then today, then by priority+due
      if(!!b.starred-!!a.starred)return !!b.starred-!!a.starred;
      const today=todayISO();
      const aOver=a.dueDate&&a.dueDate<today?0:1,bOver=b.dueDate&&b.dueDate<today?0:1;
      if(aOver!==bOver)return aOver-bOver;
      const aToday=a.dueDate===today?0:1,bToday=b.dueDate===today?0:1;
      if(aToday!==bToday)return aToday-bToday;
      const pd=(PRIORITY_ORDER[a.priority||'none']||9)-(PRIORITY_ORDER[b.priority||'none']||9);
      if(pd!==0)return pd;
      if(!a.dueDate&&b.dueDate)return 1;if(a.dueDate&&!b.dueDate)return -1;
      if(a.dueDate&&b.dueDate)return a.dueDate.localeCompare(b.dueDate);
      return (a.order||0)-(b.order||0);
    }
    if(by==='impact'){
      const sa=_paretoScoreMap.get(a.id)||0, sb=_paretoScoreMap.get(b.id)||0;
      if(sa!==sb) return sb-sa;
      // Stable tiebreaker: starred, then due, then priority
      if(!!b.starred-!!a.starred) return !!b.starred-!!a.starred;
      if(a.dueDate&&b.dueDate&&a.dueDate!==b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return (PRIORITY_ORDER[a.priority||'none']||9)-(PRIORITY_ORDER[b.priority||'none']||9);
    }
    if(by==='name')return a.name.localeCompare(b.name);
    if(by==='priority')return (PRIORITY_ORDER[a.priority||'none']||9)-(PRIORITY_ORDER[b.priority||'none']||9);
    if(by==='due'){
      if(!a.dueDate&&!b.dueDate)return 0;
      if(!a.dueDate)return 1;if(!b.dueDate)return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    if(by==='created')return a.id-b.id;
    if(by==='time')return getRolledUpTime(b.id)-getRolledUpTime(a.id);
    return 0;
  });
  return sorted;
}

function renderTodayBanner(){
  const today=todayISO();
  const activeTasks=tasks.filter(t=>!t.archived&&t.status!=='done');
  const overdue=activeTasks.filter(t=>t.dueDate&&t.dueDate<today).length;
  const dueToday=activeTasks.filter(t=>t.dueDate===today).length;
  const weekAhead=new Date();weekAhead.setDate(weekAhead.getDate()+7);
  const weekEnd=weekAhead.getFullYear()+'-'+String(weekAhead.getMonth()+1).padStart(2,'0')+'-'+String(weekAhead.getDate()).padStart(2,'0');
  const thisWeek=activeTasks.filter(t=>t.dueDate&&t.dueDate>=today&&t.dueDate<=weekEnd).length;
  const doneToday=tasks.filter(t=>{
    if(t.status!=='done'||!t.completedAt)return false;
    const dk=completionDateKey(t.completedAt);
    return dk===today;
  }).length;
  if(gid('tbOverdue'))gid('tbOverdue').textContent=overdue;
  if(gid('tbToday'))gid('tbToday').textContent=dueToday;
  if(gid('tbWeek'))gid('tbWeek').textContent=thisWeek;
  if(gid('tbDoneToday'))gid('tbDoneToday').textContent=doneToday;
  // Show banner ONLY when there's something urgent — overdue tasks or tasks due today
  // Week-ahead and done-today are available via smart views, no need to duplicate
  const banner=gid('todayBanner');
  if(banner){
    let snooze=null;
    try{ snooze=localStorage.getItem((window.ODTAULAI_CONFIG && window.ODTAULAI_CONFIG.STORAGE_KEYS && window.ODTAULAI_CONFIG.STORAGE_KEYS.TB_SNOOZE) || 'odtaulai_tb_snooze'); }catch(e){}
    const hasUrgent=overdue>0||dueToday>0;
    const hiddenBySnooze=snooze===today;
    banner.style.display=hasUrgent&&!hiddenBySnooze?'':'none';
  }
}
function snoozeTodayBanner(){
  try{ localStorage.setItem((window.ODTAULAI_CONFIG && window.ODTAULAI_CONFIG.STORAGE_KEYS && window.ODTAULAI_CONFIG.STORAGE_KEYS.TB_SNOOZE) || 'odtaulai_tb_snooze', todayISO()); }catch(e){}
  const banner=gid('todayBanner');
  if(banner) banner.style.display='none';
}

function toggleFiltersPanel(){
  const panel=gid('filtersPanel');if(!panel)return;
  const btn=gid('filtersToggle');
  const isOpen=panel.style.display!=='none';
  panel.style.display=isOpen?'none':'';
  if(btn){
    btn.classList.toggle('active',!isOpen);
    btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  }
}

function updateFiltersActiveBadge(){
  // Show a badge on the Filters button when any filter is non-default
  const badge=gid('filtersActiveCount');if(!badge)return;
  let count=0;
  const s=gid('taskSearch'),st=gid('filterStatus'),pr=gid('filterPriority'),so=gid('taskSortSel'),gr=gid('groupBySel');
  if(s&&s.value.trim())count++;
  const sem=gid('taskSearchSemantic');  if(sem&&sem.checked)count++;
  if(st&&st.value!=='all')count++;
  if(pr&&pr.value!=='all')count++;
  if(so&&so.value!=='manual'&&so.value!=='smart')count++;
  if(gr&&gr.value!=='none')count++;
  const cat=gid('filterCategory');if(cat&&cat.value!=='all')count++;
  const sc=gid('showCompletedAll');if(sc&&sc.checked)count++;
  const cd=gid('cardDensityDetailed');if(cd&&cd.checked)count++;
  const hh=gid('hideHabitsInMain');if(hh&&!hh.checked)count++;
  if(count>0){badge.textContent=count;badge.style.display='';}
  else{badge.style.display='none';}
}

function renderSmartViewCounts(){
  const today=todayISO();
  const inList=t=>!t.listId||!activeListId||t.listId===activeListId;
  const active=tasks.filter(t=>!t.archived&&inList(t));
  const activeNotDone=active.filter(t=>t.status!=='done');
  const weekAhead=new Date();weekAhead.setDate(weekAhead.getDate()+7);
  const weekEnd=weekAhead.getFullYear()+'-'+String(weekAhead.getMonth()+1).padStart(2,'0')+'-'+String(weekAhead.getDate()).padStart(2,'0');
  const set=(id,n)=>{const el=gid(id);if(el)el.textContent=n};
  // Hide snoozed (hiddenUntil > today) from "active" counts so the chips
  // don't advertise tasks the user explicitly deferred.
  const visibleNow=activeNotDone.filter(t=>!t.hiddenUntil||t.hiddenUntil<=today);
  set('svcAll',visibleNow.length);
  set('svcToday',visibleNow.filter(t=>t.dueDate===today).length);
  set('svcWeek',visibleNow.filter(t=>t.dueDate&&t.dueDate>=today&&t.dueDate<=weekEnd).length);
  set('svcOverdue',visibleNow.filter(t=>t.dueDate&&t.dueDate<today).length);
  set('svcUnscheduled',visibleNow.filter(t=>!t.dueDate).length);
  set('svcStarred',visibleNow.filter(t=>t.starred).length);
  set('svcImpact',visibleNow.filter(t=>_paretoTopSet.has(t.id)&&inList(t)).length);
  set('svcHabits',visibleNow.filter(t=>t.recur&&inList(t)).length);
  set('svcInbox',visibleNow.filter(t=>!t.listId&&!t.category&&!t.dueDate&&!(Array.isArray(t.tags)&&t.tags.length)).length);
  set('svcWaiting',visibleNow.filter(t=>t.type==='waiting').length);
  const stuckCutoff=Date.now()-(14*86400000);
  set('svcStuck',visibleNow.filter(t=>typeof t.lastModified==='number'&&t.lastModified>0&&t.lastModified<stuckCutoff).length);
  set('svcSnoozed',activeNotDone.filter(t=>t.hiddenUntil&&t.hiddenUntil>today).length);
  set('svcCompleted',active.filter(t=>t.status==='done').length);
  set('svcArchived',tasks.filter(t=>t.archived&&inList(t)).length);
}

// Main render (list view)
function renderTaskList(){
  const list=gid('taskList');
  if(!list)return;
  // Apply density class — exactly one of the three modifiers is active.
  if(list){
    const _d = (typeof getCardDensity==='function' ? getCardDensity() : 'cozy');
    list.classList.toggle('task-list--comfortable', _d==='comfortable');
    list.classList.toggle('task-list--cozy',        _d==='cozy');
    list.classList.toggle('task-list--compact',     _d==='compact');
  }
  // H2: compute the "lists that own open tasks" set once per render so
  // renderTaskItem doesn't rebuild it for every row (was O(N²)).
  if(typeof _computeListsWithTasks==='function') _computeListsWithTasks();
  renderLists();
  refreshParetoTopSet();
  renderTodayBanner();
  if(typeof renderTodayCalEvents==='function') renderTodayCalEvents();
  renderSmartViewCounts();
  if(typeof updateHabitsHiddenNotice==='function') updateHabitsHiddenNotice();
  if(typeof updateFiltersSummary==='function') updateFiltersSummary();
  const visibleTasks=tasks.filter(matchesFilters);
  const activeCount=visibleTasks.filter(t=>t.status!=='done'&&!t.parentId).length;
  const badge=gid('taskCountBadge');if(badge)badge.textContent=activeCount+' active';
  if(taskView==='board'){renderBoard(visibleTasks);return}
  if(taskView==='calendar'){renderCalendar(visibleTasks);return}
  list.querySelectorAll('.task-item, .task-subtask-form, .task-section').forEach(e=>e.remove());
  if(!visibleTasks.length){
    const empty=gid('taskEmpty');
    empty.style.display='';
    // Rebuild via createElement so styling is class-driven (theme-aware) and
    // there's no inline-style spaghetti to update when tokens change.
    empty.replaceChildren();
    empty.classList.add('task-empty');
    const buildIcon = (kind) => {
      const ic = document.createElement('div');
      ic.className = 'task-empty-icon';
      const svg = (window.icon && window.icon(kind,{size:28})) || '';
      if(svg){
        // window.icon returns a known-safe inline SVG string from icons.js.
        ic.insertAdjacentHTML('afterbegin', svg);
      }else{
        ic.textContent = kind === 'archive' ? '🗂' : kind === 'filter' ? '🔍' : '✨';
      }
      return ic;
    };
    const addBlock = (cls, text) => {
      const b = document.createElement('div');
      b.className = cls;
      b.textContent = text;
      empty.appendChild(b);
    };
    if(tasks.length){
      // Has tasks, but filter/view excludes all.
      empty.appendChild(buildIcon('filter'));
      addBlock('task-empty-title', 'No tasks match your filters');
      addBlock('task-empty-help',  'Try adjusting the Filters panel, or switch to the "All" smart view.');
    } else if(smartView==='archived'){
      empty.appendChild(buildIcon('archive'));
      addBlock('task-empty-title', 'Archive is empty');
      addBlock('task-empty-help',  'Archived tasks will appear here when you archive them from the menu.');
    } else {
      const mod = /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform||'') ? '⌘' : 'Ctrl';
      empty.appendChild(buildIcon('sparkles'));
      addBlock('task-empty-title', 'No tasks yet');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'first-task-btn';
      btn.textContent = '+ Add your first task';
      btn.onclick = () => {
        const i = gid('taskInput');
        if(i){ i.focus(); i.select(); }
      };
      empty.appendChild(btn);
      const cmdkLine = document.createElement('div');
      cmdkLine.className = 'task-empty-help';
      cmdkLine.append('Or press ');
      const kbd = document.createElement('strong');
      kbd.textContent = mod + '+K';
      cmdkLine.append(kbd);
      cmdkLine.append(' to open the command palette.');
      empty.appendChild(cmdkLine);
      addBlock('task-empty-tip', 'The Filters button sets sort, group, and status — smart-view chips are quick lenses on top.');
      // Inline syntax example.
      const ex = document.createElement('div');
      ex.className = 'task-empty-example';
      ex.append('Buy milk ');
      const tokens = document.createElement('span');
      tokens.className = 'task-empty-example-tokens';
      tokens.textContent = 'tomorrow @urgent #shopping !star';
      ex.appendChild(tokens);
      empty.appendChild(ex);
    }
    // Hide progress bar — empty list has nothing to scroll through.
    if(typeof refreshTaskListProgress==='function') requestAnimationFrame(refreshTaskListProgress);
    return;
  }
  gid('taskEmpty').style.display='none';
  const visibleIds=new Set(visibleTasks.map(t=>t.id));
  // If grouping, bypass tree-render and group flat (only roots)
  if(taskGroupBy!=='none'){
    renderGroupedTasks(visibleTasks);
    if(typeof refreshTaskListProgress==='function') requestAnimationFrame(refreshTaskListProgress);
    return;
  }
  function renderNode(parentId,depth){
    const children=getTaskChildren(parentId);
    const sorted=sortTasks(children);
    sorted.forEach(t=>{
      if(visibleIds.has(t.id)||hasVisibleDescendant(t.id,visibleIds)){
        renderTaskItem(t,depth);
        if(subtaskPromptParent===t.id)renderSubtaskForm(t.id,depth+1);
        if(!t.collapsed)renderNode(t.id,depth+1);
      }
    });
  }
  renderNode(null,0);
  // Long-list affordance: show/hide the scroll-progress bar once DOM commits.
  if(typeof refreshTaskListProgress==='function') requestAnimationFrame(refreshTaskListProgress);
}

// ========== SECTION GROUPING ==========
function getGroupKey(t){
  if(taskGroupBy==='priority')return t.priority||'none';
  if(taskGroupBy==='status')return t.status||'open';
  if(taskGroupBy==='list')return String(t.listId||'none');
  if(taskGroupBy==='due'){
    const today=todayISO();
    if(!t.dueDate)return 'zzzunscheduled';
    if(t.dueDate<today)return 'overdue';
    if(t.dueDate===today)return 'today';
    const tmr=new Date();tmr.setDate(tmr.getDate()+1);
    const tmrISO=tmr.getFullYear()+'-'+String(tmr.getMonth()+1).padStart(2,'0')+'-'+String(tmr.getDate()).padStart(2,'0');
    if(t.dueDate===tmrISO)return 'tomorrow';
    const wk=new Date();wk.setDate(wk.getDate()+7);
    const wkISO=wk.getFullYear()+'-'+String(wk.getMonth()+1).padStart(2,'0')+'-'+String(wk.getDate()).padStart(2,'0');
    if(t.dueDate<=wkISO)return 'thisweek';
    return 'later';
  }
  return 'all';
}
function getGroupLabel(key){
  if(taskGroupBy==='priority')return({urgent:'P1 Urgent',high:'P2 High',normal:'P3 Normal',low:'P4 Low',none:'No priority'})[key]||key;
  if(taskGroupBy==='status')return (STATUSES[key]||{label:key}).label;
  if(taskGroupBy==='list'){const l=lists.find(l=>String(l.id)===key);return l?l.name:'No list'}
  if(taskGroupBy==='due')return({overdue:'Overdue',today:'Today',tomorrow:'Tomorrow',thisweek:'This Week',later:'Later',zzzunscheduled:'Unscheduled'})[key]||key;
  return key;
}
function getGroupColor(key){
  if(taskGroupBy==='priority')return({urgent:'var(--danger)',high:'var(--warning)',normal:'var(--accent)',low:'var(--text-3)',none:'var(--text-4)'})[key]||'var(--text-3)';
  if(taskGroupBy==='status')return({open:'var(--text-3)',progress:'var(--accent)',review:'var(--purple)',blocked:'var(--danger)',done:'var(--success)'})[key]||'var(--text-3)';
  if(taskGroupBy==='list'){const l=lists.find(l=>String(l.id)===key);return l?l.color:'var(--text-3)'}
  if(taskGroupBy==='due')return({overdue:'var(--danger)',today:'var(--warning)',tomorrow:'var(--accent)',thisweek:'var(--accent)',later:'var(--text-3)',zzzunscheduled:'var(--text-4)'})[key]||'var(--text-3)';
  return 'var(--text-3)';
}
function renderGroupedTasks(visibleTasks){
  const list=gid('taskList');
  const visibleSet=new Set(visibleTasks.map(t=>t.id));
  // Only show root-level in groups (subtasks appear under their parents)
  const roots=visibleTasks.filter(t=>!t.parentId);
  const groups={};
  roots.forEach(t=>{const k=getGroupKey(t);(groups[k]=groups[k]||[]).push(t)});
  // Order keys
  const keyOrder={priority:['urgent','high','normal','low','none'],status:['open','progress','review','blocked','done'],due:['overdue','today','tomorrow','thisweek','later','zzzunscheduled']};
  const preferred=keyOrder[taskGroupBy]||[];
  const sortedKeys=Object.keys(groups).sort((a,b)=>{
    const ai=preferred.indexOf(a),bi=preferred.indexOf(b);
    if(ai!==-1&&bi!==-1)return ai-bi;
    if(ai!==-1)return -1;if(bi!==-1)return 1;
    return a.localeCompare(b);
  });
  sortedKeys.forEach(k=>{
    const items=sortTasks(groups[k]);
    const hdr=document.createElement('div');hdr.className='task-section';
    const isCol=collapsedSections[taskGroupBy+':'+k];
    hdr.innerHTML='<span class="ts-chevron'+(isCol?' collapsed':'')+'">▼</span>'
      +'<span class="ts-color" style="background:'+getGroupColor(k)+'"></span>'
      +'<span class="ts-label">'+esc(getGroupLabel(k))+'</span>'
      +'<span class="ts-count">'+items.length+'</span>';
    hdr.onclick=function(){collapsedSections[taskGroupBy+':'+k]=!isCol;renderTaskList();saveState('user')};
    list.appendChild(hdr);
    if(!isCol){
      items.forEach(t=>{
        renderTaskItem(t,0);
        // Show descendants inline (no further grouping) if not collapsed
        if(!t.collapsed){
          function renderKids(pid,depth){
            getTaskChildren(pid).forEach(c=>{
              if(!visibleSet.has(c.id)) return;
              renderTaskItem(c,depth);
              if(!c.collapsed) renderKids(c.id, depth+1);
            });
          }
          renderKids(t.id,1);
        }
      });
    }
  });
}

// ========== CHECKLIST ==========
let _clIdCtr=0;
function addChecklistItem(taskId,text){
  const t=findTask(taskId);if(!t||!text.trim())return;
  if(!t.checklist)t.checklist=[];
  t.checklist.push({id:++_clIdCtr,text:text.trim(),done:false,doneAt:null});
  renderChecklist(taskId);saveState('user');
}
function toggleChecklistItem(taskId,itemId){
  const t=findTask(taskId);if(!t)return;
  const item=t.checklist.find(c=>c.id===itemId);if(!item)return;
  item.done=!item.done;item.doneAt=item.done?timeNow():null;
  renderChecklist(taskId);saveState('user');
}
function removeChecklistItem(taskId,itemId){
  const t=findTask(taskId);if(!t)return;
  t.checklist=t.checklist.filter(c=>c.id!==itemId);
  renderChecklist(taskId);saveState('user');
}
function renderChecklist(taskId){
  const t=findTask(taskId);if(!t)return;
  const el=document.getElementById('mdChecklist');if(!el)return;
  const items=t.checklist||[];
  const done=items.filter(c=>c.done).length;
  const pct=items.length?Math.round((done/items.length)*100):0;
  el.innerHTML=`
    ${items.length?`<div class="cl-progress"><div class="cl-bar" style="width:${pct}%"></div><span class="cl-pct">${pct}%</span></div>`:''}
    <div class="cl-items" id="clItems"></div>
    <div class="cl-add">
      <input class="cl-input" id="clInput" placeholder="Add item…" onkeydown="if(event.key==='Enter'){addChecklistItem(${taskId},this.value);this.value=''}">
      <button class="btn-ghost btn-sm" onclick="addChecklistItem(${taskId},document.getElementById('clInput').value);document.getElementById('clInput').value=''">+</button>
    </div>`;
  const list=document.getElementById('clItems');
  items.forEach(item=>{
    const d=document.createElement('div');d.className='cl-item'+(item.done?' cl-done':'');
    d.innerHTML=`<button class="cl-check${item.done?' on':''}" onclick="toggleChecklistItem(${taskId},${item.id})">${item.done?'✓':''}</button><span class="cl-text">${esc(item.text)}</span><button class="cl-rm" onclick="removeChecklistItem(${taskId},${item.id})">×</button>`;
    list.appendChild(d);
  });
}

// ========== TASK NOTES ==========
let _noteIdCtr=0;
/**
 * After loading persisted tasks, set checklist/note id counters to max existing
 * so new items never collide with persisted ids.
 */
function reseedChecklistAndNoteIdCtrs(){
  let maxC = 0, maxN = 0;
  for(const t of tasks || []){
    for(const c of t.checklist || []){
      if(typeof c.id === 'number' && c.id > maxC) maxC = c.id;
    }
    for(const n of t.notes || []){
      const id = n && n.id;
      if(typeof id === 'number' && id > 0 && id < 1e12) maxN = Math.max(maxN, id);
    }
  }
  if(maxC > _clIdCtr) _clIdCtr = maxC;
  if(maxN > _noteIdCtr) _noteIdCtr = maxN;
}
function addTaskNote(taskId,text){
  const t=findTask(taskId);if(!t||!text.trim())return;
  if(!t.notes)t.notes=[];
  t.notes.unshift({id:++_noteIdCtr,text:text.trim(),createdAt:timeNow()});
  renderTaskNotes(taskId);saveState('user');
}
function removeTaskNote(taskId,noteId){
  const t=findTask(taskId);if(!t)return;
  t.notes=t.notes.filter(n=>n.id!==noteId);
  renderTaskNotes(taskId);saveState('user');
}
function renderTaskNotes(taskId){
  const t=findTask(taskId);if(!t)return;
  const el=document.getElementById('mdNotes');if(!el)return;
  el.innerHTML=`
    <div class="note-add">
      <textarea class="note-input" id="noteInput" rows="2" placeholder="Add a timestamped note…"></textarea>
      <button class="btn-ghost btn-sm" onclick="addTaskNote(${taskId},document.getElementById('noteInput').value);document.getElementById('noteInput').value=''">Add</button>
    </div>
    <div id="noteList"></div>`;
  const list=document.getElementById('noteList');
  (t.notes||[]).forEach(n=>{
    const d=document.createElement('div');d.className='note-item';
    d.innerHTML=`<span class="note-time">${esc(n.createdAt||'')}</span><span class="note-text">${esc(n.text)}</span><button class="note-rm" onclick="removeTaskNote(${taskId},${n.id})">×</button>`;
    list.appendChild(d);
  });
}

// ========== BLOCKED-BY ==========
function addBlockedBy(taskId,blockerIdStr){
  const t=findTask(taskId);if(!t)return;
  const blockerId=parseInt(blockerIdStr);if(!blockerId||blockerId===taskId)return;
  if(!t.blockedBy)t.blockedBy=[];
  if(!t.blockedBy.includes(blockerId))t.blockedBy.push(blockerId);
  renderBlockedBy(taskId);saveState('user');
}
function removeBlockedBy(taskId,blockerId){
  const t=findTask(taskId);if(!t)return;
  t.blockedBy=(t.blockedBy||[]).filter(id=>id!==blockerId);
  renderBlockedBy(taskId);saveState('user');
}
function renderBlockedBy(taskId){
  const t=findTask(taskId);if(!t)return;
  const el=document.getElementById('mdBlockedBy');if(!el)return;
  const blockers=t.blockedBy||[];
  el.innerHTML=`
    <div class="blocker-chips" id="blockerChips"></div>
    <div style="display:flex;gap:6px;margin-top:6px">
      <select class="mfield-in" id="blockerSel" style="flex:1;font-size:12px">
        <option value="">Select blocking task…</option>
        ${tasks.filter(x=>x.id!==taskId&&x.status!=='done').map(x=>`<option value="${x.id}">${esc(x.name.slice(0,40))}</option>`).join('')}
      </select>
      <button class="btn-ghost btn-sm" onclick="addBlockedBy(${taskId},document.getElementById('blockerSel').value)">Link</button>
    </div>`;
  const chips=document.getElementById('blockerChips');
  blockers.forEach(bid=>{
    const bt=findTask(bid);if(!bt)return;
    const c=document.createElement('span');c.className='blocker-chip'+(bt.status==='done'?' resolved':'');
    c.innerHTML=`${bt.status==='done'?'✓ ':''}<span>${esc(bt.name.slice(0,30))}</span><button onclick="removeBlockedBy(${taskId},${bid})">×</button>`;
    chips.appendChild(c);
  });
}

(function(){
  const inp = typeof gid === 'function' ? gid('taskInput') : null;
  if(inp) inp.addEventListener('paste', taskInputPaste);
})();

// Density: enum of 'comfortable' | 'cozy' | 'compact'. Default cozy.
// Back-compat: legacy 'detailed' -> 'comfortable'; legacy 'compact' (which was
// the previous default) -> 'cozy' so existing users see no visual change.
const _DENSITY_KEY = (window.ODTAULAI_CONFIG && window.ODTAULAI_CONFIG.STORAGE_KEYS && window.ODTAULAI_CONFIG.STORAGE_KEYS.CARD_DENSITY) || 'stupind_card_density';
function getCardDensity(){
  try{
    const v = localStorage.getItem(_DENSITY_KEY);
    if(v==='comfortable'||v==='cozy'||v==='compact') return v;
    if(v==='detailed') return 'comfortable';
    return 'cozy';
  }catch(e){ return 'cozy'; }
}
function setCardDensity(v){
  if(v!=='comfortable'&&v!=='cozy'&&v!=='compact') v='cozy';
  try{ localStorage.setItem(_DENSITY_KEY, v); }catch(e){}
  // Reflect in the segmented control radios.
  document.querySelectorAll('.density-seg-btn').forEach(b=>{
    const on = b.dataset.density === v;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.classList.toggle('on', on);
  });
  if(typeof updateFiltersActiveBadge === 'function') updateFiltersActiveBadge();
  renderTaskList();
}
// Legacy entry-point kept so any old onclick="onCardDensityToggle()" still works.
function onCardDensityToggle(){
  setCardDensity(getCardDensity()==='comfortable' ? 'cozy' : 'comfortable');
}
function onShowCompletedToggle(){
  try{
    const sc = gid('showCompletedAll');
    localStorage.setItem((window.ODTAULAI_CONFIG && window.ODTAULAI_CONFIG.STORAGE_KEYS && window.ODTAULAI_CONFIG.STORAGE_KEYS.SHOW_DONE_ALL) || 'stupind_show_done_all', sc && sc.checked ? '1' : '0');
  }catch(e){}
  updateTaskFilters();
}
function restoreTaskToolbarPrefs(){
  const sc = gid('showCompletedAll');
  if(sc){
    try{ sc.checked = localStorage.getItem((window.ODTAULAI_CONFIG && window.ODTAULAI_CONFIG.STORAGE_KEYS && window.ODTAULAI_CONFIG.STORAGE_KEYS.SHOW_DONE_ALL) || 'stupind_show_done_all') === '1'; }catch(e){}
  }
  // Reflect persisted density on the new segmented control (and legacy
  // checkbox if still present).
  const _d = getCardDensity();
  document.querySelectorAll('.density-seg-btn').forEach(b=>{
    const on = b.dataset.density === _d;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.classList.toggle('on', on);
  });
  const cd = gid('cardDensityDetailed');
  if(cd){ cd.checked = (_d === 'comfortable'); }
  const hh = gid('hideHabitsInMain');
  if(hh && typeof cfg === 'object' && cfg && typeof cfg.hideHabitsInMainViews === 'boolean'){
    hh.checked = cfg.hideHabitsInMainViews;
  }
}

window.getCardDensity = getCardDensity;
window.setCardDensity = setCardDensity;
window.onCardDensityToggle = onCardDensityToggle;
window.onShowCompletedToggle = onShowCompletedToggle;
window.restoreTaskToolbarPrefs = restoreTaskToolbarPrefs;
window.describeDue = describeDue;
window.onHideHabitsToggle = onHideHabitsToggle;
window.updateHabitsHiddenNotice = updateHabitsHiddenNotice;
window.completeHabitCycle = completeHabitCycle;
window.getHabitStreak = getHabitStreak;
window.getHabitLoggedSecTotal = getHabitLoggedSecTotal;
window.dismissSwipeTip = dismissSwipeTip;
window.snoozeTodayBanner = snoozeTodayBanner;
window.clearTaskSearch = clearTaskSearch;
