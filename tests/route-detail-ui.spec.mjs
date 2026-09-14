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
      { stop:'stop-1', name_tc:'第一站', lat:'22.30', long:'114.20' },
      { stop:'stop-2', name_tc:'第二站', lat:'22.31', long:'114.21' },
      { stop:'stop-3', name_tc:'第三站', lat:'22.32', long:'114.22' }
    ] })
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
  await expect(page.locator('.detail-status')).toContainText('下一段');
});

test('Escape and browser Back close the overlay and restore the entry focus', async ({ page }) => {
  await prepare(page);
  const entry = page.locator('[data-detail-id]');
  await entry.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#routeDetail')).not.toHaveClass(/on/);
  await expect(entry).toBeFocused();
  await entry.click();
  await page.goBack();
  await expect(page.locator('#routeDetail')).not.toHaveClass(/on/);
});
