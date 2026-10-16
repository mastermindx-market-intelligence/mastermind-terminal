import { expect, test } from '@playwright/test';
import { isolateWatchlistStore } from './watchlistStore';
import { isolateLayoutStore } from './layoutStore';

for (const lang of ['en', 'zh'] as const) {
  test(`watchlist columns remain aligned and readable after scrolling and resizing (${lang})`, async ({ page, baseURL }, info) => {
    test.skip(info.project.name !== 'desktop', 'the desktop watchlist rail is hidden below 861px');
    await isolateWatchlistStore(page, info, baseURL);
    await isolateLayoutStore(page, info, baseURL);
    await page.addInitScript((locale) => {
      localStorage.setItem('mm.lang', locale);
      if (sessionStorage.getItem('column-sizing-seeded')) return;
      sessionStorage.setItem('column-sizing-seeded', '1');
      localStorage.setItem('mm.setVersion', '1');
      localStorage.setItem('mm.set', JSON.stringify({ tableView: true, logo: true, disp: 'symbol', cols: { last: true, changePct: true, change: false, volume: false, ext: true, extPct: true }, colW: {} }));
    }, lang);
    const writes: string[] = [];
    page.on('request', r => {
      if (r.method() !== 'GET' && /^\/api\/(watchlists|layouts|investigations|theses|smart-screens)(\/|\?|$)/.test(new URL(r.url()).pathname)) writes.push(r.method() + ' ' + new URL(r.url()).pathname);
    });
    await page.goto('/terminal?symbol=NVDA');
    const row = page.locator('#rail-panel-watchlists .wl-row').first();
    await expect(row).toBeVisible();
    await expect(row.locator('[data-watchlist-column="last"]')).toHaveText(/[0-9]/);
    await expect(row.locator('[data-watchlist-column="changePct"]')).toHaveText(/[0-9]/);
    const original = await row.locator('[data-watchlist-column]').allTextContents();
    for (const key of ['last', 'changePct', 'ext', 'extPct']) {
      const cell = row.locator(`[data-watchlist-column="${key}"]`);
      await cell.scrollIntoViewIfNeeded();
      const geometry = await cell.evaluate(e => {
        const b = e.getBoundingClientRect(), range = document.createRange();
        range.selectNodeContents(e);
        const text = range.getBoundingClientRect();
        const hit = document.elementFromPoint((text.left + text.right) / 2, (text.top + text.bottom) / 2);
        const header = document.querySelector(`.wl-cols [data-watchlist-column="${e.getAttribute('data-watchlist-column')}"]`)!.getBoundingClientRect();
        return { visible: hit === e || e.contains(hit), left: b.left, headerLeft: header.left, fits: text.left >= b.left - 1 && text.right <= b.right + 1 };
      });
      expect(geometry.visible).toBe(true);
      expect(geometry.fits).toBe(true);
      expect(geometry.headerLeft).toBeCloseTo(geometry.left, 0);
    }
    const header = page.locator('.wl-cols [data-watchlist-column="last"]');
    const handle = header.locator('.wl-rz');
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 3 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mm.set') || '{}').colW.last)).toBe(112);
    expect((await header.boundingBox())!.width).toBeCloseTo(112, 0);
    await expect(row.locator('[data-watchlist-column]')).toHaveText(original);
    await page.reload();
    await expect(row).toBeVisible();
    expect((await header.boundingBox())!.width).toBeCloseTo(112, 0);
    await expect(row.locator('[data-watchlist-column]')).toHaveText(original);
    expect(writes).toEqual([]);
  });
}
