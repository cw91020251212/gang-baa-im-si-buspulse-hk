import { test, expect } from '@playwright/test';

test('custom route segment uses fresh endpoint ETAs', async ({ page }) => {
  await page.goto('./?smoke=route-detail-custom', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const now = Date.now();
    const stops = [
      { seq:1, id:'a', name:'第一站', cumulativeDistanceMeters:0 },
      { seq:2, id:'b', name:'第二站', cumulativeDistanceMeters:1200 },
      { seq:3, id:'c', name:'第三站', cumulativeDistanceMeters:3600 }
    ];
    const etaByStop = new Map([
      ['a', { status:'ready', stale:false, etas:[{ iso:new Date(now + 5 * 60000).toISOString(), sched:false }] }],
      ['b', { status:'ready', stale:false, etas:[{ iso:new Date(now + 12 * 60000).toISOString(), sched:false }] }],
      ['c', { status:'ready', stale:false, etas:[{ iso:new Date(now + 20 * 60000).toISOString(), sched:false }] }]
    ]);
    const live = customTripResult(stops, etaByStop, 1, 3, now);
    const invalid = customTripResult(stops, etaByStop, 3, 1, now);
    return { status:live.status, minutes:live.minutes, invalid:invalid.status };
  });
  expect(result).toEqual({ status:'live', minutes:15, invalid:'invalid' });
});

test('custom route segment falls back to distance estimate when ETA is unavailable', async ({ page }) => {
  await page.goto('./?smoke=route-detail-custom-fallback', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const stops = [
      { seq:1, id:'a', name:'第一站', cumulativeDistanceMeters:0 },
      { seq:2, id:'b', name:'第二站', cumulativeDistanceMeters:6000 }
    ];
    const result = customTripResult(stops, new Map(), 1, 2);
    return { status:result.status, minutes:result.minutes, text:result.text };
  });
  expect(result.status).toBe('estimate');
  expect(result.minutes).toBe(30);
  expect(result.text).toContain('非即時行車時間');
});

test('route detail shows custom origin and destination controls', async ({ page }) => {
  await page.goto('./?smoke=route-detail-custom-ui', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    routeDetailState.open = true;
    routeDetailState.item = { co:'KMB', route:'E41', origin:'起點', dest:'終點' };
    routeDetailState.stops = [
      { seq:1, id:'a', name:'第一站', name_en:'First', cumulativeDistanceMeters:0 },
      { seq:2, id:'b', name:'第二站', name_en:'Second', cumulativeDistanceMeters:1200 }
    ];
    routeDetailState.customFromSeq = 1;
    routeDetailState.customToSeq = 2;
    routeDetailState.etaByStop = new Map();
    renderRouteDetail();
    return {
      from:routeDetailBody.querySelector('[data-custom-from]')?.value,
      to:routeDetailBody.querySelector('[data-custom-to]')?.value,
      title:routeDetailBody.querySelector('#customTripTitle')?.textContent.trim()
    };
  });
  expect(result).toEqual({ from:'1', to:'2', title:'自訂起點／終點同一路線站點' });
});
