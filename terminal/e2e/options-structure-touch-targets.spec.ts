import { expect, test } from "@playwright/test";

test("Structure keeps OI scope and sort controls touch accessible on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only touch-target regression");

  await page.goto("/options?tab=structure");

  const scope = page.getByRole("group", { name: "Open-interest change scope" });
  await expect(scope).toBeVisible({ timeout: 15_000 });

  const scopeButtons = scope.getByRole("button");
  await expect(scopeButtons).toHaveCount(2);

  const sortButtons = page.getByRole("button", { name: /^Sort by / });
  await expect.poll(() => sortButtons.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(5);

  const geometry = await scopeButtons.evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );
  const sortGeometry = await sortButtons.evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );

  expect(geometry.every((g) => g.width >= 44 && g.height >= 44)).toBe(true);
  expect(sortGeometry.every((g) => g.width >= 44 && g.height >= 44)).toBe(true);

  const pageWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client + 1);
});
