import { expect, test, type Page } from "@playwright/test";
import { SUITE_META, suiteDefaults } from "../lib/suites/meta";
import type { NativeSuiteCapabilities } from "../lib/chartIndicatorParams";

// The model/script transport and OHLC are explicit fixtures. TerminalShell, Chart Bus,
// parameter storage, lazy suite computation, and SVG rendering are the real product.
const BRAIN_SCRIPT = "https://www.mastermind-x.com/mm_brain.js";
const fixtureBars = Array.from({ length: 420 }, (_, i) => {
  const c = 100 + i * 0.018 + Math.sin(i / 6) * 7 + Math.sin(i / 31) * 3;
  const o = c - Math.sin(i / 3);
  return [new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
    o, Math.max(o, c) + 1.2, Math.min(o, c) - 1.2, c, 100000 + i * 31];
});
const structureParams = suiteDefaults("structure");
for (const module of SUITE_META.structure.modules) structureParams[`${module.key}.on`] = false;
Object.assign(structureParams, { "sr.on": true, "sr.sensitivity": "low", "sr.minTouches": 2,
  "sr.bufferZone": false, "sr.labels": true });

type Mirror = { session?: { indicators?: Array<{ name: string; params?: Record<string, unknown> }>; capabilities?: { indicators?: string[]; native_parameters?: NativeSuiteCapabilities | null } }; acks?: Array<{ seq: number; ok: boolean; error?: string }> };
async function dispatch(page: Page, params: Record<string, unknown>, seq: number) {
  await page.evaluate(({ params, seq }) => {
    const host = window as Window & { MM_BRAIN_CFG?: { onCommand?: (command: unknown) => void } };
    if (!host.MM_BRAIN_CFG?.onCommand) throw new Error("The real Brain host callback is absent");
    host.MM_BRAIN_CFG.onCommand({ on: true, v: 2, batch_id: "cmx-native-suite-browser", seq,
      op: "chart.set_indicators", args: { indicators: [{ name: "structure", params }] } });
  }, { params, seq });
}

for (const lang of ["en", "zh"] as const) {
  test(`Brain native suite command renders and revises actual Smart S/R — ${lang}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const mirrors: Mirror[] = [];
    await page.route(BRAIN_SCRIPT, route => route.fulfill({ contentType: "application/javascript",
      body: "window.MMBrain={mounted:true,open(){},close(){},toggle(){}};" }));
    await page.route("**/api/brain/chart/state", async route => {
      mirrors.push(route.request().postDataJSON());
      await route.fulfill({ json: { ok: true } });
    });
    await page.route(/\/data\/NVDA\.json(?:\?.*)?$/, route => route.fulfill({ json: {
      t: "NVDA", o: 1, src: "cmx-synthetic-fixture", bar_quality: "real_ohlc", bars: fixtureBars,
    } }));
    await page.route(/\/data\/NVDA\.slice\.json(?:\?.*)?$/, route => route.fulfill({ json: {
      indicator: { state: { position_hint: "flat" }, signals: [], early_dots: [], warnings: [] },
      backtest: { metrics: {} },
    } }));
    await page.addInitScript(lang => {
      localStorage.setItem("mm.inds", "[]");
      localStorage.setItem("mm.indParams", JSON.stringify({ ema: { len: 37 } }));
      localStorage.setItem("mm.devTier", "pro");
      localStorage.setItem("mm.mastermindCandles.v1", "1");
      localStorage.setItem("mm.lang", lang);
      localStorage.setItem("mm.tf", JSON.stringify("D"));
      localStorage.setItem("mm.startTf", JSON.stringify("D"));
      const w = window as Window & { __cmxNativeReady?: boolean };
      w.__cmxNativeReady = false;
      window.addEventListener("mm:terminal-visual-ready", () => { w.__cmxNativeReady = true; });
    }, lang);
    await page.goto("/terminal?symbol=NVDA");
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __cmxNativeReady?: boolean }).__cmxNativeReady)), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => typeof (window as Window & { MM_BRAIN_CFG?: { onCommand?: unknown } }).MM_BRAIN_CFG?.onCommand), { timeout: 15_000 }).toBe("function");

    await dispatch(page, structureParams, 1);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.inds") || "[]")), { timeout: 15_000 }).toEqual(["structure"]);
    await expect.poll(() => mirrors.some(row => row.session?.capabilities?.indicators?.includes("structure")), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => mirrors.some(row => row.session?.capabilities?.native_parameters?.modules.some(m => m.id === "structure/sr")), {
      message: "the real chart-state POST must publish the native setting description", timeout: 10_000,
    }).toBe(true);
    const packet = mirrors.find(row => row.session?.capabilities?.native_parameters?.modules.some(m => m.id === "structure/sr"))!.session!.capabilities!.native_parameters!;
    expect(packet.authority).toBe("configuration_description_only");
    const sr = packet.modules.find(m => m.id === "structure/sr")!;
    expect(sr.parameters["sr.sensitivity"].enum).toEqual(["high", "medium", "low"]);
    expect(sr.parameters["sr.bufferZone"]).toEqual({ type: "boolean", default: false });
    expect(new TextEncoder().encode(JSON.stringify(packet)).byteLength).toBeLessThanOrEqual(4096);
    const tips = page.locator('svg [data-ic-tip^="sr-"]');
    // Native S/R chips intentionally hide below 2.5px/bar. Phone proof therefore
    // observes the actual price-level lines, not a label the renderer must suppress.
    const levels = page.locator('svg g[clip-path^="url(#ic-price-clip-"] > line');
    await expect.poll(() => levels.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    if (testInfo.project.name !== "mobile") await expect(tips.first()).toBeAttached();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mm.indParams") || "{}"));
    expect(saved.structure).toMatchObject(structureParams);
    expect(saved.ema).toMatchObject({ len: 37 });
    await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${lang}-native-sr.png`) });

    // An invalid enum rejects the complete change: no silent fallback and no native state loss.
    await dispatch(page, { "sr.sensitivity": "not-a-setting", "sr.on": false }, 2);
    await expect.poll(() => mirrors.flatMap(row => row.acks || []).find(ack => ack.seq === 2), { timeout: 10_000 }).toMatchObject({ ok: false, error: "invalid_native_setting" });
    await expect.poll(() => levels.count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mm.indParams") || "{}").structure)).toEqual(saved.structure);

    // A legitimate false switch removes the actual painted labels, while keeping the suite on.
    await dispatch(page, { "sr.labels": false }, 3);
    await expect(tips).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.indParams") || "{}").structure?.["sr.labels"])).toBe(false);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mm.inds") || "[]"))).toEqual(["structure"]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mm.indParams") || "{}").structure?.["sr.sensitivity"])).toBe("low");
    // Disabling the native module removes its real geometry at every viewport,
    // including narrow views where density correctly hid the label chips already.
    await dispatch(page, { "sr.on": false }, 4);
    await expect(levels).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.indParams") || "{}").structure?.["sr.on"])).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await testInfo.attach("native-suite-state-receipts", { body: JSON.stringify(mirrors), contentType: "application/json" });
  });
}
