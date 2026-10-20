import { expect, test, type Page } from "@playwright/test";

// Coherent synthetic books and price bars. These exercise product behavior, not
// provider qualification or production acceptance.
const SESSION = "2026-10-19";
const spots: Record<string, number> = { SPY: 752.35, QQQ: 627.8, IWM: 274.6, SPX: 7523.5 };
async function workspaceSource(page: Page, lang: "en" | "zh" = "en") {
  await page.addInitScript(locale => {
    localStorage.setItem("mm.lang", locale);
    Reflect.deleteProperty(window, "EventSource");
  }, lang);
  await page.route(url => url.pathname === "/api/flow", async route => {
    const feed = new URL(route.request().url()).searchParams.get("f") ?? "";
    const [kind, root] = feed.split(":");
    if (kind === "gexstate_index") return route.fulfill({ json: { asof: SESSION, rows: Object.fromEntries(Object.entries({ ...spots, FUTURE: 100 }).map(([r, spot], i) => [r, {
      asof: r === "FUTURE" ? "2099-01-04" : SESSION, gamma_regime: "RANGE", stability_pct: 68, net_gex_bn: i === 1 ? -2.4 : 3.6 + i,
      spot, call_wall: Math.ceil(spot) + 3, put_wall: Math.floor(spot) - 4, gamma_flip: Math.floor(spot) - 1,
    }])) } });
    if (kind === "quad") return route.fulfill({ json: { asof: SESSION, min_history_days: 20, pctile_window_days: 252, rows: [...Object.keys(spots), "FUTURE"].map((r, i) => ({
      root: r, asof: r === "FUTURE" ? "2099-01-04" : r === "SPY" ? "2026-09-01" : SESSION, gamma_pctile: r === "SPY" ? 99 : 78 - i * 8,
      vanna_pctile: 64, quadrant: "dampen_volsens", n_days: 180, since: "2026-01-02",
    })) } });
    if (!spots[root] || !["gex", "matrix"].includes(kind)) return route.continue();
    const spot = spots[root], step = root === "SPX" ? 10 : 1;
    const strikes = Array.from({ length: 29 }, (_, i) => Math.round(spot / step) * step + (i - 14) * step);
    const rows = strikes.map((strike, i) => {
      const call = 20 + 620 * Math.exp(-((i - 18) ** 2) / 16);
      const put = -(15 + 550 * Math.exp(-((i - 9) ** 2) / 12));
      return { strike, gamma_call: call, gamma_put: put, gamma_net: call + put,
        vanna_net: (call + put) * .32, charm_net: (put - call) * .09, delta_net: call * .7 };
    });
    if (kind === "gex") return route.fulfill({ json: {
      schema: "options_hub.gex/v1", root, asof: `${SESSION}T20:15:00Z`, spot_ref: spot,
      convention: "+call/-put assumed dealer inventory", by_strike_full_n: strikes.length,
      by_strike: rows, by_expiry: [{ exp: SESSION }, { exp: "2026-10-23" }],
      exposure_projection: { schema: "options_hub.exposure_projection/v2", root,
        clocks: { source_session: null }, cells_status: "source_unqualified", cells: [] },
    } });
    return route.fulfill({ json: { schema: "options_structure.matrix/v1", root,
      asof: `${SESSION}T20:16:00Z`, _build_meta: { asof_date: SESSION }, strikes, expiries: [SESSION, "2026-10-23"],
      cells: rows.flatMap(row => [{ strike: row.strike, expiry: SESSION, gex: row.gamma_net * .65e6 },
        { strike: row.strike, expiry: "2026-10-23", gex: row.gamma_net * .35e6 }]),
    } });
  });
  await page.route(url => url.pathname === "/api/intraday", route => {
    const url = new URL(route.request().url()), root = url.searchParams.get("sym") ?? "SPY";
    const spot = spots[root] ?? spots.SPY;
    const bars = Array.from({ length: 78 }, (_, i) => {
      const close = spot - 2.5 + i * .035 + Math.sin(i * .25) * 1.15;
      const open = close - Math.cos(i * .4) * .3;
      return [Date.parse(`${SESSION}T09:30:00Z`) / 1000 + i * 300, open, Math.max(open, close) + .25, Math.min(open, close) - .3, close, 600000 + i * 1100];
    });
    return route.fulfill({ json: { t: root, tf: url.searchParams.get("tf"), bars, source: "fixture" } });
  });
}

for (const lang of ["en", "zh"] as const) {
  test(`Connected exposure workspace ${lang}: chart, comparison scopes, scanner and return`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await workspaceSource(page, lang);
    await page.goto("/options?tab=prism&symbol=SPY&view=chart");
    const map = page.getByTestId("exposure-map");
    await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
    await expect(map.getByRole("button", { name: lang === "en" ? /Largest covered net node/ : /覆盖范围最大净节点/ })).toBeEnabled();
    await map.getByRole("button", { name: lang === "en" ? "Gamma + Vanna layers" : "Gamma + Vanna 双层", exact: true }).click();
    await expect(map.getByText(lang === "en" ? /Dual layers: solid Gamma/ : /双层视图：/)).toBeVisible();
    if (info.project.name === "mobile") expect((await map.locator(".chart-wrap canvas").first().boundingBox())!.y).toBeLessThan(700);
    for (const theme of ["dark", "light"]) {
      await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
      await page.screenshot({ path: `test-results/exposure-workspace-${info.project.name}-${lang}-${theme}.png` });
    }
    await map.getByRole("button", { name: lang === "en" ? "Compare" : "多市场对比", exact: true }).click();
    const board = page.getByTestId("exposure-board");
    await expect(board.getByTestId("exposure-market-4").locator('[data-leader="true"]')).toBeVisible();
    await board.getByLabel(lang === "en" ? "Shared expiration scope" : "统一到期范围").selectOption("zero");
    const first = board.getByTestId("exposure-market-1"), second = board.getByTestId("exposure-market-2");
    await first.getByLabel(lang === "en" ? "Expiration scope 1" : "到期范围 1").selectOption("2026-10-23");
    await expect(second.getByLabel(lang === "en" ? "Expiration scope 2" : "到期范围 2")).toHaveValue("zero");
    // A Gamma-only matrix must not masquerade as an exact-expiry Vanna book.
    await board.getByRole("button", { name: "Vanna", exact: true }).click();
    await expect(first.getByText(lang === "en" ? "Metric unavailable" : "此指标不可用")).toBeVisible();
    await board.getByLabel(lang === "en" ? "Shared expiration scope" : "统一到期范围").selectOption("all");
    await expect(first.locator('[data-leader="true"]')).toBeVisible();
    await page.screenshot({ path: `test-results/exposure-comparison-${info.project.name}-${lang}.png` });
    await map.getByRole("button", { name: lang === "en" ? "Scanner" : "扫描", exact: true }).click();
    const scanner = page.getByTestId("exposure-scanner");
    await expect(scanner.locator("tbody tr")).toHaveCount(4);
    await expect(scanner.getByRole("status")).toContainText(lang === "en" ? "1 instruments withheld" : "1 个标的");
    await expect(scanner.getByRole("button", { name: "FUTURE ↗", exact: true })).toHaveCount(0);
    const spy = scanner.getByRole("row").filter({ has: page.getByRole("button", { name: "SPY ↗", exact: true }) });
    await expect(spy.locator("td").nth(6)).toHaveText("—"); // September rank cannot join October book.
    await scanner.getByLabel(lang === "en" ? "Gamma sign" : "Gamma 正负").selectOption("negative");
    await expect(scanner.locator("tbody tr")).toHaveCount(1);
    await expect(scanner.getByRole("button", { name: "QQQ ↗", exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/exposure-scanner-${info.project.name}-${lang}.png` });
    await scanner.getByRole("button", { name: "QQQ ↗", exact: true }).click();
    await expect(map).toHaveAttribute("data-source-root", "QQQ");
    await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}
