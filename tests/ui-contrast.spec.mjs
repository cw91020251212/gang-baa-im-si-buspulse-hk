import { test, expect } from '@playwright/test';

async function expectCleanDarkText(page) {
  const shadowed = await page.locator('body *').evaluateAll(elements => elements.flatMap(el => {
    if (!el.getClientRects().length || ![...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) return [];
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden') return [];
    const rgba = style.color.match(/[\d.]+/g)?.map(Number);
    if (rgba?.length === 4 && rgba[3] === 0) return []; // Gradient text is transparent, not black.
    const channels = rgba?.slice(0, 3);
    if (!channels || channels.length !== 3 || Math.max(...channels) > 64 || style.textShadow === 'none') return [];
    return [{ tag: el.tagName, id: el.id, text: el.textContent.trim().slice(0, 40), color: style.color, shadow: style.textShadow }];
  }));
  expect(shadowed, 'Visible black/near-black text must never have a text shadow').toEqual([]);
}

for (const theme of ['dark', 'light']) {
  for (const width of [320, 390]) {
    test(`large add-route label stays crisp and usable in ${theme} mode at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(() => {
        localStorage.setItem('busboard.items.v1', JSON.stringify([{
          co: 'KMB', route: 'N271', bound: 'outbound', dir: 'O', service_type: '1', seq: 1,
          stopId: 'test-stop', stopName: '大埔中心總站', origin: '大埔中心', dest: '紅磡'
        }]));
        localStorage.setItem('busboard.user-defaults.v1', '[]');
      });
      await page.route(/https:\/\/[^/]*(?:gov\.hk|kmb\.hk)\//, route => route.abort());
      await page.goto('./?smoke=large-add-route', { waitUntil: 'domcontentloaded' });
      await page.evaluate(value => document.body.classList.toggle('light', value === 'light'), theme);
      const fab = page.getByRole('button', { name: '加入巴士路線', exact: true });
      await expect(fab).toBeVisible();
      await expect(fab).toHaveText('＋ 路線');
      await expect(fab).toHaveCSS('font-size', '22px');
      await expect(fab).toHaveCSS('text-shadow', 'none');
      await expect(fab).not.toHaveCSS('box-shadow', 'none');
      const bounds = await fab.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(await fab.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
      const textFits = await fab.evaluate(el => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const button = el.getBoundingClientRect();
        return text.left >= button.left && text.right <= button.right && text.top >= button.top && text.bottom <= button.bottom;
      });
      expect(textFits).toBe(true);
      await expectCleanDarkText(page);
      if (theme === 'dark') await expect(page.locator('.rt').first()).not.toHaveCSS('text-shadow', 'none');
      if (width === 390) await page.screenshot({ path: testInfo.outputPath(`large-add-route-${theme}.png`) });
      await fab.click();
      await expect(page.locator('#addBtn')).toBeVisible();
      await expect(page.locator('#addBtn')).toHaveCSS('text-shadow', 'none');
      await expectCleanDarkText(page);
      // The global dark-mode selector must not reintroduce shadows on nested labels.
      await page.locator('#addBtn').evaluate(el => { const label = document.createElement('span'); label.textContent = el.textContent; el.replaceChildren(label); });
      await expect(page.locator('#addBtn span')).toHaveCSS('text-shadow', 'none');
    });
  }
}
