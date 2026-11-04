import { expect, test } from "@playwright/test";

test("Volatility term-structure card stays inside the phone viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only overflow regression");

  await page.goto("/options?tab=volatility");

  const card = page.locator(".fin-card").filter({ hasText: "Term structure" }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });

  const geometry = await card.evaluate((el) => {
    const card = el as HTMLElement;
    const head = card.querySelector<HTMLElement>(".fin-card-h");
    const svg = card.querySelector<SVGElement>("svg");
    return {
      cardClient: card.clientWidth,
      cardScroll: card.scrollWidth,
      headClient: head?.clientWidth ?? 0,
      headScroll: head?.scrollWidth ?? 0,
      svgRight: svg?.getBoundingClientRect().right ?? 0,
      cardRight: card.getBoundingClientRect().right,
    };
  });

  expect(geometry.cardScroll).toBeLessThanOrEqual(geometry.cardClient + 1);
  expect(geometry.headScroll).toBeLessThanOrEqual(geometry.headClient + 1);
  expect(geometry.svgRight).toBeLessThanOrEqual(geometry.cardRight + 1);

  const doc = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.client + 1);
});
