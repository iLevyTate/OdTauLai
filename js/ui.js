// ========== CALENDAR VIEW ==========
function renderCalendar(visibleTasks){
  const container=gid('calendarView');if(!container)return;
  const now=calMonth?new Date(calMonth):new Date();
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
      if(src){src.dueDate=el.dataset.date;renderTaskList();saveState()}
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
    html += showEvs.map(ev =>
      `<div class="cal-task cal-feed-event" style="border-left-color:${ev.feedColor}" title="${esc(ev.feedLabel)}: ${esc(ev.title)}${ev.time?' at '+ev.time:''}${ev.location?' — '+esc(ev.location):''}">`
      + (ev.time ? `<span class="cal-feed-time">${esc(ev.time)}</span> ` : '')
      + esc(ev.title)
      + '</div>'
    ).join('');
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
  const now=calMonth?new Date(calMonth):new Date();
  now.setMonth(now.getMonth()+dir);
  calMonth=now.toISOString();renderTaskList()
}
function calToday(){calMonth=null;renderTaskList()}

// ========== COMMAND PALETTE (Cmd+K) ==========
let cmdkActiveIdx=0,cmdkFilteredItems=[];
function openCmdK(){
  const ov=gid('cmdkOverlay');if(!ov)return;
  ov.classList.add('open');
  gid('cmdkInput').value='';cmdkActiveIdx=0;renderCmdK();
  setTimeout(()=>gid('cmdkInput').focus(),30);
}
function closeCmdK(){gid('cmdkOverlay').classList.remove('open')}
function renderCmdK(){
  const q=gid('cmdkInput').value.toLowerCase().trim();
  const results=gid('cmdkResults');
  // Build items: actions + tasks + views
  const actions=[
    {type:'action',label:'Go to Tasks',icon:'☰',kbd:'1',run:()=>showTab('tasks')},
    {type:'action',label:'Go to Timer',icon:'◉',kbd:'2',run:()=>showTab('focus')},
    {type:'action',label:'Go to Tools',icon:'⏱',kbd:'3',run:()=>showTab('tools')},
    {type:'action',label:'Go to Data',icon:'▤',kbd:'4',run:()=>showTab('data')},
    {type:'action',label:'Go to Settings',icon:'⚙',kbd:'5',run:()=>showTab('settings')},
    {type:'action',label:'Today view',icon:'📅',run:()=>{showTab('tasks');setSmartView('today')}},
    {type:'action',label:'Overdue view',icon:'⚠',run:()=>{showTab('tasks');setSmartView('overdue')}},
    {type:'action',label:'Starred view',icon:'★',run:()=>{showTab('tasks');setSmartView('starred')}},
    {type:'action',label:'Archive view',icon:'🗂',run:()=>{showTab('tasks');setSmartView('archived')}},
    {type:'action',label:'List view',icon:'☰',run:()=>{showTab('tasks');setTaskView('list')}},
    {type:'action',label:'Board view',icon:'▦',run:()=>{showTab('tasks');setTaskView('board')}},
    {type:'action',label:'Calendar view',icon:'🗓',run:()=>{showTab('tasks');setTaskView('calendar')}},
    {type:'action',label:'Toggle theme',icon:'🌗',run:()=>toggleTheme()},
    {type:'action',label:'Start focus timer',icon:'▶',run:()=>{showTab('focus');if(!running)startTimer()}},
    {type:'action',label:'Add new list',icon:'+',run:()=>{showTab('tasks');addList()}},
  ];
  const items=[];
  // Match actions
  const matchedActions=q?actions.filter(a=>a.label.toLowerCase().includes(q)):actions;
  if(matchedActions.length){items.push({section:'Actions'});matchedActions.forEach(a=>items.push(a))}
  // Match tasks
  const matchedTasks=tasks.filter(t=>!t.archived&&(t.name.toLowerCase().includes(q)||(t.description||'').toLowerCase().includes(q))).slice(0,12);
  if(q&&matchedTasks.length){
    items.push({section:'Tasks'});
    matchedTasks.forEach(t=>items.push({type:'task',label:t.name,icon:t.status==='done'?'✓':'○',desc:(t.dueDate?fmtDue(t.dueDate):'')||getTaskPath(t.id).slice(0,-1).join(' › '),run:()=>{showTab('tasks');openTaskDetail(t.id)}}));
  }
  cmdkFilteredItems=items.filter(i=>!i.section);
  if(cmdkActiveIdx>=cmdkFilteredItems.length)cmdkActiveIdx=Math.max(0,cmdkFilteredItems.length-1);
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
  if(e.key==='ArrowDown'){e.preventDefault();cmdkActiveIdx=Math.min(cmdkActiveIdx+1,cmdkFilteredItems.length-1);renderCmdK()}
  else if(e.key==='ArrowUp'){e.preventDefault();cmdkActiveIdx=Math.max(cmdkActiveIdx-1,0);renderCmdK()}
  else if(e.key==='Enter'){e.preventDefault();cmdkRun(cmdkActiveIdx)}
}
// Keyboard shortcut: Cmd+K / Ctrl+K
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();openCmdK()}
});

// ========== THEME TOGGLE ==========
function toggleTheme(){
  theme=theme==='dark'?'light':'dark';
  applyTheme();saveState();
}
function applyTheme(){
  document.body.classList.toggle('light-theme',theme==='light');
  const btn=gid('themeToggleBtn');if(btn)btn.textContent=theme==='dark'?'🌙':'☀';
}
function hasVisibleDescendant(taskId,visibleSet){
  return getTaskDescendantIds(taskId).some(id=>visibleSet.has(id))
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
    +(t.starred?' starred-task':'')
    +(t.priority&&t.priority!=='none'?' priority-'+t.priority+'-item':'');
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
    const srcId=parseInt(e.dataTransfer.getData('text/plain'));if(!srcId||srcId===t.id)return;
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
      e.preventDefault&&e.preventDefault();
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

  // Signal chips: ONLY show due date if meaningful (today/overdue/soon), and inline hidden otherwise
  let signalChips='';
  // List indicator dot — only show if viewing All and >1 list has tasks (otherwise pure noise)
  const taskOwnerList=lists.find(l=>l.id===t.listId);
  const listsWithTasks=new Set(tasks.filter(x=>!x.archived&&x.status!=='done').map(x=>x.listId));
  if(taskOwnerList&&activeListId==='all'&&listsWithTasks.size>1){
    signalChips+='<span class="task-sig sig-list" style="background:transparent;padding:0" title="List: '+esc(taskOwnerList.name)+'"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:'+taskOwnerList.color+'"></span></span>';
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
  // Recurring icon (simple)
  if(t.recur){
    signalChips+='<span class="task-sig sig-recur" title="Repeats '+t.recur+'">↻</span>';
  }
  // Active timer indicator
  if(isActive){
    signalChips+='<span class="task-sig sig-active" title="Tracking time">● '+fmtHMS(rolledTime)+'</span>';
  }
  // Category badge (values alignment)
  if(t.category){
    const catIcon={health:'❤',finance:'💰',work:'💼',relationships:'🤝',learning:'📚',home:'🏠',personal:'🧘',other:'📌'}[t.category]||'📌';
    signalChips+='<span class="task-sig sig-cat" title="'+(t.valuesNote||t.category)+'">'+catIcon+' '+t.category+'</span>';
  }
  // Values alignment dots
  if(t.valuesAlignment&&t.valuesAlignment.length){
    signalChips+='<span class="task-sig sig-values" title="Serves: '+t.valuesAlignment.join(', ')+'">◈</span>';
  }
  if(window._dupSimMap && window._dupSimMap.get(t.id) >= 0.9){
    signalChips+='<span class="task-sig task-dup-badge" title="Very similar to another task">⧉ dup</span>';
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

  d.innerHTML=
    '<div class="task-row-primary">'
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
  list.appendChild(d)
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
      const srcId=parseInt(e.dataTransfer.getData('text/plain'));
      const src=findTask(srcId);if(!src)return;
      src.status=st;
      if(st==='done'){src.completedAt=timeNow();if(src.recur)spawnRecurringClone(src)}
      else src.completedAt=null;
      renderTaskList();saveState();
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
      const due=t.dueDate?'<span class="due-chip'+(getDueClass(t.dueDate)?' '+getDueClass(t.dueDate):'')+'">📅 '+fmtDue(t.dueDate)+'</span>':'';
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

// Task Detail Modal
function openTaskDetail(id){
  const t=findTask(id);if(!t)return;
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
  gid('mdStats').innerHTML='<span><b>Path:</b> '+esc(pathStr)+'<b style="color:#e2e8f0">'+esc(t.name)+'</b></span> · <span>Created '+(t.created||'—')+'</span>'+(t.completedAt?' · <span>Done '+t.completedAt+'</span>':'');
  // List selector
  const listSel=gid('mdList');listSel.innerHTML='';
  lists.forEach(l=>{const opt=document.createElement('option');opt.value=l.id;opt.textContent=l.name;if((t.listId||lists[0].id)===l.id)opt.selected=true;listSel.appendChild(opt)});
  // Status chips
  const sChips=gid('mdStatusChips');sChips.innerHTML='';
  STATUS_ORDER.forEach(st=>{
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.status||'open')===st?' active':'');
    b.textContent=STATUSES[st].label;
    b.onclick=function(){t.status=st;gid('mdCheckbox').classList.toggle('checked',st==='done');gid('mdCheckbox').textContent=st==='done'?'✓':'';[...sChips.children].forEach(c=>c.classList.remove('active'));b.classList.add('active')};
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
  // Type chips
  const tChips=gid('mdTypeChips');tChips.innerHTML='';
  [['task','📋 Task'],['bug','🐛 Bug'],['idea','💡 Idea'],['errand','🏃 Errand'],['waiting','⏳ Waiting']].forEach(([key,lbl])=>{
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.type||'task')===key?' active':'');
    b.textContent=lbl;
    b.onclick=function(){t.type=key;[...tChips.children].forEach(c=>c.classList.remove('active'));b.classList.add('active')};
    tChips.appendChild(b)
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
  [['high','⚡ High energy'],['low','🌿 Low energy']].forEach(([key,lbl])=>{
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.energyLevel||null)===key?' active':'');
    b.textContent=lbl;
    b.onclick=function(){t.energyLevel=t.energyLevel===key?null:key;[...enChips.children].forEach(c=>c.classList.remove('active'));if(t.energyLevel)b.classList.add('active')};
    enChips.appendChild(b)
  });
  // Context chips
  const cxChips=gid('mdContextChips');cxChips.innerHTML='';
  [['work','💼 Work'],['home','🏠 Home'],['phone','📱 Phone'],['computer','💻 Computer'],['errands','🚗 Errands']].forEach(([key,lbl])=>{
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.context||null)===key?' active':'');
    b.textContent=lbl;
    b.onclick=function(){t.context=t.context===key?null:key;[...cxChips.children].forEach(c=>c.classList.remove('active'));if(t.context)b.classList.add('active')};
    cxChips.appendChild(b)
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
  const CATS=[['health','❤ Health'],['finance','💰 Finance'],['work','💼 Work'],['relationships','🤝 Relationships'],['learning','📚 Learning'],['home','🏠 Home'],['personal','🧘 Personal'],['other','📌 Other']];
  const catChips=gid('mdCategoryChips');catChips.innerHTML='';
  CATS.forEach(([key,lbl])=>{
    const b=document.createElement('button');b.className='mfield-chip-btn'+((t.category||null)===key?' active':'');
    b.textContent=lbl;
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
  gid('taskModal').classList.add('open');
  setTimeout(()=>gid('mdName').focus(),50)
}

async function refreshMdSimilarTasks(id){
  const body = gid('mdSimilarTasks');
  const acc = gid('mdSimilarAccordion');
  if(!body) return;
  if(typeof isIntelReady !== 'function' || !isIntelReady()){
    body.innerHTML = '<span class="intel-muted">Load intelligence (Settings) for similar tasks.</span>';
    if(acc) acc.classList.remove('open');
    return;
  }
  body.innerHTML = '<span class="intel-muted">Finding neighbors…</span>';
  try{
    const sim = await similarTasksFor(id, 5);
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

function closeTaskDetail(){gid('taskModal').classList.remove('open');editingTaskId=null}
function saveTaskDetail(){
  if(!editingTaskId)return;
  const t=findTask(editingTaskId);if(!t)return;
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
  if(t.status==='done'&&!t.completedAt)t.completedAt=timeNow();
  if(t.status!=='done')t.completedAt=null;
  closeTaskDetail();renderTaskList();saveState()
}
function deleteTaskFromModal(){
  if(!editingTaskId)return;
  const id=editingTaskId;closeTaskDetail();removeTask(id);
}
function toggleTaskDone(){
  if(!editingTaskId)return;
  const t=findTask(editingTaskId);if(!t)return;
  if(t.status==='done'){t.status='open';t.completedAt=null;gid('mdCheckbox').classList.remove('checked');gid('mdCheckbox').textContent=''}
  else{t.status='done';t.completedAt=timeNow();gid('mdCheckbox').classList.add('checked');gid('mdCheckbox').textContent='✓'}
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
setInterval(()=>{if(activeTaskId){renderTaskList();renderBanner()}},1000);

// ESC closes modal
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&gid('taskModal').classList.contains('open'))closeTaskDetail()});

// ========== LOG ==========
function addLog(name,durSec,type){timeLog.unshift({id:++logIdCtr,name,durSec,type,time:timeNow()});renderLog();saveState()}
function removeLog(id){timeLog=timeLog.filter(l=>l.id!==id);renderLog();saveState()}
function renderLog(){const list=gid('logList');list.querySelectorAll('.log-item').forEach(e=>e.remove());if(!timeLog.length){gid('logEmpty').style.display='';return}gid('logEmpty').style.display='none';timeLog.slice(0,40).forEach(l=>{const d=document.createElement('div');d.className='log-item';const col=l.type==='work'?'var(--work)':l.type==='short'?'var(--short)':l.type==='quick'?'#48b5e0':'var(--long)';const lid=l.id||0;d.innerHTML=`<div class="log-dot" style="background:${col}"></div><span class="log-name">${esc(l.name)}</span><span class="log-dur">${fmtShort(l.durSec)}</span><span class="log-time">${l.time}</span>${lid?`<button class="log-del" onclick="removeLog(${lid})" title="Remove">×</button>`:''}`;list.appendChild(d)})}
function clearLog(){timeLog=[];renderLog();saveState()}

// ========== TAB NAVIGATION ==========
function showTab(tab){
  activeTab=tab;
  document.querySelectorAll('[data-tab]').forEach(el=>{el.style.display=el.dataset.tab===tab?'':'none'});
  document.querySelectorAll('.nav-tab').forEach(el=>{el.classList.toggle('active',el.dataset.navtab===tab)});
  // Auto-open settings accordion when user switches to Settings tab
  if(tab==='settings'&&!settingsOpen)toggleSettings();
  // Scroll to top of content for clean view
  window.scrollTo({top:gid('navTabs').offsetTop-20,behavior:'smooth'});
  updateMiniTimer();
  saveState()
}

// ========== FLOATING MINI TIMER ==========
// Show the mini-timer when not on the Timer (focus) tab. Click it to jump to Timer.
window.toggleSimilarAccordion = function(){
  const acc = gid('mdSimilarAccordion');
  if(acc) acc.classList.toggle('open');
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
function resetStats(){
  if(!confirm('Reset today\'s data? Current progress will be archived to Past Days.'))return;
  // Archive current day before resetting
  const state={date:todayKey(),totalPomos,totalBreaks,totalFocusSec,goals:goals.map(g=>({text:g.text,done:g.done,doneAt:g.doneAt})),tasks:tasks.map(t=>({name:t.name,totalSec:getTaskElapsed(t),sessions:t.sessions})),timeLog,sessionHistory};
  if(totalPomos>0||goals.length>0||tasks.length>0)archiveDay(state);
  totalPomos=0;totalBreaks=0;totalFocusSec=0;pomosInCycle=0;sessionHistory=[];
  goals=[];goalIdCtr=0;tasks=[];taskIdCtr=0;activeTaskId=null;taskStartedAt=null;timeLog=[];
  renderStats();renderPips();renderGoalList();renderTaskList();renderLog();renderBanner();renderArchive();saveState()
}
function updateTitle(){if(running)document.title=(phase==='work'?'🔴':'🟢')+' '+fmt(remaining)+' — '+getPL(phase);else if(finished)document.title='✅ '+getPL(phase)+' Complete';else document.title='ODTAULAI'}

