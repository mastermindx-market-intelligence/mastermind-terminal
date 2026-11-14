import { expect, test, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";

// Real Route -> Reader -> Workspace -> Curve -> Evidence in a browser, with
// fixture-only Next/auth/network boundaries. This is not production admission,
// live-source or deployed authenticated proof.
const root = process.cwd(), mock = path.join(root, "e2e/fixtures/nativeMacroEconomyMocks.tsx");
const built = buildSync({
  entryPoints: [path.join(root, "e2e/fixtures/nativeMacroEconomy.tsx")], bundle: true,
  outdir: "/tmp/native-macro-economy-component", write: false, jsx: "automatic", format: "iife",
  alias: { "next/link": mock, "next/navigation": mock, "@/lib/i18n": mock, "@/lib/supabase/client": mock, "@": root },
  define: { "process.env.NODE_ENV": '"development"' },
});
const js = built.outputFiles.find(file => file.path.endsWith(".js"))!.text;
const css = ["app/globals.css", "components/chrome/shared-shell/shared-shell.css"].map(file => readFileSync(path.join(root, file), "utf8")).join("\n")
  .replace('@import "tailwindcss";', "").replace('@source not "../public/data";', "") + built.outputFiles.find(file => file.path.endsWith(".css"))!.text;
const fixture = JSON.parse(readFileSync(path.join(root, "lib/__tests__/fixtures/macro_economy_views.json"), "utf8"));
const overview = JSON.parse(readFileSync(path.join(root, "lib/__tests__/fixtures/macro_economy_overview.json"), "utf8"));

async function specimen(page: Page, lang: "en" | "zh", theme: "dark" | "light", payload = fixture.rates_curves) {
  const reads: string[] = [];
  const html = '<!doctype html><html lang="' + lang + '" data-theme="' + theme + '"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic native Economy qualification</title></head><body><div id="root"></div></body></html>';
  await page.route(/\/macro_(monetary|rates_curves)\.html(?:\?.*)?$/, route => route.fulfill({ contentType: "text/html", body: html }));
  await page.route("**/api/shared-shell/today**", route => {
    const request = route.request(), url = new URL(request.url());
    expect(request.method()).toBe("GET"); expect(url.pathname).toBe("/api/shared-shell/today");
    const workspace = url.searchParams.get("workspace");
    reads.push(workspace ?? "overview");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace === "rates_curves" ? payload : overview) });
  });
  const open = async (url: string) => {
    await page.goto(url);
    await page.addStyleTag({ content: css + "\nhtml,body{height:100%;margin:0}#root{height:100dvh}" });
    await page.addScriptTag({ content: js });
  };
  return { reads, open };
}

for (const lang of ["en", "zh"] as const) for (const theme of ["dark", "light"] as const) {
  test(`native Economy curve-to-source journey · ${lang} · ${theme}`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const { reads, open } = await specimen(page, lang, theme);
    await open("/macro_monetary.html?workspaceMarket=us");
    await expect(page.locator("[data-macro-economy]")).toHaveAttribute("data-read-state", "ready");
    await page.locator('a[href*="/macro_rates_curves.html"]').first().click();
    const workspace = page.locator('[data-macro-economy-workspace="rates_curves"]');
    await expect(workspace).toHaveAttribute("data-read-state", "ready");
    await expect(page.getByRole("heading", { name: lang === "zh" ? "利率与收益率曲线" : "Rates & the curve", exact: true })).toBeVisible();
    const maturity = page.getByLabel(lang === "zh" ? "选择期限" : "Select a maturity", { exact: true });
    const comparison = page.getByLabel(lang === "zh" ? "对比" : "Comparison", { exact: true });
    await maturity.selectOption("2y"); await comparison.selectOption("prior_month");
    await page.getByRole("button", { name: lang === "zh" ? "表格" : "Table", exact: true }).click();
    const selectedRow = workspace.locator("tr[data-selected]");
    await expect(selectedRow).toContainText("3.543"); await expect(selectedRow).toContainText("3.477");
    await expect(selectedRow).toContainText("2026-11-13"); await expect(selectedRow).toContainText("2026-10-14");
    const trigger = workspace.locator('[data-curve-source="dgs2"]');
    await trigger.scrollIntoViewIfNeeded();
    const scroller = page.locator("#shared-shell-content");
    await trigger.evaluate(el => {
      const owner = document.getElementById("shared-shell-content")!;
      owner.scrollTop += el.getBoundingClientRect().top - owner.getBoundingClientRect().top - 96;
    });
    await expect(trigger).toBeInViewport({ ratio: 1 });
    const origin = await scroller.evaluate(el => ({ top: el.scrollTop, windowY: scrollY }));
    expect(origin.top).toBeGreaterThan(0);
    const returned = async () => {
      await expect(trigger).toBeFocused();
      await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeCloseTo(origin.top, 0);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(origin.windowY, 0);
      await expect.poll(() => new URL(page.url()).searchParams.get("evidence")).toBeNull();
    };
    const exactSource = async () => {
      const panel = workspace.locator("[data-economic-evidence]");
      await expect(panel).toBeFocused();
      await expect(panel.getByRole("heading", { level: 3 })).toHaveCount(1);
      await expect(panel.getByRole("heading", { name: lang === "zh" ? "2-year（DGS2，经FRED）" : "2-year (DGS2, via FRED)", exact: true })).toBeVisible();
      await expect(panel.locator("[data-source-unlinked]")).toHaveCount(0);
      await expect(page).toHaveURL(/[?&]evidence=dgs2(?:&|$)/);
    };
    if ((page.viewportSize()?.width ?? 0) <= 900) {
      const box = await trigger.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: info.outputPath(`selected-curve-${lang}-${theme}.png`) });
    await trigger.click();
    const evidence = workspace.locator("[data-economic-evidence]");
    await exactSource();
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(origin.top + 1);
    for (const surface of [page.locator("#root"), scroller, workspace, evidence]) {
      expect(await surface.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`exact-source-${lang}-${theme}.png`) });
    await evidence.getByRole("button", { name: lang === "zh" ? "关闭来源 ×" : "Close sources ×", exact: true }).click();
    await expect(evidence).toHaveCount(0); await returned();
    await expect(maturity).toHaveValue("2y"); await expect(comparison).toHaveValue("prior_month");
    await expect(selectedRow).toContainText("3.543");
    await trigger.click(); await exactSource();
    await page.goBack();
    await expect(evidence).toHaveCount(0); await returned();
    await expect(maturity).toHaveValue("2y"); await expect(comparison).toHaveValue("prior_month");
    await page.goForward(); await exactSource();
    await evidence.press("Escape");
    await expect(evidence).toHaveCount(0); await returned();
    expect(reads).toEqual(["overview", "rates_curves"]);
    expect(await workspace.locator("iframe").count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await trigger.click(); await exactSource(); const direct = page.url(); await open(direct);
    const directEvidence = page.locator("[data-economic-evidence]");
    await exactSource();
    await directEvidence.press("Escape");
    await expect(page.getByRole("button", { name: lang === "zh" ? "来源与计算" : "Sources & calculation", exact: true })).toBeFocused();
    await expect(page.getByLabel(lang === "zh" ? "选择期限" : "Select a maturity", { exact: true })).toHaveValue("2y");
    expect(reads).toEqual(["overview", "rates_curves", "rates_curves"]);
    expect(errors).toEqual([]);
  });
}

test("older publications stay readable without a guessed maturity source", async ({ page }) => {
  const payload = structuredClone(fixture.rates_curves);
  for (const row of payload.selected_workspace.view.curve_hero.tenors) delete row.source_binding;
  const { open } = await specimen(page, "en", "dark", payload);
  await open("/macro_rates_curves.html?workspaceMarket=us&tenor=2y");
  await expect(page.locator('[data-macro-economy-workspace="rates_curves"]')).toHaveAttribute("data-read-state", "ready");
  await expect(page.locator("[data-curve-source]")).toHaveCount(0);
  await expect(page.locator("[data-curve-source-unlinked]")).toBeVisible();
  await expect(page.locator("[data-curve-source-unlinked]")).toContainText("no verified source link");
});

test("an unsupported market does not mount or fetch the US Economy reader", async ({ page }) => {
  const { open, reads } = await specimen(page, "en", "light");
  await open("/macro_rates_curves.html?workspaceMarket=cn");
  await expect(page.getByRole("heading", { name: "This workspace is not available for this market yet", exact: true })).toBeVisible();
  await expect(page.locator("[data-native-macro-economy]")).toHaveCount(0);
  expect(reads).toEqual([]);
});

