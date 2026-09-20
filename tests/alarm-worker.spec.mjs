import { test, expect } from '@playwright/test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { MessageChannel } from 'node:worker_threads';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const request = { type:'BUS_ARRIVAL_AUTHORIZED', alarmId:'route-1', session:'session-1', tag:'buspulse-route-1', title:'到站提醒' };

function worker(allowed = true) {
  const handlers = {}, shown = [], replies = [], stored = [];
  const client = { id:'page-1', type:'window', url:'https://bus.example/app/', postMessage(data, ports) { ports[0].postMessage({ allowed }); ports[0].close(); } };
  const self = {
    location:{ origin:'https://bus.example' },
    addEventListener(type, handler) { handlers[type] = handler; },
    clients:{ async get(){ return client; }, async claim(){} },
    registration:{
      async showNotification(title, options) { shown.push({ title, options }); },
      async getNotifications(){ return stored; }
    }
  };
  vm.runInNewContext(source, { self, URL, MessageChannel, setTimeout, clearTimeout, caches:{ async keys(){ return []; } } });
  async function send(data, source = client) {
    const pending = [];
    handlers.message({ data, source, ports:[{ postMessage(value){ replies.push(value); } }], waitUntil(promise){ pending.push(promise); } });
    await Promise.all(pending);
  }
  return { handlers, client, shown, replies, stored, send };
}

test('worker ignores legacy unverified BUS_ARRIVAL messages', async () => {
  const w = worker();
  await w.send({ type:'BUS_ARRIVAL', title:'old page notification', silent:false });
  expect(w.shown).toHaveLength(0);
});

test('worker denies notifications when the originating page says the bell is off', async () => {
  const w = worker(false);
  await w.send(request);
  expect(w.shown).toHaveLength(0);
  expect(w.replies).toEqual([{ delivered:false }]);
});

test('worker only delivers after current page confirmation and includes the session', async () => {
  const w = worker(true);
  await w.send(request);
  expect(w.shown).toHaveLength(1);
  expect(w.shown[0].options.data).toEqual({ url:'./', alarmId:'route-1', session:'session-1' });
  expect(w.replies).toEqual([{ delivered:true }]);
});

test('revocation during asynchronous client confirmation blocks delivery', async () => {
  const w = worker(true);
  let reply, started;
  const ready = new Promise(resolve => { started = resolve; });
  w.client.postMessage = (data, ports) => { reply = ports[0]; started(); };
  const delivery = w.send(request);
  await ready;
  await w.send({ type:'CANCEL_ARRIVAL_ALARM', alarmId:request.alarmId, session:request.session });
  reply.postMessage({ allowed:true }); reply.close();
  await delivery;
  expect(w.shown).toHaveLength(0);
  expect(w.replies).toEqual([{ delivered:false }]);
});

test('worker rejects a missing session or an untrusted client origin', async () => {
  const w = worker(true);
  await w.send({ ...request, session:null });
  w.client.url = 'https://different.example/';
  await w.send(request);
  expect(w.shown).toHaveLength(0);
});

test('activation retires old arrival notifications without removing explicit test notifications', async () => {
  const w = worker();
  const closed = [];
  w.stored.push({ tag:'buspulse-old', close(){ closed.push('old'); } });
  w.stored.push({ tag:'buspulse-test-123', close(){ closed.push('test'); } });
  let pending;
  w.handlers.activate({ waitUntil(promise){ pending = promise; } });
  await pending;
  expect(closed).toEqual(['old']);
});
