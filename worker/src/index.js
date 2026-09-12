import { buildPushPayload } from '@block65/webcrypto-web-push';

const API = {
  KMB: 'https://data.etabus.gov.hk/v1/transport/kmb',
  CTB: 'https://rt.data.gov.hk/v2/transport/citybus',
  GMB: 'https://data.etagmb.gov.hk/eta'
};
const LEAD_MINUTES = 2;
const MAX_SUBSCRIPTIONS = 5000;
const INDEX_KEY = 'meta:active-subscriptions';

function cors(origin, env) {
  const allowed = env.ALLOWED_ORIGIN || '*';
  return { 'access-control-allow-origin': origin === allowed ? origin : allowed, 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'Origin' };
}
function json(data, status = 200, origin = '*', env = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin, env) } });
}
function keyFor(subscription) { return 'sub:' + btoa(subscription.endpoint).replaceAll('/', '_').replaceAll('+', '-').replaceAll('=', ''); }
function validSubscription(s) { return s && typeof s.endpoint === 'string' && s.endpoint.startsWith('https://') && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string'; }
function validItem(it) { return it && ['KMB', 'CTB', 'GMB'].includes(it.co) && typeof it.route === 'string' && typeof it.seq !== 'undefined'; }
async function getJSON(url) { const r = await fetch(url, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('API ' + r.status); return r.json(); }
async function readIndex(env) {
  const value = await env.SUBSCRIPTIONS.get(INDEX_KEY, 'json');
  return Array.isArray(value) ? value.filter(k => typeof k === 'string' && k.startsWith('sub:')).slice(0, MAX_SUBSCRIPTIONS) : [];
}
async function writeIndex(env, keys) {
  const unique = [...new Set(keys)].filter(k => typeof k === 'string' && k.startsWith('sub:')).slice(0, MAX_SUBSCRIPTIONS);
  await env.SUBSCRIPTIONS.put(INDEX_KEY, JSON.stringify(unique));
  return unique;
}
async function addToIndex(env, key) {
  const keys = await readIndex(env);
  if (!keys.includes(key)) await writeIndex(env, [...keys, key]);
}
async function removeFromIndex(env, key) {
  const keys = await readIndex(env);
  if (keys.includes(key)) await writeIndex(env, keys.filter(k => k !== key));
}
function etaUrl(it) {
  if (it.co === 'KMB') return API.KMB + '/route-eta/' + encodeURIComponent(it.route) + '/' + encodeURIComponent(it.service_type);
  if (it.co === 'CTB') return API.CTB + '/eta/CTB/' + encodeURIComponent(it.stopId) + '/' + encodeURIComponent(it.route);
  return API.GMB + '/route-stop/' + encodeURIComponent(it.route_id) + '/' + encodeURIComponent(it.route_seq) + '/' + encodeURIComponent(it.seq);
}
function parseETAs(it, payload) {
  const data = payload.data;
  if (it.co === 'KMB') return (data || []).filter(e => e.seq === it.seq && e.dir === it.dir && e.eta).map(e => ({ iso: e.eta, rmk: e.rmk_tc || '' }));
  if (it.co === 'CTB') return (data || []).filter(e => e.eta && e.dir === it.dir).map(e => ({ iso: e.eta, rmk: e.rmk_tc || '' }));
  const rows = Array.isArray(data) ? (data[0]?.eta || []) : (data?.eta || []);
  return rows.filter(e => e.timestamp).map(e => ({ iso: e.timestamp, rmk: e.remarks_tc || '' }));
}
export function dueETA(etas, now = Date.now(), lead = LEAD_MINUTES) {
  return etas.map(e => ({ ...e, at: Date.parse(e.iso), min: Math.round((Date.parse(e.iso) - now) / 60000) }))
    .filter(e => Number.isFinite(e.at) && e.min >= -2 && e.min <= lead)
    .sort((a, b) => a.at - b.at)[0] || null;
}
async function notify(sub, body, env, tag) {
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const payload = await buildPushPayload({ data: JSON.stringify({ title: '巴士就嚟到站', body, tag, silent: false }) }, sub, vapid);
  return fetch(sub.endpoint, payload);
}
async function checkSubscription(sub, env) {
  const routes = Array.isArray(sub.routes) ? sub.routes.filter(validItem).slice(0, 20) : [];
  for (const it of routes) {
    const result = parseETAs(it, await getJSON(etaUrl(it)));
    const eta = dueETA(result);
    if (!eta) continue;
    const tripKey = it.co + ':' + it.route + ':' + it.seq + ':' + eta.at;
    const sentKey = keyFor(sub) + ':sent:' + tripKey;
    if (await env.SUBSCRIPTIONS.get(sentKey)) continue;
    const response = await notify(sub, it.route + ' 往 ' + (it.dest || '') + '，約 ' + Math.max(0, eta.min) + ' 分鐘到 ' + (it.stopName || ''), env, 'buspulse-' + encodeURIComponent(tripKey));
    if (response.status === 404 || response.status === 410) {
      const key = keyFor(sub);
      await env.SUBSCRIPTIONS.delete(key);
      await removeFromIndex(env, key);
      return;
    }
    if (!response.ok) throw new Error('push ' + response.status);
    await env.SUBSCRIPTIONS.put(sentKey, '1', { expirationTtl: 21600 });
  }
}
async function runCron(env) {
  // Never use KV.list() in the minute-level Cron. The index costs one KV get
  // and allows an empty service to return immediately without consuming the
  // 1,000/day KV list-operation free limit.
  const keys = await readIndex(env);
  if (!keys.length) return { checked: 0, failed: 0 };
  const results = await Promise.allSettled(keys.map(async key => {
    const sub = await env.SUBSCRIPTIONS.get(key, 'json');
    if (sub) await checkSubscription(sub, env);
  }));
  return { checked: results.length, failed: results.filter(r => r.status === 'rejected').length };
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin, env) });
    const url = new URL(request.url);
    if (url.pathname === '/vapid-public-key' && request.method === 'GET') return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, origin, env);
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      const body = await request.json();
      if (!validSubscription(body.subscription) || !Array.isArray(body.routes) || !body.routes.some(validItem)) return json({ error: 'invalid subscription or routes' }, 400, origin, env);
      const subscription = { endpoint: body.subscription.endpoint, expirationTime: body.subscription.expirationTime ?? null, keys: body.subscription.keys, routes: body.routes.filter(validItem).slice(0, 20), updatedAt: new Date().toISOString() };
      const key = keyFor(subscription);
      await env.SUBSCRIPTIONS.put(key, JSON.stringify(subscription));
      await addToIndex(env, key);
      return json({ ok: true }, 201, origin, env);
    }
    if (url.pathname === '/subscribe' && request.method === 'DELETE') {
      const body = await request.json();
      if (!validSubscription(body)) return json({ error: 'invalid subscription' }, 400, origin, env);
      const key = keyFor(body);
      await env.SUBSCRIPTIONS.delete(key);
      await removeFromIndex(env, key);
      return json({ ok: true }, 200, origin, env);
    }
    if (url.pathname === '/health') return json({ ok: true, cron: 'disabled until explicitly enabled', kvStrategy: 'active-index-no-list' }, 200, origin, env);
    return json({ error: 'not found' }, 404, origin, env);
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(runCron(env)); }
};
