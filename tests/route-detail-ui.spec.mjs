import { test, expect } from '@playwright/test';

const item = {
  co: 'KMB', route: '74X', bound: 'outbound', dir: 'O', service_type: '1', seq: 1,
  stopId: 'stop-1', stopName: '第一站', origin: '觀塘碼頭', dest: '大埔中心'
};

async function prepare(page) {
  await page.addInitScript(value => {
    localStorage.setItem('busboard.items.v1', JSON.stringify([value]));
    localStorage.setItem('busboard.user-defaults.v1', '[]');
  }, item);
  await page.route('**/v1/transport/kmb/route-stop/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: [
      { seq: 1, stop: 'stop-1' }, { seq: 2, stop: 'stop-2' }, { seq: 3, stop: 'stop-3' }
    ] })
  }));
  await page.route('**/v1/transport/kmb/stop', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: [
      { stop:'stop-1', name_tc:'第一站', name_en:'FIRST STATION', lat:'22.30', long:'114.20' },
      { stop:'stop-2', name_tc:'第二站', name_en:'SECOND STATION', lat:'22.31', long:'114.21' },
      { stop:'stop-3', name_tc:'第三站', name_en:'THIRD STATION', lat:'22.32', long:'114.22' }
    ] })
  }));
  await page.route('**/v1/transport/kmb/route-eta/**', route => {
    const now = Date.now();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: [
        { seq:1, dir:'O', eta:new Date(now + 1*60*1000).toISOString(), eta_seq:1 },
        { seq:1, dir:'O', eta:new Date(now + 15*60*1000).toISOString(), eta_seq:2 },
        { seq:2, dir:'O', eta:new Date(now + 3*60*1000).toISOString(), eta_seq:1 },
        { seq:2, dir:'O', eta:new Date(now + 18*60*1000).toISOString(), eta_seq:2 },
        { seq:3, dir:'O', eta:new Date(now + 30*60*1000).toISOString(), eta_seq:1 }
      ] })
    });
  });
  await page.route('**/search.kmb.hk/KMBWebSite/Function/FunctionRequest.ashx?action=getschedule**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ result:true, data:{ '01': [
      { ServiceType:'01', DayType:'MF', BoundText1:'05:30-06:00', BoundTime1:'15', BoundText2:'05:45-06:15', BoundTime2:'20' },
      { ServiceType:'01', DayType:'MF', BoundText1:'06:00-24:20', BoundTime1:'8-11', BoundText2:'06:15-24:00', BoundTime2:'10-15' }
    ] } })
  }));
  await page.goto('./?smoke=route-detail-ui', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-detail-id]')).toBeVisible();
}

test('opens full-screen timeline and changes selected stop without side effects', async ({ page }) => {
  await prepare(page);
  await page.locator('[data-detail-id]').click();
  await expect(page.locator('#routeDetail')).toHaveClass(/on/);
  await expect(page.locator('#routeDetail')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('.stop-row')).toHaveCount(3);
  await expect(page.locator('.stop-row.is-selected')).toContainText('第一站');
  await page.locator('[data-detail-stop="2"]').click();
  await expect(page.locator('.detail-current-name')).toContainText('第二站');
  await expect(page.locator('.stop-row.is-selected')).toContainText('第二站');
  await expect(page.locator('.detail-status')).toContainText('即時資料');
  await expect(page.locator('.detail-eta strong').first()).toContainText('3');
  await expect(page.locator('.detail-live-dock')).toBeVisible();
  await expect(page.locator('.detail-live-dock')).toHaveCSS('z-index', '3');
  await expect(page.locator('.detail-live-dock .detail-eta')).toHaveCount(3);
  await page.locator('#routeDetail').evaluate(el => { el.style.height = '200px'; el.style.overflow = 'auto'; el.scrollTop = 140; updateRouteDetailCompact(); });
  await expect(page.locator('.detail-live-dock')).toHaveClass(/compact/);
  await expect(page.locator('.detail-live-dock .detail-eta')).toHaveCount(3);
  await expect(page.locator('.detail-live-dock .detail-current')).toBeHidden();
  await expect(page.locator('.detail-live-dock .detail-eta-panel')).toBeVisible();
  await expect(page.locator('.detail-status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#routeDetailOperator')).toHaveText('KMB');
  await expect(page.locator('#routeDetailOperator')).toHaveClass(/KMB/);
  await expect(page.locator('#routeDetailOperator')).toHaveCSS('color', 'rgb(231, 25, 45)');
  await expect(page.locator('.detail-route-icon')).toHaveText('🚌');
  await expect(page.locator('[data-detail-refresh]')).toHaveText('立即更新全部車站 ETA');
  await expect(page.locator('.detail-inference').first()).toContainText('估計位置');
  await expect(page.locator('.detail-eta.near-arrival .near-arrival-dot').first()).toBeVisible();
  const markerCss = (await page.locator('style').allTextContents()).join('\n');
  expect(markerCss).toContain('@keyframes busBounce');
  expect(markerCss).toContain('@keyframes nearArrivalFlash');
  await expect(page.locator('.detail-bus-status')).toContainText('巴士');
  await expect(page.locator('[aria-label="巴士即將到站"]')).toHaveCount(0);
  await expect(page.locator('[aria-label="估計巴士位置"]').first()).toBeVisible();
  await expect(page.locator('.stop-copy small').first()).toContainText('FIRST STATION');
  await expect(page.locator('.stop-copy small').first()).not.toContainText('STOP-');
  await expect(page.locator('.detail-inference').first()).toContainText('估計位置');
  await expect(page.locator('.detail-reverse')).toHaveCSS('position', 'absolute');
  await expect(page.locator('.detail-service')).toContainText('營運時間表及服務資料');
  await expect(page.locator('.detail-service')).toContainText('官方班次、服務更新');
  await expect(page.locator('.detail-service-link')).toHaveAttribute('href', /search\.kmb\.hk/);
  await expect(page.locator('.detail-official-update-link')).toContainText('查看官方最新消息／臨時改道');
  await expect(page.locator('.detail-official-update-link')).toHaveAttribute('href', /search\.kmb\.hk/);
  await expect(page.locator('.detail-frequency-title')).toContainText('官方班次頻率表');
  await expect(page.locator('.detail-frequency-row')).toHaveCount(2);
  await expect(page.locator('.detail-frequency-row').first()).toContainText('15 分鐘／班');
  await expect(page.locator('.detail-schedule-check')).toContainText('班次參考核對');
  await expect(page.locator('.detail-meta')).toContainText('首班車：05:30');
  await expect(page.locator('.detail-meta')).toContainText('尾班車：24:20');
});

test('service accordion keeps a clear, single-line mobile heading', async ({ page }) => {
  await page.setViewportSize({ width:375, height:812 });
  await prepare(page);
  await page.locator('[data-detail-id]').click();
  await expect(page.locator('.detail-service summary')).toBeVisible();
  const hierarchy = await page.locator('.detail-service summary').evaluate(summary => {
    const title = summary.querySelector('.detail-service-title');
    const subtitle = summary.querySelector('small');
    const titleBox = title.getBoundingClientRect();
    const subtitleBox = subtitle.getBoundingClientRect();
    const summaryBox = summary.getBoundingClientRect();
    return {
      title:title.textContent, subtitle:subtitle.textContent,
      titleHeight:titleBox.height,
      subtitleHeight:subtitleBox.height,
      titleTop:titleBox.top, subtitleTop:subtitleBox.top,
      titleRight:titleBox.right, summaryRight:summaryBox.right
    };
  });
  expect(hierarchy).toMatchObject({
    title:'營運時間表及服務資料', subtitle:'官方班次、服務更新'
  });
  expect(hierarchy.titleHeight).toBeLessThan(26);
  expect(hierarchy.titleHeight).toBeGreaterThan(hierarchy.subtitleHeight);
  expect(hierarchy.subtitleTop).toBeGreaterThan(hierarchy.titleTop);
  expect(hierarchy.titleRight).toBeLessThan(hierarchy.summaryRight - 28);
});

test('open service information stays open during detail refreshes', async ({ page }) => {
  await prepare(page);
  await page.locator('[data-detail-id]').click();
  const service = page.locator('.detail-service');
  await expect(service).toBeVisible();
  await service.locator('summary').click();
  await expect(service).toHaveAttribute('open', '');
  await page.evaluate(() => renderRouteDetail());
  await expect(page.locator('.detail-service')).toHaveAttribute('open', '');
  await page.evaluate(() => renderRouteDetail());
  await expect(page.locator('.detail-service')).toHaveAttribute('open', '');
});

test('finds the nearest route stop from the current location before adding a route', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('buspulse.first-use-tour.v1', '1');
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
      configurable:true,
      value:success => success({ coords:{ latitude:22.31002, longitude:114.21002, accuracy:12 } })
    });
  });
  await prepare(page);
  await page.evaluate(route => { openSheet(); viewStops(route); }, {
    co:'KMB', route:'74X', bound:'outbound', dir:'O', service_type:'1',
    origin:'觀塘碼頭', dest:'大埔中心', dirLabel:'觀塘碼頭 → 大埔中心'
  });
  await expect(page.locator('#nearbyStopBtn')).toBeVisible();
  await page.locator('#nearbyStopBtn').click();
  await expect(page.locator('#nearbyStopResult')).toContainText('最近站：第 2 站「第二站」');
  await expect(page.locator('#nearbyStopResult')).toContainText('定位誤差約 12 米');
  await expect(page.locator('[data-s="1"]')).toHaveClass(/nearby-stop/);
  await expect(page.locator('#confirmNearbyStop')).toHaveText('使用呢個站');
});

test('schedule validation compares visible ETA count with the official headway', async ({ page }) => {
  await page.goto('./?smoke=route-detail-scheduled-cue', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => ({
    bounds: scheduleFrequencyBounds('8-11'),
    label: scheduleFrequencyText('8-11'),
    check: detailScheduleValidation({ current:{ freq:'8-11' } }, [
      { iso:new Date(Date.now() + 10 * 60000).toISOString(), sched:false },
      { iso:new Date(Date.now() + 30 * 60000).toISOString(), sched:false },
      { iso:new Date(Date.now() + 50 * 60000).toISOString(), sched:false },
      { iso:new Date(Date.now() + 55 * 60000).toISOString(), sched:false },
      { iso:new Date(Date.now() + 59 * 60000).toISOString(), sched:false }
    ]).className
  }));
  expect(result).toMatchObject({ bounds:{ min:8, max:11 }, label:'8–11 分鐘／班', check:'ok' });
});

test('Escape and browser Back close the overlay and restore the entry focus', async ({ page }) => {
  await prepare(page);
  const entry = page.locator('[data-detail-id]');
  await entry.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#routeDetail')).not.toHaveClass(/on/);
  await expect(entry).toBeFocused();
  await expect.poll(() => page.evaluate(() => routeDetailState.detailTicker)).toBeNull();
  await entry.click();
  await page.goBack();
  await expect(page.locator('#routeDetail')).not.toHaveClass(/on/);
});

test('detail close restores focus after the originating card is rerendered', async ({ page }) => {
  await prepare(page);
  const entry = page.locator('[data-detail-id]').first();
  await entry.click();
  await page.evaluate(() => shell());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name:'查看完整路線及沿途車站', exact:true })).toBeFocused();
});

test('route detail trigger is compact and does not add a text row to the card', async ({ page }) => {
  await prepare(page);
  const entry = page.locator('[data-detail-id]').first();
  await expect(entry).toHaveAttribute('aria-label', '查看完整路線及沿途車站');
  await expect(entry.locator('xpath=..')).toHaveClass(/stop/);
  await expect(page.locator('text=查看完整路線及沿途車站　›')).toHaveCount(0);
});

for (const theme of ['dark', 'light']) {
  test(`four-corner expand icon preserves the route detail button in ${theme} mode`, async ({ page }, testInfo) => {
    await prepare(page);
    await page.evaluate(value => document.body.classList.toggle('light', value === 'light'), theme);
    const entry = page.getByRole('button', { name: '查看完整路線及沿途車站', exact: true });
    const icon = entry.locator('svg.detail-expand-icon');
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
    await expect(icon).toHaveAttribute('focusable', 'false');
    await expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
    await expect(icon).toHaveCSS('width', '18px');
    await expect(icon).toHaveCSS('height', '18px');
    await expect(icon).toHaveAttribute('stroke', 'currentColor');
    await expect(icon.locator('path')).toHaveCount(4);
    expect(await icon.locator('path').evaluateAll(paths => paths.map(path => path.getAttribute('d')))).toEqual([
      'M12 12 3 3M3 8V3h5', 'M12 12 21 3M16 3h5v5',
      'M12 12 3 21M3 16v5h5', 'M12 12 21 21M16 21h5v-5'
    ]);
    await expect(entry).not.toContainText('☷');
    expect(await icon.evaluate(el => getComputedStyle(el).stroke)).toBe(await entry.evaluate(el => getComputedStyle(el).color));
    await page.locator('.card').first().screenshot({ path: testInfo.outputPath(`expand-icon-${theme}.png`) });
    await icon.click();
    await expect(page.locator('#routeDetail')).toHaveClass(/on/);
    await page.keyboard.press('Escape');
    await expect(entry).toBeFocused();
    await entry.press('Enter');
    await expect(page.locator('#routeDetail')).toHaveClass(/on/);
  });
}

test('reverse direction swaps supported route variants without inventing a GMB variant', async ({ page }) => {
  await page.goto('./?smoke=route-detail-reverse', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(kmbItem => ({
    kmb: reverseDetailItem(kmbItem),
    compact: reverseDetailItem({ ...kmbItem, origin:undefined, stopName:'大埔中心總站' }),
    gmb: reverseDetailItem({ co:'GMB', route:'1', route_id:'G1', route_seq:1, origin:'甲', dest:'乙' })
  }), item);
  expect(result.kmb).toMatchObject({ dir:'I', bound:'inbound', origin:'大埔中心', dest:'觀塘碼頭' });
  expect(result.compact).toMatchObject({ dir:'I', origin:'大埔中心', dest:'大埔中心總站' });
  expect(result.gmb).toBeNull();
});

test('detail fare lookup follows direction and never invents first or last service times', async ({ page }) => {
  await page.goto('./?smoke=route-detail-metadata', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => ({
    outbound: detailFareValue({ co:'KMB', route:'74X', dir:'O' }, { 'KMB|74X|1':11.5 }),
    inbound: detailFareValue({ co:'KMB', route:'74X', dir:'I' }, { 'KMB|74X|2':11.5 }),
    missing: detailFareValue({ co:'KMB', route:'UNKNOWN', dir:'O' }, {})
  }));
  expect(result.outbound).toBe('$11.5');
  expect(result.inbound).toBe('$11.5');
  expect(result.missing).toBe('官方資料未提供');
});

test('ETA time-drop estimator counts monotonic waves and one-minute drops', async ({ page }) => {
  await page.goto('./?smoke=route-detail-estimator', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const stops = [{ id:'a', seq:1 }, { id:'b', seq:2 }, { id:'c', seq:3 }, { id:'d', seq:4 }];
    const base = Date.now() + 60000;
    const etaByStop = new Map([
      ['a', { status:'ready', etas:[{ iso:new Date(base).toISOString(), etaSeq:1 }] }],
      ['b', { status:'ready', etas:[{ iso:new Date(base + 180000).toISOString(), etaSeq:1 }] }],
      ['c', { status:'ready', etas:[{ iso:new Date(base - 60000).toISOString(), etaSeq:1 }] }],
      ['d', { status:'ready', etas:[{ iso:new Date(base + 120000).toISOString(), etaSeq:1 }] }]
    ]);
    return estimateActiveBusWaves(stops, etaByStop);
  });
  expect(result).toMatchObject({ count:2, drops:1, samples:4 });
});

test('scheduled ETA within five minutes stays a timetable value, not a moving-bus cue', async ({ page }) => {
  await page.goto('./?smoke=route-detail-scheduled-cue', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => ({
    near: detailEtaShouldShowBus({ sched:true, min:3 }),
    far: detailEtaShouldShowBus({ sched:true, min:8 })
  }));
  expect(result).toEqual({ near:false, far:false });
});

test('ETA wave estimate places virtual buses between the correct stops', async ({ page }) => {
  await page.goto('./?smoke=route-detail-virtual-buses', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const now = Date.now();
    const stops = [{id:'a',seq:1},{id:'b',seq:2},{id:'c',seq:3},{id:'d',seq:4}];
    const etaByStop = new Map([
      ['a',{status:'ready',etas:[{etaSeq:1,iso:new Date(now-60000).toISOString()},{etaSeq:2,iso:new Date(now+120000).toISOString()}]}],
      ['b',{status:'ready',etas:[{etaSeq:1,iso:new Date(now+60000).toISOString()},{etaSeq:2,iso:new Date(now-60000).toISOString()}]}],
      ['c',{status:'ready',etas:[{etaSeq:1,iso:new Date(now+180000).toISOString()},{etaSeq:2,iso:new Date(now+60000).toISOString()}]}],
      ['d',{status:'ready',etas:[{etaSeq:1,iso:new Date(now+240000).toISOString()},{etaSeq:2,iso:new Date(now+120000).toISOString()}]}]
    ]);
    return deriveVirtualBusSegments(stops, etaByStop, now);
  });
  expect(result.map(x => x.fromSeq)).toEqual([1,2]);
});

test('custom trip uses the selected intermediate destination instead of the terminal stop', async ({ page }) => {
  await page.goto('./?smoke=route-detail-custom-trip', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const stops = [
      { id:'LONG-STOP-ID-A', seq:1, name:'起點 (A001)', cumulativeDistanceMeters:0 },
      { id:'LONG-STOP-ID-B', seq:2, name:'中途上車站 (B002)', cumulativeDistanceMeters:1200 },
      { id:'LONG-STOP-ID-C', seq:3, name:'中途落車站 (C003)', cumulativeDistanceMeters:3600 },
      { id:'LONG-STOP-ID-D', seq:4, name:'尾站 (D004)', cumulativeDistanceMeters:12000 }
    ];
    routeDetailState.customFromSeq = 2;
    routeDetailState.customToSeq = 3;
    const trip = customTripResult(stops, new Map(), 2, 3);
    const html = customTripPickerDrawer(stops, 2, 3);
    routeDetailState.customFromSeq = null;
    routeDetailState.customToSeq = null;
    const defaultHtml = customTripPanel(stops);
    return { trip, hasSelectedDestination: html.includes('中途落車站') && html.includes('<small>(C003)</small>') && !html.includes('LONG-STOP-ID-C'), defaultsToTerminal: defaultHtml.includes('尾站') };
  });
  expect(result.trip).toMatchObject({ status:'estimate', from:{ seq:2 }, to:{ seq:3 }, minutes:12 });
  expect(result.hasSelectedDestination).toBe(true);
  expect(result.defaultsToTerminal).toBe(true);
});

test('arrow keys move between stops and keep the selected ETA panel in sync', async ({ page }) => {
  await prepare(page);
  await page.locator('[data-detail-id]').click();
  const first = page.locator('[data-detail-stop="1"]');
  await first.focus();
  await first.press('ArrowDown');
  await expect(page.locator('.detail-current-name')).toContainText('第二站');
  await expect(page.locator('[data-detail-stop="2"]')).toBeFocused();
  await page.locator('[data-detail-stop="2"]').press('ArrowUp');
  await expect(page.locator('.detail-current-name')).toContainText('第一站');
  await expect(first).toBeFocused();
});

test('returning to the app closes the screen saver before showing the main UI', async ({ page }) => {
  await page.goto('./?smoke=route-detail-ui', { waitUntil: 'domcontentloaded' });
  const state = await page.evaluate(() => {
    openBusSaver();
    const before = document.getElementById('busSaver').classList.contains('on');
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
    return { before, after: busSaverActive, visible: document.getElementById('busSaver').classList.contains('on') };
  });
  expect(state).toEqual({ before:true, after:false, visible:false });
});
