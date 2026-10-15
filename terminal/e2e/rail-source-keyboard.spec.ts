import { expect, test } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";

// The real Terminal tablist: keyboard selection must use the same panels as a click,
// retain the mounted watchlist board, and never turn navigation into an owner write.
for (const lang of ["en", "zh"] as const) {
  test(`[${lang}] rail sources support arrows, Home and End with visible focus`, async ({ page, baseURL }, info) => {
    await isolateWatchlistStore(page, info, baseURL);
    await page.addInitScript(value => localStorage.setItem("mm.lang", value), lang);
    const writes: string[] = [];
    page.on("request", request => {
      if (request.method() !== "GET" && /^\/api\/(portfolio|watchlists|layouts|investigations|theses|smart-screens)(\/|$)/.test(new URL(request.url()).pathname)) {
        writes.push(request.method() + " " + new URL(request.url()).pathname);
      }
    });
    await page.route("**/api/portfolio", route => route.fulfill({ json: { positions: [] } }));
    await page.goto("/terminal?symbol=NVDA");
    const tabs = page.getByTestId("rail-source-tabs");
    await expect(tabs.getByRole("tab")).toHaveCount(3, { timeout: 45_000 });
    const watchlistBoard = await page.locator("#rail-panel-watchlists").elementHandle();
    await page.locator("#rail-tab-watchlists").focus();
    const steps = [["ArrowRight", "news"], ["Home", "portfolio"], ["End", "news"],
      ["ArrowRight", "portfolio"], ["ArrowLeft", "news"], ["ArrowLeft", "watchlists"]] as const;
    for (const [key, source] of steps) {
      await page.keyboard.press(key);
      const selected = page.locator(`#rail-tab-${source}`);
      await expect(selected).toBeFocused();
      await expect(selected).toHaveAttribute("aria-selected", "true");
      await expect(selected).toHaveAttribute("tabindex", "0");
      await expect(tabs.locator('[aria-selected="true"]')).toHaveCount(1);
      await expect(tabs.locator('[tabindex="0"]')).toHaveCount(1);
      await expect(selected).toBeInViewport();
      expect(await selected.evaluate(element => element.matches(":focus-visible"))).toBe(true);
      const panel = page.locator(`#rail-panel-${source}`);
      if (source !== "watchlists" || info.project.name === "desktop") await expect(panel).toBeVisible();
      else await expect(panel).not.toHaveClass(/rail-hidden/); // responsive shell uses its mobile watchlist entry
    }
    expect(await watchlistBoard!.evaluate(element => element === document.querySelector("#rail-panel-watchlists"))).toBe(true);
    expect(await tabs.getByRole("tab").evaluateAll(elements => elements.every(element => {
      const box = element.getBoundingClientRect(), range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      return text.left >= box.left - 1 && text.right <= box.right + 1 && text.top >= box.top - 1 && text.bottom <= box.bottom + 1;
    }))).toBe(true);
    await page.screenshot({ path: info.outputPath(`rail-keyboard-${lang}.png`) });
    expect(writes).toEqual([]);
  });
}
