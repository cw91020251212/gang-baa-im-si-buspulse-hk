import { test, expect } from '@playwright/test';

const baseURL = process.env.BUSPULSE_BASE_URL || 'http://127.0.0.1:4179';

test.use({ baseURL });

test('homepage renders without uncaught page errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('./?smoke=baseline', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('#prefsBtn')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
