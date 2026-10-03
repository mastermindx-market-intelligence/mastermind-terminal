/**
 * TERMINAL-02 live-bar acceptance — CANVAS witness, tick-correlated.
 *
 * A study's live value exists ONLY as pixels the lightweight-charts canvas draws. There is no DOM
 * node holding it, and the dev hooks (`__mmLiveBarGeneration`) are stripped from the production
 * bundle — verified on app.mastermind-x.com 2026-09-29, `typeof` is "undefined" there. So the only
 * production witness is a pixel diff, and the whole difficulty is picking a region that can
 * actually see the thing under test.
 *
 * ── WHY THE PANE BODIES, NOT THE PRICE-AXIS STRIPS ────────────────────────────────────────────
 * The first version of this file diffed the price pane's AXIS strip against the study pane's AXIS
 * strip. That pairing cannot return COHERENT on any build, because the two strips do not have
 * comparable sensitivity. Measured on production over 90s (BTC-USD, 3D), on a build that provably
 * contains the fix:
 *
 *      candle axis 84 moves   |   study axis  1 move
 *      candle body  5 moves   |   study body  5 moves
 *
 * The candle's axis label re-renders on every cent; the study's axis label is rounded, so a correct
 * per-tick update is invisible in it. Comparing them measures LABEL PRECISION, not generation
 * coherence, and yields a guaranteed false SPLIT. The plot areas are commensurate sensors. Axis
 * counts are still reported below, as diagnostics only — never as the verdict's input.
 *
 * ── WHY TICK-CORRELATED, NOT WINDOW-AGGREGATE ─────────────────────────────────────────────────
 * The slow lane periodically refetches and rebuilds everything, so over a long window a BROKEN
 * build's study pane does eventually redraw. "Did the study ever move" would therefore drift back
 * to a false COHERENT. Each CANDLE-body move is scored on whether the STUDY body moved within
 * CORR_MS of it.
 *
 * ── WHY A LOW RATIO IS NOT PROOF OF THE DEFECT ────────────────────────────────────────────────
 * A study can be updated on every tick and still repaint only occasionally, because its value has
 * to cross a pixel boundary to be visible. Measured against a LOCAL dev server with the fix ACTIVE:
 * 19 candle-body moves, 3 study-body moves — ratio 0.158, which the naive threshold would have
 * called SPLIT on a correct build. So the only unambiguous defect signature is a study body that
 * moves ZERO times while the candle moves freely; anything between that and the coherent band is
 * reported as INCONCLUSIVE (under-sensitive witness) rather than guessed at.
 *
 * Discrimination is real and was measured, same server / same build / one runtime flag toggling
 * whether the followers run (local dev, exact `__mmLiveBarGeneration` witness, 150s each):
 *      followers starved -> 15 candle advances, ema 0/15, macd 0/15, vol 0/15
 *      fix active        ->  9 candle advances, ema 9/9,  macd 9/9,  vol 8/9
 *
 * Usage: node e2e/tools/canvas-acceptance.mjs <symbol> <seconds> [baseUrl]
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";

const SYMBOL = process.argv[2] || "BTC-USD";
const WINDOW_S = Number(process.argv[3] || 300);
const BASE = process.argv[4] || "https://app.mastermind-x.com";
const SAMPLE_MS = 400;
const CORR_MS = 1600;          // a commit paints candle+study in one frame; allow for sampling skew
const MIN_MOVES = 6;           // never judge on a handful of sub-pixel ticks

/**
 * Study panes whose series are BAR-DERIVED, i.e. rebuilt by `commitLiveBarGeneration` (the audit
 * asked that the witness be asserted, not merely reported: a pane carrying something that is not
 * bar-derived would make a COHERENT reading meaningless). Matched against the legend label, which
 * is i18n'd — so a non-English run finds no match and returns INCONCLUSIVE. That is deliberate:
 * this list fails CLOSED, and an unknown pane must be verified and added, never assumed.
 */
const BAR_DERIVED_PANES = ["MACD-RSI", "RSI", "Stochastic", "Stoch", "RSI Stack", "Accum", "RVOL", "Volume"];

const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE);

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

// Served build identity, read off the WIRE. It must NOT be read from the hydrated DOM: Next emits
// `data-dpl-id` on <html> from `deploymentId`, and React hydration REMOVES it — measured on
// production 2026-09-29, present at DOMContentLoaded and null by readyState "complete". A harness
// that records a null SHA cannot say which build it accepted. A local dev server emits no
// deploymentId at all, so the requirement applies to deployed bases only.
let servedSha = null;
page.on("response", async (r) => {
  if (servedSha === null && r.request().resourceType() === "document") {
    try { servedSha = ((await r.text()).match(/data-dpl-id="([^"]*)"/) || [])[1] ?? null; } catch {}
  }
});
await page.goto(`${BASE}/terminal?symbol=${encodeURIComponent(SYMBOL)}&cb=${Date.now()}`,
  { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector(".chart-wrap canvas", { state: "visible", timeout: 60_000 });
await page.waitForTimeout(10_000);
await page.mouse.move(5, 5);   // keep the crosshair off the chart: hover repaints both panes

const geom = await page.evaluate(() => {
  const wrap = document.querySelector(".chart-wrap");
  const R = (c) => { const r = c.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; };
  const rects = [...wrap.querySelectorAll("canvas")].map(R).filter((r) => r.width > 0 && r.height >= 40);
  if (!rects.length) return null;
  // The axis column is the rightmost x; the body column is the widest canvas. Panes are the
  // distinct y-bands within each, matched to each other by top edge.
  const maxX = Math.max(...rects.map((r) => r.x)), maxW = Math.max(...rects.map((r) => r.width));
  const uniq = (rs) => [...new Map(rs.map((r) => [`${r.y}x${r.height}`, r])).values()].sort((a, b) => a.y - b.y);
  const axes = uniq(rects.filter((r) => r.x === maxX)), bodies = uniq(rects.filter((r) => r.width === maxW));
  const near = (a) => bodies.find((b) => Math.abs(b.y - a.y) <= 3) || null;
  const paneName = (top) => {
    const el = [...wrap.querySelectorAll(".lg-name")].find((e) => {
      const r = e.getBoundingClientRect(); return r.y >= top - 4 && r.y <= top + 60; });
    return el ? el.textContent.trim() : null; };
  const last = axes.length > 1 ? axes[axes.length - 1] : null;
  return {
    tf: (document.querySelector(".status-symbol-name")?.textContent || "").trim(),
    panes: axes.length,
    candleAxis: axes[0] || null, candleBody: axes[0] ? near(axes[0]) : null,
    studyAxis: last, studyBody: last ? near(last) : null,
    studyName: last ? paneName(last.y) : null,
  };
});

const bail = async (verdict, extra = {}) => {
  console.log(JSON.stringify({ base: BASE, servedSha, symbol: SYMBOL, verdict, ...extra }, null, 2));
  await browser.close(); process.exit(0);
};
if (!geom || !geom.candleBody) await bail("INCONCLUSIVE — could not locate the price pane", { geom });
if (!geom.studyBody) await bail("INCONCLUSIVE — no study pane on this chart", { geom });
const derived = geom.studyName && BAR_DERIVED_PANES.some((n) => geom.studyName.toLowerCase().includes(n.toLowerCase()));
if (!derived) {
  await bail(`INCONCLUSIVE — the witness pane ${JSON.stringify(geom.studyName)} is not a known bar-derived study; `
    + `verify it is rebuilt by commitLiveBarGeneration and add it to BAR_DERIVED_PANES`, { geom });
}

const regions = { candleAxis: geom.candleAxis, candleBody: geom.candleBody, studyAxis: geom.studyAxis, studyBody: geom.studyBody };
const keys = Object.keys(regions).filter((k) => regions[k]);
const prev = {}, moves = {}, at = {};
for (const k of keys) { prev[k] = sha(await page.screenshot({ clip: regions[k] })); moves[k] = 0; at[k] = []; }

const deadline = Date.now() + WINDOW_S * 1000;
let samples = 0;
while (Date.now() < deadline) {
  await page.waitForTimeout(SAMPLE_MS);
  samples++;
  const t = Date.now();
  for (const k of keys) {
    const h = sha(await page.screenshot({ clip: regions[k] }));
    if (h !== prev[k]) { moves[k]++; at[k].push(t); prev[k] = h; }
  }
}

// Score each CANDLE-BODY move on whether the STUDY BODY moved with it.
const paired = at.candleBody.filter((t) => at.studyBody.some((u) => u >= t - CORR_MS && u <= t + CORR_MS));
const ratio = at.candleBody.length ? paired.length / at.candleBody.length : 0;
const verdict =
  !servedSha && !isLocal
    ? "INCONCLUSIVE — could not identify the served build (no data-dpl-id on the wire)"
  : at.candleBody.length < MIN_MOVES
    ? `INCONCLUSIVE — only ${at.candleBody.length} candle-body moves in ${WINDOW_S}s (need ${MIN_MOVES}); the market was too quiet to judge`
  : ratio >= 0.8
    ? "COHERENT — the study repainted with the candle"
  : at.studyBody.length === 0
    ? "SPLIT GENERATION — the candle moved and the study never repainted (the defect)"
    : `INCONCLUSIVE — the study repainted ${at.studyBody.length}x against ${at.candleBody.length} candle moves `
      + `(${paired.length} paired). Too coarse to call: a correct build on a slow timeframe looks like this. `
      + `Re-run longer, or on a timeframe where each tick moves the study by a visible pixel.`;

console.log(JSON.stringify({
  base: BASE, servedSha, symbol: SYMBOL, timeframe: geom.tf, studyWitness: geom.studyName,
  panes: geom.panes, regions, windowSeconds: WINDOW_S, samples,
  moves,                                   // all four regions; axes are DIAGNOSTIC ONLY
  candleBodyMoves: at.candleBody.length, studyBodyMoves: at.studyBody.length,
  pairedMoves: paired.length, pairedRatio: Number(ratio.toFixed(3)), verdict,
  // The caller MUST anchor the verdict to the tree, not just to a SHA string:
  //   git ls-tree -r <servedSha> --name-only | grep liveBarProjection
  // A COHERENT reading against a build that does not contain the carrier is measuring someone
  // else's change; a SPLIT against one that does would be a real regression.
  verifyWith: `git ls-tree -r ${servedSha ?? "<servedSha>"} --name-only | grep liveBarProjection`,
}, null, 2));
await browser.close();
