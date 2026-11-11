import { expect, test } from "@playwright/test";

test("Ticker Drill discovers the producer-owned intraday coverage universe", async ({ page }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  if (zh) {
    await page.addInitScript(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      document.documentElement.setAttribute("lang", "zh-CN");
    });
  }

  await page.goto("/options?tab=tickers");

  const sidebar = page.getByRole("complementary", {
    name: zh ? "期权标的覆盖" : "Options ticker coverage",
  });
  await expect(sidebar).toBeVisible({ timeout: 15_000 });
  await expect(sidebar).toContainText(zh ? "覆盖 40" : "40 covered");

  const search = sidebar.getByRole("searchbox", {
    name: zh ? "搜索已覆盖期权标的" : "Search covered options tickers",
  });

  // A core ETF with no current-cycle receipt remains discoverable and names its
  // rotating/waiting state instead of pretending to be unsupported.
  await search.fill("TLT");
  const tlt = sidebar.getByRole("option", { name: /TLT/ });
  await expect(tlt).toBeVisible();
  await tlt.click();
  await expect(page.locator(".fin-empty-why").filter({ hasText: "TLT" })).toContainText(
    zh ? "核心覆盖尚未发布" : "core coverage has not published",
  );

  // A covered quiet name has a different state from waiting and unsupported.
  await search.fill("AMD");
  const amd = sidebar.getByRole("option", { name: /AMD/ });
  await expect(amd).toBeVisible();
  await amd.click();
  await expect(page.locator(".fin-empty-why").filter({ hasText: "AMD" })).toContainText(
    zh ? "没有达标的期权成交" : "no qualifying options prints",
  );

  // A covered root with a published artifact opens the real drill.
  await search.fill("SPY");
  const spy = sidebar.getByRole("option", { name: /SPY/ });
  await expect(spy).toBeVisible();
  await spy.click();
  await expect(page.getByText(zh ? "当日总权利金" : "Day Gross", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(zh ? "分钟净权利金" : "Minute Net Prem", { exact: true })).toBeVisible();
  await expect(page.getByText(zh ? "主力合约" : "Top Contracts", { exact: true })).toBeVisible();

  const containment = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    sidebarRight: document.querySelector<HTMLElement>('[aria-label="Options ticker coverage"], [aria-label="期权标的覆盖"]')?.getBoundingClientRect().right ?? Infinity,
  }));
  expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewport + 1);
  expect(containment.sidebarRight).toBeLessThanOrEqual(containment.viewport + 1);

  if (testInfo.project.name === "mobile") {
    const mobileLayout = await sidebar.evaluate((node) => {
      const parent = node.parentElement!;
      const main = node.nextElementSibling as HTMLElement;
      return {
        flexDirection: getComputedStyle(parent).flexDirection,
        sidebarWidth: node.getBoundingClientRect().width,
        mainWidth: main.getBoundingClientRect().width,
        viewport: window.innerWidth,
      };
    });
    expect(mobileLayout.flexDirection).toBe("column");
    expect(mobileLayout.sidebarWidth).toBeGreaterThanOrEqual(mobileLayout.viewport - 2);
    expect(mobileLayout.mainWidth).toBeGreaterThanOrEqual(mobileLayout.viewport - 2);
  }

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-options-ticker-catalog.png`),
    fullPage: false,
  });
});
