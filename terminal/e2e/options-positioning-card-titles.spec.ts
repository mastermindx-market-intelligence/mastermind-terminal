import { expect, test } from "@playwright/test";

test("Positioning keeps long card titles readable on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only title regression");

  await page.goto("/options?tab=positioning");

  const titles = [
    "Hedging requirement by strike",
    "Hedge-flow scenarios",
    "The book in delta space",
    "Level report card — graded universe",
  ];

  for (const title of titles) {
    const el = page.getByText(title, { exact: true }).first();
    await expect(el).toBeVisible({ timeout: 15_000 });
    const geometry = await el.evaluate((node) => {
      const e = node as HTMLElement;
      const style = getComputedStyle(e);
      const rect = e.getBoundingClientRect();
      return {
        clientWidth: e.clientWidth,
        scrollWidth: e.scrollWidth,
        height: rect.height,
        whiteSpace: style.whiteSpace,
      };
    });

    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.whiteSpace).not.toBe("nowrap");
    expect(geometry.height).toBeGreaterThan(12);
  }
});
