import { test, expect } from '@playwright/test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { MessageChannel } from 'node:worker_threads';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://bus.example';
const SCOPE = `${ORIGIN}/app/`;
const authorized = { enabled:true, watches:[{ id:'route-1', session:'session-1' }] };
const arrival = (overrides = {}) => ({
  title:'即將到站', body:'巴士快到站', tag:'buspulse-route-1',
  data:{ kind:'bus_arrival', id:'route-1', alarmId:'route-1', session:'session-1', url:'./' },
  ...overrides
});

function harness({ cacheStore = new Map(), withCache = true, alarmAllowed = true } = {}) {
  const handlers = {}, shown = [], notifications = [], closed = [], replies = [];
  const client = {
    id:'page-1', type:'window', url:SCOPE,
    postMessage(data, ports) {
      if (data.type === 'VERIFY_ARRIVAL_ALARM') {
        ports[0].postMessage({ allowed:alarmAllowed });
        ports[0].close();
      }
    }
  };
  const cache = {
    async match(request) { return cacheStore.get(String(request.url || request))?.clone() || null; },
    async put(request, response) { cacheStore.set(String(request.url || request), response.clone()); },
    async addAll() {}
  };
  const caches = {
    async keys() { return ['buspulse-hk-push-state-v1']; },
    async delete(key) { return key !== 'buspulse-hk-push-state-v1' && cacheStore.clear() === undefined; }
  };
  if (withCache) caches.open = async () => cache;
  const self = {
    location:{ origin:ORIGIN },
    addEventListener(type, handler) { handlers[type] = handler; },
    skipWaiting:async () => {},
    clients:{
      async get(id) { return id === client.id ? client : null; },
      async claim() {},
      async matchAll() { return [client]; },
      async openWindow(url) { return { url }; }
    },
    registration:{
      scope:SCOPE,
      async showNotification(title, options) {
        shown.push({ title, options });
        notifications.push({ tag:options.tag, data:options.data, close() { closed.push(options.data); notifications.splice(notifications.indexOf(this), 1); } });
      },
      async getNotifications() { return notifications; },
      async setAppBadge() {}, async clearAppBadge() {}
    }
  };
  vm.runInNewContext(source, { self, URL, Request, Response, MessageChannel, setTimeout, clearTimeout, caches });
  async function dispatch(type, { data, source:from = client, json, ports = [] } = {}) {
    const pending = [];
    const event = { data:json !== undefined ? { json } : data, source:from, ports, waitUntil(promise) { pending.push(promise); } };
    handlers[type](event);
    await Promise.all(pending);
  }
  async function sync(state, from = client) {
    let result;
    await dispatch('message', { data:{ type:'SYNC_WEB_PUSH_STATE', ...state }, source:from, ports:[{ postMessage(value) { result = value; } }] });
    replies.push(result);
    return result;
  }
  async function push(payload) {
    const json = payload instanceof Error ? () => { throw payload; } : () => payload;
    await dispatch('push', { json });
  }
  return { handlers, client, self, shown, notifications, closed, replies, cacheStore, sync, push, dispatch };
}

async function seed(worker, state = authorized) {
  expect(await worker.sync(state)).toEqual({ ok:true });
}

test('authorized route push survives service-worker restart without an open page', async () => {
  const persistentCache = new Map();
  const first = harness({ cacheStore:persistentCache });
  await seed(first);
  const restarted = harness({ cacheStore:persistentCache });
  restarted.self.clients.get = async () => null;
  restarted.self.clients.matchAll = async () => [];
  await restarted.push(arrival());
  expect(restarted.shown).toHaveLength(1);
  expect(restarted.shown[0].options.data).toEqual({ kind:'bus_arrival', id:'route-1', alarmId:'route-1', session:'session-1', url:'./' });
});

test('disabled, missing, malformed and superseded sessions fail closed', async () => {
  const missing = harness();
  await missing.push(arrival());
  expect(missing.shown).toHaveLength(0);

  const paused = harness();
  await seed(paused, { enabled:false, watches:[] });
  await paused.push(arrival());
  expect(paused.shown).toHaveLength(0);

  const stale = harness();
  await seed(stale, { enabled:true, watches:[{ id:'route-1', session:'new-session' }] });
  await stale.push(arrival());
  expect(stale.shown).toHaveLength(0);

  const malformed = harness();
  await seed(malformed);
  await malformed.push(new Error('invalid JSON'));
  await malformed.push(null);
  await malformed.push({ title:'missing session', data:{ kind:'bus_arrival', id:'route-1' } });
  expect(malformed.shown).toHaveLength(0);
});

test('push display retains system sound and does not introduce custom audio fields', async () => {
  const worker = harness();
  await seed(worker);
  await worker.push(arrival());
  const options = worker.shown[0].options;
  expect(options.silent).toBe(false);
  expect(options.vibrate).toEqual([260,100,260,100,260]);
  expect(Object.keys(options).some(key => /audio|sound/i.test(key))).toBe(false);
});

test('push-state sync requires a same-scope live window and acknowledges success/failure', async () => {
  const worker = harness();
  expect(await worker.sync(authorized)).toEqual({ ok:true });
  const foreign = { id:'foreign', type:'window', url:'https://evil.example/' };
  expect(await worker.sync(authorized, foreign)).toEqual({ ok:false });
  const otherApp = { id:'other', type:'window', url:`${ORIGIN}/other/` };
  expect(await worker.sync(authorized, otherApp)).toEqual({ ok:false });
  await worker.push(arrival());
  expect(worker.shown).toHaveLength(1);
});

test('state revocation persists across restart and closes the matching notification', async () => {
  const cacheStore = new Map();
  const worker = harness({ cacheStore });
  await seed(worker);
  await worker.push(arrival());
  expect(worker.shown).toHaveLength(1);
  expect(await worker.sync({ enabled:false, watches:[] })).toEqual({ ok:true });
  expect(worker.closed).toHaveLength(1);
  const restarted = harness({ cacheStore });
  await restarted.push(arrival());
  expect(restarted.shown).toHaveLength(0);
});

test('CANCEL_ARRIVAL_ALARM persistently revokes the matching route session', async () => {
  const cacheStore = new Map();
  const worker = harness({ cacheStore });
  await seed(worker);
  await worker.push(arrival());
  await worker.dispatch('message', { data:{ type:'CANCEL_ARRIVAL_ALARM', alarmId:'route-1', session:'session-1' } });
  expect(worker.closed).toHaveLength(1);
  const restarted = harness({ cacheStore });
  await restarted.push(arrival());
  expect(restarted.shown).toHaveLength(0);
});

test('notification clicks stay inside the PWA scope and focus only an in-scope client', async () => {
  for (const url of ['./', './../../outside', 'https://evil.example/']) {
    const worker = harness();
    const opened = [];
    worker.self.clients.matchAll = async () => [];
    worker.self.clients.openWindow = async url => { opened.push(url); };
    let pending;
    worker.handlers.notificationclick({ notification:{ data:{ url }, close(){} }, waitUntil(promise) { pending = promise; } });
    await pending;
    expect(opened).toEqual([SCOPE]);
  }

  const worker = harness();
  const opened = [];
  let focused = false;
  worker.self.clients.matchAll = async () => [{ url:`${ORIGIN}/another-app/`, focus() { focused = true; } }];
  worker.self.clients.openWindow = async url => { opened.push(url); };
  let pending;
  worker.handlers.notificationclick({ notification:{ data:{ url:'./' }, close(){} }, waitUntil(promise) { pending = promise; } });
  await pending;
  expect(focused).toBe(false);
  expect(opened).toEqual([SCOPE]);
});

test('local alarm authorization and legacy rejection remain unchanged', async () => {
  const worker = harness();
  await worker.dispatch('message', { data:{ type:'BUS_ARRIVAL', alarmId:'route-1', session:'session-1' } });
  expect(worker.shown).toHaveLength(0);
  await worker.dispatch('message', { data:{ type:'BUS_ARRIVAL_AUTHORIZED', alarmId:'route-1', session:'session-1', title:'Local alarm' }, ports:[{ postMessage(value) { worker.replies.push(value); } }] });
  expect(worker.shown).toHaveLength(1);
  expect(worker.shown[0].options.silent).toBe(false);
  expect(worker.replies.at(-1)).toEqual({ delivered:true });

  const denied = harness({ alarmAllowed:false });
  await denied.dispatch('message', { data:{ type:'BUS_ARRIVAL_AUTHORIZED', alarmId:'route-1', session:'session-1' }, ports:[{ postMessage(value) { denied.replies.push(value); } }] });
  expect(denied.shown).toHaveLength(0);
  expect(denied.replies.at(-1)).toEqual({ delivered:false });
});

test('activation preserves durable push state cache and legacy mocks still accept local alarm messages', async () => {
  const noCache = harness({ withCache:false });
  await noCache.dispatch('message', { data:{ type:'BUS_ARRIVAL', title:'legacy' } });
  let pending;
  noCache.handlers.activate({ waitUntil(promise) { pending = promise; } });
  await pending;
  expect(noCache.shown).toHaveLength(0);

  const cacheStore = new Map();
  const worker = harness({ cacheStore });
  await seed(worker);
  worker.handlers.activate({ waitUntil(promise) { pending = promise; } });
  await pending;
  const restarted = harness({ cacheStore });
  await restarted.push(arrival());
  expect(restarted.shown).toHaveLength(1);
});
