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
    await page.route("**/data/prophet/trough_read.json", route => route.fulfill({ status: state === "D" ? 404 : 200, json: troughSpecimen(state) }));
    await page.route(url => url.pathname === "/api/sector-intelligence" && url.searchParams.get("source") === "rotation_read", route => route.fulfill({ status: 404, json: {} }));
    await page.goto(url);
    const block = page.getByTestId("trough-read");
    await expect(block).toBeVisible({ timeout: 30_000 });
    if (state === "D") await expect(block).toContainText(lang === "en" ? "This read is not available for this stock yet." : "该股票暂未提供此项解读。");
    else await expect(block.getByTestId("trough-headline")).toContainText(lang === "en" ? state === "C" ? "not washed out" : state === "B" ? "not yet turned" : "turning up" : state === "C" ? "未处于低位" : state === "B" ? "尚未回升" : "正在回升");
    await expect(block).not.toContainText(TROUGH_BANNED_WORDS);
    await expect(block.locator("a,[role=alert]")).toHaveCount(0);
    const rotation = await page.getByTestId("rotation-read").boundingBox();
    const box = (await block.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(rotation!.y + rotation!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    // Card plus existing page header fits a phone without moving or hiding the
    // preceding RotationRead. Larger served rotation payloads remain untouched.
    if (width === 390) expect(box.y + box.height).toBeLessThanOrEqual(844);
    if (crops) await page.screenshot({ path: path.join(crops, `${state}-${lang}-${width}-collapsed.png`) });
    if (state === "D") { await expect(block.getByRole("button")).toHaveCount(0); return; }
    const open = block.getByRole("button", { name: lang === "en" ? "How this read works ▸" : "解读方法 ▸", exact: true });
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await open.focus(); await page.keyboard.press("Enter");
    await expect(open).toHaveAttribute("aria-expanded", "true");
    const disclosure = block.getByTestId("trough-disclosure");
    await expect(disclosure).toBeVisible();
    await expect(block.getByTestId("trough-frame")).toHaveCount(4);
    for (const row of await block.getByTestId("trough-frame").all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(block).toContainText(lang === "en" ? "Group figures: not yet available" : "组内数据：尚未提供");
    await expect(block).not.toContainText(TROUGH_BANNED_WORDS);
    if (lang === "en" && state === "E") await expect(block.getByTestId("trough-frame").last()).toHaveText("2-week——");
    const method = disclosure.locator("aside"); const frames = block.getByTestId("trough-frame").first();
    if (width === 1440) expect((await method.boundingBox())!.x).toBeGreaterThan((await frames.boundingBox())!.x);
    else expect((await method.boundingBox())!.y).toBeLessThan((await frames.boundingBox())!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (crops) await block.screenshot({ path: path.join(crops, `${state}-${lang}-${width}-expanded.png`) });
    const hide = block.getByRole("button", { name: lang === "en" ? "Hide ▴" : "收起 ▴", exact: true });
    const hideBox = (await hide.boundingBox())!; expect(hideBox.height).toBeGreaterThanOrEqual(44); expect(hideBox.width).toBeGreaterThanOrEqual(44);
    await hide.click(); await expect(disclosure).toBeHidden(); await expect(open).toBeFocused();
    await page.keyboard.press("Space"); await expect(disclosure).toBeVisible(); await hide.click();
    await page.getByTestId("case-tab-context").click(); await expect(block).toHaveCount(0);
    await page.getByTestId("case-tab-setup").click(); await expect(block).toBeVisible(); await expect(page).toHaveURL(/prophetSymbol=ADP/);
  });
}
