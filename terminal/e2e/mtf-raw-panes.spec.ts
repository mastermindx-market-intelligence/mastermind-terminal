import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { momentumPoints } from "../lib/mtfMomentum";
import { openIndicatorLibrary } from "./phoneChrome";

// Synthetic, pre-holdout fixture: no market-performance evidence or current prices.
const dates: string[] = [];
for (const d = new Date("2025-12-30T00:00:00Z"); dates.length < 2401; d.setUTCDate(d.getUTCDate() - 1)) {
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.unshift(d.toISOString().slice(0, 10));
}
const BARS = dates.map((date, i) => {
  const c = 100 + i * .008 + 9 * Math.sin(i / 31) + 4 * Math.cos(i / 7);
  return [date, c - .3, c + 2, c - 2, c, 1_000_000] as [string, number, number, number, number, number];
});
const POINTS = momentumPoints(BARS.map((b) => ({ h: b[2], l: b[3], c: b[4] })));
const LAST = dates.at(-1)!;
const KEYS = ["mtfstoch", "mtfmacd", "mtfconfluence"];
const names = { mtfstoch: "MTF Stochastic (HLC)", mtfmacd: "MTF MACD-RSI", mtfconfluence: "MTF Momentum Confluence" };
type Phase = { live: boolean; price: number; session: "rth" | "post"; minute: number };
const witness = (page: Page) => page.evaluate(() => (window as any).__mmLiveBarGeneration?.() ?? null);
const panes = (page: Page) => page.evaluate(() => (window as any).__mmChartAxisOpts?.()?.paneTickMarkDensity?.length ?? 0);
const titles = (page: Page) => page.evaluate(() => (window as any).__mmChartSeriesTitles?.() ?? []);

async function setup(page: Page, keys = KEYS, params: Record<string, any> = {}, getPhase?: () => Phase, zh = false) {
  await page.route("**/data/NVDA.json", (route) => route.fulfill({ json: {
    t: "NVDA", o: 1, src: "synthetic_mtf_browser_fixture", bar_quality: "real_ohlc", bars: BARS,
    session_anchor: { v: 1, date: dates[0], index: 0, basis: "feed" },
  } }));
  await page.route("**/data/NVDA.slice.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/api/quote?**", (route) => {
    const phase = getPhase?.() ?? { live: false, price: BARS.at(-1)![4], session: "post", minute: 0 };
    const ts = Date.parse(`${LAST}T${phase.session === "post" ? "22" : "18"}:${String(phase.minute).padStart(2, "0")}:00Z`) / 1000;
    return route.fulfill({ json: { quotes: { NVDA: {
      sym: "NVDA", market: "us", basis: phase.live ? "REALTIME" : "EOD", live: phase.live,
      last: phase.price, prevClose: BARS.at(-2)![4], chg: 1, open: BARS.at(-1)![1],
      high: Math.max(phase.price, BARS.at(-1)![2]), low: Math.min(phase.price, BARS.at(-1)![3]),
      vol: 1_000_000, ts, asOfMs: ts * 1000, lagMs: 0,
      marketSession: phase.session, regularSession: phase.session, regularSessionDate: LAST,
      regularPrice: phase.price, regularChg: 1,
    } } } });
  });
  await page.addInitScript(({ keys, params, zh }) => {
    // The one-time seed deliberately does not overwrite later user settings on reload.
    if (!sessionStorage.getItem("mtf-test-seeded")) {
      localStorage.setItem("mm.startTf", JSON.stringify("D"));
      localStorage.setItem("mm.inds", JSON.stringify(keys));
      localStorage.setItem("mm.indParams", JSON.stringify(params));
      localStorage.setItem("mm.indHidden", "[]");
      localStorage.setItem("mm.mastermindCandles.v1", "1");
      localStorage.removeItem("mm.ws");
      if (zh) localStorage.setItem("mm.lang", "zh");
      sessionStorage.setItem("mtf-test-seeded", "1");
    }
  }, { keys, params, zh });
}

async function ready(page: Page, keys = KEYS) {
  await expect.poll(async () => {
    const w = await witness(page);
    return !!w && w.barCount === BARS.length && keys.every((k) => w.series[k]?.[0]?.value != null);
  }, { timeout: 30_000, message: "raw oscillators must reach their actual owned canvas series" }).toBe(true);
  return witness(page);
}

async function settings(page: Page, label: string) {
  const expand = page.getByTitle("Show indicator list", { exact: true });
  if (await expand.isVisible()) await expand.click();
  const row = page.locator(".lg-row").filter({ hasText: label }).first();
  await row.locator(".lg-name").click(); // Touch arms; desktop leaves the row unchanged.
  await row.hover();
  await row.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: label, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function capture(page: Page, file: string) {
  const dir = path.resolve("docs/pr-crops/mtf-raw-panes");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, file) });
}

test("raw panes plot five warmed native horizons separately from the composite", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  await page.goto("/terminal?symbol=NVDA");
  const w = await ready(page);
  expect(await panes(page)).toBe(4);
  for (const key of KEYS) {
    expect(w.series[key]).toHaveLength(5);
    expect(w.series[key].every((p: any) => p?.value != null)).toBe(true);
    expect(w.projection[key]).toBe("closed-bar-series");
  }
  expect(w.series.mtfstoch[0].value).toBeCloseTo(POINTS.at(-1)!.stochK!, 8);
  expect(w.series.mtfmacd[0].value).toBeCloseTo(POINTS.at(-1)!.rsiMacd!, 8);
  expect(w.series.mtfconfluence[0].value).toBeCloseTo(POINTS.at(-1)!.score!, 8);
  expect(await titles(page)).toEqual(expect.arrayContaining(["D %K", "1M %K", "D MACD-RSI", "1M MACD-RSI", "D", "1M"]));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await capture(page, `${info.project.name}-raw.png`);
  expect(errors).toEqual([]);
});

test("native settings change horizons and dashed signal lines, persist, and support all-off", async ({ page }, info) => {
  test.slow();
  await setup(page, ["mtfstoch"]);
  await page.goto("/terminal?symbol=NVDA");
  await ready(page, ["mtfstoch"]);
  let dialog = await settings(page, names.mtfstoch);
  await dialog.getByRole("switch", { name: "Show %D (dashed)", exact: true }).click();
  await expect.poll(async () => (await witness(page))?.series.mtfstoch?.length).toBe(10);
  await dialog.getByRole("switch", { name: "1M", exact: true }).click();
  await expect.poll(async () => (await witness(page))?.series.mtfstoch?.length).toBe(8);
  await capture(page, `${info.project.name}-settings.png`);
  await dialog.getByLabel("Close", { exact: true }).click();
  await page.reload(); // Intentional persisted-settings proof, never a readiness workaround.
  await ready(page, ["mtfstoch"]);
  expect((await witness(page)).series.mtfstoch).toHaveLength(8);
  expect(await titles(page)).not.toContain("1M %K");
  dialog = await settings(page, names.mtfstoch);
  for (const tf of ["D", "3D", "W", "2W"]) await dialog.getByRole("switch", { name: tf, exact: true }).click();
  await expect(page.locator(".lg-name").filter({ hasText: "Select a timeframe in settings" })).toBeVisible();
  expect(await titles(page)).not.toContain("D %K");
  expect((await witness(page)).series.mtfstoch).toEqual([null]);
  expect(await panes(page)).toBe(2);
  await dialog.getByRole("switch", { name: "W", exact: true }).press("Enter");
  await expect.poll(async () => (await witness(page))?.series.mtfstoch?.length).toBe(2);
  expect(await titles(page)).toEqual(expect.arrayContaining(["W %K", "W %D"]));
});

test("post-load add, insert-between, removal and re-add do not leak raw series or panes", async ({ page }) => {
  test.slow();
  await setup(page, ["mtfconfluence"]);
  await page.goto("/terminal?symbol=NVDA");
  await ready(page, ["mtfconfluence"]);
  await openIndicatorLibrary(page);
  const lib = page.locator(".imodal-library"), search = lib.getByRole("searchbox");
  for (const key of ["mtfmacd", "mtfstoch"] as const) {
    await search.fill(names[key]);
    await lib.getByRole("switch", { name: names[key], exact: true }).click();
  }
  await ready(page);
  expect(await panes(page)).toBe(4);
  for (let i = 0; i < 2; i++) {
    await search.fill(names.mtfstoch);
    const toggle = lib.getByRole("switch", { name: names.mtfstoch, exact: true });
    await toggle.click();
    await expect.poll(() => panes(page)).toBe(3);
    await toggle.click();
    await ready(page);
    expect(await panes(page)).toBe(4);
    expect((await witness(page)).series.mtfstoch).toHaveLength(5);
  }
});

test("raw closed values stay fixed during forming ticks and advance at explicit US completion", async ({ page }) => {
  test.slow();
  let phase: Phase = { live: true, price: BARS.at(-1)![4] + .5, session: "rth", minute: 0 };
  await setup(page, KEYS, { mtfstoch: { showSignal: true }, mtfmacd: { showSignal: true } }, () => phase);
  await page.goto("/terminal?symbol=NVDA");
  await ready(page);
  await expect.poll(async () => (await witness(page))?.priceTail?.value, { timeout: 30_000 }).toBe(phase.price);
  const before = await witness(page);
  phase = { ...phase, price: phase.price * 1.25, minute: 1 };
  await expect.poll(async () => (await witness(page))?.priceTail?.value, { timeout: 30_000 }).toBe(phase.price);
  const developing = await witness(page);
  for (const key of KEYS) expect(developing.series[key]).toEqual(before.series[key]);
  phase = { ...phase, session: "post", minute: 2 };
  await expect.poll(async () => (await witness(page))?.series.mtfstoch?.[0]?.value, { timeout: 30_000 })
    .not.toBe(before.series.mtfstoch[0].value);
  const closed = await witness(page);
  expect(closed.series.mtfstoch).toHaveLength(10);
  expect(closed.series.mtfmacd).toHaveLength(10);
  expect(closed.series.mtfmacd[0].value).not.toBe(before.series.mtfmacd[0].value);
  expect(await panes(page)).toBe(4);
});

test("raw pane labels and settings are bilingual without English-only legend fallback", async ({ page }, info) => {
  await setup(page, ["mtfstoch", "mtfmacd"], {}, undefined, true);
  await page.goto("/terminal?symbol=NVDA");
  await ready(page, ["mtfstoch", "mtfmacd"]);
  const expand = page.getByTitle("展开指标列表", { exact: true });
  if (await expand.isVisible()) await expand.click();
  const label = "多周期随机指标（高低收）";
  await expect(page.locator(".lg-name").filter({ hasText: label })).toBeVisible();
  await expect(page.locator(".lg-name").filter({ hasText: "多周期 MACD-RSI" })).toBeVisible();
  await expect(page.locator(".lg-name").filter({ hasText: "Closed bars" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await capture(page, `${info.project.name}-raw-zh.png`);
  const row = page.locator(".lg-row").filter({ hasText: label }).first();
  await row.locator(".lg-name").click();
  await row.hover();
  await row.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: label, exact: true });
  await expect(dialog.getByRole("switch", { name: "显示 %D（虚线）", exact: true })).toBeVisible();
  await capture(page, `${info.project.name}-settings-zh.png`);
});
