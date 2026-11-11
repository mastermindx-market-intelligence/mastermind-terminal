import { expect, test } from "@playwright/test";

test.skip(process.env.MMX_SHARED_SHELL !== "1", "Existing beta presentation required");

function fund(ticker: string, pe: number) {
  return {
    schema: "mastermind.fund/v1", ticker, asof: "2026-11-06", quote_currency: "USD", stmt_currency: "USD",
    stats: { shares_out: 10_000_000, mktcap: 1_000_000_000 }, profile: { employees: 100 },
    ratios: { periods: [], pe: [], ps: [], pb: [], pcf: [], current: { pe_ttm: pe } },
    statements: { annual: null, quarterly: null },
  };
}

for (const lang of ["en", "zh"] as const) {
test(`company switch keeps published statistics scoped without unused quotes (${lang})`, async ({ page, context, baseURL }, info) => {
  const pageErrors: string[] = [], quoteRequests: string[] = [];
  await page.addInitScript(value => localStorage.setItem("mm.lang", value), lang);
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/quote" && url.searchParams.get("view") === "regular"
      && ["NVDA", "AAPL"].includes(url.searchParams.get("syms") ?? "")) quoteRequests.push(url.pathname + url.search);
  });
  await context.addCookies([
    { name: "mm_e2e_rs30", value: "1", url: baseURL! },
    { name: "mm_e2e_guest", value: "1", url: baseURL! },
  ]);
  await page.route("https://www.mastermind-x.com/mm_brain.js", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/data/manifest.json", route => route.fulfill({ json: { as_of: null, symbols: {
    NVDA: { name: "NVIDIA Corporation", mkt: "NASDAQ", col: "#aaa", sec: "Equities", verdict: null },
    AAPL: { name: "Apple Inc.", mkt: "NASDAQ", col: "#aaa", sec: "Equities", verdict: null },
  } } }));
  await page.route("**/NVDA.fund.json**", route => route.fulfill({ json: fund("NVDA", 20) }));
  let releaseApple!: () => void;
  const appleGate = new Promise<void>(resolve => { releaseApple = resolve; });
  await page.route("**/AAPL.fund.json**", async route => {
    await appleGate; await route.fulfill({ json: fund("AAPL", 30) });
  });
  try {
    await page.goto("/analysis?symbol=NVDA&page=statistics");
    const panel = page.locator("#fin-active-panel");
    const peRow = () => panel.getByRole("row").filter({ has: page.getByRole("rowheader", { name: lang === "zh" ? "市盈率" : "Price to earnings ratio", exact: true }) });
    await expect(peRow()).toContainText("20.00");
    await page.locator(".analysis-context-bar").getByRole("button", { name: lang === "zh" ? "切换标的" : "Change symbol", exact: true }).click();
    const picker = page.getByRole("dialog");
    await picker.getByRole("combobox").fill("Apple");
    await expect(picker.getByRole("option", { name: /AAPL Apple Inc/ })).toBeVisible();
    await picker.getByRole("combobox").press("Enter");
    await picker.getByRole("button", { name: lang === "zh" ? "打开分析" : "Open Analysis", exact: true }).click();
    await expect(page).toHaveURL(/symbol=AAPL/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(panel).not.toContainText("20.00");
    await expect(page.getByTestId("fundamentals-loading")).toContainText(lang === "zh" ? "正在加载财务数据" : "Loading financial data");
    await page.screenshot({ path: info.outputPath(`company-loading-${lang}.png`), animations: "disabled" });
    releaseApple();
    await expect(peRow()).toContainText("30.00");
    await expect(page.getByTestId("fundamentals-loading")).toHaveCount(0);
    expect(quoteRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`selected-company-statistics-${lang}.png`), animations: "disabled" });
  } finally { releaseApple(); }
});
}
