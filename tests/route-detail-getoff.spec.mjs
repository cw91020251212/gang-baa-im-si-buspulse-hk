import { test, expect } from '@playwright/test';

const item = { co:'KMB', route:'74X', bound:'outbound', dir:'O', service_type:'1', seq:1, stopId:'stop-1', stopName:'第一站', origin:'觀塘碼頭', dest:'大埔中心' };
const id = 'KMB|74X|O|stop-1';
test.use({ serviceWorkers:'block' });

async function prepare(page, { permission = 'granted', enabled = true, native = false } = {}) {
  await page.addInitScript(({ item, permission, enabled, native }) => {
    localStorage.clear();
    localStorage.setItem('buspulse.first-use-tour.v1', '1');
    localStorage.setItem('busboard.items.v1', JSON.stringify([item]));
    localStorage.setItem('busboard.user-defaults.v1', '[]');
    localStorage.setItem('busboard.preferences.v1', JSON.stringify({ notificationsEnabled:enabled }));
    window.pageErrors = [];
    window.addEventListener('error', e => window.pageErrors.push(e.message));
    window.geoWatches = new Map(); window.geoCleared = []; window.geoNext = 0;
    Object.defineProperty(navigator, 'geolocation', { configurable:true, value:{
      watchPosition(ok, error) { const n = ++window.geoNext; window.geoWatches.set(n, {ok,error}); return n; },
      clearWatch(n) { window.geoCleared.push(n); window.geoWatches.delete(n); }
    }});
    window.sentNotifications = []; window.permissionRequests = 0;
    class FakeNotification {
      static permission = permission;
      static requestPermission() { window.permissionRequests++; FakeNotification.permission = 'granted'; return Promise.resolve('granted'); }
      constructor(title, options) { window.sentNotifications.push({title,options}); }
      close() { window.closedNotifications = (window.closedNotifications || 0) + 1; }
    }
    window.Notification = FakeNotification;
    window.nativeCalls = [];
    if (native) window.AndroidLocalAlarm = { postMessage(json) {
      const message = JSON.parse(json); window.nativeCalls.push(message);
      if (message.requestId) setTimeout(() => window.dispatchEvent(new CustomEvent('buspulse-native-alarm-result', {detail:{ requestId:message.requestId, notificationsGranted:true, notificationState:'granted', sent:true }})), 0);
    }};
    window.emitPosition = (latitude, longitude) => [...window.geoWatches.values()].forEach(w => w.ok({coords:{latitude,longitude,accuracy:10},timestamp:Date.now()}));
  }, { item, permission, enabled, native });
  await page.route('**/v1/transport/kmb/route-stop/**', r => r.fulfill({json:{data:[{seq:1,stop:'stop-1'},{seq:2,stop:'stop-2'},{seq:3,stop:'stop-3'}]}}));
  await page.route('**/v1/transport/kmb/stop', r => r.fulfill({json:{data:[
    {stop:'stop-1',name_tc:'第一站',name_en:'FIRST',lat:'22.30',long:'114.20'},
    {stop:'stop-2',name_tc:'第二站',name_en:'SECOND',lat:'22.31',long:'114.21'},
    {stop:'stop-3',name_tc:'第三站',name_en:'THIRD',lat:'22.32',long:'114.22'}
  ]}}));
  await page.route('**/v1/transport/kmb/route-eta/**', r => r.fulfill({json:{data:[]}}));
  await page.route('**/search.kmb.hk/**', r => r.fulfill({json:{result:false}}));
  await page.goto('./?smoke=route-detail-getoff', {waitUntil:'domcontentloaded'});
  await page.locator('[data-detail-id]').click();
  await expect(page.locator('.stop-row')).toHaveCount(3);
  await expect(page.locator('[data-detail-getoff-open]')).toHaveText('設下車站');
}
async function saved(page) { return page.evaluate(id => JSON.parse(localStorage.getItem('busboard.getoff.v1') || '{}')[id], id); }
async function pick(page, seq, confirm = true) {
  await page.locator('[data-detail-getoff-open], [data-detail-getoff-change]').click();
  await expect(page.locator('#getoffPicker')).toBeVisible();
  await page.locator(`[data-getoff-pick="${seq}"]`).click();
  if (confirm) await page.locator('[data-getoff-confirm]').click();
}

test('ordinary stop taps only browse ETA and no station row contains a 下車 action', async ({page}) => {
  await prepare(page);
  await page.locator('[data-detail-stop="2"]').click();
  await expect(page.locator('.detail-current-name')).toContainText('第二站');
  expect(await saved(page)).toBeUndefined();
  expect(await page.evaluate(() => geoWatches.size)).toBe(0);
  await expect(page.locator('[data-detail-getoff]')).toHaveCount(0);
  await expect(page.locator('button button')).toHaveCount(0);
});

test('selecting a destination is a draft; only 開始提醒 asks permission and arms GPS', async ({page}) => {
  await prepare(page, {permission:'default'});
  await page.locator('[data-detail-getoff-open]').click();
  await expect(page.locator('[data-getoff-confirm]')).toBeDisabled();
  await expect(page.locator('#getoffPicker')).toHaveAttribute('aria-labelledby','getoffPickerTitle');
  await page.locator('[data-getoff-pick="3"]').click();
  await expect(page.locator('[data-getoff-choice]')).toContainText('確認下車站：第 3 站 · 第三站');
  expect(await saved(page)).toBeUndefined();
  expect(await page.evaluate(() => ({watches:geoWatches.size,permission:permissionRequests}))).toEqual({watches:0,permission:0});
  await page.locator('[data-getoff-confirm]').click();
  await expect(page.locator('#getoffPicker')).not.toBeVisible();
  await expect(page.locator('.detail-getoff-status strong')).toHaveText('下車提醒中：第三站');
  expect((await saved(page)).targetSeq).toBe(3);
  expect(await page.evaluate(() => ({watches:geoWatches.size,permission:permissionRequests}))).toEqual({watches:1,permission:1});
  await expect(page.locator('[data-getoff-id]')).toHaveText('落車中');
});

test('return and Escape discard a draft, leave detailed ETA view open, and restore focus', async ({page}) => {
  await prepare(page);
  await pick(page, 3, false);
  await page.locator('[data-getoff-picker-close]').click();
  expect(await saved(page)).toBeUndefined();
  await expect(page.locator('[data-detail-getoff-open]')).toBeFocused();
  await pick(page, 2, false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#getoffPicker')).not.toBeVisible();
  await expect(page.locator('#routeDetail')).toHaveClass(/on/);
  expect(await saved(page)).toBeUndefined();
  expect(await page.evaluate(() => geoWatches.size)).toBe(0);
  await page.locator('[data-detail-getoff-open]').click();
  await expect(page.locator('[data-getoff-confirm]')).toBeDisabled();
  await expect(page.locator('[data-getoff-pick][aria-pressed="true"]')).toHaveCount(0);
});

test('browsing another stop does not change the confirmed target, including on ETA refresh', async ({page}) => {
  await prepare(page);
  await pick(page, 3);
  await page.locator('[data-detail-stop="2"]').click();
  await expect(page.locator('.detail-current-name')).toContainText('第二站');
  await page.evaluate(() => renderRouteDetail());
  await expect(page.locator('.detail-getoff-status strong')).toHaveText('下車提醒中：第三站');
  await expect(page.locator('.stop-row.is-getoff-target')).toHaveAttribute('data-detail-stop','3');
  expect((await saved(page)).targetSeq).toBe(3);
});

test('changing a target requires confirmation; canceling the edit preserves old reminder and ignores obsolete GPS callbacks', async ({page}) => {
  await prepare(page);
  await pick(page, 3);
  await page.evaluate(() => { window.obsoletePosition = [...geoWatches.values()][0].ok; });
  await pick(page, 2, false);
  expect((await saved(page)).targetSeq).toBe(3);
  await page.evaluate(() => emitPosition(22.30,114.20));
  await expect(page.locator('#getoffPicker')).toBeVisible();
  await expect(page.locator('[data-getoff-choice]')).toContainText('第二站');
  await page.locator('[data-getoff-picker-close]').click();
  expect((await saved(page)).targetSeq).toBe(3);
  await pick(page, 2);
  expect((await saved(page)).targetSeq).toBe(2);
  expect(await page.evaluate(() => geoWatches.size)).toBe(1);
  await page.evaluate(() => obsoletePosition({coords:{latitude:22.31,longitude:114.21}}));
  expect(await page.evaluate(() => sentNotifications.length)).toBe(0);
  await page.locator('[data-detail-getoff-cancel]').click();
  expect(await saved(page)).toBeUndefined();
  expect(await page.evaluate(() => geoWatches.size)).toBe(0);
  await expect(page.locator('[data-detail-getoff-open]')).toBeVisible();
  await expect(page.locator('[data-getoff-id]')).toHaveText('落車');
});

test('previous station flashes both target and status, with one system notification despite GPS bouncing', async ({page}) => {
  await prepare(page);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await pick(page, 3);
  await page.evaluate(() => emitPosition(22.31,114.21));
  await expect(page.locator('[data-detail-stop="3"].is-getoff-alert .stop-content')).toHaveCSS('animation-name','getoffFlash');
  await expect(page.locator('.detail-getoff-status')).toHaveCSS('animation-name','getoffFlash');
  await page.evaluate(() => { emitPosition(22.30,114.20); emitPosition(22.31,114.21); emitPosition(22.32,114.22); });
  expect(await page.evaluate(() => sentNotifications)).toEqual([
    expect.objectContaining({title:'準備下車',options:expect.objectContaining({silent:false,body:'74X 接近下車站：第三站'})})
  ]);
  await page.locator('[data-detail-getoff-cancel]').click();
  await expect(page.locator('.is-getoff-alert')).toHaveCount(0);
  expect(await page.evaluate(() => closedNotifications)).toBe(1);
});

test('jumping directly to the destination alerts but a distant GPS fix never does', async ({page}) => {
  await prepare(page);
  await pick(page, 3);
  await page.evaluate(() => emitPosition(23.31,115.21));
  expect(await page.evaluate(() => sentNotifications.length)).toBe(0);
  await page.evaluate(() => emitPosition(22.32,114.22));
  expect(await page.evaluate(() => sentNotifications.length)).toBe(1);
});

test('denied notifications and GPS errors are explained; later fixes still give a visual reminder', async ({page}) => {
  await prepare(page, {permission:'denied'});
  await pick(page, 2);
  await page.evaluate(() => [...geoWatches.values()][0].error({code:1}));
  await expect(page.locator('.detail-getoff-status')).toContainText('GPS 暫時未能定位');
  await expect(page.locator('.detail-getoff-status')).toContainText('聲音提醒未能啟用');
  await page.evaluate(() => emitPosition(22.31,114.21));
  await expect(page.locator('.detail-getoff-status')).toHaveClass(/is-getoff-alert/);
  expect(await page.evaluate(() => sentNotifications.length)).toBe(0);
  await expect(page.locator('audio')).toHaveCount(0);
});

test('notifications disabled keeps visuals, and reduced motion gives a steady outline', async ({page}) => {
  await prepare(page, {enabled:false});
  await pick(page, 2);
  await page.evaluate(() => emitPosition(22.31,114.21));
  await expect(page.locator('.detail-getoff-status')).toContainText('系統通知已關閉');
  await expect(page.locator('.detail-getoff-status')).toHaveCSS('animation-name','none');
  await expect(page.locator('.detail-getoff-status')).toHaveCSS('outline-style','solid');
  expect(await page.evaluate(() => sentNotifications.length)).toBe(0);
});

test('keyboard can select and confirm independently of ETA browsing', async ({page}) => {
  await prepare(page);
  await page.locator('[data-detail-getoff-open]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-getoff-pick="1"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(page.locator('[data-getoff-pick="2"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-getoff-confirm]').focus();
  await page.keyboard.press('Enter');
  expect((await saved(page)).targetSeq).toBe(2);
  await expect(page.locator('.detail-current-name')).toContainText('第一站');
  await expect(page.locator('[data-detail-getoff-change]')).toBeFocused();
});

test('station without coordinates cannot be chosen and closing detail discards the selection dialog', async ({page}) => {
  await prepare(page);
  await page.evaluate(() => { routeDetailState.stops[1].lat = null; });
  await page.locator('[data-detail-getoff-open]').click();
  await expect(page.locator('[data-getoff-pick="2"]')).toBeDisabled();
  await expect(page.locator('[data-getoff-pick="2"]')).toContainText('暫無定位座標');
  await page.evaluate(() => closeRouteDetail());
  await expect(page.locator('#getoffPicker')).not.toBeVisible();
  expect(await saved(page)).toBeUndefined();
  expect(await page.evaluate(() => pageErrors)).toEqual([]);
});

test('small and large screens keep the independent dialog and controls within viewport', async ({page}) => {
  await prepare(page);
  await page.evaluate(() => { document.body.classList.add('font-large'); routeDetailState.stops = Array.from({length:50}, (_,i) => ({id:'s'+i, seq:i+1, name:'很長的下車站名稱測試 '+(i+1),lat:22.3+i*.001,lng:114.2})); renderRouteDetail(); });
  for (const width of [320,390,768]) {
    await page.setViewportSize({width,height:844});
    await page.locator('[data-detail-getoff-open]').click();
    const layout = await page.locator('#getoffPicker').evaluate(dialog => {
      const r = dialog.getBoundingClientRect(), button=dialog.querySelector('[data-getoff-confirm]').getBoundingClientRect(), list=dialog.querySelector('[data-getoff-picker-list]');
      return {inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,confirmInside:button.left>=r.left&&button.right<=r.right&&button.bottom<=r.bottom,touchHeight:button.height,scrolls:list.scrollHeight>list.clientHeight};
    });
    expect(layout.inside).toBe(true); expect(layout.confirmInside).toBe(true); expect(layout.touchHeight).toBeGreaterThanOrEqual(44); expect(layout.scrolls).toBe(true);
    await page.locator('[data-getoff-pick="50"]').click();
    await expect(page.locator('[data-getoff-choice]')).toContainText('第 50 站');
    await page.locator('[data-getoff-picker-close]').click();
  }
});
