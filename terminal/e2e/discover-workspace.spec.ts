import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { chooseDiscoverOption, openDiscoverFilters } from "./discoverWorkspaceFixture";
import { dataRows, prepare, routeManifest, secondDevice } from "./smartScreensFixture";
import { DISCOVER_CURRENT_KEY, DEFAULT_DISCOVER_COLUMNS, discoverViewKey } from "../lib/discoverWorkspace";
import { installDiscoverResearchWorld } from "./discoverResearchFixture";
import technicalProducer from "../lib/__tests__/fixtures/screenerScan/technical.producer.json";

// Account writes use the shipped route and fixture DB. Context B receives only
// the account cookie, never A's localStorage or a mocked save acknowledgement.
test.setTimeout(150_000);
const endpoint = "/api/smart-screens?resource=discover_views";
const headers = (page: Page) => page.locator("table.scr2 thead th[data-column]");
const columnOrder = (page: Page) => headers(page).evaluateAll(nodes => nodes.map(node => node.getAttribute("data-column")));
const sync = (page: Page) => page.locator("[data-discover-sync]");
const current = (page: Page) => page.locator("[data-discover-view]");
const dialog = (page: Page) => page.getByRole("dialog");
const saveButton = (page: Page, zh: boolean) => dialog(page).getByRole("button", { name: zh ? "保存" : "Save view", exact: true });
async function open(page: Page, count: number) {
  await page.goto("/discover?tab=screener");
  await expect(dataRows(page)).toHaveCount(count, { timeout: 45_000 });
}
async function saveView(page: Page, name: string, zh: boolean) {
  await page.locator("[data-discover-views]").click();
  await dialog(page).locator("#discover-view-name").fill(name);
  await saveButton(page, zh).click();
  await expect(dialog(page).getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", "true");
  await dialog(page).press("Escape");
  await expect(sync(page)).toHaveAttribute("data-discover-sync", "saved");
}
async function shoot(page: Page, info: TestInfo, name: string) {
  await page.mouse.move(0, 0);
  if (await dialog(page).isVisible()) {
    const box = (await dialog(page).boundingBox())!, viewport = page.viewportSize()!;
    expect(Math.abs(box.x - (viewport.width - box.width) / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y - (viewport.height - box.height) / 2)).toBeLessThanOrEqual(2);
    expect(box.x).toBeGreaterThanOrEqual(16);
  }
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}
async function account(page: Page) {
  const response = await page.request.get(endpoint); expect(response.ok()).toBe(true); return response.json();
}
async function quietQuotes(page: Page) {
  await page.route("**/api/quote?**", route => route.fulfill({ json: { quotes: {} } }));
  await page.route("**/api/ext-quote?**", route => route.fulfill({ json: { quotes: {} } }));
}

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: simple controls, modular columns and account views across devices`, async ({ page, browser, baseURL }, info) => {
    const zh = lang === "zh", touch = !!info.project.use.hasTouch;
    const key = `discover-journey-${info.project.name}-${lang}-${Date.now()}-${info.retry}`;
    await prepare(page.context(), baseURL!, key, zh); await routeManifest(page, () => "g1"); await quietQuotes(page);
    await open(page, 5);
    await expect(page.locator("#discover-advanced")).toBeHidden();
    await expect(page.locator(".screener-main select")).toHaveCount(0);
    expect(await columnOrder(page)).toEqual(DEFAULT_DISCOVER_COLUMNS);
    await shoot(page, info, `${lang}-overview`);

    // Public custom menu: keyboard focus stays within the menu and Escape restores it.
    const signal = page.locator('[data-cm-control="signal"]');
    await signal.click(); await expect(page.getByRole("listbox")).toBeVisible();
    await page.getByRole("listbox").dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await expect(page.getByRole("listbox")).toBeVisible();
    await shoot(page, info, `${lang}-custom-menu`);
    await page.keyboard.press("Escape"); await expect(signal).toBeFocused();

    // Pointer drag on desktop; the visible arrow alternative is genuinely tapped on touch.
    const last = page.locator('thead [data-column="last"]');
    if (!touch) {
      const grip = last.getByRole("button").first();
      await grip.scrollIntoViewIfNeeded();
      const start = (await grip.boundingBox())!, target = (await page.locator('thead [data-column="regimeBull"]').boundingBox())!;
      const x = start.x + start.width / 2, y = start.y + start.height / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + 10, y, { steps: 2 });
      await expect(last).toHaveAttribute("data-dragging", "true");
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
      await page.mouse.up();
    } else {
      await page.locator("[data-discover-columns]").tap();
      await dialog(page).getByRole("button", { name: zh ? "最新左移" : "Move Last left", exact: true }).tap();
      await dialog(page).press("Escape");
    }
    await expect.poll(() => columnOrder(page)).toEqual(["sym", "verdict", "last", "regimeBull", "chg", "dv", "mcap", "gics"]);
    await expect(page.locator('thead [data-column="dv"]')).toHaveAttribute("aria-sort", "descending");
    if (!touch) {
      const grip = last.getByRole("button").first(); await grip.focus();
      await page.keyboard.press("Space");
      await expect(last).toHaveAttribute("data-dragging", "true");
      await page.keyboard.press("ArrowRight");
      const announcement = zh ? "最新将移至第4列。" : "Last will move to column 4 of 8.";
      await expect(page.getByRole("status").filter({ hasText: announcement })).toHaveText(announcement);
      await page.keyboard.press("Space");
      await expect.poll(() => columnOrder(page)).toEqual(DEFAULT_DISCOVER_COLUMNS);
    }

    await page.locator("[data-discover-columns]").click();
    await shoot(page, info, `${lang}-column-order`);
    await dialog(page).locator('[data-discover-column="mcap"]').uncheck();
    await dialog(page).locator('[data-discover-column="overnight"]').check();
    await dialog(page).locator('[data-discover-column="cagr"]').check();
    await shoot(page, info, `${lang}-columns`); await dialog(page).press("Escape");
    const cagr = page.locator('thead [data-column="cagr"]');
    await cagr.getByRole("button").last().click(); await expect(cagr).toHaveAttribute("aria-sort", "descending");
    await page.locator("[data-discover-columns]").click(); await dialog(page).locator('[data-discover-column="cagr"]').uncheck(); await dialog(page).press("Escape");
    await expect(page.locator("[data-discover-hidden-sort]")).toBeVisible();
    await page.locator("[data-discover-hidden-sort]").click(); await expect(cagr).toHaveAttribute("aria-sort", "descending");
    await page.locator('thead [data-column="dv"]').getByRole("button").last().click();
    await page.locator("[data-discover-columns]").click(); await dialog(page).locator('[data-discover-column="cagr"]').uncheck(); await dialog(page).press("Escape");

    const layout = await columnOrder(page);
    await chooseDiscoverOption(page.locator('[data-cm-control="regime"]'), "uptrend");
    expect(await columnOrder(page)).toEqual(layout); await expect(page.locator('thead [data-column="dv"]')).toHaveAttribute("aria-sort", "descending");
    await chooseDiscoverOption(page.locator('[data-cm-control="regime"]'), "any");
    await openDiscoverFilters(page);
    // Expanded controls must leave a useful results viewport, including on touch screens.
    const resultsBox = (await page.locator(".scr2-table").boundingBox())!;
    const provenanceBox = (await page.locator(".scr2-asof").boundingBox())!;
    expect(resultsBox.height).toBeGreaterThanOrEqual(touch ? 180 : 224);
    expect(provenanceBox.y).toBeGreaterThanOrEqual(resultsBox.y + resultsBox.height - 1);
    expect(provenanceBox.y + provenanceBox.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    await shoot(page, info, `${lang}-advanced`);
    await chooseDiscoverOption(page.locator('[data-cm-control="move"]'), "up3");
    await page.locator('[aria-controls="discover-advanced"]').click(); await expect(dataRows(page)).toHaveCount(4);
    expect(await columnOrder(page)).toEqual(layout);
    await page.getByRole("group", { name: zh ? "行密度" : "Row density", exact: true }).getByRole("button", { name: zh ? "紧凑" : "Compact", exact: true }).click();
    const rowHeights = await dataRows(page).evaluateAll(nodes => nodes.map(node => node.closest("tr")!.getBoundingClientRect().height));
    expect(rowHeights.every(height => Math.abs(height - 36) <= 1)).toBe(true);
    // Shared overflow belongs to the table, never the document.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await shoot(page, info, `${lang}-customized`);

    await saveView(page, "Momentum", zh);
    const savedId = await current(page).getAttribute("data-discover-view");
    const saved = await account(page);
    expect(saved.values[DISCOVER_CURRENT_KEY]).toEqual(saved.values[discoverViewKey(savedId!)]);
    await page.locator("[data-discover-views]").click();
    await dialog(page).getByRole("button", { name: zh ? /市场概览/ : /Market overview/ }).click();
    await expect(dataRows(page)).toHaveCount(5); await saveView(page, "Baseline", zh);
    await page.locator("[data-discover-views]").click(); await dialog(page).getByRole("button", { name: "Momentum", exact: true }).click();
    await expect(dataRows(page)).toHaveCount(4); expect(await columnOrder(page)).toEqual(layout);
    await expect(sync(page)).toHaveAttribute("data-discover-sync", "saved");

    const second = await secondDevice(browser, page, touch, baseURL!, key, zh);
    try {
      await routeManifest(second.page, () => "g2"); await quietQuotes(second.page);
      await open(second.page, 3); expect(await columnOrder(second.page)).toEqual(layout);
      await expect(current(second.page)).toHaveAttribute("data-discover-view", savedId!);
      await expect(second.page.locator(".screener-main")).toHaveClass(/den-k/);
      await expect(second.page.locator('thead [data-column="dv"]')).toHaveAttribute("aria-sort", "descending");
      await second.page.locator("[data-discover-views]").click();
      await expect(dialog(second.page).getByRole("button", { name: "Momentum", exact: true })).toHaveAttribute("aria-current", "true");
      const baseline = dialog(second.page).getByRole("button", { name: "Baseline", exact: true }).locator("..");
      await baseline.getByRole("button", { name: zh ? "重命名" : "Rename", exact: true }).click();
      await expect(dialog(second.page).locator("#discover-view-name")).toBeFocused();
      await dialog(second.page).locator("#discover-view-name").fill("Daily overview"); await saveButton(second.page, zh).click();
      await expect(dialog(second.page).getByRole("button", { name: "Daily overview", exact: true })).toBeVisible();
      await shoot(second.page, info, `${lang}-account-views`); await dialog(second.page).press("Escape");
      await expect(current(second.page)).toHaveAttribute("data-discover-view", savedId!);
      await expect(sync(second.page)).toHaveAttribute("data-discover-sync", "saved");
      await second.page.reload(); await expect(dataRows(second.page)).toHaveCount(3); expect(await columnOrder(second.page)).toEqual(layout);
      await second.page.locator("[data-discover-views]").click();
      const active = dialog(second.page).getByRole("button", { name: "Momentum", exact: true }).locator("..");
      await active.getByRole("button", { name: zh ? "删除Momentum" : "Delete Momentum", exact: true }).click();
      await active.getByRole("button", { name: zh ? "删除" : "Delete", exact: true }).click();
      await dialog(second.page).press("Escape"); await expect(current(second.page)).toHaveAttribute("data-discover-view", "current");
      await expect(sync(second.page)).toHaveAttribute("data-discover-sync", "saved");
      expect(await columnOrder(second.page)).toEqual(layout);
      expect((await account(second.page)).values[discoverViewKey(savedId!)]).toBeUndefined();
    } finally { await second.context.close(); }
  });
}

test("conflicting device edits survive reload and a failed account-version read", async ({ page, browser, baseURL }, info) => {
  const zh = info.project.name === "tablet", key = `discover-conflict-${info.project.name}-${Date.now()}-${info.retry}`;
  await prepare(page.context(), baseURL!, key, zh); await routeManifest(page, () => "g1"); await quietQuotes(page); await open(page, 5); await saveView(page, "Shared view", zh);
  const second = await secondDevice(browser, page, !!info.project.use.hasTouch, baseURL!, key, zh);
  try {
    await routeManifest(second.page, () => "g1"); await quietQuotes(second.page); await open(second.page, 5);
    await page.locator("[data-discover-columns]").click(); await dialog(page).locator('[data-discover-column="mcap"]').uncheck(); await dialog(page).press("Escape");
    await expect(sync(page)).toHaveAttribute("data-discover-sync", "saved"); const remote = await account(page);
    await second.page.locator("[data-discover-columns]").click(); await dialog(second.page).locator('[data-discover-column="gics"]').uncheck(); await dialog(second.page).press("Escape");
    await expect(sync(second.page)).toHaveAttribute("data-discover-issue", "conflict");
    expect((await account(second.page)).values).toEqual(remote.values);
    await second.page.reload(); await expect(sync(second.page)).toHaveAttribute("data-discover-issue", "conflict");
    await expect(second.page.locator('thead [data-column="gics"]')).toHaveCount(0);
    await second.context.addCookies([{ name: "mm_e2e_fault", value: "saved_views_read", url: baseURL! }]);
    await second.page.getByRole("button", { name: zh ? "放弃本地更改并载入账户版本" : "Discard local edits & use account version", exact: true }).click();
    await expect(sync(second.page)).toHaveAttribute("data-discover-issue", "unavailable");
    await second.context.clearCookies({ name: "mm_e2e_fault" });
    await second.page.reload(); await expect(sync(second.page)).toHaveAttribute("data-discover-issue", "conflict");
    await expect(second.page.locator('thead [data-column="gics"]')).toHaveCount(0);
    await shoot(second.page, info, "account-conflict");
    await second.page.getByRole("button", { name: zh ? "放弃本地更改并载入账户版本" : "Discard local edits & use account version", exact: true }).click();
    await expect(sync(second.page)).not.toHaveAttribute("data-discover-issue", "conflict");
    await expect.poll(() => columnOrder(second.page)).toEqual(remote.values[DISCOVER_CURRENT_KEY].columns);
    await expect(sync(second.page)).toHaveAttribute("data-discover-sync", "idle");
  } finally { await second.context.close(); }
});

test("regular prices update without reordering rows and expired overnight trades disappear", async ({ page, baseURL }, info) => {
  const key = `discover-quotes-${info.project.name}-${Date.now()}-${info.retry}`;
  await prepare(page.context(), baseURL!, key, false); await routeManifest(page, () => "g1");
  let tick = 100, quoteNow = Date.now();
  const issued = quoteNow / 1000;
  await page.clock.setFixedTime(quoteNow);
  const symbols = () => page.locator('tbody [data-discover-quote]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-discover-quote")));
  await page.route("**/api/quote?**", route => {
    const url = new URL(route.request().url()); expect(url.searchParams.get("view")).toBe("regular");
    return route.fulfill({ json: { quotes: Object.fromEntries((url.searchParams.get("syms") ?? "").split(",").map(sym => [sym, { regularPrice: tick, regularChg: tick - 100, ts: quoteNow / 1000, live: true }])) } });
  });
  await page.route("**/api/ext-quote?**", route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { quotes: Object.fromEntries((url.searchParams.get("syms") ?? "").split(",").map(sym => [sym, {
      extSource: "tiingo_boats", extBasis: "LIVE", extVenue: "BOATS", extPriceKind: "LAST_TRADE", extSession: "overnight", extTs: issued,
      extReceivedTs: issued, extPublishedTs: issued, extExpiresTs: issued + 20, extCaptureId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", extGeneration: 1, extPrice: 102, extChg: 2,
    }])) } });
  });
  await open(page, 5); const order = await symbols();
  await expect(page.locator('tbody [data-column="last"]').first()).toContainText("100.00"); tick = 103;
  await expect(page.locator('tbody [data-column="last"]').first()).toContainText("103.00", { timeout: 15_000 });
  await expect(page.locator('tbody [data-column="chg"]').first()).toContainText("+3.00%"); expect(await symbols()).toEqual(order);
  await page.locator("[data-discover-views]").click(); await dialog(page).getByRole("button", { name: /Overnight watch/ }).click();
  const overnight = page.locator('tbody [data-column="overnight"]').first(); await expect(overnight).toContainText("102.00");
  await page.locator("[data-discover-quote]").first().click(); await expect(dialog(page)).toContainText("Tiingo · BOATS");
  await shoot(page, info, "quote-details"); await dialog(page).press("Escape");
  quoteNow += 21_000; await page.clock.setFixedTime(quoteNow);
  await expect(overnight).toContainText("—", { timeout: 15_000 });
  await expect(page.locator('tbody [data-column="last"]').first()).toContainText("103.00"); expect(await symbols()).toEqual(order);
});

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: inspect evidence, compare four candidates and preserve the account view`, async ({ page, baseURL }, info) => {
    const zh = lang === "zh", key = `discover-research-${info.project.name}-${lang}-${Date.now()}-${info.retry}`;
    await prepare(page.context(), baseURL!, key, zh);
    const world = await installDiscoverResearchWorld(page);
    await open(page, 5);
    await expect(page.locator("tbody tr", { has: page.locator('[data-discover-inspect="AAA"]') }).locator('[data-signal-age="historical"]')).toHaveCount(1);
    // Quote columns are hidden deliberately: the inspector must create its own bounded
    // demand, while selecting a closed comparison tray must create none.
    await page.locator("[data-discover-columns]").click();
    await dialog(page).locator('[data-discover-column="last"]').uncheck();
    await dialog(page).locator('[data-discover-column="chg"]').uncheck();
    await dialog(page).press("Escape"); await expect(sync(page)).toHaveAttribute("data-discover-sync", "saved");
    const baseline = await account(page), layout = await columnOrder(page);
    const chartBefore = await page.locator('a.sym-cell[href*="sym=AAA"]').getAttribute("href");
    const opener = page.locator('[data-discover-inspect="AAA"]');
    world.quoteRequests.length = 0;
    await opener.click();
    const inspector = page.locator('[data-discover-inspector="AAA"]');
    await expect(inspector).toBeVisible();
    await expect.poll(() => world.quoteRequests.some(symbols => symbols.includes("AAA"))).toBe(true);
    await expect(inspector).toContainText(zh ? "延迟15分钟" : "15 min delayed");
    await expect(inspector).toContainText(zh ? "入场机会尚未核实" : "Entry unverified");
    await expect(inspector).toContainText(zh ? "历史事件" : "Historical event");
    await expect(inspector).toContainText(zh ? "暂无合格的当前夜盘成交" : "No current qualified overnight trade");
    const capture = async (name: string) => {
      const box = (await dialog(page).boundingBox())!, viewport = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const file = info.outputPath(`${lang}-research-${name}.png`);
      await page.screenshot({ path: file, animations: "disabled" }); await info.attach(`${lang}-research-${name}`, { path: file, contentType: "image/png" });
    };
    await capture("inspector");
    const margin = inspector.locator('[data-research-fund="fund.net_margin_fy"]');
    await expect(margin).toContainText("15%"); await expect(margin).toContainText("2025-09-27");
    await expect(margin).toHaveAttribute("aria-label", /15%.*2025-09-27/);
    await margin.scrollIntoViewIfNeeded();
    // Candidate navigation stays reachable while reading the lowest evidence section.
    await expect(dialog(page).getByRole("button", { name: zh ? "上一个结果" : "Previous result", exact: true })).toBeInViewport();
    await capture("fundamentals");
    await margin.click();
    await expect(page.locator('[data-fund-evidence="AAA"]')).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1); await expect(inspector).toHaveCount(0);
    await page.locator("[data-fund-evidence-close]").click();
    await expect(inspector).toBeVisible(); await expect(margin).toBeFocused();
    await dialog(page).press("Escape"); await expect(opener).toBeFocused();
    expect(await page.locator('a.sym-cell[href*="sym=AAA"]').getAttribute("href")).toBe(chartBefore);
    expect(await columnOrder(page)).toEqual(layout);
    const beforeSelection = world.quoteRequests.length;
    for (const sym of ["AAA", "BBB", "CCC", "DDD"]) await page.locator(`[data-discover-compare="${sym}"]`).click();
    expect(world.quoteRequests).toHaveLength(beforeSelection);
    await page.locator('[data-discover-inspect="EEE"]').click();
    await expect(dialog(page).getByRole("button", { name: zh ? "加入比较" : "Add to compare", exact: true })).toBeDisabled();
    await expect(dialog(page)).toContainText(zh ? "最多比较四个标的" : "You can compare four stocks");
    await dialog(page).press("Escape");
    await page.locator("[data-discover-compare-tray]").getByRole("button", { name: zh ? "比较" : "Compare", exact: true }).click();
    const comparison = page.locator("[data-discover-comparison]"); await expect(comparison).toBeVisible();
    await expect(comparison).toContainText("HKD"); await expect(comparison).toContainText("USD");
    await expect(comparison.locator('[data-research-fund="fund.net_margin_fy"][data-research-fund-symbol="AAA"]')).toContainText("2025-09-27");
    await expect(comparison.locator('[data-research-fund="fund.net_margin_fy"][data-research-fund-symbol="BBB"]')).toContainText("2025-06-30");
    const matrix = comparison.getByRole("region");
    await matrix.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(matrix.locator("thead th").first()).toBeInViewport();
    await capture("comparison");
    await dialog(page).press("Escape");
    expect((await account(page)).values).toEqual(baseline.values);
    await page.locator(".scr2-search").fill("$aaa, $bbb"); await expect(dataRows(page)).toHaveCount(2);
    await page.getByRole("button", { name: zh ? "清除搜索" : "Clear search", exact: true }).first().click(); await expect(dataRows(page)).toHaveCount(5);
  });
}

test("saved filter screens cannot silently omit search or technical conditions", async ({ page, baseURL }, info) => {
  await prepare(page.context(), baseURL!, `discover-screen-complete-${info.project.name}-${Date.now()}-${info.retry}`, false);
  await installDiscoverResearchWorld(page);
  // This case edits a technical predicate; other research journeys retain the
  // fixture's deliberate unavailable source. Reuse the real producer observations.
  const technical = structuredClone(technicalProducer);
  const buy = technical.rows.find(row => row.sym === "NVDA");
  const sell = technical.rows.find(row => row.sym === "AAPL");
  expect(buy).toBeTruthy(); expect(sell).toBeTruthy();
  technical.rows = ["AAA", "BBB", "CCC", "DDD", "EEE"].map((sym, index) => ({
    ...structuredClone(index === 1 ? sell! : buy!), sym,
  }));
  technical.universe.count = technical.rows.length;
  await page.route("**/data/scan/technical.json**", route => route.fulfill({ json: technical }));
  await open(page, 5);
  const layout = await columnOrder(page);
  await openDiscoverFilters(page, true);
  const screens = page.locator("[data-smart-screens]");
  await expect(screens).not.toHaveAttribute("data-ss-status", "loading");
  await screens.locator("[data-ss-toggle]").click();
  await screens.locator("[data-ss-name-input]").fill("All candidates");
  await screens.locator("[data-ss-save-button]").click();
  await expect(screens.locator("[data-ss-on-table]")).toHaveCount(1);
  await page.locator(".scr2-search").fill("$AAA"); await expect(dataRows(page)).toHaveCount(1);
  // Search alone must not be silently omitted by a legacy filter screen.
  await expect(screens.locator("[data-ss-extra-conditions]")).toBeVisible();
  await expect(screens.locator("[data-ss-save-button]")).toBeDisabled();
  await expect(screens.locator("[data-ss-replace]")).toBeDisabled();
  await expect(screens.locator("[data-ss-on-table]")).toHaveCount(0);
  await page.locator("[data-tech-toggle]").click();
  await expect(page.locator("[data-tech-signal]")).toBeEnabled();
  await chooseDiscoverOption(page.locator("[data-tech-tf]"), "3D");
  await chooseDiscoverOption(page.locator("[data-tech-signal]"), "buyside");
  await expect(dataRows(page)).toHaveCount(1);
  // Clear search so refusal also proves the technical condition independently.
  await page.locator(".scr2-search").fill("");
  await expect(dataRows(page)).toHaveCount(4);
  await expect(screens.locator("[data-ss-extra-conditions]")).toBeVisible();
  await expect(screens.locator("[data-ss-save-button]")).toBeDisabled();
  await expect(screens.locator("[data-ss-replace]")).toBeDisabled();
  await expect(screens.locator("[data-ss-on-table]")).toHaveCount(0);
  await page.locator(".scr2-search").fill("$AAA"); await expect(dataRows(page)).toHaveCount(1);
  await screens.locator("[data-ss-open]").click();
  await expect(page.locator(".scr2-search")).toHaveValue("");
  await expect(dataRows(page)).toHaveCount(5);
  await expect(screens.locator("[data-ss-notice]")).toContainText("Search and technical conditions were cleared");
  await expect(screens.locator("[data-ss-on-table]")).toHaveCount(1);
  expect(await columnOrder(page)).toEqual(layout);
});
