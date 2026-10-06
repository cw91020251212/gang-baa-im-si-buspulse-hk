import { test, expect } from '@playwright/test';
const baseURL = process.env.BUSPULSE_BASE_URL || 'http://127.0.0.1:4179';
test.use({ baseURL });

test('button hint appears on desktop hover and disappears on leave', async ({ page }) => {
  await page.goto('./?smoke=button-hints', { waitUntil: 'domcontentloaded' });
  const button = page.locator('#prefsBtn');
  await button.hover();
  await expect(page.locator('.button-hint')).toHaveText('顯示設定');
  await page.mouse.move(20, 20);
  await expect(page.locator('.button-hint')).toBeHidden();
});

test('button hint appears after a touch long press', async ({ page }) => {
  await page.goto('./?smoke=button-hints', { waitUntil: 'domcontentloaded' });
  const button = page.locator('#prefsBtn');
  await button.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
  await page.waitForTimeout(600);
  await expect(page.locator('.button-hint')).toHaveText('顯示設定');
  await button.dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true });
});
