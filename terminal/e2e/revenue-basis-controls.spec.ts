import { expect, test, type Locator, type Page } from "@playwright/test";

type Availability = "both" | "annual" | "quarterly";
function fixture(availability: Availability = "both") {
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
    profile: null, stats: null,
    statements: { annual: availability === "quarterly" ? null : annual, quarterly: availability === "annual" ? null : quarterly },
    ratios: { periods: [], current: {} }, earnings: null, estimates: null, analyst: null,
    dividends: null, ownership: null, guidance: null, segments: null,
  };
}

async function openRevenue(page: Page, surface: "analysis" | "terminal", lang: "en" | "zh", availability: Availability = "both") {
  const theme = lang === "zh" && (surface === "terminal" || process.env.MMX_SHARED_SHELL === "1") ? "light" : "dark";
  let fundReads = 0;
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("mmx.shell.theme", theme);
  }, { lang, theme });
  await page.route("**/api/**", route => route.fulfill({ status: 503, json: { error: "local_revenue_fixture" } }));
  await page.route("**/NVDA.fund.json**", route => {
    fundReads++;
    return route.fulfill({ json: fixture(availability) });
  });
  await page.goto(surface === "analysis" ? "/analysis?symbol=NVDA&page=revenue" : "/terminal?symbol=NVDA");
  await expect(page.locator(surface === "analysis" ? ".analysis-shell" : ".workspace")).toBeVisible();
  const title = lang === "zh" ? "营收历史" : "REVENUE HISTORY";
  const history = page.locator(".fin-sec").filter({ has: page.locator(".fin-eyebrow", { hasText: new RegExp("^" + title + "$") }) });
  if (surface === "terminal") {
    await expect.poll(async () => {
      if (await history.count()) return true;
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:open-pane", { detail: "revenue" })));
      return (await history.count()) === 1;
    }, { timeout: 15_000 }).toBe(true);
  }
  await expect(history).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  return { history, fundReads: () => fundReads };
}

async function nativeTarget(button: Locator) {
  const box = await button.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await expect.poll(() => button.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === el || el.contains(hit);
  }), { message: "Native basis focus remains clear of the bottom navigation" }).toBe(true);
}

for (const surface of ["analysis", "terminal"] as const) for (const lang of ["en", "zh"] as const) {
  test(`${surface} ${lang}: selected revenue basis matches its chart and table`, async ({ page }, info) => {
    if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    const { history, fundReads } = await openRevenue(page, surface, lang);
    const group = history.locator(".fin-toggle.fin-aq");
    const annual = group.getByRole("button", { name: lang === "zh" ? "年度" : "Annual", exact: true });
    const quarterly = group.getByRole("button", { name: lang === "zh" ? "季度" : "Quarterly", exact: true });
    await expect(history.locator(".fin-bar")).toHaveCount(3);
    await expect(history.locator("table")).toContainText("300.00M");
    const reads = fundReads();
    await annual.focus();
    const capture = (info.project.name === "desktop" && lang === "en") || (info.project.name === "mobile" && lang === "zh");
    if (capture) await page.screenshot({ path: info.outputPath(`${surface}-${lang}-initial.png`) });
    console.info("revenue initial controls", JSON.stringify({
      surface, lang, annual: await annual.boundingBox(), quarterly: await quarterly.boundingBox(),
      role: await group.getAttribute("role"), annualPressed: await annual.getAttribute("aria-pressed"),
      quarterlyPressed: await quarterly.getAttribute("aria-pressed"),
    }));
    await expect(group).toHaveAttribute("role", "group");
    await expect(group).toHaveAttribute("aria-label", lang === "zh" ? "营收历史口径" : "Revenue history basis");
    await expect(annual).toHaveAttribute("aria-pressed", "true");
    await expect(quarterly).toHaveAttribute("aria-pressed", "false");
    await expect(annual).toHaveAttribute("type", "button");
    await nativeTarget(annual);
    await page.keyboard.press("Tab");
    await expect(quarterly).toBeFocused();
    await nativeTarget(quarterly);
    expect(await quarterly.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
    await page.keyboard.press("Space");
    await expect(quarterly).toHaveAttribute("aria-pressed", "true");
    await expect(annual).toHaveAttribute("aria-pressed", "false");
    await expect(history.locator(".fin-bar")).toHaveCount(2);
    await expect(history.locator("table")).toContainText("Q2 2026");
    await expect(history.locator("table")).toContainText("40.00M");
    await expect(history.locator("table")).not.toContainText("FY2025");
    await expect(quarterly).toBeFocused();
    await nativeTarget(quarterly);
    if (capture) await page.screenshot({ path: info.outputPath(`${surface}-${lang}-quarterly.png`) });
    await page.keyboard.press("Shift+Tab");
    await expect(annual).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(annual).toHaveAttribute("aria-pressed", "true");
    await expect(quarterly).toHaveAttribute("aria-pressed", "false");
    await expect(history.locator(".fin-bar")).toHaveCount(3);
    await expect(history.locator("table")).toContainText("FY2025");
    await expect(history.locator("table")).toContainText("300.00M");
    await nativeTarget(annual);
    if (info.project.name === "mobile") {
      await quarterly.tap();
      await expect(quarterly).toHaveAttribute("aria-pressed", "true");
      await expect(history.locator(".fin-bar")).toHaveCount(2);
    }
    expect(fundReads()).toBe(reads);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

for (const availability of ["annual", "quarterly"] as const) {
  test(`${availability}-only basis follows the available history`, async ({ page }, info) => {
    // Each payload has its own browser context: the real data owner retains a symbol's cached snapshot.
    if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    const lang = info.project.name === "mobile" ? "zh" : "en";
    const { history, fundReads } = await openRevenue(page, "analysis", lang, availability);
    expect(fundReads()).toBeGreaterThan(0);
    const group = history.getByRole("group", { name: lang === "zh" ? "营收历史口径" : "Revenue history basis", exact: true });
    const annual = group.getByRole("button", { name: lang === "zh" ? "年度" : "Annual", exact: true });
    const interim = group.getByRole("button").nth(1);
    const selected = availability === "annual" ? annual : interim;
    const unavailable = availability === "annual" ? interim : annual;
    await expect(selected).toBeEnabled();
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await expect(unavailable).toBeDisabled();
    await expect(unavailable).toHaveAttribute("aria-pressed", "false");
    await expect(history.locator(".fin-bar")).toHaveCount(availability === "annual" ? 3 : 2);
    await expect(history.locator("table")).toContainText(availability === "annual" ? "300.00M" : "40.00M");
    await selected.focus();
    await nativeTarget(selected);
    await page.keyboard.press("Enter");
    await expect(selected).toHaveAttribute("aria-pressed", "true");
  });
}
