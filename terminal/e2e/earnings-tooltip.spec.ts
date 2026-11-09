import { expect, test, type Page, type TestInfo } from "@playwright/test";

const BRAIN_SCRIPT_SRC = "https://www.mastermind-x.com/mm_brain.js";

const fundFixture = {
  schema: "mastermind.fund/v1",
  ticker: "INTC",
  asof: "2026-09-17",
  quote_currency: "USD",
  stmt_currency: "USD",
  src: { statements: "fixture", estimates: null, dividends: "fixture" },
  profile: {
    website: null, employees: null, sector: null, industry: null,
    description: null, founded: null, hq: null,
  },
  stats: {
    mktcap: null, shares_out: null, float_shares: null, inst_pct: null,
    insider_pct: null, beta: null, num_holders: null,
  },
  statements: {
    annual: null,
    quarterly: {
      periods: ["Q3 2024", "Q3 2025"],
      period_end: ["2024-09-30", "2025-09-30"],
      fiscal_year: ["2024", "2025"],
      period_kind: ["quarter", "quarter"],
      period_number: [3, 3],
      reporting_cadence: "quarterly",
      is_cumulative: [false, false],
      normalization_method: ["as_reported", "as_reported"],
      flow_basis: "discrete_period",
      source_market: "us",
      source_family: "industrial",
      source_family_by_period: ["industrial", "industrial"],
      income: {
        revenue: [12_000_000_000, 15_000_000_000],
        cogs: [5_000_000_000, 6_000_000_000],
        gross_profit: [7_000_000_000, 9_000_000_000],
        opex: [4_000_000_000, 4_500_000_000],
        op_income: [3_000_000_000, 4_500_000_000],
        nonop_income: [100_000_000, 120_000_000],
        pretax_income: [3_100_000_000, 4_620_000_000],
        taxes: [400_000_000, 550_000_000],
        net_income: [2_700_000_000, 4_070_000_000],
        eps_basic: [-0.46, 0.23],
        eps_diluted: [-0.46, 0.22],
        ebitda: [3_400_000_000, 4_900_000_000],
      },
      balance: {
        assets: [190_000_000_000, 205_000_000_000],
        assets_st: [65_000_000_000, 72_000_000_000],
        assets_lt: [125_000_000_000, 133_000_000_000],
        liabilities: [88_000_000_000, 91_000_000_000],
        liab_st: [31_000_000_000, 33_000_000_000],
        liab_lt: [57_000_000_000, 58_000_000_000],
        equity: [102_000_000_000, 114_000_000_000],
        debt: [50_000_000_000, 48_000_000_000],
        net_debt: [28_000_000_000, 24_000_000_000],
        cash: [22_000_000_000, 24_000_000_000],
      },
      cashflow: {
        cfo: [3_500_000_000, 5_200_000_000],
        cfi: [-2_100_000_000, -2_400_000_000],
        cff: [-1_800_000_000, -2_000_000_000],
        capex: [1_000_000_000, 1_100_000_000],
        fcf: [2_500_000_000, 4_100_000_000],
      },
    },
  },
  ratios: {
    periods: [], pe: [], ps: [], pb: [], pcf: [], ev: [], ev_ebitda: [],
    current: {
      pe_ttm: null, pe_fwd: null, ps: null, pb: null, ev_ebitda: null,
      ev_sales: null, ev_ebit: null, p_fcf: null, div_yield: null,
      payout: null, gross_margin: null, net_margin: null, roe: null, roa: null,
      debt_to_equity: null, current_ratio: null,
    },
  },
  earnings: {
    next_date: null,
    next_period: null,
    next_eps_est: null,
    next_rev_est: null,
    q: [
      {
        period: "Q3 2024",
        end: "2024-09-30",
        report_date: "2024-10-31",
        eps_a: -0.46,
        eps_e: -0.03,
        rev_a: null,
        rev_e: null,
        surp_pct: -1533.52,
        tx: null,
      },
      {
        period: "Q3 2025",
        end: "2025-09-30",
        report_date: "2025-10-23",
        eps_a: 0.23,
        eps_e: 0.01,
        rev_a: null,
        rev_e: null,
        surp_pct: 3162.41,
        tx: null,
      },
    ],
    fy: [],
  },
  estimates: null,
  analyst: null,
  dividends: { never_paid: true, yield_ttm: null, payout_ratio: null, events: [], splits: [] },
  ownership: { free_float_pct: null, closely_held_pct: null, top_inst: [] },
  guidance: null,
  segments: null,
};

async function installFixtureRoutes(page: Page, fixture: unknown = fundFixture) {
  await page.route(BRAIN_SCRIPT_SRC, (route) =>
    route.fulfill({ contentType: "application/javascript", body: "window.MMBrain = window.MMBrain || {};" }),
  );
  await page.route("**/data/INTC.fund.json**", (route) => route.fulfill({ json: fixture }));
  await page.route("**/api/quote?syms=INTC**", (route) =>
    route.fulfill({ json: { quotes: { INTC: { last: 25.5 } } } }),
  );
}

async function captureEarningsProof(page: Page, testInfo: TestInfo) {
  const pulse = page.locator("[data-earnings-vnext-pulse]");
  await pulse.scrollIntoViewIfNeeded();
  await expect(pulse).toBeInViewport({ ratio: 0.95 });
  await testInfo.attach("earnings-pulse", { body: await page.screenshot(), contentType: "image/png" });

  const coverage = page.locator("[data-earnings-vnext-coverage]");
  await coverage.scrollIntoViewIfNeeded();
  await expect(coverage).toBeInViewport({ ratio: 0.95 });
  await testInfo.attach("earnings-coverage", { body: await page.screenshot(), contentType: "image/png" });
}

async function expectTooltipContained(page: Page, expectedPercent: string) {
  const earningsModule = page.locator(".fin-earn-module").first();
  const tip = earningsModule.locator(".fin-dumbtip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(expectedPercent);

  const geometry = await tip.evaluate((element) => {
    const tipRect = element.getBoundingClientRect();
    const boxRect = element.closest<HTMLElement>(".fin-svg-box")!.getBoundingClientRect();
    const rows = Array.from(element.querySelectorAll<HTMLElement>(".r")).map((row) => {
      const value = row.querySelector<HTMLElement>(".v");
      if (!value) return null;
      const rect = value.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }).filter(Boolean);
    return {
      tip: { left: tipRect.left, right: tipRect.right, top: tipRect.top, bottom: tipRect.bottom },
      box: { left: boxRect.left, right: boxRect.right, top: boxRect.top, bottom: boxRect.bottom },
      rows,
      scrollWidth: (element as HTMLElement).scrollWidth,
      clientWidth: (element as HTMLElement).clientWidth,
    };
  });

  expect(geometry.tip.left).toBeGreaterThanOrEqual(geometry.box.left - 1);
  expect(geometry.tip.right).toBeLessThanOrEqual(geometry.box.right + 1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  for (const row of geometry.rows as Array<{ left: number; right: number; top: number; bottom: number }>) {
    expect(row.left).toBeGreaterThanOrEqual(geometry.tip.left - 1);
    expect(row.right).toBeLessThanOrEqual(geometry.tip.right + 1);
  }
}

test("earnings tooltip contains four-digit surprise percentages at every responsive viewport", async ({ page }) => {
  await installFixtureRoutes(page);
  await page.goto("/analysis?symbol=INTC&page=earnings");

  const earningsTab = page.getByRole("tab", { name: "Earnings", exact: true });
  await expect(earningsTab).toHaveAttribute("aria-selected", "true");

  const earningsModule = page.locator(".fin-earn-module").first();
  const dots = earningsModule.locator(".fin-dot-act");
  await expect(dots).toHaveCount(2);

  await dots.nth(0).click();
  await expectTooltipContained(page, "1533.52%");

  await dots.nth(1).click();
  await expectTooltipContained(page, "3162.41%");
});


test("Earnings vNext separates matched EPS from statement-backed revenue", async ({ page }) => {
  await installFixtureRoutes(page);
  await page.goto("/analysis?symbol=INTC&page=earnings");

  const earnings = page.locator("[data-earnings-vnext]");
  await expect(earnings).toBeVisible({ timeout: 45_000 });

  const pulse = earnings.locator("[data-earnings-vnext-pulse]");
  await expect(pulse).toContainText("EARNINGS PULSE");
  await expect(pulse).toContainText("Reported periods");
  await expect(pulse).toContainText("Q3 '25");
  await expect(pulse).toContainText("EPS result");
  await expect(pulse).toContainText("Matched actual and estimate");
  await expect(pulse).not.toContainText("+3162.41%");
  await expect(earnings).toContainText("+3162.41%");
  await expect(pulse).toContainText("Revenue actual");
  await expect(pulse).toContainText("15.00B");
  await expect(pulse).toContainText("Statement-backed");
  await expect(pulse).toContainText("Next report");
  await expect(pulse).toContainText("Date pending");

  await expect(earnings).toContainText("EPS · reported vs estimate");
  await expect(earnings).toContainText("Revenue · reported basis");
  await expect(earnings).toContainText("Derived from reported financial statements.");

  const coverage = earnings.locator("[data-earnings-vnext-coverage]");
  await expect(coverage).toContainText("COVERAGE & BASIS");
  await expect(coverage).toContainText("EPS actual / estimate");
  await expect(coverage).toContainText("Matched actual and estimate");
  await expect(coverage).toContainText("Revenue actual");
  await expect(coverage).toContainText("Statement-backed");
  await expect(coverage).toContainText("Revenue estimate");
  await expect(coverage).toContainText("Not published");
  await expect(coverage).toContainText("No inferred beat/miss without a matched basis");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Earnings vNext remains truthful and usable in Chinese on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one mobile bilingual Earnings contract is sufficient");
  await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
  await installFixtureRoutes(page);
  await page.goto("/analysis?symbol=INTC&page=earnings");

  const earnings = page.locator("[data-earnings-vnext]");
  await expect(earnings).toBeVisible({ timeout: 45_000 });
  await expect(earnings).toContainText("财报脉冲");
  await expect(earnings).toContainText("已报告期");
  await expect(earnings).toContainText("每股盈利结果");
  await expect(earnings).toContainText("营收实际值");
  await expect(earnings).toContainText("财务报表支持");
  await expect(earnings).toContainText("覆盖与口径");
  await expect(earnings).toContainText("实际值与预期口径匹配");
  await expect(earnings).toContainText("未发布");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

for (const zh of [false, true]) {
  for (const unit of ["HKD", null]) {
    test(`annual-only Earnings keeps reported values and statement currency, zh=${zh}, unit=${unit}`, async ({ page }, testInfo) => {
      if (zh) await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
      await installFixtureRoutes(page, {
        ...fundFixture,
        stmt_currency: unit,
        statements: { annual: null, quarterly: null },
        earnings: {
          ...fundFixture.earnings,
          q: [],
          fy: [{ period: "2025", eps_a: 1.25, eps_e: null, rev_a: 123_000_000, rev_e: null, surp_pct: null }],
        },
      });
      await page.goto("/analysis?symbol=INTC&page=earnings");
      const earnings = page.locator("[data-earnings-vnext]");
      await expect(earnings).toBeVisible({ timeout: 45_000 });
      const pulse = earnings.locator("[data-earnings-vnext-pulse]");
      const coverage = earnings.locator("[data-earnings-vnext-coverage]");
      const annualLabel = zh ? "年度" : "Annual";
      for (const section of [pulse, coverage]) {
        await expect(section).toContainText("2025");
        await expect(section).toContainText(annualLabel);
        await expect(section).toContainText(zh ? "仅有已报告实际值" : "Reported actual only");
      }
      await expect(pulse.locator("article").nth(1)).toContainText("1.25");
      await expect(pulse.locator("article").nth(2)).toContainText("123.00M");
      await expect(pulse).toContainText(unit
        ? (zh ? "货币：HKD" : "Currency: HKD")
        : (zh ? "报表货币不可用" : "Statement currency unavailable"));
      await expect(pulse).not.toContainText("USD");
      await expect(pulse).toContainText(zh ? "报告日期不可用" : "Report date unavailable");
      await expect(pulse.getByRole("button", { name: annualLabel, exact: true })).toHaveClass("on");
      await expect(pulse.getByRole("button", { name: zh ? "中期" : "Interim", exact: true })).toBeDisabled();
      const revenue = earnings.locator(".fin-earn-module").last();
      await expect(revenue.getByRole("button", { name: annualLabel, exact: true })).toHaveClass("on");
      await expect(revenue).toContainText("123.00M");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await captureEarningsProof(page, testInfo);
    });
  }
}

test("independent EPS and Revenue controls keep Pulse on each selected reported basis", async ({ page }, testInfo) => {
  await installFixtureRoutes(page, {
    ...fundFixture,
    stmt_currency: "HKD",
    earnings: {
      ...fundFixture.earnings,
      q: [{
        period: "Q1 2026", end: "2026-03-31", report_date: "2026-04-30",
        eps_a: 1.8, eps_e: 2, rev_a: 90, rev_e: 100, surp_pct: -10, tx: null,
      }],
      fy: [{ period: "2025", eps_a: 3.2, eps_e: null, rev_a: 500, rev_e: null, surp_pct: null }],
    },
  });
  await page.goto("/analysis?symbol=INTC&page=earnings");
  const earnings = page.locator("[data-earnings-vnext]");
  await expect(earnings).toBeVisible({ timeout: 45_000 });
  const pulse = earnings.locator("[data-earnings-vnext-pulse]");
  const modules = earnings.locator(".fin-earn-module");
  const eps = modules.first();
  const revenue = modules.last();
  const epsActual = pulse.locator("article").nth(1).locator("strong");
  const revenueActual = pulse.locator("article").nth(2).locator("strong");
  await expect(modules).toHaveCount(2);
  await expect(earnings.locator("table")).toHaveCount(2);
  await expect(earnings.locator("table .fin-cell-surp.down")).toHaveCount(2);
  await expect(earnings.locator("table .fin-cell-surp.down")).toHaveText(["−10.00%", "−10.00%"]);
  await expect(epsActual).toHaveText("1.80");
  await expect(revenueActual).toHaveText("90.00");

  await pulse.getByRole("button", { name: "Annual", exact: true }).click();
  await expect(epsActual).toHaveText("3.20");
  await expect(eps.locator("thead")).toContainText("2025");
  await expect(revenueActual).toHaveText("90.00");
  await expect(revenue.getByRole("button", { name: "Quarterly", exact: true })).toHaveClass("on");
  await expect(pulse).toContainText("Different periods");
  await expect(pulse).toContainText("Currency: HKD");

  await revenue.getByRole("button", { name: "Annual", exact: true }).click();
  await expect(revenueActual).toHaveText("500.00");
  await expect(revenue.locator("thead")).toContainText("2025");
  await expect(epsActual).toHaveText("3.20");
  await expect(pulse).not.toContainText("Different periods");

  await pulse.getByRole("button", { name: "Quarterly", exact: true }).click();
  await expect(epsActual).toHaveText("1.80");
  await expect(revenueActual).toHaveText("500.00");
  await expect(revenue.getByRole("button", { name: "Annual", exact: true })).toHaveClass("on");
  await expect(pulse).toContainText("Different periods");
  await expect(pulse).toContainText("Currency: HKD");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await captureEarningsProof(page, testInfo);
});
