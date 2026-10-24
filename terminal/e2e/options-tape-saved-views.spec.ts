import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createDefaultTapeView, encodeTapeView } from "../lib/optionsTapeView";
import { SAVED_TAPE_VIEWS_KEY } from "../lib/optionsTapeSavedViews";

const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "public/data/flow_fixture.json"), "utf8"));
const base = fixture.feed.events[0];
const feed = { ...fixture.feed, stale: true, events: [
  { ...base, id: "saved-nvda-large", root: "NVDA", premium: 2_000_000 },
  { ...base, id: "saved-nvda-small", root: "NVDA", premium: 200_000 },
  { ...base, id: "saved-spy", root: "SPY", premium: 3_000_000 },
] };
const url = (root: string, minPrem = 0) => `/options?${new URLSearchParams({ tab: "tape", tapeView: encodeTapeView({
  ...createDefaultTapeView(), tapeTickerSearch: root, minPrem, sortKey: "premium", sortDir: 1,
}) })}`;
const panel = (page: Page) => page.locator('[data-options-saved-view="panel"]');
const rows = (page: Page) => page.locator("table.scr tbody tr").filter({ has: page.locator("td") });
// Identity/order fields are stable; the independent OI-confirmation fetch may add a badge later.
const rowValues = (page: Page) => rows(page).evaluateAll((items) => items.map((row) =>
  [...row.querySelectorAll("td")].slice(0, 10).map((cell) => cell.textContent)));
async function routeFeed(page: Page) {
  let current = feed;
  await page.route(/\/api\/flow\/stream\?f=feed$/, (route) => route.fulfill({ headers: { "content-type": "text/event-stream" },
    body: `retry: 60000\n\ndata: ${JSON.stringify(current)}\n\n` }));
  return (next: typeof feed) => { current = next; };
}

for (const lang of ["en", "zh"] as const) {
  const theme = "dark"; // Terminal currently ships a hardcoded dark theme. No light-product proof.
  test(`named screens restore current Tape filters and persist (${lang}, ${theme})`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.addInitScript((locale) => { localStorage.setItem("mm.lang", locale); }, lang);
    const updateFeed = await routeFeed(page);
    await page.goto(url("NVDA", 1_000_000));
    const exporter = page.locator('[data-options-export="tape-csv-v1"]');
    await expect(exporter).toContainText("1");
    const original = await rowValues(page);
    const save = page.locator('[data-options-saved-view="save"]');
    const library = page.locator('[data-options-saved-view="list"]');
    await save.click();
    await panel(page).getByRole("textbox").fill("NVDA · 期权观察 👩‍💻");
    await panel(page).getByRole("button", { name: lang === "zh" ? "保存筛选视图" : "Save screen", exact: true }).click();
    await expect(panel(page)).toContainText(lang === "zh" ? "仅保存在此浏览器" : "Saved on this browser");
    await expect(panel(page)).toContainText(lang === "zh" ? "已保存在此浏览器" : "Screen saved on this browser");
    await page.keyboard.press("Escape");
    await expect(save).toBeFocused();

    // Same URL, different unsaved local filters: opening its saved screen must restore it.
    const search = page.locator(".flow-filter-bar > input");
    await search.fill("SPY");
    await expect(exporter).toContainText("1");
    await library.click();
    await panel(page).getByRole("button", { name: `${lang === "zh" ? "打开" : "Open"} NVDA · 期权观察 👩‍💻`, exact: true }).click();
    await expect(search).toHaveValue("NVDA");
    expect(await rowValues(page)).toEqual(original);

    await search.fill("SPY");
    await save.click();
    await panel(page).getByRole("textbox").fill("SPY watch");
    await panel(page).getByRole("button", { name: lang === "zh" ? "保存筛选视图" : "Save screen", exact: true }).click();
    await expect(panel(page)).toBeFocused();
    await page.reload();
    await expect(library).toContainText("(2)");
    await library.click();
    await expect(panel(page)).toContainText("NVDA · 期权观察 👩‍💻");
    await expect(panel(page)).toContainText("SPY watch");
    await panel(page).getByRole("button", { name: `${lang === "zh" ? "打开" : "Open"} SPY watch`, exact: true }).click();
    await expect(search).toHaveValue("SPY");
    const spyValues = await rowValues(page);
    await page.goBack();
    await expect(search).toHaveValue("NVDA");
    expect(await rowValues(page)).toEqual(original);
    await page.goForward();
    await expect(search).toHaveValue("SPY");
    expect(await rowValues(page)).toEqual(spyValues);
    updateFeed({ ...feed, events: [...feed.events, { ...base, id: "saved-nvda-new", root: "NVDA", premium: 2_500_000 }] });
    await page.reload();
    await library.click();
    await panel(page).getByRole("button", { name: `${lang === "zh" ? "打开" : "Open"} NVDA · 期权观察 👩‍💻`, exact: true }).click();
    await expect(exporter).toContainText("2");
    const refreshed = await rowValues(page);
    expect(refreshed.map((row) => row[9])).toEqual(["$2.0M", "$2.5M"]);
    await library.click();
    await panel(page).getByRole("button", { name: `${lang === "zh" ? "重命名" : "Rename"} SPY watch`, exact: true }).click();
    await panel(page).getByRole("textbox").fill("SPY intraday");
    await panel(page).getByRole("button", { name: lang === "zh" ? "重命名" : "Rename", exact: true }).click();
    await expect(panel(page)).toBeFocused();
    const beforeDelete = await search.inputValue();
    await panel(page).getByRole("button", { name: `${lang === "zh" ? "删除" : "Delete"} SPY intraday`, exact: true }).click();
    await expect(panel(page)).toBeFocused();
    await expect(search).toHaveValue(beforeDelete);
    await expect(library).toContainText("(1)");
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVED_TAPE_VIEWS_KEY);
    expect(stored.views[0].name).toBe("NVDA · 期权观察 👩‍💻");
    expect(Object.keys(stored.views[0])).toEqual(["id", "name", "state"]);
    expect(JSON.parse(stored.views[0].state).tapeTickerSearch).toBe("NVDA");

    const bounds = await page.evaluate(() => ({ width: innerWidth, doc: document.documentElement.scrollWidth }));
    expect(bounds.doc).toBeLessThanOrEqual(bounds.width + 1);
    for (const button of await panel(page).getByRole("button").all()) {
      const box = await button.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(40);
    }
    if (process.env.OPTIONS_SAVED_VIEWS_EVIDENCE === "1") {
      const dir = path.join(process.cwd(), "../docs/pr-crops/options-tape-saved-views");
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `${testInfo.project.name}-${lang}-${theme}.png`) });
    }
  });
}

test("corrupt preferences and invalid links do not broaden the Tape", async ({ page }) => {
  await page.addInitScript((key) => { localStorage.setItem("mm.lang", "en"); localStorage.setItem(key, '{"v":99}'); }, SAVED_TAPE_VIEWS_KEY);
  await routeFeed(page);
  await page.goto(url("NVDA", 1_000_000));
  await page.locator('[data-options-saved-view="list"]').click();
  await expect(panel(page)).toContainText("stored screens have not been replaced");
  expect(await page.evaluate((key) => localStorage.getItem(key), SAVED_TAPE_VIEWS_KEY)).toBe('{"v":99}');
  await expect(page.locator('[data-options-export="tape-csv-v1"]')).toContainText("1");
  await panel(page).getByRole("button", { name: "Clear unreadable saved screens", exact: true }).click();
  await expect(panel(page)).toContainText("No saved screens yet");
  expect(await page.locator(".flow-filter-bar > input").inputValue()).toBe("NVDA");
  await page.goto("/options?tab=tape&tapeView=invalid");
  await expect(page.locator('[data-options-tape-view="invalid"]')).toBeVisible();
  await expect(page.locator('[data-options-saved-view="list"]')).toHaveCount(0);
  await expect(page.locator("table.scr")).toHaveCount(0);
});

test("storage failure remains unsaved and leaves current results usable", async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem("mm.lang", "en");
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, v) { if (k === key) throw new DOMException("quota", "QuotaExceededError"); return original.call(this, k, v); };
  }, SAVED_TAPE_VIEWS_KEY);
  await routeFeed(page);
  await page.goto(url("NVDA", 1_000_000));
  await page.locator('[data-options-saved-view="save"]').click();
  await panel(page).getByRole("textbox").fill("Will not save");
  await panel(page).getByRole("button", { name: "Save screen", exact: true }).click();
  await expect(panel(page)).toContainText("the change was not saved");
  await expect(page.locator('[data-options-export="tape-csv-v1"]')).toContainText("1");
  expect(await page.evaluate((key) => localStorage.getItem(key), SAVED_TAPE_VIEWS_KEY)).toBeNull();
});
