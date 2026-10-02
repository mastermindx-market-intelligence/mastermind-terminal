/**
 * TERMINAL-02 live-bar acceptance — CANVAS witness, tick-correlated.
 *
 * Replaces the DOM harness, which was a proven FALSE WITNESS: it reported COHERENT against a
 * build containing zero `commitLiveBarGeneration`, because the EMA it polled is a render-time
 * recompute (VisualIntelligencePanel), and because a full leaf-text diff across an accepted quote
 * is byte-identical between the broken and repaired builds. A study's live value exists ONLY as a
 * lightweight-charts price-axis label drawn into the canvas.
 *
 * WITNESSES (geometry discovered, never hardcoded):
 *   CANDLE = price pane's price-axis strip  — moves on BOTH builds (applyLiveSplice paints it)
 *   STUDY  = last study pane's price-axis strip — bar-derived; frozen pre-fix, live post-fix
 *
 * WHY TICK-CORRELATED, not window-aggregate: the slow lane periodically refetches and rebuilds
 * everything, so over a long window a BROKEN build's study pane does eventually redraw. Counting
 * "did the study ever change" would therefore drift back to a false COHERENT. So each CANDLE
 * change is scored on whether STUDY changed within CORR_MS of it. Pre-fix a tick moves the candle
 * and not the study; post-fix both move inside one commit.
 *
 * Usage: node e2e/tools/canvas-acceptance.mjs <symbol> <seconds> [baseUrl]   (run from terminal/)
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";

const SYMBOL = process.argv[2] || "BTC-USD";
const WINDOW_S = Number(process.argv[3] || 240);
const BASE = process.argv[4] || "https://app.mastermind-x.com";
const SAMPLE_MS = 400;
const CORR_MS = 1600;          // a commit paints candle+study in one frame; allow for sampling skew
const MIN_MOVES = 6;           // never judge on a handful of sub-pixel ticks

const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

// Served build identity, read off the WIRE. It must NOT be read from the hydrated DOM: Next emits
// `data-dpl-id` on <html> from `deploymentId`, and React hydration REMOVES it — measured on
// production 2026-09-29, present at DOMContentLoaded and null by readyState "complete". A harness
// that records a null SHA cannot say which build it accepted, which is the whole point.
let servedSha = null;
page.on("response", async (r) => {
  if (servedSha === null && r.request().resourceType() === "document") {
    try { servedSha = ((await r.text()).match(/data-dpl-id="([^"]*)"/) || [])[1] ?? null; } catch {}
  }
});
await page.goto(`${BASE}/terminal?symbol=${encodeURIComponent(SYMBOL)}&cb=${Date.now()}`,
  { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector(".chart-wrap canvas", { state: "visible", timeout: 60_000 });
await page.waitForTimeout(8_000);
await page.mouse.move(5, 5);   // keep the crosshair off the chart: hover repaints both panes

const geom = await page.evaluate(() => {
  const wrap = document.querySelector(".chart-wrap");
  const r0 = wrap.getBoundingClientRect();
  const rects = [...wrap.querySelectorAll("canvas")].map((c) => {
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  const maxX = Math.max(...rects.map((r) => r.x));
  const axes = [...new Map(rects.filter((r) => r.x === maxX && r.height >= 40)
    .map((r) => [`${r.y}x${r.height}`, r])).values()].sort((a, b) => a.y - b.y);
  const paneName = (top) => {
    const el = [...wrap.querySelectorAll(".lg-name")].find((e) => {
      const r = e.getBoundingClientRect(); return r.y >= top - 4 && r.y <= top + 60; });
    return el ? el.textContent.trim() : null;
  };
  return {
    tf: (document.querySelector(".status-symbol-name")?.textContent || "").trim(),
    candle: axes[0] || null,
    study: axes.length > 1 ? axes[axes.length - 1] : null,
    studyName: axes.length > 1 ? paneName(axes[axes.length - 1].y) : null,
    panes: axes.length,
  };
});
if (!geom.study) { console.log(JSON.stringify({ verdict: "INCONCLUSIVE — no study pane on this chart", geom })); await browser.close(); process.exit(0); }

const shot = async (r) => sha(await page.screenshot({ clip: r }));
let cPrev = await shot(geom.candle), sPrev = await shot(geom.study);
const candleAt = [], studyAt = [];
const deadline = Date.now() + WINDOW_S * 1000;
while (Date.now() < deadline && candleAt.length < 24) {
  await page.waitForTimeout(SAMPLE_MS);
  const [c, s] = [await shot(geom.candle), await shot(geom.study)];
  const t = Date.now();
  if (c !== cPrev) { candleAt.push(t); cPrev = c; }
  if (s !== sPrev) { studyAt.push(t); sPrev = s; }
}

// score each candle move on whether the study moved with it
const paired = candleAt.filter((t) => studyAt.some((u) => u >= t - CORR_MS && u <= t + CORR_MS));
const ratio = candleAt.length ? paired.length / candleAt.length : 0;
// A verdict that cannot name the build it measured proves nothing about any particular PR.
// Production moved twice on 2026-09-29 alone, so an unanchored GREEN is worthless: refuse one.
const verdict =
  !servedSha
    ? "INCONCLUSIVE — could not identify the served build (no data-dpl-id in the document body)"
  : candleAt.length < MIN_MOVES
    ? `INCONCLUSIVE — only ${candleAt.length} candle moves in ${WINDOW_S}s (need ${MIN_MOVES})`
    : ratio >= 0.8 ? "COHERENT — the study repainted with the candle"
    : ratio <= 0.2 ? "SPLIT GENERATION — the candle moved and the study did not (the defect)"
    : `INCONCLUSIVE — mixed (${paired.length}/${candleAt.length} paired)`;

console.log(JSON.stringify({
  base: BASE, servedSha, symbol: SYMBOL, timeframe: geom.tf, studyWitness: geom.studyName,
  panes: geom.panes, regions: { candle: geom.candle, study: geom.study },
  windowSeconds: WINDOW_S, candleMoves: candleAt.length, studyMoves: studyAt.length,
  pairedMoves: paired.length, pairedRatio: Number(ratio.toFixed(3)), verdict,
  // The caller MUST anchor the verdict to the tree, not just to a SHA string:
  //   git ls-tree -r <servedSha> --name-only | grep liveBarProjection
  // A COHERENT reading against a build that does not contain the carrier is measuring someone
  // else's change; a SPLIT against one that does would be a real regression.
  verifyWith: `git ls-tree -r ${servedSha ?? "<servedSha>"} --name-only | grep liveBarProjection`,
}, null, 2));
await browser.close();
