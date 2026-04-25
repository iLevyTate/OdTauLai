// ========== ASK — natural-language intent → op batch (preview + apply) ==========
// Retrieval-augmented: embed the query, pick top-k semantically similar tasks
// as context, run the local LLM, tolerant-parse the JSON, validate against
// TOOL_SCHEMA, and hand the valid ops to acceptProposedOps() so the existing
// pending-ops preview + undo pipeline handles everything else.

const ASK_CONTEXT_MAX_TASKS = 10;
const ASK_RECENT_MAX_TASKS = 20;
const ASK_CONTEXT_MAX_CHARS = 1800;
const ASK_TASK_LINE_MAX = 200;

// (M3) Strip C0 control characters + DEL from user-supplied text before it
// enters the LLM prompt.  Prevents theoretical prompt injection via embedded
// control sequences in task names, categories, or the query itself.
const _askStripCtrl = s => String(s || '').replace(/[\u0000-\u001F\u007F]/g, '');

// Uses todayISO() from tasks.js / todayKey() from utils.js — no local re-implementation
function _askToday(){
  return (typeof todayISO === 'function') ? todayISO() : (typeof todayKey === 'function' ? todayKey() : new Date().toISOString().slice(0, 10));
}

function _askListName(id){
  if(typeof lists === 'undefined' || id == null) return null;
  const l = lists.find(x => x.id === id);
  return l ? l.name : null;
}

function _askSerializeTask(t){
  const line = {
    id: t.id,
    name: _askStripCtrl(t.name).slice(0, 80),
    status: t.status || 'open',
    priority: t.priority || 'none',
  };
  if(t.dueDate) line.due = t.dueDate;
  if(t.listId != null){ const n = _askListName(t.listId); if(n) line.list = n; }
  if(Array.isArray(t.tags) && t.tags.length) line.tags = t.tags.slice(0, 6).map(x => _askStripCtrl(x));
  if(t.effort) line.effort = t.effort;
  if(t.category) line.category = _askStripCtrl(t.category);
  if(t.starred) line.starred = true;
  if(t.archived) line.archived = true;
  let s = JSON.stringify(line);
  if(s.length > ASK_TASK_LINE_MAX) s = s.slice(0, ASK_TASK_LINE_MAX - 1) + '…';
  return s;
}

/**
 * Pick context tasks: top-k semantic matches + recently-modified open tasks, deduped.
 * Will lazily kick off embedding model load if the user enabled Ask but never
 * opened Tools — but won't block the Ask turn on that (retrieval is best-effort).
 */
async function _askBuildContext(query){
  const out = [];
  const seen = new Set();

  // Kick off embedding load in the background if it's missing. We briefly
  // await it (short timeout) so first-ever Ask turns get semantic retrieval
  // if the model loads quickly enough.
  if(typeof isIntelReady === 'function' && !isIntelReady() && typeof intelLoad === 'function'){
    try{
      await Promise.race([
        intelLoad(),
        new Promise(res => setTimeout(res, 2000)),
      ]);
    }catch(e){ /* best-effort */ }
  }

  if(typeof semanticSearch === 'function' && typeof isIntelReady === 'function' && isIntelReady()){
    try{
      const ranked = await semanticSearch(query, ASK_CONTEXT_MAX_TASKS);
      for(const r of ranked){
        if(!r || !r.t) continue;
        if(seen.has(r.t.id)) continue;
        seen.add(r.t.id);
        out.push(r.t);
      }
    }catch(e){ /* retrieval is best-effort */ }
  }

  if(typeof tasks !== 'undefined' && Array.isArray(tasks)){
    const recents = tasks
      .filter(t => !t.archived && t.status !== 'done')
      .slice()
      .sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0))
      .slice(0, ASK_RECENT_MAX_TASKS);
    for(const t of recents){
      if(seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
      if(out.length >= ASK_CONTEXT_MAX_TASKS + ASK_RECENT_MAX_TASKS) break;
    }
  }

  const lines = [];
  let used = 0;
  for(const t of out){
    const line = _askSerializeTask(t);
    if(used + line.length + 1 > ASK_CONTEXT_MAX_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines;
}

function _askListsBlock(){
  if(typeof lists === 'undefined' || !Array.isArray(lists) || !lists.length) return '';
  return lists.slice(0, 20)
    .map(l => '{"id":' + l.id + ',"name":' + JSON.stringify(_askStripCtrl(l.name).slice(0, 40)) + '}')
    .join('\n');
}

function _askSystemPrompt(){
  const schema = (typeof toolSchemaPromptBlock === 'function') ? toolSchemaPromptBlock() : '';
  return [
    'You convert a user request into a JSON array of task operations for a local task manager.',
    'Return ONLY a JSON array. No prose, no code fences, no explanation.',
    'If the request is ambiguous, unsafe, or you cannot match it to the ops below, return [].',
    '',
    'Allowed ops (name(required,optional?)):',
    schema,
    '',
    'Rules:',
    '- Each element is {"name":"OP_NAME","args":{...}}.',
    '- "id" values must come from the Context below. Do not invent ids.',
    '- priority ∈ {urgent,high,normal,low,none}. status ∈ {open,progress,review,blocked,done}.',
    '- effort ∈ {xs,s,m,l,xl}. energyLevel ∈ {high,low}. recur ∈ {daily,weekdays,weekly,monthly}.',
    '- Dates use YYYY-MM-DD. Reminders use YYYY-MM-DDTHH:MM.',
    '- Prefer UPDATE_TASK for edits. Use CREATE_TASK only when the user asks to create.',
    '- Never output DELETE_TASK unless the user explicitly says "delete forever".',
    '- Keep the array short — only the ops that clearly satisfy the request.',
    '- Read-only ops (QUERY_TASKS, GET_TASK_DETAIL, GET_CALENDAR_EVENTS, LIST_CATEGORIES, LIST_LISTS) are for gathering facts; you will receive tool results and can then output write ops. Do not try to open UI modals.',
    '',
    'Examples:',
    'User: make task 12 urgent\n→ [{"name":"UPDATE_TASK","args":{"id":12,"priority":"urgent"}}]',
    'User: create a task "buy milk" due tomorrow tagged shopping\n→ [{"name":"CREATE_TASK","args":{"name":"buy milk","dueDate":"<tomorrow>","tags":["shopping"]}}]',
    'User: mark all my #errands as done\n→ [{"name":"MARK_DONE","args":{"id":<id>}}, ...]',
    'User: archive everything already completed last week\n→ [{"name":"ARCHIVE_TASK","args":{"id":<id>}}, ...]',
    'User: what should I do next?\n→ []',
    'User: nevermind\n→ []',
  ].join('\n');
}

function _askCalendarBlock(){
  if(typeof getUpcomingEvents !== 'function') return '';
  const evs = getUpcomingEvents(7, 20, { strictFuture: false });
  if(!evs || !evs.length) return '';
  const lines = evs.map(e => {
    const tim = (e.time || (e.allDay ? 'all day' : '')) || '';
    const loc = e.location ? ' @' + String(e.location).replace(/\n/g, ' ').slice(0, 40) : '';
    return (e.dateISO || '') + ' ' + String(tim).padEnd(8, ' ') + ' ' + (e.title || '(event)') + loc;
  });
  return ('Calendar (next 7 days):\n' + lines.join('\n')).slice(0, 600);
}

function _askUserPrompt(query, contextLines){
  const parts = [];
  parts.push('Today: ' + _askToday());
  const listBlock = _askListsBlock();
  if(listBlock) parts.push('Lists:\n' + listBlock);
  const calB = (typeof _askCalendarBlock === 'function') ? _askCalendarBlock() : '';
  if(calB) parts.push(calB);
  if(contextLines.length) parts.push('Context (relevant tasks):\n' + contextLines.join('\n'));
  parts.push('Request: ' + _askStripCtrl(query).slice(0, 600));
  parts.push('JSON array:');
  return parts.join('\n\n');
}

function _askCtx(){
  const tasksById = new Map();
  const listsById = new Map();
  if(typeof tasks !== 'undefined' && Array.isArray(tasks)) tasks.forEach(t => tasksById.set(t.id, t));
  if(typeof lists !== 'undefined' && Array.isArray(lists)) lists.forEach(l => listsById.set(l.id, l));
  return { tasksById, listsById };
}

// ---- Cognitask: multi-turn read then write (same module so tests can load ask.js alone) ----
const COGNITASK_MAX_READ_ROUNDS = 3;
const COGNITASK_MAX_TURNS = COGNITASK_MAX_READ_ROUNDS + 1;

function _readArgCtx(){
  if(typeof _askCtx === 'function') return _askCtx();
  return { tasksById: new Map(), listsById: new Map() };
}

function _coerceReadKey(key, raw){
  if(typeof window !== 'undefined' && typeof window.coerceToolArg === 'function'){
    return window.coerceToolArg(key, raw, _readArgCtx());
  }
  if(key === 'id'){
    if(raw == null) return null;
    const n = (typeof raw === 'number' && Number.isFinite(raw)) ? Math.trunc(raw) : parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : null;
  }
  if(key === 'limit') return Math.min(100, Math.max(1, _coerceCognitaskInt(raw, 20)));
  if(key === 'fromDate' || key === 'toDate' || key === 'untilDate') return raw == null ? null : String(raw).slice(0, 10);
  if(key === 'filter') return raw == null ? null : String(raw).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 200) || null;
  return raw;
}

/**
 * @param {Array<object>} evs - from getUpcomingEvents (have _startMs)
 * @param {string|null} fromDate ISO y-m-d
 * @param {string|null} toDate
 */
function _filterCalEventsByDateRange(evs, fromDate, toDate){
  if(!Array.isArray(evs) || !evs.length) return evs || [];
  const fromT = fromDate ? new Date(String(fromDate).slice(0, 10) + 'T00:00:00').getTime() : null;
  const toT = toDate ? new Date(String(toDate).slice(0, 10) + 'T23:59:59.999').getTime() : null;
  if(fromT == null && toT == null) return evs;
  return evs.filter(ev => {
    const ms = ev && ev._startMs;
    if(typeof ms !== 'number' || !Number.isFinite(ms)) return false;
    if(fromT != null && !Number.isFinite(fromT)) return false;
    if(toT != null && !Number.isFinite(toT)) return false;
    if(fromT != null && ms < fromT) return false;
    if(toT != null && ms > toT) return false;
    return true;
  });
}

/** Days of lookahead for getUpcomingEvents so filtering by toDate is not pre-truncated (cap 365). */
function _calendarFetchWindowDays(fromDate, toDate){
  if(!toDate) return 30;
  const anchor = fromDate
    ? new Date(String(fromDate).slice(0, 10) + 'T00:00:00')
    : new Date();
  anchor.setHours(0, 0, 0, 0);
  const end = new Date(String(toDate).slice(0, 10) + 'T23:59:59.999');
  if(!Number.isFinite(anchor.getTime()) || !Number.isFinite(end.getTime())) return 30;
  const diffMs = end - anchor;
  const days = Math.ceil(diffMs / 86400000);
  if(!Number.isFinite(days)) return 30;
  return Math.min(365, Math.max(1, days));
}

/**
 * @param {{ name: string, args: object }} op
 * @returns {object} JSON-serializable result
 */
function runReadOp(op){
  const rawA = (op && op.args) || {};
  const n = (op && op.name) || '';
  const a = { ...rawA };
  try{
    if(n === 'QUERY_TASKS'){
      const limR = a.limit != null && a.limit !== undefined ? _coerceReadKey('limit', a.limit) : 20;
      const lim = Math.min(100, Math.max(1, typeof limR === 'number' && Number.isFinite(limR) ? limR : 20));
      const f = (a.filter != null && a.filter !== '')
        ? String(_coerceReadKey('filter', a.filter) || '').toLowerCase()
        : '';
      const pool = (typeof tasks !== 'undefined' && Array.isArray(tasks))
        ? tasks.filter(t => t && !t.archived && t.status !== 'done') : [];
      const picked = f
        ? pool.filter(t => {
            const desc = String(t.description || '').slice(0, 5000);
            return (String(t.name || '') + ' ' + desc).toLowerCase().includes(f);
          })
        : pool;
      return { tasks: picked.slice(0, lim).map(t => ({ id: t.id, name: t.name, dueDate: t.dueDate, status: t.status, priority: t.priority })) };
    }
    if(n === 'GET_TASK_DETAIL'){
      const id = _coerceReadKey('id', a.id);
      if(id == null || !Number.isFinite(id)) return { error: 'bad_id' };
      const t = (typeof findTask === 'function') ? findTask(id) : null;
      if(!t) return { error: 'not_found' };
      return { task: {
        id: t.id, name: t.name, description: (t.description || '').slice(0, 800),
        dueDate: t.dueDate, startDate: t.startDate, category: t.category, tags: t.tags, status: t.status, priority: t.priority, effort: t.effort, energyLevel: t.energyLevel, remindAt: t.remindAt,
      } };
    }
    if(n === 'GET_CALENDAR_EVENTS'){
      if(typeof getUpcomingEvents !== 'function') return { events: [] };
      const limV = _coerceReadKey('limit', a.limit);
      const lim = Math.min(500, Math.max(1, typeof limV === 'number' && Number.isFinite(limV) ? limV : 30));
      const fromD = _coerceReadKey('fromDate', a.fromDate);
      const toD = _coerceReadKey('toDate', a.toDate);
      const windowDays = _calendarFetchWindowDays(fromD, toD);
      let evs = getUpcomingEvents(windowDays, 500, { strictFuture: false });
      evs = _filterCalEventsByDateRange(evs, fromD, toD);
      return { events: evs.slice(0, lim).map(e => ({ title: e.title, dateISO: e.dateISO, time: e.time, location: (e.location || '').slice(0, 80), feed: e.feedLabel })) };
    }
    if(n === 'LIST_CATEGORIES'){
      const rows = (typeof getActiveCategories === 'function') ? getActiveCategories() : [];
      return { categories: rows.map(c => ({ id: c.id, label: c.label, focus: (c.focus != null) ? c.focus : (c.description || '') })) };
    }
    if(n === 'LIST_LISTS'){
      const L = (typeof lists !== 'undefined' && Array.isArray(lists)) ? lists : [];
      return { lists: L.map(l => ({ id: l.id, name: l.name })) };
    }
  }catch(e){
    return { error: (e && e.message) || 'read_failed' };
  }
  return { error: 'unknown_read' };
}

function _coerceCognitaskInt(v, d){
  const n = (typeof v === 'number' && Number.isFinite(v)) ? v : parseInt(String(v), 10);
  if(!Number.isFinite(n)) return d;
  return Math.trunc(n);
}

function _schemaReadOnly(name){
  const s = (typeof TOOL_SCHEMA !== 'undefined' && TOOL_SCHEMA) ? TOOL_SCHEMA[name] : null;
  return !!(s && s.readOnly);
}

/**
 * @param {string} query
 * @param {{ onToken?:(t:string)=>void, onReadRound?:(summary:object)=>void, signal?:AbortSignal }} [opts]
 * @returns {Promise<{ ok:boolean, ops:Array, rejected:Array, destructiveLevel:string, rawText:string, truncated:boolean, readRounds?:number, reason?:string }>}
 */
async function cognitaskRun(query, opts){
  opts = opts || {};
  const q = String(query || '').trim();
  if(!q) return { ok: false, ops: [], rejected: [], destructiveLevel: 'none', rawText: '', truncated: false, readRounds: 0, reason: 'EMPTY_QUERY' };
  if(typeof isGenReady !== 'function' || !isGenReady()){
    return { ok: false, ops: [], rejected: [], destructiveLevel: 'none', rawText: '', truncated: false, readRounds: 0, reason: 'GEN_NOT_READY' };
  }
  if(typeof parseOpsJson !== 'function' || typeof validateOps !== 'function' || typeof genGenerate !== 'function'){
    return { ok: false, ops: [], rejected: [], destructiveLevel: 'none', rawText: '', truncated: false, readRounds: 0, reason: 'SCHEMA_UNAVAILABLE' };
  }
  if(typeof _askBuildContext !== 'function' || typeof _askUserPrompt !== 'function' || typeof _askSystemPrompt !== 'function'){
    return { ok: false, ops: [], rejected: [], destructiveLevel: 'none', rawText: '', truncated: false, readRounds: 0, reason: 'ASK_HELPERS_MISSING' };
  }

  const contextLines = await _askBuildContext(q);
  const useNativeQwenTools = typeof isGenModelNativeQwen25Tools === 'function' && isGenModelNativeQwen25Tools()
    && typeof buildOpenAIToolsFromToolSchema === 'function';
  const cognitaskOpenAITools = useNativeQwenTools ? buildOpenAIToolsFromToolSchema() : null;

  const systemJson = _askSystemPrompt() + '\n\nIf you use read-only ops, output ONLY them first; the system will return results, then you output write ops. Do not include prose outside the JSON array.';
  const systemNativeQwen = 'You are a local task assistant. Use only the provided function tools. '
    + 'Call read tools first if you need tasks, calendar, lists, or categories. '
    + 'Use task ids that appear in the user context. Answer with tool call(s) in the required <tool_call> format; do not add other text.';
  const user = _askUserPrompt(q, contextLines);
  const messages = useNativeQwenTools
    ? [ { role: 'system', content: systemNativeQwen }, { role: 'user', content: user } ]
    : [ { role: 'system', content: systemJson }, { role: 'user', content: user } ];

  const cfg = (typeof getGenCfg === 'function') ? getGenCfg() : { timeoutSec: 30 };
  const timeoutMs = Math.max(5000, (cfg.timeoutSec || 30) * 1000);
  const timeoutCtl = new AbortController();
  const timer = setTimeout(() => timeoutCtl.abort(), timeoutMs);
  const mergedSignal = (() => {
    const ctl = new AbortController();
    const bail = () => ctl.abort();
    if(opts.signal){
      if(opts.signal.aborted) bail();
      else opts.signal.addEventListener('abort', bail, { once: true });
    }
    timeoutCtl.signal.addEventListener('abort', bail, { once: true });
    return ctl.signal;
  })();

  let allRaw = '';
  let lastError = null;
  let readRounds = 0;
  let lastFinal = null;
  let gotParse = false;
  let cognitaskTerminalInjected = false;

  const runOnce = async (temp) => {
    let rawText = '';
    const full = await genGenerate({
      messages,
      maxTokens: 512,
      temperature: temp,
      tools: cognitaskOpenAITools || undefined,
      onToken: (t) => {
        rawText += t;
        if(typeof opts.onToken === 'function'){ try{ opts.onToken(t); }catch(e){} }
      },
      signal: mergedSignal,
    });
    if(!rawText) rawText = full || '';
    return rawText;
  };

  try{
    for(let turn = 0; turn < COGNITASK_MAX_TURNS; turn++){
      if(mergedSignal && mergedSignal.aborted) break;
      if(readRounds >= COGNITASK_MAX_READ_ROUNDS && !cognitaskTerminalInjected){
        messages.push({ role: 'user', content: 'This is your last turn — return only a JSON array of write operations or []. Do not call read-only tools.' });
        cognitaskTerminalInjected = true;
      }
      const temp = turn === 0 ? 0.2 : 0.1;
      const raw = await runOnce(temp);
      allRaw += (allRaw ? '\n' : '') + raw;
      let parsed = null;
      if(useNativeQwenTools && typeof parseQwen25ToolCallBlocks === 'function'){
        const tco = parseQwen25ToolCallBlocks(raw);
        if(tco != null) parsed = tco;
      }
      if(parsed == null){
        try{ parsed = parseOpsJson(raw); }catch(e){ lastError = e; }
      }
      if(!parsed || !Array.isArray(parsed)) continue;

      const reads = [];
      const writes = [];
      for(const op of parsed){
        if(!op || !op.name) continue;
        const nm = String(op.name).toUpperCase();
        if(_schemaReadOnly(nm)) reads.push({ name: nm, args: op.args && typeof op.args === 'object' ? op.args : {} });
        else writes.push({ name: nm, args: op.args && typeof op.args === 'object' ? op.args : {} });
      }

      if(reads.length && !writes.length){
        if(readRounds >= COGNITASK_MAX_READ_ROUNDS){
          lastFinal = [];
          gotParse = true;
          break;
        }
        const results = reads.map(r => ({ op: r.name, result: runReadOp(r) }));
        readRounds++;
        if(typeof opts.onReadRound === 'function'){ try{ opts.onReadRound({ results, readRounds }); }catch(e){} }
        messages.push({ role: 'assistant', content: raw });
        const payload = JSON.stringify(results).slice(0, 6000);
        messages.push({ role: 'user', content: 'Tool result:\n' + payload + '\n\nNow return ONLY a JSON array of write operations (or [] if no changes), using task ids from context.' });
        continue;
      }

      if(writes.length){
        lastFinal = writes;
        gotParse = true;
        break;
      }
      lastFinal = parsed;
      gotParse = true;
      break;
    }
  }catch(e){
    lastError = e;
  }finally{
    clearTimeout(timer);
  }

  if(mergedSignal && mergedSignal.aborted){
    return { ok: false, ops: [], rejected: [], destructiveLevel: 'none', rawText: allRaw, truncated: false, readRounds, reason: timeoutCtl.signal.aborted ? 'TIMEOUT' : 'ABORTED' };
  }

  if(!gotParse || lastFinal == null){
    return { ok: false, ops: [], rejected: [], destructiveLevel: 'none', rawText: allRaw, truncated: false, readRounds, reason: 'PARSE_FAILED:' + (lastError && lastError.message ? lastError.message : 'no_ops') };
  }

  const writeOnly = lastFinal.filter(op => op && op.name && !_schemaReadOnly(String(op.name).toUpperCase()));
  if(!writeOnly.length){
    return { ok: true, ops: [], rejected: [], destructiveLevel: 'none', rawText: allRaw, truncated: false, readRounds };
  }

  const ctx = (typeof _askCtx === 'function') ? _askCtx() : { tasksById: new Map(), listsById: new Map() };
  const val = validateOps(writeOnly, ctx);
  if(typeof pushAskHistory === 'function') pushAskHistory(q);
  return {
    ok: true,
    ops: val.valid,
    rejected: val.rejected,
    destructiveLevel: val.destructiveLevel,
    rawText: allRaw,
    truncated: !!val.truncated,
    readRounds,
  };
}

/**
 * @param {string} query
 * @param {{ onToken?:(t:string)=>void, onReadRound?:(o:object)=>void, signal?:AbortSignal }} [opts]
 */
async function askRun(query, opts){
  return cognitaskRun(query, opts);
}

if(typeof window !== 'undefined'){
  window.askRun = askRun;
  window.cognitaskRun = cognitaskRun;
  window.runReadOp = runReadOp;
  window.ASK_CONTEXT_MAX_TASKS = ASK_CONTEXT_MAX_TASKS;
  window._askBuildContext = _askBuildContext;
  window._askUserPrompt = _askUserPrompt;
  window._askSystemPrompt = _askSystemPrompt;
  window._askCtx = _askCtx;
  window._askCalendarBlock = _askCalendarBlock;
}
