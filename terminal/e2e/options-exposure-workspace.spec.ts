import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import observedWitness from "../lib/__tests__/fixtures/exposure-projection-observed-v2.json";
import oneSidedWitness from "../lib/__tests__/fixtures/exposure-projection-one-sided-v2.json";
import { reportedGammaBook, reportedGammaPriorWithoutOctober23 } from "../lib/__tests__/fixtures/reportedGammaBooks";
import { optionsT } from "../components/options-companion/optionsStrings";

// Coherent synthetic books and price bars. These exercise product behavior, not
// provider qualification or production acceptance.
const SESSION = "2026-10-19";
const spots: Record<string, number> = { SPY: 752.35, QQQ: 627.8, IWM: 274.6, SPX: 7523.5 };
test("Main chart rejects a book corrected during navigation", async ({ page }) => {
  await workspaceSource(page);
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY", async route => {
    const destination = new URL(route.request().frame().url()).pathname === "/terminal";
    await route.fulfill({ json: { root: "SPY", asof: SESSION, spot_ref: spots.SPY, by_strike: [
      { strike: 753, gamma_net: destination ? -190 : -200, gamma_call: 100, gamma_put: -300 },
    ] } });
  });
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map = page.getByTestId("exposure-map");
  await map.getByRole("button", { name: /Largest covered net node/ }).click();
  await page.getByTestId("exposure-node-inspector").getByRole("button", { name: "Open on main chart", exact: true }).click();
  const reference = page.getByTestId("exposure-chart-reference");
  await expect(reference).toHaveAttribute("data-state", "changed", { timeout: 30_000 });
  await expect(reference.getByRole("button", { name: "Remove reference", exact: true })).toHaveCount(0);
  await expect(reference.getByRole("link", { name: "Return to Exposure", exact: true })).toBeVisible();
});

async function workspaceSource(page: Page, lang: "en" | "zh" = "en", overrides: Record<string, number> = {}) {
  const prices = { ...spots, ...overrides };
  await page.addInitScript(locale => {
    localStorage.setItem("mm.lang", locale);
    Reflect.deleteProperty(window, "EventSource");
  }, lang);
  await page.route(url => url.pathname === "/api/flow", async route => {
    const feed = new URL(route.request().url()).searchParams.get("f") ?? "";
    const [kind, root, date] = feed.split(":");
    if (kind === "gex_dates" && prices[root]) return route.fulfill({ json: {root, dates:[SESSION,"2026-10-16","2026-10-15"], latest:SESSION} });
    if (kind === "gex_at" && prices[root]) return route.fulfill({ json: {
      schema:"options_hub.gex/v1",root,asof:"2026-10-16",spot_ref:prices[root]-2,
      by_strike:[{strike:Math.ceil(prices[root]),gamma_net:date === "2026-10-16" ? 88 : 77,gamma_call:100,gamma_put:-12}],
      by_expiry:[{exp:"2026-10-23"}],by_strike_full_n:1,
    } });
    if (kind === "gexstate_index") return route.fulfill({ json: { asof: SESSION, rows: Object.fromEntries(Object.entries({ ...prices, FUTURE: 100 }).map(([r, spot], i) => [r, {
      asof: r === "FUTURE" ? "2099-01-04" : SESSION, gamma_regime: "RANGE", stability_pct: 68, net_gex_bn: i === 1 ? -2.4 : 3.6 + i,
      spot, call_wall: Math.ceil(spot) + 3, put_wall: Math.floor(spot) - 4, gamma_flip: Math.floor(spot) - 1,
    }])) } });
    if (kind === "quad") return route.fulfill({ json: { asof: SESSION, min_history_days: 20, pctile_window_days: 252, rows: [...Object.keys(prices), "FUTURE"].map((r, i) => ({
      root: r, asof: r === "FUTURE" ? "2099-01-04" : r === "SPY" ? "2026-09-01" : SESSION, gamma_pctile: r === "SPY" ? 99 : 78 - i * 8,
      vanna_pctile: 64, quadrant: "dampen_volsens", n_days: 180, since: "2026-01-02",
    })) } });
    if (kind === "moves" && prices[root]) return route.fulfill({ json: { schema:"options_hub.moves/v1",root,asof:SESSION,spot_ref:prices[root],expected_move:{pct:1.96,band_mult:1.96,horizon_days:1} } });
    if (!prices[root] || !["gex", "matrix"].includes(kind)) return route.continue();
    const spot = prices[root], step = root === "SPX" ? 10 : 1;
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
    const spot = prices[root] ?? spots.SPY;
    const interval = url.searchParams.get("tf") === "30m" ? 1800 : url.searchParams.get("tf") === "2h" ? 7200 : 300;
    const bars = Array.from({ length: Math.ceil(23400 / interval) }, (_, i) => {
      const close = spot - 2.5 + i * .035 + Math.sin(i * .25) * 1.15;
      const open = close - Math.cos(i * .4) * .3;
      return [Date.parse(`${SESSION}T09:30:00Z`) / 1000 + i * interval, open, Math.max(open, close) + .25, Math.min(open, close) - .3, close, 600000 + i * 1100];
    });
    return route.fulfill({ json: { t: root, tf: url.searchParams.get("tf"), bars, source: "fixture" } });
  });
}

for (const lang of ["en", "zh"] as const) {
  for (const mismatch of ["scope", "definition"] as const) {
    test(`Withheld Gamma ${mismatch} ${lang} explains the admitted comparison boundary`, async ({ page }) => {
      await workspaceSource(page, lang, { SPY: 100 });
      const current = reportedGammaBook("2026-10-19");
      const previous = mismatch === "scope" ? reportedGammaPriorWithoutOctober23() : reportedGammaBook("2026-10-16", 2);
      if (mismatch === "definition") current.exposure_projection.greek_provenance.gamma.model_ref += "-different";
      await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY",
        route => route.fulfill({ json: current }));
      await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_dates:SPY",
        route => route.fulfill({ json: { root: "SPY", dates: ["2026-10-19", "2026-10-16"], latest: "2026-10-19" } }));
      await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_at:SPY:2026-10-16",
        route => route.fulfill({ json: previous }));
      await page.goto("/options?tab=prism&symbol=SPY&view=chart");
      const map = page.getByTestId("exposure-map");
      await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
      if (mismatch === "scope") await map.getByRole("combobox", { name: lang === "en" ? "Expiration scope" : "到期范围", exact: true }).selectOption("2026-10-23");
      await map.getByRole("button", { name: lang === "en" ? "Changes" : "变化", exact: true }).click();
      const memory = map.getByTestId("options-market-memory");
      await expect(memory).toHaveAttribute("data-memory-status", mismatch === "scope" ? "scope-unavailable" : "ready");
      await expect(memory.getByRole("status")).toHaveText(optionsT(lang)(mismatch === "scope" ? "memoryPriorScopeUnavailable" : "memoryDefinitionMismatch"));
      await expect(memory.getByTestId("options-memory-reported-change")).toHaveCount(0);
      await expect(memory).not.toContainText(optionsT(lang)("memoryArchiveMissing"));
      await expect(memory).not.toContainText("9.9B");
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  }

  test(`Source-relative zero Gamma ${lang} does not match rolling expiry identities`, async ({ page }) => {
    await workspaceSource(page, lang, { SPY: 100 });
    const current = reportedGammaBook("2026-10-19", 1, true), previous = reportedGammaBook("2026-10-16", 2, true);
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY",
      route => route.fulfill({ json: current }));
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_dates:SPY",
      route => route.fulfill({ json: { root: "SPY", dates: ["2026-10-19", "2026-10-16"], latest: "2026-10-19" } }));
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_at:SPY:2026-10-16",
      route => route.fulfill({ json: previous }));
    await page.goto("/options?tab=prism&symbol=SPY&view=chart");
    const map = page.getByTestId("exposure-map");
    await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
    await map.getByRole("combobox", { name: lang === "en" ? "Expiration scope" : "到期范围", exact: true }).selectOption("zero");
    await map.getByRole("button", { name: lang === "en" ? "Changes" : "变化", exact: true }).click();
    const memory = map.getByTestId("options-market-memory");
    await expect(memory).toHaveAttribute("data-memory-status", "ready");
    await expect(memory).toContainText(lang === "en" ? "SOURCE-SESSION 0DTE" : "各来源交易日 0DTE");
    await expect(memory.getByTestId("options-memory-reported-change")).toHaveCount(0);
    await expect(memory.getByRole("status")).toHaveText(optionsT(lang)("memoryNoZeroMatch"));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

  test(`Matched reported Gamma ${lang} separates contributions and source coverage`, async ({ page }, info) => {
    const currentPath = process.env.EXPOSURE_P09_CURRENT_WITNESS;
    const previousPath = process.env.EXPOSURE_P09_PREVIOUS_WITNESS;
    if (!!currentPath !== !!previousPath) throw Error("Both retained witnesses required");
    const rawCurrent = currentPath ? JSON.parse(readFileSync(currentPath, "utf8")) : reportedGammaBook("2026-10-19");
    const current = rawCurrent.exposure_projection ? rawCurrent : {
      schema: "options_hub.gex/v1", root: "SPY", asof: rawCurrent.clocks.source_session,
      by_strike: [], exposure_projection: rawCurrent,
    };
    const previous = previousPath ? JSON.parse(readFileSync(previousPath, "utf8")) : reportedGammaBook("2026-10-16", 2);
    const date = current.asof.slice(0, 10), previousDate = previous.asof.slice(0, 10);
    await workspaceSource(page, lang, { SPY: current.exposure_projection.underlying_reference?.value ?? 100 });
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY",
      route => route.fulfill({ json: current }));
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_dates:SPY",
      route => route.fulfill({ json: { root: "SPY", dates: [date, previousDate], latest: date } }));
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === `gex_at:SPY:${previousDate}`,
      route => route.fulfill({ json: previous }));
    await page.goto("/options?tab=prism&symbol=SPY&view=chart");
    const map = page.getByTestId("exposure-map");
    await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
    await map.getByRole("button", { name: lang === "en" ? "Changes" : "变化", exact: true }).click();
    const memory = map.getByTestId("options-market-memory");
    const matched = memory.getByTestId("options-memory-reported-change");
    await expect(matched).toBeVisible();
    await expect(matched).toContainText(lang === "en" ? "Matched reported contributions" : "匹配的已报告贡献");
    await expect(matched).toContainText(currentPath ? "20" : "119");
    await expect(matched).toContainText(currentPath ? "583.8M" : "10K");
    await expect(matched.getByText(optionsT(lang)("memoryMatchedPlain"), { exact: true })).toBeVisible();
    await expect(matched.getByText(optionsT(lang)("memoryGammaUnit"), { exact: true })).toBeVisible();
    await expect(memory).toContainText(lang === "en" ? "GAMMA" : "GAMMA");
    await expect(memory).not.toContainText("9.9B");
    await expect(memory.getByText(lang === "en" ? "Δ vs prior · —" : "较上一快照 Δ · —", { exact: true })).toHaveCount(2);
    await memory.screenshot({ path: `test-results/exposure-matched-gamma-${info.project.name}-${lang}.png` });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const details = memory.getByTestId("options-memory-details"), summary = details.locator("summary");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(memory.getByTestId("options-memory-measurement-basis")).not.toBeVisible();
    await summary.focus(); await expect(summary).toBeFocused(); await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(memory.getByTestId("options-memory-measurement-basis")).toBeVisible();
    await expect(details.getByText(optionsT(lang)("memoryReportedLimitsDetail"), { exact: true })).toBeVisible();
    await expect(details.getByText(optionsT(lang)("memorySignConvention"), { exact: true })).toBeVisible();
    await memory.screenshot({ path: `test-results/exposure-matched-gamma-expanded-${info.project.name}-${lang}.png` });
    await page.keyboard.press("Space"); await expect(details).not.toHaveAttribute("open", "");
    await expect(summary).toBeFocused();
    await map.getByRole("combobox", { name: lang === "en" ? "Expiration scope" : "到期范围", exact: true }).selectOption("2026-10-23");
    await expect(matched).toBeVisible();
    await expect(memory).toContainText("GAMMA · 2026-10-23");
  });

  test(`One observed side ${lang} remains a measured book through chart and return`, async ({ page }) => {
    await workspaceSource(page, lang, { SPY: 100 });
    let holdMatrix = false;
    let releaseMatrix: (() => void) | null = null;
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "matrix:SPY", async route => {
      if (holdMatrix) await new Promise<void>(resolve => { releaseMatrix = resolve; });
      await route.fallback();
    });
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY",
      route => route.fulfill({ json: { root: "SPY", asof: "2026-10-15", spot_ref: 100,
        by_strike: [], exposure_projection: oneSidedWitness } }));
    await page.goto("/options?tab=prism&symbol=SPY&view=chart");
    const map = page.getByTestId("exposure-map");
    await expect(map.getByTestId("exposure-partial-coverage")).toContainText("1 / 1");
    await expect(map).toContainText(lang === "en" ? "MEASURED NET · INCOMPLETE" : "已测净值 · 不完整");
    await map.getByRole("button", { name: new RegExp(lang === "en" ? "^Provisional net leader" : "^暂定净值主节点") }).click();
    await page.getByTestId("exposure-node-inspector").getByRole("button", {
      name: lang === "en" ? "Open on main chart" : "在主图表打开", exact: true,
    }).click();
    const reference = page.getByTestId("exposure-chart-reference");
    await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    holdMatrix = true;
    await reference.getByRole("link", { name: lang === "en" ? "Return to Exposure" : "返回敞口", exact: true }).click();
    await expect(map.getByTestId("exposure-return-check")).toHaveAttribute("data-state", "ready");
    // An unrelated matrix arrives only after the qualified book restored its
    // selection. Its arrival must not invalidate a source that never used it.
    await expect.poll(() => releaseMatrix !== null).toBe(true);
    const matrixResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get("f") === "matrix:SPY");
    releaseMatrix!();
    await matrixResponse;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(map.getByTestId("exposure-return-check")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("exposure-node-inspector")).toContainText(lang === "en" ? "Selected strike 100" : "所选行权价 100");
    await expect(map.getByTestId("exposure-partial-coverage")).toContainText("1 / 1");
    await expect(map).toContainText(lang === "en" ? "MEASURED NET · INCOMPLETE" : "已测净值 · 不完整");
  });

  for (const correction of [false, true]) {
    test(`Archived chart return ${lang} ${correction ? "withdraws a corrected selection" : "restores the same book and strike"}`, async ({ page }) => {
      await workspaceSource(page, lang);
      let corrected = false;
      await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_at:SPY:2026-10-16",
        route => route.fulfill({ json: {
          root: "SPY", asof: "2026-10-16", spot_ref: 750.35, by_expiry: [{ exp: "2026-10-23" }],
          by_strike: [{ strike: 753, gamma_net: corrected ? 99 : 88, gamma_call: 100, gamma_put: corrected ? -1 : -12 }],
          by_strike_full_n: 1,
        } }));
      await page.goto("/options?tab=prism&symbol=SPY&view=chart");
      const map = page.getByTestId("exposure-map");
      const stored = map.getByTestId("exposure-stored-snapshots");
      await stored.locator("summary").click();
      await stored.locator("select").selectOption("2026-10-16");
      await expect(map).toHaveAttribute("data-source-session", "2026-10-16");
      await map.getByRole("button", { name: lang === "en" ? /Largest covered net node/ : /覆盖范围最大净节点/ }).click();
      await page.getByTestId("exposure-node-inspector").getByRole("button", {
        name: lang === "en" ? "Open on main chart" : "在主图表打开", exact: true,
      }).click();
      const reference = page.getByTestId("exposure-chart-reference");
      await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      corrected = correction;
      await reference.getByRole("link", { name: lang === "en" ? "Return to Exposure" : "返回敞口", exact: true }).click();
      await expect(map).toHaveAttribute("data-source-session", "2026-10-16");
      await expect(map.getByTestId("exposure-return-check")).toHaveAttribute("data-state", correction ? "changed" : "ready");
      const inspector = page.getByTestId("exposure-node-inspector");
      if (correction) {
        await expect(inspector.getByRole("button", { name: lang === "en" ? "Open on main chart" : "在主图表打开", exact: true })).toHaveCount(0);
      } else {
        await expect(inspector).toContainText(lang === "en" ? "Selected strike 753" : "所选行权价 753");
        await expect(inspector).toContainText("+88M");
      }
    });
  }

  test(`Exposure selection opens the main chart ${lang} with the same book`, async ({ page }, info) => {
    await workspaceSource(page, lang);
    await page.goto("/options?tab=prism&symbol=SPY&view=chart");
    const map = page.getByTestId("exposure-map");
    await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
    await map.getByRole("button", { name: lang === "en" ? /Largest covered net node/ : /覆盖范围最大净节点/ }).click();
    await page.getByTestId("exposure-node-inspector").getByRole("button", { name: lang === "en" ? "Open on main chart" : "在主图表打开", exact: true }).click();
    await expect(page).toHaveURL(/\/terminal\?symbol=SPY#exposure=/);
    const reference = page.getByTestId("exposure-chart-reference");
    await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(reference.getByRole("button", { name: lang === "en" ? "Remove reference" : "移除参考线", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: `test-results/exposure-main-chart-${info.project.name}-${lang}.png` });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    // Wide desktop toolbars may fit every action. Exercise that focus path
    // deterministically in both languages; narrower projects retain More.
    if (info.project.name === "desktop") {
      await page.addStyleTag({ content: "[data-testid=toolbar-more], [data-testid=roller-more] { display: none !important; }" });
    }
    await reference.getByRole("button", { name: lang === "en" ? "Dismiss exposure reference" : "关闭敞口参考线" }).focus();
    await page.keyboard.press("Escape");
    await expect(reference).toHaveCount(0);
    await expect(page).toHaveURL(/\/terminal\?symbol=SPY$/);
    await expect(page.locator(info.project.name === "desktop"
      ? "[data-context-launcher]:visible"
      : "[data-testid=toolbar-more]:visible, [data-testid=roller-more]:visible").first()).toBeFocused();
  });

  test(`Partial observed exposure ${lang} preserves measured contributions`, async ({ page }, info) => {
    // CI uses the synthetic producer witness. A local retained native envelope
    // can exercise these same assertions without committing provider data.
    const native = process.env.EXPOSURE_NATIVE_WITNESS;
    const envelope = native ? JSON.parse(readFileSync(native, "utf8")) : {
      schema: "options_hub.gex/v1", root: "SPY", asof: observedWitness.clocks.source_session,
      spot_ref: 100, by_strike: [], exposure_projection: observedWitness,
    };
    const p = envelope.exposure_projection;
    const root = envelope.root;
    expect(["SPY", "QQQ"]).toContain(root);
    const qualified = p.metrics.gamma.qualified, missing = p.metrics.gamma.missing;
    await workspaceSource(page, lang, { [root]: p.underlying_reference?.value ?? envelope.spot_ref });
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === `gex:${root}`,
      route => route.fulfill({ json: envelope }));
    await page.goto(`/options?tab=prism&symbol=${root}&view=chart`);
    const map = page.getByTestId("exposure-map");
    await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
    await expect(map.getByTestId("exposure-partial-coverage")).toContainText(
      `${qualified.toLocaleString()} / ${(qualified + missing).toLocaleString()}`);
    await expect(map).toContainText(lang === "en" ? "MEASURED NET · INCOMPLETE" : "已测净值 · 不完整");
    const leader = map.getByRole("button", { name: new RegExp(lang === "en" ? "Provisional net leader" : "暂定净值主节点") }).first();
    await expect(leader).toBeEnabled();
    if (native && root === "SPY") await expect(leader).toContainText("765");
    await leader.click();
    await expect(page.getByTestId("exposure-node-inspector")).toBeVisible();
    await expect(page.getByTestId("exposure-node-inspector")).toContainText(lang === "en" ? "Measured contributions" : "已测贡献");
    await page.screenshot({ path: `test-results/exposure-partial-${info.project.name}-${lang}.png` });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByTestId("exposure-node-inspector").getByRole("button", {
      name: lang === "en" ? "Open on main chart" : "在主图表打开", exact: true,
    }).click();
    await expect(page).toHaveURL(new RegExp(`/terminal\\?symbol=${root}#exposure=`));
    const reference = page.getByTestId("exposure-chart-reference");
    await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(reference).toContainText(p.clocks.source_session);
    await expect(reference.getByRole("button", {
      name: lang === "en" ? "Remove reference" : "移除参考线", exact: true,
    })).toHaveAttribute("aria-pressed", "true");
    await reference.getByRole("link", {
      name: lang === "en" ? "Return to Exposure" : "返回敞口", exact: true,
    }).click();
    await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", root);
    await expect(page.getByTestId("exposure-partial-coverage")).toContainText(
      `${qualified.toLocaleString()} / ${(qualified + missing).toLocaleString()}`);
  });

  test(`Projected exposure memory ${lang} preserves measurements without a false delta`, async ({ page }, info) => {
    await workspaceSource(page, lang, { SPY: 100 });
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY",
      route => route.fulfill({ json: { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-15",
        spot_ref: 100, net_gex_bn: 9.9, by_strike: [{ strike: 100, gamma_net: 999 }],
        exposure_projection: oneSidedWitness } }));
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_dates:SPY",
      route => route.fulfill({ json: { root: "SPY", dates: ["2026-10-15", "2026-10-14"], latest: "2026-10-15" } }));
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_at:SPY:2026-10-14",
      route => route.fulfill({ json: { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-14",
        spot_ref: 99, net_gex_bn: .02, by_strike: [{ strike: 100, gamma_net: 20 }] } }));
    await page.goto("/options?tab=prism&symbol=SPY&view=chart");
    const map = page.getByTestId("exposure-map");
    await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
    await map.getByRole("button", { name: lang === "en" ? "Changes" : "变化", exact: true }).click();
    const memory = map.getByTestId("options-market-memory");
    await expect(memory).toHaveAttribute("data-memory-status", "ready");
    await expect(memory.getByRole("status")).toHaveText(optionsT(lang)("memoryMissingComparison"));
    await memory.getByTestId("options-memory-details").locator("summary").click();
    await expect(memory).toContainText("+20M → +10K");
    await expect(memory).not.toContainText("999M");
    await expect(memory).not.toContainText("9.9B");
    await expect(memory.getByTestId("options-memory-measurement-basis")).toContainText(optionsT(lang)("memorySeparateTotals"));
    await expect(memory.getByText(lang === "en" ? "Δ vs prior · —" : "较上一快照 Δ · —", { exact: true })).toHaveCount(2);
    await memory.screenshot({ path: `test-results/exposure-projected-memory-${info.project.name}-${lang}.png` });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

  test(`Archived exposure changes ${lang} compare the selected book`, async ({ page }, info) => {
    await workspaceSource(page, lang);
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_dates:SPY",
      route => route.fulfill({ json: { root: "SPY", dates: [SESSION, "2026-10-16", "2026-10-14"], latest: SESSION } }));
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_at:SPY:2026-10-14",
      route => route.fulfill({ json: { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-14",
        spot_ref: 749, net_gex_bn: .5, by_strike: [{ strike: 753, gamma_net: 22 }] } }));
    await page.goto("/options?tab=prism&symbol=SPY&view=chart");
    const map = page.getByTestId("exposure-map");
    await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
    const stored = map.getByTestId("exposure-stored-snapshots");
    await stored.locator("summary").click();
    await stored.locator("select").selectOption("2026-10-16");
    await expect(map).toHaveAttribute("data-source-session", "2026-10-16");
    await map.getByRole("button", { name: lang === "en" ? "Changes" : "变化", exact: true }).click();
    const memory = map.getByTestId("options-market-memory");
    await expect(memory).toHaveAttribute("data-memory-status", "ready");
    await expect(memory).toContainText("2026-10-14");
    await expect(memory).toContainText("2026-10-16");
    await expect(memory).toContainText("+22M → +88M");
    await expect(memory).not.toContainText(SESSION);
    await memory.screenshot({ path: `test-results/exposure-archive-memory-${info.project.name}-${lang}.png` });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

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
    if (info.project.name !== "mobile") await expect(map.getByTestId("exposure-implied-distance")).toContainText("0.49 σ");
    for (const theme of ["dark", "light"]) {
      await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
      await page.screenshot({ path: `test-results/exposure-workspace-${info.project.name}-${lang}-${theme}.png` });
    }
    const stored = map.getByTestId("exposure-stored-snapshots");
    await stored.locator("summary").click();
    const sessions = stored.locator("select");
    await sessions.selectOption("2026-10-16");
    await expect(map).toHaveAttribute("data-source-session", "2026-10-16");
    await expect(map.getByRole("button", {name:lang === "en" ? "Return to latest book" : "返回最新账簿",exact:true})).toBeVisible();
    await expect(map.getByTestId("exposure-implied-distance")).toHaveCount(info.project.name === "mobile" ? 0 : 1);
    if (info.project.name !== "mobile") await expect(map.getByTestId("exposure-implied-distance")).toContainText("—");
    // A wrong-date archive cannot wear the selected session's label or values.
    await sessions.selectOption("2026-10-15");
    await expect(map).toHaveAttribute("data-source-session", "");
    await map.getByRole("button", {name:lang === "en" ? "Return to latest book" : "返回最新账簿",exact:true}).click();
    await expect(map).toHaveAttribute("data-source-session",SESSION);
    await map.getByRole("button", { name: lang === "en" ? "Compare" : "多市场对比", exact: true }).click();
    const board = page.getByTestId("exposure-board");
    await expect(board.getByTestId("exposure-market-4").locator('[data-leader="true"]')).toBeVisible();
    await expect(board.locator('[data-testid="exposure-comparison-chart"][data-chart-ready="true"]')).toHaveCount(4,{timeout:30_000});
    for (const chart of await board.getByTestId("exposure-comparison-chart").all()) {
      expect((await chart.locator(".chart-wrap").boundingBox())!.height).toBeGreaterThan(200);
      expect((await chart.locator("canvas").first().boundingBox())!.height).toBeGreaterThan(150);
    }
    await board.getByLabel(lang === "en" ? "Shared chart timeframe" : "统一图表周期").selectOption("30m");
    await expect(board.locator('[data-testid="exposure-comparison-chart"][data-chart-ready="true"]')).toHaveCount(4,{timeout:30_000});
    await board.getByLabel(lang === "en" ? "Shared chart timeframe" : "统一图表周期").selectOption("5m");
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
    if (info.project.name === "desktop") {
      await board.getByRole("button",{name:lang === "en" ? "Full-screen comparison" : "全屏对比",exact:true}).click();
      await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute("data-testid"))).toBe("exposure-board");
      for (const pane of await board.locator('[data-testid^="exposure-market-"]').all()) {
        const bounds = (await pane.boundingBox())!;
        expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y+bounds.height).toBeLessThanOrEqual(901);
        expect((await pane.locator(".chart-wrap canvas").first().boundingBox())!.height).toBeGreaterThan(175);
      }
      await page.screenshot({path:`test-results/exposure-comparison-fullscreen-${lang}.png`});
      await board.getByRole("button",{name:lang === "en" ? "Exit full screen" : "退出全屏",exact:true}).click();
      await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    }
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
