// ========== P2P SYNC (WebRTC via PeerJS) ==========
// Devices sync directly — no server sees your data.
// PeerJS cloud only handles the initial handshake (SDP/ICE exchange).
// After that, data flows device-to-device via RTCDataChannel.

const SYNC_PEER_KEY = 'stupind_peer_id';
const SYNC_ROOM_KEY = 'stupind_sync_room';
const SYNC_VERSION  = 1;

let _peer        = null;   // PeerJS instance
let _conn        = null;   // active DataConnection
let _syncEnabled = false;
let _syncStatus  = 'off';  // 'off' | 'waiting' | 'connected' | 'error'
let _myRoomCode  = null;
let _lastSyncAt  = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

function _genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return 'STU-' + code.slice(0,3) + '-' + code.slice(3);
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

function _codeToId(code) {
  return 'stupind-' + code.replace(/-/g, '').toLowerCase();
}

function _idToCode(id) {
  const raw = id.replace('stupind-', '').toUpperCase();
  return 'STU-' + raw.slice(0,3) + '-' + raw.slice(3);
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
  };
}

function _mergeState(remote) {
  // Defensive: run incoming tasks through the repair function if available.
  // Handles cross-version sync (device on v4 → device on v5) without breaking.
  const repair = (typeof _repairTask === 'function') ? _repairTask : (t=>t);
  const repairedRemoteTasks = (remote.tasks || []).map(repair).filter(Boolean);

  // Merge tasks: last-write-wins using lastModified if present,
  // falling back to completedAt, falling back to "keep local"
  const localMap = new Map(tasks.map(t => [t.id, t]));
  for (const rt of repairedRemoteTasks) {
    const lt = localMap.get(rt.id);
    if (!lt) {
      localMap.set(rt.id, rt);
    } else {
      const lLM = lt.lastModified || lt.completedAt || 0;
      const rLM = rt.lastModified || rt.completedAt || 0;
      // Only overwrite if remote is strictly newer (tie goes to local)
      if (rLM > lLM) localMap.set(rt.id, rt);
    }
  }
  tasks = Array.from(localMap.values());
  taskIdCtr = Math.max(taskIdCtr, remote.taskIdCtr || 0);

  // Lists: merge by id (no conflict resolution needed — lists rarely change)
  const listMap = new Map(lists.map(l => [l.id, l]));
  for (const rl of (remote.lists || [])) {
    if (!listMap.has(rl.id)) listMap.set(rl.id, rl);
  }
  lists = Array.from(listMap.values());
  listIdCtr = Math.max(listIdCtr, remote.listIdCtr || 0);

  // Goals: merge by id
  const goalMap = new Map(goals.map(g => [g.id, g]));
  for (const rg of (remote.goals || [])) {
    if (!goalMap.has(rg.id)) goalMap.set(rg.id, rg);
  }
  goals = Array.from(goalMap.values());
  goalIdCtr = Math.max(goalIdCtr, remote.goalIdCtr || 0);

  _lastSyncAt = Date.now();
  saveState();
  if (typeof renderAll === 'function') renderAll();
}

// ── Connection handling ──────────────────────────────────────────────────────

function _wireConn(conn) {
  _conn = conn;

  conn.on('open', () => {
    _setSyncStatus('connected');
    // Exchange state on connect
    try { conn.send({ type: 'state', payload: _packState() }); } catch(e) {}
    // Persist the room code we connected to
    try { localStorage.setItem(SYNC_ROOM_KEY, _idToCode(conn.peer)); } catch(e) {}
  });

  conn.on('data', (msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'state') {
      _mergeState(msg.payload);
    } else if (msg.type === 'patch') {
      _mergeState(msg.payload);
    } else if (msg.type === 'ping') {
      try { conn.send({ type: 'pong' }); } catch(e) {}
    }
  });

  conn.on('close', () => {
    _conn = null;
    _setSyncStatus('waiting');
  });

  conn.on('error', (err) => {
    console.warn('[sync] conn error', err);
    _conn = null;
    _setSyncStatus('error', err.type || 'Connection failed');
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

async function syncInit() {
  if (_peer) return;
  _setSyncStatus('loading');

  let Peer;
  try { Peer = await _loadPeerJS(); }
  catch(e) { _setSyncStatus('error', 'PeerJS unavailable'); return; }

  // Reuse stable peer ID derived from stored room code, or generate new
  let myId;
  try {
    const saved = localStorage.getItem(SYNC_PEER_KEY);
    myId = saved || ('stupind-' + _genCode().replace(/-/g,'').toLowerCase());
    localStorage.setItem(SYNC_PEER_KEY, myId);
  } catch(e) { myId = 'stupind-' + _genCode().replace(/-/g,'').toLowerCase(); }

  _myRoomCode = _idToCode(myId);

  const codeEl = document.getElementById('syncMyCode');
  if (codeEl) codeEl.textContent = _myRoomCode;

  _peer = new Peer(myId, {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
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
    // Incoming connection from peer
    _wireConn(conn);
  });

  _peer.on('error', (err) => {
    console.warn('[sync] peer error', err);
    if (err.type === 'unavailable-id') {
      // ID taken — generate new one
      localStorage.removeItem(SYNC_PEER_KEY);
      _peer = null;
      syncInit();
    } else {
      _setSyncStatus('error', err.type || 'Peer error');
    }
  });

  _peer.on('disconnected', () => {
    _setSyncStatus('waiting');
    _peer.reconnect();
  });
}

function syncConnect(code) {
  if (!_peer) { syncInit().then(() => syncConnect(code)); return; }
  const targetId = _codeToId(code.trim().toUpperCase());
  if (targetId === _peer.id) return; // can't connect to self
  _setSyncStatus('connecting');
  const conn = _peer.connect(targetId, { reliable: true });

  // Timeout guard: if connection doesn't open in 15s, most likely cause is
  // NAT traversal failure (symmetric NAT on cellular, aggressive firewall,
  // target device offline, or wrong code). Show specific message.
  const timeoutId = setTimeout(() => {
    if (conn && !conn.open) {
      try { conn.close(); } catch(e) {}
      _setSyncStatus('error',
        'Could not connect. Common causes: the other device is offline, ' +
        'the code is wrong, or one device is on a cellular network where ' +
        'peer-to-peer is blocked. Try again on the same WiFi network.');
    }
  }, 15000);

  // Clear timeout when connection opens or errors (handlers stack with _wireConn's)
  conn.on('open', () => clearTimeout(timeoutId));
  conn.on('error', () => clearTimeout(timeoutId));

  _wireConn(conn);
}

function syncDisconnect() {
  if (_conn) { try { _conn.close(); } catch(e) {} _conn = null; }
  if (_peer) { try { _peer.destroy(); } catch(e) {} _peer = null; }
  try { localStorage.removeItem(SYNC_ROOM_KEY); } catch(e) {}
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
      try { _conn.send({ type: 'patch', payload: _packState() }); } catch(e) {}
    }, 500);
    return;
  }
  _lastBroadcastAt = now;
  try { _conn.send({ type: 'patch', payload: _packState() }); } catch(e) {}
}

// ── UI ───────────────────────────────────────────────────────────────────────

function renderSyncPanel() {
  const panel = document.getElementById('syncPanel');
  if (!panel) return;

  if (!_syncEnabled) {
    panel.innerHTML = `
      <div class="sync-off-state">
        <p class="sync-desc">Sync tasks between your devices directly — no server stores your data.</p>
        <p class="sync-desc" style="font-size:10px;color:var(--text-4);margin-top:-4px">
          ℹ Best effort: works reliably on same WiFi; may fail on some cellular networks due to NAT restrictions.
        </p>
        <button class="btn-primary" onclick="syncEnable()">Enable Sync</button>
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
        <button class="btn-ghost btn-sm" onclick="navigator.clipboard?.writeText(document.getElementById('syncMyCode')?.textContent||'')">Copy</button>
      </div>
      <div class="sync-connect-block">
        <label>Connect to device</label>
        <div class="sync-input-row">
          <input id="syncCodeInput" type="text" placeholder="STU-XXX-XXX" maxlength="12"
                 oninput="this.value=this.value.toUpperCase()"
                 onkeydown="if(event.key==='Enter')syncConnectFromInput()">
          <button class="btn-primary btn-sm" onclick="syncConnectFromInput()">Connect</button>
        </div>
      </div>
      <button class="btn-ghost btn-sm sync-disable" onclick="syncDisconnect()">Disable sync</button>
    </div>`;

  _setSyncStatus(_syncStatus);
}

function syncEnable() {
  _syncEnabled = true;
  renderSyncPanel();
  syncInit();
}

function syncConnectFromInput() {
  const val = (document.getElementById('syncCodeInput')?.value || '').trim();
  if (val.length < 6) return;
  syncConnect(val);
}
