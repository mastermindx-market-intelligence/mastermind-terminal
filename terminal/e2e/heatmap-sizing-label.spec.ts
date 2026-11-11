import { expect, test } from "@playwright/test";

// Uses the existing dev-only fixture server and the existing three responsive
// projects. No new auth, data, server or deployment seam is introduced.
for (const lang of ["en", "zh"] as const) {
  test(`heatmap names its price-volume sizing in ${lang}`, async ({ page }, testInfo) => {
    await page.addInitScript((locale) => {
      localStorage.setItem("mm.lang", locale);
      document.documentElement.setAttribute("data-lang", locale);
      document.documentElement.setAttribute("lang", locale === "zh" ? "zh-CN" : "en");
    }, lang);

    await page.goto("/discover?tab=heatmap");
    const label = lang === "zh" ? "价格 × 成交量" : "Price × volume";
    const equalLabel = lang === "zh" ? "等面积" : "EQUAL";
    const sizing = page.getByRole("button", { name: label, exact: true });
    await expect(sizing).toBeVisible({ timeout: 15_000 });
    // Loading completion requires the real component's effect to have run;
    // clicking SSR markup before hydration is not an interaction proof.
    await expect(page.getByText(lang === "zh" ? "加载热力图中…" : "Loading heatmap…", { exact: true }))
      .toHaveCount(0, { timeout: 15_000 });
    await expect(sizing).toHaveClass(/\bon\b/);
    await expect(page.getByRole("button", { name: lang === "zh" ? "市值" : "CAP", exact: true })).toHaveCount(0);

    const equal = page.getByRole("button", { name: equalLabel, exact: true });
    await equal.click();
    await expect(equal).toHaveClass(/\bon\b/);
    await expect(sizing).not.toHaveClass(/\bon\b/);
    await sizing.click();
    await expect(sizing).toHaveClass(/\bon\b/);

    const geometry = await sizing.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport + 1);
    await page.screenshot({
      path: testInfo.outputPath(`${testInfo.project.name}-heatmap-size-${lang}.png`),
      fullPage: false,
    });
  });
}
