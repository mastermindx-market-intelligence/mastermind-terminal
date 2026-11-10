import { expect, test, type Locator, type Page } from "@playwright/test";

function fixture() {
  const annual = {
    periods: ["FY2023", "FY2024", "FY2025"],
    period_end: ["2023-12-31", "2024-12-31", "2025-12-31"],
    source_market: "us", source_family: "industrial", reporting_cadence: "annual",
    flow_basis: "as_reported", normalization_method: ["as_reported", "as_reported", "as_reported"],
    income: { revenue: [100_000_000, 200_000_000, 300_000_000] }, balance: {}, cashflow: {},
  };
  const quarterly = {
    periods: ["Q1 2026", "Q2 2026"], period_end: ["2026-03-31", "2026-06-30"],
    source_market: "us", source_family: "industrial", reporting_cadence: "quarterly",
    flow_basis: "discrete_period", normalization_method: ["as_reported", "as_reported"],
    income: { revenue: [25_000_000, 40_000_000] }, balance: {}, cashflow: {},
  };
  return {
    schema: "mastermind.fund/v1", ticker: "NVDA", asof: "2026-09-23",
    quote_currency: "USD", stmt_currency: "USD",
    src: { statements: "synthetic_fixture", estimates: null, dividends: null },
    profile: null, stats: { shares_out: 200_000_000, float_shares: 150_000_000, num_holders: 1_234_567 },
    statements: { annual, quarterly },
    ratios: {
      periods: ["FY2023", "FY2024", "FY2025"], pe: [10, 20, 30], ps: [2, 3, 4], pb: [1, 1.2, 1.5],
      current: { pe_ttm: 25, ps: 4.5, pb: 2, gross_margin: 0.4875, net_margin: 0.2, roe: 0.1, current_ratio: 123456.78 },
    },
    earnings: null, estimates: null, analyst: null, dividends: null, ownership: null, guidance: null, segments: null,
  };
}

async function openStatistics(page: Page, surface: "analysis" | "terminal", lang: "en" | "zh") {
  const theme = lang === "zh" && (surface === "terminal" || process.env.MMX_SHARED_SHELL === "1") ? "light" : "dark";
  let fundReads = 0;
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("mmx.shell.theme", theme);
  }, { lang, theme });
  await page.route("**/api/**", route => route.fulfill({ status: 503, json: { error: "local_statistics_table_fixture" } }));
  await page.route("**/NVDA.fund.json**", route => {
    fundReads++;
    return route.fulfill({ json: fixture() });
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

async function readingPosition(cell: Locator, wrapper: Locator) {
  // Vertical reading position is deliberate; horizontal scrolling must remain at zero.
  await cell.evaluate(el => el.scrollIntoView({ block: "center", inline: "nearest" }));
  await wrapper.evaluate(el => { el.scrollLeft = 0; });
  await expect(wrapper).toHaveJSProperty("scrollLeft", 0);
}

async function textGeometry(cell: Locator) {
  return cell.evaluate(el => {
    const wrapper = el.closest(".fin-table-scroll")!;
    const clip = wrapper.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const hit = document.elementFromPoint(text.x + text.width / 2, text.y + text.height / 2);
    return {
      text: el.textContent, left: text.left, right: text.right, width: text.width,
      clipLeft: Math.max(0, clip.left), clipRight: Math.min(innerWidth, clip.right),
      scrollLeft: wrapper.scrollLeft, scrollWidth: wrapper.scrollWidth, clientWidth: wrapper.clientWidth,
      hit: hit === el || el.contains(hit),
    };
  });
}

async function visibleValue(cell: Locator, wrapper: Locator, value: string) {
  await expect(cell).toHaveText(value);
  await readingPosition(cell, wrapper);
  await expect.poll(async () => {
    const r = await textGeometry(cell);
    return r.width > 0 && r.left >= r.clipLeft - 1 && r.right <= r.clipRight + 1 && r.hit && r.scrollLeft === 0;
  }, { message: `Current value ${value} is fully visible at horizontal offset zero` }).toBe(true);
  expect(await wrapper.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

for (const surface of ["analysis", "terminal"] as const) for (const lang of ["en", "zh"] as const) {
  test(`${surface} ${lang}: current values fit beside their labels`, async ({ page }, info) => {
    if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    const { statistics, fundReads } = await openStatistics(page, surface, lang);
    const table = (en: string, zh: string) => statistics.locator("table").filter({ has: page.getByText(lang === "zh" ? zh : en, { exact: true }) });
    const key = table("Key stats", "关键指标");
    const profit = table("Profitability ratios", "盈利比率");
    const valuation = table("Valuation ratios", "估值比率");
    const keyWrap = key.locator("..");
    const profitWrap = profit.locator("..");
    const value = (target: Locator, en: string, zh: string) => target.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: lang === "zh" ? zh : en, exact: true }),
    }).locator("td");
    const shares = value(key, "Total shares outstanding", "总股本");
    const holders = value(key, "Number of shareholders", "股东人数");
    const gross = value(profit, "Gross margin", "毛利率");
    const ratio = value(profit, "Current ratio", "流动比率");
    const reads = fundReads();
    expect(reads).toBeGreaterThan(0);
    await expect(key.getByRole("columnheader")).toHaveCount(2);
    await expect(profit.getByRole("columnheader")).toHaveCount(2);
    await expect(valuation).toContainText("FY2025");
    await expect(valuation).toContainText("30.00");

    const capture = (info.project.name === "desktop" && lang === "en") || info.project.name === "mobile";
    await visibleValue(shares, keyWrap, "200.00M");
    console.info("statistics current-value geometry", JSON.stringify({ surface, lang, ...await textGeometry(shares) }));
    if (capture) await page.screenshot({ path: info.outputPath(`${surface}-${lang}-key-stats.png`) });
    await visibleValue(holders, keyWrap, "1,234,567");
    await visibleValue(gross, profitWrap, "48.75%");
    await visibleValue(ratio, profitWrap, "123456.78");
    if (capture) await page.screenshot({ path: info.outputPath(`${surface}-${lang}-profitability.png`) });

    // Current-only tables fit, while the multi-period history keeps its own scrollport.
    if (info.project.name === "mobile") {
      const historyWrap = valuation.locator("..");
      expect(await historyWrap.evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(true);
      await historyWrap.evaluate(el => { el.scrollLeft = el.scrollWidth; });
      expect(await historyWrap.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      const currentPE = valuation.getByRole("row").filter({
        has: page.getByRole("rowheader", { name: lang === "zh" ? "市盈率" : "Price to earnings ratio", exact: true }),
      }).locator("td").last();
      await expect(currentPE).toHaveText("25.00");
      await currentPE.evaluate(el => el.scrollIntoView({ block: "center", inline: "nearest" }));
      await expect.poll(async () => {
        const r = await textGeometry(currentPE);
        return r.width > 0 && r.left >= r.clipLeft - 1 && r.right <= r.clipRight + 1 && r.hit;
      }).toBe(true);
    }

    const basis = statistics.locator(".fin-stats-hdr .fin-toggle");
    await basis.getByRole("button", { name: lang === "zh" ? "季度" : "Quarterly", exact: true }).click();
    await expect(valuation).toHaveCount(0);
    await visibleValue(shares, keyWrap, "200.00M");
    await visibleValue(ratio, profitWrap, "123456.78");
    await basis.getByRole("button", { name: lang === "zh" ? "年度" : "Annual", exact: true }).click();
    await expect(valuation).toContainText("FY2025");
    await expect(valuation).toContainText("30.00");
    expect(fundReads()).toBe(reads);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
