(function(){
  const isFileProtocol = location.protocol === 'file:';

  // Inline fallback icon (for file:// where external PNGs can't be fetched by manifest)
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
    <rect width="512" height="512" rx="112" fill="#0a1320"/>
    <circle cx="256" cy="256" r="160" stroke="#1a2d44" stroke-width="18"/>
    <path d="M 256 96 A 160 160 0 1 1 96 256" stroke="#3d8bcc" stroke-width="22" stroke-linecap="round"/>
    <circle cx="256" cy="96" r="14" fill="#48b5e0"/>
    <text x="256" y="292" text-anchor="middle" font-family="monospace" font-weight="800" font-size="90" fill="#e2e8f0">25</text>
  </svg>`;
  const iconUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvg);

  // On file://, override to inline manifest + icons so install still works
  if (isFileProtocol) {
    document.getElementById('pwa-apple-icon').href = iconUrl;
    document.getElementById('pwa-favicon').href = iconUrl;
    const manifest = {
      name: 'ODTAULAI — On device task app using local ambient intelligence',
      short_name: 'ODTAULAI',
      description: 'Pomodoro + tasks with on-device semantic understanding of task meaning and context (embedding model; no generative chat).',
      start_url: location.pathname.split('/').slice(0,-1).join('/') + '/' + (location.pathname.split('/').pop() || ''),
      scope: location.pathname.split('/').slice(0,-1).join('/') + '/',
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui'],
      orientation: 'any',
      background_color: '#0a1320',
      theme_color: '#0a1320',
      categories: ['productivity', 'utilities'],
      icons: [
        {src: iconUrl, sizes: '192x192', type: 'image/svg+xml', purpose: 'any'},
        {src: iconUrl, sizes: '512x512', type: 'image/svg+xml', purpose: 'any'},
        {src: iconUrl, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable'}
      ]
    };
    try {
      const manifestBlob = new Blob([JSON.stringify(manifest)], {type: 'application/manifest+json'});
      document.getElementById('pwa-manifest').href = URL.createObjectURL(manifestBlob);
    } catch(e) {}
  }

  // Register external service worker when served via http(s) — preferred path.
  // Falls back to inline blob SW only if sw.js isn't reachable.
  if ('serviceWorker' in navigator && !isFileProtocol) {
    navigator.serviceWorker.register('sw.js', {scope: './'}).then(()=>{
      window._swRegistered = true;
    }).catch((err)=>{
      console.warn('External sw.js failed, falling back to inline SW:', err);
      // Fallback: inline SW via blob URL
      const swCode = `
        const CACHE = 'odtaulai-v24-inline';
        self.addEventListener('install', e => self.skipWaiting());
        self.addEventListener('activate', e => e.waitUntil(clients.claim()));
        self.addEventListener('fetch', e => {
          if (e.request.method !== 'GET') return;
          const u = new URL(e.request.url);
          const h = u.hostname;
          if (h.includes('huggingface.co') || h.includes('cdn-lfs.huggingface.co') ||
              h === 'hf.co' || h.includes('cdn.jsdelivr.net')) {
            e.respondWith(fetch(e.request));
            return;
          }
          e.respondWith(
            caches.match(e.request).then(cached => {
              if (cached) return cached;
              return fetch(e.request).then(resp => {
                if (resp.ok && (resp.type === 'basic' || resp.type === 'cors')) {
                  const clone = resp.clone();
                  caches.open(CACHE).then(c => c.put(e.request, clone)).catch(()=>{});
                }
                return resp;
              }).catch(() => cached || new Response('Offline', {status: 503}));
            })
          );
        });
      `;
      try {
        const swBlob = new Blob([swCode], {type: 'application/javascript'});
        navigator.serviceWorker.register(URL.createObjectURL(swBlob)).then(()=>{
          window._swRegistered = true;
        }).catch(()=>{ window._swRegistered = false; });
      } catch(e) { window._swRegistered = false; }
    });
  }

  // Install prompt — capture beforeinstallprompt, show install button when available
  window._deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window._deferredInstallPrompt = e;
    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('installBtn');
      if (btn) btn.classList.remove('u-hidden');
    });
    const btn = document.getElementById('installBtn');
    if (btn) btn.classList.remove('u-hidden');
    if (typeof window.refreshPWAInstallUI === 'function') window.refreshPWAInstallUI();
  });
  window.addEventListener('appinstalled', () => {
    window._deferredInstallPrompt = null;
    const btn = document.getElementById('installBtn');
    if (btn) btn.classList.add('u-hidden');
    const status = document.getElementById('pwaStatus');
    if (status) status.textContent = '✓ Installed as app';
  });

  function _isIOS(){
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function _isStandalonePWA(){
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  /** iOS never fires beforeinstallprompt — show the same button with manual steps. */
  function _syncInstallButtonForPlatform(){
    if (location.protocol === 'file:') return;
    if (_isStandalonePWA()) return;
    const btn = document.getElementById('installBtn');
    const status = document.getElementById('pwaStatus');
    if (!btn) return;
    if (window._deferredInstallPrompt) {
      btn.classList.remove('u-hidden');
      btn.textContent = '＋ Install';
      if (status) status.textContent = 'Ready to install';
      return;
    }
    if (_isIOS()) {
      btn.classList.remove('u-hidden');
      btn.textContent = '＋ Add to Home Screen';
      if (status) status.textContent = 'iOS: tap for steps — Share → Add to Home Screen';
      return;
    }
    if (/Android/i.test(navigator.userAgent)) {
      btn.classList.remove('u-hidden');
      btn.textContent = '＋ Install app';
      if (status) status.textContent = 'Android: tap for tips, or Chrome ⋮ → Install app';
    }
  }

  window.installPWA = function(){
    if (window._deferredInstallPrompt) {
      window._deferredInstallPrompt.prompt();
      window._deferredInstallPrompt.userChoice.then(() => {
        window._deferredInstallPrompt = null;
        const btn = document.getElementById('installBtn');
        if (btn) btn.classList.add('u-hidden');
      });
      return;
    }
    if (_isIOS()) {
      alert('Apple does not provide an “Install” API on iPhone/iPad (unlike Android).\n\nUse Safari:\n1. Tap Share (square with arrow).\n2. Tap “Add to Home Screen”.\n3. Tap Add — ODTAULAI opens fullscreen like an app.\n\nChrome on iOS uses the same WebKit engine; if Add to Home Screen is missing, try Safari.');
      return;
    }
    if (/Android/i.test(navigator.userAgent || '')) {
      alert('On Android (Chrome):\n1. Open the menu (⋮).\n2. Tap “Install app” or “Add to Home screen”.\n\nIf you do not see it:\n• Use HTTPS or localhost (required).\n• Use the site for a moment first — Chrome shows install when engagement criteria are met.');
      return;
    }
    alert('To install this app:\n\n• Chrome / Edge: tap ⊕ Install in the address bar, or Menu → Save and share → Install page as app.\n• Site must be served over HTTPS or localhost (not file://).\n\niOS: Share → Add to Home Screen.');
  };

  window.refreshPWAInstallUI = _syncInstallButtonForPlatform;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { _syncInstallButtonForPlatform(); });
  } else {
    _syncInstallButtonForPlatform();
  }
  setTimeout(_syncInstallButtonForPlatform, 800);
  setTimeout(_syncInstallButtonForPlatform, 2500);
})();
