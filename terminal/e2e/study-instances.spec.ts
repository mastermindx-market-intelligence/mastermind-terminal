import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { isPhoneViewport, openIndicatorLibrary } from "./phoneChrome";
import { useLang } from "./layoutStore";

// ── E06: independent instances of one built-in study ──────────────────────────────────────────────
//
// Two RSI instances on one chart must each own their params, pane, legend row, settings dialog,
// data-table column, saved record and chart resources. The aliasing failure this guards against is
// any one surface still addressing the study by its TYPE ("rsi"): the second pane would then draw
// the primary's length, the legend would show two "RSI" rows, the table would carry one column, or
// a reload/template would reset the sibling to the primary's settings.
//
// Values are proven off the real canvas series and the chart's readout map through the dev-only
// `__mmLiveBarGeneration` witness (a canvas screenshot cannot show an indicator value) and compared
// with a canonical Wilder RSI computed HERE from the fixture closes, independent of the app code.

const SYMBOL = "NVDA";
const LAST_SESSION = "2026-08-06";
const SIBLING_SEED = "rsi__e06seed01";

function sessionDates(count: number, lastISO: string): string[] {
  const out: string[] = [];
  const d = new Date(`${lastISO}T00:00:00Z`);
  while (out.length < count) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

const BARS = sessionDates(262, LAST_SESSION).map((date, i) => {
  // A wave plus drift with a short-period ripple, so RSI(7) and RSI(14) differ materially.
  const c = Number((120 + Math.sin(i / 9) * 8 + Math.sin(i / 2.3) * 1.7 + i * 0.04).toFixed(2));
  return [date, Number((c - 0.5).toFixed(2)), Number((c + 1.1).toFixed(2)), Number((c - 1.3).toFixed(2)), c, 1_000_000 + i * 1_000] as const;
});
const CLOSES = BARS.map((b) => b[4]);
const LAST_CLOSE = CLOSES[CLOSES.length - 1];

/** Textbook Wilder RSI: SMA seed over the first `n` changes, then (prev·(n−1) + x)/n smoothing. */
function wilderRsi(closes: number[], n: number): number {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const ch = closes[i] - closes[i - 1];
    gain += Math.max(ch, 0);
    loss += Math.max(-ch, 0);
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(ch, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-ch, 0)) / n;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

const RSI14 = wilderRsi(CLOSES, 14);
const RSI7 = wilderRsi(CLOSES, 7);
const RSI21 = wilderRsi(CLOSES, 21);

type SeriesTail = { time: unknown; value: number | null } | null;
type Witness = {
  barCount: number;
  lastBar: { time: string | number; c: number } | null;
  series: Record<string, SeriesTail[]>;
  indRow: Record<string, number | null> | null;
};
type Census = { orphanSeries: number; trackedSeries: number; live: { panes: number; series: number }; owned: { indicators: number }; paneMeta: number };

const readWitness = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mmLiveBarGeneration?: () => Witness }).__mmLiveBarGeneration?.() ?? null);
const readCensus = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mmChartOwnership?: () => Census }).__mmChartOwnership?.() ?? null);
const readStore = (page: Page) =>
  page.evaluate(() => {
    const parse = (k: string) => { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } };
    return { inds: parse("mm.inds") as string[] | null, params: parse("mm.indParams") as Record<string, Record<string, unknown>> | null, hidden: parse("mm.indHidden") as string[] | null };
  });

const rsiIds = (w: Witness | null) => Object.keys(w?.series ?? {}).filter((k) => k === "rsi" || k.startsWith("rsi__")).sort();
const tailOf = (w: Witness | null, id: string) => w?.series[id]?.[0]?.value ?? null;
const near = (a: number | null | undefined, b: number, digits = 6) => a != null && Math.abs(a - b) < 10 ** -digits;

/** Route the daily fixture once; seed the device prefs ONCE per tab so a reload reads what the app saved. */
async function serveWorkspace(page: Page, inds: string[], params: Record<string, unknown> = {}) {
  await page.route(`**/data/${SYMBOL}.json`, (route) =>
    route.fulfill({ json: { t: SYMBOL, o: SYMBOL, src: "study-instances-e2e", bars: BARS } }));
  await page.route(`**/data/${SYMBOL}.slice.json`, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/api/quote?**", async (route) => {
    const syms = (new URL(route.request().url()).searchParams.get("syms") || SYMBOL).split(",").filter(Boolean);
    const seconds = Date.parse(`${LAST_SESSION}T15:00:00Z`) / 1000;
    await route.fulfill({ json: { quotes: Object.fromEntries(syms.map((sym) => [sym, sym === SYMBOL ? {
      sym, last: LAST_CLOSE, prevClose: LAST_CLOSE, chg: 0, open: LAST_CLOSE, high: LAST_CLOSE, low: LAST_CLOSE,
      vol: 12_345_678, ts: seconds, asOfMs: seconds * 1000, lagMs: 40, live: false, basis: "EOD", market: "us",
      marketSession: "rth", regularSessionDate: LAST_SESSION, regularSession: "rth", regularPrice: LAST_CLOSE, regularChg: 0,
    } : null])) } });
  });
  await page.addInitScript(([indicators, stored]) => {
    if (sessionStorage.getItem("e06.seeded") === "1") return;
    sessionStorage.setItem("e06.seeded", "1");
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
    localStorage.setItem("mm.inds", JSON.stringify(indicators));
    localStorage.setItem("mm.indParams", JSON.stringify(stored));
    localStorage.setItem("mm.indHidden", JSON.stringify([]));
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.removeItem("mm.chartTemplates");
    localStorage.removeItem("mm.ws");
  }, [inds, params] as [string[], Record<string, unknown>]);
}

/** Wait until exactly `count` RSI instances hold data on the canvas; returns the settled witness. */
async function settledRsi(page: Page, count: number, message: string): Promise<Witness> {
  await expect.poll(async () => {
    const w = await readWitness(page);
    if (!w || w.barCount !== BARS.length || w.lastBar?.c !== LAST_CLOSE) return "waiting";
    const ids = rsiIds(w);
    return ids.length === count && ids.every((id) => tailOf(w, id) != null) ? "ready" : `rsi=${ids.join("|")}`;
  }, { message, timeout: 60_000 }).toBe("ready");
  return (await readWitness(page))!;
}

const coarse = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 860;

async function legendRow(page: Page, label: string): Promise<Locator> {
  const row = page.locator(".lg-row").filter({ has: page.locator(".lg-name").getByText(label, { exact: true }) }).first();
  await expect.poll(() => row.count(), { message: `legend row "${label}" should exist`, timeout: 20_000 }).toBeGreaterThan(0);
  // Touch layouts start with the list minimized; open it only when its own toggle says it is closed.
  const toggle = page.locator(".lg-collapse").first();
  if (await toggle.count() && /^(Show indicator list|展开指标列表)$/.test((await toggle.getAttribute("title")) ?? "")) await toggle.click();
  await expect(row, `legend row "${label}"`).toBeVisible({ timeout: 20_000 });
  return row;
}

async function legendAction(page: Page, label: string, action: "Settings" | "Remove" | "Hide" | "Show") {
  const row = await legendRow(page, label);
  if (coarse(page)) {
    if (action === "Show" && await row.getByRole("button", { name: "Show", exact: true }).isVisible().catch(() => false)) {
      await row.getByRole("button", { name: "Show", exact: true }).click();
      return;
    }
    await row.locator(".lg-name").click();
    await expect(row).toHaveClass(/is-armed/);
  } else {
    await row.hover();
  }
  await row.getByRole("button", { name: action, exact: true }).click();
}

async function openLibrarySearch(page: Page) {
  await openIndicatorLibrary(page);
  const modal = page.locator(".imodal-library");
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await modal.getByRole("searchbox", { name: "Search indicators" }).fill("RSI");
  return modal;
}

async function closeLibrary(page: Page) {
  await page.locator(".imodal-library .im-close").click();
  await expect(page.locator(".imodal-library")).toHaveCount(0);
}

async function openChartMenu(page: Page) {
  const chart = page.locator(".chart-wrap").first();
  const bounds = await chart.boundingBox();
  expect(bounds).not.toBeNull();
  await chart.click({ button: "right", position: { x: Math.min(100, bounds!.width * 0.25), y: Math.min(160, bounds!.height * 0.3) } });
  await expect(page.locator(".ctx-menu")).toBeVisible();
}

async function crop(page: Page, name: string, projectName: string) {
  if (!process.env.TERMINAL_CROPS) return;
  mkdirSync("docs/pr-crops/e06-study-instances", { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `docs/pr-crops/e06-study-instances/${projectName}-${name}.png`, animations: "disabled" });
}

test("two RSI instances compute, label, edit, hide and reload independently", async ({ page }, testInfo) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    // The shared `useLang` init script also runs in frames with no documentElement yet; that is the
    // harness, not the app (its only frame is the anonymous init script). Every app error still fails.
    const harness = /^\s+at <anonymous>:\d+:\d+$/m.test(e.stack ?? "") && !/https?:\/\//.test(e.stack ?? "");
    if (!harness) errors.push(e.message);
  });
  await useLang(page, "en");
  await serveWorkspace(page, ["rsi"]);
  await page.goto(`/terminal?symbol=${SYMBOL}`);

  // A legacy single-RSI device state is exactly one instance, named exactly as before E06.
  const single = await settledRsi(page, 1, "the primary RSI should reach the canvas");
  expect(rsiIds(single)).toEqual(["rsi"]);
  expect(near(tailOf(single, "rsi"), RSI14)).toBe(true);
  await legendRow(page, "RSI");

  // ── add a second, independent instance from the library ──
  const modal = await openLibrarySearch(page);
  const add = modal.locator('[data-study-add-instance="rsi"]');
  await expect(add).toBeVisible();
  await expect(add).toContainText("Add another RSI");
  await expect(add).toContainText("1 of 4 on this chart");
  await add.click();
  await expect(add).toContainText("2 of 4 on this chart");
  await closeLibrary(page);

  const two = await settledRsi(page, 2, "the added RSI instance should get its own series");
  const sibling = rsiIds(two).find((id) => id !== "rsi")!;
  expect(sibling).toMatch(/^rsi__[a-z0-9]{4,16}$/);
  expect(near(tailOf(two, "rsi"), RSI14)).toBe(true);
  expect(near(tailOf(two, sibling), RSI14)).toBe(true);
  expect((await readStore(page)).params?.[sibling]?.length).toBe(14);

  // ── edit ONLY the sibling, through its own legend row and settings dialog ──
  await legendAction(page, "RSI 2 (14)", "Settings");
  const dialog = page.locator(".ind-set");
  await expect(dialog.locator("#indicator-settings-title")).toHaveText("RSI 2 (14)");
  const length = dialog.locator(".is-row").filter({ has: page.getByText("Length", { exact: true }) }).locator(".is-stepper input[type=number]");
  await length.fill("7");
  await expect(dialog.locator("#indicator-settings-title")).toHaveText("RSI 2 (7)");
  await dialog.getByRole("button", { name: "Ok", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await expect.poll(async () => {
    const w = await readWitness(page);
    return near(tailOf(w, sibling), RSI7) && near(tailOf(w, "rsi"), RSI14) ? "independent" : `${tailOf(w, "rsi")}|${tailOf(w, sibling)}`;
  }, { message: "the sibling should draw RSI(7) while the primary stays RSI(14)", timeout: 30_000 }).toBe("independent");
  const edited = (await readWitness(page))!;
  // The chart's readout map (Chart Table / visual intelligence) carries one value per instance id.
  expect(near(edited.indRow?.rsi, RSI14)).toBe(true);
  expect(near(edited.indRow?.[sibling], RSI7)).toBe(true);
  expect(Math.abs(RSI7 - RSI14)).toBeGreaterThan(0.5);   // the premise: the two lengths differ visibly
  await legendRow(page, "RSI 1 (14)");
  await legendRow(page, "RSI 2 (7)");
  const store = await readStore(page);
  expect(store.inds).toEqual(expect.arrayContaining(["rsi", sibling]));
  expect(store.params?.[sibling]?.length).toBe(7);
  expect(store.params?.rsi?.length ?? 14).toBe(14);
  await crop(page, "two-instances-en", testInfo.project.name);

  // ── hide ONLY the sibling ──
  await legendAction(page, "RSI 2 (7)", "Hide");
  await expect.poll(async () => (await readStore(page)).hidden ?? [], { timeout: 10_000 }).toEqual([sibling]);
  await expect(await legendRow(page, "RSI 2 (7)")).toHaveClass(/is-hidden/);
  await expect(await legendRow(page, "RSI 1 (14)")).not.toHaveClass(/is-hidden/);
  const hiddenW = (await readWitness(page))!;
  expect(near(tailOf(hiddenW, "rsi"), RSI14)).toBe(true);
  await legendAction(page, "RSI 2 (7)", "Show");
  await expect.poll(async () => (await readStore(page)).hidden ?? [], { timeout: 10_000 }).toEqual([]);

  // ── reload: each instance comes back with ITS OWN saved params ──
  await page.reload();
  const reloaded = await settledRsi(page, 2, "both instances should restore after reload");
  expect(rsiIds(reloaded)).toEqual(["rsi", sibling].sort());
  expect(near(tailOf(reloaded, "rsi"), RSI14)).toBe(true);
  expect(near(tailOf(reloaded, sibling), RSI7)).toBe(true);
  await legendRow(page, "RSI 2 (7)");
  expect(errors).toEqual([]);
});

test("table, CSV and templates carry each instance under its own column and record", async ({ page }) => {
  test.slow();
  await useLang(page, "en");
  // A device state written by this build (or a newer one): primary at 21, a sibling at 7.
  await serveWorkspace(page, ["rsi", SIBLING_SEED], { rsi: { length: 21 }, [SIBLING_SEED]: { length: 7 } });
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  const w = await settledRsi(page, 2, "both seeded instances should draw");
  expect(near(tailOf(w, "rsi"), RSI21)).toBe(true);
  expect(near(tailOf(w, SIBLING_SEED), RSI7)).toBe(true);

  // ── data inspector: one column per instance, headed by its own length ──
  await openChartMenu(page);
  await page.locator('.ctx-menu [data-a="tableview"]').click();
  const table = page.locator(".ctv-root");
  await expect(table).toBeVisible();
  await expect(table.locator(".ctv-th").filter({ hasText: /^RSI 1 \(21\)$/ })).toHaveCount(1);
  await expect(table.locator(".ctv-th").filter({ hasText: /^RSI 2 \(7\)$/ })).toHaveCount(1);
  const pending = page.waitForEvent("download");
  await table.getByRole("button", { name: "Download data", exact: true }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  const [header, ...rows] = readFileSync(path!, "utf8").trim().split("\n").map((line) => line.split(","));
  expect(rows[0][0]).toBe(LAST_SESSION);
  expect(Number(rows[0][header.indexOf("RSI 1 (21)")])).toBeCloseTo(RSI21, 3);
  expect(Number(rows[0][header.indexOf("RSI 2 (7)")])).toBeCloseTo(RSI7, 3);
  await table.getByRole("button", { name: "Back to chart" }).click();
  await expect(table).toHaveCount(0);

  // ── save the arrangement as a chart template ──
  await openChartMenu(page);
  await page.locator('.ctx-menu [data-a="tplmenu"]').click();
  await page.locator('.ctx-menu [data-a="savetemplate"]').click();
  const save = page.locator("[data-study-template-save]");
  await expect(save).toBeVisible();
  await save.getByRole("radio", { name: /^This device/ }).check();   // E07: the account is the signed-in default
  await save.locator("#study-template-name").fill("Two RSI");
  await save.getByRole("button", { name: "Save", exact: true }).click();
  await expect(save).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mm.chartTemplates") ?? "[]"));
  expect(saved).toHaveLength(1);
  expect(saved[0].indicators).toEqual(expect.arrayContaining(["rsi", "rsi__e06seed01"]));
  expect(saved[0].indParams["rsi__e06seed01"].length).toBe(7);

  // ── remove the sibling: its record retires, the primary is untouched ──
  await legendAction(page, "RSI 2 (7)", "Remove");
  const one = await settledRsi(page, 1, "removing the sibling should leave only the primary");
  expect(near(tailOf(one, "rsi"), RSI21)).toBe(true);
  await legendRow(page, "RSI");
  await expect.poll(async () => {
    const s = await readStore(page);
    return { has: !!s.inds?.includes(SIBLING_SEED), params: Object.prototype.hasOwnProperty.call(s.params ?? {}, SIBLING_SEED), primary: s.params?.rsi?.length };
  }, { timeout: 10_000 }).toEqual({ has: false, params: false, primary: 21 });

  // ── apply the template: the sibling returns with ITS OWN length, not the primary's ──
  await openChartMenu(page);
  await page.locator('.ctx-menu [data-a="tplmenu"]').click();
  await page.locator(`.ctx-menu [data-a="tpl:${saved[0].id}"]`).click();
  // E07: the menu opens the template's preview; applying is an explicit choice (replace by default).
  const library = page.locator("[data-study-template-library]");
  await expect(library.locator("[data-apply-template]")).toBeEnabled();
  await library.locator("[data-apply-template]").click();
  await expect(library).toHaveCount(0);
  const restored = await settledRsi(page, 2, "the template should restore both instances");
  expect(near(tailOf(restored, "rsi"), RSI21)).toBe(true);
  expect(near(tailOf(restored, SIBLING_SEED), RSI7)).toBe(true);
  await legendRow(page, "RSI 1 (21)");
  await legendRow(page, "RSI 2 (7)");
});

test("repeated add/remove cycles retire only their own chart resources", async ({ page }) => {
  test.slow();
  await useLang(page, "en");
  await serveWorkspace(page, ["rsi"], { rsi: { length: 21 } });
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  const primary = await settledRsi(page, 1, "the primary should draw");
  const perInstance = primary.series.rsi.length;   // series one RSI instance owns
  expect(perInstance).toBeGreaterThan(0);
  await expect.poll(async () => (await readCensus(page))?.orphanSeries ?? null, { timeout: 20_000 }).toBe(0);
  const baseline = (await readCensus(page))!;

  for (let cycle = 0; cycle < 2; cycle++) {
    const modal = await openLibrarySearch(page);
    const add = modal.locator('[data-study-add-instance="rsi"]');
    for (let n = 2; n <= 4; n++) {
      await expect(add).toBeEnabled();
      await add.click();
      await expect(add).toContainText(n < 4 ? `${n} of 4 on this chart` : "Limit reached · 4 RSI per chart");
    }
    await expect(add).toBeDisabled();
    await closeLibrary(page);
    const four = await settledRsi(page, 4, `cycle ${cycle}: four instances should draw`);
    for (const id of rsiIds(four)) expect(near(tailOf(four, id), RSI21) || near(tailOf(four, id), RSI14)).toBe(true);
    // Each additional instance is seeded at registry defaults (14); the primary keeps its own 21.
    expect(near(tailOf(four, "rsi"), RSI21)).toBe(true);
    const grown = (await readCensus(page))!;
    expect(grown.orphanSeries).toBe(0);
    expect(grown.owned.indicators).toBe(baseline.owned.indicators + 3 * perInstance);
    expect(grown.live.series).toBe(baseline.live.series + 3 * perInstance);
    expect(grown.live.panes).toBe(baseline.live.panes + 3);

    for (const label of ["RSI 4 (14)", "RSI 3 (14)", "RSI 2 (14)"]) await legendAction(page, label, "Remove");
    const back = await settledRsi(page, 1, `cycle ${cycle}: only the primary should remain`);
    expect(near(tailOf(back, "rsi"), RSI21)).toBe(true);
    await expect.poll(async () => {
      const c = await readCensus(page);
      return c ? { orphans: c.orphanSeries, indicators: c.owned.indicators, series: c.live.series, panes: c.live.panes, paneMeta: c.paneMeta } : null;
    }, { message: `cycle ${cycle}: every added instance's series and pane should be retired`, timeout: 20_000 })
      .toEqual({ orphans: 0, indicators: baseline.owned.indicators, series: baseline.live.series, panes: baseline.live.panes, paneMeta: baseline.paneMeta });
    const store = await readStore(page);
    expect(store.inds).toEqual(["rsi"]);
    expect(Object.keys(store.params ?? {}).filter((k) => k.startsWith("rsi__"))).toEqual([]);
    expect(store.params?.rsi?.length).toBe(21);
  }
});

test("Chinese copy names the add action and the per-chart instance limit", async ({ page }, testInfo) => {
  test.slow();
  await useLang(page, "zh");
  await serveWorkspace(page, ["rsi", SIBLING_SEED], { [SIBLING_SEED]: { length: 7 } });
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  await settledRsi(page, 2, "both seeded instances should draw");
  await legendRow(page, "RSI 1 (14)");
  await legendRow(page, "RSI 2 (7)");
  await crop(page, "two-instances-zh", testInfo.project.name);

  await openIndicatorLibrary(page);
  const modal = page.locator(".imodal-library");
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await modal.getByRole("searchbox").fill("RSI");
  const add = modal.locator('[data-study-add-instance="rsi"]');
  await expect(add).toContainText("再添加一个RSI");
  await expect(add).toContainText("本图表已有 2/4 个 · 各自保留独立设置");
  await expect(add).toHaveAttribute("aria-label", "再添加一个RSI");
  if (!isPhoneViewport(page)) await add.scrollIntoViewIfNeeded();
  await crop(page, "library-zh", testInfo.project.name);
});
