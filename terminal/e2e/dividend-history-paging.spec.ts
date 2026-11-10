import { expect, test, type Locator, type Page } from "@playwright/test";

// Synthetic public fundamentals: interaction evidence, not dividend/market research.
const events = Array.from({ length: 83 }, (_, index) => {
  const ex = new Date(Date.UTC(2026, 8 - index, 15)).toISOString().slice(0, 10);
  const pay = new Date(Date.UTC(2026, 8 - index, 22)).toISOString().slice(0, 10);
  return { ex, pay, amount: (index + 1) / 100, type: index % 20 === 0 ? "Special" : "Regular" };
});
const fixture = {
  schema: "mastermind.fund/v1", ticker: "NVDA", asof: "2026-09-23",
  quote_currency: "USD", stmt_currency: "USD",
  src: { statements: "fixture", estimates: null, dividends: "fixture" },
  profile: null, stats: null, statements: { annual: null, quarterly: null },
  ratios: { periods: [], current: {} }, earnings: null, estimates: null, analyst: null,
  dividends: { never_paid: false, yield_ttm: 0.035, payout_ratio: 0.25,
    events: [...events].reverse(), splits: [{ date: "2024-06-10", ratio: "10:1" }] },
  ownership: null, guidance: null, segments: null,
};

async function visibleTarget(button: Locator) {
  // Observe native focus/page-change scrolling without repositioning the target.
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  const hit = () => button.evaluate(el => {
    const box = el.getBoundingClientRect();
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return target === el || el.contains(target);
  });
  try {
    await expect.poll(hit, { message: "Paging target remains reachable after scrolling settles" }).toBe(true);
  } catch (error) {
    console.info("dividend target clipping", JSON.stringify(await button.evaluate(el => {
      const box = el.getBoundingClientRect();
      const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const ancestors = [];
      for (let parent = el.parentElement; parent && ancestors.length < 7; parent = parent.parentElement) {
        const rect = parent.getBoundingClientRect();
        const style = getComputedStyle(parent);
        ancestors.push({ className: parent.className, y: rect.y, height: rect.height, scrollTop: parent.scrollTop,
          clientHeight: parent.clientHeight, scrollHeight: parent.scrollHeight, overflowY: style.overflowY });
      }
      return { button: box.toJSON(), hit: target?.className, ancestors };
    })));
    throw error;
  }
}

async function visibleResult(rows: Locator) {
  const firstDate = rows.first().locator("th");
  await expect.poll(() => firstDate.evaluate(el => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === el || el.contains(hit);
  }), { message: "New dividend records are visible after changing pages" }).toBe(true);
}

async function openDividends(page: Page, surface: "analysis" | "terminal", lang: "en" | "zh") {
  const theme = lang === "zh" && (surface === "terminal" || process.env.MMX_SHARED_SHELL === "1") ? "light" : "dark";
  let fundReads = 0;
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("mmx.shell.theme", theme);
  }, { lang, theme });
  await page.route("**/api/**", route => route.fulfill({ status: 503, json: { error: "local_dividend_fixture" } }));
  await page.route("**/NVDA.fund.json**", route => {
    fundReads++;
    return route.fulfill({ json: fixture });
  });
  await page.goto(surface === "analysis" ? "/analysis?symbol=NVDA&page=dividends" : "/terminal?symbol=NVDA");
  await expect(page.locator(surface === "analysis" ? ".analysis-shell" : ".workspace")).toBeVisible();
  const title = lang === "zh" ? "股息历史" : "Dividend history";
  const history = page.locator(".fin-sec").filter({ has: page.locator(".fin-sec-h", { hasText: new RegExp("^" + title + "$") }) });
  if (surface === "terminal") {
    await expect.poll(async () => {
      if (await history.count()) return true;
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:open-pane", { detail: "dividends" })));
      return (await history.count()) === 1;
    }, { timeout: 15_000 }).toBe(true);
  }
  await expect(history).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  return { history, fundReads: () => fundReads };
}

for (const surface of ["analysis", "terminal"] as const) {
  for (const lang of ["en", "zh"] as const) {
    test(`${surface} ${lang}: all supplied dividend records remain reachable by keyboard`, async ({ page }, info) => {
      if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
      const { history, fundReads } = await openDividends(page, surface, lang);
      const rows = history.locator("tbody tr");
      await expect(rows).toHaveCount(40);
      await expect(rows.first()).toContainText("Sep 15, 2026");
      await expect(rows.first()).toContainText("0.0100 USD");
      const kpis = await page.locator(".fin-div-cards").allTextContents();
      const reads = fundReads();
      const allRows = await rows.allTextContents();
      await history.locator(".fin-div-more").scrollIntoViewIfNeeded();
      const capture = (info.project.name === "desktop" && lang === "en") || (info.project.name === "mobile" && lang === "zh");
      if (capture) await page.screenshot({ path: info.outputPath(`${surface}-${lang}-initial.png`) });
      const previous = history.getByRole("button", { name: lang === "zh" ? "上一页" : "Previous", exact: true });
      const next = history.getByRole("button", { name: lang === "zh" ? "下一页" : "Next", exact: true });
      await expect(next).toBeVisible();
      await expect(previous).toHaveAttribute("aria-disabled", "true");
      await previous.focus();
      await page.keyboard.press("Tab");
      await expect(next).toBeFocused();
      await visibleTarget(next);
      await visibleTarget(previous);
      expect(await next.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
      await page.keyboard.press("Enter");
      await expect(rows).toHaveCount(40);
      await expect(rows.first()).toContainText("May 15, 2023");
      await expect(rows.first()).toContainText("0.4100 USD");
      await visibleResult(rows);
      await expect(history.getByRole("status")).toHaveText(lang === "zh" ? "显示 41–80 / 83 条记录" : "Showing 41–80 of 83 events");
      await expect(next).toBeFocused();
      allRows.push(...await rows.allTextContents());
      await page.keyboard.press("Space");
      await expect(rows).toHaveCount(3);
      await expect(rows.first()).toContainText("Jan 15, 2020");
      await expect(rows.last()).toContainText("Nov 15, 2019");
      await expect(rows.last()).toContainText("0.8300 USD");
      await visibleResult(rows);
      await expect(next).toHaveAttribute("aria-disabled", "true");
      await expect(next).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(rows).toHaveCount(3);
      allRows.push(...await rows.allTextContents());
      expect(new Set(allRows).size).toBe(83);
      expect(allRows).toHaveLength(83);
      expect(await page.locator(".fin-div-cards").allTextContents()).toEqual(kpis);
      expect(fundReads()).toBe(reads);
      await visibleTarget(next);
      await visibleTarget(previous);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (capture) await page.screenshot({ path: info.outputPath(`${surface}-${lang}-last-page.png`) });
      await previous.focus();
      await page.keyboard.press("Enter");
      await expect(rows).toHaveCount(40);
      await expect(rows.first()).toContainText("May 15, 2023");
      await expect(previous).toBeFocused();
      await page.keyboard.press("Space");
      await expect(rows).toHaveCount(40);
      await expect(rows.first()).toContainText("Sep 15, 2026");
      await expect(previous).toHaveAttribute("aria-disabled", "true");
      await expect(previous).toBeFocused();
      await page.keyboard.press("Space");
      await expect(rows.first()).toContainText("Sep 15, 2026");
      console.info("dividend paging", JSON.stringify({
        surface, lang, viewport: page.viewportSize(), records: allRows.length,
        previous: await previous.boundingBox(), next: await next.boundingBox(), fundReads: reads,
      }));
    });
  }
}

test("short phone Terminal keeps paging above the bottom navigation", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "One explicit landscape phone case");
  await page.setViewportSize({ width: 568, height: 320 });
  const { history } = await openDividends(page, "terminal", "zh");
  const rows = history.locator("tbody tr");
  const next = history.getByRole("button", { name: "下一页", exact: true });
  const previous = history.getByRole("button", { name: "上一页", exact: true });
  await expect(rows).toHaveCount(40);
  await previous.focus();
  await page.keyboard.press("Tab");
  await expect(next).toBeFocused();
  await visibleTarget(next);
  await page.keyboard.press("Enter");
  await expect(rows.first()).toContainText("May 15, 2023");
  await page.keyboard.press("Space");
  await expect(rows).toHaveCount(3);
  await visibleResult(rows);
  await expect(next).toBeFocused();
  await visibleTarget(next);
  await visibleTarget(previous);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("terminal-zh-short-last-page.png") });
  await previous.tap();
  await expect(rows).toHaveCount(40);
  await expect(rows.first()).toContainText("May 15, 2023");
});
