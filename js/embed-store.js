/**
 * IndexedDB store for task embeddings + meta (Schwartz value vectors).
 * DB: stupind_intel (legacy name; retains existing IndexedDB after rebrand to ODTAULAI)
 */
const INTEL_DB = 'stupind_intel';
const INTEL_DB_VER = 1;
const STORE_EMB = 'embeddings';
const STORE_META = 'meta';

const META_SCHWARTZ_KEY = 'schwartz_vecs_v1';
const SCHWARTZ_MODEL_VER = 'gte-small';

function _openDb(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INTEL_DB, INTEL_DB_VER);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE_EMB)) db.createObjectStore(STORE_EMB, { keyPath: 'taskId' });
      if(!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
    };
  });
}

function _tx(db, stores, mode){
  return db.transaction(stores, mode);
}

/** djb2-ish hash for change detection */
function hashTaskText(name, description){
  const s = String(name || '') + '\n' + String(description || '').slice(0, 4000);
  let h = 5381;
  for(let i = 0; i < s.length; i++){
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

const embedStore = {
  async put(taskId, textHash, vec){
    const db = await _openDb();
    await new Promise((resolve, reject) => {
      const tx = _tx(db, [STORE_EMB], 'readwrite');
      const st = tx.objectStore(STORE_EMB);
      const rec = { taskId, textHash, vec: vec.buffer ? vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength) : vec };
      st.put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },

  async get(taskId){
    const db = await _openDb();
    const rec = await new Promise((resolve, reject) => {
      const tx = _tx(db, [STORE_EMB], 'readonly');
      const rq = tx.objectStore(STORE_EMB).get(taskId);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error);
    });
    db.close();
    if(!rec || !rec.vec) return null;
    return { textHash: rec.textHash, vec: new Float32Array(rec.vec) };
  },

  /** @returns {Promise<Map<number, {vec: Float32Array, textHash: string}>>} */
  async all(){
    const db = await _openDb();
    const map = new Map();
    await new Promise((resolve, reject) => {
      const tx = _tx(db, [STORE_EMB], 'readonly');
      const rq = tx.objectStore(STORE_EMB).openCursor();
      rq.onsuccess = e => {
        const cur = e.target.result;
        if(!cur){
          resolve();
          return;
        }
        const r = cur.value;
        if(r && r.vec) map.set(r.taskId, { vec: new Float32Array(r.vec), textHash: r.textHash });
        cur.continue();
      };
      rq.onerror = () => reject(rq.error);
    });
    db.close();
    return map;
  },

  async ensure(task){
    if(typeof embedText !== 'function') return;
    if(typeof isIntelReady === 'function' && !isIntelReady()) return;
    if(!task || task.archived) return;
    const h = hashTaskText(task.name, task.description);
    const cur = await embedStore.get(task.id);
    if(cur && cur.textHash === h) return;
    const vec = await embedText(`${task.name}\n${(task.description || '').slice(0, 2000)}`);
    await embedStore.put(task.id, h, vec);
  },

  async purge(taskIds){
    if(!taskIds || !taskIds.length) return;
    const db = await _openDb();
    await new Promise((resolve, reject) => {
      const tx = _tx(db, [STORE_EMB], 'readwrite');
      const st = tx.objectStore(STORE_EMB);
      taskIds.forEach(id => st.delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },

  async cleanOrphans(){
    if(typeof tasks === 'undefined' || !Array.isArray(tasks)) return;
    const alive = new Set(tasks.map(t => t.id));
    const db = await _openDb();
    const toDelete = [];
    await new Promise((resolve, reject) => {
      const tx = _tx(db, [STORE_EMB], 'readonly');
      const rq = tx.objectStore(STORE_EMB).openCursor();
      rq.onsuccess = e => {
        const cur = e.target.result;
        if(!cur){
          resolve();
          return;
        }
        if(!alive.has(cur.value.taskId)) toDelete.push(cur.value.taskId);
        cur.continue();
      };
      rq.onerror = () => reject(rq.error);
    });
    db.close();
    if(toDelete.length) await embedStore.purge(toDelete);
  },

  async getMeta(key){
    const db = await _openDb();
    const rec = await new Promise((resolve, reject) => {
      const tx = _tx(db, [STORE_META], 'readonly');
      const rq = tx.objectStore(STORE_META).get(key);
      rq.onsuccess = () => resolve(rq.result ? rq.result.value : null);
      rq.onerror = () => reject(rq.error);
    });
    db.close();
    return rec;
  },

  async setMeta(key, value){
    const db = await _openDb();
    await new Promise((resolve, reject) => {
      const tx = _tx(db, [STORE_META], 'readwrite');
      tx.objectStore(STORE_META).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },

  async getSchwartzEmbeddings(){
    const cached = await embedStore.getMeta(META_SCHWARTZ_KEY);
    if(cached && cached.model === SCHWARTZ_MODEL_VER && cached.vecs) return cached.vecs;
    return null;
  },

  async setSchwartzEmbeddings(vecs){
    await embedStore.setMeta(META_SCHWARTZ_KEY, { model: SCHWARTZ_MODEL_VER, vecs });
  },
};

window.embedStore = embedStore;
window.hashTaskText = hashTaskText;
window.INTEL_META_SCHWARTZ_KEY = META_SCHWARTZ_KEY;
