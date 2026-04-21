// ========== PERSISTENCE ==========
// Internal keys keep stupind_* prefix so existing installs retain data after rebrand to ODTAULAI.
const STORE_KEY     = 'stupind_state';
const ARCHIVE_KEY   = 'stupind_archive';
const SCHEMA_VERSION = 6;

// Main nav tabs — single source for persisted activeTab + ?tab= deep links (see app.js)
const VALID_MAIN_TABS = ['tasks','focus','tools','data','settings'];

// ── IndexedDB mirror (silent crash backup) ────────────────────────────────────
let _idb = null;
function _openIDB(){
  if(_idb) return Promise.resolve(_idb);
  return new Promise((res,rej)=>{
    const req = indexedDB.open('stupind_backup',1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    req.onsuccess = e => { _idb = e.target.result; res(_idb); };
    req.onerror   = () => rej(req.error);
  });
}
function _idbSet(key,val){ _openIDB().then(db=>{ const tx=db.transaction('kv','readwrite'); tx.objectStore('kv').put(val,key); }).catch(()=>{}); }
function _idbGet(key){ return _openIDB().then(db=>new Promise((res,rej)=>{ const tx=db.transaction('kv','readonly'); const r=tx.objectStore('kv').get(key); r.onsuccess=()=>res(r.result??null); r.onerror=()=>rej(r.error); })).catch(()=>null); }

// ── Type coercions — repair individual bad values safely ──────────────────────
const _str  = (v,d='')     => (v!=null&&typeof v==='string') ? v : (v!=null?String(v):d);
const _int  = (v,d=0)      => { const n=parseInt(v); return isNaN(n)?d:n; };
const _bool = (v,d=false)  => typeof v==='boolean'?v:d;
const _arr  = (v)          => Array.isArray(v)?v:[];
const _obj  = (v,d={})     => (v&&typeof v==='object'&&!Array.isArray(v))?v:d;
const _enum = (v,allowed,d)=> allowed.includes(v)?v:d;

// ── Task field repair — run on every task after migration ─────────────────────
// Ensures every field has the right type regardless of what was stored.
function _repairTask(t){
  if(!t||typeof t!=='object') return null;
  return {
    // Core identity
    id:           _int(t.id, 0),
    name:         _str(t.name, 'Untitled task'),
    parentId:     t.parentId!=null ? _int(t.parentId) : null,
    collapsed:    _bool(t.collapsed, false),
    created:      _str(t.created, ''),
    order:        _int(t.order, Date.now()),
    archived:     _bool(t.archived, false),
    // Status / priority
    status:       _enum(t.status,   ['open','progress','review','blocked','done'], 'open'),
    priority:     _enum(t.priority, ['urgent','high','normal','low','none'],       'none'),
    completedAt:  t.completedAt!=null ? _str(t.completedAt) : null,
    // Dates
    dueDate:      t.dueDate   ? _str(t.dueDate)   : null,
    startDate:    t.startDate ? _str(t.startDate) : null,
    remindAt:     t.remindAt  ? _str(t.remindAt)  : null,
    reminderFired:_bool(t.reminderFired, false),
    recur:        _enum(t.recur, ['daily','weekdays','weekly','monthly'], null) ?? (t.recur&&typeof t.recur==='string'?null:null),
    // Text fields
    description:  _str(t.description, ''),
    url:          t.url ? _str(t.url) : null,
    completionNote: t.completionNote ? _str(t.completionNote) : null,
    // Numbers
    estimateMin:  _int(t.estimateMin, 0),
    totalSec:     _int(t.totalSec, 0),
    sessions:     _int(t.sessions, 0),
    // Flags
    starred:      _bool(t.starred, false),
    // Arrays
    tags:         _arr(t.tags).filter(x=>typeof x==='string'),
    blockedBy:    _arr(t.blockedBy).map(x=>_int(x)).filter(x=>x>0),
    checklist:    _arr(t.checklist).map(c=>({
                    id:    _int(c.id, 0),
                    text:  _str(c.text, ''),
                    done:  _bool(c.done, false),
                    doneAt:c.doneAt ? _str(c.doneAt) : null,
                  })).filter(c=>c.text),
    notes:        _arr(t.notes).map(n=>({
                    id:        n.id||Date.now()+Math.random(),
                    text:      _str(n.text, ''),
                    createdAt: _str(n.createdAt, ''),
                  })).filter(n=>n.text),
    // v4 contextual fields
    type:         _enum(t.type, ['task','bug','idea','errand','waiting'], 'task'),
    effort:       _enum(t.effort, ['xs','s','m','l','xl'], null) ?? null,
    energyLevel:  _enum(t.energyLevel, ['high','low'], null) ?? null,
    context:      (function(){
      const c = t.context;
      if(c == null || c === '') return null;
      const s = String(c).trim();
      if(!s) return null;
      return s.length > 64 ? s.slice(0, 64) : s;
    })(),
    // v5 values alignment — category id is user-extensible (custom classifications)
    category:     (function(){
      const c = t.category;
      if(c == null || c === '') return null;
      const s = String(c).trim();
      if(!s) return null;
      return s.length > 64 ? s.slice(0, 64) : s;
    })(),
    completions:  _arr(t.completions).map(x => {
      if(!x || typeof x !== 'object') return null;
      return { date: _str(x.date, ''), sec: _int(x.sec, 0) };
    }).filter(x => x && x.date),
    habitLastRecordedTotalSec: (typeof t.habitLastRecordedTotalSec === 'number' && t.habitLastRecordedTotalSec >= 0)
      ? Math.floor(t.habitLastRecordedTotalSec) : null,
    valuesAlignment: _arr(t.valuesAlignment).filter(x=>typeof x==='string'),
    valuesNote:   t.valuesNote ? _str(t.valuesNote) : null,
    // List membership
    listId:       t.listId!=null ? _int(t.listId) : null,
    // Sync metadata — CRITICAL: must be preserved across reloads so that
    // last-write-wins merging in sync.js compares correct timestamps instead
    // of treating every task as "just modified" after each page refresh.
    lastModified: (typeof t.lastModified === 'number' && t.lastModified > 0) ? t.lastModified : null,
  };
}

// ── Migration runner ──────────────────────────────────────────────────────────
// Each block is wrapped independently so a failure in one version doesn't
// prevent later migrations from running.
function migrateState(s){
  if(!s||typeof s!=='object') return null;
  const v = _int(s.v, 1);

  if(v < 2){
    try{
      s.lists     = _arr(s.lists);
      s.listIdCtr = _int(s.listIdCtr, 0);
      s.activeListId = s.activeListId ?? null;
      if(Array.isArray(s.tasks)) s.tasks = s.tasks.map(t=>({listId:null,..._obj(t)}));
    }catch(e){ console.warn('[migration v2]',e); }
  }
  if(v < 3){
    try{
      s.collapsedSections = _obj(s.collapsedSections);
      s.taskGroupBy       = _str(s.taskGroupBy, 'none');
      if(Array.isArray(s.tasks)) s.tasks = s.tasks.map(t=>({recur:null,remindAt:null,reminderFired:false,..._obj(t)}));
    }catch(e){ console.warn('[migration v3]',e); }
  }
  if(v < 4){
    try{
      if(Array.isArray(s.tasks)) s.tasks = s.tasks.map(t=>({
        startDate:null,type:'task',effort:null,energyLevel:null,
        context:null,blockedBy:[],checklist:[],notes:[],url:null,completionNote:null,
        ..._obj(t)
      }));
    }catch(e){ console.warn('[migration v4]',e); }
  }
  if(v < 5){
    try{
      if(Array.isArray(s.tasks)) s.tasks = s.tasks.map(t=>({
        category:null,valuesAlignment:[],valuesNote:null,..._obj(t)
      }));
    }catch(e){ console.warn('[migration v5]',e); }
  }
  if(v < 6){
    try{
      if(Array.isArray(s.tasks)){
        s.tasks = s.tasks.map(t => {
          const o = _obj(t);
          const base = { completions: [], ...o };
          if(o.recur){
            base.habitLastRecordedTotalSec = _int(o.totalSec, 0);
          }
          return base;
        });
      }
    }catch(e){ console.warn('[migration v6]',e); }
  }

  // ── Field-level repair pass — runs on EVERY load regardless of version ──────
  // This is the safety net: even if a migration was skipped or data was
  // partially corrupted, every task comes out with correct types.
  if(Array.isArray(s.tasks)){
    s.tasks = s.tasks.map(_repairTask).filter(Boolean);
  }

  s.v = SCHEMA_VERSION;
  return s;
}

// ── State validation — sanity check after migration ───────────────────────────
function _validateState(s){
  if(!s||typeof s!=='object')         return false;
  if(!Array.isArray(s.tasks))         return false;
  if(typeof s.date !== 'string')      return false;
  return true;
}

// Save — captures task mutations with per-task lastModified stamp for sync
let _prevTaskSnapshot = null; // used to detect which tasks changed since last save
/** @param {'auto'|'unload'|'user'} [reason] — only 'user' shows the save pill (throttled) */
function saveState(reason){
  if(!reason) reason = 'auto';
  // H5: any user-attributed save means the in-memory state is live and must
  // not be overwritten by the async IDB recovery path in loadState().
  if(reason === 'user') window._stateDirty = true;
  if(typeof taskSortBy==='string'&&taskSortBy==='order') taskSortBy='manual';
  // Stamp lastModified on tasks that actually changed since the previous save.
  // This gives sync a reliable "newer wins" comparator without touching every
  // mutation site manually.
  const prev = _prevTaskSnapshot || {};
  const _intelEmbedIds = [];
  tasks.forEach(t => {
    const p = prev[t.id];
    if (!p) {
      // Brand new task
      t.lastModified = t.lastModified || Date.now();
      _intelEmbedIds.push(t.id);
    } else {
      // Cheap comparator — any field difference = changed
      const fieldsToCompare = ['name','status','priority','dueDate','startDate','description','tags',
        'starred','archived','completedAt','effort','energyLevel','context','category',
        'valuesAlignment','parentId','listId','url','estimateMin','recur','remindAt','type','blockedBy',
        'completions','habitLastRecordedTotalSec',
        'totalSec','sessions','checklist','notes'];
      let changed = false;
      for (const f of fieldsToCompare){
        const a = JSON.stringify(t[f]);
        const b = JSON.stringify(p[f]);
        if (a !== b) { changed = true; break; }
      }
      if (changed){
        t.lastModified = Date.now();
        _intelEmbedIds.push(t.id);
      }
    }
  });
  // Rebuild snapshot for next diff
  _prevTaskSnapshot = {};
  tasks.forEach(t => { _prevTaskSnapshot[t.id] = {...t}; });

  let taskSnap = tasks.map(t=>({...t}));
  if(activeTaskId && taskStartedAt){
    const t = taskSnap.find(x=>x.id===activeTaskId);
    if(t) t.totalSec += Math.floor((Date.now()-taskStartedAt)/1000);
  }
  const state = {
    v:SCHEMA_VERSION, date:todayKey(),
    cfg, goals, goalIdCtr,
    tasks:taskSnap, taskIdCtr, activeTaskId,
    timeLog,logIdCtr,
    totalPomos, totalBreaks, totalFocusSec, sessionHistory,
    pomosInCycle, phase,
    intervals, intIdCtr,
    quickTimers, qtIdCtr,
    activeTab,
    lists, listIdCtr, activeListId,
    taskView, taskSortBy, smartView, taskGroupBy, theme, collapsedSections,
  };
  const serialized = JSON.stringify(state);
  try{
    localStorage.setItem(STORE_KEY, serialized);
    window._saveError = null;
    window._lastSaveAt = Date.now();
  }catch(e){
    // QuotaExceededError — warn user. Most common cause: archive grew huge.
    window._saveError = e.name || 'save-failed';
    // Show a non-blocking warning banner once
    if(!document.getElementById('quotaWarning')){
      const w = document.createElement('div');
      w.id = 'quotaWarning';
      w.className = 'quota-warning';
      const warnIc = (window.icon && window.icon('alertTriangle', {size:14})) || '';
      w.innerHTML = `
        <span class="quota-warning-msg">${warnIc}<span>Storage nearly full — new changes may not be saved.</span></span>
        <button onclick="document.getElementById('quotaWarning').remove()">Dismiss</button>
        <button onclick="exportData();document.getElementById('quotaWarning').remove()">Backup now</button>`;
      document.body.appendChild(w);
    }
  }
  _idbSet(STORE_KEY, serialized);
  if(typeof syncBroadcast==='function') syncBroadcast();
  if(reason === 'user') showSaveIndicator();

  queueMicrotask(() => {
    if(typeof embedStore === 'undefined' || !embedStore || !embedStore.ensure) return;
    _intelEmbedIds.forEach(id => {
      const t = typeof findTask === 'function' ? findTask(id) : null;
      if(t) embedStore.ensure(t).catch(() => {});
    });
    if(typeof scheduleIntelDupRefresh === 'function') scheduleIntelDupRefresh();
  });
}

// ── Apply validated+migrated state to live variables ─────────────────────────
function _applyState(s){
  try{
    s = migrateState(s);
    if(!_validateState(s)) return false;

    // Day rollover — archive yesterday's daily counters, but preserve
    // long-lived user data (tasks, lists, goals, cfg, etc.) across days.
    // Only the per-day metrics reset; archiveDay dedupes by date so it's
    // safe if this runs again on reload.
    if(s.date !== todayKey()){
      archiveDay(s);
      s.date          = todayKey();
      s.totalPomos    = 0;
      s.totalBreaks   = 0;
      s.totalFocusSec = 0;
      s.pomosInCycle  = 0;
      s.sessionHistory = [];
      s.timeLog       = [];
      // Fall through and apply the rest of the state normally.
    }

    // Config — repair individual values defensively
    if(s.cfg && typeof s.cfg==='object'){
      cfg = s.cfg;
      if(typeof ensureClassificationConfig === 'function') ensureClassificationConfig(cfg);
      const cw=gid('cfgWork'); if(cw) cw.value = _int(cfg.work,25);
      const cs=gid('cfgShort');if(cs) cs.value = _int(cfg.short,5);
      const cl=gid('cfgLong'); if(cl) cl.value = _int(cfg.long,15);
      const cc=gid('cfgCycle');if(cc) cc.value = _int(cfg.cycle,4);
      setToggle('togBreak', _bool(cfg.autoBreak,true));
      setToggle('togWork',  _bool(cfg.autoWork,false));
      setToggle('togSound', _bool(cfg.sound,true));
      setToggle('togLink',  _bool(cfg.linkTask,true));
      setToggle('togNotif', cfg.notif!==false);
    } else if(typeof ensureClassificationConfig === 'function'){
      ensureClassificationConfig(cfg);
    }

    // Goals
    if(Array.isArray(s.goals)){
      goals     = s.goals.filter(g=>g&&typeof g==='object'&&g.text);
      goalIdCtr = _int(s.goalIdCtr, goals.length);
    }

    // Tasks — already repaired in migrateState
    if(Array.isArray(s.tasks)){
      tasks     = s.tasks;
      taskIdCtr = _int(s.taskIdCtr, 0);
      activeTaskId  = null;
      taskStartedAt = null;
    }

    // Lists
    if(Array.isArray(s.lists)){
      lists       = s.lists.filter(l=>l&&l.id&&l.name).map(l=>({
        id: l.id,
        name: l.name,
        color: l.color || '#3d8bcc',
        description: typeof l.description==='string' ? l.description : '',
      }));
      listIdCtr   = _int(s.listIdCtr, 0);
      activeListId = s.activeListId ?? null;
    }

    // Scalars with enum validation
    const validViews = ['list','board','calendar'];
    // Sort/group use `due` to match index.html + tasks.js (legacy state may have dueDate)
    let sortIn = s.taskSortBy;
    if(sortIn === 'dueDate') sortIn = 'due';
    if(sortIn === 'order') sortIn = 'manual';
    let groupIn = s.taskGroupBy;
    if(groupIn === 'dueDate') groupIn = 'due';
    const validSorts = ['smart','manual','priority','due','name','created','time','impact'];
    const validSmart = ['all','today','week','overdue','unscheduled','starred','impact','completed','archived'];
    const validGroup = ['none','priority','status','due','list'];
    if(s.taskView   && validViews.includes(s.taskView))  taskView   = s.taskView;
    if(sortIn && validSorts.includes(sortIn)) taskSortBy = sortIn;
    if(s.smartView  && validSmart.includes(s.smartView)) smartView  = s.smartView;
    if(groupIn && validGroup.includes(groupIn)) taskGroupBy = groupIn;
    if(s.theme      && ['dark','light'].includes(s.theme)) theme = s.theme;
    if(s.collapsedSections && typeof s.collapsedSections==='object') collapsedSections = s.collapsedSections;

    // Numerics
    if(Array.isArray(s.timeLog))     timeLog       = s.timeLog;
    if(s.totalPomos   !=null)        totalPomos    = _int(s.totalPomos,0);
    if(s.totalBreaks  !=null)        totalBreaks   = _int(s.totalBreaks,0);
    if(s.totalFocusSec!=null)        totalFocusSec = _int(s.totalFocusSec,0);
    if(Array.isArray(s.sessionHistory)) sessionHistory = s.sessionHistory;
    if(s.pomosInCycle !=null)        pomosInCycle  = _int(s.pomosInCycle,0);
    if(s.phase && ['work','short','long'].includes(s.phase)) phase = s.phase;

    // Intervals + quick timers
    if(Array.isArray(s.intervals)){  intervals = s.intervals; intIdCtr = _int(s.intIdCtr,0); }
    if(Array.isArray(s.quickTimers)){
      quickTimers = s.quickTimers; qtIdCtr = _int(s.qtIdCtr,0);
      quickTimers.forEach(qt=>{
        if(qt.running && qt.startedAt){
          const elapsed = Math.floor((Date.now()-qt.startedAt)/1000);
          const rem     = Math.max(0, _int(qt.pausedRem,0)-elapsed);
          if(rem<=0){ qt.running=false; qt.finished=true; qt.remaining=0; qt.pausedRem=0; }
          else qt.remaining = rem;
        }
      });
    }

    if(s.activeTab && VALID_MAIN_TABS.includes(s.activeTab)) activeTab = s.activeTab;

    return true;
  }catch(e){
    console.error('[storage] _applyState error:',e);
    return false;
  }
}

// ── Load — with multi-layer fallback ─────────────────────────────────────────
// Priority: localStorage → IDB → clean start (never crashes)
function loadState(){
  // Try localStorage first
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(raw){
      const s = JSON.parse(raw);
      const ok = _applyState(s);
      if(ok) return true;
    }
  }catch(e){ console.warn('[storage] localStorage load failed:',e); }

  // Async IDB fallback — if localStorage was empty or corrupt.
  // H5: the promise below resolves *after* the app has already initialized with
  // defaults, which means the user may have typed a task or tweaked settings
  // in the meantime. We must NEVER blindly replace live state. Only restore
  // when every user-writeable store is still at its pristine default.
  _idbGet(STORE_KEY).then(raw=>{
    if(!raw) return;
    try{
      if(!_isStatePristine()){
        // User is mid-session. Surface recovery as an opt-in toast rather than
        // clobbering their work. If showExportToast is missing (very early boot
        // or stripped build) we still log a visible warning.
        const msg = 'Backup found in IndexedDB but local data has diverged — kept current data.';
        if(typeof showExportToast === 'function') showExportToast(msg);
        console.warn('[storage]', msg);
        return;
      }
      const s = JSON.parse(raw);
      if(_applyState(s)){
        renderAll(); renderLog(); renderGoalList();
        renderIntList(); renderQuickTimers();
        applyTheme(); setTaskView(taskView); setSmartView(smartView);
        console.info('[storage] Recovered from IDB backup');
        if(typeof showExportToast === 'function') showExportToast('Restored from backup');
      }
    }catch(e){ console.warn('[storage] IDB fallback failed:',e); }
  });

  return false;
}

/** True when the in-memory state is still the post-boot defaults — i.e. the
 *  user has not typed, edited, or saved anything since this session started.
 *  Combines an explicit dirty flag (set by any `saveState('user')`) with a
 *  belt-and-suspenders check against the user-writeable stores. */
function _isStatePristine(){
  try{
    if(window._stateDirty) return false;
    if(Array.isArray(tasks)      && tasks.length)      return false;
    if(Array.isArray(goals)      && goals.length)      return false;
    if(Array.isArray(timeLog)    && timeLog.length)    return false;
    if(Array.isArray(intentions) && intentions.length) return false;
    if(Array.isArray(quickTimers)&& quickTimers.length)return false;
    return true;
  }catch(e){ return false; }
}

// ── Data export / import (manual backup) ─────────────────────────────────────
function exportData(){
  const raw = localStorage.getItem(STORE_KEY);
  const archive = localStorage.getItem(ARCHIVE_KEY);
  const blob = new Blob([JSON.stringify({export:raw,archive,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const fname = 'odtaulai-full-backup-'+todayKey()+'.json';
  a.download = fname;
  a.click(); URL.revokeObjectURL(a.href);
  if(typeof showExportToast === 'function') showExportToast('Exported full backup — '+fname);
}

function importData(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      const wrapper = JSON.parse(e.target.result);
      // Support both raw state JSON and wrapped export format
      const raw  = wrapper.export || e.target.result;
      const arch = wrapper.archive;
      const s    = JSON.parse(raw);
      if(!s||!Array.isArray(s.tasks)) throw new Error('Invalid backup file');
      // Force re-apply regardless of date
      s.date = todayKey();
      if(_applyState(s)){
        if(arch) localStorage.setItem(ARCHIVE_KEY, arch);
        saveState('user');
        renderAll(); renderLog(); renderGoalList();
        renderIntList(); renderQuickTimers();
        applyTheme(); setTaskView(taskView); setSmartView(smartView);
        alert('Data restored successfully — '+s.tasks.length+' tasks loaded.');
      } else { alert('Backup file could not be applied.'); }
    }catch(err){ alert('Import failed: '+err.message); }
  };
  reader.readAsText(file);
}

// ════════════════════════════════════════════════════════════════════════════
// UNIFIED TASK EXPORT / IMPORT — single schema shared between CSV and JSON
// ════════════════════════════════════════════════════════════════════════════
// Both formats contain the same fields. CSV flattens nested arrays (tags as
// semicolon-separated strings, checklist as "done/total", notes as count).
// JSON preserves full fidelity. Import auto-detects format and merges by id.

// Authoritative field list — the single source of truth for both formats.
// Order matters: this is the CSV column order.
const TASK_EXPORT_FIELDS = [
  'id','name','parentId','listId',
  'status','priority','starred','archived',
  'dueDate','startDate','remindAt','completedAt','created',
  'category','effort','energyLevel','context','type',
  'estimateMin','totalSec','sessions',
  'tags','valuesAlignment','blockedBy',
  'checklistDone','checklistTotal','notesCount',
  'description','url','completionNote','valuesNote',
  'recur','reminderFired',
  'lastModified',
];

// Convert a task object → flat row suitable for CSV or JSON export
function _taskToExportRow(t){
  const checklist = Array.isArray(t.checklist) ? t.checklist : [];
  const notes = Array.isArray(t.notes) ? t.notes : [];
  return {
    id:              t.id ?? null,
    name:            t.name || '',
    parentId:        t.parentId ?? null,
    listId:          t.listId ?? null,
    status:          t.status || 'open',
    priority:        t.priority || 'none',
    starred:         !!t.starred,
    archived:        !!t.archived,
    dueDate:         t.dueDate || null,
    startDate:       t.startDate || null,
    remindAt:        t.remindAt || null,
    completedAt:     t.completedAt || null,
    created:         t.created || '',
    category:        t.category || null,
    effort:          t.effort || null,
    energyLevel:     t.energyLevel || null,
    context:         t.context || null,
    type:            t.type || 'task',
    estimateMin:     t.estimateMin || 0,
    totalSec:        t.totalSec || 0,
    sessions:        t.sessions || 0,
    tags:            Array.isArray(t.tags) ? t.tags : [],
    valuesAlignment: Array.isArray(t.valuesAlignment) ? t.valuesAlignment : [],
    blockedBy:       Array.isArray(t.blockedBy) ? t.blockedBy : [],
    checklistDone:   checklist.filter(c=>c && c.done).length,
    checklistTotal:  checklist.length,
    notesCount:      notes.length,
    description:     t.description || '',
    url:             t.url || null,
    completionNote:  t.completionNote || null,
    valuesNote:      t.valuesNote || null,
    recur:           t.recur || null,
    reminderFired:   !!t.reminderFired,
    lastModified:    (typeof t.lastModified === 'number') ? t.lastModified : null,
    completions:     Array.isArray(t.completions) ? t.completions : [],
    habitLastRecordedTotalSec: (typeof t.habitLastRecordedTotalSec === 'number') ? t.habitLastRecordedTotalSec : null,
    // JSON-only rich fields (not in CSV columns but preserved in JSON export)
    _checklist:      checklist,
    _notes:          notes,
  };
}

// CSV helpers
function _csvEscape(v){
  if(v == null) return '';
  let s = String(v);
  // Neutralize spreadsheet formula injection (=, +, -, @, tab at cell start)
  if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  // Escape if contains comma, quote, newline, or leading/trailing whitespace
  if(/[",\n\r]/.test(s) || s !== s.trim()){
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function _csvJoinArray(arr){
  if(!Array.isArray(arr)) return '';
  // Use semicolon inside CSV cell for array values (comma is CSV separator)
  return arr.map(x => String(x).replace(/;/g, ',')).join(';');
}

function _csvSplitArray(s){
  if(!s || typeof s !== 'string') return [];
  return s.split(';').map(x => x.trim()).filter(x => x.length);
}

// ── Export tasks as CSV ───────────────────────────────────────────────────
function exportTasksCSV(){
  if(!Array.isArray(tasks) || tasks.length === 0){
    alert('No tasks to export');
    return;
  }
  const lines = [];
  lines.push(TASK_EXPORT_FIELDS.join(','));
  tasks.forEach(t => {
    const row = _taskToExportRow(t);
    const cells = TASK_EXPORT_FIELDS.map(f => {
      const v = row[f];
      if(Array.isArray(v)) return _csvEscape(_csvJoinArray(v));
      if(typeof v === 'boolean') return v ? '1' : '0';
      return _csvEscape(v);
    });
    lines.push(cells.join(','));
  });
  const csv = lines.join('\n');
  const blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'odtaulai-tasks-'+todayKey()+'.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  if(typeof showExportToast === 'function') showExportToast('Exported CSV — odtaulai-tasks-'+todayKey()+'.csv');
}

// ── Export tasks as JSON (full fidelity) ──────────────────────────────────
function exportTasksJSON(){
  if(!Array.isArray(tasks) || tasks.length === 0){
    alert('No tasks to export');
    return;
  }
  const payload = {
    kind: 'odtaulai-tasks',
    version: 1,
    exportedAt: new Date().toISOString(),
    taskCount: tasks.length,
    // Include the current lists so list membership survives the round trip
    lists: Array.isArray(lists) ? lists.map(l => ({id:l.id, name:l.name, color:l.color, description:l.description||''})) : [],
    tasks: tasks.map(t => {
      const row = _taskToExportRow(t);
      // In JSON, keep full arrays — drop the tabular-only derivations
      return {
        id: row.id, name: row.name, parentId: row.parentId, listId: row.listId,
        status: row.status, priority: row.priority, starred: row.starred, archived: row.archived,
        dueDate: row.dueDate, startDate: row.startDate, remindAt: row.remindAt,
        completedAt: row.completedAt, created: row.created,
        category: row.category, effort: row.effort, energyLevel: row.energyLevel,
        context: row.context, type: row.type,
        estimateMin: row.estimateMin, totalSec: row.totalSec, sessions: row.sessions,
        tags: row.tags, valuesAlignment: row.valuesAlignment, blockedBy: row.blockedBy,
        checklist: row._checklist, notes: row._notes,
        description: row.description, url: row.url,
        completionNote: row.completionNote, valuesNote: row.valuesNote,
        recur: row.recur, reminderFired: row.reminderFired,
        lastModified: row.lastModified,
      };
    }),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const jname = 'odtaulai-tasks-'+todayKey()+'.json';
  a.download = jname;
  a.click();
  URL.revokeObjectURL(a.href);
  if(typeof showExportToast === 'function') showExportToast('Exported JSON — '+jname);
}

// ── CSV parser (handles quoted fields with embedded commas/newlines/quotes) ─
function _parseCSV(text){
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for(let i = 0; i < s.length; i++){
    const c = s[i];
    if(inQuotes){
      if(c === '"'){
        if(s[i+1] === '"'){ cell += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cell += c;
      }
    } else {
      if(c === '"' && cell === ''){
        inQuotes = true;
      } else if(c === ','){
        row.push(cell); cell = '';
      } else if(c === '\n'){
        row.push(cell); rows.push(row); row = []; cell = '';
      } else {
        cell += c;
      }
    }
  }
  // Flush final cell/row if non-empty
  if(cell !== '' || row.length){ row.push(cell); rows.push(row); }
  return rows;
}

// Convert a row (from CSV parse OR JSON object) → task shape.
// Handles both: CSV rows come in with array fields as semicolon-joined strings,
// JSON rows come in with array fields as actual arrays.
function _csvRowToTask(obj, existingTask){
  // Start from existing if we're updating, otherwise blank slate with defaults
  const base = existingTask ? {...existingTask} : {
    totalSec:0, sessions:0, tags:[], blockedBy:[], valuesAlignment:[],
    checklist:[], notes:[], completions:[],
  };
  const T = {...base};

  const bool = v => v === '1' || v === 'true' || v === true;
  const num  = v => { const n = parseInt(v,10); return isNaN(n) ? 0 : n; };
  const str  = v => (v == null || v === '') ? null : String(v);
  const strReq = v => (v == null) ? '' : String(v);
  // Array helper: accept array as-is, or split string by semicolon
  const asArr = v => Array.isArray(v) ? v.slice() : _csvSplitArray(v);

  if('name' in obj)            T.name = strReq(obj.name);
  if('parentId' in obj)        T.parentId = (obj.parentId === '' || obj.parentId == null) ? null : num(obj.parentId);
  if('listId' in obj)          T.listId = (obj.listId === '' || obj.listId == null) ? null : num(obj.listId);
  if('status' in obj)          T.status = obj.status || 'open';
  if('priority' in obj)        T.priority = obj.priority || 'none';
  if('starred' in obj)         T.starred = bool(obj.starred);
  if('archived' in obj)        T.archived = bool(obj.archived);
  if('dueDate' in obj)         T.dueDate = str(obj.dueDate);
  if('startDate' in obj)       T.startDate = str(obj.startDate);
  if('remindAt' in obj)        T.remindAt = str(obj.remindAt);
  if('completedAt' in obj)     T.completedAt = str(obj.completedAt);
  if('created' in obj)         T.created = obj.created || '';
  if('category' in obj)        T.category = str(obj.category);
  if('effort' in obj)          T.effort = str(obj.effort);
  if('energyLevel' in obj)     T.energyLevel = str(obj.energyLevel);
  if('context' in obj)         T.context = str(obj.context);
  if('type' in obj)            T.type = obj.type || 'task';
  if('estimateMin' in obj)     T.estimateMin = num(obj.estimateMin);
  if('totalSec' in obj)        T.totalSec = num(obj.totalSec);
  if('sessions' in obj)        T.sessions = num(obj.sessions);
  if('tags' in obj)            T.tags = asArr(obj.tags).map(String);
  if('valuesAlignment' in obj) T.valuesAlignment = asArr(obj.valuesAlignment).map(String);
  if('blockedBy' in obj)       T.blockedBy = asArr(obj.blockedBy).map(x => parseInt(x,10)).filter(x => x > 0);
  if('description' in obj)     T.description = obj.description || '';
  if('url' in obj)             T.url = str(obj.url);
  if('completionNote' in obj)  T.completionNote = str(obj.completionNote);
  if('valuesNote' in obj)      T.valuesNote = str(obj.valuesNote);
  if('recur' in obj)           T.recur = str(obj.recur);
  if('reminderFired' in obj)   T.reminderFired = bool(obj.reminderFired);
  if('lastModified' in obj){
    const lm = parseInt(obj.lastModified, 10);
    if(!isNaN(lm) && lm > 0) T.lastModified = lm;
  }
  // checklist and notes — preserve if passed as arrays (JSON imports); CSV has counts only
  if(Array.isArray(obj.checklist)) T.checklist = obj.checklist;
  if(Array.isArray(obj.notes))     T.notes     = obj.notes;
  if(Array.isArray(obj.completions)) T.completions = obj.completions;
  if('habitLastRecordedTotalSec' in obj){
    const h = parseInt(obj.habitLastRecordedTotalSec, 10);
    T.habitLastRecordedTotalSec = (!isNaN(h) && h >= 0) ? h : null;
  }
  return T;
}

// ── Import tasks — auto-detects CSV vs JSON, merges by id ──────────────────
// Returns {added, updated, skipped, errors[]}
function importTasks(file){
  if(!file){ return; }
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    let report;
    try {
      if(file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{')){
        report = _importTasksFromJSON(text);
      } else {
        report = _importTasksFromCSV(text);
      }
    } catch(err){
      alert('Import failed: ' + err.message);
      return;
    }
    // After successful import, re-repair and save, then re-render
    try {
      // Run every task back through _repairTask to normalise types
      tasks = tasks.map(_repairTask).filter(Boolean);
      saveState('user');
      if(typeof renderTaskList === 'function') renderTaskList();
      if(typeof renderLists === 'function') renderLists();
    } catch(err){ console.warn('[import] post-save failed', err); }

    const parts = [];
    if(report.added)   parts.push(report.added + ' added');
    if(report.updated) parts.push(report.updated + ' updated');
    if(report.skipped) parts.push(report.skipped + ' skipped');
    const msg = 'Import complete: ' + (parts.join(', ') || 'no changes') +
                (report.errors.length ? '\n\nWarnings:\n• ' + report.errors.slice(0,5).join('\n• ') : '');
    alert(msg);
  };
  reader.readAsText(file);
}

function _importTasksFromJSON(text){
  const parsed = JSON.parse(text);
  if(!parsed || typeof parsed !== 'object') throw new Error('Not a valid JSON file');

  // Accept three shapes:
  //   1. { kind:'odtaulai-tasks' | 'stupind-tasks', tasks:[...] }  — native task export
  //   2. { tasks:[...] }                         — generic
  //   3. [...]                                   — bare array
  let incomingTasks;
  if(Array.isArray(parsed)) incomingTasks = parsed;
  else if(Array.isArray(parsed.tasks)) incomingTasks = parsed.tasks;
  else throw new Error('JSON does not contain a tasks array');

  // Import lists too if present (adds missing lists only, never overwrites)
  if(Array.isArray(parsed.lists)){
    parsed.lists.forEach(rl => {
      if(!rl || typeof rl !== 'object' || !rl.id) return;
      if(!lists.find(l => l.id === rl.id)){
        lists.push({
          id: rl.id,
          name: rl.name || 'Imported',
          color: rl.color || '#3d8bcc',
          description: typeof rl.description==='string' ? rl.description : '',
        });
        if(rl.id > listIdCtr) listIdCtr = rl.id;
      }
    });
  }

  const report = { added: 0, updated: 0, skipped: 0, errors: [] };
  incomingTasks.forEach((incoming, idx) => {
    if(!incoming || typeof incoming !== 'object'){
      report.errors.push('Row ' + (idx+1) + ': not an object');
      report.skipped++;
      return;
    }
    _applyIncomingTask(incoming, report);
  });
  return report;
}

function _importTasksFromCSV(text){
  const rows = _parseCSV(text);
  if(rows.length < 2) throw new Error('CSV must have a header row and at least one data row');
  const headers = rows[0].map(h => h.trim());
  if(!headers.includes('name')) throw new Error('CSV missing required "name" column');

  const report = { added: 0, updated: 0, skipped: 0, errors: [] };
  for(let i = 1; i < rows.length; i++){
    const row = rows[i];
    if(!row || (row.length === 1 && row[0] === '')) continue; // blank line
    const obj = {};
    headers.forEach((h, j) => { obj[h] = row[j] != null ? row[j] : ''; });
    if(!obj.name || !obj.name.trim()){
      report.errors.push('Row ' + (i+1) + ': missing name');
      report.skipped++;
      continue;
    }
    _applyIncomingTask(obj, report);
  }
  return report;
}

// Apply a single incoming row (from CSV parse or JSON object) — decide add vs update vs skip
function _applyIncomingTask(incoming, report){
  const incomingId = parseInt(incoming.id, 10);
  if(!isNaN(incomingId) && incomingId > 0){
    const existing = tasks.find(t => t.id === incomingId);
    if(existing){
      // Update existing — respect lastModified if both present (older loses)
      const newTask = _csvRowToTask(incoming, existing);
      const exLM = existing.lastModified || 0;
      const inLM = newTask.lastModified || 0;
      if(inLM && exLM && inLM < exLM){
        report.skipped++;
        return;
      }
      Object.assign(existing, newTask);
      report.updated++;
    } else {
      // ID provided but not local — add as new with preserved id
      const newTask = _csvRowToTask(incoming, null);
      newTask.id = incomingId;
      tasks.push(newTask);
      if(incomingId > taskIdCtr) taskIdCtr = incomingId;
      report.added++;
    }
  } else {
    // No id — always add as new with fresh id
    const newTask = _csvRowToTask(incoming, null);
    newTask.id = ++taskIdCtr;
    newTask.created = newTask.created || (typeof timeNowFull === 'function' ? timeNowFull() : new Date().toISOString());
    tasks.push(newTask);
    report.added++;
  }
}


// ── Misc ──────────────────────────────────────────────────────────────────────
function setToggle(id,val){ const el=gid(id); if(!el)return; if(val)el.classList.add('on'); else el.classList.remove('on'); }

function archiveDay(state){
  try{
    const archives = JSON.parse(localStorage.getItem(ARCHIVE_KEY)||'[]');
    if(archives.find(a=>a.date===state.date)) return;
    archives.push({
      date:          state.date,
      totalPomos:    _int(state.totalPomos,0),
      totalBreaks:   _int(state.totalBreaks,0),
      totalFocusSec: _int(state.totalFocusSec,0),
      goals:  _arr(state.goals).map(g=>({text:g.text,done:g.done,doneAt:g.doneAt})),
      tasks:  _arr(state.tasks).map(t=>({
        id:t.id, name:t.name,
        totalSec:t.totalSec, sessions:t.sessions,
        parentId:t.parentId||null,
        status:t.status, priority:t.priority,
        category:t.category, effort:t.effort, context:t.context,
        type:t.type, energyLevel:t.energyLevel,
        dueDate:t.dueDate, completedAt:t.completedAt,
        valuesAlignment:t.valuesAlignment||[],
        tags:t.tags||[],
        checklistDone:(t.checklist||[]).filter(c=>c.done).length,
        checklistTotal:(t.checklist||[]).length,
        listId:t.listId,
      })),
      timeLog: _arr(state.timeLog),
      sessionHistory: _arr(state.sessionHistory),
    });
    while(archives.length>90) archives.shift();
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archives));
  }catch(e){ console.warn('[storage] archiveDay failed', e); }
}

let _autoSaveDebounce = null;
function queueAutoSave(){
  clearTimeout(_autoSaveDebounce);
  _autoSaveDebounce = setTimeout(() => {
    _autoSaveDebounce = null;
    saveState('auto');
  }, 450);
}

let _saveIndLast = 0;
function showSaveIndicator(){
  const el = gid('saveInd'); if(!el)return;
  const now = Date.now();
  if(now - _saveIndLast < 4000) return;
  _saveIndLast = now;
  el.classList.add('show');
  clearTimeout(el._saveIndT);
  el._saveIndT = setTimeout(()=>{ el.classList.remove('show'); }, 900);
}

// Auto-save every 10s, on tab hide, and on unload (no save pill)
setInterval(() => queueAutoSave(), 10000);
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) queueAutoSave(); });
window.addEventListener('beforeunload', () => saveState('unload'));
