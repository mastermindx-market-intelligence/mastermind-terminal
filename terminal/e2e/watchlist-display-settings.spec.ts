import { expect, test } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";
import { useLang as selectLanguage } from "./layoutStore";

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: watchlist display choices stay usable, visible and persistent`, async ({ page, baseURL }, info) => {
    test.skip(info.project.name !== "desktop", "the existing display-settings rail is desktop-only");
    test.setTimeout(90_000);
    await isolateWatchlistStore(page, info, baseURL); await selectLanguage(page, lang);
    await page.addInitScript(() => {
      const fixture = window as Window & { watchlistDisplayReady?: boolean };
      fixture.watchlistDisplayReady = false;
      window.addEventListener("mm:terminal-visual-ready", () => { fixture.watchlistDisplayReady = true; }, { once: true });
      if (sessionStorage.getItem("watchlist-display-fixture")) return;
      sessionStorage.setItem("watchlist-display-fixture", "seeded");
      localStorage.setItem("mm.setVersion", "1");
      localStorage.setItem("mm.set", JSON.stringify({ tableView: true, cols: { last: true, changePct: true, change: false, volume: false, ext: true, extPct: true }, disp: "symbol", logo: true, colW: {} }));
    });
    await page.route("**/data/manifest.json", async (route) => {
      const response = await route.fetch(); const manifest = await response.json();
      manifest.symbols.NVDA = { ...manifest.symbols.NVDA, name: "NVIDIA Corporation", zh: "英伟达公司" };
      await route.fulfill({ response, json: manifest });
    });
    const ready = () => expect.poll(() => page.evaluate(() => Boolean((window as Window & { watchlistDisplayReady?: boolean }).watchlistDisplayReady))).toBe(true);
    await page.goto("/terminal?symbol=NVDA"); await ready();
    const trigger = page.locator(".wl-acts button").last();
    const popup = page.locator(".wl-bar > .pop.show");
    const row = page.locator('.wl-row[data-watchlist-symbol="NVDA"]');
    const column = (key: string) => page.locator(`.wl-cols [data-watchlist-column="${key}"]`);
    const checkbox = (key: string) => popup.locator(`[data-watchlist-setting="${key}"] input`);
    await expect(column("last")).toHaveCount(1);
    await trigger.click();
    // This same full-row action exists in the unchanged UI and exposes the ignored Last flag.
    await popup.locator(".set-row").filter({ hasText: lang === "zh" ? /^最新$/ : /^Last$/ }).click();
    await expect(column("last")).toHaveCount(0);
    await expect(row.locator('[data-watchlist-column="last"]')).toHaveCount(0);
    await expect(popup).toHaveAttribute("role", "dialog");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(trigger).toHaveAttribute("aria-controls", await popup.getAttribute("id") as string);
    await expect(checkbox("last")).toBeFocused();
    await expect(popup).toHaveCSS("color-scheme", "dark");
    if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
      for (const label of await popup.locator("label").all()) expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    await checkbox("volume").focus(); await page.keyboard.press("Space");
    await expect(checkbox("volume")).toBeChecked(); await expect(checkbox("volume")).toBeFocused();
    await expect(column("volume")).toHaveCount(1);
    await checkbox("ext").uncheck(); await expect(column("ext")).toHaveCount(0); await expect(column("extPct")).toHaveCount(1);
    await checkbox("logo").uncheck(); await expect(row.locator(".s > .asset-logo.ic")).toHaveCount(0);
    const symbol = popup.getByRole("radio", { name: lang === "zh" ? "代码" : "Symbol", exact: true });
    const name = popup.getByRole("radio", { name: lang === "zh" ? "名称" : "Name", exact: true });
    const both = popup.getByRole("radio", { name: lang === "zh" ? "代码+名称" : "Both", exact: true });
    await symbol.focus(); await page.keyboard.press("ArrowDown");
    await expect(name).toBeChecked(); await expect(name).toBeFocused();
    await expect(row.locator(".s > .nm > .tk")).toHaveText(lang === "zh" ? "英伟达公司" : "NVIDIA Corporation");
    await expect(row.locator(".s > .nm > .tk-sub")).toHaveText("NVDA");
    await page.keyboard.press("ArrowDown"); await expect(both).toBeChecked();
    await expect(row.locator(".s > .nm > .tk")).toHaveText("NVDA");
    const tableView = popup.getByRole("switch", { name: lang === "zh" ? "表格视图" : "Table view" });
    await tableView.focus(); await page.keyboard.press("Space"); await expect(tableView).not.toBeChecked();
    await expect(row).not.toHaveClass(/\btv\b/);
    await expect(row.locator(".s > .nm > .sub")).toHaveText(lang === "zh" ? "英伟达公司" : "NVIDIA Corporation");

    for (const key of ["last", "change", "changePct", "volume", "ext", "extPct"]) await checkbox(key).uncheck();
    await expect(page.locator(".wl-cols [data-watchlist-column]")).toHaveCount(0);
    await expect(row.locator(".s > .nm > .tk")).toBeVisible();
    await checkbox("volume").check(); await checkbox("extPct").check();
    await page.keyboard.press("Escape"); await expect(popup).toHaveCount(0); await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter"); await expect(tableView).toBeFocused();
    await trigger.focus(); await trigger.click(); await expect(popup).toHaveCount(0);
    await trigger.click();
    const outside = page.locator(".rail-tab").filter({ hasText: lang === "zh" ? /^自选列表$/ : /^Watchlists$/ });
    await outside.click(); await expect(popup).toHaveCount(0); await expect(outside).toBeFocused();
    await trigger.click(); await expect(checkbox("last")).not.toBeChecked(); await expect(both).toBeChecked();
    const normal = info.outputPath(`watchlist-display-${lang}.png`);
    await page.screenshot({ path: normal, animations: "disabled" }); await info.attach("watchlist-display", { path: normal, contentType: "image/png" });

    await page.setViewportSize({ width: 1440, height: 520 });
    await both.focus(); await expect(both).toBeInViewport();
    await expect.poll(() => popup.evaluate((el) => {
      const rect = el.getBoundingClientRect(), rail = el.closest(".rail-body")!.getBoundingClientRect();
      return { usable: rect.height > 120, contained: rect.bottom <= Math.min(innerHeight, rail.bottom) - 6, scrolling: el.scrollHeight > el.clientHeight };
    })).toEqual({ usable: true, contained: true, scrolling: true });
    const short = info.outputPath(`watchlist-display-short-${lang}.png`);
    await page.screenshot({ path: short, animations: "disabled" }); await info.attach("watchlist-display-short", { path: short, contentType: "image/png" });
    await page.keyboard.press("Escape"); await page.reload(); await ready();
    await expect(column("last")).toHaveCount(0); await expect(column("volume")).toHaveCount(1); await expect(column("extPct")).toHaveCount(1);
    await expect(row.locator(".s > .asset-logo.ic")).toHaveCount(0); await expect(row).not.toHaveClass(/\btv\b/);
    await trigger.click(); await expect(both).toBeChecked(); await expect(checkbox("last")).not.toBeChecked();
    await expect(checkbox("volume")).toBeChecked(); await expect(tableView).not.toBeChecked();
  });
}
