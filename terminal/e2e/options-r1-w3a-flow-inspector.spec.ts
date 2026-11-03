import { expect, test } from "@playwright/test";
import fixture from "./fixtures/options-r1-w3a-flow.json";

/**
 * W3A flow print inspector (Options R1 packet 3, U05 board).
 *
 * Draft — written and type-checked, not yet run by this seat. The mocking shape
 * mirrors e2e/options-activity-sign.spec.ts: the real Tape and its SSE consumer
 * are exercised against a local response fixture; the fixture is test data, not
 * market data or a claim about any production source.
 *
 * Expected arithmetic over the 9 fixture rows (unknown stays in every denominator):
 *   total 3,071,000 · unknown 355,000 → 12 % unknown / 88 % classified
 *   calls 2,321,000 · puts 750,000 (unsigned)
 */

const feed = (fixture as { feed: Record<string, unknown> }).feed;

/** Route the feed over both transports exactly as the Tape consumes them. */
async function mockFlowFeed(page: import("@playwright/test").Page) {
  await page.route(/\/api\/flow(?:\/stream)?\?/, (route) => {
    const url = route.request().url();
    // Only the feed is fixtured. The desk also polls `f=tide` (and ticker
    // detail) on the same path; answering those with the feed object would
    // hand the Watchlist rail a tide without `minutes` and crash the desk.
    const kind = new URL(url).searchParams.get("f");
    if (kind !== "feed") return route.continue();
    if (url.includes("/stream")) {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify(feed)}\n\n`,
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(feed) });
  });
}

async function openDesk(page: import("@playwright/test").Page, lang: "en" | "zh") {
  await page.addInitScript((locale) => {
    localStorage.setItem("mm.lang", locale);
    localStorage.setItem("flowdesk.tutorial.seen", "1");
  }, lang);
  await mockFlowFeed(page);
  await page.goto("/options?tab=desk");
  await expect(page.locator('[data-testid="flow-coverage"]')).toBeVisible();
}

/** A flow card is identified by its rendered size + premium text (no row hook on FlowCard). */
function card(page: import("@playwright/test").Page, text: string) {
  return page.locator('[data-tut="flow-card"]', { hasText: text });
}

test("coverage line keeps unknown premium in the denominator and totals calls and puts unsigned", async ({ page }) => {
  await openDesk(page, "en");
  const coverage = page.locator('[data-testid="flow-coverage"]');
  await expect(coverage).toContainText("88 % of eligible premium classified · 12 % unknown");
  await expect(coverage).toContainText("Calls $2.3M · Puts $750.0K · unsigned premium, not a direction");
});

test("selecting e1 shows the print inspector with premium arithmetic, named-method side and the not-supplied clocks", async ({ page }) => {
  await openDesk(page, "en");
  await card(page, "$504.0K").click();
  const inspector = page.locator('[data-testid="flow-print-inspector"]');
  const evidence = inspector.locator("details");
  await expect(evidence).not.toHaveAttribute("open", "");
  await expect(inspector.getByText("Bought · estimate", { exact: true })).toBeVisible();
  await expect(inspector.getByText("$0.84", { exact: true })).toBeVisible();
  await expect(inspector.getByText("receipt not supplied", { exact: false })).not.toBeVisible();
  await evidence.locator("summary").click();
  await expect(inspector).toContainText("AAPL 230 C · Oct 23, 2026");
  await expect(inspector).toContainText("Event 10:40:12 ET");
  await expect(inspector).toContainText("receipt not supplied by the flow owner");
  await expect(inspector).toContainText("exchange and conditions not supplied");
  await expect(inspector).toContainText("$504,000 = 6,000 × $0.84 × 100");
  await expect(inspector).toContainText("Bought · estimate");
  await expect(inspector).toContainText("method: tick rule on the tape");
  await expect(inspector).toContainText("confidence not supplied by the flow owner");
  await expect(inspector).toContainText("No package source is admitted. Similar timestamps alone never group prints.");
  await expect(inspector).toContainText("1.63× prior open interest");
});

test("selecting e5 shows the owner's figure as not reproducible from size × price × 100", async ({ page }) => {
  await openDesk(page, "en");
  await card(page, "$395.0K").click();
  const inspector = page.locator('[data-testid="flow-print-inspector"]');
  await expect(inspector.locator("details")).not.toHaveAttribute("open", "");
  await expect(inspector.getByRole("note")).toBeVisible();
  await expect(inspector.getByRole("note")).toContainText("owner's figure · not reproducible from 4,100 × $0.95 × 100");
  await expect(inspector).toContainText("Mixed");
});

test("the 23 Oct expiry filter hides the 20 Nov row and never changes the coverage line", async ({ page }) => {
  await openDesk(page, "en");
  const coverage = page.locator('[data-testid="flow-coverage"]');
  const before = await coverage.textContent();
  const novRow = card(page, "2026-11-20");
  await expect(novRow).toHaveCount(1);

  await page.getByRole("button", { name: "Filters" }).click();
  await page.locator('[data-testid="flow-filter-exp"]').getByRole("button", { name: "Oct 23" }).click();
  await expect(novRow).toHaveCount(0);
  await expect(page.locator('[data-testid="flow-coverage"]')).toHaveText(before ?? "");
});

test("the expiry filter survives a reload through flowdesk.filters.v1", async ({ page }) => {
  await openDesk(page, "en");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.locator('[data-testid="flow-filter-exp"]').getByRole("button", { name: "Oct 23" }).click();
  await expect(card(page, "2026-11-20")).toHaveCount(0);

  await page.reload();
  await expect(page.locator('[data-testid="flow-coverage"]')).toBeVisible();
  await expect(card(page, "2026-11-20")).toHaveCount(0);
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(
    page.locator('[data-testid="flow-filter-exp"]').getByRole("button", { name: "Oct 23" }),
  ).toHaveClass(/on/);
});

test("equal-timestamp prints keep their id order across re-sorts (e6 before e9)", async ({ page }) => {
  await openDesk(page, "en");
  const positions = async () => {
    const texts = await page.locator('[data-tut="flow-card"]').allTextContents();
    const at = (needle: string) => texts.findIndex((t) => t.includes(needle));
    return { e6: at("2,900"), e9: at("Size 1,000") };
  };
  // The payload delivers e9 BEFORE e6; the comparator's id tiebreak must hold.
  expect((await positions()).e6).toBeLessThan((await positions()).e9);

  // Two forced re-renders through the sort toggle — the relative order is stable.
  // exact: the per-card "Show score breakdown" buttons also match a loose "SCORE".
  await page.getByRole("button", { name: "SCORE", exact: true }).click();
  await page.getByRole("button", { name: "NEW", exact: true }).click();
  const after = await positions();
  expect(after.e6).toBeLessThan(after.e9);
  expect(after.e6).toBeGreaterThanOrEqual(0);
  expect(after.e9).toBeGreaterThanOrEqual(0);
});

test("the 中文 view renders the same inspector sections with no Latin machine text", async ({ page }) => {
  await openDesk(page, "zh");
  const coverage = page.locator('[data-testid="flow-coverage"]');
  await expect(coverage).toContainText("88 % 合格权利金已分类 · 12 % 未知");
  await expect(coverage).toContainText("认购 $2.3M · 认沽 $750.0K · 无符号权利金，非方向指示");

  await card(page, "$504.0K").click();
  const inspector = page.locator('[data-testid="flow-print-inspector"]');
  await expect(inspector.getByText("买入 · 估计", { exact: true })).toBeVisible();
  await inspector.getByText("成交依据", { exact: true }).click();
  await expect(inspector).toContainText("选定成交明细");
  await expect(inspector).toContainText("买入 · 估计");
  await expect(inspector).toContainText("方法： 逐笔成交规则推断");
  await expect(inspector).toContainText("置信度资金流数据方未提供");
  await expect(inspector).toContainText("不接纳任何组合交易数据源");
  await expect(inspector).toContainText("1.63× 前一交易日持仓量");
  // No EN inspector copy and no raw enum/slug tokens leak into the 中文 view.
  const text = (await inspector.textContent()) ?? "";
  for (const leak of ["SELECTED PRINT", "not supplied by the flow owner", "SIDE · ESTIMATE", "~buy", "mixed", "tape", "Bought"]) {
    expect(text, `ZH inspector must not contain "${leak}"`).not.toContain(leak);
  }
});

test("inspect by keyboard and return to the source print with filters intact", async ({ page, viewport }) => {
  await openDesk(page, "en");
  const search = page.getByRole("searchbox", { name: "Filter flow by ticker" });
  await search.fill("AAPL");
  const source = page.locator("#inspect-flow-w3a-e1");
  await source.focus();
  await source.press("Enter");
  const inspector = page.getByRole("region", { name: "AAPL · Print inspector" });
  await expect(inspector).toBeFocused();
  await expect(inspector).toBeInViewport();
  await inspector.press("Escape");
  await expect(source).toBeFocused();
  await expect(search).toHaveValue("AAPL");
  await search.fill("NOT-A-ROOT");
  await expect(page.locator('[data-tut="flow-card"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(source).toBeVisible();

  if (viewport && viewport.width < 1000) {
    const filters = page.getByRole("button", { name: "Filters", exact: true });
    await filters.click();
    const list = await page.locator(".obs-fd-list").boundingBox();
    const print = await page.locator('[data-tut="flow-card"]').first().boundingBox();
    expect(list!.height).toBeGreaterThanOrEqual(2 * print!.height);
    await filters.click();
    const sections = page.getByRole("navigation", { name: "Flow Desk sections" });
    await sections.getByRole("button", { name: "Chain Heat" }).click();
    await expect(page.locator('[data-tut="chain-heat"]')).toBeFocused();
    await expect(page.locator('[data-tut="chain-heat"]')).toBeInViewport();
    const research = await page.locator(".obs-fd-right").boundingBox();
    const market = await page.locator(".obs-fd-left").boundingBox();
    expect(research!.height).toBeGreaterThan(40);
    expect(market!.height).toBeGreaterThan(40);
    expect(market!.y).toBeGreaterThanOrEqual(research!.y + research!.height - 1);
  }
});

test("a slow previous ticker cannot replace the selected print's context", async ({ page }) => {
  await openDesk(page, "en");
  let release!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => ["ticker:AAPL", "ticker:NVDA"].includes(url.searchParams.get("f") ?? ""), async route => {
    const symbol = new URL(route.request().url()).searchParams.get("f")!.slice(7);
    if (symbol === "AAPL") await slow;
    await route.fulfill({ json: { root: symbol, day: { gross: symbol === "AAPL" ? 1500000 : 6500000, call_share: .5, n_events: 20 } } });
  });
  const started = page.waitForRequest(req => new URL(req.url()).searchParams.get("f") === "ticker:AAPL");
  await page.locator("#inspect-flow-w3a-e1").click();
  await started;
  await page.locator("#inspect-flow-w3a-e8").click();
  const inspector = page.getByRole("region", { name: "NVDA · Print inspector" });
  await expect(inspector).toContainText("$6.5M");
  const finished = page.waitForResponse(res => new URL(res.url()).searchParams.get("f") === "ticker:AAPL");
  release();
  await finished;
  await expect(inspector).toContainText("$6.5M");
  await expect(inspector).not.toContainText("$1.5M");
});

for (const lang of ["en", "zh"] as const) {
  test(`selected Command print has one natural page scroll on compact screens (${lang})`, async ({ page, viewport }, testInfo) => {
    await openDesk(page, lang);
    const source = page.locator("#inspect-flow-w3a-e1");
    await source.focus();
    await source.press("Enter");
    const selected = page.locator(".obs-fd-inspector.has-event");
    const body = selected.locator(".obs-insp-body");
    await expect(selected).toBeVisible();
    const evidence = selected.locator('[data-testid="flow-print-inspector"] details');
    await evidence.locator("summary").click();
    await expect(evidence).toHaveAttribute("open", "");

    const compact = !!viewport && viewport.width <= 999;
    const metrics = await body.evaluate(el => {
      const scroll = el.closest(".obs-flowdesk")!;
      const inspector = el.closest(".obs-fd-inspector")!;
      return {
        overflow: getComputedStyle(el).overflowY,
        bodyOverflow: el.scrollHeight - el.clientHeight,
        cardOverflow: inspector.scrollHeight - inspector.clientHeight,
        cardHeight: inspector.getBoundingClientRect().height,
        deskOverflow: scroll.scrollHeight - scroll.clientHeight,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(metrics.horizontalOverflow).toBeLessThanOrEqual(1);
    if (compact) {
      expect(metrics.overflow).toBe("visible");
      expect(metrics.bodyOverflow).toBeLessThanOrEqual(2);
      expect(metrics.cardOverflow).toBeLessThanOrEqual(2);
      expect(metrics.deskOverflow).toBeGreaterThan(20);
      // Evidence is in the page's one native scroll path, not clipped behind
      // an independently scrolling, capped card.
      const last = body.locator(":scope > :last-child");
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      if (testInfo.project.name === "mobile") {
        await page.setViewportSize({ width: 320, height: 700 });
        const narrow = await body.evaluate(el => ({
          bodyOverflow: el.scrollHeight - el.clientHeight,
          cardOverflow: el.closest(".obs-fd-inspector")!.scrollHeight - el.closest(".obs-fd-inspector")!.clientHeight,
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        expect(narrow.bodyOverflow).toBeLessThanOrEqual(2);
        expect(narrow.cardOverflow).toBeLessThanOrEqual(2);
        expect(narrow.horizontalOverflow).toBeLessThanOrEqual(1);
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport();
      }
    } else {
      // Desktop uses its dedicated research rail; keep that bounded scroller.
      expect(metrics.overflow).toBe("auto");
      expect(metrics.bodyOverflow).toBeGreaterThan(20);
    }
    await page.screenshot({ path: testInfo.outputPath(`command-inspector-scroll-${lang}-${testInfo.project.name}.png`) });
    await selected.press("Escape");
    await expect(source).toBeFocused();
  });
}
