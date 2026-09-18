import { expect, test, type Page } from "@playwright/test";

async function armTerminalVisualReady(page: Page) {
  await page.addInitScript(() => {
    const readyWindow = window as Window & { __mmWatchlistVisualReady?: boolean };
    readyWindow.__mmWatchlistVisualReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      readyWindow.__mmWatchlistVisualReady = true;
    }, { once: true });
  });
}

async function waitForTerminalVisualReady(page: Page) {
  await expect.poll(
    () => page.evaluate(() =>
      Boolean((window as Window & { __mmWatchlistVisualReady?: boolean }).__mmWatchlistVisualReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 15_000 },
  ).toBe(true);
}

test("Ext price and Ext % are independent, persistent watchlist columns", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the watchlist rail is intentionally desktop-only");

  const extRequests: string[][] = [];
  await page.addInitScript(() => {
    if (sessionStorage.getItem("watchlist-ext-pct-fixture") === "seeded") return;
    sessionStorage.setItem("watchlist-ext-pct-fixture", "seeded");
    // A current-version workspace created before Ext % existed. Ext price is explicitly off;
    // the resolver must add the new default without overwriting that choice.
    localStorage.setItem("mm.setVersion", "1");
    localStorage.setItem("mm.set", JSON.stringify({
      tableView: true,
      cols: { last: true, changePct: true, change: false, volume: false, ext: false },
      disp: "symbol",
      logo: true,
      colW: {},
    }));
  });
  await page.route("**/api/ext-quote?**", async (route) => {
    const syms = (new URL(route.request().url()).searchParams.get("syms") || "")
      .split(",").filter(Boolean);
    extRequests.push(syms);
    await route.fulfill({ json: { quotes: Object.fromEntries(syms.map((sym) => [
      sym,
      sym === "NVDA"
        ? { extPrice: 421.14, extChg: 7.84, extTs: 1_785_533_400, extSession: "post" }
        : null,
    ])) } });
  });

  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=NVDA");
  await waitForTerminalVisualReady(page);

  const nvda = page.locator(".wl-row", { has: page.locator(".tk", { hasText: /^NVDA$/ }) });
  const extPctHeader = page.locator('.wl-cols [data-watchlist-column="extPct"]');
  const extHeader = page.locator('.wl-cols [data-watchlist-column="ext"]');
  await expect(extPctHeader).toHaveText("Ext %");
  await expect(extHeader).toHaveCount(0);
  await expect(nvda.locator('[data-watchlist-column="extPct"]')).toHaveText("+7.84%");
  await expect(nvda.locator('[data-watchlist-column="extPct"]')).toHaveClass(/\bup\b/);
  await expect(nvda.locator('[data-watchlist-column="extPct"]')).toHaveAttribute("title", "After hours · +7.84%");
  const aapl = page.locator(".wl-row", { has: page.locator(".tk", { hasText: /^AAPL$/ }) });
  const bitcoin = page.locator(".wl-row", { has: page.locator(".tk", { hasText: /^BTC-USD$/ }) });
  await expect(aapl.locator('[data-watchlist-column="extPct"]')).toHaveText("—");
  await expect(bitcoin.locator('[data-watchlist-column="extPct"]')).toHaveText("—");

  // Ext %-only mode must still subscribe the whole US watchlist, not just the active ticker.
  await expect.poll(() => extRequests.some((syms) => syms.includes("AAPL"))).toBe(true);

  await page.locator(".wl-acts button").last().click();
  const extSetting = page.locator('[data-watchlist-setting="ext"]');
  const extPctSetting = page.locator('[data-watchlist-setting="extPct"]');
  await expect(extSetting).not.toHaveClass(/\bon\b/);
  await expect(extPctSetting).toHaveClass(/\bon\b/);

  // Turn price on, then percentage off: each setting owns only its own column.
  await extSetting.click();
  await expect(extHeader).toHaveText("Ext");
  await expect(nvda.locator('[data-watchlist-column="ext"]')).toHaveText("421.14");
  await expect(extPctHeader).toHaveText("Ext %");
  await extPctSetting.click();
  await expect(extHeader).toHaveText("Ext");
  await expect(extPctHeader).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("mm.set") || "{}");
    return { ext: saved.cols?.ext, extPct: saved.cols?.extPct };
  })).toEqual({ ext: true, extPct: false });

  await page.reload();
  await waitForTerminalVisualReady(page);
  await expect(extHeader).toHaveText("Ext");
  await expect(extPctHeader).toHaveCount(0);
});

test("a transient ext-quote outage keeps the last-good quote at every width", async ({ page }, testInfo) => {
  const isDesktop = testInfo.project.name === "desktop";

  await page.addInitScript(() => {
    localStorage.setItem("mm.setVersion", "1");
    localStorage.setItem("mm.set", JSON.stringify({
      tableView: true,
      cols: { last: true, changePct: true, change: false, volume: false, ext: true, extPct: true },
      disp: "symbol",
      logo: true,
      colW: {},
    }));
  });

  let mode: "initial" | "outage" | "recovered" = "initial";
  let requestCount = 0;
  const quoteViews: Array<string | null> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/quote") quoteViews.push(url.searchParams.get("view"));
  });
  await page.route("**/api/ext-quote?**", async (route) => {
    requestCount++;
    if (mode === "outage") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "quote_hub_unavailable" }),
      });
      return;
    }

    const syms = (new URL(route.request().url()).searchParams.get("syms") || "")
      .split(",").filter(Boolean);
    const quote = mode === "recovered"
      ? { extPrice: 422.08, extChg: 8.06, extTs: 1_785_533_460, extSession: "post" }
      : { extPrice: 421.14, extChg: 7.84, extTs: 1_785_533_400, extSession: "post" };
    await route.fulfill({ json: { quotes: Object.fromEntries(syms.map((sym) => [
      sym,
      sym === "NVDA" ? quote : null,
    ])) } });
  });

  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=NVDA");
  await waitForTerminalVisualReady(page);
  await expect.poll(() => quoteViews.length).toBeGreaterThan(0);
  expect(quoteViews.every((view) => view === "regular")).toBe(true);

  const nvda = page.locator(".wl-row", { has: page.locator(".tk", { hasText: /^NVDA$/ }) });
  const extPrice = nvda.locator('[data-watchlist-column="ext"]');
  const extPct = nvda.locator('[data-watchlist-column="extPct"]');
  const detail = page.locator(".ah-block");
  const compactExtended = page.locator('[data-quote-lane="extended"]');
  const expectExt = async (price: string, pct: string) => {
    if (isDesktop) {
      await expect(extPrice).toHaveText(price);
      await expect(extPct).toHaveText(pct);
      await expect(detail.locator(".ah-price")).toHaveText(price);
      await expect(detail.locator(".ah-chg")).toHaveText(pct);
      return;
    }
    await expect(compactExtended).toContainText("After hours");
    await expect(compactExtended).toContainText(price);
    await expect(compactExtended).toContainText(pct);
  };
  await expectExt("421.14", "+7.84%");

  // Re-run the same callback the shell uses when a hidden tab becomes visible. A failed
  // refresh is not an authoritative deletion: every surface must keep the last-good print.
  mode = "outage";
  const beforeOutage = requestCount;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => requestCount).toBeGreaterThan(beforeOutage);
  await expectExt("421.14", "+7.84%");

  // A later successful response remains authoritative and advances all consumers together.
  mode = "recovered";
  const beforeRecovery = requestCount;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => requestCount).toBeGreaterThan(beforeRecovery);
  await expectExt("422.08", "+8.06%");
});
