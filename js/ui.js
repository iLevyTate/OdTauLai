// ========== CALENDAR VIEW ==========
function _calMonthAnchor(){
  if(!calMonth) return new Date();
  if(/^\d{4}-\d{2}$/.test(calMonth)){
    const p=calMonth.split('-').map(Number);
    return new Date(p[0],p[1]-1,1,12,0,0);
  }
  return new Date(calMonth);
}
function renderCalendar(visibleTasks){
  const container=gid('calendarView');if(!container)return;
  const now=_calMonthAnchor();
  const year=now.getFullYear(),month=now.getMonth();
  const first=new Date(year,month,1);
  const startDay=first.getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const prevDays=new Date(year,month,0).getDate();
  const today=todayISO();
  const monthName=now.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  // Group tasks by due date
  const byDate={};
  visibleTasks.forEach(t=>{if(t.dueDate){(byDate[t.dueDate]=byDate[t.dueDate]||[]).push(t)}});
  // Surface feed sync failures inline at the top of the calendar so users
  // realise their displayed events may be stale. Falls back silently when
  // the calfeed module isn't loaded (e.g. in test sandbox).
  let feedAlertHtml='';
  if(typeof getFailedCalFeeds === 'function'){
    const failed = getFailedCalFeeds();
    if(failed && failed.length){
      const names = failed.map(f => esc(f.label || 'Feed')).slice(0, 3).join(', ');
      const more = failed.length > 3 ? ' +' + (failed.length - 3) : '';
      feedAlertHtml = '<div class="cal-feed-alert" role="status">'
        + '<span class="cal-feed-alert-msg">⚠ ' + names + more + ' — sync failed; events may be stale</span>'
        + '<button type="button" class="cal-feed-alert-btn" data-action="retryFailedCalFeeds">Retry sync</button>'
        + '</div>';
    }
  }
  let html=feedAlertHtml+'<div class="calendar"><div class="cal-head">'
    +'<button class="cal-nav" data-action="calNav" data-args="[-1]" title="Previous month">‹</button>'
    +'<div class="cal-title">'+monthName+'</div>'
    +'<button class="cal-today-btn" data-action="calToday">Today</button>'
    +'<button class="cal-nav" data-action="calNav" data-args="[1]" title="Next month">›</button>'
    +'</div><div class="cal-weekdays">';
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(w=>{html+='<div class="cal-weekday">'+w+'</div>'});
  html+='</div><div class="cal-grid">';
  // Prev month trailing
  for(let i=startDay-1;i>=0;i--){
    const day=prevDays-i;const d=new Date(year,month-1,day);
    const iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    html+='<div class="cal-day other-month" data-date="'+iso+'"><div class="cal-daynum">'+day+'</div>'+renderCalTasks(byDate[iso], iso)+'</div>';
  }
  // Current month
  for(let day=1;day<=daysInMonth;day++){
    const iso=year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    const isToday=iso===today;
    html+='<div class="cal-day'+(isToday?' today':'')+'" data-date="'+iso+'"><div class="cal-daynum">'+day+'</div>'+renderCalTasks(byDate[iso], iso)+'</div>';
  }
  // Next month leading
  const totalCells=startDay+daysInMonth;
  const rem=(7-totalCells%7)%7;
  for(let day=1;day<=rem;day++){
    const d=new Date(year,month+1,day);
    const iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    html+='<div class="cal-day other-month" data-date="'+iso+'"><div class="cal-daynum">'+day+'</div>'+renderCalTasks(byDate[iso], iso)+'</div>';
  }
  html+='</div></div>';
  container.innerHTML=html;
  // Apply per-event border-left-color via DOM API — inline style is blocked
  // by CSP, but el.style.X writes are allowed.
  container.querySelectorAll('.cal-feed-event[data-feed-color]').forEach(el=>{
    el.style.borderLeftColor = el.dataset.feedColor;
  });
  // Click handlers - click day background opens new task with that date, click task opens detail
  container.querySelectorAll('.cal-task').forEach(el=>{
    el.onclick=function(e){e.stopPropagation();const tid=parseInt(el.dataset.taskId);if(tid)openTaskDetail(tid)};
  });
  container.querySelectorAll('.cal-day').forEach(el=>{
    el.ondragover=function(e){e.preventDefault();e.dataTransfer.dropEffect='move';el.classList.add('drop-target')};
    el.ondragleave=function(){el.classList.remove('drop-target')};
    el.ondrop=function(e){
      e.preventDefault();el.classList.remove('drop-target');
      const srcId=parseInt(e.dataTransfer.getData('text/plain'));const src=findTask(srcId);
      if(src){src.dueDate=el.dataset.date;renderTaskList();saveState('user')}
    };
    el.onclick=function(e){if(e.target.closest('.cal-task')||e.target.closest('[data-action]'))return;
      const inp=gid('taskInput');if(inp){inp.value='';inp.focus();}
      // Pre-set the date when user presses Enter
      const date=el.dataset.date;
      window._calSelectedDate=date;
    };
  });
}
function renderCalTasks(arr, isoDate){
  // Merge local tasks with external calendar feed events for this date
  const feedEvents = (typeof getCalFeedEventsForDate === 'function' && isoDate)
    ? getCalFeedEventsForDate(isoDate) : [];

  const haveAnything = (arr && arr.length) || feedEvents.length;
  if(!haveAnything) return '';

  let html = '';
  // Render local tasks first (show up to 2)
  if(arr && arr.length){
    const show = arr.slice(0, 2);
    html += show.map(t=>'<div class="cal-task p-'+(t.priority||'none')+(t.status==='done'?' done':'')+'" data-task-id="'+t.id+'">'+esc(t.name)+'</div>').join('');
  }
  // Render external feed events (show up to 2)
  if(feedEvents.length){
    const showEvs = feedEvents.slice(0, 2);
    html += showEvs.map(ev => {
      const uid = String(ev.uid || '');
      const mk = uid && typeof createTaskFromCalEvent === 'function'
        ? `<button type="button" class="cal-ev-mk-task" title="Create task from this event" aria-label="Create task from event" data-action="createTaskFromCalEvent" data-args='${JSON.stringify([String(ev.feedId), uid])}'>+Task</button>`
        : '';
      return `<div class="cal-task cal-feed-event" data-feed-color="${escAttr(sanitizeListColor(ev.feedColor))}" title="${esc(ev.feedLabel)}: ${esc(ev.title)}${ev.time?' at '+esc(String(ev.time)):''}${ev.location?' — '+esc(ev.location):''}">`
        + mk
        + (ev.time ? `<span class="cal-feed-time">${esc(ev.time)}</span> ` : '')
        + esc(ev.title)
        + '</div>';
    }).join('');
  }
  // "+N more" indicator if we truncated
  const totalCount = (arr ? arr.length : 0) + feedEvents.length;
  const shownCount = Math.min(arr ? arr.length : 0, 2) + Math.min(feedEvents.length, 2);
  if(totalCount > shownCount){
    html += '<div class="cal-task-more">+'+(totalCount-shownCount)+' more</div>';
  }
  return html;
}
function calNav(dir){
  const now=_calMonthAnchor();
  now.setMonth(now.getMonth()+dir);
  calMonth=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  renderTaskList();
}
function calToday(){calMonth=null;renderTaskList()}

// ========== COMMAND PALETTE (Cmd+K) ==========
let cmdkActiveIdx=0,cmdkFilteredItems=[];
let cmdkMode='find'; // 'find' | 'ask'
let _cmdkAskCtl=null;
let _cmdkAskHistoryIdx=-1;
let _cmdkAskBusy=false;
let _cmdkLastReply=null;
let _cmdkPrevFocus=null;
function openCmdK(opts){
  const openAsk = opts && opts.ask === true;
  const prefill = (opts && typeof opts.prefill === 'string') ? opts.prefill : '';
  const ov=gid('cmdkOverlay');if(!ov)return;
  _cmdkPrevFocus=document.activeElement;
  ov.classList.add('open');
  cmdkMode=openAsk?'ask':'find';
  _cmdkAskHistoryIdx=-1;_cmdkLastReply=null;_cmdkAskBusy=false;
  _applyCmdkMode();
  const inp=gid('cmdkInput');
  if(inp)inp.value=prefill;
  cmdkActiveIdx=0;renderCmdK();
  if(inp){
    try{inp.focus({preventScroll:true})}catch(_){inp.focus()}
    if(prefill){
      try{inp.setSelectionRange(prefill.length, prefill.length)}catch(_){}
    }
  }
  if(typeof installTabTrap==='function') installTabTrap(ov);
}
function closeCmdK(){
  _cmdkAbortAsk();
  if(typeof removeTabTrap==='function') removeTabTrap();
  gid('cmdkOverlay').classList.remove('open');
  if(_cmdkPrevFocus&&_cmdkPrevFocus.focus)try{_cmdkPrevFocus.focus()}catch(_){}
  _cmdkPrevFocus=null;
}
function _cmdkAbortAsk(){
  if(_cmdkAskCtl){try{_cmdkAskCtl.abort()}catch(_){}_cmdkAskCtl=null}
  if(typeof genAbort==='function'){try{genAbort()}catch(_){}}
  _cmdkAskBusy=false;
}
function cmdkSetAskMode(on){
  // Leaving ask mode mid-generation must actually stop the model, not just
  // the UI affordance. Otherwise tokens keep decoding in the background and
  // the next Ask turn sees stale state.
  if(!on && (_cmdkAskBusy || _cmdkAskCtl)) _cmdkAbortAsk();
  cmdkMode=on?'ask':'find';
  _applyCmdkMode();
  renderCmdK();
}
function cmdkToggleAsk(){cmdkSetAskMode(cmdkMode!=='ask')}
function _cmdkTouchOrNarrowUI(){
  return typeof matchMedia==='function' && (matchMedia('(max-width: 640px)').matches || matchMedia('(pointer: coarse)').matches);
}
function _syncCmdkFindHint(){
  const h=gid('cmdkFindHint');
  if(!h)return;
  if(cmdkMode!=='find'){h.hidden=true;return}
  h.hidden=!_cmdkTouchOrNarrowUI();
}
function _applyCmdkMode(){
  const panel=gid('cmdkOverlay')?.querySelector('.cmdk-panel');
  const input=gid('cmdkInput');
  const tog=gid('cmdkAskToggle');
  const reply=gid('cmdkAskReply');
  const results=gid('cmdkResults');
  if(panel)panel.classList.toggle('cmdk-panel--ask',cmdkMode==='ask');
  if(input){
    input.placeholder=cmdkMode==='ask'
      ?'Ask about or edit your tasks in plain English…'
      :'Search tasks, actions, views… (? for Ask)';
  }
  if(tog){
    tog.classList.toggle('cmdk-ask-toggle--active',cmdkMode==='ask');
    tog.setAttribute('aria-pressed',cmdkMode==='ask'?'true':'false');
  }
  if(reply){
    if(cmdkMode==='ask'){reply.hidden=false;if(!reply.childNodes.length){const h=document.createElement('div');h.className='cmdk-ask-hint';h.textContent='Press Enter to run on-device. No auto-apply — you’ll preview every proposed change.';reply.appendChild(h)}}
    else{reply.hidden=true;reply.textContent=''}
  }
  if(results)results.hidden = !!(cmdkMode==='ask');
  _syncCmdkFindHint();
}
function _cmdkFootFindText(){
  const foot=gid('cmdkFoot');if(!foot)return;
  if(_cmdkTouchOrNarrowUI()){
    foot.textContent='Tap a row to run · Ask = on-device AI · outside = close';
  }else{
    const mod=/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform||'')?'⌘':'Ctrl';
    foot.textContent=mod+'/Ctrl+K · ↑↓ · Enter · Esc';
  }
}
function _cmdkFootAskText(){
  const foot=gid('cmdkFoot');if(!foot)return;
  const mod=/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform||'')?'⌘':'Ctrl';
  const genReady=typeof isGenReady==='function'&&isGenReady();
  if(_cmdkTouchOrNarrowUI()){
    foot.textContent='Enter = run on-device · toggle Ask to browse actions · '+(genReady?'Model ready':'Model not loaded');
  }else{
    foot.textContent=mod+'/Ctrl+K · Enter = ask · Esc · '+(genReady?'Model ready':'Model not loaded');
  }
}
// Append a collapsible "Rejected ops" panel to the existing Ask reply DOM.
// validateOps returns each rejection with a reason; surfacing them lets the
// user see exactly why a proposed change didn't apply (e.g. unknown id,
// invalid status, mismatched arg shape) instead of just a "(N rejected)"
// count. textContent only — the LLM op shape is not trusted as HTML.
function _renderAskRejected(rejected){
  const reply = gid('cmdkAskReply');
  if(!reply) return;
  const det = document.createElement('details');
  det.className = 'cmdk-ask-rejected';
  const summ = document.createElement('summary');
  summ.textContent = rejected.length + ' rejected — show reasons';
  det.appendChild(summ);
  const list = document.createElement('ul');
  list.className = 'cmdk-ask-rejected-list';
  rejected.slice(0, 25).forEach(r => {
    const li = document.createElement('li');
    const op = (r && r.op) || (r && r.name) || 'op';
    const why = (r && (r.reason || r.error || r.message)) || 'invalid';
    li.textContent = String(op) + ' — ' + String(why);
    list.appendChild(li);
  });
  if(rejected.length > 25){
    const more = document.createElement('li');
    more.className = 'cmdk-ask-rejected-more';
    more.textContent = '+ ' + (rejected.length - 25) + ' more';
    list.appendChild(more);
  }
  det.appendChild(list);
  reply.appendChild(det);
}
// Render a free-form prose answer from the on-device model. Kept separate
// from _renderAskStatus so it can host longer multi-line replies (chat-style)
// without being mistaken for an error or "done" toast. textContent only —
// the LLM output is not trusted as HTML.
function _renderAskAnswer(text){
  const reply = gid('cmdkAskReply');
  if(!reply) return;
  reply.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'cmdk-ask-answer';
  const body = document.createElement('div');
  body.className = 'cmdk-ask-answer-body';
  body.textContent = String(text || '').trim();
  wrap.appendChild(body);
  const foot = document.createElement('div');
  foot.className = 'cmdk-ask-answer-foot';
  foot.textContent = 'Answered on-device. No changes were applied.';
  wrap.appendChild(foot);
  reply.appendChild(wrap);
}
function _renderAskStatus(state,msg){
  const reply=gid('cmdkAskReply');if(!reply)return;
  if(state==='streaming'){
    reply.innerHTML=`
      <div class="cmdk-ask-streaming">
        <div class="cmdk-ask-row">
          <span class="cmdk-ask-spinner" aria-hidden="true"></span>
          <span class="cmdk-ask-label" id="cmdkAskLabel">Thinking on-device…</span>
          <button type="button" class="cmdk-ask-stop" data-action="cmdkAskStop">Stop</button>
        </div>
        <details class="cmdk-ask-details">
          <summary>Show raw output</summary>
          <pre class="cmdk-ask-stream" id="cmdkAskStream"></pre>
        </details>
      </div>`;
  }else if(state==='error'){
    reply.textContent='';const ed=document.createElement('div');ed.className='cmdk-ask-error';ed.textContent=msg||'Error';reply.appendChild(ed);
  }else if(state==='empty'){
    reply.textContent='';const em=document.createElement('div');em.className='cmdk-ask-empty';em.textContent=msg||'No changes proposed.';reply.appendChild(em);
  }else if(state==='done'){
    reply.textContent='';const dn=document.createElement('div');dn.className='cmdk-ask-done';dn.textContent=msg||'Proposed.';reply.appendChild(dn);
  }else if(state==='need-model'){
    // Message reflects whether the model just needs loading vs a full download.
    const cfg = typeof getGenCfg === 'function' ? getGenCfg() : null;
    const cached = !!(cfg && typeof isGenDownloaded === 'function' && isGenDownloaded(cfg.modelId));
    const loading = typeof isGenLoading === 'function' && isGenLoading();
    // Look up the chosen preset's headline size so the user knows what
    // they're agreeing to before tapping Download. Falls back to a
    // conservative "~230 MB" if the preset list isn't reachable for any
    // reason (it always is in practice — gen.js loads first).
    let sizeHint = '~230 MB';
    try{
      if(cfg && typeof getGenPresets === 'function'){
        const presets = getGenPresets() || [];
        const p = presets.find(x => x && x.id === cfg.modelId);
        if(p && typeof p.sizeMb === 'number') sizeHint = '~' + p.sizeMb + ' MB';
      }
    }catch(_){}
    let inner;
    if(loading){
      inner = 'Local AI is still loading — give it a moment and try again.';
    }else{
      // One-tap download: genDownloadClick flips cfg.enabled itself if it's
      // off, so a single button covers both "never enabled" and "enabled
      // but not yet downloaded." Stays on-device — no cloud, no API key.
      const head = cached
        ? 'Local AI is ready but not loaded into memory yet.'
        : 'This app runs the chat model fully on-device. Nothing leaves your browser. First time needs a one-off ' + sizeHint + ' download.';
      const btnLabel = cached ? 'Load now' : 'Download local AI (' + sizeHint + ')';
      inner = head
        + ' <button type="button" class="btn-ghost btn-sm cmdk-ask-enable" data-action="genDownloadClick">'
        + btnLabel + '</button>';
    }
    reply.innerHTML = '<div class="cmdk-ask-error">' + inner + '</div>';
  }
}
function _updateAskLabel(totalChars){
  const lbl=gid('cmdkAskLabel');if(!lbl)return;
  // Try to extract "count so far" by scanning for completed op entries
  // without doing a full parse — just count top-level `{"name"` occurrences.
  const stream=gid('cmdkAskStream');
  const txt=stream?stream.textContent:'';
  const matches=txt.match(/\{\s*"name"/g);
  const n=matches?matches.length:0;
  if(n>0)lbl.textContent=`Planning ${n} change${n!==1?'s':''}…`;
  else lbl.textContent='Thinking on-device…';
}
async function cmdkAskSubmit(){
  if(_cmdkAskBusy)return;
  const input=gid('cmdkInput');if(!input)return;
  const q=input.value.trim();
  if(!q)return;
  if(typeof isGenReady!=='function'||!isGenReady()){_renderAskStatus('need-model');return}
  if(typeof askRun!=='function'){_renderAskStatus('error','Ask pipeline unavailable');return}
  _cmdkAskBusy=true;
  _cmdkAskCtl=new AbortController();
  _renderAskStatus('streaming');
  const streamEl=gid('cmdkAskStream');
  try{
    const res=await askRun(q,{
      signal:_cmdkAskCtl.signal,
      onReadRound:()=>{
        const lbl=gid('cmdkAskLabel');
        if(lbl)lbl.textContent='Running read-only tools on-device…';
      },
      onToken:(t)=>{
        const el=gid('cmdkAskStream');
        if(el){el.textContent+=t;el.scrollTop=el.scrollHeight}
        _updateAskLabel();
      },
    });
    _cmdkLastReply=res;
    if(!res.ok){
      const reason=res.reason||'Unknown error';
      if(reason==='ABORTED'||reason==='TIMEOUT'){_renderAskStatus('error',reason==='TIMEOUT'?'Timed out — try a shorter request or a smaller model.':'Stopped.');}
      else if(reason==='GEN_NOT_READY'){_renderAskStatus('need-model');}
      else if(reason.startsWith('PARSE_FAILED')){_renderAskStatus('error','Couldn’t parse a valid plan. Try rephrasing.');}
      else{_renderAskStatus('error',reason);}
      return;
    }
    if(!res.ops.length){
      // Free-form chat answer (e.g. "what's overdue?") — surface the prose
      // the model produced instead of treating "no ops to apply" as an
      // empty result. Without this branch, a plain question never gets an
      // answer back in the UI.
      if(res.chatAnswer){
        _renderAskAnswer(res.chatAnswer);
        return;
      }
      _renderAskStatus('empty','No actionable changes — nothing will be applied.');
      return;
    }
    if(typeof acceptProposedOps==='function'){
      await acceptProposedOps(res.ops,{source:'ask',destructiveLevel:res.destructiveLevel});
    }
    const n=res.ops.length;
    const extra=res.rejected&&res.rejected.length?` (${res.rejected.length} rejected)`:'';
    const rrd=res.readRounds>0?` ${res.readRounds} read step${res.readRounds!==1?'s':''} ·`:'';
    _renderAskStatus('done',`Proposed ${n} change${n!==1?'s':''}${extra}.${rrd} Opened Tools — review before applying.`);
    // Show why each rejected op was dropped so the user can adjust their
    // request. validateOps already returns the reasons; previously they
    // were summarized as a count and the detail vanished.
    if(res.rejected && res.rejected.length){
      _renderAskRejected(res.rejected);
    }
    setTimeout(closeCmdK,res.rejected && res.rejected.length ? 2400 : 650);
  }catch(e){
    _renderAskStatus('error',(e&&e.message)||'Error');
  }finally{
    _cmdkAskBusy=false;
    _cmdkAskCtl=null;
  }
}
function cmdkAskStop(){
  if(_cmdkAskCtl){try{_cmdkAskCtl.abort()}catch(_){}}
  if(typeof genAbort==='function')genAbort();
}

/** Open the palette pre-switched to Ask mode (used by the promo chip). */
function openAskMode(){
  openCmdK({ask:true});
}

/** Show the task-input promo chip only when the LLM is ready AND the user
 * hasn't dismissed/hidden it. Default is hidden — Ask is also reachable via
 * the Cmd/Ctrl+K palette so promoting it inline is opt-in noise reduction. */
function syncAskPromoChip(){
  const chip=gid('askPromoChip');
  if(!chip)return;
  const ready=typeof isGenReady==='function'&&isGenReady();
  const allowed=!(typeof cfg==='object'&&cfg&&cfg.askPromoHidden);
  chip.hidden = !((ready&&allowed));
}
/** User-toggle to surface the inline Ask promo. Persists to cfg. */
function showAskPromo(){
  if(typeof cfg==='object'&&cfg){cfg.askPromoHidden=false;saveState('user');}
  syncAskPromoChip();
}
function hideAskPromo(){
  if(typeof cfg==='object'&&cfg){cfg.askPromoHidden=true;saveState('user');}
  syncAskPromoChip();
}
window.showAskPromo=showAskPromo;
window.hideAskPromo=hideAskPromo;
function renderCmdK(){
  const rawInput=gid('cmdkInput');
  let rawVal=rawInput?rawInput.value:'';
  // Prefix "? " toggles Ask mode and strips the prefix from the query.
  if(cmdkMode!=='ask'&&(rawVal.startsWith('?')||rawVal.startsWith('？'))){
    const rest=rawVal.replace(/^[?？]\s*/,'');
    if(rawInput)rawInput.value=rest;
    rawVal=rest;
    // If there's an Ask turn running from a previous invocation, kill it
    // cleanly before flipping modes so the new Ask state isn't racing the
    // old one.
    if(_cmdkAskBusy||_cmdkAskCtl)_cmdkAbortAsk();
    cmdkSetAskMode(true);
    return;
  }
  if(cmdkMode==='ask'){
    const results=gid('cmdkResults');
    if(results)results.hidden = true;
    _cmdkFootAskText();
    return;
  }
  const q=rawVal.toLowerCase().trim();
  const results=gid('cmdkResults');
  const ic=(n)=>(typeof window.icon==='function'?window.icon(n):'');
  const askAction={type:'action',label:'Ask the AI (natural language)',icon:ic('spark'),kbd:'?',run:()=>{openCmdK({ask:true})}};
  const navActions=[
    {type:'action',label:'Go to Tasks',icon:ic('list'),kbd:'1',run:()=>showTab('tasks')},
    {type:'action',label:'Go to Timer',icon:ic('timer'),kbd:'2',run:()=>showTab('focus')},
    {type:'action',label:'Go to Tools',icon:ic('toolSparkle'),kbd:'3',run:()=>showTab('tools')},
    {type:'action',label:'Go to Data',icon:ic('database'),kbd:'4',run:()=>showTab('data')},
    {type:'action',label:'Go to Settings',icon:ic('gear'),kbd:'5',run:()=>showTab('settings')},
    {type:'action',label:'Inbox view (untriaged)',icon:ic('inbox'),run:()=>{showTab('tasks');setSmartView('inbox')}},
    {type:'action',label:'Today view',icon:ic('calendar'),run:()=>{showTab('tasks');setSmartView('today')}},
    {type:'action',label:'Overdue view',icon:ic('alertTriangle'),run:()=>{showTab('tasks');setSmartView('overdue')}},
    {type:'action',label:'Starred view',icon:ic('star'),run:()=>{showTab('tasks');setSmartView('starred')}},
    {type:'action',label:'Waiting view (blocked on others)',icon:ic('hourglass'),run:()=>{showTab('tasks');setSmartView('waiting')}},
    {type:'action',label:'Stuck view (untouched 14+ days)',icon:ic('alertCircle'),run:()=>{showTab('tasks');setSmartView('stuck')}},
    {type:'action',label:'Snoozed view (hidden until a date)',icon:ic('moon'),run:()=>{showTab('tasks');setSmartView('snoozed')}},
    {type:'action',label:'Habits view (recurring tasks)',icon:ic('refresh'),run:()=>{showTab('tasks');setSmartView('habits')}},
    {type:'action',label:'Impact view (Pareto 80/20)',icon:ic('zap'),run:()=>{showTab('tasks');setSmartView('impact')}},
    {type:'action',label:'Sort by Impact (Pareto)',icon:ic('zap'),run:()=>{showTab('tasks');const s=gid('taskSortSel');if(s){s.value='impact';if(typeof updateTaskFilters==='function')updateTaskFilters()}}},
    {type:'action',label:'Archive view',icon:ic('archive'),run:()=>{showTab('tasks');setSmartView('archived')}},
    {type:'action',label:'List view',icon:ic('list'),run:()=>{showTab('tasks');setTaskView('list')}},
    {type:'action',label:'Board view',icon:ic('grid'),run:()=>{showTab('tasks');setTaskView('board')}},
    {type:'action',label:'Calendar view',icon:ic('calendar'),run:()=>{showTab('tasks');setTaskView('calendar')}},
    {type:'action',label:'Toggle theme',icon:ic('moon'),run:()=>toggleTheme()},
    {type:'action',label:'Focus-on-list mode (hide other lists)',icon:ic('folder'),run:()=>toggleFocusListMode()},
    {type:'action',label:(isBulkMode()?'Exit bulk-edit mode':'Bulk-edit mode (multi-select)'),icon:ic('check'),run:()=>toggleBulkMode()},
    {type:'action',label:'Save current view…',icon:ic('star'),run:()=>savePerspectivePrompt()},
    {type:'action',label:'Daily brief (top tasks today)',icon:ic('sparkles'),run:()=>showDailyBriefCard()},
    {type:'action',label:'Weekly review (last 7 days)',icon:ic('clipboard'),run:()=>showWeeklyReviewCard()},
    {type:'action',label:'AI: Rephrase open task title',icon:ic('wand'),run:()=>rephraseActiveTaskTitle()},
    {type:'action',label:'AI: Suggest tags for open task',icon:ic('spark'),run:()=>suggestTagsForTask()},
    {type:'action',label:'AI: Suggest due date for open task',icon:ic('calendar'),run:()=>suggestDueDateForTask()},
    {type:'action',label:'Snooze open task — 1 day',icon:ic('moon'),run:()=>{ if(editingTaskId!=null) snoozeTaskForDays(editingTaskId,1); else if(typeof showExportToast==='function') showExportToast('Open a task first.') }},
    {type:'action',label:'Snooze open task — 3 days',icon:ic('moon'),run:()=>{ if(editingTaskId!=null) snoozeTaskForDays(editingTaskId,3); else if(typeof showExportToast==='function') showExportToast('Open a task first.') }},
    {type:'action',label:'Snooze open task — 1 week',icon:ic('moon'),run:()=>{ if(editingTaskId!=null) snoozeTaskForDays(editingTaskId,7); else if(typeof showExportToast==='function') showExportToast('Open a task first.') }},
    {type:'action',label:'Unsnooze open task',icon:ic('refresh'),run:()=>{ if(editingTaskId!=null) unsnoozeTask(editingTaskId); else if(typeof showExportToast==='function') showExportToast('Open a task first.') }},
    {type:'action',label:'Manage saved views (perspectives)',icon:ic('star'),run:()=>showManagePerspectivesCard()},
    {type:'action',label:'Render markdown in open task description',icon:ic('book'),run:()=>{ if(typeof toggleDescriptionRender==='function') toggleDescriptionRender(); }},
    {type:'action',label:'Export open task as Markdown',icon:ic('clipboard'),run:()=>{ if(editingTaskId!=null) exportSingleTaskAsMarkdown(editingTaskId); else if(typeof showExportToast==='function') showExportToast('Open a task first.') }},
    {type:'action',label:'Save open task as template',icon:ic('clipboard'),run:()=>saveCurrentTaskAsTemplate()},
    {type:'action',label:'Apply task template…',icon:ic('clipboard'),run:()=>showApplyTemplateCard()},
    {type:'action',label:'Start focus timer',icon:ic('play'),run:()=>{showTab('focus');if(!running)startTimer()}},
    {type:'action',label:'Add new list',icon:ic('plus'),run:()=>{showTab('tasks');addList()}},
    {type:'action',label:'Harmonize all fields (embeddings)',icon:ic('harmonize'),run:()=>{showTab('tools');if(typeof intelHarmonizeFields==='function')intelHarmonizeFields()}},
    {type:'action',label:'Find duplicate tasks',icon:ic('copy'),run:()=>{showTab('tools');if(typeof intelFindDuplicatesUI==='function')intelFindDuplicatesUI()}},
    {type:'action',label:'Toggle semantic search',icon:ic('search'),run:()=>{showTab('tasks');if(typeof isIntelReady !== 'function' || !isIntelReady()){if(typeof syncHeaderAIChip === 'function') syncHeaderAIChip('error', 'Load model first — open Tools');showTab('tools');return}const cb=gid('taskSearchSemantic');if(cb){cb.checked=!cb.checked;if(typeof toggleTaskSearchSemantic==='function')toggleTaskSearchSemantic()}}},
  ];
  const items=[];
  const askMatches=!q||askAction.label.toLowerCase().includes(q);
  if(askMatches){
    items.push({section:'Ask'});
    items.push(askAction);
  }
  // Append saved perspectives dynamically
  if(typeof cfg === 'object' && cfg && Array.isArray(cfg.perspectives)){
    cfg.perspectives.forEach(p => {
      if(!p || !p.name) return;
      const label = 'View: ' + p.name;
      navActions.push({ type:'action', label, icon: ic('star'), run: () => applyPerspective(p.name) });
    });
  }
  const matchedNav=q?navActions.filter(a=>a.label.toLowerCase().includes(q)):navActions;
  if(matchedNav.length){items.push({section:'Actions'});matchedNav.forEach(a=>items.push(a))}
  // Match tasks
  const matchedTasks=tasks.filter(t=>!t.archived&&(t.name.toLowerCase().includes(q)||(t.description||'').toLowerCase().includes(q))).slice(0,12);
  if(q&&matchedTasks.length){
    items.push({section:'Tasks'});
    matchedTasks.forEach(t=>items.push({type:'task',label:t.name,icon:t.status==='done'?'✓':'○',desc:(t.dueDate?fmtDue(t.dueDate):'')||getTaskPath(t.id).slice(0,-1).join(' › '),run:()=>{showTab('tasks');openTaskDetail(t.id)}}));
  }
  cmdkFilteredItems=items.filter(i=>!i.section);
  if(cmdkActiveIdx>=cmdkFilteredItems.length)cmdkActiveIdx=Math.max(0,cmdkFilteredItems.length-1);
  _cmdkFootFindText();
  if(!items.length){results.textContent='';const emp=document.createElement('div');emp.className='cmdk-empty';emp.textContent='No matches';results.appendChild(emp);return}
  let itemIdx=0;
  results.innerHTML=items.map(i=>{
    if(i.section)return '<div class="cmdk-section">'+i.section+'</div>';
    const active=itemIdx===cmdkActiveIdx;
    const cur=itemIdx++;
    const kbd=i.kbd?'<span class="cmdk-kbd">'+i.kbd+'</span>':(i.desc?'<span class="cmdk-desc">'+esc(i.desc)+'</span>':'');
    return '<div class="cmdk-item'+(active?' active':'')+'" data-idx="'+cur+'" data-action="cmdkRun" data-arg="+cur+"><span class="cmdk-icon">'+i.icon+'</span><span>'+esc(i.label)+'</span>'+kbd+'</div>';
  }).join('');
}
function cmdkRun(idx){
  const item=cmdkFilteredItems[idx];if(!item||!item.run)return;
  closeCmdK();setTimeout(()=>item.run(),50);
}
function cmdkKeydown(e){
  if(e.key==='Escape'){closeCmdK();return}
  if(cmdkMode==='ask'){
    if(e.key==='Enter'){e.preventDefault();cmdkAskSubmit();return}
    if(e.key==='ArrowUp'){
      if(typeof getAskHistory!=='function')return;
      const hist=getAskHistory();
      if(!hist.length)return;
      e.preventDefault();
      _cmdkAskHistoryIdx=Math.min(_cmdkAskHistoryIdx+1,hist.length-1);
      const item=hist[_cmdkAskHistoryIdx];
      if(item){const inp=gid('cmdkInput');if(inp){inp.value=item.text}}
      return;
    }
    if(e.key==='ArrowDown'){
      if(_cmdkAskHistoryIdx<=0){_cmdkAskHistoryIdx=-1;const inp=gid('cmdkInput');if(inp)inp.value='';e.preventDefault();return}
      const hist=typeof getAskHistory==='function'?getAskHistory():[];
      _cmdkAskHistoryIdx=Math.max(_cmdkAskHistoryIdx-1,0);
      const item=hist[_cmdkAskHistoryIdx];
      if(item){const inp=gid('cmdkInput');if(inp)inp.value=item.text}
      e.preventDefault();
      return;
    }
    // Backspace on empty exits Ask mode
    if(e.key==='Backspace'){
      const inp=gid('cmdkInput');
      if(inp&&inp.value===''){e.preventDefault();cmdkSetAskMode(false);return}
    }
    return;
  }
  if(e.key==='ArrowDown'){e.preventDefault();cmdkActiveIdx=Math.min(cmdkActiveIdx+1,cmdkFilteredItems.length-1);renderCmdK()}
  else if(e.key==='ArrowUp'){e.preventDefault();cmdkActiveIdx=Math.max(cmdkActiveIdx-1,0);renderCmdK()}
  else if(e.key==='Enter'){e.preventDefault();cmdkRun(cmdkActiveIdx)}
}
function _blockingOverlaysForCmdK(){
  const wno = document.getElementById('whatNextOverlay');
  if(wno && !wno.hidden) return true;
  const tm = document.getElementById('taskModal');
  if(tm && tm.classList.contains('open')) return true;
  if(document.getElementById('bulkImportModal')?.classList.contains('open')) return true;
  if(document.getElementById('appConfirmModal')?.classList.contains('open')) return true;
  if(document.getElementById('appPromptModal')?.classList.contains('open')) return true;
  return false;
}
// Keyboard shortcut: Cmd+K / Ctrl+K
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&(e.key==='k'||e.key==='K')){
    if(_blockingOverlaysForCmdK()) return;
    e.preventDefault();
    openCmdK();
  }
});

// Keyboard shortcut: Ctrl+Z / Cmd+Z — undo the last action via the action toast button
document.addEventListener('keydown',(e)=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey){
    const active=document.activeElement;
    const tag=active?active.tagName.toLowerCase():'';
    // Don't intercept undo in text inputs/textareas (they handle Ctrl+Z natively)
    if(tag!=='input'&&tag!=='textarea'&&tag!=='select'){
      const toast=document.getElementById('actionToast');
      const btn=toast?.querySelector('.action-toast-btn');
      if(btn&&toast?.classList?.contains('show')){
        e.preventDefault();
        btn.click();
      }
    }
  }
},true);

// ========== THEME TOGGLE ==========
// Manual toggle wins over OS preference: once the user picks a theme it sticks
// across reloads (persisted in localStorage). The OS auto-apply only takes
// effect for users who haven't explicitly chosen yet.
const _THEME_MANUAL_KEY = 'stupind_theme_manual';
function _isThemeManual(){
  try{ return localStorage.getItem(_THEME_MANUAL_KEY) === '1'; }catch(_){ return false; }
}
function toggleTheme(){
  theme=theme==='dark'?'light':'dark';
  try{ localStorage.setItem(_THEME_MANUAL_KEY, '1'); }catch(_){}
  applyTheme();saveState('user');
}
function applyTheme(){
  document.body.classList.toggle('light-theme',theme==='light');
  // Theme-toggle glyph: SVG icon via the project icon system (no emoji — the
  // U+1F319 moon and U+2600 sun glyphs fall back to ✱ on Windows in many
  // sans-serif stacks, hiding the affordance entirely).
  const btn=gid('themeToggleBtn');
  if(btn){
    const span = btn.querySelector('[data-icon]');
    if(span){
      span.setAttribute('data-icon', theme==='dark' ? 'moon' : 'sun');
      span.textContent = '';
      span.__iconHydrated = false;
      if(typeof window.hydrateIcons === 'function') window.hydrateIcons(btn);
    }else{
      btn.textContent = theme==='dark' ? '🌙' : '☀';
    }
  }
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta){
    const c=getComputedStyle(document.body).getPropertyValue('--bg-0').trim();
    if(c) meta.setAttribute('content',c);
  }
}
// Sync to OS preference on load, but only when the user hasn't made a manual
// choice. matchMedia listener also tracks runtime OS-theme changes.
(function _syncThemeToOS(){
  try{
    const mq = matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      if(_isThemeManual()) return;
      const want = mq.matches ? 'light' : 'dark';
      if(theme !== want){ theme = want; applyTheme(); }
    };
    if(typeof mq.addEventListener === 'function') mq.addEventListener('change', apply);
    else if(typeof mq.addListener === 'function') mq.addListener(apply);
    // Defer the initial sync until after saveState's restore pass has set the
    // persisted theme value, otherwise we'd overwrite the user's prior choice.
    setTimeout(apply, 100);
  }catch(_){}
})();
function hasVisibleDescendant(taskId,visibleSet){
  return getTaskDescendantIds(taskId).some(id=>visibleSet.has(id))
}

/** Compute the set of list IDs that still own at least one non-archived, non-done
 *  task. Scans the full task array once — intended to be called by renderTaskList
 *  and cached on window._listsWithTasksCache for the duration of one render. */
function _computeListsWithTasks(){
  const s=new Set();
  for(const x of tasks){ if(!x.archived && x.status!=='done') s.add(x.listId); }
  window._listsWithTasksCache=s;
  return s;
}

function renderTaskItem(t,depth){
  const list=gid('taskList');
  const isActive=activeTaskId===t.id;
  const rolledTime=getRolledUpTime(t.id);
  const kids=hasChildren(t.id);
  const isDone=t.status==='done';
  const dueCls=getDueClass(t.dueDate);
  const d=document.createElement('div');
  d.className='task-item clickable'
    +(isActive?' active-task task-item--tracking':'')
    +(kids?' has-children':'')
    +(depth>0?' depth-'+Math.min(depth,4):'')
    +(isDone?' completed':'')
    +(t.archived?' archived':'')
    +(dueCls==='overdue'&&!isDone?' overdue':'')
    +(t.starred?' starred-task':'');
  if(smartView==='impact'&&typeof isParetoTop==='function'&&isParetoTop(t.id))d.classList.add('task-item--pareto');
  d.dataset.priority=(!t.starred&&t.priority&&t.priority!=='none')?t.priority:'';
  d.style.marginLeft=(depth*18)+'px';
  // Reorder is now handled by Sortable.js (see _initTaskListSortable below).
  // Native draggable=true would double-fire and conflict with Sortable's
  // synthetic touch path on iOS, so we don't set it here anymore. The drop
  // target on calendar days (.cal-day) keeps its own native handlers — that
  // surface accepts a drop from a Sortable item without further config since
  // Sortable falls back to native dragstart on desktop.
  d.dataset.taskId=t.id;
  if(t.category&&dueCls!=='overdue'&&typeof getCategoryDef==='function'){
    const cdef=getCategoryDef(t.category);
    if(cdef&&cdef.color){
      d.classList.add('task-cat-stripe');
      d.style.setProperty('--cat-stripe',cdef.color);
    }
  }
  if(window._lastAddedTaskId===t.id){
    d.classList.add('task-item--enter');
    window._lastAddedTaskId=null;
    requestAnimationFrame(()=>{try{d.scrollIntoView({block:'nearest',behavior:'smooth'})}catch(_){}});
  }
  // Per-task ondragstart/over/leave/drop handlers were removed in the
  // Sortable migration. The container-level Sortable instance now owns
  // reorder; .drop-above/.drop-below visual hints are no longer used because
  // Sortable provides its own ghost/placeholder.
  d.onclick=function(e){
    if(e.target.closest('button')||e.target.closest('.task-chevron')||e.target.closest('.drag-handle')||e.target.closest('[data-action]'))return;
    if(typeof isBulkMode === 'function' && isBulkMode()){
      bulkToggleSelect(t.id);
      d.classList.toggle('task-bulk-selected', _bulkSelectedIds.has(t.id));
      return;
    }
    openTaskDetail(t.id)
  };
  // Reflect prior bulk selection on re-render
  if(typeof isBulkMode === 'function' && isBulkMode() && typeof _bulkSelectedIds !== 'undefined' && _bulkSelectedIds.has(t.id)){
    d.classList.add('task-bulk-selected');
  }
  // Swipe-to-complete for touch
  let touchStartX=0,touchStartY=0,touchCurrentX=0,swiping=false;
  d.addEventListener('touchstart',function(e){
    if(e.target.closest('button')||e.target.closest('input'))return;
    touchStartX=e.touches[0].clientX;touchStartY=e.touches[0].clientY;swiping=false;
  },{passive:true});
  d.addEventListener('touchmove',function(e){
    if(!touchStartX)return;
    touchCurrentX=e.touches[0].clientX;
    const dx=touchCurrentX-touchStartX,dy=e.touches[0].clientY-touchStartY;
    if(!swiping&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.5)swiping=true;
    if(swiping){
      if(e.cancelable)e.preventDefault();
      d.style.transform='translateX('+dx+'px)';
      d.style.transition='none';
      d.style.background=dx>0?'linear-gradient(90deg,var(--success-bg),var(--bg-1) 80%)':'linear-gradient(90deg,var(--bg-1) 20%,var(--danger-bg))';
    }
  },{passive:false});
  d.addEventListener('touchend',function(e){
    const dx=touchCurrentX-touchStartX;
    d.style.transition='transform .2s,background .2s';d.style.transform='';d.style.background='';
    if(swiping&&Math.abs(dx)>80){
      haptic(20);
      if(dx>0){toggleTaskDoneQuick(t.id)}
      else{removeTask(t.id)}
    }
    touchStartX=0;touchCurrentX=0;swiping=false;
  },{passive:true});

  // At rest: due chip (overdue / today / soon only) + subtask progress. Habits view: ↻ + streak. Rest on hover.
  const chevron=kids
    ?'<button class="task-chevron'+(t.collapsed?' collapsed':'')+'" data-action="toggleCollapse" data-arg="+t.id+" title="'+(t.collapsed?'Expand':'Collapse')+'">▸</button>'
    :'<span class="task-chevron-spacer"></span>';
  const checkbox='<button class="task-checkbox'+(isDone?' checked':'')+'" data-action="toggleTaskDoneQuick" data-arg="+t.id+" title="Mark done" aria-label="Mark task done">'+(isDone?'✓':'')+'</button>';

  let signalChips='';
  if(t.dueDate&&!isDone){
    const du=typeof describeDue==='function'?describeDue(t.dueDate):{label:fmtDue(t.dueDate),cls:dueCls};
    if(du&&du.cls&&(du.cls==='overdue'||du.cls==='today'||du.cls==='soon')){
      signalChips+='<span class="date-chip date-chip--'+du.cls+'">'+esc(du.label)+'</span>';
    }
  }
  const prog=getSubtaskProgress(t.id);
  if(prog) signalChips+='<span class="task-sig sig-subs" title="'+prog.done+' of '+prog.total+' subtasks done">'+prog.done+'/'+prog.total+'</span>';
  if(smartView==='habits'&&t.recur){
    signalChips+='<span class="task-sig sig-recur" title="Repeats '+escAttr(String(t.recur))+'">↻</span>';
    if(typeof getHabitStreak==='function'){
      const st=getHabitStreak(t);
      if(st>0) signalChips+='<span class="task-sig sig-streak" title="Consecutive days with a logged completion">'+st+'d</span>';
    }
  }

  const status=STATUSES[t.status||'open'];
  const showStatusOnHover=(t.status&&t.status!=='open')?'':'hidden-status';
  const statusBadge='<span class="status-badge '+status.cls+' '+showStatusOnHover+'" data-action="cycleStatus" data-args="['+t.id+']" title="Click to cycle status">'+status.label+'</span>';
  const tagsVisible=(t.tags||[]).slice(0,3).map(tg=>'<span class="tag-chip">'+esc(tg)+'</span>').join('');
  const descPrev=(t.description&&t.description.length>0)?'<span class="task-desc-inline">'+esc(t.description.slice(0,50))+(t.description.length>50?'…':'')+'</span>':'';

  const actions=t.archived
    ?'<button type="button" class="ta-btn ta-restore" data-action="restoreTask" data-args="['+t.id+']" title="Restore">↺</button>'
     +'<button type="button" class="ta-btn ta-del" data-action="removeTask" data-args="['+t.id+']" title="Delete permanently">×</button>'
    :'<button type="button" class="ta-btn ta-star'+(t.starred?' on':'')+'" data-action="toggleStar" data-args="['+t.id+']" title="'+(t.starred?'Unpin':'Pin to top')+'">'+(t.starred?'★':'☆')+'</button>'
     +'<button type="button" class="ta-btn ta-play '+(isActive?'on':'')+'" data-action="toggleTask" data-args="['+t.id+']" title="'+(isActive?'Stop timer':'Start timer')+'">'+(isActive?'■':'▶')+'</button>'
     +'<button type="button" class="ta-btn ta-sub" data-action="addSubtaskPrompt" data-args="['+t.id+']" title="Add subtask">+</button>'
     +'<button type="button" class="ta-btn ta-del" data-action="removeTask" data-args="['+t.id+']" title="Archive">×</button>';

  // Star pin — shown prominently only if starred (otherwise hidden in hover actions)
  const starPin=t.starred?'<span class="star-pin" title="Pinned">★</span>':'';

  const dragGrip=(typeof taskSortBy==='string'&&taskSortBy==='manual')
    ?'<span class="drag-handle" title="Drag to reorder">⠿</span>':'';
  d.innerHTML=
    '<div class="task-row-primary">'
      +dragGrip
      +chevron
      +checkbox
      +'<div class="task-main">'
        +starPin
        +'<span class="task-name">'+esc(t.name)+'</span>'
        +(signalChips?'<span class="task-signals">'+signalChips+'</span>':'')
      +'</div>'
      +'<div class="task-row-actions">'+actions+'</div>'
    +'</div>'
    +'<div class="task-row-secondary">'
      +statusBadge
      +(tagsVisible?'<span class="task-tags-inline">'+tagsVisible+'</span>':'')
      +descPrev
    +'</div>';
  list.appendChild(d)
}

function renderSubtaskForm(parentId,depth){
  const list=gid('taskList');
  const d=document.createElement('div');
  d.className='task-subtask-form';
  d.style.marginLeft=(depth*18)+'px';
  const inp=document.createElement('input');inp.className='task-sub-input';inp.dataset.parent=parentId;inp.placeholder='Subtask name...';
  inp.onkeydown=function(e){if(e.key==='Enter')addSubtask(parentId);if(e.key==='Escape')cancelSubtaskPrompt()};
  d.appendChild(inp);
  const btns=document.createElement('div');btns.className='task-sub-btns';
  const addBtn=document.createElement('button');addBtn.className='task-sub-btn task-sub-add';addBtn.textContent='Add';addBtn.onclick=function(){addSubtask(parentId)};btns.appendChild(addBtn);
  const cancelBtn=document.createElement('button');cancelBtn.className='task-sub-btn task-sub-cancel';cancelBtn.textContent='×';cancelBtn.onclick=function(){cancelSubtaskPrompt()};btns.appendChild(cancelBtn);
  d.appendChild(btns);
  list.appendChild(d);
  if(typeof _subtaskFormDraftParent==='number'&&_subtaskFormDraftParent===parentId&&typeof _subtaskFormDraftText==='string'){
    inp.value=_subtaskFormDraftText;
  }
  inp.addEventListener('input',()=>{
    _subtaskFormDraftText=inp.value;
    _subtaskFormDraftParent=parentId;
  });
}

// Kanban Board View
function renderBoard(visibleTasks){
  const board=gid('boardView');board.textContent='';
  const isMobile=window.matchMedia('(max-width:640px)').matches;
  STATUS_ORDER.forEach(st=>{
    const status=STATUSES[st];
    const colTasks=sortTasks(visibleTasks.filter(t=>(t.status||'open')===st));
    // On mobile, hide empty columns unless it's "open" (default drop target) or "done" (completed)
    if(isMobile&&colTasks.length===0&&st!=='open'&&st!=='done')return;
    const col=document.createElement('div');col.className='board-col';
    col.dataset.status=st;
    col.ondragover=function(e){e.preventDefault();e.dataTransfer.dropEffect='move';col.classList.add('drop-target')};
    col.ondragleave=function(){col.classList.remove('drop-target')};
    col.ondrop=function(e){
      e.preventDefault();col.classList.remove('drop-target');
      const srcId=parseInt(e.dataTransfer.getData('text/plain'),10);
      if(!Number.isFinite(srcId)||srcId<=0)return;
      const src=findTask(srcId);if(!src)return;
      if(src.status===st)return;
      const backup=JSON.parse(JSON.stringify(src));
      src.status=st;
      if(st==='done'){
        if(src.recur && typeof completeHabitCycle==='function'){completeHabitCycle(src)}
        else{src.completedAt=stampCompletion()}
      }
      else src.completedAt=null;
      renderTaskList();saveState('user');
      if(typeof showActionToast==='function'){
        showActionToast('Moved to '+STATUSES[st].label, 'Undo', ()=>{
          const u=findTask(srcId);
          if(u){Object.assign(u,backup);renderTaskList();saveState('user')}
        }, 4000);
      }
    };
    col.innerHTML='<div class="board-col-hdr"><span class="status-badge '+status.cls+'">'+status.label+'</span><span class="cc-count">'+colTasks.length+'</span></div><div class="board-col-body"></div>';
    const body=col.querySelector('.board-col-body');
    colTasks.forEach(t=>{
      const card=document.createElement('div');
      card.className='board-card priority-'+(t.priority||'none')+'-card';
      card.setAttribute('draggable','true');
      card.ondragstart=function(e){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.id);card.style.opacity='.4'};
      card.ondragend=function(){card.style.opacity='1'};
      card.onclick=function(){openTaskDetail(t.id)};
      const path=getTaskPath(t.id);
      const breadcrumb=path.length>1?'<div class="board-breadcrumb">'+esc(path.slice(0,-1).join(' › '))+'</div>':'';
      const dueIc=(typeof window.icon==='function')?window.icon('calendar',{size:12}):'';
      const ddc=t.dueDate&&typeof describeDue==='function'?describeDue(t.dueDate):{cls:getDueClass(t.dueDate),label:fmtDue(t.dueDate)};
      const dueMod=ddc&&ddc.cls?' date-chip--'+ddc.cls:'';
      const due=t.dueDate?'<span class="date-chip'+dueMod+'">'+dueIc+' '+esc(String(ddc.label||fmtDue(t.dueDate)||''))+'</span>':'';
      const tags=(t.tags||[]).slice(0,2).map(tg=>'<span class="tag-chip">'+esc(tg)+'</span>').join('');
      const time=getRolledUpTime(t.id)>0?'<span class="task-elapsed">'+fmtHMS(getRolledUpTime(t.id))+'</span>':'';
      card.innerHTML=breadcrumb
        +'<div class="board-card-name">'+esc(t.name)+'</div>'
        +'<div class="board-card-meta">'+due+tags+time+'</div>';

      // ── Touch drag-and-drop (mobile Kanban) ─────────────────────────────
      // Ghost-element pattern: clone the card at a fixed position that follows
      // the finger. elementFromPoint() (with ghost temporarily display:none)
      // resolves which board column is under the touch. Mirrors the mouse
      // ondragstart/ondrop path so status changes are committed identically.
      let _ghost=null,_srcCol=col,_overCol=null;
      function _applyDrop(dropSt){
        if(!dropSt||dropSt===(t.status||'open'))return;
        const src=findTask(t.id);if(!src)return;
        const backup=JSON.parse(JSON.stringify(src));
        src.status=dropSt;
        if(dropSt==='done'){
          if(src.recur&&typeof completeHabitCycle==='function')completeHabitCycle(src);
          else src.completedAt=stampCompletion();
        } else {
          src.completedAt=null;
        }
        if(typeof haptic==='function')haptic(30);
        renderTaskList();saveState('user');
        if(typeof showActionToast==='function'){
          showActionToast('Moved to '+STATUSES[dropSt].label, 'Undo', ()=>{
            const u=findTask(t.id);
            if(u){Object.assign(u,backup);renderTaskList();saveState('user')}
          }, 4000);
        }
      }
      card.addEventListener('touchstart',function(e){
        if(e.target.closest('button'))return;
        const r=card.getBoundingClientRect();
        _ghost=card.cloneNode(true);
        _ghost.style.cssText='position:fixed;top:'+r.top+'px;left:'+r.left+'px;width:'+r.width+'px;z-index:9999;pointer-events:none;opacity:.88;box-shadow:0 10px 32px rgba(0,0,0,.55);border-radius:var(--r-md,10px);transform:scale(1.04);transition:none';
        document.body.appendChild(_ghost);
        card.style.opacity='.28';
        e.preventDefault();
      },{passive:false});
      card.addEventListener('touchmove',function(e){
        if(!_ghost)return;
        const touch=e.touches[0];
        const gh=_ghost.getBoundingClientRect();
        _ghost.style.top=(touch.clientY-gh.height/2)+'px';
        _ghost.style.left=(touch.clientX-gh.width/2)+'px';
        _ghost.style.display='none';
        const el=document.elementFromPoint(touch.clientX,touch.clientY);
        _ghost.style.display='';
        const targetCol=el&&el.closest('.board-col');
        if(targetCol!==_overCol){
          if(_overCol)_overCol.classList.remove('drop-target');
          _overCol=targetCol||null;
          if(_overCol&&_overCol!==_srcCol)_overCol.classList.add('drop-target');
        }
        if(e.cancelable)e.preventDefault();
      },{passive:false});
      function _touchEnd(){
        if(!_ghost)return;
        _ghost.remove();_ghost=null;
        card.style.opacity='1';
        if(_overCol)_overCol.classList.remove('drop-target');
        const dropSt=_overCol?_overCol.dataset.status:null;
        _overCol=null;
        _applyDrop(dropSt);
      }
      card.addEventListener('touchend',_touchEnd,{passive:true});
      card.addEventListener('touchcancel',_touchEnd,{passive:true});
      // ── end touch DnD ────────────────────────────────────────────────────

      body.appendChild(card)
    });
    if(!colTasks.length){
      const empty=document.createElement('div');empty.className='board-col-empty';
      empty.textContent=isMobile ? 'No tasks' : 'Drop tasks here';body.appendChild(empty);
    }
    board.appendChild(col)
  })
}

// Task Detail Modal — chips commit immediately to the live task and persist
// via saveState. _taskModalSnapshot is a deep clone taken on open so close-
// without-save can revert the *text fields* (name, description, dates, url,
// notes) — but chip-driven fields (priority, effort, energy, category, type,
// recur, tags, status) are explicitly re-snapshotted on each commit so they
// are NOT reverted on cancel. This matches the user's mental model: clicking
// a chip looks like an immediate action, so it should be one. Typing into a
// textarea and bailing should still discard, hence the per-field handling.
let _taskModalSnapshot=null;
const TASK_MODAL_CHIP_FIELDS = ['priority','effort','energyLevel','category','type','recur','tags','status','completedAt','dueDate'];
// Commit a chip-driven mutation: persist via saveState, refresh the chip
// portion of the snapshot so closeTaskDetail's revert pass can't undo it,
// re-render the task list (so chips on the row update live), and pulse the
// existing save-indicator pill so the user gets visible "saved" feedback.
function _commitChipChange(t){
  if(!t || !_taskModalSnapshot) return;
  TASK_MODAL_CHIP_FIELDS.forEach(f => {
    const v = t[f];
    _taskModalSnapshot[f] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  });
  if(typeof saveState === 'function') saveState('user');
  if(typeof renderTaskList === 'function') renderTaskList();
  if(typeof showSaveIndicator === 'function') showSaveIndicator();
}
function openTaskDetail(id){
  const t=findTask(id);if(!t)return;
  _taskModalSnapshot=JSON.parse(JSON.stringify(t));
  editingTaskId=id;
  gid('mdName').value=t.name;
  gid('mdCheckbox').classList.toggle('checked',t.status==='done');
  gid('mdCheckbox').textContent=t.status==='done'?'✓':'';
  gid('mdDue').value=t.dueDate||'';
  if(gid('mdSnoozeUntil')) gid('mdSnoozeUntil').value=t.hiddenUntil||'';
  // Type chips (task / waiting / bug / idea / errand)
  const tChips=gid('mdTypeChips');
  if(tChips){
    tChips.replaceChildren();
    [['task','Task'],['waiting','Waiting on'],['bug','Bug'],['idea','Idea'],['errand','Errand']].forEach(([key,lbl])=>{
      const b=document.createElement('button');
      b.type='button';
      b.className='mfield-chip-btn'+((t.type||'task')===key?' active':'');
      b.textContent=lbl;
      b.onclick=function(){
        t.type=key;
        Array.from(tChips.children).forEach(c=>c.classList.remove('active'));
        b.classList.add('active');
        _commitChipChange(t);
      };
      tChips.appendChild(b);
    });
  }
  gid('mdStartDate').value=t.startDate||'';
  gid('mdEstimate').value=t.estimateMin||0;
  gid('mdDesc').value=t.description||'';
  gid('mdUrl').value=t.url||'';
  gid('mdCompletionNote').value=t.completionNote||'';
  if(gid('mdRemindAt'))gid('mdRemindAt').value=t.remindAt||'';
  gid('mdTracked').textContent=fmtHMS(getRolledUpTime(id))+' · '+getRolledUpSessions(id)+' sessions';
  const path=getTaskPath(id);
  const pathStr=path.length>1?path.slice(0,-1).join(' › ')+' › ':'';
  gid('mdStats').innerHTML='<span><b>Path:</b> '+esc(pathStr)+'<b class="md-name-strong">'+esc(t.name)+'</b></span> · <span>Created '+esc(t.created||'—')+'</span>'+(t.completedAt?' · <span>Done '+esc(String(t.completedAt))+'</span>':'');
  // List selector
  const listSel=gid('mdList');listSel.innerHTML='';
  lists.forEach(l=>{const opt=document.createElement('option');opt.value=l.id;opt.textContent=l.name;if((t.listId||lists[0].id)===l.id)opt.selected=true;listSel.appendChild(opt)});
  // Status chips
  const sChips=gid('mdStatusChips');sChips.innerHTML='';
  STATUS_ORDER.forEach(st=>{
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.status||'open')===st?' active':'');
    b.textContent=STATUSES[st].label;
    b.onclick=function(){
      if(st==='done'&&t.recur&&typeof completeHabitCycle==='function'){
        completeHabitCycle(t);
        gid('mdCheckbox').classList.remove('checked');gid('mdCheckbox').textContent='';
        [...sChips.children].forEach((c,i)=>c.classList.toggle('active',STATUS_ORDER[i]==='open'));
        renderMdHabitLog(t);
        renderMdSessions(t);
        gid('mdTracked').textContent=fmtHMS(getRolledUpTime(t.id))+' · '+getRolledUpSessions(t.id)+' sessions';
      }else{
        t.status=st;
        if(st==='done' && !t.completedAt && typeof stampCompletion === 'function') t.completedAt = stampCompletion();
        if(st!=='done') t.completedAt = null;
        gid('mdCheckbox').classList.toggle('checked',st==='done');gid('mdCheckbox').textContent=st==='done'?'✓':'';
        [...sChips.children].forEach(c=>c.classList.remove('active'));b.classList.add('active');
      }
      _commitChipChange(t);
    };
    sChips.appendChild(b)
  });
  // Priority chips
  const pChips=gid('mdPriorityChips');pChips.innerHTML='';
  ['urgent','high','normal','low','none'].forEach(pr=>{
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.priority||'none')===pr?' active':'');
    b.style.color=pr!=='none'?({urgent:'#c0392b',high:'#e67e22',normal:'#3d8bcc',low:'#7f8c8d'}[pr]):'';
    b.textContent=PRIORITIES[pr].label;
    b.onclick=function(){t.priority=pr;[...pChips.children].forEach(c=>c.classList.remove('active'));b.classList.add('active');_commitChipChange(t)};
    pChips.appendChild(b)
  });
  // Effort chips
  const eChips=gid('mdEffortChips');eChips.innerHTML='';
  [['xs','XS'],['s','S'],['m','M'],['l','L'],['xl','XL']].forEach(([key,lbl])=>{
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.effort||null)===key?' active':'');
    b.textContent=lbl;b.title={xs:'Extra small (~15min)',s:'Small (~1hr)',m:'Medium (~half day)',l:'Large (~full day)',xl:'Extra large (multi-day)'}[key];
    b.onclick=function(){t.effort=t.effort===key?null:key;[...eChips.children].forEach(c=>c.classList.remove('active'));if(t.effort===key||!t.effort){}else b.classList.add('active');renderEffortChips(t,eChips);_commitChipChange(t)};
    eChips.appendChild(b)
  });
  // Energy chips
  const enChips=gid('mdEnergyChips');enChips.innerHTML='';
  [['high','High energy'],['low','Low energy']].forEach(([key,lbl])=>{
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.energyLevel||null)===key?' active':'');
    b.textContent=lbl;
    b.onclick=function(){t.energyLevel=t.energyLevel===key?null:key;[...enChips.children].forEach(c=>c.classList.remove('active'));if(t.energyLevel)b.classList.add('active');_commitChipChange(t)};
    enChips.appendChild(b)
  });
  // Recurrence — calendar-relative (daily/weekly/...) plus C-5 after-completion variants
  const rc=gid('mdRecur');if(rc){rc.replaceChildren();
    [
      ['none','No repeat'],
      ['daily','Daily'],['weekdays','Weekdays'],['weekly','Weekly'],['monthly','Monthly'],
      ['after1d','After 1d'],['after3d','After 3d'],['after7d','After 7d'],['after14d','After 14d'],['after30d','After 30d'],
    ].forEach(([key,lbl])=>{
      const b=document.createElement('button');b.className='recur-opt'+((t.recur||'none')===key?' active':'');
      b.textContent=lbl;
      if(key && key.startsWith('after')) b.title='Schedule next due ' + key.replace(/^after(\d+)d$/, '$1 day(s)') + ' AFTER completion (won\'t pile up if you finish late)';
      b.onclick=function(){
        t.recur=key==='none'?null:key;
        [...rc.children].forEach(c=>c.classList.remove('active'));
        b.classList.add('active');
        // First-time recurrence on a task with no due date defaults to today
        // so it actually shows up in Today / Habits views immediately.
        if(t.recur && !t.dueDate && typeof todayISO === 'function') t.dueDate = todayISO();
        _commitChipChange(t);
      };
      rc.appendChild(b)
    })
  }
  // Tags
  renderTagsEditor(id);
  // Category chips
  const catChips=gid('mdCategoryChips');catChips.innerHTML='';
  const catList=(typeof getActiveCategories==='function')?getActiveCategories():[];
  catList.forEach(row=>{
    const key=row.id,lbl=row.label||row.id;
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.category||null)===key?' active':'');
    b.textContent=lbl;
    const cdef=(typeof getCategoryDef==='function')?getCategoryDef(key):null;
    if(cdef&&cdef.color){
      b.style.borderColor='color-mix(in srgb, '+cdef.color+' 40%, var(--border))';
      b.style.color=cdef.color;
    }
    if(cdef){
      const tip=((cdef.label||key)+(cdef.focus?': '+(cdef.focus):'')+((cdef.examples&&cdef.examples.length)?' · e.g. '+cdef.examples.slice(0,3).join(', '):'')).slice(0,280);
      if(tip) b.setAttribute('title', tip);
    }
    b.onclick=function(){t.category=t.category===key?null:key;[...catChips.children].forEach(c=>c.classList.remove('active'));if(t.category)b.classList.add('active');_commitChipChange(t)};
    catChips.appendChild(b)
  });
  const vn=gid('mdValuesNote');if(vn)vn.textContent=t.valuesNote||'';
  // C-1: visible task ID badge near the task name
  if(typeof renderTaskIdBadge === 'function') renderTaskIdBadge(t);
  // Checklist (legacy single + C-7 multiple named groups)
  renderChecklist(id);
  if(typeof renderChecklistGroups === 'function') renderChecklistGroups(id);
  // Notes
  renderTaskNotes(id);
  // Blocked by
  renderBlockedBy(id);
  // C-9 related tasks (non-blocking links)
  if(typeof renderRelatedTasks === 'function') renderRelatedTasks(id);
  // C-2 activity log
  if(typeof renderTaskActivity === 'function') renderTaskActivity(t);
  // C-6 estimate vs actual variance
  if(typeof renderEstimateVariance === 'function') renderEstimateVariance(t);
  refreshMdSimilarTasks(id);
  // Show the Break-down accordion only when a generative model is loaded.
  // Content is lazy-rendered on toggle to avoid spending tokens unless asked.
  const bdWrap = gid('mdBreakdownWrap');
  if(bdWrap){
    const llmOn = typeof isGenReady === 'function' && isGenReady();
    bdWrap.hidden = !(llmOn);
    const bdAcc = gid('mdBreakdownAccordion');
    if(bdAcc) bdAcc.classList.remove('open');
    const bdBody = gid('mdBreakdownBody');
    if(bdBody){ bdBody.textContent = ''; delete bdBody.dataset.loaded; }
  }
  renderMdHabitLog(t);
  renderMdSessions(t);
  gid('taskModal').classList.add('open');
  _taskModalPrevFocus=document.activeElement;
  document.addEventListener('keydown',_taskModalTabTrap,true);
  setTimeout(()=>gid('mdName').focus(),50)
}

/**
 * Per-task session history. Renders one entry per timer session that recorded
 * to t.sessionEntries (timer.js writes these on phase complete + skip). Hidden
 * gracefully when the task has no sessions yet so empty tasks don't show a
 * useless empty list.
 */
function renderMdSessions(t){
  const el = gid('mdSessions');
  const wrap = gid('mdSessionsWrap');
  if(!el) return;
  const entries = (t && Array.isArray(t.sessionEntries)) ? t.sessionEntries : [];
  if(!entries.length){
    el.replaceChildren();
    if(wrap) wrap.hidden = true;
    return;
  }
  if(wrap) wrap.hidden = false;
  el.replaceChildren();
  // Show newest first, cap at 30 visible to keep the modal scrollable.
  const recent = entries.slice(-30).reverse();
  const ul = document.createElement('ul');
  ul.className = 'md-sessions-list';
  recent.forEach(s => {
    const li = document.createElement('li');
    li.className = 'md-sessions-item' + (s.type === 'work-partial' ? ' md-sessions-item--partial' : '');
    const ts = document.createElement('span');
    ts.className = 'md-sessions-ts';
    // Format: "Apr 27, 2:34 PM" — small but parseable. timeNowFull stores
    // ISO so Date(s.ts) is safe.
    try{
      const d = new Date(s.ts);
      ts.textContent = d.toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
    }catch(_){ ts.textContent = String(s.ts || ''); }
    const dur = document.createElement('span');
    dur.className = 'md-sessions-dur';
    dur.textContent = (typeof fmtHMS === 'function') ? fmtHMS(s.durationSec || 0) : (s.durationSec || 0) + 's';
    li.append(ts, dur);
    if(s.type === 'work-partial'){
      const tag = document.createElement('span');
      tag.className = 'md-sessions-tag';
      tag.textContent = 'partial';
      li.appendChild(tag);
    }
    ul.appendChild(li);
  });
  if(entries.length > 30){
    const more = document.createElement('li');
    more.className = 'md-sessions-more';
    more.textContent = '+ ' + (entries.length - 30) + ' earlier sessions';
    ul.appendChild(more);
  }
  el.appendChild(ul);
}

function renderMdHabitLog(t){
  const el=gid('mdHabitLog');
  if(!el)return;
  if(!t||!t.recur||!Array.isArray(t.completions)||!t.completions.length){
    el.textContent='';const hint=document.createElement('span');hint.className='intel-muted';hint.textContent='Completion history appears after you finish a repeating task.';el.appendChild(hint);
    return;
  }
  const rows=t.completions.slice(-14).reverse();
  const sum=(typeof getHabitLoggedSecTotal==='function')?getHabitLoggedSecTotal(t):0;
  el.textContent='';
  const sumDiv=document.createElement('div');sumDiv.className='habit-log-sum';sumDiv.textContent='Logged in completions: ';
  const sumStrong=document.createElement('strong');sumStrong.textContent=fmtHMS(sum);sumDiv.appendChild(sumStrong);el.appendChild(sumDiv);
  const ul=document.createElement('ul');ul.className='habit-log-list';
  rows.forEach(c=>{const li=document.createElement('li');const ds=document.createElement('span');ds.textContent=c.date;li.appendChild(ds);li.append(' · '+fmtHMS(c.sec||0));ul.appendChild(li)});
  el.appendChild(ul);
}

async function refreshMdSimilarTasks(id){
  const body = gid('mdSimilarTasks');
  const acc = gid('mdSimilarAccordion');
  if(!body) return;
  if(typeof isIntelReady !== 'function' || !isIntelReady()){
    body.textContent='';const m1=document.createElement('span');m1.className='intel-muted';m1.textContent='Load the model (AI chip or Tools → Task understanding) for similar tasks.';body.appendChild(m1);
    if(acc) acc.classList.remove('open');
    return;
  }
  body.textContent='';const m2=document.createElement('span');m2.className='intel-muted';m2.textContent='Finding neighbors…';body.appendChild(m2);
  try{
    const sim = await similarTasksFor(id, 5);
    if (editingTaskId !== id) return;
    if(!sim.length){
      body.textContent='';const m3=document.createElement('span');m3.className='intel-muted';m3.textContent='No similar tasks found yet.';body.appendChild(m3);
      return;
    }
    body.textContent='';
    sim.forEach(({ t: ot, sim: s }) => {
      const btn=document.createElement('button');btn.type='button';btn.className='similar-task-row';
      btn.onclick=function(){closeTaskDetail();openTaskDetail(parseInt(ot.id,10)||0)};
      const nm=document.createElement('span');nm.className='st-name';nm.textContent=ot.name.slice(0,48);btn.appendChild(nm);
      const sc=document.createElement('span');sc.className='st-sim';sc.textContent=s.toFixed(2);btn.appendChild(sc);
      body.appendChild(btn);
    });
    if(acc) acc.classList.add('open');
  }catch(e){
    if (editingTaskId !== id) return;
    body.textContent='';const m4=document.createElement('span');m4.className='intel-muted';m4.textContent='Could not load neighbors.';body.appendChild(m4);
  }
}


function renderEffortChips(t,eChips){
  [...eChips.children].forEach(b=>{b.classList.toggle('active',b.textContent.toLowerCase()===t.effort)})
}

function renderTagsEditor(id){
  const t=findTask(id);if(!t)return;
  const ed=gid('mdTagsEditor');ed.textContent='';
  (t.tags||[]).forEach((tag,i)=>{
    const chip=document.createElement('span');chip.className='tag-edit-chip';
    chip.textContent=tag;
    const rm=document.createElement('span');rm.className='tag-rm';rm.textContent='×';rm.onclick=function(){removeTag(id,i)};chip.appendChild(rm);
    ed.appendChild(chip)
  });
  const inp=document.createElement('input');inp.className='tag-input';inp.placeholder='+ tag';
  inp.onkeydown=function(e){if(e.key==='Enter'&&inp.value.trim()){addTag(id,inp.value.trim());inp.value=''}};
  ed.appendChild(inp)
}
function addTag(id,tag){const t=findTask(id);if(!t)return;if(!t.tags)t.tags=[];if(!t.tags.includes(tag))t.tags.push(tag);renderTagsEditor(id);_commitChipChange(t)}
function removeTag(id,idx){const t=findTask(id);if(!t||!t.tags)return;t.tags.splice(idx,1);renderTagsEditor(id);_commitChipChange(t)}

let _taskModalPrevFocus=null;
function _taskModalTabTrap(e){
  const modal=gid('taskModal');
  if(!modal||!modal.classList.contains('open')||e.key!=='Tab')return;
  const panel=modal.querySelector('.modal');
  if(!panel)return;
  const f=[...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled&&el.offsetParent!==null);
  if(f.length<2)return;
  const first=f[0],last=f[f.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
}
// Snapshot-vs-form-fields divergence check. Only the *text/number* form
// fields gate the discard-confirm — chip edits already committed via
// _commitChipChange aren't considered "unsaved". Returns true when the user
// has typed or changed an input that would be lost on revert.
function _taskModalHasUnsavedTextEdits(){
  if(!_taskModalSnapshot) return false;
  const pairs = [
    ['mdName',         _taskModalSnapshot.name         || ''],
    ['mdDesc',         _taskModalSnapshot.description  || ''],
    ['mdUrl',          _taskModalSnapshot.url          || ''],
    ['mdCompletionNote', _taskModalSnapshot.completionNote || ''],
    ['mdDue',          _taskModalSnapshot.dueDate      || ''],
    ['mdStartDate',    _taskModalSnapshot.startDate    || ''],
    ['mdSnoozeUntil',  _taskModalSnapshot.hiddenUntil  || ''],
    ['mdRemindAt',     _taskModalSnapshot.remindAt     || ''],
    ['mdEstimate',     String(_taskModalSnapshot.estimateMin ?? 0)],
  ];
  for(const [id, baseline] of pairs){
    const el = gid(id);
    if(!el) continue;
    const cur = (id === 'mdName' || id === 'mdUrl' || id === 'mdCompletionNote') ? (el.value||'').trim() : (el.value||'');
    const base = (id === 'mdName' || id === 'mdUrl' || id === 'mdCompletionNote') ? String(baseline).trim() : String(baseline);
    if(cur !== base) return true;
  }
  return false;
}
async function closeTaskDetail(opts){
  const skipRevert=opts&&opts.skipRevert;
  // Confirm before discarding text/number edits the user typed but didn't
  // save. Chip edits aren't gated by this — they were already committed.
  if(!skipRevert && _taskModalSnapshot && _taskModalHasUnsavedTextEdits() && typeof showAppConfirm === 'function'){
    const ok = await showAppConfirm('Discard unsaved text edits?');
    if(!ok) return;
  }
  if(!skipRevert&&_taskModalSnapshot&&editingTaskId!=null){
    const id=editingTaskId,si=tasks.findIndex(x=>x.id===id);
    if(si>=0){
      const snap=JSON.parse(JSON.stringify(_taskModalSnapshot));
      tasks[si]=snap;
    }
  }
  _taskModalSnapshot=null;
  const _modalEl=gid('taskModal');
  _modalEl.classList.remove('open');
  // Reset any leftover swipe-drag transform from the bottom-sheet gesture so
  // the next open starts cleanly.
  const _sheet=_modalEl&&_modalEl.querySelector('.modal');
  if(_sheet){_sheet.style.transform='';_sheet.style.transition=''}
  if(!skipRevert) renderTaskList();
  editingTaskId=null;
  document.removeEventListener('keydown',_taskModalTabTrap,true);
  if(_taskModalPrevFocus&&_taskModalPrevFocus.focus)try{_taskModalPrevFocus.focus()}catch(e){}
  _taskModalPrevFocus=null;
  if(typeof _updateActiveTaskTickSchedule==='function')_updateActiveTaskTickSchedule();
}

// ── Bottom-sheet swipe-to-dismiss ──────────────────────────────────────────
// On mobile (<640px) the .modal renders as a bottom sheet. Swipe down on the
// sheet header to dismiss — matches iOS / Android conventions. Header-only so
// scrolling the body doesn't accidentally trigger a dismiss.
function _initTaskModalSwipeDismiss(){
  const overlay=gid('taskModal');
  if(!overlay||overlay.dataset.swipeBound==='1') return;
  const sheet=overlay.querySelector('.modal');
  const head=overlay.querySelector('.modal-head');
  if(!sheet||!head) return;
  let startY=null,deltaY=0,active=false;
  const isSheetMode=()=>matchMedia('(max-width:640px)').matches;
  const onStart=(e)=>{
    if(!isSheetMode()) return;
    const t=e.touches?e.touches[0]:e;
    startY=t.clientY;deltaY=0;active=true;
    sheet.style.transition='none';
  };
  const onMove=(e)=>{
    if(!active||startY==null) return;
    const t=e.touches?e.touches[0]:e;
    const dy=t.clientY-startY;
    if(dy<0){deltaY=0;sheet.style.transform='';return}
    deltaY=dy;
    sheet.style.transform='translateY('+dy+'px)';
    if(e.cancelable) e.preventDefault();
  };
  const onEnd=()=>{
    if(!active) return;
    active=false;
    sheet.style.transition='transform .2s ease-out';
    if(deltaY>120){
      // Animate to fully off-screen, then close (close also resets transform).
      sheet.style.transform='translateY(110%)';
      setTimeout(()=>closeTaskDetail(),180);
    }else{
      sheet.style.transform='';
    }
    startY=null;deltaY=0;
  };
  head.addEventListener('touchstart',onStart,{passive:true});
  head.addEventListener('touchmove',onMove,{passive:false});
  head.addEventListener('touchend',onEnd,{passive:true});
  head.addEventListener('touchcancel',onEnd,{passive:true});
  overlay.dataset.swipeBound='1';
}
window._initTaskModalSwipeDismiss=_initTaskModalSwipeDismiss;
function saveTaskDetail(){
  if(!editingTaskId)return;
  const t=findTask(editingTaskId);if(!t)return;
  // C-2: snapshot the fields we'll diff against post-save so we can append
  // a per-field activity entry. Snapshot is a shallow copy of relevant fields.
  const _activityBefore = {
    name: t.name, dueDate: t.dueDate, hiddenUntil: t.hiddenUntil, startDate: t.startDate,
    estimateMin: t.estimateMin, description: t.description, url: t.url,
    completionNote: t.completionNote, remindAt: t.remindAt, listId: t.listId,
    status: t.status, priority: t.priority, category: t.category,
    effort: t.effort, energyLevel: t.energyLevel, type: t.type,
    starred: t.starred,
    tags: Array.isArray(t.tags) ? t.tags.slice() : [],
    valuesAlignment: Array.isArray(t.valuesAlignment) ? t.valuesAlignment.slice() : [],
    relatedTo: Array.isArray(t.relatedTo) ? t.relatedTo.slice() : [],
    recur: t.recur,
  };
  try{
  if(t.recur&&t.status==='done'&&typeof completeHabitCycle==='function'&&!t._habitCycledInSession){
    completeHabitCycle(t);
    gid('mdCheckbox').classList.remove('checked');gid('mdCheckbox').textContent='';
  }
  t.name=gid('mdName').value.trim()||t.name;
  t.dueDate=gid('mdDue').value||null;
  if(gid('mdSnoozeUntil')) t.hiddenUntil=gid('mdSnoozeUntil').value||null;
  t.startDate=gid('mdStartDate').value||null;
  t.estimateMin=parseInt(gid('mdEstimate').value)||0;
  t.description=gid('mdDesc').value;
  t.url=gid('mdUrl').value.trim()||null;
  t.completionNote=gid('mdCompletionNote').value.trim()||null;
  const ra=gid('mdRemindAt')?gid('mdRemindAt').value:'';
  if(ra!==t.remindAt){t.remindAt=ra||null;t.reminderFired=false}
  t.listId=parseInt(gid('mdList').value)||t.listId;
  if(t.status==='done'&&!t.completedAt)t.completedAt=stampCompletion();
  if(t.status!=='done')t.completedAt=null;
  // C-2: record diffs into task.activity[] (cap at 50 entries)
  if(typeof recordTaskActivity === 'function') recordTaskActivity(t, _activityBefore);
  _taskModalSnapshot=null;
  gid('taskModal').classList.remove('open');
  editingTaskId=null;
  document.removeEventListener('keydown',_taskModalTabTrap,true);
  if(_taskModalPrevFocus&&_taskModalPrevFocus.focus)try{_taskModalPrevFocus.focus()}catch(e){}
  _taskModalPrevFocus=null;
  }finally{
    try{ delete t._habitCycledInSession; }catch(e){}
  }
  renderTaskList();
  saveState('user');
  if(typeof _updateActiveTaskTickSchedule==='function')_updateActiveTaskTickSchedule();
}
function deleteTaskFromModal(){
  if(!editingTaskId)return;
  const id=editingTaskId;closeTaskDetail({skipRevert:true});removeTask(id);
}
function toggleTaskDone(){
  if(!editingTaskId)return;
  const t=findTask(editingTaskId);if(!t)return;
  if(t.status==='done'){t.status='open';t.completedAt=null;gid('mdCheckbox').classList.remove('checked');gid('mdCheckbox').textContent=''}
  else if(t.recur&&typeof completeHabitCycle==='function'){
    completeHabitCycle(t);
    gid('mdCheckbox').classList.remove('checked');gid('mdCheckbox').textContent='';
    renderMdHabitLog(t);
    renderMdSessions(t);
    gid('mdTracked').textContent=fmtHMS(getRolledUpTime(t.id))+' · '+getRolledUpSessions(t.id)+' sessions';
  }else{t.status='done';t.completedAt=stampCompletion();gid('mdCheckbox').classList.add('checked');gid('mdCheckbox').textContent='✓'}
  // Update status chips
  const sChips=gid('mdStatusChips');if(sChips){[...sChips.children].forEach((c,i)=>c.classList.toggle('active',STATUS_ORDER[i]===t.status))}
  _commitChipChange(t);
}

function renderBanner(){
  const b=gid('banner');
  if(!activeTaskId){b.hidden = true;return}
  const t=findTask(activeTaskId);if(!t){b.hidden = true;return}
  b.hidden = false;
  const path=getTaskPath(activeTaskId);
  const bel=gid('bannerTask');
  if(path.length>1){
    bel.textContent='';const bc=document.createElement('span');bc.className='task-breadcrumb';bc.textContent=path.slice(0,-1).join(' › ')+' › ';bel.appendChild(bc);bel.append(t.name);
  }else{
    bel.textContent=t.name;
  }
  gid('bannerTime').textContent=fmtHMS(getTaskElapsed(t))
}
/** H1: Previously this re-rendered the whole task list every second, which
 *  burned CPU and reset scroll/hover state on long lists. Now we only patch
 *  the active row's live-time chip and re-render the floating banner. If the
 *  active row isn't currently rendered (filtered out, archive view, etc.),
 *  we silently no-op. A full render still happens on real state changes. */
function _tickActiveTaskRow(){
  if(!activeTaskId) return;
  const t=findTask(activeTaskId);
  if(!t){ renderBanner(); return; }
  const row=document.querySelector('.task-item[data-task-id="'+activeTaskId+'"]');
  if(row){
    let chip=row.querySelector('.sig-active');
    const elapsed=fmtHMS(getRolledUpTime(t.id));
    if(chip){
      chip.textContent='● '+elapsed;
    }else{
      const signals=row.querySelector('.task-signals');
      if(signals){
        chip=document.createElement('span');
        chip.className='task-sig sig-active';
        chip.title='Tracking time';
        chip.textContent='● '+elapsed;
        signals.appendChild(chip);
      }
    }
  }
  renderBanner();
}
let _activeTaskTickId=null;
function _updateActiveTaskTickSchedule(){
  if(activeTaskId){
    if(!_activeTaskTickId) _activeTaskTickId=setInterval(_tickActiveTaskRow,1000);
  }else if(_activeTaskTickId){
    clearInterval(_activeTaskTickId);
    _activeTaskTickId=null;
  }
}
window._updateActiveTaskTickSchedule=_updateActiveTaskTickSchedule;

// ========== APP DIALOGS (replace native confirm/prompt) ==========
let _appConfirmResolve=null;
function closeAppConfirm(ok){
  const ov=gid('appConfirmModal');
  if(ov) ov.classList.remove('open');
  const fn=_appConfirmResolve;
  _appConfirmResolve=null;
  if(fn) fn(!!ok);
}
function showAppConfirm(message){
  return new Promise(resolve=>{
    const ov=gid('appConfirmModal'), m=gid('appConfirmMessage');
    if(!ov||!m){ resolve(confirm(message)); return; }
    m.textContent=message;
    _appConfirmResolve=resolve;
    ov.classList.add('open');
    setTimeout(()=>{const b=gid('appConfirmOk');if(b)b.focus()},30);
  });
}
let _appPromptResolve=null,_appPromptMultiline=false;
function _appPromptTextareaKeydown(e){
  if(!_appPromptMultiline) return;
  if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){
    e.preventDefault();
    submitAppPrompt();
  }
}
function closeAppPrompt(val){
  const multi=gid('appPromptTextarea');
  if(multi && multi._appPromptKd){
    multi.removeEventListener('keydown', multi._appPromptKd);
    multi._appPromptKd=null;
  }
  const ov=gid('appPromptModal');
  if(ov) ov.classList.remove('open');
  const fn=_appPromptResolve;
  _appPromptResolve=null;
  _appPromptMultiline=false;
  if(fn) fn(val);
}
function submitAppPrompt(){
  const single=gid('appPromptInput'), multi=gid('appPromptTextarea');
  let v='';
  if(_appPromptMultiline&&multi) v=multi.value;
  else if(single) v=single.value;
  closeAppPrompt(v);
}
function showAppPrompt(label, defaultValue, opts){
  opts=opts||{};
  return new Promise(resolve=>{
    const ov=gid('appPromptModal'), lb=gid('appPromptLabel'), single=gid('appPromptInput'), multi=gid('appPromptTextarea');
    if(!ov||!lb){ resolve(prompt(label, defaultValue||'')||null); return; }
    const useMulti=!!opts.multiline;
    _appPromptMultiline=useMulti;
    lb.textContent=label;
    if(lb.setAttribute) lb.setAttribute('for', useMulti ? 'appPromptTextarea' : 'appPromptInput');
    if(single){ single.hidden = !!(useMulti); single.value=defaultValue||'' }
    if(multi){
      if(multi._appPromptKd){ multi.removeEventListener('keydown', multi._appPromptKd); multi._appPromptKd=null }
      multi.hidden = !(useMulti);
      multi.value=defaultValue||'';
      if(useMulti){
        multi._appPromptKd=_appPromptTextareaKeydown;
        multi.addEventListener('keydown', multi._appPromptKd);
      }
    }
    _appPromptResolve=resolve;
    ov.classList.add('open');
    setTimeout(()=>{(useMulti?multi:single)?.focus()},30);
  });
}
window.closeAppConfirm=closeAppConfirm;
window.closeAppPrompt=closeAppPrompt;
window.submitAppPrompt=submitAppPrompt;
window.showAppConfirm=showAppConfirm;
window.showAppPrompt=showAppPrompt;

document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  const ac=gid('appConfirmModal');
  if(ac&&ac.classList.contains('open')){ e.preventDefault(); closeAppConfirm(false); return }
  const ap=gid('appPromptModal');
  if(ap&&ap.classList.contains('open')){ e.preventDefault(); closeAppPrompt(null); return }
  const cmdk=gid('cmdkOverlay');
  if(cmdk&&cmdk.classList.contains('open')){ e.preventDefault(); if(typeof closeCmdK==='function') closeCmdK(); return }
  const wno=gid('whatNextOverlay');
  if(wno && !wno.hidden){ e.preventDefault(); if(typeof closeWhatNext==='function') closeWhatNext(); return }
  const bulk=gid('bulkImportModal');
  if(bulk&&bulk.classList.contains('open')){ e.preventDefault(); if(typeof closeBulkImportModal==='function') closeBulkImportModal(); return }
  const tm=gid('taskModal');
  if(tm&&tm.classList.contains('open')){ e.preventDefault(); closeTaskDetail(); }
});

// ========== LOG ==========
function addLog(name,durSec,type){timeLog.unshift({id:++logIdCtr,name,durSec,type,time:timeNow()});renderLog();saveState('user')}
function removeLog(id){timeLog=timeLog.filter(l=>l.id!==id);renderLog();saveState('user')}
function renderLog(){const list=gid('logList');list.querySelectorAll('.log-item').forEach(e=>e.remove());if(!timeLog.length){gid('logEmpty').hidden = false;return}gid('logEmpty').hidden = true;timeLog.slice(0,40).forEach(l=>{const d=document.createElement('div');d.className='log-item';const col=l.type==='work'?'var(--work)':l.type==='short'?'var(--short)':l.type==='quick'?'#48b5e0':'var(--long)';const lid=l.id||0;const dot=document.createElement('div');dot.className='log-dot';dot.style.background=col;d.appendChild(dot);const nm=document.createElement('span');nm.className='log-name';nm.textContent=l.name;d.appendChild(nm);const dur=document.createElement('span');dur.className='log-dur';dur.textContent=fmtShort(l.durSec);d.appendChild(dur);const tm=document.createElement('span');tm.className='log-time';tm.textContent=l.time;d.appendChild(tm);if(lid){const del=document.createElement('button');del.className='log-del';del.title='Remove';del.textContent='�';del.onclick=function(){removeLog(lid)};d.appendChild(del)}list.appendChild(d)})}
function clearLog(){timeLog=[];renderLog();saveState('user')}

// ========== TAB NAVIGATION ==========
function showTab(tab){
  if(typeof closeCmdK==='function')closeCmdK();
  activeTab=tab;
  document.querySelectorAll('[data-tab]').forEach(el=>{el.hidden = !(el.dataset.tab===tab)});
  document.querySelectorAll('.nav-tab').forEach(el=>{
    const on=el.dataset.navtab===tab;
    el.classList.toggle('active',on);
    el.setAttribute('aria-selected',on?'true':'false');
    // aria-current also marks navigation membership for screen readers that
    // navigate by page/section (in addition to the tablist's aria-selected).
    if(on) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');
  });
  if(tab==='settings'){
    // Refresh the dynamic sub-managers so legacy data (renamed categories,
    // newly added lists) shows up immediately when the tab is opened.
    if(typeof renderClassificationSettings==='function') renderClassificationSettings();
    if(typeof renderListsManager==='function') renderListsManager();
  }
  const nav=gid('navTabs');
  if(nav&&nav.getBoundingClientRect().top<0){
    window.scrollTo({top:nav.offsetTop-20,behavior:'smooth'});
  }
  if(tab==='focus'&&typeof setTimerSub==='function') setTimerSub(cfg.timerSub||'pomo');
  updateMiniTimer();
  saveState('auto');
}

// Mark panels as "entered" after initial animation so repeat visits don't re-trigger
(function(){
  let _enteredTabs = {};
  const _origShowTab = window.showTab;
  window.showTab = function(tab) {
    _origShowTab(tab);
    if(!_enteredTabs[tab]) {
      const panel = document.querySelector('[data-tab="' + tab + '"]:not([hidden])');
      if(panel) {
        setTimeout(() => {
          panel.setAttribute('data-panel-entered', '1');
          _enteredTabs[tab] = true;
        }, 360);
      }
    }
  };
})();

// Session completion summary: celebrate work phase completion with closure toast
window.showPomodoroSummary=function(){
  const pomosToday=window.totalPomos||0;
  const activeId=window.activeTaskId;
  let taskName='';
  if(activeId&&typeof window.findTask==='function'){
    const t=window.findTask(activeId);
    taskName=t?.name||'';
  }
  const msg=taskName?'Focus session complete — '+taskName:'Focus session complete!';
  if(typeof window.showActionToast==='function'){
    window.showActionToast(msg+(pomosToday>1?' · '+pomosToday+' today':''),null,null,5000);
  }
};

// ========== FLOATING MINI TIMER ==========
// Show the mini-timer when not on the Timer (focus) tab. Click it to jump to Timer.
window.toggleSimilarAccordion = function(){
  const acc = gid('mdSimilarAccordion');
  if(acc) acc.classList.toggle('open');
};

window.toggleBreakdownAccordion = function(){
  const acc = gid('mdBreakdownAccordion');
  if(!acc) return;
  const opening = !acc.classList.contains('open');
  acc.classList.toggle('open');
  // Lazy-load suggestions the first time the user opens the accordion.
  const body = gid('mdBreakdownBody');
  if(opening && body && !body.dataset.loaded){
    if(typeof runMdBreakdown === 'function') runMdBreakdown();
  }
};

function updateMiniTimer(){
  const el=gid('miniTimer');if(!el)return;
  // Hide on the Timer tab (the full timer is already visible there)
  if(activeTab==='focus'){el.classList.remove('visible');return}
  el.classList.add('visible');
  // Phase styling
  el.classList.remove('work','short','long');el.classList.add(phase);
  const dot=gid('mtDot');dot.classList.remove('work','short','long','running');
  dot.classList.add(phase);if(running)dot.classList.add('running');
  // Label & time
  gid('mtLabel').textContent=getPL(phase);
  const timeEl=gid('mtTime');
  timeEl.textContent=fmt(remaining);
  timeEl.classList.remove('warn','done');
  if(finished)timeEl.classList.add('done');
  else if(remaining<=10&&running)timeEl.classList.add('warn');
  // Button state
  const btn=gid('mtToggle');
  btn.classList.remove('mt-play','mt-pause');
  if(running){btn.classList.add('mt-pause');btn.textContent='⏸'}
  else if(finished){btn.classList.add('mt-play');btn.textContent='↻'}
  else{btn.classList.add('mt-play');btn.textContent='▶'}
}
function miniTimerToggle(){
  if(finished){advancePhase();return}
  if(running)pauseTimer();
  else if(remaining<totalDuration&&remaining>0)resumeTimer();
  else startTimer();
  updateMiniTimer()
}

// ========== STATS ==========
function renderStats(){gid('statPomos').textContent=totalPomos;const fm=Math.floor(totalFocusSec/60);gid('statFocus').textContent=fm>=60?Math.floor(fm/60)+'h '+fm%60+'m':fm+'m';gid('statBreaks').textContent=totalBreaks;const h=gid('historyBlocks');h.textContent='';sessionHistory.forEach(s=>{const b=document.createElement('div');b.className='hblock h'+s.type[0];h.appendChild(b)});if(typeof renderStatsByArea==='function') renderStatsByArea();if(typeof renderFocusStreak==='function') renderFocusStreak();}

// ========== G-17 STATS BY LIFE AREA ==========
// Pivot today's timeLog by the active task's category — purely from existing
// state (no new fields). Builds the DOM with createElement / textContent so
// untrusted task names can never form HTML.
function renderStatsByArea(){
  const host = gid('statsByArea');
  if(!host) return;
  const todays = timeLog.filter(l => l && l.type === 'work' && l.durSec > 0);
  host.replaceChildren();
  if(!todays.length){ host.hidden = true; return; }
  const byCat = new Map();
  for(const l of todays){
    const t = tasks.find(x => x.name === l.name);
    const cat = (t && t.category) || 'general';
    byCat.set(cat, (byCat.get(cat) || 0) + l.durSec);
  }
  const total = Array.from(byCat.values()).reduce((a,b)=>a+b,0);
  if(!total){ host.hidden = true; return; }
  host.hidden = false;
  const cats = (typeof getCategoryDefs === 'function') ? getCategoryDefs() : [];
  const labelFor = id => { const c = cats.find(c => c.id === id); return c ? c.label : id; };
  const colorFor = id => { const c = cats.find(c => c.id === id); return (c && c.accent) || 'var(--accent)'; };
  const title = document.createElement('div');
  title.className = 'sba-title';
  title.textContent = 'Today by life area';
  host.appendChild(title);
  const rows = Array.from(byCat.entries()).sort((a,b)=>b[1]-a[1]);
  rows.forEach(([id,sec])=>{
    const pct = Math.round((sec/total)*100);
    const mins = Math.round(sec/60);
    const row = document.createElement('div'); row.className = 'sba-row';
    const dot = document.createElement('span'); dot.className = 'sba-dot'; dot.style.background = colorFor(id);
    const lbl = document.createElement('span'); lbl.className = 'sba-lbl'; lbl.textContent = labelFor(id);
    const bar = document.createElement('span'); bar.className = 'sba-bar';
    const fill = document.createElement('span'); fill.className = 'sba-bar-fill';
    fill.style.width = pct + '%'; fill.style.background = colorFor(id);
    bar.appendChild(fill);
    const val = document.createElement('span'); val.className = 'sba-val';
    val.textContent = mins + 'm · ' + pct + '%';
    row.append(dot, lbl, bar, val);
    host.appendChild(row);
  });
}
window.renderStatsByArea = renderStatsByArea;

// ========== G-14 FOCUS STREAKS ==========
// Aggregate the existing daily archive into a streak counter (current/best)
// and a 56-day heatmap. Pure read of getArchives() — no new state.
function renderFocusStreak(){
  const host = gid('focusStreak');
  if(!host) return;
  let archives = [];
  try{ archives = (typeof getArchives === 'function') ? getArchives() : []; }catch(_){}
  const byDate = new Map(archives.map(a => [a.date, a]));
  const today = (typeof todayKey === 'function') ? todayKey() : (new Date()).toISOString().slice(0,10);
  if(typeof totalFocusSec === 'number' && totalFocusSec > 0){
    byDate.set(today, { date: today, totalFocusSec, totalPomos });
  }
  let cur = 0, best = 0, run = 0;
  const today0 = new Date(today + 'T00:00:00');
  const isFocusDay = key => {
    const a = byDate.get(key);
    return !!(a && (a.totalPomos > 0 || a.totalFocusSec > 0));
  };
  for(let i = 0; i < 365; i++){
    const d = new Date(today0); d.setDate(d.getDate() - i);
    const k = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    if(isFocusDay(k)){
      run++;
      if(i === cur) cur = run;
      if(run > best) best = run;
    } else {
      if(i === 0) cur = 0;
      run = 0;
    }
  }
  host.replaceChildren();
  const top = document.createElement('div'); top.className = 'streak-row';
  const num = document.createElement('span'); num.className = 'streak-num'; num.textContent = String(cur);
  const lbl = document.createElement('span'); lbl.className = 'streak-lbl'; lbl.textContent = 'day streak';
  const bst = document.createElement('span'); bst.className = 'streak-best'; bst.textContent = 'best ' + best;
  top.append(num, lbl, bst);
  host.appendChild(top);
  const grid = document.createElement('div'); grid.className = 'hm-grid';
  for(let i = 55; i >= 0; i--){
    const d = new Date(today0); d.setDate(d.getDate() - i);
    const k = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const a = byDate.get(k);
    const min = a ? Math.round((a.totalFocusSec || 0) / 60) : 0;
    let level = 0;
    if(min >= 240) level = 4;
    else if(min >= 120) level = 3;
    else if(min >= 60) level = 2;
    else if(min > 0) level = 1;
    const cell = document.createElement('span');
    cell.className = 'hm-cell hm-l' + level;
    cell.title = k + ': ' + min + ' min';
    grid.appendChild(cell);
  }
  host.appendChild(grid);
  host.hidden = false;
}
window.renderFocusStreak = renderFocusStreak;

// ========== G-15 SESSION-NOTE PROMPT ==========
function showSessionNotePrompt(taskId){
  const card = gid('mainCard');
  if(!card) return;
  let host = gid('sessionNotePrompt');
  if(!host){
    host = document.createElement('div');
    host.id = 'sessionNotePrompt';
    host.className = 'session-note-prompt';
    card.parentNode.insertBefore(host, card.nextSibling);
  }
  const t = (typeof findTask === 'function') ? findTask(taskId) : null;
  if(!t){ host.hidden = true; return; }
  host.replaceChildren();
  const lbl = document.createElement('label'); lbl.className = 'snp-lbl';
  lbl.appendChild(document.createTextNode('Quick note about your session on '));
  const strong = document.createElement('strong'); strong.textContent = t.name || 'this task';
  lbl.appendChild(strong);
  host.appendChild(lbl);
  const input = document.createElement('textarea');
  input.id = 'sessionNoteInput'; input.className = 'snp-input';
  input.rows = 2; input.placeholder = 'What did you get done?';
  host.appendChild(input);
  const actions = document.createElement('div'); actions.className = 'snp-actions';
  const saveBtn = document.createElement('button'); saveBtn.type = 'button';
  saveBtn.className = 'snp-save'; saveBtn.textContent = 'Save note';
  const skipBtn = document.createElement('button'); skipBtn.type = 'button';
  skipBtn.className = 'snp-skip'; skipBtn.textContent = 'Skip';
  const offLbl = document.createElement('label'); offLbl.className = 'snp-off';
  const offCb = document.createElement('input'); offCb.type = 'checkbox'; offCb.id = 'sessionNoteDisable';
  offLbl.append(offCb, document.createTextNode(' Stop asking'));
  actions.append(saveBtn, skipBtn, offLbl);
  host.appendChild(actions);
  host.hidden = false;
  try{ input.focus(); }catch(_){}
  const close = () => { host.hidden = true; };
  saveBtn.onclick = function(){
    const text = (input.value || '').trim();
    if(text){
      if(!Array.isArray(t.notes)) t.notes = [];
      t.notes.push({ id: Date.now() + Math.random(), text, createdAt: (typeof timeNowFull === 'function') ? timeNowFull() : new Date().toISOString() });
      t.lastModified = Date.now();
      if(typeof saveState === 'function') saveState('user');
      if(typeof renderTaskList === 'function') renderTaskList();
    }
    if(offCb.checked){ cfg.askSessionNote = false; if(typeof saveState === 'function') saveState('user'); }
    close();
  };
  skipBtn.onclick = function(){
    if(offCb.checked){ cfg.askSessionNote = false; if(typeof saveState === 'function') saveState('user'); }
    close();
  };
}
window.showSessionNotePrompt = showSessionNotePrompt;

/**
 * Live-refresh the task detail modal's tracking surfaces when a timer session
 * completes for the task that's currently open. Without this, the modal shows
 * stale "1 session" text after the user kicked off a second timer round and
 * watched it complete with the modal still open.
 */
function refreshOpenTaskModalIfMatches(taskId){
  if(editingTaskId == null || editingTaskId !== taskId) return;
  const t = (typeof findTask === 'function') ? findTask(taskId) : null;
  if(!t) return;
  const trackedEl = gid('mdTracked');
  if(trackedEl) trackedEl.textContent = fmtHMS(getRolledUpTime(t.id)) + ' · ' + getRolledUpSessions(t.id) + ' sessions';
  if(typeof renderMdSessions === 'function') renderMdSessions(t);
  if(typeof renderMdHabitLog === 'function') renderMdHabitLog(t);
}
window.refreshOpenTaskModalIfMatches = refreshOpenTaskModalIfMatches;

// ========== G-10 DAILY BRIEF + G-11 WEEKLY REVIEW ==========
// Both render as a temporary modal-ish card. They're narrative-only (no ops),
// so no validator pipeline — but we still gate on isGenReady() and degrade
// gracefully when the LLM hasn't been loaded.
function _briefCard(title){
  let host = document.getElementById('aiBriefCard');
  if(!host){
    host = document.createElement('div');
    host.id = 'aiBriefCard';
    host.className = 'ai-brief-card';
    document.body.appendChild(host);
  }
  host.replaceChildren();
  host.hidden = false;
  const head = document.createElement('div'); head.className = 'aibc-head';
  const h = document.createElement('span'); h.className = 'aibc-title'; h.textContent = title;
  const close = document.createElement('button'); close.type = 'button'; close.className = 'aibc-close';
  close.textContent = '✕'; close.onclick = function(){ host.hidden = true; };
  head.append(h, close);
  host.appendChild(head);
  const body = document.createElement('div'); body.className = 'aibc-body';
  host.appendChild(body);
  return body;
}
async function showDailyBriefCard(){
  const body = _briefCard('Daily brief');
  if(typeof isGenReady !== 'function' || !isGenReady()){
    body.textContent = 'Load the on-device LLM (Settings → Integrations → Generative AI) to enable AI briefs.';
    return;
  }
  body.textContent = 'Composing…';
  // Gather context
  const today = (typeof todayKey === 'function') ? todayKey() : (new Date()).toISOString().slice(0,10);
  const open = (Array.isArray(tasks) ? tasks : []).filter(t => t && !t.archived && t.status !== 'done');
  // Use the existing rankWhatNext for the top-N
  let ranked = [];
  try{ if(typeof rankWhatNext === 'function') ranked = rankWhatNext(open, {}).slice(0, 5); }catch(_){}
  if(!ranked.length) ranked = open.slice(0, 5);
  const topTasks = ranked.map(r => ({ name: (r.task || r).name, due: (r.task || r).dueDate || null, priority: (r.task || r).priority || 'none' }));
  const dueTodayCount = open.filter(t => t.dueDate === today).length;
  const overdueCount = open.filter(t => t.dueDate && t.dueDate < today).length;
  const blockedCount = open.filter(t => Array.isArray(t.blockedBy) && t.blockedBy.length).length;
  let events = [];
  try{ if(typeof getCalFeedEventsForDate === 'function') events = (getCalFeedEventsForDate(today) || []).slice(0, 3).map(e => ({ time: e.time || 'all-day', summary: e.summary || '' })); }catch(_){}
  const out = await genDailyBrief({ topTasks, dueTodayCount, overdueCount, blockedCount, events });
  body.textContent = (typeof out === 'string' && out.trim()) ? out.trim() : '(No brief generated.)';
}
async function showWeeklyReviewCard(){
  const body = _briefCard('Weekly review');
  if(typeof isGenReady !== 'function' || !isGenReady()){
    body.textContent = 'Load the on-device LLM (Settings → Integrations → Generative AI) to enable weekly reviews.';
    return;
  }
  body.textContent = 'Reviewing…';
  const all = Array.isArray(tasks) ? tasks : [];
  const weekAgoMs = Date.now() - 7 * 86400000;
  const stuckCutoff = Date.now() - 7 * 86400000;
  const isoDateOnly = s => (typeof s === 'string') ? s.slice(0, 10) : '';
  const done = all.filter(t => t && t.status === 'done' && t.completedAt && new Date(isoDateOnly(t.completedAt) + 'T00:00:00').getTime() >= weekAgoMs);
  const blocked = all.filter(t => t && !t.archived && t.status !== 'done' && Array.isArray(t.blockedBy) && t.blockedBy.length);
  const stuck = all.filter(t => t && !t.archived && t.status !== 'done' && typeof t.lastModified === 'number' && t.lastModified > 0 && t.lastModified < stuckCutoff);
  // Reopened detection: tasks that have completedAt cleared but had it before — we don't track this explicitly; approximate as tasks with `notes` mentioning "reopen" or with recent updates and status open. Skip for now.
  const reopened = [];
  const out = await genWeeklyReview({
    doneCount: done.length,
    done: done.slice(0, 12).map(t => ({ name: t.name, completedAt: t.completedAt })),
    reopened: reopened.slice(0, 6),
    blocked: blocked.slice(0, 6).map(t => ({ name: t.name, blockedBy: (t.blockedBy || []).slice(0, 3) })),
    stuck: stuck.slice(0, 6).map(t => ({ name: t.name, lastModified: t.lastModified })),
  });
  body.textContent = (typeof out === 'string' && out.trim()) ? out.trim() : '(No review generated.)';
}
window.showDailyBriefCard = showDailyBriefCard;
window.showWeeklyReviewCard = showWeeklyReviewCard;

// ========== G-9 REPHRASE / G-13 AUTO-TAG (per-task surface) ==========
// Surfaced via task-detail drawer buttons (wired below) and palette commands.
async function rephraseActiveTaskTitle(taskId){
  const id = taskId != null ? taskId : editingTaskId;
  if(id == null){
    if(typeof showExportToast === 'function') showExportToast('Open a task first (click any task), then rerun this action.');
    return;
  }
  if(typeof isGenReady !== 'function' || !isGenReady()){
    if(typeof showExportToast === 'function') showExportToast('Load the LLM first (Settings → Integrations → Generative AI)');
    return;
  }
  const t = (typeof findTask === 'function') ? findTask(id) : null;
  if(!t) return;
  const next = await genRephrase(t);
  if(!next || next === t.name) return;
  // Land in the existing op preview pipeline instead of mutating directly.
  if(typeof acceptProposedOps === 'function'){
    await acceptProposedOps([{ name: 'UPDATE_TASK', args: { id: t.id, name: next }, _rationale: 'AI rephrase suggestion' }], { source: 'ai-rephrase', destructiveLevel: 'none' });
  }
}
async function suggestTagsForTask(taskId){
  const id = taskId != null ? taskId : editingTaskId;
  if(id == null){
    if(typeof showExportToast === 'function') showExportToast('Open a task first (click any task), then rerun this action.');
    return;
  }
  if(typeof isGenReady !== 'function' || !isGenReady()){
    if(typeof showExportToast === 'function') showExportToast('Load the LLM first (Settings → Integrations → Generative AI)');
    return;
  }
  const t = (typeof findTask === 'function') ? findTask(id) : null;
  if(!t || typeof genSuggestTags !== 'function') return;
  const allTags = new Set();
  (Array.isArray(tasks) ? tasks : []).forEach(x => (x.tags || []).forEach(tg => allTags.add(tg)));
  const res = await genSuggestTags(t, Array.from(allTags));
  if(!res || !Array.isArray(res.tags) || !res.tags.length) return;
  const newOnes = res.tags.filter(tg => !(t.tags || []).includes(tg));
  if(!newOnes.length){
    if(typeof showExportToast === 'function') showExportToast('No new tags to suggest');
    return;
  }
  if(typeof acceptProposedOps === 'function'){
    const ops = newOnes.map(tag => ({ name: 'ADD_TAG', args: { id: t.id, tag }, _rationale: res.rationale || '' }));
    await acceptProposedOps(ops, { source: 'ai-tag-suggest', destructiveLevel: 'none' });
  }
}
async function suggestDueDateForTask(taskId){
  const id = taskId != null ? taskId : editingTaskId;
  if(id == null){
    if(typeof showExportToast === 'function') showExportToast('Open a task first (click any task), then rerun this action.');
    return;
  }
  const t = (typeof findTask === 'function') ? findTask(id) : null;
  if(!t || typeof predictDueDate !== 'function') return;
  if(typeof isIntelReady !== 'function' || !isIntelReady()){
    if(typeof showExportToast === 'function') showExportToast('Load embeddings first (Tools tab)');
    return;
  }
  const next = await predictDueDate(t.name);
  if(!next){
    if(typeof showExportToast === 'function') showExportToast('No similar tasks with due dates yet — try again later');
    return;
  }
  if(t.dueDate === next){
    if(typeof showExportToast === 'function') showExportToast('Suggested date matches the current due date');
    return;
  }
  if(typeof acceptProposedOps === 'function'){
    await acceptProposedOps([{ name: 'UPDATE_TASK', args: { id: t.id, dueDate: next }, _rationale: 'kNN median of similar tasks' }], { source: 'ai-due-suggest', destructiveLevel: 'none' });
  }
}
window.rephraseActiveTaskTitle = rephraseActiveTaskTitle;
window.suggestTagsForTask = suggestTagsForTask;
window.suggestDueDateForTask = suggestDueDateForTask;

// ========== G-18 TODAY-VIEW CALENDAR EVENTS ==========
// Show today's calendar events as a compact strip above the task list when
// the user is on the Today smart view. Read-only — uses existing parser.
function renderTodayCalEvents(){
  const host = gid('todayCalEvents');
  if(!host) return;
  if(typeof smartView !== 'string' || smartView !== 'today'){ host.hidden = true; host.replaceChildren(); return; }
  if(typeof getCalFeedEventsForDate !== 'function'){ host.hidden = true; return; }
  const todayK = (typeof todayKey === 'function') ? todayKey() : (new Date()).toISOString().slice(0,10);
  let evs = [];
  try{ evs = getCalFeedEventsForDate(todayK) || []; }catch(_){}
  if(!evs.length){ host.hidden = true; host.replaceChildren(); return; }
  evs.sort((a,b)=>{
    if(a.allDay && !b.allDay) return -1;
    if(!a.allDay && b.allDay) return 1;
    return String(a.time||'').localeCompare(String(b.time||''));
  });
  host.replaceChildren();
  const head = document.createElement('div');
  head.className = 'tce-head';
  head.textContent = evs.length === 1 ? '1 event today' : evs.length + ' events today';
  host.appendChild(head);
  const wrap = document.createElement('div');
  wrap.className = 'tce-list';
  evs.slice(0, 8).forEach(ev => {
    const row = document.createElement('div');
    row.className = 'tce-row';
    const dot = document.createElement('span');
    dot.className = 'tce-dot';
    dot.style.background = ev.feedColor || 'var(--accent)';
    const tm = document.createElement('span');
    tm.className = 'tce-time';
    tm.textContent = ev.allDay ? 'All day' : (ev.time || '').slice(0, 5);
    const title = document.createElement('span');
    title.className = 'tce-title';
    title.textContent = ev.summary || '(no title)';
    if(ev.location){ title.title = ev.location; }
    const feed = document.createElement('span');
    feed.className = 'tce-feed';
    feed.textContent = ev.feedLabel || '';
    row.append(dot, tm, title, feed);
    wrap.appendChild(row);
  });
  host.appendChild(wrap);
  host.hidden = false;
}
window.renderTodayCalEvents = renderTodayCalEvents;

// ========== G-4 BULK-SELECT EDIT MODE ==========
// Multi-select tasks then batch-apply ops through the existing
// acceptProposedOps pipeline (which gives the user a preview + undo).
const _bulkSelectedIds = new Set();
function isBulkMode(){ return !!(typeof cfg === 'object' && cfg && cfg.bulkMode); }
function toggleBulkMode(){
  if(typeof cfg !== 'object' || !cfg) return;
  cfg.bulkMode = !cfg.bulkMode;
  if(!cfg.bulkMode) _bulkSelectedIds.clear();
  document.body.classList.toggle('app-bulk-mode', !!cfg.bulkMode);
  if(typeof renderTaskList === 'function') renderTaskList();
  renderBulkBar();
  if(typeof saveState === 'function') saveState('user');
}
function bulkToggleSelect(id){
  const n = parseInt(id, 10);
  if(!Number.isFinite(n)) return;
  if(_bulkSelectedIds.has(n)) _bulkSelectedIds.delete(n);
  else _bulkSelectedIds.add(n);
  renderBulkBar();
  // Also flip the checkbox visual on the row
  const cb = document.querySelector('.task-bulk-cb[data-id="' + n + '"]');
  if(cb) cb.checked = _bulkSelectedIds.has(n);
}
function bulkClear(){
  _bulkSelectedIds.clear();
  document.querySelectorAll('.task-bulk-cb').forEach(cb => { cb.checked = false; });
  renderBulkBar();
}
function bulkSelectVisible(){
  const visible = Array.isArray(tasks) ? tasks.filter(t => typeof matchesFilters === 'function' && matchesFilters(t)) : [];
  visible.forEach(t => _bulkSelectedIds.add(t.id));
  document.querySelectorAll('.task-bulk-cb').forEach(cb => {
    const n = parseInt(cb.dataset.id, 10);
    if(_bulkSelectedIds.has(n)) cb.checked = true;
  });
  renderBulkBar();
}
async function _bulkApplyOps(makeOps){
  if(!_bulkSelectedIds.size) return;
  const ids = Array.from(_bulkSelectedIds);
  const ops = ids.flatMap(id => makeOps(id)).filter(Boolean);
  if(!ops.length) return;
  // Validate before previewing — surfaces destructive-ACK levels
  if(typeof validateOps === 'function'){
    const tasksById = new Map((tasks || []).map(t => [t.id, t]));
    const listsById = new Map((lists || []).map(l => [l.id, l]));
    const v = validateOps(ops, { tasksById, listsById });
    if(typeof acceptProposedOps === 'function'){
      await acceptProposedOps(v.valid, { source: 'bulk', destructiveLevel: v.destructiveLevel });
    }
  } else if(typeof acceptProposedOps === 'function'){
    await acceptProposedOps(ops, { source: 'bulk', destructiveLevel: 'none' });
  }
  // Selection persists so the user can adjust, but we exit bulk mode after
  // a destructive batch so the chips stop blocking.
  if(ops.some(o => o.name === 'ARCHIVE_TASK' || o.name === 'DELETE_TASK')) {
    _bulkSelectedIds.clear();
  }
  renderBulkBar();
}
function bulkArchive(){ return _bulkApplyOps(id => [{ name: 'ARCHIVE_TASK', args: { id } }]); }
function bulkStar(){ return _bulkApplyOps(id => [{ name: 'TOGGLE_STAR', args: { id } }]); }
function bulkSetPriority(p){
  if(!['urgent','high','normal','low','none'].includes(p)) return;
  return _bulkApplyOps(id => [{ name: 'UPDATE_TASK', args: { id, priority: p } }]);
}
function bulkAddTag(tag){
  const t = String(tag || '').replace(/^#/, '').trim();
  if(!t) return;
  return _bulkApplyOps(id => [{ name: 'ADD_TAG', args: { id, tag: t } }]);
}
function bulkChangeList(listId){
  const n = parseInt(listId, 10);
  if(!Number.isFinite(n)) return;
  return _bulkApplyOps(id => [{ name: 'CHANGE_LIST', args: { id, listId: n } }]);
}
function bulkAddTagPrompt(){
  const t = prompt('Tag to add to ' + _bulkSelectedIds.size + ' selected task' + (_bulkSelectedIds.size === 1 ? '' : 's') + ':');
  if(t) bulkAddTag(t);
}
function renderBulkBar(){
  let bar = document.getElementById('bulkBar');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'bulkBar';
    bar.className = 'bulk-bar';
    document.body.appendChild(bar);
  }
  if(!isBulkMode() || _bulkSelectedIds.size === 0){ bar.hidden = true; return; }
  bar.replaceChildren();
  const count = document.createElement('span');
  count.className = 'bulk-count';
  count.textContent = _bulkSelectedIds.size + ' selected';
  bar.appendChild(count);
  const mkBtn = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bulk-btn';
    b.textContent = label;
    b.onclick = fn;
    return b;
  };
  bar.appendChild(mkBtn('Star', bulkStar));
  bar.appendChild(mkBtn('Archive', bulkArchive));
  bar.appendChild(mkBtn('Tag…', bulkAddTagPrompt));
  // Priority dropdown
  const prSel = document.createElement('select');
  prSel.className = 'bulk-sel';
  const prOpts = [['','Set priority…'],['urgent','Urgent'],['high','High'],['normal','Normal'],['low','Low'],['none','None']];
  prOpts.forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; prSel.appendChild(o); });
  prSel.onchange = function(){ if(prSel.value) bulkSetPriority(prSel.value); prSel.value=''; };
  bar.appendChild(prSel);
  // List dropdown
  if(Array.isArray(lists) && lists.length > 1){
    const lsSel = document.createElement('select');
    lsSel.className = 'bulk-sel';
    const placeholder = document.createElement('option'); placeholder.value=''; placeholder.textContent='Move to list…';
    lsSel.appendChild(placeholder);
    lists.forEach(l => { const o=document.createElement('option'); o.value=String(l.id); o.textContent=l.name; lsSel.appendChild(o); });
    lsSel.onchange = function(){ if(lsSel.value) bulkChangeList(lsSel.value); lsSel.value=''; };
    bar.appendChild(lsSel);
  }
  bar.appendChild(mkBtn('Select all visible', bulkSelectVisible));
  const close = mkBtn('✕', toggleBulkMode);
  close.className = 'bulk-btn bulk-close';
  bar.appendChild(close);
  bar.hidden = false;
}
window.toggleBulkMode = toggleBulkMode;
window.bulkToggleSelect = bulkToggleSelect;
window.bulkClear = bulkClear;
window.bulkSelectVisible = bulkSelectVisible;
window.renderBulkBar = renderBulkBar;
window._bulkSelectedIds = _bulkSelectedIds;

// ========== G-5 PERSPECTIVES (Saved Filter Sets) ==========
// Snapshot the current filter/sort/view tuple under a user-chosen name.
function _currentPerspectiveTuple(){
  const so = gid('taskSortSel'), gr = gid('groupBySel'), st = gid('filterStatus'), pr = gid('filterPriority'), ca = gid('filterCategory'), srch = gid('taskSearch');
  return {
    smartView: typeof smartView === 'string' ? smartView : 'all',
    status:    st ? st.value : 'all',
    priority:  pr ? pr.value : 'all',
    category:  ca ? ca.value : 'all',
    sort:      so ? so.value : 'manual',
    group:     gr ? gr.value : 'none',
    search:    srch ? srch.value : '',
    activeListId: typeof activeListId !== 'undefined' ? activeListId : null,
  };
}
function showManagePerspectivesCard(){
  const arr = (typeof cfg === 'object' && cfg && Array.isArray(cfg.perspectives)) ? cfg.perspectives : [];
  let host = document.getElementById('perspectivesCard');
  if(!host){
    host = document.createElement('div');
    host.id = 'perspectivesCard';
    host.className = 'ai-brief-card';
    document.body.appendChild(host);
  }
  host.replaceChildren();
  host.hidden = false;
  const head = document.createElement('div'); head.className = 'aibc-head';
  const h = document.createElement('span'); h.className = 'aibc-title'; h.textContent = 'Saved views';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'aibc-close';
  close.textContent = '✕'; close.onclick = function(){ host.hidden = true; };
  head.append(h, close);
  host.appendChild(head);
  const body = document.createElement('div'); body.className = 'aibc-body';
  if(!arr.length){
    body.textContent = 'No saved views yet. Use the command palette ("Save current view…") to create one.';
  } else {
    arr.forEach(p => {
      if(!p || !p.name) return;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'bulk-btn';
      apply.style.flex = '1';
      apply.textContent = p.name;
      apply.onclick = function(){ applyPerspective(p.name); host.hidden = true; };
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'bulk-btn bulk-close';
      del.textContent = '✕';
      del.title = 'Delete this saved view';
      del.onclick = function(){ removePerspective(p.name); showManagePerspectivesCard(); };
      row.append(apply, del);
      body.appendChild(row);
    });
  }
  host.appendChild(body);
}
window.showManagePerspectivesCard = showManagePerspectivesCard;

function _ensurePerspectivesArray(){
  if(typeof cfg !== 'object' || !cfg) return [];
  if(!Array.isArray(cfg.perspectives)) cfg.perspectives = [];
  return cfg.perspectives;
}
function savePerspectivePrompt(){
  const name = prompt('Name this view (e.g. "Today @work", "Stuck deep work"):');
  if(!name) return;
  savePerspective(name);
}
function savePerspective(name){
  const trimmed = String(name || '').trim().slice(0, 64);
  if(!trimmed) return;
  const arr = _ensurePerspectivesArray();
  const tuple = _currentPerspectiveTuple();
  const existing = arr.findIndex(p => p && p.name === trimmed);
  const entry = { name: trimmed, view: tuple };
  if(existing >= 0) arr[existing] = entry;
  else arr.push(entry);
  if(typeof saveState === 'function') saveState('user');
  if(typeof showExportToast === 'function') showExportToast('View saved: ' + trimmed);
}
function applyPerspective(name){
  const arr = _ensurePerspectivesArray();
  const p = arr.find(x => x && x.name === name);
  if(!p || !p.view) return;
  const v = p.view;
  if(v.smartView && typeof setSmartView === 'function') setSmartView(v.smartView);
  const setIf = (id, val) => { const el = gid(id); if(el && val != null){ el.value = val; } };
  setIf('filterStatus',   v.status);
  setIf('filterPriority', v.priority);
  setIf('filterCategory', v.category);
  setIf('taskSortSel',    v.sort);
  setIf('groupBySel',     v.group);
  setIf('taskSearch',     v.search || '');
  if(v.activeListId != null && typeof switchList === 'function') switchList(v.activeListId);
  if(typeof updateTaskFilters === 'function') updateTaskFilters();
  if(typeof showTab === 'function') showTab('tasks');
}
function removePerspective(name){
  if(typeof cfg !== 'object' || !cfg || !Array.isArray(cfg.perspectives)) return;
  cfg.perspectives = cfg.perspectives.filter(p => !p || p.name !== name);
  if(typeof saveState === 'function') saveState('user');
}
window.savePerspective = savePerspective;
window.savePerspectivePrompt = savePerspectivePrompt;
window.applyPerspective = applyPerspective;
window.removePerspective = removePerspective;

// ========== G-12 VOICE QUICK-ADD ==========
// Uses Web Speech API — fully browser-native (Chrome/Edge/Safari/iOS Safari).
// Transcribes into the existing taskInput so all the smart-add / nlparse
// downstream still applies.
let _voiceRec = null;
let _voiceActive = false;
function _voiceSupport(){
  return typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
}
function showVoiceButtonIfSupported(){
  const btn = gid('taskVoiceBtn');
  if(!btn) return;
  btn.hidden = !(_voiceSupport());
}
function toggleVoiceInput(){
  if(_voiceActive){ stopVoiceInput(); return; }
  startVoiceInput();
}
function startVoiceInput(){
  const Ctor = _voiceSupport();
  if(!Ctor) return;
  if(_voiceRec){ try{ _voiceRec.abort(); }catch(_){} }
  const rec = new Ctor();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = (navigator.language || 'en-US');
  const inp = gid('taskInput');
  const btn = gid('taskVoiceBtn');
  let baseValue = (inp && inp.value) || '';
  rec.onstart = function(){
    _voiceActive = true;
    if(btn) btn.classList.add('on');
  };
  rec.onresult = function(e){
    let txt = '';
    for(let i = e.resultIndex; i < e.results.length; i++){
      txt += e.results[i][0].transcript;
    }
    if(inp){
      inp.value = (baseValue ? (baseValue + ' ') : '') + txt.trim();
      if(typeof maybeShowEnhanceBtn === 'function') maybeShowEnhanceBtn();
    }
  };
  rec.onerror = function(e){
    console.warn('[voice] recognition error', e && e.error);
    stopVoiceInput();
  };
  rec.onend = function(){
    _voiceActive = false;
    _voiceRec = null;
    if(btn) btn.classList.remove('on');
  };
  _voiceRec = rec;
  try{ rec.start(); }catch(e){ console.warn('[voice] start failed', e); }
}
function stopVoiceInput(){
  if(_voiceRec){ try{ _voiceRec.stop(); }catch(_){} }
  _voiceActive = false;
  const btn = gid('taskVoiceBtn');
  if(btn) btn.classList.remove('on');
}
window.toggleVoiceInput = toggleVoiceInput;
window.startVoiceInput = startVoiceInput;
window.stopVoiceInput = stopVoiceInput;
window.showVoiceButtonIfSupported = showVoiceButtonIfSupported;
window.addEventListener('DOMContentLoaded', showVoiceButtonIfSupported);

// ========== G-24 MODAL FOCUS TRAP ==========
// Generic focus-trap helper. Existing modals open via `.open` class — we
// hook the document keydown to detect Tab/Shift+Tab inside any visible modal.
function _focusableInside(root){
  if(!root) return [];
  const sel = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll(sel)).filter(el => el.offsetParent !== null && !el.hasAttribute('aria-hidden'));
}
document.addEventListener('keydown', function(e){
  if(e.key !== 'Tab') return;
  // Find the topmost open modal-ish container.
  const candidates = [
    document.getElementById('cmdkOverlay'),
    document.getElementById('taskModal'),
    document.getElementById('bulkImportModal'),
    document.getElementById('whatNextOverlay'),
    document.getElementById('aiBriefCard'),
  ].filter(Boolean);
  const open = candidates.find(el => {
    const cls = el.classList;
    if(cls.contains('open')) return true;
    if(!el.hidden && cls.contains('cmdk-overlay')) return true;
    if(el.id === 'aiBriefCard' && !el.hidden) return true;
    return false;
  });
  if(!open) return;
  const focusables = _focusableInside(open);
  if(!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if(e.shiftKey){
    if(document.activeElement === first || !open.contains(document.activeElement)){
      e.preventDefault();
      try{ last.focus(); }catch(_){}
    }
  } else {
    if(document.activeElement === last){
      e.preventDefault();
      try{ first.focus(); }catch(_){}
    }
  }
});

// ========== G-7 FOCUS-ON-LIST MODE ==========
function toggleFocusListMode(){
  cfg.focusListMode = !cfg.focusListMode;
  document.body.classList.toggle('app-focus-list', !!cfg.focusListMode);
  if(typeof renderTaskList === 'function') renderTaskList();
  if(typeof saveState === 'function') saveState('user');
}
window.toggleFocusListMode = toggleFocusListMode;
function _applyFocusListClass(){
  if(typeof cfg === 'object' && cfg && cfg.focusListMode){
    document.body.classList.add('app-focus-list');
  }
}
window.addEventListener('DOMContentLoaded', _applyFocusListClass);
async function resetStats(){
  if(!(await showAppConfirm('Reset today\'s pomodoro stats and time log? Tasks and goals are not affected. A snapshot is archived to Past Days if there is progress to keep.')))return;
  const state={date:todayKey(),totalPomos,totalBreaks,totalFocusSec,goals:goals.map(g=>({text:g.text,done:g.done,doneAt:g.doneAt})),tasks:tasks.map(t=>({name:t.name,totalSec:getTaskElapsed(t),sessions:t.sessions})),timeLog,sessionHistory};
  if(totalPomos>0||goals.length>0||tasks.length>0)archiveDay(state);
  totalPomos=0;totalBreaks=0;totalFocusSec=0;pomosInCycle=0;sessionHistory=[];timeLog=[];
  renderStats();renderPips();renderGoalList();renderTaskList();renderLog();renderBanner();renderArchive();saveState('user');
  if(typeof _updateActiveTaskTickSchedule==='function')_updateActiveTaskTickSchedule();
}
function updateTitle(){if(running)document.title=(phase==='work'?'🔴':'🟢')+' '+fmt(remaining)+' — '+getPL(phase);else if(finished)document.title='✅ '+getPL(phase)+' Complete';else document.title='OdTauLai'}

// ========== C-1 Task ID badge ==========
function renderTaskIdBadge(t){
  if(!t) return;
  const stats = document.getElementById('mdStats');
  if(!stats) return;
  let badge = stats.querySelector('.md-task-id');
  if(!badge){
    badge = document.createElement('span');
    badge.className = 'md-task-id';
    stats.appendChild(badge);
  }
  badge.textContent = ' · #' + (t.id != null ? t.id : '?');
  badge.title = 'Task ID — use in task references';
}
window.renderTaskIdBadge = renderTaskIdBadge;

// ========== C-2 Activity log ==========
function recordTaskActivity(t, before){
  if(!t || !before) return;
  if(!Array.isArray(t.activity)) t.activity = [];
  const at = (typeof timeNowFull === 'function') ? timeNowFull() : new Date().toISOString();
  const fmt = v => {
    if(v == null) return '';
    if(Array.isArray(v)) return v.join(', ');
    return String(v);
  };
  const eq = (a, b) => {
    if(Array.isArray(a) && Array.isArray(b)){
      if(a.length !== b.length) return false;
      const sa = a.slice().sort(); const sb = b.slice().sort();
      for(let i = 0; i < sa.length; i++) if(sa[i] !== sb[i]) return false;
      return true;
    }
    return (a == null ? '' : a) === (b == null ? '' : b);
  };
  for(const k of Object.keys(before)){
    const a = before[k]; const b = t[k];
    if(!eq(a, b)){
      t.activity.push({ at, field: k, from: fmt(a).slice(0, 80), to: fmt(b).slice(0, 80) });
    }
  }
  if(t.activity.length > 50) t.activity = t.activity.slice(-50);
}
window.recordTaskActivity = recordTaskActivity;

function renderTaskActivity(t){
  if(!t) return;
  let host = document.getElementById('mdActivity');
  if(!host){
    const desc = document.getElementById('mdDesc');
    if(!desc || !desc.parentNode) return;
    host = document.createElement('div');
    host.id = 'mdActivity';
    host.className = 'md-activity';
    desc.parentNode.parentNode.appendChild(host);
  }
  host.replaceChildren();
  if(!Array.isArray(t.activity) || !t.activity.length){
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const head = document.createElement('div');
  head.className = 'md-activity-head';
  head.textContent = 'Activity (last ' + Math.min(t.activity.length, 8) + ')';
  host.appendChild(head);
  const list = document.createElement('ul');
  list.className = 'md-activity-list';
  t.activity.slice(-8).reverse().forEach(a => {
    const li = document.createElement('li');
    const when = document.createElement('span'); when.className = 'mda-when'; when.textContent = String(a.at).slice(0, 16);
    const what = document.createElement('span'); what.className = 'mda-what';
    const fromTo = a.from ? '“' + a.from + '” → ' : '';
    what.textContent = a.field + ': ' + fromTo + '“' + a.to + '”';
    li.append(when, what);
    list.appendChild(li);
  });
  host.appendChild(list);
}
window.renderTaskActivity = renderTaskActivity;

// ========== C-3 Markdown render in description ==========
function renderMarkdownInline(text){
  const escapeHtml = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const lines = String(text || '').split('\n');
  const out = [];
  let inList = false;
  for(const raw of lines){
    let line = escapeHtml(raw);
    line = line.replace(/`([^`]+)`/g, '<code>$1</code>');
    line = line.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    line = line.replace(/(^|\W)\*([^*\s][^*]*?)\*(\W|$)/g, '$1<em>$2</em>$3');
    line = line.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    if(/^### (.+)/.test(raw)){ if(inList){ out.push('</ul>'); inList=false;} out.push('<h4>' + line.replace(/^### /, '') + '</h4>'); continue; }
    if(/^## (.+)/.test(raw)){  if(inList){ out.push('</ul>'); inList=false;} out.push('<h3>' + line.replace(/^## /,  '') + '</h3>'); continue; }
    if(/^# (.+)/.test(raw)){   if(inList){ out.push('</ul>'); inList=false;} out.push('<h2>' + line.replace(/^# /,   '') + '</h2>'); continue; }
    const bullet = raw.match(/^\s*[-*]\s+(.+)/);
    if(bullet){
      if(!inList){ out.push('<ul>'); inList = true; }
      out.push('<li>' + line.replace(/^\s*[-*]\s+/, '') + '</li>');
      continue;
    }
    if(inList){ out.push('</ul>'); inList = false; }
    if(raw.trim() === '') out.push('<br>');
    else out.push('<p>' + line + '</p>');
  }
  if(inList) out.push('</ul>');
  return out.join('');
}
window.renderMarkdownInline = renderMarkdownInline;
function _safeWriteMarkdown(host, src){
  const html = renderMarkdownInline(src);
  const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
  const wrap = doc.body.firstChild;
  host.replaceChildren();
  while(wrap && wrap.firstChild){
    host.appendChild(wrap.firstChild);
  }
}
function toggleDescriptionRender(){
  const ta = document.getElementById('mdDesc');
  let view = document.getElementById('mdDescView');
  if(!ta) return;
  if(view){
    view.remove();
    ta.hidden = false;
    const btn = document.getElementById('mdDescToggle');
    if(btn) btn.textContent = 'Render markdown';
    return;
  }
  view = document.createElement('div');
  view.id = 'mdDescView';
  view.className = 'md-desc-view';
  _safeWriteMarkdown(view, ta.value || '');
  ta.hidden = true;
  ta.parentNode.insertBefore(view, ta.nextSibling);
  const btn = document.getElementById('mdDescToggle');
  if(btn) btn.textContent = 'Edit';
}
window.toggleDescriptionRender = toggleDescriptionRender;

// ========== C-4 Single-task export ==========
function exportSingleTaskAsMarkdown(taskId){
  const id = taskId != null ? taskId : editingTaskId;
  if(id == null) return;
  const t = (typeof findTask === 'function') ? findTask(id) : null;
  if(!t) return;
  const lines = [];
  lines.push('# ' + (t.name || 'Task'));
  lines.push('');
  if(t.priority && t.priority !== 'none') lines.push('**Priority:** ' + t.priority);
  if(t.status) lines.push('**Status:** ' + t.status);
  if(t.dueDate) lines.push('**Due:** ' + t.dueDate);
  if(t.startDate) lines.push('**Start:** ' + t.startDate);
  if(t.hiddenUntil) lines.push('**Snoozed until:** ' + t.hiddenUntil);
  if(t.category) lines.push('**Life area:** ' + t.category);
  if(t.effort) lines.push('**Effort:** ' + t.effort);
  if(t.energyLevel) lines.push('**Energy:** ' + t.energyLevel);
  if(Array.isArray(t.tags) && t.tags.length) lines.push('**Tags:** ' + t.tags.map(x => '#' + x).join(' '));
  if(t.url) lines.push('**URL:** ' + t.url);
  if(t.estimateMin) lines.push('**Estimate:** ' + t.estimateMin + ' min');
  if(t.totalSec) lines.push('**Tracked:** ' + Math.round(t.totalSec / 60) + ' min · ' + (t.sessions || 0) + ' sessions');
  if(t.description){ lines.push(''); lines.push(t.description); }
  const allLists = [];
  if(Array.isArray(t.checklists) && t.checklists.length) allLists.push(...t.checklists);
  if(Array.isArray(t.checklist) && t.checklist.length) allLists.push({ name: 'Checklist', items: t.checklist });
  if(allLists.length){
    lines.push('');
    allLists.forEach(g => {
      lines.push('## ' + (g.name || 'Checklist'));
      (g.items || []).forEach(c => lines.push('- [' + (c.done ? 'x' : ' ') + '] ' + (c.text || '')));
    });
  }
  if(Array.isArray(t.notes) && t.notes.length){
    lines.push('');
    lines.push('## Notes');
    t.notes.forEach(n => lines.push('- ' + (n.createdAt || '') + ' — ' + (n.text || '')));
  }
  if(t.completionNote){ lines.push(''); lines.push('## Completion note'); lines.push(t.completionNote); }
  if(Array.isArray(t.activity) && t.activity.length){
    lines.push('');
    lines.push('## Activity');
    t.activity.slice(-10).forEach(a => {
      const fromTo = a.from ? '“' + a.from + '” → ' : '';
      lines.push('- ' + a.at + ' — ' + a.field + ': ' + fromTo + '“' + a.to + '”');
    });
  }
  lines.push('');
  lines.push('— task #' + t.id);
  const md = lines.join('\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const slug = (t.name || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';
  a.download = 'odtaulai-task-' + slug + '-' + t.id + '.md';
  a.click();
  URL.revokeObjectURL(a.href);
  if(typeof showExportToast === 'function') showExportToast('Exported task — ' + a.download);
}
window.exportSingleTaskAsMarkdown = exportSingleTaskAsMarkdown;

// ========== C-6 Estimate vs actual variance ==========
function renderEstimateVariance(t){
  if(!t) return;
  let host = document.getElementById('mdVariance');
  if(!host){
    const tracked = document.getElementById('mdTracked');
    if(!tracked || !tracked.parentNode) return;
    host = document.createElement('div');
    host.id = 'mdVariance';
    host.className = 'md-variance';
    tracked.parentNode.parentNode.appendChild(host);
  }
  host.replaceChildren();
  const est = parseInt(t.estimateMin, 10) || 0;
  const act = Math.round((t.totalSec || 0) / 60);
  if(est <= 0 || act <= 0){ host.hidden = true; return; }
  host.hidden = false;
  const ratio = act / est;
  const pct = Math.round((ratio - 1) * 100);
  const label = document.createElement('span');
  label.className = 'mdv-label';
  label.textContent = 'Variance';
  const val = document.createElement('span');
  val.className = 'mdv-val';
  val.textContent = (pct >= 0 ? '+' : '') + pct + '% (estimate ' + est + 'm · actual ' + act + 'm)';
  if(ratio > 1.25) val.classList.add('mdv-over');
  else if(ratio < 0.75) val.classList.add('mdv-under');
  else val.classList.add('mdv-ok');
  host.append(label, val);
}
window.renderEstimateVariance = renderEstimateVariance;

// ========== C-7 Multiple named checklists ==========
function renderChecklistGroups(taskId){
  const t = (typeof findTask === 'function') ? findTask(taskId) : null;
  if(!t) return;
  const legacyHost = document.getElementById('mdChecklist');
  if(!legacyHost) return;
  let host = document.getElementById('mdChecklistGroups');
  if(!host){
    host = document.createElement('div');
    host.id = 'mdChecklistGroups';
    host.className = 'md-checklist-groups';
    legacyHost.parentNode.appendChild(host);
  }
  host.replaceChildren();
  if(!Array.isArray(t.checklists)) t.checklists = [];
  t.checklists.forEach(group => {
    const wrap = document.createElement('div'); wrap.className = 'mclg-group';
    const head = document.createElement('div'); head.className = 'mclg-head';
    const title = document.createElement('input');
    title.type = 'text'; title.className = 'mclg-name';
    title.value = group.name || ''; title.placeholder = 'Checklist name';
    title.onchange = function(){ group.name = title.value.trim() || 'Checklist'; if(typeof saveState==='function') saveState('user'); };
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'mclg-rm';
    rm.textContent = '✕'; rm.title = 'Remove this checklist';
    rm.onclick = function(){
      t.checklists = t.checklists.filter(g => g !== group);
      renderChecklistGroups(taskId);
      if(typeof saveState==='function') saveState('user');
    };
    head.append(title, rm);
    wrap.appendChild(head);
    const list = document.createElement('ul'); list.className = 'mclg-items';
    if(!Array.isArray(group.items)) group.items = [];
    group.items.forEach((c, idx) => {
      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !!c.done;
      cb.onchange = function(){
        c.done = cb.checked;
        c.doneAt = cb.checked ? (new Date()).toISOString() : null;
        if(typeof saveState==='function') saveState('user');
      };
      const txt = document.createElement('input');
      txt.type = 'text'; txt.className = 'mclg-item-txt';
      txt.value = c.text || ''; txt.placeholder = 'Item';
      txt.onchange = function(){ c.text = txt.value.trim(); if(!c.text){ group.items.splice(idx, 1); renderChecklistGroups(taskId); } if(typeof saveState==='function') saveState('user'); };
      const xb = document.createElement('button');
      xb.type = 'button'; xb.className = 'mclg-item-x';
      xb.textContent = '×';
      xb.onclick = function(){ group.items.splice(idx, 1); renderChecklistGroups(taskId); if(typeof saveState==='function') saveState('user'); };
      li.append(cb, txt, xb);
      list.appendChild(li);
    });
    wrap.appendChild(list);
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'mclg-add';
    add.textContent = '+ item';
    add.onclick = function(){
      group.items.push({ id: Date.now() + Math.random(), text: '', done: false, doneAt: null });
      renderChecklistGroups(taskId);
      setTimeout(() => {
        const inputs = wrap.querySelectorAll('.mclg-item-txt');
        if(inputs.length) inputs[inputs.length - 1].focus();
      }, 50);
    };
    wrap.appendChild(add);
    host.appendChild(wrap);
  });
  const addGroup = document.createElement('button');
  addGroup.type = 'button'; addGroup.className = 'mclg-add-group';
  addGroup.textContent = '+ checklist group';
  addGroup.onclick = function(){
    if(!Array.isArray(t.checklists)) t.checklists = [];
    t.checklists.push({ id: Date.now() + Math.random(), name: 'Checklist ' + (t.checklists.length + 1), items: [] });
    renderChecklistGroups(taskId);
    if(typeof saveState==='function') saveState('user');
  };
  host.appendChild(addGroup);
}
window.renderChecklistGroups = renderChecklistGroups;

// ========== C-9 Linked / related tasks ==========
function renderRelatedTasks(taskId){
  const t = (typeof findTask === 'function') ? findTask(taskId) : null;
  if(!t) return;
  const blocked = document.getElementById('mdBlockedBy');
  if(!blocked || !blocked.parentNode) return;
  let host = document.getElementById('mdRelatedTo');
  if(!host){
    host = document.createElement('div');
    host.id = 'mdRelatedTo';
    host.className = 'md-related';
    const wrap = document.createElement('div');
    wrap.className = 'mfield';
    const lbl = document.createElement('div');
    lbl.className = 'mfield-lbl';
    lbl.textContent = 'Related tasks (non-blocking links)';
    wrap.append(lbl, host);
    blocked.parentNode.parentNode.insertBefore(wrap, blocked.parentNode.nextSibling);
  }
  host.replaceChildren();
  if(!Array.isArray(t.relatedTo)) t.relatedTo = [];
  t.relatedTo.forEach((rid, idx) => {
    const other = (typeof findTask === 'function') ? findTask(rid) : null;
    if(!other) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'related-chip';
    chip.textContent = '#' + rid + ' ' + (other.name || '').slice(0, 40);
    chip.onclick = function(){ closeTaskDetail(); openTaskDetail(rid); };
    const x = document.createElement('span');
    x.className = 'related-x';
    x.textContent = '×';
    x.title = 'Unlink';
    x.onclick = function(ev){
      ev.stopPropagation();
      t.relatedTo.splice(idx, 1);
      renderRelatedTasks(taskId);
      if(typeof saveState==='function') saveState('user');
    };
    chip.appendChild(x);
    host.appendChild(chip);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'related-add';
  add.textContent = '+ link';
  add.onclick = function(){
    const idStr = prompt('Task ID to link (visible as #N in the drawer header):');
    if(!idStr) return;
    const n = parseInt(String(idStr).replace(/^#/, ''), 10);
    if(!Number.isFinite(n) || n <= 0) return;
    if(n === t.id){ alert('A task can\'t be linked to itself.'); return; }
    if(!findTask(n)){ alert('No task with id #' + n); return; }
    if(!Array.isArray(t.relatedTo)) t.relatedTo = [];
    if(!t.relatedTo.includes(n)) t.relatedTo.push(n);
    renderRelatedTasks(taskId);
    if(typeof saveState==='function') saveState('user');
  };
  host.appendChild(add);
}
window.renderRelatedTasks = renderRelatedTasks;

