// ========== ON-DEVICE AI ENGINE (WebLLM + Gemma 2B) ==========
// Full CRUD via tool-calling. Preview-diff confirmation. Undo history.
// Runs 100% in the browser via WebGPU. No server. No API key.

const WEBLLM_CDN = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.73/+esm';
const AI_MODEL   = 'gemma-2-2b-it-q4f32_1-MLC';
const AI_CFG_KEY = 'stupind_ai_cfg';
const MODEL_FLAG = 'stupind_model_ready';

const LIFE_CATS = ['health','finance','work','relationships','learning','home','personal','other'];
const CAT_ICON  = {health:'❤',finance:'💰',work:'💼',relationships:'🤝',learning:'📚',home:'🏠',personal:'🧘',other:'📌'};

const SCHWARTZ = {
  'self-direction':{ icon:'🧭', def:'Independent thought, creativity, freedom to choose your own goals.' },
  'stimulation':   { icon:'⚡', def:'Excitement, novelty, challenge, variety over routine.' },
  'hedonism':      { icon:'🌟', def:'Pleasure, enjoyment, comfort, sensory gratification.' },
  'achievement':   { icon:'🏆', def:'Personal success, demonstrated competence, goal achievement.' },
  'power':         { icon:'👑', def:'Social status, authority, control over resources and people.' },
  'security':      { icon:'🛡', def:'Safety, stability, harmony — reducing risk and uncertainty.' },
  'conformity':    { icon:'🤝', def:'Meeting obligations, honoring commitments, maintaining harmony.' },
  'tradition':     { icon:'🏛', def:'Respect for cultural customs, family traditions.' },
  'benevolence':   { icon:'❤', def:'Welfare of close others — family, friends, community.' },
  'universalism':  { icon:'🌍', def:'Welfare of all people and nature — justice, sustainability.' },
};
const VALUE_KEYS = Object.keys(SCHWARTZ);

// ══════════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY
// ══════════════════════════════════════════════════════════════════════════════
const TOOLS = {
  CREATE_TASK: {
    sig: 'CREATE_TASK(name="...", priority?, category?, dueDate?, description?, tags?, parentId?, effort?, type?, listId?)',
    desc: 'Create a new task. name is required. dueDate YYYY-MM-DD. tags comma-separated.',
    group: 'create',
  },
  UPDATE_TASK: {
    sig: 'UPDATE_TASK(id=N, name?, priority?, status?, dueDate?, startDate?, effort?, energyLevel?, context?, category?, description?, url?, estimateMin?, starred?, type?)',
    desc: 'Update any field. Use null to clear.',
    group: 'update',
  },
  MARK_DONE: {
    sig: 'MARK_DONE(id=N, completionNote?)',
    desc: 'Mark task done with optional completion note.',
    group: 'update',
  },
  REOPEN: { sig:'REOPEN(id=N)', desc:'Reopen a completed task.', group:'update' },
  TOGGLE_STAR: { sig:'TOGGLE_STAR(id=N)', desc:'Toggle star.', group:'update' },
  ARCHIVE_TASK: { sig:'ARCHIVE_TASK(id=N)', desc:'Archive task + subtasks.', group:'delete' },
  RESTORE_TASK: { sig:'RESTORE_TASK(id=N)', desc:'Restore archived task.', group:'delete' },
  DELETE_TASK: { sig:'DELETE_TASK(id=N)', desc:'PERMANENT delete. Archived only.', group:'delete' },
  DUPLICATE_TASK: { sig:'DUPLICATE_TASK(id=N)', desc:'Copy a task.', group:'create' },
  MOVE_TASK: { sig:'MOVE_TASK(id=N, newParentId=N|null)', desc:'Change parent.', group:'structure' },
  CHANGE_LIST: { sig:'CHANGE_LIST(id=N, listId=N)', desc:'Move to different list.', group:'structure' },
  ADD_NOTE: { sig:'ADD_NOTE(id=N, text="...")', desc:'Append timestamped note.', group:'content' },
  ADD_CHECKLIST: { sig:'ADD_CHECKLIST(id=N, text="...")', desc:'Add checklist item.', group:'content' },
  TOGGLE_CHECK: { sig:'TOGGLE_CHECK(id=N, checkId=N)', desc:'Toggle checklist done.', group:'content' },
  REMOVE_CHECK: { sig:'REMOVE_CHECK(id=N, checkId=N)', desc:'Remove checklist item.', group:'content' },
  ADD_TAG: { sig:'ADD_TAG(id=N, tag="...")', desc:'Add tag.', group:'content' },
  REMOVE_TAG: { sig:'REMOVE_TAG(id=N, tag="...")', desc:'Remove tag.', group:'content' },
  ADD_BLOCKER: { sig:'ADD_BLOCKER(id=N, blockerId=N)', desc:'Mark task blocked by another.', group:'deps' },
  REMOVE_BLOCKER: { sig:'REMOVE_BLOCKER(id=N, blockerId=N)', desc:'Unblock.', group:'deps' },
  SET_REMINDER: { sig:'SET_REMINDER(id=N, remindAt="YYYY-MM-DDTHH:MM")', desc:'Set reminder.', group:'update' },
  SET_RECUR: { sig:'SET_RECUR(id=N, recur="daily"|"weekdays"|"weekly"|"monthly"|null)', desc:'Set recurrence.', group:'update' },
};

function _selectTools(msg){
  const m = msg.toLowerCase();
  const groups = new Set();
  if(/\b(create|add|new|make|need to|add a)\b/.test(m)) groups.add('create');
  if(/\b(update|set|change|mark|priority|due|effort|status)\b/.test(m)) groups.add('update');
  if(/\b(delete|remove|archive|trash|clear)\b/.test(m)){ groups.add('delete'); groups.add('update'); }
  if(/\b(link|block|depend|waiting on|requires)\b/.test(m)) groups.add('deps');
  if(/\b(note|checklist|item|tag)\b/.test(m)) groups.add('content');
  if(/\b(move|parent|subtask|list)\b/.test(m)) groups.add('structure');
  if(/\b(done|complete|finished|reopen)\b/.test(m)) groups.add('update');
  if(/\b(remind|recur|repeat|daily|weekly)\b/.test(m)) groups.add('update');

  const analytical = /^(how|what|which|why|when|show|tell|list|summarize|analyze|count)/.test(m);
  if(analytical && groups.size===0) return [];
  if(groups.size===0){ ['create','update','delete','content','deps','structure'].forEach(g=>groups.add(g)); }
  return Object.entries(TOOLS).filter(([_,t])=>groups.has(t.group)).map(([n])=>n);
}

// ══════════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════════
const CHAT_HISTORY_KEY = 'stupind_ai_chat_history';
const CHAT_HISTORY_MAX = 40; // keep last 20 turns (40 messages)

let _engine=null, _aiReady=false, _aiLoading=false;
let _cfg=null, _pendingOps=[], _undoStack=[];
let _engineBusy=false; // true while inference is running — prevents concurrent calls

// Load persisted chat history on init
let _chatHistory = (() => {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if(!raw) return [];
    const parsed = JSON.parse(raw);
    if(!Array.isArray(parsed)) return [];
    return parsed.slice(-CHAT_HISTORY_MAX);
  } catch(e) { return []; }
})();

function _persistChatHistory(){
  try {
    // Trim to max before persisting
    const trimmed = _chatHistory.slice(-CHAT_HISTORY_MAX);
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(trimmed));
  } catch(e) { /* quota full or private mode — silent */ }
}

function _loadCfg(){
  try{_cfg=JSON.parse(localStorage.getItem(AI_CFG_KEY)||'{}');}catch(e){_cfg={};}
  _cfg.dominant = Array.isArray(_cfg.dominant)?_cfg.dominant:[];
  _cfg.mode = _cfg.mode||'chat';
  return _cfg;
}
function _saveCfg(){try{localStorage.setItem(AI_CFG_KEY,JSON.stringify(_cfg));}catch(e){}}

// ══════════════════════════════════════════════════════════════════════════════
// WEBLLM
// ══════════════════════════════════════════════════════════════════════════════
async function _loadWebLLM(){
  if(window._WebLLM) return window._WebLLM;
  const urls=[WEBLLM_CDN,'https://unpkg.com/@mlc-ai/web-llm@0.2.73/lib/index.esm.js'];
  let last;
  for(const url of urls){
    try{const mod=await import(url);window._WebLLM=mod;return mod;}catch(e){last=e;}
  }
  throw last;
}

async function aiDownload(){
  if(_aiReady){_setStatus('ready','✓ Gemma ready');return;}
  if(_aiLoading) return;
  _aiLoading=true;
  const btn=document.getElementById('aiDownloadBtn');
  const wrap=document.getElementById('aiProgressWrap');
  const bar=document.getElementById('aiProgressBar');
  const pct=document.getElementById('aiProgressPct');
  const mb=document.getElementById('aiProgressMB');
  if(btn) btn.disabled=true;
  if(wrap) wrap.style.display='';
  _setStatus('loading','Loading WebLLM…');

  let WebLLM;
  try{WebLLM=await _loadWebLLM();}
  catch(err){
    _aiLoading=false;
    if(btn){btn.disabled=false;btn.textContent='⬇ Retry Download';}
    _setStatus('error','✕ Could not load WebLLM — check internet');return;
  }

  _setStatus('loading','Starting download (~1.5 GB)…');
  let _dlStart=Date.now(), _dlLastLoaded=0, _dlLastTime=Date.now(), _dlSpeedEMA=0;
  try{
    _engine=await WebLLM.CreateMLCEngine(AI_MODEL,{
      initProgressCallback:(p)=>{
        const pctVal=p.progress!=null?Math.round(p.progress*100):0;
        const loadedBytes=p.loaded_size_bytes||0;
        const totalBytes =p.total_size_bytes ||1500*1024*1024;
        const loaded=(loadedBytes/1024/1024).toFixed(0);
        const total =(totalBytes /1024/1024).toFixed(0);

        // Calculate rolling speed (EMA) and ETA
        const now=Date.now();
        const dt=Math.max(0.1,(now-_dlLastTime)/1000);
        const dBytes=loadedBytes-_dlLastLoaded;
        if(dBytes>0){
          const instSpeed=dBytes/dt; // bytes/sec
          _dlSpeedEMA = _dlSpeedEMA===0 ? instSpeed : _dlSpeedEMA*0.7 + instSpeed*0.3;
        }
        _dlLastTime=now; _dlLastLoaded=loadedBytes;

        let etaStr='';
        if(_dlSpeedEMA>0 && loadedBytes<totalBytes){
          const etaSec=Math.round((totalBytes-loadedBytes)/_dlSpeedEMA);
          const mbps=(_dlSpeedEMA/1024/1024).toFixed(1);
          if(etaSec<60) etaStr=`~${etaSec}s left · ${mbps} MB/s`;
          else etaStr=`~${Math.round(etaSec/60)}m ${etaSec%60}s left · ${mbps} MB/s`;
        }

        if(bar) bar.style.width=pctVal+'%';
        if(pct) pct.textContent=pctVal+'%';
        if(mb)  mb.innerHTML=`${loaded}MB / ${total}MB${etaStr?` <span class="ai-progress-eta">${etaStr}</span>`:''}`;
        _setStatus('loading',p.text||'Downloading '+pctVal+'%');
      }
    });
    _aiReady=true;_aiLoading=false;
    localStorage.setItem(MODEL_FLAG,'1');
    if(bar) bar.style.width='100%';
    if(pct) pct.textContent='100%';
    if(mb)  mb.textContent='Complete';
    _setStatus('ready','✓ Gemma ready — works offline');
    renderAIPanel();
    // Re-check enhance button visibility on task input (Gemma now ready)
    if(typeof maybeShowEnhanceBtn==='function') maybeShowEnhanceBtn();
  }catch(err){
    _aiLoading=false;
    if(btn){btn.disabled=false;btn.textContent='⬇ Retry Download';}
    const msg=err.message||String(err);
    _setStatus('error',msg.includes('WebGPU')?'✕ WebGPU unavailable — Chrome 113+ desktop':'✕ '+msg.slice(0,100));
  }
}
async function aiInit(){if(!_aiReady&&!_aiLoading) aiDownload();}

// ══════════════════════════════════════════════════════════════════════════════
// CONTEXT
// ══════════════════════════════════════════════════════════════════════════════
function _buildContext(){
  const today=typeof todayKey==='function'?todayKey():new Date().toISOString().slice(0,10);
  const active=tasks.filter(t=>t.status!=='done'&&!t.archived);

  const byCategory={}, byPriority={urgent:0,high:0,normal:0,low:0,none:0}, byContext={};
  const byStatus={open:0,progress:0,review:0,blocked:0};
  const overdue=[], dueToday=[], blocked=[], starred=[];
  let estMin=0, trackedSec=0;

  active.forEach(t=>{
    const c=t.category||'uncategorized';
    if(!byCategory[c]) byCategory[c]={count:0,urgent:0};
    byCategory[c].count++;
    if(t.priority==='urgent') byCategory[c].urgent++;
    byStatus[t.status||'open']=(byStatus[t.status||'open']||0)+1;
    byPriority[t.priority||'none']++;
    if(t.context) byContext[t.context]=(byContext[t.context]||0)+1;
    if(t.dueDate&&t.dueDate<today) overdue.push(t.id);
    if(t.dueDate===today) dueToday.push(t.id);
    if((t.blockedBy||[]).length) blocked.push(t.id);
    if(t.starred) starred.push(t.id);
    estMin+=(t.estimateMin||0);
    trackedSec+=(t.totalSec||0);
  });

  return {
    today,
    lists: lists.map(l=>({id:l.id,name:l.name})),
    stats:{
      totalActive:active.length,
      overdue:overdue.length, dueToday:dueToday.length,
      blocked:blocked.length, starred:starred.length,
      byCategory, byStatus, byPriority, byContext,
      totalEstMin:estMin, totalTrackedHr:Math.round(trackedSec/3600*10)/10,
    },
    tasks: active.map(t=>({
      id:t.id, name:t.name,
      status:t.status, priority:t.priority, type:t.type||'task',
      effort:t.effort, energy:t.energyLevel, ctx:t.context, cat:t.category,
      values:t.valuesAlignment||[],
      due:t.dueDate, start:t.startDate, rem:t.remindAt, recur:t.recur,
      star:t.starred, tags:t.tags||[],
      estMin:t.estimateMin||0,
      trackedMin:Math.round((t.totalSec||0)/60),
      blocked:t.blockedBy||[],
      checklist:(t.checklist||[]).map(c=>({id:c.id,text:c.text,done:c.done})),
      notesCount:(t.notes||[]).length,
      parent:t.parentId,
      list:t.listId,
      desc:(t.description||'').slice(0,120),
    })),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PROMPT
// ══════════════════════════════════════════════════════════════════════════════
function _buildChatPrompt(userMsg, availableTools){
  const toolList = availableTools.length
    ? availableTools.map(n=>`  • ${TOOLS[n].sig}\n    ${TOOLS[n].desc}`).join('\n')
    : '(no write tools — answer from context only)';

  return `You are a task-management assistant in STUPInD. You have full read access to the user's tasks and can propose changes.

AVAILABLE TOOLS:
${toolList}

RULES:
1. First briefly explain what you'll do in plain English.
2. If changes needed, END with a TOOLS block:
TOOLS:
CREATE_TASK(name="Buy groceries", priority="normal", dueDate="2026-04-20")
UPDATE_TASK(id=42, status="progress")
MARK_DONE(id=87)

3. One call per line. Exact argument names. Strings quoted. Numbers unquoted. null to clear.
4. Only reference task IDs that exist.
5. If no changes needed, omit the TOOLS block.
6. Be concise.`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PARSER
// ══════════════════════════════════════════════════════════════════════════════
function _parseToolCalls(text){
  const ops=[];
  // Accept TOOLS:, Tools:, tools: as block marker
  const markerMatch = text.match(/\n?\s*tools\s*:/i);
  if(!markerMatch) return {ops, reasoning:text.trim()};
  const idx = markerMatch.index;
  const reasoning=text.slice(0,idx).trim();
  const block=text.slice(idx+markerMatch[0].length).trim();
  // Accept both CREATE_TASK and create_task — normalize to uppercase
  const re=/([A-Za-z_]+)\s*\(([^)]*)\)/g;
  let m;
  while((m=re.exec(block))!==null){
    const name=m[1].toUpperCase();
    if(!TOOLS[name]) continue;
    ops.push({name, args:_parseArgs(m[2])});
  }
  return {ops, reasoning};
}

function _parseArgs(str){
  const args={};
  const re=/(\w+)\s*=\s*("([^"]*)"|'([^']*)'|null|true|false|-?\d+(?:\.\d+)?|\w+)/g;
  let m;
  while((m=re.exec(str))!==null){
    const key=m[1], raw=m[2];
    if(raw==='null') args[key]=null;
    else if(raw==='true') args[key]=true;
    else if(raw==='false') args[key]=false;
    else if(m[3]!==undefined) args[key]=m[3];
    else if(m[4]!==undefined) args[key]=m[4];
    else if(/^-?\d+(\.\d+)?$/.test(raw)) args[key]=Number(raw);
    else args[key]=raw;
  }
  return args;
}

// Extract a balanced JSON object from arbitrary text. Returns null if no
// valid top-level {...} block found. Handles nested braces + strings.
function _extractJSONBlock(text){
  const start = text.indexOf('{');
  if(start<0) return null;
  let depth=0, inStr=false, esc=false;
  for(let i=start;i<text.length;i++){
    const c=text[i];
    if(inStr){
      if(esc){esc=false;continue;}
      if(c==='\\'){esc=true;continue;}
      if(c==='"') inStr=false;
      continue;
    }
    if(c==='"'){inStr=true;continue;}
    if(c==='{') depth++;
    else if(c==='}'){
      depth--;
      if(depth===0) return text.slice(start,i+1);
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// DIFF PREVIEW
// ══════════════════════════════════════════════════════════════════════════════
function _describeOp(op){
  const a=op.args;
  const t=a.id?findTask(a.id):null;
  const nm=t?`"${t.name.slice(0,40)}"`:(a.name?`"${String(a.name).slice(0,40)}"`:'');
  switch(op.name){
    case 'CREATE_TASK':    return `➕ Create ${nm}`+_flds(a,['priority','category','dueDate','effort']);
    case 'UPDATE_TASK':    return `✎ Update ${nm}`+_chgs(t,a);
    case 'MARK_DONE':      return `✓ Done: ${nm}`+(a.completionNote?` — "${String(a.completionNote).slice(0,40)}"`:'');
    case 'REOPEN':         return `↻ Reopen: ${nm}`;
    case 'TOGGLE_STAR':    return `${t?.starred?'☆ Unstar':'★ Star'}: ${nm}`;
    case 'ARCHIVE_TASK':   return `📦 Archive: ${nm}`;
    case 'RESTORE_TASK':   return `♻ Restore: ${nm}`;
    case 'DELETE_TASK':    return `🗑 DELETE FOREVER: ${nm}`;
    case 'DUPLICATE_TASK': return `⎘ Duplicate: ${nm}`;
    case 'MOVE_TASK':      return `↱ Move ${nm} → parent #${a.newParentId||'(top)'}`;
    case 'CHANGE_LIST':    { const l=lists.find(x=>x.id===a.listId); return `↦ Move ${nm} → "${l?.name||'#'+a.listId}"`; }
    case 'ADD_NOTE':       return `📝 Note on ${nm}: "${String(a.text||'').slice(0,50)}"`;
    case 'ADD_CHECKLIST':  return `☐ Checklist on ${nm}: "${String(a.text||'').slice(0,50)}"`;
    case 'TOGGLE_CHECK':   return `☑ Toggle check #${a.checkId} on ${nm}`;
    case 'REMOVE_CHECK':   return `✕ Remove check #${a.checkId} from ${nm}`;
    case 'ADD_TAG':        return `🏷 +tag "${a.tag}" on ${nm}`;
    case 'REMOVE_TAG':     return `✕ -tag "${a.tag}" from ${nm}`;
    case 'ADD_BLOCKER':    { const b=findTask(a.blockerId); return `🚫 Block ${nm} by "${b?.name.slice(0,30)||'#'+a.blockerId}"`; }
    case 'REMOVE_BLOCKER': return `✓ Unblock ${nm} from #${a.blockerId}`;
    case 'SET_REMINDER':   return `⏰ Remind ${nm}: ${a.remindAt}`;
    case 'SET_RECUR':      return a.recur?`↻ ${a.recur} recurrence on ${nm}`:`✕ Clear recurrence on ${nm}`;
    default: return op.name+'(...)';
  }
}
function _flds(a,keys){
  const p=keys.filter(k=>a[k]!=null).map(k=>`${k}=${a[k]}`);
  return p.length?` [${p.join(', ')}]`:'';
}
function _chgs(t,a){
  if(!t) return ' (task not found)';
  const skip=new Set(['id']);
  const d=[];
  Object.entries(a).forEach(([k,v])=>{
    if(skip.has(k)) return;
    const o=t[k];
    if(o!==v){
      const os=o==null?'∅':String(o).slice(0,18);
      const ns=v==null?'∅':String(v).slice(0,18);
      d.push(`${k}: ${os}→${ns}`);
    }
  });
  return d.length?' — '+d.join(', '):' (no change)';
}

// ══════════════════════════════════════════════════════════════════════════════
// EXECUTOR
// ══════════════════════════════════════════════════════════════════════════════
function _executeOp(op){
  const a=op.args;
  let snap=null;
  switch(op.name){
    case 'CREATE_TASK':{
      const id=++taskIdCtr;
      const nt=Object.assign({
        id, name:String(a.name||'Untitled'),
        totalSec:0, sessions:0, created:timeNowFull(),
        parentId:a.parentId||null, collapsed:false,
      }, defaultTaskProps(), {
        priority:a.priority||'none',
        category:a.category||null,
        dueDate:a.dueDate||null,
        description:a.description||'',
        tags:a.tags?String(a.tags).split(',').map(s=>s.trim()).filter(Boolean):[],
        effort:a.effort||null,
        type:a.type||'task',
        listId:a.listId||activeListId,
      });
      tasks.push(nt);
      snap={type:'created',id};
      break;
    }
    case 'UPDATE_TASK':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{...t}};
      const allow=['name','priority','status','dueDate','startDate','effort','energyLevel','context','category','description','url','estimateMin','starred','type'];
      allow.forEach(f=>{if(a[f]!==undefined) t[f]=a[f];});
      if(t.status==='done'&&!t.completedAt) t.completedAt=timeNow();
      if(t.status!=='done') t.completedAt=null;
      break;
    }
    case 'MARK_DONE':{
      const t=findTask(a.id);if(!t) return null;
      const beforeLen = tasks.length;
      snap={type:'updated',id:t.id,before:{...t}};
      t.status='done'; t.completedAt=timeNow();
      if(a.completionNote) t.completionNote=String(a.completionNote);
      // If a recurring clone was spawned, also snapshot its creation so undo removes it
      if(t.recur){
        spawnRecurringClone(t);
        if(tasks.length > beforeLen){
          const cloneId = tasks[tasks.length-1].id;
          snap={type:'batch',snaps:[
            {type:'updated',id:t.id,before:snap.before},
            {type:'created',id:cloneId},
          ]};
        }
      }
      break;
    }
    case 'REOPEN':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{...t}};
      t.status='open'; t.completedAt=null;
      break;
    }
    case 'TOGGLE_STAR':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{...t}};
      t.starred=!t.starred;
      break;
    }
    case 'ARCHIVE_TASK':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{...t}};
      t.archived=true;
      getTaskDescendantIds(t.id).forEach(did=>{const d=findTask(did);if(d) d.archived=true;});
      break;
    }
    case 'RESTORE_TASK':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{...t}};
      t.archived=false;
      getTaskDescendantIds(t.id).forEach(did=>{const d=findTask(did);if(d) d.archived=false;});
      break;
    }
    case 'DELETE_TASK':{
      const t=findTask(a.id);if(!t||!t.archived) return null;
      snap={type:'deleted',before:{...t}};
      const desc=getTaskDescendantIds(t.id);
      tasks=tasks.filter(x=>x.id!==t.id&&!desc.includes(x.id));
      break;
    }
    case 'DUPLICATE_TASK':{
      const src=findTask(a.id);if(!src) return null;
      const id=++taskIdCtr;
      tasks.push(Object.assign({},src,{
        id, name:src.name+' (copy)',
        totalSec:0, sessions:0, created:timeNowFull(),
        completedAt:null, status:'open', archived:false,
        tags:[...(src.tags||[])], blockedBy:[],
        checklist:(src.checklist||[]).map(c=>({...c,done:false,doneAt:null})),
        notes:[],
      }));
      snap={type:'created',id};
      break;
    }
    case 'MOVE_TASK':{
      const t=findTask(a.id);if(!t) return null;
      if(a.newParentId&&getTaskDescendantIds(t.id).includes(a.newParentId)) return null;
      snap={type:'updated',id:t.id,before:{...t}};
      t.parentId=a.newParentId||null;
      break;
    }
    case 'CHANGE_LIST':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{...t}};
      t.listId=a.listId;
      break;
    }
    case 'ADD_NOTE':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{notes:[...(t.notes||[])]}};
      if(!t.notes) t.notes=[];
      t.notes.unshift({id:Date.now()+Math.random(),text:'[AI] '+String(a.text||''),createdAt:timeNow()});
      break;
    }
    case 'ADD_CHECKLIST':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{checklist:[...(t.checklist||[])]}};
      if(!t.checklist) t.checklist=[];
      t.checklist.push({id:Date.now()+Math.random(),text:String(a.text||''),done:false,doneAt:null});
      break;
    }
    case 'TOGGLE_CHECK':{
      const t=findTask(a.id);if(!t) return null;
      const it=(t.checklist||[]).find(c=>c.id===a.checkId);
      if(!it) return null;
      snap={type:'updated',id:t.id,before:{checklist:JSON.parse(JSON.stringify(t.checklist))}};
      it.done=!it.done;
      it.doneAt=it.done?timeNow():null;
      break;
    }
    case 'REMOVE_CHECK':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{checklist:[...(t.checklist||[])]}};
      t.checklist=(t.checklist||[]).filter(c=>c.id!==a.checkId);
      break;
    }
    case 'ADD_TAG':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{tags:[...(t.tags||[])]}};
      if(!t.tags) t.tags=[];
      const tag=String(a.tag||'').trim();
      if(tag&&!t.tags.includes(tag)) t.tags.push(tag);
      break;
    }
    case 'REMOVE_TAG':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{tags:[...(t.tags||[])]}};
      t.tags=(t.tags||[]).filter(x=>x!==a.tag);
      break;
    }
    case 'ADD_BLOCKER':{
      const t=findTask(a.id);if(!t||a.blockerId===a.id) return null;
      snap={type:'updated',id:t.id,before:{blockedBy:[...(t.blockedBy||[])]}};
      if(!t.blockedBy) t.blockedBy=[];
      if(!t.blockedBy.includes(a.blockerId)) t.blockedBy.push(a.blockerId);
      break;
    }
    case 'REMOVE_BLOCKER':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{blockedBy:[...(t.blockedBy||[])]}};
      t.blockedBy=(t.blockedBy||[]).filter(x=>x!==a.blockerId);
      break;
    }
    case 'SET_REMINDER':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{...t}};
      t.remindAt=a.remindAt||null;
      t.reminderFired=false;
      break;
    }
    case 'SET_RECUR':{
      const t=findTask(a.id);if(!t) return null;
      snap={type:'updated',id:t.id,before:{...t}};
      t.recur=a.recur||null;
      break;
    }
    default: return null;
  }
  return snap;
}

// ══════════════════════════════════════════════════════════════════════════════
// UNDO
// ══════════════════════════════════════════════════════════════════════════════
function _pushUndo(label, snaps){
  _undoStack.unshift({timestamp:Date.now(),label,snapshots:snaps});
  if(_undoStack.length>10) _undoStack.pop();
}

function aiUndo(){
  const b=_undoStack.shift();
  if(!b){_setStatus('idle','Nothing to undo'); _renderUndoBtn(); return;}
  // Flatten batch snapshots for processing
  const flat = [];
  b.snapshots.forEach(s=>{
    if(s.type==='batch'&&Array.isArray(s.snaps)) flat.push(...s.snaps);
    else flat.push(s);
  });
  flat.forEach(s=>{
    if(s.type==='created') tasks=tasks.filter(t=>t.id!==s.id);
    else if(s.type==='updated'){ const t=findTask(s.id); if(t) Object.assign(t,s.before); }
    else if(s.type==='deleted') tasks.push(s.before);
  });
  saveState();
  if(typeof renderTaskList==='function') renderTaskList();
  _appendChat('system',`↩ Undone: ${b.label}`);
  _renderUndoBtn();
  _setStatus('ready',`↩ Reverted ${flat.length} change${flat.length!==1?'s':''}`);
}

function _renderUndoBtn(){
  const btn=document.getElementById('aiUndoBtn');
  if(!btn) return;
  btn.style.display=_undoStack.length?'':'none';
  btn.textContent=`↩ Undo (${_undoStack.length})`;
}

// ══════════════════════════════════════════════════════════════════════════════
// CHAT
// ══════════════════════════════════════════════════════════════════════════════
async function aiChat(){
  if(!_aiReady){await aiDownload();return;}
  if(_engineBusy){_setStatus('error','AI is busy — wait for current request to finish');return;}
  const input=document.getElementById('aiChatInput');
  const msg=(input?.value||'').trim();
  if(!msg){_setStatus('error','Type a message first');return;}

  _engineBusy=true;
  _appendChat('user',msg);
  if(input) input.value='';
  _setRunWorking(true);
  _setStatus('thinking','⚙ Gemma thinking…');

  const ctx=_buildContext();
  const availableTools=_selectTools(msg);
  const systemPrompt=_buildChatPrompt(msg,availableTools);

  const ctxSummary=JSON.stringify({
    today:ctx.today, stats:ctx.stats, lists:ctx.lists,
    tasks:ctx.tasks.slice(0,80),
  });

  const messages=[
    {role:'system',content:systemPrompt},
    {role:'user',content:'CONTEXT:\n'+ctxSummary},
    {role:'assistant',content:'Got it. What can I help with?'},
    ..._chatHistory.slice(-6),
    {role:'user',content:msg},
  ];

  try{
    const reply=await _engine.chat.completions.create({
      messages, temperature:0.2, max_tokens:1200,
    });
    const raw=reply.choices[0].message.content.trim();
    _chatHistory.push({role:'user',content:msg});
    _chatHistory.push({role:'assistant',content:raw});
    _persistChatHistory();

    const {ops,reasoning}=_parseToolCalls(raw);
    _appendChat('assistant',reasoning||'(no response text)');
    if(ops.length){
      _pendingOps=ops;
      _renderPendingOps();
    } else {
      _setStatus('ready','✓ Done — no changes proposed');
    }
  }catch(err){
    const m=err.message||String(err);
    _appendChat('system','Error: '+m.slice(0,150));
    _setStatus('error','✕ '+m.slice(0,80));
  }finally{
    _engineBusy=false;
    _setRunWorking(false);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONFIRMATION UI
// ══════════════════════════════════════════════════════════════════════════════
function _renderPendingOps(){
  const wrap=document.getElementById('aiPendingOps');
  if(!wrap) return;
  if(!_pendingOps.length){wrap.innerHTML='';wrap.style.display='none';return;}
  wrap.style.display='';
  const rows=_pendingOps.map((op,i)=>{
    const desc=_describeOp(op);
    const danger=op.name==='DELETE_TASK';
    return `<label class="pending-op-row ${danger?'pending-danger':''}">
      <input type="checkbox" class="pending-op-check" data-idx="${i}" checked>
      <span class="pending-op-desc">${esc(desc)}</span>
    </label>`;
  }).join('');
  wrap.innerHTML=`
    <div class="pending-hdr">
      <span class="pending-title">Proposed Changes (${_pendingOps.length})</span>
      <button class="pending-toggle-all" onclick="aiToggleAllPending()">Toggle all</button>
    </div>
    <div class="pending-list">${rows}</div>
    <div class="pending-actions">
      <button class="btn-ghost btn-sm" onclick="aiRejectPending()">✕ Reject All</button>
      <button class="btn-primary" onclick="aiApplyPending()">✓ Apply Selected</button>
    </div>`;
  _setStatus('idle','Review proposed changes below');
}

function aiToggleAllPending(){
  const cs=document.querySelectorAll('.pending-op-check');
  const all=[...cs].every(c=>c.checked);
  cs.forEach(c=>c.checked=!all);
}

function aiRejectPending(){
  _pendingOps=[]; _renderPendingOps();
  _appendChat('system','✕ Changes rejected');
  _setStatus('ready','Ready');
}

function aiApplyPending(){
  const cs=[...document.querySelectorAll('.pending-op-check')];
  const sel=cs.filter(c=>c.checked).map(c=>_pendingOps[parseInt(c.dataset.idx)]);
  if(!sel.length){aiRejectPending();return;}

  const snaps=[];
  let applied=0;
  const failures=[]; // detailed failure list
  sel.forEach(op=>{
    try{
      const s=_executeOp(op);
      if(s){snaps.push(s); applied++;}
      else {
        // Diagnose the specific failure reason
        let reason='unknown';
        if(op.args.id && !findTask(op.args.id)) reason=`task #${op.args.id} not found`;
        else if(op.name==='DELETE_TASK' && op.args.id){
          const t=findTask(op.args.id);
          if(t && !t.archived) reason='task must be archived before permanent delete';
        }
        else if(op.name==='MOVE_TASK' && op.args.newParentId){
          reason='would create parent-child cycle';
        }
        else if(op.name==='ADD_BLOCKER' && op.args.blockerId===op.args.id){
          reason='task cannot block itself';
        }
        failures.push(`${op.name}: ${reason}`);
      }
    }catch(e){
      console.warn('[AI] op threw',op,e);
      failures.push(`${op.name}: ${(e.message||'error').slice(0,50)}`);
    }
  });

  if(snaps.length){
    _pushUndo(`${applied} change${applied!==1?'s':''}`, snaps);
    saveState();
    if(typeof renderTaskList==='function') renderTaskList();
    if(typeof renderBanner==='function') renderBanner();
    if(typeof renderLists==='function') renderLists();
    _renderUndoBtn();
    // Flash AI-modified rows briefly for visual confirmation
    const changedIds = new Set();
    snaps.forEach(s=>{
      if(s.type==='batch'&&Array.isArray(s.snaps)) s.snaps.forEach(x=>x.id&&changedIds.add(x.id));
      else if(s.id) changedIds.add(s.id);
    });
    setTimeout(()=>{
      changedIds.forEach(id=>{
        const row=document.querySelector('.task-item[data-task-id="'+id+'"]');
        if(row){
          row.classList.add('ai-modified');
          setTimeout(()=>row.classList.remove('ai-modified'),3000);
        }
      });
    },50);
  }

  _pendingOps=[]; _renderPendingOps();

  let m=`✓ Applied ${applied}`;
  if(failures.length){
    m+=` (${failures.length} failed)`;
    _appendChat('system',m+'\n• '+failures.slice(0,5).join('\n• '));
  } else {
    _appendChat('system',m);
  }
  _setStatus('ready',m);
}

// ══════════════════════════════════════════════════════════════════════════════
// VALUES ALIGNMENT
// ══════════════════════════════════════════════════════════════════════════════
async function aiAlign(){
  if(!_aiReady){await aiDownload();return;}
  if(_engineBusy){_setStatus('error','AI is busy — wait for current request to finish');return;}
  _loadCfg();
  if(_cfg.dominant.length<2){_setStatus('error','Pick 2–3 values first');return;}
  _engineBusy=true;
  _setRunWorking(true);
  _setStatus('thinking','⚙ Aligning…');

  const ctx=_buildContext();
  const defs=_cfg.dominant.map((v,i)=>`${i+1}. ${v}: ${SCHWARTZ[v]?.def||v}`).join('\n');
  const systemPrompt=`Values-based task alignment using Schwartz Theory.
User's dominant values:
${defs}

Categories: ${LIFE_CATS.join(', ')}.

Return ONLY valid JSON:
{"alignments":[{"id":N,"category":"...","valuesAlignment":["..."],"priority":"urgent|high|normal|low","note":"<12 words"}],"summary":"one sentence"}`;

  try{
    // Cap at 100 tasks to prevent context overflow on large task lists
    const taskSubset = ctx.tasks.slice(0, 100);
    const capNote = ctx.tasks.length > 100 ? `\nNOTE: Showing first 100 of ${ctx.tasks.length} active tasks.` : '';
    const reply=await _engine.chat.completions.create({
      messages:[
        {role:'system',content:systemPrompt},
        {role:'user',content:JSON.stringify(taskSubset)+capNote},
      ],
      temperature:0.1,max_tokens:2048,
    });
    _applyAlignment(reply.choices[0].message.content.trim());
  }catch(err){_setStatus('error','✕ '+(err.message||err).slice(0,80));}
  finally{_engineBusy=false;_setRunWorking(false);}
}

function _applyAlignment(raw){
  const clean=raw.replace(/^```[a-z]*\n?/i,'').replace(/```$/,'').trim();
  let r;try{r=JSON.parse(clean);}catch(e){
    // Balanced-brace extraction — handles surrounding text safely
    const extracted = _extractJSONBlock(clean);
    if(extracted) try{r=JSON.parse(extracted);}catch(e2){}
  }
  if(!r||!Array.isArray(r.alignments)){_setStatus('error','✕ Parse failed');return;}
  const snaps=[];
  r.alignments.forEach(a=>{
    const t=findTask(a.id);if(!t) return;
    snaps.push({type:'updated',id:t.id,before:{...t}});
    if(a.category&&LIFE_CATS.includes(a.category)) t.category=a.category;
    if(Array.isArray(a.valuesAlignment)) t.valuesAlignment=a.valuesAlignment.filter(v=>VALUE_KEYS.includes(v));
    if(['urgent','high','normal','low'].includes(a.priority)) t.priority=a.priority;
    if(a.note){
      t.valuesNote=a.note;
      if(!t.notes) t.notes=[];
      t.notes.unshift({id:Date.now()+Math.random(),text:'[Values AI] '+a.note,createdAt:timeNow()});
    }
  });
  if(snaps.length){_pushUndo(`Values alignment (${snaps.length})`,snaps); _renderUndoBtn();}
  saveState();
  if(typeof renderTaskList==='function') renderTaskList();
  _setStatus('ready','✓ '+(r.summary||snaps.length+' aligned'));
  _renderBreakdown();
  // Flash aligned rows
  setTimeout(()=>{
    snaps.forEach(s=>{
      const row=document.querySelector('.task-item[data-task-id="'+s.id+'"]');
      if(row){row.classList.add('ai-modified'); setTimeout(()=>row.classList.remove('ai-modified'),3000);}
    });
  },50);
}

// ══════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function _appendChat(role,text){
  const f=document.getElementById('aiChatFeed');if(!f) return;
  // Only auto-scroll if user is already near the bottom (within 40px)
  const wasAtBottom = f.scrollHeight - f.scrollTop - f.clientHeight < 40;
  const d=document.createElement('div');
  d.className='ai-msg ai-msg--'+role;
  d.textContent=text;
  f.appendChild(d);
  if(wasAtBottom) f.scrollTop=f.scrollHeight;
}
function aiClearChat(){
  _chatHistory=[];
  _persistChatHistory();
  const f=document.getElementById('aiChatFeed');if(f) f.innerHTML='';
  _pendingOps=[]; _renderPendingOps();
}
function _setStatus(state,msg){
  const el=document.getElementById('aiStatus');if(!el) return;
  el.textContent=msg;
  el.className='claude-status claude-status--'+(
    state==='ready'?'ok':state==='error'?'error':
    state==='thinking'?'syncing':state==='loading'?'syncing':'idle');
}
function _setRunWorking(w){
  const btn=document.getElementById('aiRunBtn');if(!btn) return;
  btn.disabled=w;
  if(w){
    btn.dataset.label=btn.textContent;
    btn.innerHTML='Thinking<span class="ai-thinking-dots"><span></span><span></span><span></span></span>';
  }
  else if(btn.dataset.label){btn.textContent=btn.dataset.label; btn.dataset.label='';}
}
function aiToggleValue(key){
  _loadCfg();
  const i=_cfg.dominant.indexOf(key);
  if(i>=0) _cfg.dominant.splice(i,1);
  else{if(_cfg.dominant.length>=3){_setStatus('error','Max 3');return;} _cfg.dominant.push(key);}
  _saveCfg(); _renderValuesGrid();
}
function aiSetMode(mode){
  _loadCfg();_cfg.mode=mode;_saveCfg();
  document.querySelectorAll('.ai-mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  const c=document.getElementById('aiChatSection'), v=document.getElementById('aiValuesSection');
  if(c) c.style.display=mode==='chat'?'':'none';
  if(v) v.style.display=mode==='values'?'':'none';
}

function _renderBreakdown(){
  const el=document.getElementById('aiBreakdown');if(!el) return;
  const a=tasks.filter(t=>t.status!=='done'&&!t.archived&&t.category);
  const by={};
  a.forEach(t=>{
    if(!by[t.category]) by[t.category]={count:0,urgent:0,high:0};
    by[t.category].count++;
    if(t.priority==='urgent') by[t.category].urgent++;
    if(t.priority==='high') by[t.category].high++;
  });
  const rows=Object.entries(by).sort((x,y)=>y[1].count-x[1].count).map(([c,s])=>`
    <div class="breakdown-row">
      <span class="breakdown-cat">${CAT_ICON[c]||'📌'} ${c}</span>
      <span class="breakdown-count">${s.count}</span>
      ${s.urgent?`<span class="breakdown-badge urgent">${s.urgent}!</span>`:''}
      ${s.high?`<span class="breakdown-badge high">${s.high}↑</span>`:''}
    </div>`).join('');
  el.innerHTML=rows||'<span style="color:var(--text-3);font-size:12px">Run alignment to see</span>';
}

function _renderValuesGrid(){
  const el=document.getElementById('aiValuesGrid');if(!el) return;
  _loadCfg();
  el.innerHTML=VALUE_KEYS.map(key=>{
    const v=SCHWARTZ[key], sel=_cfg.dominant.includes(key), rank=sel?_cfg.dominant.indexOf(key)+1:null;
    return `<div class="schwartz-card ${sel?'selected':''}" onclick="aiToggleValue('${key}')">
      <div class="schwartz-card-top">
        <span class="schwartz-icon">${v.icon}</span>
        <span class="schwartz-name">${key}</span>
        ${sel?`<span class="schwartz-rank">#${rank}</span>`:''}
      </div>
      <div class="schwartz-short">${v.def.slice(0,55)}</div>
    </div>`;
  }).join('');
}

function renderAIPanel(){
  const panel=document.getElementById('claudePanel');if(!panel) return;
  _loadCfg();
  const cached=!!localStorage.getItem(MODEL_FLAG);
  const mode=_cfg.mode||'chat';
  const hasWebGPU = !!navigator.gpu;

  // Early exit for incompatible browsers — show clear message instead of a broken download button
  if(!hasWebGPU){
    panel.innerHTML = `
      <div class="claude-desc" style="padding:12px;background:rgba(230,126,34,.08);border:1px solid rgba(230,126,34,.3);border-radius:8px">
        <strong style="color:#e67e22">⚠ AI features unavailable on this browser</strong><br>
        <span style="font-size:12px;color:var(--text-3);line-height:1.5">
          Gemma runs entirely in your browser using WebGPU. Your current browser doesn't support this API.
          <br><br>
          <strong>To enable AI features:</strong><br>
          • Desktop: use Chrome 113+, Edge 113+, or Safari 18+<br>
          • iPhone/iPad: WebGPU is not yet enabled in iOS Safari<br>
          • Android: Chrome on Android 12+ with WebGPU flag enabled
          <br><br>
          <em>All other STUPInD features (tasks, Pomodoro, sync) work normally on every browser.</em>
        </span>
      </div>`;
    return;
  }

  // Deep WebGPU check — navigator.gpu exists but can we actually get an adapter?
  // Runs once then caches result. Some older GPUs/drivers fail adapter request.
  if(!window._webgpuAdapterChecked){
    window._webgpuAdapterChecked = true;
    navigator.gpu.requestAdapter().then(adapter => {
      if(!adapter){
        window._webgpuNoAdapter = true;
        renderAIPanel(); // re-render with warning
      }
    }).catch(() => {
      window._webgpuNoAdapter = true;
      renderAIPanel();
    });
  }
  if(window._webgpuNoAdapter){
    panel.innerHTML = `
      <div class="claude-desc" style="padding:12px;background:rgba(230,126,34,.08);border:1px solid rgba(230,126,34,.3);border-radius:8px">
        <strong style="color:#e67e22">⚠ WebGPU available but no compatible GPU found</strong><br>
        <span style="font-size:12px;color:var(--text-3);line-height:1.5">
          Your browser supports WebGPU but couldn't find a compatible GPU adapter.
          This usually means an older integrated GPU or an incompatible driver.
          <br><br>
          AI features won't work on this device. All other STUPInD features work normally.
        </span>
      </div>`;
    return;
  }

  panel.innerHTML=`
    <div class="claude-desc">
      <strong>Gemma 2B</strong> runs on this device via WebGPU — no data leaves your browser.
      ${cached
        ?'<span style="color:#2ecc71">✓ Model cached — works offline</span>'
        :'~1.5 GB download, cached forever. Chrome 113+ desktop required.'}
    </div>

    ${!cached?`
    <div class="ai-download-block">
      <button class="btn-primary" onclick="aiDownload()" id="aiDownloadBtn">⬇ Download Gemma (~1.5 GB)</button>
      <div class="ai-progress-wrap" id="aiProgressWrap" style="display:none">
        <div class="ai-progress-track"><div class="ai-progress-bar" id="aiProgressBar" style="width:0%"></div></div>
        <div class="ai-progress-info"><span id="aiProgressPct">0%</span><span id="aiProgressMB"></span></div>
      </div>
    </div>`:`
    <div style="margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${!_aiReady?`<button class="btn-ghost btn-sm" onclick="aiInit()" id="aiLoadBtn">▶ Load into Memory</button>`:`<span style="font-size:11px;color:#2ecc71;font-weight:600">✓ Gemma loaded</span>`}
      <button class="btn-ghost btn-sm" id="aiUndoBtn" onclick="aiUndo()" style="display:${_undoStack.length?'':'none'}">↩ Undo (${_undoStack.length})</button>
    </div>`}

    <div id="aiStatus" class="claude-status claude-status--idle">
      ${_aiReady?'✓ Gemma ready':cached?'Model cached — click Load':'Download model to start'}
    </div>

    <div class="ai-mode-tabs" style="margin:10px 0 8px">
      <button class="ai-mode-btn ${mode==='chat'?'active':''}" data-mode="chat" onclick="aiSetMode('chat')">💬 Ask AI</button>
      <button class="ai-mode-btn ${mode==='values'?'active':''}" data-mode="values" onclick="aiSetMode('values')">◈ Values</button>
    </div>

    <div id="aiChatSection" style="display:${mode==='chat'?'':'none'}">
      <div class="ai-chat-feed" id="aiChatFeed">
        <div class="ai-msg ai-msg--system">Ask anything about your tasks. I can create, update, complete, delete, link, tag, note, check off, archive, and more. Examples:<br>
          • "Create a task to call dentist tomorrow urgent"<br>
          • "Mark all design tasks high priority"<br>
          • "What's blocking me?"<br>
          • "Add checklist to task 42: buy milk, bread, eggs"<br>
          • "Archive everything I finished last week"<br>
          • "Which tasks have I been procrastinating on?"<br><br>
          <em>All changes shown as preview — you approve before anything applies.</em>
        </div>
      </div>

      <div id="aiPendingOps" class="pending-ops-wrap" style="display:none"></div>

      <div class="ai-chat-input-row">
        <textarea id="aiChatInput" class="ai-chat-input" rows="2"
          placeholder="Ask or tell AI what to do…"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();aiChat()}"></textarea>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button class="btn-primary btn-sm" id="aiRunBtn" onclick="aiChat()" ${!_aiReady?'disabled':''}>↩ Send</button>
          <button class="btn-ghost btn-sm" onclick="aiClearChat()">Clear</button>
        </div>
      </div>
    </div>

    <div id="aiValuesSection" style="display:${mode==='values'?'':'none'}">
      <div class="mfield-lbl" style="margin-bottom:6px">Dominant Values <span style="color:var(--text-3);font-weight:400;font-size:11px">— pick 2–3</span></div>
      <div class="schwartz-grid" id="aiValuesGrid"></div>
      <button class="btn-primary" style="margin-top:10px;width:100%" onclick="aiAlign()" ${!_aiReady||_cfg.dominant.length<2?'disabled':''}>⚡ Align All Tasks</button>
      <div class="ai-breakdown-section" style="margin-top:12px">
        <div class="mfield-lbl" style="margin-bottom:6px">Category Breakdown</div>
        <div id="aiBreakdown"></div>
      </div>
    </div>

    <div class="claude-hint" style="margin-top:10px">
      Every AI-proposed change is previewed. Undo works across all AI-applied batches (last 10).
    </div>`;

  _renderValuesGrid();
  _renderBreakdown();
  _renderUndoBtn();
  if(_aiLoading){const w=document.getElementById('aiProgressWrap');if(w) w.style.display='';}

  // Restore persisted chat history into feed (don't overwrite welcome message
  // unless there's actual history to restore)
  const feed = document.getElementById('aiChatFeed');
  if(feed && _chatHistory.length){
    // Defensive: filter out malformed entries before rendering
    const valid = _chatHistory.filter(m =>
      m && typeof m === 'object' &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' && m.content.length > 0
    );
    if(!valid.length) return;
    feed.innerHTML = '';
    // Show "continuation" indicator
    const note = document.createElement('div');
    note.className = 'ai-msg ai-msg--system';
    note.style.fontSize = '10px';
    note.textContent = '↻ Continuing previous conversation ('+Math.floor(valid.length/2)+' turn'+(valid.length>2?'s':'')+')';
    feed.appendChild(note);
    valid.slice(-12).forEach(m => {
      const d = document.createElement('div');
      d.className = 'ai-msg ai-msg--'+m.role;
      // Strip TOOLS: block from displayed assistant messages (keep only reasoning)
      const clean = m.role==='assistant'
        ? m.content.split(/\n?\s*tools\s*:/i)[0].trim() || m.content
        : m.content;
      d.textContent = clean;
      feed.appendChild(d);
    });
    feed.scrollTop = feed.scrollHeight;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SMART ADD — ambient AI enhancement on the main task input
// ══════════════════════════════════════════════════════════════════════════════
window._smartAddPreview = null; // current suggestion, applied on Enter or Add

// Show ✨ button when input has 3+ chars AND engine is ready
function maybeShowEnhanceBtn(){
  const btn = document.getElementById('taskEnhanceBtn');
  const inp = document.getElementById('taskInput');
  if(!btn||!inp) return;
  const len = inp.value.trim().length;
  const showable = _aiReady && len >= 3;
  btn.style.display = showable ? '' : 'none';
  // Clear stale preview whenever input becomes too short or user keeps typing
  if((len < 3 || window._smartAddPreview) && !btn.disabled){
    window._smartAddPreview = null;
    const prev=document.getElementById('smartAddPreview');
    if(prev){prev.innerHTML=''; prev.style.display='none';}
  }
}

// Reset smart-add state when user switches tabs
document.addEventListener('visibilitychange', () => {
  if(document.hidden && window._smartAddPreview){
    window._smartAddPreview = null;
    const prev=document.getElementById('smartAddPreview');
    if(prev){prev.innerHTML=''; prev.style.display='none';}
  }
});

async function smartAddEnhance(){
  if(!_aiReady){_setStatus('error','Load Gemma first (Settings → AI Triage)');return;}
  if(_engineBusy){_setStatus('error','AI is busy — wait a moment and retry');return;}
  const inp=document.getElementById('taskInput');
  const btn=document.getElementById('taskEnhanceBtn');
  const prev=document.getElementById('smartAddPreview');
  const raw=(inp?.value||'').trim();
  if(!raw||raw.length<3) return;

  _engineBusy=true;
  if(btn){btn.disabled=true; btn.textContent='⚙';}

  // Build compact history from last 20 active/recent tasks to mirror user patterns
  const history = tasks
    .filter(t=>!t.archived)
    .slice(-20)
    .map(t=>({
      name:t.name.slice(0,60),
      priority:t.priority, category:t.category,
      effort:t.effort, context:t.context,
      tags:(t.tags||[]).slice(0,3),
      energy:t.energyLevel,
    }));

  const systemPrompt = `You are a smart task enhancer. Given a new task name and the user's recent tasks as examples, predict reasonable values for metadata fields. Mirror the user's patterns.

Return ONLY valid JSON. No markdown. No explanation.
{"priority":"urgent|high|normal|low|none","category":"health|finance|work|relationships|learning|home|personal|other|null","effort":"xs|s|m|l|xl|null","context":"work|home|phone|computer|errands|null","energyLevel":"high|low|null","tags":["tag"],"dueDate":"YYYY-MM-DD or null"}

Rules:
- Omit fields you're genuinely unsure about (use null) — don't guess
- tags should be short, lowercase, snake_case
- dueDate only if the task name strongly implies timing (e.g. "prep tomorrow's meeting")
- Match the user's history patterns`;

  try{
    const reply=await _engine.chat.completions.create({
      messages:[
        {role:'system',content:systemPrompt},
        {role:'user',content:`User's recent tasks:\n${JSON.stringify(history)}\n\nNew task: "${raw}"\n\nReturn JSON only.`},
      ],
      temperature:0.1, max_tokens:300,
    });
    const rawReply=reply.choices[0].message.content.trim();
    const clean=rawReply.replace(/^```[a-z]*\n?/i,'').replace(/```$/,'').trim();
    let sugg;
    try{sugg=JSON.parse(clean);}
    catch(e){
      const extracted=_extractJSONBlock(clean);
      if(extracted) try{sugg=JSON.parse(extracted);}catch(e2){}
    }
    if(!sugg){_setStatus('error','✕ Enhance failed — try again');return;}

    // Validate + clean up
    const PR=['urgent','high','normal','low','none'];
    const CAT=LIFE_CATS;
    const EFF=['xs','s','m','l','xl'];
    const CTX=['work','home','phone','computer','errands'];
    const EN=['high','low'];

    const cleaned={};
    if(PR.includes(sugg.priority)&&sugg.priority!=='none') cleaned.priority=sugg.priority;
    if(CAT.includes(sugg.category)) cleaned.category=sugg.category;
    if(EFF.includes(sugg.effort)) cleaned.effort=sugg.effort;
    if(CTX.includes(sugg.context)) cleaned.context=sugg.context;
    if(EN.includes(sugg.energyLevel)) cleaned.energyLevel=sugg.energyLevel;
    if(Array.isArray(sugg.tags)) cleaned.tags=sugg.tags.filter(t=>typeof t==='string'&&t.length&&t.length<25).slice(0,5);
    if(typeof sugg.dueDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(sugg.dueDate)) cleaned.dueDate=sugg.dueDate;

    if(Object.keys(cleaned).length===0){
      if(prev){prev.innerHTML='<span class="smart-add-empty">No confident suggestions — add it manually</span>'; prev.style.display='';}
    } else {
      window._smartAddPreview=cleaned;
      _renderSmartAddChips(cleaned);
    }
  }catch(err){
    console.warn('[smart-add]',err);
    _setStatus('error','✕ Enhance failed');
  }finally{
    _engineBusy=false;
    if(btn){btn.disabled=false; btn.textContent='✨';}
  }
}

function _renderSmartAddChips(s){
  const prev=document.getElementById('smartAddPreview'); if(!prev) return;
  const effortTips = {xs:'Extra small — ~15 min',s:'Small — ~1 hr',m:'Medium — ~half day',l:'Large — ~full day',xl:'Extra large — multi-day'};
  const ctxTips = {work:'At your desk/workplace',home:'At home',phone:'Requires a phone call',computer:'Requires a computer',errands:'Out and about'};
  const chips=[];
  if(s.priority) chips.push(`<span class="sa-chip sa-priority sa-p-${s.priority}" data-tip="Priority level — tap to remove" onclick="smartAddRemove('priority')">priority: ${s.priority} ×</span>`);
  if(s.category) chips.push(`<span class="sa-chip" data-tip="Life area category — tap to remove" onclick="smartAddRemove('category')">${CAT_ICON[s.category]||'📌'} ${s.category} ×</span>`);
  if(s.effort)   chips.push(`<span class="sa-chip" data-tip="${effortTips[s.effort]||'Effort'} — tap to remove" onclick="smartAddRemove('effort')">effort: ${s.effort.toUpperCase()} ×</span>`);
  if(s.context)  chips.push(`<span class="sa-chip" data-tip="${ctxTips[s.context]||'Context'} — tap to remove" onclick="smartAddRemove('context')">${s.context} ×</span>`);
  if(s.energyLevel) chips.push(`<span class="sa-chip" data-tip="Energy needed — tap to remove" onclick="smartAddRemove('energyLevel')">${s.energyLevel==='high'?'⚡':'🌿'} ${s.energyLevel} ×</span>`);
  if(s.dueDate)  chips.push(`<span class="sa-chip" data-tip="Due date — tap to remove" onclick="smartAddRemove('dueDate')">📅 ${s.dueDate} ×</span>`);
  if(s.tags&&s.tags.length) s.tags.forEach(tag=>chips.push(`<span class="sa-chip" data-tip="Tag — tap to remove" onclick="smartAddRemoveTag('${esc(tag)}')">#${esc(tag)} ×</span>`));
  prev.innerHTML=`
    <span class="smart-add-hint">✨ AI suggestions — tap to remove, Enter to add:</span>
    <div class="sa-chips">${chips.join('')}</div>`;
  prev.style.display='';
}

function smartAddRemove(field){
  if(!window._smartAddPreview) return;
  delete window._smartAddPreview[field];
  if(Object.keys(window._smartAddPreview).length===0||
     (Object.keys(window._smartAddPreview).length===1&&window._smartAddPreview.tags&&!window._smartAddPreview.tags.length)){
    window._smartAddPreview=null;
    const prev=document.getElementById('smartAddPreview');
    if(prev){prev.innerHTML=''; prev.style.display='none';}
  } else {
    _renderSmartAddChips(window._smartAddPreview);
  }
}

function smartAddRemoveTag(tag){
  if(!window._smartAddPreview?.tags) return;
  window._smartAddPreview.tags=window._smartAddPreview.tags.filter(t=>t!==tag);
  // If tags is now empty, delete it so dismissal logic kicks in
  if(!window._smartAddPreview.tags.length) delete window._smartAddPreview.tags;
  // If nothing left, fully dismiss
  if(Object.keys(window._smartAddPreview).length===0){
    window._smartAddPreview=null;
    const prev=document.getElementById('smartAddPreview');
    if(prev){prev.innerHTML=''; prev.style.display='none';}
  } else {
    _renderSmartAddChips(window._smartAddPreview);
  }
}

// Called on Enter when a preview is active — creates task with suggestions merged
function applySmartAddAndSubmit(){
  const inp=gid('taskInput');
  const raw=(inp?.value||'').trim();
  if(!raw){window._smartAddPreview=null; return;}
  const sugg=window._smartAddPreview||{};

  ensureDefaultList();
  const parsed=parseQuickAdd(raw);
  if(!parsed.name) return;

  // Merge: quick-add syntax wins over AI suggestions (explicit > inferred)
  const merged=Object.assign({},defaultTaskProps(),sugg,parsed.props);

  tasks.push(Object.assign({
    id:++taskIdCtr, name:parsed.name,
    totalSec:0, sessions:0, created:timeNowFull(),
    parentId:null, collapsed:false,
  }, merged));

  inp.value='';
  window._smartAddPreview=null;
  const prev=document.getElementById('smartAddPreview');
  if(prev){prev.innerHTML=''; prev.style.display='none';}
  const btn=document.getElementById('taskEnhanceBtn');
  if(btn) btn.style.display='none';

  renderTaskList();
  if(typeof renderBanner==='function') renderBanner();
  if(typeof renderLists==='function') renderLists();
  saveState();
}
