import { test, expect } from '@playwright/test';

for (const width of [320, 390]) {
  for (const theme of ['dark', 'light']) {
    for (const font of ['medium', 'large']) {
      test(`V1.0 stays inside the mobile header at ${width}px in ${theme}/${font}`, async ({ page }) => {
        await page.setViewportSize({ width, height:844 });
        await page.addInitScript(({ theme, font }) => {
          localStorage.setItem('busboard.preferences.v1', JSON.stringify({ theme, font, screenSaverIdle:0 }));
        }, { theme, font });
        await page.route(/https:\/\/[^/]*(?:gov\.hk|kmb\.hk)\//, route => route.abort());
        await page.goto('./?smoke=header-version', { waitUntil:'domcontentloaded' });
        const version = page.locator('.top .app-version');
        await expect(version).toHaveText('V1.0');
        await expect(version).toBeVisible();
        const layout = await page.evaluate(() => {
          const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
          return { version:rect('.app-version'), title:rect('.brandtitle'), brand:rect('.brandcopy'), clock:rect('.clock'), top:rect('.top'), width:innerWidth };
        });
        expect(layout.version.x).toBeGreaterThanOrEqual(layout.title.right - 1);
        expect(layout.version.right).toBeLessThanOrEqual(layout.brand.right + 1);
        expect(layout.version.right).toBeLessThanOrEqual(layout.clock.x);
        expect(layout.version.y).toBeGreaterThanOrEqual(layout.top.y);
        expect(layout.version.bottom).toBeLessThanOrEqual(layout.top.bottom);
        expect(layout.top.right).toBeLessThanOrEqual(layout.width + 1);
        if (width === 390 && theme === 'dark' && font === 'medium') {
          await page.screenshot({ path:'/workspace/buspulse-v1-mobile-preview.png' });
        }
      });
    }
  }
}
