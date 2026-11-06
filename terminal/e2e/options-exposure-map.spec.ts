import { expect, test } from "@playwright/test";
import qualifiedFixture from "../lib/__tests__/fixtures/exposure-projection.json";

for (const lang of ["en", "zh"] as const) {
  test(`Exposure chart ${lang}: common chart, source selection, inspector and responsive layout`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((locale) => localStorage.setItem("mm.lang", locale), lang);
    await page.goto("/options?tab=prism&symbol=SPY&view=chart");
    const map = page.getByTestId("exposure-map");
    await expect(map).toBeVisible({ timeout: 30_000 });
    await expect(map).toHaveAttribute("data-source-root", "SPY");
    await expect(map.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 30_000 });
    await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
    const canvas = await map.locator(".chart-wrap canvas").first().elementHandle();
    const leader = map.getByRole("button", { name: lang === "en" ? /Largest covered net node/ : /覆盖范围最大净节点/ });
    await expect(leader).toBeEnabled(); await leader.click();
    const inspector = page.getByTestId("exposure-node-inspector");
    if ((page.viewportSize()?.width ?? 1440) <= 640) await expect(page.getByRole("dialog")).toBeFocused();
    else await expect(inspector).toBeFocused();
    const pin = inspector.getByRole("button", { name: lang === "en" ? "Pin reference on chart" : "在图表固定参考线", exact: true });
    await pin.click();
    if (info.project.name === "mobile") await page.screenshot({path:`test-results/exposure-inspector-mobile-${lang}.png`});
    await expect(inspector.getByRole("button", { name: lang === "en" ? "Remove reference" : "移除参考线", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape"); await expect(leader).toBeFocused();
    await map.getByLabel(lang === "en" ? "Expiration scope" : "到期范围", { exact: true }).selectOption("zero");
    expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
    await expect(inspector.getByRole("button", { name: lang === "en" ? "Remove reference" : "移除参考线", exact: true })).toHaveCount(0);
    await map.getByRole("group", { name: lang === "en" ? "Exposure metric" : "敞口指标", exact: true }).getByRole("button", { name: /^Vanna/ }).click();
    await expect(map.getByLabel(lang === "en" ? "Expiration scope" : "到期范围", { exact: true })).toBeDisabled();
    await expect(map.getByTestId("exposure-divergence")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
      await expect(map).toHaveCSS("background-color", theme === "light" ? "rgb(247, 248, 250)" : "rgb(10, 11, 14)");
      expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
      await page.screenshot({ path: `test-results/exposure-map-${info.project.name}-${lang}-${theme}.png` });
    }
    expect(errors).toEqual([]);
  });
}

test("Exposure chart distinguishes source failure, recovers in place and fences root changes", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  // Exercise the incumbent polling fallback in a browser without SSE support.
  await page.addInitScript(() => { Reflect.deleteProperty(window, "EventSource"); });
  await page.route(url => url.pathname === "/api/flow/stream", route => route.abort("failed"));
  let status = 503;
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY", async route => {
    if (status !== 200) return route.fulfill({ status, json: { error: "controlled source failure" } });
    return route.fulfill({ json: { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-15", spot_ref: 100,
      by_strike: [], by_expiry: [], exposure_projection: qualifiedFixture } });
  });
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map = page.getByTestId("exposure-map"), leader = map.getByRole("button", { name: /Largest covered net node/ });
  await expect(map.getByText(/Exposure could not be read/)).toBeVisible({ timeout: 30_000 });
  await expect(leader).toBeDisabled();
  const canvas = await map.locator(".chart-wrap canvas").first().elementHandle();
  status = 200; await map.getByRole("button", { name: "Retry source read" }).click();
  await expect(leader).toBeEnabled({ timeout: 20_000 });
  await expect(leader).toContainText("5.00e-3");
  expect(await canvas!.evaluate(el => el.isConnected)).toBe(true);
  await leader.click(); await page.getByRole("button", { name: "Pin reference on chart", exact: true }).click();
  status = 403;
  await page.clock.fastForward(30_001);
  await expect(map.getByText(/Exposure could not be read/)).toBeVisible();
  await expect(leader).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove reference", exact: true })).toHaveCount(0);
  status = 200; await map.getByRole("button", { name: "Retry source read" }).click();
  await expect(leader).toBeEnabled();
  await map.getByRole("group", { name: "Exposure metric", exact: true }).getByRole("button", { name: /^Combined/ }).click();
  await expect(map.getByRole("button", { name: /Largest covered hedge-demand node/ })).toBeDisabled(); // explicit no-shock default
  await map.getByLabel("Spot change (%)").fill("1");
  await map.getByLabel("IV change (vol points)").fill("1");
  await map.getByLabel("Elapsed calendar days").fill("1");
  await expect(map.getByRole("button", { name: /Largest covered hedge-demand node/ })).toContainText("-4.50e-3");
  const root = map.getByLabel("Exposure symbol", {exact:true}); await root.fill("QQQ"); await root.press("Enter");
  await expect(map).toHaveAttribute("data-source-root", "QQQ");
  await expect(map.getByRole("button", { name: /Largest covered hedge-demand node/ })).toBeDisabled();
});

test("Exposure chart controls remain usable at 320px and 200 percent zoom", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "One explicit narrow/zoom viewport sequence");
  await page.addInitScript(() => localStorage.setItem("mm.lang", "zh"));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map = page.getByTestId("exposure-map"); await expect(map).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await map.getByRole("group", { name: "敞口指标", exact: true }).getByRole("button", { name: /^组合/ }).click();
  await map.getByLabel("现价变化 (%)").fill("1");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "test-results/exposure-map-200percent-zh.png" });
});

test("Dense exposure inspector records latency and retains the chart and source owner", async ({ page }, info) => {
  await page.addInitScript(() => { localStorage.setItem("mm.lang", "en"); Reflect.deleteProperty(window, "EventSource"); });
  const rows = Array.from({ length: 500 }, (_, i) => ({ strike: 500 + i, gamma_call: i + 1, gamma_put: -(i + 1) / 2, gamma_net: (i + 1) / 2, vanna_net: (i + 1) / 4 }));
  let sourceReads = 0;
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY", route => {
    sourceReads += 1;
    return route.fulfill({ json: { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-15", spot_ref: 750, by_strike: rows, by_strike_full_n: rows.length, by_expiry: [] } });
  });
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map = page.getByTestId("exposure-map");
  await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  await map.getByRole("button", {name:"Exact values", exact:true}).click();
  await expect(map.locator("tbody button")).toHaveCount(500);
  const canvas = await map.locator(".chart-wrap canvas").first().elementHandle();
  const canvasCount = await map.locator("canvas").count(), readsBefore = sourceReads;
  // Measure actual browser click -> rendered inspector -> next presentation frames.
  // No CI timing assertion: hosts vary. The pinned local result is the evidence.
  const sample = await map.evaluate(async section => {
    const values: number[] = [];
    const buttons = Array.from(section.querySelectorAll<HTMLButtonElement>("tbody button"));

    for (let i = 0; i < 25; i += 1) {
      const button = buttons[(i * 17) % buttons.length];
      const start = performance.now();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { observer.disconnect(); reject(new Error("inspector did not render")); }, 3000);
        const observer = new MutationObserver(() => {
          if (!document.querySelector('[data-testid="exposure-node-inspector"] h3')?.textContent?.endsWith(button.textContent!)) return;
          observer.disconnect(); clearTimeout(timer);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        button.click();
      });
      if (i >= 5) values.push(performance.now() - start);
    }
    values.sort((a, b) => a - b);
    return { samples: values.length, p50Ms: values[Math.floor(values.length / 2)], p95Ms: values[Math.ceil(values.length * .95) - 1], maxMs: values.at(-1), rows: buttons.length };
  });
  // The latency loop leaves a strike selected. On phones the inspector is a detented sheet whose
  // scrim covers the metric control, so release the selection first the way a reader would.
  if (info.project.name === "mobile") {
    await page.keyboard.press("Escape");
    await expect(page.locator(".msheet-scrim")).toHaveCount(0);
  }
  for (let i = 0; i < 5; i += 1) {
    await map.getByRole("group", { name: "Exposure metric", exact: true }).getByRole("button", { name: /^Vanna/ }).click();
    await map.getByRole("group", { name: "Exposure metric", exact: true }).getByRole("button", { name: /^Gamma/ }).click();
  }
  expect(await canvas!.evaluate(el => el.isConnected)).toBe(true);
  expect(await map.locator("canvas").count()).toBe(canvasCount);
  expect(sourceReads).toBe(readsBefore);
  const result = { ...sample, project: info.project.name, viewport: page.viewportSize(), sourceReads, canvasCount, evidence: "synthetic local browser; no heap or production acceptance claim" };
  console.log("EXPOSURE_INSPECTOR_METRICS", JSON.stringify(result));
  await info.attach("exposure-inspector-metrics", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
});

test("Exposure book anatomy offers the replay and review tabs", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map = page.getByTestId("exposure-map");
  await expect(map).toBeVisible({ timeout: 30_000 });
  const tabs = map.getByRole("button", { name: "Compare expiries", exact: true }).locator("..");
  await tabs.getByRole("button", { name: "Replay", exact: true }).click();
  const replay = map.locator("[data-replay-status]");
  await expect(replay).toHaveCount(1, { timeout: 30_000 });
  await expect(replay).not.toHaveAttribute("data-replay-status", "loading", { timeout: 30_000 });
  await tabs.getByRole("button", { name: "Review", exact: true }).click();
  await expect(map.locator("[data-review-status], [data-review-frames]")).toHaveCount(1, { timeout: 30_000 });
  await expect(map.locator("[data-review-frames='loading']")).toHaveCount(0, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("Exposure book anatomy offers the local scenario tab", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map = page.getByTestId("exposure-map");
  await expect(map).toBeVisible({ timeout: 30_000 });
  const tabs = map.getByRole("button", { name: "Compare expiries", exact: true }).locator("..");
  await tabs.getByRole("button", { name: "Scenario", exact: true }).click();
  const scenario = map.locator("[data-scenario-status]");
  await expect(scenario).toHaveCount(1, { timeout: 30_000 });
  await expect(scenario).toHaveAttribute("data-scenario-status", /^(ready|not-admitted|summary-unavailable)$/);
  expect(errors).toEqual([]);
});

test("Exposure book anatomy offers the surface tab", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map = page.getByTestId("exposure-map");
  await expect(map).toBeVisible({ timeout: 30_000 });
  const tabs = map.getByRole("button", { name: "Compare expiries", exact: true }).locator("..");
  await tabs.getByRole("button", { name: "Surface", exact: true }).click();
  const surface = map.locator("[data-surface-status]");
  await expect(surface).toHaveCount(1, { timeout: 30_000 });
  await expect(surface).toHaveAttribute("data-surface-status", /^(ready|empty-window|no-projection)$/);
  expect(errors).toEqual([]);
});

test("Discover board mounts the scan table beside the glance scanner", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map = page.getByTestId("exposure-map");
  await expect(map).toBeVisible({ timeout: 30_000 });
  await map.getByRole("button", { name: "Scanner", exact: true }).click();
  await expect(map.getByTestId("exposure-scanner")).toBeVisible();
  const table = map.getByTestId("exposure-scan-table");
  await expect(table).toBeVisible();
  const scan = table.locator("[data-scan-status]");
  await expect(scan).toHaveCount(1);
  // The first completed pass freezes as the original (rev 1); the denominator names scored and unscored presets, never "all scanned".
  await expect(scan).toHaveAttribute("data-scan-status", "ready", { timeout: 30_000 });
  await expect(scan).toHaveAttribute("data-scan-revision", "1");
  await expect(table.getByText(/\d+ presets · \d+ scored · \d+ unscored/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

for (const lang of ["en", "zh"] as const) {
  test(`Exposure Surface ${lang}: real keyboard handoff and connected focus return`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-14T20:00:00Z") });
    await page.addInitScript(locale => {
      localStorage.setItem("mm.lang", locale);
      Reflect.deleteProperty(window, "EventSource");
    }, lang);
    await page.route(url => url.pathname === "/api/flow/stream", route => route.abort("failed"));
    const projection = structuredClone(qualifiedFixture);
    const session = "2026-10-13", expiries = ["2026-10-16", "2026-10-23"];
    projection.clocks = { ...projection.clocks, source_session: session, oi_report_date: session,
      oi_available_at: `${session}T12:00:00Z`, option_observed_at: `${session}T19:00:00Z`,
      underlying_observed_at: `${session}T19:00:00Z`, greeks_available_at: `${session}T19:01:00Z`,
      available_at: `${session}T20:00:00Z` };
    const proto = projection.cells[0]!;
    projection.cells = expiries.map((expiry, index) => ({
      ...structuredClone(proto), expiry, strike: 100, economic_expiry_at: `${expiry}T20:00:00Z`,
      gamma: { ...proto.gamma, net: 100e6 * (index + 1), gross: 200e6 * (index + 1),
        known_net: 100e6 * (index + 1), known_gross: 200e6 * (index + 1),
        call: 150e6 * (index + 1), put: -50e6 * (index + 1) },
    }));
    projection.cell_count = projection.cells.length;
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY", route =>
      route.fulfill({ json: { schema: "options_hub.gex/v1", root: "SPY", asof: session, spot_ref: 100,
        by_strike: [{ strike: 100, gamma_net: 300e6 }], by_expiry: expiries.map(exp => ({ exp })),
        exposure_projection: projection } }));
    await page.goto("/options?tab=prism&symbol=SPY&view=chart");
    const map = page.getByTestId("exposure-map");
    await expect(map).toBeVisible({ timeout: 30_000 });
    const surfaceTab = map.getByRole("button", { name: lang === "en" ? "Surface" : "曲面", exact: true });
    const phone = (page.viewportSize()?.width ?? 1440) <= 640;
    for (const [action, activation, dismissal] of [
      ["open", "Enter", "escape"], ["pin", "Space", "close"],
      ["open", "Space", "close"], ["pin", "Enter", "escape"],
    ] as const) {
      await surfaceTab.focus(); await surfaceTab.press("Enter");
      const surface = map.locator("[data-surface-status]");
      await expect(surface).toHaveAttribute("data-surface-status", "ready");
      // Select an actual rendered cell, not a replacement button or a tolerated
      // empty/unqualified Surface state.
      await surface.locator('[data-surface-cell][data-strike="100"][data-expiry="2026-10-23"]').locator("polygon").last().click();
      const cellInspector = surface.getByTestId("surface-inspector");
      const button = cellInspector.getByRole("button", {
        name: action === "open" ? (lang === "en" ? "Open in Exposure ↗" : "在 Exposure 中打开 ↗")
          : (lang === "en" ? /^Pin / : /^固定 /),
        exact: action === "open",
      });
      await button.focus(); await expect(button).toBeFocused();
      await button.press(activation);
      await expect(surface).toHaveCount(0);
      const inspector = page.getByTestId("exposure-node-inspector");
      const dialog = page.getByRole("dialog");
      await expect(phone ? dialog : inspector).toBeFocused();
      await expect(phone ? dialog : inspector).toBeInViewport();
      await expect(map.getByLabel(lang === "en" ? "Expiration scope" : "到期范围", { exact: true })).toHaveValue("2026-10-23");
      await expect(inspector).toContainText("+200M");
      await expect(inspector).toContainText("400M");
      await expect(inspector).not.toContainText("+300M");
      if (action === "pin") await expect(inspector.getByRole("button", {
        name: lang === "en" ? "Remove reference" : "移除参考线", exact: true,
      })).toHaveAttribute("aria-pressed", "true");
      if (phone) {
        await page.keyboard.press("Shift+Tab");
        const last = await page.evaluateHandle(() => document.activeElement);
        expect(await dialog.evaluate((node, active) => node.contains(active), last)).toBe(true);
        await page.keyboard.press("Tab");
        const first = await page.evaluateHandle(() => document.activeElement);
        expect(await dialog.evaluate((node, active) => node.contains(active), first)).toBe(true);
        expect(await first.evaluate((node, other) => node !== other, last)).toBe(true);
        await page.keyboard.press("Shift+Tab");
        expect(await last.evaluate(node => node === document.activeElement)).toBe(true);
        await first.dispose(); await last.dispose();
      } else {
        await page.keyboard.press("Tab");
        expect(await inspector.evaluate(node => node.contains(document.activeElement))).toBe(true);
      }
      if (dismissal === "escape") await page.keyboard.press("Escape");
      else await inspector.getByRole("button", {
        name: lang === "en" ? "Close inspector" : "关闭详情", exact: true,
      }).click();
      await expect(surfaceTab).toBeFocused();
      expect(await surfaceTab.evaluate(node => node.isConnected)).toBe(true);
      if (phone) await expect(dialog).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
