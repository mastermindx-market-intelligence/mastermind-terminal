import { expect, test, type Page, type TestInfo } from "@playwright/test";

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

async function installOverviewFixture(page: Page, fixture: unknown = overviewFundFixture) {
  await page.route("**/NVDA.fund.json**", async (route) => route.fulfill({ json: fixture }));
}

async function captureMobileValuation(page: Page, testInfo: TestInfo, language: "en" | "zh") {
  const valuation = page.locator("[data-overview-vnext-valuation]");
  const frames = [
    { name: "current", selectors: [":scope > .fin-sec-h", ":scope > .fin-sec-cap", ".fin-overview-valuation-current"], withAsOf: false },
    { name: "pe-history", selectors: [".fin-overview-pe-history"], withAsOf: false },
    { name: "ps-context", selectors: [".fin-overview-ps-context"], withAsOf: true },
  ];

  for (const frame of frames) {
    const geometry = await valuation.evaluate(async (section, frame) => {
      const scroller = section.closest<HTMLElement>(".fin-body");
      if (!scroller) throw new Error("Overview has no existing .fin-body scrollport");
      const targets = frame.selectors.map((selector) => {
        const element = section.querySelector<HTMLElement>(selector);
        if (!element) throw new Error("Missing valuation capture target: " + selector);
        return element;
      });
      if (frame.withAsOf) {
        const asOf = section.querySelector<HTMLElement>(":scope > .fin-asof");
        if (asOf) targets.push(asOf);
      }

      const measure = () => {
        const port = scroller.getBoundingClientRect();
        const usable = {
          top: Math.max(0, port.top + scroller.clientTop),
          bottom: Math.min(window.innerHeight, port.top + scroller.clientTop + scroller.clientHeight),
          left: Math.max(0, port.left + scroller.clientLeft),
          right: Math.min(window.innerWidth, port.left + scroller.clientLeft + scroller.clientWidth),
        };
        // Respect the real chrome; never hide it or resize the viewport for a capture.
        for (const header of Array.from(document.querySelectorAll<HTMLElement>(
          ".mobilebar, .analysis-context-bar, .fin-head, .fin-research-nav",
        ))) {
          if (!header.getClientRects().length) continue;
          const box = header.getBoundingClientRect();
          if (box.left < usable.right && box.right > usable.left &&
              box.top <= usable.top + 1 && box.bottom > usable.top) {
            usable.top = Math.max(usable.top, box.bottom);
          }
        }
        const bottomTabs = scroller.closest(".fin-pane")?.querySelector<HTMLElement>(".fin-local-tabs-mobile");
        if (bottomTabs?.getClientRects().length) {
          const box = bottomTabs.getBoundingClientRect();
          if (box.left < usable.right && box.right > usable.left &&
              box.top < usable.bottom && box.bottom > usable.top) {
            usable.bottom = Math.min(usable.bottom, box.top);
          }
        }
        const regions = targets.map((element) => {
          const box = element.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
        });
        return {
          usable,
          target: {
            top: Math.min(...regions.map((r) => r.top)),
            bottom: Math.max(...regions.map((r) => r.bottom)),
            left: Math.min(...regions.map((r) => r.left)),
            right: Math.max(...regions.map((r) => r.right)),
          },
          regions,
          scrollTop: scroller.scrollTop,
        };
      };

      const before = measure();
      scroller.scrollTo({
        top: scroller.scrollTop + before.target.top - before.usable.top - 8,
        behavior: "instant",
      });
      const settledFrame = () => new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await settledFrame();
      const first = measure();
      await settledFrame();
      const current = measure();
      return {
        frame: frame.name,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        ...current,
        motion: Math.max(
          Math.abs(first.target.top - current.target.top),
          Math.abs(first.target.bottom - current.target.bottom),
          Math.abs(first.scrollTop - current.scrollTop),
          Math.abs(first.usable.top - current.usable.top),
          Math.abs(first.usable.bottom - current.usable.bottom),
        ),
        centersUnobscured: targets.every((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
          return hit !== null && element.contains(hit);
        }),
      };
    }, frame);

    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    expect(geometry.viewport).toEqual(page.viewportSize());
    expect(geometry.motion, "valuation capture scroll must settle").toBeLessThanOrEqual(0.5);
    expect(geometry.target.top).toBeGreaterThanOrEqual(geometry.usable.top - 1);
    expect(geometry.target.bottom).toBeLessThanOrEqual(geometry.usable.bottom + 1);
    expect(geometry.target.left).toBeGreaterThanOrEqual(geometry.usable.left - 1);
    expect(geometry.target.right).toBeLessThanOrEqual(geometry.usable.right + 1);
    expect(geometry.centersUnobscured, "valuation cards must remain outside the real chrome").toBe(true);
    await testInfo.attach("overview-" + language + "-valuation-" + frame.name + "-geometry", {
      body: Buffer.from(JSON.stringify(geometry, null, 2)),
      contentType: "application/json",
    });
    await page.screenshot({
      path: testInfo.outputPath("overview-" + language + "-valuation-" + frame.name + ".png"),
      animations: "disabled",
    });
  }
}

async function captureOverview(page: Page, testInfo: TestInfo, language: "en" | "zh") {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // The existing responsive-qa artifact retains these actual browser captures.
  await page.screenshot({
    path: testInfo.outputPath(`overview-${language}-first-frame.png`),
    animations: "disabled",
  });
  if (testInfo.project.name === "mobile") {
    await captureMobileValuation(page, testInfo, language);
    return;
  }
  await page.locator("[data-overview-vnext-valuation]").screenshot({
    path: testInfo.outputPath(`overview-${language}-valuation.png`),
    animations: "disabled",
  });
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


test("Overview vNext keeps snapshot, ownership, capital and valuation in one research canvas", async ({ page }, testInfo) => {
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
  await expect(valuation.locator(".fin-overview-valuation-current")).toContainText("Basic EPS · latest available FY");
  await expect(valuation).toContainText("Historical P/E");
  await expect(valuation).toContainText("Revenue-relative context");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await captureOverview(page, testInfo, "en");
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
  await expect(overview.locator(".fin-overview-valuation-current")).toContainText("基本每股收益 · 最近可用财年");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await captureOverview(page, testInfo, "zh");
});


for (const locale of [
  { language: "en", project: "desktop", epsLabel: "Basic EPS", basis: "Latest available FY", cardBasis: "Basic EPS · latest available FY", history: "Historical P/E is unavailable in the current data." },
  { language: "zh", project: "mobile", epsLabel: "基本每股收益", basis: "最近可用财年", cardBasis: "基本每股收益 · 最近可用财年", history: "当前数据中暂无历史市盈率。" },
] as const) {
  test(`Overview labels an older available annual EPS without inventing current or historical P/E (${locale.language})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== locale.project, "one missing-data contract per locale is sufficient");
    await page.addInitScript((language) => window.localStorage.setItem("mm.lang", language), locale.language);
    await installOverviewFixture(page, {
      ...overviewFundFixture,
      statements: {
        ...overviewFundFixture.statements,
        annual: {
          ...overviewFundFixture.statements.annual,
          income: { ...overviewFundFixture.statements.annual.income, eps_basic: [1.2, 1.9, null] },
        },
      },
      ratios: {
        ...overviewFundFixture.ratios,
        pe: [],
        current: { ...overviewFundFixture.ratios.current, pe_ttm: null },
      },
    });
    await page.goto("/analysis?symbol=NVDA&page=overview");

    const overview = page.locator("[data-overview-vnext]");
    await expect(overview).toBeVisible({ timeout: 45_000 });
    const epsFact = overview.locator(".fin-kpi").filter({ has: page.getByText(locale.epsLabel, { exact: true }) });
    await expect(epsFact.locator(".v")).toHaveText("1.90");
    await expect(epsFact.locator(".s")).toHaveText(locale.basis);
    const current = overview.locator(".fin-overview-valuation-current");
    await expect(current.locator(".fin-overview-current-pe .num")).toHaveText("—");
    await expect(current.locator(".fin-overview-current-eps")).toContainText(locale.cardBasis);
    await expect(current.locator(".fin-overview-current-eps .num")).toHaveText("1.90");
    await expect(overview.locator(".fin-overview-pe-history")).toContainText(locale.history);
  });
}

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


function marketBarsFixture() {
  const bars: [string, number, number, number, number, number][] = [];
  let close = 100;
  for (let year = 2020; year <= 2026; year++) {
    const monthCount = year === 2026 ? 6 : 12;
    for (let month = 1; month <= monthCount; month++) {
      for (const day of [5, 12, 19, 26]) {
        const seasonal = Math.sin((month / 12) * Math.PI * 2) * 0.004;
        const drift = 0.0045 + seasonal + ((year - 2020) * 0.00008);
        const open = close;
        close = close * (1 + drift);
        const high = Math.max(open, close) * 1.012;
        const low = Math.min(open, close) * 0.988;
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        bars.push([date, open, high, low, close, 1_000_000 + bars.length * 2_500]);
      }
    }
  }
  return { bars };
}

async function installMarketBars(page: Page) {
  const fixture = marketBarsFixture();
  await page.route("**/data/NVDA.json**", async (route) => route.fulfill({ json: fixture }));
}


test("Market vNext projects canonical technicals, pivots and five-year seasonality", async ({ page }) => {
  await installMarketBars(page);
  await page.goto("/analysis?symbol=NVDA&page=technicals");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const market = page.locator("[data-market-vnext]");
  await expect(market).toBeVisible({ timeout: 45_000 });

  const state = market.locator("[data-market-vnext-state]");
  await expect(state).toContainText("MARKET TECHNICALS");
  await expect(state).toContainText("Deterministic indicator state");
  await expect(state).toContainText("RSI (14)");
  await expect(state).toContainText("MACD (12, 26, 9)");
  await expect(state).toContainText("vs SMA 20");
  await expect(state).toContainText("vs SMA 50");
  await expect(state).toContainText("vs SMA 200");

  const rating = market.locator("[data-market-vnext-rating]");
  await expect(rating).toContainText("TECHNICAL RATING");
  await expect(rating).toContainText("Oscillators");
  await expect(rating).toContainText("Moving Averages");
  await expect(rating).toContainText("not a trade signal");

  const pivots = market.locator("[data-market-vnext-pivots]");
  await expect(pivots).toContainText("PIVOT MAP");
  await expect(pivots).toContainText("R1");
  await expect(pivots).toContainText("S1");
  await expect(pivots).toContainText("Nearest support");
  await expect(pivots).toContainText("Nearest resistance");
  await expect(pivots).toContainText("not forecasts");

  const seasonality = market.locator("[data-market-vnext-seasonality]");
  await expect(seasonality).toContainText("SEASONALITY SNAPSHOT");
  await expect(seasonality).toContainText("5 completed yearly observations");
  await expect(seasonality).toContainText("Jan");
  await expect(seasonality).toContainText("Dec");
  await expect(seasonality).toContainText("Historical recurrence only");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Market vNext remains bilingual and overflow-safe on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one mobile bilingual Market contract is sufficient");
  await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
  await installMarketBars(page);
  await page.goto("/analysis?symbol=NVDA&page=technicals");

  const market = page.locator("[data-market-vnext]");
  await expect(market).toBeVisible({ timeout: 45_000 });
  await expect(market).toContainText("市场技术面");
  await expect(market).toContainText("技术评级");
  await expect(market).toContainText("枢轴图");
  await expect(market).toContainText("季节性快照");
  await expect(market).toContainText("5 个完整年度观测");
  await expect(market).toContainText("并非交易信号");
  await expect(market).toContainText("而非预测");
  await expect(market).toContainText("小样本不能预测下一步走势");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});


test("Market summary keeps seasonality ahead of deep indicator tables", async ({ page }, testInfo) => {
  await installMarketBars(page);
  await page.goto("/analysis?symbol=NVDA&page=technicals");
  const market = page.locator("[data-market-vnext]");
  const seasonality = market.locator("[data-market-vnext-seasonality]");
  await expect(seasonality).toContainText("5 completed yearly observations", { timeout: 45_000 });
  const summaryBox = await seasonality.boundingBox();
  const detailsBox = await market.locator(":scope > .fin-grid2").boundingBox();
  expect(summaryBox).not.toBeNull();
  expect(detailsBox).not.toBeNull();
  // The overview must be discoverable before scrolling through the full metric tables.
  expect(summaryBox!.y).toBeLessThan(page.viewportSize()!.height - 72);
  expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(detailsBox!.y);
  if (page.viewportSize()!.width <= 760) {
    const pivotsBox = await market.locator("[data-market-vnext-pivots]").boundingBox();
    expect(pivotsBox!.y).toBeGreaterThanOrEqual(summaryBox!.y + summaryBox!.height);
  }
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-market-full-history-en.png`) });
});


type MarketBasis = "D" | "W" | "1M";

function marketAvailabilityBars(n: number, basis: MarketBasis, measuredZero = false) {
  const bars: [string, number, number, number, number, number][] = [];
  let dailyMs = Date.UTC(2000, 0, 3);
  for (let i = 0; i < n; i++) {
    const close = measuredZero ? 128 : 100 + i;
    const high = measuredZero ? (i % 2 === 0 ? 130 : 129) : close + 1;
    const low = measuredZero ? (i % 2 === 0 ? 127 : 126) : close - 1;
    for (const offset of basis === "D" ? [0] : [0, 1]) {
      let ms: number;
      if (basis === "D") {
        while ([0, 6].includes(new Date(dailyMs).getUTCDay())) dailyMs += 86_400_000;
        ms = dailyMs;
        dailyMs += 86_400_000;
      } else {
        ms = basis === "W" ? Date.UTC(2000, 0, 3 + 7 * i + offset) : Date.UTC(2000, i, 1 + offset);
      }
      bars.push([new Date(ms).toISOString().slice(0, 10), close, high, low, close, 100]);
    }
  }
  return { bars };
}

for (const zh of [false, true]) {
  // Each fixed input owns an isolated browser context; persistent OHLC caching remains real.
  for (const n of [29, 30, 49, 50, 199, 200, 220]) {
    test(`Market numeric availability thresholds and measured Neutral ${zh ? "zh" : "en"} at ${n} active observations`, async ({ page }, testInfo) => {
      const basis: MarketBasis = testInfo.project.name === "mobile" ? "1M" : testInfo.project.name === "tablet" ? "W" : "D";
      const basisLabel = basis === "D" ? (zh ? "1天" : "1 day") : basis === "W" ? (zh ? "1周" : "1 week") : (zh ? "1月" : "1 month");
      await page.addInitScript((lang) => window.localStorage.setItem("mm.lang", lang), zh ? "zh" : "en");
      const neutral = n === 220;
      const fixture = marketAvailabilityBars(n, basis, neutral);
      await page.route("**/data/NVDA.json**", async (route) => route.fulfill({ json: fixture }));
      const market = page.locator("[data-market-vnext]");
      const rating = market.locator("[data-market-vnext-rating]");
      const group = (moving: boolean) => rating.getByRole("group", {
        name: moving ? (zh ? "移动平均" : "Moving Averages") : (zh ? "震荡指标" : "Oscillators"), exact: true,
      });
      const table = (moving: boolean) => market.locator(".fin-card.fin-tech-tbl").filter({
        has: page.locator(".fin-sec-h", { hasText: moving ? (zh ? "移动平均" : "Moving Averages") : (zh ? "震荡指标" : "Oscillators") }),
      });
      const row = (moving: boolean, name: string) => table(moving).getByRole("row").filter({
        has: page.getByRole("rowheader", { name, exact: true }),
      });
      const expectUnavailable = async (moving: boolean, name: string) => {
        const target = row(moving, name);
        await expect(target.locator("td").nth(0)).toHaveText("—");
        await expect(target.locator(".fin-tech-act")).toHaveText(zh ? "不可用" : "Unavailable");
        await expect(target.locator(".fin-tech-act")).toHaveClass(/\bmut\b/);
      };
      const checkGroup = async (moving: boolean, total: number, missing: number) => {
        const target = group(moving);
        if (missing > 0) {
          await expect(target.locator(".arcg")).toHaveCount(0);
          await expect(target.locator(".fin-gauge-counts")).toHaveCount(0);
          await expect(target.getByRole("status")).toContainText(zh
            ? `${total} 项数值读数中 ${total - missing} 项可用 · ${missing} 项不可用`
            : `${total - missing} of ${total} numeric readings available · ${missing} unavailable`);
        } else {
          await expect(target.getByRole("status")).toHaveCount(0);
          await expect(target.locator(".arcg")).toHaveCount(1);
          await expect(target.locator(".arcg .num")).toHaveCount(total === 0 ? 0 : 1);
          await expect(target.locator(".fin-gauge-counts")).toHaveCount(total === 0 ? 0 : 1);
        }
      };

      await page.goto("/analysis?symbol=NVDA&page=technicals");
      await expect(market).toBeVisible({ timeout: 45_000 });
      await market.locator(".fin-tf-row").getByRole("button", { name: basisLabel, exact: true }).click();
      const provenance = market.locator("[data-market-vnext-state] > header > div > p");
      await expect(provenance).toContainText(zh ? `${n} 个观测` : `${n} observations`);
      await expect(provenance).toContainText(basisLabel);
      await expect(rating).toContainText(zh ? "中性也可能表示历史不足。" : "Neutral may reflect limited history.");
      if (n < 30) {
        await checkGroup(true, 0, 0); await checkGroup(false, 0, 0);
        await expect(table(true).locator("tbody th")).toHaveCount(0);
        await expect(table(false).locator("tbody th")).toHaveCount(0);
        return;
      }
      await expect(table(true).locator('tbody th[scope="row"]')).toHaveCount(15);
      await expect(table(false).locator('tbody th[scope="row"]')).toHaveCount(11);
      await checkGroup(true, 15, n < 50 ? 6 : n < 100 ? 4 : n < 200 ? 2 : 0);
      if (!neutral) await checkGroup(false, 11, n < 34 ? 1 : 0);
      if (n < 50) await expectUnavailable(true, "EMA (50)");
      else await expect(row(true, "EMA (50)").locator(".fin-tech-act")).toHaveText(neutral ? (zh ? "中性" : "Neutral") : (zh ? "买入" : "Buy"));
      if (n < 200) await expectUnavailable(true, "SMA (200)");
      else await expect(row(true, "SMA (200)").locator("td").nth(0)).toHaveText(neutral ? "128.00" : "199.50");
      if (n === 30) {
        await expectUnavailable(false, "Awesome Oscillator");
        await expect(row(true, "SMA (30)").locator("td").nth(0)).toHaveText("114.50");
        await expect(row(false, "MACD (12, 26, 9)").locator(".fin-tech-act")).toHaveText(zh ? "中性" : "Neutral");
      }
      if (neutral) {
        await expect(group(true).locator(".arcg .num")).toHaveText("50");
        await expect(group(true).locator(".fin-gauge-counts")).toContainText(zh ? "中性 15" : "Neutral 15");
        await expect(row(false, "Momentum (10)").locator("td").nth(0)).toHaveText("0.00");
        await expect(row(false, "Momentum (10)").locator(".fin-tech-act")).toHaveText(zh ? "中性" : "Neutral");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      if (n === 30 || neutral) {
        await rating.scrollIntoViewIfNeeded();
        await expect(group(true)).toBeInViewport({ ratio: 1 });
        await expect(group(false)).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-market-${neutral ? "neutral" : "partial"}-${zh ? "zh" : "en"}.png`) });
        // Prove the changed row is reachable through the existing scrollport too.
        const target = row(neutral ? false : true, neutral ? "Momentum (10)" : "SMA (200)");
        await target.scrollIntoViewIfNeeded();
        await expect(target).toBeInViewport({ ratio: 1 });
        await expect(target.locator(".fin-tech-act")).toHaveText(neutral ? (zh ? "中性" : "Neutral") : (zh ? "不可用" : "Unavailable"));
      }
    });
  }
}

test("Market full-history hierarchy remains readable in Chinese", async ({ page }, testInfo) => {
  await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
  await installMarketBars(page);
  await page.goto("/analysis?symbol=NVDA&page=technicals");
  const market = page.locator("[data-market-vnext]");
  const seasonality = market.locator("[data-market-vnext-seasonality]");
  await expect(seasonality).toContainText("5 个完整年度观测", { timeout: 45_000 });
  const summary = await seasonality.boundingBox();
  const details = await market.locator(":scope > .fin-grid2").boundingBox();
  expect(summary).not.toBeNull(); expect(details).not.toBeNull();
  expect(summary!.y).toBeLessThan(page.viewportSize()!.height - 72);
  expect(summary!.y + summary!.height).toBeLessThanOrEqual(details!.y);
  if (page.viewportSize()!.width <= 1100) {
    const pivots = await market.locator("[data-market-vnext-pivots]").boundingBox();
    expect(pivots!.y).toBeGreaterThanOrEqual(summary!.y + summary!.height);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-market-full-history-zh.png`) });
});

const financialsFundFixture = {
  schema: "mastermind.fund/v1",
  ticker: "NVDA",
  asof: "2026-09-23",
  quote_currency: "USD",
  stmt_currency: "USD",
  src: { statements: "fixture", estimates: null, dividends: "fixture" },
  profile: {
    website: "https://www.nvidia.com", employees: 36000, sector: "Technology", industry: "Semiconductors",
    description: "Fixture company profile.", founded: 1993, hq: "Santa Clara, CA",
  },
  stats: {
    mktcap: 4_000_000_000_000, shares_out: 24_000_000_000, float_shares: null, inst_pct: null,
    insider_pct: null, beta: null, num_holders: null,
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
    periods: [], pe: [], ps: [], pb: [], pcf: [], ev: [], ev_ebitda: [],
    current: {
      pe_ttm: null, pe_fwd: null, ps: null, pb: null, ev_ebitda: null, ev_sales: null,
      ev_ebit: null, p_fcf: null, div_yield: null, payout: null, gross_margin: null,
      net_margin: null, roe: null, roa: null, debt_to_equity: null, current_ratio: null,
    },
  },
  earnings: { next_date: null, next_period: null, next_eps_est: null, next_rev_est: null, q: [], fy: [] },
  estimates: null,
  analyst: null,
  dividends: { never_paid: true, yield_ttm: null, payout_ratio: null, events: [], splits: [] },
  ownership: { free_float_pct: null, closely_held_pct: null, top_inst: [] },
  guidance: null,
  segments: null,
};

async function installFinancialsFixture(page: Page) {
  await page.route("**/NVDA.fund.json**", async (route) => route.fulfill({ json: financialsFundFixture }));
}

test("Financials vNext keeps statement summary, explorer and integrity on one canonical page", async ({ page }, testInfo) => {
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
  await expect(summary).toContainText("From the financials record");

  const explorer = financials.locator("[data-financials-vnext-explorer]");
  await expect(explorer).toContainText("TRAJECTORY");
  await expect(explorer).toContainText("Income trajectory");
  await expect(explorer).toContainText("STATEMENT SNAPSHOT");
  await expect(explorer).toContainText("Income statement");
  const integrity = financials.locator("[data-financials-vnext-integrity]");
  await expect(integrity).toContainText("Balance-sheet snapshot");
  await expect(integrity).toContainText("Cash conversion");
  await expect(integrity).toContainText("This page uses the free-cash-flow value in the financials record; it does not recompute a missing value.");
  await expect(integrity).toContainText("Source & normalization");
  await expect(integrity).toContainText("Reporting cadence");
  await expect(integrity).toContainText("Normalization");
  await expect(integrity).toContainText("Currency");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const capturePath = testInfo.outputPath("financials-current-en.png");
  await page.screenshot({ path: capturePath, animations: "disabled" });
  await testInfo.attach("financials-current-en", {
    path: capturePath, contentType: "image/png",
  });
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
  await expect(financials).toContainText("利润趋势");
  await expect(financials).toContainText("报表快照");
  await expect(financials).toContainText("资产负债表快照");
  await expect(financials).toContainText("现金转换");
  await expect(financials).toContainText("本页使用财务记录中的自由现金流值；字段缺失时不会在页面重算。");
  await expect(financials).toContainText("来源与标准化");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const capturePath = testInfo.outputPath("financials-current-zh.png");
  await page.screenshot({ path: capturePath, animations: "disabled" });
  await testInfo.attach("financials-current-zh", {
    path: capturePath, contentType: "image/png",
  });
});

test("Financials snapshot preserves period columns when a metric is incomplete", async ({ page }) => {
  const annual = financialsFundFixture.statements.annual;
  const fund = { ...financialsFundFixture, statements: { ...financialsFundFixture.statements, annual: {
    ...annual, periods: ["FY2020", "FY2021", "FY2022", "FY2023", "FY2024", "FY2025"],
    income: { ...annual.income, revenue: [60e9, 90e9, 130e9, 140e9, 150e9, 160e9],
      gross_profit: [42e9, 65e9, 98e9], eps_diluted: [] },
  } } };
  await page.route("**/NVDA.fund.json**", async (route) => route.fulfill({ json: fund }));
  await page.goto("/analysis?symbol=NVDA&page=statements");
  const table = page.locator(".fin-financials-snapshot-table");
  await expect(table).toBeVisible({ timeout: 45_000 });
  await expect(table.locator("thead th")).toHaveText(["Metric", "FY2022", "FY2023", "FY2024", "FY2025"]);
  const gross = table.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: "Gross profit", exact: true }) });
  await expect(gross.locator("td")).toHaveText(["98.00B", "—", "—", "—"]);
  const eps = table.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: "Diluted EPS", exact: true }) });
  await expect(eps.locator("td")).toHaveText(["—", "—", "—", "—"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
});
