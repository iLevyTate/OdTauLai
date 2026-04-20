// ========== UTILS ==========
function gid(id){return document.getElementById(id)}
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}
function fmt(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;if(h>0)return h+":"+String(m).padStart(2,"0")+":"+String(sc).padStart(2,"0");return String(m).padStart(2,"0")+":"+String(sc).padStart(2,"0")}
function fmtHMS(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(sc).padStart(2,"0")}
function fmtShort(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?h+"h "+m+"m":m+"m"}
function timeNow(){const d=new Date();return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")}
function todayKey(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function dateStr(d){return (d||new Date()).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}
function prettyDate(iso){const d=new Date(iso+'T12:00:00');return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'})}

gid('headerDate').textContent=dateStr();

function timeNowFull(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
