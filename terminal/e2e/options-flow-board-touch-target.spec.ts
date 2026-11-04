import { expect, test } from "@playwright/test";

test("Largest Events gives ticker links a real mobile touch target", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only touch-target regression");

  await page.goto("/options?tab=largest");

  const cards = page.locator(".options-flow-board-cards");
  await expect(cards).toBeVisible({ timeout: 15_000 });
  const tickers = cards.locator(".options-flow-board-ticker");
  await expect.poll(() => tickers.count()).toBeGreaterThan(4);

  const geometry = await tickers.evaluateAll((els) => els.slice(0, 12).map((el) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));

  expect(geometry.every((g) => g.width >= 44 && g.height >= 44)).toBe(true);

  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
});
