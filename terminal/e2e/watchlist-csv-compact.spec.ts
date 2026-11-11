import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { isolateWatchlistStore, seedOwnerWatchlists } from "./watchlistStore";

// At <=860px the regular .wl-board remains hidden by deliberate responsive
// chrome. The compact CSV action bar must still use the SAME selected-list and
// owner-bound handlers as desktop, including the native picker and safe export.
const seed = {
  lists: {
    Default: [],
    "CSV Safe": [
      { symbol: "AAPL", section: "Core, US" },
      { symbol: "MSFT", section: 'Core "US"' },
    ],
    "CSV Target": [],
    "CSV Hazard": [{ symbol: "NVDA", section: "=1+1" }],
  },
  active: "CSV Safe",
  meta: {},
};

test.beforeEach(({}, testInfo) => {
  test.skip(!["tablet", "mobile"].includes(testInfo.project.name),
    "Compact CSV controls are responsive-only; desktop uses the existing native dropdown.");
});

for (const lang of ["en", "zh"] as const) {
  test(`compact CSV owner/list, export guard and native import (${lang})`,
    async ({ page, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      const key = await isolateWatchlistStore(page, testInfo, baseURL);
      await seedOwnerWatchlists(page, key, seed);
      await page.goto("/terminal?symbol=AAPL");
      const bar = page.getByTestId("compact-wl-csv");
      await expect(bar).toBeVisible({ timeout: 60_000 });
      await expect(bar.locator("select")).toHaveValue("CSV Safe");
      await expect(page.locator(".rail .wl-board")).toBeHidden();

      await page.evaluate((value) => {
        document.documentElement.setAttribute("data-lang", value);
        localStorage.setItem("mm.lang", value);
        window.dispatchEvent(new Event("mm:lang"));
      }, lang);
      const importLabel = lang === "en" ? "Import CSV" : "导入 CSV";
      const exportLabel = lang === "en" ? "Export CSV" : "导出 CSV";
      const importButton = bar.getByRole("button", { name: importLabel });
      const exportButton = bar.getByRole("button", { name: exportLabel });
      await expect(importButton).toBeVisible();
      await expect(exportButton).toBeVisible();
      const targets = await bar.locator("select,button").evaluateAll((elements) =>
        elements.map((element) => ({ width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height })));
      for (const target of targets) {
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }

      // Quote-preserving export from the owner's currently chosen list.
      const [firstDownload] = await Promise.all([
        page.waitForEvent("download"),
        exportButton.click(),
      ]);
      const firstCsv = await readFile(await firstDownload.path(), "utf8");
      expect(firstCsv).toContain('AAPL,"Core, US"');
      expect(firstCsv).toContain('MSFT,"Core ""US"""');

      // Native picker binds the selected target, not the hidden desktop rail.
      await bar.locator("select").selectOption("CSV Target");
      const filePromise = page.waitForEvent("filechooser");
      await importButton.click();
      const picker = await filePromise;
      await picker.setFiles({
        name: "watchlist.csv",
        mimeType: "text/csv",
        buffer: Buffer.from('\uFEFFsymbol,section\r\nNVDA,"Growth, US"\r\nMSFT,Core\r\n'),
      });
      await expect(page.getByRole("status").filter({
        hasText: lang === "en" ? "Imported 2 symbols into CSV Target" : "已向 CSV Target 导入 2 个代码",
      })).toBeVisible({ timeout: 30_000 });

      const [secondDownload] = await Promise.all([
        page.waitForEvent("download"),
        exportButton.click(),
      ]);
      const secondCsv = await readFile(await secondDownload.path(), "utf8");
      expect(secondCsv).toContain('NVDA,"Growth, US"');
      expect(secondCsv).toContain("MSFT,Core");

      // A spreadsheet-formula hazard blocks all URL creation, even on touch UI.
      await bar.locator("select").selectOption("CSV Hazard");
      await page.evaluate(() => {
        const global = window as typeof window & { __compactCsvUrls?: number };
        global.__compactCsvUrls = 0;
        const original = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (blob) => { global.__compactCsvUrls!++; return original(blob); };
      });
      await exportButton.click();
      await expect(page.getByRole("alert").filter({
        hasText: lang === "en" ? "CSV export blocked" : "CSV 导出已阻止",
      })).toBeVisible();
      expect(await page.evaluate(() =>
        (window as typeof window & { __compactCsvUrls?: number }).__compactCsvUrls)).toBe(0);
    });
}
