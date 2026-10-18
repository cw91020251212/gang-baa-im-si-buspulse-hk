/* BusPulse HK service worker: app shell, authorized local alarms, and consent-gated Web Push. */
const SHELL = 'buspulse-hk-shell-v122-single-push-system-sound';
const PUSH_STATE_CACHE = 'buspulse-hk-push-state-v1';
const PUSH_STATE_KEY = '/__buspulse_hk_push_state_v1__';
const FILES = ['./', './index.html', './bus-gap-estimator.js', './landsd-map-provider.js', './landsd-map-provider.css', './assets/landsd-logo.png', './manifest.json', './icon-192.png', './icon-512.png', './route-location-icon-v6.png', './fare-index.json', './place-index.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== PUSH_STATE_CACHE).map(k => caches.delete(k)))),
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
const revokedAlarmSessions = new Set();
const alarmToken = data => data.alarmId + '|' + data.session;
let pushStateWrites = Promise.resolve();
const appScopeURL = () => new URL(self.registration.scope || './', self.location.href || (self.location.origin + '/'));
const inAppScope = url => { try { const value = new URL(url), scope = appScopeURL(); return value.origin === scope.origin && value.pathname.startsWith(scope.pathname); } catch { return false; } };
const pushStateRequest = () => new Request(new URL(PUSH_STATE_KEY.slice(1), appScopeURL()).href);
async function readStoredPushState() {
  if (!globalThis.caches || typeof caches.open !== 'function' || typeof Request !== 'function' || typeof Response !== 'function') return null;
  try {
    const cache = await caches.open(PUSH_STATE_CACHE);
    const response = await cache.match(pushStateRequest());
    if (!response) return { enabled:false, watches:[] };
    const state = await response.json();
    if (!state || state.enabled !== true || !Array.isArray(state.watches)) return { enabled:false, watches:[] };
    return { enabled:true, watches:state.watches.filter(w => w && typeof w.id === 'string' && w.id && typeof w.session === 'string' && w.session) };
  } catch { return null; }
}
async function readPushState() {
  await pushStateWrites;
  return readStoredPushState();
}
function serializePushStateWrite(operation) {
  const next = pushStateWrites.then(operation, operation);
  pushStateWrites = next.catch(() => {});
  return next;
}
async function writePushState(state) {
  if (!globalThis.caches || typeof caches.open !== 'function' || typeof Request !== 'function' || typeof Response !== 'function') return false;
  try {
    const cache = await caches.open(PUSH_STATE_CACHE);
    await cache.put(pushStateRequest(), new Response(JSON.stringify(state), { headers:{ 'Content-Type':'application/json' } }));
    return true;
  } catch { return false; }
}
async function verifyWindowSource(source) {
  if (!source?.id || source.type !== 'window' || typeof source.url !== 'string' || !inAppScope(source.url)) return false;
  try {
    const current = await self.clients.get(source.id);
    return !!current && current.type === 'window' && inAppScope(current.url);
  } catch { return false; }
}
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
function matchingWatch(state, data) {
  return !!state?.enabled && state.watches.some(w => w.id === data.id && w.session === data.session);
}
async function closePushNotification(id, session) {
  try {
    const notifications = await self.registration.getNotifications({ includeTriggered:true });
    notifications.filter(n => n.data?.kind === 'bus_arrival' && n.data?.id === id && n.data?.session === session).forEach(n => n.close());
  } catch {}
}
async function deliverWebPush(e) {
  let payload;
  try {
    if (!e.data || typeof e.data.json !== 'function') return false;
    payload = e.data.json();
  } catch { return false; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const data = payload.data;
  if (!data || typeof data !== 'object' || data.kind !== 'bus_arrival' || typeof data.id !== 'string' || !data.id || typeof data.session !== 'string' || !data.session) return false;
  if (!matchingWatch(await readPushState(), data)) return false;
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title : '巴士就嚟到站';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const tag = typeof payload.tag === 'string' && payload.tag ? payload.tag : `buspulse-webpush-${data.id}`;
  const options = {
    body, icon:'./icon-192.png', badge:'./icon-192.png', tag, renotify:true,
    vibrate:[260,100,260,100,260], silent:false, requireInteraction:true,
    data:{ kind:'bus_arrival', id:data.id, alarmId:typeof data.alarmId === 'string' ? data.alarmId : data.id, session:data.session, url:'./' }
  };
  try { await self.registration.showNotification(title, options); } catch { return false; }
  // A stop/pause/session change racing showNotification must not leave a stale alert visible.
  if (!matchingWatch(await readPushState(), data)) {
    await closePushNotification(data.id, data.session);
    return false;
  }
  return true;
}
self.addEventListener('message', e => {
  const data = e.data || {};
  if (data.type === 'SYNC_WEB_PUSH_STATE') {
    const operation = async () => {
      if (!(await verifyWindowSource(e.source)) || typeof data.enabled !== 'boolean' || !Array.isArray(data.watches)) return { ok:false };
      const normalized = [];
      if (data.enabled) {
        for (const item of data.watches) {
          if (!item || typeof item.id !== 'string' || !item.id || typeof item.session !== 'string' || !item.session) continue;
          if (!normalized.some(w => w.id === item.id && w.session === item.session)) normalized.push({ id:item.id, session:item.session });
        }
      }
      const previous = await readStoredPushState();
      if (!(await writePushState({ enabled:data.enabled && normalized.length > 0, watches:normalized }))) return { ok:false };
      if (previous?.enabled) {
        const revoked = previous.watches.filter(w => !normalized.some(next => next.id === w.id && next.session === w.session));
        try {
          const old = await self.registration.getNotifications({ includeTriggered:true });
          old.filter(n => n.data?.kind === 'bus_arrival' && revoked.some(w => w.id === n.data.id && w.session === n.data.session)).forEach(n => n.close());
        } catch {}
      }
      return { ok:true };
    };
    e.waitUntil(serializePushStateWrite(operation).then(result => e.ports?.[0]?.postMessage(result)).catch(() => e.ports?.[0]?.postMessage({ ok:false })));
    return;
  }
  if (data.type === 'CANCEL_ARRIVAL_ALARM') {
    if (typeof data.session === 'string' && data.session) revokedAlarmSessions.add(alarmToken(data));
    if (revokedAlarmSessions.size > 512) revokedAlarmSessions.delete(revokedAlarmSessions.values().next().value);
    const cancelPushState = serializePushStateWrite(async () => {
      if (typeof data.alarmId !== 'string' || !data.alarmId || !globalThis.caches || typeof caches.open !== 'function') return;
      const state = await readStoredPushState();
      if (!state) return;
      const watches = state.watches.filter(w => w.id !== data.alarmId || (data.session && w.session !== data.session));
      await writePushState({ enabled:state.enabled && watches.length > 0, watches });
    });
    e.waitUntil(Promise.all([cancelPushState, self.registration.getNotifications({ includeTriggered:true }).then(ns => ns.filter(n => {
      const sameRoute = (n.data?.alarmId || n.data?.id) === data.alarmId;
      return sameRoute && (!data.session || !n.data?.session || n.data.session === data.session);
    }).forEach(n => n.close())).catch(() => {})]));
    return;
  }
  // Legacy BUS_ARRIVAL messages contain no verifiable switch/session: fail closed.
  if (data.type !== 'BUS_ARRIVAL_AUTHORIZED') return;
  e.waitUntil(deliverAuthorizedArrival(e, data).then(delivered => e.ports?.[0]?.postMessage({ delivered })).catch(() => e.ports?.[0]?.postMessage({ delivered:false })));
});
// One push event must use only this consent-checked delivery path.
self.addEventListener('push', e => {
  e.waitUntil(deliverWebPush(e).catch(() => false));
});
self.addEventListener('notificationclick', e => {
  const notificationData = e.notification?.data || {};
  e.notification.close();
  const clearBadge = self.registration.clearAppBadge
    ? self.registration.clearAppBadge().catch(() => {}) : Promise.resolve();
  const requested = typeof notificationData.url === 'string' && notificationData.url.startsWith('./') ? notificationData.url : './';
  const target = new URL(requested, appScopeURL());
  if (!inAppScope(target.href)) target.href = appScopeURL().href;
  e.waitUntil(Promise.all([
    clearBadge, self.clients.matchAll({ type:'window', includeUncontrolled:true })
  ]).then(([, list]) => {
    const existing = list.find(c => { try { return inAppScope(c.url) && 'focus' in c; } catch { return false; } });
    if (existing) {
      if (existing.navigate && target.href !== new URL(existing.url).href) return existing.navigate(target.href).then(() => existing.focus());
      return existing.focus();
    }
    return self.clients.openWindow(target.href);
  }));
});
