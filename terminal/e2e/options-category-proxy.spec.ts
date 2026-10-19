import { expect, test, type Page } from "@playwright/test";

// Real /options?tab=desk → FlowDeskView ChainHeatRail. Only HTTP f=chainheat is synthetic.
const PROXY = {
  schema: "options_flow.category_proxy/v1",
  basis: "side_category",
  source_certified_accepted: false as const,
};
const MASS = {
  known_premium_usd: 4_000_000,
  unknown_premium_usd: 1_000_000,
  source_premium_usd: 5_000_000,
  invalid_premium_count: 0,
};

function camp(ticker: string, extra: Record<string, unknown> = {}) {
  return {
    option_symbol: `${ticker}260116C00180000`,
    ticker,
    type: "CALL",
    strike: 180,
    expiry: "2026-01-16",
    dte: 90,
    total_premium_mn: 3.5,
    alert_count: 3,
    span_minutes: 40,
    first_seen: "2026-09-17T13:45:00Z",
    ask_share: 0.99,
    lean: "accumulation",
    direction_reliability: "heuristic",
    authority_tier: "soft",
    ...extra,
  };
}

const CHAINHEAT = {
  asof: "2026-09-17T14:00:00Z",
  session_date: "2026-09-17",
  threshold_mn: 3,
  campaigns: [
    camp("AAPL", { category_proxy: { ...PROXY, share: 0.8, ...MASS } }),
    camp("MSFT", {
      category_proxy: {
        ...PROXY, share: null, known_premium_usd: 0,
        unknown_premium_usd: 5_000_000, source_premium_usd: 5_000_000,
        invalid_premium_count: 0,
      },
    }),
    camp("NVDA", { category_proxy: null }),
    camp("TSLA", { category_proxy: { ...PROXY, share: 0.8, ...MASS, source_premium_usd: 9_000_000 } }),
    camp("META", { category_proxy: { schema: PROXY.schema, basis: PROXY.basis, share: 0.8, ...MASS } }),
    camp("AMZN", { category_proxy: { ...PROXY, share: 0.8, ...MASS, invalid_premium_count: 1 } }),
    camp("GOOG", { ask_share: 0.42 }),
    camp("NFLX", { ask_share: null }),
  ],
};

function row(page: Page, ticker: string) {
  return page.locator(".obs-fd-chain-row").filter({
    has: page.locator(".obs-fd-chain-ticker", { hasText: new RegExp(`^${ticker}$`) }),
  });
}

async function assertNoFill(page: Page, ticker: string) {
  const r = row(page, ticker);
  await expect(r.locator(".obs-fd-chain-askbar-fill")).toHaveCount(0);
  await expect(r).not.toContainText("99%");
  await expect(r).not.toContainText("80%");
}

for (const lang of ["en", "zh"] as const) {
  test(`desk chainheat category proxy honest bars (${lang})`, async ({ page }, info) => {
    await page.addInitScript((value) => { localStorage.setItem("mm.lang", value); }, lang);
    await page.route("**/api/flow?**", async (route) => {
      const f = new URL(route.request().url()).searchParams.get("f") ?? "";
      if (f === "chainheat") return route.fulfill({ json: CHAINHEAT });
      return route.continue();
    });
    await page.goto("/options?tab=desk");
    for (const sel of [".obs-fd-left", ".obs-fd-center", ".obs-fd-right"]) {
      await page.locator(sel).scrollIntoViewIfNeeded();
      await expect(page.locator(sel)).toBeVisible();
    }
    const chain = page.locator(".obs-fd-chain");
    await chain.scrollIntoViewIfNeeded();
    await expect(page.locator(".obs-fd-chain-row")).toHaveCount(8, { timeout: 30_000 });

    const unavail = lang === "zh" ? "不可用" : "unavailable";
    const cov = lang === "zh" ? "覆盖 4.0M / 5.0M" : "coverage 4.0M / 5.0M";
    const legacy = lang === "zh"
      ? "旧版类别代理值 · 覆盖不可用"
      : "Legacy category proxy · coverage unavailable";

    const valid = row(page, "AAPL");
    await valid.scrollIntoViewIfNeeded();
    await expect(valid).toBeVisible();
    const bounds = await chain.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(280);
    expect(bounds!.height).toBeGreaterThanOrEqual(150);
    await expect(valid.locator(".obs-fd-chain-caveat").last()).toBeVisible();
    await expect(valid).toContainText("80%");
    await expect(valid).toContainText(cov);
    await expect(valid).not.toContainText("99%");
    await expect(valid.locator(".obs-fd-chain-askbar-fill")).toHaveAttribute("style", /width:\s*80%/);

    await expect(row(page, "MSFT")).toContainText(unavail);
    await assertNoFill(page, "MSFT");

    for (const ticker of ["NVDA", "TSLA", "META", "AMZN"]) {
      await expect(row(page, ticker)).toContainText(unavail);
      await expect(row(page, ticker)).not.toContainText(legacy);
      await assertNoFill(page, ticker);
    }

    const leg = row(page, "GOOG");
    await expect(leg).toContainText(legacy);
    await expect(leg).toContainText("42%");
    await expect(leg.locator(".obs-fd-chain-askbar-fill")).toHaveAttribute("style", /width:\s*42%/);
    await expect(leg).not.toContainText("99%");

    const legNull = row(page, "NFLX");
    await expect(legNull).toContainText(legacy);
    await expect(legNull).toContainText(unavail);
    await assertNoFill(page, "NFLX");
    await expect(legNull).not.toContainText("42%");

    await chain.screenshot({ path: info.outputPath(`${info.project.name}-${lang}-chainheat.png`) });
  });
}
