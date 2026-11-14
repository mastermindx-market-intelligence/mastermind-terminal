import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { buildSync } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// This is the incumbent synthetic component-test seam, not a deployed route or
// recovered browser/Paper session. Real production components and CSS consume
// real producer-shaped fixtures; only Next navigation and identity are mocked.
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
const fixturePaths = ["macro_economy_views.json", "macro_economy_overview.json", "macro_payroll_revisions.json"];
const fixtureBytes = fixturePaths.map(name => readFileSync(path.join(root, "lib/__tests__/fixtures", name), "utf8"));
const [views, overview, payroll] = fixtureBytes.map(value => JSON.parse(value));
const fixtureDigests = Object.fromEntries(fixturePaths.map((name, i) => [name, createHash("sha256").update(fixtureBytes[i]).digest("hex")]));

async function openSpecimen(page: Page, lang: "en" | "zh", theme: "dark" | "light", availableInflation = false) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/shared-shell/today**", route => {
    const workspace = new URL(route.request().url()).searchParams.get("workspace");
    const payload = structuredClone(workspace === "labor_markets" ? payroll : workspace ? views[workspace] : overview);
    if (!payload) return route.fulfill({ status: 404, json: { unavailable: true } });
    if (availableInflation && workspace === "inflation_system") {
      // Deliberate test values, including zero; never replace a source fixture on disk.
      const values: Record<string, string> = { headline_cpi_yoy_pct: "2.40", core_cpi_yoy_pct: "2.80", headline_cpi_mom_pct: "0.00", core_cpi_mom_pct: "0.20" };
      for (const metric of payload.selected_workspace.view.metrics) if (metric.metric_id in values) {
        metric.value = { en: values[metric.metric_id], zh: values[metric.metric_id] };
        metric.value_raw = Number(values[metric.metric_id]); metric.reference_period = "2026-10";
        metric.freshness = { en: "Older input", zh: "较早的数据" };
      }
    }
    return route.fulfill({ json: payload });
  });
  await page.route("**/native-macro-economy-component**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic native Economy component verification</title></head><body><div id="root"></div></body></html>' }));
  await page.goto(`/native-macro-economy-component?lang=${lang}&theme=${theme}`);
  // Match the content width available beside an expanded desktop rail, without
  // fabricating the shared-shell chrome or claiming route-admission coverage.
  await page.addStyleTag({ content: css + "\nhtml,body,#root{height:100%;margin:0}#root>main{height:100%;overflow:auto;max-width:100%;width:100%;margin:0;padding:0}@media(min-width:901px){#root{width:calc(100% - 200px);margin-left:200px}}" });
  await page.addScriptTag({ content: js });
  await expect(page.locator("[data-macro-economy]")).toHaveAttribute("data-read-state", "ready");
  return errors;
}

async function capture(page: Page, info: TestInfo, name: string, lang: string, theme: string) {
  const main = page.locator("main[data-native-macro-economy]");
  expect(await main.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await main.locator("iframe").count()).toBe(0);
  await main.screenshot({ animations: "disabled", path: info.outputPath(`${name}-${lang}-${theme}.png`) });
  await info.attach(`${name}-binding`, { contentType: "application/json", body: JSON.stringify({ synthetic_component: true, checkout: process.env.GITHUB_SHA ?? null, fixtureDigests, route: page.url(), viewport: page.viewportSize(), contentWidth: await main.evaluate(node => node.clientWidth), lang, theme }) });
}

async function visitWorkspace(page: Page, id: string, title: string, lang: "en" | "zh") {
  const chooser = page.getByRole("combobox", { name: lang === "zh" ? "探索工作区" : "Explore a workspace", exact: true });
  if (await chooser.isVisible()) await chooser.selectOption(id);
  else {
    const link = page.getByRole("link", { name: title + " →", exact: true });
    if (await link.count()) await link.click();
    else await page.getByRole("navigation", { name: lang === "zh" ? "探索工作区" : "Explore a workspace", exact: true }).getByRole("link", { name: title, exact: true }).click();
  }
  await expect(page.locator(`[data-macro-economy-workspace="${id}"]`)).toHaveAttribute("data-read-state", "ready");
  await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
}

for (const lang of ["en", "zh"] as const) for (const theme of ["dark", "light"] as const) {
  test(`native Economy overview to evidence and retained study · ${lang} · ${theme}`, async ({ page }, info) => {
    const errors = await openSpecimen(page, lang, theme), zh = lang === "zh";
    await expect(page.getByRole("heading", { name: zh ? "一眼看懂经济环境。" : "Economy at a glance.", exact: true })).toBeVisible();
    await expect(page.locator('[data-macro-economy] a[href="/macro.html"]').first()).toBeVisible();
    await capture(page, info, "economy-overview", lang, theme);
    await visitWorkspace(page, "liquidity_regime", zh ? "货币与融资" : "Money & funding", lang);
    await expect(page.locator("[data-economic-reading-context]")).toContainText(views.liquidity_regime.selected_workspace.view.implications.entries[0].text[lang]);
    await capture(page, info, "money-overview", lang, theme);
    const sources = page.getByRole("button", { name: zh ? "来源与计算" : "Sources & calculation", exact: true }).first();
    await sources.click();
    const evidence = page.locator("[data-economic-evidence]");
    await expect(evidence).toBeVisible(); await expect(evidence).toBeFocused();
    await capture(page, info, "money-evidence", lang, theme);
    await evidence.getByRole("button", { name: zh ? "关闭来源 ×" : "Close sources ×", exact: true }).click();
    await expect(evidence).toHaveCount(0); await expect(sources).toBeFocused();

    await visitWorkspace(page, "inflation_system", zh ? "通货膨胀" : "Inflation", lang);
    await expect(page.locator("[data-inflation-rate] strong")).toHaveText(["—", "—", "—", "—"]);
    await expect(page.getByRole("heading", { name: zh ? "价格水平" : "Price levels", exact: true })).toBeVisible();
    await capture(page, info, "inflation-unavailable-rates", lang, theme);
    await page.getByRole("combobox", { name: zh ? "时间范围" : "Time range", exact: true }).selectOption("published");
    if ((page.viewportSize()?.width ?? 0) <= 900) {
      const table = page.getByRole("button", { name: zh ? "表格" : "Table", exact: true });
      expect((await table.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const svg = page.locator('[data-macro-economy-workspace="inflation_system"] svg').first();
    await svg.scrollIntoViewIfNeeded();
    // Reproduce a CSS-scaled chart: pointer pixels must map back to SVG units.
    await svg.evaluate(node => { node.style.transform = "scale(0.65)"; node.style.transformOrigin = "top left"; });
    const point = await svg.locator("circle").nth(4).evaluate(node => {
      const svg = (node as SVGGraphicsElement).ownerSVGElement!, bounds = svg.getBoundingClientRect();
      return { x: bounds.left + Number(node.getAttribute("cx")) * bounds.width / svg.viewBox.baseVal.width,
        y: bounds.top + Number(node.getAttribute("cy")) * bounds.height / svg.viewBox.baseVal.height };
    });
    await page.mouse.click(point.x, point.y);
    const expected = views.inflation_system.selected_workspace.view.series.entries[0].points.filter((row: { v: number | null }) => row.v !== null)[4];
    await expect(page.getByRole("slider", { name: zh ? "选择观察值" : "Select observation", exact: true })).toHaveAttribute("aria-valuetext", new RegExp(`^${expected.t}:`));
    expect(new URL(page.url()).searchParams.get("observation")).toBe(expected.t);
    await svg.evaluate(node => { node.style.transform = ""; });
    await page.getByRole("button", { name: zh ? "表格" : "Table", exact: true }).click();
    await expect(page.locator('table tr[data-selected="true"]')).toContainText(expected.t);
    await expect(page.getByRole("region", { name: zh ? "历史观察值" : "Historical observations", exact: true })).toContainText(zh ? "无观察值" : "No observation");
    await capture(page, info, "inflation-history-table", lang, theme);

    await visitWorkspace(page, "rates_curves", zh ? "利率与收益率曲线" : "Rates & the curve", lang);
    await page.getByRole("combobox", { name: zh ? "选择期限" : "Select a maturity", exact: true }).selectOption("2y");
    await page.getByRole("combobox", { name: zh ? "对比" : "Comparison", exact: true }).selectOption("prior_month");
    await page.getByRole("button", { name: zh ? "表格" : "Table", exact: true }).click();
    const retained = page.url();
    const tenor = views.rates_curves.selected_workspace.view.curve_hero.tenors.find((row: { tenor: string }) => row.tenor === "2y");
    await expect(page.locator('table tr[data-selected="true"]')).toContainText(tenor.label[lang]);
    await expect(page.locator('table tr[data-selected="true"]')).toContainText(tenor.as_of_tenor);
    await expect(page.locator('table tr[data-selected="true"]')).toContainText(tenor.prior_month_as_of);
    await capture(page, info, "rates-dated-comparison", lang, theme);
    await page.getByRole("button", { name: zh ? "驱动因素" : "Drivers", exact: true }).click();
    await page.goBack(); await expect(page).toHaveURL(retained);
    await expect(page.getByRole("combobox", { name: zh ? "选择期限" : "Select a maturity", exact: true })).toHaveValue("2y");
    await expect(page.locator('table tr[data-selected="true"]')).toContainText(tenor.label[lang]);

    await visitWorkspace(page, "labor_markets", zh ? "就业" : "Jobs", lang);
    await page.getByRole("button", { name: zh ? "非农就业修订" : "Payroll revisions", exact: true }).click();
    await expect(page.locator("[data-payroll-revisions]")).toBeVisible();
    await expect(page.locator("[data-payroll-revisions]")).toContainText(zh ? "最早保留读数可能晚于首次发布" : "The earliest retained reading may be later than the first release");
    await capture(page, info, "payroll-retained-revisions", lang, theme);
    await page.evaluate(() => window.dispatchEvent(new Event("native-economy-fixture:signout")));
    await expect(page.locator("[data-payroll-revisions]")).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText(zh ? "私人读数已清除" : "Private readings have been cleared");
    expect(errors).toEqual([]);
  });
}

test("native Inflation preserves published rates and zero separately from index history", async ({ page }, info) => {
  const errors = await openSpecimen(page, "en", "dark", true);
  await visitWorkspace(page, "inflation_system", "Inflation", "en");
  await expect(page.locator("[data-inflation-rate] strong")).toHaveText(["2.40%", "2.80%", "0.00%", "0.20%"]);
  await expect(page.locator('[data-inflation-rate="headline_cpi_mom_pct"]')).toContainText("2026-10");
  await expect(page.locator('[data-inflation-rate="headline_cpi_mom_pct"]')).toContainText("Older input");
  await capture(page, info, "inflation-synthetic-published-rates", "en", "dark");
  await page.locator('[data-inflation-rate="headline_cpi_mom_pct"]').click();
  expect(new URL(page.url()).searchParams.get("evidence")).toBe("metric:headline_cpi_mom_pct");
  await expect(page.locator("[data-economic-evidence]")).toContainText("0.00");
  expect(errors).toEqual([]);
});
