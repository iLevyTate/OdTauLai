// ========== GOALS ==========
function addGoal(){const inp=gid('goalInput');if(!inp)return;const text=inp.value.trim();if(!text)return;goals.push({id:++goalIdCtr,text,done:false,doneAt:null,addedAt:timeNow()});inp.value='';renderGoalList();saveState()}
function toggleGoal(id){const g=goals.find(x=>x.id===id);if(g){g.done=!g.done;g.doneAt=g.done?timeNow():null}renderGoalList();saveState()}
function removeGoal(id){goals=goals.filter(g=>g.id!==id);renderGoalList();saveState()}
function renderGoalList(){
  const list=gid('goalList');if(!list)return; // panel removed — skip everything
  const cnt=gid('goalCount');if(cnt)cnt.textContent=goals.filter(g=>g.done).length+' / '+goals.length;
  list.querySelectorAll('.goal-item').forEach(e=>e.remove());
  const empty=gid('goalEmpty'),prog=gid('goalProgress');
  if(!goals.length){if(empty)empty.style.display='';if(prog)prog.style.display='none';return}
  if(empty)empty.style.display='none';if(prog)prog.style.display='flex';
  const pct=goals.length?Math.round((goals.filter(g=>g.done).length/goals.length)*100):0;
  const bar=gid('goalBar'),pctEl=gid('goalPct');
  if(bar)bar.style.width=pct+'%';if(pctEl)pctEl.textContent=pct+'%';
  [...goals.filter(g=>!g.done),...goals.filter(g=>g.done)].forEach(g=>{
    const d=document.createElement('div');d.className='goal-item'+(g.done?' checked':'');
    d.innerHTML=`<button class="goal-check${g.done?' on':''}" onclick="toggleGoal(${g.id})">${g.done?'✓':''}</button><span class="goal-text">${esc(g.text)}</span>${g.doneAt?`<span class="goal-time">${g.doneAt}</span>`:''}<button class="goal-rm" onclick="removeGoal(${g.id})">×</button>`;
    list.appendChild(d)
  })
}

// ========== CLICKUP-STYLE TASKS ==========
// Status definitions (colors match CSS)
const STATUSES={
  open:{label:'Open',cls:'status-open'},
  progress:{label:'In Progress',cls:'status-progress'},
  review:{label:'Review',cls:'status-review'},
  blocked:{label:'Blocked',cls:'status-blocked'},
  done:{label:'Done',cls:'status-done'}
};
const STATUS_ORDER=['open','progress','review','blocked','done'];
const PRIORITIES={
  urgent:{label:'Urgent',icon:'⚑',cls:'priority-urgent'},
  high:{label:'High',icon:'⚑',cls:'priority-high'},
  normal:{label:'Normal',icon:'⚑',cls:'priority-normal'},
  low:{label:'Low',icon:'⚑',cls:'priority-low'},
  none:{label:'None',icon:'⚐',cls:'priority-none'}
};
const PRIORITY_ORDER={urgent:0,high:1,normal:2,low:3,none:4};

function defaultTaskProps(){return{
  status:'open',priority:'none',tags:[],dueDate:null,startDate:null,
  estimateMin:0,description:'',starred:false,completedAt:null,
  listId:activeListId,archived:false,
  recur:null,order:Date.now(),
  remindAt:null,reminderFired:false,
  type:'task',effort:null,energyLevel:null,context:null,
  blockedBy:[],checklist:[],notes:[],url:null,completionNote:null,
  // v5 — values alignment
  category:null,        // life area: health|finance|work|relationships|learning|home|personal|other
  valuesAlignment:[],   // which user values this task serves e.g. ['security','benevolence']
  valuesNote:null       // Short note from values alignment
}}

let _dupRefreshTimer = null;
function scheduleIntelDupRefresh(){
  if(_dupRefreshTimer) return;
  _dupRefreshTimer = setTimeout(async () => {
    _dupRefreshTimer = null;
    if(typeof computeDuplicateScores !== 'function' || typeof isIntelReady !== 'function' || !isIntelReady()) return;
    try{
      window._dupSimMap = await computeDuplicateScores();
      if(typeof renderTaskList === 'function') renderTaskList();
    }catch(e){}
  }, 2000);
}
window.scheduleIntelDupRefresh = scheduleIntelDupRefresh;
window.invalidateDupMap = function(){ window._dupSimMap = null; };

// Parse natural language tokens from input: @priority, #tag, !star, ~recur, today/tomorrow/mon-sun
function parseQuickAdd(raw){
  let text=raw;
  const props={};
  // Priority @urgent @high @normal @low
  const prMatch=text.match(/\s@(urgent|high|normal|low)\b/i);
  if(prMatch){props.priority=prMatch[1].toLowerCase();text=text.replace(prMatch[0],'')}
  // Tags #tag  (multiple)
  const tagRe=/\s#(\w+)/g;const tags=[];let m;
  while((m=tagRe.exec(text))!==null)tags.push(m[1]);
  if(tags.length){props.tags=tags;text=text.replace(/\s#\w+/g,'')}
  // Star !star !pin
  if(/\s!(star|pin)\b/i.test(text)){props.starred=true;text=text.replace(/\s!(star|pin)\b/i,'')}
  // Recurrence ~daily ~weekdays ~weekly ~monthly
  const rcMatch=text.match(/\s~(daily|weekdays|weekly|monthly)\b/i);
  if(rcMatch){props.recur=rcMatch[1].toLowerCase();text=text.replace(rcMatch[0],'')}
  // Due date: today, tomorrow, mon-sun, next week
  const days={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
  const todayISOs=todayISO();
  const lower=' '+text.toLowerCase()+' ';
  if(/\btoday\b/i.test(lower)){props.dueDate=todayISOs;text=text.replace(/\btoday\b/i,'')}
  else if(/\btomorrow\b|\btmrw\b/i.test(lower)){
    const d=new Date();d.setDate(d.getDate()+1);
    props.dueDate=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    text=text.replace(/\btomorrow\b|\btmrw\b/i,'');
  }else if(/\bnext week\b/i.test(lower)){
    const d=new Date();d.setDate(d.getDate()+7);
    props.dueDate=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    text=text.replace(/\bnext week\b/i,'');
  }else{
    const dayMatch=text.match(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day)?\b/i);
    if(dayMatch){
      const target=days[dayMatch[1].toLowerCase().slice(0,3)];
      const d=new Date();const today=d.getDay();
      let diff=(target-today+7)%7;if(diff===0)diff=7;
      d.setDate(d.getDate()+diff);
      props.dueDate=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      text=text.replace(dayMatch[0],'');
    }
  }
  return{name:text.replace(/\s+/g,' ').trim(),props};
}

async function addTask(){
  const inp=gid('taskInput'),raw=inp.value.trim();if(!raw)return;
  ensureDefaultList();
  let name, props;
  if(typeof parseQuickAddAsync === 'function'){
    const parsed = await parseQuickAddAsync(raw);
    name = parsed.name;
    props = parsed.props;
  } else {
    const p = parseQuickAdd(raw);
    name = p.name;
    props = p.props;
  }
  if(!name){ name = raw; props = {}; }
  tasks.push(Object.assign({
    id:++taskIdCtr,name,totalSec:0,sessions:0,created:timeNowFull(),
    parentId:null,collapsed:false
  },defaultTaskProps(),props));
  inp.value='';renderTaskList();saveState()
}
function findTask(id){return tasks.find(t=>t.id===id)}

// Tree helpers
function getTaskChildren(parentId){return tasks.filter(t=>(t.parentId||null)===parentId)}
function hasChildren(taskId){return tasks.some(t=>t.parentId===taskId)}
function getTaskDescendantIds(taskId){
  const result=[],queue=[taskId];
  while(queue.length){
    const id=queue.shift();
    tasks.filter(t=>t.parentId===id).forEach(c=>{result.push(c.id);queue.push(c.id)});
  }
  return result;
}
function getRolledUpTime(taskId){
  const t=findTask(taskId);if(!t)return 0;
  let total=getTaskElapsed(t);
  getTaskDescendantIds(taskId).forEach(id=>{const d=findTask(id);if(d)total+=getTaskElapsed(d)});
  return total;
}
function getRolledUpSessions(taskId){
  const t=findTask(taskId);if(!t)return 0;
  let total=t.sessions||0;
  getTaskDescendantIds(taskId).forEach(id=>{const d=findTask(id);if(d)total+=d.sessions||0});
  return total;
}
function getTaskPath(taskId){
  const path=[];let cur=findTask(taskId);
  while(cur){path.unshift(cur.name);cur=cur.parentId?findTask(cur.parentId):null}
  return path;
}
function getTaskElapsed(t){let s=t.totalSec;if(activeTaskId===t.id&&taskStartedAt)s+=Math.floor((Date.now()-taskStartedAt)/1000);return s}

// Due date helpers
function todayISO(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function getDueClass(dateStr){
  if(!dateStr)return null;
  const today=todayISO();
  if(dateStr<today)return 'overdue';
  if(dateStr===today)return 'today';
  const now=new Date(today),due=new Date(dateStr);
  const days=Math.round((due-now)/(1000*60*60*24));
  if(days<=3)return 'soon';
  return null;
}
function fmtDue(dateStr){
  if(!dateStr)return '';
  const today=todayISO();
  if(dateStr===today)return 'Today';
  const tmr=new Date();tmr.setDate(tmr.getDate()+1);
  const tmrISO=tmr.getFullYear()+'-'+String(tmr.getMonth()+1).padStart(2,'0')+'-'+String(tmr.getDate()).padStart(2,'0');
  if(dateStr===tmrISO)return 'Tomorrow';
  const d=new Date(dateStr+'T00:00:00');
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
}

// Subtask UI (nested)
function addSubtaskPrompt(parentId){
  event&&event.stopPropagation();
  subtaskPromptParent=parentId;
  const p=findTask(parentId);if(p&&p.collapsed)p.collapsed=false;
  renderTaskList();
  setTimeout(()=>{const i=document.querySelector('.task-sub-input[data-parent="'+parentId+'"]');if(i)i.focus()},20);
}
function addSubtask(parentId){
  const input=document.querySelector('.task-sub-input[data-parent="'+parentId+'"]');
  if(!input)return;
  const name=input.value.trim();
  if(!name){subtaskPromptParent=null;renderTaskList();return}
  const parent=findTask(parentId);if(!parent)return;
  tasks.push(Object.assign({
    id:++taskIdCtr,name,totalSec:0,sessions:0,created:timeNowFull(),
    parentId,collapsed:false
  },defaultTaskProps(),{listId:parent.listId}));
  subtaskPromptParent=null;renderTaskList();saveState()
}
function cancelSubtaskPrompt(){subtaskPromptParent=null;renderTaskList()}
function toggleCollapse(taskId){event&&event.stopPropagation();const t=findTask(taskId);if(!t)return;t.collapsed=!t.collapsed;renderTaskList();saveState()}

// Time tracking
function toggleTask(id){
  event&&event.stopPropagation();
  if(activeTaskId===id){const t=findTask(id);if(t&&taskStartedAt){t.totalSec+=Math.floor((Date.now()-taskStartedAt)/1000);taskStartedAt=null}activeTaskId=null}
  else{if(activeTaskId&&taskStartedAt){const ot=findTask(activeTaskId);if(ot)ot.totalSec+=Math.floor((Date.now()-taskStartedAt)/1000)}activeTaskId=id;taskStartedAt=Date.now();
    // Auto-set status to In Progress when starting time
    const t=findTask(id);if(t&&t.status==='open')t.status='progress';
  }
  renderTaskList();renderBanner();saveState()
}

function removeTask(id){
  event&&event.stopPropagation();
  const task=findTask(id);if(!task)return;
  // If viewing archive, this is a permanent delete
  if(task.archived||smartView==='archived'){
    const descendants=getTaskDescendantIds(id);
    if(!confirm('Permanently delete "'+task.name+'"'+(descendants.length>0?' and '+descendants.length+' subtask'+(descendants.length!==1?'s':''):'')+'? Cannot be undone.'))return;
    const toRemove=[id,...descendants];
    if(toRemove.includes(activeTaskId)){
      if(taskStartedAt){const t=findTask(activeTaskId);if(t)t.totalSec+=Math.floor((Date.now()-taskStartedAt)/1000)}
      activeTaskId=null;taskStartedAt=null;
    }
    tasks=tasks.filter(t=>!toRemove.includes(t.id));
    if(typeof embedStore !== 'undefined' && embedStore && embedStore.purge){
      embedStore.purge(toRemove).catch(()=>{});
    }
  }else{
    // Archive it
    const descendants=getTaskDescendantIds(id);
    if(descendants.length>0&&!confirm('Archive "'+task.name+'" and '+descendants.length+' subtask'+(descendants.length!==1?'s':'')+'?'))return;
    const toArchive=[id,...descendants];
    if(toArchive.includes(activeTaskId)){
      if(taskStartedAt){const t=findTask(activeTaskId);if(t)t.totalSec+=Math.floor((Date.now()-taskStartedAt)/1000)}
      activeTaskId=null;taskStartedAt=null;
    }
    toArchive.forEach(tid=>{const t=findTask(tid);if(t)t.archived=true});
  }
  renderTaskList();renderBanner();saveState()
}

function restoreTask(id){
  event&&event.stopPropagation();
  const t=findTask(id);if(!t)return;
  t.archived=false;
  // Restore any descendants too
  getTaskDescendantIds(id).forEach(did=>{const d=findTask(did);if(d)d.archived=false});
  renderTaskList();saveState()
}

function emptyArchive(){
  tasks=tasks.filter(t=>!t.archived);
  renderTaskList();saveState()
}

// Smart Views
function setSmartView(v){
  smartView=v;
  document.querySelectorAll('.sv-chip').forEach(el=>{el.classList.toggle('active',el.dataset.view===v)});
  const notice=gid('archivedNotice');if(notice)notice.style.display=v==='archived'?'flex':'none';
  renderTaskList();saveState()
}

// Star toggle
function toggleStar(id){
  event&&event.stopPropagation();
  const t=findTask(id);if(!t)return;
  t.starred=!t.starred;renderTaskList();saveState()
}

// Reorder (manual)
function reorderTask(id,dir){
  event&&event.stopPropagation();
  const t=findTask(id);if(!t)return;
  // Find siblings with same parentId, sorted by order
  const siblings=tasks.filter(x=>x.parentId===t.parentId&&!x.archived&&matchesFilters(x)).sort((a,b)=>(a.order||0)-(b.order||0));
  const idx=siblings.findIndex(x=>x.id===id);
  const target=idx+dir;
  if(target<0||target>=siblings.length)return;
  // Swap order values
  const a=siblings[idx],b=siblings[target];
  const tmp=a.order;a.order=b.order;b.order=tmp;
  renderTaskList();saveState()
}

// Drag-drop handler for list view
function handleTaskDrop(srcId,targetId,position){
  const src=findTask(srcId),target=findTask(targetId);
  if(!src||!target)return;
  // Don't allow dropping a task onto its own descendant (would create a cycle)
  if(getTaskDescendantIds(srcId).includes(targetId))return;
  // Move to same parent as target, ordered right above/below target
  src.parentId=target.parentId;
  const targetOrder=target.order||0;
  src.order=position==='before'?targetOrder-0.5:targetOrder+0.5;
  // Re-normalize order values in this sibling group
  const siblings=tasks.filter(x=>x.parentId===src.parentId).sort((a,b)=>(a.order||0)-(b.order||0));
  siblings.forEach((s,i)=>{s.order=i*10});
  // Force manual sort when user drags
  if(taskSortBy!=='manual'){taskSortBy='manual';const sel=gid('taskSortSel');if(sel)sel.value='manual'}
  renderTaskList();saveState()
}

// Subtask completion progress
function getSubtaskProgress(taskId){
  const descIds=getTaskDescendantIds(taskId);
  if(!descIds.length)return null;
  const total=descIds.length;
  const done=descIds.filter(id=>{const t=findTask(id);return t&&t.status==='done'}).length;
  return{done,total,pct:Math.round(done/total*100)};
}

// Quick date buttons
function setQuickDate(offset){
  if(offset==='clear'){gid('mdDue').value='';return}
  const d=new Date();d.setDate(d.getDate()+offset);
  gid('mdDue').value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// ========== REMINDERS ==========
function setQuickReminder(offset,hour){
  if(offset==='clear'){gid('mdRemindAt').value='';return}
  let d;
  if(offset==='due'){
    const due=gid('mdDue').value;
    if(!due){alert('Set a due date first');return}
    d=new Date(due+'T00:00:00');
  }else{
    d=new Date();d.setDate(d.getDate()+offset);
  }
  d.setHours(hour,0,0,0);
  const yr=d.getFullYear(),mo=String(d.getMonth()+1).padStart(2,'0'),da=String(d.getDate()).padStart(2,'0');
  const hh=String(d.getHours()).padStart(2,'0'),mm=String(d.getMinutes()).padStart(2,'0');
  gid('mdRemindAt').value=yr+'-'+mo+'-'+da+'T'+hh+':'+mm;
}

function checkReminders(){
  const now=Date.now();
  let fired=false;
  tasks.forEach(t=>{
    if(!t.remindAt||t.reminderFired||t.archived||t.status==='done')return;
    const remindTime=new Date(t.remindAt).getTime();
    if(now>=remindTime){
      t.reminderFired=true;fired=true;
      const late=(now-remindTime)>5*60*1000;
      const title=(late?'Missed: ':'Task reminder: ')+t.name;
      if('Notification' in window&&Notification.permission==='granted'){
        try{
          const n=new Notification(title,{
            body:t.dueDate?'Due '+fmtDue(t.dueDate):'No due date',
            tag:'task-'+t.id,requireInteraction:true
          });
          n.onclick=function(){window.focus();showTab('tasks');openTaskDetail(t.id);n.close()};
        }catch(e){}
      }else if(cfg.sound){playChime('bell')}
    }
  });
  if(fired)saveState()
}
// Check reminders every 30s
setInterval(checkReminders,30000);
// And once on load
setTimeout(checkReminders,1000);

// Recurring tasks — when a recurring task is marked done, clone it with next due date
function advanceRecurringDate(dateStr,recurType){
  const d=dateStr?new Date(dateStr+'T12:00:00'):new Date();
  if(recurType==='daily')d.setDate(d.getDate()+1);
  else if(recurType==='weekdays'){
    d.setDate(d.getDate()+1);
    while(d.getDay()===0||d.getDay()===6)d.setDate(d.getDate()+1);
  }
  else if(recurType==='weekly')d.setDate(d.getDate()+7);
  else if(recurType==='monthly')d.setMonth(d.getMonth()+1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function spawnRecurringClone(t){
  if(!t.recur)return;
  const newDue=advanceRecurringDate(t.dueDate||todayISO(),t.recur);
  tasks.push({
    id:++taskIdCtr,name:t.name,totalSec:0,sessions:0,created:timeNowFull(),
    parentId:t.parentId,collapsed:false,archived:false,completedAt:null,
    status:'open',priority:t.priority,tags:[...(t.tags||[])],
    dueDate:newDue,startDate:null,estimateMin:t.estimateMin,
    description:t.description,starred:t.starred,listId:t.listId,
    recur:t.recur,order:Date.now(),remindAt:null,reminderFired:false,
    type:t.type||'task',effort:t.effort||null,energyLevel:t.energyLevel||null,
    context:t.context||null,blockedBy:[],checklist:[],notes:[],
    url:t.url||null,completionNote:null,
    category:t.category||null,valuesAlignment:[...(t.valuesAlignment||[])],valuesNote:null,
  });
}

// Status/Priority quick-change
function cycleStatus(id){
  event&&event.stopPropagation();
  const t=findTask(id);if(!t)return;
  const idx=STATUS_ORDER.indexOf(t.status||'open');
  t.status=STATUS_ORDER[(idx+1)%STATUS_ORDER.length];
  if(t.status==='done')t.completedAt=timeNow();
  else t.completedAt=null;
  renderTaskList();saveState()
}

function toggleTaskDoneQuick(id){
  event&&event.stopPropagation();
  const t=findTask(id);if(!t)return;
  if(t.status==='done'){t.status='open';t.completedAt=null}
  else{
    t.status='done';t.completedAt=timeNow();
    if(activeTaskId===id){toggleTask(id)}
    if(t.recur)spawnRecurringClone(t);
    haptic(15);
    // Dopamine: animate the row + a little sparkle
    setTimeout(()=>{
      const row=document.querySelector('.task-item[data-task-id="'+id+'"]');
      if(row){
        row.classList.add('just-done');
        const spark=document.createElement('span');spark.className='done-sparkle';spark.textContent='✨';
        const rect=row.getBoundingClientRect();
        spark.style.cssText='left:'+(rect.left+32)+'px;top:'+(rect.top+10)+'px;position:fixed;z-index:2000';
        document.body.appendChild(spark);
        setTimeout(()=>spark.remove(),700);
      }
    },10);
  }
  renderTaskList();saveState()
}

// Haptic helper — vibrate on supporting devices (iOS Safari + all Android)
function haptic(ms){
  if(navigator.vibrate)try{navigator.vibrate(ms||10)}catch(e){}
}

// Lists (Projects)
// Each list: { id, name, color, description } — description is optional but feeds
// Auto-organize (embeddings route tasks to the list whose name+description they
// match best). Example: description "bills, taxes, budgets, investments" routes
// "pay rent" or "review purchases" to Finance.
function ensureDefaultList(){
  if(lists.length===0){
    lists.push({id:++listIdCtr,name:'Personal',color:'#2ecc71',description:'Personal life — errands, home, hobbies, relationships, health, self-care.'});
    lists.push({id:++listIdCtr,name:'Work',color:'#3d8bcc',description:'Work and career — projects, meetings, deadlines, professional learning.'});
    activeListId=lists[0].id;
  }
  if(!activeListId&&lists.length)activeListId=lists[0].id;
  // Assign orphaned tasks to the active list
  const defList=activeListId||lists[0].id;
  tasks.forEach(t=>{if(!t.listId)t.listId=defList});
  lists.forEach(l=>{if(typeof l.description!=='string')l.description=''});
}
const LIST_DESC_HINT='Short description (optional) — feeds Auto-organize so new tasks get routed here.\nExamples: "bills, taxes, budgets, investments" or "household chores, repairs, cleaning".';
function addList(){
  const name=prompt('List name:');if(!name||!name.trim())return;
  const description=(prompt(LIST_DESC_HINT,'')||'').trim();
  const colors=['#2ecc71','#3d8bcc','#e056a0','#e8a838','#9b59b6','#48b5e0','#c0392b','#1abc9c'];
  const color=colors[lists.length%colors.length];
  lists.push({id:++listIdCtr,name:name.trim(),color,description});
  activeListId=listIdCtr;
  if(typeof invalidateListVectorCache==='function')invalidateListVectorCache();
  renderLists();renderTaskList();saveState()
}
function editList(id){
  event&&event.stopPropagation();
  const l=lists.find(x=>x.id===id);if(!l)return;
  const name=prompt('List name:',l.name);
  if(name===null)return;
  if(!name.trim()){alert('Name cannot be empty.');return}
  const description=prompt(LIST_DESC_HINT,l.description||'');
  if(description===null)return;
  l.name=name.trim();
  l.description=description.trim();
  if(typeof invalidateListVectorCache==='function')invalidateListVectorCache();
  renderLists();renderTaskList();saveState()
}
function removeList(id){
  event&&event.stopPropagation();
  if(lists.length<=1){alert('You need at least one list.');return}
  const list=lists.find(l=>l.id===id);if(!list)return;
  const taskCount=tasks.filter(t=>t.listId===id).length;
  if(!confirm('Delete list "'+list.name+'"?'+(taskCount>0?' '+taskCount+' task(s) will be moved to the first remaining list.':'')))return;
  lists=lists.filter(l=>l.id!==id);
  const fallbackId=lists[0].id;
  tasks.forEach(t=>{if(t.listId===id)t.listId=fallbackId});
  if(activeListId===id)activeListId=fallbackId;
  if(typeof invalidateListVectorCache==='function')invalidateListVectorCache();
  renderLists();renderTaskList();saveState()
}
function switchList(id){activeListId=id;renderLists();renderTaskList();saveState()}
function renderLists(){
  const bar=gid('listsBar');if(!bar)return;
  ensureDefaultList();
  bar.innerHTML='';
  // Hide the whole bar when only 1 list OR when only 1 list has tasks
  // — reduces visual noise for simple single-list users
  const listsWithTasks=lists.filter(l=>tasks.some(t=>t.listId===l.id&&!t.archived));
  if(lists.length<=1||listsWithTasks.length<=1){
    bar.style.display='none';
    return;
  }
  bar.style.display='';
  lists.forEach(l=>{
    const count=tasks.filter(t=>t.listId===l.id&&(!t.parentId)).length;
    const chip=document.createElement('button');
    chip.className='list-chip'+(l.id===activeListId?' active':'');
    chip.onclick=function(){switchList(l.id)};
    chip.title=l.description?l.description+'\n\n(double-click or ✎ to edit)':'Double-click or ✎ to edit list';
    chip.ondblclick=function(e){if(e)e.stopPropagation();editList(l.id)};
    chip.innerHTML='<span class="lc-dot" style="background:'+l.color+'"></span>'
      +esc(l.name)
      +'<span class="lc-count">'+count+'</span>'
      +'<span class="lc-edit" onclick="event.stopPropagation();editList('+l.id+')" title="Edit name + description">✎</span>'
      +'<span class="lc-rm" onclick="event.stopPropagation();removeList('+l.id+')">✕</span>';
    bar.appendChild(chip)
  });
  const add=document.createElement('button');
  add.className='list-add';add.textContent='+ List';add.onclick=addList;
  bar.appendChild(add);
}

// Filter/Sort/Search
function updateTaskFilters(){
  taskFilters.search=gid('taskSearch').value.toLowerCase().trim();
  taskFilters.status=gid('filterStatus').value;
  taskFilters.priority=gid('filterPriority').value;
  taskFilters.category=(gid('filterCategory')||{}).value||'all';
  taskSortBy=gid('taskSortSel').value;
  const g=gid('groupBySel');if(g)taskGroupBy=g.value;
  const sem=gid('taskSearchSemantic');
  window._taskSearchSemantic=sem?sem.checked:false;
  updateFiltersActiveBadge();
  if(window._taskSearchSemantic && taskFilters.search && typeof semanticSearch === 'function' && typeof isIntelReady === 'function' && isIntelReady()){
    const rawQ = gid('taskSearch').value.trim();
    void (async () => {
      try{
        const results = await semanticSearch(rawQ, 800);
        window._semanticScores = new Map(results.map(r => [r.id, r.score]));
      }catch(e){
        window._semanticScores = null;
      }
      renderTaskList();
    })();
    return;
  }
  window._semanticScores = null;
  renderTaskList()
}
function setTaskView(v){
  taskView=v;
  gid('viewList').classList.toggle('active',v==='list');
  gid('viewBoard').classList.toggle('active',v==='board');
  if(gid('viewCal'))gid('viewCal').classList.toggle('active',v==='calendar');
  // Also sync mobile view-toggle buttons if they exist
  if(gid('viewListMobile'))gid('viewListMobile').classList.toggle('active',v==='list');
  if(gid('viewBoardMobile'))gid('viewBoardMobile').classList.toggle('active',v==='board');
  if(gid('viewCalMobile'))gid('viewCalMobile').classList.toggle('active',v==='calendar');
  gid('taskList').style.display=v==='list'?'':'none';
  gid('boardView').style.display=v==='board'?'flex':'none';
  if(gid('calendarView'))gid('calendarView').style.display=v==='calendar'?'':'none';
  document.body.classList.toggle('cal-active-mobile',v==='calendar');
  renderTaskList();
  saveState()
}
function updateMobileViewToggle(){/* alias for call sites */}
function matchesFilters(t){
  // Archive view shows ONLY archived
  if(smartView==='archived'){if(!t.archived)return false}
  else if(t.archived)return false;
  // List filter — only apply on 'all' view, not on focused smart views
  const listSensitiveViews=['all'];
  if(listSensitiveViews.includes(smartView)&&t.listId&&activeListId&&t.listId!==activeListId)return false;
  // Smart view filters
  const today=todayISO();
  if(smartView==='today'){if(t.dueDate!==today||t.status==='done')return false}
  else if(smartView==='week'){
    if(!t.dueDate||t.status==='done')return false;
    const d=new Date();const w=new Date();w.setDate(d.getDate()+7);
    const weekEnd=w.getFullYear()+'-'+String(w.getMonth()+1).padStart(2,'0')+'-'+String(w.getDate()).padStart(2,'0');
    if(t.dueDate>weekEnd)return false;
  }
  else if(smartView==='overdue'){if(!t.dueDate||t.dueDate>=today||t.status==='done')return false}
  else if(smartView==='unscheduled'){if(t.dueDate||t.status==='done')return false}
  else if(smartView==='starred'){if(!t.starred||t.status==='done')return false}
  else if(smartView==='completed'){if(t.status!=='done')return false}
  // Search — semantic (cosine) or substring
  if(taskFilters.search){
    const semActive = window._taskSearchSemantic && window._semanticScores && window._semanticScores.size > 0;
    if(semActive){
      if(!window._semanticScores.has(t.id))return false;
    }else{
      const hay=(t.name+' '+(t.description||'')+' '+(t.tags||[]).join(' ')+' '+(t.category||'')+' '+(t.valuesAlignment||[]).join(' ')).toLowerCase();
      if(!hay.includes(taskFilters.search))return false;
    }
  }
  if(taskFilters.status!=='all'){
    if(taskFilters.status==='active'){if(t.status==='done')return false}
    else if(t.status!==taskFilters.status)return false;
  }
  if(taskFilters.priority!=='all'&&t.priority!==taskFilters.priority)return false;
  // Category filter
  if(taskFilters.category&&taskFilters.category!=='all'&&t.category!==taskFilters.category)return false;
  return true;
}
function sortTasks(arr){
  const sorted=arr.slice();
  if(window._semanticScores && window._semanticScores.size && window._taskSearchSemantic && taskFilters.search){
    return sorted.sort((a,b)=>(window._semanticScores.get(b.id)||0)-(window._semanticScores.get(a.id)||0));
  }
  const by = taskSortBy==='order'?'manual':taskSortBy;
  if(by==='manual')return sorted.sort((a,b)=>(a.order||0)-(b.order||0));
  sorted.sort((a,b)=>{
    if(by==='smart'){
      // Starred first, then overdue, then today, then by priority+due
      if(!!b.starred-!!a.starred)return !!b.starred-!!a.starred;
      const today=todayISO();
      const aOver=a.dueDate&&a.dueDate<today?0:1,bOver=b.dueDate&&b.dueDate<today?0:1;
      if(aOver!==bOver)return aOver-bOver;
      const aToday=a.dueDate===today?0:1,bToday=b.dueDate===today?0:1;
      if(aToday!==bToday)return aToday-bToday;
      const pd=(PRIORITY_ORDER[a.priority||'none']||9)-(PRIORITY_ORDER[b.priority||'none']||9);
      if(pd!==0)return pd;
      if(!a.dueDate&&b.dueDate)return 1;if(a.dueDate&&!b.dueDate)return -1;
      if(a.dueDate&&b.dueDate)return a.dueDate.localeCompare(b.dueDate);
      return (a.order||0)-(b.order||0);
    }
    if(by==='name')return a.name.localeCompare(b.name);
    if(by==='priority')return (PRIORITY_ORDER[a.priority||'none']||9)-(PRIORITY_ORDER[b.priority||'none']||9);
    if(by==='due'){
      if(!a.dueDate&&!b.dueDate)return 0;
      if(!a.dueDate)return 1;if(!b.dueDate)return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    if(by==='created')return a.id-b.id;
    if(by==='time')return getRolledUpTime(b.id)-getRolledUpTime(a.id);
    return 0;
  });
  return sorted;
}

function renderTodayBanner(){
  const today=todayISO();
  const activeTasks=tasks.filter(t=>!t.archived&&t.status!=='done');
  const overdue=activeTasks.filter(t=>t.dueDate&&t.dueDate<today).length;
  const dueToday=activeTasks.filter(t=>t.dueDate===today).length;
  const weekAhead=new Date();weekAhead.setDate(weekAhead.getDate()+7);
  const weekEnd=weekAhead.getFullYear()+'-'+String(weekAhead.getMonth()+1).padStart(2,'0')+'-'+String(weekAhead.getDate()).padStart(2,'0');
  const thisWeek=activeTasks.filter(t=>t.dueDate&&t.dueDate>=today&&t.dueDate<=weekEnd).length;
  const doneToday=tasks.filter(t=>t.status==='done'&&t.completedAt&&t.completedAt>=today).length;
  if(gid('tbOverdue'))gid('tbOverdue').textContent=overdue;
  if(gid('tbToday'))gid('tbToday').textContent=dueToday;
  if(gid('tbWeek'))gid('tbWeek').textContent=thisWeek;
  if(gid('tbDoneToday'))gid('tbDoneToday').textContent=doneToday;
  // Show banner ONLY when there's something urgent — overdue tasks or tasks due today
  // Week-ahead and done-today are available via smart views, no need to duplicate
  const banner=gid('todayBanner');
  if(banner){
    const hasUrgent=overdue>0||dueToday>0;
    banner.style.display=hasUrgent?'':'none';
  }
}

function toggleFiltersPanel(){
  const panel=gid('filtersPanel');if(!panel)return;
  const btn=gid('filtersToggle');
  const isOpen=panel.style.display!=='none';
  panel.style.display=isOpen?'none':'';
  if(btn)btn.classList.toggle('active',!isOpen);
}

function updateFiltersActiveBadge(){
  // Show a badge on the Filters button when any filter is non-default
  const badge=gid('filtersActiveCount');if(!badge)return;
  let count=0;
  const s=gid('taskSearch'),st=gid('filterStatus'),pr=gid('filterPriority'),so=gid('taskSortSel'),gr=gid('groupBySel');
  if(s&&s.value.trim())count++;
  const sem=gid('taskSearchSemantic');if(sem&&sem.checked)count++;
  if(st&&st.value!=='all')count++;
  if(pr&&pr.value!=='all')count++;
  if(so&&so.value!=='manual'&&so.value!=='smart')count++;
  if(gr&&gr.value!=='none')count++;
  if(count>0){badge.textContent=count;badge.style.display='';}
  else{badge.style.display='none';}
}

function renderSmartViewCounts(){
  const today=todayISO();
  const inList=t=>!t.listId||!activeListId||t.listId===activeListId;
  const active=tasks.filter(t=>!t.archived&&inList(t));
  const activeNotDone=active.filter(t=>t.status!=='done');
  const weekAhead=new Date();weekAhead.setDate(weekAhead.getDate()+7);
  const weekEnd=weekAhead.getFullYear()+'-'+String(weekAhead.getMonth()+1).padStart(2,'0')+'-'+String(weekAhead.getDate()).padStart(2,'0');
  const set=(id,n)=>{const el=gid(id);if(el)el.textContent=n};
  set('svcAll',active.length);
  set('svcToday',activeNotDone.filter(t=>t.dueDate===today).length);
  set('svcWeek',activeNotDone.filter(t=>t.dueDate&&t.dueDate>=today&&t.dueDate<=weekEnd).length);
  set('svcOverdue',activeNotDone.filter(t=>t.dueDate&&t.dueDate<today).length);
  set('svcUnscheduled',activeNotDone.filter(t=>!t.dueDate).length);
  set('svcStarred',activeNotDone.filter(t=>t.starred).length);
  set('svcCompleted',active.filter(t=>t.status==='done').length);
  set('svcArchived',tasks.filter(t=>t.archived&&inList(t)).length);
}

// Main render (list view)
function renderTaskList(){
  const list=gid('taskList');
  if(!list)return;
  renderLists();
  renderTodayBanner();
  renderSmartViewCounts();
  const visibleTasks=tasks.filter(matchesFilters);
  const activeCount=visibleTasks.filter(t=>t.status!=='done'&&!t.parentId).length;
  const badge=gid('taskCountBadge');if(badge)badge.textContent=activeCount+' active';
  if(taskView==='board'){renderBoard(visibleTasks);return}
  if(taskView==='calendar'){renderCalendar(visibleTasks);return}
  list.querySelectorAll('.task-item, .task-subtask-form, .task-section').forEach(e=>e.remove());
  if(!visibleTasks.length){
    const empty=gid('taskEmpty');
    empty.style.display='';
    if(tasks.length){
      // Has tasks, but filter/view excludes all
      empty.innerHTML='<div style="font-size:28px;margin-bottom:8px;opacity:.6">🔍</div><div style="font-weight:500;margin-bottom:4px">No tasks match your filters</div><div style="font-size:12px;opacity:.7">Try adjusting the Filters panel, or switch to the "All" smart view.</div>';
    } else if(smartView==='archived'){
      empty.innerHTML='<div style="font-size:28px;margin-bottom:8px;opacity:.6">📦</div><div style="font-weight:500;margin-bottom:4px">Archive is empty</div><div style="font-size:12px;opacity:.7">Archived tasks will appear here when you archive them from the menu.</div>';
    } else {
      empty.innerHTML='<div style="font-size:28px;margin-bottom:8px;opacity:.6">✨</div><div style="font-weight:500;margin-bottom:4px">No tasks yet</div><div style="font-size:12px;opacity:.7;margin-bottom:8px">Type above to add one, or try a quick-add shortcut:</div><div style="font-size:11px;opacity:.55;font-family:var(--font-mono,monospace);line-height:1.6">Buy milk <span style="color:var(--accent,#48b5e0)">tomorrow @urgent #shopping</span></div>';
    }
    return;
  }
  gid('taskEmpty').style.display='none';
  const visibleIds=new Set(visibleTasks.map(t=>t.id));
  // If grouping, bypass tree-render and group flat (only roots)
  if(taskGroupBy!=='none'){
    renderGroupedTasks(visibleTasks);
    return;
  }
  function renderNode(parentId,depth){
    const children=getTaskChildren(parentId);
    const sorted=sortTasks(children);
    sorted.forEach(t=>{
      if(visibleIds.has(t.id)||hasVisibleDescendant(t.id,visibleIds)){
        renderTaskItem(t,depth);
        if(subtaskPromptParent===t.id)renderSubtaskForm(t.id,depth+1);
        if(!t.collapsed)renderNode(t.id,depth+1);
      }
    });
  }
  renderNode(null,0);
}

// ========== SECTION GROUPING ==========
function getGroupKey(t){
  if(taskGroupBy==='priority')return t.priority||'none';
  if(taskGroupBy==='status')return t.status||'open';
  if(taskGroupBy==='list')return String(t.listId||'none');
  if(taskGroupBy==='due'){
    const today=todayISO();
    if(!t.dueDate)return 'zzzunscheduled';
    if(t.dueDate<today)return 'overdue';
    if(t.dueDate===today)return 'today';
    const tmr=new Date();tmr.setDate(tmr.getDate()+1);
    const tmrISO=tmr.getFullYear()+'-'+String(tmr.getMonth()+1).padStart(2,'0')+'-'+String(tmr.getDate()).padStart(2,'0');
    if(t.dueDate===tmrISO)return 'tomorrow';
    const wk=new Date();wk.setDate(wk.getDate()+7);
    const wkISO=wk.getFullYear()+'-'+String(wk.getMonth()+1).padStart(2,'0')+'-'+String(wk.getDate()).padStart(2,'0');
    if(t.dueDate<=wkISO)return 'thisweek';
    return 'later';
  }
  return 'all';
}
function getGroupLabel(key){
  if(taskGroupBy==='priority')return({urgent:'P1 Urgent',high:'P2 High',normal:'P3 Normal',low:'P4 Low',none:'No priority'})[key]||key;
  if(taskGroupBy==='status')return (STATUSES[key]||{label:key}).label;
  if(taskGroupBy==='list'){const l=lists.find(l=>String(l.id)===key);return l?l.name:'No list'}
  if(taskGroupBy==='due')return({overdue:'Overdue',today:'Today',tomorrow:'Tomorrow',thisweek:'This Week',later:'Later',zzzunscheduled:'Unscheduled'})[key]||key;
  return key;
}
function getGroupColor(key){
  if(taskGroupBy==='priority')return({urgent:'var(--danger)',high:'var(--warning)',normal:'var(--accent)',low:'var(--text-3)',none:'var(--text-4)'})[key]||'var(--text-3)';
  if(taskGroupBy==='status')return({open:'var(--text-3)',progress:'var(--accent)',review:'var(--purple)',blocked:'var(--danger)',done:'var(--success)'})[key]||'var(--text-3)';
  if(taskGroupBy==='list'){const l=lists.find(l=>String(l.id)===key);return l?l.color:'var(--text-3)'}
  if(taskGroupBy==='due')return({overdue:'var(--danger)',today:'var(--warning)',tomorrow:'var(--accent)',thisweek:'var(--accent)',later:'var(--text-3)',zzzunscheduled:'var(--text-4)'})[key]||'var(--text-3)';
  return 'var(--text-3)';
}
function renderGroupedTasks(visibleTasks){
  const list=gid('taskList');
  // Only show root-level in groups (subtasks appear under their parents)
  const roots=visibleTasks.filter(t=>!t.parentId);
  const groups={};
  roots.forEach(t=>{const k=getGroupKey(t);(groups[k]=groups[k]||[]).push(t)});
  // Order keys
  const keyOrder={priority:['urgent','high','normal','low','none'],status:['open','progress','review','blocked','done'],due:['overdue','today','tomorrow','thisweek','later','zzzunscheduled']};
  const preferred=keyOrder[taskGroupBy]||[];
  const sortedKeys=Object.keys(groups).sort((a,b)=>{
    const ai=preferred.indexOf(a),bi=preferred.indexOf(b);
    if(ai!==-1&&bi!==-1)return ai-bi;
    if(ai!==-1)return -1;if(bi!==-1)return 1;
    return a.localeCompare(b);
  });
  sortedKeys.forEach(k=>{
    const items=sortTasks(groups[k]);
    const hdr=document.createElement('div');hdr.className='task-section';
    const isCol=collapsedSections[taskGroupBy+':'+k];
    hdr.innerHTML='<span class="ts-chevron'+(isCol?' collapsed':'')+'">▼</span>'
      +'<span class="ts-color" style="background:'+getGroupColor(k)+'"></span>'
      +'<span class="ts-label">'+esc(getGroupLabel(k))+'</span>'
      +'<span class="ts-count">'+items.length+'</span>';
    hdr.onclick=function(){collapsedSections[taskGroupBy+':'+k]=!isCol;renderTaskList();saveState()};
    list.appendChild(hdr);
    if(!isCol){
      items.forEach(t=>{
        renderTaskItem(t,0);
        // Show descendants inline (no further grouping) if not collapsed
        if(!t.collapsed){
          function renderKids(pid,depth){
            getTaskChildren(pid).forEach(c=>{if(!c.archived){renderTaskItem(c,depth);if(!c.collapsed)renderKids(c.id,depth+1)}});
          }
          renderKids(t.id,1);
        }
      });
    }
  });
}

// ========== CHECKLIST ==========
let _clIdCtr=0;
function addChecklistItem(taskId,text){
  const t=findTask(taskId);if(!t||!text.trim())return;
  if(!t.checklist)t.checklist=[];
  t.checklist.push({id:++_clIdCtr,text:text.trim(),done:false,doneAt:null});
  renderChecklist(taskId);saveState();
}
function toggleChecklistItem(taskId,itemId){
  const t=findTask(taskId);if(!t)return;
  const item=t.checklist.find(c=>c.id===itemId);if(!item)return;
  item.done=!item.done;item.doneAt=item.done?timeNow():null;
  renderChecklist(taskId);saveState();
}
function removeChecklistItem(taskId,itemId){
  const t=findTask(taskId);if(!t)return;
  t.checklist=t.checklist.filter(c=>c.id!==itemId);
  renderChecklist(taskId);saveState();
}
function renderChecklist(taskId){
  const t=findTask(taskId);if(!t)return;
  const el=document.getElementById('mdChecklist');if(!el)return;
  const items=t.checklist||[];
  const done=items.filter(c=>c.done).length;
  const pct=items.length?Math.round((done/items.length)*100):0;
  el.innerHTML=`
    ${items.length?`<div class="cl-progress"><div class="cl-bar" style="width:${pct}%"></div><span class="cl-pct">${pct}%</span></div>`:''}
    <div class="cl-items" id="clItems"></div>
    <div class="cl-add">
      <input class="cl-input" id="clInput" placeholder="Add item…" onkeydown="if(event.key==='Enter'){addChecklistItem(${taskId},this.value);this.value=''}">
      <button class="btn-ghost btn-sm" onclick="addChecklistItem(${taskId},document.getElementById('clInput').value);document.getElementById('clInput').value=''">+</button>
    </div>`;
  const list=document.getElementById('clItems');
  items.forEach(item=>{
    const d=document.createElement('div');d.className='cl-item'+(item.done?' cl-done':'');
    d.innerHTML=`<button class="cl-check${item.done?' on':''}" onclick="toggleChecklistItem(${taskId},${item.id})">${item.done?'✓':''}</button><span class="cl-text">${esc(item.text)}</span><button class="cl-rm" onclick="removeChecklistItem(${taskId},${item.id})">×</button>`;
    list.appendChild(d);
  });
}

// ========== TASK NOTES ==========
let _noteIdCtr=0;
function addTaskNote(taskId,text){
  const t=findTask(taskId);if(!t||!text.trim())return;
  if(!t.notes)t.notes=[];
  t.notes.unshift({id:++_noteIdCtr,text:text.trim(),createdAt:timeNow()});
  renderTaskNotes(taskId);saveState();
}
function removeTaskNote(taskId,noteId){
  const t=findTask(taskId);if(!t)return;
  t.notes=t.notes.filter(n=>n.id!==noteId);
  renderTaskNotes(taskId);saveState();
}
function renderTaskNotes(taskId){
  const t=findTask(taskId);if(!t)return;
  const el=document.getElementById('mdNotes');if(!el)return;
  el.innerHTML=`
    <div class="note-add">
      <textarea class="note-input" id="noteInput" rows="2" placeholder="Add a timestamped note…"></textarea>
      <button class="btn-ghost btn-sm" onclick="addTaskNote(${taskId},document.getElementById('noteInput').value);document.getElementById('noteInput').value=''">Add</button>
    </div>
    <div id="noteList"></div>`;
  const list=document.getElementById('noteList');
  (t.notes||[]).forEach(n=>{
    const d=document.createElement('div');d.className='note-item';
    d.innerHTML=`<span class="note-time">${n.createdAt}</span><span class="note-text">${esc(n.text)}</span><button class="note-rm" onclick="removeTaskNote(${taskId},${n.id})">×</button>`;
    list.appendChild(d);
  });
}

// ========== BLOCKED-BY ==========
function addBlockedBy(taskId,blockerIdStr){
  const t=findTask(taskId);if(!t)return;
  const blockerId=parseInt(blockerIdStr);if(!blockerId||blockerId===taskId)return;
  if(!t.blockedBy)t.blockedBy=[];
  if(!t.blockedBy.includes(blockerId))t.blockedBy.push(blockerId);
  renderBlockedBy(taskId);saveState();
}
function removeBlockedBy(taskId,blockerId){
  const t=findTask(taskId);if(!t)return;
  t.blockedBy=(t.blockedBy||[]).filter(id=>id!==blockerId);
  renderBlockedBy(taskId);saveState();
}
function renderBlockedBy(taskId){
  const t=findTask(taskId);if(!t)return;
  const el=document.getElementById('mdBlockedBy');if(!el)return;
  const blockers=t.blockedBy||[];
  el.innerHTML=`
    <div class="blocker-chips" id="blockerChips"></div>
    <div style="display:flex;gap:6px;margin-top:6px">
      <select class="mfield-in" id="blockerSel" style="flex:1;font-size:12px">
        <option value="">Select blocking task…</option>
        ${tasks.filter(x=>x.id!==taskId&&x.status!=='done').map(x=>`<option value="${x.id}">${esc(x.name.slice(0,40))}</option>`).join('')}
      </select>
      <button class="btn-ghost btn-sm" onclick="addBlockedBy(${taskId},document.getElementById('blockerSel').value)">Link</button>
    </div>`;
  const chips=document.getElementById('blockerChips');
  blockers.forEach(bid=>{
    const bt=findTask(bid);if(!bt)return;
    const c=document.createElement('span');c.className='blocker-chip'+(bt.status==='done'?' resolved':'');
    c.innerHTML=`${bt.status==='done'?'✓ ':''}<span>${esc(bt.name.slice(0,30))}</span><button onclick="removeBlockedBy(${taskId},${bid})">×</button>`;
    chips.appendChild(c);
  });
}
