import { test, expect } from '@playwright/test';

test('route detail core keeps variants separate and deduplicates stop loading', async ({ page }) => {
  await page.goto('./?smoke=route-detail-core', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const kmb = { co:'KMB', route:'74X', dir:'O', service_type:'1', seq:1, stopId:'old', stopName:'舊站', dest:'大埔' };
    const ctb = { co:'CTB', route:'1', dir:'I', seq:2, stopId:'ctb-stop', stopName:'城巴站' };
    const gmb = { co:'GMB', route_id:'G123', route_seq:2, seq:1, stopId:'gmb-stop', stopName:'小巴站' };
    const calls = [];
    const loader = async value => {
      calls.push(value.co + ':' + (value.route || value.route_id));
      await new Promise(resolve => setTimeout(resolve, 20));
      return [{ seq:1, id:value.co + '-1', name:'第一站' }, { seq:2, id:value.co + '-2', name:'第二站' }];
    };
    const [a, b] = await Promise.all([getRouteStopsCached(kmb, { loader }), getRouteStopsCached(kmb, { loader })]);
    const selected = makeStopRequest(kmb, a[1]);
    const originalUntouched = kmb.stopId === 'old' && kmb.seq === 1;
    const keysDistinct = routeVariantKey(kmb) !== routeVariantKey(ctb)
      && routeVariantKey(ctb) !== routeVariantKey(gmb);
    const all = await Promise.all([getRouteStopsCached(ctb, { loader }), getRouteStopsCached(gmb, { loader })]);
    return {
      sameReference: a === b,
      calls,
      selected,
      originalUntouched,
      keysDistinct,
      variantsLoaded: all.every(list => list.length === 2)
    };
  });
  expect(result.sameReference).toBe(true);
  expect(result.calls).toEqual(['KMB:74X', 'CTB:1', 'GMB:G123']);
  expect(result.selected.stopId).toBe('KMB-2');
  expect(result.selected.seq).toBe(2);
  expect(result.originalUntouched).toBe(true);
  expect(result.keysDistinct).toBe(true);
  expect(result.variantsLoaded).toBe(true);
});

test('failed or aborted stop loading is not cached and can retry', async ({ page }) => {
  await page.goto('./?smoke=route-detail-abort', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const route = { co:'KMB', route:'N271', dir:'O', service_type:'1' };
    let calls = 0;
    const failing = async () => { calls += 1; const error = new Error('aborted'); error.name = 'AbortError'; throw error; };
    let firstFailed = false;
    try { await getRouteStopsCached(route, { loader:failing }); } catch { firstFailed = true; }
    let secondLoaded = false;
    const retry = await getRouteStopsCached(route, { loader:async () => { calls += 1; return [{seq:1,id:'retry-1',name:'重試站'}]; } });
    secondLoaded = retry[0].id === 'retry-1';
    return { firstFailed, secondLoaded, calls };
  });
  expect(result.firstFailed).toBe(true);
  expect(result.secondLoaded).toBe(true);
  expect(result.calls).toBe(2);
});

 test('detail generation guard rejects stale asynchronous results', async ({ page }) => {
  await page.goto('./?smoke=route-detail-generation', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    routeDetailState.open = true;
    const first = beginRouteDetailGeneration();
    const second = beginRouteDetailGeneration();
    return {
      firstCurrent: isCurrentRouteDetailGeneration(first.generation),
      secondCurrent: isCurrentRouteDetailGeneration(second.generation),
      signalAborted: first.signal.aborted,
      different: first.generation !== second.generation
    };
  });
  expect(result.firstCurrent).toBe(false);
  expect(result.secondCurrent).toBe(true);
  expect(result.signalAborted).toBe(true);
  expect(result.different).toBe(true);
});
