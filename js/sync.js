// ========== P2P SYNC (WebRTC via PeerJS) ==========
// Devices sync directly — no server sees your data.
// PeerJS cloud only handles the initial handshake (SDP/ICE exchange).
// After that, data flows device-to-device via RTCDataChannel.

// Peer ID format: `stupind-<6 alphanumeric>` (never includes "stu" as suffix).
// Displayed as `STU-XXX-XXX` where the first "STU" is branding only.
// A legacy v1 bug produced 9-char ids starting with "stu" (the brand accidentally
// embedded in the id), rendered as "STU-STU-XXXXXX". We migrate those on boot.
const SYNC_PEER_KEY    = (window.ODTAULAI_CONFIG && window.ODTAULAI_CONFIG.STORAGE_KEYS && window.ODTAULAI_CONFIG.STORAGE_KEYS.SYNC_PEER) || 'stupind_peer_id_v2'; // cleaned format
const SYNC_PEER_KEY_V1 = (window.ODTAULAI_CONFIG && window.ODTAULAI_CONFIG.STORAGE_KEYS && window.ODTAULAI_CONFIG.STORAGE_KEYS.SYNC_PEER_V1) || 'stupind_peer_id';    // legacy — detected & migrated
const SYNC_ROOM_KEY    = (window.ODTAULAI_CONFIG && window.ODTAULAI_CONFIG.STORAGE_KEYS && window.ODTAULAI_CONFIG.STORAGE_KEYS.SYNC_ROOM) || 'stupind_sync_room';
const SYNC_VERSION     = 1;
const CODE_ALPHABET    = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Crockford-ish, no 0/O/1/I

let _peer        = null;   // PeerJS instance
let _conn        = null;   // active DataConnection
let _syncEnabled = false;
let _syncStatus  = 'off';  // 'off' | 'waiting' | 'connected' | 'error'
let _myRoomCode  = null;
let _lastSyncAt  = null;
let _connectTimeoutId = null;
let _pendingInboundConn = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

function _clampSyncTs(ts){
  let n = typeof ts === 'number' ? ts : NaN;
  if(!Number.isFinite(n) && ts != null){
    const p = Date.parse(String(ts));
    n = Number.isFinite(p) ? p : NaN;
  }
  if(!Number.isFinite(n)) return 0;
  const now = Date.now();
  if(n > now + 300000) return now;
  return n;
}

function _genCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code.slice(0,3) + '-' + code.slice(3); // e.g. "AB3-C9D"
}

function _genPeerId() {
  // 6 random chars → stable peer id. No "stu" baked in.
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return 'stupind-' + s.toLowerCase();
}

function _setSyncStatus(status, msg) {
  _syncStatus = status;
  const el = document.getElementById('syncStatus');
  const dot = document.getElementById('syncDot');
  if (!el) return;
  const labels = {
    off:       '○ Sync off',
    loading:   '◌ Loading…',
    waiting:   '◌ Waiting for peer…',
    connecting:'◌ Connecting…',
    connected: '● Synced',
    error:     '✕ ' + (msg || 'Error'),
  };
  el.textContent = labels[status] || status;
  if (dot) dot.className = 'sync-dot sync-dot--' + status;
}

/** Normalize input: uppercase, strip whitespace/dashes, tolerate legacy "STU…" prefix. */
function _normalizeCode(code) {
  const raw = String(code || '').toUpperCase().replace(/[\s-]/g, '');
  // Legacy codes were displayed as "STU-STU-XXXXXX" — 9 letters after stripping
  // dashes and starting with "STU". Drop the accidental STU prefix so we land on
  // the actual 6-char id suffix.
  if (raw.length === 9 && raw.startsWith('STU')) return raw.slice(3);
  return raw;
}

function _codeToId(code) {
  const suffix = _normalizeCode(code);
  return 'stupind-' + suffix.toLowerCase();
}

function _idToCode(id) {
  const raw = String(id || '').replace(/^stupind-/, '').toUpperCase();
  // Display legacy 9-char ids (starting with STU) as clean "STU-XXX-XXX" too —
  // the embedded STU is branding noise, not an address component.
  const suffix = (raw.length === 9 && raw.startsWith('STU')) ? raw.slice(3) : raw;
  if (suffix.length === 6) return 'STU-' + suffix.slice(0,3) + '-' + suffix.slice(3);
  // Any other length: best-effort symmetric split (shouldn't happen post-migration)
  const half = Math.ceil(suffix.length / 2);
  return 'STU-' + suffix.slice(0, half) + '-' + suffix.slice(half);
}

/** True if the code parses to a 6-char suffix (the only shape we should ever accept). */
function _isValidCode(code) {
  const n = _normalizeCode(code);
  return n.length === 6 && [...n].every(c => CODE_ALPHABET.includes(c));
}

/** True if the stored peer id is a legacy "stupind-stuXXXXXX" entry (double-STU bug). */
function _isLegacyPeerId(id) {
  if (!id) return false;
  const suffix = id.replace(/^stupind-/, '').toLowerCase();
  return suffix.length === 9 && suffix.startsWith('stu');
}

// ── PeerJS loader (CDN, lazy) ────────────────────────────────────────────────

function _loadPeerJS() {
  return new Promise((res, rej) => {
    if (window.Peer) return res(window.Peer);
    // Try local bundled copy first (works offline after install), CDN as last resort
    const tryLoad = (src, onFail) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload  = () => res(window.Peer);
      s.onerror = onFail;
      document.head.appendChild(s);
    };
    tryLoad('./js/vendor/peerjs.min.js', () => {
      tryLoad('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
        () => rej(new Error('Failed to load PeerJS from local and CDN')));
    });
  });
}

// ── State packaging ──────────────────────────────────────────────────────────

function _packState() {
  // Package current live state for transmission
  return {
    syncV:    SYNC_VERSION,
    sentAt:   Date.now(),
    tasks,    taskIdCtr,
    lists,    listIdCtr,   activeListId,
    goals,    goalIdCtr,
    timeLog,
    totalPomos, totalBreaks, totalFocusSec,
    sessionHistory,
    intervals, intIdCtr,
    cfg,
    theme,
    syncTaskDels, syncListDels, syncGoalDels,
    stateEpoch,
    pomosInCycle, phase, logIdCtr,
  };
}

function _mergeDelMapPair(local, remote) {
  const o = { ...(local || {}) };
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return o;
  for (const [k, v] of Object.entries(remote)) {
    const id = parseInt(k, 10);
    if (!Number.isFinite(id)) continue;
    const rv = _clampSyncTs(v);
    if (o[id] == null) o[id] = rv;
    else o[id] = Math.max(_clampSyncTs(o[id]), rv);
  }
  return o;
}

function _listOrGoalLM(x) {
  if (!x) return 0;
  if (typeof x.lastModified === 'number' && x.lastModified > 0) return _clampSyncTs(x.lastModified);
  return 0;
}

const _SYNC_MAX_MSG_CHARS = 2_500_000;
const _SYNC_MAX_TASKS = 100_000;
const _SYNC_MAX_LISTS = 20_000;
const _SYNC_MAX_GOALS = 50_000;
const _SYNC_MAX_SH_MERGE = 500;

function _syncIncomingPayloadInvalid(remote) {
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return true;
  let n = 0;
  try { n = JSON.stringify(remote).length; } catch (e) { return true; }
  if (n > _SYNC_MAX_MSG_CHARS) return true;
  if (remote.syncV != null && remote.syncV !== SYNC_VERSION) return true;
  if (Array.isArray(remote.tasks) && remote.tasks.length > _SYNC_MAX_TASKS) return true;
  if (Array.isArray(remote.lists) && remote.lists.length > _SYNC_MAX_LISTS) return true;
  if (Array.isArray(remote.goals) && remote.goals.length > _SYNC_MAX_GOALS) return true;
  return false;
}

function _syncMergeTimeLogsById(a, b) {
  const m = new Map();
  for (const l of a || []) { if (l && l.id != null) m.set(l.id, l); }
  for (const l of b || []) { if (l && l.id != null) m.set(l.id, l); }
  return Array.from(m.values());
}

function _syncMergeIntervalsById(a, b) {
  const m = new Map();
  for (const x of a || []) { if (x && x.id != null) m.set(x.id, x); }
  for (const x of b || []) { if (x && x.id != null) m.set(x.id, x); }
  return Array.from(m.values());
}

function _syncMergeSessionHist(a, b) {
  const out = [...(a || []), ...(b || [])];
  return out.length > _SYNC_MAX_SH_MERGE ? out.slice(-_SYNC_MAX_SH_MERGE) : out;
}

function _mergeState(remote) {
  try {
    if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return;
    if (_syncIncomingPayloadInvalid(remote)) {
      console.warn('[sync] rejected oversized or invalid sync payload');
      return;
    }

  const repair = (typeof _repairTask === 'function') ? _repairTask : (t=>t);

  let mergedTaskDels = _mergeDelMapPair(
    (typeof syncTaskDels === 'object' && syncTaskDels) ? syncTaskDels : {},
    remote.syncTaskDels
  );
  let mergedListDels = _mergeDelMapPair(
    (typeof syncListDels === 'object' && syncListDels) ? syncListDels : {},
    remote.syncListDels
  );
  let mergedGoalDels = _mergeDelMapPair(
    (typeof syncGoalDels === 'object' && syncGoalDels) ? syncGoalDels : {},
    remote.syncGoalDels
  );

  const repairedRemoteTasks = (remote.tasks || []).map(repair).filter(Boolean);
  const localMap = new Map(tasks.map(t => [t.id, t]));

  for (const [id, t] of [...localMap.entries()]) {
    const d = mergedTaskDels[id];
    if (d == null) continue;
    const tLM = _clampSyncTs(t.lastModified || t.completedAt || 0);
    if (_clampSyncTs(d) > tLM) localMap.delete(id);
  }

  for (const rt of repairedRemoteTasks) {
    if (!rt) continue;
    const delT = mergedTaskDels[rt.id];
    const rLM = _clampSyncTs(rt.lastModified || rt.completedAt || 0);
    if (delT != null && _clampSyncTs(delT) > rLM) continue;

    const lt = localMap.get(rt.id);
    if (!lt) {
      localMap.set(rt.id, rt);
    } else {
      const lLM = _clampSyncTs(lt.lastModified || lt.completedAt || 0);
      if (rLM > lLM) localMap.set(rt.id, rt);
    }
  }
  for (const t of localMap.values()) {
    if (mergedTaskDels[t.id] != null) {
      const tLM = _clampSyncTs(t.lastModified || t.completedAt || 0);
      if (tLM > _clampSyncTs(mergedTaskDels[t.id])) delete mergedTaskDels[t.id];
    }
  }
  syncTaskDels = mergedTaskDels;

  tasks = Array.from(localMap.values());
  taskIdCtr = Math.max(taskIdCtr, remote.taskIdCtr || 0);
  if (typeof rebuildTaskIdIndex === 'function') rebuildTaskIdIndex();
  if (typeof repairOrphanedTaskParents === 'function') repairOrphanedTaskParents();

  const listMap = new Map(lists.map(l => [l.id, l]));
  for (const rl of (remote.lists || [])) {
    if (!rl || rl.id == null) continue;
    if (mergedListDels[rl.id] != null && _clampSyncTs(mergedListDels[rl.id]) > _listOrGoalLM(rl)) continue;
    const ex = listMap.get(rl.id);
    if (!ex) listMap.set(rl.id, rl);
    else if (_listOrGoalLM(rl) > _listOrGoalLM(ex)) listMap.set(rl.id, rl);
  }
  for (const [id, l] of [...listMap.entries()]) {
    if (mergedListDels[id] != null && _clampSyncTs(mergedListDels[id]) > _listOrGoalLM(l)) listMap.delete(id);
  }
  lists = Array.from(listMap.values());
  listIdCtr = Math.max(listIdCtr, remote.listIdCtr || 0);
  syncListDels = mergedListDels;

  const goalMap = new Map(goals.map(g => [g.id, g]));
  for (const rg of (remote.goals || [])) {
    if (!rg || rg.id == null) continue;
    if (mergedGoalDels[rg.id] != null && _clampSyncTs(mergedGoalDels[rg.id]) > _listOrGoalLM(rg)) continue;
    const ex = goalMap.get(rg.id);
    if (!ex) goalMap.set(rg.id, rg);
    else if (_listOrGoalLM(rg) > _listOrGoalLM(ex)) goalMap.set(rg.id, rg);
  }
  for (const [id, g] of [...goalMap.entries()]) {
    if (mergedGoalDels[id] != null && _clampSyncTs(mergedGoalDels[id]) > _listOrGoalLM(g)) goalMap.delete(id);
  }
  goals = Array.from(goalMap.values());
  goalIdCtr = Math.max(goalIdCtr, remote.goalIdCtr || 0);
  syncGoalDels = mergedGoalDels;

  const re = _clampSyncTs(
    remote.stateEpoch != null
      ? remote.stateEpoch
      : (typeof remote.sentAt === 'number' ? remote.sentAt : 0)
  );
  const le = _clampSyncTs(typeof stateEpoch !== 'undefined' ? stateEpoch : 0);
  if (re > le) {
    if (Array.isArray(remote.timeLog)) timeLog = remote.timeLog;
    if (Array.isArray(remote.sessionHistory)) sessionHistory = remote.sessionHistory;
    if (Array.isArray(remote.intervals)) intervals = remote.intervals;
    if (remote.totalPomos != null) totalPomos = Math.max(0, parseInt(remote.totalPomos, 10) || 0);
    if (remote.totalBreaks != null) totalBreaks = Math.max(0, parseInt(remote.totalBreaks, 10) || 0);
    if (remote.totalFocusSec != null) totalFocusSec = Math.max(0, parseInt(remote.totalFocusSec, 10) || 0);
    if (remote.intIdCtr != null) intIdCtr = Math.max(0, parseInt(remote.intIdCtr, 10) || 0);
    if (remote.logIdCtr != null) logIdCtr = Math.max(0, parseInt(remote.logIdCtr, 10) || 0);
    if (remote.pomosInCycle != null) pomosInCycle = Math.max(0, parseInt(remote.pomosInCycle, 10) || 0);
    if (remote.phase && ['work', 'short', 'long'].includes(remote.phase)) phase = remote.phase;
    if (remote.cfg && typeof remote.cfg === 'object') cfg = remote.cfg;
    if (remote.theme && ['dark', 'light'].includes(remote.theme)) theme = remote.theme;
  } else if (re === le && re > 0) {
    if (Array.isArray(remote.timeLog)) timeLog = _syncMergeTimeLogsById(timeLog, remote.timeLog);
    if (Array.isArray(remote.sessionHistory)) sessionHistory = _syncMergeSessionHist(sessionHistory, remote.sessionHistory);
    if (Array.isArray(remote.intervals)) intervals = _syncMergeIntervalsById(intervals, remote.intervals);
    if (remote.totalPomos != null) totalPomos = Math.max(totalPomos, Math.max(0, parseInt(remote.totalPomos, 10) || 0));
    if (remote.totalBreaks != null) totalBreaks = Math.max(totalBreaks, Math.max(0, parseInt(remote.totalBreaks, 10) || 0));
    if (remote.totalFocusSec != null) totalFocusSec = Math.max(totalFocusSec, Math.max(0, parseInt(remote.totalFocusSec, 10) || 0));
    if (remote.intIdCtr != null) intIdCtr = Math.max(intIdCtr, Math.max(0, parseInt(remote.intIdCtr, 10) || 0));
    if (remote.logIdCtr != null) logIdCtr = Math.max(logIdCtr, Math.max(0, parseInt(remote.logIdCtr, 10) || 0));
    if (remote.pomosInCycle != null) pomosInCycle = Math.max(pomosInCycle, Math.max(0, parseInt(remote.pomosInCycle, 10) || 0));
  }
  } catch (e) {
    console.warn('[sync] mergeState failed', e);
  }

  _lastSyncAt = Date.now();
  saveState('auto');
  if (typeof renderAll === 'function') renderAll();
}

// ── Connection handling ──────────────────────────────────────────────────────

function syncHideIncomingBanner(){
  const b = document.getElementById('syncIncomingBar');
  if(b) b.remove();
}

function syncShowIncomingBanner(peerLabel){
  syncHideIncomingBanner();
  const bar = document.createElement('div');
  bar.id = 'syncIncomingBar';
  bar.className = 'sync-incoming-bar';
  const safePeer = (typeof esc === 'function') ? esc(String(peerLabel || 'unknown')) : String(peerLabel || 'unknown');
  bar.innerHTML = '<div class="sync-incoming-inner"><strong>Incoming sync</strong> from <code>'+safePeer+'</code> — accept only if this is your device.</div>'
    +'<div class="sync-incoming-actions">'
    +'<button type="button" class="btn-primary btn-sm" id="syncAcceptInbound">Accept</button>'
    +'<button type="button" class="btn-ghost btn-sm" id="syncRejectInbound">Reject</button></div>';
  document.body.appendChild(bar);
  document.getElementById('syncAcceptInbound').onclick = () => syncAcceptInbound();
  document.getElementById('syncRejectInbound').onclick = () => syncRejectInbound();
}

function syncAcceptInbound(){
  const conn = _pendingInboundConn;
  if(!conn) return;
  _pendingInboundConn = null;
  syncHideIncomingBanner();
  if(_conn){ try{ _conn.close(); }catch(e){} _conn = null; }
  _wireConn(conn);
}

function syncRejectInbound(){
  const conn = _pendingInboundConn;
  _pendingInboundConn = null;
  syncHideIncomingBanner();
  if(conn){ try{ conn.close(); }catch(e){} }
}

function _wireConn(conn) {
  _conn = conn;

  conn.on('open', () => {
    _setSyncStatus('connected');
    // Exchange state on connect
    try { conn.send({ type: 'state', payload: _packState() }); } catch(e) { console.warn('[Sync] send state', e); }
    // Persist the room code we connected to
    try { localStorage.setItem(SYNC_ROOM_KEY, _idToCode(conn.peer)); } catch(e) { /* LS fire-and-forget */ }
  });

  conn.on('data', (msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'state') {
      _mergeState(msg.payload);
    } else if (msg.type === 'patch') {
      _mergeState(msg.payload);
    } else if (msg.type === 'ping') {
      try { conn.send({ type: 'pong' }); } catch(e) { console.warn('[Sync] send pong', e); }
    }
  });

  conn.on('close', () => {
    _conn = null;
    // Don't stomp on a more-specific error message (e.g. "Code not found")
    // that we just set from _peer.on('error', 'peer-unavailable').
    if (_syncStatus !== 'error') _setSyncStatus('waiting');
  });

  conn.on('error', (err) => {
    console.warn('[sync] conn error', err);
    _conn = null;
    if (_connectTimeoutId) { clearTimeout(_connectTimeoutId); _connectTimeoutId = null; }
    _setSyncStatus('error', (err && (err.type || err.message)) || 'Connection failed');
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve our stable peer id. Migrates the legacy double-STU form
 * (`stupind-stuXXXXXX`) to a fresh clean 6-char id, and clears any stored
 * room code (the pairing relationship is no longer reachable from this side
 * once our id rotates — re-pair by typing the other device's new code).
 */
function _resolvePeerId() {
  let saved = null;
  try { saved = localStorage.getItem(SYNC_PEER_KEY); } catch(e) {}

  if (!saved) {
    // One-time migration: pull v1 id, check if it's the buggy double-STU form,
    // and if so mint a new one. Otherwise keep the v1 id — it was valid.
    let legacy = null;
    try { legacy = localStorage.getItem(SYNC_PEER_KEY_V1); } catch(e) {}
    if (legacy && !_isLegacyPeerId(legacy)) {
      saved = legacy;
    } else if (legacy && _isLegacyPeerId(legacy)) {
      saved = _genPeerId();
      // Legacy pairing partner references the old id, so forget the room.
      try { localStorage.removeItem(SYNC_ROOM_KEY); } catch(e) {}
      console.info('[sync] migrated legacy peer id — re-pair required');
    } else {
      saved = _genPeerId();
    }
    try { localStorage.setItem(SYNC_PEER_KEY, saved); } catch(e) {}
  }
  return saved;
}

async function syncInit() {
  if (_peer) return;
  _setSyncStatus('loading');

  let Peer;
  try { Peer = await _loadPeerJS(); }
  catch(e) { _setSyncStatus('error', 'PeerJS unavailable'); return; }

  const myId = _resolvePeerId();
  _myRoomCode = _idToCode(myId);

  const codeEl = document.getElementById('syncMyCode');
  if (codeEl) codeEl.textContent = _myRoomCode;

  _peer = new Peer(myId, {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ]
    }
  });

  _peer.on('open', () => {
    _setSyncStatus('waiting');
    // Auto-reconnect to last room if we have one
    const lastRoom = localStorage.getItem(SYNC_ROOM_KEY);
    if (lastRoom && lastRoom !== _myRoomCode) {
      syncConnect(lastRoom);
    }
  });

  _peer.on('connection', (conn) => {
    if(!_syncEnabled){ try{ conn.close(); }catch(e){} return; }
    if(_conn && _conn.open){ try{ conn.close(); }catch(e){} return; }
    if(_pendingInboundConn){ try{ conn.close(); }catch(e){} return; }
    _pendingInboundConn = conn;
    conn.on('close', () => {
      if(_pendingInboundConn === conn){
        _pendingInboundConn = null;
        syncHideIncomingBanner();
      }
    });
    conn.on('error', () => {
      if(_pendingInboundConn === conn){
        _pendingInboundConn = null;
        syncHideIncomingBanner();
      }
    });
    syncShowIncomingBanner(_idToCode(conn.peer));
  });

  _peer.on('error', (err) => {
    console.warn('[sync] peer error', err);
    const t = err && err.type;
    if (t === 'unavailable-id') {
      // Our own id is already registered — mint a new one.
      try { localStorage.removeItem(SYNC_PEER_KEY); } catch(e) {}
      _peer = null;
      syncInit();
      return;
    }
    if (t === 'peer-unavailable') {
      // Target we were trying to connect to doesn't exist on the broker.
      // Cancel the connect timeout and show a clean specific message.
      if (_connectTimeoutId) { clearTimeout(_connectTimeoutId); _connectTimeoutId = null; }
      _setSyncStatus('error', 'Code not found — device is offline or the code is mistyped');
      return;
    }
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') {
      _setSyncStatus('error', 'Lost connection to matchmaking server — check internet');
      return;
    }
    if (t === 'browser-incompatible') {
      _setSyncStatus('error', 'Browser does not support WebRTC data channels');
      return;
    }
    _setSyncStatus('error', t || (err && err.message) || 'Peer error');
  });

  _peer.on('disconnected', () => {
    _setSyncStatus('waiting');
    try { _peer.reconnect(); } catch(e) { console.warn('[Sync] reconnect', e); }
  });
}

function syncConnect(code) {
  if (!_peer) { syncInit().then(() => syncConnect(code)).catch(e => console.warn('[Sync] init failed', e)); return; }
  if (!_isValidCode(code)) {
    _setSyncStatus('error', 'Invalid code — expected 6 letters/digits after STU-');
    return;
  }
  const targetId = _codeToId(code);
  if (targetId === _peer.id) {
    _setSyncStatus('error', "That's this device's own code");
    return;
  }
  _setSyncStatus('connecting');

  // If we have a stale dead connection, drop it before making a new one.
  if (_conn) { try { _conn.close(); } catch(e) {} _conn = null; }

  const conn = _peer.connect(targetId, { reliable: true });

  // Two failure modes:
  //   (a) Target isn't registered on broker → _peer.on('error') fires
  //       `peer-unavailable` within ~1s (handled above; clears this timeout).
  //   (b) Target is registered but NAT traversal fails → no error ever fires,
  //       the data channel just never opens. 20s is generous for ICE gathering
  //       but still snappy enough to be usable feedback.
  if (_connectTimeoutId) clearTimeout(_connectTimeoutId);
  _connectTimeoutId = setTimeout(() => {
    _connectTimeoutId = null;
    if (conn && !conn.open) {
      try { conn.close(); } catch(e) {}
      _setSyncStatus('error',
        'No response — the other device may be on a different network ' +
        '(cellular or restrictive firewall can block peer-to-peer). ' +
        'Try again on the same WiFi network.');
    }
  }, 20000);

  conn.on('open', () => {
    if (_connectTimeoutId) { clearTimeout(_connectTimeoutId); _connectTimeoutId = null; }
  });
  conn.on('error', () => {
    if (_connectTimeoutId) { clearTimeout(_connectTimeoutId); _connectTimeoutId = null; }
  });

  _wireConn(conn);
}

/** Mint a fresh peer id (escape hatch if pairing is stuck on a bad code). */
function syncRegenerateCode() {
  try { localStorage.removeItem(SYNC_PEER_KEY); } catch(e) {}
  try { localStorage.removeItem(SYNC_ROOM_KEY); } catch(e) {}
  if (_conn) { try { _conn.close(); } catch(e) {} _conn = null; }
  if (_peer) { try { _peer.destroy(); } catch(e) {} _peer = null; }
  _setSyncStatus('loading');
  syncInit().then(() => renderSyncPanel()).catch(e => console.warn('[Sync] init failed', e));
}

function syncDisconnect() {
  if (_connectTimeoutId) { clearTimeout(_connectTimeoutId); _connectTimeoutId = null; }
  if (_conn) { try { _conn.close(); } catch(e) { console.warn('[Sync] conn close', e); } _conn = null; }
  if (_peer) { try { _peer.destroy(); } catch(e) { console.warn('[Sync] peer destroy', e); } _peer = null; }
  try { localStorage.removeItem(SYNC_ROOM_KEY); } catch(e) { /* LS fire-and-forget */ }
  _setSyncStatus('off');
  _syncEnabled = false;
  renderSyncPanel();
}

// Graceful cleanup on tab close — tells PeerJS server to release our ID
window.addEventListener('beforeunload', () => {
  if (_conn) { try { _conn.close(); } catch(e) {} }
  if (_peer) { try { _peer.destroy(); } catch(e) {} }
});

// Called from saveState() — broadcast patch to connected peer (throttled)
let _broadcastTimer = null;
let _lastBroadcastAt = 0;
function syncBroadcast() {
  if (!_conn || !_conn.open) return;
  // Throttle: max 1 broadcast per 500ms to avoid flooding on rapid saves
  const now = Date.now();
  if (now - _lastBroadcastAt < 500) {
    clearTimeout(_broadcastTimer);
    _broadcastTimer = setTimeout(() => {
      _lastBroadcastAt = Date.now();
      _broadcastTimer = null;
      try { _conn.send({ type: 'patch', payload: _packState() }); } catch(e) { console.warn('[Sync] broadcast', e); }
    }, 500);
    return;
  }
  _lastBroadcastAt = now;
  try { _conn.send({ type: 'patch', payload: _packState() }); } catch(e) { console.warn('[Sync] broadcast', e); }
}

// ── UI ───────────────────────────────────────────────────────────────────────

function renderSyncPanel() {
  const panel = document.getElementById('syncPanel');
  if (!panel) return;

  if (!_syncEnabled) {
    panel.innerHTML = `
      <div class="sync-off-state">
        <p class="sync-desc">Sync tasks between your devices directly — no server stores your data.</p>
        <p class="sync-desc">
          ℹ Best effort: works reliably on same WiFi; may fail on some cellular networks due to NAT restrictions.
        </p>
        <button class="btn-primary" data-action="syncEnable">Enable Sync</button>
      </div>`;
    return;
  }

  panel.innerHTML = `
    <div class="sync-active">
      <div class="sync-status-row">
        <span class="sync-dot sync-dot--${_syncStatus}" id="syncDot"></span>
        <span id="syncStatus"></span>
      </div>
      <div class="sync-my-code-block">
        <label>Your code</label>
        <div class="sync-code" id="syncMyCode">${_myRoomCode || '…'}</div>
        <div class="sync-code-actions">
          <button class="btn-ghost btn-sm" data-action="syncCopyMyCode">Copy</button>
          <button class="btn-ghost btn-sm" data-action="syncRegenerateCode" title="Mint a new pairing code (unpairs this device)">Regenerate</button>
        </div>
      </div>
      <div class="sync-connect-block">
        <label>Connect to device</label>
        <div class="sync-input-row">
          <input id="syncCodeInput" type="text" placeholder="STU-XXX-XXX" maxlength="11"
                 autocomplete="off" autocapitalize="characters" spellcheck="false"
                 data-oninput="syncOnCodeInputFromInput"
                 data-onkeydown="syncConnectInputKey">
          <button class="btn-primary btn-sm" id="syncConnectBtn" data-action="syncConnectFromInput" disabled>Connect</button>
        </div>
        <div class="sync-input-hint" id="syncInputHint">Enter the 6-character code shown on the other device (e.g. <code>STU-AB3-C9D</code>).</div>
      </div>
      <button class="btn-ghost btn-sm sync-disable" data-action="syncDisconnect">Disable sync</button>
    </div>`;

  _setSyncStatus(_syncStatus);
}

/** Live validation + auto-format while typing a pairing code. */
function syncOnCodeInput(el) {
  if (!el) return;
  // Strip anything that isn't a code letter or a dash, uppercase as we go.
  let raw = String(el.value || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  // Collapse multiple dashes and trim leading/trailing
  raw = raw.replace(/-+/g, '-').replace(/^-|-$/g, '');
  el.value = raw;
  const btn = document.getElementById('syncConnectBtn');
  const hint = document.getElementById('syncInputHint');
  const ok = _isValidCode(raw);
  if (btn) btn.disabled = !ok;
  if (hint) {
    if (!raw) {
      hint.textContent = 'Enter the 6-character code shown on the other device (e.g. STU-AB3-C9D).';
      hint.classList.remove('sync-input-hint--err');
    } else if (!ok) {
      const n = _normalizeCode(raw).length;
      hint.textContent = n < 6
        ? `Keep typing — ${n}/6 characters so far.`
        : 'Too long — pairing codes are 6 letters/digits after STU-.';
      hint.classList.add('sync-input-hint--err');
    } else {
      hint.textContent = 'Ready — press Connect.';
      hint.classList.remove('sync-input-hint--err');
    }
  }
}

function syncEnable() {
  _syncEnabled = true;
  renderSyncPanel();
  syncInit();
}

function syncConnectFromInput() {
  const val = (document.getElementById('syncCodeInput')?.value || '').trim();
  if (!_isValidCode(val)) {
    _setSyncStatus('error', 'Invalid code — expected 6 letters/digits after STU-');
    return;
  }
  syncConnect(val);
}
