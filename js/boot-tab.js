/**
 * Pre-paint boot resolver. Loaded synchronously in <head> right after
 * version.js, before any panel HTML is parsed. Reads the user's saved
 * activeTab from localStorage and stamps it onto <html>, so CSS in
 * main.css can hide non-matching panels on the very first paint.
 *
 * Without this, the page paints with the default 'tasks' panel; then
 * app.js (js/app.js:579) runs `el.hidden = !(el.dataset.tab===activeTab)`
 * on every [data-tab] and the visible panel swaps. The user sees a
 * layout snap on every reload if their saved tab isn't 'tasks'.
 *
 * Hot path — keep it tiny and defensive. localStorage may be unavailable
 * (private mode), the saved state may be corrupt JSON, or the schema
 * may be missing activeTab entirely. Any failure leaves the defaults
 * intact, which is the same outcome the page had before this script.
 *
 * STORE_KEY is hardcoded ('stupind_state') because js/config.js — which
 * normally owns it — loads at the bottom of <body>, after the panels
 * have already painted. Keep this in lock-step with the fallback in
 * js/storage.js:3.
 */
(function(){
  try{
    var raw = localStorage.getItem('stupind_state');
    if(!raw) return;
    var s = JSON.parse(raw);
    if(!s || typeof s !== 'object') return;
    var validTabs = ['tasks','focus','tools','data','settings'];
    if(s.activeTab && validTabs.indexOf(s.activeTab) >= 0){
      document.documentElement.setAttribute('data-boot-tab', s.activeTab);
    }
  }catch(_){ /* private mode / corrupt JSON / no LS — keep defaults */ }
})();
