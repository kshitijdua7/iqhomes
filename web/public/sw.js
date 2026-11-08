/* IQHomes service worker: offline app shell + push notifications. */
const CACHE = 'iqhomes-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (the house is live data), falling back to the cached shell when offline.
// API calls and the live socket are never cached.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('/') : Response.error()))),
  );
});

self.addEventListener('push', (e) => {
  let data = { title: 'IQHomes', body: '' };
  try { data = { ...data, ...e.data.json() }; } catch { if (e.data) data.body = e.data.text(); }
  const isLock = (data.tag || '').startsWith('lock-');
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag,
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
    vibrate: isLock ? [120, 60, 120] : [80],
    actions: isLock ? [{ action: 'lock', title: '🔒 Lock it' }] : [],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let url = e.notification.data?.url || '/';
  if (e.action === 'lock') url = '/?lock=' + (e.notification.tag || '').replace(/^lock-/, '');
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.navigate(url).catch(() => {}); return w.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
