import { test, expect } from '@playwright/test';

const epoch = Date.parse('2026-10-20T00:00:00Z');
const item = { co:'KMB', route:'74X', bound:'outbound', dir:'O', service_type:'1', seq:1, stopId:'s1', stopName:'第一站', origin:'起點', dest:'第三站' };
test.use({ serviceWorkers:'block' });

async function prepare(page, { withEta = true } = {}) {
  await page.clock.install({ time:new Date(epoch) });
  await page.addInitScript(item => {
    localStorage.clear();
    localStorage.setItem('buspulse.first-use-tour.v1', '1');
    localStorage.setItem('busboard.items.v1', JSON.stringify([item]));
    localStorage.setItem('busboard.user-defaults.v1', '[]');
    window.markerErrors = [];
    addEventListener('error', e => markerErrors.push(e.message));
    window.markerWatches = new Map();
    window.markerWatchId = 0;
    Object.defineProperty(navigator, 'geolocation', { configurable:true, value:{
      watchPosition(ok, error) { const id = ++markerWatchId; markerWatches.set(id, {ok,error}); return id; },
      clearWatch(id) { markerWatches.delete(id); }
    }});
    window.emitMarkerGps = latitude => [...markerWatches.values()].forEach(w => w.ok({ coords:{latitude,longitude:114.2,accuracy:10,speed:null},timestamp:Date.now() }));
    window.markerNotifications = [];
    window.Notification = class {
      static permission = 'granted';
      constructor(title, options) { markerNotifications.push({title,options}); }
      close() {}
    };
  }, item);
  await page.route('**/v1/transport/kmb/route-stop/**', r => r.fulfill({json:{data:[1,2,3].map(seq => ({seq,stop:'s'+seq}))}}));
  await page.route('**/v1/transport/kmb/stop', r => r.fulfill({json:{data:[22.300,22.304,22.307].map((lat,i) => ({stop:'s'+(i+1),name_tc:['第一站','第二站','第三站'][i],name_en:'STOP '+(i+1),lat:String(lat),long:'114.2'}))}}));
  await page.route('**/v1/transport/kmb/route-eta/**', r => r.fulfill({json:{data:withEta ? [-60,180,420].map((seconds,i) => ({co:'KMB',route:'74X',service_type:1,dir:'O',seq:i+1,eta_seq:1,eta:new Date(epoch+seconds*1000).toISOString(),data_timestamp:new Date(epoch).toISOString(),rmk_tc:''})) : []}}));
  await page.route('**/search.kmb.hk/**', r => r.fulfill({json:{result:false}}));
  await page.route('**/raw.githubusercontent.com/**', r => r.fulfill({status:404,body:''}));
  await page.goto('./?smoke=map-marker-regression', {waitUntil:'domcontentloaded'});
  await page.evaluate(() => {
    // Keep production marker generation/rendering/animation; isolate road-provider availability.
    mapEtaEvidence = async () => null;
    mapRoutePath = async (_it, stops) => stops.slice(0,-1).map((stop,i) => [[stop.lat,stop.lng],[stops[i+1].lat,stops[i+1].lng]]);
    addRouteMapTiles = () => null;
  });
  await page.locator('[data-detail-id]').click();
  await expect(page.locator('.stop-row')).toHaveCount(3);
}
async function openMap(page) {
  await page.locator('[data-detail-map]').click();
  await expect.poll(() => page.evaluate(() => !!routeDetailBody.querySelector('[data-detail-map-wrap]')?._routeGeometry)).toBe(true);
}
async function busPosition(page) {
  return page.evaluate(() => {
    const marker = [...routeDetailBody.querySelector('[data-detail-map-wrap]')._estimatedBusMarkers.values()][0];
    return marker ? {lat:marker.getLatLng().lat,lng:marker.getLatLng().lng} : null;
  });
}
const buses = page => page.locator('.detail-map-panel.open .detail-estimated-bus');
const rider = page => page.locator('.detail-map-panel.open .detail-passenger-bus');

test('ETA route-number marker renders and the production animation moves it along the road', async ({page}) => {
  await prepare(page);
  await openMap(page);
  await expect(buses(page).first()).toBeVisible();
  await expect(buses(page).first().locator('strong')).toHaveText('74X');
  await expect(buses(page).first()).toHaveAttribute('aria-label', /ETA 推算位置.*並非實時/);
  const before = await busPosition(page);
  await page.clock.fastForward(20_000);
  await expect.poll(async () => (await busPosition(page))?.lat).toBeGreaterThan(before.lat);
  const after = await busPosition(page);
  expect(after.lat).toBeLessThan(22.304);
  expect(after.lng).toBeCloseTo(114.2, 6);
  await expect(page.locator('[data-detail-map-bus-legend]')).toContainText('ETA 推算點');
  expect(await page.evaluate(() => markerErrors)).toEqual([]);
});

test('ETA buses and GPS overlay coexist while the simplified timeline and preceding-stop alert remain intact', async ({page}) => {
  await prepare(page);
  await page.locator('[data-detail-getoff-open]').click();
  await page.locator('[data-getoff-pick="3"]').click();
  await page.locator('[data-getoff-confirm]').click();
  await page.evaluate(() => emitMarkerGps(22.300));
  await expect(page.locator('.stop-timeline')).toHaveCount(1);
  await expect(page.locator('[data-trip-marker]')).toHaveCount(1);
  await expect(page.locator('.detail-inference,.summary-buses,.trip-stop-timeline')).toHaveCount(0);
  await openMap(page);
  await expect(buses(page).first()).toBeVisible();
  // Arming an alighting alert starts its own watcher, not the separate map GPS control.
  await page.locator('[data-detail-map-locate]').click();
  await page.evaluate(() => emitMarkerGps(22.300));
  await expect(rider(page)).toBeVisible();
  const activeWatches = await page.evaluate(() => markerWatches.size);
  const before = await busPosition(page);
  await page.clock.fastForward(20_000);
  await page.evaluate(() => emitMarkerGps(22.304));
  await page.clock.runFor(300);
  await expect.poll(() => page.evaluate(() => markerNotifications.length)).toBe(1);
  await expect(rider(page)).toBeVisible();
  await expect(buses(page).first()).toBeVisible();
  await expect.poll(async () => (await busPosition(page))?.lat).toBeGreaterThan(before.lat);
  const gpsLat = await page.evaluate(() => routeDetailBody.querySelector('[data-detail-map-wrap]')._passengerBusMarker.getLatLng().lat);
  expect(gpsLat).toBeCloseTo(22.304, 5);
  await expect(page.locator('[data-detail-map-bus-legend]')).toContainText('GPS 乘搭位置推算');
  await expect(page.locator('[data-detail-map-bus-legend]')).toContainText('ETA 推算點');
  await page.clock.fastForward(20_000);
  await page.evaluate(() => emitMarkerGps(22.307));
  expect(await page.evaluate(() => markerNotifications.length)).toBe(1);
  await page.locator('[data-detail-map-close]').click();
  await expect(page.locator('.stop-timeline')).toHaveCount(1);
  await expect(page.locator('[data-trip-marker]')).toHaveCount(1);
  expect(await page.evaluate(() => markerWatches.size)).toBe(activeWatches);
  await page.locator('[data-detail-gps-stop]').click();
  expect(await page.evaluate(() => markerWatches.size)).toBe(1);
  expect(await page.evaluate(() => markerErrors)).toEqual([]);
});

test('absent ETA does not invent buses or suppress a valid GPS overlay', async ({page}) => {
  await prepare(page, {withEta:false});
  await openMap(page);
  await expect(buses(page)).toHaveCount(0);
  await page.locator('[data-detail-map-locate]').click();
  await page.evaluate(() => emitMarkerGps(22.302));
  await expect(rider(page)).toBeVisible();
  await expect(buses(page)).toHaveCount(0);
  await page.locator('[data-detail-map-locate]').click();
  await expect(rider(page)).toHaveCount(0);
  await expect(buses(page)).toHaveCount(0);
  expect(await page.evaluate(() => markerNotifications.length)).toBe(0);
  expect(await page.evaluate(() => markerErrors)).toEqual([]);
});
