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
  let html='<div class="calendar"><div class="cal-head">'
    +'<button class="cal-nav" onclick="calNav(-1)" title="Previous month">‹</button>'
    +'<div class="cal-title">'+monthName+'</div>'
    +'<button class="cal-today-btn" onclick="calToday()">Today</button>'
    +'<button class="cal-nav" onclick="calNav(1)" title="Next month">›</button>'
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
    el.onclick=function(e){if(e.target.closest('.cal-task'))return;
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
        ? `<button type="button" class="cal-ev-mk-task" title="Create task from this event" aria-label="Create task from event" onclick="event.stopPropagation();if(typeof createTaskFromCalEvent==='function')createTaskFromCalEvent(${JSON.stringify(String(ev.feedId))},${JSON.stringify(uid)})">+Task</button>`
        : '';
      return `<div class="cal-task cal-feed-event" style="border-left-color:${sanitizeListColor(ev.feedColor)}" title="${esc(ev.feedLabel)}: ${esc(ev.title)}${ev.time?' at '+esc(String(ev.time)):''}${ev.location?' — '+esc(ev.location):''}">`
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
  const ov=gid('cmdkOverlay');if(!ov)return;
  _cmdkPrevFocus=document.activeElement;
  ov.classList.add('open');
  cmdkMode=openAsk?'ask':'find';
  _cmdkAskHistoryIdx=-1;_cmdkLastReply=null;_cmdkAskBusy=false;
  _applyCmdkMode();
  const inp=gid('cmdkInput');
  if(inp)inp.value='';
  cmdkActiveIdx=0;renderCmdK();
  if(inp){
    try{inp.focus({preventScroll:true})}catch(_){inp.focus()}
  }
}
function closeCmdK(){
  _cmdkAbortAsk();
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
    if(cmdkMode==='ask'){reply.hidden=false;if(!reply.innerHTML)reply.innerHTML='<div class="cmdk-ask-hint">Press Enter to run on-device. <strong>No auto-apply</strong> — you’ll preview every proposed change.</div>'}
    else{reply.hidden=true;reply.innerHTML=''}
  }
  if(results)results.style.display=cmdkMode==='ask'?'none':'';
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
function _renderAskStatus(state,msg){
  const reply=gid('cmdkAskReply');if(!reply)return;
  if(state==='streaming'){
    reply.innerHTML=`
      <div class="cmdk-ask-streaming">
        <div class="cmdk-ask-row">
          <span class="cmdk-ask-spinner" aria-hidden="true"></span>
          <span class="cmdk-ask-label" id="cmdkAskLabel">Thinking on-device…</span>
          <button type="button" class="cmdk-ask-stop" onclick="cmdkAskStop()">Stop</button>
        </div>
        <details class="cmdk-ask-details">
          <summary>Show raw output</summary>
          <pre class="cmdk-ask-stream" id="cmdkAskStream"></pre>
        </details>
      </div>`;
  }else if(state==='error'){
    reply.innerHTML='<div class="cmdk-ask-error">'+esc(msg||'Error')+'</div>';
  }else if(state==='empty'){
    reply.innerHTML='<div class="cmdk-ask-empty">'+esc(msg||'No changes proposed.')+'</div>';
  }else if(state==='done'){
    reply.innerHTML='<div class="cmdk-ask-done">'+esc(msg||'Proposed.')+'</div>';
  }else if(state==='need-model'){
    // Message reflects whether the model just needs loading vs a full download.
    const cfg = typeof getGenCfg === 'function' ? getGenCfg() : null;
    const cached = !!(cfg && typeof isGenDownloaded === 'function' && isGenDownloaded(cfg.modelId));
    const loading = typeof isGenLoading === 'function' && isGenLoading();
    let inner;
    if(loading){
      inner = 'Local LLM is still loading — give it a moment and try again.';
    }else if(!cfg || !cfg.enabled){
      inner = 'Local LLM is off. <button type="button" class="btn-ghost btn-sm" onclick="openGenSettingsFromAsk()">Enable in Settings</button> to turn it on and download weights.';
    }else if(cached){
      inner = 'Local LLM is enabled but not loaded yet. <button type="button" class="btn-ghost btn-sm" onclick="openGenSettingsFromAsk()">Open Settings</button> and click Load.';
    }else{
      inner = 'Local LLM weights aren’t downloaded on this device. <button type="button" class="btn-ghost btn-sm" onclick="openGenSettingsFromAsk()">Open Settings</button> to download.';
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
    setTimeout(closeCmdK,650);
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

/** Show the task-input promo chip only when the LLM is ready. */
function syncAskPromoChip(){
  const chip=gid('askPromoChip');
  if(!chip)return;
  const ready=typeof isGenReady==='function'&&isGenReady();
  chip.style.display=ready?'':'none';
}
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
    if(results)results.style.display='none';
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
    {type:'action',label:'Today view',icon:ic('calendar'),run:()=>{showTab('tasks');setSmartView('today')}},
    {type:'action',label:'Overdue view',icon:ic('alertTriangle'),run:()=>{showTab('tasks');setSmartView('overdue')}},
    {type:'action',label:'Starred view',icon:ic('star'),run:()=>{showTab('tasks');setSmartView('starred')}},
    {type:'action',label:'Impact view (Pareto 80/20)',icon:ic('zap'),run:()=>{showTab('tasks');setSmartView('impact')}},
    {type:'action',label:'Sort by Impact (Pareto)',icon:ic('zap'),run:()=>{showTab('tasks');const s=gid('taskSortSel');if(s){s.value='impact';if(typeof updateTaskFilters==='function')updateTaskFilters()}}},
    {type:'action',label:'Archive view',icon:ic('archive'),run:()=>{showTab('tasks');setSmartView('archived')}},
    {type:'action',label:'List view',icon:ic('list'),run:()=>{showTab('tasks');setTaskView('list')}},
    {type:'action',label:'Board view',icon:ic('grid'),run:()=>{showTab('tasks');setTaskView('board')}},
    {type:'action',label:'Calendar view',icon:ic('calendar'),run:()=>{showTab('tasks');setTaskView('calendar')}},
    {type:'action',label:'Toggle theme',icon:ic('moon'),run:()=>toggleTheme()},
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
  if(!items.length){results.innerHTML='<div class="cmdk-empty">No matches</div>';return}
  let itemIdx=0;
  results.innerHTML=items.map(i=>{
    if(i.section)return '<div class="cmdk-section">'+i.section+'</div>';
    const active=itemIdx===cmdkActiveIdx;
    const cur=itemIdx++;
    const kbd=i.kbd?'<span class="cmdk-kbd">'+i.kbd+'</span>':(i.desc?'<span class="cmdk-desc">'+esc(i.desc)+'</span>':'');
    return '<div class="cmdk-item'+(active?' active':'')+'" data-idx="'+cur+'" onclick="cmdkRun('+cur+')"><span class="cmdk-icon">'+i.icon+'</span><span>'+esc(i.label)+'</span>'+kbd+'</div>';
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
  if(wno && wno.style.display !== 'none' && wno.style.display !== '') return true;
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

// ========== THEME TOGGLE ==========
function toggleTheme(){
  theme=theme==='dark'?'light':'dark';
  applyTheme();saveState('user');
}
function applyTheme(){
  document.body.classList.toggle('light-theme',theme==='light');
  const btn=gid('themeToggleBtn');if(btn)btn.textContent=theme==='dark'?'🌙':'☀';
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta){
    const c=getComputedStyle(document.body).getPropertyValue('--bg-0').trim();
    if(c) meta.setAttribute('content',c);
  }
}
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
    +(isActive?' active-task':'')
    +(kids?' has-children':'')
    +(depth>0?' depth-'+Math.min(depth,4):'')
    +(isDone?' completed':'')
    +(t.archived?' archived':'')
    +(dueCls==='overdue'&&!isDone?' overdue':'')
    +(t.starred?' starred-task':'');
  d.dataset.priority=(!t.starred&&t.priority&&t.priority!=='none')?t.priority:'';
  d.style.marginLeft=(depth*18)+'px';
  d.setAttribute('draggable','true');
  d.dataset.taskId=t.id;
  d.ondragstart=function(e){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.id);d.classList.add('dragging')};
  d.ondragend=function(){d.classList.remove('dragging');document.querySelectorAll('.task-item').forEach(el=>el.classList.remove('drop-above','drop-below'))};
  d.ondragover=function(e){
    e.preventDefault();e.dataTransfer.dropEffect='move';
    const r=d.getBoundingClientRect();const above=e.clientY-r.top<r.height/2;
    d.classList.toggle('drop-above',above);d.classList.toggle('drop-below',!above);
  };
  d.ondragleave=function(){d.classList.remove('drop-above','drop-below')};
  d.ondrop=function(e){
    e.preventDefault();e.stopPropagation();
    const srcId=parseInt(e.dataTransfer.getData('text/plain'),10);
    if(!Number.isFinite(srcId)||srcId<=0||srcId===t.id)return;
    const r=d.getBoundingClientRect();const above=e.clientY-r.top<r.height/2;
    handleTaskDrop(srcId,t.id,above?'before':'after');
    d.classList.remove('drop-above','drop-below');
  };
  d.onclick=function(e){
    if(e.target.closest('button')||e.target.closest('.task-chevron')||e.target.closest('.drag-handle'))return;
    openTaskDetail(t.id)
  };
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

  // ========== COGNITIVE-LOAD-OPTIMIZED RENDER ==========
  // PRINCIPLE: Only 2-3 things visible at rest. Everything else on hover.
  // Row = PRIMARY (checkbox + name) + at-a-glance SIGNAL (priority stripe on left border, due date chip if relevant)
  // Actions like star/play/sub/delete appear on hover. Status/tags/description appear on hover.
  // Subtask counter shown compactly only if parent has children.

  const chevron=kids
    ?'<button class="task-chevron'+(t.collapsed?' collapsed':'')+'" onclick="toggleCollapse('+t.id+')" title="'+(t.collapsed?'Expand':'Collapse')+'">▸</button>'
    :'<span class="task-chevron-spacer"></span>';
  const checkbox='<button class="task-checkbox'+(isDone?' checked':'')+'" onclick="toggleTaskDoneQuick('+t.id+')" title="Mark done" aria-label="Mark task done">'+(isDone?'✓':'')+'</button>';

  const dense=(typeof getCardDensity==='function'?getCardDensity():'compact')==='compact';
  // Signal chips: ONLY show due date if meaningful (today/overdue/soon), and inline hidden otherwise
  let signalChips='';
  // List indicator dot — only show if viewing All and >1 list has tasks (otherwise pure noise)
  // H2: the "which lists currently have tasks" set is O(N) over all tasks.
  // Computing it once per render (in renderTaskList) avoids O(N²) work on long lists.
  const taskOwnerList=lists.find(l=>l.id===t.listId);
  const listsWithTasks=window._listsWithTasksCache || _computeListsWithTasks();
  if(taskOwnerList&&activeListId==='all'&&listsWithTasks.size>1){
    signalChips+='<span class="task-sig sig-list" style="background:transparent;padding:0" title="List: '+escAttr(taskOwnerList.name)+'"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:'+sanitizeListColor(taskOwnerList.color)+'"></span></span>';
  }
  if(t.dueDate&&!isDone){
    const dueLabel=fmtDue(t.dueDate);
    if(dueCls==='overdue'||dueCls==='today'||dueCls==='soon'){
      signalChips+='<span class="task-sig due-'+dueCls+'">'+dueLabel+'</span>';
    }else{
      signalChips+='<span class="task-sig due-future">'+dueLabel+'</span>';
    }
  }
  // Subtask progress (compact)
  const prog=getSubtaskProgress(t.id);
  if(prog){
    signalChips+='<span class="task-sig sig-subs" title="'+prog.done+' of '+prog.total+' subtasks done">'+prog.done+'/'+prog.total+'</span>';
  }
  // Recurring + habit streak
  if(t.recur){
    signalChips+='<span class="task-sig sig-recur" title="Repeats '+t.recur+'">↻</span>';
    if(typeof getHabitStreak==='function'){
      const st=getHabitStreak(t);
      if(st>0)signalChips+='<span class="task-sig sig-streak" title="Consecutive days with a logged completion">'+st+'d</span>';
    }
  }
  // Active timer indicator
  if(isActive){
    signalChips+='<span class="task-sig sig-active" title="Tracking time">● '+fmtHMS(rolledTime)+'</span>';
  }
  // Category, values, dup — detailed density only
  if(!dense && t.category){
    const cdef=(typeof getCategoryDef==='function')?getCategoryDef(t.category):null;
    const catLbl=cdef?cdef.label:t.category;
    const catSvg=(typeof window.categoryIcon==='function')?window.categoryIcon(t.category):'';
    const catColor=cdef&&cdef.color?cdef.color:'var(--cat-general)';
    signalChips+='<span class="task-sig sig-cat" style="--cat-color:'+escAttr(catColor)+'" title="'+escAttr(t.valuesNote||catLbl)+'"><span class="sig-cat-ic">'+catSvg+'</span>'+esc(catLbl)+'</span>';
  }
  if(!dense && t.valuesAlignment&&t.valuesAlignment.length){
    signalChips+='<span class="task-sig sig-values" title="Serves: '+escAttr(t.valuesAlignment.join(', '))+'">◈</span>';
  }
  if(!dense && window._dupSimMap && window._dupSimMap.get(t.id) >= 0.9){
    signalChips+='<span class="task-sig task-dup-badge" title="Very similar to another task">⧉ dup</span>';
  }
  if(smartView==='impact' && typeof isParetoTop==='function' && isParetoTop(t.id)){
    const sc=(typeof getImpactScore==='function'?getImpactScore(t.id):0);
    const zapIc=(typeof window.icon==='function')?window.icon('zap',{size:11}):'';
    signalChips+='<span class="task-sig sig-pareto" title="High-leverage task (top ~20% by impact'+(sc?' · score '+sc.toFixed(1):'')+')"><span class="sig-cat-ic">'+zapIc+'</span>impact</span>';
  }

  // Hover-only metadata (status badge + tags + description preview) — hidden by default, reveal on hover
  const status=STATUSES[t.status||'open'];
  const showStatusOnHover=(t.status&&t.status!=='open')?'':'hidden-status';
  const statusBadge='<span class="status-badge '+status.cls+' '+showStatusOnHover+'" onclick="event.stopPropagation();cycleStatus('+t.id+')" title="Click to cycle status">'+status.label+'</span>';

  const tagsVisible=(t.tags||[]).slice(0,3).map(tg=>'<span class="tag-chip">'+esc(tg)+'</span>').join('');
  const descPrev=(t.description&&t.description.length>0)?'<span class="task-desc-inline">'+esc(t.description.slice(0,50))+(t.description.length>50?'…':'')+'</span>':'';

  // Hover actions — pushed right, compact, appear only on hover
  const actions=t.archived
    ?'<button class="ta-btn ta-restore" onclick="event.stopPropagation();restoreTask('+t.id+')" title="Restore">↺</button>'
     +'<button class="ta-btn ta-del" onclick="event.stopPropagation();removeTask('+t.id+')" title="Delete permanently">×</button>'
    :'<button class="ta-btn ta-star'+(t.starred?' on':'')+'" onclick="event.stopPropagation();toggleStar('+t.id+')" title="'+(t.starred?'Unpin':'Pin to top')+'">'+(t.starred?'★':'☆')+'</button>'
     +'<button class="ta-btn ta-play '+(isActive?'on':'')+'" onclick="event.stopPropagation();toggleTask('+t.id+')" title="'+(isActive?'Stop timer':'Start timer')+'">'+(isActive?'■':'▶')+'</button>'
     +'<button class="ta-btn ta-sub" onclick="event.stopPropagation();addSubtaskPrompt('+t.id+')" title="Add subtask">+</button>'
     +'<button class="ta-btn ta-del" onclick="event.stopPropagation();removeTask('+t.id+')" title="Archive">×</button>';

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
    +(descPrev||tagsVisible||statusBadge.indexOf('hidden-status')===-1?
      '<div class="task-row-secondary">'
        +statusBadge
        +(tagsVisible?'<span class="task-tags-inline">'+tagsVisible+'</span>':'')
        +descPrev
      +'</div>':'');
  list.appendChild(d)
}

function renderSubtaskForm(parentId,depth){
  const list=gid('taskList');
  const d=document.createElement('div');
  d.className='task-subtask-form';
  d.style.marginLeft=(depth*18)+'px';
  d.innerHTML='<input class="task-sub-input" data-parent="'+parentId+'" placeholder="Subtask name..." '
    +'onkeydown="if(event.key===\'Enter\')addSubtask('+parentId+');if(event.key===\'Escape\')cancelSubtaskPrompt()">'
    +'<div class="task-sub-btns">'
    +'<button class="task-sub-btn task-sub-add" onclick="addSubtask('+parentId+')">Add</button>'
    +'<button class="task-sub-btn task-sub-cancel" onclick="cancelSubtaskPrompt()">×</button>'
    +'</div>';
  list.appendChild(d);
  const inp=d.querySelector('.task-sub-input');
  if(inp){
    if(typeof _subtaskFormDraftParent==='number'&&_subtaskFormDraftParent===parentId&&typeof _subtaskFormDraftText==='string'){
      inp.value=_subtaskFormDraftText;
    }
    inp.addEventListener('input',()=>{
      _subtaskFormDraftText=inp.value;
      _subtaskFormDraftParent=parentId;
    });
  }
}

// Kanban Board View
function renderBoard(visibleTasks){
  const board=gid('boardView');board.innerHTML='';
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
      src.status=st;
      if(st==='done'){
        if(src.recur && typeof completeHabitCycle==='function'){completeHabitCycle(src)}
        else{src.completedAt=stampCompletion()}
      }
      else src.completedAt=null;
      renderTaskList();saveState('user');
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
      const breadcrumb=path.length>1?'<div style="font-size:10px;color:var(--text-3);margin-bottom:4px">'+esc(path.slice(0,-1).join(' › '))+'</div>':'';
      const dueIc=(typeof window.icon==='function')?window.icon('calendar',{size:12}):'';
      const due=t.dueDate?'<span class="due-chip'+(getDueClass(t.dueDate)?' '+getDueClass(t.dueDate):'')+'">'+dueIc+' '+fmtDue(t.dueDate)+'</span>':'';
      const tags=(t.tags||[]).slice(0,2).map(tg=>'<span class="tag-chip">'+esc(tg)+'</span>').join('');
      const time=getRolledUpTime(t.id)>0?'<span class="task-elapsed" style="font-size:10px">'+fmtHMS(getRolledUpTime(t.id))+'</span>':'';
      card.innerHTML=breadcrumb
        +'<div class="board-card-name">'+esc(t.name)+'</div>'
        +'<div class="board-card-meta" style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap;align-items:center">'+due+tags+time+'</div>';
      body.appendChild(card)
    });
    if(!colTasks.length){
      const empty=document.createElement('div');empty.style.cssText='font-size:12px;color:var(--text-4);text-align:center;padding:24px 0';
      empty.textContent='Drop tasks here';body.appendChild(empty);
    }
    board.appendChild(col)
  })
}

// Task Detail Modal — chips mutate the live task object while open. _taskModalSnapshot
// is a deep clone taken on open; closeTaskDetail() restores it on Cancel/Escape/backdrop
// unless skipRevert (Save, Delete).
let _taskModalSnapshot=null;
function openTaskDetail(id){
  const t=findTask(id);if(!t)return;
  _taskModalSnapshot=JSON.parse(JSON.stringify(t));
  editingTaskId=id;
  gid('mdName').value=t.name;
  gid('mdCheckbox').classList.toggle('checked',t.status==='done');
  gid('mdCheckbox').textContent=t.status==='done'?'✓':'';
  gid('mdDue').value=t.dueDate||'';
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
        gid('mdTracked').textContent=fmtHMS(getRolledUpTime(t.id))+' · '+getRolledUpSessions(t.id)+' sessions';
      }else{
        t.status=st;
        gid('mdCheckbox').classList.toggle('checked',st==='done');gid('mdCheckbox').textContent=st==='done'?'✓':'';
        [...sChips.children].forEach(c=>c.classList.remove('active'));b.classList.add('active');
      }
    };
    sChips.appendChild(b)
  });
  // Priority chips
  const pChips=gid('mdPriorityChips');pChips.innerHTML='';
  ['urgent','high','normal','low','none'].forEach(pr=>{
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.priority||'none')===pr?' active':'');
    b.style.color=pr!=='none'?({urgent:'#c0392b',high:'#e67e22',normal:'#3d8bcc',low:'#7f8c8d'}[pr]):'';
    b.textContent=PRIORITIES[pr].label;
    b.onclick=function(){t.priority=pr;[...pChips.children].forEach(c=>c.classList.remove('active'));b.classList.add('active')};
    pChips.appendChild(b)
  });
  // Effort chips
  const eChips=gid('mdEffortChips');eChips.innerHTML='';
  [['xs','XS'],['s','S'],['m','M'],['l','L'],['xl','XL']].forEach(([key,lbl])=>{
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.effort||null)===key?' active':'');
    b.textContent=lbl;b.title={xs:'Extra small (~15min)',s:'Small (~1hr)',m:'Medium (~half day)',l:'Large (~full day)',xl:'Extra large (multi-day)'}[key];
    b.onclick=function(){t.effort=t.effort===key?null:key;[...eChips.children].forEach(c=>c.classList.remove('active'));if(t.effort===key||!t.effort){}else b.classList.add('active');renderEffortChips(t,eChips)};
    eChips.appendChild(b)
  });
  // Energy chips
  const enChips=gid('mdEnergyChips');enChips.innerHTML='';
  [['high','High energy'],['low','Low energy']].forEach(([key,lbl])=>{
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.energyLevel||null)===key?' active':'');
    b.textContent=lbl;
    b.onclick=function(){t.energyLevel=t.energyLevel===key?null:key;[...enChips.children].forEach(c=>c.classList.remove('active'));if(t.energyLevel)b.classList.add('active')};
    enChips.appendChild(b)
  });
  // Recurrence
  const rc=gid('mdRecur');if(rc){rc.innerHTML='';
    [['none','No repeat'],['daily','Daily'],['weekdays','Weekdays'],['weekly','Weekly'],['monthly','Monthly']].forEach(([key,lbl])=>{
      const b=document.createElement('button');b.className='recur-opt'+((t.recur||'none')===key?' active':'');
      b.textContent=lbl;
      b.onclick=function(){t.recur=key==='none'?null:key;[...rc.children].forEach(c=>c.classList.remove('active'));b.classList.add('active')};
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
    b.onclick=function(){t.category=t.category===key?null:key;[...catChips.children].forEach(c=>c.classList.remove('active'));if(t.category)b.classList.add('active')};
    catChips.appendChild(b)
  });
  const vn=gid('mdValuesNote');if(vn)vn.textContent=t.valuesNote||'';
  // Checklist
  renderChecklist(id);
  // Notes
  renderTaskNotes(id);
  // Blocked by
  renderBlockedBy(id);
  refreshMdSimilarTasks(id);
  // Show the Break-down accordion only when a generative model is loaded.
  // Content is lazy-rendered on toggle to avoid spending tokens unless asked.
  const bdWrap = gid('mdBreakdownWrap');
  if(bdWrap){
    const llmOn = typeof isGenReady === 'function' && isGenReady();
    bdWrap.style.display = llmOn ? '' : 'none';
    const bdAcc = gid('mdBreakdownAccordion');
    if(bdAcc) bdAcc.classList.remove('open');
    const bdBody = gid('mdBreakdownBody');
    if(bdBody){ bdBody.innerHTML = ''; delete bdBody.dataset.loaded; }
  }
  renderMdHabitLog(t);
  gid('taskModal').classList.add('open');
  _taskModalPrevFocus=document.activeElement;
  document.addEventListener('keydown',_taskModalTabTrap,true);
  setTimeout(()=>gid('mdName').focus(),50)
}

function renderMdHabitLog(t){
  const el=gid('mdHabitLog');
  if(!el)return;
  if(!t||!t.recur||!Array.isArray(t.completions)||!t.completions.length){
    el.innerHTML='<span class="intel-muted">Completion history appears after you finish a repeating task.</span>';
    return;
  }
  const rows=t.completions.slice(-14).reverse();
  const sum=(typeof getHabitLoggedSecTotal==='function')?getHabitLoggedSecTotal(t):0;
  el.innerHTML='<div class="habit-log-sum">Logged in completions: <strong>'+fmtHMS(sum)+'</strong></div>'
    +'<ul class="habit-log-list">'+rows.map(c=>'<li><span>'+esc(c.date)+'</span> · '+fmtHMS(c.sec||0)+'</li>').join('')+'</ul>';
}

async function refreshMdSimilarTasks(id){
  const body = gid('mdSimilarTasks');
  const acc = gid('mdSimilarAccordion');
  if(!body) return;
  if(typeof isIntelReady !== 'function' || !isIntelReady()){
    body.innerHTML = '<span class="intel-muted">Load the model (AI chip or Tools → Task understanding) for similar tasks.</span>';
    if(acc) acc.classList.remove('open');
    return;
  }
  body.innerHTML = '<span class="intel-muted">Finding neighbors…</span>';
  try{
    const sim = await similarTasksFor(id, 5);
    if (editingTaskId !== id) return;
    if(!sim.length){
      body.innerHTML = '<span class="intel-muted">No similar tasks found yet.</span>';
      return;
    }
    body.innerHTML = sim.map(({ t: ot, sim: s }) => `
      <button type="button" class="similar-task-row" onclick="closeTaskDetail();openTaskDetail(${ot.id})">
        <span class="st-name">${esc(ot.name.slice(0, 48))}</span>
        <span class="st-sim">${s.toFixed(2)}</span>
      </button>`).join('');
    if(acc) acc.classList.add('open');
  }catch(e){
    if (editingTaskId !== id) return;
    body.innerHTML = '<span class="intel-muted">Could not load neighbors.</span>';
  }
}


function renderEffortChips(t,eChips){
  [...eChips.children].forEach(b=>{b.classList.toggle('active',b.textContent.toLowerCase()===t.effort)})
}

function renderTagsEditor(id){
  const t=findTask(id);if(!t)return;
  const ed=gid('mdTagsEditor');ed.innerHTML='';
  (t.tags||[]).forEach((tag,i)=>{
    const chip=document.createElement('span');chip.className='tag-edit-chip';
    chip.innerHTML=esc(tag)+'<span class="tag-rm" onclick="removeTag('+id+','+i+')">×</span>';
    ed.appendChild(chip)
  });
  const inp=document.createElement('input');inp.className='tag-input';inp.placeholder='+ tag';
  inp.onkeydown=function(e){if(e.key==='Enter'&&inp.value.trim()){addTag(id,inp.value.trim());inp.value=''}};
  ed.appendChild(inp)
}
function addTag(id,tag){const t=findTask(id);if(!t)return;if(!t.tags)t.tags=[];if(!t.tags.includes(tag))t.tags.push(tag);renderTagsEditor(id)}
function removeTag(id,idx){const t=findTask(id);if(!t||!t.tags)return;t.tags.splice(idx,1);renderTagsEditor(id)}

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
function closeTaskDetail(opts){
  const skipRevert=opts&&opts.skipRevert;
  if(!skipRevert&&_taskModalSnapshot&&editingTaskId!=null){
    const id=editingTaskId,si=tasks.findIndex(x=>x.id===id);
    if(si>=0){
      const snap=JSON.parse(JSON.stringify(_taskModalSnapshot));
      tasks[si]=snap;
    }
  }
  _taskModalSnapshot=null;
  gid('taskModal').classList.remove('open');
  if(!skipRevert) renderTaskList();
  editingTaskId=null;
  document.removeEventListener('keydown',_taskModalTabTrap,true);
  if(_taskModalPrevFocus&&_taskModalPrevFocus.focus)try{_taskModalPrevFocus.focus()}catch(e){}
  _taskModalPrevFocus=null;
  if(typeof _updateActiveTaskTickSchedule==='function')_updateActiveTaskTickSchedule();
}
function saveTaskDetail(){
  if(!editingTaskId)return;
  const t=findTask(editingTaskId);if(!t)return;
  try{
  if(t.recur&&t.status==='done'&&typeof completeHabitCycle==='function'&&!t._habitCycledInSession){
    completeHabitCycle(t);
    gid('mdCheckbox').classList.remove('checked');gid('mdCheckbox').textContent='';
  }
  t.name=gid('mdName').value.trim()||t.name;
  t.dueDate=gid('mdDue').value||null;
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
    gid('mdTracked').textContent=fmtHMS(getRolledUpTime(t.id))+' · '+getRolledUpSessions(t.id)+' sessions';
  }else{t.status='done';t.completedAt=stampCompletion();gid('mdCheckbox').classList.add('checked');gid('mdCheckbox').textContent='✓'}
  // Update status chips
  const sChips=gid('mdStatusChips');if(sChips){[...sChips.children].forEach((c,i)=>c.classList.toggle('active',STATUS_ORDER[i]===t.status))}
}

function renderBanner(){
  const b=gid('banner');
  if(!activeTaskId){b.style.display='none';return}
  const t=findTask(activeTaskId);if(!t){b.style.display='none';return}
  b.style.display='block';
  const path=getTaskPath(activeTaskId);
  const bel=gid('bannerTask');
  if(path.length>1){
    bel.innerHTML='<span class="task-breadcrumb">'+path.slice(0,-1).map(esc).join(' › ')+' › </span>'+esc(t.name);
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
    if(single){ single.style.display=useMulti?'none':''; single.value=defaultValue||'' }
    if(multi){
      if(multi._appPromptKd){ multi.removeEventListener('keydown', multi._appPromptKd); multi._appPromptKd=null }
      multi.style.display=useMulti?'':'none';
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
  if(wno&&wno.style.display!=='none'){ e.preventDefault(); if(typeof closeWhatNext==='function') closeWhatNext(); return }
  const bulk=gid('bulkImportModal');
  if(bulk&&bulk.classList.contains('open')){ e.preventDefault(); if(typeof closeBulkImportModal==='function') closeBulkImportModal(); return }
  const tm=gid('taskModal');
  if(tm&&tm.classList.contains('open')){ e.preventDefault(); closeTaskDetail(); }
});

// ========== LOG ==========
function addLog(name,durSec,type){timeLog.unshift({id:++logIdCtr,name,durSec,type,time:timeNow()});renderLog();saveState('user')}
function removeLog(id){timeLog=timeLog.filter(l=>l.id!==id);renderLog();saveState('user')}
function renderLog(){const list=gid('logList');list.querySelectorAll('.log-item').forEach(e=>e.remove());if(!timeLog.length){gid('logEmpty').style.display='';return}gid('logEmpty').style.display='none';timeLog.slice(0,40).forEach(l=>{const d=document.createElement('div');d.className='log-item';const col=l.type==='work'?'var(--work)':l.type==='short'?'var(--short)':l.type==='quick'?'#48b5e0':'var(--long)';const lid=l.id||0;d.innerHTML=`<div class="log-dot" style="background:${col}"></div><span class="log-name">${esc(l.name)}</span><span class="log-dur">${fmtShort(l.durSec)}</span><span class="log-time">${esc(l.time)}</span>${lid?`<button class="log-del" onclick="removeLog(${lid})" title="Remove">×</button>`:''}`;list.appendChild(d)})}
function clearLog(){timeLog=[];renderLog();saveState('user')}

// ========== TAB NAVIGATION ==========
function showTab(tab){
  if(typeof closeCmdK==='function')closeCmdK();
  activeTab=tab;
  document.querySelectorAll('[data-tab]').forEach(el=>{el.style.display=el.dataset.tab===tab?'':'none'});
  document.querySelectorAll('.nav-tab').forEach(el=>{const on=el.dataset.navtab===tab;el.classList.toggle('active',on);el.setAttribute('aria-selected',on?'true':'false')});
  if(tab==='settings'&&!settingsOpen)toggleSettings();
  const nav=gid('navTabs');
  if(nav&&nav.getBoundingClientRect().top<0){
    window.scrollTo({top:nav.offsetTop-20,behavior:'smooth'});
  }
  if(tab==='focus'&&typeof setTimerSub==='function') setTimerSub(cfg.timerSub||'pomo');
  updateMiniTimer();
  saveState('auto');
}

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
function renderStats(){gid('statPomos').textContent=totalPomos;const fm=Math.floor(totalFocusSec/60);gid('statFocus').textContent=fm>=60?Math.floor(fm/60)+'h '+fm%60+'m':fm+'m';gid('statBreaks').textContent=totalBreaks;const h=gid('historyBlocks');h.innerHTML='';sessionHistory.forEach(s=>{const b=document.createElement('div');b.className='hblock h'+s.type[0];h.appendChild(b)})}
async function resetStats(){
  if(!(await showAppConfirm('Reset today\'s pomodoro stats and time log? Tasks and goals are not affected. A snapshot is archived to Past Days if there is progress to keep.')))return;
  const state={date:todayKey(),totalPomos,totalBreaks,totalFocusSec,goals:goals.map(g=>({text:g.text,done:g.done,doneAt:g.doneAt})),tasks:tasks.map(t=>({name:t.name,totalSec:getTaskElapsed(t),sessions:t.sessions})),timeLog,sessionHistory};
  if(totalPomos>0||goals.length>0||tasks.length>0)archiveDay(state);
  totalPomos=0;totalBreaks=0;totalFocusSec=0;pomosInCycle=0;sessionHistory=[];timeLog=[];
  renderStats();renderPips();renderGoalList();renderTaskList();renderLog();renderBanner();renderArchive();saveState('user');
  if(typeof _updateActiveTaskTickSchedule==='function')_updateActiveTaskTickSchedule();
}
function updateTitle(){if(running)document.title=(phase==='work'?'🔴':'🟢')+' '+fmt(remaining)+' — '+getPL(phase);else if(finished)document.title='✅ '+getPL(phase)+' Complete';else document.title='ODTAULAI'}

