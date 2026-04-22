// ========== SHARED ICON LIBRARY ==========
// Monochrome Lucide-style stroke icons. Single source of truth — no emoji in the UI.
// All icons inherit `currentColor`, so they theme correctly.
//
// Usage:
//   icon('calendar')                → <svg>…</svg>
//   icon('calendar', {size:14, cls:'sv-icon-svg'})
//   UI_ICONS.calendar               → inner path markup only (for custom wrappers)

(function(){
  const P = {
    // Navigation / views
    list:          '<path d="M3 6h18M3 12h18M3 18h18"/>',
    grid:          '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    calendar:      '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    calendarWeek:  '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 15h2M14 15h2M8 19h2M14 19h2"/>',
    alertTriangle: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
    circleDashed:  '<path d="M10.1 2.2a10 10 0 0 0-3.8 1.6"/><path d="M4.3 6.3A10 10 0 0 0 2.7 10"/><path d="M2.4 14a10 10 0 0 0 1.5 3.9"/><path d="M6.2 20.1a10 10 0 0 0 3.8 1.7"/><path d="M13.9 21.8a10 10 0 0 0 3.8-1.6"/><path d="M19.7 17.7a10 10 0 0 0 1.6-3.8"/><path d="M21.6 10a10 10 0 0 0-1.5-3.9"/><path d="M17.8 3.9A10 10 0 0 0 14 2.2"/>',
    star:          '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    starFilled:    '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/>',
    zap:           '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    check:         '<polyline points="20 6 9 17 4 12"/>',
    checkCircle:   '<circle cx="12" cy="12" r="10"/><polyline points="16 10 11 15 8 12"/>',
    archive:       '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>',
    sparkles:      '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"/><path d="M19 14l.9 2.4 2.4.9-2.4.9L19 20.6l-.9-2.4-2.4-.9 2.4-.9L19 14z"/>',
    moon:          '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    clipboard:     '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    gear:          '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.16.68.42.92.76a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    timer:         '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
    database:      '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6a9 3 0 0 0 18 0V5M3 11v6a9 3 0 0 0 18 0v-6"/>',
    toolSparkle:   '<path d="M9.5 2l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2 2-5.5z"/><path d="M17.5 14l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5z"/>',
    // Life categories
    heart:         '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    dollar:        '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    briefcase:     '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    users:         '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    book:          '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    home:          '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    leaf:          '<path d="M11 20A7 7 0 0 1 4 13c0-5 5.5-8.5 17-11-2.5 11.5-6 17-11 17-.7 0-1.4-.1-2-.2"/><path d="M2 22c2-6 6-10 12-11"/>',
    pin:           '<path d="M12 2a5 5 0 0 0-5 5c0 1.5.5 2.5 1 3.5L12 16l4-5.5c.5-1 1-2 1-3.5a5 5 0 0 0-5-5z"/><circle cx="12" cy="7" r="1.5"/>',
    // Type
    bug:           '<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M3 13h5M16 13h5M3 7l3 3M21 7l-3 3M3 19l3-3M21 19l-3-3M12 20v-8"/>',
    lightbulb:     '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.8.7 1.5 1.3 1.5 2.3h5c0-1 .7-1.6 1.5-2.3A7 7 0 0 0 12 2z"/>',
    running:       '<circle cx="13" cy="4" r="2"/><path d="M4 22l3.5-6.5L11 13l2-4 5 5 3-3M11 13l-2 5-4 1"/>',
    hourglass:     '<path d="M6 2h12M6 22h12M7 2v6a5 5 0 0 0 10 0V2M7 22v-6a5 5 0 0 1 10 0v6"/>',
    flame:         '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.3-2.4-.5-4.5 2-6 .6 5.5 5.5 5.2 5.5 10A6 6 0 1 1 6 13c0-1.6.6-2.5 1.5-3.5"/>',
    // Context
    phone:         '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    monitor:       '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    car:           '<path d="M5 13l2-6a2 2 0 0 1 2-1h6a2 2 0 0 1 2 1l2 6"/><rect x="3" y="13" width="18" height="5" rx="1"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/>',
    // Actions
    play:          '<polygon points="5 3 19 12 5 21 5 3"/>',
    stop:          '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    plus:          '<path d="M12 5v14M5 12h14"/>',
    close:         '<path d="M18 6L6 18M6 6l12 12"/>',
    chevronRight:  '<polyline points="9 18 15 12 9 6"/>',
    chevronDown:   '<polyline points="6 9 12 15 18 9"/>',
    refresh:       '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/>',
    undo:          '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
    rotateCcw:     '<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    // AI / tools
    search:        '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    folder:        '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    copy:          '<rect x="8" y="8" width="13" height="13" rx="2" ry="2"/><path d="M4 16H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1"/>',
    harmonize:     '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/>',
    spark:         '<path d="M12 3c.5 2.5 2 4 4.5 4.5-2.5.5-4 2-4.5 4.5-.5-2.5-2-4-4.5-4.5 2.5-.5 4-2 4.5-4.5z"/>',
    wand:          '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>',
    split:         '<path d="M8 3h5a2 2 0 0 1 2 2v5M8 21h5a2 2 0 0 0 2-2v-5M3 8h5M3 16h5"/>',
    // Schwartz values
    compass:       '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    trophy:        '<path d="M6 9H4a2 2 0 0 1-2-2V5h4"/><path d="M18 9h2a2 2 0 0 0 2-2V5h-4"/><path d="M6 3h12v7a6 6 0 0 1-12 0V3z"/><path d="M10 21h4"/><path d="M12 17v4"/>',
    crown:         '<path d="M2 20h20"/><path d="M3 7l4 5 5-7 5 7 4-5-2 11H5L3 7z"/>',
    shield:        '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    columns:       '<path d="M3 10h18M3 6l9-4 9 4M5 10v10M12 10v10M19 10v10M3 20h18"/>',
    globe:         '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>',
  };

  // Life-category lookup by category key — used on task items and harmonize panels.
  const CATEGORY_ICON = {
    bodyMindSpirit: 'leaf',
    relationships: 'heart',
    community: 'users',
    jobLearningFinances: 'briefcase',
    interests: 'sparkles',
    personalCare: 'home',
    general: 'pin',
  };

  /**
   * Render an icon as an `<svg>` string.
   * @param {string} name - key in UI_ICONS
   * @param {{size?:number, cls?:string, title?:string, strokeWidth?:number}} [opts]
   * @returns {string}
   */
  function icon(name, opts){
    const body = P[name];
    if(!body) return '';
    const o = opts || {};
    const size = o.size || 16;
    const cls = o.cls || 'ui-ic';
    const sw = o.strokeWidth || 1.75;
    const title = o.title ? '<title>' + String(o.title).replace(/[<>&"']/g, '') + '</title>' : '';
    return '<svg class="' + cls + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      title + body + '</svg>';
  }

  /** Icon for a life-category id (uses getCategoryDef when loaded). */
  function categoryIcon(key, opts){
    if(!key) return '';
    const def = (typeof window.getCategoryDef === 'function') ? window.getCategoryDef(key) : null;
    const k = def ? def.icon : CATEGORY_ICON[key];
    return k ? icon(k, opts) : icon('pin', opts);
  }

  /**
   * Replace any element with `data-icon="name"` with its SVG. Idempotent —
   * can be called after DOM mutations to hydrate newly injected placeholders.
   * Reads optional `data-icon-size` (number) and preserves existing classes.
   */
  function hydrateIcons(root){
    const scope = root || document;
    const els = scope.querySelectorAll ? scope.querySelectorAll('[data-icon]') : [];
    els.forEach(el => {
      if(el.__iconHydrated) return;
      const name = el.getAttribute('data-icon');
      if(!name || !P[name]) return;
      const size = parseInt(el.getAttribute('data-icon-size') || '', 10);
      const opts = {cls: 'ui-ic'};
      if(Number.isFinite(size) && size > 0) opts.size = size;
      el.innerHTML = icon(name, opts);
      el.__iconHydrated = true;
    });
  }

  window.UI_ICONS = P;
  window.UI_CATEGORY_ICON = CATEGORY_ICON;
  window.icon = icon;
  window.categoryIcon = categoryIcon;
  window.hydrateIcons = hydrateIcons;

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => hydrateIcons());
  }else{
    hydrateIcons();
  }
})();
