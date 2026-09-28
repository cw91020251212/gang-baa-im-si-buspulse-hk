import { test, expect } from '@playwright/test';

const item = {
  co: 'KMB', route: '74X', bound: 'outbound', dir: 'O', service_type: '1', seq: 1,
  stopId: 'stop-1', stopName: '第一站', origin: '觀塘碼頭', dest: '大埔中心'
};
const routeId = 'KMB|74X|O|stop-1';

async function prepare(page, active = false) {
  await page.addInitScript(({ item, routeId, active }) => {
    localStorage.setItem('busboard.items.v1', JSON.stringify([item]));
    localStorage.setItem('busboard.user-defaults.v1', '[]');
    if (active) {
      localStorage.setItem('busboard.getoff.v1', JSON.stringify({
        [routeId]: {
          active: true, route: item.route, targetSeq: 2, targetName: '第二站',
          targetLat: 22.31, targetLng: 114.21
        }
      }));
    }
  }, { item, routeId, active });
  await page.goto('./?smoke=getoff-toggle', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-getoff-id]')).toBeVisible();
}

test('active green get-off button directly stops the reminder', async ({ page }) => {
  await prepare(page, true);
  const button = page.locator('[data-getoff-id]');
  await expect(button).toHaveText('落車中');
  await expect(button).toHaveAttribute('aria-label', '停止落車提醒');

  await button.click();

  await expect(button).toHaveText('落車');
  await expect(button).toHaveAttribute('aria-label', '設定落車提醒');
  await expect(button).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#sheet')).not.toHaveClass(/\bon\b/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('busboard.getoff.v1')))).toEqual({});
});

test('inactive green get-off button still opens station setup', async ({ page }) => {
  await prepare(page);
  await page.locator('[data-getoff-id]').click();

  await expect(page.locator('#sheet')).toHaveClass(/\bon\b/);
  await expect(page.locator('#sTitle')).toHaveText('設定落車提醒');
  await expect(page.locator('[data-getoff-id]')).toHaveText('落車');
});
