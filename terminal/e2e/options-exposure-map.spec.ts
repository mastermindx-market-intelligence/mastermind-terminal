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
