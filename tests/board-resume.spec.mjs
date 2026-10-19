import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.route(/^https:\/\//, route => route.abort());
  await page.goto('./?smoke=board-resume', { waitUntil:'domcontentloaded' });
  await page.clock.install();
  await page.evaluate(() => {
    stopLoop();
    if (typeof cancelBoardRefresh === 'function') cancelBoardRefresh();
    if (typeof clearRecoveryRetry === 'function') clearRecoveryRetry();
    if (typeof lastBoardResume !== 'undefined') lastBoardResume = 0;
    if (typeof boardWasHidden !== 'undefined') boardWasHidden = false;
    inFlight = false;
    items = [{ co:'KMB', route:'1A', dir:'O', service_type:'1', seq:1, stopId:'resume-a', stopName:'測試站', dest:'測試總站' }];
    etaSnapshots = {};
    latestResults.clear();
    alarms = {}; getoff = {};
    shell();
    window.testFresh = (minutes = 8) => ({ etas:[{ iso:new Date(Date.now() + minutes * 60000).toISOString(), min:minutes }], err:null });
    window.testCalls = 0;
    fetchETA = async () => { window.testCalls++; return window.testFresh(); };
  });
}
const slot = page => page.locator('#board .etas').first();

// These are controlled lifecycle simulations, not an Android one-hour device test.
test('one-hour resume replaces an unresolved old request and ignores its late response', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    fetchETA = () => new Promise(resolve => { window.finishOld = resolve; });
    refresh();
    Object.defineProperty(document, 'hidden', { configurable:true, value:true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.setSystemTime(new Date(Date.now() + 3600000));
  await page.evaluate(() => {
    fetchETA = async () => { window.testCalls++; return window.testFresh(9); };
    Object.defineProperty(document, 'hidden', { configurable:true, value:false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(slot(page).locator('.m').first()).toHaveText('9');
  await page.evaluate(() => window.finishOld(window.testFresh(99)));
  await expect(slot(page).locator('.m').first()).toHaveText('9');
  expect(await page.evaluate(() => inFlight)).toBe(false);
});

test('a healthy route paints without waiting for a stuck route', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    items.push({ ...items[0], route:'2A', stopId:'resume-b' }); shell();
    fetchETA = it => it.route === '1A' ? new Promise(() => {}) : Promise.resolve(window.testFresh(6));
    refresh();
  });
  await expect(page.locator('#board .etas').nth(1).locator('.m').first()).toHaveText('6');
});

test('batch deadline releases a request even when the provider ignores abort', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { fetchETA = () => new Promise(() => {}); refresh(); });
  await page.clock.runFor(15100);
  expect(await page.evaluate(() => inFlight)).toBe(false);
  await expect(slot(page)).toContainText('連線超時');
  await page.evaluate(async () => { fetchETA = async () => window.testFresh(7); await refresh(); });
  await expect(slot(page).locator('.m').first()).toHaveText('7');
});

test('visibility/pageshow/focus on the same return do not restart fresh requests', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(slot(page).locator('.m').first()).toHaveText('8');
  expect(await page.evaluate(() => window.testCalls)).toBe(1);
});

test('foreground wall-clock watchdog recovers when lifecycle events are missing', async ({ page }) => {
  await setup(page);
  await page.clock.setSystemTime(new Date(Date.now() + 3600000));
  await page.clock.runFor(1100);
  await expect(slot(page).locator('.m').first()).toHaveText('8');
  expect(await page.evaluate(() => window.testCalls)).toBe(1);
});

test('resume retries transient network error and empty response without manual refresh', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    fetchETA = async () => {
      window.testCalls++;
      if (window.testCalls === 1) return { etas:[], err:'讀取失敗' };
      if (window.testCalls === 2) return { etas:[], err:null };
      return window.testFresh(5);
    };
    window.dispatchEvent(new Event('pageshow'));
  });
  await page.clock.runFor(2100);
  expect(await page.evaluate(() => window.testCalls)).toBe(2);
  await page.clock.runFor(5100);
  await expect(slot(page).locator('.m').first()).toHaveText('5');
  expect(await page.evaluate(() => window.testCalls)).toBe(3);
});

test('resume retries are bounded and the regular 25-second loop continues', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    fetchETA = async () => { window.testCalls++; return { etas:[], err:null }; };
    window.dispatchEvent(new Event('pageshow'));
  });
  await page.clock.runFor(24000);
  expect(await page.evaluate(() => window.testCalls)).toBe(3);
  await page.clock.runFor(1100);
  expect(await page.evaluate(() => window.testCalls)).toBe(4);
  await expect(page.locator('#board .none')).toContainText('暫時冇班次資料');
});

test('expired hour-old cache is not presented as live ETA while reconnecting', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const it = items[0];
    const old = { etas:[{ iso:new Date(Date.now() + 600000).toISOString(), min:10 }], err:null };
    cacheEta(uid(it), old.etas); paint(it, old);
    etaSnapshots[uid(it)].savedAt = Date.now() - 3600000;
    fetchETA = () => new Promise(() => {});
    window.dispatchEvent(new Event('pageshow'));
  });
  await expect(slot(page)).toContainText('重新連線');
  await expect(slot(page)).not.toContainText('分鐘');
});

test('manual refresh supersedes a hung automatic request', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { fetchETA = () => new Promise(() => {}); refresh(); });
  await page.evaluate(() => { fetchETA = async () => window.testFresh(4); });
  await page.locator('#refreshBtn').click();
  await expect(slot(page).locator('.m').first()).toHaveText('4');
  await expect(page.locator('#refreshBtn')).toBeEnabled();
});

test('cancelled polling callback cannot start a duplicate loop after resume', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => startLoop());
  await expect(slot(page).locator('.m').first()).toHaveText('8');
  await page.evaluate(() => { fetchETA = () => new Promise(resolve => { window.finishPoll = resolve; }); });
  await page.clock.runFor(25000);
  await page.evaluate(() => {
    fetchETA = async () => { window.testCalls++; return window.testFresh(3); };
    window.dispatchEvent(new Event('pageshow'));
  });
  await expect(slot(page).locator('.m').first()).toHaveText('3');
  await page.evaluate(() => window.finishPoll(window.testFresh(99)));
  await page.clock.runFor(25000);
  expect(await page.evaluate(() => window.testCalls)).toBe(3);
  await expect(slot(page).locator('.m').first()).toHaveText('3');
});

test('board cancellation reaches all three provider network requests', async ({ page }) => {
  await setup(page);
  const aborted = await page.evaluate(async () => {
    const captured = [];
    const originalFetch = window.fetch;
    window.fetch = (url, { signal }) => new Promise((resolve, reject) => {
      captured.push(signal);
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once:true });
    });
    try {
      const controller = new AbortController();
      const pending = [etaKMB(items[0], controller.signal), etaCTB(items[0], controller.signal), etaGMB({ route_id:1, route_seq:1, seq:1 }, controller.signal)];
      controller.abort();
      await Promise.allSettled(pending);
      return captured.map(signal => signal.aborted);
    } finally { window.fetch = originalFetch; }
  });
  expect(aborted).toEqual([true, true, true]);
});

test('online event alone restores board data and the polling loop', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(slot(page).locator('.m').first()).toHaveText('8');
  await page.clock.runFor(25100);
  expect(await page.evaluate(() => window.testCalls)).toBe(2);
});

test('returning to background cancels short retries until the next visible resume', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    fetchETA = async () => { window.testCalls++; return { etas:[], err:'讀取失敗' }; };
    window.dispatchEvent(new Event('pageshow'));
  });
  await expect(slot(page)).toContainText('讀取失敗');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable:true, value:true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(8000);
  expect(await page.evaluate(() => window.testCalls)).toBe(1);
  await page.evaluate(() => {
    fetchETA = async () => { window.testCalls++; return window.testFresh(2); };
    Object.defineProperty(document, 'hidden', { configurable:true, value:false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(slot(page).locator('.m').first()).toHaveText('2');
  expect(await page.evaluate(() => window.testCalls)).toBe(2);
});
