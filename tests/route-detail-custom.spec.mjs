import { test, expect } from '@playwright/test';

test('custom route segment uses fixed station-to-station distance timing', async ({ page }) => {
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
  expect(result).toEqual({ status:'estimate', minutes:18, invalid:'invalid' });
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
  expect(result.text).toContain('按站與站之間距離估算');
});

test('route detail shows custom origin and destination controls', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.goto('./?smoke=route-detail-custom-ui', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    routeDetailState.open = true;
    routeDetailState.stopsStatus = 'ready';
    routeDetailState.item = { co:'KMB', route:'E41', origin:'起點', dest:'終點' };
    routeDetail.classList.add('on');
    document.body.classList.add('detail-open');
    routeDetailState.stops = Array.from({length:22}, (_, index) => ({
      seq:index + 1, id:'stop-' + (index + 1), name:'第' + (index + 1) + '站', name_en:'Stop ' + (index + 1),
      cumulativeDistanceMeters:index * 600
    }));
    routeDetailState.customFromSeq = 1;
    routeDetailState.customToSeq = 22;
    routeDetailState.etaByStop = new Map();
    renderRouteDetail();
    routeDetail.scrollTop = 360;
    const detailScrollBefore = routeDetail.scrollTop;
    routeDetailBody.querySelector('[data-custom-open]')?.click();
    const opened = Boolean(routeDetailBody.querySelector('.custom-picker-drawer'));
    const title = routeDetailBody.querySelector('#customPickerTitle')?.textContent.trim();
    let drawer = routeDetailBody.querySelector('.custom-picker-drawer');
    drawer.scrollTop = Math.min(640, drawer.scrollHeight - drawer.clientHeight);
    const originScrollBefore = drawer.scrollTop;
    routeDetailBody.querySelector('[data-custom-pick-seq="12"]')?.click();
    drawer = routeDetailBody.querySelector('.custom-picker-drawer');
    const originScrollAfter = drawer.scrollTop;
    const detailScrollAfterOrigin = routeDetail.scrollTop;
    const switchedToDestination = routeDetailBody.querySelector('[data-custom-mode="to"]')?.classList.contains('active');
    drawer.scrollTop = Math.min(900, drawer.scrollHeight - drawer.clientHeight);
    const destinationScrollBefore = drawer.scrollTop;
    routeDetailBody.querySelector('[data-custom-pick-seq="18"]')?.click();
    drawer = routeDetailBody.querySelector('.custom-picker-drawer');
    const destinationScrollAfter = drawer.scrollTop;
    const detailScrollAfterDestination = routeDetail.scrollTop;
    const remainsOpenAfterPick = Boolean(routeDetailBody.querySelector('.custom-picker-drawer'));
    routeDetailBody.querySelector('.custom-picker-close')?.click();
    return {
      from:routeDetailState.customFromSeq,
      to:routeDetailState.customToSeq,
      opened,
      title,
      switchedToDestination,
      remainsOpenAfterPick,
      originScrollPreserved:originScrollBefore === originScrollAfter,
      destinationScrollPreserved:destinationScrollBefore === destinationScrollAfter,
      detailScrollPreservedAfterOrigin:detailScrollBefore === detailScrollAfterOrigin,
      detailScrollPreservedAfterDestination:detailScrollBefore === detailScrollAfterDestination,
      closed:!routeDetailBody.querySelector('.custom-picker-drawer')
    };
  });
  expect(result).toEqual({
    from:12, to:18, opened:true, title:'車程', switchedToDestination:true, remainsOpenAfterPick:true,
    originScrollPreserved:true, destinationScrollPreserved:true,
    detailScrollPreservedAfterOrigin:true, detailScrollPreservedAfterDestination:true, closed:true
  });
});
