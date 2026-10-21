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
  await expect(inspector).toContainText("owner's figure · not reproducible from 4,100 × $0.95 × 100");
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
  await page.getByRole("button", { name: "SCORE" }).click();
  await page.getByRole("button", { name: "NEW" }).click();
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
