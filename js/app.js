// ── App version — see js/version.js (ODTAULAI_RELEASE) ─────────────────────
const R = window.ODTAULAI_RELEASE || {};
const APP_VERSION = R.version || 'v26';
const APP_BUILD_DATE = R.buildDate || '2026-04-21';

// ── Persistent storage — protects task data from "Clear browsing history" ──
// Chrome/Edge/Firefox: survives normal clears when granted
// Safari: still subject to 7-day inactivity purge unless PWA is installed
(async () => {
  if ('storage' in navigator && 'persist' in navigator.storage) {
    try {
      const already = await navigator.storage.persisted();
      if (!already) {
        const granted = await navigator.storage.persist();
        window._storagePersistent = granted;
      } else {
        window._storagePersistent = true;
      }
    } catch(e) { window._storagePersistent = false; }
  }
})();

// ── Storage quota monitoring — warn user when approaching limit ─────────────
async function checkStorageQuota(){
  if(!('storage' in navigator)||!navigator.storage.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    const usedMB = Math.round((est.usage||0)/1024/1024*10)/10;
    const quotaMB = Math.round((est.quota||0)/1024/1024);
    const pct = est.quota ? Math.round((est.usage/est.quota)*100) : 0;
    return { usedMB, quotaMB, pct, persistent: !!window._storagePersistent };
  } catch(e) { return null; }
}

// ── Online/offline status indicator ─────────────────────────────────────────
function updateOnlineStatus(){
  const el = document.getElementById('onlineStatus');
  if(!el) return;
  if(navigator.onLine){
    el.style.display = 'none';
  } else {
    el.style.display = '';
    el.textContent = '● Offline — tasks work, sync paused';
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
setTimeout(updateOnlineStatus, 500);

// ── Service worker update detection ──────────────────────────────────────────
// When a new version is deployed, notify user with an "Update available" banner
// instead of silently waiting for them to close all tabs.
if ('serviceWorker' in navigator && !window.location.protocol.startsWith('file')) {
  navigator.serviceWorker.ready.then(reg => {
    // Check for updates every 30 min while app is open
    setInterval(() => { try{ reg.update(); }catch(e){} }, 30 * 60 * 1000);

    // Listen for a new service worker waiting to take over
    const showUpdateBanner = () => {
      if(document.getElementById('updateBanner')) return; // already shown
      const banner = document.createElement('div');
      banner.id = 'updateBanner';
      banner.className = 'update-banner';
      const sparkIc = (window.icon && window.icon('sparkles', {size:14})) || '';
      banner.innerHTML = `
        <span class="update-banner-msg">${sparkIc}<span>New version available</span></span>
        <button onclick="applyUpdate()">Reload to update</button>
        <button onclick="dismissUpdate()" class="update-dismiss">Later</button>`;
      document.body.appendChild(banner);
    };
    window.applyUpdate = () => {
      // Flush any pending state before reload so user doesn't lose recent changes
      try { if(typeof saveState === 'function') saveState('unload'); } catch(e) {}
      if(reg.waiting) reg.waiting.postMessage({type:'SKIP_WAITING'});
      // Wait for controllerchange then reload
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if(!reloaded){ reloaded = true; location.reload(); }
      });
      // Safety net — force reload after 1.5s even if controllerchange misses
      setTimeout(() => { if(!reloaded){ reloaded = true; location.reload(); } }, 1500);
    };
    window.dismissUpdate = () => {
      const b = document.getElementById('updateBanner'); if(b) b.remove();
    };

    if(reg.waiting){ showUpdateBanner(); return; }
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if(!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if(newWorker.state === 'installed' && navigator.serviceWorker.controller){
          showUpdateBanner();
        }
      });
    });
  }).catch(() => {});
}

// ========== ARCHIVE ==========
function getArchives(){try{return JSON.parse(localStorage.getItem(ARCHIVE_KEY)||'[]')}catch(e){return[]}}

function renderArchive(){
  const archives=getArchives();
  const list=gid('archiveList');
  gid('archiveCount').textContent=archives.length+' day'+(archives.length!==1?'s':'');
  list.innerHTML='';
  if(!archives.length){list.innerHTML='<div class="iempty">History will appear here after each day</div>';return}
  // Most recent first
  archives.slice().reverse().forEach((a,idx)=>{
    const doneG=a.goals?a.goals.filter(g=>g.done).length:0;
    const totalG=a.goals?a.goals.length:0;
    const d=document.createElement('button');d.type='button';d.className='hist-day';d.setAttribute('aria-expanded','false');
    d.onclick=function(){this.classList.toggle('open');this.setAttribute('aria-expanded',this.classList.contains('open')?'true':'false')};
    d.innerHTML=`<div class="hist-day-hdr"><span class="hist-day-date">${prettyDate(a.date)}</span><div class="hist-day-stats"><div class="hist-day-stat"><span style="color:var(--work)">${a.totalPomos||0}</span> sessions</div><div class="hist-day-stat"><span style="color:var(--long)">${fmtShort(a.totalFocusSec||0)}</span></div>${totalG?`<div class="hist-day-stat"><span style="color:var(--short)">${doneG}/${totalG}</span> goals</div>`:''}</div></div>`
      +`<div class="hist-day-detail">`
      +(a.goals&&a.goals.length?`<div class="hist-day-section"><div class="hist-day-section-title">Goals</div>${a.goals.map(g=>`<div class="hist-goal">${g.done?'✓':'○'} ${esc(g.text)}${g.doneAt?' <span style="color:#2a3a4a">('+esc(String(g.doneAt))+')</span>':''}</div>`).join('')}</div>`:'')
      +(a.tasks&&a.tasks.length?`<div class="hist-day-section"><div class="hist-day-section-title">Tasks</div>${a.tasks.map(t=>`<div class="hist-task">${esc(t.name)}: ${fmtHMS(t.totalSec||0)} (${t.sessions||0} sessions)</div>`).join('')}</div>`:'')
      +(a.timeLog&&a.timeLog.length?`<div class="hist-day-section"><div class="hist-day-section-title">Session Log</div>${a.timeLog.slice().reverse().slice(0,20).map(l=>`<div class="hist-log">${esc(l.time)} — ${esc(l.name)} (${fmtShort(l.durSec)})</div>`).join('')}</div>`:'')
      +`</div>`;
    list.appendChild(d)
  })
}

async function clearArchive(){if(!(await showAppConfirm('Clear all past day history? This cannot be undone.')))return;localStorage.removeItem(ARCHIVE_KEY);renderArchive()}

function exportAllCSV(){
  const archives=getArchives();
  if(!archives.length){alert('No history to export');return}
  let csv='Date,Sessions,Focus Time (min),Breaks,Goals Done,Goals Total,Tasks\n';
  archives.forEach(a=>{
    const doneG=a.goals?a.goals.filter(g=>g.done).length:0;
    const totalG=a.goals?a.goals.length:0;
    const taskNames=(a.tasks||[]).map(t=>{
      let n=String(t.name||'').replace(/"/g,'""');
      if(/^[=+\-@\t\r]/.test(n)) n = "'" + n;
      return n;
    }).join('; ');
    csv+=`"${a.date}",${a.totalPomos||0},${Math.floor((a.totalFocusSec||0)/60)},${a.totalBreaks||0},${doneG},${totalG},"${taskNames}"\n`;
  });
  const blob=new Blob([csv],{type:'text/csv'});
  const el=document.createElement('a');el.href=URL.createObjectURL(blob);el.download='odtaulai-history.csv';el.click();URL.revokeObjectURL(el.href)
}

// ========== EXPORT ==========
function buildTaskTreeReport(bullet,parentId,depth){
  let out='';
  getTaskChildren(parentId).forEach(t=>{
    const indent=bullet.startsWith('-')?'  '.repeat(depth):'    '.repeat(depth);
    const own=getTaskElapsed(t),rolled=getRolledUpTime(t.id);
    const kids=hasChildren(t.id);
    const timeStr=kids?fmtHMS(rolled)+(own>0?' (own '+fmtShort(own)+')':''):fmtHMS(own);
    out+=indent+bullet+t.name+': '+timeStr+' ('+t.sessions+' session'+(t.sessions!==1?'s':'')+')'+'\n';
    out+=buildTaskTreeReport(bullet,t.id,depth+1);
  });
  return out;
}

function buildReport(format){
  // Human-readable daily report — txt or md. For data export, use exportTasksCSV/JSON instead.
  const date=dateStr();const fm=Math.floor(totalFocusSec/60);const focusStr=fm>=60?Math.floor(fm/60)+'h '+fm%60+'m':fm+'m';
  const doneGoals=goals.filter(g=>g.done),missedGoals=goals.filter(g=>!g.done);
  const goalPct=goals.length?Math.round((doneGoals.length/goals.length)*100):0;
  const isMd=format==='md';const hr=isMd?'---':'────────────────────────────────────────';const h1=s=>isMd?'# '+s:s;const h2=s=>isMd?'## '+s:'  '+s;const check=done=>isMd?(done?'- [x] ':'- [ ] '):(done?'  [✓] ':'  [ ] ');const bullet=isMd?'- ':'  • ';
  let r=h1('Daily Report — '+date)+'\n'+hr+'\n\n';
  r+=h2('Summary')+'\n'+bullet+'Sessions: '+totalPomos+'\n'+bullet+'Focus time: '+focusStr+'\n'+bullet+'Breaks: '+totalBreaks+'\n'+bullet+'Goals: '+doneGoals.length+'/'+goals.length+' ('+goalPct+'%)\n\n';
  if(goals.length){r+=h2('Goals')+'\n';doneGoals.forEach(g=>{r+=check(true)+g.text+(g.doneAt?' ('+g.doneAt+')':'')+'\n'});missedGoals.forEach(g=>{r+=check(false)+g.text+'\n'});r+='\n'}
  if(tasks.length){r+=h2('Time by Task')+'\n'+buildTaskTreeReport(bullet,null,0)+'\n'}
  if(timeLog.length){r+=h2('Session Log')+'\n';timeLog.slice().reverse().forEach(l=>{r+=bullet+l.time+' | '+(l.type==='work'?'FOCUS':l.type==='short'?'SHORT BREAK':l.type==='quick'?'QUICK':'LONG BREAK')+' | '+l.name+' | '+fmtShort(l.durSec)+'\n'});r+='\n'}
  r+=hr+'\nGenerated at '+timeNow()+' by ODTAULAI\n';return r
}
function exportFile(format){
  // Daily report only supports txt/md now; csv is routed to the unified task CSV
  if(format==='csv'){ return exportTasksCSV(); }
  const content=buildReport(format);
  const ext=format==='md'?'md':'txt';
  const blob=new Blob([content],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='odtaulai-'+todayKey()+'.'+ext;a.click();URL.revokeObjectURL(a.href);
}
function exportClipboard(){const content=buildReport('txt');navigator.clipboard.writeText(content).then(()=>{const btn=gid('exportClipBtn')||document.querySelector('.export-clip');if(!btn)return;const orig=btn.textContent;btn.textContent='Copied!';btn.style.color='#2ecc71';btn.style.borderColor='#1a4a2a';setTimeout(()=>{btn.textContent=orig;btn.style.color='';btn.style.borderColor=''},1500)}).catch(()=>{const ta=document.createElement('textarea');ta.value=content;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta)})}

// ========== v16 migration (WebLLM removal — reclaim ~1.5GB) ==========
function runV16Migration(){
  if(localStorage.getItem('stupind_v16_migrated') === '1') return;
  try{
    ['webllm/model','webllm/wasm','webllm/config'].forEach(n => {
      try{ indexedDB.deleteDatabase(n); }catch(e){}
    });
    if(typeof caches !== 'undefined'){
      caches.keys().then(ks => ks.filter(k => k.startsWith('webllm/')).forEach(k => caches.delete(k))).catch(() => {});
    }
    const old = localStorage.getItem('stupind_ai_cfg');
    if(old && !localStorage.getItem('stupind_intel_cfg')){
      try{
        const j = JSON.parse(old);
        if(j && Array.isArray(j.dominant) && j.dominant.length){
          localStorage.setItem('stupind_intel_cfg', JSON.stringify({ dominant: j.dominant.slice(0, 3) }));
        }
      }catch(e){}
    }
  }catch(e){}
  localStorage.removeItem('stupind_ai_cfg');
  localStorage.removeItem('stupind_model_ready');
  localStorage.removeItem('stupind_ai_chat_history');
  localStorage.setItem('stupind_v16_migrated', '1');
}
runV16Migration();

// ========== INIT ==========
loadState();
if(typeof ensureClassificationConfig==='function') ensureClassificationConfig(cfg);
ensureDefaultList();
setTimeout(() => {
  if(typeof embedStore !== 'undefined' && embedStore.cleanOrphans){
    embedStore.cleanOrphans().catch(() => {});
  }
}, 200);
// Manifest shortcuts use ?tab= — override saved tab when opening from a shortcut/link (after list bootstrap)
(function applyTabFromUrl(){
  try{
    const u = new URL(window.location.href);
    const t = u.searchParams.get('tab');
    if(t && VALID_MAIN_TABS.includes(t)){
      activeTab = t;
      u.searchParams.delete('tab');
      const q = u.searchParams.toString();
      history.replaceState(null, '', u.pathname + (q ? '?' + q : '') + u.hash);
      try { saveState('auto'); } catch(e) {}
    }
  } catch(e) {}
})();
setPhaseTime();
if(typeof restoreTaskToolbarPrefs==='function') restoreTaskToolbarPrefs();
if(typeof refreshClassificationUi==='function') refreshClassificationUi();
renderAll();
renderLog();
renderGoalList();
renderIntList();
renderQuickTimers();
ensureQuickTick();
// Restore task toolbar UI
if(gid('taskSortSel'))gid('taskSortSel').value=taskSortBy;
if(gid('groupBySel'))gid('groupBySel').value=taskGroupBy;
if(typeof updateFiltersSummary==='function') updateFiltersSummary();
applyTheme();
setTaskView(taskView);
setSmartView(smartView);
if(typeof hydrateIcons==='function') hydrateIcons();
updateMiniTimer();
// Apply saved active tab without scroll
document.querySelectorAll('[data-tab]').forEach(el=>{el.style.display=el.dataset.tab===activeTab?'':'none'});
document.querySelectorAll('.nav-tab').forEach(el=>{const on=el.dataset.navtab===activeTab;el.classList.toggle('active',on);el.setAttribute('aria-selected',on?'true':'false')});
if(activeTab==='focus'&&typeof setTimerSub==='function') setTimerSub(cfg.timerSub||'pomo');
if(typeof syncQaHintVisibility==='function') syncQaHintVisibility();
if(activeTab==='settings'&&!settingsOpen)toggleSettings();

// PWA status — standalone / file / SW; install UI lives in pwa.js (refreshPWAInstallUI)
(function(){
  const status=gid('pwaStatus');if(!status)return;
  const isStandalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  const okIc = (window.icon && window.icon('checkCircle', {size:13})) || '';
  const warnIc = (window.icon && window.icon('alertTriangle', {size:13})) || '';
  if(isStandalone){status.innerHTML=okIc+' Running as app';return}
  if(location.protocol==='file:'){status.innerHTML=warnIc+' Served via file:// — host over HTTP to install';return}
  if(!('serviceWorker' in navigator)){status.textContent='Browser does not support PWA';return}
  setTimeout(()=>{
    if(window._swRegistered===false){ status.textContent='Offline cache unavailable in this browser'; return; }
    if(typeof window.refreshPWAInstallUI==='function') window.refreshPWAInstallUI();
  },500)
})();

// Day rollover — detect the boundary in memory so a tab left open past midnight
// still archives yesterday's counters. (Previously we read localStorage, but
// the 10s auto-save overwrites s.date to today before this check runs, which
// swallowed the rollover for continuously-open tabs.)
let _lastKnownDate = (typeof todayKey === 'function') ? todayKey() : null;
function _handleDayRollover(){
  try{
    const today = (typeof todayKey === 'function') ? todayKey() : null;
    if(!today || !_lastKnownDate || today === _lastKnownDate) return;
    // Build a yesterday-stamped snapshot from the live in-memory state and
    // archive it. archiveDay dedupes by date so running twice is harmless.
    const yesterday = {
      date:           _lastKnownDate,
      totalPomos:     totalPomos,
      totalBreaks:    totalBreaks,
      totalFocusSec:  totalFocusSec,
      goals:          goals,
      tasks:          tasks,
      timeLog:        timeLog,
      sessionHistory: sessionHistory,
    };
    try{ archiveDay(yesterday); }catch(e){ console.warn('[app] archiveDay at rollover', e); }
    totalPomos=0; totalBreaks=0; totalFocusSec=0; pomosInCycle=0;
    sessionHistory=[]; timeLog=[];
    _lastKnownDate = today;
    if(typeof saveState==='function') saveState('auto');
    if(typeof renderAll==='function') renderAll();
    if(typeof renderLog==='function') renderLog();
    if(typeof renderStats==='function') renderStats();
    if(typeof renderArchive==='function') renderArchive();
  }catch(e){ console.warn('[app] day rollover', e); }
}
// Check every minute while the tab is alive…
setInterval(_handleDayRollover, 60 * 1000);
// …and again whenever the tab regains focus (backgrounded phones/laptops
// often suspend setInterval for hours, so this covers the common case).
document.addEventListener('visibilitychange', () => {
  if(!document.hidden) _handleDayRollover();
});

// Init sync panel UI (renders the "Enable Sync" state by default)
if(typeof renderSyncPanel==='function') renderSyncPanel();

if(typeof renderAIPanel==='function') renderAIPanel();
if(typeof renderGenSettings==='function') renderGenSettings();
if(typeof syncAskPromoChip==='function') syncAskPromoChip();

// Init calendar feeds panel + auto-refresh on boot
if(typeof renderCalFeedsPanel==='function') renderCalFeedsPanel();
if(typeof autoSyncCalFeedsOnBoot==='function') autoSyncCalFeedsOnBoot();

// ── Render System Info in Settings (version, storage persistence, quota) ───
async function renderSystemInfo(info){
  const el = document.getElementById('systemInfo');
  if(!el) return;
  const data = info || await checkStorageQuota();
  const okIc = (window.icon && window.icon('checkCircle', {size:13})) || '';
  const warnIc = (window.icon && window.icon('alertTriangle', {size:13})) || '';
  const storageLine = data
    ? `${data.persistent ? `<span class="sys-info-ok">${okIc} Protected</span>` : `<span class="sys-info-warn">${warnIc} Not protected — task data may be cleared by "Clear browsing history"</span>`} · Using ${data.usedMB} MB / ${data.quotaMB} MB (${data.pct}%)`
    : 'Storage info unavailable in this browser';
  const onlineLine = navigator.onLine
    ? `<span class="sys-info-ok">${okIc} Online</span>`
    : `<span class="sys-info-warn">${warnIc} Offline — tasks work, sync paused</span>`;
  const lastSaved = window._lastSaveAt
    ? new Date(window._lastSaveAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  el.innerHTML = `
    <div><strong>Version:</strong> ${APP_VERSION} (built ${APP_BUILD_DATE})</div>
    <div><strong>Last saved:</strong> ${lastSaved}</div>
    <div><strong>Network:</strong> ${onlineLine}</div>
    <div><strong>Storage:</strong> ${storageLine}</div>
    <div><strong>Intelligence:</strong> ${typeof isIntelReady === 'function' && isIntelReady()
      ? `<span class="sys-info-ok">${okIc} Embeddings ready (${typeof getIntelDevice === 'function' ? getIntelDevice() || 'runtime' : ''})</span>`
      : '<span style="color:var(--text-3)">Loads in background (WebGPU ~110 MB, WASM ~33 MB, cached offline)</span>'}</div>`;
}
// Initial render + re-render when online status changes
setTimeout(() => { renderSystemInfo(); }, 400);
window.addEventListener('online',  () => renderSystemInfo());
window.addEventListener('offline', () => renderSystemInfo());

// Deferred intelligence load — small embedding model (~33 MB), WebGPU or WASM
setTimeout(() => {
  if(typeof intelLoad !== 'function') return;
  const w = document.getElementById('intelProgressWrap');
  const bar = document.getElementById('intelProgressBar');
  const pct = document.getElementById('intelProgressPct');
  const txt = document.getElementById('intelProgressTxt');
  const retry = document.getElementById('intelRetryBtn');
  if(w) w.style.display = '';
  const onProgress = (typeof _makeProgressAggregator === 'function')
    ? _makeProgressAggregator((v, ev) => {
        if(bar) bar.style.width = v + '%';
        if(pct) pct.textContent = v + '%';
        const status = ev && ev.status ? String(ev.status) : '';
        const file = ev && ev.file ? ' · ' + String(ev.file).split('/').pop() : '';
        if(txt) txt.textContent = (status + file).slice(0, 80);
        if(typeof syncHeaderAIChip === 'function') syncHeaderAIChip('loading', v + '%');
      })
    : (p => { /* fallback (shouldn't happen) */
        const v = p && p.progress != null ? Math.round(p.progress) : 0;
        if(bar) bar.style.width = v + '%';
        if(pct) pct.textContent = v + '%';
        if(typeof syncHeaderAIChip === 'function') syncHeaderAIChip('loading', v + '%');
      });
  intelLoad(onProgress).then(async () => {
    if(w) w.style.display = 'none';
    if(retry) retry.style.display = 'none';
    if(typeof embedStore !== 'undefined' && embedStore.migrateEmbedRuntimeIfNeeded){
      try{
        const mig = await embedStore.migrateEmbedRuntimeIfNeeded();
        if(mig && mig.didPurge){
          const ban = document.getElementById('embedReindexBanner');
          if(ban){
            ban.style.display = '';
            ban.setAttribute('role', 'status');
            ban.setAttribute('aria-live', 'polite');
            ban.textContent = 'Re-indexing tasks…';
          }
          await embedStore.reindexAllOpenTasks((done, total) => {
            const b = document.getElementById('embedReindexBanner');
            if(b) b.textContent = 'Re-indexing tasks (' + done + ' of ' + total + ')…';
          });
          const b2 = document.getElementById('embedReindexBanner');
          if(b2){
            b2.textContent = 'Re-indexing complete.';
            setTimeout(() => { if(b2) b2.style.display = 'none'; }, 4000);
          }
        }
      }catch(e){ console.warn('[app] embed migration', e); }
    }
    if(typeof ensureCategoryCentroids === 'function'){
      try{ await ensureCategoryCentroids(); }catch(e){}
    }
    if(typeof ensureSchwartzEmbeddings === 'function'){
      ensureSchwartzEmbeddings().catch(() => {});
    }
    if(typeof renderAIPanel === 'function') renderAIPanel();
    if(typeof maybeShowEnhanceBtn === 'function') maybeShowEnhanceBtn();
    if(typeof scheduleIntelDupRefresh === 'function') scheduleIntelDupRefresh();
  }).catch(() => {
    if(w) w.style.display = 'none';
    if(retry) retry.style.display = '';
    if(typeof syncHeaderAIChip === 'function') syncHeaderAIChip('error', 'Load failed');
    if(typeof renderAIPanel === 'function') renderAIPanel();
    else if(typeof syncSemanticSearchUi === 'function') syncSemanticSearchUi();
  });
}, 1000);

// Deferred LLM auto-load — only when the user has enabled it AND the weights
// are already cached in the browser HTTP cache. We never auto-download.
setTimeout(() => {
  if(typeof getGenCfg !== 'function' || typeof genLoad !== 'function') return;
  if(typeof isGenDownloaded !== 'function') return;
  const cfg = getGenCfg();
  if(!cfg.enabled || !isGenDownloaded(cfg.modelId)) return;
  if(typeof isGenReady === 'function' && isGenReady()) return;

  let lastPct = -1;
  const bar = document.getElementById('genProgressBar');
  const pct = document.getElementById('genProgressPct');
  const txt = document.getElementById('genProgressTxt');
  const onProgress = (typeof _makeProgressAggregator === 'function')
    ? _makeProgressAggregator((v) => {
        if(v === lastPct) return;
        lastPct = v;
        if(bar) bar.style.width = v + '%';
        if(pct) pct.textContent = v + '%';
        if(txt) txt.textContent = 'restoring from cache…';
      })
    : () => {};

  genLoad(cfg.modelId, cfg.dtype, onProgress).then(() => {
    if(typeof renderGenSettings === 'function') renderGenSettings();
  }).catch((e) => {
    // Cached entry may have been evicted by the browser — leave a hint but
    // don't surface a toast. renderGenSettings will show the state on next open.
    console.warn('[gen] auto-load from cache failed:', e && e.message);
    if(typeof renderGenSettings === 'function') renderGenSettings();
  });
}, 2500);

(function syncCmdKGlyph(){
  const b=document.getElementById('cmdKBtn');
  if(!b) return;
  if(!/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform||'')){
    b.textContent='Ctrl+K';
    b.style.fontSize='10px';
    b.style.lineHeight='1.1';
  }
})();
