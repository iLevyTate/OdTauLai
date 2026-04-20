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
      name: 'SuperTimerUsablePerInDevice',
      short_name: 'STUPInD',
      description: 'Pomodoro timer with task tracking, quick timers, and daily goals',
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
        const CACHE = 'stupind-v14-inline';
        self.addEventListener('install', e => self.skipWaiting());
        self.addEventListener('activate', e => e.waitUntil(clients.claim()));
        self.addEventListener('fetch', e => {
          if (e.request.method !== 'GET') return;
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
      if (btn) btn.style.display = '';
    });
    const btn = document.getElementById('installBtn');
    if (btn) btn.style.display = '';
  });
  window.addEventListener('appinstalled', () => {
    window._deferredInstallPrompt = null;
    const btn = document.getElementById('installBtn');
    if (btn) btn.style.display = 'none';
    const status = document.getElementById('pwaStatus');
    if (status) status.textContent = '✓ Installed as app';
  });
  window.installPWA = function(){
    if (!window._deferredInstallPrompt) {
      alert('Install not available. To install:\n\n• Chrome/Edge desktop: click the install icon in the address bar\n• iOS Safari: Share → Add to Home Screen\n• Android Chrome: menu → Install app\n\nNote: Must be served via HTTPS/localhost (not file://) for install to work on Android/Chrome.');
      return;
    }
    window._deferredInstallPrompt.prompt();
    window._deferredInstallPrompt.userChoice.then(() => {
      window._deferredInstallPrompt = null;
      const btn = document.getElementById('installBtn');
      if (btn) btn.style.display = 'none';
    });
  };
})();
