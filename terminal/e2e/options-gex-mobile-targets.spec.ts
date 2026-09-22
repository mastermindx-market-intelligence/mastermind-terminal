import { expect, test } from "@playwright/test";

test("Exposure keeps GEX utility controls touchable on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only touch-target regression");

  await page.goto("/options?tab=gex");

  const targets = page.locator(".obs-gex-mobile-target");
  await expect.poll(() => targets.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

  const geometry = await targets.evaluateAll((els) => els.map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      text: (el.textContent || "").replace(/\s+/g, " ").trim(),
      width: rect.width,
      height: rect.height,
    };
  }));

  expect(geometry.some((g) => /How to Read/i.test(g.text))).toBe(true);
  expect(geometry.some((g) => /0DTE/i.test(g.text))).toBe(true);
  expect(geometry.every((g) => g.width >= 44 && g.height >= 44)).toBe(true);

  const pageWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client + 1);
});
