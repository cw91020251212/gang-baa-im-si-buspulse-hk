import { test, expect } from '@playwright/test';

test('KMB parser groups by stop and preserves scheduled remarks', async ({ page }) => {
  await page.goto('./?smoke=route-detail-eta-parser', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const now = Date.now();
    const grouped = parseKmbRouteEta([
      { seq:1, dir:'O', eta:new Date(now + 300000).toISOString(), eta_seq:1, rmk_tc:'' },
      { seq:1, dir:'O', eta:new Date(now + 600000).toISOString(), eta_seq:2, rmk_tc:'原定班次' },
      { seq:2, dir:'I', eta:new Date(now + 400000).toISOString(), eta_seq:1 },
      { seq:3, dir:'O', eta:null, eta_seq:1 }
    ], { dir:'O' });
    return { keys:[...grouped.keys()], first:grouped.get(1), inbound:grouped.get(2), nullEta:grouped.get(3) || [] };
  });
  expect(result.keys).toEqual([1]);
  expect(result.first).toHaveLength(2);
  expect(result.first[1].sched).toBe(true);
  expect(result.inbound).toBeUndefined();
  expect(result.nullEta).toEqual([]);
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
