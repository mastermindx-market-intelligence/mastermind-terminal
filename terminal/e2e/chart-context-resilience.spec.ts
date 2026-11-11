import { expect, test, type Page } from "@playwright/test";
import { chartContextReturnTarget, openChartContext } from "./phoneChrome";
import { useLang } from "./layoutStore";

async function toggleFocusedChart(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const floating = page.locator(".chart-fs-float");
  const toolbar = page.locator(".chart-fs-btn");
  if (await floating.isVisible()) await floating.click();
  else if (await toolbar.isVisible()) await toolbar.click();
  else {
    await page.getByTestId("toolbar-more").click();
    await page.locator('[data-toolbar-menu-action="fullscreen"]').click();
  }
}

test("an open historical reader keeps disclosures, internal scroll and owned focus across dock changes", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "One transition sequence; native viewport cases run separately.");
  test.slow();
  await page.goto("/terminal?symbol=NVDA");
  const panel = await openChartContext(page);
  await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20_000 });
  await panel.getByRole("button", { name: "Previous bar", exact: true }).click();
  const selected = await panel.locator("[data-context-bar-time]").innerText();
  const help = panel.locator("details").nth(2);
  const summary = help.locator("summary");
  await summary.click();
  await expect(help).toHaveAttribute("open", "");
  await summary.focus();
  await panel.evaluate((el) => { el.scrollTop = Math.min(280, el.scrollHeight - el.clientHeight); });
  await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(20);
  const offset = await panel.evaluate((el) => el.scrollTop);
  await page.screenshot({ path: info.outputPath("desktop-before-transition.png") });

  for (const viewport of [{ width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('[data-context-dock="inline"] [data-context-reader]')).toHaveCount(1);
    await expect(help).toHaveAttribute("open", "");
    await expect(summary).toBeFocused();
    await expect(panel.locator("[data-context-bar-time]")).toHaveText(selected);
    await expect(panel.locator("[data-context-calendar]")).toHaveAttribute("data-context-calendar", "withheld");
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('[data-context-dock="rail"] [data-context-reader]')).toHaveCount(1);
  await expect(help).toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
  await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeCloseTo(offset, 0);
  await expect(panel.locator("[data-context-bar-time]")).toHaveText(selected);
  await page.screenshot({ path: info.outputPath("desktop-after-transition.png") });
});

for (const lang of ["en", "zh"] as const) {
  test(`reader keyboard controls and return navigation remain usable in ${lang}`, async ({ page }, info) => {
    await useLang(page, lang);
    await page.goto("/terminal?symbol=NVDA");
    const panel = await openChartContext(page, lang);
    await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20_000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await panel.locator('[data-context-focus="previous"]').click();
    const selected = await panel.locator("[data-context-bar-time]").innerText();
    await expect(panel.locator("[data-context-calendar]")).toHaveAttribute("data-context-calendar", "withheld");
    const geometry = await panel.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const controls = Array.from(node.querySelectorAll<HTMLElement>("button, summary"))
        .filter((element) => element.getClientRects().length)
        .map((element) => ({ key: element.dataset.contextFocus, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
      return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth, readerWidth: rect.width, readerLeft: rect.left, readerRight: rect.right,
        background: getComputedStyle(node).backgroundColor, coarse: matchMedia("(pointer:coarse)").matches,
        theme: document.documentElement.dataset.theme, locale: document.documentElement.lang, controls };
    });
    expect(geometry.scrollWidth).toBe(geometry.documentWidth);
    expect(geometry.readerLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.readerRight).toBeLessThanOrEqual(geometry.documentWidth + 1);
    expect(geometry.background).toBe("rgb(10, 11, 14)");
    if (geometry.coarse || geometry.viewport.width <= 640) {
      for (const control of geometry.controls) {
        expect(control.height, control.key).toBeGreaterThanOrEqual(44);
        if (control.key !== "range" && control.key !== "layers" && control.key !== "help") expect(control.width, control.key).toBeGreaterThanOrEqual(44);
      }
    }
    const capture = info.outputPath(`reader-${info.project.name}-${lang}.png`);
    await panel.screenshot({ path: capture, animations: "disabled" });
    await info.attach("reader-capture", { path: capture, contentType: "image/png" });
    await info.attach("reader-geometry", { body: Buffer.from(JSON.stringify({ proof: "local real Terminal route with existing deterministic fixture", ...geometry }, null, 2)), contentType: "application/json" });

    const range = panel.locator("details").nth(0);
    await range.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(range).toHaveAttribute("open", "");
    await page.keyboard.press("Space");
    await expect(range).not.toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(chartContextReturnTarget(page, lang)).toBeFocused();
    const reopened = await openChartContext(page, lang);
    await expect(reopened.locator("details[open]")).toHaveCount(0);
    await expect(reopened.locator("[data-context-bar-time]")).toHaveText(selected);
    await expect(reopened.locator('[data-context-focus="close"]')).toBeFocused();
  });

  test(`320px fine-pointer reader keeps 44px targets in ${lang}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "The desktop project provides a genuine fine-pointer context.");
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await useLang(page, lang);
    await page.goto("/terminal?symbol=NVDA");
    const panel = await openChartContext(page, lang);
    await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20_000 });
    expect(await page.evaluate(() => matchMedia("(pointer:fine)").matches)).toBe(true);
    for (const summary of await panel.locator("summary").all()) await summary.click();
    const sizes = await panel.locator("button").evaluateAll((buttons) => buttons.filter((button) => button.getClientRects().length).map((button) => {
      const rect = button.getBoundingClientRect();
      return { key: (button as HTMLElement).dataset.contextFocus, width: rect.width, height: rect.height };
    }));
    for (const size of sizes) {
      expect(size.width, size.key).toBeGreaterThanOrEqual(44);
      expect(size.height, size.key).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    const capture = info.outputPath(`phone-fine-pointer-${lang}.png`);
    await panel.screenshot({ path: capture, animations: "disabled" });
    await info.attach("phone-fine-pointer", { path: capture, contentType: "image/png" });
  });
}

test("moving the reader never takes focus from another chart control", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "One crossing with an outside chart focus owner.");
  await page.goto("/terminal?symbol=NVDA");
  const panel = await openChartContext(page);
  await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20_000 });
  await panel.locator('[data-context-focus="previous"]').focus();
  const chart = page.locator(".cfb-gear").first();
  await chart.focus();
  await expect(chart).toBeFocused();
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator('[data-context-dock="inline"] [data-context-reader]')).toHaveCount(1);
  await expect(chart).toBeFocused();
});

test("fullscreen preserves disclosure and internal position with its bounded inline scroller", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "One rail-to-focused-to-rail sequence.");
  await page.goto("/terminal?symbol=NVDA");
  const panel = await openChartContext(page);
  await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20_000 });
  await panel.locator('[data-context-focus="help"]').click();
  await panel.evaluate((node) => { node.scrollTop = 260; });
  await expect.poll(() => panel.evaluate((node) => node.scrollTop)).toBe(260);
  await toggleFocusedChart(page);
  const host = page.locator('[data-context-dock="inline"]');
  await expect(host.locator("[data-context-reader]")).toHaveCount(1);
  await expect(panel.locator("details").nth(2)).toHaveAttribute("open", "");
  await expect.poll(() => host.evaluate((node) => node.scrollTop)).toBe(260);
  const scrolled = await host.evaluate((node) => {
    node.scrollTop = 120;
    return node.scrollTop;
  });
  await expect.poll(() => host.evaluate((node) => node.scrollTop)).toBe(scrolled);
  await toggleFocusedChart(page);
  await expect(page.locator('[data-context-dock="rail"] [data-context-reader]')).toHaveCount(1);
  await expect.poll(() => panel.evaluate((node) => node.scrollTop)).toBe(scrolled);
});

test("Candle settings takes focus without a delayed reader restoration", async ({ page }) => {
  await page.goto("/terminal?symbol=NVDA");
  const panel = await openChartContext(page);
  await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20_000 });
  await panel.locator('[data-context-focus="help"]').click();
  await panel.getByRole("button", { name: "Candle settings", exact: false }).click();
  const settings = page.getByRole("dialog", { name: "Mastermind Candles", exact: true });
  await expect(settings).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect.poll(() => settings.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect.poll(() => settings.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await expect(panel).toHaveCount(0);
});

