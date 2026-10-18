/* BusPulse HK service worker: app shell, authorized local alarms and standard Web Push. */
const SHELL = 'buspulse-hk-shell-v120-web-push-url';
const FILES = ['./', './index.html', './bus-gap-estimator.js', './landsd-map-provider.js', './landsd-map-provider.css', './assets/landsd-logo.png', './manifest.json', './icon-192.png', './icon-512.png', './route-location-icon-v6.png', './fare-index.json', './place-index.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))),
    // Retire queued notifications that cannot prove current alarm consent.
    self.registration.getNotifications({ includeTriggered:true }).then(ns => ns.filter(n => n.tag?.startsWith('buspulse-') && !n.tag.startsWith('buspulse-test-')).forEach(n => n.close())).catch(() => {})
  ]).then(() => self.clients.claim()));
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

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body:e.data?.text() || '' }; }
  const title = typeof data.title === 'string' && data.title ? data.title : '港巴即時';
  const options = {
    body: typeof data.body === 'string' ? data.body : '', icon:'./icon-192.png', badge:'./icon-192.png',
    tag: typeof data.tag === 'string' ? data.tag : 'buspulse-web-push', renotify:true,
    requireInteraction:true, silent:data.silent === true,
    vibrate:data.silent === true ? [] : [260,100,260],
    data:{ url:typeof data.url === 'string' ? data.url : './', alarmId:data.alarmId || null, session:data.session || null }
  };
  e.waitUntil(self.registration.showNotification(title, options).then(() => self.registration.setAppBadge
    ? self.registration.setAppBadge(Math.max(1, Number(data.badgeNumber) || 1)).catch(() => {}) : undefined));
});
const revokedAlarmSessions = new Set();
const alarmToken = data => data.alarmId + '|' + data.session;
async function verifyAlarmClient(source, data) {
  if (!source?.id || typeof data.alarmId !== 'string' || !data.alarmId || typeof data.session !== 'string' || !data.session) return false;
  const client = await self.clients.get(source.id);
  if (!client || client.type !== 'window' || new URL(client.url).origin !== self.location.origin) return false;
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = allowed => { clearTimeout(timer); channel.port1.close(); resolve(allowed); };
    const timer = setTimeout(() => finish(false), 1200);
    channel.port1.onmessage = event => finish(event.data?.allowed === true);
    try { client.postMessage({ type:'VERIFY_ARRIVAL_ALARM', alarmId:data.alarmId, session:data.session }, [channel.port2]); }
    catch { finish(false); }
  });
}
async function deliverAuthorizedArrival(e, data) {
  const token = alarmToken(data);
  if (revokedAlarmSessions.has(token) || !(await verifyAlarmClient(e.source, data)) || revokedAlarmSessions.has(token)) return false;
  const options = {
    body:data.body || '', icon:'./icon-192.png', badge:'./icon-192.png',
    tag:data.tag || 'buspulse-local-alarm', renotify:true,
    vibrate:data.silent ? [] : [260,100,260,100,260],
    silent:!!data.silent, requireInteraction:true,
    data:{ url:'./', alarmId:data.alarmId, session:data.session }
  };
  await self.registration.showNotification(data.title || '巴士就嚟到站', options);
  if (revokedAlarmSessions.has(token)) {
    const notifications = await self.registration.getNotifications({ includeTriggered:true });
    notifications.filter(n => n.data?.alarmId === data.alarmId && n.data?.session === data.session).forEach(n => n.close());
    return false;
  }
  if (self.registration.setAppBadge) await self.registration.setAppBadge(Math.max(1, Number(data.badgeNumber) || 1)).catch(() => {});
  return true;
}
self.addEventListener('message', e => {
  const data = e.data || {};
  if (data.type === 'CANCEL_ARRIVAL_ALARM') {
    if (typeof data.session === 'string' && data.session) revokedAlarmSessions.add(alarmToken(data));
    if (revokedAlarmSessions.size > 512) revokedAlarmSessions.delete(revokedAlarmSessions.values().next().value);
    e.waitUntil(self.registration.getNotifications({ includeTriggered:true }).then(ns => ns.filter(n => {
      const sameRoute = (n.data?.alarmId || n.data?.id) === data.alarmId;
      return sameRoute && (!data.session || !n.data?.session || n.data.session === data.session);
    }).forEach(n => n.close())).catch(() => {}));
    return;
  }
  // Legacy BUS_ARRIVAL messages contain no verifiable switch/session: fail closed.
  if (data.type !== 'BUS_ARRIVAL_AUTHORIZED') return;
  e.waitUntil(deliverAuthorizedArrival(e, data).then(delivered => e.ports?.[0]?.postMessage({ delivered })).catch(() => e.ports?.[0]?.postMessage({ delivered:false })));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const clearBadge = self.registration.clearAppBadge
    ? self.registration.clearAppBadge().catch(() => {}) : Promise.resolve();
  const target = e.notification.data?.url || './';
  e.waitUntil(Promise.all([
    clearBadge, clients.matchAll({ type:'window', includeUncontrolled:true })
  ]).then(([, list]) => {
    const existing = list.find(c => c.url.includes(self.location.origin) && 'focus' in c);
    if (existing) return existing.focus();
    return clients.openWindow(new URL(target, self.location.origin).href);
  }));
});
