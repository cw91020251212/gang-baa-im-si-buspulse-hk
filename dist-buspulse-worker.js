var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/uint8array-extras/index.js
var objectToString = Object.prototype.toString;
var uint8ArrayStringified = "[object Uint8Array]";
var arrayBufferStringified = "[object ArrayBuffer]";
function isType(value, typeConstructor, typeStringified) {
  if (!value) {
    return false;
  }
  if (value.constructor === typeConstructor) {
    return true;
  }
  return objectToString.call(value) === typeStringified;
}
__name(isType, "isType");
function isUint8Array(value) {
  return isType(value, Uint8Array, uint8ArrayStringified);
}
__name(isUint8Array, "isUint8Array");
function isArrayBuffer(value) {
  return isType(value, ArrayBuffer, arrayBufferStringified);
}
__name(isArrayBuffer, "isArrayBuffer");
function isUint8ArrayOrArrayBuffer(value) {
  return isUint8Array(value) || isArrayBuffer(value);
}
__name(isUint8ArrayOrArrayBuffer, "isUint8ArrayOrArrayBuffer");
function toUint8ArrayIfArrayBuffer(value) {
  return isArrayBuffer(value) ? new Uint8Array(value) : value;
}
__name(toUint8ArrayIfArrayBuffer, "toUint8ArrayIfArrayBuffer");
function assertUint8ArrayOrArrayBuffer(value) {
  if (!isUint8ArrayOrArrayBuffer(value)) {
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof value}\``);
  }
}
__name(assertUint8ArrayOrArrayBuffer, "assertUint8ArrayOrArrayBuffer");
function toUint8Array(value) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`Unsupported value, got \`${typeof value}\`.`);
}
__name(toUint8Array, "toUint8Array");
function concatUint8Arrays(arrays, totalLength) {
  if (arrays.length === 0) {
    return new Uint8Array(0);
  }
  totalLength ??= arrays.reduce((accumulator, currentValue) => accumulator + currentValue.byteLength, 0);
  const returnValue = new Uint8Array(totalLength);
  let offset = 0;
  for (let array of arrays) {
    assertUint8ArrayOrArrayBuffer(array);
    array = toUint8ArrayIfArrayBuffer(array);
    returnValue.set(array, offset);
    offset += array.length;
  }
  return returnValue;
}
__name(concatUint8Arrays, "concatUint8Arrays");
var cachedDecoders = {
  utf8: new globalThis.TextDecoder("utf8")
};
function assertString(value) {
  if (typeof value !== "string") {
    throw new TypeError(`Expected \`string\`, got \`${typeof value}\``);
  }
}
__name(assertString, "assertString");
var cachedEncoder = new globalThis.TextEncoder();
function stringToUint8Array(string) {
  assertString(string);
  return cachedEncoder.encode(string);
}
__name(stringToUint8Array, "stringToUint8Array");
function base64ToBase64Url(base64) {
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
__name(base64ToBase64Url, "base64ToBase64Url");
function base64UrlToBase64(base64url) {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const padding = (4 - base64.length % 4) % 4;
  return base64 + "=".repeat(padding);
}
__name(base64UrlToBase64, "base64UrlToBase64");
var MAX_BLOCK_SIZE = 65535;
function uint8ArrayToBase64(array, { urlSafe = false } = {}) {
  assertUint8ArrayOrArrayBuffer(array);
  array = toUint8ArrayIfArrayBuffer(array);
  let base64 = "";
  for (let index = 0; index < array.length; index += MAX_BLOCK_SIZE) {
    const chunk = array.subarray(index, index + MAX_BLOCK_SIZE);
    base64 += globalThis.btoa(String.fromCodePoint.apply(void 0, chunk));
  }
  return urlSafe ? base64ToBase64Url(base64) : base64;
}
__name(uint8ArrayToBase64, "uint8ArrayToBase64");
function base64ToUint8Array(base64String) {
  assertString(base64String);
  return Uint8Array.from(globalThis.atob(base64UrlToBase64(base64String)), (x) => x.codePointAt(0));
}
__name(base64ToUint8Array, "base64ToUint8Array");
var byteToHexLookupTable = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));

// node_modules/@block65/webcrypto-web-push/dist/lib/utils.js
function encodeRecordSize(size) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, size);
  return bytes;
}
__name(encodeRecordSize, "encodeRecordSize");
function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
__name(invariant, "invariant");

// node_modules/@block65/webcrypto-web-push/dist/lib/client-keys.js
async function deriveClientKeys(sub) {
  const bytes = base64ToUint8Array(sub.keys.p256dh);
  const authSecretBytes = base64ToUint8Array(sub.keys.auth);
  invariant(bytes.byteLength === 65 && bytes[0] === 4, "Subscription p256dh is not an uncompressed P-256 point");
  invariant(authSecretBytes.byteLength === 16, "Subscription auth secret is not 16 bytes");
  return {
    publicKeyBytes: bytes,
    publicKey: await crypto.subtle.importKey("raw", bytes, {
      name: "ECDH",
      namedCurve: "P-256"
    }, false, []),
    authSecretBytes
  };
}
__name(deriveClientKeys, "deriveClientKeys");

// node_modules/@block65/webcrypto-web-push/dist/lib/hkdf.js
function createHMAC(data) {
  const keyPromise = crypto.subtle.importKey("raw", data, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, ["sign"]);
  return {
    hash: /* @__PURE__ */ __name(async (input) => {
      const k = await keyPromise;
      return crypto.subtle.sign("HMAC", k, input);
    }, "hash")
  };
}
__name(createHMAC, "createHMAC");
async function hkdf(salt, ikm) {
  const prkhPromise = createHMAC(salt).hash(ikm).then((prk) => createHMAC(prk));
  return {
    extract: /* @__PURE__ */ __name(async (info, len) => {
      const prkh = await prkhPromise;
      const blocks = await Array.from({ length: Math.ceil(len / 32) }, (_, i) => i).reduce(async (acc, i) => {
        const previous = await acc;
        const hash = await prkh.hash(new Uint8Array([...previous.at(-1) ?? [], ...info, i + 1]));
        return [...previous, new Uint8Array(hash)];
      }, Promise.resolve([]));
      return concatUint8Arrays(blocks).slice(0, len);
    }, "extract")
  };
}
__name(hkdf, "hkdf");

// node_modules/@block65/webcrypto-web-push/dist/lib/info.js
function createKeyInfo(clientPublic, serverPublic) {
  return new Uint8Array([
    ...stringToUint8Array("WebPush: info\0"),
    ...clientPublic,
    ...serverPublic
  ]);
}
__name(createKeyInfo, "createKeyInfo");
function createInfo(type) {
  return stringToUint8Array(`Content-Encoding: ${type}\0`);
}
__name(createInfo, "createInfo");

// node_modules/@block65/webcrypto-web-push/dist/lib/local-keys.js
async function generateLocalKeys() {
  const keyPair = await crypto.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, false, ["deriveBits"]);
  return {
    privateKey: keyPair.privateKey,
    publicKeyBytes: new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
  };
}
__name(generateLocalKeys, "generateLocalKeys");

// node_modules/@block65/webcrypto-web-push/dist/lib/salt.js
async function getSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}
__name(getSalt, "getSalt");

// node_modules/@block65/webcrypto-web-push/dist/lib/encrypt.js
var recordSize = 4096;
var headerSize = 21 + 65;
var maxPlaintextSize = recordSize - headerSize - 17;
async function encryptNotification(subscription, plaintext, options = {}) {
  invariant(plaintext.byteLength <= maxPlaintextSize, `Payload is ${plaintext.byteLength} bytes, the maximum is ${maxPlaintextSize}`);
  const clientKeys = await deriveClientKeys(subscription);
  const salt = await getSalt();
  const localKeys = await generateLocalKeys();
  const sharedSecret = await crypto.subtle.deriveBits({
    name: "ECDH",
    public: clientKeys.publicKey
  }, localKeys.privateKey, 256);
  const keyInfo = createKeyInfo(clientKeys.publicKeyBytes, localKeys.publicKeyBytes);
  const cekInfo = createInfo("aes128gcm");
  const nonceInfo = createInfo("nonce");
  const ikmHkdf = await hkdf(clientKeys.authSecretBytes, sharedSecret);
  const ikm = await ikmHkdf.extract(keyInfo, 32);
  const messageHkdf = await hkdf(salt, ikm);
  const cekBytes = await messageHkdf.extract(cekInfo, 16);
  const nonceBytes = await messageHkdf.extract(nonceInfo, 12);
  const cekCryptoKey = await crypto.subtle.importKey("raw", cekBytes, {
    name: "AES-GCM",
    length: 128
  }, false, ["encrypt"]);
  const padTo = options.pad ?? true ? maxPlaintextSize : plaintext.byteLength;
  const padded = new Uint8Array(padTo + 1);
  padded.set(plaintext);
  padded[plaintext.byteLength] = 2;
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: nonceBytes
  }, cekCryptoKey, padded);
  return new Uint8Array([
    ...salt,
    ...encodeRecordSize(recordSize),
    localKeys.publicKeyBytes.byteLength,
    ...localKeys.publicKeyBytes,
    ...new Uint8Array(encrypted)
  ]);
}
__name(encryptNotification, "encryptNotification");

// node_modules/@block65/webcrypto-web-push/dist/lib/base64.js
function encodeBase64Url(value) {
  return uint8ArrayToBase64(toUint8Array(value), { urlSafe: true });
}
__name(encodeBase64Url, "encodeBase64Url");
function objectToBase64Url(obj) {
  return encodeBase64Url(stringToUint8Array(JSON.stringify(obj)));
}
__name(objectToBase64Url, "objectToBase64Url");

// node_modules/@block65/webcrypto-web-push/dist/lib/jwt.js
async function sign(payload, key) {
  const headerStr = objectToBase64Url({
    typ: "JWT",
    alg: "ES256"
  });
  const payloadStr = objectToBase64Url({
    iat: Math.floor(Date.now() / 1e3),
    ...payload
  });
  const dataStr = `${headerStr}.${payloadStr}`;
  const signature = await crypto.subtle.sign({
    name: "ECDSA",
    hash: "SHA-256"
  }, key, stringToUint8Array(dataStr));
  return `${dataStr}.${encodeBase64Url(signature)}`;
}
__name(sign, "sign");

// node_modules/@block65/webcrypto-web-push/dist/lib/vapid.js
async function vapidHeaders(subscription, vapid) {
  invariant(vapid.subject, "Vapid subject is empty");
  invariant(vapid.privateKey, "Vapid private key is empty");
  invariant(vapid.publicKey, "Vapid public key is empty");
  const endpoint = new URL(subscription.endpoint);
  invariant(endpoint.protocol === "https:", `Subscription endpoint is not https: ${endpoint.protocol}`);
  const vapidPublicKeyBytes = base64ToUint8Array(vapid.publicKey);
  const publicKey = await crypto.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(vapidPublicKeyBytes.slice(1, 33)),
    y: encodeBase64Url(vapidPublicKeyBytes.slice(33, 65)),
    d: vapid.privateKey
  }, {
    name: "ECDSA",
    namedCurve: "P-256"
  }, false, ["sign"]);
  const jwt = await sign({
    aud: endpoint.origin,
    exp: Math.floor(Date.now() / 1e3) + 12 * 60 * 60,
    sub: vapid.subject
  }, publicKey);
  return {
    headers: {
      authorization: `vapid t=${jwt}, k=${vapid.publicKey}`
    }
  };
}
__name(vapidHeaders, "vapidHeaders");

// node_modules/@block65/webcrypto-web-push/dist/lib/payload.js
async function buildPushPayload(message, subscription, vapid) {
  const { headers } = await vapidHeaders(subscription, vapid);
  const body = await encryptNotification(subscription, stringToUint8Array(
    // if its a primitive, convert to string, otherwise stringify
    typeof message.data === "string" || typeof message.data === "number" ? message.data.toString() : JSON.stringify(message.data)
  ));
  return {
    headers: {
      ...headers,
      ttl: (message.options?.ttl || 60).toString(),
      ...message.options?.urgency && {
        urgency: message.options.urgency
      },
      ...message.options?.topic && {
        topic: message.options.topic
      },
      "content-encoding": "aes128gcm",
      "content-length": body.byteLength.toString(),
      "content-type": "application/octet-stream"
    },
    method: "post",
    body
  };
}
__name(buildPushPayload, "buildPushPayload");

// src/index.js
var API = {
  KMB: "https://data.etabus.gov.hk/v1/transport/kmb",
  CTB: "https://rt.data.gov.hk/v2/transport/citybus",
  GMB: "https://data.etagmb.gov.hk/eta"
};
var MAX_ROUTES = 20;
var MAX_BODY = 1e5;
var LEAD_DEFAULT = 2;
var rate = /* @__PURE__ */ new Map();
function cors(origin, env) {
  const allowed = env.ALLOWED_ORIGIN || "";
  const ok = origin && origin === allowed;
  return { "access-control-allow-origin": ok ? origin : allowed, "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600", vary: "Origin" };
}
__name(cors, "cors");
function json(data, status, origin, env) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "content-type": "application/json; charset=utf-8", ...cors(origin, env) } });
}
__name(json, "json");
function clean(value, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
__name(clean, "clean");
function validSubscription(s) {
  return s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length <= 2048 && s.keys && typeof s.keys.p256dh === "string" && s.keys.p256dh.length <= 256 && typeof s.keys.auth === "string" && s.keys.auth.length <= 256;
}
__name(validSubscription, "validSubscription");
function validRoute(it) {
  return it && ["KMB", "CTB", "GMB"].includes(it.co) && /^[A-Za-z0-9-]{1,24}$/.test(clean(it.route, 24)) && Number.isFinite(Number(it.seq ?? it.route_seq)) && (it.co !== "GMB" || clean(it.route_id, 80) && clean(it.route_seq, 40));
}
__name(validRoute, "validRoute");
function normalRoute(it) {
  return { co: it.co, route: clean(it.route, 24), dir: clean(it.dir, 20), bound: clean(it.bound, 20), service_type: clean(it.service_type, 20), stopId: clean(it.stopId, 80), seq: Number(it.seq), route_id: clean(it.route_id, 80), route_seq: clean(it.route_seq, 40), dest: clean(it.dest, 120), stopName: clean(it.stopName, 160), lead: Math.min(10, Math.max(0, Number.isFinite(Number(it.lead)) ? Number(it.lead) : LEAD_DEFAULT)), session: clean(it.session, 100) };
}
__name(normalRoute, "normalRoute");
function allow(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const now = Date.now();
  const item = rate.get(ip) || { n: 0, at: now };
  if (now - item.at > 6e4) {
    item.n = 0;
    item.at = now;
  }
  item.n++;
  rate.set(ip, item);
  return item.n <= Number(env.RATE_LIMIT_PER_MINUTE || 30);
}
__name(allow, "allow");
async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("API " + r.status);
  return r.json();
}
__name(getJSON, "getJSON");
function etaUrl(it) {
  if (it.co === "KMB") return API.KMB + "/route-eta/" + encodeURIComponent(it.route) + "/" + encodeURIComponent(it.service_type || "1");
  if (it.co === "CTB") return API.CTB + "/eta/CTB/" + encodeURIComponent(it.stopId) + "/" + encodeURIComponent(it.route);
  return API.GMB + "/route-stop/" + encodeURIComponent(it.route_id) + "/" + encodeURIComponent(it.route_seq) + "/" + encodeURIComponent(it.seq);
}
__name(etaUrl, "etaUrl");
function parseETAs(it, payload) {
  const data = payload?.data;
  if (it.co === "KMB") return (data || []).filter((e) => Number(e.seq) === Number(it.seq) && e.dir === it.dir && e.eta).map((e) => ({ iso: e.eta, rmk: e.rmk_tc || "" }));
  if (it.co === "CTB") return (data || []).filter((e) => e.eta && (!it.dir || e.dir === it.dir) && String(e.stop || e.stop_id || it.stopId) === String(it.stopId)).map((e) => ({ iso: e.eta, rmk: e.rmk_tc || "" }));
  const rows = Array.isArray(data) ? data[0]?.eta || [] : data?.eta || [];
  return rows.filter((e) => e.timestamp).map((e) => ({ iso: e.timestamp, rmk: e.remarks_tc || "" }));
}
__name(parseETAs, "parseETAs");
function dueETA(etas, now = Date.now(), lead = LEAD_DEFAULT, lateFloor = -30) {
  return etas.map((e) => ({ ...e, at: Date.parse(e.iso), min: Math.round((Date.parse(e.iso) - now) / 6e4) })).filter((e) => Number.isFinite(e.at) && e.min >= lateFloor && e.min <= lead).sort((a, b) => a.at - b.at)[0] || null;
}
__name(dueETA, "dueETA");
function tripKey(it, eta) {
  return [it.co, it.route, it.bound, it.dir, it.service_type, it.route_id, it.route_seq, it.stopId, it.seq, eta.at].join(":");
}
__name(tripKey, "tripKey");
async function getRoutes(env, endpoint) {
  const result = await env.DB.prepare("SELECT co, route, dir, bound, service_type, stop_id AS stopId, seq, route_id AS route_id, route_seq, dest, stop_name AS stopName, lead, session FROM watches WHERE endpoint = ? AND active = 1 ORDER BY id LIMIT ?").bind(endpoint, MAX_ROUTES).all();
  return result.results || [];
}
__name(getRoutes, "getRoutes");
async function deleteSubscription(env, endpoint) {
  await env.DB.batch([env.DB.prepare("DELETE FROM watches WHERE endpoint = ?").bind(endpoint), env.DB.prepare("DELETE FROM subscriptions WHERE endpoint = ?").bind(endpoint)]);
}
__name(deleteSubscription, "deleteSubscription");
async function upsertSubscription(env, sub, routes) {
  await env.DB.prepare("INSERT INTO subscriptions(endpoint, expiration_time, p256dh, auth, updated_at) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET expiration_time=excluded.expiration_time,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at").bind(sub.endpoint, sub.expirationTime ?? null, sub.keys.p256dh, sub.keys.auth, Date.now()).run();
  await env.DB.prepare("DELETE FROM watches WHERE endpoint = ?").bind(sub.endpoint).run();
  for (const r of routes) await env.DB.prepare("INSERT INTO watches(endpoint, co, route, dir, bound, service_type, stop_id, seq, route_id, route_seq, dest, stop_name, lead, session, active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)").bind(sub.endpoint, r.co, r.route, r.dir, r.bound, r.service_type, r.stopId, r.seq, r.route_id, r.route_seq, r.dest, r.stopName, r.lead, r.session).run();
}
__name(upsertSubscription, "upsertSubscription");
async function sendPush(env, sub, body, tag) {
  const payload = await buildPushPayload({ data: { title: "\u5DF4\u58EB\u5C31\u569F\u5230\u7AD9", body, tag, badgeNumber: 1, silent: false } }, { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY });
  return fetch(sub.endpoint, payload);
}
__name(sendPush, "sendPush");
async function checkWatch(env, sub, it) {
  const payload = await getJSON(etaUrl(it));
  const eta = dueETA(parseETAs(it, payload), Date.now(), it.lead);
  if (!eta) return;
  const trip = tripKey(it, eta);
  const exists = await env.DB.prepare("SELECT 1 FROM deliveries WHERE endpoint = ? AND trip_key = ?").bind(sub.endpoint, trip).first();
  if (exists) return;
  const response = await sendPush(env, sub, it.route + " \u5F80 " + it.dest + "\uFF0C\u7D04 " + Math.max(0, eta.min) + " \u5206\u9418\u5230 " + it.stopName, "buspulse-" + encodeURIComponent(trip));
  if (response.status === 404 || response.status === 410) {
    await deleteSubscription(env, sub.endpoint);
    return;
  }
  if (!response.ok) throw new Error("push " + response.status);
  await env.DB.prepare("INSERT OR IGNORE INTO deliveries(endpoint, trip_key, sent_at) VALUES(?,?,?)").bind(sub.endpoint, trip, Date.now()).run();
}
__name(checkWatch, "checkWatch");
async function runCron(env) {
  const rows = await env.DB.prepare("SELECT endpoint, expiration_time, p256dh, auth FROM subscriptions LIMIT 5000").all();
  let checked = 0, failed = 0;
  for (const sub of rows.results || []) {
    const watches = await getRoutes(env, sub.endpoint);
    for (const it of watches) {
      checked++;
      try {
        await checkWatch(env, sub, it);
      } catch {
        failed++;
      }
    }
  }
  return { checked, failed };
}
__name(runCron, "runCron");
var index_default = { async fetch(request, env) {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin, env) });
  const url = new URL(request.url);
  if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, push: "web-push", storage: "d1", cron: "every minute" }, 200, origin, env);
  if (url.pathname === "/vapid-public-key" && request.method === "GET") return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, origin, env);
  if (url.pathname !== "/subscribe" || !["POST", "DELETE"].includes(request.method)) return json({ error: "not found" }, 404, origin, env);
  if (!allow(request, env)) return json({ error: "rate limit" }, 429, origin, env);
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return json({ error: "request too large" }, 413, origin, env);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400, origin, env);
  }
  if (request.method === "DELETE") {
    if (!validSubscription(body)) return json({ error: "invalid subscription" }, 400, origin, env);
    await deleteSubscription(env, body.endpoint);
    return json({ ok: true }, 200, origin, env);
  }
  if (!validSubscription(body.subscription) || !Array.isArray(body.routes) || body.routes.length < 1 || body.routes.length > MAX_ROUTES || body.routes.some((r) => !validRoute(r))) return json({ error: "invalid subscription or routes" }, 400, origin, env);
  const routes = body.routes.map(normalRoute);
  await upsertSubscription(env, { endpoint: body.subscription.endpoint, expirationTime: body.subscription.expirationTime, keys: body.subscription.keys }, routes);
  return json({ ok: true, registeredRoutes: routes.length }, 201, origin, env);
}, async scheduled(_event, env, ctx) {
  ctx.waitUntil(runCron(env));
} };
export {
  API,
  index_default as default,
  dueETA,
  parseETAs,
  runCron
};
//# sourceMappingURL=index.js.map
