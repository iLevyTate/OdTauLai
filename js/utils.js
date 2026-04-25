// ========== UTILS ==========
function gid(id){return document.getElementById(id)}
/**
 * HTML-escape a string for safe insertion into innerHTML.
 * SECURITY: This is the primary XSS boundary. All user-supplied
 * data rendered via innerHTML MUST pass through esc() first.
 * Uses DOM textContent encoding — handles &, <, >, ", ' correctly.
 */
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}
/** Escape for HTML double-quoted attributes (title=, etc.). */
function escAttr(s){
  if(s==null)return '';
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
/** Local completion timestamp YYYY-MM-DDTHH:MM:SS (for completedAt / done-today). */
function stampCompletion(){
  const d=new Date();
  const p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
}
/** Date portion of completion stamp (handles legacy HH:MM-only values as today). */
function completionDateKey(completedAt){
  if(!completedAt)return null;
  const s=String(completedAt);
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
  if(/^\d{1,2}:\d{2}$/.test(s))return typeof todayKey==='function'?todayKey():null;
  return null;
}

function showExportToast(msg){
  let t=document.getElementById('exportToast');
  if(!t){
    t=document.createElement('div');
    t.id='exportToast';
    t.className='export-toast';
    t.setAttribute('role','status');
    document.body.appendChild(t);
  }
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm=setTimeout(()=>t.classList.remove('show'),2800);
}

/** Allow only simple hex colors for inline styles from user data */
function sanitizeListColor(c){
  const s=String(c||'').trim();
  if(/^#[0-9A-Fa-f]{3}$/.test(s)||/^#[0-9A-Fa-f]{6}$/.test(s))return s;
  return '#888888';
}
function fmt(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;if(h>0)return h+":"+String(m).padStart(2,"0")+":"+String(sc).padStart(2,"0");return String(m).padStart(2,"0")+":"+String(sc).padStart(2,"0")}
function fmtHMS(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(sc).padStart(2,"0")}
function fmtShort(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?h+"h "+m+"m":m+"m"}
function timeNow(){const d=new Date();return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")}
function todayKey(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function dateStr(d){return (d||new Date()).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}
function prettyDate(iso){const d=new Date(iso+'T12:00:00');return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'})}

gid('headerDate').textContent=dateStr();

function timeNowFull(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
