// ========== ASK — natural-language intent → op batch (preview + apply) ==========
// Retrieval-augmented: embed the query, pick top-k semantically similar tasks
// as context, run the local LLM, tolerant-parse the JSON, validate against
// TOOL_SCHEMA, and hand the valid ops to acceptProposedOps() so the existing
// pending-ops preview + undo pipeline handles everything else.

const ASK_CONTEXT_MAX_TASKS = 10;
const ASK_RECENT_MAX_TASKS = 20;
const ASK_CONTEXT_MAX_CHARS = 1800;
const ASK_TASK_LINE_MAX = 200;

function _askToday(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function _askListName(id){
  if(typeof lists === 'undefined' || id == null) return null;
  const l = lists.find(x => x.id === id);
  return l ? l.name : null;
}

function _askSerializeTask(t){
  const line = {
    id: t.id,
    name: String(t.name || '').slice(0, 80),
    status: t.status || 'open',
    priority: t.priority || 'none',
  };
  if(t.dueDate) line.due = t.dueDate;
  if(t.listId != null){ const n = _askListName(t.listId); if(n) line.list = n; }
  if(Array.isArray(t.tags) && t.tags.length) line.tags = t.tags.slice(0, 6);
  if(t.effort) line.effort = t.effort;
  if(t.category) line.category = t.category;
  if(t.starred) line.starred = true;
  if(t.archived) line.archived = true;
  let s = JSON.stringify(line);
  if(s.length > ASK_TASK_LINE_MAX) s = s.slice(0, ASK_TASK_LINE_MAX - 1) + '…';
  return s;
}

/**
 * Pick context tasks: top-k semantic matches + recently-modified open tasks, deduped.
 */
async function _askBuildContext(query){
  const out = [];
  const seen = new Set();

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
    .map(l => '{"id":' + l.id + ',"name":' + JSON.stringify(String(l.name || '').slice(0, 40)) + '}')
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

function _askUserPrompt(query, contextLines){
  const parts = [];
  parts.push('Today: ' + _askToday());
  const listBlock = _askListsBlock();
  if(listBlock) parts.push('Lists:\n' + listBlock);
  if(contextLines.length) parts.push('Context (relevant tasks):\n' + contextLines.join('\n'));
  parts.push('Request: ' + String(query || '').slice(0, 600));
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

/**
 * Run one Ask turn.
 * @param {string} query
 * @param {{ onToken?:(t:string)=>void, signal?:AbortSignal }} opts
 * @returns {Promise<{ ok:boolean, ops:Array, rejected:Array, destructiveLevel:string, rawText:string, truncated:boolean, reason?:string }>}
 */
async function askRun(query, opts){
  opts = opts || {};
  const q = String(query || '').trim();
  if(!q) return { ok:false, ops:[], rejected:[], destructiveLevel:'none', rawText:'', truncated:false, reason:'EMPTY_QUERY' };
  if(typeof isGenReady !== 'function' || !isGenReady()){
    return { ok:false, ops:[], rejected:[], destructiveLevel:'none', rawText:'', truncated:false, reason:'GEN_NOT_READY' };
  }

  const contextLines = await _askBuildContext(q);
  const system = _askSystemPrompt();
  const user = _askUserPrompt(q, contextLines);

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

  let rawText = '';
  let parsed = null;
  let lastError = null;

  const runOnce = async (temperature) => {
    rawText = '';
    return genGenerate({
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
      maxTokens: 512,
      temperature,
      onToken: (t) => { rawText += t; if(typeof opts.onToken === 'function'){ try{ opts.onToken(t); }catch(e){} } },
      signal: mergedSignal,
    });
  };

  try{
    const full = await runOnce(0.2);
    if(!rawText) rawText = full || '';
    try{ parsed = parseOpsJson(rawText); }
    catch(e){ lastError = e; }
  }catch(e){
    lastError = e;
  }

  if(!parsed && !(mergedSignal && mergedSignal.aborted)){
    try{
      const full = await runOnce(0);
      if(!rawText) rawText = full || '';
      try{ parsed = parseOpsJson(rawText); }
      catch(e){ lastError = e; }
    }catch(e){
      lastError = e;
    }
  }

  clearTimeout(timer);

  if(mergedSignal && mergedSignal.aborted){
    return { ok:false, ops:[], rejected:[], destructiveLevel:'none', rawText, truncated:false, reason: timeoutCtl.signal.aborted ? 'TIMEOUT' : 'ABORTED' };
  }

  if(!parsed){
    return { ok:false, ops:[], rejected:[], destructiveLevel:'none', rawText, truncated:false, reason: 'PARSE_FAILED:' + (lastError && lastError.message ? lastError.message : 'unknown') };
  }

  const ctx = _askCtx();
  const val = (typeof validateOps === 'function') ? validateOps(parsed, ctx) : { valid:[], rejected:[{op:null,reason:'NO_VALIDATOR'}], destructiveLevel:'none', truncated:false };

  if(typeof pushAskHistory === 'function') pushAskHistory(q);

  return {
    ok: true,
    ops: val.valid,
    rejected: val.rejected,
    destructiveLevel: val.destructiveLevel,
    rawText,
    truncated: !!val.truncated,
  };
}

if(typeof window !== 'undefined'){
  window.askRun = askRun;
  window.ASK_CONTEXT_MAX_TASKS = ASK_CONTEXT_MAX_TASKS;
}
