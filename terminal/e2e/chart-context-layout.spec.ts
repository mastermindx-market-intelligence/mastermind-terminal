import { expect, test, type Page } from "@playwright/test";
import { openChartContext } from "./phoneChrome";

async function openWorkspace(page: Page, width = 520) {
  await page.addInitScript((value) => localStorage.setItem("mm.railW", String(value)), width);
  await page.goto("/terminal?symbol=NVDA");
  const panel = await openChartContext(page);
  await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return panel;
}
async function geometry(page: Page) {
  return page.evaluate(() => {
    const app = document.querySelector<HTMLElement>(".app")!;
    const grid = app.querySelector<HTMLElement>(".pane-grid")!;
    const rail = app.querySelector<HTMLElement>(":scope > .rail")!;
    const pane = grid.querySelector<HTMLElement>(".pane.on") ?? grid.querySelector<HTMLElement>(".pane")!;
    const diagnostics = (window as any).__mmChartAxisOpts?.();
    const plot = diagnostics?.pricePlotWidth;
    const g = grid.getBoundingClientRect(), r = rail.getBoundingClientRect();
    return { placement: app.dataset.railLayout, requested: Number(app.dataset.railRequested),
      railWidth: r.width, paneWidth: pane.getBoundingClientRect().width, plotWidth: plot,
      available: g.width + (app.dataset.railLayout === "below" ? 0 : r.width),
      hostWidth: diagnostics?.plotGeometry.hostWidth,
      axisWidth: diagnostics?.plotGeometry.engineWidth - plot,
      pageHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight,
      tracks: getComputedStyle(app).gridTemplateColumns.split(/\s+/).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      saved: localStorage.getItem("mm.railW"), range: (window as any).__mmChartAxisOpts?.()?.visibleRange };
  });
}

test.describe("adaptive chart workspace", () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop", "Explicit transition sequence; existing reader suites cover native coarse-pointer viewports."); });

  test("fits the actual plot, preserves preference and keeps the same chart and historical reader", async ({ page }, info) => {
    test.slow();
    const panel = await openWorkspace(page);
    const app = page.locator(".app");
    await expect(app).toHaveAttribute("data-rail-layout", "rail");
    await expect.poll(async () => (await geometry(page)).railWidth).toBe(520);
    await expect.poll(async () => (await geometry(page)).plotWidth).toBeGreaterThanOrEqual(640);
    await panel.locator('[data-context-focus="previous"]').click();
    await panel.locator('[data-context-focus="help"]').click();
    await panel.locator('[data-context-focus="help"]').focus();
    const selected = await panel.locator("[data-context-bar-time]").innerText();
    await page.evaluate(() => {
      (window as any).__d06Canvas = document.querySelector(".pane.on canvas") ?? document.querySelector(".pane canvas");
      (window as any).__d06Reader = document.querySelector("[data-context-reader]");
    });
    const before = await geometry(page);
    const observations = [before];
    for (const width of [1280, 1024, 861, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const placement = width < 1100 ? "below" : "rail";
      await expect(app).toHaveAttribute("data-rail-layout", placement);
      await expect(panel.locator("[data-context-bar-time]")).toHaveText(selected);
      await expect(panel.locator("details").nth(2)).toHaveAttribute("open", "");
      await expect(panel.locator('[data-context-focus="help"]')).toBeFocused();
      await expect.poll(async () => (await geometry(page)).overflow).toBe(0);
      if (placement === "rail") await expect.poll(async () => (await geometry(page)).plotWidth).toBeGreaterThanOrEqual(640);
      const observation = await geometry(page);
      expect(observation.pageHeight).toBeLessThanOrEqual(observation.viewportHeight);
      expect(observation.saved).toBe("520");
      expect(observation.requested).toBe(520);
      expect(observation.tracks).toBe(placement === "below" ? 2 : 3);
      expect(await page.evaluate(() => (window as any).__d06Canvas.isConnected && (window as any).__d06Reader === document.querySelector("[data-context-reader]"))).toBe(true);
      observations.push(observation);
      if (width === 1024) {
        const samples = await page.evaluate(async () => {
          const result: string[] = [];
          for (let frame = 0; frame < 45; frame++) {
            await new Promise(requestAnimationFrame);
            if (frame >= 15) result.push(document.querySelector<HTMLElement>(".app")!.dataset.railLayout!);
          }
          return result;
        });
        expect(new Set(samples).size).toBe(1);
        expect(samples[0]).toBe("below");
        const bounds = await page.evaluate(() => {
          const p = document.querySelector("[data-context-reader]")!.getBoundingClientRect();
          const c = document.querySelector(".chart-wrap")!.getBoundingClientRect();
          return { readerTop: p.top, chartBottom: c.bottom };
        });
        expect(bounds.readerTop).toBeGreaterThanOrEqual(bounds.chartBottom);
        await page.screenshot({ path: info.outputPath("workspace-1024-below.png"), fullPage: true });
      }
    }
    const after = await geometry(page);
    expect(after.railWidth).toBe(520);
    expect(after.range.from).toBeCloseTo(before.range.from, 1);
    expect(after.range.to).toBeCloseTo(before.range.to, 1);
    await info.attach("workspace-geometry", { body: Buffer.from(JSON.stringify(observations, null, 2)), contentType: "application/json" });
    await page.screenshot({ path: info.outputPath("workspace-1440-restored.png"), fullPage: true });
  });

  test("keyboard resize, reset, pointer cancellation and focus handoff use the existing width owner", async ({ page }, info) => {
    const panel = await openWorkspace(page, 360);
    const handle = page.getByRole("separator", { name: "Resize sidebar", exact: true });
    await expect(handle).toHaveAttribute("aria-valuenow", "360");
    await handle.focus();
    await page.evaluate(() => { (window as any).__d06LeakedKeys = []; window.addEventListener("keydown", (event) => (window as any).__d06LeakedKeys.push(event.key)); });
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "370");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "410");
    await page.keyboard.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", "300");
    await page.keyboard.press("End");
    const maximum = await handle.getAttribute("aria-valuemax");
    await expect(handle).toHaveAttribute("aria-valuenow", maximum!);
    expect(await page.evaluate(() => (window as any).__d06LeakedKeys.filter((key: string) => key !== "Shift"))).toEqual([]);
    await page.getByRole("button", { name: "Reset sidebar width", exact: true }).click();
    await expect(handle).toHaveAttribute("aria-valuenow", "360");
    expect(await page.evaluate(() => localStorage.getItem("mm.railW"))).toBe("360");

    await handle.focus(); await page.keyboard.press("End");
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow"))).toBeLessThan(Number(maximum));
    const fitted = Number(await handle.getAttribute("aria-valuenow"));
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + 80);
    await expect(handle).toHaveAttribute("aria-valuenow", String(fitted - 30));
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", String(fitted));
    expect(await page.evaluate(() => document.body.classList.contains("rail-resizing"))).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem("mm.railW"))).toBe(maximum);

    await handle.focus();
    await page.setViewportSize({ width: 1024, height: 600 });
    await expect(handle).toHaveCount(0);
    await expect(panel.locator('[data-context-focus="close"]')).toBeFocused();
    await expect(page.locator(".app")).toHaveAttribute("data-rail-layout", "below");
    await page.screenshot({ path: info.outputPath("workspace-short-height.png"), fullPage: true });
  });

  test("the reader focus action returns to the same workspace and selected facts", async ({ page }, info) => {
    const panel = await openWorkspace(page, 360);
    await panel.locator('[data-context-focus="previous"]').click();
    const selected = await panel.locator("[data-context-bar-time]").innerText();
    const focus = panel.locator('[data-context-focus="workspace"]');
    await focus.focus(); await page.keyboard.press("Enter");
    await expect(page.locator(".app")).toHaveClass(/fs/);
    await expect(focus).toHaveAccessibleName("Back to workspace");
    await expect(focus).toBeFocused();
    await expect(page.locator('[data-context-dock="inline"] [data-context-reader]')).toHaveCount(1);
    await expect(panel.locator("[data-context-bar-time]")).toHaveText(selected);
    const toolbar = page.getByTestId("drawing-toolbar");
    await page.getByTestId("drawing-favorites-toggle").focus();
    const toolbarBounds = await toolbar.evaluate((node) => {
      const a = node.getBoundingClientRect();
      const b = node.parentElement!.getBoundingClientRect();
      const control = document.activeElement!.getBoundingClientRect();
      return { bottom: a.bottom, chartBottom: b.bottom, controlBottom: control.bottom, scroll: node.scrollTop };
    });
    expect(toolbarBounds.bottom).toBeLessThanOrEqual(toolbarBounds.chartBottom + 1);
    expect(toolbarBounds.controlBottom).toBeLessThanOrEqual(toolbarBounds.bottom + 1);
    expect(toolbarBounds.scroll).toBeGreaterThan(0);
    await focus.focus();
    await page.screenshot({ path: info.outputPath("workspace-focused.png"), fullPage: true });
    await page.keyboard.press("Enter");
    await expect(page.locator(".app")).not.toHaveClass(/fs/);
    await expect(focus).toBeFocused();
    await expect(panel.locator("[data-context-bar-time]")).toHaveText(selected);
    await expect(page.locator('[data-context-dock="rail"] [data-context-reader]')).toHaveCount(1);
  });

  test("the minimum boundary and a changed pane grid requalify without resetting the workspace", async ({ page }, info) => {
    const panel = await openWorkspace(page, 520);
    await expect.poll(async () => (await geometry(page)).railWidth).toBe(520);
    const before = await geometry(page);
    const reservedInset = Math.ceil(before.paneWidth - before.hostWidth + before.axisWidth + 1);
    const minimum = Math.ceil(1440 - before.available + 640 + reservedInset + 300);
    await page.setViewportSize({ width: minimum, height: 900 });
    await expect(page.locator(".app")).toHaveAttribute("data-rail-layout", "rail");
    await expect.poll(async () => (await geometry(page)).plotWidth).toBe(640);
    await page.setViewportSize({ width: minimum - 1, height: 900 });
    await expect(page.locator(".app")).toHaveAttribute("data-rail-layout", "below");
    await expect.poll(async () => (await geometry(page)).plotWidth).toBeGreaterThan(640);
    const placements = await page.evaluate(async () => {
      const samples: string[] = [];
      for (let frame = 0; frame < 45; frame++) {
        await new Promise(requestAnimationFrame);
        samples.push(document.querySelector<HTMLElement>(".app")!.dataset.railLayout!);
      }
      return samples;
    });
    expect([...new Set(placements)]).toEqual(["below"]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(async () => (await geometry(page)).railWidth).toBe(520);
    const chooseGrid = async (n: number) => {
      await expect(page.locator(".chart-tabs[data-toolbar-mode]")).toHaveAttribute("data-toolbar-mode", n === 2 ? "overflow" : "full");
      const direct = page.locator('[data-toolbar-action="split"] button', { hasText: String(n) });
      if (await direct.isVisible()) await direct.click();
      else {
        await page.getByTestId("toolbar-more").click();
        await page.getByRole("group").filter({ has: page.getByRole("button", { name: "4", exact: true }) }).getByRole("button", { name: String(n), exact: true }).click();
      }
    };
    await chooseGrid(2);
    await expect(page.locator(".pane-grid>.pane")).toHaveCount(2);
    await expect(page.locator(".app")).toHaveAttribute("data-rail-layout", "below");
    await expect(panel).toHaveCount(1);
    await chooseGrid(1);
    await expect(page.locator(".pane-grid>.pane")).toHaveCount(1);
    await expect(page.locator(".app")).toHaveAttribute("data-rail-layout", "rail");
    await expect.poll(async () => (await geometry(page)).railWidth).toBe(520);
    expect(await page.evaluate(() => localStorage.getItem("mm.railW"))).toBe("520");
    await info.attach("boundary", { body: Buffer.from(JSON.stringify({ minimumDockViewport: minimum, atMinimumPlotWidth: 640 })), contentType: "application/json" });
  });
});
