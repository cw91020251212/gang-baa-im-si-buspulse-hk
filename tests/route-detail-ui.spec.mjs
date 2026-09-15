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
  await expect(page.locator('.detail-status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('[data-detail-refresh]')).toHaveText('立即更新全部車站 ETA');
  await expect(page.locator('.detail-inference')).toContainText('推算中');
  await expect(page.locator('.detail-inference')).toContainText('並非巴士 GPS');
  await expect(page.locator('.detail-bus-status')).toContainText('巴士');
  await expect(page.locator('[aria-label="巴士即將到站"]')).toHaveCount(0);
  await expect(page.locator('[aria-label="巴士在途中"]').first()).toBeVisible();
  await expect(page.locator('.stop-copy small').first()).toContainText('FIRST STATION');
  await expect(page.locator('.stop-copy small').first()).not.toContainText('STOP-');
  await expect(page.locator('.detail-inference').first()).toContainText('途中');
  await expect(page.locator('.detail-reverse')).toHaveCSS('position', 'absolute');
  await expect(page.locator('.detail-service')).toContainText('營運時間表及服務資料');
  await expect(page.locator('.detail-service')).toContainText('官方來源');
  await expect(page.locator('.detail-service-link')).toHaveAttribute('href', /search\.kmb\.hk/);
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

test('route detail trigger is compact and does not add a text row to the card', async ({ page }) => {
  await prepare(page);
  const entry = page.locator('[data-detail-id]').first();
  await expect(entry).toHaveAttribute('aria-label', '查看完整路線及沿途車站');
  await expect(entry.locator('xpath=..')).toHaveClass(/stop/);
  await expect(page.locator('text=查看完整路線及沿途車站　›')).toHaveCount(0);
});

test('reverse direction swaps supported route variants without inventing a GMB variant', async ({ page }) => {
  await page.goto('./?smoke=route-detail-reverse', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(kmbItem => ({
    kmb: reverseDetailItem(kmbItem),
    gmb: reverseDetailItem({ co:'GMB', route:'1', route_id:'G1', route_seq:1, origin:'甲', dest:'乙' })
  }), item);
  expect(result.kmb).toMatchObject({ dir:'I', bound:'inbound', origin:'大埔中心', dest:'觀塘碼頭' });
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
