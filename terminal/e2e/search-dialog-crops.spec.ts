import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isolateWatchlistStore, seedOwnerWatchlists } from "./watchlistStore";

// Opt-in review evidence from the real application and its existing synthetic fixture server.
// TERMINAL_CROPS=1 TERMINAL_E2E_PORT=3192 npx playwright test e2e/search-dialog-crops.spec.ts --workers=1
test.skip(!process.env.TERMINAL_CROPS, "Review captures are opt-in and never write artifacts in ordinary CI.");
test.setTimeout(90_000);

const OUT = join(process.cwd(), "docs/pr-crops/ex03-search/after");
const LISTS = {
  lists: { Default: [{ symbol: "NVDA", section: "EQUITIES" }], Research: [{ symbol: "AAPL", section: "EQUITIES" }] },
  active: "Default", meta: {},
};

async function contained(page: Page, surface: Locator) {
  const geometry = await surface.evaluate(node => {
    const r = node.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
  expect(geometry.overflow).toBe(false);
}

async function capture(page: Page, info: TestInfo, lang: string, state: string) {
  mkdirSync(OUT, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(OUT, `${info.project.name}-${lang}-${state}.png`), animations: "disabled" });
}

for (const lang of ["en", "zh"] as const) {
  test(`symbol tasks remain coherent with long results and reduced motion — ${lang}`, async ({ page, baseURL }, info) => {
    const store = await isolateWatchlistStore(page, info, baseURL);
    await seedOwnerWatchlists(page, store, LISTS);
    await page.addInitScript(language => localStorage.setItem("mm.lang", language), lang);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/terminal?symbol=NVDA");
    await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
    const viewport = page.viewportSize()!;
    const phone = info.project.name === "mobile";
    const opener = info.project.name === "desktop" ? page.locator(".pair").first() : page.locator("[data-symbol-search]");
    await opener.click();
    await page.locator(".sh input").fill("A");
    await expect(page.locator(".sres .r").first()).toBeVisible();
    const surface = phone ? page.locator(".msheet-search") : page.locator(".smodal");
    await contained(page, surface);
    await capture(page, info, lang, "search");

    await page.locator(".sh input").fill("AMD");
    await expect(page.locator(".sres .r .tk").first()).toHaveText("AMD");
    await page.locator(".sres .r .add").first().click();
    const picker = page.locator(".s-pick");
    await expect(picker).toBeVisible();
    await contained(page, picker);
    expect(await picker.evaluate(node => {
      const r = node.getBoundingClientRect();
      return !!document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)?.closest(".s-pick");
    })).toBe(true);
    await capture(page, info, lang, "destination-picker");
    // Escape closes the desktop picker first; phone retains its incumbent sheet dismissal.
    await page.keyboard.press("Escape");
    if (await surface.isVisible()) await page.keyboard.press("Escape");
    await expect(surface).toBeHidden();

    if (phone) {
      await page.getByTestId("roller-more").click();
      await page.getByTestId("hub-tile-compare").click();
    } else {
      // Tablet has no dedicated header Compare entry. Exercise responsive continuation from
      // the existing desktop entry; this is geometry evidence, not a new tablet entry claim.
      if (info.project.name === "tablet") await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator(".cmp-btn").first().click();
      await page.setViewportSize(viewport);
    }
    const compare = page.locator(".smodal-cmp");
    await expect(compare.locator(".sh input")).toBeFocused();
    await compare.locator(".sh input").fill("A");
    await contained(page, compare);
    await expect(compare).toHaveCSS("animation-name", "none");
    await capture(page, info, lang, "compare");
    await page.keyboard.press("Escape");
    await expect(compare).toBeHidden();

    // Add Symbol is a rail action. Its open task must remain usable when the browser narrows.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".wl-acts button").first().click();
    await page.setViewportSize(viewport);
    const add = page.locator(".smodal-add");
    await add.locator(".sh input").fill("A");
    await contained(page, add);
    const close = page.getByRole("button", { name: lang === "en" ? "Close add symbol" : "关闭添加标的", exact: true });
    const box = await close.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(info.project.name === "desktop" ? 32 : 44);
    await capture(page, info, lang, "add-symbol");
    await close.click();
    await expect(add).toBeHidden();

    // This panel changes height allocation. Check the intervening and short-window layouts,
    // where a long result set must scroll without hiding the input, close or footer.
    if (info.project.name === "desktop") {
      for (const size of [{ width: 1180, height: 820 }, { width: 1440, height: 600 }]) {
        await page.setViewportSize(size);
        await page.locator(".cmp-btn").first().click();
        await compare.locator(".sh input").fill("A");
        await contained(page, compare);
        await expect(compare.locator(".sh input")).toBeInViewport({ ratio: 1 });
        await expect(compare.locator(".scmp-foot")).toBeInViewport({ ratio: 1 });
        await capture(page, info, lang, `compare-${size.width}x${size.height}`);
        await page.keyboard.press("Escape");
        await expect(compare).toBeHidden();
      }
    }
  });
}
