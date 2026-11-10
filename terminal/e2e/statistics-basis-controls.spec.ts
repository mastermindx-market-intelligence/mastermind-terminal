import { expect, test, type Locator, type Page } from "@playwright/test";

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

async function nativeTarget(button: Locator) {
  const box = await button.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await expect.poll(() => button.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === el || el.contains(hit);
  }), { message: "Native Statistics focus is visible and clear of fixed navigation" }).toBe(true);
}

for (const surface of ["analysis", "terminal"] as const) for (const lang of ["en", "zh"] as const) {
  test(`${surface} ${lang}: selected statistics basis matches available ratios`, async ({ page }, info) => {
    if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    const { statistics, fundReads } = await openStatistics(page, surface, lang);
    const group = statistics.locator(".fin-stats-hdr .fin-toggle");
    const annual = group.getByRole("button", { name: lang === "zh" ? "年度" : "Annual", exact: true });
    const interim = group.getByRole("button", { name: lang === "zh" ? "季度" : "Quarterly", exact: true });
    const valuation = statistics.locator("table").filter({ has: page.getByText(lang === "zh" ? "估值比率" : "Valuation ratios", { exact: true }) });
    const keyStats = statistics.locator("table").filter({ has: page.getByText(lang === "zh" ? "关键指标" : "Key stats", { exact: true }) });
    const note = statistics.getByRole("status");
    await expect(statistics.locator(".fin-bar")).toHaveCount(6);
    await expect(valuation).toContainText("FY2025");
    await expect(valuation).toContainText("30.00");
    await expect(keyStats).toContainText("200.00M");
    const reads = fundReads();
    expect(reads).toBeGreaterThan(0);
    await annual.focus();
    const capture = (info.project.name === "desktop" && lang === "en") || (info.project.name === "mobile" && lang === "zh");
    if (capture) await page.screenshot({ path: info.outputPath(`${surface}-${lang}-initial.png`) });
    console.info("statistics initial controls", JSON.stringify({
      surface, lang, annual: await annual.boundingBox(), interim: await interim.boundingBox(),
      role: await group.getAttribute("role"), annualPressed: await annual.getAttribute("aria-pressed"),
      interimPressed: await interim.getAttribute("aria-pressed"),
    }));
    await expect(group).toHaveAttribute("role", "group");
    await expect(group).toHaveAttribute("aria-label", lang === "zh" ? "统计数据口径" : "Statistics basis");
    await expect(annual).toHaveAttribute("aria-pressed", "true");
    await expect(interim).toHaveAttribute("aria-pressed", "false");
    await expect(annual).toHaveAttribute("type", "button");
    await nativeTarget(annual);
    await page.keyboard.press("Tab");
    await expect(interim).toBeFocused();
    await nativeTarget(interim);
    expect(await interim.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
    await page.keyboard.press("Space");
    await expect(interim).toHaveAttribute("aria-pressed", "true");
    await expect(annual).toHaveAttribute("aria-pressed", "false");
    await expect(statistics.locator(".fin-bar")).toHaveCount(0);
    await expect(valuation).toHaveCount(0);
    await expect(note).toContainText(lang === "zh" ? "暂无季度估值比率" : "No quarterly valuation ratios");
    await expect(note).toContainText(lang === "zh" ? "切换到年度视图" : "switch to Annual");
    await expect(keyStats).toContainText("200.00M");
    await expect(interim).toBeFocused();
    await nativeTarget(interim);
    if (capture) await page.screenshot({ path: info.outputPath(`${surface}-${lang}-interim.png`) });
    await page.keyboard.press("Shift+Tab");
    await expect(annual).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(annual).toHaveAttribute("aria-pressed", "true");
    await expect(interim).toHaveAttribute("aria-pressed", "false");
    await expect(statistics.locator(".fin-bar")).toHaveCount(6);
    await expect(valuation).toContainText("FY2025");
    await expect(valuation).toContainText("30.00");
    await expect(note).toHaveCount(0);
    await nativeTarget(annual);
    if (info.project.name === "mobile") {
      await interim.tap();
      await expect(interim).toHaveAttribute("aria-pressed", "true");
      await expect(statistics.locator(".fin-bar")).toHaveCount(0);
    }
    expect(fundReads()).toBe(reads);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

for (const availability of ["annual", "semiannual"] as const) {
  test(`${availability}-only basis preserves honest availability guidance`, async ({ page }, info) => {
    // Independent contexts preserve the real symbol-snapshot cache contract.
    if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    const lang = info.project.name === "mobile" ? "zh" : "en";
    const { statistics, fundReads } = await openStatistics(page, "analysis", lang, availability);
    expect(fundReads()).toBeGreaterThan(0);
    const group = statistics.locator(".fin-stats-hdr .fin-toggle");
    const annual = group.getByRole("button", { name: lang === "zh" ? "年度" : "Annual", exact: true });
    const interim = group.getByRole("button").nth(1);
    const selected = availability === "annual" ? annual : interim;
    const unavailable = availability === "annual" ? interim : annual;
    if (availability === "semiannual") {
      await expect(interim).toHaveText(lang === "zh" ? "半年度" : "Semiannual");
      await expect(statistics.getByRole("status")).toContainText(lang === "zh" ? "暂无半年度估值比率" : "No semiannual valuation ratios");
      await expect(annual).toBeDisabled();
      console.info("statistics interim-only guidance", await statistics.getByRole("status").innerText());
      if (info.project.name === "mobile") {
        await statistics.getByRole("status").scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath("analysis-zh-semiannual.png") });
      }
      await expect(statistics.getByRole("status")).toContainText(lang === "zh" ? "该快照暂无年度报表历史" : "Annual statement history is unavailable in this snapshot");
      await expect(statistics.getByRole("status")).not.toContainText(lang === "zh" ? "切换到年度视图" : "switch to Annual");
    }
    await expect(selected).toBeEnabled();
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await expect(unavailable).toBeDisabled();
    await expect(unavailable).toHaveAttribute("aria-pressed", "false");
    await expect(statistics.locator(".fin-bar")).toHaveCount(availability === "annual" ? 6 : 0);
    await selected.focus();
    await nativeTarget(selected);
    await page.keyboard.press("Enter");
    await expect(selected).toHaveAttribute("aria-pressed", "true");
  });
}
