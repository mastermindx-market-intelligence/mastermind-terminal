import { expect, test } from "@playwright/test";
import path from "node:path";
import { stubObservationsUnavailable } from "./prophetCaseFixtures";
import { troughSpecimen, TROUGH_BANNED_WORDS, type TroughSpecimenState } from "./prophetTroughSpecimens";
const url = "/options?tab=prophet&prophetLane=sector&prophetView=setup&prophetGroup=us_sector_industrials&prophetSymbol=ADP";
const crops = process.env.PROPHET_TROUGH_CROPS;
// The broad suite keeps the production default off. Opt in only on the explicit
// fixture server; no runtime URL/localStorage override can expose the block.
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.metadata.troughEnabled !== true, "Requires the default-off rollout fixture configuration");
});
for (const lang of ["en", "zh"] as const) for (const width of [320, 390, 1440]) for (const state of ["A", "B", "C", "D", "E"] as TroughSpecimenState[]) {
  if (width === 320 && state !== "A" && state !== "D") continue;
  test(`${state} ${lang} at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.addInitScript(code => localStorage.setItem("mm.lang", code), lang);
    await stubObservationsUnavailable(page);
    await page.route("**/api/prophet/trough-read", route => route.fulfill({ status: state === "D" ? 404 : 200, json: troughSpecimen(state) }));
    await page.route(url => url.pathname === "/api/sector-intelligence" && url.searchParams.get("source") === "rotation_read", route => route.fulfill({ status: 404, json: {} }));
    await page.goto(url);
    const block = page.getByTestId("trough-read");
    await expect(block).toBeVisible({ timeout: 30_000 });
    if (state === "D") await expect(block).toContainText(lang === "en" ? "This read is not available for this stock yet." : "该股票暂未提供此项解读。");
    else await expect(block.getByTestId("trough-headline")).toContainText(lang === "en" ? state === "C" ? "Not washed out on any timeframe" : state === "B" ? "not yet turned" : "turning up" : state === "C" ? "未处于低位" : state === "B" ? "尚未回升" : "正在回升");
    await expect(block).not.toContainText(TROUGH_BANNED_WORDS);
    await expect(block.locator("a,[role=alert]")).toHaveCount(0);
    await expect(block).not.toContainText(/Studied on three stocks|仅研究过三只股票/);
    if (state !== "D") {
      await expect(block.getByTestId("trough-headline").locator("+ p")).toHaveText(lang === "en" ? "More timeframes washed out means a deeper decline. It has not been shown to make the low more likely to hold." : "更多周期处于低位意味着跌幅更深。尚无证据表明这会使低点更可能守住。");
      await expect(block).toContainText(lang === "en" ? "Kind: not yet available" : "类型：尚未提供");
    }
    const rotation = await page.getByTestId("rotation-read").boundingBox();
    const box = (await block.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(rotation!.y + rotation!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    // Card plus existing page header fits a phone without moving or hiding the
    // preceding RotationRead. Larger served rotation payloads remain untouched.
    if (width === 390) expect(box.y + box.height).toBeLessThanOrEqual(844);
    if (crops) await page.screenshot({ path: path.join(crops, `${state}-${lang}-${width}-collapsed.png`) });
    const record = lang === "en" ? "Measured on about 22,000 past turns in large and mid-size US stocks, 2013–2019. On average they did no better than the market." : "基于2013–2019年美国大中型股约22,000次历史回升测算。平均而言，其表现并未优于大盘。";
    await expect(block.locator("small").first()).toHaveText(record);
    if (state === "D") {
      await block.getByRole("button", { name: lang === "en" ? "How this read works ▸" : "解读方法 ▸", exact: true }).click();
      await expect(block.locator("aside small")).toHaveText(record);
      await expect(block).not.toContainText(TROUGH_BANNED_WORDS);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (crops) await block.screenshot({ path: path.join(crops, `${state}-${lang}-${width}-expanded.png`) });
      return;
    }
    const open = block.getByRole("button", { name: lang === "en" ? "How this read works ▸" : "解读方法 ▸", exact: true });
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await open.focus(); await page.keyboard.press("Enter");
    await expect(open).toHaveAttribute("aria-expanded", "true");
    const disclosure = block.getByTestId("trough-disclosure");
    await expect(disclosure).toBeVisible();
    await expect(disclosure.locator("aside small")).toHaveText(record);
    await expect(block.getByTestId("trough-frame")).toHaveCount(4);
    await expect(block.getByRole("meter")).toHaveCount(0);
    await expect(block).not.toContainText(/Turned up on|K_gt_D|hist_rising/);
    for (const index of [0, 2, 3]) await expect(block.getByTestId("trough-frame").nth(index).locator("span").last()).toHaveText("—");
    for (const row of await block.getByTestId("trough-frame").all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(block).toContainText(lang === "en" ? "Group figures: not yet available" : "组内数据：尚未提供");
    await expect(block).not.toContainText(TROUGH_BANNED_WORDS);
    if (lang === "en" && state === "E") await expect(block.getByTestId("trough-frame").last()).toHaveText("2‑week——");
    const method = disclosure.locator("aside"); const frames = block.getByTestId("trough-frame").first();
    if (width === 1440) expect((await method.boundingBox())!.x).toBeGreaterThan((await frames.boundingBox())!.x);
    else expect((await method.boundingBox())!.y).toBeLessThan((await frames.boundingBox())!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const name of await block.locator("span, strong").filter({ hasText: /^(3‑day|2‑week|3日K线|3日线|2周线)$/ }).all()) {
      expect(await name.evaluate(el => {
        const range = document.createRange(); range.selectNodeContents(el);
        return { nowrap: getComputedStyle(el).whiteSpace, lines: range.getClientRects().length };
      })).toEqual({ nowrap: "nowrap", lines: 1 });
    }
    if (crops) await block.screenshot({ path: path.join(crops, `${state}-${lang}-${width}-expanded.png`) });
    const hide = block.getByRole("button", { name: lang === "en" ? "Hide ▴" : "收起 ▴", exact: true });
    const hideBox = (await hide.boundingBox())!; expect(hideBox.height).toBeGreaterThanOrEqual(44); expect(hideBox.width).toBeGreaterThanOrEqual(44);
    await hide.click(); await expect(disclosure).toBeHidden(); await expect(open).toBeFocused();
    await page.keyboard.press("Space"); await expect(disclosure).toBeVisible(); await hide.click();
    await page.getByTestId("case-tab-context").click(); await expect(block).toHaveCount(0);
    await page.getByTestId("case-tab-setup").click(); await expect(block).toBeVisible(); await expect(page).toHaveURL(/prophetSymbol=ADP/);
  });
}
