/**
 * Ambient features: kNN metadata, semantic search, duplicates, values alignment, what-next.
 * Loads before ai.js — exports Schwartz constants for values UI + embeddings.
 */

const LIFE_CATS = ['health','finance','work','relationships','learning','home','personal','other'];
// Category / Schwartz icons are UI_ICONS keys, resolved to SVG at render time via window.icon()
const CAT_ICON  = {health:'heart',finance:'dollar',work:'briefcase',relationships:'users',learning:'book',home:'home',personal:'leaf',other:'pin'};
const SCHWARTZ = {
  'self-direction':{ icon:'compass', def:'Independent thought, creativity, freedom to choose your own goals.' },
  'stimulation':   { icon:'zap',     def:'Excitement, novelty, challenge, variety over routine.' },
  'hedonism':      { icon:'sparkles',def:'Pleasure, enjoyment, comfort, sensory gratification.' },
  'achievement':   { icon:'trophy',  def:'Personal success, demonstrated competence, goal achievement.' },
  'power':         { icon:'crown',   def:'Social status, authority, control over resources and people.' },
  'security':      { icon:'shield',  def:'Safety, stability, harmony — reducing risk and uncertainty.' },
  'conformity':    { icon:'users',   def:'Meeting obligations, honoring commitments, maintaining harmony.' },
  'tradition':     { icon:'columns', def:'Respect for cultural customs, family traditions.' },
  'benevolence':   { icon:'heart',   def:'Welfare of close others — family, friends, community.' },
  'universalism':  { icon:'globe',   def:'Welfare of all people and nature — justice, sustainability.' },
};
const VALUE_KEYS = Object.keys(SCHWARTZ);

window.LIFE_CATS = LIFE_CATS;
window.CAT_ICON = CAT_ICON;
window.SCHWARTZ = SCHWARTZ;
window.VALUE_KEYS = VALUE_KEYS;

const PRIO_ORDER = { urgent: 0, high: 1, normal: 2, low: 3, none: 4 };

function _taskText(t){
  return `${t.name || ''}\n${(t.description || '').slice(0, 2000)}`;
}

function _heuristicMetadata(name){
  const out = {};
  const lower = name.toLowerCase();
  if(/\burgent|asap|critical\b/.test(lower)) out.priority = 'urgent';
  else if(/\bimportant|soon\b/.test(lower)) out.priority = 'high';
  if(/\b(dentist|doctor|health|gym|workout)\b/.test(lower)) out.category = 'health';
  else if(/\b(pay|invoice|tax|bank|finance)\b/.test(lower)) out.category = 'finance';
  else if(/\b(call|email|meeting|deadline|project)\b/.test(lower)) out.category = 'work';
  return out;
}

/**
 * Ensure Schwartz value description embeddings cached in IDB.
 */
async function ensureSchwartzEmbeddings(){
  if(typeof embedStore === 'undefined' || !isIntelReady()) return null;
  const existing = await embedStore.getSchwartzEmbeddings();
  if(existing) return existing;

  const keys = VALUE_KEYS;
  const S = SCHWARTZ;
  const vecs = {};
  for(const k of keys){
    const def = (S[k] && S[k].def) ? S[k].def : k;
    const text = `${k}: ${def}`;
    vecs[k] = await embedText(text);
  }
  await embedStore.setSchwartzEmbeddings(vecs);
  return vecs;
}

/**
 * kNN vote from embedding store
 */
async function predictMetadata(taskName, k){
  const kk = k || 5;
  const q = await embedText(taskName);
  const store = await embedStore.all();
  const scored = [];
  for(const [id, rec] of store){
    const t = typeof findTask === 'function' ? findTask(id) : null;
    if(!t || t.archived) continue;
    scored.push({ t, sim: cosine(q, rec.vec) });
  }
  scored.sort((a, b) => b.sim - a.sim);
  const top = scored.slice(0, kk).filter(x => x.sim > 0.55);
  const merged = _heuristicMetadata(taskName);
  if(!top.length) return merged;

  const vote = field => {
    const w = new Map();
    for(const { t, sim } of top){
      const v = t[field];
      if(v == null || v === '') continue;
      w.set(v, (w.get(v) || 0) + sim);
    }
    if(!w.size) return null;
    return [...w.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  const cat = vote('category');
  const pr = vote('priority');
  const eff = vote('effort');
  const ctx = vote('context');
  const en = vote('energyLevel');
  if(cat && typeof cat === 'string') merged.category = cat;
  if(pr && ['urgent','high','normal','low'].includes(pr)) merged.priority = pr;
  if(eff && ['xs','s','m','l','xl'].includes(eff)) merged.effort = eff;
  if(ctx && typeof ctx === 'string') merged.context = ctx;
  if(en && ['high','low'].includes(en)) merged.energyLevel = en;

  const tagCounts = new Map();
  for(const { t, sim } of top){
    (t.tags || []).forEach(tag => {
      if(!tag || typeof tag !== 'string') return;
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + sim);
    });
  }
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);
  if(tags.length) merged.tags = tags;

  return merged;
}

async function semanticSearch(query, limit){
  const lim = limit || 20;
  const q = await embedText(query);
  const store = await embedStore.all();
  const scored = [];
  for(const [id, rec] of store){
    const t = typeof findTask === 'function' ? findTask(id) : null;
    if(!t || t.archived) continue;
    scored.push({ id, t, score: cosine(q, rec.vec) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, lim);
}

async function findDuplicates(threshold){
  const th = threshold == null ? 0.9 : threshold;
  const store = await embedStore.all();
  const ids = [...store.keys()];
  const pairs = [];
  for(let i = 0; i < ids.length; i++){
    for(let j = i + 1; j < ids.length; j++){
      const a = ids[i], b = ids[j];
      const va = store.get(a).vec;
      const vb = store.get(b).vec;
      const sim = cosine(va, vb);
      if(sim >= th){
        const ta = findTask(a), tb = findTask(b);
        if(!ta || !tb || ta.archived || tb.archived) continue;
        pairs.push({ idA: a, idB: b, sim, taskA: ta, taskB: tb });
      }
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);
  return pairs;
}

/** Per-task max similarity to any other (for badge) */
async function computeDuplicateScores(){
  const store = await embedStore.all();
  const ids = [...store.keys()];
  const maxSim = new Map();
  for(let i = 0; i < ids.length; i++){
    for(let j = i + 1; j < ids.length; j++){
      const a = ids[i], b = ids[j];
      const va = store.get(a).vec;
      const vb = store.get(b).vec;
      const sim = cosine(va, vb);
      if(sim >= 0.85){
        maxSim.set(a, Math.max(maxSim.get(a) || 0, sim));
        maxSim.set(b, Math.max(maxSim.get(b) || 0, sim));
      }
    }
  }
  return maxSim;
}

async function alignValuesForTask(taskId){
  const t = typeof findTask === 'function' ? findTask(taskId) : null;
  if(!t) return [];
  const schwartzVecs = await ensureSchwartzEmbeddings();
  if(!schwartzVecs) return [];

  let vec;
  const got = await embedStore.get(t.id);
  if(got && got.vec) vec = got.vec;
  else vec = await embedText(_taskText(t));

  const ranked = Object.entries(schwartzVecs)
    .map(([name, v]) => ({ name, sim: cosine(vec, v) }))
    .sort((a, b) => b.sim - a.sim)
    .filter(x => x.sim > 0.35)
    .slice(0, 3);
  return ranked.map(x => x.name);
}

function isTaskBlocked(t){
  if(!t || t.status === 'done' || t.archived) return true;
  if((t.status || '') === 'blocked') return true;
  const bb = t.blockedBy || [];
  for(const bid of bb){
    const b = typeof findTask === 'function' ? findTask(bid) : null;
    if(b && b.status !== 'done') return true;
  }
  return false;
}

function priorityWeight(t){
  const p = t.priority || 'none';
  return ({ urgent: 40, high: 28, normal: 14, low: 6, none: 0 })[p] || 0;
}

function deadlineUrgency(t, nowMs){
  if(!t.dueDate) return 0;
  const today = typeof todayISO === 'function' ? todayISO() : new Date().toISOString().slice(0, 10);
  if(t.dueDate < today) return 30;
  if(t.dueDate === today) return 22;
  const d = new Date(t.dueDate + 'T00:00:00');
  const diff = (d - new Date(today + 'T00:00:00')) / (86400000);
  if(diff <= 1) return 16;
  if(diff <= 7) return 8;
  return 3;
}

function effortFit(t, timeMin){
  if(timeMin == null || timeMin <= 0) return 0;
  const map = { xs: 15, s: 60, m: 240, l: 480, xl: 960 };
  const est = map[t.effort || ''] || 60;
  if(est <= timeMin) return 6;
  if(est <= timeMin * 2) return 3;
  return 0;
}

function energyFit(t, energy){
  if(!energy) return 0;
  if(energy === 'high' && t.energyLevel === 'high') return 4;
  if(energy === 'low' && (t.energyLevel === 'low' || !t.energyLevel)) return 4;
  if(!t.energyLevel) return 2;
  return 0;
}

function rankWhatNext(tasks, opts){
  const o = opts || {};
  const now = Date.now();
  const list = (tasks || []).filter(t => t && t.status !== 'done' && !t.archived && !isTaskBlocked(t));
  return list.map(t => ({
    t,
    score:
      priorityWeight(t)
      + deadlineUrgency(t, now)
      + (t.starred ? 12 : 0)
      + effortFit(t, o.timeMin)
      + energyFit(t, o.energy),
  })).sort((a, b) => b.score - a.score);
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-ORGANIZE INTO LISTS
// Embeds each list (name + description) once per content-hash, caches in meta
// store, then proposes CHANGE_LIST moves for tasks whose best list differs
// from their current list with enough confidence. Lists without descriptions
// still work — they just carry weaker signal (name-only embedding).
// ══════════════════════════════════════════════════════════════════════════════
const META_LIST_VECS_KEY = 'list_vecs_v1';

function _listText(l){
  const name = l.name || '';
  const desc = (l.description || '').slice(0, 2000);
  return desc ? `${name}\n${desc}` : name;
}

/** @returns {Promise<Map<number, Float32Array>>} */
async function _getListVectors(){
  if(typeof lists === 'undefined' || !Array.isArray(lists) || !lists.length) return new Map();
  const meta = await embedStore.getMeta(META_LIST_VECS_KEY);
  const cache = (meta && meta.vecs && typeof meta.vecs === 'object') ? meta.vecs : {};
  const result = new Map();
  let dirty = false;

  for(const l of lists){
    const h = hashTaskText(l.name, l.description);
    const cur = cache[l.id];
    if(cur && cur.hash === h && cur.vec){
      result.set(l.id, new Float32Array(cur.vec));
      continue;
    }
    const vec = await embedText(_listText(l));
    const buf = vec.buffer
      ? vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength)
      : vec;
    cache[l.id] = { hash: h, vec: buf };
    result.set(l.id, new Float32Array(buf));
    dirty = true;
  }

  // Prune stale cache entries for deleted lists
  const liveIds = new Set(lists.map(l => l.id));
  for(const k of Object.keys(cache)){
    if(!liveIds.has(Number(k))){
      delete cache[k];
      dirty = true;
    }
  }

  if(dirty) await embedStore.setMeta(META_LIST_VECS_KEY, { vecs: cache });
  return result;
}

async function invalidateListVectorCache(){
  try{ await embedStore.setMeta(META_LIST_VECS_KEY, { vecs: {} }); }catch(e){}
}

/**
 * Propose list moves for active (non-archived, non-done) tasks whose best-fitting
 * list differs from their current one.
 * @param {{minScore?:number, minMargin?:number, includeEmptyListId?:boolean}} opts
 *   minScore   — min absolute cosine to the winning list (default 0.45)
 *   minMargin  — min gap between best and 2nd-best list (default 0.04)
 * @returns {Promise<Array<{id:number,name:string,fromListId:number|null,toListId:number,sim:number,margin:number}>>}
 */
async function autoOrganizeIntoLists(opts){
  const o = opts || {};
  const minScore = o.minScore == null ? 0.45 : o.minScore;
  const minMargin = o.minMargin == null ? 0.04 : o.minMargin;
  if(typeof lists === 'undefined' || !Array.isArray(lists) || lists.length < 2) return [];

  const listVecs = await _getListVectors();
  if(listVecs.size < 2) return [];

  if(typeof tasks !== 'undefined' && Array.isArray(tasks) && typeof embedStore !== 'undefined' && embedStore.ensure){
    for(const t of tasks){
      if(!t || t.archived || t.status === 'done') continue;
      try{ await embedStore.ensure(t); }catch(e){ /* skip */ }
    }
  }

  const store = await embedStore.all();
  const proposals = [];

  for(const [id, rec] of store){
    const t = typeof findTask === 'function' ? findTask(id) : null;
    if(!t || t.archived || t.status === 'done') continue;

    let best = null, second = null;
    for(const [lid, lv] of listVecs){
      const sim = cosine(rec.vec, lv);
      if(!best || sim > best.sim){ second = best; best = { lid, sim }; }
      else if(!second || sim > second.sim){ second = { lid, sim }; }
    }
    if(!best || best.sim < minScore) continue;
    if(second && (best.sim - second.sim) < minMargin) continue;
    if(t.listId === best.lid) continue;

    proposals.push({
      id: t.id,
      name: t.name,
      fromListId: t.listId || null,
      toListId: best.lid,
      sim: best.sim,
      margin: second ? best.sim - second.sim : best.sim,
    });
  }

  proposals.sort((a, b) => b.sim - a.sim);
  return proposals;
}

function _stableSortedJson(arr){
  return JSON.stringify([...(arr || [])].map(String).sort());
}

/** Name + description line for kNN metadata (matches embed text roughly) */
function _predictQueryLine(t){
  const n = (t.name || '').trim();
  const d = (t.description || '').trim().slice(0, 600);
  return d ? `${n}\n${d}` : n;
}

/**
 * Build UPDATE_TASK ops from embeddings: Schwartz-style values + kNN metadata
 * (category, priority, effort, context, energy, tags) where they differ from current.
 * Uses dominant value keys when set (from settings) to filter alignment; otherwise top 3.
 * @param {{dominant?:string[], maxTasks?:number}} opts
 * @returns {Promise<Array<{name:'UPDATE_TASK', args:object}>>}
 */
async function proposeHarmonizeUpdates(opts){
  const o = opts || {};
  const dominant = Array.isArray(o.dominant) ? o.dominant : [];
  const maxTasks = o.maxTasks == null ? 200 : o.maxTasks;
  if(typeof tasks === 'undefined' || !Array.isArray(tasks)) return [];

  await ensureSchwartzEmbeddings();

  const active = tasks.filter(t => t && !t.archived && t.status !== 'done').slice(0, maxTasks);
  const ops = [];

  for(const t of active){
    if(typeof embedStore !== 'undefined' && embedStore.ensure){
      try{ await embedStore.ensure(t); }catch(e){ /* skip */ }
    }

    const line = _predictQueryLine(t);
    const meta = await predictMetadata(line, 7);
    const valsRaw = await alignValuesForTask(t.id);
    const useVals = dominant.length
      ? valsRaw.filter(v => dominant.includes(v))
      : valsRaw.slice(0, 3);
    const vals = useVals.length ? useVals : valsRaw.slice(0, 3);

    const args = { id: t.id };
    let changes = 0;

    if(vals.length){
      if(_stableSortedJson(t.valuesAlignment) !== _stableSortedJson(vals)){
        args.valuesAlignment = vals;
        args.valuesNote = 'Harmonized from on-device embeddings (values + task similarity)';
        changes++;
      }
    }

    if(meta.category && typeof meta.category === 'string' && meta.category.trim() && meta.category !== (t.category || null)){
      args.category = meta.category.trim();
      changes++;
    }
    if(meta.priority && ['urgent','high','normal','low'].includes(meta.priority) && meta.priority !== (t.priority || 'none')){
      args.priority = meta.priority;
      changes++;
    }
    if(meta.effort && ['xs','s','m','l','xl'].includes(meta.effort) && meta.effort !== (t.effort || null)){
      args.effort = meta.effort;
      changes++;
    }
    if(meta.context && typeof meta.context === 'string' && meta.context.trim() && meta.context !== (t.context || null)){
      args.context = meta.context.trim();
      changes++;
    }
    if(meta.energyLevel && ['high','low'].includes(meta.energyLevel) && meta.energyLevel !== (t.energyLevel || null)){
      args.energyLevel = meta.energyLevel;
      changes++;
    }
    if(Array.isArray(meta.tags) && meta.tags.length){
      const cur = [...(t.tags || [])];
      const merged = [...cur];
      const seen = new Set(cur.map(String));
      let added = false;
      for(const tag of meta.tags){
        if(merged.length >= 12) break;
        if(tag && !seen.has(tag)){
          merged.push(tag);
          seen.add(tag);
          added = true;
        }
      }
      if(added){
        args.tags = merged;
        changes++;
      }
    }

    if(changes) ops.push({ name: 'UPDATE_TASK', args });
  }

  return ops;
}

async function similarTasksFor(taskId, k){
  const kk = k || 5;
  const t = findTask(taskId);
  if(!t) return [];
  let vec;
  const got = await embedStore.get(taskId);
  if(got && got.vec) vec = got.vec;
  else vec = await embedText(_taskText(t));

  const store = await embedStore.all();
  const scored = [];
  for(const [id, rec] of store){
    if(id === taskId) continue;
    const ot = findTask(id);
    if(!ot || ot.archived) continue;
    scored.push({ id, t: ot, sim: cosine(vec, rec.vec) });
  }
  scored.sort((a, b) => b.sim - a.sim);
  return scored.slice(0, kk);
}

window.ensureSchwartzEmbeddings = ensureSchwartzEmbeddings;
window.predictMetadata = predictMetadata;
window.semanticSearch = semanticSearch;
window.findDuplicates = findDuplicates;
window.computeDuplicateScores = computeDuplicateScores;
window.alignValuesForTask = alignValuesForTask;
window.rankWhatNext = rankWhatNext;
window.similarTasksFor = similarTasksFor;
window.isTaskBlocked = isTaskBlocked;
window.autoOrganizeIntoLists = autoOrganizeIntoLists;
window.invalidateListVectorCache = invalidateListVectorCache;
window.proposeHarmonizeUpdates = proposeHarmonizeUpdates;

// ── Custom categories / contexts (seeded defaults, user-editable in Settings) ──
const DEFAULT_CATEGORY_ROWS = LIFE_CATS.map(id => ({
  id,
  label: ({health:'Health',finance:'Finance',work:'Work',relationships:'Relationships',learning:'Learning',home:'Home',personal:'Personal',other:'Other'})[id] || id,
  icon: CAT_ICON[id] || 'pin',
  hidden: false,
}));
const DEFAULT_CONTEXT_ROWS = [
  {id:'work', label:'Work', icon:'briefcase', hidden:false},
  {id:'home', label:'Home', icon:'home', hidden:false},
  {id:'phone', label:'Phone', icon:'phone', hidden:false},
  {id:'computer', label:'Computer', icon:'monitor', hidden:false},
  {id:'errands', label:'Errands', icon:'car', hidden:false},
];
function ensureClassificationCfg(c){
  if(!c || typeof c !== 'object') return;
  if(!Array.isArray(c.categories) || c.categories.length === 0)
    c.categories = DEFAULT_CATEGORY_ROWS.map(x => ({...x}));
  if(!Array.isArray(c.contexts) || c.contexts.length === 0)
    c.contexts = DEFAULT_CONTEXT_ROWS.map(x => ({...x}));
  (c.categories || []).forEach(row => {
    if(!row || typeof row !== 'object') return;
    if(!row.icon) row.icon = CAT_ICON[row.id] || 'pin';
    row.hidden = row.hidden === true;
  });
  (c.contexts || []).forEach(row => {
    if(!row || typeof row !== 'object') return;
    if(!row.icon){
      const d = DEFAULT_CONTEXT_ROWS.find(z => z.id === row.id);
      row.icon = d ? d.icon : 'monitor';
    }
    row.hidden = row.hidden === true;
  });
}
function getCategoryDef(id){
  if(id == null || id === '') return {id:'', label:'', icon:'pin'};
  const sid = String(id);
  if(typeof cfg !== 'undefined' && cfg){
    ensureClassificationCfg(cfg);
    const row = (cfg.categories || []).find(x => x && x.id === sid);
    if(row)
      return { id: row.id, label: row.label || sid, icon: row.icon || CAT_ICON[sid] || 'pin' };
  }
  return { id: sid, label: sid, icon: CAT_ICON[sid] || 'pin' };
}
function getContextDef(id){
  if(id == null || id === '') return {id:'', label:'', icon:'monitor'};
  const sid = String(id);
  const fb = DEFAULT_CONTEXT_ROWS.find(z => z.id === sid);
  if(typeof cfg !== 'undefined' && cfg){
    ensureClassificationCfg(cfg);
    const row = (cfg.contexts || []).find(x => x && x.id === sid);
    if(row)
      return { id: row.id, label: row.label || sid, icon: row.icon || (fb && fb.icon) || 'monitor' };
  }
  return { id: sid, label: sid, icon: (fb && fb.icon) || 'monitor' };
}
function getActiveCategories(){
  if(typeof cfg === 'undefined' || !cfg) return DEFAULT_CATEGORY_ROWS.filter(x => !x.hidden);
  ensureClassificationCfg(cfg);
  return (cfg.categories || []).filter(x => x && !x.hidden);
}
function getActiveContexts(){
  if(typeof cfg === 'undefined' || !cfg) return DEFAULT_CONTEXT_ROWS.filter(x => !x.hidden);
  ensureClassificationCfg(cfg);
  return (cfg.contexts || []).filter(x => x && !x.hidden);
}
window.resolveCategoryIconKey = function(id){ return getCategoryDef(id).icon; };
window.ensureClassificationCfg = ensureClassificationCfg;
window.getCategoryDef = getCategoryDef;
window.getContextDef = getContextDef;
window.getActiveCategories = getActiveCategories;
window.getActiveContexts = getActiveContexts;
