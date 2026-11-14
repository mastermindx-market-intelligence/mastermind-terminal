import { expect, test, type Page } from "@playwright/test";

type Availability = "both" | "annual" | "semiannual";
function fixture(availability: Availability = "both") {
  const annual = {
    periods: ["FY2023", "FY2024", "FY2025"],
    period_end: ["2023-12-31", "2024-12-31", "2025-12-31"],
    source_market: "us", source_family: "industrial", reporting_cadence: "annual",
    flow_basis: "as_reported", normalization_method: ["as_reported", "as_reported", "as_reported"],
    income: { revenue: [100_000_000, 200_000_000, 300_000_000] }, balance: {}, cashflow: {},
  };
  const interim = availability === "semiannual" ? {
    periods: ["H1 2025", "H2 2025"], period_end: ["2025-06-30", "2025-12-31"],
    source_market: "hk", source_family: "industrial", reporting_cadence: "semiannual",
    flow_basis: "discrete_period", normalization_method: ["as_reported", "as_reported"],
    income: { revenue: [25_000_000, 40_000_000] }, balance: {}, cashflow: {},
  } : {
    periods: ["Q1 2026", "Q2 2026"], period_end: ["2026-03-31", "2026-06-30"],
    source_market: "us", source_family: "industrial", reporting_cadence: "quarterly",
    flow_basis: "discrete_period", normalization_method: ["as_reported", "as_reported"],
    income: { revenue: [25_000_000, 40_000_000] }, balance: {}, cashflow: {},
  };
  return {
    schema: "mastermind.fund/v1", ticker: "NVDA", asof: "2026-09-23",
    quote_currency: "USD", stmt_currency: "USD",
    src: { statements: "synthetic_fixture", estimates: null, dividends: null },
    profile: null, stats: { shares_out: 200_000_000, float_shares: 150_000_000, num_holders: 321 },
    statements: { annual: availability === "semiannual" ? null : annual, quarterly: availability === "annual" ? null : interim },
    ratios: {
      periods: ["FY2023", "FY2024", "FY2025"], pe: [10, 20, 30], ps: [2, 3, 4], pb: [1, 1.2, 1.5],
      current: { pe_ttm: 25, ps: 4.5, pb: 2, net_margin: 0.2, roe: 0.1 },
    },
    earnings: null, estimates: null, analyst: null,
    dividends: null, ownership: null, guidance: null, segments: null,
  };
}

async function openStatistics(page: Page, surface: "analysis" | "terminal", lang: "en" | "zh", availability: Availability = "both") {
  const theme = lang === "zh" && (surface === "terminal" || process.env.MMX_SHARED_SHELL === "1") ? "light" : "dark";
  let fundReads = 0;
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("mmx.shell.theme", theme);
  }, { lang, theme });
  await page.route("**/api/**", route => route.fulfill({ status: 503, json: { error: "local_statistics_fixture" } }));
  await page.route("**/NVDA.fund.json**", route => {
    fundReads++;
    return route.fulfill({ json: fixture(availability) });
  });
  await page.goto(surface === "analysis" ? "/analysis?symbol=NVDA&page=statistics" : "/terminal?symbol=NVDA");
  await expect(page.locator(surface === "analysis" ? ".analysis-shell" : ".workspace")).toBeVisible();
  const statistics = page.locator(".fin-body:has(> .fin-stats-hdr)");
  if (surface === "terminal") {
    await expect.poll(async () => {
      if (await statistics.count()) return true;
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:open-pane", { detail: "statistics" })));
      return (await statistics.count()) === 1;
    }, { timeout: 15_000 }).toBe(true);
  }
  await expect(statistics).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  return { statistics, fundReads: () => fundReads };
}

for (const surface of ["analysis", "terminal"] as const) for (const lang of ["en", "zh"] as const) {
  test(`${surface} ${lang}: current metrics and annual ratio history remain available together`, async ({ page }, info) => {
    if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    const { statistics, fundReads } = await openStatistics(page, surface, lang);
    const valuation = statistics.locator("table").filter({ hasText: lang === "zh" ? "估值比率" : "Valuation ratios" });
    const keyStats = statistics.locator("table").filter({ hasText: lang === "zh" ? "关键指标" : "Key stats" });
    await expect(statistics.locator(".fin-bar")).toHaveCount(6);
    await expect(valuation).toContainText("FY2025");
    await expect(valuation).toContainText("30.00");
    await expect(valuation).toContainText("25.00");
    await expect(keyStats).toContainText("200.00M");
    await expect(statistics.locator(".fin-stats-hdr")).toContainText(lang === "zh" ? "当前快照 · 年度估值历史" : "Current snapshot · annual ratio history");
    // There is no quarterly ratio series; do not offer a control that hides current values.
    await expect(statistics.locator(".fin-stats-hdr button")).toHaveCount(0);
    expect(fundReads()).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if ((info.project.name === "desktop" && lang === "en") || (info.project.name === "mobile" && lang === "zh")) {
      await page.screenshot({ path: info.outputPath(`${surface}-${lang}-current-ratios.png`) });
    }
  });
}

for (const availability of ["annual", "semiannual"] as const) {
  test(`${availability}-only statements do not remove published current ratios`, async ({ page }, info) => {
    const lang = info.project.name === "mobile" ? "zh" : "en";
    const { statistics } = await openStatistics(page, "analysis", lang, availability);
    const valuation = statistics.locator("table").filter({ hasText: lang === "zh" ? "估值比率" : "Valuation ratios" });
    await expect(valuation).toContainText("25.00");
    await expect(valuation).toContainText("FY2025");
    await expect(statistics.locator(".fin-stats-hdr button")).toHaveCount(0);
    await expect(statistics.getByText(lang === "zh" ? "暂无半年度估值比率" : "No semiannual valuation ratios")).toHaveCount(0);
  });
}
