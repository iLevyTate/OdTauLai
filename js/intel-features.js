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

const DEFAULT_CATEGORY_DEFS = [
  { id: 'health', label: 'Health', icon: 'heart' },
  { id: 'finance', label: 'Finance', icon: 'dollar' },
  { id: 'work', label: 'Work', icon: 'briefcase' },
  { id: 'relationships', label: 'Relationships', icon: 'users' },
  { id: 'learning', label: 'Learning', icon: 'book' },
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'personal', label: 'Personal', icon: 'leaf' },
  { id: 'other', label: 'Other', icon: 'pin' },
];
const DEFAULT_CONTEXT_DEFS = [
  { id: 'work', label: 'Work', icon: 'briefcase' },
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'phone', label: 'Phone', icon: 'phone' },
  { id: 'computer', label: 'Computer', icon: 'monitor' },
  { id: 'errands', label: 'Errands', icon: 'car' },
];

function ensureClassificationConfig(c){
  if(!c || typeof c !== 'object') return;
  if(!Array.isArray(c.categories) || !c.categories.length){
    c.categories = DEFAULT_CATEGORY_DEFS.map(x => ({ ...x, hidden: false }));
  } else {
    c.categories = c.categories.map(row => ({
      id: String(row.id || '').trim().slice(0, 64) || null,
      label: String(row.label || row.id || '').trim().slice(0, 80) || '',
      icon: String(row.icon || 'pin').trim() || 'pin',
      hidden: !!row.hidden,
    })).filter(r => r.id);
    if(!c.categories.length){
      c.categories = DEFAULT_CATEGORY_DEFS.map(x => ({ ...x, hidden: false }));
    }
  }
  if(!Array.isArray(c.contexts) || !c.contexts.length){
    c.contexts = DEFAULT_CONTEXT_DEFS.map(x => ({ ...x, hidden: false }));
  } else {
    c.contexts = c.contexts.map(row => ({
      id: String(row.id || '').trim().slice(0, 64) || null,
      label: String(row.label || row.id || '').trim().slice(0, 80) || '',
      icon: String(row.icon || 'pin').trim() || 'pin',
      hidden: !!row.hidden,
    })).filter(r => r.id);
    if(!c.contexts.length){
      c.contexts = DEFAULT_CONTEXT_DEFS.map(x => ({ ...x, hidden: false }));
    }
  }
}

function hasClassificationCategory(cat){
  if(!cat) return false;
  if(LIFE_CATS.includes(cat)) return true;
  if(typeof cfg === 'undefined' || !cfg) return false;
  ensureClassificationConfig(cfg);
  return (cfg.categories || []).some(c => c.id === cat);
}
function hasClassificationContext(ctx){
  if(!ctx) return false;
  if(['work','home','phone','computer','errands'].includes(ctx)) return true;
  if(typeof cfg === 'undefined' || !cfg) return false;
  ensureClassificationConfig(cfg);
  return (cfg.contexts || []).some(c => c.id === ctx);
}

function getCategoryDef(id){
  if(!id) return null;
  if(typeof cfg !== 'undefined' && cfg) ensureClassificationConfig(cfg);
  const row = (typeof cfg !== 'undefined' && cfg && Array.isArray(cfg.categories))
    ? cfg.categories.find(x => x.id === id) : null;
  if(row){
    return { id: row.id, label: row.label || row.id, icon: row.icon || 'pin' };
  }
  const ic = CAT_ICON[id];
  return { id, label: id, icon: ic || 'pin' };
}

function getContextDef(id){
  if(!id) return null;
  if(typeof cfg !== 'undefined' && cfg) ensureClassificationConfig(cfg);
  const row = (typeof cfg !== 'undefined' && cfg && Array.isArray(cfg.contexts))
    ? cfg.contexts.find(x => x.id === id) : null;
  if(row){
    return { id: row.id, label: row.label || row.id, icon: row.icon || 'pin' };
  }
  const fallback = { work: 'briefcase', home: 'home', phone: 'phone', computer: 'monitor', errands: 'car' };
  return { id, label: id, icon: fallback[id] || 'pin' };
}

function getActiveCategories(){
  if(typeof cfg === 'undefined' || !cfg) return DEFAULT_CATEGORY_DEFS.slice();
  ensureClassificationConfig(cfg);
  return (cfg.categories || []).filter(c => !c.hidden);
}
function getActiveContexts(){
  if(typeof cfg === 'undefined' || !cfg) return DEFAULT_CONTEXT_DEFS.slice();
  ensureClassificationConfig(cfg);
  return (cfg.contexts || []).filter(c => !c.hidden);
}

function slugClassId(label){
  const s = String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return s || ('c' + Date.now().toString(36));
}

function classificationMove(kind, idx, dir){
  if(typeof cfg === 'undefined' || !cfg) return;
  ensureClassificationConfig(cfg);
  const arr = kind === 'cat' ? cfg.categories : cfg.contexts;
  const j = idx + dir;
  if(j < 0 || j >= arr.length) return;
  const tmp = arr[idx];
  arr[idx] = arr[j];
  arr[j] = tmp;
  renderClassificationSettings();
  refreshClassificationUi();
  if(typeof saveState === 'function') saveState('user');
}

function classificationToggleHidden(kind, idx){
  if(typeof cfg === 'undefined' || !cfg) return;
  ensureClassificationConfig(cfg);
  const arr = kind === 'cat' ? cfg.categories : cfg.contexts;
  if(!arr[idx]) return;
  arr[idx].hidden = !arr[idx].hidden;
  renderClassificationSettings();
  refreshClassificationUi();
  if(typeof renderTaskList === 'function') renderTaskList();
  if(typeof saveState === 'function') saveState('user');
}

function classificationSetLabel(kind, idx, label){
  if(typeof cfg === 'undefined' || !cfg) return;
  ensureClassificationConfig(cfg);
  const arr = kind === 'cat' ? cfg.categories : cfg.contexts;
  if(!arr[idx]) return;
  arr[idx].label = String(label || '').trim().slice(0, 80) || arr[idx].id;
  refreshClassificationUi();
  if(typeof renderTaskList === 'function') renderTaskList();
  if(typeof saveState === 'function') saveState('user');
}

function classificationSetIcon(kind, idx, iconName){
  if(typeof cfg === 'undefined' || !cfg) return;
  ensureClassificationConfig(cfg);
  const arr = kind === 'cat' ? cfg.categories : cfg.contexts;
  if(!arr[idx]) return;
  arr[idx].icon = String(iconName || 'pin').trim() || 'pin';
  renderClassificationSettings();
  if(typeof saveState === 'function') saveState('user');
}

async function classificationAdd(kind){
  if(typeof cfg === 'undefined' || !cfg) return;
  const promptLabel = kind === 'cat' ? 'New category name:' : 'New context name:';
  const raw = typeof showAppPrompt === 'function'
    ? await showAppPrompt(promptLabel, '')
    : (kind === 'cat' ? prompt('New category name:') : prompt('New context name:'));
  if(raw === null || !String(raw).trim()) return;
  ensureClassificationConfig(cfg);
  const label = String(raw).trim().slice(0, 80);
  let id = slugClassId(label);
  const arr = kind === 'cat' ? cfg.categories : cfg.contexts;
  while(arr.some(x => x.id === id)){
    id = id + '-' + Math.random().toString(36).slice(2, 5);
  }
  arr.push({ id, label, icon: 'pin', hidden: false });
  renderClassificationSettings();
  refreshClassificationUi();
  if(typeof saveState === 'function') saveState('user');
}

function renderClassificationSettings(){
  const root = document.getElementById('classificationManager');
  if(!root || typeof cfg === 'undefined' || !cfg) return;
  ensureClassificationConfig(cfg);
  const iconKeys = (window.UI_ICONS && typeof window.UI_ICONS === 'object')
    ? Object.keys(window.UI_ICONS).sort() : ['pin'];

  function rowsHtml(title, kind, list){
    let h = '<div class="class-mgr-block"><div class="class-mgr-hdr">' + esc(title) + '</div>';
    list.forEach((obj, idx) => {
      const opt = iconKeys.map(k => '<option value="' + esc(k) + '"' + (k === obj.icon ? ' selected' : '') + '>' + esc(k) + '</option>').join('');
      h += '<div class="class-mgr-row' + (obj.hidden ? ' class-mgr-row--hidden' : '') + '">'
        + '<input type="text" class="class-mgr-in" value="' + esc(obj.label) + '" '
        + 'onchange="classificationSetLabel(\'' + kind + '\',' + idx + ',this.value)" aria-label="Label"/>'
        + '<select class="class-mgr-sel" onchange="classificationSetIcon(\'' + kind + '\',' + idx + ',this.value)" aria-label="Icon">' + opt + '</select>'
        + '<button type="button" class="class-mgr-btn" onclick="classificationToggleHidden(\'' + kind + '\',' + idx + ')">' + (obj.hidden ? 'Show' : 'Hide') + '</button>'
        + '<button type="button" class="class-mgr-btn" onclick="classificationMove(\'' + kind + '\',' + idx + ',-1)">↑</button>'
        + '<button type="button" class="class-mgr-btn" onclick="classificationMove(\'' + kind + '\',' + idx + ',1)">↓</button>'
        + '<code class="class-mgr-id" title="Stable id stored on tasks">' + esc(obj.id) + '</code>'
        + '</div>';
    });
    h += '<button type="button" class="btn-ghost btn-sm class-mgr-add" onclick="classificationAdd(\'' + kind + '\')">+ Add ' + (kind === 'cat' ? 'category' : 'context') + '</button></div>';
    return h;
  }

  root.innerHTML = rowsHtml('Life categories', 'cat', cfg.categories)
    + rowsHtml('Contexts', 'ctx', cfg.contexts);
}

function refreshClassificationUi(){
  if(typeof cfg !== 'undefined') ensureClassificationConfig(cfg);
  const sel = document.getElementById('filterCategory');
  if(sel){
    const cur = sel.value;
    sel.innerHTML = '<option value="all">Any category</option>';
    getActiveCategories().forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.label;
      sel.appendChild(o);
    });
    if([...sel.options].some(o => o.value === cur)) sel.value = cur;
  }
  if(document.getElementById('classificationManager')){
    renderClassificationSettings();
  }
}

const LIFE_CATS_LOCAL = LIFE_CATS;
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

let _schwartzEmbeddingsPromise = null;

/**
 * Ensure Schwartz value description embeddings cached in IDB.
 */
async function ensureSchwartzEmbeddings(){
  if(typeof embedStore === 'undefined' || !isIntelReady()) return null;
  const existing = await embedStore.getSchwartzEmbeddings();
  if(existing) return existing;
  if(_schwartzEmbeddingsPromise) return _schwartzEmbeddingsPromise;

  _schwartzEmbeddingsPromise = (async () => {
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
  })();

  try{
    return await _schwartzEmbeddingsPromise;
  }finally{
    _schwartzEmbeddingsPromise = null;
  }
}

/** kNN neighborhood + vote quality (tuneable) */
const KNN_MIN_SIM = 0.55;
const KNN_CAT_MIN_CONF = 0.55;
const KNN_CAT_MIN_MARGIN = 0.15;
const KNN_CTX_MIN_CONF = 0.55;
const KNN_CTX_MIN_MARGIN = 0.15;
const KNN_PRIO_EFF_EN_MIN_CONF = 0.5;
const KNN_TAG_TOP_FRAC = 0.6;

function _weightedFieldVote(topNeighbors, field){
  const w = new Map();
  let total = 0;
  for(const { t, sim } of topNeighbors){
    const v = t[field];
    if(v == null || v === '') continue;
    w.set(v, (w.get(v) || 0) + sim);
    total += sim;
  }
  if(!w.size || total <= 0) return { value: null, confidence: 0, margin: 0, totalWeight: 0 };
  const sorted = [...w.entries()].sort((a, b) => b[1] - a[1]);
  const [v0, w0] = sorted[0];
  const w1 = sorted[1] ? sorted[1][1] : 0;
  const confidence = w0 / total;
  const margin = w0 > 0 ? (w0 - w1) / w0 : 0;
  return { value: v0, confidence, margin, totalWeight: w0 };
}

/**
 * kNN metadata from a precomputed query vector (no embedText call).
 * @param {Float32Array} queryVec
 * @param {{ store: Map<number,{vec:Float32Array,textHash:string}>, excludeId?: number|null, heuristic?: object, k?: number }} opts
 */
function predictMetadataFromVec(queryVec, opts){
  const o = opts || {};
  const store = o.store;
  const excludeId = o.excludeId == null ? null : o.excludeId;
  const kk = o.k || 5;
  const heuristic = (o.heuristic && typeof o.heuristic === 'object') ? { ...o.heuristic } : {};
  const merged = { ...heuristic };
  const _confidence = {};

  if(!store || !queryVec){
    merged._confidence = _confidence;
    return merged;
  }

  const scored = [];
  for(const [id, rec] of store){
    if(id === excludeId) continue;
    const t = typeof findTask === 'function' ? findTask(id) : null;
    if(!t || t.archived) continue;
    scored.push({ t, sim: cosine(queryVec, rec.vec) });
  }
  scored.sort((a, b) => b.sim - a.sim);
  const top = scored.slice(0, kk).filter(x => x.sim > KNN_MIN_SIM);
  if(!top.length){
    merged._confidence = _confidence;
    return merged;
  }

  const pickDiscrete = (field, minConf, minMargin, validator) => {
    const { value, confidence, margin } = _weightedFieldVote(top, field);
    _confidence[field] = { value, confidence, margin };
    if(value == null) return null;
    if(confidence < minConf || margin < minMargin) return null;
    if(typeof validator === 'function' && !validator(value)) return null;
    return value;
  };

  const cat = pickDiscrete('category', KNN_CAT_MIN_CONF, KNN_CAT_MIN_MARGIN, v => hasClassificationCategory(v));
  if(cat) merged.category = cat;

  const ctx = pickDiscrete('context', KNN_CTX_MIN_CONF, KNN_CTX_MIN_MARGIN, v => hasClassificationContext(v));
  if(ctx) merged.context = ctx;

  const prVote = _weightedFieldVote(top, 'priority');
  _confidence.priority = { value: prVote.value, confidence: prVote.confidence, margin: prVote.margin };
  if(prVote.value && ['urgent','high','normal','low'].includes(prVote.value) && prVote.confidence >= KNN_PRIO_EFF_EN_MIN_CONF){
    merged.priority = prVote.value;
  }

  const effVote = _weightedFieldVote(top, 'effort');
  _confidence.effort = { value: effVote.value, confidence: effVote.confidence, margin: effVote.margin };
  if(effVote.value && ['xs','s','m','l','xl'].includes(effVote.value) && effVote.confidence >= KNN_PRIO_EFF_EN_MIN_CONF){
    merged.effort = effVote.value;
  }

  const enVote = _weightedFieldVote(top, 'energyLevel');
  _confidence.energyLevel = { value: enVote.value, confidence: enVote.confidence, margin: enVote.margin };
  if(enVote.value && ['high','low'].includes(enVote.value) && enVote.confidence >= KNN_PRIO_EFF_EN_MIN_CONF){
    merged.energyLevel = enVote.value;
  }

  const tagCounts = new Map();
  for(const { t, sim } of top){
    (t.tags || []).forEach(tag => {
      if(!tag || typeof tag !== 'string') return;
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + sim);
    });
  }
  const tagSorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  let tags = [];
  if(tagSorted.length){
    const topW = tagSorted[0][1];
    const floor = topW * KNN_TAG_TOP_FRAC;
    tags = tagSorted.filter(([, w]) => w >= floor).slice(0, 5).map(x => x[0]);
    _confidence.tags = { topWeight: topW, picked: tags.slice() };
  }
  if(tags.length) merged.tags = tags;

  merged._confidence = _confidence;
  return merged;
}

/**
 * kNN vote from embedding store (embeds query text once).
 */
async function predictMetadata(taskName, k){
  const kk = k || 5;
  const q = await embedText(taskName);
  const store = await embedStore.all();
  return predictMetadataFromVec(q, {
    store,
    excludeId: null,
    heuristic: _heuristicMetadata(taskName),
    k: kk,
  });
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

const _DUP_PAIR_YIELD = 350;

async function findDuplicates(threshold){
  const th = threshold == null ? 0.9 : threshold;
  const store = await embedStore.all();
  const ids = [...store.keys()];
  const pairs = [];
  let pairsChecked = 0;
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
      if(++pairsChecked % _DUP_PAIR_YIELD === 0) await new Promise(r => setTimeout(r, 0));
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
  let pairsChecked = 0;
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
      if(++pairsChecked % _DUP_PAIR_YIELD === 0) await new Promise(r => setTimeout(r, 0));
    }
  }
  return maxSim;
}

function alignValuesFromVec(vec, schwartzVecs){
  if(!vec || !schwartzVecs) return [];
  const ranked = Object.entries(schwartzVecs)
    .map(([name, v]) => ({ name, sim: cosine(vec, v) }))
    .sort((a, b) => b.sim - a.sim)
    .filter(x => x.sim > 0.35)
    .slice(0, 3);
  return ranked.map(x => x.name);
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

  return alignValuesFromVec(vec, schwartzVecs);
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

  const schwartzVecs = await ensureSchwartzEmbeddings();

  const active = tasks.filter(t => t && !t.archived && t.status !== 'done').slice(0, maxTasks);
  const ops = [];

  if(typeof embedStore !== 'undefined' && embedStore.ensure){
    for(const t of active){
      try{ await embedStore.ensure(t); }catch(e){ /* skip */ }
    }
  }
  const store = await embedStore.all();

  for(const t of active){
    const rec = store.get(t.id);
    if(!rec || !rec.vec) continue;

    const meta = predictMetadataFromVec(rec.vec, {
      store,
      excludeId: t.id,
      heuristic: _heuristicMetadata((t.name || '').trim()),
      k: 7,
    });
    const fieldConfidence = meta._confidence || null;
    if(meta._confidence) delete meta._confidence;

    const valsRaw = schwartzVecs ? alignValuesFromVec(rec.vec, schwartzVecs) : [];
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

    if(meta.category && hasClassificationCategory(meta.category) && meta.category !== (t.category || null)){
      args.category = meta.category;
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
    if(meta.context && hasClassificationContext(meta.context) && meta.context !== (t.context || null)){
      args.context = meta.context;
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

    if(changes){
      const op = { name: 'UPDATE_TASK', args };
      if(fieldConfidence) op._fieldConfidence = fieldConfidence;
      ops.push(op);
    }
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
window.predictMetadataFromVec = predictMetadataFromVec;
window.alignValuesFromVec = alignValuesFromVec;
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
window.ensureClassificationConfig = ensureClassificationConfig;
window.getCategoryDef = getCategoryDef;
window.getContextDef = getContextDef;
window.getActiveCategories = getActiveCategories;
window.getActiveContexts = getActiveContexts;
window.hasClassificationCategory = hasClassificationCategory;
window.hasClassificationContext = hasClassificationContext;
window.renderClassificationSettings = renderClassificationSettings;
window.refreshClassificationUi = refreshClassificationUi;
window.classificationMove = classificationMove;
window.classificationToggleHidden = classificationToggleHidden;
window.classificationSetLabel = classificationSetLabel;
window.classificationSetIcon = classificationSetIcon;
window.classificationAdd = classificationAdd;
