import { expect, test } from "@playwright/test";

test("Options category and view navigation keeps mobile touch targets usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only touch-target regression");

  await page.goto("/options?tab=levels");

  const categories = page.getByRole("tablist", { name: "Options categories" });
  const views = page.getByRole("tablist", { name: "Options views" });
  const launcher = page.locator('[data-options-workflow-guide="launcher"]');

  await expect(categories).toBeVisible({ timeout: 15_000 });
  await expect(views).toBeVisible();
  await expect(launcher).toBeVisible();

  const categoryGeometry = await categories.getByRole("tab").evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );
  const viewGeometry = await views.getByRole("tab").evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );
  const launcherGeometry = await launcher.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });

  expect(categoryGeometry.length).toBeGreaterThan(4);
  expect(viewGeometry.length).toBeGreaterThan(0);
  expect(categoryGeometry.every((g) => g.height >= 44)).toBe(true);
  expect(viewGeometry.every((g) => g.height >= 44)).toBe(true);
  expect(launcherGeometry.height).toBeGreaterThanOrEqual(44);

  const pageWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client + 1);
});
