import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function transparentPngTile(size = 256) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(size * (1 + size * 4));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
const LABEL_TILE_PNG = transparentPngTile();
const varint = (n) => {
  const bytes = [];
  while (n > 127) { bytes.push((n & 127) | 128); n >>>= 7; }
  bytes.push(n);
  return Buffer.from(bytes);
};
const bytesField = (tag, data) => Buffer.concat([varint((tag << 3) | 2), varint(data.length), data]);
const pointGeometry = Buffer.from([0x09, 0x80, 0x20, 0x80, 0x20]);
const mvtFeature = Buffer.concat([Buffer.from([0x18, 0x01]), bytesField(4, pointGeometry)]);
const mvtLayer = Buffer.concat([
  bytesField(1, Buffer.from('0_MTR_POINT_10K:3')),
  bytesField(2, mvtFeature),
  Buffer.from([0x78, 0x02, 0x28, 0x80, 0x20])
]);
const VECTOR_TILE = bytesField(3, mvtLayer);
const MAP_API = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0';
const FIXTURE_STYLE = {
  version: 8,
  glyphs: `${MAP_API}/vt/basemap/WGS84/resources/fonts/{fontstack}/{range}.pbf`,
  sources: {
    esri: {
      type: 'vector',
      tiles: [`${MAP_API}/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf`],
      minzoom: 8,
      maxzoom: 20
    }
  },
  layers: [
    { id: 'fixture-background', type: 'background', paint: { 'background-color': '#f4f4f0' } },
    {
      id: 'fixture-mtr-point', type: 'circle', source: 'esri', 'source-layer': '0_MTR_POINT_10K:3',
      paint: { 'circle-radius': 4, 'circle-color': '#538679', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 }
    }
  ]
};

async function openMainPage(page, { failStyle = false } = {}) {
  const mapRequests = [];
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('https://mapapi.geodata.gov.hk/')) {
      mapRequests.push(url);
      if (url.endsWith('/resources/styles/root.json')) {
        return route.fulfill({
          status: failStyle ? 503 : 200,
          contentType: 'application/json',
          body: failStyle ? '{"error":"test outage"}' : JSON.stringify(FIXTURE_STYLE),
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }
      if (url.endsWith('.pbf')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.mapbox-vector-tile',
          body: VECTOR_TILE,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }
      if (url.includes('/xyz/label/hk/tc/WGS84/') && url.endsWith('.png')) {
        return route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: LABEL_TILE_PNG,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }
      return route.fulfill({ status: 404, body: '' });
    }
    if (/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.includes('unpkg.com') || url.startsWith('http://127.0.0.1:4179/')) return route.continue();
    if (url.startsWith('http://') || url.startsWith('https://')) return route.abort();
    return route.continue();
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.BusPulseLandsDMap && typeof window.addRouteMapTiles === 'function')).toBe(true);
  await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'landsd-main-map-test';
    container.style.cssText = 'position:fixed;left:0;bottom:0;width:360px;height:280px;z-index:99999';
    document.body.appendChild(container);
    const map = window.__landsdTestMap = L.map(container, { attributionControl: true, zoomControl: false }).setView([22.3, 114.17], 13);
    window.__landsdTestRoute = L.polyline([[22.28, 114.1], [22.3, 114.17], [22.32, 114.22]], { color: '#e52635', weight: 3 }).addTo(map);
    window.__landsdTestStop = L.circleMarker([22.3, 114.17], { color: '#07583d', fillColor: '#36e0a0', fillOpacity: 1, radius: 7 }).addTo(map);
    window.__landsdTestBus = L.marker([22.31, 114.19], { icon: L.divIcon({ className: 'test-bus', html: '<span>307</span>', iconSize: [24, 24] }) }).addTo(map);
    window.__landsdTestLoad = addRouteMapTiles(map);
  });
  return mapRequests;
}

async function waitForLandsD(page) {
  await page.waitForFunction(() => {
    const state = window.BusPulseLandsDMap?.getState(window.__landsdTestMap);
    return state?.ready === true && !!state.glLayer && !!state.glMap;
  }, null, { timeout: 70_000 });
}

test('main Leaflet maps render LandsD vectors/TC labels without disturbing bus overlays', async ({ page }) => {
  test.setTimeout(90_000);
  const mapRequests = await openMainPage(page);
  await waitForLandsD(page);

  await expect(page.locator('#landsd-main-map-test .leaflet-gl-layer canvas')).toBeVisible();
  await expect(page.locator('#landsd-main-map-test .landsd-leaflet-credit')).toContainText('Map from Lands Department');
  await expect(page.locator('#landsd-main-map-test .leaflet-control-attribution')).toContainText('Map from Lands Department');
  await expect(page.locator('#landsd-main-map-test .leaflet-overlay-pane path')).toHaveCount(2);
  await expect(page.locator('#landsd-main-map-test .leaflet-marker-pane .leaflet-marker-icon')).toHaveCount(1);
  const logoLoads = await page.locator('#landsd-main-map-test .landsd-leaflet-credit img').evaluate(img => img.complete && img.naturalWidth > 0);
  expect(logoLoads).toBe(true);
  expect(mapRequests.some(url => url.endsWith('/resources/styles/root.json'))).toBe(true);
  expect(mapRequests.some(url => /\/vt\/basemap\/WGS84\/tile\/\d+\/\d+\/\d+\.pbf$/.test(url))).toBe(true);
  expect(mapRequests.some(url => /\/xyz\/label\/hk\/tc\/WGS84\/\d+\/\d+\/\d+\.png$/.test(url))).toBe(true);

  await page.evaluate(() => window.BusPulseLandsDMap.suspend(window.__landsdTestMap));
  await expect(page.locator('#landsd-main-map-test .leaflet-gl-layer canvas')).toHaveCount(0);
  const overlaysRemain = await page.evaluate(() => [
    window.__landsdTestMap.hasLayer(window.__landsdTestRoute),
    window.__landsdTestMap.hasLayer(window.__landsdTestStop),
    window.__landsdTestMap.hasLayer(window.__landsdTestBus)
  ]);
  expect(overlaysRemain).toEqual([true, true, true]);

  await page.evaluate(() => window.BusPulseLandsDMap.resume(window.__landsdTestMap));
  await waitForLandsD(page);
  await expect(page.locator('#landsd-main-map-test .leaflet-gl-layer canvas')).toBeVisible();
  await expect(page.locator('#landsd-main-map-test .landsd-leaflet-credit')).toHaveCount(1);
  await page.evaluate(() => window.__landsdTestMap.remove());
});

test('main Leaflet maps fall back to attributed OSM when the LandsD style is unavailable', async ({ page }) => {
  test.setTimeout(60_000);
  await openMainPage(page, { failStyle: true });
  await page.waitForFunction(() => {
    const state = window.BusPulseLandsDMap?.getState(window.__landsdTestMap);
    return !!state?.fallbackLayer && !!state.error;
  }, null, { timeout: 20_000 });
  await expect.poll(() => page.locator('#landsd-main-map-test .leaflet-tile-pane .leaflet-tile').count()).toBeGreaterThan(0);
  await expect(page.locator('#landsd-main-map-test .leaflet-control-attribution')).toContainText('OpenStreetMap contributors');
  await expect(page.locator('#landsd-main-map-test .landsd-leaflet-credit')).toHaveCount(0);
  const overlaysRemain = await page.evaluate(() => [
    window.__landsdTestMap.hasLayer(window.__landsdTestRoute),
    window.__landsdTestMap.hasLayer(window.__landsdTestStop),
    window.__landsdTestMap.hasLayer(window.__landsdTestBus)
  ]);
  expect(overlaysRemain).toEqual([true, true, true]);
  await page.evaluate(() => window.__landsdTestMap.remove());
});

test('main Leaflet adapter renders the official live LandsD map (@live)', async ({ page }) => {
  test.skip(process.env.BUSPULSE_LIVE_LANDSD !== '1', 'Enable explicitly to make real, rate-limited LandsD requests.');
  test.setTimeout(90_000);
  const serviceRequests = new Set();
  page.on('requestfinished', request => {
    if (request.url().includes('mapapi.geodata.gov.hk')) serviceRequests.add(request.url().split('?')[0]);
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  const configuredBase = process.env.BUSPULSE_BASE_URL;
  const livePageURL = configuredBase
    ? new URL('index.html', configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`).href
    : '/index.html';
  await page.goto(livePageURL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'landsd-main-map-test';
    container.style.cssText = 'position:fixed;right:12px;bottom:12px;width:700px;height:520px;z-index:99999';
    document.body.appendChild(container);
    window.__landsdTestMap = L.map(container, { attributionControl: true, zoomControl: false }).setView([22.2819, 114.1585], 14);
    addRouteMapTiles(window.__landsdTestMap);
  });
  await waitForLandsD(page);
  await expect(page.locator('#landsd-main-map-test .landsd-leaflet-credit')).toContainText('Map from Lands Department');
  const logoLoads = await page.locator('#landsd-main-map-test .landsd-leaflet-credit img').evaluate(img => img.complete && img.naturalWidth > 0);
  expect(logoLoads).toBe(true);
  expect([...serviceRequests].some(url => url.endsWith('/resources/styles/root.json'))).toBe(true);
  expect([...serviceRequests].some(url => /\/vt\/basemap\/WGS84\/tile\/\d+\/\d+\/\d+\.pbf$/.test(url))).toBe(true);
  expect([...serviceRequests].some(url => /\/xyz\/label\/hk\/tc\/WGS84\/\d+\/\d+\/\d+\.png$/.test(url))).toBe(true);
  if (process.env.BUSPULSE_LANDSD_MAIN_SCREENSHOT) await page.locator('#landsd-main-map-test').screenshot({ path: process.env.BUSPULSE_LANDSD_MAIN_SCREENSHOT });
  await page.evaluate(() => window.__landsdTestMap.remove());
});
