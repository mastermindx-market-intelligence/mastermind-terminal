import { expect, test, type Page } from "@playwright/test";
import { toggleToolbarReplay } from "./terminalToolbar";

// Without phone bounds/wrapping, Replay escapes its chart even though the badge
// still passes Playwright's visibility check. Check the whole painted rectangle.
async function expectStatusWithinChart(page: Page) {
  const wrap = page.locator(".chart-wrap").first();
  const badge = wrap.locator(".statusline .mm", { hasText: /^REPLAY$/ });
  await expect(badge).toHaveCount(1);
  await expect(badge).toBeVisible();
  const geometry = await wrap.evaluate((host) => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const line = host.querySelector(".statusline")!;
    const chip = Array.from(line.querySelectorAll(".mm")).find((el) => el.textContent === "REPLAY")!;
    const values = Array.from(line.querySelectorAll(".status-identity, .status-ohlc, .status-change, .status-vol, .status-day"));
    const legend = Array.from(host.querySelectorAll(".chart-overlays > div:first-child .lg-row, .chart-overlays > div:first-child .lg-collapse"))
      .find((el) => el.getBoundingClientRect().width > 0);
    const fullscreen = document.querySelector(".chart-fs-float");
    const controls = Array.from(host.querySelectorAll("[data-visual-context] > button, .mm-ptag, .mm-hovertag"));
    const chips = Array.from(line.querySelectorAll(".mm")).filter((el) => el.getBoundingClientRect().width > 0);
    return {
      host: rect(host), line: rect(line), badge: rect(chip),
      values: values.map((el) => ({ text: el.textContent, ...rect(el) })),
      renderers: Array.from(host.querySelectorAll("canvas, table")).map(rect),
      legend: legend ? rect(legend) : null,
      fullscreen: fullscreen ? rect(fullscreen) : null,
      controls: controls.map(rect).filter((r) => r.width > 0 && r.height > 0),
      chips: chips.map(rect),
      viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  await test.info().attach("statusline-geometry", { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
  expect(geometry.overflow).toBe(false);
  for (const box of [geometry.line, ...geometry.chips, ...geometry.values]) {
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(box.left).toBeGreaterThanOrEqual(Math.max(0, geometry.host.left) - 1);
    expect(box.right).toBeLessThanOrEqual(Math.min(geometry.viewport.width, geometry.host.right) + 1);
    expect(box.top).toBeGreaterThanOrEqual(geometry.host.top - 1);
    expect(box.bottom).toBeLessThanOrEqual(Math.min(geometry.viewport.height, geometry.host.bottom) + 1);
  }
  for (const renderer of geometry.renderers) expect(renderer.width).toBeLessThanOrEqual(geometry.host.width + 1);
  for (const selector of [".status-ohlc", ".status-vol", ".status-day"]) {
    await expect(wrap.locator(selector)).toBeVisible();
    await expect(wrap.locator(selector)).toContainText(/\d/);
  }
  expect(geometry.legend, "the indicator legend must remain reachable").not.toBeNull();
  if (geometry.legend) expect(geometry.legend.top).toBeGreaterThanOrEqual(geometry.line.bottom - 1);
  if (geometry.fullscreen?.width) {
    const overlap = Math.max(0, Math.min(geometry.fullscreen.right, geometry.badge.right) - Math.max(geometry.fullscreen.left, geometry.badge.left))
      * Math.max(0, Math.min(geometry.fullscreen.bottom, geometry.badge.bottom) - Math.max(geometry.fullscreen.top, geometry.badge.top));
    expect(overlap, "fullscreen must not cover the Replay chip").toBe(0);
  }
  if (geometry.viewport.width <= 640) for (const control of geometry.controls) {
    // The header has transparent padding; check its painted fields and chips.
    for (const box of [...geometry.chips, ...geometry.values]) {
      const overlap = Math.max(0, Math.min(control.right, box.right) - Math.max(control.left, box.left))
        * Math.max(0, Math.min(control.bottom, box.bottom) - Math.max(control.top, box.top));
      expect(overlap, "phone status must clear chart controls and price labels").toBe(0);
    }
  }
}

// Terminal's product surface is dark; the account's light preference belongs to Macro.
for (const appearance of [{ lang: "en", theme: "dark" }, { lang: "zh", theme: "dark" }] as const) {
  test(`Replay status stays readable inside its chart (${appearance.lang}, ${appearance.theme})`, async ({ page }) => {
    test.slow();
    await page.addInitScript(({ lang, theme }) => {
      localStorage.setItem("mm.lang", lang);
      localStorage.setItem("theme", theme);
      localStorage.setItem("theme_auto", "0");
      localStorage.setItem("mm.startTf", JSON.stringify("3D"));
      localStorage.setItem("mm.chartSettings", JSON.stringify({ showLastDayChange: true, showVolume: true }));
      localStorage.setItem("mm.inds", JSON.stringify(["ema"]));
      localStorage.setItem("mm.indHidden", JSON.stringify([]));
    }, appearance);
    await page.goto("/terminal?symbol=NVDA");
    await expect(page.locator("html")).toHaveAttribute("data-theme", appearance.theme);
    await expect(page.locator('[data-toolbar-action="replay"]')).toBeEnabled({ timeout: 45_000 });
    await toggleToolbarReplay(page);
    const rail = page.locator("[data-replay-rail]");
    await expect(rail).toBeVisible();
    const legendRow = page.locator(".chart-overlays > div:first-child .lg-row").first();
    if (!(await legendRow.isVisible())) await page.locator(".lg-collapse").first().click();
    await expect(legendRow).toBeVisible();
    await expectStatusWithinChart(page);
    const idxOf = async () => Number(await rail.getAttribute("data-replay-idx"));
    const start = await idxOf();
    // Transport labels are stable semantics within each locale.
    await rail.getByRole("button", { name: appearance.lang === "en" ? "Next bar" : "下一根K线", exact: true }).click();
    await expect.poll(idxOf).toBe(start + 1);
    await expectStatusWithinChart(page);
    await rail.getByRole("button", { name: appearance.lang === "en" ? "Previous bar" : "上一根K线", exact: true }).click();
    await expect.poll(idxOf).toBe(start);
    await expectStatusWithinChart(page);
    await test.info().attach("replay-status-restored", { body: await page.screenshot({ path: test.info().outputPath("replay-status-restored.png") }), contentType: "image/png" });
    if ((page.viewportSize()?.width ?? 1440) <= 640) {
      await page.locator(".chart-fs-float").click();
      await expect(page.locator(".app")).toHaveClass(/\bfs\b/);
      await expectStatusWithinChart(page);
      await test.info().attach("replay-status-fullscreen", { body: await page.screenshot({ path: test.info().outputPath("replay-status-fullscreen.png") }), contentType: "image/png" });
      await page.locator(".chart-fs-float").click();
      await expect(page.locator(".app")).not.toHaveClass(/\bfs\b/);
      await expectStatusWithinChart(page);
    }
    await toggleToolbarReplay(page);
    await expect(rail).toHaveCount(0);
  });
}
