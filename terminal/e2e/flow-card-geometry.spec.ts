import { expect, test } from "@playwright/test";

test("Flow Desk keeps each card's direction and expand controls readable", async ({ page }) => {
  await page.goto("/options?tab=desk");

  const cards = page.locator(".obs-fc-card");
  await expect.poll(() => cards.count(), { timeout: 15_000 }).toBeGreaterThan(4);

  const geometry = await cards.evaluateAll((els) => els.slice(0, 8).map((card) => {
    const button = card.querySelector<HTMLElement>(".obs-fc-expand-btn");
    const lean = card.querySelector<HTMLElement>(".obs-fc-lean");
    const cardRect = card.getBoundingClientRect();
    const buttonRect = button?.getBoundingClientRect();
    return {
      buttonInside: Boolean(buttonRect)
        && buttonRect!.left >= cardRect.left
        && buttonRect!.right <= cardRect.right
        && buttonRect!.top >= cardRect.top
        && buttonRect!.bottom <= cardRect.bottom,
      buttonWidth: buttonRect?.width ?? 0,
      buttonHeight: buttonRect?.height ?? 0,
      leanClientWidth: lean?.clientWidth ?? 0,
      leanScrollWidth: lean?.scrollWidth ?? 0,
    };
  }));

  expect(geometry.every((row) => row.buttonInside)).toBe(true);
  expect(geometry.every((row) => row.buttonWidth >= 30 && row.buttonHeight >= 30)).toBe(true);
  expect(geometry.every((row) => row.leanScrollWidth <= row.leanClientWidth + 1)).toBe(true);

  const secondTopBefore = await cards.nth(1).evaluate((el) => (el as HTMLElement).offsetTop);
  await cards.first().locator(".obs-fc-expand-btn").click();
  const detail = cards.first().locator(".obs-fc-detail");
  await expect(detail).toBeVisible();
  // Expansion may scroll the feed just enough to reveal its overlay; that must not
  // move neighbouring cards inside the grid itself.
  const secondTopAfter = await cards.nth(1).evaluate((el) => (el as HTMLElement).offsetTop);
  expect(Math.abs(secondTopAfter - secondTopBefore)).toBeLessThanOrEqual(1);
  await detail.locator(".obs-fc-detail-close").click();
  await expect(detail).toHaveCount(0);
});
