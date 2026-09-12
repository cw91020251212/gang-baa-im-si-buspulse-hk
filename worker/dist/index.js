var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/uint8array-extras/index.js
var objectToString = Object.prototype.toString;
var uint8ArrayStringified = "[object Uint8Array]";
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
function assertUint8Array(value) {
  if (!isUint8Array(value)) {
    throw new TypeError(`Expected \`Uint8Array\`, got \`${typeof value}\``);
  }
}
__name(assertUint8Array, "assertUint8Array");
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
  totalLength ??= arrays.reduce((accumulator, currentValue) => accumulator + currentValue.length, 0);
  const returnValue = new Uint8Array(totalLength);
  let offset = 0;
  for (const array of arrays) {
    assertUint8Array(array);
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
  assertUint8Array(array);
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
var LEAD_MINUTES = 2;
var MAX_SUBSCRIPTIONS = 5e3;
var INDEX_KEY = "meta:active-subscriptions";
function cors(origin, env) {
  const allowed = env.ALLOWED_ORIGIN || "*";
  return { "access-control-allow-origin": origin === allowed ? origin : allowed, "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-allow-headers": "content-type", vary: "Origin" };
}
__name(cors, "cors");
function json(data, status = 200, origin = "*", env = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...cors(origin, env) } });
}
__name(json, "json");
function keyFor(subscription) {
  return "sub:" + btoa(subscription.endpoint).replaceAll("/", "_").replaceAll("+", "-").replaceAll("=", "");
}
__name(keyFor, "keyFor");
function validSubscription(s) {
  return s && typeof s.endpoint === "string" && s.endpoint.startsWith("https://") && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";
}
__name(validSubscription, "validSubscription");
function validItem(it) {
  return it && ["KMB", "CTB", "GMB"].includes(it.co) && typeof it.route === "string" && typeof it.seq !== "undefined";
}
__name(validItem, "validItem");
async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("API " + r.status);
  return r.json();
}
__name(getJSON, "getJSON");
async function readIndex(env) {
  const value = await env.SUBSCRIPTIONS.get(INDEX_KEY, "json");
  return Array.isArray(value) ? value.filter((k) => typeof k === "string" && k.startsWith("sub:")).slice(0, MAX_SUBSCRIPTIONS) : [];
}
__name(readIndex, "readIndex");
async function writeIndex(env, keys) {
  const unique = [...new Set(keys)].filter((k) => typeof k === "string" && k.startsWith("sub:")).slice(0, MAX_SUBSCRIPTIONS);
  await env.SUBSCRIPTIONS.put(INDEX_KEY, JSON.stringify(unique));
  return unique;
}
__name(writeIndex, "writeIndex");
async function addToIndex(env, key) {
  const keys = await readIndex(env);
  if (!keys.includes(key)) await writeIndex(env, [...keys, key]);
}
__name(addToIndex, "addToIndex");
async function removeFromIndex(env, key) {
  const keys = await readIndex(env);
  if (keys.includes(key)) await writeIndex(env, keys.filter((k) => k !== key));
}
__name(removeFromIndex, "removeFromIndex");
function etaUrl(it) {
  if (it.co === "KMB") return API.KMB + "/route-eta/" + encodeURIComponent(it.route) + "/" + encodeURIComponent(it.service_type);
  if (it.co === "CTB") return API.CTB + "/eta/CTB/" + encodeURIComponent(it.stopId) + "/" + encodeURIComponent(it.route);
  return API.GMB + "/route-stop/" + encodeURIComponent(it.route_id) + "/" + encodeURIComponent(it.route_seq) + "/" + encodeURIComponent(it.seq);
}
__name(etaUrl, "etaUrl");
function parseETAs(it, payload) {
  const data = payload.data;
  if (it.co === "KMB") return (data || []).filter((e) => e.seq === it.seq && e.dir === it.dir && e.eta).map((e) => ({ iso: e.eta, rmk: e.rmk_tc || "" }));
  if (it.co === "CTB") return (data || []).filter((e) => e.eta && e.dir === it.dir).map((e) => ({ iso: e.eta, rmk: e.rmk_tc || "" }));
  const rows = Array.isArray(data) ? data[0]?.eta || [] : data?.eta || [];
  return rows.filter((e) => e.timestamp).map((e) => ({ iso: e.timestamp, rmk: e.remarks_tc || "" }));
}
__name(parseETAs, "parseETAs");
function dueETA(etas, now = Date.now(), lead = LEAD_MINUTES) {
  return etas.map((e) => ({ ...e, at: Date.parse(e.iso), min: Math.round((Date.parse(e.iso) - now) / 6e4) })).filter((e) => Number.isFinite(e.at) && e.min >= -2 && e.min <= lead).sort((a, b) => a.at - b.at)[0] || null;
}
__name(dueETA, "dueETA");
async function notify(sub, body, env, tag) {
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const payload = await buildPushPayload({ data: JSON.stringify({ title: "\u5DF4\u58EB\u5C31\u569F\u5230\u7AD9", body, tag, silent: false }) }, sub, vapid);
  return fetch(sub.endpoint, payload);
}
__name(notify, "notify");
async function checkSubscription(sub, env) {
  const routes = Array.isArray(sub.routes) ? sub.routes.filter(validItem).slice(0, 20) : [];
  for (const it of routes) {
    const result = parseETAs(it, await getJSON(etaUrl(it)));
    const eta = dueETA(result);
    if (!eta) continue;
    const tripKey = it.co + ":" + it.route + ":" + it.seq + ":" + eta.at;
    const sentKey = keyFor(sub) + ":sent:" + tripKey;
    if (await env.SUBSCRIPTIONS.get(sentKey)) continue;
    const response = await notify(sub, it.route + " \u5F80 " + (it.dest || "") + "\uFF0C\u7D04 " + Math.max(0, eta.min) + " \u5206\u9418\u5230 " + (it.stopName || ""), env, "buspulse-" + encodeURIComponent(tripKey));
    if (response.status === 404 || response.status === 410) {
      const key = keyFor(sub);
      await env.SUBSCRIPTIONS.delete(key);
      await removeFromIndex(env, key);
      return;
    }
    if (!response.ok) throw new Error("push " + response.status);
    await env.SUBSCRIPTIONS.put(sentKey, "1", { expirationTtl: 21600 });
  }
}
__name(checkSubscription, "checkSubscription");
async function runCron(env) {
  const keys = await readIndex(env);
  if (!keys.length) return { checked: 0, failed: 0 };
  const results = await Promise.allSettled(keys.map(async (key) => {
    const sub = await env.SUBSCRIPTIONS.get(key, "json");
    if (sub) await checkSubscription(sub, env);
  }));
  return { checked: results.length, failed: results.filter((r) => r.status === "rejected").length };
}
__name(runCron, "runCron");
var index_default = {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin, env) });
    const url = new URL(request.url);
    if (url.pathname === "/vapid-public-key" && request.method === "GET") return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, origin, env);
    if (url.pathname === "/subscribe" && request.method === "POST") {
      const body = await request.json();
      if (!validSubscription(body.subscription) || !Array.isArray(body.routes) || !body.routes.some(validItem)) return json({ error: "invalid subscription or routes" }, 400, origin, env);
      const subscription = { endpoint: body.subscription.endpoint, expirationTime: body.subscription.expirationTime ?? null, keys: body.subscription.keys, routes: body.routes.filter(validItem).slice(0, 20), updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      const key = keyFor(subscription);
      await env.SUBSCRIPTIONS.put(key, JSON.stringify(subscription));
      await addToIndex(env, key);
      return json({ ok: true }, 201, origin, env);
    }
    if (url.pathname === "/subscribe" && request.method === "DELETE") {
      const body = await request.json();
      if (!validSubscription(body)) return json({ error: "invalid subscription" }, 400, origin, env);
      const key = keyFor(body);
      await env.SUBSCRIPTIONS.delete(key);
      await removeFromIndex(env, key);
      return json({ ok: true }, 200, origin, env);
    }
    if (url.pathname === "/health") return json({ ok: true, cron: "disabled until explicitly enabled", kvStrategy: "active-index-no-list" }, 200, origin, env);
    return json({ error: "not found" }, 404, origin, env);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runCron(env));
  }
};
export {
  index_default as default,
  dueETA
};
//# sourceMappingURL=index.js.map
