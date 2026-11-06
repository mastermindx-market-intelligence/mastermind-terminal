import { expect, test } from "@playwright/test";

test("Options category and view navigation keeps mobile touch targets usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only touch-target regression");

  await page.goto("/options?tab=levels");

  const picker = page.getByRole("combobox", { name: "Switch Options view" });
  const views = page.getByRole("tablist", { name: "Options views" });
  const launcher = page.locator('[data-options-workflow-guide="launcher"]');

  await expect(picker).toBeVisible({ timeout: 15_000 });
  await expect(picker).toHaveValue("levels");
  await expect(picker.locator("optgroup")).toHaveCount(7);
  await expect(picker.locator("option")).toHaveCount(15);
  await expect(views).toBeVisible();
  await expect(launcher).toBeVisible();

  const pickerGeometry = await picker.boundingBox();
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

  expect(pickerGeometry!.width).toBeGreaterThanOrEqual(44);
  expect(pickerGeometry!.height).toBeGreaterThanOrEqual(44);
  expect(viewGeometry.length).toBeGreaterThan(0);
  expect(viewGeometry.every((g) => g.height >= 44)).toBe(true);
  expect(launcherGeometry.height).toBeGreaterThanOrEqual(44);

  await picker.selectOption("surface");
  await expect(page).toHaveURL(/tab=surface/);
  await expect(views.getByRole("tab", { name: "Surface" })).toHaveAttribute("aria-selected", "true");
  await expect(picker).toHaveValue("surface");
  await page.goBack();
  await expect(picker).toHaveValue("levels");

  const pageWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client + 1);
});
