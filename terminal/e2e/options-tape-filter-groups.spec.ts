import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDefaultTapeView, encodeTapeView } from "../lib/optionsTapeView";
import { encodeTapeScreen } from "../lib/optionsTapeFilterGroups";
import { addSavedTapeView, encodeSavedTapeViews, SAVED_TAPE_VIEWS_KEY } from "../lib/optionsTapeSavedViews";

const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "public/data/flow_fixture.json"), "utf8"));
const base = fixture.feed.events[0];
const first = { ...createDefaultTapeView(), tapeTickerSearch: "NVDA", minPrem: 1_000_000 };
const second = { ...createDefaultTapeView(), tapeTickerSearch: "SPY" };
const saved = encodeSavedTapeViews(addSavedTapeView(addSavedTapeView([], "nvda", "NVDA large", first), "spy", "SPY", second));
const current = { ...createDefaultTapeView(), sortKey: "premium" as const, sortDir: 1 as const };
const feed = { ...fixture.feed, events: [
  { ...base, id: "group-nvda-large", root: "NVDA", premium: 2_000_000 },
  { ...base, id: "group-nvda-small", root: "NVDA", premium: 200_000 },
  { ...base, id: "group-spy", root: "SPY", premium: 3_000_000 },
  { ...base, id: "group-qqq", root: "QQQ", premium: 4_000_000 },
] };

for (const lang of ["en", "zh"] as const) {
  test(`composed screens retain population through save, share, reload and history (${lang})`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.addInitScript(({ locale, stored, key }) => {
      localStorage.setItem("mm.lang", locale);
      if (localStorage.getItem(key) === null) localStorage.setItem(key, stored);
    }, { locale: lang, stored: saved, key: SAVED_TAPE_VIEWS_KEY });
    let source = feed;
    await page.route(/\/api\/flow\/stream\?f=feed$/, (route) => route.fulfill({ headers: { "content-type": "text/event-stream" },
      body: `retry: 60000\n\ndata: ${JSON.stringify(source)}\n\n` }));
    await page.goto(`/options?${new URLSearchParams({ tab: "tape", tapeView: encodeTapeView(current) })}`);
    const panel = page.locator('[data-options-saved-view="panel"]');
    const list = page.locator('[data-options-saved-view="list"]');
    const exported = page.locator('[data-options-export="tape-csv-v1"]');
    await expect(exported).toContainText("4");
    await list.click();
    await panel.getByRole("checkbox", { name: `${lang === "zh" ? "选择以组合" : "Select for combination"} NVDA large`, exact: true }).check();
    await expect(panel.getByRole("button", { name: /Combine selected|组合所选视图/ })).toBeDisabled();
    await panel.getByRole("checkbox", { name: `${lang === "zh" ? "选择以组合" : "Select for combination"} SPY`, exact: true }).check();
    await page.screenshot({ path: testInfo.outputPath(`group-selection-${lang}.png`) });
    await panel.getByRole("button", { name: /Combine selected|组合所选视图/ }).click();
    await expect(exported).toContainText("2");
    await expect(page.locator('[data-options-tape-view="groups"]')).toBeVisible();
    expect(new URL(page.url()).searchParams.get("tapeView")).toBe(encodeTapeScreen(current, [first, second]));
    const search = page.locator(".flow-filter-bar > input");
    await search.fill("SPY");
    await expect(exported).toContainText("1");
    await search.fill("");
    await expect(exported).toContainText("2");
    await page.locator('[data-options-saved-view="save"]').click();
    await panel.getByRole("textbox").fill("Two screens");
    await panel.getByRole("button", { name: lang === "zh" ? "保存筛选视图" : "Save screen", exact: true }).click();
    await expect(panel).toContainText(lang === "zh" ? "组合视图" : "Combined screen");
    await page.keyboard.press("Escape");
    await page.locator('[data-options-tape-view="share"]').click();
    const share = page.locator('[data-options-tape-view="url"]');
    expect(JSON.parse(new URL(await share.inputValue()).searchParams.get("tapeView")!).v).toBe(2);
    const sharedUrl = await share.inputValue();
    await page.keyboard.press("Escape");
    await list.click();
    await panel.getByRole("button", { name: `${lang === "zh" ? "打开" : "Open"} SPY`, exact: true }).click();
    await expect(exported).toContainText("1");
    await expect(page.locator('[data-options-tape-view="groups"]')).toHaveCount(0);
    await page.goBack();
    await expect(exported).toContainText("2");
    await expect(page.locator('[data-options-tape-view="groups"]')).toBeVisible();
    await page.goForward();
    await expect(exported).toContainText("1");
    await list.click();
    await panel.getByRole("button", { name: `${lang === "zh" ? "删除" : "Delete"} NVDA large`, exact: true }).click();
    await panel.getByRole("button", { name: `${lang === "zh" ? "打开" : "Open"} Two screens`, exact: true }).click();
    await expect(exported).toContainText("2");
    source = { ...feed, events: [...feed.events, { ...base, id: "group-new", root: "NVDA", premium: 2_500_000 }] };
    await page.reload();
    await expect(exported).toContainText("3");
    await page.goto(sharedUrl);
    await expect(exported).toContainText("3");
    await page.locator('[data-options-tape-view="groups"]').getByText(lang === "zh" ? "查看组合条件" : "View combined conditions", { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    await page.screenshot({ path: testInfo.outputPath(`group-results-${lang}.png`) });
    await page.getByRole("button", { name: lang === "zh" ? "清除组合条件" : "Clear combined conditions", exact: true }).click();
    await expect(exported).toContainText("5");
  });
  test(`invalid or repeated group parameters withhold the Tape (${lang})`, async ({ page }) => {
    await page.addInitScript((locale) => localStorage.setItem("mm.lang", locale), lang);
    for (const values of [[JSON.stringify({ v: 2, view: encodeTapeView(current), groups: "bad" })], [encodeTapeScreen(current, [first, second]), encodeTapeScreen(current, [first, second])]]) {
      const query = new URLSearchParams({ tab: "tape" });
      for (const value of values) query.append("tapeView", value);
      await page.goto(`/options?${query}`);
      await expect(page.locator('[data-options-tape-view="invalid"]')).toBeVisible();
      await expect(page.locator('[data-options-export="tape-csv-v1"]')).toHaveCount(0);
    }
    await page.locator('[data-options-tape-view="invalid"] button').click();
    await expect(page.locator('[data-options-tape-view="invalid"]')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("tapeView")).toBe(false);
  });
}
