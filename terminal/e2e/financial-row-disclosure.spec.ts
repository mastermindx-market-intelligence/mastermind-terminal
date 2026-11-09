import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const fund = JSON.parse(readFileSync(path.join(process.cwd(), "lib/__tests__/fixtures/fin-compare/NVDA.fund.json"), "utf8"));

async function expectUnobstructed(control: Locator) {
  await expect.poll(() => control.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight &&
      [r.top + 3, r.top + r.height / 2, r.bottom - 3].every(y =>
        el.contains(document.elementFromPoint(r.left + r.width / 2, y)));
  })).toBe(true);
}

async function expectContained(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.locator(".fin-pane").first().evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}

for (const lang of ["en", "zh"] as const) {
  test(`financial row disclosure has a named target and preserves statement values in ${lang}`, async ({ page }, testInfo) => {
    const zh = lang === "zh";
    if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    await page.addInitScript(({ lang, theme }) => {
      localStorage.setItem("mm.lang", lang);
      localStorage.setItem("mmx.shell.theme", theme);
    }, { lang, theme: zh ? "light" : "dark" });
    await page.route(url => url.pathname === "/data/NVDA.fund.json", route => route.fulfill({ json: fund }));
    await page.goto("/analysis?symbol=NVDA&page=statements");
    await page.getByRole("button", { name: zh ? "资产负债表" : "Balance sheet", exact: true }).click();
    const table = page.locator(".fin-table");
    const assets = zh ? "总资产" : "Total assets";
    const liabilities = zh ? "总负债" : "Total liabilities";
    const rawToggle = table.locator(".fin-row-toggle").first();
    await rawToggle.focus();
    await page.screenshot({ path: testInfo.outputPath(`disclosure-target-${lang}.png`), animations: "disabled" });
    await expect.soft(rawToggle).toHaveAccessibleName(assets);
    const initial = (await rawToggle.boundingBox())!;
    expect.soft(initial.width).toBeGreaterThanOrEqual(44);
    expect.soft(initial.height).toBeGreaterThanOrEqual(44);
    const assetsButton = table.getByRole("button", { name: assets, exact: true });
    await expect(assetsButton).toHaveAttribute("aria-expanded", "false");
    await expectUnobstructed(assetsButton);
    const parent = assetsButton.locator("xpath=ancestor::tr");
    const values = await parent.locator("td").allTextContents();
    await page.keyboard.press("Enter");
    await expect(assetsButton).toHaveAttribute("aria-expanded", "true");
    const currentAssets = table.getByRole("rowheader", { name: zh ? "流动资产" : "Current assets", exact: true });
    const longAssets = table.getByRole("rowheader", { name: zh ? "非流动资产" : "Non-current assets", exact: true });
    await expect(currentAssets).toBeVisible();
    await expect(longAssets).toBeVisible();
    await expect(currentAssets.locator("xpath=ancestor::tr").locator("td").last()).toContainText("125.61B");
    await expect(longAssets.locator("xpath=ancestor::tr").locator("td").last()).toContainText("81.20B");
    expect(await parent.locator("td").allTextContents()).toEqual(values);
    await expect(assetsButton).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`expanded-assets-${lang}.png`), animations: "disabled" });
    await page.keyboard.press("Space");
    await expect(assetsButton).toHaveAttribute("aria-expanded", "false");
    await expect(currentAssets).toHaveCount(0);
    await expect(assetsButton).toBeFocused();

    const liabilitiesButton = table.getByRole("button", { name: liabilities, exact: true });
    await liabilitiesButton.focus();
    await expectUnobstructed(liabilitiesButton);
    await page.keyboard.press("Enter");
    await expect(liabilitiesButton).toHaveAttribute("aria-expanded", "true");
    await expect(table.getByRole("rowheader", { name: zh ? "流动负债" : "Current liabilities", exact: true })).toBeVisible();
    await expect(table.getByRole("rowheader", { name: zh ? "非流动负债" : "Non-current liabilities", exact: true })).toBeVisible();
    const indicator = await liabilitiesButton.evaluate(el => {
      const s = getComputedStyle(el);
      return { width: parseFloat(s.outlineWidth), style: s.outlineStyle };
    });
    expect(indicator.width).toBeGreaterThanOrEqual(2);
    expect(indicator.style).not.toBe("none");
    await page.keyboard.press("Space");
    await expect(liabilitiesButton).toHaveAttribute("aria-expanded", "false");
    await expect(liabilitiesButton).toBeFocused();

    const scroll = table.locator("xpath=..");
    await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    const sticky = await assetsButton.locator("xpath=..").boundingBox();
    const view = (await scroll.boundingBox())!;
    expect(sticky!.x).toBeGreaterThanOrEqual(view.x - 1);
    expect(sticky!.x + sticky!.width).toBeLessThanOrEqual(view.x + view.width);
    await expectContained(page);
    await scroll.evaluate(el => { el.scrollLeft = 0; });
    if (testInfo.project.name === "mobile") {
      await page.setViewportSize({ width: 375, height: 667 });
      await assetsButton.focus();
      await expectUnobstructed(assetsButton);
      const box = (await assetsButton.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await expectContained(page);
    }
  });
}

const historyFund = JSON.parse(readFileSync(path.join(process.cwd(), "lib/__tests__/fixtures/fin-compare/0700.HK.fund.json"), "utf8"));

for (const lang of ["en", "zh"] as const) {
  test(`financial period paging has reachable targets and preserves history in ${lang}`, async ({ page }, testInfo) => {
    const zh = lang === "zh";
    if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    await page.addInitScript(({ lang, theme }) => {
      localStorage.setItem("mm.lang", lang);
      localStorage.setItem("mmx.shell.theme", theme);
    }, { lang, theme: zh ? "light" : "dark" });
    await page.route(url => url.pathname === "/data/0700.HK.fund.json", route => route.fulfill({ json: historyFund }));
    await page.goto("/analysis?symbol=0700.HK&page=statements");
    await page.getByRole("button", { name: zh ? "资产负债表" : "Balance sheet", exact: true }).click();
    await page.getByRole("button", { name: zh ? "季度" : "Quarterly", exact: true }).click();
    const table = page.locator(".fin-table");
    const pager = page.locator(".fin-table-pager");
    const earlier = pager.getByRole("button", { name: zh ? "较早期" : "Earlier periods", exact: true });
    const later = pager.getByRole("button", { name: zh ? "较近期" : "Later periods", exact: true });
    const periods = historyFund.statements.quarterly.periods as string[];
    expect(periods.length).toBe(12);
    const periodLabels = table.locator("thead th.fin-cell-head");
    await expect(periodLabels).toHaveText(periods.slice(-6));
    await expect(later).toBeDisabled();
    await earlier.focus();
    await expectUnobstructed(earlier);
    await page.screenshot({ path: testInfo.outputPath(`period-pager-${lang}.png`), animations: "disabled" });
    for (const button of [earlier, later]) {
      const rect = (await button.boundingBox())!;
      expect.soft(rect.width).toBeGreaterThanOrEqual(44);
      expect.soft(rect.height).toBeGreaterThanOrEqual(44);
    }
    await expectUnobstructed(earlier);
    await page.keyboard.press("Enter");
    await expect(periodLabels).toHaveText(periods.slice(0, 6));
    await expect(earlier).toBeDisabled();
    await expect(later).toBeEnabled();
    await later.focus();
    await expectUnobstructed(later);
    await page.keyboard.press("Space");
    await expect(periodLabels).toHaveText(periods.slice(-6));
    await expect(later).toBeDisabled();
    await expect(earlier).toBeEnabled();
    await expectContained(page);
  });
}
