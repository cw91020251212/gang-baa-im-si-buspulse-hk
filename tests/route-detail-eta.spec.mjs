import { test, expect } from '@playwright/test';

test('KMB parser groups by stop and preserves scheduled remarks', async ({ page }) => {
  await page.goto('./?smoke=route-detail-eta-parser', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const now = Date.now();
    const grouped = parseKmbRouteEta([
      { seq:1, dir:'O', eta:new Date(now + 300000).toISOString(), eta_seq:1, rmk_tc:'' },
      { seq:1, dir:'O', eta:new Date(now + 600000).toISOString(), eta_seq:2, rmk_tc:'原定班次', data_timestamp:'2026-09-15T04:00:00+08:00' },
      { seq:2, dir:'I', eta:new Date(now + 400000).toISOString(), eta_seq:1 },
      { seq:3, dir:'O', eta:null, eta_seq:1 }
    ], { dir:'O' });
    return { keys:[...grouped.keys()], first:grouped.get(1), inbound:grouped.get(2), nullEta:grouped.get(3) || [] };
  });
  expect(result.keys).toEqual([1]);
  expect(result.first).toHaveLength(2);
  expect(result.first[1].sched).toBe(true);
  expect(result.first[1].dataTimestamp).toBe('2026-09-15T04:00:00+08:00');
  expect(result.inbound).toBeUndefined();
  expect(result.nullEta).toEqual([]);
});

test('detail ETA cells include a clock time and scheduled remark', async ({ page }) => {
  await page.goto('./?smoke=route-detail-eta-panel', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const stop = { id:'panel-stop', name:'測試站', seq:1 };
    routeDetailState.etaByStop.set(stop.id, { status:'ready', etas:[
      { iso:new Date(Date.now() + 300000).toISOString(), min:5, sched:false },
      { iso:new Date(Date.now() + 600000).toISOString(), min:10, sched:true, rmk:'原定班次' }
    ] });
    return detailEtaPanel(stop);
  });
  expect(result).toMatch(/\d{2}:\d{2}/);
  expect(result).toContain('原定班次');
});

test('detail status keeps official provider time separate from fetch time', async ({ page }) => {
  await page.goto('./?smoke=route-detail-source-time', { waitUntil:'domcontentloaded' });
  const result = await page.evaluate(() => {
    const stop = { id:'source-stop', name:'資料站' };
    setDetailEtaState(stop.id, { status:'ready', fetchedAt:new Date().toISOString(), sourceTimestamp:'2026-09-15T04:00:00+08:00', etas:[{ iso:new Date(Date.now() + 300000).toISOString(), min:5 }] });
    return detailStatusText(stop);
  });
  expect(result).toContain('官方資料');
});

test('conservative inferred segment requires adjacent fresh non-scheduled ETAs', async ({ page }) => {
  await page.goto('./?smoke=route-detail-inference', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const now = Date.now();
    const stops = [{ seq:1, id:'a' }, { seq:2, id:'b' }, { seq:3, id:'c' }];
    const state = new Map([
      ['a', { status:'ready', batchId:7, fetchedAt:new Date(now).toISOString(), etas:[{ iso:new Date(now + 120000).toISOString(), sched:false }] }],
      ['b', { status:'ready', batchId:7, fetchedAt:new Date(now).toISOString(), etas:[{ iso:new Date(now + 240000).toISOString(), sched:false }] }],
      ['c', { status:'ready', batchId:7, fetchedAt:new Date(now).toISOString(), etas:[{ iso:new Date(now + 360000).toISOString(), sched:true }] }]
    ]);
    const valid = deriveEstimatedSegments(stops, state, now);
    state.get('b').stale = true;
    const stale = deriveEstimatedSegments(stops, state, now);
    state.get('b').stale = false;
    state.get('b').batchId = 8;
    const mixedBatch = deriveEstimatedSegments(stops, state, now);
    return { valid, stale, mixedBatch };
  });
  expect(result.valid).toHaveLength(1);
  expect(result.valid[0]).toMatchObject({ fromSeq:1, toSeq:2, confidence:'estimated' });
  expect(result.stale).toEqual([]);
  expect(result.mixedBatch).toEqual([]);
});

test('recent station snapshot is used only as stale fallback', async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem('busboard.eta-snapshot.v1', JSON.stringify({
      'KMB|N271|O|cached-stop': {
        savedAt: now - 30_000,
        etas: [{ iso:new Date(now + 240_000).toISOString(), min:4, rmk:'', sched:false }]
      }
    }));
  });
  await page.goto('./?smoke=route-detail-snapshot', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const it = { co:'KMB', route:'N271', dir:'O', service_type:'1', seq:2, stopId:'cached-stop', stopName:'快取站' };
    const stop = { seq:2, id:'cached-stop', name:'快取站' };
    applyDetailEtaResult(it, stop, [], '讀取失敗', 1);
    const stale = detailEtaStateFor(stop);
    const fresh = { seq:2, id:'fresh-stop', name:'新鮮站' };
    applyDetailEtaResult(it, fresh, [], '讀取失敗', 1);
    return { staleStatus:stale.status, staleCount:stale.etas.length, freshStatus:detailEtaStateFor(fresh).status };
  });
  expect(result.staleStatus).toBe('stale');
  expect(result.staleCount).toBe(1);
  expect(result.freshStatus).toBe('error');
});
