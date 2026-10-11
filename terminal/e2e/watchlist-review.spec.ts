import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { useLang } from "./layoutStore";
import { E2E_WL_FLAGS_KEY, E2E_WL_NOTES_KEY, E2E_WLS_KEY, e2eWatchlistOwner, isolateWatchlistStore, seedOwnerWatchlists } from "./watchlistStore";

// E16: a user-started review that freezes one list's order, walks it next/previous through the
// shell's own navigation owner, skips symbols with no data BY NAME, and resumes after a reload.
// The real shell, the real rail and the real #821 context card; deterministic feed/auth fixtures.

const LIST = "Review Mix";
// ZZZQ is in no manifest: the review must skip it explicitly, never open a neighbour in its place.
const ORDER = ["NVDA", "ZZZQ", "MSFT", "AAPL", "AMD"];
const SEED = {
  lists: { Default: [], [LIST]: ORDER.map((symbol) => ({ symbol, section: "" })) },
  active: LIST,
  meta: { Default: { sections: [], collapsed: [] }, [LIST]: { sections: [], collapsed: [] } },
};
const REVIEW_KEY = "mm.wlReview.v1";

const COPY = {
  en: {
    region: "Watchlist review", next: "Next symbol", prev: "Previous symbol", reviewed: "Mark reviewed", defer: "Defer",
    saveDefer: "Save defer", end: "End review", sort: "Sort A → Z", chipReviewed: "Reviewed", chipDeferred: "Deferred",
    skipped: "Skipped ZZZQ (no market data).", nextIs: (s: string) => `Next: ${s}`, position: (n: number, t: number) => `${n} of ${t}`,
    summary: "1 reviewed · 1 deferred · 1 unavailable", saved: "Progress saved on this device.", unsaved: "Not saved", retry: "Retry save",
    atEnd: "No available symbol after this one.", start: "Review this list", resume: "Resume review",
  },
  zh: {
    region: "自选列表复盘", next: "下一个标的", prev: "上一个标的", reviewed: "标记已复盘", defer: "推迟",
    saveDefer: "确认推迟", end: "结束复盘", sort: "按 A → Z 排序", chipReviewed: "已复盘", chipDeferred: "已推迟",
    skipped: "已跳过 ZZZQ（无行情数据）。", nextIs: (s: string) => `下一个：${s}`, position: (n: number, t: number) => `第 ${n} / ${t} 个`,
    summary: "已复盘 1 · 已推迟 1 · 不可用 1", saved: "进度已保存在本设备。", unsaved: "未保存", retry: "重试保存",
    atEnd: "之后没有可复盘的标的。", start: "逐个复盘此列表", resume: "继续复盘",
  },
} as const;

/** The chart's active security, read from the context owner Brain/linked panels consume. */
const chartSymbol = (page: Page) => page.evaluate(() => {
  const cfg = (window as unknown as { MM_BRAIN_CFG?: { getAiContext?: () => { active?: { id: string } } } }).MM_BRAIN_CFG;
  return cfg?.getAiContext?.().active?.id ?? null;
});
const wide = (page: Page) => (page.viewportSize()?.width ?? 0) > 860;
const reviewSlot = (page: Page, owner: string) => page.evaluate(([key, slot]) => {
  try { return JSON.parse(localStorage.getItem(key) || "{}")[slot] ?? null; } catch { return "unreadable"; }
}, [REVIEW_KEY, owner] as const);
const ownedKeys = (page: Page) => page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), [E2E_WLS_KEY, E2E_WL_FLAGS_KEY, E2E_WL_NOTES_KEY]);

async function boot(page: Page, testInfo: TestInfo, baseURL: string | undefined, lang: "en" | "zh", symbol = "SPY") {
  const storeKey = await isolateWatchlistStore(page, testInfo, baseURL);
  await seedOwnerWatchlists(page, storeKey, SEED);
  await useLang(page, lang);
  await page.route("https://www.mastermind-x.com/mm_brain.js", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.goto(`/terminal?symbol=${symbol}`);
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  return { storeKey, owner: e2eWatchlistOwner(storeKey) };
}

/** Desktop starts from the list menu; at ≤860px (where the rail board is hidden) from the idle control. */
async function startReview(page: Page, lang: "en" | "zh") {
  if (wide(page)) {
    await expect(page.locator(".wl-select")).toContainText(LIST);
    await expect(page.locator(".wl-row")).toHaveCount(ORDER.length);
    await page.locator(".wl-select").click();
    const entry = page.getByTestId("wl-review-start");
    await expect(entry).toHaveText(COPY[lang].start);
    await entry.click();
  } else {
    const idle = page.getByTestId("wl-review-idle-start");
    await expect(idle).toContainText(LIST, { timeout: 30_000 });
    await idle.scrollIntoViewIfNeeded();
    await idle.click();
  }
  const region = page.getByRole("region", { name: COPY[lang].region });
  await expect(region).toBeVisible();
  return region;
}

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: a frozen review walks a mixed list, keeps its order through a re-sort and resumes after reload`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const c = COPY[lang];
    const { owner } = await boot(page, testInfo, baseURL, lang);
    const region = await startReview(page, lang);
    const current = region.getByTestId("wl-review-current");
    const next = region.getByRole("button", { name: c.next, exact: true });
    const prev = region.getByRole("button", { name: c.prev, exact: true });

    await expect(current).toHaveText("NVDA");
    await expect.poll(() => chartSymbol(page)).toBe("NVDA");
    await expect(region.getByTestId("wl-review-position")).toHaveText(c.position(1, 5));
    await expect(region.getByTestId("wl-review-next")).toHaveText(c.nextIs("MSFT"));

    await next.click();
    await expect(current).toHaveText("MSFT");
    await expect(region.getByTestId("wl-review-notice")).toHaveText(c.skipped);
    await expect.poll(() => chartSymbol(page)).toBe("MSFT");

    // The falsifier, in every project: re-sorting the live list must not change where Next goes.
    // In the live A→Z order MSFT is followed by NVDA; the frozen review still goes to AAPL. The
    // list's sort control lives on the rail board, which is hidden at ≤860px, so tablet and phone
    // widen the same page for the sort and narrow it again; the review is never reloaded.
    const viewport = page.viewportSize()!;
    if (!wide(page)) await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".wl-select").click();
    await page.locator(".wl-lists .menu-row", { hasText: c.sort }).click();
    await expect(page.locator(".wl-row").first()).toHaveAttribute("data-watchlist-symbol", "AAPL");
    await page.setViewportSize(viewport);
    await expect(current).toHaveText("MSFT");
    await expect(region.getByTestId("wl-review-next")).toHaveText(c.nextIs("AAPL"));
    await expect(region.getByTestId("wl-review-drift")).toHaveCount(0);

    // Markers: review-local only. No list, flag, note, alert or watchlist write may follow.
    const before = await ownedKeys(page);
    const writes: string[] = [];
    const onRequest = (request: import("@playwright/test").Request) => {
      if (request.url().includes("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(new URL(request.url()).pathname);
    };
    page.on("request", onRequest);
    await region.getByRole("button", { name: c.reviewed, exact: true }).click();
    await expect(region.getByTestId("wl-review-mark")).toHaveText(c.chipReviewed);
    await expect(region.getByRole("button", { name: c.reviewed, exact: true })).toHaveAttribute("aria-pressed", "true");

    await next.click();
    await expect(current).toHaveText("AAPL");
    await expect.poll(() => chartSymbol(page)).toBe("AAPL");
    await region.getByRole("button", { name: c.defer, exact: true }).click();
    await region.locator("#wl-review-defer-note").fill("after earnings");
    await region.getByRole("button", { name: c.saveDefer, exact: true }).click();
    await expect(region.getByTestId("wl-review-mark")).toHaveText(c.chipDeferred);
    await expect(region.getByTestId("wl-review-note")).toHaveText("after earnings");

    await prev.click();
    await expect(current).toHaveText("MSFT");
    await expect(region.getByTestId("wl-review-mark")).toHaveText(c.chipReviewed);
    await next.click();
    await next.click();
    await expect(current).toHaveText("AMD");
    await expect.poll(() => chartSymbol(page)).toBe("AMD");
    await expect(region.getByTestId("wl-review-position")).toHaveText(c.position(5, 5));
    await expect(next).toBeDisabled();
    await expect(region.getByTestId("wl-review-summary")).toHaveText(c.summary);
    await expect(region.getByTestId("wl-review-save")).toHaveText(c.saved);
    page.off("request", onRequest);
    expect(await ownedKeys(page)).toEqual(before);
    expect(writes.filter((path) => /alert|watchlist|flag|note|portfolio|position/.test(path))).toEqual([]);

    await region.screenshot({ path: testInfo.outputPath(`review-${lang}.png`), animations: "disabled" });
    // The bar in context: the whole visible page at this width, scrolled so the bar is on screen.
    await region.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: testInfo.outputPath(`context-${lang}.png`), animations: "disabled" });

    // Resume: same owner, same list, same frozen order, same position. Reloading does not move the chart.
    const saved = await reviewSlot(page, owner);
    expect(saved).toMatchObject({ listName: LIST, symbols: ORDER, cursor: 4 });
    await page.goto("/terminal?symbol=SPY");
    await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
    const resumed = page.getByRole("region", { name: c.region });
    await expect(resumed.getByTestId("wl-review-current")).toHaveText("AMD");
    await expect(resumed.getByTestId("wl-review-summary")).toHaveText(c.summary);
    await expect.poll(() => chartSymbol(page)).toBe("SPY");
    await resumed.getByRole("button", { name: c.prev, exact: true }).click();
    await expect(resumed.getByTestId("wl-review-current")).toHaveText("AAPL");
    await expect(resumed.getByTestId("wl-review-note")).toHaveText("after earnings");
    await expect.poll(() => chartSymbol(page)).toBe("AAPL");

    await resumed.getByRole("button", { name: c.end, exact: true }).click();
    await expect(page.getByRole("region", { name: c.region })).toHaveCount(0);
    expect(await reviewSlot(page, owner)).toBeNull();
  });
}

test("en: Next updates linked panels through the context owner and leaves a pinned panel pinned", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  await boot(page, testInfo, baseURL, "en", "NVDA");
  const card = page.getByRole("region", { name: "Seasonality view context" });
  const status = card.locator('p[role="status"]');
  await expect(status).toContainText("NVDA", { timeout: 45_000 });

  const region = await startReview(page, "en");
  await expect(region.getByTestId("wl-review-current")).toHaveText("NVDA");
  await card.scrollIntoViewIfNeeded();
  const pin = card.getByRole("button", { name: "Pin this view", exact: true });
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");

  await region.scrollIntoViewIfNeeded();
  await region.getByRole("button", { name: "Next symbol", exact: true }).click();
  await expect(region.getByTestId("wl-review-current")).toHaveText("MSFT");
  await expect.poll(() => chartSymbol(page)).toBe("MSFT");
  await expect(status).toContainText("pinned to NVDA; chart is MSFT");
  await expect(card.getByTestId("seasonality-context")).toContainText("NVDA");

  await card.getByRole("button", { name: "Follow chart", exact: true }).click();
  await expect(status).toHaveText("Following chart: MSFT");
  await region.getByRole("button", { name: "Next symbol", exact: true }).click();
  await expect(region.getByTestId("wl-review-current")).toHaveText("AAPL");
  await expect(status).toHaveText("Following chart: AAPL");
  await expect(card.getByTestId("seasonality-context")).toContainText("AAPL");
});

test("en: a review belongs to its account, and a refused save says so until Retry succeeds", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const { storeKey, owner } = await boot(page, testInfo, baseURL, "en");
  const region = await startReview(page, "en");
  await region.getByRole("button", { name: "Next symbol", exact: true }).click();
  await expect(region.getByTestId("wl-review-current")).toHaveText("MSFT");

  // The browser store starts refusing writes for the review key (quota / blocked storage).
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    (window as unknown as { __restoreReviewStore?: () => void }).__restoreReviewStore = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (this: Storage, name: string, value: string) {
      if (name === key) throw new DOMException("full", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, REVIEW_KEY);
  await region.getByRole("button", { name: "Next symbol", exact: true }).click();
  await expect(region.getByTestId("wl-review-current")).toHaveText("AAPL");
  await expect(region.getByTestId("wl-review-save")).toHaveAttribute("data-save", "unsaved");
  await expect(region.getByTestId("wl-review-save")).toContainText("Not saved");
  expect(await reviewSlot(page, owner)).toMatchObject({ cursor: 2 });
  await page.evaluate(() => (window as unknown as { __restoreReviewStore?: () => void }).__restoreReviewStore?.());
  await region.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(region.getByTestId("wl-review-save")).toHaveAttribute("data-save", "saved");
  expect(await reviewSlot(page, owner)).toMatchObject({ cursor: 3 });

  // Another account on the same browser never sees (or writes into) this review.
  const otherKey = `${storeKey}-b`.slice(0, 110);
  await page.context().addCookies([{ name: "mm_e2e_wl", value: otherKey, url: baseURL ?? "http://127.0.0.1:3108" }]);
  await page.goto("/terminal?symbol=SPY");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("wl-review-start").or(page.getByTestId("wl-review-idle-start")).first()).toBeAttached({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Watchlist review" })).toHaveCount(0);
  expect(await reviewSlot(page, e2eWatchlistOwner(otherKey))).toBeNull();

  await page.context().addCookies([{ name: "mm_e2e_wl", value: storeKey, url: baseURL ?? "http://127.0.0.1:3108" }]);
  await page.goto("/terminal?symbol=SPY");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Watchlist review" }).getByTestId("wl-review-current")).toHaveText("AAPL");
});

test("en: a review started on the web never surfaces in the native dossier", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const { owner } = await boot(page, testInfo, baseURL, "en");
  const region = await startReview(page, "en");
  await region.getByRole("button", { name: "Next symbol", exact: true }).click();
  await expect(region.getByTestId("wl-review-current")).toHaveText("MSFT");
  const saved = await reviewSlot(page, owner);
  expect(saved).toMatchObject({ listName: LIST, cursor: 2 });

  // The installable app opens the dossier for NVDA on the same browser profile. It has no chart, so
  // the review (and its menu entry) must not appear there, and nothing may move the symbol to MSFT.
  await page.goto("/terminal?symbol=NVDA&shell=app&dossier=1");
  await expect(page.locator('[data-dossier="1"]')).toHaveCount(1);
  await expect(page.locator(".detail-board")).toBeVisible({ timeout: 45_000 });
  await page.waitForFunction(() => (window as unknown as { __mmShell?: { version?: number } }).__mmShell?.version === 1);
  await expect(page.locator('[data-testid^="wl-review"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __mmShell: { getState: () => { sym: string } } }).__mmShell.getState().sym)).toBe("NVDA");
  // The saved review is untouched: the dossier neither resumed, moved nor ended it.
  expect(await reviewSlot(page, owner)).toEqual(saved);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath("dossier-en.png"), animations: "disabled" });
});

test("en: a saved review this device cannot read is named before a new start replaces it", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const storeKey = await isolateWatchlistStore(page, testInfo, baseURL);
  const owner = e2eWatchlistOwner(storeKey);
  await seedOwnerWatchlists(page, storeKey, SEED);
  // A record in a format this build does not know (e.g. written by a newer version).
  await page.addInitScript(([key, slot]) => {
    if (sessionStorage.getItem("e16-unreadable-seeded")) return;
    sessionStorage.setItem("e16-unreadable-seeded", "1");
    localStorage.setItem(key, JSON.stringify({ [slot]: { v: 9, listName: "Review Mix" } }));
  }, [REVIEW_KEY, owner] as const);
  await useLang(page, "en");
  await page.route("https://www.mastermind-x.com/mm_brain.js", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.goto("/terminal?symbol=SPY");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });

  const notice = page.getByTestId("wl-review-unreadable");
  await notice.scrollIntoViewIfNeeded();
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("A saved review on this device could not be read. Starting a review replaces it.");
  // Loading the page did not overwrite the record.
  expect(await reviewSlot(page, owner)).toEqual({ v: 9, listName: "Review Mix" });

  const region = await startReview(page, "en");
  await expect(region.getByTestId("wl-review-current")).toHaveText("NVDA");
  await expect(page.getByTestId("wl-review-unreadable")).toHaveCount(0);
  expect(await reviewSlot(page, owner)).toMatchObject({ v: 1, listName: LIST, cursor: 0 });
});

