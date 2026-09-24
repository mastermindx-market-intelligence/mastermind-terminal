import { expect, test, type Page } from "@playwright/test";

const overviewFundFixture = {
  schema: "mastermind.fund/v1",
  ticker: "NVDA",
  asof: "2026-09-23",
  quote_currency: "USD",
  stmt_currency: "USD",
  src: { statements: "fixture", estimates: null, dividends: "fixture" },
  profile: {
    website: "https://www.nvidia.com",
    employees: 36000,
    sector: "Technology",
    industry: "Semiconductors",
    description: "NVIDIA designs accelerated computing platforms for graphics, data center, networking, and AI workloads.",
    founded: "1993",
    hq: "Santa Clara, CA",
  },
  stats: {
    mktcap: 4_000_000_000_000,
    shares_out: 24_000_000_000,
    float_shares: 23_500_000_000,
    inst_pct: 0.68,
    insider_pct: 0.04,
    beta: 1.9,
    num_holders: 6400,
  },
  statements: {
    annual: {
      periods: ["FY2023", "FY2024", "FY2025"],
      period_end: ["2024-01-28", "2025-01-26", "2026-01-25"],
      source_market: "us",
      source_family: "industrial",
      source_family_by_period: ["industrial", "industrial", "industrial"],
      reporting_cadence: "annual",
      flow_basis: "as_reported",
      normalization_method: ["as_reported", "as_reported", "as_reported"],
      income: {
        revenue: [60_000_000_000, 90_000_000_000, 130_000_000_000],
        cogs: [18_000_000_000, 25_000_000_000, 32_000_000_000],
        gross_profit: [42_000_000_000, 65_000_000_000, 98_000_000_000],
        opex: [11_000_000_000, 15_000_000_000, 20_000_000_000],
        op_income: [31_000_000_000, 50_000_000_000, 78_000_000_000],
        nonop_income: [1_000_000_000, 1_100_000_000, 1_200_000_000],
        pretax_income: [32_000_000_000, 51_100_000_000, 79_200_000_000],
        taxes: [4_000_000_000, 6_000_000_000, 9_000_000_000],
        net_income: [28_000_000_000, 45_100_000_000, 70_200_000_000],
        eps_basic: [1.2, 1.9, 2.95],
        eps_diluted: [1.18, 1.86, 2.9],
        ebitda: [34_000_000_000, 54_000_000_000, 83_000_000_000],
      },
      balance: {
        assets: [70_000_000_000, 95_000_000_000, 125_000_000_000],
        assets_st: [35_000_000_000, 48_000_000_000, 65_000_000_000],
        assets_lt: [35_000_000_000, 47_000_000_000, 60_000_000_000],
        liabilities: [30_000_000_000, 38_000_000_000, 45_000_000_000],
        liab_st: [12_000_000_000, 15_000_000_000, 18_000_000_000],
        liab_lt: [18_000_000_000, 23_000_000_000, 27_000_000_000],
        equity: [40_000_000_000, 57_000_000_000, 80_000_000_000],
        debt: [11_000_000_000, 10_000_000_000, 9_000_000_000],
        net_debt: [-3_000_000_000, -9_000_000_000, -18_000_000_000],
        cash: [14_000_000_000, 19_000_000_000, 27_000_000_000],
      },
      cashflow: {
        cfo: [25_000_000_000, 43_000_000_000, 69_000_000_000],
        cfi: [-8_000_000_000, -11_000_000_000, -15_000_000_000],
        cff: [-10_000_000_000, -14_000_000_000, -20_000_000_000],
        capex: [4_000_000_000, 5_000_000_000, 7_000_000_000],
        fcf: [21_000_000_000, 38_000_000_000, 62_000_000_000],
      },
    },
    quarterly: null,
  },
  ratios: {
    periods: ["FY2021", "FY2022", "FY2023", "FY2024", "FY2025"],
    pe: [28, 24, 31, 36, 42],
    ps: [12, 10, 16, 21, 27],
    pb: [18, 17, 21, 28, 34],
    pcf: [25, 22, 30, 35, 40],
    ev: [],
    ev_ebitda: [24, 21, 28, 33, 38],
    current: {
      pe_ttm: 42,
      pe_fwd: 35,
      ps: 27,
      pb: 34,
      ev_ebitda: 38,
      ev_sales: 26,
      ev_ebit: 44,
      p_fcf: 39,
      div_yield: 0.0003,
      payout: 0.012,
      gross_margin: 0.75,
      net_margin: 0.54,
      roe: 0.62,
      roa: 0.41,
      debt_to_equity: 0.11,
      current_ratio: 3.1,
    },
  },
  earnings: { next_date: null, next_period: null, next_eps_est: null, next_rev_est: null, q: [], fy: [] },
  estimates: null,
  analyst: null,
  dividends: { never_paid: false, yield_ttm: 0.0003, payout_ratio: 0.012, events: [], splits: [] },
  ownership: { free_float_pct: 0.95, closely_held_pct: 0.05, top_inst: [] },
  guidance: null,
  segments: null,
};

async function installOverviewFixture(page: Page) {
  await page.route("**/NVDA.fund.json**", async (route) => route.fulfill({ json: overviewFundFixture }));
}

async function installFinancialsFixture(page: Page) {
  await page.route("**/NVDA.fund.json**", async (route) => route.fulfill({ json: overviewFundFixture }));
}

/**
 * Research Workspace navigation vNext keeps the existing FinPage URL/deep-link
 * authority while projecting those pages into scalable page families.
 */
test("company page families preserve exact FinPage deep links", async ({ page }) => {
  await page.goto("/analysis?symbol=NVDA&page=statements");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const compact = page.viewportSize()!.width <= 860;
  if (compact) {
    const familyTrigger = page.locator(".fin-family-mobile-trigger");
    await expect(familyTrigger).toContainText("Financials");
    await expect(page.locator(".fin-local-mobile-tab.on")).toHaveText("Statements");
    await page.locator(".fin-local-mobile-tab", { hasText: "Revenue" }).click();
  } else {
    await expect(page.locator('[data-fin-family="financials"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-fin-local="statements"]')).toHaveAttribute("aria-selected", "true");
    await page.locator('[data-fin-local="revenue"]').click();
  }

  await expect(page).toHaveURL(/[?&]page=revenue\b/);
  await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.has("pane"))).toBe(false);
});

test("family selection lands on the existing family default without a second router", async ({ page }) => {
  await page.goto("/analysis?symbol=NVDA&page=overview");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const compact = page.viewportSize()!.width <= 860;
  if (compact) {
    await page.locator(".fin-family-mobile-trigger").click();
    const sheet = page.locator(".fin-family-sheet");
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-fin-family-sheet="market"]').click();
    await expect(page.locator(".fin-local-mobile-tab.on")).toHaveText("Technicals");
    await page.locator(".fin-local-mobile-tab", { hasText: "Seasonality" }).click();
    await expect(page).toHaveURL(/[?&]page=seasonals\b/);
  } else {
    await page.locator('[data-fin-family="earnings"]').click();
    await expect(page).toHaveURL(/[?&]page=earnings\b/);
    await expect(page.locator('[data-fin-local="earnings"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-fin-local="forecast"]')).toContainText("Analyst");
    await expect(page.locator('[data-fin-local="transcripts"]')).toContainText("Transcripts");
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});


test("Overview vNext keeps snapshot, ownership, capital and valuation in one research canvas", async ({ page }) => {
  await installOverviewFixture(page);
  await page.goto("/analysis?symbol=NVDA&page=overview");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const overview = page.locator("[data-overview-vnext]");
  await expect(overview).toBeVisible({ timeout: 15_000 });
  await expect(overview.locator("[data-overview-vnext-snapshot]")).toContainText("COMPANY SNAPSHOT");
  await expect(overview.locator("[data-overview-vnext-snapshot]")).toContainText("Key facts");
  await expect(overview.locator("[data-overview-vnext-snapshot]")).toContainText("Market cap");
  await expect(overview.locator("[data-overview-vnext-snapshot]")).toContainText("P/E ratio");
  await expect(overview.locator("[data-overview-vnext-snapshot]")).toContainText("Basic EPS");
  await expect(overview.locator("[data-overview-vnext-mid]")).toContainText("Ownership");
  await expect(overview.locator("[data-overview-vnext-mid]")).toContainText("Capital structure");

  const valuation = overview.locator("[data-overview-vnext-valuation]");
  await expect(valuation).toContainText("Valuation");
  await expect(valuation).toContainText("CURRENT");
  await expect(valuation).toContainText("P/E TTM");
  await expect(valuation).toContainText("Historical P/E");
  await expect(valuation).toContainText("Revenue-relative context");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Overview vNext remains bilingual and overflow-safe on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one mobile bilingual Overview contract is sufficient");
  await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
  await installOverviewFixture(page);
  await page.goto("/analysis?symbol=NVDA&page=overview");

  const overview = page.locator("[data-overview-vnext]");
  await expect(overview).toBeVisible({ timeout: 45_000 });
  await expect(overview).toContainText("公司快照");
  await expect(overview).toContainText("关键数据");
  await expect(overview).toContainText("股权结构");
  await expect(overview).toContainText("资本结构");
  await expect(overview).toContainText("估值");
  await expect(overview).toContainText("当前");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Financials vNext keeps statement summary, explorer and integrity on one canonical page", async ({ page }) => {
  await installFinancialsFixture(page);
  await page.goto("/analysis?symbol=NVDA&page=statements");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const financials = page.locator("[data-financials-vnext]");
  await expect(financials).toBeVisible({ timeout: 15_000 });
  await expect(financials.locator("[data-financials-vnext-head]")).toContainText("FINANCIAL STATEMENTS");
  await expect(financials.locator("[data-financials-vnext-head]")).toContainText("Reported fundamentals with source-aware period handling");
  await expect(financials.locator("[data-financials-vnext-head]").getByRole("button", { name: "Annual" })).toBeVisible();
  await expect(financials.locator("[data-financials-vnext-head]").getByRole("button", { name: "Income" })).toBeVisible();
  await expect(financials.locator("[data-financials-vnext-head]").getByRole("button", { name: "Balance" })).toBeVisible();
  await expect(financials.locator("[data-financials-vnext-head]").getByRole("button", { name: "Cash flow" })).toBeVisible();

  const summary = financials.locator("[data-financials-vnext-summary]");
  await expect(summary).toContainText("Revenue");
  await expect(summary).toContainText("Gross profit");
  await expect(summary).toContainText("Operating income");
  await expect(summary).toContainText("Free cash flow");

  await expect(financials.locator("[data-financials-vnext-explorer]")).toContainText("STATEMENT EXPLORER");
  const integrity = financials.locator("[data-financials-vnext-integrity]");
  await expect(integrity).toContainText("Balance-sheet snapshot");
  await expect(integrity).toContainText("Cash conversion");
  await expect(integrity).toContainText("Source & normalization");
  await expect(integrity).toContainText("Reporting cadence");
  await expect(integrity).toContainText("Normalization");
  await expect(integrity).toContainText("Currency");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Financials vNext remains bilingual and overflow-safe on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one mobile bilingual Financials contract is sufficient");
  await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
  await installFinancialsFixture(page);
  await page.goto("/analysis?symbol=NVDA&page=statements");

  const financials = page.locator("[data-financials-vnext]");
  await expect(financials).toBeVisible({ timeout: 45_000 });
  await expect(financials).toContainText("财务报表");
  const summary = financials.locator("[data-financials-vnext-summary]");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("营业收入");
  await expect(summary).toContainText("营业利润");
  await expect(summary).toContainText("自由现金流");
  await expect(financials).toContainText("报表浏览器");
  await expect(financials).toContainText("资产负债表快照");
  await expect(financials).toContainText("现金转换");
  await expect(financials).toContainText("来源与标准化");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Ownership family defaults to Institutional and preserves Insider as its sibling", async ({ page }) => {
  await page.route("**/api/company-intelligence/NVDA**", async (route) => {
    await route.fulfill({
      status: 404,
      json: {
        ok: false,
        state: "error",
        error: { code: "not_found", message: "Company context not covered in navigation fixture", retryable: false },
      },
    });
  });
  await page.goto("/analysis?symbol=NVDA&page=overview");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const compact = page.viewportSize()!.width <= 860;
  if (compact) {
    await page.locator(".fin-family-mobile-trigger").click();
    const sheet = page.locator(".fin-family-sheet");
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-fin-family-sheet="ownership"]').click();
    await expect(page).toHaveURL(/[?&]page=ownership\b/);
    await expect(page.locator(".fin-family-mobile-trigger")).toContainText("Ownership");
    await expect(page.locator(".fin-local-mobile-tab.on")).toHaveText("Institutional");
    await expect(page.locator(".fin-local-mobile-tab", { hasText: "Insider" })).toBeVisible();
    await page.locator(".fin-local-mobile-tab", { hasText: "Insider" }).click();
  } else {
    await page.locator('[data-fin-family="ownership"]').click();
    await expect(page).toHaveURL(/[?&]page=ownership\b/);
    await expect(page.locator('[data-fin-family="ownership"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-fin-local="ownership"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-fin-local="ownership"]')).toContainText("Institutional");
    await expect(page.locator('[data-fin-local="insider"]')).toContainText("Insider");
    await page.locator('[data-fin-local="insider"]').click();
  }

  await expect(page).toHaveURL(/[?&]page=insider\b/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
