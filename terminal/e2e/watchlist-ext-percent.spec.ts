import { expect, test, type Page } from "./fixtures";

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
