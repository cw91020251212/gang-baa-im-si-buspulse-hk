import { test, expect } from '@playwright/test';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
);
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
      paint: { 'circle-radius': 3, 'circle-color': '#538679', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 }
    }
  ]
};

// Deterministic CI test: exercise both renderers and page controls with local map fixtures.
// The manual live test below separately validates actual public map services.
test('renders synchronized OSM/LandsD maps, attribution and compare controls', async ({ page }) => {
  const vectorTiles = new Set();
  page.on('request', (request) => {
    if (request.url().includes('/vt/basemap/WGS84/tile/') && request.url().endsWith('.pbf')) vectorTiles.add(request.url());
  });
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
    status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG,
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  await page.route('https://mapapi.geodata.gov.hk/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/resources/styles/root.json')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_STYLE), headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.endsWith('.pbf')) {
      return route.fulfill({ status: 200, contentType: 'application/vnd.mapbox-vector-tile', body: VECTOR_TILE, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG, headers: { 'Access-Control-Allow-Origin': '*' } });
  });

  await page.goto('/landsd-map-compare.html');
  await expect(page.getByRole('heading', { name: '同一個香港，兩種底圖' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '目前地圖' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '地政總署矢量圖' })).toBeVisible();
  await expect(page.locator('#osm-map.leaflet-container')).toBeVisible();
  await expect(page.locator('#landsd-map .maplibregl-canvas')).toBeVisible();
  await expect(page.locator('.landsd-mark')).toContainText('Map from Lands Department');
  const logoLoads = await page.locator('.landsd-mark img').evaluate((img) => img.complete && img.naturalWidth > 0);
  expect(logoLoads).toBe(true);
  await expect(page.locator('#landsd-ready')).not.toHaveText('—');
  await expect(page.locator('#landsd-count')).toHaveText(/[1-9]\d* 塊/);

  const centralTileCount = vectorTiles.size;
  await page.getByLabel('選擇共同地圖位置').selectOption('shatin');
  await expect.poll(() => vectorTiles.size).toBeGreaterThan(centralTileCount);
  await expect(page.getByLabel('同步拖曳／縮放')).toBeChecked();
  await page.getByLabel('同步拖曳／縮放').uncheck();
  await expect(page.getByLabel('同步拖曳／縮放')).not.toBeChecked();
  await page.getByRole('button', { name: '重設比較位置' }).click();
});

// Opt-in only: verify official style/PBF requests, browser CORS and actual render readiness.
// CI leaves this skipped to respect the LandsD API's rate-limit notice.
test('renders the official live Hong Kong LandsD vector map and OSM map (@live)', async ({ page }) => {
  test.skip(process.env.BUSPULSE_LIVE_LANDSD !== '1', 'Enable explicitly to make real, rate-limited map requests.');
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  const serviceRequests = new Set();
  page.on('requestfinished', (request) => {
    if (/mapapi\.geodata\.gov\.hk|tile\.openstreetmap\.org/.test(request.url())) serviceRequests.add(request.url().split('?')[0]);
  });

  await page.goto('/landsd-map-compare.html');
  await expect(page.locator('#osm-map.leaflet-container')).toBeVisible();
  await expect(page.locator('#landsd-map .maplibregl-canvas')).toBeVisible();
  await expect(page.locator('#landsd-ready')).not.toHaveText('—', { timeout: 80_000 });
  await expect(page.locator('#osm-ready')).not.toHaveText('—', { timeout: 80_000 });
  await expect(page.locator('#landsd-count')).not.toHaveText('0 塊');
  expect([...serviceRequests].some((url) => url.endsWith('/resources/styles/root.json'))).toBe(true);
  expect([...serviceRequests].some((url) => /\/tile\/\d+\/\d+\/\d+\.pbf$/.test(url))).toBe(true);
  expect([...serviceRequests].some((url) => url.includes('/xyz/label/hk/tc/WGS84/') && url.endsWith('.png'))).toBe(true);
  if (process.env.BUSPULSE_LANDSD_SCREENSHOT) {
    await page.screenshot({ path: process.env.BUSPULSE_LANDSD_SCREENSHOT, fullPage: true });
  }
});
