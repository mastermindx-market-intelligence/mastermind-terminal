import { expect, test, type Page } from "@playwright/test";
import { useLang as selectLanguage } from "./layoutStore";

const MANIFEST = { as_of: "2026-11-09", symbols: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [
  `S${String(i).padStart(3, "0")}`,
  { name: i < 2 ? "Focus company" : `Company ${i}`, last: 10 + i, vol: 1000, chg: i % 2 ? 4 : -4, mkt: "US", sec: "Technology" },
])) };
const table = (page: Page) => page.locator(".scr2-table");
const results = (page: Page) => page.locator("tbody a.sym-cell");
async function scroll(page: Page, top: number) {
  await table(page).evaluate((el, value) => { el.scrollTop = value; el.dispatchEvent(new Event("scroll")); }, top);
}
async function open(page: Page, lang: "en" | "zh") {
  await selectLanguage(page, lang);
  await page.addInitScript(() => { localStorage.removeItem("mm.scrPresets"); localStorage.setItem("mm.scrDensity", "c"); });
  await page.route("**/data/manifest.json**", route => route.fulfill({ json: MANIFEST }));
  await page.goto("/discover?tab=screener");
  await expect(results(page).first()).toBeVisible({ timeout: 45_000 });
}

for (const lang of ["en", "zh"] as const) {
  test(`${lang} screener keeps a visible result and deliberate keyboard actions`, async ({ page }, info) => {
    await open(page, lang);
    const search = page.locator(".scr2-search");
    const nestedScroll = info.project.name === "desktop";
    // The existing ≤860px shell uses document scrolling, while desktop virtualizes
    // within the result table. Exercise the actual owner in both layouts.
    if (nestedScroll) {
      await scroll(page, 6000);
      await expect.poll(() => table(page).evaluate(el => el.scrollTop)).toBeGreaterThan(3000);
    } else {
      await results(page).last().scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(3000);
    }
    await search.fill("Focus company");
    await expect(results(page)).toHaveCount(2);
    await expect(results(page).first()).toBeVisible();
    await expect.poll(() => table(page).evaluate(el => el.scrollTop)).toBe(0);
    await search.fill("no such listing");
    await expect(results(page)).toHaveCount(0);
    await expect(page.locator("tbody .empty-row")).toBeVisible();
    await expect(page.locator("tbody .scr2-spacer")).toHaveCount(0);
    await search.fill("");
    await expect(results(page).first()).toBeVisible();

    const sort = page.locator("thead th").first().getByRole("button");
    const th = sort.locator("..");
    const buttonBox = await sort.boundingBox(); const headerBox = await th.boundingBox();
    expect(buttonBox!.height).toBeGreaterThanOrEqual(info.project.use.hasTouch ? 44 : 32);
    expect(Math.abs(buttonBox!.width - headerBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(buttonBox!.height - headerBox!.height)).toBeLessThanOrEqual(1);
    await scroll(page, 4000);
    // Clicking in the header's former padding still sorts; the whole target is a button.
    await sort.click({ position: { x: 4, y: 4 } });
    await expect(th).toHaveAttribute("aria-sort", "descending");
    await expect.poll(() => table(page).evaluate(el => el.scrollTop)).toBe(0);
    await sort.focus(); await page.keyboard.press("Enter");
    await expect(th).toHaveAttribute("aria-sort", "ascending");
    await expect(sort).toBeFocused();
    await expect(results(page).first()).toHaveAttribute("href", "/terminal?sym=S000");

    const density = page.getByRole("group", { name: lang === "zh" ? "行密度" : "Row density", exact: true });
    if (nestedScroll) await scroll(page, 4000);
    const oldTop = await table(page).evaluate(el => el.scrollTop);
    await density.getByRole("button", { name: lang === "zh" ? "紧凑" : "Compact", exact: true }).click();
    await expect.poll(() => table(page).evaluate(el => el.scrollTop)).toBeCloseTo(oldTop * 36 / 44, 0);
    if (nestedScroll) await scroll(page, 100000);
    await density.getByRole("button", { name: lang === "zh" ? "宽松" : "Comfortable", exact: true }).click();
    if (nestedScroll) await expect.poll(() => table(page).evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
    await density.getByRole("button", { name: lang === "zh" ? "紧凑" : "Compact", exact: true }).click();
    if (nestedScroll) await expect.poll(() => table(page).evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
    await results(page).last().scrollIntoViewIfNeeded();
    await expect(results(page).last()).toBeVisible();
    await expect(results(page).last()).toHaveAttribute("href", "/terminal?sym=S299");

    const launch = page.locator(".scr2-presets-tail").getByRole("button", { name: lang === "zh" ? "+ 保存" : "+ Save", exact: true });
    await launch.click();
    const input = page.locator(".scr2-preset-name");
    const name = lang === "zh" ? "趋势观察" : "Trend watch";
    await input.fill(name);
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await expect(input).toHaveValue(name);
    await expect(page.locator(".scr2-preset-wrap")).toHaveCount(0);
    await input.press("Tab");
    const save = page.locator(".scr2-presets-tail").getByRole("button", { name: lang === "zh" ? "保存" : "Save", exact: true });
    await expect(save).toBeFocused(); await expect(input).toHaveValue(name);
    const cancel = page.locator(".scr2-presets-tail").getByRole("button", { name: lang === "zh" ? "取消" : "Cancel", exact: true });
    for (const control of [input, save, cancel]) {
      const b = await control.boundingBox();
      expect(b!.x).toBeGreaterThanOrEqual(0);
      expect(b!.x + b!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      if (info.project.use.hasTouch) expect(b!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const crop = info.outputPath(`screener-editor-${lang}.png`);
    await page.screenshot({ path: crop }); await info.attach("screener-editor", { path: crop, contentType: "image/png" });
    await save.press("Enter");
    await expect(input).toHaveCount(0); await expect(launch).toBeFocused();
    await expect(page.locator(".scr2-preset-wrap .fin-tab")).toHaveText([name]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mm.scrPresets") || "{}").items[0].name)).toBe(name);
    await launch.click(); await input.fill("Discard");
    await page.locator(".scr2-presets-tail").getByRole("button", { name: lang === "zh" ? "取消" : "Cancel", exact: true }).click();
    await expect(launch).toBeFocused(); await expect(page.locator(".scr2-preset-wrap .fin-tab")).toHaveText([name]);

    await scroll(page, 0);
    const href = await results(page).first().getAttribute("href");
    await results(page).first().focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
  });
}
