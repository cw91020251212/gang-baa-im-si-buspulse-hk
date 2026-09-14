import { test, expect } from '@playwright/test';

async function runQueue(page, company) {
  return page.evaluate(async co => {
    let active = 0, maxActive = 0, calls = 0;
    const originalFetch = window.fetch;
    window.fetch = async url => {
      calls += 1; active += 1; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 12));
      active -= 1;
      const now = Date.now();
      if (co === 'CTB') return new Response(JSON.stringify({ data:[{ dir:'O', eta:new Date(now + 300000).toISOString(), rmk_tc:'' }] }), { status:200, headers:{'content-type':'application/json'} });
      return new Response(JSON.stringify({ data:[{ eta:[{ timestamp:new Date(now + 300000).toISOString(), diff:5 }] }] }), { status:200, headers:{'content-type':'application/json'} });
    };
    routeDetailState.open = true;
    routeDetailState.stops = Array.from({length:7}, (_, i) => ({ seq:i+1, id:co+'-'+(i+1), name:'站'+(i+1) }));
    routeDetailState.etaByStop.clear();
    const it = co === 'CTB'
      ? { co, route:'1', dir:'O', stopId:'selected', stopName:'站1' }
      : { co, route:'G1', route_id:'G1', route_seq:1, dir:'O', stopId:'selected', stopName:'站1' };
    const request = beginRouteDetailGeneration();
    const beforeAlarm = localStorage.getItem('busboard.alarm-plan.v1');
    const beforeGetoff = localStorage.getItem('busboard.getoff.v1');
    await loadRouteDetailEtas(it, request);
    window.fetch = originalFetch;
    return {
      calls, maxActive,
      allReady:[...routeDetailState.etaByStop.values()].every(x => x.status === 'ready'),
      alarmUnchanged:beforeAlarm === localStorage.getItem('busboard.alarm-plan.v1'),
      getoffUnchanged:beforeGetoff === localStorage.getItem('busboard.getoff.v1')
    };
  }, company);
}

test('CTB detail ETA uses bounded workers and no alarm or GPS side effects', async ({ page }) => {
  await page.goto('./?smoke=route-detail-ctb-queue', { waitUntil: 'domcontentloaded' });
  const result = await runQueue(page, 'CTB');
  expect(result.calls).toBe(7);
  expect(result.maxActive).toBeLessThanOrEqual(3);
  expect(result.allReady).toBe(true);
  expect(result.alarmUnchanged).toBe(true);
  expect(result.getoffUnchanged).toBe(true);
});

test('GMB detail ETA uses bounded workers and no alarm or GPS side effects', async ({ page }) => {
  await page.goto('./?smoke=route-detail-gmb-queue', { waitUntil: 'domcontentloaded' });
  const result = await runQueue(page, 'GMB');
  expect(result.calls).toBe(7);
  expect(result.maxActive).toBeLessThanOrEqual(3);
  expect(result.allReady).toBe(true);
  expect(result.alarmUnchanged).toBe(true);
  expect(result.getoffUnchanged).toBe(true);
});

test('newer detail generation wins and closing invalidates the older response', async ({ page }) => {
  await page.goto('./?smoke=route-detail-race', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    routeDetailState.open = true;
    const first = beginRouteDetailGeneration();
    const second = beginRouteDetailGeneration();
    const beforeClose = {
      firstCurrent: isCurrentRouteDetailGeneration(first.generation),
      secondCurrent: isCurrentRouteDetailGeneration(second.generation),
      firstAborted: first.signal.aborted
    };
    closeRouteDetail({ history:false });
    return { ...beforeClose, secondAfterClose:isCurrentRouteDetailGeneration(second.generation), secondAborted:second.signal.aborted };
  });
  expect(result.firstCurrent).toBe(false);
  expect(result.secondCurrent).toBe(true);
  expect(result.firstAborted).toBe(true);
  expect(result.secondAfterClose).toBe(false);
  expect(result.secondAborted).toBe(true);
});
