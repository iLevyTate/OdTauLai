// OdTauLai Service Worker — keep CACHE_NAME aligned with js/version.js swCache
const CACHE_NAME = 'odtaulai-v43';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './css/main.css',
  './js/version.js',
  './js/pwa.js',
  './js/config.js',
  './js/icons.js',
  './js/utils.js',
  './js/ui-flip.js',
  './js/storage.js',
  './js/audio.js',
  './js/timer.js',
  './js/tasks.js',
  './js/intel.js',
  './js/embed-store.js',
  './js/nlparse.js',
  './js/intel-features.js',
  './js/tool-schema.js',
  './js/gen.js',
  './js/ask.js',
  './js/ui.js',
  './js/ai.js',
  './js/sync.js',
  './js/calfeeds.js',
  './js/app.js',
  './js/vendor/peerjs.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-small.svg',
  './widgets/quickadd-template.json',
  './widgets/quickadd-data.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS).catch(err => {
        console.warn('[sw] precache incomplete', err && err.message ? err.message : err);
      }))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const host = url.hostname;
  // Let Transformers.js / Hugging Face / jsDelivr manage their own HTTP caches
  if(host.includes('huggingface.co') || host.includes('cdn-lfs.huggingface.co') ||
     host === 'hf.co' || host.includes('cdn.jsdelivr.net')){
    e.respondWith(fetch(e.request));
    return;
  }
  if(url.origin !== self.location.origin) return;

  const isNavigation = e.request.mode === 'navigate' || e.request.destination === 'document' ||
    url.pathname === '/' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('index.html');
  if(isNavigation){
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if(res && res.status === 200 && res.type === 'basic'){
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone).catch(() => {}));
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match(e.request)))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if(res && res.status === 200 && res.type === 'basic'){
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone).catch(() => {}));
        }
        return res;
      }).catch(() => cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }));
      return cached || net;
    })
  );
});

self.addEventListener('message', e => {
  if(e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  // ── Persistent notification from main thread ──
  // ServiceWorker.showNotification() fires even when the page tab is frozen
  // or backgrounded on mobile — unlike `new Notification()` from the main
  // thread which requires the page to be active.
  if(e.data?.type === 'SHOW_NOTIFICATION'){
    const d = e.data;
    e.waitUntil(
      self.registration.showNotification(d.title || 'OdTauLai', {
        body:               d.body || '',
        tag:                d.tag || 'odtaulai',
        renotify:           d.renotify !== false,
        icon:               './icons/icon-192.png',
        badge:              './icons/icon-192.png',
        silent:             !!d.silent,
        requireInteraction: !!d.requireInteraction,
        data:               d.data || {},
      })
    );
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  const target = data.url || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // If the app is already open, focus it and forward the notification data
      for(const c of clients){
        if('focus' in c){
          c.postMessage({ type: 'NOTIFICATION_CLICK', data });
          return c.focus();
        }
      }
      // App isn't open — launch it (with optional target path)
      if(self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
