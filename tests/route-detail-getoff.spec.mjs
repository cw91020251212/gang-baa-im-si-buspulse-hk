import { test, expect } from '@playwright/test';

const item = {
  co: 'KMB', route: '74X', bound: 'outbound', dir: 'O', service_type: '1',
  seq: 1, stopId: 's1', stopName: '第一站', origin: '起點', dest: '終點'
};
const routeId = 'KMB|74X|O|s1';
// Deliberately sparse: destination logic must compare ordered stops, not seq +/- 1.
const stops = [
  { seq: 1, stop: 's1', name_tc: '第一站', name_en: 'FIRST', lat: '22.3000', long: '114.2000' },
  { seq: 4, stop: 's4', name_tc: '第四站', name_en: 'FOURTH', lat: '22.3040', long: '114.2000' },
  { seq: 9, stop: 's9', name_tc: '第九站', name_en: 'NINTH', lat: '22.3070', long: '114.2000' }
];

test.use({ serviceWorkers: 'block' });

async function prepare(page, { permission = 'granted', enabled = true, native = false } = {}) {
  await page.clock.install({ time: new Date('2026-10-20T00:00:00Z') });
  await page.addInitScript(({ item, permission, enabled, native }) => {
    localStorage.clear();
    localStorage.setItem('buspulse.first-use-tour.v1', '1');
    localStorage.setItem('busboard.items.v1', JSON.stringify([item]));
    localStorage.setItem('busboard.user-defaults.v1', '[]');
    localStorage.setItem('busboard.preferences.v1', JSON.stringify({ notificationsEnabled: enabled }));

    window.pageErrors = [];
    window.addEventListener('error', e => window.pageErrors.push(e.message));
    window.geoWatches = new Map();
    window.geoCleared = [];
    window.geoNext = 0;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition(ok, error) {
          const watchId = ++window.geoNext;
          window.geoWatches.set(watchId, { ok, error });
          return watchId;
        },
        clearWatch(watchId) {
          window.geoCleared.push(watchId);
          window.geoWatches.delete(watchId);
        }
      }
    });

    window.sentNotifications = [];
    window.permissionRequests = 0;
    class FakeNotification {
      static permission = permission;
      static requestPermission() {
        window.permissionRequests++;
        FakeNotification.permission = 'granted';
        return Promise.resolve('granted');
      }
      constructor(title, options) { window.sentNotifications.push({ title, options }); }
      close() { window.closedNotifications = (window.closedNotifications || 0) + 1; }
    }
    window.Notification = FakeNotification;

    window.nativeCalls = [];
    if (native) {
      window.hasAndroidAlarmBridge = true;
      window.androidAlarmRequest = async (action, payload) => {
        window.nativeCalls.push({ action, payload });
        return action === 'requestPermission'
          ? { notificationsGranted: true, notificationState: 'granted' }
          : { sent: true };
      };
    }

    window.emitPosition = (latitude, longitude = 114.2) => {
      const position = {
        coords: { latitude, longitude, accuracy: 10, speed: null },
        timestamp: Date.now()
      };
      [...window.geoWatches.values()].forEach(watch => watch.ok(position));
    };
    window.failPosition = () => {
      [...window.geoWatches.values()].forEach(watch => watch.error({ code: 1, message: 'permission denied' }));
    };
  }, { item, permission, enabled, native });

  await page.route('**/v1/transport/kmb/route-stop/**', route =>
    route.fulfill({ json: { data: stops.map(({ seq, stop }) => ({ seq, stop })) } }));
  await page.route('**/v1/transport/kmb/stop', route =>
    route.fulfill({ json: { data: stops } }));
  await page.route('**/v1/transport/kmb/route-eta/**', route =>
    route.fulfill({ json: { data: [] } }));
  await page.route('**/search.kmb.hk/**', route => route.fulfill({ json: { result: false } }));
  await page.route('**/raw.githubusercontent.com/**', route =>
    route.fulfill({ status: 404, body: 'fixture has no official geometry' }));

  await page.goto('./?smoke=route-detail-getoff', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-detail-id]').click();
  await expect(page.locator('.stop-row')).toHaveCount(3);
  await expect(page.locator('[data-detail-getoff-open]')).toHaveText('設下車站');
  await expect(page.locator('#getoffPicker')).not.toBeVisible();
}

async function saved(page) {
  return page.evaluate(id => JSON.parse(localStorage.getItem('busboard.getoff.v1') || '{}')[id], routeId);
}

async function pick(page, seq, opener = '[data-detail-getoff-open]') {
  await page.locator(opener).click();
  await expect(page.locator('#getoffPicker')).toBeVisible();
  await page.locator(`[data-getoff-pick="${seq}"]`).click();
  await expect(page.locator('[data-getoff-confirm]')).toBeEnabled();
}

async function confirmPick(page) {
  await page.locator('[data-getoff-confirm]').click();
  await expect(page.locator('#getoffPicker')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => geoWatches.size)).toBe(1);
}

async function startGetoff(page, seq = '9') {
  await pick(page, seq);
  await confirmPick(page);
}

async function reachPreviousStop(page) {
  // Seq 4 is the ordered stop immediately before target seq 9, despite the gap.
  await page.evaluate(() => emitPosition(22.3000));
  await page.clock.fastForward(60_000);
  await page.evaluate(() => emitPosition(22.3040));
}

async function state(page) {
  return page.evaluate(() => ({
    count: sentNotifications.length,
    notifications: sentNotifications,
    requests: permissionRequests,
    watches: geoWatches.size,
    nativeCalls
  }));
}

test('selecting a sparse-sequence destination is passive until confirmation; marker stays in the timeline', async ({ page }) => {
  await prepare(page);
  await pick(page, '4');
  await expect(page.locator('[data-getoff-choice]')).toContainText('第 4 站 · 第四站');
  expect(await saved(page)).toBeUndefined();
  expect(await page.evaluate(() => geoWatches.size)).toBe(0);

  await confirmPick(page);
  await expect(page.locator('.detail-getoff-status strong')).toHaveText('下車站：第四站');
  expect((await saved(page)).targetSeq).toBe(4);
  await page.evaluate(() => emitPosition(22.3000));
  await expect(page.locator('.stop-timeline [data-trip-marker]')).toHaveCount(1);
  await expect(page.locator('[data-trip-marker]')).toHaveCount(1);
  await expect(page.locator('.stop-timeline [data-detail-stop]')).toHaveCount(3);
});

test('ordinary stop taps browse ETA and never change the active get-off target', async ({ page }) => {
  await prepare(page);
  await startGetoff(page, '9');
  await page.locator('[data-detail-stop="4"]').click();
  await expect(page.locator('.detail-current-name')).toContainText('第四站');
  await expect(page.locator('.detail-getoff-status strong')).toHaveText('下車站：第九站');
  expect((await saved(page)).targetSeq).toBe(9);
  expect(await page.evaluate(() => geoWatches.size)).toBe(1);
});

test('default permission requests once; one ordered approach alert survives closing and reopening detail', async ({ page }) => {
  await prepare(page, { permission: 'default' });
  await startGetoff(page, '9');
  await expect.poll(() => page.evaluate(() => permissionRequests)).toBe(1);
  await reachPreviousStop(page);
  await expect(page.locator('.detail-getoff-status small')).toHaveText('準備下車');
  await expect.poll(() => page.evaluate(() => sentNotifications.length)).toBe(1);

  const first = await state(page);
  expect(first.notifications[0].title).toBe('準備下車');
  expect(first.notifications[0].options).toMatchObject({
    silent: false, body: expect.stringContaining('第九站')
  });
  expect(first.requests).toBe(1);

  await page.locator('#routeDetailBack').click();
  await expect(page.locator('#routeDetail')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => geoWatches.size)).toBe(1);
  await page.locator('[data-detail-id]').click();
  await expect(page.locator('.detail-getoff-status strong')).toHaveText('下車站：第九站');
  await expect(page.locator('.detail-getoff-status small')).toHaveText('準備下車');
  await page.evaluate(() => { emitPosition(22.3040); emitPosition(22.3040); });
  expect(await state(page)).toMatchObject({ count: 1, requests: 1, watches: 1 });
  expect((await saved(page))).toMatchObject({ targetSeq: 9, alerted: true, orderedJourney: true });
});

test('granted permission does not prompt and the system alert is silent:false and single-shot', async ({ page }) => {
  await prepare(page, { permission: 'granted' });
  await startGetoff(page);
  expect((await state(page)).requests).toBe(0);
  await reachPreviousStop(page);
  await expect.poll(() => page.evaluate(() => sentNotifications.length)).toBe(1);
  await page.evaluate(() => { emitPosition(22.3040); emitPosition(22.3040); });
  const result = await state(page);
  expect(result.count).toBe(1);
  expect(result.notifications[0].options.silent).toBe(false);
  expect(result.notifications[0].options).not.toHaveProperty('sound');
  expect(result.notifications[0].options).not.toHaveProperty('vibrate');
  expect(result.requests).toBe(0);
});

test('denied notification permission leaves journey tracking active without a notification', async ({ page }) => {
  await prepare(page, { permission: 'denied' });
  await startGetoff(page);
  await reachPreviousStop(page);
  await expect(page.locator('.detail-getoff-status small')).toHaveText('準備下車');
  expect(await page.evaluate(() => ({ count: sentNotifications.length, requests: permissionRequests, watches: geoWatches.size })))
    .toEqual({ count: 0, requests: 0, watches: 1 });
});

test('global notifications-off suppresses permission requests and delivery', async ({ page }) => {
  await prepare(page, { permission: 'default', enabled: false });
  await startGetoff(page);
  await reachPreviousStop(page);
  expect(await page.evaluate(() => ({ count: sentNotifications.length, requests: permissionRequests, watches: geoWatches.size })))
    .toEqual({ count: 0, requests: 0, watches: 1 });
});

test('native bridge delivers one notifyNow request instead of a web notification', async ({ page }) => {
  await prepare(page, { permission: 'granted', native: true });
  await startGetoff(page);
  await reachPreviousStop(page);
  await expect.poll(() => page.evaluate(() => nativeCalls.filter(call => call.action === 'notifyNow').length)).toBe(1);
  await page.evaluate(() => { emitPosition(22.3040); emitPosition(22.3040); });
  const result = await state(page);
  expect(result.count).toBe(0);
  expect(result.nativeCalls.filter(call => call.action === 'requestPermission')).toHaveLength(1);
  const notifyCall = result.nativeCalls.find(call => call.action === 'notifyNow');
  expect(notifyCall.payload).toMatchObject({ title: '準備下車', routeId, body: expect.stringContaining('第九站') });
  expect(result.nativeCalls.filter(call => call.action === 'notifyNow')).toHaveLength(1);
});

test('GPS errors are shown; cancelling the reminder clears its watch and saved state', async ({ page }) => {
  await prepare(page);
  await startGetoff(page);
  await page.evaluate(() => failPosition());
  await expect(page.locator('.detail-getoff-status small')).toContainText('暫時未能定位');
  expect(await page.evaluate(() => geoWatches.size)).toBe(1);

  const watchId = await page.evaluate(() => [...geoWatches.keys()][0]);
  await page.locator('[data-detail-getoff-cancel]').click();
  await expect(page.locator('[data-detail-getoff-open]')).toBeVisible();
  expect(await page.evaluate(() => ({ watches: geoWatches.size, cleared: geoCleared })))
    .toEqual({ watches: 0, cleared: [watchId] });
  expect(await saved(page)).toBeUndefined();
});

test('changing an active destination is only a draft until confirmed; dismissing it preserves the reminder', async ({ page }) => {
  await prepare(page);
  await startGetoff(page, '9');
  const before = await saved(page);

  await pick(page, '4', '[data-detail-getoff-change]');
  expect(await saved(page)).toEqual(before);
  expect(await page.evaluate(() => geoWatches.size)).toBe(1);
  await page.locator('[data-getoff-picker-close]').click();
  await expect(page.locator('#getoffPicker')).not.toBeVisible();
  await expect(page.locator('.detail-getoff-status strong')).toHaveText('下車站：第九站');
  expect(await saved(page)).toEqual(before);
  expect(await page.evaluate(() => geoWatches.size)).toBe(1);
});
