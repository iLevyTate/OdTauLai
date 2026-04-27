// ========== UI-FLIP: minimal FLIP reorder + focus-trap utilities ==========
// Loaded before ui.js so its globals are available to the renderers.
//
// FLIP (First, Last, Invert, Play) animates positional changes after a full
// re-render: capture rects, mutate the DOM, compute deltas, transform back to
// the old position, then transition to identity. Cards "slide" instead of
// jump-cutting on sort/status/star/drop changes.

(function(){
  'use strict';

  /**
   * Wrap a re-render so cards animate from their old positions to their new
   * ones. Pass the container that holds [data-task-id] children and a
   * function that performs the actual re-render.
   *
   *   flipReorder(document.getElementById('taskList'), () => renderTaskList());
   *
   * Reduced-motion users get the render with no transforms.
   */
  function flipReorder(container, renderFn){
    if(!container || typeof renderFn !== 'function'){ if(typeof renderFn==='function')renderFn(); return; }
    let reduceMotion = false;
    try { reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(_){}
    if(reduceMotion){ renderFn(); return; }

    const before = new Map();
    container.querySelectorAll('[data-task-id]').forEach(el => {
      before.set(el.dataset.taskId, el.getBoundingClientRect());
    });

    renderFn();

    container.querySelectorAll('[data-task-id]').forEach(el => {
      const prev = before.get(el.dataset.taskId);
      if(!prev) return; // newly inserted — covered by .task-item--enter
      const next = el.getBoundingClientRect();
      const dy = prev.top - next.top;
      const dx = prev.left - next.left;
      if(Math.abs(dy) < 1 && Math.abs(dx) < 1) return;
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      el.style.transition = 'none';
      // Force a frame so the browser commits the transform before we clear it.
      requestAnimationFrame(() => {
        el.style.transition = 'transform .24s cubic-bezier(.2,.8,.2,1)';
        el.style.transform = '';
        const cleanup = () => {
          el.style.transition = '';
          el.removeEventListener('transitionend', cleanup);
        };
        el.addEventListener('transitionend', cleanup);
      });
    });
  }

  /**
   * Focus trap for modals/overlays. Call openFocusTrap(modalEl) when a modal
   * opens; call closeFocusTrap() when it closes. Captures the trigger element
   * so focus returns there on close.
   */
  let _trapEl = null;
  let _prevFocus = null;
  let _trapHandler = null;

  function _focusables(root){
    return Array.from(root.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement);
  }

  function openFocusTrap(modalEl, opts){
    if(!modalEl) return;
    closeFocusTrap(); // clear any prior trap defensively
    _trapEl = modalEl;
    if(!(opts && opts.skipPrevFocus)) _prevFocus = document.activeElement;
    if(!(opts && opts.skipInitialFocus)){
      const items = _focusables(modalEl);
      if(items.length){ try { items[0].focus(); } catch(_){} }
    }
    _trapHandler = function(e){
      if(e.key !== 'Tab') return;
      const list = _focusables(modalEl);
      if(!list.length){ e.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    };
    modalEl.addEventListener('keydown', _trapHandler);
  }

  function closeFocusTrap(opts){
    if(_trapEl && _trapHandler){ _trapEl.removeEventListener('keydown', _trapHandler); }
    const restore = _prevFocus;
    _trapEl = null; _trapHandler = null; _prevFocus = null;
    if(!(opts && opts.skipRestore) && restore && typeof restore.focus === 'function'){
      try { restore.focus(); } catch(_){}
    }
  }

  /**
   * Lighter-weight trap for modals that already manage their own initial focus
   * and previous-focus capture (like openCmdK). Adds only the Tab/Shift+Tab
   * cycling behavior. Pair with removeTabTrap() on close.
   */
  function installTabTrap(modalEl){
    openFocusTrap(modalEl, { skipPrevFocus: true, skipInitialFocus: true });
  }
  function removeTabTrap(){
    closeFocusTrap({ skipRestore: true });
  }

  /**
   * Scroll progress for the task list. Visible only when tasks.length > 50.
   * The bar fills from 0% to 100% as the page scrolls. Throttled via rAF so
   * the scroll handler stays cheap on long lists.
   *
   * Call refreshTaskListProgress() after renderTaskList() to update visibility
   * when the list size changes.
   */
  let _scrollRaf = 0;
  function _updateProgress(){
    _scrollRaf = 0;
    const bar = document.getElementById('taskListProgressBar');
    const wrap = document.getElementById('taskListProgress');
    if(!bar || !wrap || wrap.hidden) return;
    const max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
    const pct = Math.max(0, Math.min(100, (window.scrollY / max) * 100));
    bar.style.width = pct.toFixed(1) + '%';
    wrap.setAttribute('aria-valuenow', String(Math.round(pct)));
  }
  function _onScroll(){
    if(_scrollRaf) return;
    _scrollRaf = requestAnimationFrame(_updateProgress);
  }
  function refreshTaskListProgress(){
    const wrap = document.getElementById('taskListProgress');
    if(!wrap) return;
    const list = document.getElementById('taskList');
    const count = list ? list.querySelectorAll('.task-item').length : 0;
    const shouldShow = count > 50;
    if(wrap.hidden !== !shouldShow){ wrap.hidden = !shouldShow; }
    if(shouldShow) _updateProgress();
  }
  window.addEventListener('scroll', _onScroll, { passive: true });
  window.addEventListener('resize', _onScroll, { passive: true });

  window.flipReorder = flipReorder;
  window.openFocusTrap = openFocusTrap;
  window.closeFocusTrap = closeFocusTrap;
  window.installTabTrap = installTabTrap;
  window.removeTabTrap = removeTabTrap;
  window.refreshTaskListProgress = refreshTaskListProgress;
})();
