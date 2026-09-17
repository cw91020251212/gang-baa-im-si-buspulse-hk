/* BusPulse HK service worker: app shell cache and local notifications only. */
const SHELL = 'buspulse-hk-shell-v35-stop-distances';
const FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './fare-index.json', './place-index.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('gov.hk')) return;
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone();
      caches.open(SHELL).then(c => c.put(req, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
  }
});
self.addEventListener('message', e => {
  const data = e.data || {};
  if (data.type !== 'BUS_ARRIVAL') return;
  const options = {
    body: data.body || '', icon: './icon-192.png', badge: './icon-192.png',
    tag: data.tag || 'buspulse-local-alarm', renotify: true,
    vibrate: data.silent ? [] : [260, 100, 260, 100, 260],
    silent: !!data.silent, requireInteraction: true, data: { url: './' }
  };
  const badge = self.registration.setAppBadge
    ? self.registration.setAppBadge(Math.max(1, Number(data.badgeNumber) || 1)).catch(() => {})
    : Promise.resolve();
  e.waitUntil(Promise.all([
    self.registration.showNotification(data.title || '巴士就嚟到站', options), badge
  ]));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const clearBadge = self.registration.clearAppBadge
    ? self.registration.clearAppBadge().catch(() => {}) : Promise.resolve();
  e.waitUntil(Promise.all([
    clearBadge, clients.matchAll({ type: 'window', includeUncontrolled: true })
  ]).then(([, list]) => {
    const existing = list.find(c => 'focus' in c);
    if (existing) return existing.focus();
    return clients.openWindow('./');
  }));
});
