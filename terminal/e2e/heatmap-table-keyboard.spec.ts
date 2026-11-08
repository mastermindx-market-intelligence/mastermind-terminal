import { expect, test } from "@playwright/test";

// Existing responsive fixture server and route. No new fixture/auth seam.
for (const lang of ["en", "zh"] as const) {
  test(`heatmap table keyboard sorting and inspection in ${lang}`, async ({ page }) => {
    await page.addInitScript(locale => {
      localStorage.setItem("mm.lang", locale);
      document.documentElement.setAttribute("data-lang", locale);
    }, lang);
    await page.goto("/discover?tab=heatmap");
    await expect(page.getByRole("button", { name: lang === "zh" ? "价格 × 成交量" : "Price × volume", exact: true }))
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(lang === "zh" ? "加载热力图中…" : "Loading heatmap…", { exact: true }))
      .toHaveCount(0, { timeout: 15_000 });
    await page.getByRole("button", { name: lang === "zh" ? "列表" : "TABLE", exact: true }).click();
    const table = page.locator("main table").filter({ has: page.getByRole("button", { name: lang === "zh" ? "代码" : "Ticker", exact: true }) });
    await expect(table).toBeVisible();
    const header = table.locator("thead th").first();
    const sort = header.getByRole("button");
    const tickers = () => table.locator("tbody tr td:first-child button").allTextContents();
    const controls = page.locator('[data-tut="heatmap-controls"]');
    for (const layer of ["price", "flow"] as const) {
      // The ZH price column and layer share the label 价格. Scope to the
      // incumbent controls row rather than matching the table sort button.
      await controls.getByRole("button", { name: layer === "price" ? (lang === "zh" ? "价格" : "PRICE") : (lang === "zh" ? "资金流" : "FLOW"), exact: true }).click();
      await expect(table.locator("tbody tr").first()).toBeVisible();
      await sort.focus();
      for (const key of ["Enter", "Space", "Enter", "Space"]) {
        const before = await header.getAttribute("aria-sort");
        await sort.press(key);
        const next = before === "descending" ? "ascending" : "descending";
        await expect(header).toHaveAttribute("aria-sort", next);
        await expect(sort).toBeFocused();
        const names = (await tickers()).map(x => x.trim());
        expect(names.length).toBeGreaterThan(1);
        const expected = [...names].sort((a, b) => a.localeCompare(b));
        expect(names).toEqual(next === "ascending" ? expected : expected.reverse());
        await expect(table.locator("th[aria-sort]")).toHaveCount(1);
      }
      const inspect = table.locator("tbody tr td:first-child button").first();
      for (const key of ["Enter", "Space"]) {
        await inspect.focus();
        await inspect.press(key);
        const close = page.getByRole("button", { name: lang === "zh" ? "关闭" : "Close", exact: true });
        await expect(close).toBeVisible();
        await close.click();
        await expect(close).toHaveCount(0);
      }
    }
  });
}

