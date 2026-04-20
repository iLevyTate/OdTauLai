// ========== AUDIO ==========
const CH={bell:{freq:[880,1108,1320],type:"sine",decay:.8},ping:{freq:[1200],type:"sine",decay:.3},buzz:{freq:[220,223],type:"sawtooth",decay:.5},chord:{freq:[523,659,784],type:"triangle",decay:1},alarm:{freq:[600,900],type:"square",decay:.6}};
const CHL={bell:"Bell",ping:"Ping",buzz:"Buzz",chord:"Chord",alarm:"Alarm"};
let _audioCtx=null;
function getAudioCtx(){if(!_audioCtx||_audioCtx.state==='closed')_audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(_audioCtx.state==='suspended')_audioCtx.resume();return _audioCtx}

// ========== KEEPALIVE: prevents browser from suspending audio when tab is in background ==========
// Technique: play a silent audio tone continuously. Browsers keep the tab "active" as long as
// audio is playing, which means timers, scheduled audio, and notifications continue firing
// even when the tab is backgrounded or minimized. This is how Pomofocus, Forest, etc. work.
let _keepaliveNode=null,_keepaliveGain=null;
function startKeepalive(){
  if(_keepaliveNode)return;
  try{
    const x=getAudioCtx();
    _keepaliveNode=x.createOscillator();
    _keepaliveGain=x.createGain();
    _keepaliveNode.type='sine';
    _keepaliveNode.frequency.value=20;
    _keepaliveGain.gain.value=0.0001;
    _keepaliveNode.connect(_keepaliveGain);
    _keepaliveGain.connect(x.destination);
    _keepaliveNode.start();
  }catch(e){}
  if('wakeLock' in navigator){
    navigator.wakeLock.request('screen').then(l=>{_wakeLock=l}).catch(()=>{});
  }
  if('mediaSession' in navigator){
    try{
      navigator.mediaSession.metadata=new MediaMetadata({
        title:'ODTAULAI Focus Timer',
        artist:'Pomodoro session in progress',
        album:'ODTAULAI'
      });
      navigator.mediaSession.playbackState='playing';
      navigator.mediaSession.setActionHandler('pause',()=>{if(running)pauseTimer()});
      navigator.mediaSession.setActionHandler('play',()=>{if(!running)startTimer()});
    }catch(e){}
  }
  updateBgAudioStatus();
}
function stopKeepalive(){
  try{if(_keepaliveNode){_keepaliveNode.stop();_keepaliveNode=null;_keepaliveGain=null}}catch(e){}
  if(_wakeLock){try{_wakeLock.release()}catch(e){}_wakeLock=null}
  if('mediaSession' in navigator){
    try{navigator.mediaSession.playbackState='none'}catch(e){}
  }
  updateBgAudioStatus();
}
function updateBgAudioStatus(){
  const el=gid('bgAudioStatus');if(!el)return;
  if(_keepaliveNode){
    el.textContent='● Active — background OK';
    el.style.color='var(--success)';
  }else{
    el.textContent='○ Idle — starts with timer';
    el.style.color='var(--text-3)';
  }
}
let _wakeLock=null;

function playChime(t){try{const x=getAudioCtx(),c=CH[t]||CH.bell;c.freq.forEach((f,i)=>{const o=x.createOscillator(),g=x.createGain();o.type=c.type;o.frequency.setValueAtTime(f,x.currentTime);g.gain.setValueAtTime(.25,x.currentTime);g.gain.exponentialRampToValueAtTime(.001,x.currentTime+c.decay);o.connect(g);g.connect(x.destination);o.start(x.currentTime+i*.05);o.stop(x.currentTime+c.decay+.1)})}catch(e){}}
function playTransition(){try{const x=getAudioCtx();[0,.12,.24,.36].forEach((d,i)=>{const fr=[523,659,784,1047][i],o=x.createOscillator(),g=x.createGain();o.type="sine";o.frequency.setValueAtTime(fr,x.currentTime+d);g.gain.setValueAtTime(.3,x.currentTime+d);g.gain.exponentialRampToValueAtTime(.001,x.currentTime+d+.5);o.connect(g);g.connect(x.destination);o.start(x.currentTime+d);o.stop(x.currentTime+d+.6)})}catch(e){}}
function playBreakEnd(){try{const x=getAudioCtx();[0,.1,.2].forEach((d,i)=>{const fr=[784,659,523][i],o=x.createOscillator(),g=x.createGain();o.type="triangle";o.frequency.setValueAtTime(fr,x.currentTime+d);g.gain.setValueAtTime(.25,x.currentTime+d);g.gain.exponentialRampToValueAtTime(.001,x.currentTime+d+.4);o.connect(g);g.connect(x.destination);o.start(x.currentTime+d);o.stop(x.currentTime+d+.5)})}catch(e){}}

// ========== SCHEDULED AUDIO (fires reliably in background tabs) ==========
// Web Audio scheduling uses the audio clock, which isn't throttled like setInterval.
// We pre-schedule chimes at phase/timer start so they play even when the tab is hidden.
let scheduledAudio=[],audioScheduled=false;

function scheduleAudioChime(delaySec,type){
  if(!cfg.sound||delaySec<=0)return;
  try{
    const x=getAudioCtx(),base=x.currentTime+delaySec,c=CH[type]||CH.bell;
    c.freq.forEach((f,i)=>{
      const o=x.createOscillator(),g=x.createGain(),t=base+i*.05;
      o.type=c.type;o.frequency.setValueAtTime(f,t);
      g.gain.setValueAtTime(.25,t);g.gain.exponentialRampToValueAtTime(.001,t+c.decay);
      o.connect(g);g.connect(x.destination);
      o.start(t);o.stop(t+c.decay+.1);
      scheduledAudio.push(o);
    });
  }catch(e){}
}

function scheduleTransitionAudio(delaySec){
  if(!cfg.sound||delaySec<=0)return;
  try{
    const x=getAudioCtx(),base=x.currentTime+delaySec;
    [0,.12,.24,.36].forEach((d,i)=>{
      const fr=[523,659,784,1047][i],o=x.createOscillator(),g=x.createGain();
      o.type="sine";o.frequency.setValueAtTime(fr,base+d);
      g.gain.setValueAtTime(.3,base+d);g.gain.exponentialRampToValueAtTime(.001,base+d+.5);
      o.connect(g);g.connect(x.destination);
      o.start(base+d);o.stop(base+d+.6);
      scheduledAudio.push(o);
    });
  }catch(e){}
}

function scheduleBreakEndAudio(delaySec){
  if(!cfg.sound||delaySec<=0)return;
  try{
    const x=getAudioCtx(),base=x.currentTime+delaySec;
    [0,.1,.2].forEach((d,i)=>{
      const fr=[784,659,523][i],o=x.createOscillator(),g=x.createGain();
      o.type="triangle";o.frequency.setValueAtTime(fr,base+d);
      g.gain.setValueAtTime(.25,base+d);g.gain.exponentialRampToValueAtTime(.001,base+d+.4);
      o.connect(g);g.connect(x.destination);
      o.start(base+d);o.stop(base+d+.5);
      scheduledAudio.push(o);
    });
  }catch(e){}
}

function cancelScheduledAudio(){
  scheduledAudio.forEach(o=>{try{o.stop(0)}catch(e){}});
  scheduledAudio=[];audioScheduled=false;
}

function schedulePhaseAudio(){
  cancelScheduledAudio();
  if(!cfg.sound)return;
  // Schedule phase-end completion chime
  if(phase==='work')scheduleTransitionAudio(remaining);
  else scheduleBreakEndAudio(remaining);
  // Schedule all remaining interval chimes
  intervals.forEach(iv=>{
    if(iv.intervalSec<=0)return;
    const totalEl=totalDuration-remaining;
    const alreadyFired=fireCounts[iv.id]||0;
    for(let n=alreadyFired+1;n*iv.intervalSec<=totalDuration;n++){
      const delay=n*iv.intervalSec-totalEl;
      if(delay>0&&delay<=remaining)scheduleAudioChime(delay,iv.chime);
    }
  });
  audioScheduled=true;
}

// ========== NOTIFICATIONS (fire when tab hidden/minimized) ==========
function reqNotifPerm(){
  if('Notification' in window&&Notification.permission==='default'){
    try{Notification.requestPermission()}catch(e){}
  }
}

function notify(title,body){
  if(!cfg.notif)return;
  if(!('Notification' in window))return;
  if(Notification.permission!=='granted')return;
  try{
    const n=new Notification(title,{body,tag:'odtaulai',renotify:true,silent:false});
    setTimeout(()=>{try{n.close()}catch(e){}},8000);
  }catch(e){}
}

// Resume AudioContext on tab refocus (some browsers suspend when hidden)
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&_audioCtx&&_audioCtx.state==='suspended'){
    try{_audioCtx.resume()}catch(e){}
  }
});

