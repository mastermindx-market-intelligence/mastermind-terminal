import { expect, test, type Page } from "@playwright/test";

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
  statements: { annual: null, quarterly: null },
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

async function installFixtureRoutes(page: Page) {
  await page.route(BRAIN_SCRIPT_SRC, (route) =>
    route.fulfill({ contentType: "application/javascript", body: "window.MMBrain = window.MMBrain || {};" }),
  );
  await page.route("**/data/INTC.fund.json**", (route) => route.fulfill({ json: fundFixture }));
  await page.route("**/api/quote?syms=INTC**", (route) =>
    route.fulfill({ json: { quotes: { INTC: { last: 25.5 } } } }),
  );
}

async function expectTooltipContained(page: Page, expectedPercent: string) {
  const module = page.locator(".fin-earn-module").first();
  const tip = module.locator(".fin-dumbtip");
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

  const module = page.locator(".fin-earn-module").first();
  const dots = module.locator(".fin-dot-act");
  await expect(dots).toHaveCount(2);

  await dots.nth(0).click();
  await expectTooltipContained(page, "1533.52%");

  await dots.nth(1).click();
  await expectTooltipContained(page, "3162.41%");
});
