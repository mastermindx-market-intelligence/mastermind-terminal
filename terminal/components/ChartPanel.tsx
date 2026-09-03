"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// ── Boot-trace helper — mirrors the one in TerminalShell (?boottrace=1) ──────
const _cpStart = typeof performance !== "undefined" ? performance.now() : 0;
function cpMark(name: string) {
  if (typeof window === "undefined") return;
  if (!new URLSearchParams(window.location.search).has("boottrace")) return;
  const now = performance.now();
  try { performance.mark("bt:" + name); } catch {}
  // eslint-disable-next-line no-console
  console.log(`[boottrace] ${name} +${(now - _cpStart).toFixed(1)}ms`);
}
import {
  CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries, BaselineSeries,
  createSeriesMarkers, type ISeriesMarkersPluginApi,
  createTextWatermark,
  CrosshairMode, ColorType, LineStyle, LineType, MismatchDirection, PriceScaleMode, type IChartApi, type ISeriesApi, type IPaneApi, type IPriceLine,
} from "lightweight-charts";
import { createEngine, type ChartEngine } from "@/lib/chart-engine";
import {
  axisLogFormulaForRange,
  axisRangeFromLog,
  axisRangeToLog,
  axisValueAtCoordinate,
  wheelDeltaToZoomFactor,
  zoomAxisRange,
  type AxisLogFormula,
  type AxisMargins,
  type AxisRange,
} from "@/lib/chart-engine/axisZoom";
import { DEFAULT_CHART_RIGHT_OFFSET, fullHistoryLogicalRange, futureAxisBarCount, normalizedChartLogicalRange } from "@/lib/chart-engine/viewReset";
import { FUTURE_ANCHOR_BARS, futureBarTimes, futureCadence, futureSlotOf, type FutureCadence } from "@/lib/chart-engine/futureTime";
import { keepIndicatorPaneAxisLabelsOnly } from "@/lib/indicatorPaneSeries";
import { runPine, type RunResult } from "@/lib/pine-engine";
import { createPineHost, type PineHost, type PineResult } from "@/lib/pine-engine/host";
import { ORACLE_V1_PINE } from "@/lib/pine";
import { DRAWING_SCHEMA_VERSION, MAX_DRAWING_PAYLOAD_BYTES, type Drawing, type DrawKind, type Bar as DBar, uid, autoTrendlines, autoFib, srDrawings, mtfaDrawings } from "@/lib/drawings";
import { drawingToolFromShortcut, getDrawingTool, FREEHAND_DRAWING_KINDS, type DrawingToolCapability } from "@/lib/drawingTools";
import { DRAWING_RENDERER_FAMILY, materializeSemanticPoints } from "@/lib/drawing-engine/geometry";
import { calculateAnchoredVwap, calculateFixedRangeVolumeProfile, calculateRegressionChannel, generateGhostFeed } from "@/lib/drawing-engine/analytics";
import { cloneDrawing, constrainScreenAngle, translateDrawingAnchors } from "@/lib/drawing-engine/interaction";
import { calculatePositionMetrics, fibonacciSettings, positionSettings, type FibonacciLabelMode } from "@/lib/drawing-engine/settings";
import { registerPane, broadcastCrosshair, broadcastRange } from "@/lib/paneSync";
import {
  PRICE_TAG_ROW_HEIGHT,
  PRICE_TAG_TIME_HEIGHT,
  PRICE_TAG_MIN_VALUE_WIDTH,
  priceTagRowTop,
  priceScaleDisplayValue,
  secondaryPriceTagTop,
} from "@/lib/priceTagPlacement";
import { setActivePaneCoords, getActivePaneCoords } from "@/lib/paneCoords";
import { getJSON, getSliceAndOhlc, getCompositeOhlc, getOhlc } from "@/lib/dataCache";
import { parseComposite, alignAndSum } from "@/lib/composite";
import { CMP_PALETTE, type CmpCfg, defaultCmpCfg, cmpKey } from "@/lib/compare";
import { isIntradayTf, isSecondTf, classify, tfMinutes, type Market } from "@/lib/intradaySources";
import { liveDisplayEpoch, mutateLiveCandle } from "@/lib/liveCandle";
import { isMacroSymbol, macroOnEtAxis } from "@/lib/macroSymbols";
import { sessionVwap, openingRange, sessionLevels, pivotLevels, rvolSeries, ttmSqueeze, adx as calcAdx, cvdApprox, type Bar as IMBar, type DailyBar } from "@/lib/intradayMath";
import { attachSessionShading, detachSessionShading, type SessionShadingPrimitive } from "@/lib/sessionShading";
import { IND_DEFS, withDefaults, isIndKey } from "@/lib/indicators";
import { flowGet } from "@/lib/flowClientCache";
import { deriveOptLevels, sessionsOldEt, type OptLevelsResult } from "@/lib/optionsLevels";
import { computeSuite, resolveSuiteColors } from "@/lib/indicator-canvas/host";
import { renderPrims, ensureTooltipHost } from "@/lib/indicator-canvas/render";
import {
  hitTestMarkers, placeMarkerTip, isTapGesture,
  MARKER_HOVER_SLACK, MARKER_TAP_SLACK, type MarkerHit,
} from "@/lib/markerTooltip";
import { paintCandleData } from "@/lib/indicator-canvas/candlePaint";
import { paintSnapshotTables } from "@/lib/chartSnapshotTables";
import { SUITE_DEFS, getSuiteDef, isSuiteKey as isSuiteKeyReg, paneSuiteKeys } from "@/lib/suites/registry";
import { ensureSuiteRuntime, peekSuiteRuntime } from "@/lib/suites/compute";
import {
  enabledModulesForSuite,
  parseSuiteModuleId,
  suiteModuleCatalogFor,
  type SuiteModuleCatalogEntry,
} from "@/lib/suites/catalog";
import type { SuiteRenderBundle, SuiteTier, SuiteColors, CoordMapper, TableSpec } from "@/lib/indicator-canvas/types";
import ChartTables from "@/components/ChartTables";
import { crossUps, crossDowns, crossUpsBelow, crossDownsAbove } from "@/lib/crossSignals";
import { SOFT_Q, anchorSignal, isBlockedSignal, isOverrideCandidate, isReclaimOverrideTake, isRetroOverride, isStopSweepReclaim, isStructureStop, isWaivedEntry, markerTooltipCopy, opportunityMarkerGlyph, sliceSignalBasis } from "@/lib/signalVerdict";
import { makeNearestBarIndex } from "@/lib/barSnap";
import { ichimoku, supertrend, avwap as computeAvwap, rollingVwap, weekAnchoredVwap, vprofile, volbox, rsiStack, accumPct, trendRibbon, buyShare as mfBuyShare } from "@/lib/indicatorMath";
import ChartOverlays, { type PaneInfo, type LegendEntry } from "@/components/ChartOverlays";
import DayStatsStrip from "@/components/DayStatsStrip";
import { tPlain } from "@/lib/i18n";
import { listTemplates } from "@/lib/chartTemplates";
import {
  announceTerminalVisualReady,
  isTerminalIndicatorSetBuilt,
  type TerminalVisualReadyAnnouncement,
} from "@/lib/terminalBoot";
import { assetInitial, assetLogoPath } from "@/lib/assetLogos";
import { DEFAULT_CHART_SETTINGS, type ChartSettings } from "@/components/ChartFrameBar";
import { chartTimeAxisOptions, chartTimeSpanDays } from "@/lib/chartTimeAxis";

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
type Bar = { time: string; o: number; h: number; l: number; c: number; v: number };

const DRAWING_IMAGE_MAX_FILE_BYTES = 700 * 1024;
const DRAWING_IMAGE_MAX_EDGE = 4096;
const DRAWING_IMAGE_MAX_PIXELS = 12_000_000;
const DRAWING_IMAGE_PAYLOAD_BUDGET = Math.floor(MAX_DRAWING_PAYLOAD_BYTES * .9);
const DRAWING_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const DRAWING_IMAGE_DATA_RE = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i;

type DrawingMediaIcon = {
  id: string;
  label: string;
  path: string;
  filled?: boolean;
};

const DRAWING_MEDIA_EMOJIS = [
  { glyph: "😀", label: "Smile" },
  { glyph: "👍", label: "Thumbs up" },
  { glyph: "🔥", label: "Fire" },
  { glyph: "🚀", label: "Rocket" },
  { glyph: "💡", label: "Idea" },
  { glyph: "⚡", label: "Lightning" },
  { glyph: "🎯", label: "Target" },
  { glyph: "👀", label: "Watching" },
  { glyph: "💰", label: "Money" },
  { glyph: "📈", label: "Chart up" },
  { glyph: "📉", label: "Chart down" },
  { glyph: "⚠️", label: "Warning" },
] as const;

const DRAWING_MEDIA_ICONS: readonly DrawingMediaIcon[] = [
  { id: "star", label: "Star", filled: true, path: "M12 2.4l2.92 5.92 6.53.95-4.72 4.6 1.12 6.5L12 17.3l-5.85 3.07 1.12-6.5-4.72-4.6 6.53-.95z" },
  { id: "heart", label: "Heart", filled: true, path: "M12 20.5S3.5 15.6 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 6.4-8.5 11.3-8.5 11.3z" },
  { id: "bolt", label: "Bolt", filled: true, path: "M13.4 2.5L5.8 13h5.1l-.4 8.5L18.2 11h-5.1z" },
  { id: "flag", label: "Flag", path: "M6 21V4m0 1h10l-1.8 3L16 11H6" },
  { id: "check", label: "Check", path: "M4.5 12.5l4.2 4.2L19.5 6" },
  { id: "warning", label: "Warning", path: "M12 3l9 17H3L12 3zm0 5v5m0 3.5v.1" },
  { id: "pin", label: "Pin", filled: true, path: "M12 21s6-6.2 6-11a6 6 0 1 0-12 0c0 4.8 6 11 6 11zm0-8.4a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2z" },
  { id: "target", label: "Target", path: "M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5m-5 0 8-8m0 0v5m0-5h-5" },
] as const;

function isSafeDrawingImageDataUrl(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= Math.ceil(DRAWING_IMAGE_MAX_FILE_BYTES * 4 / 3) + 128
    && DRAWING_IMAGE_DATA_RE.test(value);
}

function drawingMediaIcon(value: unknown): DrawingMediaIcon {
  const id = typeof value === "string" ? value : "";
  return DRAWING_MEDIA_ICONS.find((icon) => icon.id === id) ?? DRAWING_MEDIA_ICONS[0];
}
export type DetectCmd = {
  kind: "trendlines" | "fib" | "sr" | "mtfa" | "clear" | "clearAll";
  nonce: number;
  /** Pane that owned the command when it was dispatched; prevents replay after an active-pane switch. */
  targetPane: number;
} | null;
const VALUE_CHART_TYPES = new Set(["line", "line-markers", "step", "area", "baseline"]);
const isValueChartType = (chartType: string) => VALUE_CHART_TYPES.has(chartType);
const priceSeriesFamily = (chartType: string) => {
  if (chartType === "bars") return "bars";
  if (chartType === "hollow") return "hollow";
  if (isValueChartType(chartType)) return chartType;
  return "candle"; // candles + Heikin Ashi share the same LWC series family
};

// Optional live/delayed snapshot threaded ChartPane → ChartPanel for the R11 live-bar splice.
// `ts` is a unix epoch in SECONDS (from the quote hub); `basis` gates whether we splice at all.
export type LiveQuote = {
  last?: number;
  open?: number;
  high?: number;
  low?: number;
  vol?: number;
  ts?: number;
  basis?: string;
  market?: Market;
  chg?: number;
  prevSessionChg?: number;
  marketSession?: "pre" | "rth" | "post" | "overnight";
  regularSessionDate?: string;
  regularSession?: "rth" | "closed";
  extPrice?: number;
  extChg?: number;
  extTs?: number;
  extSession?: "pre" | "post" | "overnight";
  extSource?: string;
  extBasis?: string;
  live?: boolean;
  suspended?: boolean;
  lagMs?: number | null;
  asOfMs?: number | null;
  // Latest one-second aggregate from the live Massive WebSocket lane. Kept distinct from
  // day open/high/low/volume so a 1s candle never mistakes the session open for its own open.
  tickOpen?: number | null;
  tickHigh?: number | null;
  tickLow?: number | null;
  tickClose?: number | null;
  tickVol?: number | null;
  tickStartMs?: number | null;
  tickEndMs?: number | null;
} | null | undefined;

// Which markets can show intraday TFs (R12): everyone but Canadian `.TO` (no Polygon intraday leg).
// Exported so the shell can gate its TF picker per active symbol.
export function intradayCapable(market: Market): boolean { return market !== "ca"; }

// ── R11 live-bar splice (pure, exported for unit tests) ────────────────────────
// Splice a live quote onto a DAILY bar array. `sessionDate` is the quote's market-local
// wall-clock date ("YYYY-MM-DD"). Returns a NEW daily array (never mutates the input):
//   • sessionDate > last bar date  → APPEND a synthetic in-progress daily bar
//   • sessionDate === last bar date → PATCH the last bar (c=last, h=max, l=min, v when known)
//   • sessionDate < last bar date OR no quote/last → return the input unchanged (no-op)
// Callers own the replay / basis / intraday guards (this helper is math-only).
export function spliceDaily(daily: Bar[], q: { last?: number; open?: number; high?: number; low?: number; vol?: number } | null | undefined, sessionDate: string | null): Bar[] {
  if (!daily.length || !q || sessionDate == null) return daily;
  const last = q.last;
  // Only splice a REAL positive price. Equities never trade at/below 0; a 0 (or missing) `last` is a
  // premarket/feed placeholder — splicing it would draw a bar down to $0.
  if (last == null || !isFinite(last) || last <= 0) return daily;
  // Treat 0/negative open/high/low as MISSING, not real prices. CN/HK premarket call-auction snapshots
  // report open/high/low = 0 before the session resolves; accepting the 0 open anchored a synthetic bar
  // at $0 → the "$0 → last-close" spike on every China chart at the open.
  const pos = (x: number | undefined): number | undefined => (typeof x === "number" && isFinite(x) && x > 0 ? x : undefined);
  const qHigh = pos(q.high), qLow = pos(q.low), qOpen = pos(q.open);
  const tail = daily[daily.length - 1];
  if (sessionDate < tail.time) return daily;   // quote is older than the freshest bar — nothing to do
  if (sessionDate === tail.time) {
    const h = Math.max(tail.h, last, qHigh ?? -Infinity);
    const l = Math.min(tail.l, last, qLow ?? Infinity);
    const patched: Bar = { ...tail, h, l, c: last, v: isFinite(q.vol as number) ? (q.vol as number) : tail.v };
    return [...daily.slice(0, -1), patched];
  }
  // newer session → append a synthetic bar built from the snapshot fields (open/high/low fall back to last)
  const o = qOpen ?? last;
  const h = Math.max(o, last, qHigh ?? -Infinity);
  const l = Math.min(o, last, qLow ?? Infinity);
  const bar: Bar = { time: sessionDate, o, h, l, c: last, v: isFinite(q.vol as number) ? (q.vol as number) : 0 };
  return [...daily, bar];
}

/**
 * May this quote's regular-session value be drawn as the daily bar for `sessionDate`?
 *
 * US extended prints live on a separate line and must NEVER become a daily candle. The regular
 * session's own value may: during RTH it is the forming bar, and AFTER THE BELL IT IS THE
 * COMPLETED ONE.
 *
 * This used to be `marketSession === "rth"` alone, which conflated the two and left the chart a
 * full session behind every evening: the daily file does not roll until the ~23:00 ET EOD writer,
 * so from 16:00 to 23:00 the candles sat on yesterday while the header showed today's close
 * (operator-reported 2026-08-07, alongside the quote-side half of the same gap).
 *
 * `regularSessionDate === sessionDate` is the precise test — it says this quote's REGULAR session
 * is the very day being spliced. Safe because the hub guarantees `last`/`close` are regular-session
 * values (extended prints exist only in the ext* namespace), and in pre-market or the overnight
 * window before an open, `regularSessionDate` is still the PRIOR day — so nothing is ever drawn
 * for a session that has not traded yet.
 *
 * Non-US markets (and macro symbols) are unaffected: they have no separate extended lane here.
 */
export function canSpliceRegularBar(
  sym: string,
  q: { marketSession?: string; regularSessionDate?: string } | null | undefined,
  sessionDate: string | null,
): boolean {
  if (!q || sessionDate == null) return false;
  // A-share opening-auction quotes replace the header/watchlist price from 09:15, but continuous
  // trading has not begun. Chinese brokerages show that indicative/matched price without drawing
  // a daily or intraday candle for it; the first candle still belongs to 09:30.
  if (classify(sym) === "cn" && q.marketSession === "pre") return false;
  if (classify(sym) !== "us" || isMacroSymbol(sym)) return true;
  if (q.marketSession === "rth") return true;
  return q.regularSessionDate === sessionDate;
}

// Fold a spliced DAILY array into the final resampled bucket for tf∈{3D,W,1M}. Returns the ONE
// bucket (time key + OHLCV) that `series.update()` should push — reusing the existing bucketer so
// the time key matches whatever Effect 2 produced (never invents a bucket unless the new daily date
// genuinely starts one, e.g. a fresh ISO week). Returns null for tf=D (caller updates the raw bar).
export function foldFinalBucket(daily: Bar[], tf: string): Bar | null {
  if (!daily.length) return null;
  if (tf === "D") return daily[daily.length - 1];
  const res = resampleTf(daily, tf);
  return res.length ? res[res.length - 1] : null;
}

// Derive the quote's session date in the symbol's market-local wall-clock ("YYYY-MM-DD").
// CN/HK live in UTC+8 (no DST); US in America/New_York; crypto/ca fall back to UTC.
export function sessionDateOf(ts: number | undefined, market: Market): string | null {
  if (ts == null || !isFinite(ts)) return null;
  const ms = ts * 1000;
  if (market === "cn" || market === "hk") return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
  if (market === "us") {
    const p: Record<string, string> = {};
    for (const part of US_DATE_FMT.formatToParts(ms)) p[part.type] = part.value;
    return `${p.year}-${p.month}-${p.day}`;
  }
  return new Date(ms).toISOString().slice(0, 10);
}
const US_DATE_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

// ── last-price tag: bar-close countdown (the "07:36" / "1d 20h" next to the price) ──
// Per-market UTC offsets + session-close hours (both DST/holiday-agnostic — good enough for a
// countdown; ≤1h drift under DST). Intraday close is exact (bar open + interval). Daily+ counts
// to the exchange session close of the last trading day of the period: 24/7 crypto rolls at local
// midnight (closeH=24), equities close at 16:00 (15:00 CN) on the last weekday of the period.
const MARKET_TZ_OFFSET: Record<Market, number> = { us: -5 * 3600, ca: -5 * 3600, cn: 8 * 3600, hk: 8 * 3600, crypto: 0 };
const SESSION_CLOSE_H: Record<Market, number> = { us: 16, ca: 16, cn: 15, hk: 16, crypto: 24 };

/** Unix seconds when the current daily/weekly/2-week/monthly/quarter bar closes. */
export function periodCloseTs(tf: string, nowSec: number, market: Market): number {
  const off = MARKET_TZ_OFFSET[market] ?? 0;
  const closeH = SESSION_CLOSE_H[market] ?? 24;
  const weekend = market === "crypto";                        // 24/7 → no weekend walk-back, midnight roll
  const HOUR = 3600, DAYMS = 86400_000;
  const d = new Date((nowSec + off) * 1000);
  const Y = d.getUTCFullYear(), Mo = d.getUTCMonth(), Da = d.getUTCDate();
  // unix-sec of the session close on local calendar day (y,m,dd), walked back to the last
  // trading weekday for markets that don't trade weekends.
  const closeOn = (y: number, m: number, dd: number): number => {
    let t = Date.UTC(y, m, dd);
    if (!weekend) { let wd = new Date(t).getUTCDay(); while (wd === 0 || wd === 6) { t -= DAYMS; wd = new Date(t).getUTCDay(); } }
    return Math.floor(t / 1000) + closeH * HOUR - off;
  };
  for (let i = 0; i < 3; i++) {                               // advance to the next period if this one already closed
    let cand: number;
    if (tf === "W" || tf === "2W") {
      const dow = new Date(Date.UTC(Y, Mo, Da)).getUTCDay();
      cand = closeOn(Y, Mo, Da + ((7 - dow) % 7) + i * 7);    // ISO-week end (Sunday) → walked to Fri close for equities
    } else if (tf === "1M") {
      cand = closeOn(Y, Mo + i, new Date(Date.UTC(Y, Mo + i + 1, 0)).getUTCDate());   // last day of month
    } else if (tf === "3M") {
      const qEndMo = Math.floor(Mo / 3) * 3 + 2 + i * 3;      // last month of the calendar quarter
      cand = closeOn(Y, qEndMo, new Date(Date.UTC(Y, qEndMo + 1, 0)).getUTCDate());
    } else {
      cand = closeOn(Y, Mo, Da + i);                          // D + any unknown daily-derived TF
    }
    if (cand > nowSec) return cand;
  }
  return closeOn(Y, Mo, Da + 1);
}

/** Format a bar-close countdown (seconds), TradingView-style, tiered by timeframe. */
export function fmtCountdown(remaining: number, _intraday: boolean): string {
  let r = Math.max(0, Math.floor(remaining));
  const d = Math.floor(r / 86400); r -= d * 86400;
  const h = Math.floor(r / 3600); r -= h * 3600;
  const m = Math.floor(r / 60); const s = r - m * 60;
  const p2 = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h`;
  // TradingView keeps second resolution on the current bar even for a daily candle. Besides being
  // more useful, the fixed clock shape gives the compact 66px value cell a stable width.
  if (h > 0) return `${p2(h)}:${p2(m)}:${p2(s)}`;
  return `${p2(m)}:${p2(s)}`;
}

const EMPTY_SET: Set<string> = new Set();
const EMPTY_OBJ: Record<string, any> = {};
const EMPTY_PINE: PineScript[] = [];

// An enabled custom script threaded from TerminalShell. `params` already has the user's per-script
// overrides merged over the script's declared input defaults (keyed by the input's assignment-var).
export type PineScript = { id: string; name: string; source: string; params: Record<string, any> };
// Sub-pane pine scripts get a namespaced pane key so they never collide with a built-in sub-pane key.
const pineKeyOf = (id: string) => "pine:" + id;
// ~2s coarse runtime cap: a pathological script is skipped with an error rather than freezing the tab.
const PINE_RUNTIME_CAP_MS = 2000;

// Preserve the visible logical range across an indicator toggle (§0.4 ratified = true).
// The one-line escape hatch: flip to false to restore the pre-refactor "view resets on toggle" behavior.
const PRESERVE_VIEW_ON_INDICATOR_TOGGLE = true;


// ---- indicator math ----
function ema(a: (number | null)[], p: number) { const o: (number | null)[] = Array(a.length).fill(null); const k = 2 / (p + 1); let pr: number | null = null, s = 0, c = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v == null) { o[i] = pr; continue; } if (pr == null) { s += v; c++; if (c === p) { pr = s / p; o[i] = pr; } } else { pr = v * k + pr * (1 - k); o[i] = pr; } } return o; }
function sma(a: (number | null)[], p: number) { const o: (number | null)[] = Array(a.length).fill(null); const q: number[] = []; let s = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; q.push(v == null ? 0 : v); if (v != null) s += v; if (q.length > p) s -= q.shift()!; if (q.length === p) o[i] = s / p; } return o; }
function stddev(a: number[], p: number) { const o: (number | null)[] = Array(a.length).fill(null); for (let i = p - 1; i < a.length; i++) { const w = a.slice(i - p + 1, i + 1); const m = w.reduce((x, y) => x + y, 0) / p; o[i] = Math.sqrt(w.reduce((x, y) => x + (y - m) ** 2, 0) / p); } return o; }
function rsi(cl: number[], p = 14) { const o: (number | null)[] = Array(cl.length).fill(null); let g = 0, l = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], u = ch > 0 ? ch : 0, d = ch < 0 ? -ch : 0; if (i <= p) { g += u; l += d; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (p - 1) + u) / p; l = (l * (p - 1) + d) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; }
// CM_Stochastic_MTF (ChrisMoody) — regular *price* stochastic on the current timeframe:
// rawK = 100·(close − lowest(low,len)) / (highest(high,len) − lowest(low,len)); %K = SMA(rawK, smoothK); %D = SMA(%K, smoothD).
function cmStoch(highs: number[], lows: number[], cl: number[], len = 14, smoothK = 3, smoothD = 3) { const raw: (number | null)[] = Array(cl.length).fill(null); for (let i = len - 1; i < cl.length; i++) { let hh = -1e9, ll = 1e9; for (let j = i - len + 1; j <= i; j++) { if (highs[j] > hh) hh = highs[j]; if (lows[j] < ll) ll = lows[j]; } raw[i] = hh === ll ? 50 : (100 * (cl[i] - ll)) / (hh - ll); } const k = sma(raw, smoothK); return { k, d: sma(k, smoothD) }; }
// TH_RSIMACD+ — RSI-based MACD: MACD computed on the RSI, not on price (matches the Golden Oracle confluence's RSI-MACD).
function rsiMacd(cl: number[], rsiLen = 14, fastLen = 14, baseLen = 60, signalLen = 5) { const r = rsi(cl, rsiLen); const ef = ema(r, fastLen), es = ema(r, baseLen); const line = cl.map((_, i) => (ef[i] != null && es[i] != null ? ef[i]! - es[i]! : null)); const sig = ema(line, signalLen); const hist = line.map((_, i) => (line[i] != null && sig[i] != null ? line[i]! - sig[i]! : null)); return { line, sig, hist }; }
const toLine = (rows: Bar[], arr: (number | null)[]) => rows.map((r, i) => (arr[i] != null && isFinite(arr[i]!) ? { time: r.time, value: arr[i]! } : null)).filter(Boolean) as any[];

function resampleTf(rows: Bar[], tf: string): Bar[] {
  if (tf === "D" || rows.length === 0) return rows;
  const out: Bar[] = []; let cur: Bar | null = null; let key: any = null;
  const isoWeek = (d: string) => { const dt = new Date(d + "T00:00:00Z"); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day); return dt.toISOString().slice(0, 10); };
  // 2W / 3M use ABSOLUTE-calendar bucketing (anchored to a fixed epoch, not the data's first bar), so
  // buckets are stable across a month/quarter boundary regardless of where the window starts:
  //   2W → floor(days-since-epoch of the bar's ISO-week-start / 14)   (fixed fortnight blocks)
  //   3M → year + calendar quarter (Q0=Jan-Mar … Q3=Oct-Dec)
  const biWeek = (d: string) => { const dt = new Date(isoWeek(d) + "T00:00:00Z"); return Math.floor(dt.getTime() / 86400_000 / 14); };
  const quarter = (d: string) => { const y = d.slice(0, 4); const m = +d.slice(5, 7) - 1; return `${y}-Q${Math.floor(m / 3)}`; };
  for (let i = 0; i < rows.length; i++) { const r = rows[i]; const k = tf === "W" ? isoWeek(r.time) : tf === "2W" ? biWeek(r.time) : tf === "1M" ? r.time.slice(0, 7) : tf === "3M" ? quarter(r.time) : tf === "2D" ? Math.floor(i / 2) : Math.floor(i / 3); if (k !== key) { if (cur) out.push(cur); key = k; cur = { ...r }; } else { cur!.h = Math.max(cur!.h, r.h); cur!.l = Math.min(cur!.l, r.l); cur!.c = r.c; cur!.time = r.time; cur!.v += r.v; } }
  if (cur) out.push(cur); return out;
}

// ── resampleTf memoization: cache per (symbol, tf) so D→W→D doesn't recompute ──
// Keys are evicted when the symbol changes (clearResampleCache). Max ~10 entries (6 TFs × recent symbols).
// The cache stores the FULL resampled array; callers still slice for replay.
const _resampleCache = new Map<string, Bar[]>();
function resampleTfCached(rows: Bar[], tf: string, sym: string): Bar[] {
  const key = sym + "::" + tf;
  const cached = _resampleCache.get(key);
  if (cached !== undefined) return cached;
  const result = resampleTf(rows, tf);
  _resampleCache.set(key, result);
  return result;
}
function clearResampleCache(sym?: string): void {
  if (sym === undefined) { _resampleCache.clear(); return; }
  for (const k of Array.from(_resampleCache.keys())) { if (k.startsWith(sym + "::")) _resampleCache.delete(k); }
}
function heikin(rows: Bar[]): Bar[] { const out: Bar[] = []; let po = 0, pc = 0; for (let i = 0; i < rows.length; i++) { const r = rows[i]; const hc = (r.o + r.h + r.l + r.c) / 4; const ho = i === 0 ? (r.o + r.c) / 2 : (po + pc) / 2; out.push({ ...r, o: ho, c: hc, h: Math.max(r.h, ho, hc), l: Math.min(r.l, ho, hc) }); po = ho; pc = hc; } return out; }

const NS = "http://www.w3.org/2000/svg";
const mk = (tag: string, attrs: Record<string, any>) => { const e = document.createElementNS(NS, tag); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, String(attrs[k])); return e; };

/** Native shell renders TV-parity axis chips: the VALUE pill only. LWC draws a second filled
 *  label for a series `title`, which duplicates the DOM legend and triples the axis ink.
 *  Web is unchanged. (D5) */
const shellAxis = () =>
  typeof document !== "undefined" && document.documentElement.getAttribute("data-shell") === "app";
const axTitle = (s: string) => (shellAxis() ? "" : s);

/** C3/C7 — the ONE regular-width breakpoint. Must stay byte-identical to the `@media (min-width:700px)`
 *  branch at the end of globals.css's D-block, or the type ramp and the grid pitch step apart. */
const SHELL_WIDE_MQ = "(min-width:700px)";
const shellWide = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(SHELL_WIDE_MQ).matches;
/** C2 — TV keeps the horizontal time-axis rule but lighter than ours: measured `#2A2D38` at
 *  x=300, y2133–2135 (vs our `--line` #23262F). The price scale gets NO rule at all. */
const SHELL_TIME_AXIS_LINE = "#2a2d38";
const axisLineColor = (fallback: string) => (shellAxis() ? SHELL_TIME_AXIS_LINE : fallback);
/** C3 — LWC's minimum price-label pitch is `ceil(fontSize * tickMarkDensity)`. TV measures 47 CSS px,
 *  so 12 × 3.9 = 47 exactly. Web keeps the library default (2.5 — passing it is a no-op).
 *  The 4.6 regular-width value is an invention (§4-A20.12). */
const shellTickDensity = () => (shellAxis() ? (shellWide() ? 4.6 : 3.9) : 2.5);
/** C7 — the axis font rides the same breakpoint as the CSS type ramp. */
const shellAxisFontSize = () => (shellAxis() && shellWide() ? 13 : 12);

// ── color-token snapshot (re-read on mount and on the up/down color flip, Effect 5) ──
// `axis`/`grid` resolve through the --chart-axis-text / --chart-grid indirection whose :root
// defaults reproduce --muted / --grid exactly; only the native shell retunes them (D6).
type Tokens = { up: string; down: string; grid: string; axis: string; line: string; p3: string; link: string; warn: string; signal: string; buy: string; sell: string; mut: string; brand2: string };
const readTokens = (): Tokens => ({ up: css("--up"), down: css("--down"), grid: css("--chart-grid") || css("--grid"), axis: css("--chart-axis-text") || css("--muted"), line: css("--line"), p3: css("--panel-3"), link: css("--link"), warn: css("--warn"), signal: css("--signal"), buy: css("--buy"), sell: css("--sell"), mut: css("--muted"), brand2: css("--brand-2") });

// Directional tint. LWC paints to canvas and cannot resolve var(--up)/var(--down), so every shaded
// directional band has to be built in JS from the LIVE token — hardcoding the green/red rgba is what
// kept these bands on the western convention under html[data-updown="east"]. Non-color input (and
// any notation this doesn't parse) passes through untouched rather than drawing transparent.
const withAlpha = (col: string, a: number): string => {
  const s = (col || "").trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  }
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(s);
  return m ? `rgba(${+m[1]},${+m[2]},${+m[3]},${a})` : s;
};

// ── the canonical sub-pane order (parity with the base's sequential pane assignment) ──
// overlays (ema/bb/vwap/vol + new DT overlays) always live in pane 0.
// every sub-pane indicator gets its OWN pane (rsi and stochrsi were formerly a shared "osc" pane).
const SUBPANE_ORDER = ["rsi", "stochrsi", "macd", "rsistack", "accum", "rvol", "ttmsq", "adx", "cvd"] as const;

// Bases that carry a fresher-than-EOD price we can splice onto the last daily bar.
const SPLICE_BASES = new Set(["REALTIME", "LIVE", "DELAYED_15M"]);

export default function ChartPanel({ symbol, chartType = "candles", indicators, timeframe = "D", replayIdx = null, onMeta, tool = null, toolActivation = 0, drawingSticky = false, drawingCreationDisabled = false, drawStyle, drawings = [], onDrawingsChange, detectCmd = null, magnet = "off", compare = [], compareCfg = EMPTY_OBJ, isActive = true, syncId = null, liveQuote = null,
  indParams = EMPTY_OBJ, hidden = EMPTY_SET, onToggleHidden, onRemoveInd, onOpenSettings, onOpenSource, pineScripts = EMPTY_PINE, chartSettings, onChartApi, extHours = false,
  instrumentName, instrumentMarket, instrumentColor, onAddAlert, onTableView, onObjectTree, onOpenSettingsModal, lockedVLine = null, onSetLockedVLine, onIndRowsAt, dayMode = false, onPaneCount, companyName = "", userTier = "free", dataReady = true, initialTimeframe = null }:
  { symbol: string; companyName?: string; chartType?: string; indicators: Set<string>; timeframe?: string; replayIdx?: number | null; onMeta?: (m: { total: number }) => void;
    /** False until the shell has COMMITTED its persisted prefs. See `effectiveTimeframe`. */
    dataReady?: boolean;
    /** The shell's already-resolved startup timeframe, handed over before it can be rendered. */
    initialTimeframe?: string | null;
    tool?: DrawKind | null; toolActivation?: number; drawingSticky?: boolean; drawingCreationDisabled?: boolean; drawStyle?: { color: string; width: number; dash: "solid" | "dashed" | "dotted" }; drawings?: Drawing[]; onDrawingsChange?: (d: Drawing[]) => void; detectCmd?: DetectCmd; magnet?: "off" | "weak" | "strong" | boolean; compare?: string[]; compareCfg?: Record<string, CmpCfg>; isActive?: boolean; syncId?: number | null; liveQuote?: LiveQuote;
    indParams?: Record<string, any>; hidden?: Set<string>; onToggleHidden?: (key: string) => void; onRemoveInd?: (key: string) => void; onOpenSettings?: (key: string) => void; onOpenSource?: (key: string) => void; pineScripts?: PineScript[];
    chartSettings?: Partial<ChartSettings>;
    instrumentName?: string;
    instrumentMarket?: string;
    instrumentColor?: string;
    onChartApi?: (api: IChartApi | null) => void; extHours?: boolean;
    onAddAlert?: (price: number) => void;
    onTableView?: () => void;
    onObjectTree?: () => void;
    onOpenSettingsModal?: (tab?: string) => void;
    lockedVLine?: string | null;
    onSetLockedVLine?: (time: string | null) => void;
    /** Called once after each data load with a function that returns per-key indicator values at a bar time. */
    onIndRowsAt?: (fn: ((barTime: string | number) => Record<string, number | null>) | null) => void;
    /** Day Trade Mode — enables session shading + countdown chip + stats strip. */
    dayMode?: boolean;
    /** B3: fires whenever the number of non-price sub-panes changes, so TerminalShell can grow the container. */
    onPaneCount?: (n: number) => void;
    /** Entitlement tier (UI gate for premium suite modules — authority stays server-side). */
    userTier?: SuiteTier;
  }) {
  const ref = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const verdictRef = useRef<HTMLSpanElement>(null);
  // ── chart / series refs (never in a dep array) ──
  // The engine owns the renderer lifecycle (chart-engine P1); chartRef is the raw-LWC
  // bridge handle the not-yet-migrated call sites still speak (P2 drives it out).
  const engineRef = useRef<ChartEngine | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const visibleCalendarSpanDays = () => {
    try {
      const range = chartRef.current?.timeScale().getVisibleRange();
      return range ? chartTimeSpanDays(range.from, range.to) : null;
    } catch {
      return null;
    }
  };
  const priceSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const priceFamilyRef = useRef<string | null>(null);   // which series family is on the chart now
  const indSeriesRef = useRef<Map<string, ISeriesApi<any>[]>>(new Map());   // indKey → its series
  const cmpSeriesRef = useRef<Map<string, ISeriesApi<any>>>(new Map());      // compare-sym → series
  const paneMapRef = useRef<Map<string, number>>(new Map());                 // sub-pane indKey → pane index
  // ── custom-script (Pine) render state (parallels the built-in indicator refs) ──
  const pineSeriesRef = useRef<Map<string, ISeriesApi<any>[]>>(new Map());   // scriptId → its series (all panes)
  const pineMarkersRef = useRef<Map<string, ISeriesMarkersPluginApi<any>>>(new Map()); // scriptId → its markers plugin
  const ttmsqMarkersRef = useRef<ISeriesMarkersPluginApi<any> | null>(null); // ttmsq squeeze-tier dots plugin
  const macdMarkersRef = useRef<ISeriesMarkersPluginApi<any> | null>(null);  // TH_RSIMACD+ crossover dots plugin (on the MACD-RSI line series)
  const pinePaneMapRef = useRef<Map<string, number>>(new Map());             // sub-pane scriptId → pane index (overlay scripts absent)
  const pineErrRef = useRef<Map<string, string>>(new Map());                 // scriptId → error text (surfaced in the legend)
  const pineCacheRef = useRef<Map<string, { key: string; result: RunResult | null; error: string | null }>>(new Map()); // memo: scriptId → last run
  // ── worker-backed Pine host (PINE lane's host.ts) ──────────────────────────────────────────────
  // The host runs compile+execute in a terminateable Web Worker (SSR/tests fall back to a sync host,
  // same surface), caches the parsed AST by source hash (data-only re-runs skip re-parsing), and
  // supersedes an in-flight run per `slot` (= scriptId) so a fast replay auto-advance coalesces to the
  // latest tick instead of stacking O(N) re-parses on the main thread (the old O(N²) replay stall).
  const pineHostRef = useRef<PineHost | null>(null);
  const pineHost = (): PineHost => { if (!pineHostRef.current) pineHostRef.current = createPineHost(); return pineHostRef.current; };
  // scriptId → { source, astId } for the last compiled source, so a data-only re-run passes the astId.
  const pineAstRef = useRef<Map<string, { source: string; astId: string | null }>>(new Map());
  // Monotonic epoch bumped on every pine rebuild request. An async worker batch stamps the epoch it was
  // launched under and is DROPPED on resolve if a newer rebuild has since bumped it — the guard that
  // stops a stale reply from painting over a newer bar set (host supersession handles same-slot; this
  // covers a full clearAllPine()+buildAllPine() between launch and resolve).
  const pineEpochRef = useRef(0);
  // Debounce handle for the live-splice incremental pine re-run (≥250ms) so a burst of live quotes
  // schedules ONE pine re-eval, not one per splice.
  const pineLiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pineScriptsRef = useRef<PineScript[]>(pineScripts); pineScriptsRef.current = pineScripts;
  const barsRef = useRef<Bar[]>([]);        // the bars currently ON the chart (full OR replay-sliced)
  const fullBarsRef = useRef<Bar[]>([]);    // the full resampled history — NEVER mutated by replay
  const dailyBarsRef = useRef<Bar[]>([]);   // the raw DAILY source (pre-resample) — the R11 splice operates here
  const isIntradayRef = useRef<boolean>(false);   // true when the active TF is an intraday branch (skip splice/resample/date-keyed overlays)
  const closesRef = useRef<number[]>([]);   // closes of barsRef
  // PERF: time→index map for O(1) barIndex()/snapT lookups (was an O(n) linear scan called per marker
  // per frame). Rebuilt lazily on `barsRef.current` array-identity change (every data/replay/splice
  // reassigns barsRef to a NEW array), so it's always in step without touching the 6 assignment sites.
  const barIdxRef = useRef<{ src: Bar[] | null; map: Map<string | number, number> }>({ src: null, map: new Map() });
  // Addressable bar slots PAST the newest candle, so anchors can be placed in the
  // blank future area instead of collapsing onto the last bar. Memoized on the
  // same array-identity trigger as barIdxMap.
  const futureRef = useRef<{
    src: Bar[] | null;
    times: (string | number)[];
    index: Map<string | number, number>;
    cadence: FutureCadence | null;
  }>({ src: null, times: [], index: new Map(), cadence: null });
  const futureGrid = () => {
    const b = barsRef.current;
    if (futureRef.current.src !== b) {
      const barTimes = b.map((row) => row.time as string | number);
      const times = futureBarTimes(barTimes, FUTURE_ANCHOR_BARS);
      const index = new Map<string | number, number>();
      times.forEach((time, offset) => { index.set(String(time), offset); index.set(time, offset); });
      futureRef.current = { src: b, times, index, cadence: futureCadence(barTimes) };
    }
    return futureRef.current;
  };
  /** Offset into the future grid, or -1 when the time is a real (or unknown) bar. */
  const futureOffset = (tm: string | number): number => {
    const grid = futureGrid();
    const exact = grid.index.get(tm as any) ?? grid.index.get(String(tm));
    if (exact != null) return exact;
    // Every new bar regenerates the grid, so a stored anchor's exact slot can
    // stop existing. Derive its offset from the cadence instead — otherwise the
    // nearest-bar fallback would yank it back to the live edge, which is the
    // "drawings get cut off by the wall" defect this feature removes.
    return futureSlotOf(grid.cadence, tm, FUTURE_ANCHOR_BARS);
  };
  // ── future dates on the time axis ─────────────────────────────────────────
  // lightweight-charts only labels times it holds a data point for, so the blank
  // gutter past the newest candle carried no dates at all. A dedicated
  // WHITESPACE series (no values, so it cannot touch any price scale) extends
  // the time scale forward and gives that region real labels.
  //
  // Deliberately NOT the price series: that one is driven by update() on every
  // live tick, and update() rejects a point older than the series' last one — a
  // future tail there would reject every subsequent tick.
  const futureAxisRef = useRef<ISeriesApi<any> | null>(null);
  const applyFutureAxis = () => {
    const chartApi = chartRef.current; if (!chartApi) return;
    // Cover as much of the anchor grid as the loaded history justifies, so every
    // ordinarily reachable anchor sits on a labelled slot without turning a
    // short history into mostly blank canvas. Replay is a closed historical lens
    // and gets no future tail at all.
    const tail = futureAxisBarCount(barsRef.current.length, FUTURE_ANCHOR_BARS);
    const times = replayIdxRef.current != null ? [] : futureGrid().times.slice(0, tail);
    let series = futureAxisRef.current;
    if (!series) {
      if (!times.length) return;
      try {
        series = chartApi.addSeries(LineSeries, {
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          // Never let an axis-only helper participate in price autoscaling.
          autoscaleInfoProvider: () => null,
        }, 0);
      } catch { return; }
      futureAxisRef.current = series;
    }
    try { series.setData(times.map((time) => ({ time: time as any }))); } catch { /* stale chart */ }
  };
  const barIdxMap = (): Map<string | number, number> => {
    const b = barsRef.current;
    if (barIdxRef.current.src !== b) {
      const m = new Map<string | number, number>();
      // Key on BOTH the raw time and its stringified form so an exact lookup hits O(1) regardless of
      // whether the query time arrives as a number (intraday epoch) or a string (the old scan used
      // String()==String() coercion). Raw key set last so m.get(rawTime) returns the canonical index.
      for (let k = 0; k < b.length; k++) { const t = b[k].time; m.set(String(t), k); m.set(t, k); }
      barIdxRef.current = { src: b, map: m };
    }
    return barIdxRef.current.map;
  };
  // PERF: gap-zone detection memo — the O(daily²) gap+fill scan is pure data-derived geometry that does
  // NOT depend on the crosshair/range, yet renderSignals ran it every frame. Cache keyed on the daily
  // source array identity + the gap params so it recomputes only on a data/param change; the per-frame
  // render just re-projects the cached zones' coordinates.
  type GapZone = { date: string; type: "up" | "down"; lo: number; hi: number; fill: string | null };
  const gapZonesRef = useRef<{ src: Bar[] | null; thr: number; map: Map<string, Bar["time"]>; gaps: GapZone[] }>({ src: null, thr: -1, map: new Map(), gaps: [] });
  const prevSymbolRef = useRef<string>("");  // tracks the symbol from the last Effect 2 run to detect symbol changes
  const precRef = useRef<number>(2);
  // GC v2: sig marks additionally carry keeper quality + recipe tier (drives the marker dimming/
  // hollow style + the A+/Q badge) and the engine's quality_reason for the soft-mark tooltip. CUT is
  // discriminated by `type` (the schema guarantees CUT ⟺ scored:false), so `score`/`scored` aren't
  // needed on the chart. All optional — the client-Pine fallback path omits them.
  // HK-O1: `basis` and `blocked` are the render keys the glyph law reads — `type` alone is not
  // enough to know what a marker MEANS (every slice SELL is a trailing structure stop; a
  // regime_blocked BUY is a refused setup that must never wear buy geometry). Both are stamped
  // only on the slice path, where provenance is known — the client-Pine fallback leaves them
  // undefined so its genuinely momentum-sourced SELL is not relabelled a stop.
  type SigMark = { t: string; type: string; price: number; highlight?: boolean; quality?: string; tier?: string | null; reason?: string; basis?: string; blocked?: boolean; scored?: boolean | null; subtype?: string | null; stopLevel?: number | null; priorStopLevel?: number | null; sweepLow?: number | null; riskBasis?: string | null; overrideCandidate?: boolean; overrideTake?: boolean; overrideGroup?: string | null; overrideDd?: number | null;
    // durable cross-engine candidate receipt; never folded into Oracle's position walk
    source?: string | null; definition?: string | null; rank?: number | null;
    returnPct?: number | null; authority?: string | null;
    // the entry's waived leg was the KEEPER's 200-reclaim (era gc_v2_wo2), not the regime veto
    reclaimWaived?: boolean;
    // display-only RETRO PROJECTION: today's rule would have entered this pre-fence refusal
    retro?: boolean;
    // The emitter's context objects, kept WHOLE alongside the flattened `overrideGroup` the
    // marker geometry uses. The tooltip copy needs them intact: `name_zh` lives only here, so a
    // flattened English `overrideGroup` is all a zh reader could ever have been shown.
    overrideCtx?: { group_id?: string | null; peer_dd?: number | null; name?: string | null; name_zh?: string | null } | null;
    retroCtx?: { group_id?: string | null; name?: string | null; name_zh?: string | null } | null };
  const sigMarksRef = useRef<SigMark[]>([]);
  // Client-Pine FALLBACK: when a symbol ships no slice signal history, marks come from ORACLE_V1_PINE
  // run client-side on the daily bars, memoized per (symbol · daily length · last daily date) so the
  // flagship Pine runs at most once per load and replay just re-snaps the cached signal dates.
  const oracleMemoRef = useRef<{ key: string; sig: { ts: string; type: string }[] }>({ key: "", sig: [] });
  // Lab signal markers (TLT-R4): populated when _lab indicator is active and intel.tech is available.
  // Shape: Map<date-string, { names: string[]; dir: number }[]> — one entry per date, one item per signal fired that day.
  // Capped at the most recent LAB_MARKER_CAP fire-days to keep rendering responsive.
  const LAB_MARKER_CAP = 200;
  const labMarkersRef = useRef<Map<string, { name: string; dir: number }[]>>(new Map());
  // GC v2 side channels: anticipation dots (dates) + structure-break warnings ({t, kind}), resolved to bar times.
  const earlyDotsRef = useRef<{ t: string }[]>([]);
  const warnMarksRef = useRef<{ t: string; kind: string }[]>([]);
  const showDetailRef = useRef<boolean>(true);   // "Signals detail" chip → early dots + warnings visibility
  const highlightTimerRef = useRef<any>(null);   // R14 pulse timer — cleared on symbol/TF change
  const epochRef = useRef(0);               // race guard: latest data-effect run wins
  const dataReadyRef = useRef(dataReady);    // shell preference hydration for the current render
  const builtIndicatorRef = useRef<{ generation: number; key: string } | null>(null);
  const visualReadyRef = useRef<TerminalVisualReadyAnnouncement | null>(null);
  const cmpGenRef = useRef(0);              // compare-specific generation token (epoch doesn't bump on compare change)
  const sliceRef = useRef<any>(null);       // latest slice, so replay re-resolves sig marks without a refetch
  const viewSavedRef = useRef<{ from: number; to: number } | null>(null);
  // SSR-safe: seed with empty tokens (this client component still renders on the server for initial
  // HTML, where getComputedStyle/document are unavailable). Effect 1 populates real tokens on mount.
  const tokensRef = useRef<Tokens>({ up: "", down: "", grid: "", axis: "", line: "", p3: "", link: "", warn: "", signal: "", buy: "", sell: "", mut: "", brand2: "" });
  const chartTypeRef = useRef<string>(chartType);
  const timeframeRef = useRef<string>(timeframe);
  const compareRef = useRef<string[]>(compare || []);
  const compareCfgRef = useRef<Record<string, CmpCfg>>(compareCfg);
  const indicatorsRef = useRef<Set<string>>(indicators);
  const indicatorSetKey = (set: ReadonlySet<string>) => Array.from(set).sort().join(",");
  const syncIdRef = useRef<number | null>(syncId);
  const replayIdxRef = useRef<number | null>(replayIdx);   // live replayIdx so Effect 2 doesn't build against a stale closure if replay starts mid-fetch
  const liveQuoteRef = useRef<LiveQuote>(liveQuote);       // latest live quote, so Effect 2's tail can re-apply the splice after setData
  const extHoursRef = useRef(extHours);
  const liveTickKeyRef = useRef("");                        // rejects a repeated one-second packet without repainting
  const livePulseSeqRef = useRef(0);                         // alternates CSS animation names so every tick can pulse
  const renderRef = useRef<() => void>(() => {});
  const cancelPendingDrawingRef = useRef<() => void>(() => {});
  const cancelMediaToolRef = useRef<(activeTool?: DrawKind | null) => void>(() => {});
  const renderTagRef = useRef<(() => void) | null>(null);   // updates the last-price + bar-close-countdown axis tag
  const renderHoverTagRef = useRef<((y: number | null, price?: number | null) => void) | null>(null);
  const symbolRef = useRef(symbol);                          // current symbol (Effect 1 mounts once; symbol changes in Effect 2)
  const companyNameRef = useRef(companyName);                 // proper name for the snapshot header (zh preferred over English)
  const renderSignalsRef = useRef<() => void>(() => {});
  // B7: the suite-runtime loader repaints through this, so it can live above the definition it
  // calls without capturing a stale closure.
  const applySuitePaintRef = useRef<(() => void) | null>(null);
  // ── B7: suite COMPUTATION is fetched per suite, on first use ───────────────────────────────
  //
  // The registry used to import all 31 module implementations eagerly, so /terminal shipped the
  // whole premium-suite compute before one was switched on. Metadata still comes from the static
  // graph; only the computation is deferred.
  //
  // The trigger is the RENDER PASS, not an effect keyed on the active set. That is deliberate:
  // an effect can resolve before the chart has mounted, and `rerenderOverlays` calls render
  // functions that are no-ops until then — the repaint would land on nothing and the suite would
  // stay invisible until the next unrelated pan or zoom. A render pass, by definition, only runs
  // once the chart is alive, so hanging the load off it removes that race entirely.
  //
  // Hooked ONCE per suite, not once per frame: `ensureSuiteRuntime` dedupes the fetch, but the
  // repaint callback would otherwise be re-attached on every frame while the chunk is in flight.
  const suiteRuntimeHookedRef = useRef<Set<string>>(new Set());
  // The chart's own frame scheduler, captured on mount. It is what re-runs renderIndOverlays —
  // the pass that draws SUITE prims. `rerenderOverlays` covers signals/drawings/tag only, so
  // repainting through that alone left a just-loaded suite invisible until the next pan or zoom.
  const scheduleRenderRef = useRef<(() => void) | null>(null);
  const requestSuiteRuntime = (key: string) => {
    if (suiteRuntimeHookedRef.current.has(key)) return;
    suiteRuntimeHookedRef.current.add(key);
    void ensureSuiteRuntime(key).then(() => {
      suiteRuntimeHookedRef.current.delete(key);
      // Both layers: the SVG prims/tables AND the candle paint, which is key-guarded and would
      // otherwise not notice that a suite it skipped now has something to say.
      scheduleRenderRef.current?.();      // suite prims + tables
      applySuitePaintRef.current?.();     // candle paint (key-guarded, so it needs its own kick)
    });
  };
  const syncCleanupRef = useRef<(() => void) | null>(null);
  // D3 table-view: stable lookup of per-key indicator values by bar time (built after each data load).
  const indDataMapRef = useRef<Map<string, Record<string, number | null>>>(new Map());

  // ── indicator-legend + pane-management plumbing (grafted onto the persistent-chart model) ──
  // one entry per chart pane (price pane + each sub-pane); pane KEY is the sub-pane store key
  // ("__price__" | "rsi" | "macd" | …) so it survives an incremental sub-pane rebuild / reorder.
  const panesMeta = useRef<{ key: string; removeKey?: string; isPrice: boolean; entries: Omit<LegendEntry, "hidden">[]; pane: IPaneApi<any> }[]>([]);
  // collapse/maximize/resize state, keyed by pane key — survives reorder + indicator churn
  const paneCtl = useRef<{ collapsed: Set<string>; maximized: string | null; normal: Map<string, number> }>({ collapsed: new Set(), maximized: null, normal: new Map() });
  const hiddenRef = useRef<Set<string>>(hidden); hiddenRef.current = hidden;
  const indParamsRef = useRef<Record<string, any>>(indParams); indParamsRef.current = indParams;
  // ── Premium suites (IndicatorCanvas) ── lazy per-frame compute via the host's memo; refs only.
  const userTierRef = useRef<SuiteTier>(userTier); userTierRef.current = userTier;
  const suiteColorsRef = useRef<SuiteColors | null>(null);          // resolved once per mount + on updown flip
  const suitePaintKeyRef = useRef<string>("");                      // last applied suite candle-paint signature
  const suiteTablesSigRef = useRef<string>("");                     // dashboard tables change-signature
  const suiteTablesRef = useRef<TableSpec[]>([]);                   // synchronous snapshot source
  const [suiteTables, setSuiteTables] = useState<TableSpec[]>([]);  // rendered by <ChartTables> (DOM, not SVG)
  suiteTablesRef.current = suiteTables;
  const wrapElRef = useRef<HTMLElement | null>(null);
  const paneLayoutRef = useRef<PaneInfo[]>([]);
  const hoveredKeyRef = useRef<string | null>(null);   // pane under cursor, tracked by stable key
  const measureRef = useRef<() => void>(() => {});
  const paneRORef = useRef<ResizeObserver | null>(null);
  const [paneLayout, setPaneLayout] = useState<PaneInfo[]>([]);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // B4: collapsed by default on mobile (≤860px) — coarse devices don't need the legend open
  const [legendOpen, setLegendOpen] = useState(() =>
    typeof window === "undefined" ? true : !window.matchMedia("(max-width:860px)").matches
  );
  const [showDetail, setShowDetail] = useState(true);   // GC v2: early-dots + warnings overlay toggle
  // DayStatsStrip: snapshot of bars + dailyBars for the strip (updated when intraday data loads)
  // Using state so React re-renders the strip when data changes; refs are not enough.
  const [stripBars, setStripBars] = useState<Bar[]>([]);
  const [stripDailyBars, setStripDailyBars] = useState<{ time: string; h: number; l: number; c: number }[]>([]);
  useEffect(() => { showDetailRef.current = showDetail; renderSignalsRef.current(); }, [showDetail]);
  // ── new D1-D4 callback refs (stable closures so Effect 1 can read latest without re-mounting) ──
  const onAddAlertRef = useRef(onAddAlert); onAddAlertRef.current = onAddAlert;
  const onTableViewRef = useRef(onTableView); onTableViewRef.current = onTableView;
  const onObjectTreeRef = useRef(onObjectTree); onObjectTreeRef.current = onObjectTree;
  const onOpenSettingsModalRef = useRef(onOpenSettingsModal); onOpenSettingsModalRef.current = onOpenSettingsModal;
  const onSetLockedVLineRef = useRef(onSetLockedVLine); onSetLockedVLineRef.current = onSetLockedVLine;
  const lockedVLineRef = useRef(lockedVLine); lockedVLineRef.current = lockedVLine;
  const onIndRowsAtRef = useRef(onIndRowsAt); onIndRowsAtRef.current = onIndRowsAt;
  // B2/B3/B5: mobile breakpoint ref (drives applyStretch) + reactive state (drives ChartOverlays coarse prop)
  const isMobileRef = useRef<boolean>(typeof window !== "undefined" && window.matchMedia("(max-width:860px)").matches);
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width:860px)").matches : false
  );
  const onPaneCountRef = useRef(onPaneCount); onPaneCountRef.current = onPaneCount;
  const lastPaneCountRef = useRef<number>(-1);   // last reported count to avoid redundant calls

  // `insider` is the pre-rename name for `essential`; still ranked so a stale cached tier can
  // never fail CLOSED here (the renderer refusing to draw) while the picker fails OPEN.
  const suiteTierRank = (tier: SuiteTier | "insider"): number =>
    tier === "pro" ? 2 : tier === "essential" || tier === "insider" ? 1 : 0;
  const canRenderSuiteModule = (entry: SuiteModuleCatalogEntry): boolean =>
    suiteTierRank(userTierRef.current) >= suiteTierRank(entry.tier);
  const activeSuiteModules = (suiteKey: string): SuiteModuleCatalogEntry[] =>
    enabledModulesForSuite(suiteKey, indicatorsRef.current, indParamsRef.current).filter(canRenderSuiteModule);
  const suiteLegendLabel = (entry: SuiteModuleCatalogEntry): string =>
    `${entry.suiteTag} · ${entry.label}`;
  const isLegendEntryHidden = (key: string): boolean => {
    const parsed = parseSuiteModuleId(key);
    return hiddenRef.current.has(key) || !!parsed && hiddenRef.current.has(parsed.suiteKey);
  };
  // Per-module eye state remains UI-only. The suite host still computes one shared context, but
  // hidden modules are disabled in the render snapshot so their prims, paint, tables and events
  // disappear together without mutating the user's saved module selection.
  const suiteRenderParams = (suiteKey: string): Record<string, any> | undefined => {
    const current = indParamsRef.current[suiteKey] as Record<string, any> | undefined;
    const hideSuite = hiddenRef.current.has(suiteKey);
    let next: Record<string, any> | undefined = current;
    for (const entry of suiteModuleCatalogFor(suiteKey)) {
      if (!hideSuite && !hiddenRef.current.has(entry.id)) continue;
      if (next === current) next = { ...(current ?? {}) };
      next![`${entry.moduleKey}.on`] = false;
    }
    return next;
  };
  // B1: double-tap + synthetic-hover suppression refs
  const lastDblHandledRef = useRef<number>(0);   // performance.now() of last touch-driven double-tap
  const lastTouchTsRef = useRef<number>(0);       // performance.now() of last touch pointerdown
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);   // first tap of a potential double-tap
  // params for the ACTIVE indicators drive an indicator rebuild (Effect 3b)
  const indParamsKey = JSON.stringify(Array.from(indicators).sort().map((k) => indParams[k]));
  // ── existing DOM / interaction refs (unchanged) ──
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drawRef = useRef<Drawing[]>(drawings);
  const drawingTransactionRef = useRef(false);
  const toolRef = useRef<DrawKind | null>(tool);
  const toolActivationRef = useRef(toolActivation);
  const drawingStickyRef = useRef(drawingSticky);
  const drawingCreationDisabledRef = useRef(drawingCreationDisabled);
  const clearDrawingSelectionRef = useRef<() => void>(() => {});
  const styleRef = useRef(drawStyle);
  const onChangeRef = useRef(onDrawingsChange);
  const magnetRef = useRef(magnet);
  const activeRef = useRef(isActive); activeRef.current = isActive;
  // CMX W3: ids of AI-session objects whose stroke-enter animation has already played. renderDraw()
  // rebuilds every <g> on each pan/zoom frame, so this set gates the enter class to fire exactly once
  // per object (never re-firing on re-render). Cleared for an id only when it leaves the draw set.
  const cmxPlayedRef = useRef<Set<string>>(new Set());
  // CMX W3: this pane's live coordinate resolver (set inside the chart effect once xOf/yOf exist).
  const cmxCoordResolverRef = useRef<import("@/lib/paneCoords").PaneCoordResolver | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const creationPaletteRef = useRef<HTMLDivElement | null>(null);
  const mediaPickerRef = useRef<HTMLDivElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const ctxRef = useRef<HTMLDivElement | null>(null);
  const textEditRef = useRef<HTMLInputElement | null>(null);
  const sigRef = useRef<SVGSVGElement | null>(null);
  const priceTagRef = useRef<HTMLDivElement | null>(null);  // TradingView-style last-price + countdown tag on the right axis
  const extendedTagRef = useRef<HTMLDivElement | null>(null); // PRE/AH/ON badge; shares the DOM scale layer with the primary tag
  const hoverTagRef = useRef<HTMLDivElement | null>(null);   // pointer price; foreground and excluded from persistent collisions
  const tagTimerRef = useRef<number | null>(null);          // 1s ticker so the bar-close countdown stays live
  // y (price-pane coords) of the crosshair's axis price label. Persistent badges never consume
  // this coordinate: an independent foreground DOM label follows it. The ref remains observable
  // for crosshair-continuity tests and mirrored panes.
  const crossLabelYRef = useRef<number | null>(null);
  const watermarkPluginRef = useRef<{ applyOptions: (opts: Record<string, any>) => void } | null>(null); // v5 text watermark plugin
  const brandBugRef = useRef<HTMLDivElement | null>(null);  // C5 — shell-only DOM brand bug (never created on web)
  // Mirrors the last `visible` passed to the watermark plugin. The plugin API is write-only
  // (IPanePrimitiveWrapper exposes applyOptions, never options), and the wordmark is canvas-drawn,
  // so this is the only assertable surface for C5's "plugin off in shell" contract.
  const watermarkVisibleRef = useRef<boolean>(true);
  const lastValueVisibleRef = useRef<boolean>(true);        // mirrors chartSettings.lastValueVisible; gates the custom priceTag
  const countdownVisibleRef = useRef<boolean>(true);
  const chartSettingsRef = useRef<Partial<ChartSettings>>(chartSettings ?? {});
  // status-line visibility knobs (chartSettings.showOHLC/showBarChange/showSymbolName)
  const showOHLCRef = useRef<boolean>(true);
  const showBarChangeRef = useRef<boolean>(true);
  const showSymbolNameRef = useRef<boolean>(true);
  const showLogoRef = useRef<boolean>(true);
  const titleModeRef = useRef<ChartSettings["titleMode"]>("name");
  const showVolumeRef = useRef<boolean>(false);
  const showLastDayChangeRef = useRef<boolean>(false);
  const instrumentNameRef = useRef<string>(instrumentName || symbol);
  const instrumentMarketRef = useRef<string>(instrumentMarket || "");
  const instrumentColorRef = useRef<string>(instrumentColor || "#64748b");
  // intraday dead-end empty-state overlay ("Back to Daily") — built in Effect 1, toggled from Effect 2
  const emptyRef = useRef<HTMLDivElement | null>(null);
  const showEmptyRef = useRef<(msg: string, action?: "daily" | null) => void>(() => {});
  const hideEmptyRef = useRef<() => void>(() => {});
  // SVG layer for indicator overlays (ichimoku cloud, ribbon fill, vprofile, volbox)
  const indSvgRef = useRef<SVGSVGElement | null>(null);
  // cached indicator overlay data — rebuilt when indicators/params/bars change, read by render
  const indOverlayRef = useRef<Record<string, any>>({});
  // ── Day Trade Mode refs ───────────────────────────────────────────────────────────────────────
  const dayModeRef = useRef<boolean>(dayMode); dayModeRef.current = dayMode;
  // Price lines created on the price series for slevels / pivots — must be removed explicitly on clear.
  // Keyed per indicator so removing ONE of slevels/pivots doesn't clear the survivor's lines.
  const indPriceLinesRef = useRef<Map<string, IPriceLine[]>>(new Map());
  const extendedPriceLineRef = useRef<IPriceLine | null>(null);
  const pushIndPriceLine = (key: string, pl: IPriceLine) => {
    const m = indPriceLinesRef.current;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(pl);
  };
  const removeIndPriceLines = (key?: string) => {
    const priceS = priceSeriesRef.current;
    const m = indPriceLinesRef.current;
    const keys = key ? [key] : [...m.keys()];
    for (const k of keys) {
      for (const pl of m.get(k) ?? []) { try { priceS?.removePriceLine(pl); } catch {} }
      m.delete(k);
    }
  };
  const clearExtendedPriceLine = () => {
    if (extendedTagRef.current) extendedTagRef.current.style.display = "none";
    const line = extendedPriceLineRef.current;
    if (!line) return;
    try { priceSeriesRef.current?.removePriceLine(line); } catch {}
    extendedPriceLineRef.current = null;
  };
  const applyExtendedPriceLine = () => {
    clearExtendedPriceLine();
    const priceSeries = priceSeriesRef.current;
    const quote = liveQuoteRef.current;
    const settings = chartSettingsRef.current;
    if (!priceSeries || isIntradayRef.current || replayIdxRef.current != null) return;
    if (chartDataSymRef.current !== symbolRef.current) return;   // never annotate another symbol's series
    if (classify(symbolRef.current) !== "us" || isMacroSymbol(symbolRef.current)) return;
    if (settings.extendedLineVisible === false) return;
    if (!quote?.extSession || quote.extPrice == null || !Number.isFinite(quote.extPrice) || quote.extPrice <= 0) return;
    const color = quote.extSession === "pre"
      ? settings.preMarketColor || "#ff9800"
      : quote.extSession === "post"
        ? settings.postMarketColor || "#2962ff"
        : settings.overnightColor || "#9c27b0";
    try {
      extendedPriceLineRef.current = priceSeries.createPriceLine({
        price: quote.extPrice,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        // The native canvas label cannot collide with our DOM current-price badge. Keep the true
        // price line native and render both persistent labels in one DOM scale layer instead.
        axisLabelVisible: false,
        title: "",
      });
      renderTagRef.current?.();
    } catch {}
  };
  // Session shading primitive attached to the candle series (intraday + market has sessions + dayMode).
  const shadingPrimRef = useRef<SessionShadingPrimitive | null>(null);
  // Countdown chip DOM element + its 1s timer (mounted in Effect 1, driven by dayMode effect).
  const countdownChipRef = useRef<HTMLDivElement | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Daily OHLC bars cached for slevels/pivots (fetched async during intraday builds; keyed by symbol).
  const dailyCacheRef = useRef<{ sym: string; bars: DailyBar[] } | null>(null);
  // Options Levels overlay (R3.1): fetched gex+moves derivation, keyed by symbol so a stale
  // root's levels can never draw on another ticker's chart. status: "loading" (fetch in
  // flight), "ok"/"empty" (derivation result), "unavailable" (fetch returned null — the
  // /api/flow entitlement 403 or a transient failure), "ineligible" (non-US symbol).
  const optLevelsStateRef = useRef<{
    sym: string;
    status: "loading" | "ok" | "empty" | "unavailable" | "ineligible";
    res: OptLevelsResult | null;
  } | null>(null);
  // The symbol whose bars are ACTUALLY on the price series (stamped at each setData).
  // symbolRef flips the instant the prop renders — long before Effect 2's bars land — so a
  // cache-hit gex fetch resolving in a microtask would otherwise draw the NEW root's levels
  // over the OLD symbol's candles (permanently, when the bars fetch dead-ends).
  const chartDataSymRef = useRef<string>("");
  // US options only — same market gate the extended-hours line uses.
  const optLevelsEligible = (sym: string) => classify(sym) === "us" && !isMacroSymbol(sym);

  // rebuild the CHART STYLE (not the chart) when the up/down color scheme flips (Effect 5)
  const [csNonce, setCsNonce] = useState(0);
  useEffect(() => { const h = () => setCsNonce((n) => n + 1); window.addEventListener("mm:updown", h); return () => window.removeEventListener("mm:updown", h); }, []);
  // suite colors resolve from CSS tokens — drop the cache on an up/down flip so the next frame re-reads
  useEffect(() => { const h = () => { suiteColorsRef.current = null; }; window.addEventListener("mm:updown", h); return () => window.removeEventListener("mm:updown", h); }, []);
  // Options Levels bakes tPlain() titles into canvas price-line labels at build time — rebuild on a
  // language flip or zh axis titles persist into the EN view (LEX law: no cross-language leaks).
  useEffect(() => {
    const h = () => {
      if (!indicatorsRef.current.has("optlevels")) return;
      try { buildOptLevels(); applyHidden(); rebuildPaneMeta(); } catch {}
    };
    window.addEventListener("mm:lang", h);
    return () => window.removeEventListener("mm:lang", h);
    // eslint-disable-next-line
  }, []);
  // CMX W3: keep the active-pane coordinate registration in sync with isActive (the chart mount effect
  // only re-runs on symbol/tf changes). Register when active, and clear our entry on deactivate/unmount
  // only if it's still ours (last-writer-wins — never clobber another pane that became active after us).
  useEffect(() => {
    if (isActive && cmxCoordResolverRef.current) setActivePaneCoords(cmxCoordResolverRef.current);
    return () => {
      if (getActivePaneCoords() === cmxCoordResolverRef.current) setActivePaneCoords(null);
    };
  }, [isActive]);
  // Live quote/language updates can rerender React in the middle of a pointer
  // drag or native color/range transaction. Do not replace that in-flight
  // draft with the last committed prop snapshot.
  if (!drawingTransactionRef.current) drawRef.current = drawings;
  toolRef.current = tool; toolActivationRef.current = toolActivation; drawingStickyRef.current = drawingSticky; drawingCreationDisabledRef.current = drawingCreationDisabled; onChangeRef.current = onDrawingsChange; magnetRef.current = magnet; styleRef.current = drawStyle;
  // keep the data-effect's non-trigger props readable from the mount closures without re-subscribing
  // ── Which timeframe this pane's DATA belongs to ────────────────────────────────────────────
  // The shell resolves the user's persisted startup timeframe synchronously on the client, but
  // cannot render it until its mount effect commits — measured at ~1.05s after mount, while this
  // component's data effect runs at ~130ms. Reading only the `timeframe` PROP therefore loads the
  // server-rendered default and throws the entire result away (fetch + setData + indicator build
  // + paint) for every user whose startup timeframe is not the SSR one: p50 1.14s of the cold path
  // to the first live candle, 2.7-3.1s under CI-shaped CPU load.
  //
  // So until the shell says its prefs are COMMITTED, prefer the value it handed over out-of-band.
  // Once `dataReady` flips, the prop is authoritative and equals it, so the dep below does not
  // change and no second load is issued. Standalone callers (embed, dev theater, ChartConductor)
  // pass neither prop and are unaffected.
  const effectiveTimeframe = dataReady ? timeframe : (initialTimeframe ?? timeframe);
  chartTypeRef.current = chartType; timeframeRef.current = effectiveTimeframe; compareRef.current = compare || []; compareCfgRef.current = compareCfg; indicatorsRef.current = indicators; dataReadyRef.current = dataReady; syncIdRef.current = syncId; replayIdxRef.current = replayIdx; liveQuoteRef.current = liveQuote; extHoursRef.current = extHours; symbolRef.current = symbol; companyNameRef.current = companyName;
  lastValueVisibleRef.current = chartSettings?.lastValueVisible !== false;
  countdownVisibleRef.current = chartSettings?.countdownVisible !== false;
  chartSettingsRef.current = chartSettings ?? {};
  showOHLCRef.current = chartSettings?.showOHLC !== false;
  showBarChangeRef.current = chartSettings?.showBarChange !== false;
  showSymbolNameRef.current = chartSettings?.showSymbolName !== false;
  showLogoRef.current = chartSettings?.showLogo !== false;
  titleModeRef.current = chartSettings?.titleMode ?? "name";
  showVolumeRef.current = chartSettings?.showVolume === true;
  showLastDayChangeRef.current = chartSettings?.showLastDayChange === true;
  instrumentNameRef.current = instrumentName || symbol;
  instrumentMarketRef.current = instrumentMarket || "";
  instrumentColorRef.current = instrumentColor || "#64748b";

  // Creating a new drawing and inspecting an existing object are mutually
  // exclusive. On narrow charts those controls intentionally share one lane.
  useEffect(() => {
    if (tool) clearDrawingSelectionRef.current();
  }, [tool]);
  useEffect(() => {
    const dismiss = () => clearDrawingSelectionRef.current();
    window.addEventListener("mm:drawing-dismiss-selection", dismiss);
    return () => window.removeEventListener("mm:drawing-dismiss-selection", dismiss);
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // Shared helpers (module-level within the component, referenced from every effect).
  // They read *Ref.current so they stay valid across data reloads without re-binding.
  // ────────────────────────────────────────────────────────────────────────────

  // HTML-escape helper for context menu template strings
  const escH = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // price format for the current precision
  const priceFmt = () => { const prec = precRef.current; return { type: "price" as const, precision: prec, minMove: Math.pow(10, -prec) }; };

  // Build price-series data for the current chartType from a bar set.
  const priceData = (rows: Bar[]) => {
    const display = chartTypeRef.current === "heikin" ? heikin(rows) : rows;
    if (isValueChartType(chartTypeRef.current)) return display.map((r) => ({ time: r.time, value: r.c }));
    const byPreviousClose = chartSettingsRef.current.colorBarsPrevClose && chartTypeRef.current !== "bars" && chartTypeRef.current !== "hollow";
    return display.map((r, index) => {
      const point: Record<string, any> = { time: r.time, open: r.o, high: r.h, low: r.l, close: r.c };
      if (byPreviousClose) {
        const previous = display[index - 1]?.c ?? r.o;
        const up = r.c >= previous;
        const settings = chartSettingsRef.current;
        const color = up
          ? settings.candleUpColor || tokensRef.current.up
          : settings.candleDownColor || tokensRef.current.down;
        point.color = settings.candleBodyVisible === false ? "rgba(0,0,0,0)" : color;
        point.borderColor = up ? settings.candleUpBorder || color : settings.candleDownBorder || color;
        point.wickColor = up ? settings.candleUpWick || color : settings.candleDownWick || color;
      }
      return point;
    });
  };

  // Create the price series (removed+re-added when the chartType actually changes).
  const addPriceSeries = (chart: IChartApi, t: Tokens) => {
    const pf = priceFmt();
    const settings = chartSettingsRef.current;
    const common = { priceFormat: pf, lastValueVisible: false, priceLineVisible: settings.priceLineVisible !== false };
    if (chartTypeRef.current === "line") return chart.addSeries(LineSeries, { ...common, color: t.brand2, lineWidth: 2 }, 0);
    if (chartTypeRef.current === "line-markers") return chart.addSeries(LineSeries, { ...common, color: t.brand2, lineWidth: 2, pointMarkersVisible: true, pointMarkersRadius: 2.5 }, 0);
    if (chartTypeRef.current === "step") return chart.addSeries(LineSeries, { ...common, color: t.brand2, lineWidth: 2, lineType: LineType.WithSteps }, 0);
    if (chartTypeRef.current === "area") return chart.addSeries(AreaSeries, { ...common, lineColor: t.brand2, topColor: "rgba(41,98,255,.30)", bottomColor: "rgba(41,98,255,.02)", lineWidth: 2 }, 0);
    if (chartTypeRef.current === "baseline") return chart.addSeries(BaselineSeries, {
      ...common,
      baseValue: { type: "price", price: 0 }, relativeGradient: true, lineWidth: 2,
      topLineColor: t.up, topFillColor1: withAlpha(t.up, 0.28), topFillColor2: withAlpha(t.up, 0.03),
      bottomLineColor: t.down, bottomFillColor1: withAlpha(t.down, 0.03), bottomFillColor2: withAlpha(t.down, 0.28),
    }, 0);
    if (chartTypeRef.current === "bars") return chart.addSeries(BarSeries, { ...common, upColor: settings.candleUpColor || t.up, downColor: settings.candleDownColor || t.down }, 0);
    return chart.addSeries(CandlestickSeries, {
      ...common,
      upColor: settings.candleBodyVisible === false || chartTypeRef.current === "hollow" ? "rgba(0,0,0,0)" : settings.candleUpColor || t.up,
      downColor: settings.candleBodyVisible === false ? "rgba(0,0,0,0)" : settings.candleDownColor || t.down,
      wickUpColor: settings.candleUpWick || settings.candleUpColor || t.up,
      wickDownColor: settings.candleDownWick || settings.candleDownColor || t.down,
      borderUpColor: settings.candleUpBorder || settings.candleUpColor || t.up,
      borderDownColor: settings.candleDownBorder || settings.candleDownColor || t.down,
      borderVisible: settings.candleBordersVisible !== false,
      wickVisible: settings.candleWicksVisible !== false,
    }, 0);
  };

  // per-indicator params merged over the registry defaults (drives the Settings dialog + the math/style).
  // withDefaults() also resolves directional style colors against the active Up/Down setting.
  const P = (k: string) => withDefaults(k, indParamsRef.current[k]);
  // Live --up/--down for canvas-painted indicator colors. tokensRef is filled on mount (Effect 1)
  // and re-read on the Up/Down flip (Effect 5); the literals cover only the pre-mount window.
  const dirUp = () => tokensRef.current.up || "#26c281";
  const dirDown = () => tokensRef.current.down || "#f0566b";
  const labelOf = (k: string) => (isIndKey(k) ? IND_DEFS[k].label : k);

  // ── indicator builders (param-driven; params flow from the Settings dialog via indParams) ──
  // Each returns the list of ISeriesApi it created, tracked in indSeriesRef under its indKey.
  const buildEma = (chart: IChartApi, rows: Bar[], closes: number[]): ISeriesApi<any>[] => {
    const out: ISeriesApi<any>[] = []; const p = P("ema");
    ([[p.ma1On, p.ma1Len, p.ma1Col], [p.ma2On, p.ma2Len, p.ma2Col], [p.ma3On, p.ma3Len, p.ma3Col]] as [boolean, number, string][]).forEach(([on, len, col]) => {
      if (!on) return; const ln = chart.addSeries(LineSeries, { color: col, lineWidth: p.width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0); ln.setData(toLine(rows, ema(closes, len))); out.push(ln);
    });
    return out;
  };
  const buildBb = (chart: IChartApi, rows: Bar[], closes: number[]): ISeriesApi<any>[] => {
    const out: ISeriesApi<any>[] = []; const p = P("bb");
    const basis = sma(closes, p.length); const sd = stddev(closes, p.length);
    const up = closes.map((_, i) => (basis[i] != null && sd[i] != null ? basis[i]! + p.mult * sd[i]! : null));
    const lo = closes.map((_, i) => (basis[i] != null && sd[i] != null ? basis[i]! - p.mult * sd[i]! : null));
    [up, basis, lo].forEach((arr, j) => { const ln = chart.addSeries(LineSeries, { color: j === 1 ? p.basisCol : p.bandCol, lineWidth: p.width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0); ln.setData(toLine(rows, arr)); out.push(ln); });
    return out;
  };
  const buildVwap = (chart: IChartApi, rows: Bar[]): ISeriesApi<any>[] => {
    const p = P("vwap");
    let cum = 0, cumv = 0; const vw = rows.map((r) => { const tp = (r.h + r.l + r.c) / 3; cum += tp * r.v; cumv += r.v; return cumv ? cum / cumv : null; });
    const ln = chart.addSeries(LineSeries, { color: p.col, lineWidth: p.width as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0); ln.setData(toLine(rows, vw));
    return [ln];
  };
  // volume rebuilt with param-aware colors so Effect 5 can recolor by re-setData (see volData)
  const volData = (rows: Bar[]) => { const p = P("vol"); return rows.map((r) => ({ time: r.time, value: r.v, color: r.c >= r.o ? p.upCol : p.downCol })); };
  const buildVol = (chart: IChartApi, rows: Bar[]): ISeriesApi<any>[] => {
    const vs = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false,
    }, 0);
    // C4/CHART-04 — 22% of the price pane is a slab that buries MA-200 and the brand bug; TV's
    // sliver is ~3.5%. 12% (top 0.88) is a deliberate midpoint, not a match (§4-A20.13). The alpha
    // in lib/indicators.ts moves WITH this: it was explicitly a compensator for the oversized band.
    try { chart.priceScale("volume").applyOptions({ scaleMargins: { top: shellAxis() ? 0.88 : 0.78, bottom: 0 } }); } catch {}
    vs.setData(volData(rows));
    return [vs];
  };
  // rsi and stochrsi each get their own pane (formerly combined into one shared "osc" pane)
  const buildRsiPane = (chart: IChartApi, rows: Bar[], closes: number[], pane: number): ISeriesApi<any>[] => {
    const p = P("rsi"); const rS = chart.addSeries(LineSeries, { color: p.col, lineWidth: p.width as any, lastValueVisible: true, title: axTitle("RSI") }, pane);
    rS.setData(toLine(rows, rsi(closes, p.length)));
    if (p.showLevels) { try { rS.createPriceLine({ price: p.obLevel, color: "rgba(214,218,227,.25)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false } as any); rS.createPriceLine({ price: p.osLevel, color: "rgba(214,218,227,.25)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false } as any); } catch {} }
    return [rS];
  };
  // CM_Stochastic crossover-highlight bars (Pine bgcolor port): value 1 (full-pane
  // via the fixed 0..1 autoscale on scale "stochsig") at a bullish/bearish cross,
  // whitespace elsewhere so only signal bars draw. A bull cross (%K crosses ABOVE %D while
  // %K < lowLine) rides --up and a bear cross (%K crosses BELOW %D while %K > upLine) rides
  // --down, so the bars follow the Up/Down colors setting (red-up under data-updown="east")
  // exactly like the candles — they used to be hardcoded green/red.
  const stochHiData = (rows: Bar[], k: (number | null)[], d: (number | null)[], upLine: number, lowLine: number) => {
    const bull = crossUpsBelow(k, d, lowLine); const bear = crossDownsAbove(k, d, upLine);
    const bullCol = withAlpha(dirUp(), 0.22), bearCol = withAlpha(dirDown(), 0.22);
    return rows.map((r, i) => (bull[i] ? { time: r.time, value: 1, color: bullCol } : bear[i] ? { time: r.time, value: 1, color: bearCol } : { time: r.time }));
  };
  const buildStochRsiPane = (chart: IChartApi, rows: Bar[], closes: number[], pane: number): ISeriesApi<any>[] => {
    const p = P("stochrsi"); const sr = cmStoch(rows.map(r => r.h), rows.map(r => r.l), closes, p.length, p.smoothK, p.smoothD);
    // Highlight bars are added FIRST so LWC (draws in add order) paints them BENEATH the %K/%D curves.
    const hlS = chart.addSeries(HistogramSeries, { priceScaleId: "stochsig", base: 0, priceLineVisible: false, lastValueVisible: false, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }) }, pane);
    try { chart.priceScale("stochsig").applyOptions({ scaleMargins: { top: 0, bottom: 0 } }); } catch {}   // full-pane-height bars (default overlay margins are 0.2/0.1)
    hlS.setData(stochHiData(rows, sr.k, sr.d, p.upLine, p.lowLine) as any);
    const kS = chart.addSeries(LineSeries, { color: p.kCol, lineWidth: p.width as any, lastValueVisible: true, title: axTitle("%K") }, pane);
    const dS = chart.addSeries(LineSeries, { color: p.dCol, lineWidth: 1, lastValueVisible: true, title: axTitle("%D") }, pane);
    kS.setData(toLine(rows, sr.k)); dS.setData(toLine(rows, sr.d));
    // CM_Stochastic_MTF upper/lower/mid guide lines (80 / 20 / 50 by default). Overbought is the
    // down side and oversold the up side, so both ride the tokens and flip with the setting.
    try { kS.createPriceLine({ price: p.upLine, color: withAlpha(dirDown(), 0.25), lineWidth: 1, lineStyle: 2, axisLabelVisible: false } as any); kS.createPriceLine({ price: p.lowLine, color: withAlpha(dirUp(), 0.25), lineWidth: 1, lineStyle: 2, axisLabelVisible: false } as any); kS.createPriceLine({ price: 50, color: "rgba(214,218,227,.15)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false } as any); } catch {}
    // Return order keeps kS@0/dS@1 stable for the in-place update path; the highlight histogram rides at [2]
    // (a real series → the teardown loops removeSeries it for free).
    return [kS, dS, hlS];
  };
  // TH_RSIMACD+ crossover dots (Pine plotshape port): a circle at the mid-price of every
  // macd/signal cross — bullish (line crosses ABOVE signal) green, bearish red. Rebuilt on the
  // passed LINE series and cached in macdMarkersRef (detached on teardown, like ttmsqMarkersRef).
  const applyMacdMarkers = (lineSeries: ISeriesApi<any>, rows: Bar[], line: (number | null)[], sig: (number | null)[]) => {
    if (macdMarkersRef.current) { try { macdMarkersRef.current.detach(); } catch {} macdMarkersRef.current = null; }
    const up = crossUps(line, sig); const dn = crossDowns(line, sig); const markers: any[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (!up[i] && !dn[i]) continue;
      markers.push({ time: rows[i].time, position: "atPriceMiddle", price: (line[i]! + sig[i]!) / 2, shape: "circle", size: 1, color: up[i] ? dirUp() : dirDown() });
    }
    try { macdMarkersRef.current = createSeriesMarkers(lineSeries, markers as any); } catch {}
  };
  const buildMacd = (chart: IChartApi, rows: Bar[], closes: number[], pane: number): ISeriesApi<any>[] => {
    const p = P("macd"); const m = rsiMacd(closes, p.rsiLen, p.fastLen, p.baseLen, p.signalLen);
    const hs = chart.addSeries(HistogramSeries, {}, pane); hs.setData(rows.map((r, i) => (m.hist[i] != null ? { time: r.time, value: m.hist[i]!, color: m.hist[i]! >= 0 ? p.upHist : p.downHist } : null)).filter(Boolean) as any);
    const lS = chart.addSeries(LineSeries, { color: p.macdCol, lineWidth: p.width as any, title: axTitle("MACD-RSI") }, pane); const sS = chart.addSeries(LineSeries, { color: p.signalCol, lineWidth: 1, title: axTitle("signal") }, pane);
    lS.setData(toLine(rows, m.line)); sS.setData(toLine(rows, m.sig));
    try { lS.createPriceLine({ price: 0, color: "rgba(214,218,227,.2)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false } as any); } catch {}
    applyMacdMarkers(lS, rows, m.line, m.sig);
    return [hs, lS, sS];
  };

  // ── custom-script (Pine) run + translate layer ─────────────────────────────────────────────────
  // Execution runs OFF the main thread via the worker-backed PineHost (host.ts): compile once per
  // source (AST cached by hash), run per data change with per-slot supersession (a fast replay
  // auto-advance coalesces to the latest tick), and a hard wall budget with real preemption. The
  // per-(script,data) result is memoized in pineCacheRef so a re-render with the SAME bar set (pan,
  // indicator toggle) rebuilds synchronously from cache with no worker round-trip or flicker.
  //
  // Cache key = source · params · symbol · tf · (len:lastTime). The AST cache inside the host is keyed
  // on source alone, so a bar-count change (replay/live) reuses the compiled AST and only re-runs.
  const pineDataSig = (rows: Bar[]) => (rows.length ? `${rows.length}:${rows[rows.length - 1].time}` : "0");
  const pineCacheKey = (script: PineScript, rows: Bar[]) =>
    `${script.source}\0${JSON.stringify(script.params)}\0${symbol}\0${timeframeRef.current}\0${pineDataSig(rows)}`;
  // Cache READER: fresh hit → { result, error }; miss → null (caller launches an async run).
  const pineCached = (script: PineScript, rows: Bar[]): { result: RunResult | null; error: string | null } | null => {
    const cached = pineCacheRef.current.get(script.id);
    return cached && cached.key === pineCacheKey(script, rows) ? { result: cached.result, error: cached.error } : null;
  };
  // Translate a host PineResult (or a caught crash) into the cache's { result, error } shape.
  const pineOutcome = (out: PineResult | null, crash?: unknown): { result: RunResult | null; error: string | null } => {
    if (crash !== undefined) return { result: null, error: (crash as any)?.message ? String((crash as any).message) : "Script crashed" };
    if (!out) return { result: null, error: "Script produced no output" };
    if (out.budgetExceeded) return { result: null, error: "Script exceeded the run budget (cancelled)" };
    if (!out.ok) { const e = out.errors[0]; return { result: null, error: e ? (e.line ? `Line ${e.line}: ${e.message}` : e.message) : "Script failed to run" }; }
    return { result: out.result, error: null };
  };
  // Launch an async host run for one script on `rows`, caching the outcome under the (script,data) key.
  // Returns the cache-shaped outcome. `cancelled` results (superseded by a newer same-slot run) are
  // dropped WITHOUT touching the cache so the newer run owns the entry. compile() is fire-and-forget to
  // warm the AST cache — run() also carries `source` so it self-compiles if the astId isn't cached yet.
  const runPineHost = async (script: PineScript, rows: Bar[]): Promise<{ result: RunResult | null; error: string | null } | null> => {
    const key = pineCacheKey(script, rows);
    const host = pineHost();
    // warm/refresh the AST cache when the source changed for this script
    const prevAst = pineAstRef.current.get(script.id);
    if (!prevAst || prevAst.source !== script.source) {
      pineAstRef.current.set(script.id, { source: script.source, astId: null });
      host.compile(script.source).then((c) => { if (pineAstRef.current.get(script.id)?.source === script.source) pineAstRef.current.set(script.id, { source: script.source, astId: c.astId }); }).catch(() => {});
    }
    let out: PineResult | null = null; let crash: unknown;
    try {
      out = await host.run({ slot: script.id, source: script.source, astId: pineAstRef.current.get(script.id)?.astId ?? undefined, bars: rows as any, inputs: script.params || {}, opts: { timeframe: timeframeRef.current, symbol }, budgetMs: PINE_RUNTIME_CAP_MS });
    } catch (e) { crash = e; }
    if (out && out.cancelled) return null;   // superseded → let the newer run win; don't cache
    if (out && out.astId && pineAstRef.current.get(script.id)?.source === script.source) pineAstRef.current.set(script.id, { source: script.source, astId: out.astId });
    const outcome = pineOutcome(out, crash);
    pineCacheRef.current.set(script.id, { key, ...outcome });
    return outcome;
  };

  // Map a Pine PlotKind → a Lightweight-Charts series on `pane`. Histogram/columns → HistogramSeries
  // (per-bar colors preserved); area → AreaSeries; everything else (line/stepline/circles/cross) → a
  // LineSeries. Returns the series (or null if the plot has no finite points).
  const addPinePlot = (chart: IChartApi, plot: RunResult["plots"][number], pane: number): ISeriesApi<any> | null => {
    const data = plot.data.filter((d) => d.value != null && isFinite(d.value));
    if (!data.length) return null;
    const lw = Math.max(1, plot.linewidth || 1) as any;
    let s: ISeriesApi<any>;
    if (plot.kind === "histogram" || plot.kind === "columns") {
      s = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, title: plot.title }, pane);
      s.setData(data.map((d) => ({ time: d.time, value: d.value, color: d.color || plot.color })) as any);
    } else if (plot.kind === "area") {
      s = chart.addSeries(AreaSeries, { lineColor: plot.color, topColor: plot.color, bottomColor: "rgba(0,0,0,0)", lineWidth: lw, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
      s.setData(data.map((d) => ({ time: d.time, value: d.value })) as any);
    } else {
      s = chart.addSeries(LineSeries, { color: plot.color, lineWidth: lw, lineStyle: plot.kind === "stepline" ? 0 : 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: plot.title }, pane);
      s.setData(data.map((d) => ({ time: d.time, value: d.value })) as any);
    }
    return s;
  };

  // Build ONE script's series onto the chart. Overlay scripts (meta.overlay) plot on the price pane
  // (pane 0); non-overlay scripts get their own sub-pane at index `subPane` (caller-assigned). hlines
  // → createPriceLine on the first series (or the price series for empty overlay scripts); shapes →
  // one markers plugin. Records series/markers/pane in the pine refs. Returns true if it got a pane.
  const buildPineScript = (script: PineScript, rows: Bar[], subPane: number): { ok: boolean; usedPane: boolean } => {
    const chart = chartRef.current, priceS = priceSeriesRef.current; if (!chart || !priceS) return { ok: false, usedPane: false };
    // Consume the memoized outcome (a fresh cache hit). Callers (buildAllPine) only invoke this for
    // scripts already resolved into pineCacheRef; a miss here means the async run hasn't landed yet.
    const outcome = pineCached(script, rows);
    if (!outcome) return { ok: false, usedPane: false };
    const { result, error } = outcome;
    if (error || !result) { pineErrRef.current.set(script.id, error || "Script produced no output"); return { ok: false, usedPane: false }; }
    pineErrRef.current.delete(script.id);
    const overlay = result.meta.overlay;
    const pane = overlay ? 0 : subPane;
    const series: ISeriesApi<any>[] = [];
    for (const plot of result.plots) { const s = addPinePlot(chart, plot, pane); if (s) series.push(s); }
    // hlines → price lines on the anchor series (first plot series, else the price series for overlays)
    const anchor = series[0] || (overlay ? priceS : null);
    if (anchor) for (const hl of result.hlines) { try { anchor.createPriceLine({ price: hl.price, color: hl.color, lineWidth: 1, lineStyle: hl.style === "dashed" ? 2 : hl.style === "dotted" ? 1 : 0, axisLabelVisible: true, title: hl.title } as any); } catch {} }
    // shapes → markers on the anchor series (only meaningful when there's a series to hang them on)
    if (anchor && result.shapes.length) {
      try {
        const markers = result.shapes.map((sh) => ({ time: sh.time as any, position: sh.position, shape: sh.shape, color: sh.color, text: sh.text }));
        const plugin = createSeriesMarkers(anchor, markers as any);
        pineMarkersRef.current.set(script.id, plugin);
      } catch {}
    }
    pineSeriesRef.current.set(script.id, series);
    // a non-overlay script claims its pane only if it actually rendered at least one series there
    const usedPane = !overlay && series.length > 0;
    if (usedPane) pinePaneMapRef.current.set(script.id, subPane);
    return { ok: true, usedPane };
  };

  // Remove EVERY tracked pine series + markers (price/compare/built-ins/drawings survive).
  const clearAllPine = () => {
    const chart = chartRef.current; if (!chart) return;
    for (const plugin of pineMarkersRef.current.values()) { try { plugin.detach(); } catch {} }
    pineMarkersRef.current.clear();
    for (const arr of pineSeriesRef.current.values()) for (const s of arr) { try { chart.removeSeries(s); } catch {} }
    pineSeriesRef.current.clear(); pinePaneMapRef.current.clear();
  };

  // Render every enabled script's series from the memo cache (synchronous). Non-overlay scripts append
  // sub-panes AFTER any built-in sub-panes (rsi/macd/…) in array order. Scripts without a fresh cache
  // entry are skipped (their series simply don't appear until the async run lands + triggers a rebuild).
  const paintPineFromCache = (rows: Bar[]) => {
    const chart = chartRef.current; if (!chart) return;
    const scripts = pineScriptsRef.current; if (!scripts.length) return;
    // next free pane = 1 + max(any built-in sub-pane index already assigned)
    let pane = 1;
    for (const idx of paneMapRef.current.values()) pane = Math.max(pane, idx + 1);
    for (const s of scripts) {
      const { usedPane } = buildPineScript(s, rows, pane);
      if (usedPane) pane++;
    }
  };

  // Build ALL enabled scripts onto `rows` via the worker host. FAST PATH: when every script already
  // has a fresh cache entry for this bar set (pan / indicator toggle — bars unchanged), paint
  // synchronously with no worker round-trip. SLOW PATH: any cache miss (replay tick, live splice,
  // edited/added script, TF/symbol change) launches async host runs; when the batch for THIS epoch
  // settles, clear + repaint the pine layer from the now-complete cache — guarded by pineEpochRef so a
  // stale batch (superseded by a newer rebuild) never paints over the current bars. Errors are captured
  // per-script (surfaced in the legend), never thrown. Callers invoke clearAllPine() before this, so on
  // the sync fast path we paint straight away; on the async path clearAllPine already emptied the layer.
  const buildAllPine = (rows: Bar[]) => {
    const chart = chartRef.current; if (!chart) return;
    const scripts = pineScriptsRef.current; if (!scripts.length) return;
    const epoch = ++pineEpochRef.current;
    const misses = scripts.filter((s) => pineCached(s, rows) === null);
    // paint whatever is already cached now (avoids a blank flash when only SOME scripts changed)
    paintPineFromCache(rows);
    if (!misses.length) return;   // fast path: everything was cached
    // slow path: run the misses off-thread, then rebuild the pine layer once they all resolve
    Promise.all(misses.map((s) => runPineHost(s, rows).catch(() => null))).then(() => {
      // Epoch guard: any newer buildAllPine() bumped pineEpochRef, so a stale batch (superseded by a
      // newer bar set / replay tick / edit) is dropped here and never paints over the current bars.
      if (pineEpochRef.current !== epoch) return;
      if (!chartRef.current) return;
      clearAllPine();
      paintPineFromCache(rows);
      normalizeStretch();
      applyHidden();
      renderSignalsRef.current();
      measureRef.current();
    });
  };

  // ── DT Technicals Suite builders ──────────────────────────────────────────
  // Ichimoku: tenkan + kijun lines in pane 0; cloud filled via SVG overlay in indOverlayRef.
  const buildIchimoku = (chart: IChartApi, rows: Bar[]): ISeriesApi<any>[] => {
    const p = P("ichimoku");
    const ich = ichimoku(rows, p.tenkan, p.kijun, p.senkouB, p.displacement);
    const tenS = chart.addSeries(LineSeries, { color: p.tenkanCol, lineWidth: p.width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: "Tenkan" }, 0);
    const kijS = chart.addSeries(LineSeries, { color: p.kijunCol, lineWidth: p.width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: "Kijun" }, 0);
    tenS.setData(rows.map((r, i) => ich.tenkan[i] != null ? { time: r.time, value: ich.tenkan[i]! } : null).filter(Boolean) as any);
    kijS.setData(rows.map((r, i) => ich.kijun[i] != null ? { time: r.time, value: ich.kijun[i]! } : null).filter(Boolean) as any);
    // Span A/B as lines displaced into the future
    const spAData: any[] = [], spBData: any[] = [];
    for (let i = 0; i < ich.futureTimes.length; i++) {
      if (ich.spanA[i] != null) spAData.push({ time: ich.futureTimes[i], value: ich.spanA[i]! });
      if (ich.spanB[i] != null) spBData.push({ time: ich.futureTimes[i], value: ich.spanB[i]! });
    }
    // Span A is the bullish edge of the cloud and Span B the bearish one — both ride the Up/Down
    // setting via p.spanACol/p.spanBCol (the fill params, opaque-ified here for the rails).
    const spAS = chart.addSeries(LineSeries, { color: withAlpha(p.spanACol, 0.6), lineWidth: 1 as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: "Span A" }, 0);
    const spBS = chart.addSeries(LineSeries, { color: withAlpha(p.spanBCol, 0.6), lineWidth: 1 as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: "Span B" }, 0);
    spAS.setData(spAData); spBS.setData(spBData);
    // Store cloud data for SVG polygon rendering
    indOverlayRef.current["ichimoku"] = { ich, futureTimes: ich.futureTimes };
    return [tenS, kijS, spAS, spBS];
  };

  // Ribbon: EMA lines in pane 0; fill + candle coloring via SVG overlay.
  const buildRibbon = (chart: IChartApi, rows: Bar[], closes: number[]): ISeriesApi<any>[] => {
    const p = P("ribbon");
    const rb = trendRibbon(rows, p.fast, p.slow, p.slopeWin);
    const fastS = chart.addSeries(LineSeries, { color: p.colUp, lineWidth: p.width as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: `EMA${p.fast}` }, 0);
    const slowS = chart.addSeries(LineSeries, { color: p.colDn, lineWidth: p.width as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: `EMA${p.slow}` }, 0);
    fastS.setData(toLine(rows, rb.emaFast));
    slowS.setData(toLine(rows, rb.emaSlow));
    indOverlayRef.current["ribbon"] = { rb, rows };
    // Apply candle colors if enabled; restore if toggled off (colorCandles=false) while ribbon stays active
    if (p.colorCandles) applyRibbonCandleColors(rows, rb, p);
    else restoreNormalCandleColors(rows);
    return [fastS, slowS];
  };

  // Apply per-bar candle colors for the ribbon indicator.
  const applyRibbonCandleColors = (rows: Bar[], rb: ReturnType<typeof trendRibbon>, p: Record<string, any>) => {
    const priceS = priceSeriesRef.current; if (!priceS) return;
    const chartTyp = chartTypeRef.current;
    if (isValueChartType(chartTyp)) return;
    const colored = rows.map((r, i) => {
      const st = rb.state[i], su = rb.shortUp[i];
      let col: string;
      // p.colUp/p.colDn already carry the Up/Down setting (and any user override); the weak
      // states are the same hue at 0.45 rather than a second hardcoded green/red.
      if (st === "ribbonUp") col = su ? p.colUp : withAlpha(p.colUp, 0.45);
      else if (st === "ribbonDown") col = su === false ? p.colDn : withAlpha(p.colDn, 0.45);
      else col = "#8b93a3";
      return chartTyp === "bars"
        ? { time: r.time, open: r.o, high: r.h, low: r.l, close: r.c, color: col }
        : { time: r.time, open: r.o, high: r.h, low: r.l, close: r.c, color: col, borderColor: col, wickColor: col };
    });
    try { priceS.setData(colored as any); } catch {}
  };

  // Restore normal candle colors (called when ribbon removed or colorCandles toggled off).
  const restoreNormalCandleColors = (rows: Bar[]) => {
    const priceS = priceSeriesRef.current; if (!priceS) return;
    const chartTyp = chartTypeRef.current;
    if (isValueChartType(chartTyp)) return;
    try { priceS.setData(priceData(rows) as any); } catch {}
  };

  // Premium suites: per-bar candle repaint (e.g. Structure Candles). Mirrors the ribbon pattern.
  // Key-guarded so the per-frame call from renderIndOverlays is a no-op unless the paint changed;
  // if ribbon colorCandles and a suite paint are both active, last writer wins (documented W0 limit).
  const applySuitePaint = () => {
    const priceS = priceSeriesRef.current; if (!priceS) return;
    const rows = barsRef.current; if (!rows.length) return;
    const chartTyp = chartTypeRef.current;
    if (isValueChartType(chartTyp) || chartTyp === "heikin") { suitePaintKeyRef.current = ""; return; }
    const active = Object.keys(SUITE_DEFS).filter((k) => indicatorsRef.current.has(k));
    let paint: { i: number; color?: string; borderColor?: string; wickColor?: string }[] = [];
    if (active.length) {
      if (!suiteColorsRef.current) suiteColorsRef.current = resolveSuiteColors();
      const lang = typeof document !== "undefined" && document.documentElement.getAttribute("data-lang") === "zh" ? "zh" as const : "en" as const;
      for (const k of active) {
        const def = peekSuiteRuntime(k); if (!def) { requestSuiteRuntime(k); continue; }   // fetch + repaint when it lands
        try {
          const b = computeSuite(def, suiteRenderParams(k), { bars: rows as any, tf: timeframeRef.current, symbol: symbolRef.current, isIntraday: isIntradayRef.current, lang }, userTierRef.current, suiteColorsRef.current!);
          if (b.candlePaint.length) paint = paint.concat(b.candlePaint);
        } catch { /* module errors surface via the render path */ }
      }
    }
    const last = rows[rows.length - 1];
    // djb2 over every entry (index, colors, channel presence) — a mode switch that repaints the same
    // bars with different colors must produce a different key (review finding W1-1)
    let ph = 5381;
    for (let n = 0; n < paint.length; n++) {
      const e = paint[n];
      ph = ((ph * 33) ^ e.i) >>> 0;
      ph = ((ph * 33) ^ ((e.borderColor ? 1 : 0) | (e.wickColor ? 2 : 0))) >>> 0;
      const c = (e.color ?? "") + (e.borderColor ?? "") + (e.wickColor ?? "");
      for (let ci = 0; ci < c.length; ci++) ph = ((ph * 33) ^ c.charCodeAt(ci)) >>> 0;
    }
    const key = paint.length ? `${rows.length}:${String(last?.time)}:${paint.length}:${ph}` : "";
    if (key === suitePaintKeyRef.current) return;
    const hadPaint = suitePaintKeyRef.current !== "";
    suitePaintKeyRef.current = key;
    if (!paint.length) { if (hadPaint) restoreNormalCandleColors(rows); return; }
    try { priceS.setData(paintCandleData(rows as any, paint, chartTyp === "bars" ? "bars" : "candles") as any); } catch {}
  };
  applySuitePaintRef.current = applySuitePaint;

  // SuperTrend: two line series (up/down rails with null gaps at flips).
  const buildSupertrend = (chart: IChartApi, rows: Bar[]): ISeriesApi<any>[] => {
    const p = P("supertrend");
    const st = supertrend(rows, p.period, p.mult);
    const upS = chart.addSeries(LineSeries, { color: p.colUp, lineWidth: p.width as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: "ST Up" }, 0);
    const dnS = chart.addSeries(LineSeries, { color: p.colDn, lineWidth: p.width as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: "ST Down" }, 0);
    upS.setData(rows.map((r, i) => st.up[i] != null ? { time: r.time, value: st.up[i]! } : null).filter(Boolean) as any);
    dnS.setData(rows.map((r, i) => st.down[i] != null ? { time: r.time, value: st.down[i]! } : null).filter(Boolean) as any);
    return [upS, dnS];
  };

  // AVWAP: dashed gold line. anchor 3 = vol_spike (trailing max-volume bar; earnings PROXY, not a
  // true earnings date).
  const buildAvwap = (chart: IChartApi, rows: Bar[]): ISeriesApi<any>[] => {
    const p = P("avwap");
    const anchors = ["swing_low", "swing_high", "max_history", "vol_spike"] as const;
    const anchorKey = anchors[Math.min(3, Math.max(0, Math.round(p.anchor)))] ?? "swing_low";
    const vals = computeAvwap(rows, anchorKey, p.lookback);
    const title = anchorKey === "vol_spike" ? "AVWAP (vol-spike, earnings proxy)" : "AVWAP";
    const ln = chart.addSeries(LineSeries, { color: p.col, lineWidth: p.width as any, lineStyle: 1 /* dashed */, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, title: axTitle(title) }, 0);
    ln.setData(toLine(rows, vals));
    return [ln];
  };

  // Rolling VWAP (trailing n-bar): solid teal line on the price pane.
  const buildRvwap = (chart: IChartApi, rows: Bar[]): ISeriesApi<any>[] => {
    const p = P("rvwap");
    const vals = rollingVwap(rows, p.length);
    const ln = chart.addSeries(LineSeries, { color: p.col, lineWidth: p.width as any, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, title: axTitle(`RVWAP ${p.length}`) }, 0);
    ln.setData(toLine(rows, vals));
    return [ln];
  };

  // Weekly VWAP (resets each W-FRI week): solid violet line on the price pane.
  const buildWvwap = (chart: IChartApi, rows: Bar[]): ISeriesApi<any>[] => {
    const p = P("wvwap");
    const vals = weekAnchoredVwap(rows);
    const ln = chart.addSeries(LineSeries, { color: p.col, lineWidth: p.width as any, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, title: axTitle("WVWAP") }, 0);
    ln.setData(toLine(rows, vals));
    return [ln];
  };

  // Volume Profile: pure SVG overlay, no LWC series; returns empty array.
  const buildVprofile = (rows: Bar[]): ISeriesApi<any>[] => {
    const p = P("vprofile");
    const vp = vprofile(rows, p.window, p.bins, p.shelfMode);
    indOverlayRef.current["vprofile"] = { vp, rows };
    return [];
  };

  // Volatility Box: pure SVG overlay.
  const buildVolbox = (rows: Bar[]): ISeriesApi<any>[] => {
    const p = P("volbox");
    const vb = volbox(rows, p.bbLen, p.mult, p.pctileWin, p.squeezePct, p.boxWin);
    indOverlayRef.current["volbox"] = { vb, rows };
    return [];
  };

  // RSI Stack: three RSI lines in a dedicated sub-pane.
  const buildRsiStack = (chart: IChartApi, rows: Bar[], pane: number): ISeriesApi<any>[] => {
    const p = P("rsistack");
    const rs = rsiStack(rows, p.len1, p.len2, p.len3);
    const s1 = chart.addSeries(LineSeries, { color: p.col1, lineWidth: p.width as any, lastValueVisible: true, title: axTitle(`RSI${p.len1}`) }, pane);
    const s2 = chart.addSeries(LineSeries, { color: p.col2, lineWidth: p.width as any, lastValueVisible: true, title: axTitle(`RSI${p.len2}`) }, pane);
    const s3 = chart.addSeries(LineSeries, { color: p.col3, lineWidth: p.width as any, lastValueVisible: true, title: axTitle(`RSI${p.len3}`) }, pane);
    s1.setData(toLine(rows, rs.r1)); s2.setData(toLine(rows, rs.r2)); s3.setData(toLine(rows, rs.r3));
    if (p.showLevels) {
      try { s2.createPriceLine({ price: p.ob, color: "rgba(214,218,227,.25)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false } as any); } catch {}
      try { s2.createPriceLine({ price: p.os, color: "rgba(214,218,227,.25)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false } as any); } catch {}
    }
    return [s1, s2, s3];
  };

  // Accumulation %: single line pane with reference bands.
  const buildAccum = (chart: IChartApi, rows: Bar[], pane: number): ISeriesApi<any>[] => {
    const p = P("accum");
    const vals = accumPct(rows, p.win);
    const ln = chart.addSeries(LineSeries, { color: "#4d82ff", lineWidth: 1.4 as any, lastValueVisible: true, title: axTitle("Accum%") }, pane);
    ln.setData(toLine(rows, vals));
    if (p.showBands) {
      for (const band of [75, 50, 35]) {
        try { ln.createPriceLine({ price: band, color: "rgba(214,218,227,.3)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "ref" } as any); } catch {}
      }
    }
    return [ln];
  };

  // ── Day Trade overlay builders ─────────────────────────────────────────────────────────────────
  // Helper: cast ChartPanel's Bar[] (time:string at type level, number at runtime for intraday) to IMBar[].
  const toIMBars = (rows: Bar[]): IMBar[] => rows as unknown as IMBar[];

  // buildSvwap: Session VWAP with volume-weighted σ bands and optional ±1σ SVG fill.
  // Intraday-only — returns [] on daily (caller gates, but builder also checks).
  const buildSvwap = (chart: IChartApi, rows: Bar[]): ISeriesApi<any>[] => {
    if (!isIntradayRef.current) return [];
    const p = P("svwap");
    const market = classify(symbolRef.current);
    const imBars = toIMBars(rows);
    const mults = [p.m1 as number, p.m2 as number, p.m3 as number];
    const result = sessionVwap(imBars, market, p.includePm as boolean, mults);
    const out: ISeriesApi<any>[] = [];
    // Main VWAP line — participates in autoscale
    const vwapS = chart.addSeries(LineSeries, {
      color: p.col as string, lineWidth: p.width as any,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    }, 0);
    vwapS.setData(toLine(rows, result.vwap));
    out.push(vwapS);
    // Band pairs (±1σ, ±2σ, ±3σ) — do NOT participate in autoscale
    const bandDefs = [
      { on: p.showB1 as boolean, col: p.b1Col as string, style: 2 /* dashed */ },
      { on: p.showB2 as boolean, col: p.b2Col as string, style: 2 },
      { on: p.showB3 as boolean, col: p.b3Col as string, style: 1 /* dotted */ },
    ];
    for (let k = 0; k < 3; k++) {
      const { on, col, style } = bandDefs[k];
      if (!on || !result.bands[k]) continue;
      const upS = chart.addSeries(LineSeries, {
        color: col, lineWidth: 1 as any, lineStyle: style,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null,
      }, 0);
      upS.setData(toLine(rows, result.bands[k].up));
      out.push(upS);
      const dnS = chart.addSeries(LineSeries, {
        color: col, lineWidth: 1 as any, lineStyle: style,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null,
      }, 0);
      dnS.setData(toLine(rows, result.bands[k].dn));
      out.push(dnS);
    }
    // Stash the result in indOverlayRef for the SVG fill pass in renderIndOverlays.
    indOverlayRef.current["svwap"] = { result, rows: [...rows], mults };
    return out;
  };

  // buildOrb: Opening Range box + rays — SVG-only (returns []).
  const buildOrb = (rows: Bar[]): ISeriesApi<any>[] => {
    if (!isIntradayRef.current) return [];
    const p = P("orb");
    const market = classify(symbolRef.current);
    const imBars = toIMBars(rows);
    const exts: number[] = [];
    if (p.ext1On) exts.push(p.ext1 as number);
    if (p.ext2On) exts.push(p.ext2 as number);
    const sessions = openingRange(imBars, market, p.rangeMin as number, exts);
    indOverlayRef.current["orb"] = { sessions, rows: [...rows] };
    return [];
  };

  // buildSlevels: Session Levels as createPriceLine on the price series.
  // Daily bars fetched from dailyCacheRef (populated async before this call in the intraday flow).
  const buildSlevels = (rows: Bar[]): ISeriesApi<any>[] => {
    removeIndPriceLines("slevels");   // defensive: never double-draw this key's lines
    if (!isIntradayRef.current) return [];
    const priceS = priceSeriesRef.current; if (!priceS) return [];
    const p = P("slevels");
    const market = classify(symbolRef.current);
    const imBars = toIMBars(rows);
    const daily = dailyCacheRef.current?.sym === symbolRef.current ? dailyCacheRef.current.bars : [];
    const levels = sessionLevels(imBars, market, daily);
    const styleFor = (key: string): { color: string; lineStyle: number; lineWidth: number } => {
      if (key === "PDH" || key === "PDL") return { color: p.pdCol as string, lineStyle: 0, lineWidth: 1 };
      if (key === "PDC") return { color: p.pdcCol as string, lineStyle: 2, lineWidth: 1 };
      if (key === "PMH" || key === "PML") return { color: p.pmCol as string, lineStyle: 2, lineWidth: 1 };
      if (key === "Open") return { color: p.openCol as string, lineStyle: 1 /* dotted */, lineWidth: 1 };
      if (key === "PWH" || key === "PWL") return { color: p.pwCol as string, lineStyle: 1, lineWidth: 1 };
      return { color: p.pdCol as string, lineStyle: 0, lineWidth: 1 };
    };
    for (const lv of levels) {
      const st = styleFor(lv.key);
      const on = {
        PDH: p.pdh, PDL: p.pdl, PDC: p.pdc, Open: p.open,
        PMH: p.pmh, PML: p.pml, PWH: p.pwh, PWL: p.pwl,
      }[lv.key] ?? true;
      if (!on) continue;
      try {
        const pl = priceS.createPriceLine({
          price: lv.value, color: st.color, lineWidth: st.lineWidth,
          lineStyle: st.lineStyle, axisLabelVisible: true, title: lv.label,
        } as any);
        pushIndPriceLine("slevels", pl);
      } catch {}
    }
    // slevels has no LWC series — store a sentinel so indSeriesRef has an entry (for OVERLAY_KEYS / Effect 3 tracking)
    return [];
  };

  // buildPivots: Pivot levels as createPriceLine on the price series.
  const buildPivots = (rows: Bar[]): ISeriesApi<any>[] => {
    removeIndPriceLines("pivots");    // defensive: never double-draw this key's lines
    if (!isIntradayRef.current) return [];
    const priceS = priceSeriesRef.current; if (!priceS) return [];
    const p = P("pivots");
    const daily = dailyCacheRef.current?.sym === symbolRef.current ? dailyCacheRef.current.bars : [];
    if (!daily.length) return [];
    // Prior completed daily bar = last bar whose date is strictly before today's intraday date
    const imBars = toIMBars(rows);
    if (!imBars.length) return [];
    // Derive today's session date from the last intraday bar (display-epoch → UTC date)
    const lastBarMs = (imBars[imBars.length - 1].time) * 1000;
    const todayStr = new Date(lastBarMs).toISOString().slice(0, 10);
    const priorDaily = daily.filter((d) => d.time < todayStr);
    if (!priorDaily.length) return [];
    const pd = priorDaily[priorDaily.length - 1];
    const modeMap = ["classic", "camarilla", "fib"] as const;
    const mode = modeMap[Math.max(0, Math.min(2, p.mode as number))] ?? "classic";
    const levels = pivotLevels({ h: pd.h, l: pd.l, c: pd.c }, mode);
    // Resolve up/down CSS vars at build time for East-Asian flip compliance.
    const resolvedUp = getComputedStyle(document.documentElement).getPropertyValue("--up").trim() || "rgba(38,194,129,0.65)";
    const resolvedDn = getComputedStyle(document.documentElement).getPropertyValue("--down").trim() || "rgba(240,86,107,0.65)";
    const extra = p.extra as boolean;
    for (const lv of levels) {
      const isR = lv.key.startsWith("R");
      const isS = lv.key.startsWith("S");
      const isPP = lv.key === "PP";
      // Skip R3/S3 and R4/S4 when extra is off
      if (!extra && (lv.key === "R3" || lv.key === "S3" || lv.key === "R4" || lv.key === "S4")) continue;
      const color = isPP ? (p.ppCol as string) : isR ? resolvedDn : isS ? resolvedUp : (p.ppCol as string);
      const lineWidth = isPP ? 2 : 1;
      try {
        const pl = priceS.createPriceLine({
          price: lv.value, color, lineWidth, lineStyle: 2 /* dashed */,
          axisLabelVisible: true, title: lv.label,
        } as any);
        pushIndPriceLine("pivots", pl);
      } catch {}
    }
    return [];
  };

  // buildOptLevels: Options Levels (R3.1) as createPriceLine on the price series.
  // Draws from optLevelsStateRef (populated by the fetch effect) — data-fed, so unlike
  // slevels/pivots there is nothing to compute from `rows`; the guard against a stale
  // root is the sym key on the state ref. Colors resolve from the options desk's level
  // convention at build time (LWC renders to canvas and cannot resolve var()); put wall
  // rides var(--down) so the East-Asian flip stays correct (directional-color law).
  const buildOptLevels = (): ISeriesApi<any>[] => {
    removeIndPriceLines("optlevels");   // defensive: never double-draw this key's lines
    const priceS = priceSeriesRef.current; if (!priceS) return [];
    const st = optLevelsStateRef.current;
    if (!st || st.sym !== symbolRef.current || st.status !== "ok" || !st.res) return [];
    // Never draw until this symbol's bars are on the canvas (see chartDataSymRef) — the
    // Effect-2 build path re-runs this builder right after setData, so nothing is lost.
    if (chartDataSymRef.current !== symbolRef.current) return [];
    const p = P("optlevels");
    const css = (n: string, fb: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
    const style: Record<string, { on: boolean; color: string; lineStyle: number; lineWidth: number; title: string }> = {
      call_wall: { on: p.cw !== false, color: css("--brand-2", "#4d82ff"), lineStyle: 0, lineWidth: 1, title: tPlain("olCw") },
      put_wall: { on: p.pw !== false, color: css("--down", "#f0566b"), lineStyle: 0, lineWidth: 1, title: tPlain("olPw") },
      gamma_flip: { on: p.flip !== false, color: css("--ai", "#9d86ff"), lineStyle: 2 /* dashed — signed estimate */, lineWidth: 1, title: tPlain("olFlip") },
      abs_gamma: { on: p.ags !== false, color: css("--signal", "#e8b339"), lineStyle: 1 /* dotted */, lineWidth: 1, title: tPlain("olAgs") },
      em_hi: { on: p.em !== false, color: css("--muted", "#8b93a3"), lineStyle: 1, lineWidth: 1, title: tPlain("olEmHi") },
      em_lo: { on: p.em !== false, color: css("--muted", "#8b93a3"), lineStyle: 1, lineWidth: 1, title: tPlain("olEmLo") },
    };
    for (const lv of st.res.levels) {
      const s = style[lv.key];
      if (!s || !s.on) continue;
      try {
        const pl = priceS.createPriceLine({
          price: lv.price, color: s.color, lineWidth: s.lineWidth,
          lineStyle: s.lineStyle, axisLabelVisible: true, title: s.title,
        } as any);
        pushIndPriceLine("optlevels", pl);
      } catch {}
    }
    // no LWC series — sentinel entry keeps OVERLAY_KEYS / Effect 3 tracking consistent
    return [];
  };

  // buildRvol: Relative Volume — histogram (slot) + line (cum) + 1.0 reference line.
  const buildRvol = (chart: IChartApi, rows: Bar[], pane: number): ISeriesApi<any>[] => {
    if (!isIntradayRef.current) return [];
    const p = P("rvol");
    const market = classify(symbolRef.current);
    const imBars = toIMBars(rows);
    const rv = rvolSeries(imBars, market, p.baseline as number);
    const out: ISeriesApi<any>[] = [];
    if (rv.sessionsUsed < 3) {
      // Insufficient history — return a dummy LineSeries with empty data so the pane renders
      const dummy = chart.addSeries(LineSeries, { lastValueVisible: true, title: axTitle("RVOL") }, pane);
      dummy.setData([]);
      out.push(dummy);
      indOverlayRef.current["rvol_nobase"] = true;
      return out;
    }
    indOverlayRef.current["rvol_nobase"] = false;
    const histS = chart.addSeries(HistogramSeries, {
      color: p.histCol as string,
      priceLineVisible: false, lastValueVisible: false,
    }, pane);
    histS.setData(rows.map((r, i) => rv.slot[i] != null ? { time: r.time, value: rv.slot[i]!, color: p.histCol as string } : null).filter(Boolean) as any);
    out.push(histS);
    const lineS = chart.addSeries(LineSeries, {
      color: p.lineCol as string, lineWidth: p.width as any,
      lastValueVisible: true, title: axTitle("RVOL"),
    }, pane);
    lineS.setData(toLine(rows, rv.cum));
    out.push(lineS);
    // 1.0 reference priceLine
    try { lineS.createPriceLine({ price: 1, color: "var(--muted)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "1.0" } as any); } catch {}
    // Stash for legend value
    indOverlayRef.current["rvol_last"] = rv.cum[rv.cum.length - 1] ?? null;
    return out;
  };

  // buildTtmsq: TTM Squeeze — momentum histogram + squeeze dots (SVG).
  const buildTtmsq = (chart: IChartApi, rows: Bar[], pane: number): ISeriesApi<any>[] => {
    const p = P("ttmsq");
    const imBars = toIMBars(rows);
    const sq = ttmSqueeze(imBars, p.len as number, p.bbMult as number, [1, 1.5, 2], p.momLen as number);
    // Resolve up/dn colors from CSS vars for 4-shade coloring
    const upC = getComputedStyle(document.documentElement).getPropertyValue("--up").trim() || "#26c281";
    const dnC = getComputedStyle(document.documentElement).getPropertyValue("--down").trim() || "#f0566b";
    // 4 shade function: rising-above-0 = up, falling-above-0 = up alpha, below-0 mirror with dn
    const momColor = (val: number, prev: number | null): string => {
      const rising = prev == null || val >= prev;
      if (val >= 0) return rising ? upC : upC + "99";
      return rising ? dnC + "99" : dnC;
    };
    const histData: any[] = [];
    for (let i = 0; i < rows.length; i++) {
      const v = sq.mom[i]; if (v == null) continue;
      const prev = i > 0 ? sq.mom[i - 1] : null;
      histData.push({ time: rows[i].time, value: v, color: momColor(v, prev) });
    }
    const histS = chart.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, pane);
    histS.setData(histData);
    // Squeeze-tier dots as series markers on the histogram (dots ONLY while squeezed — tier>0).
    // Non-directional intensity ramp (never --up/--down): tier 1 amber → tier 3 red.
    if (ttmsqMarkersRef.current) { try { ttmsqMarkersRef.current.detach(); } catch {} ttmsqMarkersRef.current = null; }
    if (p.showDots) {
      const TIER_COL: Record<number, string> = { 1: "#e8a33d", 2: "#e8734d", 3: "#f0566b" };
      const markers: any[] = [];
      for (let i = 0; i < rows.length; i++) {
        const t = sq.squeeze[i];
        if (t == null || t === 0) continue;
        markers.push({ time: rows[i].time, position: "inBar", shape: "circle", color: TIER_COL[t], size: 1 });
      }
      try {
        const plugin = createSeriesMarkers(histS, markers as any);
        ttmsqMarkersRef.current = plugin;
      } catch {}
    }
    return [histS];
  };

  // buildAdx: ADX with optional +DI/-DI lines and 20/25 hlines.
  const buildAdx = (chart: IChartApi, rows: Bar[], pane: number): ISeriesApi<any>[] => {
    const p = P("adx");
    const imBars = toIMBars(rows);
    const res = calcAdx(imBars, p.len as number);
    const out: ISeriesApi<any>[] = [];
    const adxS = chart.addSeries(LineSeries, {
      color: p.col as string, lineWidth: p.width as any,
      lastValueVisible: true, title: axTitle("ADX"),
    }, pane);
    adxS.setData(toLine(rows, res.adx));
    // 20 / 25 hlines
    try { adxS.createPriceLine({ price: 25, color: "rgba(214,218,227,.25)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "25" } as any); } catch {}
    try { adxS.createPriceLine({ price: 20, color: "rgba(214,218,227,.20)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "20" } as any); } catch {}
    out.push(adxS);
    if (p.showDi as boolean) {
      const upC = getComputedStyle(document.documentElement).getPropertyValue("--up").trim() || "#26c281";
      const dnC = getComputedStyle(document.documentElement).getPropertyValue("--down").trim() || "#f0566b";
      const diPlusS = chart.addSeries(LineSeries, { color: upC, lineWidth: 1 as any, lastValueVisible: true, title: axTitle("+DI") }, pane);
      diPlusS.setData(toLine(rows, res.diPlus));
      const diMinusS = chart.addSeries(LineSeries, { color: dnC, lineWidth: 1 as any, lastValueVisible: true, title: axTitle("-DI") }, pane);
      diMinusS.setData(toLine(rows, res.diMinus));
      out.push(diPlusS, diMinusS);
    }
    return out;
  };

  // buildCvd: Session CVD (approximate) as BaselineSeries at 0. Intraday-only.
  const buildCvd = (chart: IChartApi, rows: Bar[], pane: number): ISeriesApi<any>[] => {
    if (!isIntradayRef.current) return [];
    const upC = getComputedStyle(document.documentElement).getPropertyValue("--up").trim() || "#26c281";
    const dnC = getComputedStyle(document.documentElement).getPropertyValue("--down").trim() || "#f0566b";
    const imBars = toIMBars(rows);
    const vals = cvdApprox(imBars);
    const cvdS = chart.addSeries(BaselineSeries, {
      baseValue: { type: "price", price: 0 },
      topLineColor: upC, topFillColor1: upC + "33", topFillColor2: upC + "11",
      bottomLineColor: dnC, bottomFillColor1: dnC + "11", bottomFillColor2: dnC + "33",
      lastValueVisible: true, title: axTitle("Est. CVD"),
    } as any, pane);
    cvdS.setData(toLine(rows, vals));
    return [cvdS];
  };

  // Which sub-pane keys are active given the current indicator set (canonical order).
  const activeSubpanes = (): string[] => {
    const inds = indicatorsRef.current; const out: string[] = [];
    if (inds.has("rsi")) out.push("rsi");
    if (inds.has("stochrsi")) out.push("stochrsi");
    if (inds.has("macd")) out.push("macd");
    if (inds.has("rsistack")) out.push("rsistack");
    if (inds.has("accum")) out.push("accum");
    // DT sub-panes (intraday-only gating at build time, not here)
    if (inds.has("rvol")) out.push("rvol");
    if (inds.has("ttmsq")) out.push("ttmsq");
    if (inds.has("adx")) out.push("adx");
    if (inds.has("cvd")) out.push("cvd");
    // Premium pane suites still share one runtime pane per family. A table-only MTF dashboard does
    // not create an empty oscillator pane; as soon as any enabled module draws in the pane, the
    // family gets its single shared anchor.
    for (const k of paneSuiteKeys()) {
      if (inds.has(k) && activeSuiteModules(k).some((entry) => entry.surface === "pane")) out.push(k);
    }
    return out;
  };

  // ── pane sizing: collapse/maximize/normal, keyed by pane KEY so it survives indicator churn+reorder ──
  // applyStretch is the successor to the base's "price 3.4 / sub 1" normalize: same baseline, but it
  // also honors the collapsed set + the maximized pane (via paneCtl) and any user-dragged normal sizes.
  const applyStretch = () => {
    const ctl = paneCtl.current;
    // B2: on mobile, compute a minimum sub-pane floor so indicator panes are usable (~72-112px)
    const mobile = isMobileRef.current;
    const wH = wrapElRef.current?.clientHeight ?? 0;
    let mobileSubPx = 0;
    if (mobile && !ctl.maximized && wH > 50) {
      const n = panesMeta.current.filter((m) => !m.isPrice && !ctl.collapsed.has(m.key)).length;
      if (n > 0) {
        let subPx = Math.max(72, Math.min(112, wH * 0.16));
        if (wH - n * subPx < 2 * subPx) subPx = wH / (n + 2);
        mobileSubPx = subPx;
      }
    }
    for (const m of panesMeta.current) {
      let s: number;
      if (ctl.maximized) {
        s = m.key === ctl.maximized ? 1000 : 0.0001;
      } else if (ctl.collapsed.has(m.key)) {
        s = 0.06;
      } else if (mobile && !m.isPrice && mobileSubPx > 0) {
        // sub-pane gets equal share; price pane gets the remainder proportionally
        s = 1;
      } else {
        s = ctl.normal.get(m.key) ?? (m.isPrice ? 3.4 : 1);
      }
      // on mobile: override price pane factor to fill remaining space above sub-panes
      if (mobile && !ctl.maximized && m.isPrice && mobileSubPx > 0 && wH > 50) {
        const n = panesMeta.current.filter((x) => !x.isPrice && !ctl.collapsed.has(x.key)).length;
        s = Math.max(1.2, (wH - n * mobileSubPx) / mobileSubPx);
      }
      try { m.pane.setStretchFactor(s); } catch {}
    }
    applyMaximizeDom();
  };
  // Seamless maximize: stretch factors alone can't fully hide the other panes —
  // the library floors EVERY pane at 2px (adjustSizeImpl's Math.max(h, 2)) plus
  // 1px separator rows, so a "maximized" pane leaked compressed slivers of its
  // neighbors at the top/bottom. While maximized, DOM-hide every other pane row
  // and every separator row (each pane is a <tr>; separators are sibling <tr>s;
  // the last row is the time axis and stays). Restore display on exit. The wrap
  // background matches the chart background, so the few px the hidden rows gave
  // up are invisible below the time axis.
  const applyMaximizeDom = () => {
    const ctl = paneCtl.current;
    const paneEls: HTMLElement[] = [];
    let maxedEl: HTMLElement | null = null;
    for (const m of panesMeta.current) {
      try {
        const el = m.pane.getHTMLElement();
        if (el) { paneEls.push(el); if (ctl.maximized === m.key) maxedEl = el; }
      } catch {}
    }
    const tbody = paneEls[0]?.parentElement;
    if (!tbody) return;
    const rows = Array.from(tbody.children) as HTMLElement[];
    const paneRows = new Set<HTMLElement>(paneEls);
    const lastRow = rows[rows.length - 1]; // time-axis row
    for (const row of rows) {
      if (row === lastRow) continue; // time-axis row: its display is library-managed (timeScale.visible)
      const hide = maxedEl != null && (paneRows.has(row) ? row !== maxedEl : true);
      const want = hide ? "none" : "";
      if (row.style.display !== want) row.style.display = want;
    }
  };
  // legacy call-site name kept: every builder path calls normalizeStretch(). It now rebuilds the pane
  // registry (from the freshly-assigned paneMapRef), sizes via applyStretch, and re-applies the
  // eye/tf visibility to the freshly-built series.
  // C3 — createEngine only reaches the price pane's scale; every oscillator pane creates its own,
  // so an added indicator would ship the dense default pitch next to the thinned price axis.
  // Shell-only and a no-op on web, so the browser render is untouched.
  const applyPaneTickDensity = () => {
    if (!shellAxis()) return;
    const chart = chartRef.current; if (!chart) return;
    const tickMarkDensity = shellTickDensity();
    try { for (const p of chart.panes()) { try { p.priceScale("right").applyOptions({ tickMarkDensity } as any); } catch {} } } catch {}
  };
  const normalizeStretch = () => { rebuildPaneMeta(); applyStretch(); applyHidden(); applyPaneTickDensity(); };

  // a genuine separator drag (normal mode only) becomes the new baseline; ignore programmatic sizing
  const captureNormal = () => { const ctl = paneCtl.current; if (ctl.maximized) return; for (const m of panesMeta.current) { if (ctl.collapsed.has(m.key)) continue; try { ctl.normal.set(m.key, m.pane.getStretchFactor()); } catch {} } };

  // Legend swatch color for a script = its first rendered series' color (best-effort), else grey.
  const pineColorOf = (arr?: ISeriesApi<any>[]): string => {
    try { const c = (arr?.[0]?.options() as any)?.color || (arr?.[0]?.options() as any)?.lineColor; if (c) return c; } catch {}
    return tokensRef.current.mut || "#787b86";
  };
  // Build a LegendEntry for a custom script. `key` is the raw scriptId (isPine:true tells the shell
  // to route Settings to the pine branch + resolve remove/eye by scriptId). An error surfaces in the
  // label (⚠ suffix) and — because ChartOverlays doesn't take a tooltip — the shell can read it too.
  const pineLegendEntry = (s: PineScript, kind: "overlay" | "pane", series: ISeriesApi<any>[] | undefined, err?: string): Omit<LegendEntry, "hidden"> => ({
    key: s.id, label: err ? `${s.name} ⚠` : s.name, kind, isPine: true, color: pineColorOf(series),
  });

  // Rebuild the per-pane legend registry from the CURRENT indicator series + paneMapRef. The price pane
  // carries the active overlay entries (ema/bb/vwap/vol + overlay scripts); each sub-pane carries its own
  // indicator / script. Any stale collapse/normal entries for panes that no longer exist are pruned so
  // the sizing map can't leak.
  const rebuildPaneMeta = () => {
    const chart = chartRef.current, priceS = priceSeriesRef.current; if (!chart || !priceS) return;
    const inds = indicatorsRef.current;
    const overlayEntries: Omit<LegendEntry, "hidden">[] = [];
    // Golden Oracle Confluence: not a plotted series but the flagship signal layer (BUY/SELL marks +
    // verdict badge). List it FIRST on the price pane so it can be hidden (eye) or removed like any study.
    if (inds.has("_oracle")) overlayEntries.push({ key: "_oracle", label: "Golden Oracle Confluence", kind: "overlay", isPine: false, noParams: true });
    for (const k of ["ema", "bb", "vwap", "vol", "ichimoku", "ribbon", "supertrend", "avwap", "rvwap", "wvwap", "vprofile", "volbox", "svwap", "orb", "slevels", "pivots"] as const) {
      if (!inds.has(k)) continue;
      const hasEntry = indSeriesRef.current.has(k) || k === "vprofile" || k === "volbox" || k === "orb" || k === "slevels" || k === "pivots";
      if (!hasEntry) continue;
      // Intraday-only indicators: show amber "Intraday timeframes only" note on daily instead of hiding
      const intradayOnlyKeys = new Set(["svwap", "orb", "slevels", "pivots"]);
      if (intradayOnlyKeys.has(k) && !isIntradayRef.current) {
        overlayEntries.push({ key: k, label: `${labelOf(k)} — ${tPlain("intradayOnly")}`, kind: "overlay", isPine: false });
        continue;
      }
      overlayEntries.push({ key: k, label: labelOf(k), kind: "overlay", isPine: false });
    }
    // Gaps & Demand: signal-layer overlay (no plotted series, like the oracle) — drawn in renderSignals.
    // Registry-backed, so it keeps its Settings/Source/eye/remove menu.
    if (inds.has("gaps")) overlayEntries.push({ key: "gaps", label: labelOf("gaps"), kind: "overlay", isPine: false });
    // Options Levels (R3.1): data-fed price-line overlay — no plotted series. The legend row is
    // the overlay's provenance surface (discoverability law: annotate, never vanish): EOD session
    // date + the Tier-B "signed estimate" disclosure when drawn, otherwise WHY nothing is drawn
    // (non-US symbol, no coverage, entitlement, loading). Nightly EOD data — never a LIVE badge.
    if (inds.has("optlevels")) {
      const st = optLevelsStateRef.current;
      const fresh = st && st.sym === symbolRef.current ? st : null;
      let note: string;
      if (!optLevelsEligible(symbolRef.current)) note = tPlain("olUsOnly");
      else if (!fresh || fresh.status === "loading") note = tPlain("olLoading");
      else if (fresh.status === "ok" && fresh.res) {
        const d = fresh.res.asofDate;
        const age = d ? sessionsOldEt(d) : 0;
        // Tier discipline (§4.1): "signed estimate" rides ONLY when a dealer-signed level
        // (wall/flip) is drawn; an EM-only set is Tier A arithmetic and carries no disclosure.
        const parts = [
          d ? tPlain("olEod").replace("{date}", d.slice(5)) : "",
          fresh.res.signed ? tPlain("olSigned") : "",
          age > 3 ? tPlain("olStale").replace("{n}", String(age)) : "",
        ].filter(Boolean);
        // Undated + unsigned (a Tier-A-only set with a malformed asof): still say SOMETHING
        // about provenance rather than rendering a bare, unqualified row.
        note = parts.length ? parts.join(" · ") : tPlain("olNoDate");
      } else if (fresh.status === "empty") note = tPlain("olNoCov");
      else note = userTierRef.current === "free" ? tPlain("olGate") : tPlain("olUnavail");
      overlayEntries.push({ key: "optlevels", label: note ? `${labelOf("optlevels")} — ${note}` : labelOf("optlevels"), kind: "overlay", isPine: false });
    }
    // Lab signals: descriptive research markers (default OFF, drawn in renderSignals).
    // Intraday-only SUB-PANE indicators (rvol/cvd) on daily TFs: their builders return [] so the
    // sub-pane meta loop below has no pane to anchor a row to — surface them here in the price-pane
    // legend with the same amber note instead of silently vanishing (spec §4 discoverability law).
    if (!isIntradayRef.current) {
      for (const k of ["rvol", "cvd"] as const) {
        if (inds.has(k)) overlayEntries.push({ key: k, label: `${labelOf(k)} — ${tPlain("intradayOnly")}`, kind: "overlay", isPine: false });
      }
    }
    // TLT-R4: default OFF, labeled by signal name + direction glyph. No buy/sell wording.
    if (inds.has("_lab")) overlayEntries.push({ key: "_lab", label: "Lab Signals", kind: "overlay", isPine: false, noParams: true });
    // custom scripts: OVERLAY ones (or errored ones) list on the price pane; each SUB-PANE script gets
    // its own pane meta below. An errored script still gets a legend row so the user sees + can remove it.
    // On INTRADAY the pine build is skipped entirely (buildAllPine is date-keyed — see buildAllIndicators),
    // so NO series or engine error exists for any enabled script; surface an explicit "not available on
    // intraday" error on the row (⚠) instead of a phantom active-looking legend entry with no plot.
    for (const s of pineScriptsRef.current) {
      const err = isIntradayRef.current ? "Not available on intraday timeframes" : pineErrRef.current.get(s.id);
      const series = pineSeriesRef.current.get(s.id);
      const hasPane = pinePaneMapRef.current.has(s.id);
      if (hasPane) continue;   // sub-pane script → handled in the sub-pane loop
      overlayEntries.push(pineLegendEntry(s, "overlay", series, err));
    }
    // Premium modules are first-class legend rows. Overlay/candle/dashboard modules live with the
    // price pane; oscillator-drawing modules are grouped into their suite's one shared sub-pane.
    for (const sk of Object.keys(SUITE_DEFS)) {
      if (!inds.has(sk)) continue;
      const sdef = SUITE_DEFS[sk]; if (!sdef) continue;
      for (const entry of activeSuiteModules(sk)) {
        if (sdef.kind === "pane" && entry.surface === "pane") continue;
        overlayEntries.push({ key: entry.id, label: suiteLegendLabel(entry), kind: "overlay", isPine: false, noSource: true });
      }
    }
    // compare overlays: append to overlay entries so they appear as real legend rows in the price pane.
    const cmp = compareRef.current || []; const cfgM = compareCfgRef.current || {};
    for (let ci = 0; ci < cmp.length && ci < 4; ci++) { const cs = cmp[ci]; if (!cs || cs === symbol) continue; const cfg = cfgM[cs]; overlayEntries.push({ key: cmpKey(cs), label: cs, kind: "overlay", isPine: false, isCompare: true, color: cfg?.color || CMP_PALETTE[ci % CMP_PALETTE.length] }); }
    const metas: { key: string; removeKey?: string; isPrice: boolean; entries: Omit<LegendEntry, "hidden">[]; pane: IPaneApi<any> }[] = [];
    metas.push({ key: "__price__", isPrice: true, entries: overlayEntries, pane: priceS.getPane() });
    for (const key of [...SUBPANE_ORDER, ...paneSuiteKeys()]) {
      const arr = indSeriesRef.current.get(key); if (!arr || !arr.length) continue;
      const sdefPane = getSuiteDef(key);
      const entries: Omit<LegendEntry, "hidden">[] = sdefPane
        ? activeSuiteModules(key)
            .filter((entry) => entry.surface === "pane")
            .map((entry) => ({ key: entry.id, label: suiteLegendLabel(entry), kind: "pane" as const, isPine: false, noSource: true }))
        : [{
            key,
            // rvol with an insufficient baseline (<3 prior sessions) carries the honest-null note
            label: key === "rvol" && indOverlayRef.current["rvol_nobase"]
              ? `${labelOf(key)} — ${tPlain("rvolNoBase")}`
              : labelOf(key),
            kind: "pane" as const, isPine: false,
          }];
      if (!entries.length) continue;
      metas.push({
        key,
        ...(sdefPane ? { removeKey: `suite-pane:${key}` } : {}),
        isPrice: false,
        entries,
        pane: arr[0].getPane(),
      });
    }
    // pine SUB-PANE scripts, in their assigned-pane order
    for (const s of pineScriptsRef.current) {
      if (!pinePaneMapRef.current.has(s.id)) continue;
      const arr = pineSeriesRef.current.get(s.id); if (!arr || !arr.length) continue;
      metas.push({ key: pineKeyOf(s.id), isPrice: false, entries: [pineLegendEntry(s, "pane", arr, pineErrRef.current.get(s.id))], pane: arr[0].getPane() });
    }
    const prevKeys = new Set(panesMeta.current.map((m) => m.key));
    panesMeta.current = metas;
    // prune sizing/collapse state for panes that no longer exist
    const surv = new Set(metas.map((m) => m.key)); const ctl = paneCtl.current;
    for (const k of Array.from(ctl.collapsed)) if (!surv.has(k)) ctl.collapsed.delete(k);
    for (const k of Array.from(ctl.normal.keys())) if (!surv.has(k)) ctl.normal.delete(k);
    if (ctl.maximized && !surv.has(ctl.maximized)) ctl.maximized = null;
    // a brand-new pane appearing (indicator/script just added) exits maximize — otherwise the
    // new pane would be born flattened to ~2px behind the maximized one and look silently broken
    if (ctl.maximized && metas.some((m) => !prevKeys.has(m.key))) ctl.maximized = null;
    // re-observe pane elements so separator drags / collapses reposition the overlay + rebaseline
    const pRO = paneRORef.current; if (pRO) { try { pRO.disconnect(); } catch {} for (const m of metas) { try { const pe = m.pane.getHTMLElement(); if (pe) pRO.observe(pe); } catch {} } }
    measureRef.current();
    // B3: notify parent of sub-pane count changes so TerminalShell can grow the chart container
    const subPaneCount = metas.filter((m) => !m.isPrice).length;
    if (subPaneCount !== lastPaneCountRef.current) { lastPaneCountRef.current = subPaneCount; onPaneCountRef.current?.(subPaneCount); }
  };

  // ── pane-control operations (read chart refs; safe to recreate every render) ──
  const keyOfPaneIndex = (pi: number) => { const m = panesMeta.current.find((x) => { try { return x.pane.paneIndex() === pi; } catch { return false; } }); return m?.key ?? null; };
  const measure = () => measureRef.current();
  // toggle-off is always allowed; toggle-ON is a no-op when there is no other pane to hide (a lone
  // price pane already fills the chart — setting invisible sticky state would flatten panes added later)
  // after toggling, re-render the price-pane-anchored overlay layers (signals/gap zones, drawings,
  // ind fills, price tag) — they gate themselves off while a sub-pane is maximized and must clear/
  // restore NOW, not on the next pan/zoom.
  const rerenderOverlays = () => { try { renderSignalsRef.current(); renderRef.current(); renderTagRef.current?.(); } catch {} };

  const doMaximize = (pi: number) => { const key = keyOfPaneIndex(pi); if (!key) return; const ctl = paneCtl.current; if (ctl.maximized === key) ctl.maximized = null; else { if (panesMeta.current.length <= 1) return; ctl.maximized = key; ctl.collapsed.delete(key); } applyStretch(); rerenderOverlays(); requestAnimationFrame(() => { measure(); rerenderOverlays(); }); };
  const doCollapse = (pi: number) => { const key = keyOfPaneIndex(pi); if (!key) return; const ctl = paneCtl.current; ctl.maximized = null; if (ctl.collapsed.has(key)) ctl.collapsed.delete(key); else ctl.collapsed.add(key); applyStretch(); rerenderOverlays(); requestAnimationFrame(() => { measure(); rerenderOverlays(); }); };
  // applyStretch() after the swap re-runs applyMaximizeDom so the row-hiding tracks the panes'
  // NEW positions if anything ever moves a pane while maximized (the ops buttons are gated off
  // in that state, but programmatic paths stay safe).
  const doMove = (pi: number, dir: -1 | 1) => { const ch = chartRef.current; if (!ch) return; const tgt = pi + dir; let n = 1; try { n = ch.panes().length; } catch {} if (tgt < 0 || tgt >= n) return; try { ch.swapPanes(pi, tgt); } catch {} applyStretch(); rerenderOverlays(); requestAnimationFrame(() => { measure(); rerenderOverlays(); }); };
  // moves are disabled while a pane is maximized: the overlay layout is filtered to the single
  // visible pane then (up/down would disagree), and reordering an invisible stack is meaningless.
  const canMoveUp = (pi: number) => !paneCtl.current.maximized && pi > 0;
  const canMoveDown = (pi: number) => { if (paneCtl.current.maximized) return false; let n = paneLayoutRef.current.length; try { const ch = chartRef.current; if (ch) n = ch.panes().length; } catch {} return pi < n - 1; };
  // visibility-on-intervals: is this indicator allowed to show on the current timeframe? (Settings → Visibility)
  const tfVisible = (k: string) => {
    const v = (indParamsRef.current[k] || {})._vis; if (!v) return true;
    const m = /^(\d*)([DWM])$/.exec(timeframeRef.current); if (!m) return true;   // intraday tf → no _vis gating
    const n = parseInt(m[1] || "1", 10) || 1;
    const u = m[2] === "D" ? v.days : m[2] === "W" ? v.weeks : v.months;
    return !u ? true : (u.on !== false && n >= (u.min ?? 1) && n <= (u.max ?? 1e9));
  };
  // flip series visibility (eye toggle + tf-visibility) WITHOUT a chart/series rebuild
  const applyHidden = () => {
    const h = hiddenRef.current; const SB = indSeriesRef.current;
    for (const [k, arr] of SB) {
      const vis = !h.has(k) && tfVisible(k); for (const s of arr) { try { s.applyOptions({ visible: vis } as any); } catch {} }
    }
    // price-line-only overlays (slevels/pivots/optlevels) plot no series — the eye must flip
    // their pooled IPriceLines directly or the toggle silently no-ops on them.
    for (const [k, lines] of indPriceLinesRef.current) {
      const vis = !h.has(k) && tfVisible(k);
      for (const pl of lines) { try { pl.applyOptions({ lineVisible: vis, axisLabelVisible: vis } as any); } catch {} }
    }
    // custom scripts: eye toggle by scriptId (no tf-visibility gating — scripts don't declare _vis)
    for (const [id, arr] of pineSeriesRef.current) { const vis = !h.has(id); for (const s of arr) { try { s.applyOptions({ visible: vis } as any); } catch {} } }
    // compare series: eye toggle by cmpKey(sym)
    for (const [sym, s] of cmpSeriesRef.current) { try { s.applyOptions({ visible: !h.has(cmpKey(sym)) } as any); } catch {} }
  };

  // Remove EVERY tracked indicator series (price/compare/drawings survive). Used by the bounded rebuild.
  const clearAllIndicators = () => {
    const chart = chartRef.current; if (!chart) return;
    // Detach marker plugins (ttmsq dots, macd crossover dots) BEFORE removing their host series.
    if (ttmsqMarkersRef.current) { try { ttmsqMarkersRef.current.detach(); } catch {} ttmsqMarkersRef.current = null; }
    if (macdMarkersRef.current) { try { macdMarkersRef.current.detach(); } catch {} macdMarkersRef.current = null; }
    for (const arr of indSeriesRef.current.values()) for (const s of arr) { try { chart.removeSeries(s); } catch {} }
    indSeriesRef.current.clear(); paneMapRef.current.clear();
    indOverlayRef.current = {};
    // Remove price lines set on the price series by slevels / pivots (they survive removeSeries of other series).
    removeIndPriceLines();
  };

  // Build the full indicator set from scratch in canonical order onto `rows`.
  // Overlays first (pane 0), then sub-panes appended sequentially → assigns paneMapRef.
  // Pane-suite anchor: one transparent series pinning the suite's fixed y-range (autoscaleInfoProvider)
  // plus its static guide lines. All suite chrome renders in the SVG pass with pane-local mapping.
  const buildSuitePane = (chart: IChartApi, rows: Bar[], key: string, pane: number): ISeriesApi<any>[] => {
    const def = getSuiteDef(key); if (!def || def.kind !== "pane" || !def.pane || !rows.length) return [];
    const { min, max } = def.pane;
    const anchor = chart.addSeries(LineSeries, {
      color: "rgba(0,0,0,0)", lineWidth: 1 as any, lastValueVisible: false, priceLineVisible: false,
      crosshairMarkerVisible: false,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: min, maxValue: max } }),
    } as any, pane);
    const mid = (min + max) / 2;
    try { anchor.setData([{ time: rows[0].time as any, value: mid }, { time: rows[rows.length - 1].time as any, value: mid }]); } catch {}
    for (const ln of def.pane.lines ?? []) {
      try { anchor.createPriceLine({ price: ln.p, color: "rgba(214,218,227,.22)", lineWidth: 1, lineStyle: ln.dashed ? 2 : 0, axisLabelVisible: true, title: ln.label ?? String(ln.p) } as any); } catch {}
    }
    return [anchor];
  };

  const buildAllIndicators = (rows: Bar[], closes: number[]) => {
    const chart = chartRef.current; if (!chart) return; const inds = indicatorsRef.current;
    suitePaintKeyRef.current = "";   // series data was just (re)set — force suite paint re-evaluation
    // Clear SVG overlay data for overlays being rebuilt
    indOverlayRef.current = {};
    if (inds.has("ema")) indSeriesRef.current.set("ema", buildEma(chart, rows, closes));
    if (inds.has("bb")) indSeriesRef.current.set("bb", buildBb(chart, rows, closes));
    if (inds.has("vwap")) indSeriesRef.current.set("vwap", buildVwap(chart, rows));
    if (inds.has("vol")) indSeriesRef.current.set("vol", buildVol(chart, rows));
    // DT overlay indicators
    if (inds.has("ichimoku")) indSeriesRef.current.set("ichimoku", buildIchimoku(chart, rows));
    if (inds.has("ribbon")) indSeriesRef.current.set("ribbon", buildRibbon(chart, rows, closes));
    if (inds.has("supertrend")) indSeriesRef.current.set("supertrend", buildSupertrend(chart, rows));
    if (inds.has("avwap")) indSeriesRef.current.set("avwap", buildAvwap(chart, rows));
    if (inds.has("rvwap")) indSeriesRef.current.set("rvwap", buildRvwap(chart, rows));
    if (inds.has("wvwap")) indSeriesRef.current.set("wvwap", buildWvwap(chart, rows));
    if (inds.has("vprofile")) indSeriesRef.current.set("vprofile", buildVprofile(rows));
    if (inds.has("volbox")) indSeriesRef.current.set("volbox", buildVolbox(rows));
    // DT price-pane overlays (intraday-only; builders return [] on daily)
    if (inds.has("svwap")) indSeriesRef.current.set("svwap", buildSvwap(chart, rows));
    if (inds.has("orb")) indSeriesRef.current.set("orb", buildOrb(rows));
    if (inds.has("slevels")) indSeriesRef.current.set("slevels", buildSlevels(rows));
    if (inds.has("pivots")) indSeriesRef.current.set("pivots", buildPivots(rows));
    if (inds.has("optlevels")) indSeriesRef.current.set("optlevels", buildOptLevels());
    // If ribbon is NOT active, ensure normal candle colors
    if (!inds.has("ribbon")) restoreNormalCandleColors(rows);
    let pane = 1;
    for (const key of activeSubpanes()) {
      let series: ISeriesApi<any>[] = [];
      if (key === "rsi") series = buildRsiPane(chart, rows, closes, pane);
      else if (key === "stochrsi") series = buildStochRsiPane(chart, rows, closes, pane);
      else if (key === "macd") series = buildMacd(chart, rows, closes, pane);
      else if (key === "rsistack") series = buildRsiStack(chart, rows, pane);
      else if (key === "accum") series = buildAccum(chart, rows, pane);
      else if (key === "rvol") series = buildRvol(chart, rows, pane);
      else if (key === "ttmsq") series = buildTtmsq(chart, rows, pane);
      else if (key === "adx") series = buildAdx(chart, rows, pane);
      else if (key === "cvd") series = buildCvd(chart, rows, pane);
      else if (isSuiteKeyReg(key)) series = buildSuitePane(chart, rows, key, pane);
      series = keepIndicatorPaneAxisLabelsOnly(series);
      indSeriesRef.current.set(key, series);
      // Claim the pane index (and advance the counter) ONLY when the builder actually rendered ≥1 series.
      // rvol/cvd return [] on daily (intraday-only). Setting paneMapRef + incrementing `pane` for an empty
      // builder desyncs the requested-pane counter from the real pane count, so a LATER multi-series builder
      // (e.g. ADX with +DI/−DI) splits across two panes: getOrCreatePane clamps an out-of-range index to
      // panes.length, creating a phantom pane that has no panesMeta entry. Mirrors buildPineScript's usedPane.
      if (series.length > 0) { paneMapRef.current.set(key, pane); pane++; }
    }
    // custom scripts always ride along a full indicator rebuild (bars/indicator/replay change): rebuild
    // them on the SAME on-chart `rows` so their series align with the visible bars. runPineMemo caches
    // per script, so unchanged scripts don't recompute; only a fresh bar set / edited script re-runs.
    // Skipped on intraday (bars carry a NUMERIC epoch `time`; the engine's date math assumes "YYYY-MM-DD").
    clearAllPine();
    if (!isIntradayRef.current) buildAllPine(rows);
    normalizeStretch();
    builtIndicatorRef.current = { generation: epochRef.current, key: indicatorSetKey(inds) };
  };

  // Update EXISTING indicator series in-place via setData (no removeSeries/addSeries).
  // Safe to call only when the indicator SET is unchanged (same keys in indSeriesRef).
  // Used by Effect 2 on same-symbol timeframe/chartType switches to avoid the DOM series lifecycle cost.
  const updateAllIndicators = (rows: Bar[], closes: number[]) => {
    const inds = indicatorsRef.current; const SB = indSeriesRef.current;
    if (!SB.size) return;  // nothing to update (no indicators active)
    // NOTE: pane suites never reach this in-place path (INPLACE_KEYS excludes suite keys), so the
    // TF-switch re-span happens via the full rebuild in buildSuitePane — do not add a loop here.
    // overlays
    if (inds.has("ema")) {
      const sArr = SB.get("ema"); const p = P("ema");
      const configs = ([[p.ma1On, p.ma1Len], [p.ma2On, p.ma2Len], [p.ma3On, p.ma3Len]] as [boolean, number][]).filter(([on]) => on);
      if (sArr) configs.forEach(([, len], i) => { if (sArr[i]) sArr[i].setData(toLine(rows, ema(closes, len))); });
    }
    if (inds.has("bb")) {
      const sArr = SB.get("bb"); const p = P("bb");
      const basis = sma(closes, p.length); const sd = stddev(closes, p.length);
      const up = closes.map((_, i) => (basis[i] != null && sd[i] != null ? basis[i]! + p.mult * sd[i]! : null));
      const lo = closes.map((_, i) => (basis[i] != null && sd[i] != null ? basis[i]! - p.mult * sd[i]! : null));
      if (sArr) { [up, basis, lo].forEach((arr, j) => { if (sArr[j]) sArr[j].setData(toLine(rows, arr)); }); }
    }
    if (inds.has("vwap")) {
      const sArr = SB.get("vwap"); if (sArr?.[0]) { let cum = 0, cumv = 0; const vw = rows.map((r) => { const tp = (r.h + r.l + r.c) / 3; cum += tp * r.v; cumv += r.v; return cumv ? cum / cumv : null; }); sArr[0].setData(toLine(rows, vw)); }
    }
    if (inds.has("vol")) {
      const sArr = SB.get("vol"); if (sArr?.[0]) sArr[0].setData(volData(rows));
    }
    // sub-pane oscillators
    if (SB.has("rsi")) {
      const sArr = SB.get("rsi")!; const p = P("rsi");
      if (sArr[0]) sArr[0].setData(toLine(rows, rsi(closes, p.length)));
    }
    if (SB.has("stochrsi")) {
      const sArr = SB.get("stochrsi")!; const p = P("stochrsi"); const sr = cmStoch(rows.map(r => r.h), rows.map(r => r.l), closes, p.length, p.smoothK, p.smoothD);
      if (sArr[0]) sArr[0].setData(toLine(rows, sr.k));
      if (sArr[1]) sArr[1].setData(toLine(rows, sr.d));
      if (sArr[2]) sArr[2].setData(stochHiData(rows, sr.k, sr.d, p.upLine, p.lowLine) as any);   // refresh crossover-highlight bars
    }
    if (SB.has("macd")) {
      const sArr = SB.get("macd")!; const p = P("macd"); const m = rsiMacd(closes, p.rsiLen, p.fastLen, p.baseLen, p.signalLen);
      if (sArr[0]) sArr[0].setData(rows.map((r, i) => (m.hist[i] != null ? { time: r.time, value: m.hist[i]!, color: m.hist[i]! >= 0 ? p.upHist : p.downHist } : null)).filter(Boolean) as any);
      if (sArr[1]) sArr[1].setData(toLine(rows, m.line));
      if (sArr[2]) sArr[2].setData(toLine(rows, m.sig));
      if (sArr[1]) applyMacdMarkers(sArr[1], rows, m.line, m.sig);   // refresh crossover dots on the line series
    }
  };

  // Build indDataMapRef: time → {indKey: value} for every active built-in indicator.
  // Keys match the indCols `key` field (same as the indicator id: "ema", "rsi", etc.) so ChartTableView
  // can look them up directly. Multi-line indicators (EMA, BB) expose their first/primary line value.
  const buildIndDataMap = (rows: Bar[], closes: number[]) => {
    const inds = indicatorsRef.current;
    const m = new Map<string, Record<string, number | null>>();
    const slot = (t: string | number) => { const k = String(t); if (!m.has(k)) m.set(k, {}); return m.get(k)!; };
    if (inds.has("ema")) {
      const p = P("ema");
      // Expose the first active EMA line under "ema" so the column always has a value
      const [on1, len1] = [p.ma1On as boolean, p.ma1Len as number];
      const [on2, len2] = [p.ma2On as boolean, p.ma2Len as number];
      const [on3, len3] = [p.ma3On as boolean, p.ma3Len as number];
      const activeLen = on1 ? len1 : on2 ? len2 : on3 ? len3 : null;
      if (activeLen != null) { const vals = ema(closes, activeLen); rows.forEach((r, i) => { slot(r.time)["ema"] = vals[i] ?? null; }); }
    }
    if (inds.has("bb")) {
      const p = P("bb"); const basis = sma(closes, p.length);
      rows.forEach((r, i) => { slot(r.time)["bb"] = basis[i] ?? null; });
    }
    if (inds.has("vwap")) {
      let cum = 0, cumv = 0; rows.forEach((r) => { const tp = (r.h + r.l + r.c) / 3; cum += tp * r.v; cumv += r.v; slot(r.time)["vwap"] = cumv ? cum / cumv : null; });
    }
    if (inds.has("rsi")) {
      const p = P("rsi"); const rsiVals = rsi(closes, p.length);
      rows.forEach((r, i) => { slot(r.time)["rsi"] = rsiVals[i] ?? null; });
    }
    if (inds.has("stochrsi")) {
      const p = P("stochrsi"); const sr = cmStoch(rows.map(r => r.h), rows.map(r => r.l), closes, p.length, p.smoothK, p.smoothD);
      // expose %K under "stochrsi" (the primary line shown in the legend)
      rows.forEach((r, i) => { slot(r.time)["stochrsi"] = sr.k[i] ?? null; });
    }
    if (inds.has("macd")) {
      const p = P("macd"); const mv = rsiMacd(closes, p.rsiLen, p.fastLen, p.baseLen, p.signalLen);
      rows.forEach((r, i) => { slot(r.time)["macd"] = mv.line[i] ?? null; });
    }
    indDataMapRef.current = m;
    // Publish the stable getter to the parent (TerminalShell → ChartTableView)
    onIndRowsAtRef.current?.((barTime) => indDataMapRef.current.get(String(barTime)) ?? {});
  };

  // Rebuild ONLY the compare overlays onto `rows` (used by data + replay effects).
  const rebuildCompare = async (rows: Bar[], epoch: number) => {
    // Compare has its OWN generation token: two rapid compare edits share the same symbol `epoch`
    // (epochRef only bumps in Effect 2), so without this a superseded run would resume after its
    // await and re-add series into a map the winning run has already repopulated → orphaned line + leak.
    const gen = ++cmpGenRef.current;
    const chart = chartRef.current; if (!chart) return;
    for (const s of cmpSeriesRef.current.values()) { try { chart.removeSeries(s); } catch {} }
    cmpSeriesRef.current.clear();
    const prec = precRef.current; const cmp = compareRef.current || [];
    for (let ci = 0; ci < cmp.length && ci < 4; ci++) {
      const cs = cmp[ci]; if (!cs || cs === symbol) continue;
      const co = await getJSON(`/data/${cs}.json`);
      if (cmpGenRef.current !== gen || epochRef.current !== epoch) return;   // superseded compare run OR symbol/tf changed mid-fetch — abandon this build
      if (!co?.bars?.length) continue;
      let crows: Bar[] = co.bars.map((b: any[]) => ({ time: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }));
      crows = resampleTf(crows, timeframeRef.current);
      const cmap: Record<string, number> = {}; for (const cr of crows) cmap[cr.time] = cr.c;
      const cfg = compareCfgRef.current[cs] || defaultCmpCfg(ci);
      let lv: number | null = null;
      let cdata: any[];
      if (cfg.mode === "price") {
        cdata = rows.map((r) => { const v = cmap[r.time]; if (v != null) lv = v; return lv != null ? { time: r.time, value: +lv.toFixed(prec) } : null; }).filter(Boolean);
        const ln = chart.addSeries(LineSeries, { color: cfg.color, lineWidth: cfg.lineWidth as any, lineStyle: cfg.lineStyle as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: cs, priceScaleId: cmpKey(cs), visible: !hiddenRef.current.has(cmpKey(cs)) }, 0);
        ln.setData(cdata as any); cmpSeriesRef.current.set(cs, ln);
      } else {
        let bse = 0, baseA = rows[0]?.c ?? 0; for (const r of rows) { if (cmap[r.time] != null) { bse = cmap[r.time]; baseA = r.c; break; } }
        if (!bse) continue; const scl = baseA / bse;
        cdata = rows.map((r) => { const v = cmap[r.time]; if (v != null) lv = v; return lv != null ? { time: r.time, value: +(lv * scl).toFixed(prec) } : null; }).filter(Boolean);
        const ln = chart.addSeries(LineSeries, { color: cfg.color, lineWidth: cfg.lineWidth as any, lineStyle: cfg.lineStyle as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: cs, visible: !hiddenRef.current.has(cmpKey(cs)) }, 0);
        ln.setData(cdata as any); cmpSeriesRef.current.set(cs, ln);
      }
    }
  };

  // Client-Pine FALLBACK: run the ungated v1 confluence Pine (ORACLE_V1_PINE) on the DAILY bars and
  // map its ★ / CUT / RE-BUY plotshapes to signal dates. Reached only when the slice ships no signal
  // history (resolveSigMarks) — the v1 lane is unscored, so its marks carry no quality/tier. Memoized
  // per (symbol · daily length · last daily date) so the Pine runs at most once per symbol load.
  const oracleSignals = (daily: Bar[]) => {
    const key = `${symbolRef.current}|${daily.length}|${daily[daily.length - 1]?.time ?? ""}`;
    if (oracleMemoRef.current.key === key) return oracleMemoRef.current.sig;
    const sig: { ts: string; type: string }[] = [];
    try {
      const out = runPine(ORACLE_V1_PINE, daily as any, { timeframe: "D", symbol: symbolRef.current });
      if (out.ok && out.result) {
        for (const sh of out.result.shapes) {
          // ★ discriminates BUY (below the bar) vs SELL (above); CUT / RE-BUY carry their own label.
          const type = sh.text === "★" ? (sh.position === "aboveBar" ? "SELL" : "BUY")
            : sh.text === "CUT" ? "CUT" : sh.text === "RE-BUY" ? "REBUY" : null;
          if (type) sig.push({ ts: String(sh.time), type });
        }
      }
    } catch { /* engine error → no marks */ }
    oracleMemoRef.current = { key, sig };
    return sig;
  };
  // Resolve BUY/SELL/CUT/REBUY/RECLAIM marks against the CURRENT bar set. PRIMARY source is the
  // slice's signal stream (indicator.signals — the scored GC-v2 lane the rail card reads; the nightly
  // regen ships full history universe-wide, and the flagship 5-min rewrites preserve it), so chart
  // marks and the panel verdict can never contradict. Each signal snaps to the nearest bar (intraday /
  // replay / resampled views line up) and carries quality/tier/quality_reason so renderSignals
  // subordinates engine-refused entries — a soft {pending, block, regime_blocked} mark must never
  // wear the scored style (signalVerdict SOFT_Q contract). Slice absent or signal-less (composites,
  // fixtures, names outside the universe) → fall back to the client-side v1 Pine (unscored marks).
  const resolveSigMarks = (slice: any, rows: Bar[]): SigMark[] => {
    if (!rows.length) return [];
    const times = rows.map((r) => r.time);
    const lastDate = times[times.length - 1];
    const nearIdx = makeNearestBarIndex(times);
    const byTime = new Map(rows.map((r) => [r.time, r]));
    // BUY-side marks anchor below the bar (low), SELL-side above (high) — same anchors either path.
    // Exact-date hit skips the search; misses (resampled TFs, where most slice dates land between
    // bars) binary-search the precomputed epoch array — replay re-resolves per tick, so the old
    // O(signals × bars) Date-allocating scan is exactly what makeNearestBarIndex retires.
    const snap = (ts: string, type: string): SigMark | null => { let bar = byTime.get(ts); if (!bar) { const i = nearIdx(ts); if (i >= 0) bar = rows[i]; } if (!bar) return null; return { t: bar.time as string, type, price: type === "SELL" || type === "CUT" ? bar.h : bar.l }; };
    const sigs = slice?.indicator?.signals;
    const marks: SigMark[] = [];
    if (Array.isArray(sigs) && sigs.length) {
      for (const s of sigs) {
        if (typeof s?.ts !== "string" || typeof s?.type !== "string" || s.ts > (lastDate as string)) continue;
        const m = snap(s.ts, s.type); if (!m) continue;
        m.quality = s.quality; m.tier = s.tier; m.reason = s.quality_reason;
        m.scored = s.scored; m.subtype = s.subtype ?? null;
        m.basis = sliceSignalBasis(s); m.blocked = isBlockedSignal(s); m.stopLevel = s.stop_level ?? null;
        m.priorStopLevel = s.prior_stop_level ?? null; m.sweepLow = s.sweep_low ?? null;
        m.riskBasis = s.risk_basis ?? null;
        // the washout classes (emitter-stamped, never re-derived here): the display-tier
        // candidate — still a refusal — the TAKEN entry in either waived flavour (era
        // gc_v2_wo2), and the display-only RETRO projection. Mutually exclusive by
        // construction; the first three carry the same context shape.
        m.overrideCandidate = isOverrideCandidate(s);
        m.overrideTake = isWaivedEntry(s);
        m.reclaimWaived = isReclaimOverrideTake(s);
        m.retro = isRetroOverride(s);
        if (m.overrideCandidate || m.overrideTake) {
          m.overrideGroup = s.override_ctx?.name ?? s.override_ctx?.group_id ?? null;
          m.overrideDd = typeof s.override_ctx?.peer_dd === "number" ? s.override_ctx.peer_dd : null;
          m.overrideCtx = s.override_ctx ?? null;
        }
        if (m.retro) { m.overrideGroup = s.retro_ctx?.name ?? s.retro_ctx?.group_id ?? null; m.retroCtx = s.retro_ctx ?? null; }
        marks.push(m);
      }
    } else {
      const daily = dailyBarsRef.current.length ? dailyBarsRef.current : rows;
      marks.push(...oracleSignals(daily)
        .filter((s) => s.ts <= (lastDate as string))
        .map((s) => snap(s.ts, s.type))
        .filter(Boolean) as SigMark[]);
    }

    // Prophet board/reversal admissions are a distinct, append-only source receipt. They
    // share the slice for delivery efficiency, but never enter indicator.signals and never
    // become Oracle BUYs. Place them at their recorded entry when available, else the bar low.
    const opps = slice?.opportunities?.events;
    if (Array.isArray(opps)) {
      for (const o of opps) {
        const ts = typeof o?.surfaced_at === "string" ? o.surfaced_at
          : typeof o?.entry_date === "string" ? o.entry_date : null;
        if (!ts || ts > (lastDate as string)) continue;
        const m = snap(ts, "PROPHET"); if (!m) continue;
        if (typeof o.entry_price === "number" && Number.isFinite(o.entry_price)) m.price = o.entry_price;
        m.source = String(o.system || "prophet");
        m.definition = typeof o.definition === "string" ? o.definition : null;
        m.rank = typeof o.rank === "number" ? o.rank : null;
        m.returnPct = typeof o.return_pct === "number" ? o.return_pct : null;
        m.authority = typeof o.authority === "string" ? o.authority : "candidate";
        marks.push(m);
      }
    }
    // Oracle and Prophet streams are each chronological; sort their union for replay/jump stability.
    marks.sort((a, b) => a.t.localeCompare(b.t));
    return marks;
  };

  // GC v2 side channels → bar-snapped marks. early_dots is a list of date strings (anticipation
  // pre-cross); warnings is a list of {ts, kind:"arm"|"confirm"} (structure-break). Both live on the
  // slice indicator parallel to signals (emitter: ingest/gen_slices_all.py writes {"indicator": ind});
  // the client-Pine fallback has no analog, so a missing slice simply yields empty channels.
  const resolveSideChannels = (slice: any, rows: Bar[]) => {
    const times = rows.map((r) => r.time);
    const lastDate = times[times.length - 1] as string;
    const tset = new Set(times as unknown as string[]);
    const nearIdx = makeNearestBarIndex(times);
    // Exact-hit shortcut mirrors resolveSigMarks' snap(): dots/warns are engine bar dates, so on
    // the daily TF every one hits — misses (the resampled-TF case) binary-search the precomputed
    // epoch array (replay re-resolves per tick; the old linear scan cost ~100ms/step here).
    const snapT = (iso: string) => { if (tset.has(iso)) return iso; const i = nearIdx(iso); return i >= 0 ? (times[i] as string) : null; };
    const dots = ((slice?.indicator?.early_dots || []) as string[])
      .filter((ts) => ts <= lastDate)
      .map((ts) => ({ t: snapT(ts) as string | null }))
      .filter((m) => m.t) as { t: string }[];
    const warns = ((slice?.indicator?.warnings || []) as { ts: string; kind: string }[])
      .filter((w) => w?.ts <= lastDate)
      .map((w) => ({ t: snapT(w.ts) as string | null, kind: w.kind }))
      .filter((m) => m.t) as { t: string; kind: string }[];
    return { dots, warns };
  };

  // Status line + verdict badge from the current bars + slice.
  const paintStatus = (rows: Bar[], slice: any) => {
    const prec = precRef.current; const t = tokensRef.current;
    const last = rows[rows.length - 1], prev = rows[rows.length - 2] || last;
    if (statusRef.current && last) {
      const showOHLC = showOHLCRef.current;
      const showBarChange = showBarChangeRef.current;
      const ch = last.c - prev.c, cp = (ch / prev.c) * 100, u = ch >= 0, f = (x: number) => x.toFixed(prec);
      let html = "";
      const currentSymbol = symbolRef.current;
      const fallbackColor = /^#[0-9a-f]{3,8}$/i.test(instrumentColorRef.current) ? instrumentColorRef.current : "#64748b";
      const logoSrc = assetLogoPath(currentSymbol, instrumentMarketRef.current);
      let identityHtml = showLogoRef.current
        ? `<span class="status-symbol-logo" style="--status-logo-fallback:${fallbackColor}"><span>${escH(assetInitial(currentSymbol))}</span><img src="${escH(logoSrc)}" alt="" referrerpolicy="origin"></span>`
        : "";
      if (showSymbolNameRef.current) {
        const name = instrumentNameRef.current || currentSymbol;
        const title = titleModeRef.current === "ticker"
          ? currentSymbol
          : titleModeRef.current === "both" && name !== currentSymbol
            ? `${name} · ${currentSymbol}`
            : name;
        const identity = [title, timeframeRef.current, instrumentMarketRef.current].filter(Boolean).map(escH).join(" · ");
        const basis = liveQuoteRef.current?.basis;
        identityHtml += `<b class="status-symbol-name">${identity}</b><i class="status-market-dot ${basis === "LIVE" ? "is-live" : basis === "DELAYED_15M" ? "is-delayed" : ""}"></i>`;
      }
      if (identityHtml) html += `<span class="status-identity">${identityHtml}</span>`;
      let valuesHtml = "";
      // D2 — the OHLC / Vol / Day runs are wrapped so the native shell can suppress them as a
      // unit (TV shows them only on crosshair scrub). The wrappers are inert on web.
      if (showOHLC) valuesHtml += `<span class="status-ohlc"><span class="mut">O</span><b>${f(last.o)}</b><span class="mut">H</span><b>${f(last.h)}</b><span class="mut">L</span><b>${f(last.l)}</b><span class="mut">C</span><b>${f(last.c)}</b></span>`;
      // shell-only last price — display:none on web via the base .status-last rule.
      valuesHtml += `<b class="status-last">${f(last.c)}</b>`;
      if (showBarChange) valuesHtml += `<b class="status-change ${u ? "up" : "down"}">${u ? "+" : ""}${f(ch)} (${u ? "+" : ""}${cp.toFixed(2)}%)</b>`;
      if (showVolumeRef.current) valuesHtml += `<span class="status-vol"><span class="mut">Vol</span><b>${last.v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}</b></span>`;
      if (showLastDayChangeRef.current) {
        const dayChange = liveQuoteRef.current?.prevSessionChg ?? liveQuoteRef.current?.chg;
        if (dayChange != null && Number.isFinite(dayChange)) {
          valuesHtml += `<span class="status-day"><span class="mut">Day</span><b class="${dayChange >= 0 ? "up" : "down"}">${dayChange >= 0 ? "+" : ""}${dayChange.toFixed(2)}%</b></span>`;
        }
      }
      if (valuesHtml) html += `<span class="status-values">${valuesHtml}</span>`;
      statusRef.current.innerHTML = html;
      const logoImage = statusRef.current.querySelector<HTMLImageElement>(".status-symbol-logo img");
      logoImage?.addEventListener("error", () => { logoImage.hidden = true; }, { once: true });
    }
    // Gate oracle verdict text on whether the _oracle indicator is active. The chip's display:none
    // is controlled by oracleVisible in JSX; this guard prevents stale text from painting in the
    // background when the user has toggled the oracle OFF.
    if (verdictRef.current && indicatorsRef.current.has("_oracle") && !hiddenRef.current.has("_oracle")) {
      // Chip verdict = the scored lane's anchor: signalVerdict.anchorSignal — the SAME helper the
      // rail card (oracleVerdict) runs, so chip and panel can't contradict. regime_blocked markers
      // are vetoed displays and never anchor (contracts.py).
      // Bounded by the last visible bar's DATE so replay (and stale bar caches) can't future-leak a
      // verdict the on-chart marks don't show; intraday bars carry epoch times → convert to the day.
      // Client-Pine fallback (no slice signals): the latest computed mark stands in, as before.
      const sigs = slice?.indicator?.signals;
      const lastT = rows[rows.length - 1]?.time;
      const lastDate = typeof lastT === "string" ? lastT : lastT != null ? new Date((lastT as number) * 1000).toISOString().slice(0, 10) : null;
      let v = "—";
      let vBasis: string | undefined;
      let vQuality: string | undefined;
      if (Array.isArray(sigs) && sigs.length) {
        const { anchor } = anchorSignal(sigs, lastDate);
        if (anchor) { v = String(anchor.type).toUpperCase(); vBasis = sliceSignalBasis(anchor); vQuality = anchor.quality; }
      } else {
        const sm = sigMarksRef.current.filter((m) => m.type !== "PROPHET");
        if (sm.length) { v = sm[sm.length - 1].type; vBasis = sm[sm.length - 1].basis; vQuality = sm[sm.length - 1].quality; }
      }
      const buy = v === "BUY" || v === "REBUY" || v === "RECLAIM";
      const watch = v === "BOTTOM_WATCH";
      const chipColor = watch ? t.signal : buy ? t.buy : t.sell;
      // HK-O1: a structure stop says STOP, not SELL. The chip is the glance tier — four
      // characters, inside the existing pill geometry at every breakpoint — and the full
      // "Structure stop — swing-low break" read lives on the rail card and the marker hover.
      const vLabel = isStructureStop({ type: v, basis: vBasis }) ? "STOP"
        : v === "BOTTOM_WATCH" ? "EARLY"
          : isStopSweepReclaim({ type: v, quality: vQuality }) ? "LIQUIDITY RECLAIM"
            : v === "RECLAIM" ? "RE-ENTRY" : v;
      verdictRef.current.textContent = `GOLDEN ORACLE · ${vLabel}`;
      verdictRef.current.style.color = chipColor;
      const w = verdictRef.current.parentElement as HTMLElement;
      // Token-derived so the chip tracks the shell palette (byte-identical output on web, where
      // --buy/--sell still resolve to the locked v5 hexes).
      if (w) {
        w.style.background = `color-mix(in srgb, ${chipColor} 12%, transparent)`;
        w.style.borderColor = `color-mix(in srgb, ${chipColor} 30%, transparent)`;
      }
    }
  };

  // ── R11 live-bar splice ───────────────────────────────────────────────────
  // Patch/append the live quote onto the last (daily or resampled) bar so the chart's newest
  // candle agrees with the header price. Operates on the RAW daily source (dailyBarsRef), folds
  // the final bucket for resampled TFs, and `series.update()`s exactly one bar. Also updates
  // barsRef/fullBarsRef so the status line, sig-mark snapping and pane-sync map stay consistent.
  // Guards (any → no-op): no chart/series, intraday TF, replay active, basis not spliceable,
  // no quote/last, or the daily source is empty.
  /**
   * Roll the pane back to EMPTY. A symbol whose bars never arrive (no `/data/<sym>.json`, an empty
   * composite, a dead intraday feed) used to leave the PREVIOUS symbol's series on screen under the
   * new symbol's badge — and the live-quote splice then printed the new symbol's price onto those
   * bars (000001.SS's 3,878 spliced onto 300363.SZ's ~17 CNY candles: one giant candle, a 0–4400
   * scale, and a status line reading +1881%). Clearing `chartDataSymRef` also tells every
   * symbol-guarded consumer (splice, options levels, drawings) that this pane is unpainted.
   */
  const clearChartData = () => {
    barsRef.current = []; fullBarsRef.current = []; dailyBarsRef.current = []; closesRef.current = [];
    barIdxRef.current = { src: null, map: new Map() };
    sliceRef.current = null; sigMarksRef.current = []; earlyDotsRef.current = []; warnMarksRef.current = [];
    chartDataSymRef.current = "";
    clearExtendedPriceLine();
    clearAllIndicators();
    const chart = chartRef.current;
    if (chart) for (const s of cmpSeriesRef.current.values()) { try { chart.removeSeries(s); } catch {} }
    cmpSeriesRef.current.clear();
    try { priceSeriesRef.current?.setData([]); } catch {}
    liveTickKeyRef.current = "";
    const liveWrap = wrapElRef.current;
    if (liveWrap) {
      delete liveWrap.dataset.liveDirection;
      delete liveWrap.dataset.liveKind;
      delete liveWrap.dataset.livePulse;
      delete liveWrap.dataset.livePrice;
      delete liveWrap.dataset.liveRevision;
      delete liveWrap.dataset.liveOpen;
      delete liveWrap.dataset.liveHigh;
      delete liveWrap.dataset.liveLow;
      delete liveWrap.dataset.liveClose;
      delete liveWrap.dataset.liveTime;
      liveWrap.style.removeProperty("--mm-live-y");
      liveWrap.style.removeProperty("--mm-live-color");
    }
    rebuildPaneMeta();             // the legend must not advertise studies that are no longer drawn
    if (onMeta) onMeta({ total: 0 });
    renderTagRef.current?.();      // no bars → the last-price badge hides itself
    renderSignalsRef.current();    // drop the previous symbol's markers / gap zones
    renderRef.current();
  };

  const applyIntradayLiveCandle = () => {
    const priceS = priceSeriesRef.current;
    if (!priceS || !isIntradayRef.current || replayIdxRef.current != null) return;
    if (chartDataSymRef.current !== symbolRef.current) return;
    const current = fullBarsRef.current;
    if (!current.length) return;
    const mutation = mutateLiveCandle(
      current as unknown as import("@/lib/liveCandle").LiveCandleBar[],
      liveQuoteRef.current,
      timeframeRef.current,
      classify(symbolRef.current),
      extHoursRef.current,
    );
    if (!mutation || mutation.tickKey === liveTickKeyRef.current) return;

    const bar = mutation.bar as unknown as Bar;
    try {
      priceS.update(isValueChartType(chartTypeRef.current)
        ? { time: bar.time, value: bar.c }
        : { time: bar.time, open: bar.o, high: bar.h, low: bar.l, close: bar.c });
    } catch { return; }

    liveTickKeyRef.current = mutation.tickKey;
    fullBarsRef.current = mutation.bars as unknown as Bar[];
    barsRef.current = fullBarsRef.current; // replay is guarded above, so the visible set is the full set
    closesRef.current = barsRef.current.map((r) => r.c);
    barIdxRef.current = { src: null, map: new Map() };
    if (mutation.kind === "new-bar" && onMeta) onMeta({ total: barsRef.current.length });

    // Existing built-ins already have an in-place update path. Running it here keeps the default
    // EMA/volume/MACD/Stoch stack breathing with the candle without removing/recreating panes.
    updateAllIndicators(barsRef.current, closesRef.current);
    buildIndDataMap(barsRef.current, closesRef.current);
    paintStatus(barsRef.current, null);
    renderSignalsRef.current();
    renderRef.current();
    renderTagRef.current?.();
    if (dayModeRef.current) setStripBars([...barsRef.current]);
    reRegisterSync();

    // Canvas pixels change through series.update(); this small DOM tracer makes that mutation
    // perceptible at a glance without repainting the candle ourselves. Alternating a/b restarts
    // the finite pulse without a forced layout; reduced-motion CSS disables the animation.
    const wrap = wrapElRef.current;
    if (wrap) {
      const color = mutation.direction === "up"
        ? tokensRef.current.up
        : mutation.direction === "down" ? tokensRef.current.down : tokensRef.current.brand2;
      let y: number | null = null;
      try { y = priceS.priceToCoordinate(bar.c) as number | null; } catch {}
      wrap.dataset.liveDirection = mutation.direction;
      wrap.dataset.liveKind = mutation.kind;
      wrap.dataset.livePrice = String(bar.c);
      wrap.dataset.liveOpen = String(bar.o);
      wrap.dataset.liveHigh = String(bar.h);
      wrap.dataset.liveLow = String(bar.l);
      wrap.dataset.liveClose = String(bar.c);
      wrap.dataset.liveTime = String(bar.time);
      wrap.dataset.liveRevision = String(++livePulseSeqRef.current);
      wrap.dataset.livePulse = livePulseSeqRef.current % 2 ? "a" : "b";
      wrap.style.setProperty("--mm-live-color", color || tokensRef.current.brand2);
      if (y != null && Number.isFinite(y)) wrap.style.setProperty("--mm-live-y", `${Math.round(y)}px`);
      priceTagRef.current?.setAttribute("data-live-direction", mutation.direction);
    }
  };

  const applyLiveSplice = () => {
    const priceS = priceSeriesRef.current; if (!priceS) return;
    // The bars on the canvas must belong to THIS symbol (see clearChartData) — a quote must never
    // be spliced onto another symbol's series.
    if (chartDataSymRef.current !== symbolRef.current) return;
    if (isIntradayRef.current) { applyIntradayLiveCandle(); return; }
    if (replayIdxRef.current != null) return;              // never splice under replay
    const q = liveQuoteRef.current;
    if (!q || q.last == null || !isFinite(q.last)) return;
    if (!SPLICE_BASES.has(q.basis || "")) return;          // EOD / missing basis → no splice
    const daily = dailyBarsRef.current; if (!daily.length) return;
    const tf = timeframeRef.current;
    const market = classify(symbol);
    const sd = sessionDateOf(q.ts, market);
    if (sd == null) return;
    if (!canSpliceRegularBar(symbolRef.current, q, sd)) return;
    const spliced = spliceDaily(daily, q, sd);
    if (spliced === daily) return;                         // nothing changed (older session)
    // fold to the bar the chart actually plots at this TF, then push it via update()
    let bucket = foldFinalBucket(spliced, tf);
    if (!bucket) return;
    // Write the spliced daily back so the raw source stays current across ticks AND the
    // gap-zone memo (keyed on this array's identity) recomputes — else a gap formed by
    // today's developing bar stays invisible until the next full data reload.
    dailyBarsRef.current = spliced;
    // R11: reuse the EXISTING final-bucket time key unless the spliced daily date GENUINELY starts a
    // new bucket (e.g. a fresh ISO week / month / 3D group). For resampled TFs the bucketer re-stamps
    // the merged bucket's time to the newest daily date, which > the on-chart key → update() would
    // APPEND a phantom bar. Detect "same bucket" by comparing pre/post bucket counts and, if equal,
    // rewrite the key to the on-chart final bucket's time so update() REPLACES it in place.
    if (tf !== "D") {
      const preCount = resampleTf(daily, tf).length;
      const postCount = resampleTf(spliced, tf).length;
      const chartLastTime = fullBarsRef.current[fullBarsRef.current.length - 1]?.time;
      if (postCount === preCount && chartLastTime != null && chartLastTime !== bucket.time) {
        bucket = { ...bucket, time: chartLastTime as string };
      }
    }
    // heikin falls through to the OHLC mapping (raw candle acceptable per spec caveat) — passing the
    // raw {o,h,l,c,v} bucket to a candlestick series is read as a whitespace point (no `open` key)
    // and BLANKS the live candle. Map to {open,high,low,close} like the candle/bars family.
    try { priceS.update(isValueChartType(chartTypeRef.current) ? { time: bucket.time, value: bucket.c } : { time: bucket.time, open: bucket.o, high: bucket.h, low: bucket.l, close: bucket.c }); } catch { return; }
    // keep the in-memory bar sets in step with what's on the chart (last bucket only)
    const fb = fullBarsRef.current;
    const bs = barsRef.current;
    // Capture ref identity BEFORE the fullBarsRef append below reassigns it to a new array. Off-replay
    // Effect 2 sets barsRef.current === fullBarsRef.current, so wasSame is true; on the APPEND case
    // fullBarsRef is reassigned to [...fb, bucket] while `fb`/`bs` still hold the old array — we must
    // resync barsRef to the new fullBarsRef (else the status line reads the pre-splice tail for a poll).
    const wasSame = bs.length > 0 && bs === fb;
    if (fb.length) { if (fb[fb.length - 1].time === bucket.time) fb[fb.length - 1] = bucket; else fullBarsRef.current = [...fb, bucket]; }
    if (wasSame) { barsRef.current = fullBarsRef.current; }
    else if (bs.length) { if (bs[bs.length - 1].time === bucket.time) bs[bs.length - 1] = bucket; else barsRef.current = [...bs, bucket]; }
    closesRef.current = barsRef.current.map((r) => r.c);
    barIdxRef.current = { src: null, map: new Map() };   // force the time→index map to rebuild (bar count may have grown)
    paintStatus(barsRef.current, sliceRef.current);
    renderSignalsRef.current();
    renderTagRef.current?.();   // live-quote splice moved the last close → refresh the price/countdown tag now
    schedulePineLiveRerun();    // recompute Pine plots/markers on the developing bar (debounced ~250ms)
  };

  // Debounced (~250ms) incremental Pine re-run on a live splice. Pine indicators used to FREEZE on live
  // ticks (applyLiveSplice moved the last close but never re-ran the scripts). We evict the memo cache
  // (the in-place last-bucket replace keeps the same len:lastTime data-sig, so it would otherwise read
  // as a stale HIT) and re-run off-thread via the host, coalescing a burst of 6s-poll splices into ONE
  // re-eval. No-op under replay / intraday / when no scripts are active. NOTE: the engine re-runs the
  // full bar set (host.ts exposes no append-only eval); the debounce + worker keep it off the hot path.
  const PINE_LIVE_DEBOUNCE_MS = 250;
  const schedulePineLiveRerun = () => {
    if (replayIdxRef.current != null || isIntradayRef.current) return;
    if (!pineScriptsRef.current.length) return;
    if (pineLiveTimerRef.current != null) clearTimeout(pineLiveTimerRef.current);
    pineLiveTimerRef.current = setTimeout(() => {
      pineLiveTimerRef.current = null;
      const chart = chartRef.current; if (!chart || isIntradayRef.current || replayIdxRef.current != null) return;
      pineCacheRef.current.clear();   // force a re-run against the developing bar (last close moved in place)
      buildAllPine(barsRef.current);  // async: epoch-guarded, repaints when the worker batch settles
    }, PINE_LIVE_DEBOUNCE_MS);
  };

  // Apply the default view (recent ~240 window in normal mode; fit the slice in replay).
  const applyView = (rows: Bar[], replay: number | null) => {
    const chart = chartRef.current; if (!chart) return;
    let plotWidth: number | undefined;
    try { plotWidth = chart.timeScale().width(); } catch {}
    const range = normalizedChartLogicalRange(rows.length, replay != null, plotWidth)
      ?? fullHistoryLogicalRange(rows.length, plotWidth);
    try { if (range) chart.timeScale().setVisibleLogicalRange(range); else chart.timeScale().fitContent(); } catch {}
  };

  // ────────────────────────────────────────────────────────────────────────────
  // EFFECT 1 — mount once. createChart + ALL listeners/overlays + render closures.
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    cpMark(`chart-effect1-start[${symbol}]`);
    const el = ref.current; if (!el) return;
    let ro: ResizeObserver | null = null, paneRO: ResizeObserver | null = null, dead = false;
    let onKey: ((e: KeyboardEvent) => void) | null = null;
    let onCtx: ((e: MouseEvent) => void) | null = null, winDown: ((e: PointerEvent) => void) | null = null, dragCleanup: (() => void) | null = null;
    let rafId: number | null = null, measRaf: number | null = null;
    let onPaneMove: ((e: MouseEvent) => void) | null = null, onPaneLeave: (() => void) | null = null, onPaneDbl: ((e: MouseEvent) => void) | null = null;
    // signal-marker tooltip listeners (hover + tap); see the `sigTip` construction below
    let onSigHover: ((e: PointerEvent) => void) | null = null, onSigDown: ((e: PointerEvent) => void) | null = null;
    let onSigUp: ((e: PointerEvent) => void) | null = null, onSigCancel: (() => void) | null = null, onSigLeave: ((e: PointerEvent) => void) | null = null;
    // ── snapshot: composite the chart with per-pane labels + brand logo + timestamp ──
    // action = "download" | "copy" | "share" | "tab" (from event detail; default = "download")
    // Reads live refs so labels match the on-screen state.
    // Scale: takeScreenshot() returns a canvas at lightweight-charts' own pixel ratio (may be 1:1).
    // We derive realScale from src.width / wrap.clientWidth and upscale the output to TARGET_SCALE (2x)
    // for crispness. Custom indicators (z-index:2), signals (z-index:3), and user drawings
    // (z-index:4) are composited separately in the same order as the live chart.
    const TARGET_SCALE = 2;
    const SNAPSHOT_SVG_VARS = [
      "--bg", "--panel", "--panel-2", "--panel-3", "--line", "--line-3",
      "--text", "--text-2", "--text-dim", "--muted", "--brand", "--brand-2",
      "--up", "--down", "--buy", "--sell", "--signal", "--warn",
      "--font-inter", "--font-ui", "--font-num", "--font-code",
    ] as const;
    // Serialize an SVG element to a bitmap at the given CSS dimensions scaled to TARGET_SCALE.
    const svgToImage = (svgEl: SVGSVGElement, cssW: number, cssH: number): Promise<HTMLImageElement | null> => {
      return new Promise((resolve) => {
        try {
          const clone = svgEl.cloneNode(true) as SVGSVGElement;
          // The live overlays inherit theme variables and use CSS-pixel coordinates. A blob-loaded
          // SVG has neither the page cascade nor a useful viewport unless we make both explicit.
          clone.style.cssText = "background:transparent;overflow:visible";
          const rootStyle = getComputedStyle(document.documentElement);
          for (const name of SNAPSHOT_SVG_VARS) {
            const value = rootStyle.getPropertyValue(name).trim();
            if (value) clone.style.setProperty(name, value);
          }
          clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
          clone.setAttribute("width", String(cssW * TARGET_SCALE));
          clone.setAttribute("height", String(cssH * TARGET_SCALE));
          clone.setAttribute("viewBox", `0 0 ${cssW} ${cssH}`);
          const xml = new XMLSerializer().serializeToString(clone);
          const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
          img.src = url;
        } catch { resolve(null); }
      });
    };
    const snapshot = (ev?: Event) => {
      if (!activeRef.current) return;
      const action: string = (ev as CustomEvent)?.detail?.action || "download";
      (async () => {
        try {
          // Repaint the DOM overlay layer immediately before capture so a just-added indicator,
          // live-bar update, or settings change cannot export the previous render.
          renderSignalsRef.current?.();
          renderRef.current?.();
          const src = chartRef.current!.takeScreenshot();   // HTMLCanvasElement — all panes (lightweight-charts' own px ratio)
          const wrap = wrapElRef.current;
          const cssW = wrap ? wrap.clientWidth : src.width;
          const cssH = wrap ? wrap.clientHeight : src.height;
          // Output scale for the final PNG: always TARGET_SCALE (2x) for crisp sharing.
          // takeScreenshot() may return a 1:1 canvas (lightweight-charts' own ratio); we upscale
          // via drawImage so the final PNG is always 2x regardless of the chart's native resolution.
          const dpr = TARGET_SCALE;
          // Upscaled chart dimensions in output px.
          const chartW = Math.round(cssW * dpr);
          const chartH = Math.round(cssH * dpr);
          const HDR = Math.round(52 * dpr);                        // header band height in output px
          const out = document.createElement("canvas");
          out.width = chartW; out.height = chartH + HDR;
          const g = out.getContext("2d"); if (!g) return;
          const bg = css("--bg") || "#0a0b0e";
          const text = css("--text") || "#d6dae3";
          const mut = tokensRef.current.mut || css("--muted") || "#5a616f";
          const brand2 = tokensRef.current.brand2 || css("--brand-2") || "#4d82ff";
          const fam = css("--font-ui") || "system-ui, sans-serif";
          const numFam = css("--font-num") || fam;
          // ── background ──
          g.fillStyle = bg;
          g.fillRect(0, 0, out.width, out.height);
          // Draw chart upscaled from its native resolution to TARGET_SCALE.
          // While a pane is maximized the DOM hides the other pane rows, but
          // takeScreenshot() rasterizes the library's INTERNAL layout (which
          // still holds 2px slivers + 1px separators for the hidden panes) —
          // crop the raster to [maximized pane] + [time axis] so the PNG
          // matches the on-screen view instead of leaking the slivers.
          let srcDrawn = false;
          const ctlSnap = paneCtl.current;
          if (ctlSnap.maximized) {
            try {
              const ch = chartRef.current!;
              const mMeta = panesMeta.current.find((m) => m.key === ctlSnap.maximized);
              const maxIdx = mMeta ? mMeta.pane.paneIndex() : -1;
              const nP = ch.panes().length;
              if (maxIdx >= 0 && nP > 1) {
                let mTop = 0;
                for (let i = 0; i < maxIdx; i++) mTop += ch.paneSize(i).height + 1; // +1px separator
                const mH = ch.paneSize(maxIdx).height;
                let axTop = nP - 1; // separators
                for (let i = 0; i < nP; i++) axTop += ch.paneSize(i).height;
                const k = src.height / cssH; // raster px per css px
                const mHOut = Math.round(mH * dpr);
                g.drawImage(src, 0, Math.round(mTop * k), src.width, Math.round(mH * k), 0, HDR, chartW, mHOut);
                const axSrcY = Math.round(axTop * k);
                g.drawImage(src, 0, axSrcY, src.width, src.height - axSrcY, 0, HDR + mHOut, chartW, chartH - Math.round(axTop * dpr));
                srcDrawn = true;
              }
            } catch {}
          }
          if (!srcDrawn) g.drawImage(src, 0, HDR, chartW, chartH);
          // ── composite SVG overlays in their live stacking order ──
          // Each SVG occupies the full wrap (inset:0 100% 100%), so we draw them at (0, HDR).
          if (wrap) {
            const indicatorSvgEl = indSvgRef.current;
            const sigSvgEl = sigRef.current;
            const drawSvgEl = svgRef.current;
            const [indicatorImg, sigImg, drawImg] = await Promise.all([
              indicatorSvgEl ? svgToImage(indicatorSvgEl, cssW, cssH) : Promise.resolve(null),
              sigSvgEl ? svgToImage(sigSvgEl, cssW, cssH) : Promise.resolve(null),
              drawSvgEl ? svgToImage(drawSvgEl, cssW, cssH) : Promise.resolve(null),
            ]);
            if (indicatorImg) g.drawImage(indicatorImg, 0, HDR, chartW, chartH);
            if (sigImg) g.drawImage(sigImg, 0, HDR, chartW, chartH);
            if (drawImg) g.drawImage(drawImg, 0, HDR, chartW, chartH);
          }
          // Premium Market/MTF dashboards are live DOM tables rather than chart/SVG primitives.
          // Repaint their current TableSpec data directly so every first-class indicator surface
          // participates in the export without depending on a lagging React commit or DOM rasterizer.
          paintSnapshotTables(g, suiteTablesRef.current, {
            outputWidth: out.width,
            outputHeight: out.height,
            scale: dpr,
            chartBodyTop: HDR,
            palette: {
              panel: css("--panel") || "#101217",
              line: css("--line-3") || "#30343d",
              text,
              text2: css("--text-2") || "#b8beca",
              textDim: css("--text-dim") || "#747b89",
              muted: mut,
            },
            fonts: { ui: fam, numeric: numFam },
          });
          // ── header band ──
          const tf = timeframeRef.current;
          const pad = Math.round(14 * dpr);
          g.textBaseline = "middle";
          g.textAlign = "left";
          // brand logo: draw the M tile (BrandMark) then MASTERMIND TERMINAL wordmark
          // Tile: 32×32 CSS px tile → scaled by dpr
          const tileSize = Math.round(28 * dpr);
          const tileX = pad, tileY = Math.round((HDR - tileSize) / 2);
          const rx = tileSize * 0.2;           // rounded corner radius
          // gradient fill for the tile
          const grd = g.createLinearGradient(tileX, tileY, tileX + tileSize, tileY + tileSize);
          grd.addColorStop(0, "#4d82ff"); grd.addColorStop(1, "#2962ff");
          g.fillStyle = grd;
          // rounded-rect tile
          g.beginPath(); g.roundRect(tileX, tileY, tileSize, tileSize, rx); g.fill();
          // subtle border on tile
          g.strokeStyle = "rgba(255,255,255,0.22)"; g.lineWidth = Math.round(0.8 * dpr);
          g.beginPath(); g.roundRect(tileX + g.lineWidth / 2, tileY + g.lineWidth / 2, tileSize - g.lineWidth, tileSize - g.lineWidth, rx - g.lineWidth / 2); g.stroke();
          // M path inside tile (matches BrandMark SVG: 40×40 viewBox, path d="M13 28 L13 14.5 L20 22 L27 12.5 L27 28")
          const scl = tileSize / 40;
          const pts: [number, number][] = [[13, 28], [13, 14.5], [20, 22], [27, 12.5], [27, 28]];
          g.beginPath();
          g.moveTo(tileX + pts[0][0] * scl, tileY + pts[0][1] * scl);
          for (let i = 1; i < pts.length; i++) g.lineTo(tileX + pts[i][0] * scl, tileY + pts[i][1] * scl);
          g.strokeStyle = "#fff"; g.lineWidth = Math.round(3.2 * scl); g.lineCap = "round"; g.lineJoin = "round"; g.stroke();
          // wordmark: MASTERMIND (bold) + TERMINAL (small, muted)
          const logoRight = tileX + tileSize + Math.round(10 * dpr);
          g.textAlign = "left"; g.textBaseline = "middle";
          g.fillStyle = text;
          g.font = `700 ${Math.round(11 * dpr)}px ${fam}`;
          g.fillText("MASTERMIND", logoRight, Math.round(HDR / 2 - 5 * dpr));
          g.fillStyle = mut;
          g.font = `500 ${Math.round(9 * dpr)}px ${fam}`;
          g.fillText("TERMINAL", logoRight, Math.round(HDR / 2 + 6 * dpr));
          // symbol + tf (right of logo) — full timestamp right-aligned
          // Effect 1 mounts once and the panel is deliberately NOT keyed by symbol, so the `symbol`
          // prop captured here is frozen at mount. Read symbolRef (synced every render) or a
          // snapshot taken after switching tickers stamps the header with the mount-time symbol.
          const snapSym = symbolRef.current || symbol;
          const symX = logoRight + g.measureText("MASTERMIND").width + Math.round(18 * dpr);
          g.fillStyle = text;
          g.font = `700 ${Math.round(13 * dpr)}px ${fam}`;
          g.textBaseline = "middle";
          g.fillText(snapSym, symX, Math.round(HDR / 2 - 4 * dpr));
          const symW2 = g.measureText(snapSym).width;
          g.fillStyle = mut;
          g.font = `500 ${Math.round(10 * dpr)}px ${fam}`;
          g.fillText(`  ${tf}`, symX + symW2, Math.round(HDR / 2 - 4 * dpr));
          // The header band is canvas-painted, so the exported ticker has no DOM to assert against.
          // Expose what was stamped (dev/e2e only) — the stale-symbol regression is invisible otherwise.
          if (process.env.NODE_ENV !== "production") {
            (window as unknown as { __mmSnapshotHeader?: { symbol: string; timeframe: string } }).__mmSnapshotHeader = { symbol: snapSym, timeframe: tf };
          }
          // full timestamp in viewer's local timezone
          const now = new Date();
          const tzOffset = -now.getTimezoneOffset() / 60;
          const tzSign = tzOffset >= 0 ? "+" : "-";
          const tzStr = `UTC${tzSign}${Math.abs(tzOffset)}`;
          const pad2 = (n: number) => String(n).padStart(2, "0");
          const tsStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())} ${tzStr}`;
          g.textAlign = "right";
          g.fillStyle = mut;
          g.font = `400 ${Math.round(9 * dpr)}px ${fam}`;
          const tsW = g.measureText(tsStr).width;
          g.fillText(tsStr, out.width - pad, Math.round(HDR / 2 + 4 * dpr));
          // company name (proper name; zh preferred over English) on a second line under the symbol,
          // truncated with an ellipsis so a long name never runs into the right-aligned timestamp.
          const coName = (companyNameRef.current || "").trim();
          if (coName) {
            g.textAlign = "left"; g.textBaseline = "middle";
            g.font = `500 ${Math.round(9 * dpr)}px ${fam}`;
            g.fillStyle = mut;
            const maxNameW = out.width - pad - tsW - Math.round(20 * dpr) - symX;
            let label = coName;
            if (maxNameW > Math.round(24 * dpr) && g.measureText(label).width > maxNameW) {
              while (label.length > 1 && g.measureText(label + "…").width > maxNameW) label = label.slice(0, -1);
              label += "…";
            }
            if (maxNameW > Math.round(24 * dpr)) g.fillText(label, symX, Math.round(HDR / 2 + 7 * dpr));
          }
          // ── per-pane indicator labels (top-left of each pane, matching live view) ──
          // paneLayoutRef holds CSS-pixel positions; we convert to output-px using dpr (TARGET_SCALE),
          // not realScale — so label positions align with the upscaled chart raster.
          const pLayout = paneLayoutRef.current;
          if (pLayout.length) {
            g.textAlign = "left"; g.textBaseline = "top";
            for (const pane of pLayout) {
              const visEntries = pane.entries.filter((e) => !e.hidden);
              if (!visEntries.length) continue;
              // pane.top is CSS-px; multiply by dpr (output scale) and offset by HDR
              const paneTopDev = Math.round(pane.top * dpr) + HDR;
              const lPad = Math.round(8 * dpr);
              const lTop = paneTopDev + Math.round(8 * dpr);
              let lY = lTop;
              const lineH = Math.round(14 * dpr);
              for (const entry of visEntries) {
                let lbl = entry.label.trim();
                if (!lbl) continue;
                // color swatch dot
                const dot = (entry as any).color as string | undefined;
                if (dot) {
                  g.fillStyle = dot;
                  g.beginPath(); g.arc(lPad + Math.round(4 * dpr), lY + Math.round(5 * dpr), Math.round(3.5 * dpr), 0, 2 * Math.PI); g.fill();
                  g.font = `600 ${Math.round(9.5 * dpr)}px ${fam}`;
                  g.fillStyle = text;
                  g.fillText(lbl, lPad + Math.round(11 * dpr), lY);
                } else {
                  g.font = `600 ${Math.round(9.5 * dpr)}px ${fam}`;
                  const lw = g.measureText(lbl).width;
                  g.fillStyle = "rgba(10,11,14,0.55)";
                  g.fillRect(lPad - Math.round(2 * dpr), lY - Math.round(1 * dpr), lw + Math.round(6 * dpr), lineH - Math.round(2 * dpr));
                  g.fillStyle = brand2;
                  g.fillText(lbl, lPad, lY);
                }
                lY += lineH;
              }
            }
          }
          const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
          const fname = `${snapSym}_${tf}_${date}.png`;
          // textContent, not innerHTML. This interpolated `msg` into markup, and one caller passed
          // the SERVER's error string straight through — so an upstream provider's response text
          // became live HTML in the page. The message is data; it is written as data.
          const statusFeedback = (msg: string) => {
            const sEl = statusRef.current;
            if (!sEl) return;
            const prev = sEl.innerHTML;
            const b = document.createElement("b");
            b.className = "up";
            b.textContent = msg;
            sEl.replaceChildren(b);
            setTimeout(() => {
              if (statusRef.current === sEl) paintStatus(barsRef.current, sliceRef.current);
              else sEl.innerHTML = prev;
            }, 2500);
          };
          // The upload route answers with a stable `code`, never provider text. Each maps to a
          // localised string here; an unrecognised code degrades to the generic failure rather
          // than rendering whatever arrived.
          const uploadFailure = (code: unknown): string =>
            code === "too_large" ? tPlain("snapTooLarge", "Snapshot too large to share")
            : code === "invalid_png" ? tPlain("snapInvalid", "Snapshot could not be shared")
            : tPlain("snapUploadFailed", "Sharing unavailable — try again shortly");
          const blob: Blob | null = await new Promise((res) => out.toBlob(res, "image/png"));
          if (!blob) return;
          if (action === "download") {
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fname; a.click();
            try { URL.revokeObjectURL(a.href); } catch {}
            statusFeedback(tPlain("snapDownloaded", "Snapshot downloaded"));
          } else if (action === "copy") {
            try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); statusFeedback(tPlain("snapCopied", "Snapshot copied to clipboard")); }
            catch { statusFeedback(tPlain("snapClipboardFailed", "Clipboard copy failed (needs HTTPS/focus)")); }
          } else if (action === "share") {
            // Upload to R2 via /api/snapshot, copy the share URL
            try {
              const form = new FormData(); form.append("file", blob, fname);
              const r = await fetch("/api/snapshot", { method: "POST", body: form });
              if (!r.ok) { const e = await r.json().catch(() => ({})); statusFeedback(uploadFailure(e?.code)); return; }
              const { url } = await r.json();
              const abs = `${window.location.origin}${url}`;
              try { await navigator.clipboard.writeText(abs); statusFeedback(tPlain("snapLinkCopied", "Link copied to clipboard")); }
              catch { statusFeedback(`${tPlain("snapShareLink", "Share link")}: ${abs}`); }
            } catch { statusFeedback(tPlain("snapUploadFailed", "Sharing unavailable — try again shortly")); }
          } else if (action === "tab") {
            const url = URL.createObjectURL(blob);
            window.open(url, "_blank");
            setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 60_000);
          }
        } catch {}
      })();
    };
    window.addEventListener("mm:snapshot", snapshot);

    // ── D5 test hook (dev/e2e only) ────────────────────────────────────────────
    // lightweight-charts renders axis labels on canvas, so the "no series-name pill" contract
    // has no DOM to assert against. Expose every axis-labelled series' `title` option instead.
    if (process.env.NODE_ENV !== "production") {
      (window as any).__mmChartSeriesTitles = () => {
        const out: string[] = [];
        for (const list of indSeriesRef.current.values()) {
          for (const s of list) {
            try {
              const o = s.options() as any;
              if (o?.lastValueVisible) out.push(String(o.title ?? ""));
            } catch {}
          }
        }
        return out;
      };
      // C2/C3/C4/C7 test hook — the axis rule, the label pitch, the volume band and the axis font
      // are all canvas-rendered, so the option layer is the only assertable surface.
      (window as any).__mmChartAxisOpts = () => {
        const c = chartRef.current; if (!c) return null;
        const g = (fn: () => any) => { try { return fn(); } catch { return null; } };
        const right = g(() => c.priceScale("right").options());
        return {
          priceBorderVisible: right?.borderVisible ?? null,
          tickMarkDensity: right?.tickMarkDensity ?? null,
          paneTickMarkDensity: g(() => c.panes().map((p) => p.priceScale("right").options().tickMarkDensity)) ?? [],
          timeBorderColor: g(() => c.timeScale().options().borderColor) ?? null,
          fontSize: g(() => (c.options() as any).layout?.fontSize) ?? null,
          volumeTop: g(() => c.priceScale("volume").options().scaleMargins?.top) ?? null,
          watermarkVisible: watermarkVisibleRef.current,
          rowCount: barsRef.current.length,
          timeframe: timeframeRef.current,
          visibleRange: g(() => c.timeScale().getVisibleLogicalRange()),
          priceVisibleRange: g(() => priceSeriesRef.current?.priceScale().getVisibleRange()),
          priceAutoScale: g(() => priceSeriesRef.current?.priceScale().options().autoScale) ?? null,
          lastBarX: g(() => {
            const last = barsRef.current[barsRef.current.length - 1];
            return last ? c.timeScale().timeToCoordinate(last.time as any) : null;
          }),
          priceTagLeft: g(() => {
            const tag = priceTagRef.current, wrap = wrapElRef.current;
            return tag && wrap
              ? tag.getBoundingClientRect().left - wrap.getBoundingClientRect().left
              : null;
          }),
        };
      };
      // Crosshair continuity test hook. The historical name is retained because marker/primitive
      // interaction specs use it to tell a registered canvas crosshair from a dropped pointer move.
      // It no longer controls persistent-label placement.
      (window as any).__mmCrosshairDodge = () => {
        const tag = priceTagRef.current;
        return {
          crossY: crossLabelYRef.current,                          // null = no crosshair on the price pane
          tagTop: tag ? parseFloat(tag.style.top || "0") : null,   // pinned price-row top
        };
      };
      (window as any).__mmPriceLabels = () => {
        const primary = priceTagRef.current;
        const extended = extendedTagRef.current;
        return {
          primaryTop: primary ? parseFloat(primary.style.top || "0") : null,
          primaryAnchorY: primary?.dataset.anchorY ? Number(primary.dataset.anchorY) : null,
          pricePaneTop: primary?.dataset.paneTop ? Number(primary.dataset.paneTop) : 0,
          extendedTop: extended && extended.style.display !== "none" ? parseFloat(extended.style.top || "0") : null,
          extendedNaturalTop: extended?.dataset.naturalTop ? Number(extended.dataset.naturalTop) : null,
          extendedAnchorY: extended?.dataset.anchorY ? Number(extended.dataset.anchorY) : null,
          extendedDocked: extended?.dataset.docked === "true",
          hoverTop: hoverTagRef.current && hoverTagRef.current.style.display !== "none"
            ? parseFloat(hoverTagRef.current.style.top || "0")
            : null,
          hoverText: hoverTagRef.current?.textContent ?? "",
        };
      };
      // Pane-maximize test hook. Double-tap is a gesture the pane can legitimately DROP — the two
      // taps must land inside the 350ms window below, and a commit landing between them re-reads the
      // second as a fresh first tap (the R3.3 note in TerminalShell). A test therefore has to be able
      // to re-issue it, and re-issuing a TOGGLE blind would undo a tap that did register. Canvas
      // geometry cannot arbitrate that — it lags the toggle by a relayout — so expose the flag the
      // handler sets synchronously; `null` = no pane is maximized.
      (window as any).__mmPaneMaximized = () => paneCtl.current.maximized;
    }

    // ── create the ONE chart (the hard invariant — exactly one renderer instance — now
    // lives behind createEngine; docs/CHART_ENGINE_MASTERPLAN.md P1) ──
    cpMark(`chart-create[${symbol}]`);
    tokensRef.current = readTokens();
    const t = tokensRef.current;
    const engine = createEngine(el, {
      width: el.clientWidth || 900, height: el.clientHeight || 600,
      // fontSize matches the settings effect (Effect 7) so the axis does not reflow one frame after mount.
      layout: { background: { color: "transparent" }, textColor: t.axis, fontSize: shellAxisFontSize(), attributionLogo: false, panes: { separatorColor: css("--pane-sep"), separatorHoverColor: css("--pane-sep-h") } },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(214,218,227,.32)", width: 1, labelBackgroundColor: t.p3 }, horzLine: { color: "rgba(214,218,227,.32)", width: 1, labelBackgroundColor: t.p3 } },
      // C2 — TV draws no price-scale border (row y=700 across x1010–1050 is uniform canvas); the axis
      // labels float. C3 — tickMarkDensity thins the label/gridline run to TV's measured 47 CSS px.
      rightPriceScale: { borderVisible: !shellAxis(), borderColor: t.line, tickMarkDensity: shellTickDensity(), scaleMargins: { top: 0.1, bottom: 0.08 } },
      timeScale: {
        borderColor: axisLineColor(t.line),
        rightOffset: chartSettingsRef.current.rightOffsetBars ?? DEFAULT_CHART_RIGHT_OFFSET,
        barSpacing: 8,
        ...chartTimeAxisOptions(chartSettingsRef.current.hourFormat ?? "24", visibleCalendarSpanDays),
      },
      // momentum glide on pan release (LWC ships mouse:false — that reads as a hard stop)
      kineticScroll: { mouse: true, touch: true },
    });
    engineRef.current = engine;
    // engine-unwrap: P1 bridge — the raw IChartApi for the call sites below; each cluster
    // migrates behind the contract in P2, and this unwrap dies with the last one.
    const chart = engine.unwrap<IChartApi>();
    chartRef.current = chart;
    // ── v5 text watermark (createTextWatermark plugin — chart.applyOptions({ watermark }) removed in v5) ──
    // Created once on mount; Effect 7 toggles visibility via applyOptions on the plugin instance.
    try {
      const pane = chart.panes()[0];
      if (pane) {
        // C5 (revises D10) — the plugin's bottom-left placement puts the shell brand bug INSIDE the
        // volume overlay, and TextWatermarkOptions carries no padding/offset field, so the inset is
        // unreachable through it. Shell mode keeps the plugin off and paints the .mm-brandbug DOM
        // node below instead; web keeps the centred ghost wordmark byte-for-byte.
        const wmShell = shellAxis();
        const wm = createTextWatermark(pane, {
          visible: !wmShell,
          horzAlign: "center",
          vertAlign: "center",
          lines: [{
            text: "Mastermind Terminal",
            color: chartSettingsRef.current?.watermarkColor || "rgba(214,218,227,0.04)",
            fontSize: 48,
            fontStyle: "bold",
            fontFamily: "var(--font-ui, system-ui, sans-serif)",
          }],
        });
        watermarkPluginRef.current = wm;
        watermarkVisibleRef.current = !wmShell;
      }
    } catch {}

    const wrap = el.parentElement as HTMLElement;
    wrapElRef.current = wrap;
    // indicator SVG overlay layer (z-index 2, below signals and drawings)
    const indSvg = mk("svg", { style: "position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none" }) as SVGSVGElement;
    wrap.appendChild(indSvg); indSvgRef.current = indSvg;
    // signal-marker layer (below the user-drawing layer); custom TradingView-style badges
    // `data-sig-layer` mirrors the drawing layer's own hook below: the marker geometry is
    // otherwise only addressable by its z-index inline style, which no test should depend on.
    const sigSvg = mk("svg", { "data-sig-layer": "1", style: "position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none" }) as SVGSVGElement;
    wrap.appendChild(sigSvg); sigRef.current = sigSvg;
    const svg = mk("svg", { class: "drawing-layer", "data-drawing-layer": "1", style: "position:absolute;inset:0;width:100%;height:100%;z-index:4;pointer-events:none" }) as SVGSVGElement;
    wrap.appendChild(svg); svgRef.current = svg;
    ensureTooltipHost(wrap);   // shared hover tooltip for premium-suite prims (ic-tip)

    // ── SIGNAL-MARKER TOOLTIP (the repair that made the layer's `<title>`s visible) ──────────
    // Every marker below carries a `<title>`, and not one of them had ever rendered: `sigSvg` is
    // `pointer-events:none`, so no descendant is hit-testable and the browser shows no native SVG
    // tooltip. Four reviewed tooltip copies shipped to nobody.
    //
    // The layer STAYS `pointer-events:none`, and lib/markerTooltip.ts documents why at length: the
    // lightweight-charts canvas is a sibling subtree, not an ancestor, so a hit-testable marker
    // does not share the chart's gestures — it removes them over its own footprint (no pan, no
    // wheel zoom, and the crosshair drops out as the cursor crosses it). Instead the hover/tap is
    // resolved in JS from listeners on `wrap`, which already sees the canvas's bubbled events. Not
    // one pixel of the app's hit-test geometry changes, so drag behaviour is byte-identical by
    // construction rather than by tuning.
    //
    // A SEPARATE node from `.ic-tip` on purpose: that host belongs to the premium-suite prims, and
    // an overlapping prim and marker sharing one node would race to hide each other's tooltip. It
    // borrows `.ic-tip`'s styling wholesale so the two floating surfaces on this chart stay one
    // visual language; the one deviation is `white-space:normal`, because these strings are
    // sentences (the prim tooltip carries stat rows, which must not wrap).
    let sigTip: HTMLDivElement | null = document.createElement("div");
    sigTip.className = "mm-sig-tip";
    sigTip.setAttribute("role", "tooltip");
    sigTip.style.cssText =
      "position:absolute;left:0;top:0;display:none;z-index:6;pointer-events:none;max-width:280px;"
      + "background:var(--pop-bg,rgba(24,26,32,.96));border:1px solid var(--line-3);"
      + "border-radius:var(--r-md);padding:7px 10px;font:11px/1.5 var(--font-ui);color:var(--text);"
      + "white-space:normal;box-shadow:0 8px 24px rgba(0,0,0,.45)";
    wrap.appendChild(sigTip);
    // Hit boxes for the markers currently painted. `null` = stale: renderSignals clears it on every
    // repaint and the next hover rebuilds it. Rebuilding is lazy because renderSignals runs on every
    // pan/zoom frame while a hover is a much rarer event — and it is never rebuilt mid-drag.
    let sigHits: MarkerHit[] | null = null;
    // A tapped tooltip stays put until the next pointerdown; a hovered one follows the cursor.
    let sigTipPinned = false;
    // Suppresses the tooltip for the whole of a press-drag, so it can never chase a pan.
    let sigPointerDown: { x: number; y: number; t: number; id: number } | null = null;
    // Declared HERE, beside the state it owns, rather than down with the handlers: renderSignals
    // calls it and runs synchronously during this effect's setup, which would put a
    // handler-block declaration in the temporal dead zone.
    const sigTipHide = () => {
      sigTipPinned = false;
      if (sigTip && sigTip.style.display !== "none") sigTip.style.display = "none";
    };
    // C5 — shell brand bug. A DOM node, not the LWC watermark: the plugin has no offset field, so
    // it cannot be lifted clear of the volume overlay. Never created on web (zero DOM delta there);
    // all geometry lives in globals.css's .mm-brandbug rule.
    if (shellAxis()) {
      const bug = document.createElement("div");
      bug.className = "mm-brandbug";
      bug.textContent = "MASTERMIND";
      wrap.appendChild(bug); brandBugRef.current = bug;
    }

    // ── persistent price-scale labels ──
    // Both persistent labels live in the same z=5 DOM layer. The pointer price is a separate z=6
    // overlay, so it can win the collision without ever participating in persistent placement.
    const priceTag = document.createElement("div");
    priceTag.className = "mm-ptag";
    priceTag.style.cssText = `position:absolute;z-index:5;right:1px;display:none;grid-template-columns:auto ${PRICE_TAG_MIN_VALUE_WIDTH}px;grid-template-areas:"sym val";column-gap:1px;align-items:start;height:${PRICE_TAG_ROW_HEIGHT}px;pointer-events:none;white-space:nowrap`;
    const tagSym = document.createElement("div");
    tagSym.className = "mm-ptag-sym";
    tagSym.style.cssText = `grid-area:sym;box-sizing:border-box;height:${PRICE_TAG_ROW_HEIGHT}px;padding:0 5px;border-radius:2px 0 0 2px;color:#fff;display:flex;align-items:center;font:600 12px/${PRICE_TAG_ROW_HEIGHT}px var(--font-num);font-variant-numeric:tabular-nums`;
    const tagVal = document.createElement("div");
    tagVal.className = "mm-ptag-val";
    tagVal.style.cssText = `grid-area:val;position:relative;box-sizing:border-box;width:${PRICE_TAG_MIN_VALUE_WIDTH}px;height:${PRICE_TAG_ROW_HEIGHT}px;border-radius:0 2px 0 0;color:#fff;text-align:right`;
    const tagPrice = document.createElement("div");
    tagPrice.className = "mm-ptag-px";
    tagPrice.style.cssText = `box-sizing:border-box;height:${PRICE_TAG_ROW_HEIGHT}px;padding:0 5px;display:flex;align-items:center;justify-content:flex-end;font:600 12px/${PRICE_TAG_ROW_HEIGHT}px var(--font-num);font-variant-numeric:tabular-nums`;
    const tagCd = document.createElement("div");
    tagCd.className = "mm-ptag-cd";
    tagCd.style.cssText = `position:absolute;box-sizing:border-box;top:100%;right:0;width:${PRICE_TAG_MIN_VALUE_WIDTH}px;height:${PRICE_TAG_TIME_HEIGHT}px;padding:0 5px;border-radius:0 0 2px 2px;background:inherit;color:#fff;text-align:right;font:500 12px/${PRICE_TAG_TIME_HEIGHT}px var(--font-num);font-variant-numeric:tabular-nums`;
    tagVal.appendChild(tagPrice); tagVal.appendChild(tagCd);
    priceTag.appendChild(tagSym); priceTag.appendChild(tagVal);
    wrap.appendChild(priceTag); priceTagRef.current = priceTag;

    // Extended-hours tag: a shared minimum-width numeric lane keeps its orange value's LEFT edge on
    // the same spine as the current-price cell. It expands only when a large quote needs the room,
    // while short values end early as TradingView's do. The native dotted line stays at true price.
    const extendedTag = document.createElement("div");
    extendedTag.className = "mm-exttag";
    extendedTag.style.cssText = `position:absolute;z-index:5;right:1px;display:none;grid-template-columns:auto ${PRICE_TAG_MIN_VALUE_WIDTH}px;grid-template-areas:"kind slot";column-gap:1px;align-items:start;height:${PRICE_TAG_ROW_HEIGHT}px;pointer-events:none;white-space:nowrap`;
    const extendedKind = document.createElement("div");
    extendedKind.className = "mm-exttag-kind";
    extendedKind.style.cssText = `grid-area:kind;box-sizing:border-box;height:${PRICE_TAG_ROW_HEIGHT}px;padding:0 5px;border-radius:2px 0 0 2px;color:#fff;display:flex;align-items:center;font:500 12px/${PRICE_TAG_ROW_HEIGHT}px var(--font-num);font-variant-numeric:tabular-nums`;
    const extendedSlot = document.createElement("div");
    extendedSlot.className = "mm-exttag-slot";
    extendedSlot.style.cssText = `grid-area:slot;box-sizing:border-box;width:${PRICE_TAG_MIN_VALUE_WIDTH}px;height:${PRICE_TAG_ROW_HEIGHT}px;display:flex;align-items:flex-start`;
    const extendedValue = document.createElement("div");
    extendedValue.className = "mm-exttag-val";
    extendedValue.style.cssText = `box-sizing:border-box;flex:0 0 auto;height:${PRICE_TAG_ROW_HEIGHT}px;padding:0 8px;border-radius:0 2px 2px 0;color:#fff;display:flex;align-items:center;justify-content:flex-start;font:500 12px/${PRICE_TAG_ROW_HEIGHT}px var(--font-num);font-variant-numeric:tabular-nums`;
    extendedSlot.appendChild(extendedValue);
    extendedTag.appendChild(extendedKind); extendedTag.appendChild(extendedSlot);
    wrap.appendChild(extendedTag); extendedTagRef.current = extendedTag;

    const hoverTag = document.createElement("div");
    hoverTag.className = "mm-hovertag";
    hoverTag.style.cssText = `position:absolute;z-index:6;right:1px;display:none;box-sizing:border-box;width:${PRICE_TAG_MIN_VALUE_WIDTH}px;height:${PRICE_TAG_ROW_HEIGHT}px;padding:0 5px;border-radius:2px;color:#fff;align-items:center;justify-content:flex-end;pointer-events:none;white-space:nowrap;font:500 12px/${PRICE_TAG_ROW_HEIGHT}px var(--font-num);font-variant-numeric:tabular-nums`;
    wrap.appendChild(hoverTag); hoverTagRef.current = hoverTag;

    const measureCtx = document.createElement("canvas").getContext("2d");
    const measuredLabelWidth = (el: HTMLElement, value: string, horizontalPadding: number) => {
      if (!measureCtx || !value) return horizontalPadding;
      const cs = getComputedStyle(el);
      measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      // Canvas and DOM glyph advances can differ after variable-font shaping. A four-pixel safety
      // allowance keeps the flex item from shrinking and clipping its final decimal at the edge.
      return Math.ceil(measureCtx.measureText(value).width + horizontalPadding + 4);
    };
    let priceLaneWidth = PRICE_TAG_MIN_VALUE_WIDTH;
    const placeOnAxisEdge = (el: HTMLElement, onLeft: boolean) => {
      el.style.left = onLeft ? "1px" : "auto";
      el.style.right = onLeft ? "auto" : "1px";
    };
    const applyLabelLayout = (onLeft: boolean, laneWidth: number) => {
      priceLaneWidth = Math.max(PRICE_TAG_MIN_VALUE_WIDTH, Math.ceil(laneWidth));
      placeOnAxisEdge(priceTag, onLeft);
      placeOnAxisEdge(extendedTag, onLeft);
      placeOnAxisEdge(hoverTag, onLeft);
      priceTag.style.gridTemplateColumns = onLeft ? `${priceLaneWidth}px auto` : `auto ${priceLaneWidth}px`;
      priceTag.style.gridTemplateAreas = onLeft ? '"val sym"' : '"sym val"';
      extendedTag.style.gridTemplateColumns = onLeft ? `${priceLaneWidth}px auto` : `auto ${priceLaneWidth}px`;
      extendedTag.style.gridTemplateAreas = onLeft ? '"slot kind"' : '"kind slot"';
      tagVal.style.width = `${priceLaneWidth}px`;
      tagCd.style.width = `${priceLaneWidth}px`;
      extendedSlot.style.width = `${priceLaneWidth}px`;
      tagSym.style.borderRadius = onLeft ? "0 2px 2px 0" : "2px 0 0 2px";
      tagVal.style.borderRadius = onLeft ? "2px 0 0 0" : "0 2px 0 0";
      tagPrice.style.justifyContent = onLeft ? "flex-start" : "flex-end";
      tagCd.style.left = onLeft ? "0" : "auto";
      tagCd.style.right = onLeft ? "auto" : "0";
      tagCd.style.textAlign = onLeft ? "left" : "right";
      extendedKind.style.borderRadius = onLeft ? "0 2px 2px 0" : "2px 0 0 2px";
      extendedSlot.style.justifyContent = onLeft ? "flex-end" : "flex-start";
      extendedValue.style.borderRadius = onLeft ? "2px 0 0 2px" : "0 2px 2px 0";
      extendedValue.style.justifyContent = onLeft ? "flex-end" : "flex-start";
      hoverTag.style.justifyContent = onLeft ? "flex-start" : "flex-end";
      hoverTag.style.textAlign = onLeft ? "left" : "right";
    };

    // While a SUB-pane is maximized the price pane is DOM-hidden — every overlay that projects
    // price-pane coordinates (signal pills, gap zones, drawings, ichimoku/ribbon fills, the
    // last-price tag) must clear/hide itself instead of painting over the maximized pane.
    const priceProjHidden = () => { const c = paneCtl.current; return c.maximized != null && c.maximized !== "__price__"; };

    const priceIdx = () => { try { return priceSeriesRef.current?.getPane()?.paneIndex() ?? 0; } catch { return 0; } };
    // Lightweight Charts returns y coordinates relative to the series' pane, whereas these DOM
    // labels are children of the full chart wrapper. Resolve the pane's live offset on every paint:
    // panes can be reordered, collapsed, resized, or restored without rebuilding this effect.
    const pricePaneGeometry = () => {
      let top = 0;
      let height = 0;
      try {
        const pane = priceSeriesRef.current?.getPane();
        const paneEl = pane?.getHTMLElement();
        const wrapRect = wrap.getBoundingClientRect();
        if (paneEl) {
          const paneRect = paneEl.getBoundingClientRect();
          top = paneRect.top - wrapRect.top;
          height = paneRect.height;
        }
      } catch {}
      if (!(height > 0)) { try { height = chart.paneSize(priceIdx()).height; } catch {} }
      return { top, height };
    };
    const scaleMode = (s: ISeriesApi<any>) => {
      try { return s.priceScale().options().mode; } catch { return chartSettingsRef.current.mode ?? PriceScaleMode.Normal; }
    };
    const visibleScaleBasePrice = (s: ISeriesApi<any>) => {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (range == null) return barsRef.current[0]?.c ?? null;
      try {
        const data = s.dataByIndex(Math.floor(range.from), MismatchDirection.NearestRight) as any;
        return data?.close ?? data?.value ?? null;
      } catch { return null; }
    };
    const scalePriceText = (s: ISeriesApi<any>, value: number) => {
      const mode = scaleMode(s);
      const displayValue = priceScaleDisplayValue(value, visibleScaleBasePrice(s), mode);
      const digits = mode === PriceScaleMode.Percentage || mode === PriceScaleMode.IndexedTo100 ? 2 : precRef.current;
      const text = displayValue.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
      return mode === PriceScaleMode.Percentage ? `${text}%` : text;
    };
    let refreshHoverTag = () => {};
    const renderPriceTags = () => {
      const tag = priceTagRef.current, s = priceSeriesRef.current;
      if (!tag || !s || dead) return;
      if (priceProjHidden()) { tag.style.display = "none"; extendedTag.style.display = "none"; return; }
      const bars = barsRef.current; const last = bars[bars.length - 1];
      if (!last) { tag.style.display = "none"; extendedTag.style.display = "none"; return; }
      const price = last.c;
      const y = s.priceToCoordinate(price) as number | null;
      if (y == null || !Number.isFinite(y)) { tag.style.display = "none"; extendedTag.style.display = "none"; return; }
      const prev = bars[bars.length - 2];
      const up = prev ? price >= prev.c : price >= last.o;
      const col = up ? tokensRef.current.up : tokensRef.current.down;
      tagSym.textContent = symbolRef.current;
      tagPrice.textContent = scalePriceText(s, price);
      let cd = "";
      if (replayIdxRef.current == null) {                     // no meaningful "time to close" while replaying history
        const nowSec = Date.now() / 1000; let rem: number | null = null;
        if (isIntradayRef.current) {
          const mins = tfMinutes(timeframeRef.current); const openTs = Number(last.time);
          const displayNow = liveDisplayEpoch(Date.now(), classify(symbolRef.current));
          if (mins > 0 && isFinite(openTs) && displayNow != null) rem = openTs + mins * 60 - displayNow;
        } else {
          rem = periodCloseTs(timeframeRef.current, nowSec, classify(symbolRef.current)) - nowSec;
        }
        if (rem != null && isFinite(rem)) cd = fmtCountdown(rem, isIntradayRef.current);
      }
      tagCd.textContent = cd;
      const cdShown = !!cd && countdownVisibleRef.current;
      tagCd.style.display = cdShown ? "block" : "none";
      tagSym.style.background = col; tagVal.style.background = col;
      const settings = chartSettingsRef.current;
      const baseLaneWidth = Math.max(
        PRICE_TAG_MIN_VALUE_WIDTH,
        measuredLabelWidth(tagPrice, tagPrice.textContent || "", 10),
        cdShown ? measuredLabelWidth(tagCd, cd, 10) : 0,
      );
      applyLabelLayout(!!settings.scaleLeft, baseLaneWidth);
      const shown = lastValueVisibleRef.current;
      tag.style.display = shown ? "grid" : "none";
      const paneGeometry = pricePaneGeometry();
      const primaryTop = paneGeometry.top + priceTagRowTop(y);
      tag.style.top = primaryTop + "px";              // immutable: only price/scale movement changes this
      tag.dataset.anchorY = String(y);
      tag.dataset.paneTop = String(paneGeometry.top);

      const quote = liveQuoteRef.current;
      const extVisible = !isIntradayRef.current
        && replayIdxRef.current == null
        && chartDataSymRef.current === symbolRef.current
        && classify(symbolRef.current) === "us"
        && !isMacroSymbol(symbolRef.current)
        && settings.extendedLineVisible !== false
        && !!quote?.extSession
        && quote.extPrice != null
        && Number.isFinite(quote.extPrice)
        && quote.extPrice > 0;
      if (!extVisible) { extendedTag.style.display = "none"; return; }

      const extendedY = s.priceToCoordinate(quote!.extPrice!) as number | null;
      if (extendedY == null || !Number.isFinite(extendedY)) { extendedTag.style.display = "none"; return; }
      const extendedColor = quote!.extSession === "pre"
        ? settings.preMarketColor || "#ff9800"
        : quote!.extSession === "post"
          ? settings.postMarketColor || "#2962ff"
          : settings.overnightColor || "#9c27b0";
      extendedKind.textContent = quote!.extSession === "pre" ? "Pre" : quote!.extSession === "post" ? "AH" : "ON";
      const extendedText = scalePriceText(s, quote!.extPrice!);
      extendedValue.textContent = extendedText;
      extendedKind.style.background = extendedColor; extendedValue.style.background = extendedColor;
      applyLabelLayout(
        !!settings.scaleLeft,
        Math.max(baseLaneWidth, measuredLabelWidth(extendedValue, extendedText, 16)),
      );
      const paneH = paneGeometry.height;
      const naturalTop = priceTagRowTop(extendedY);
      const extendedPaneTop = shown
        ? secondaryPriceTagTop({
            primaryY: y,
            secondaryY: extendedY,
            paneHeight: paneH,
            primaryHeight: PRICE_TAG_ROW_HEIGHT + (cdShown ? PRICE_TAG_TIME_HEIGHT : 0),
          })
        : naturalTop;
      const extendedTop = paneGeometry.top + extendedPaneTop;
      extendedTag.style.top = extendedTop + "px";
      extendedTag.style.display = "grid";
      extendedTag.dataset.anchorY = String(extendedY);
      extendedTag.dataset.naturalTop = String(paneGeometry.top + naturalTop);
      extendedTag.dataset.docked = Math.abs(extendedPaneTop - naturalTop) > 0.5 ? "true" : "false";
    };
    const renderAllPriceTags = () => { renderPriceTags(); refreshHoverTag(); };
    renderTagRef.current = renderAllPriceTags;
    let hoverState: { pointerY: number; snappedPrice: number | null } | null = null;
    const renderHoverTag = (y: number | null, price?: number | null) => {
      hoverState = y == null || !Number.isFinite(y)
        ? null
        : { pointerY: y, snappedPrice: price != null && Number.isFinite(price) ? price : null };
      refreshHoverTag();
    };
    refreshHoverTag = () => {
      const tag = hoverTagRef.current;
      if (!tag || !hoverState || priceProjHidden()) { if (tag) tag.style.display = "none"; return; }
      const s = priceSeriesRef.current;
      if (!s) { tag.style.display = "none"; return; }
      const y = hoverState.snappedPrice == null
        ? hoverState.pointerY
        : (s.priceToCoordinate(hoverState.snappedPrice) as number | null);
      if (y == null || !Number.isFinite(y)) { tag.style.display = "none"; return; }
      const value = hoverState.snappedPrice ?? (s.coordinateToPrice(y) as number | null);
      if (value == null || !Number.isFinite(value)) { tag.style.display = "none"; return; }
      tag.textContent = scalePriceText(s, value);
      tag.style.background = tokensRef.current.p3;
      const axisFontSize = (() => { try { return Number((chart.options() as any).layout?.fontSize) || 12; } catch { return 12; } })();
      // LWC: font + price-label padding (2 x 2.5/12fs) + crosshair padding (2 x 2/12fs).
      const hoverHeight = Math.ceil(axisFontSize * 7 / 4);
      tag.style.height = `${hoverHeight}px`;
      tag.style.font = `500 ${axisFontSize}px/${hoverHeight}px var(--font-num)`;
      tag.style.top = pricePaneGeometry().top + priceTagRowTop(y, hoverHeight) + "px";
      const onLeft = !!chartSettingsRef.current.scaleLeft;
      placeOnAxisEdge(tag, onLeft);
      // Cover the complete native price-axis label beneath us: text plus its fixed tick/border and
      // font-scaled inner/outer padding. This prevents duplicate glyph edges at custom font sizes.
      const nativeHorizontalPadding = Math.ceil(6 + axisFontSize * (10 / 12));
      tag.style.width = `${Math.max(priceLaneWidth, measuredLabelWidth(tag, tag.textContent, nativeHorizontalPadding))}px`;
      tag.style.justifyContent = onLeft ? "flex-start" : "flex-end";
      tag.style.textAlign = onLeft ? "left" : "right";
      tag.style.display = "flex";
      crossLabelYRef.current = y;
    };
    renderHoverTagRef.current = renderHoverTag;
    // `point.y` is PANE-relative — the same space priceToCoordinate returns — but LWC reports the
    // ORIGINAL pointer point even after Magnet has snapped its horizontal line. Mirror LWC's own
    // Magnet candidate selection from the event's public seriesData: visible, non-overlay series in
    // this pane, using each series' close/value transformed through its own scale. This covers
    // Heikin-Ashi and price-pane studies without reaching into Lightweight Charts internals.
    const onTagCrosshair = (p: any) => {
      let y: number | null = null;
      let snappedPrice: number | null = null;
      const pt = p?.point;
      if (pt && Number.isFinite(pt.y) && (p.paneIndex == null || p.paneIndex === priceIdx())) {
        y = pt.y;
        if (chartSettingsRef.current.crosshairMode === 1) {
          const s = priceSeriesRef.current;
          let nearestY: number | null = null;
          let nearestDistance = Infinity;
          const data = p?.seriesData;
          if (data instanceof Map) {
            for (const [candidate, datum] of data as Map<ISeriesApi<any>, any>) {
              try {
                if (candidate.options()?.visible === false || candidate.getPane()?.paneIndex() !== priceIdx()) continue;
                const scaleId = candidate.options()?.priceScaleId;
                if (scaleId && scaleId !== "left" && scaleId !== "right") continue; // explicit overlay scale
                const value = Number.isFinite(datum?.close) ? datum.close : Number.isFinite(datum?.value) ? datum.value : null;
                if (value == null) continue;
                const candidateY = candidate.priceToCoordinate(value) as number | null;
                if (candidateY == null || !Number.isFinite(candidateY)) continue;
                const distance = Math.abs(candidateY - pt.y);
                if (distance < nearestDistance) { nearestDistance = distance; nearestY = candidateY; }
              } catch {}
            }
          }
          if (nearestY != null) {
            y = nearestY;
            const snapped = s ? (s.coordinateToPrice(nearestY) as number | null) : null;
            if (snapped != null && Number.isFinite(snapped)) snappedPrice = snapped;
          }
        }
      }
      const prev = crossLabelYRef.current;
      if (y == null && prev == null) return;
      crossLabelYRef.current = y;
      renderHoverTag(y, snappedPrice);
    };
    chart.subscribeCrosshairMove(onTagCrosshair);
    tagTimerRef.current = window.setInterval(() => { if (!dead) renderAllPriceTags(); }, 1000);

    // ── coordinate helpers (read *Ref.current so they stay valid across reloads) ──
    const dcol = (d: Drawing) => d.color?.startsWith("var(") ? css(d.color.slice(4, -1)) : (d.color || tokensRef.current.brand2);
    // Bar/drawing times span two families: daily bars are "YYYY-MM-DD" strings, intraday
    // bars are numeric epoch-seconds. Reduce EITHER to ms so a daily-anchored drawing snaps
    // to the right intraday bar (and vice versa) instead of NaN-collapsing onto bar 0.
    // Dates anchor at NOON UTC so a US-session intraday time (13:30–20:00 UTC) maps to the
    // same calendar day rather than the next.
    const toMs = (t: string | number): number => {
      if (typeof t === "number") return t * 1000;
      if (/^\d+$/.test(t)) return Number(t) * 1000;
      return +new Date(t + "T12:00:00Z");
    };
    // Return the CANONICAL bar time (b[idx].time, the exact type LWC's setData used) for an exact match,
    // O(1) via the barIdxMap. Non-exact times fall back to the nearest-bar scan (rare — off-grid drawing
    // anchors / cross-TF snapping). Returning the canonical time keeps xOf's timeToCoordinate on the type
    // it was fed. `tm` may be a string (daily) or a number (intraday epoch) despite the string annotation.
    const snapT = (tm: string) => {
      const b = barsRef.current; if (!b.length) return tm;
      const idx = barIdxMap().get(tm as any) ?? barIdxMap().get(String(tm));
      if (idx != null) return b[idx].time as any;
      // A future-grid slot is a deliberate anchor, not an off-grid time: clamping
      // it to the nearest bar is what pinned every drawing to the live edge.
      if (futureOffset(tm) >= 0) return tm as any;
      const x = toMs(tm); if (!Number.isFinite(x)) return b[0].time;
      let best = b[0].time, bd = Infinity; for (const r of b) { const dd = Math.abs(toMs(r.time) - x); if (dd < bd) { bd = dd; best = r.time; } } return best;
    };
    const xOf = (tm: string) => {
      // The series has no data point past the newest candle, so a future anchor
      // is projected from its logical index instead of from its timestamp.
      const offset = futureOffset(tm);
      if (offset >= 0) {
        const logical = barsRef.current.length + offset;
        return chart.timeScale().logicalToCoordinate(logical as any) as number | null;
      }
      return chart.timeScale().timeToCoordinate(snapT(tm) as any) as number | null;
    };
    // ── pane-scoped price projection ────────────────────────────────────────
    // A drawing placed over an indicator sub-pane used to store the price the
    // MAIN series reads at that y — a value far outside its scale. Because the
    // price scale autoscales to the visible bars, every zoom/pan re-extrapolated
    // that value and slid the object vertically (the "my brush circles move when
    // I scroll" report), until it eventually drifted off screen. Anchors now
    // record the pane they were drawn in and project through THAT pane's series.
    const PRICE_PANE_KEY = "__price__";
    const seriesForPane = (key: string | null | undefined): ISeriesApi<any> | null => {
      if (!key || key === PRICE_PANE_KEY) return priceSeriesRef.current ?? null;
      const info = paneLayoutRef.current.find((pane) => pane.key === key);
      if (!info) return null;
      try { return chartRef.current?.panes()[info.paneIndex]?.getSeries()?.[0] ?? null; } catch { return null; }
    };
    /** Pane key under a pane-space y, or null while the layout is unmeasured. */
    const paneKeyAt = (py: number): string | null =>
      paneLayoutRef.current.find((pane) => py >= pane.top && py <= pane.top + pane.height)?.key ?? null;
    /** The pane an existing drawing belongs to; absent meta means the price pane. */
    const drawingPaneKey = (d: Pick<Drawing, "meta">): string | null =>
      typeof d.meta?.pane === "string" ? d.meta.pane : null;
    const yOfIn = (p: number, paneKey?: string | null) => {
      const s = seriesForPane(paneKey);
      return s ? (s.priceToCoordinate(p) as number | null) : null;
    };
    const priceAtIn = (py: number, paneKey?: string | null) => {
      const s = seriesForPane(paneKey);
      return s ? (s.coordinateToPrice(py) as number | null) : null;
    };
    const yOf = (p: number) => yOfIn(p, null);
    const barIndex = (tm: string) => {
      const idx = barIdxMap().get(tm as any) ?? barIdxMap().get(String(tm));
      if (idx != null) return idx;
      const offset = futureOffset(tm);
      if (offset >= 0) return barsRef.current.length + offset;
      const tt = snapT(tm); const j = barIdxMap().get(tt as any); return j == null ? -1 : j;
    };

    // ── signal badges: BUY/SELL (★) + RE-BUY pill; GC v2 keeper quality/tier styling + CUT caution ──
    const renderSignals = () => {
      const layer = sigRef.current; if (!layer) return; const t2 = tokensRef.current;
      sigHits = null;   // markers are about to be repainted → the hover hit boxes are stale
      type SigCfg = { dir: "up" | "down"; fill: string; tc: string; txt: string; star?: boolean; hollow?: boolean };
      const SIGCFG: Record<string, SigCfg> = {
        BUY:   { dir: "up",   fill: t2.buy,    tc: "#fff",     txt: "★",      star: true },
        SELL:  { dir: "down", fill: t2.sell,   tc: "#fff",     txt: "★",      star: true },
        REBUY: { dir: "up",   fill: "#b6e94a", tc: "#16310a",  txt: "RE-BUY" },
        CUT:   { dir: "down", fill: "#ff8a3d", tc: "#2a1400",  txt: "CUT" },
        // reclaim-lane re-entry (slice-sourced): ALWAYS hollow — the glyph law reserves the
        // solid star for the classic confluence entries even now that the lane is scored.
        RECLAIM: { dir: "up", fill: t2.buy,    tc: t2.buy,     txt: "RE-ENTRY", hollow: true },
        BOTTOM_WATCH: { dir: "up", fill: t2.signal, tc: "#231800", txt: "EARLY" },
      };
      // HK-O1: a slice SELL is a TRAILING STRUCTURE STOP (armed distribution + a daily close
      // below the last confirmed swing low), never the MACD-RSI cross-down. It gets its own
      // pill — the solid ★ stays reserved for a momentum sell, which this stream has not
      // emitted since the GC v2 unification (0700.HK printed ★ SELL on 2026-07-24 with its
      // own 3D RSI-MACD reading bull). The client-Pine fallback keeps the ★: its SELL really
      // is the momentum cross.
      const STOPCFG: SigCfg = { dir: "down", fill: t2.sell, tc: "#fff", txt: "STOP" };
      // GC v2 tier → marker badge glyph (aplus="A+", quality="Q", base/none → no badge).
      const tierBadge = (tier?: string | null) => (tier === "aplus" ? "A+" : tier === "quality" ? "Q" : "");
      const SLATE = "#7c8aa0";   // regime_blocked dim slate (no matching CSS token — inline hex)
      // washout-override amber. `--signal` (#e8b339) resolved through the token reader rather
      // than written as a literal, so the marker tracks the token the rail card uses.
      const AMBER = t2.signal || "#e8b339";
      // ── the marker's hover/tap tooltip ──────────────────────────────────────────────────────
      // The WORDING is not here: `markerTooltipCopy` owns every class's sentence, bilingual, built
      // from the reviewed copy the rail card already prints. These strings were hand-rolled English
      // literals in this loop for as long as they existed, which was invisible under the bilingual
      // -UI law only because `pointer-events:none` meant nobody could read them. Reviving them made
      // that a live regression for zh readers, so the copy moved to the copy module.
      //
      // The language is read per RENDER, not captured once: `tPlain`'s own contract in i18n.tsx is
      // that imperative callers refresh on their own rebuild paths, and this is that path — the
      // `mm:lang` listener in EFFECT 8b re-renders the markers, so a language toggle re-titles them.
      const zhNow = typeof document !== "undefined"
        && document.documentElement.getAttribute("data-lang") === "zh";
      const addMarkerTitle = (g: SVGElement, m: SigMark) => {
        const text = markerTooltipCopy(m, zhNow);
        if (!text) return;
        const title = mk("title", {});
        title.textContent = text;
        g.appendChild(title);
      };
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      if (priceProjHidden()) return;   // sub-pane maximized → price-anchored markers stay cleared

      // Prophet receipts are deliberately outside the Oracle study toggle. A sapphire diamond
      // says "another system surfaced this name here" without borrowing Oracle's star/pill grammar.
      for (const m of sigMarksRef.current) {
        if (m.type !== "PROPHET") continue;
        const x = xOf(m.t), y = yOf(m.price); if (x == null || y == null) continue;
        const cy = y + 22, r = 7, fill = "#5b8cff";
        const glyph = opportunityMarkerGlyph(m.source);
        const g = mk("g", { opacity: 0.96, "data-signal-source": glyph === "R" ? "reversal_watch" : "prophet_board" });
        g.appendChild(mk("path", { d: `M${x} ${cy - r} L${x + r} ${cy} L${x} ${cy + r} L${x - r} ${cy} Z`, fill, stroke: "#9bb7ff", "stroke-width": 1 }));
        const tEl = mk("text", { x, y: cy + 3.2, fill: "#fff", "font-size": 8.5, "font-weight": 900, "text-anchor": "middle", "font-family": "var(--font-ui)" });
        tEl.textContent = glyph; g.appendChild(tEl);
        addMarkerTitle(g, m); layer.appendChild(g);
      }

      // ── Gap Zones premade indicator ──────────────────────────────────────────────
      // Independent of the oracle (drawn BEFORE the oracle gate below). Detects TRUE DAILY gaps — a day
      // whose whole range clears the prior day's — on the DAILY bars (so they show on ANY timeframe),
      // and draws each as a shaded supply/demand ZONE: a gap up (low > prevHigh) leaves the empty band
      // [prevHigh, low] that acts as support; a gap down (high < prevLow) leaves [high, prevLow] as
      // resistance. Each zone extends right until a later daily bar trades back into it (fills it):
      // unfilled zones are solid & reach the last bar; filled zones fade back and stop at the fill bar.
      // `minGapPct` filters by size; `maxGaps` caps the recent FILLED zones (unfilled always shown).
      if (indicatorsRef.current.has("gaps") && !hiddenRef.current.has("gaps") && tfVisible("gaps")) {
        const gp = P("gaps");
        if (gp.showGaps !== false) {
          const thr = Math.max(0, gp.minGapPct ?? 0) / 100;
          const maxGaps = Math.max(1, Math.round(gp.maxGaps ?? 40));
          const hideFilled = gp.hideFilled === true;
          const cur = barsRef.current;
          const daily = dailyBarsRef.current.length ? dailyBarsRef.current : cur;
          // current bars may be daily (YYYY-MM-DD strings) or intraday (numeric epoch secs) → a calendar date
          const dstr = (t: string | number) => (typeof t === "string" ? t : new Date((t as number) * 1000).toISOString().slice(0, 10));
          // PERF: memoize the O(daily²) gap+fill detection AND the dayToBar map. These are pure functions
          // of (daily bars, cur bars, thr) — NONE depend on the crosshair/range — so recompute only when
          // the underlying bar array identity (or the size threshold) changes. `cur`/`daily` reassign to a
          // fresh array on every data/replay/splice, so array-identity is a sound cache key.
          // Key on daily identity + thr; the dayToBar map is derived from `cur`, which reassigns in
          // lockstep with `daily` on every data change, so caching them together is safe.
          const cache = gapZonesRef.current;
          if (cache.src !== daily || cache.thr !== thr) {
            const dayToBar = new Map<string, Bar["time"]>();
            for (const b of cur) { const d = dstr(b.time); if (!dayToBar.has(d)) dayToBar.set(d, b.time); }
            const gaps: GapZone[] = [];
            for (let i = 1; i < daily.length; i++) {
              const b = daily[i], pb = daily[i - 1];
              let g: GapZone | null = null;
              if (pb.h > 0 && b.l > pb.h && (b.l - pb.h) / pb.h >= thr) g = { date: dstr(b.time), type: "up", lo: pb.h, hi: b.l, fill: null };
              else if (pb.l > 0 && b.h < pb.l && (pb.l - b.h) / pb.l >= thr) g = { date: dstr(b.time), type: "down", lo: b.h, hi: pb.l, fill: null };
              if (!g) continue;
              for (let j = i + 1; j < daily.length; j++) { if (g.type === "up" ? daily[j].l <= g.lo : daily[j].h >= g.hi) { g.fill = dstr(daily[j].time); break; } }
              gaps.push(g);
            }
            gapZonesRef.current = { src: daily, thr, map: dayToBar, gaps };
          }
          const { map: dayToBar, gaps } = gapZonesRef.current;
          const lastX = cur.length ? xOf(cur[cur.length - 1].time) : null;
          // unfilled zones are the actionable ones → always drawn; filled ones are context → recent-capped.
          const shown = [...(hideFilled ? [] : gaps.filter((g) => g.fill).slice(-maxGaps)), ...gaps.filter((g) => !g.fill)];
          for (const g of shown) {
            const t1 = dayToBar.get(g.date); if (t1 == null) continue;
            const x1 = xOf(t1); if (x1 == null) continue;
            const t2 = g.fill ? dayToBar.get(g.fill) : null;
            const x2 = (t2 != null ? xOf(t2) : null) ?? lastX; if (x2 == null) continue;
            const yHi = yOf(g.hi), yLo = yOf(g.lo); if (yHi == null || yLo == null) continue;
            const col = (g.type === "up" ? gp.gapUpCol : gp.gapDownCol) as string;
            const filled = !!g.fill;
            const x = Math.min(x1, x2), w = Math.max(1, Math.abs(x2 - x1)), y = Math.min(yHi, yLo), h = Math.max(1, Math.abs(yLo - yHi));
            const grp = mk("g", {});
            grp.appendChild(mk("rect", { x, y, width: w, height: h, fill: col, "fill-opacity": filled ? 0.05 : 0.15, stroke: col, "stroke-opacity": filled ? 0.18 : 0.55, "stroke-width": 1 }));
            layer.appendChild(grp);
          }
        }
      }

      // ── Lab signal markers (TLT-R4) ──────────────────────────────────────────
      // Descriptive research markers from the Macro Dashboard Technical Lab.
      // Default OFF (toggle via "Lab Signals" legend entry). No buy/sell wording.
      // dir +1 → ▲ glyph below the bar; dir -1 → ▼ glyph above; dir 0 → ○ below.
      // Multiple fires on the same date cluster into one marker with a count badge.
      if (indicatorsRef.current.has("_lab") && !hiddenRef.current.has("_lab")) {
        const labMap = labMarkersRef.current;
        const LAB_UP_COL = "#60a5fa";    // blue-400 — neutral descriptive color
        const LAB_DN_COL = "#f87171";    // red-400
        const LAB_NEU_COL = "#94a3b8";   // slate-400
        for (const [date, items] of labMap) {
          const x = xOf(date); if (x == null) continue;
          const b = barsRef.current[barIndex(date)]; if (!b) continue;
          // Determine dominant direction of this cluster (+1/>0 → up, -1/<0 → down, else neutral)
          const dirSum = items.reduce((acc, it) => acc + it.dir, 0);
          const isUp = dirSum > 0;
          const isDn = dirSum < 0;
          const col = isUp ? LAB_UP_COL : isDn ? LAB_DN_COL : LAB_NEU_COL;
          const glyph = isUp ? "▲" : isDn ? "▼" : "○";
          const y = isUp ? yOf(b.l) : yOf(b.h);
          if (y == null) continue;
          const offset = isUp ? 14 : -14;
          const cy = y + offset;
          const g = mk("g", { opacity: 0.88 });
          // Circle background for readability
          g.appendChild(mk("circle", { cx: x, cy, r: 7.5, fill: col, opacity: 0.15 }));
          // Glyph
          const tEl = mk("text", {
            x,
            y: cy + (isUp ? 3.5 : isDn ? 3.5 : 4),
            "font-size": isUp || isDn ? 8 : 9,
            "text-anchor": "middle",
            fill: col,
            "font-family": "var(--font-ui)",
          });
          tEl.textContent = glyph;
          g.appendChild(tEl);
          // Count badge (when > 1 signal on the same date)
          if (items.length > 1) {
            const bEl = mk("text", { x: x + 6, y: cy - 5, "font-size": 7.5, fill: col, "font-weight": 700, "font-family": "var(--font-ui)" });
            bEl.textContent = String(items.length);
            g.appendChild(bEl);
          }
          // Tooltip: title attribute lists signal names (native hover, no JS needed)
          const names = items.map((it) => `${it.name} (${it.dir > 0 ? "↑" : it.dir < 0 ? "↓" : "○"})`).join("\n");
          const titleEl = mk("title", {});
          titleEl.textContent = `${date}\n${names}`;
          g.appendChild(titleEl);
          layer.appendChild(g);
        }
      }

      // Golden Oracle Confluence is a toggleable/removable study: skip ALL signal draws (marks + side
      // channels) when it's removed from the indicator set or hidden via the legend eye.
      if (!indicatorsRef.current.has("_oracle") || hiddenRef.current.has("_oracle")) return;

      // GC v2: fast-reversal CUT is a caution, NOT an exit — render a small orange "•caution" dot below
      // the bar instead of the old down-pointing CUT pill (the ✕/exit look). Everything else keeps the pill.
      for (const m of sigMarksRef.current) {
        if (m.type === "PROPHET") continue;
        if (m.type === "CUT") {
          const x = xOf(m.t), y = yOf(m.price); if (x == null || y == null) continue;
          const cy = y + 16;
          const g = mk("g", { opacity: 0.9 });
          g.appendChild(mk("circle", { cx: x, cy, r: 3.4, fill: "#ff8a3d" }));
          const tEl = mk("text", { x: x + 6, y: cy + 3, fill: "#ff8a3d", "font-size": 8.5, "font-weight": 700, "text-anchor": "start", "font-family": "var(--font-ui)", "letter-spacing": ".02em" });
          tEl.textContent = "caution";
          g.appendChild(tEl);
          layer.appendChild(g);
          continue;
        }
        // ── HK-O1: a REFUSED entry is an annotation, never buy geometry ──
        // The emitter still types it BUY/REBUY so old readers parse, but 9988.HK's
        // 2026-07-09 regime-vetoed entry drew a solid up-pointing star on the price series
        // and the operator chased it. A blocked setup now renders as a hollow slate ring
        // with a slash — no pill, no pointer, no star — below the bar, with the block
        // reason on hover. It cannot be mistaken for an entry at a glance.
        // A RETRO-marked refusal leaves the refusal geometry behind: the question it answers
        // ("would today's rule have entered here?") is an entry question, so it is drawn with
        // entry geometry below. What it must never do is answer it silently — the entry
        // branch gives it a persistent, glance-tier `retro` tag for exactly that reason.
        if ((m.blocked || m.quality === "regime_blocked") && !m.retro) {
          const x = xOf(m.t), y = yOf(m.price); if (x == null || y == null) continue;
          const cy = y + 15, r = 5.4, k = r * 0.707;
          // ── washout-override candidate: the SAME ring-slash, promoted in weight only ──
          // Ratified 2026-08-10 (25% notch). It is still a refusal, so it keeps the ring and
          // the slash — no star, no pill, no pointer, nothing borrowed from entry geometry.
          // What changes is that it stops being background: amber at full opacity instead of
          // slate at 0.62, plus a small amber dot above the ring so a ⊘ worth reading is
          // findable in a dense marker field without zooming.
          const ovr = !!m.overrideCandidate;
          const stroke = ovr ? AMBER : SLATE;
          const g = mk("g", { opacity: ovr ? 1 : 0.62 });
          g.appendChild(mk("circle", { cx: x, cy, r, fill: "none", stroke, "stroke-width": 1.3 }));
          g.appendChild(mk("line", { x1: x - k, y1: cy + k, x2: x + k, y2: cy - k, stroke, "stroke-width": 1.3 }));
          if (ovr) g.appendChild(mk("circle", { cx: x, cy: cy - r - 4, r: 1.5, fill: AMBER }));
          addMarkerTitle(g, m);
          layer.appendChild(g);
          continue;
        }
        const stop = isStructureStop(m);
        const starter = (m.quality === "block" || m.quality === "pending")
          && (m.type === "BUY" || m.type === "REBUY");
        const baseCfg = stop ? STOPCFG : SIGCFG[m.type]; if (!baseCfg) continue;
        // Keeper block/pending has always been traded by the backtest/state/alerts. Render the
        // authority it actually has: an amber starter, not a gray refused dot.
        const cfg: SigCfg = starter
          ? { dir: "up", fill: AMBER, tc: "#231800", txt: "STARTER" }
          : baseCfg;
        const x = xOf(m.t), y = yOf(m.price); if (x == null || y == null) continue;
        const star = !!cfg.star;
        // GC v2 quality: take=solid, block=hollow outline, pending=dim gray.
        // Softness gates on signalVerdict's SOFT_Q set (not the type) so an engine-refused mark of ANY
        // type renders subordinate; RECLAIM's own lane qualities (reclaim/block_repair) are NOT soft and
        // keep the dashed-hollow re-entry law. A soft mark must never wear the scored style.
        // (regime_blocked no longer reaches here at all — HK-O1 gives it its own annotation glyph
        // above, because dimming a BUY star still leaves a BUY star.)
        // A RETRO fire is exempt from softening, and this is the line that makes the class
        // coherent. Its `quality` is still its REFUSAL quality — mark_retro never rewrites it,
        // deliberately, so it can never enter the scored lane — and both refusal strings live
        // in SOFT_Q. Left alone, the two halves of one display class rendered as two different
        // things: a `regime_blocked` retro came out solid (SOFT_Q's regime_blocked branch
        // changes no fill), while a KEEPER-block retro hit `hollow = q === "block"` and came
        // out as an unfilled outline — the subordinate treatment the order specifically says a
        // re-mark must not wear. Excluding retro here draws both as the entry the projection
        // says they would have been.
        const q = !m.retro && m.quality != null && SOFT_Q.has(m.quality) ? m.quality : undefined;
        const hollow = !!cfg.hollow;
        const fill = cfg.fill;
        const groupOp = starter ? 0.94 : 0.97;
        // tier badge ("A+"/"Q") shown only for TAKEN entries (quality take/undefined); suppressed on soft.
        const badge = (m.type === "BUY" || m.type === "REBUY") && q == null ? tierBadge(m.tier) : "";
        const w = star ? 19 : Math.max(20, 9 + cfg.txt.length * 7), h = 15, r = 4, ptr = 5, gap = 9;
        const up = cfg.dir === "up";
        const top = up ? y + gap + ptr : y - gap - ptr - h;
        const g = mk("g", { opacity: groupOp });
        // R14 jump pulse: an expanding ring behind the marker (transient highlight flag, ~2.5s)
        if ((m as any).highlight) {
          const ring = mk("circle", { cx: x, cy: top + h / 2, r: w, fill: "none", stroke: fill, "stroke-width": 2, opacity: 0.9 });
          ring.appendChild(mk("animate", { attributeName: "r", values: `${w};${w * 2.4}`, dur: "0.9s", repeatCount: "indefinite" }));
          ring.appendChild(mk("animate", { attributeName: "opacity", values: "0.9;0", dur: "0.9s", repeatCount: "indefinite" }));
          g.appendChild(ring);
        }
        // ── washout-override ENTRY (era gc_v2_wo1): the ordinary star, outlined amber ──
        // It IS an entry, so it keeps entry geometry and the full buy fill — dimming or
        // hollowing it would say the engine hedged, and the engine did not. The delta is
        // the smallest one that still reads at a glance: the amber the ⊘ class already
        // owns, drawn as an outline around the pill and its pointer, so the two states of
        // one mechanism share a colour across the chart.
        const ovrTake = !!m.overrideTake;
        const retro = !!m.retro;
        const outline = (ovrTake || retro) ? { stroke: AMBER, "stroke-width": 1.6 } : null;
        // block → hollow (fill:none + colored stroke); take/pending/regime_blocked → solid (possibly dimmed) fill.
        // RECLAIM additionally DASHES the outline so a re-entry pill never reads as a keeper-blocked entry.
        const dash = m.type === "RECLAIM" ? "3 2" : undefined;
        g.appendChild(mk("rect", { x: x - w / 2, y: top, width: w, height: h, rx: r, ry: r, fill: hollow ? "none" : fill, stroke: hollow ? fill : "none", "stroke-width": hollow ? 1.4 : 0, ...(dash ? { "stroke-dasharray": dash } : {}), ...(outline || {}) }));
        g.appendChild(mk("path", { d: up ? `M${x - ptr} ${top} L${x + ptr} ${top} L${x} ${top - ptr} Z` : `M${x - ptr} ${top + h} L${x + ptr} ${top + h} L${x} ${top + h + ptr} Z`, fill: hollow ? "none" : fill, stroke: hollow ? fill : "none", "stroke-width": hollow ? 1.4 : 0, ...(outline || {}) }));
        const tEl = mk("text", { x, y: top + h / 2 + (star ? 4.3 : 3.4), fill: hollow ? fill : cfg.tc, "font-size": star ? 11.5 : 9, "font-weight": 800, "text-anchor": "middle", "font-family": star ? "Georgia,serif" : "var(--font-ui)", "letter-spacing": star ? "0" : ".02em" });
        tEl.textContent = cfg.txt;
        g.appendChild(tEl);
        // The hover/tap tooltip. Every class's wording lives in signalVerdict.markerTooltipCopy —
        // bilingual, and composed from the same reviewed copy the rail card prints, so hover and
        // card agree and neither can drift. The RETRO branch in particular reached a reader only
        // with the marker-tooltip repair: #378 made it reachable, but the layer is
        // `pointer-events:none`, so until the hover path was wired the string existed, was
        // correct, and displayed to nobody. It is a BONUS tier — the card legend below remains
        // the disclosure of record.
        addMarkerTitle(g, m);
        // ── WHY THE RETRO MARKER CARRIES NO TAG OF ITS OWN (operator order 2026-08-10) ──
        // It is drawn exactly like a live waived entry: same star, same amber outline, no
        // marker-level mark separating the two. That is deliberate, and it is a decision with
        // a cost, so here is where the cost is accounted for.
        //
        // The disclosure is NOT this marker's `<title>`. That tooltip DOES render now — the
        // marker-tooltip repair drives it from a JS hit test on `wrap` (see the note at the
        // `sigTip` construction; for the whole of this class's history before that it displayed
        // to nobody, because the layer is `pointer-events:none`). Nothing about that promotes it
        // to the disclosure: a hover is invisible on touch until tapped, invisible in a
        // screenshot, and invisible to anyone skimming. It is a BONUS tier and nothing more.
        //
        // The disclosure of record is the CARD LEGEND (OracleDash `.sd-sig-legend`): a
        // persistent line, rendered whenever a re-marked fire sits in the visible signal
        // list, that resolves the "(retro)" row label in full. It needs no hover and no tap
        // and it survives a screenshot, which is what makes a clean chart face affordable.
        // If you are here to remove or weaken that legend: it is load-bearing, not decoration.
        // tier badge ("A+"/"Q") as a small superscript pill to the top-right of the marker (taken entries only).
        if (badge) {
          const bx = x + w / 2 + 1, by = top - 1;
          g.appendChild(mk("rect", { x: bx, y: by, width: badge.length * 6 + 4, height: 10, rx: 2, ry: 2, fill: fill, opacity: 0.92 }));
          const bEl = mk("text", { x: bx + (badge.length * 6 + 4) / 2, y: by + 8, fill: "#0b1220", "font-size": 7.5, "font-weight": 800, "text-anchor": "middle", "font-family": "var(--font-ui)" });
          bEl.textContent = badge;
          g.appendChild(bEl);
        }
        layer.appendChild(g);
      }

      // ── GC v2 side channels (toggleable via the "Signals detail" chip) ──
      if (showDetailRef.current) {
        // early_dots: faint small dot BELOW the bar (anticipation pre-cross) — distinct from the BUY ▲.
        for (const d of earlyDotsRef.current) {
          const x = xOf(d.t); if (x == null) continue;
          const b = barsRef.current[barIndex(d.t)];
          const y = b ? yOf(b.l) : null; if (y == null) continue;
          const g = mk("g", { opacity: 0.55 });
          g.appendChild(mk("circle", { cx: x, cy: y + 9, r: 2.2, fill: t2.mut }));
          layer.appendChild(g);
        }
        // warnings: ⚠ (arm) / ⛔ (confirm) small glyphs ABOVE the bar (structure-break anticipation).
        for (const w of warnMarksRef.current) {
          const x = xOf(w.t); if (x == null) continue;
          const b = barsRef.current[barIndex(w.t)];
          const y = b ? yOf(b.h) : null; if (y == null) continue;
          const g = mk("g", { opacity: 0.85 });
          const tEl = mk("text", { x, y: y - 8, "font-size": 11, "text-anchor": "middle", "font-family": "var(--font-ui)" });
          tEl.textContent = w.kind === "confirm" ? "⛔" : "⚠";
          g.appendChild(tEl);
          layer.appendChild(g);
        }
      }
    };
    renderSignalsRef.current = renderSignals;

    let snapTarget: { x: number; y: number } | null = null;
    // Pane key resolved by the most recent snap(); null means the price pane.
    // Read immediately after a snap call, in the same idiom as snapTarget.
    let snapPaneKey: string | null = null;
    type PaneAnchor = { x: number; y: number };
    const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
    const paneAnchorOf = (meta: Drawing["meta"]): PaneAnchor | null => {
      const anchor = meta?.paneAnchor;
      if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return null;
      const x = (anchor as Record<string, unknown>).x;
      const y = (anchor as Record<string, unknown>).y;
      if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) return null;
      return { x: clampUnit(x), y: clampUnit(y) };
    };
    const paneMetaAt = (x: number, y: number, meta?: Drawing["meta"]): Drawing["meta"] => ({
      ...(meta ?? {}),
      paneAnchor: {
        x: clampUnit(x / Math.max(1, el!.clientWidth)),
        y: clampUnit(y / Math.max(1, el!.clientHeight)),
      },
    });
    const snap = (
      px: number,
      py: number,
      modifier?: { ctrlKey?: boolean; metaKey?: boolean },
      forceMagnet?: "off",
    ) => {
      const prec = precRef.current;
      const bars = barsRef.current;
      // LWC logical coordinates map directly to the loaded bar array. This replaces the
      // former O(bars) scan on every pointer event with one projection + clamp.
      const logical = chart.timeScale().coordinateToLogical(px);
      const future = futureGrid().times;
      const bi = Math.max(0, Math.min(bars.length - 1 + future.length, Math.round(logical == null ? bars.length - 1 : logical)));
      // Past the newest candle the anchor takes a future-grid slot, which is a
      // real forward timestamp rather than a repeat of the last bar.
      const inFuture = bi >= bars.length && future.length > 0;
      const bar = inFuture ? undefined : bars[bi];
      const bt = inFuture ? future[Math.min(future.length - 1, bi - bars.length)] : (bar?.time ?? bars[bars.length - 1]?.time);
      // Resolve the value in the pane under the cursor. Outside the price pane
      // the number is an indicator reading, not a price, so it must be read and
      // later re-projected through that pane's own scale.
      const hitPane = paneKeyAt(py);
      const inPricePane = !hitPane || hitPane === PRICE_PANE_KEY;
      snapPaneKey = inPricePane ? null : hitPane;
      let p = priceAtIn(py, snapPaneKey);
      if (p == null) p = inPricePane ? (bars[bars.length - 1]?.c ?? 0) : 0;
      const configuredMode = magnetRef.current === true ? "strong" : magnetRef.current === false ? "off" : magnetRef.current;
      // OpenMarket's precision modifier is deliberately reversible: Ctrl/Cmd
      // supplies Strong magnet while Off is configured, but temporarily frees
      // the cursor when Weak/Strong is already active.
      const modifierDown = Boolean(modifier?.ctrlKey || modifier?.metaKey);
      const mode = forceMagnet
        ?? (modifierDown ? (configuredMode === "off" ? "strong" : "off") : configuredMode);
      snapTarget = null;
      // The magnet targets OHLC, which only exists on the price pane.
      if (bar && inPricePane && mode !== "off") {
        const candidates = [bar.o, bar.h, bar.l, bar.c];
        const best = candidates.reduce((a, v) => Math.abs(v - (p as number)) < Math.abs(a - (p as number)) ? v : a, candidates[0]);
        const bestY = yOf(best);
        // Weak magnet is intentionally forgiving but never \"teleports\" an anchor: it only
        // engages inside an 8px desktop / 14px coarse-pointer halo. Strong always snaps.
        const weakRadius = matchMedia("(pointer:coarse)").matches ? 14 : 8;
        if (mode === "strong" || (bestY != null && Math.abs(bestY - py) <= weakRadius)) {
          p = best;
          const sx = xOf(String(bt));
          if (sx != null && bestY != null) snapTarget = { x: sx, y: bestY };
        }
      }
      // Indicator readings span far smaller magnitudes than a price (a Stoch
      // value, a MACD histogram), so the price precision would quantize them
      // into a visibly wrong anchor.
      return { t: String(bt), p: +(p as number).toFixed(inPricePane ? prec : Math.max(prec, 6)) };
    };
    const constrainedSnap = (
      origin: Drawing["points"][number] | undefined,
      px: number,
      py: number,
      modifier?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
      options: { forceMagnet?: "off"; paneKey?: string | null } = {},
    ) => {
      const { forceMagnet, paneKey } = options;
      if (!origin || !modifier?.shiftKey) return snap(px, py, modifier, forceMagnet);
      const ox = xOf(origin.t), oy = yOfIn(origin.p, paneKey);
      if (ox == null || oy == null) return snap(px, py, modifier, forceMagnet);
      const constrained = constrainScreenAngle({ x: ox, y: oy }, { x: px, y: py });
      return snap(constrained.x, constrained.y, modifier, forceMagnet);
    };
    /**
     * Do two anchors land on the same spot on screen? An unprojectable anchor
     * compares by VALUE rather than by a shared `?? 0` fallback — coercing two
     * nulls to the same coordinate reported unrelated anchors as identical.
     */
    const samePlacement = (first: Drawing["points"][number], second: Drawing["points"][number], paneKey?: string | null) => {
      const x1 = xOf(first.t), x2 = xOf(second.t), y1 = yOfIn(first.p, paneKey), y2 = yOfIn(second.p, paneKey);
      if (x1 == null || x2 == null || y1 == null || y2 == null) {
        return String(first.t) === String(second.t) && first.p === second.p;
      }
      return Math.abs(x1 - x2) < 3 && Math.abs(y1 - y2) < 3;
    };
    /** Screen-space extent of a sampled stroke; a closed brush loop is NOT degenerate. */
    const strokeExtentPx = (points: readonly Drawing["points"][number][], paneKey?: string | null) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const point of points) {
        const px = xOf(point.t), py = yOfIn(point.p, paneKey);
        if (px == null || py == null) continue;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY)) return 0;
      return Math.max(maxX - minX, maxY - minY);
    };
    type PendingDrawing = {
      kind: Drawing["kind"];
      // Bind the gesture to the exact toolbar activation that began it. The
      // same tool can be re-armed before a native pointerup/text/media callback
      // runs, so sampling the mutable ref at commit time could retire the newer
      // selection instead of the transaction that actually produced the object.
      activation: number;
      points: Drawing["points"];
      mode: "point" | "text" | "drag" | "multi" | "freehand";
      pointerId?: number;
      candidate?: Drawing["points"][number];
      awaitingSecond?: boolean;
      meta?: Drawing["meta"];
      // Raw pane-space press position. Creation intent (click vs drag) is read
      // from the POINTER, never from the post-snap anchors: a magnet that pulls
      // both ends onto one bar/OHLC, or a gesture in the blank future gutter,
      // used to collapse a real drag into a "stationary click" and leave the
      // rubber band stuck to the cursor after release.
      downX?: number;
      downY?: number;
      // Pane the gesture started in; null/absent = the price pane.
      paneKey?: string | null;
    };
    let pending: PendingDrawing | null = null;
    cancelPendingDrawingRef.current = () => {
      const current = pending;
      pending = null;
      if (creationPaletteRef.current) creationPaletteRef.current.style.pointerEvents = "auto";
      if (current?.pointerId != null) {
        try { if (svg.hasPointerCapture(current.pointerId)) svg.releasePointerCapture(current.pointerId); } catch {}
      }
      renderDraw();
    };
    let sel: string | null = null;

    function shape(
      d: Drawing,
      preview = false,
      projectX: (time: string) => number | null = xOf,
      projectY: (price: number) => number | null = yOf,
    ) {
      type XY = { x: number; y: number; p?: number };
      const prec = precRef.current;
      const col = dcol(d); const W = el!.clientWidth, H = el!.clientHeight, op = preview ? 0.7 : (d.opacity ?? 1);
      const replayLocked = replayIdxRef.current != null;
      const on = d.id === sel && !preview && !replayLocked;
      const family = DRAWING_RENDERER_FAMILY[d.kind];
      const g = mk("g", {
        "data-id": d.id,
        "data-drawing-id": d.id,
        "data-drawing-kind": d.kind,
        "data-renderer-family": family,
        "data-locked": d.locked ? "true" : "false",
        "data-replay-locked": replayLocked ? "true" : "false",
        opacity: op,
        "pointer-events": preview || d.hidden || replayLocked ? "none" : "all",
        style: d.hidden ? "display:none" : (d.locked || replayLocked ? "cursor:default" : "cursor:pointer"),
      });
      if (!preview && (d.meta as any)?.by === "ai" &&
          typeof document !== "undefined" && document.documentElement.getAttribute("data-cmx-anim") === "on" &&
          !cmxPlayedRef.current.has(d.id)) {
        const cls = d.kind === "rect" ? "cmx-enter-zone"
          : d.kind === "fib" ? "cmx-enter-fib"
          : family === "annotation" || family === "media" ? "cmx-enter-pop"
          : "cmx-enter-line";
        g.classList.add(cls); cmxPlayedRef.current.add(d.id);
        g.addEventListener("animationend", () => { try { g.classList.remove(cls); } catch { /* noop */ } }, { once: true });
      }
      let geometryCount = 0;
      const add = (tag: string, attrs: Record<string, any>) => {
        geometryCount += 1;
        const node = mk(tag, { ...attrs, "data-geometry": "1" }); g.appendChild(node); return node;
      };
      const fat = (x1: number, y1: number, x2: number, y2: number) => g.appendChild(mk("line", { x1, y1, x2, y2, stroke: "transparent", "stroke-width": 14, "stroke-linecap": "round", "data-segment": "1" }));
      const line = (x1: number, y1: number, x2: number, y2: number, attrs: Record<string, any> = {}) => {
        const { hit = true, ...svgAttrs } = attrs;
        add("line", { x1, y1, x2, y2, stroke: col, "stroke-width": lw(1.5, .75), "stroke-dasharray": dash, ...svgAttrs });
        if (hit) fat(x1, y1, x2, y2);
      };
      const polyline = (points: XY[], attrs: Record<string, any> = {}) => {
        if (points.length < 2) return;
        const value = points.map((point) => `${point.x},${point.y}`).join(" ");
        add("polyline", { points: value, fill: "none", stroke: col, "stroke-width": lw(1.8, .7), "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": dash, ...attrs });
        g.appendChild(mk("polyline", { points: value, fill: "none", stroke: "transparent", "stroke-width": 14, "stroke-linecap": "round", "stroke-linejoin": "round", "data-segment": "1" }));
      };
      const path = (value: string, attrs: Record<string, any> = {}) => {
        add("path", { d: value, fill: "none", stroke: col, "stroke-width": lw(1.7, .7), "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": dash, ...attrs });
        g.appendChild(mk("path", { d: value, fill: "none", stroke: "transparent", "stroke-width": 14, "stroke-linecap": "round", "stroke-linejoin": "round", "data-segment": "1" }));
      };
      const grip = (pts: XY[]) => {
        if (!on || d.locked) return;
        // A sampled freehand stroke carries up to 64 anchors. A handle on every
        // one buried the stroke under a chain of circles and destroyed the shape
        // the user drew, so selection shows the stroke's extent plus the two
        // endpoints — the only anchors that are meaningful to drag.
        const sampled = FREEHAND_DRAWING_KINDS.has(d.kind) && pts.length > 4;
        if (sampled) {
          const xs = pts.map((point) => point.x), ys = pts.map((point) => point.y);
          const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
          g.appendChild(mk("rect", {
            x: x0 - 6, y: y0 - 6, width: (x1 - x0) + 12, height: (y1 - y0) + 12,
            fill: "none", stroke: col, "stroke-width": 1, "stroke-dasharray": "4 4",
            opacity: .55, "pointer-events": "none", "data-selection-bounds": "1",
          }));
          // Endpoint handles are only offered when every anchor projected, so a
          // dropped point can never shift a handle onto the wrong index.
          if (pts.length !== d.points.length) return;
          const ends: [XY, number][] = [[pts[0], 0], [pts[pts.length - 1], d.points.length - 1]];
          for (const [point, index] of ends) {
            g.appendChild(mk("circle", {
              cx: point.x, cy: point.y, r: 5, fill: "var(--panel)", stroke: col, "stroke-width": 2,
              "data-handle": index, "data-drawing-handle": index, style: "cursor:grab",
            }));
          }
          return;
        }
        pts.forEach((point, i) => g.appendChild(mk("circle", {
          cx: point.x, cy: point.y, r: 5, fill: "var(--panel)", stroke: col, "stroke-width": 2,
          "data-handle": i, "data-drawing-handle": i, style: "cursor:grab",
        })));
      };
      const pill = (x: number, y: number, label: string, fg = "#11151d", bg = "#f7f9fc") => {
        const w = Math.max(54, label.length * 6.15 + 16), h = 22;
        const px = Math.max(4, Math.min(W - w - 4, x - w / 2));
        const py = Math.max(4, Math.min(H - h - 4, y - h / 2));
        add("rect", { x: px, y: py, width: w, height: h, rx: 11, fill: bg, stroke: "rgba(0,0,0,.18)", "stroke-width": 1, "data-semantic-pill": "1" });
        const tx = mk("text", { x: px + w / 2, y: py + 14.5, fill: fg, "font-size": 10.5, "font-weight": 700, "text-anchor": "middle", "font-family": "var(--font-num)", style: "font-variant-numeric:tabular-nums" });
        tx.textContent = label; g.appendChild(tx);
      };
      const text = (x: number, y: number, value: string, attrs: Record<string, any> = {}) => {
        const node = mk("text", { x, y, fill: col, "font-size": 10, "font-family": "var(--font-ui)", ...attrs }); node.textContent = value; g.appendChild(node); return node;
      };
      const projected = (points = d.points): XY[] => points.flatMap((point) => {
        const x = projectX(point.t), y = projectY(point.p);
        return x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y) ? [] : [{ x, y, p: point.p }];
      });
      const A = d.points[0], B = d.points[1];
      const dash = d.dash === "dashed" ? "7 5" : d.dash === "dotted" ? "2 4" : d.dash === "solid" ? "" : (d.auto ? "5 4" : "");
      const lw = (base: number, boost: number) => (d.width ?? base) + (on ? boost : 0);
      const paneAnchor = getDrawingTool(d.kind)?.creation.anchorSpace === "pane" ? paneAnchorOf(d.meta) : null;
      const ax = paneAnchor ? paneAnchor.x * W : A ? projectX(A.t) : null;
      const ay = paneAnchor ? paneAnchor.y * H : A ? projectY(A.p) : null;
      const bx = B ? projectX(B.t) : null, by = B ? projectY(B.p) : null;
      const projectedAnchors = projected();
      const anchorXY = paneAnchor && ax != null && ay != null
        ? [{ x: ax, y: ay, p: A?.p }, ...projectedAnchors.slice(1)]
        : projectedAnchors;
      const measurementLabel = () => {
        if (!A || !B) return "";
        const bars = Math.abs(barIndex(B.t) - barIndex(A.t)), delta = B.p - A.p, pct = A.p ? delta / A.p * 100 : 0;
        return `${bars} ${tPlain("drawingBars")} × ${delta >= 0 ? "+" : ""}${delta.toFixed(prec)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
      };
      const done = (handles: XY[] = anchorXY, semanticPill = false) => {
        if (geometryCount === 0 && ax != null && ay != null) {
          g.setAttribute("data-renderer-fallback", "true");
          add("circle", { cx: ax, cy: ay, r: 7, fill: d.fillColor || col, "fill-opacity": .24, stroke: col, "stroke-width": lw(1.4, .5) });
          if (bx != null && by != null) line(ax, ay, bx, by);
        }
        if (geometryCount === 0) g.setAttribute("data-renderer-state", "unprojected");
        if (on && !semanticPill && ax != null && ay != null && bx != null && by != null) pill((ax + bx) / 2, Math.min(ay, by) - 18, measurementLabel());
        grip(handles); return g;
      };
      const fill = d.fillColor || col, fillOpacity = d.fillOpacity ?? .09;

      // One-anchor axis tools remain pane-spanning and retain generous transparent hit regions.
      if (family === "axis") {
        if (d.kind === "hline" && ay != null) {
          const sw = (d.width ?? ((d.meta as any)?.strength ? .4 + Number((d.meta as any).strength) : 1.3)) + (on ? 1 : 0);
          line(0, ay, W, ay, { "stroke-width": sw }); text(W - 6, ay - 4, String((d.meta as any)?.label || A.p.toFixed(prec)), { "text-anchor": "end", "font-family": "var(--font-num)" });
          return done([{ x: W / 2, y: ay }]);
        }
        if (d.kind === "vline" && ax != null) { line(ax, 0, ax, H); return done([{ x: ax, y: H / 2 }]); }
        if (d.kind === "horizontalray" && ax != null && ay != null) { line(ax, ay, W, ay); return done([{ x: ax, y: ay }]); }
        if (d.kind === "crossline" && ax != null && ay != null) { line(0, ay, W, ay); line(ax, 0, ax, H); return done([{ x: ax, y: ay }]); }
        return done();
      }

      // Text, notes and price labels render before the two-anchor guard.
      if (family === "annotation" && ax != null && ay != null) {
        const label = d.text || (d.kind === "text" || d.kind === "anchoredtext" ? tPlain("drawingTextFallback") : getDrawingTool(d.kind)?.label || "Note");
        const fs = d.fontSize ?? 13;
        if (d.kind === "text" || d.kind === "anchoredtext") {
          add("rect", { x: ax - 4, y: ay - fs - 3, width: Math.max(42, label.length * fs * .6 + 8), height: fs + 8, rx: 3, fill: "transparent", stroke: d.kind === "anchoredtext" ? col : "transparent", "stroke-dasharray": d.kind === "anchoredtext" ? "3 3" : "" });
          text(ax, ay, label, { "font-size": fs }); return done([{ x: ax, y: ay - fs / 2 }]);
        }
        if (d.kind === "callout" && bx != null && by != null) {
          const w = Math.max(82, label.length * 7 + 22), h = 34, left = bx >= ax ? bx : bx - w, top = by - h / 2;
          add("path", { d: `M${left} ${top}h${w}v${h}h-${Math.max(18, w * .66)}L${ax} ${ay}l${Math.max(6, w * .08)}-${h / 2}H${left}z`, fill, "fill-opacity": Math.max(.12, fillOpacity), stroke: col, "stroke-width": lw(1.2, .5) });
          text(left + 10, top + 21, label, { "font-size": fs }); return done(anchorXY);
        }
        const w = Math.max(72, label.length * 6.4 + 18), h = 30;
        if (d.kind === "pricelabel" || d.kind === "pricenote") {
          add("path", { d: `M${ax} ${ay}l9-10h${w}v20H${ax + 9}z`, fill, "fill-opacity": Math.max(.15, fillOpacity), stroke: col, "stroke-width": 1.2 });
          text(ax + 17, ay + 4, d.kind === "pricelabel" ? A.p.toFixed(prec) : label, { "font-size": fs });
        } else if (d.kind === "signpost") {
          line(ax, ay - 18, ax, ay + 24); add("path", { d: `M${ax} ${ay - 16}h${w}l8 11-8 11h-${w}z`, fill, "fill-opacity": Math.max(.15, fillOpacity), stroke: col }); text(ax + 9, ay - 1, label, { "font-size": fs });
        } else {
          add("rect", { x: ax, y: ay - h, width: w, height: h, rx: 6, fill, "fill-opacity": Math.max(.12, fillOpacity), stroke: col, "stroke-width": 1.2, "stroke-dasharray": d.kind === "anchorednote" ? "3 3" : "" });
          if (d.kind === "comment") add("path", { d: `M${ax + 14} ${ay}l-8 9 2-9z`, fill, stroke: col });
          text(ax + 9, ay - 10, label, { "font-size": fs });
        }
        return done([{ x: ax, y: ay }]);
      }

      if (family === "media" && ax != null && ay != null) {
        if (d.kind === "emoji") {
          const glyph = d.text || "🙂";
          text(ax, ay + 10, glyph, { "font-size": d.fontSize ?? 30, "text-anchor": "middle", "data-media-choice": glyph });
          add("circle", { cx: ax, cy: ay, r: 20, fill: "transparent", "data-media-hit": "1" });
          return done([{ x: ax, y: ay }]);
        }
        if (d.kind === "icon") {
          const icon = drawingMediaIcon((d.meta as Record<string, unknown> | undefined)?.iconId ?? d.text);
          add("path", {
            d: icon.path,
            transform: `translate(${ax - 15} ${ay - 15}) scale(1.25)`,
            fill: icon.filled ? fill : "none",
            "fill-opacity": icon.filled ? Math.max(.5, fillOpacity) : 0,
            "fill-rule": "evenodd",
            stroke: col,
            "stroke-width": icon.filled ? 1.1 : 1.8,
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            "vector-effect": "non-scaling-stroke",
            "data-media-choice": icon.id,
          });
          add("circle", { cx: ax, cy: ay, r: 20, fill: "transparent", "data-media-hit": "1" });
          return done([{ x: ax, y: ay }]);
        }
        if (bx != null && by != null) {
          const x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.max(20, Math.abs(bx - ax)), h = Math.max(20, Math.abs(by - ay));
          const meta = d.meta as Record<string, unknown> | undefined;
          const imageSrc = isSafeDrawingImageDataUrl(meta?.imageSrc) ? meta.imageSrc : null;
          const fallback: SVGElement[] = [];
          fallback.push(add("rect", { x, y, width: w, height: h, rx: 5, fill, "fill-opacity": Math.max(.08, fillOpacity), "data-media-fallback": "1" }));
          fallback.push(add("circle", { cx: x + w * .72, cy: y + h * .28, r: Math.max(2, Math.min(7, w * .06)), fill: col, opacity: .82, "data-media-fallback": "1" }));
          fallback.push(add("path", {
            d: `M${x + 4} ${y + h - 5}L${x + w * .34} ${y + h * .52}L${x + w * .53} ${y + h * .7}L${x + w * .73} ${y + h * .44}L${x + w - 4} ${y + h - 5}`,
            fill: "none", stroke: col, "stroke-width": lw(1.7, .7), "stroke-linecap": "round", "stroke-linejoin": "round", opacity: .82, "data-media-fallback": "1",
          }));
          if (imageSrc) {
            const image = add("image", {
              x, y, width: w, height: h, href: imageSrc,
              preserveAspectRatio: "xMidYMid slice",
              decoding: "async",
              style: "clip-path:inset(0 round 5px)",
              "data-media-image": "1",
              "aria-label": typeof meta?.imageName === "string" ? meta.imageName : "Drawing image",
            });
            image.addEventListener("load", () => {
              fallback.forEach((node) => node.setAttribute("display", "none"));
              g.setAttribute("data-media-state", "loaded");
            }, { once: true });
            image.addEventListener("error", () => {
              image.setAttribute("display", "none");
              g.setAttribute("data-media-state", "error");
            }, { once: true });
          } else {
            g.setAttribute("data-media-state", "placeholder");
          }
          add("rect", { x, y, width: w, height: h, rx: 5, fill: "transparent", stroke: col, "stroke-width": 1.3, "data-media-border": "1" });
          add("rect", { x, y, width: w, height: h, rx: 5, fill: "transparent", "data-media-hit": "1" });
          return done(anchorXY);
        }
        return done();
      }

      if (family === "mark" && ax != null && ay != null) {
        const size = 12;
        if (d.kind === "flagmark") {
          line(ax, ay + 18, ax, ay - 20); add("path", { d: `M${ax} ${ay - 18}h25l-7 8 7 8H${ax}z`, fill, "fill-opacity": .28, stroke: col, "stroke-width": 1.4 });
        } else {
          const direction = d.kind === "arrowmarkleft" ? Math.PI : d.kind === "arrowmarktop" ? -Math.PI / 2 : d.kind === "arrowmarkbottom" ? Math.PI / 2 : 0;
          const tipX = ax + Math.cos(direction) * size, tipY = ay + Math.sin(direction) * size;
          const backX = ax - Math.cos(direction) * size * .75, backY = ay - Math.sin(direction) * size * .75;
          const nx = -Math.sin(direction) * size * .62, ny = Math.cos(direction) * size * .62;
          add("polygon", { points: `${tipX},${tipY} ${backX + nx},${backY + ny} ${ax - Math.cos(direction) * 2},${ay - Math.sin(direction) * 2} ${backX - nx},${backY - ny}`, fill, "fill-opacity": d.kind === "arrowmarker" ? .75 : .24, stroke: col, "stroke-width": 1.4 });
        }
        return done([{ x: ax, y: ay }]);
      }

      if (family === "anchored-vwap" && A && ax != null && ay != null) {
        const start = Math.max(0, barIndex(A.t));
        const series = calculateAnchoredVwap(barsRef.current.slice(start));
        const projectSeries = (priceAt: (row: (typeof series)[number]) => number): XY[] => series.flatMap((row) => {
          const x = projectX(row.time), y = projectY(priceAt(row));
          return x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y) ? [] : [{ x, y }];
        });
        const center = projectSeries((row) => row.vwap);
        const upper = [0, 1, 2].map((index) => projectSeries((row) => row.upper[index]));
        const lower = [0, 1, 2].map((index) => projectSeries((row) => row.lower[index]));
        for (let index = 2; index >= 0; index -= 1) {
          if (upper[index].length < 2 || lower[index].length < 2) continue;
          add("polygon", {
            points: [...upper[index], ...lower[index].slice().reverse()].map((point) => `${point.x},${point.y}`).join(" "),
            fill,
            "fill-opacity": Math.max(.018, fillOpacity * (.22 + (2 - index) * .12)),
            stroke: "none",
            "pointer-events": "none",
          });
        }
        for (let index = 2; index >= 0; index -= 1) {
          const bandDash = index === 0 ? "" : index === 1 ? "6 5" : "2 4";
          for (const points of [upper[index], lower[index]]) {
            if (points.length < 2) continue;
            add("polyline", {
              points: points.map((point) => `${point.x},${point.y}`).join(" "),
              fill: "none", stroke: col, "stroke-width": lw(1.05, .25),
              "stroke-dasharray": bandDash, opacity: index === 0 ? .76 : index === 1 ? .56 : .38,
              "pointer-events": "none",
            });
          }
        }
        if (center.length >= 2) polyline(center, { "stroke-width": lw(1.9, .6) });
        add("circle", { cx: ax, cy: ay, r: 4, fill: col });
        const labelPoint = center.at(-1) ?? { x: ax, y: ay };
        text(labelPoint.x + 8, labelPoint.y - 8, "VWAP · ±1/2/3σ", { "font-size": 9, "font-weight": 700 });
        return done([{ x: ax, y: ay }]);
      }

      if (ax == null || ay == null || bx == null || by == null || !A || !B) return done();

      if (family === "line" || family === "arrow") {
        let sx = ax, sy = ay, ex = bx, ey = by;
        if (d.kind === "ray" || d.kind === "extendedline" || d.extend === "right" || d.extend === "both") {
          if (Math.abs(bx - ax) < .01) { ex = ax; ey = by >= ay ? H : 0; if (d.kind === "extendedline" || d.extend === "both") { sy = 0; ey = H; } }
          else { const slope = (by - ay) / (bx - ax); ex = bx >= ax ? W : 0; ey = ay + slope * (ex - ax); if (d.kind === "extendedline" || d.extend === "both") { sx = bx >= ax ? 0 : W; sy = ay + slope * (sx - ax); } }
        }
        line(sx, sy, ex, ey);
        if (family === "arrow") {
          const angle = Math.atan2(by - ay, bx - ax), head = 10 + (d.width ?? 1.5);
          path(`M${bx} ${by}L${bx + head * Math.cos(angle + Math.PI - .5)} ${by + head * Math.sin(angle + Math.PI - .5)}M${bx} ${by}L${bx + head * Math.cos(angle + Math.PI + .5)} ${by + head * Math.sin(angle + Math.PI + .5)}`);
        }
        if (d.kind === "trendangle") {
          line(ax, ay, bx, ay, { opacity: .55, "stroke-dasharray": "3 4" });
          const angle = Math.atan2(ay - by, bx - ax) * 180 / Math.PI; pill((ax + bx) / 2, ay - 13, `${Math.abs(angle).toFixed(1)}°`);
        }
        if (d.kind === "infoline") pill((ax + bx) / 2, Math.min(ay, by) - 15, measurementLabel());
        return done(anchorXY, d.kind === "infoline" || d.kind === "trendangle");
      }

      if (family === "channel") {
        if (d.kind === "regressiontrend") {
          const i1 = Math.max(0, Math.min(barIndex(A.t), barIndex(B.t)));
          const i2 = Math.min(barsRef.current.length - 1, Math.max(barIndex(A.t), barIndex(B.t)));
          const regression = calculateRegressionChannel(barsRef.current.slice(i1, i2 + 1), 2);
          if (!regression) return done(anchorXY);
          const x1 = projectX(regression.startTime), x2 = projectX(regression.endTime);
          const meanY1 = projectY(regression.start), meanY2 = projectY(regression.end);
          const upperY1 = projectY(regression.upperStart), upperY2 = projectY(regression.upperEnd);
          const lowerY1 = projectY(regression.lowerStart), lowerY2 = projectY(regression.lowerEnd);
          if ([x1, x2, meanY1, meanY2, upperY1, upperY2, lowerY1, lowerY2].some((value) => value == null || !Number.isFinite(value))) return done(anchorXY);
          const rx1 = x1 as number, rx2 = x2 as number;
          const my1 = meanY1 as number, my2 = meanY2 as number;
          const uy1 = upperY1 as number, uy2 = upperY2 as number;
          const ly1 = lowerY1 as number, ly2 = lowerY2 as number;
          add("polygon", { points: `${rx1},${uy1} ${rx2},${uy2} ${rx2},${ly2} ${rx1},${ly1}`, fill, "fill-opacity": Math.max(.06, fillOpacity), stroke: "none" });
          line(rx1, uy1, rx2, uy2, { hit: false, opacity: .72, "stroke-dasharray": "6 5" });
          line(rx1, ly1, rx2, ly2, { hit: false, opacity: .72, "stroke-dasharray": "6 5" });
          line(rx1, my1, rx2, my2);
          pill((rx1 + rx2) / 2, Math.min(uy1, uy2) - 14, `R ${regression.pearsonR.toFixed(3)} · σ ${regression.standardDeviation.toFixed(prec)}`);
          return done(anchorXY, true);
        }
        const C = d.points[2], D = d.points[3], cx = C ? projectX(C.t) : null, cy = C ? projectY(C.p) : null, dx4 = D ? projectX(D.t) : null, dy4 = D ? projectY(D.p) : null;
        if (d.kind === "flattopbottom" && cx != null && cy != null) { line(ax, ay, bx, ay); line(bx, by, cx, cy); line(ax, ay, cx, cy, { opacity: .45, "stroke-dasharray": "4 4" }); return done(anchorXY); }
        if (d.kind === "disjointchannel" && cx != null && cy != null && dx4 != null && dy4 != null) { line(ax, ay, bx, by); line(cx, cy, dx4, dy4); add("polygon", { points: `${ax},${ay} ${bx},${by} ${dx4},${dy4} ${cx},${cy}`, fill, "fill-opacity": fillOpacity, stroke: "none" }); return done(anchorXY); }
        if (cx != null && cy != null) {
          const dx = bx - ax, dy = by - ay, endX = cx + dx, endY = cy + dy;
          add("polygon", { points: `${ax},${ay} ${bx},${by} ${endX},${endY} ${cx},${cy}`, fill, "fill-opacity": fillOpacity, stroke: "none" });
          line(ax, ay, bx, by); line(cx, cy, endX, endY); line(ax, ay, cx, cy, { opacity: .48, "stroke-dasharray": "4 4" });
        }
        return done(anchorXY);
      }

      if (family === "pitchfork") {
        const C = d.points[2], cx = C ? projectX(C.t) : null, cy = C ? projectY(C.p) : null;
        if (cx == null || cy == null) return done();
        let ox = ax, oy = ay;
        if (d.kind === "schiffpitchfork") ox = (ax + bx) / 2;
        if (d.kind === "modifiedschiffpitchfork") { ox = (ax + bx) / 2; oy = (ay + by) / 2; }
        const mx = (bx + cx) / 2, my = (by + cy) / 2, vx = mx - ox, vy = my - oy;
        const scale = Math.max(1, Math.abs(vx) < 1 ? H / Math.max(1, Math.abs(vy)) : Math.abs((vx > 0 ? W - ox : -ox) / vx));
        const ex = ox + vx * scale, ey = oy + vy * scale;
        line(ox, oy, ex, ey);
        const forkScale = d.kind === "insidepitchfork" ? .5 : 1;
        line(bx, by, bx + vx * scale * forkScale, by + vy * scale * forkScale);
        line(cx, cy, cx + vx * scale * forkScale, cy + vy * scale * forkScale);
        add("polygon", { points: `${bx},${by} ${bx + vx * scale * forkScale},${by + vy * scale * forkScale} ${cx + vx * scale * forkScale},${cy + vy * scale * forkScale} ${cx},${cy}`, fill, "fill-opacity": fillOpacity * .75, stroke: "none" });
        return done(anchorXY);
      }

      if (family === "fib") {
        const settings = fibonacciSettings(d.meta);
        const startPrice = settings.reverse ? B.p : A.p;
        const endPrice = settings.reverse ? A.p : B.p;
        const x1 = Math.min(ax, bx), spanW = Math.max(48, Math.abs(bx - ax));
        const levels = settings.levels
          .filter((level) => level.visible)
          .map((level) => ({ ratio: level.value, color: level.color, price: startPrice + (endPrice - startPrice) * level.value }));
        for (let i = 0; i < levels.length - 1; i++) { const y1 = projectY(levels[i].price), y2 = projectY(levels[i + 1].price); if (y1 != null && y2 != null) add("rect", { x: x1, y: Math.min(y1, y2), width: spanW, height: Math.abs(y2 - y1), fill: levels[i + 1].color, "fill-opacity": d.fillOpacity ?? .065, "pointer-events": "none" }); }
        levels.forEach((level) => {
          const y = projectY(level.price); if (y == null) return;
          const ratio = String(Number(level.ratio.toFixed(3))), price = level.price.toFixed(prec);
          const label = settings.labels === "ratio" ? ratio : settings.labels === "price" ? price : `${ratio} (${price})`;
          line(x1, y, x1 + spanW, y, { stroke: level.color, "stroke-width": lw(level.ratio === 0 || level.ratio === 1 ? 1.5 : 1.15, .3), "pointer-events": "none", hit: false });
          text(x1 - 5, y + 3, label, { fill: level.color, "font-size": 9.5, "font-weight": 700, "text-anchor": "end", "font-family": "var(--font-num)", "pointer-events": "none" });
        });
        line(ax, ay, bx, by, { "stroke-dasharray": d.dash === "solid" || d.dash == null ? "7 5" : dash, opacity: .85 });
        return done(anchorXY, true);
      }

      if (family === "fib-grid") {
        const C = d.points[2], cx = C ? projectX(C.t) : null, cy = C ? projectY(C.p) : null;
        if (cx == null || cy == null) return done();
        const dx = bx - ax, dy = by - ay, offX = cx - ax, offY = cy - ay;
        const levels = [0, .236, .382, .5, .618, .786, 1];
        levels.forEach((ratio) => { const sx = ax + offX * ratio, sy = ay + offY * ratio; line(sx, sy, sx + dx, sy + dy, { opacity: ratio === 0 || ratio === 1 ? 1 : .8 }); text(sx - 4, sy - 3, String(ratio), { "font-size": 8.5, "text-anchor": "end" }); });
        add("polygon", { points: `${ax},${ay} ${bx},${by} ${bx + offX},${by + offY} ${cx},${cy}`, fill, "fill-opacity": fillOpacity, stroke: "none" }); return done(anchorXY);
      }

      if (family === "fib-time") {
        const startX = d.kind === "trendbasedfibtime" && d.points[2] ? projectX(d.points[2].t) ?? ax : ax;
        const unit = Math.max(5, Math.abs(bx - ax)), seq = [0, 1, 2, 3, 5, 8, 13, 21];
        seq.forEach((factor, i) => { const x = startX + Math.sign(bx - ax || 1) * unit * factor; if (x < -4 || x > W + 4) return; line(x, 0, x, H, { opacity: i < 2 ? .9 : .55, "stroke-dasharray": i ? "4 4" : dash }); text(x + 3, 14, String(factor), { "font-size": 8.5 }); });
        return done(anchorXY);
      }

      if (family === "fan") {
        const C = d.points[2], cx = C ? projectX(C.t) : bx, cy = C ? projectY(C.p) : by;
        if (d.kind === "pitchfan" && cx != null && cy != null) {
          const ratios = [0, .236, .382, .5, .618, .786, 1];
          ratios.forEach((ratio) => line(
            ax,
            ay,
            bx + (cx - bx) * ratio,
            by + (cy - by) * ratio,
            { opacity: ratio === 0 || ratio === 1 ? 1 : .66 },
          ));
          return done(anchorXY);
        }
        const endX = cx ?? bx, endY = cy ?? by, ratios = d.kind === "gannfan" ? [.125, .25, .333, .5, 1, 2, 3, 4, 8] : [.236, .382, .5, .618, .786, 1];
        ratios.forEach((ratio) => line(ax, ay, endX, ay + (endY - ay) * ratio, { opacity: ratio === 1 ? 1 : .66 })); return done(anchorXY);
      }

      if (family === "radial") {
        const C = d.points[2], cx = C ? projectX(C.t) : bx, cy = C ? projectY(C.p) : by;
        const rx = Math.max(4, Math.abs(bx - ax)), ry = Math.max(4, Math.abs(by - ay)), ratios = [.236, .382, .5, .618, .786, 1];
        if (d.kind === "fibspiral") {
          const pts: XY[] = []; const turns = Math.PI * 4.5;
          for (let i = 0; i <= 56; i++) { const angle = i / 56 * turns, radius = Math.pow(1.618, angle / (Math.PI / 2) - turns / (Math.PI / 2)) * Math.max(rx, ry); pts.push({ x: ax + Math.cos(angle) * radius, y: ay + Math.sin(angle) * radius }); }
          polyline(pts); line(ax, ay, bx, by, { opacity: .45, "stroke-dasharray": "4 4" });
        } else if (d.kind === "fibwedge") {
          line(ax, ay, bx, by); line(ax, ay, cx ?? bx, cy ?? by);
          ratios.forEach((ratio) => path(`M${ax + (bx - ax) * ratio} ${ay + (by - ay) * ratio}A${rx * ratio} ${ry * ratio} 0 0 1 ${ax + ((cx ?? bx) - ax) * ratio} ${ay + ((cy ?? by) - ay) * ratio}`, { opacity: .7 }));
        } else {
          ratios.forEach((ratio) => {
            if (d.kind === "fibcircles") add("ellipse", { cx: ax, cy: ay, rx: rx * ratio, ry: ry * ratio, fill: ratio === 1 ? fill : "none", "fill-opacity": fillOpacity, stroke: col, "stroke-width": lw(1.1, .25), opacity: .82 });
            else path(`M${ax - rx * ratio} ${ay}A${rx * ratio} ${ry * ratio} 0 0 1 ${ax + rx * ratio} ${ay}`, { opacity: .82 });
          });
        }
        return done(anchorXY);
      }

      if (family === "gann") {
        const x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.max(2, Math.abs(bx - ax)), h = Math.max(2, Math.abs(by - ay));
        add("rect", { x, y, width: w, height: h, fill, "fill-opacity": fillOpacity, stroke: col, "stroke-width": lw(1.3, .5) });
        for (const ratio of [.25, .5, .75]) { line(x + w * ratio, y, x + w * ratio, y + h, { opacity: .45 }); line(x, y + h * ratio, x + w, y + h * ratio, { opacity: .45 }); }
        line(x, y, x + w, y + h); line(x + w, y, x, y + h); return done(anchorXY);
      }

      if (family === "pattern") {
        const points = anchorXY;
        const labelsByKind: Partial<Record<DrawKind, string[]>> = {
          xabcd: ["X", "A", "B", "C", "D"], cypher: ["X", "A", "B", "C", "D"], abcd: ["A", "B", "C", "D"],
          headandshoulders: ["0", "LS", "N", "H", "N", "RS", "0"], threedrives: ["0", "1", "A", "2", "B", "3", "C"],
          elliottimpulse: ["0", "1", "2", "3", "4", "5"], elliottcorrection: ["0", "A", "B", "C"], elliotttriangle: ["0", "A", "B", "C", "D", "E"],
          elliottdoublecombo: ["W", "X", "Y", "Z"], elliotttriplecombo: ["W", "X", "Y", "X", "Z", "0"], trianglepattern: ["A", "B", "C", "D"],
        };
        polyline(points, { fill: d.kind === "trianglepattern" && points.length >= 3 ? fill : "none", "fill-opacity": fillOpacity });
        const labels = labelsByKind[d.kind] ?? points.map((_, i) => String(i + 1));
        points.forEach((point, i) => { text(point.x, point.y + (i % 2 ? 17 : -9), labels[i] ?? String(i + 1), { fill: "#f7f9fc", "font-size": 9.5, "font-weight": 800, "text-anchor": "middle" }); if (d.kind === "xabcd" && i >= 2) { const p0 = d.points[i - 2], p1 = d.points[i - 1], p2 = d.points[i], den = Math.abs(p1.p - p0.p); pill((point.x + points[i - 1].x) / 2, (point.y + points[i - 1].y) / 2, (den ? Math.abs(p2.p - p1.p) / den : 0).toFixed(3), "#f7f9fc", col); } });
        return done(points, d.kind === "xabcd");
      }

      if (family === "cycle") {
        const x1 = Math.min(ax, bx), x2 = Math.max(ax, bx), width = Math.max(8, x2 - x1);
        if (d.kind === "cycliclines") { const step = Math.max(8, width); for (let x = x1, i = 0; x <= W + step && i < 40; x += step, i++) line(x, 0, x, H, { opacity: i ? .45 : .9, "stroke-dasharray": i ? "4 4" : dash }); }
        else if (d.kind === "timecycles") { const count = Math.max(1, Math.min(24, Math.ceil((W - x1) / width))); for (let i = 0; i < count; i++) add("ellipse", { cx: x1 + width * (i + .5), cy: (ay + by) / 2, rx: width / 2, ry: Math.max(12, Math.abs(by - ay) / 2), fill: "none", stroke: col, "stroke-width": lw(1.2, .4), "stroke-dasharray": dash }); }
        else { const points: XY[] = []; const amplitude = Math.max(8, Math.abs(by - ay) / 2), center = (ay + by) / 2; for (let i = 0; i <= 48; i++) points.push({ x: ax + (bx - ax) * i / 48, y: center + Math.sin(i / 48 * Math.PI * 4) * amplitude }); polyline(points); }
        return done(anchorXY);
      }

      if (family === "position") {
        const C = d.points[2], cx = C ? projectX(C.t) : null, cy = C ? projectY(C.p) : null;
        if (!C || cx == null || cy == null) return done();
        const metrics = calculatePositionMetrics(d.points, d.meta);
        const x1 = Math.min(ax, bx, cx), x2 = Math.max(ax + 80, bx, cx), entryY = ay, targetY = by, stopY = cy, targetCol = tokensRef.current.up, stopCol = tokensRef.current.down;
        add("rect", { x: x1, y: Math.min(entryY, targetY), width: x2 - x1, height: Math.max(1, Math.abs(targetY - entryY)), fill: targetCol, "fill-opacity": d.fillOpacity ?? .2, stroke: targetCol, "stroke-opacity": .55 });
        add("rect", { x: x1, y: Math.min(entryY, stopY), width: x2 - x1, height: Math.max(1, Math.abs(stopY - entryY)), fill: stopCol, "fill-opacity": d.fillOpacity ?? .2, stroke: stopCol, "stroke-opacity": .55 });
        const compact = (value: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(value);
        line(x1, entryY, x2, entryY);
        const rr = metrics?.rewardRisk ?? 0, targetProfit = metrics?.targetProfit ?? 0, riskBudget = metrics?.riskBudget ?? 0;
        pill((x1 + x2) / 2, targetY - 15, `${tPlain("drawingTarget")} ${B.p.toFixed(prec)} (${((B.p - A.p) / A.p * 100).toFixed(2)}%) · +${compact(targetProfit)}`);
        pill((x1 + x2) / 2, stopY + 15, `${tPlain("drawingStop")} ${C.p.toFixed(prec)} (${((C.p - A.p) / A.p * 100).toFixed(2)}%) · -${compact(riskBudget)}`);
        pill((x1 + x2) / 2, entryY, `${tPlain("drawingRiskReward")} ${rr.toFixed(2)} · ${compact(metrics?.quantity ?? 0)} @ ${compact(metrics?.positionValue ?? 0)}`); return done(anchorXY, true);
      }

      if (family === "forecast") {
        if (d.kind === "ghostfeed") {
          const controls = d.points.flatMap((point) => {
            const x = projectX(point.t), y = projectY(point.p);
            return x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y) ? [] : [{ x, y, p: point.p }];
          });
          if (controls.length < 2) return done(anchorXY);
          const pathLength = controls.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - controls[index].x, point.y - controls[index].y), 0);
          const candleCount = Math.max(8, Math.min(48, Math.round(pathLength / 10)));
          const sourceEnd = Math.max(0, barIndex(d.points[0].t));
          const history = barsRef.current.slice(Math.max(0, sourceEnd - 63), sourceEnd + 1);
          const feed = generateGhostFeed(history, controls.map((point) => point.p), candleCount);
          if (!feed) return done(controls);
          const pointAtProgress = (progress: number) => {
            const scaled = progress * (controls.length - 1);
            const index = Math.min(controls.length - 2, Math.floor(scaled));
            const local = scaled - index;
            return {
              x: controls[index].x + (controls[index + 1].x - controls[index].x) * local,
              y: controls[index].y + (controls[index + 1].y - controls[index].y) * local,
            };
          };
          const candleX = feed.candles.map((candle) => pointAtProgress(candle.progress).x);
          const spacings = candleX.slice(1).map((x, index) => Math.abs(x - candleX[index])).filter((value) => value > .5).sort((a, b) => a - b);
          const medianSpacing = spacings.length ? spacings[Math.floor(spacings.length / 2)] : 5;
          const bodyWidth = Math.max(2, Math.min(8, medianSpacing * .62));
          feed.candles.forEach((candle, index) => {
            const x = candleX[index];
            const openY = projectY(candle.o), highY = projectY(candle.h), lowY = projectY(candle.l), closeY = projectY(candle.c);
            if ([openY, highY, lowY, closeY].some((value) => value == null || !Number.isFinite(value))) return;
            const candleColor = candle.c >= candle.o ? tokensRef.current.up : tokensRef.current.down;
            add("line", {
              x1: x, y1: highY as number, x2: x, y2: lowY as number,
              stroke: candleColor, "stroke-width": Math.max(1, bodyWidth * .22),
              "pointer-events": "none", "data-ghost-wick": String(index),
            });
            add("rect", {
              x: x - bodyWidth / 2,
              y: Math.min(openY as number, closeY as number),
              width: bodyWidth,
              height: Math.max(1.2, Math.abs((closeY as number) - (openY as number))),
              rx: Math.min(1.2, bodyWidth * .18),
              fill: candleColor,
              stroke: candleColor,
              "stroke-width": .65,
              "pointer-events": "none",
              "data-ghost-candle": String(index),
            });
          });
          g.appendChild(mk("polyline", {
            points: controls.map((point) => `${point.x},${point.y}`).join(" "),
            fill: "none", stroke: "transparent", "stroke-width": 16,
            "stroke-linecap": "round", "stroke-linejoin": "round", "data-segment": "1",
          }));
          return done(controls);
        }
        const points = anchorXY;
        polyline(points);
        if (d.kind === "forecast") { const angle = Math.atan2(by - ay, bx - ax), head = 10; path(`M${bx} ${by}L${bx + head * Math.cos(angle + Math.PI - .5)} ${by + head * Math.sin(angle + Math.PI - .5)}M${bx} ${by}L${bx + head * Math.cos(angle + Math.PI + .5)} ${by + head * Math.sin(angle + Math.PI + .5)}`); pill((ax + bx) / 2, Math.min(ay, by) - 15, measurementLabel()); }
        return done(points, d.kind === "forecast");
      }

      if (family === "bar-pattern") {
        const x1 = Math.min(ax, bx), y1 = Math.min(ay, by), w = Math.max(24, Math.abs(bx - ax)), h = Math.max(24, Math.abs(by - ay));
        const i1 = Math.max(0, Math.min(barIndex(A.t), barIndex(B.t))), i2 = Math.min(barsRef.current.length - 1, Math.max(barIndex(A.t), barIndex(B.t))), rows = barsRef.current.slice(i1, i2 + 1);
        const sample = rows.length > 18 ? rows.filter((_, i) => i % Math.ceil(rows.length / 18) === 0) : rows;
        const lo = Math.min(...sample.map((row) => row.l), A.p, B.p), hi = Math.max(...sample.map((row) => row.h), A.p, B.p), span = Math.max(1e-9, hi - lo);
        sample.forEach((row, i) => { const x = x1 + (i + .5) / Math.max(1, sample.length) * w, yy = (price: number) => y1 + (hi - price) / span * h; line(x, yy(row.h), x, yy(row.l), { "stroke-width": 1 }); add("rect", { x: x - Math.max(1.5, w / Math.max(8, sample.length) * .25), y: Math.min(yy(row.o), yy(row.c)), width: Math.max(3, w / Math.max(8, sample.length) * .5), height: Math.max(1, Math.abs(yy(row.o) - yy(row.c))), fill: row.c >= row.o ? tokensRef.current.up : tokensRef.current.down, stroke: "none" }); });
        return done(anchorXY);
      }

      if (family === "sector") {
        const C = d.points[2], cx = C ? projectX(C.t) : bx, cy = C ? projectY(C.p) : by, radius = Math.max(6, Math.hypot(bx - ax, by - ay));
        const a1 = Math.atan2(by - ay, bx - ax), a2 = Math.atan2((cy ?? by) - ay, (cx ?? bx) - ax), ex2 = ax + Math.cos(a2) * radius, ey2 = ay + Math.sin(a2) * radius, large = Math.abs(a2 - a1) > Math.PI ? 1 : 0;
        add("path", { d: `M${ax} ${ay}L${bx} ${by}A${radius} ${radius} 0 ${large} 1 ${ex2} ${ey2}Z`, fill, "fill-opacity": Math.max(.12, fillOpacity), stroke: col, "stroke-width": lw(1.3, .5) }); return done(anchorXY);
      }

      if (family === "volume-profile") {
        const x1 = Math.min(ax, bx), x2 = Math.max(ax, bx), y1 = Math.min(ay, by), y2 = Math.max(ay, by);
        const i1 = Math.max(0, Math.min(barIndex(A.t), barIndex(B.t))), i2 = Math.min(barsRef.current.length - 1, Math.max(barIndex(A.t), barIndex(B.t)));
        const profile = calculateFixedRangeVolumeProfile(barsRef.current.slice(i1, i2 + 1), A.p, B.p, 24, .7);
        if (!profile) return done(anchorXY);
        const maxVolume = Math.max(...profile.bins.map((bin) => bin.volume), 1e-9);
        profile.bins.forEach((bin, index) => {
          const top = projectY(bin.high), bottom = projectY(bin.low);
          if (top == null || bottom == null || !Number.isFinite(top) || !Number.isFinite(bottom)) return;
          const width = Math.max(.5, (x2 - x1) * bin.volume / maxVolume);
          add("rect", {
            x: x2 - width,
            y: Math.min(top, bottom) + .5,
            width,
            height: Math.max(1, Math.abs(bottom - top) - 1),
            fill: col,
            "fill-opacity": bin.isPoc ? .82 : bin.inValueArea ? .46 : .17,
            stroke: bin.isPoc ? col : "none",
            "stroke-width": bin.isPoc ? .8 : 0,
            "pointer-events": "none",
            "data-profile-bin": String(index),
            "data-value-area": bin.inValueArea ? "true" : "false",
            "data-poc": bin.isPoc ? "true" : "false",
          });
        });
        const pocY = projectY(profile.pocPrice), vahY = projectY(profile.valueAreaHigh), valY = projectY(profile.valueAreaLow);
        if (vahY != null) line(x1, vahY, x2, vahY, { hit: false, opacity: .46, "stroke-dasharray": "3 4" });
        if (valY != null) line(x1, valY, x2, valY, { hit: false, opacity: .46, "stroke-dasharray": "3 4" });
        if (pocY != null) {
          line(x1, pocY, x2, pocY, { hit: false, "stroke-width": lw(1.8, .45), "stroke-dasharray": "" });
          pill(x1 + (x2 - x1) * .68, pocY - 14, `POC ${profile.pocPrice.toFixed(prec)}`);
        }
        add("rect", { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1), fill: "none", stroke: col, "stroke-width": 1, "stroke-dasharray": dash });
        return done(anchorXY, true);
      }

      if (family === "range") {
        const bars = Math.abs(barIndex(B.t) - barIndex(A.t)), delta = B.p - A.p, pct = A.p ? delta / A.p * 100 : 0, x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.max(1, Math.abs(bx - ax)), h = Math.max(1, Math.abs(by - ay));
        if (d.kind === "measure") { line(ax, ay, bx, by); pill((ax + bx) / 2, y - 15, measurementLabel()); }
        else if (d.kind === "daterange") { add("rect", { x, y: 0, width: w, height: H, fill, "fill-opacity": fillOpacity, stroke: col, "stroke-opacity": .5, "stroke-dasharray": dash }); pill((ax + bx) / 2, H - 34, `${bars} ${tPlain("drawingBars")}`); }
        else { add("rect", { x, y, width: w, height: h, fill, "fill-opacity": fillOpacity, stroke: col, "stroke-opacity": .62, "stroke-dasharray": dash }); const label = d.kind === "dateandpricerange" ? `${bars} ${tPlain("drawingBars")} · ${delta >= 0 ? "+" : ""}${delta.toFixed(prec)} (${pct.toFixed(2)}%)` : `${delta >= 0 ? "+" : ""}${delta.toFixed(prec)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`; pill((ax + bx) / 2, y - 15, label); }
        return done(anchorXY, true);
      }

      if (family === "freehand") {
        // Drawing opacity already lives on the root group. Applying it again to
        // the Highlighter stroke squared the alpha (.28 -> .078) and made the
        // mark look broken on dark charts.
        polyline(anchorXY, { "stroke-width": lw(d.kind === "highlighter" ? 8 : d.kind === "brush" ? 2.6 : 1.8, .7) }); return done(anchorXY);
      }

      if (family === "shape") {
        if (d.kind === "rect") add("rect", { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.max(1, Math.abs(bx - ax)), height: Math.max(1, Math.abs(by - ay)), fill, "fill-opacity": fillOpacity, stroke: col, "stroke-width": lw(1.2, .6), "stroke-dasharray": dash });
        else if (d.kind === "circle") { const radius = Math.max(2, Math.hypot(bx - ax, by - ay)); add("circle", { cx: ax, cy: ay, r: radius, fill, "fill-opacity": fillOpacity, stroke: col, "stroke-width": lw(1.3, .6), "stroke-dasharray": dash }); }
        else if (d.kind === "ellipse") { const C = d.points[2], cx = C ? projectX(C.t) : null, cy = C ? projectY(C.p) : null, centerX = (ax + bx) / 2, centerY = (ay + by) / 2, angle = cx != null && cy != null ? Math.atan2(cy - centerY, cx - centerX) * 180 / Math.PI : 0; add("ellipse", { cx: centerX, cy: centerY, rx: Math.max(2, Math.abs(bx - ax) / 2), ry: Math.max(2, Math.abs(by - ay) / 2), transform: `rotate(${angle} ${centerX} ${centerY})`, fill, "fill-opacity": fillOpacity, stroke: col, "stroke-width": lw(1.3, .6), "stroke-dasharray": dash }); }
        else if (d.kind === "rotatedrect") { const C = d.points[2], cx = C ? projectX(C.t) : null, cy = C ? projectY(C.p) : null; if (cx != null && cy != null) add("polygon", { points: `${ax},${ay} ${bx},${by} ${cx + bx - ax},${cy + by - ay} ${cx},${cy}`, fill, "fill-opacity": fillOpacity, stroke: col, "stroke-width": lw(1.3, .6), "stroke-dasharray": dash }); }
        else { const C = d.points[2], cx = C ? projectX(C.t) : (ax + bx) / 2, cy = C ? projectY(C.p) : Math.min(ay, by); add("polygon", { points: `${ax},${ay} ${bx},${by} ${cx},${cy}`, fill, "fill-opacity": fillOpacity, stroke: col, "stroke-width": lw(1.3, .6), "stroke-dasharray": dash }); }
        return done(anchorXY);
      }

      if (family === "curve") {
        const C = d.points[2], D = d.points[3], cx = C ? projectX(C.t) : (ax + bx) / 2, cy = C ? projectY(C.p) : (ay + by) / 2, dx = D ? projectX(D.t) : null, dy = D ? projectY(D.p) : null;
        if (d.kind === "arc") path(`M${ax} ${ay}Q${cx} ${cy} ${bx} ${by}`);
        else if (d.kind === "doublecurve" && dx != null && dy != null) { path(`M${ax} ${ay}Q${cx} ${cy} ${bx} ${by}`); path(`M${ax} ${ay}Q${dx} ${dy} ${bx} ${by}`); }
        else path(`M${ax} ${ay}Q${cx} ${cy} ${bx} ${by}`);
        return done(anchorXY);
      }

      if (family === "stylized") {
        const C = d.points[2], D = d.points[3], E = d.points[4], F = d.points[5];
        const c = C ? { x: projectX(C.t), y: projectY(C.p) } : null, q = D ? { x: projectX(D.t), y: projectY(D.p) } : null, e = E ? { x: projectX(E.t), y: projectY(E.p) } : null, f = F ? { x: projectX(F.t), y: projectY(F.p) } : null;
        if (d.kind === "divergence" && c?.x != null && c.y != null && q?.x != null && q.y != null) { line(ax, ay, bx, by); line(c.x, c.y, q.x, q.y); }
        else if (d.kind === "journey" && c?.x != null && c.y != null && q?.x != null && q.y != null && e?.x != null && e.y != null && f?.x != null && f.y != null) polyline([{ x: ax, y: ay }, c as XY, q as XY, e as XY, f as XY, { x: bx, y: by }]);
        else if (d.kind === "fork" && c?.x != null && c.y != null && q?.x != null && q.y != null && e?.x != null && e.y != null) { line(ax, ay, c.x, c.y); line(c.x, c.y, bx, by); line(c.x, c.y, q.x, q.y); line(c.x, c.y, e.x, e.y); }
        else if (d.kind === "threepaths" && c?.x != null && c.y != null && q?.x != null && q.y != null && e?.x != null && e.y != null) { line(ax, ay, bx, by); line(c.x, c.y, q.x, q.y); line(e.x, e.y, bx, by); }
        else if (d.kind === "burj" && c?.x != null && c.y != null) { add("polygon", { points: `${ax},${ay} ${c.x},${c.y} ${bx},${by}`, fill, "fill-opacity": fillOpacity, stroke: col, "stroke-width": lw(1.5, .6) }); line((ax + bx) / 2, (ay + by) / 2, c.x, c.y); }
        else if (d.kind === "momentum") polyline([{ x: ax, y: ay }, { x: ax + (bx - ax) * .34, y: ay + (by - ay) * .2 }, { x: ax + (bx - ax) * .48, y: ay + (by - ay) * .76 }, { x: ax + (bx - ax) * .68, y: ay + (by - ay) * .42 }, { x: bx, y: by }]);
        else if (d.kind === "emphasis") { line(ax, ay, bx, by, { "stroke-width": lw(3.2, .8) }); line(ax + 5, ay + 7, bx + 5, by + 7, { opacity: .42 }); }
        else { const bend = d.kind === "whisper" || d.kind === "subtle" ? .14 : .32, cx1 = ax + (bx - ax) * .35, cy1 = ay - Math.abs(by - ay || 30) * bend, cx2 = ax + (bx - ax) * .65, cy2 = by + Math.abs(by - ay || 30) * bend; path(`M${ax} ${ay}C${cx1} ${cy1} ${cx2} ${cy2} ${bx} ${by}`, { opacity: d.kind === "whisper" || d.kind === "subtle" ? .58 : 1 }); }
        return done(anchorXY);
      }

      // This is deliberately loud and test-addressable. The exhaustive family map
      // makes this exceptional, but malformed/off-spec data still gets a visible,
      // editable object instead of a silent empty SVG group.
      g.setAttribute("data-renderer-fallback", "true");
      line(ax, ay, bx, by); return done(anchorXY);
    }

    // floating style/delete toolbar over the selected drawing
    const bar = document.createElement("div");
    bar.className = "draw-bar"; bar.style.display = "none"; bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", tPlain("drawingSelectionToolbar")); wrap.appendChild(bar); barRef.current = bar;
    const barTip = document.createElement("div");
    barTip.className = "tip tip-mini draw-bar-hover-tip";
    barTip.setAttribute("role", "tooltip");
    barTip.dataset.open = "0";
    barTip.style.display = "none";
    document.body.appendChild(barTip);
    let barTipTimer: number | null = null;
    let lastBarTouchAt = -Infinity;
    const hideBarTip = () => {
      if (barTipTimer !== null) window.clearTimeout(barTipTimer);
      barTipTimer = null;
      barTip.dataset.open = "0";
      barTip.style.display = "none";
    };
    const showBarTip = (target: HTMLElement, immediate = false) => {
      const label = target.getAttribute("aria-label");
      if (!label) return;
      if (barTipTimer !== null) window.clearTimeout(barTipTimer);
      barTipTimer = window.setTimeout(() => {
        barTipTimer = null;
        if (!target.isConnected || bar.style.display === "none") return;
        barTip.textContent = label;
        barTip.style.display = "flex";
        barTip.dataset.open = "0";
        const anchor = target.getBoundingClientRect();
        const tipRect = barTip.getBoundingClientRect();
        const edge = 8, gap = 8;
        const left = Math.max(edge, Math.min(window.innerWidth - tipRect.width - edge, anchor.left + anchor.width / 2 - tipRect.width / 2));
        const above = anchor.top - tipRect.height - gap;
        const top = above >= edge ? above : Math.min(window.innerHeight - tipRect.height - edge, anchor.bottom + gap);
        barTip.dataset.side = above >= edge ? "top" : "bottom";
        barTip.style.left = Math.round(left) + "px";
        barTip.style.top = Math.round(top) + "px";
        requestAnimationFrame(() => { if (barTip.style.display !== "none") barTip.dataset.open = "1"; });
      }, immediate ? 0 : 200);
    };
    bar.addEventListener("pointerover", (event) => {
      if (event.pointerType === "touch") return;
      const target = (event.target as Element).closest<HTMLElement>("[aria-label]");
      if (target && bar.contains(target)) showBarTip(target);
    });
    bar.addEventListener("pointerout", (event) => {
      const from = (event.target as Element).closest<HTMLElement>("[aria-label]");
      const to = (event.relatedTarget as Element | null)?.closest?.<HTMLElement>("[aria-label]");
      if (from !== to) hideBarTip();
    });
    bar.addEventListener("focusin", (event) => {
      if (performance.now() - lastBarTouchAt < 700) return;
      const target = (event.target as Element).closest<HTMLElement>("[aria-label]");
      if (target) showBarTip(target, true);
    });
    bar.addEventListener("focusout", hideBarTip);
    window.addEventListener("resize", hideBarTip);
    document.addEventListener("scroll", hideBarTip, true);
    const COLORS = ["#4d82ff", "#26c281", "#f0566b", "#e8b339", "#d6dae3"];
    const RECENT_COLOR_KEY = "mm.drawing.recentColors.v1";
    const normalizeHexColor = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
      ? value.toLowerCase()
      : null;
    const readRecentColors = () => {
      try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_COLOR_KEY) || "[]");
        if (!Array.isArray(parsed)) return [] as string[];
        return parsed.flatMap((value) => normalizeHexColor(value) ?? []).filter((value, index, all) => all.indexOf(value) === index).slice(0, 8);
      } catch { return [] as string[]; }
    };
    let recentColors = readRecentColors();
    const rememberRecentColor = (color: unknown, previous?: unknown) => {
      const values = [normalizeHexColor(color), normalizeHexColor(previous), ...recentColors].filter((value): value is string => value !== null);
      recentColors = values.filter((value, index) => values.indexOf(value) === index).slice(0, 8);
      try { localStorage.setItem(RECENT_COLOR_KEY, JSON.stringify(recentColors)); } catch {}
    };
    const quickBarColors = (value: unknown) => {
      const current = normalizeHexColor(value) || COLORS[0];
      const candidates = [current, ...recentColors, ...COLORS.map((color) => color.toLowerCase())];
      return candidates.filter((color, index) => candidates.indexOf(color) === index).slice(0, 3);
    };
    const creationPalette = document.createElement("div");
    creationPalette.className = "drawing-creation-palette";
    creationPalette.setAttribute("role", "toolbar");
    creationPalette.setAttribute("aria-label", "Drawing color");
    creationPalette.style.cssText = "position:absolute;z-index:9;display:none;align-items:center;gap:5px;padding:6px 7px 5px;border:1px solid rgba(148,163,184,.22);border-radius:10px;background:rgba(14,18,27,.9);box-shadow:0 10px 28px rgba(0,0,0,.32);backdrop-filter:blur(14px);pointer-events:auto;transform:translateZ(0)";
    const creationSwatches = document.createElement("div"); creationSwatches.style.cssText = "display:flex;align-items:center;gap:4px";
    /**
     * Swatch row = the armed colour, then recently used/custom colours, then the
     * fixed palette. A colour mixed in the custom picker used to vanish from
     * every creation surface, so it could never be reused without re-mixing it.
     */
    const creationPaletteColors = () => {
      const selected = normalizeHexColor(styleRef.current?.color)
        ?? normalizeHexColor(getDrawingTool(toolRef.current)?.defaults.color);
      const candidates = [
        ...(selected ? [selected] : []),
        ...recentColors,
        ...COLORS.map((color) => color.toLowerCase()),
      ];
      return candidates.filter((color, index) => candidates.indexOf(color) === index).slice(0, 6);
    };
    let creationSwatchSignature = "";
    const buildCreationSwatches = () => {
      const colors = creationPaletteColors();
      const signature = colors.join("|");
      if (signature === creationSwatchSignature) return;
      creationSwatchSignature = signature;
      creationSwatches.replaceChildren();
      for (const color of colors) {
        const swatch = document.createElement("button"); swatch.type = "button"; swatch.dataset.creationColor = color; swatch.setAttribute("aria-label", color);
        swatch.style.cssText = `width:17px;height:17px;padding:0;border:1px solid rgba(255,255,255,.18);border-radius:4px;background:${color};cursor:pointer;box-sizing:border-box`;
        creationSwatches.appendChild(swatch);
      }
    };
    buildCreationSwatches();
    const creationCaption = document.createElement("span");
    creationCaption.className = "drawing-creation-palette-caption";
    creationCaption.textContent = document.documentElement.lang.toLowerCase().startsWith("zh") ? "滚动切换" : "Scroll to Change";
    creationCaption.style.cssText = "display:block;margin-top:3px;color:rgba(226,232,240,.68);font:600 8px/1.1 var(--font-ui,system-ui);text-align:center;white-space:nowrap";
    const creationInner = document.createElement("div"); creationInner.append(creationSwatches, creationCaption); creationPalette.appendChild(creationInner); wrap.appendChild(creationPalette); creationPaletteRef.current = creationPalette;
    const updateCreationPaletteSelection = () => {
      buildCreationSwatches();
      const selected = normalizeHexColor(styleRef.current?.color)
        ?? styleRef.current?.color
        ?? getDrawingTool(toolRef.current)?.defaults.color
        ?? COLORS[0];
      creationSwatches.querySelectorAll<HTMLElement>("[data-creation-color]").forEach((swatch) => {
        const active = swatch.dataset.creationColor === selected;
        swatch.setAttribute("aria-pressed", active ? "true" : "false");
        swatch.style.outline = active ? "2px solid rgba(248,250,252,.96)" : "none";
        swatch.style.outlineOffset = active ? "2px" : "0";
      });
    };
    const setCreationColor = (color: string) => {
      const current = styleRef.current ?? { color: COLORS[0], width: 1.5, dash: "solid" as const };
      rememberRecentColor(color, current.color);
      styleRef.current = { ...current, color }; updateCreationPaletteSelection();
      try { window.dispatchEvent(new CustomEvent("mm:drawing-style", { detail: { color } })); } catch {}
      renderDraw();
    };
    creationPalette.addEventListener("pointerdown", (event) => {
      const swatch = (event.target as Element).closest<HTMLElement>("[data-creation-color]"); if (!swatch?.dataset.creationColor) return;
      event.preventDefault(); event.stopPropagation(); setCreationColor(swatch.dataset.creationColor);
    });
    const positionCreationPalette = (clientX: number, clientY: number) => {
      if (!toolRef.current || !matchMedia("(pointer:fine)").matches || matchMedia("(max-width:860px)").matches) { creationPalette.style.display = "none"; return; }
      const rect = wrap.getBoundingClientRect(); creationPalette.style.display = "flex"; updateCreationPaletteSelection();
      const width = creationPalette.offsetWidth || 132, height = creationPalette.offsetHeight || 43;
      const left = Math.max(6, Math.min(el!.clientWidth - width - 6, clientX - rect.left + 16));
      const top = Math.max(6, Math.min(el!.clientHeight - height - 6, clientY - rect.top + 16));
      creationPalette.style.left = `${left}px`; creationPalette.style.top = `${top}px`;
    };
    svg.addEventListener("pointerleave", () => { creationPalette.style.display = "none"; });
    const DASHES: [string, string][] = [["solid", "M2 6h16"], ["dashed", "M2 6h4M8 6h4M14 6h4"], ["dotted", "M2 6h.5M6 6h.5M10 6h.5M14 6h.5M18 6h.5"]];
    const buildBar = (d: Drawing) => {
      hideBarTip();
      bar.dataset.drawingId = d.id;
      const sw = (a: boolean) => (a ? " on" : "");
      const currentColor = normalizeHexColor(d.color) || COLORS[0];
      // The colour controls share one wrapper so a narrow layout can cluster them into a single
      // slot instead of spending four. `display:contents` keeps every wider layout unchanged.
      let h = `<span class="bar-colors">${quickBarColors(currentColor).map((cc, index) => `<button data-c="${cc}" data-color-role="${index === 0 ? "current" : "recent"}" class="dsw${sw(index === 0)}" style="background:${cc}" aria-label="${escH(tPlain("drawingColorValue").replace("{color}", cc))}"></button>`).join("")}</span>`;
      if (getDrawingTool(d.kind)?.capabilities.includes("fontSize")) {
        h += `<span class="bar-sep"></span>` + [["12", "S"], ["16", "M"], ["22", "L"]].map(([fs, l]) => `<button data-fs="${fs}" class="dfi${sw((d.fontSize ?? 13) === +fs)}" aria-label="${escH(tPlain("drawingTextSizeOption").replace("{size}", l))}">${l}</button>`).join("");
      } else if (getDrawingTool(d.kind)?.capabilities.some((cap) => cap === "width" || cap === "dash")) {
        h += `<span class="bar-sep"></span>` + [1.5, 2.5, 4].map((w) => `<button data-w="${w}" class="dwi${sw((d.width ?? 1.6) === w)}" aria-label="${escH(tPlain("drawingUseWidth").replace("{width}", String(w)))}"><i style="height:${Math.max(1, Math.round(w - 0.5))}px"></i></button>`).join("");
        h += `<span class="bar-sep"></span>` + DASHES.map(([k, p]) => `<button data-dash="${k}" class="ddi${sw((d.dash || "solid") === k)}" aria-label="${escH(tPlain(k === "solid" ? "drawingDashSolid" : k === "dashed" ? "drawingDashDashed" : "drawingDashDotted"))}"><svg viewBox="0 0 20 12"><path d="${p}"/></svg></button>`).join("");
      }
      h += `<span class="bar-sep"></span><button class="bar-del" data-del="1" aria-label="${tPlain("drawingDelete")}"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg></button>`;
      bar.innerHTML = h;
      const picker = document.createElement("label");
      picker.className = "bar-color-picker";
      picker.setAttribute("aria-label", tPlain("drawingCustomColorAria"));
      picker.setAttribute("data-color-role", "picker");
      const pickerPreview = document.createElement("span");
      pickerPreview.className = "bar-color-picker-preview";
      pickerPreview.style.background = currentColor;
      const pickerPlus = document.createElement("span");
      pickerPlus.className = "bar-color-picker-plus";
      pickerPlus.textContent = "+";
      const gripEl = document.createElement("button");
      gripEl.className = "bar-grip"; gripEl.type = "button"; gripEl.setAttribute("aria-label", tPlain("drawingDragProperties")); gripEl.setAttribute("data-bar-grip", "1");
      gripEl.textContent = "⠿"; bar.prepend(gripEl);
      const custom = document.createElement("input");
      custom.className = "bar-custom-color"; custom.type = "color"; custom.value = currentColor; custom.dataset.previousColor = currentColor;
      custom.setAttribute("aria-label", tPlain("drawingCustomColorAria")); custom.setAttribute("data-custom-color", "1");
      picker.append(pickerPreview, pickerPlus, custom);
      (bar.querySelector(".bar-colors") ?? bar).appendChild(picker);
      const lock = document.createElement("button");
      lock.className = "bar-act" + (d.locked ? " on" : ""); lock.type = "button";
      lock.setAttribute("aria-label", d.locked ? tPlain("drawingUnlock") : tPlain("drawingLock")); lock.setAttribute("data-lock", "1"); lock.textContent = d.locked ? "●" : "○"; bar.appendChild(lock);
      const duplicate = document.createElement("button");
      duplicate.className = "bar-act"; duplicate.type = "button"; duplicate.setAttribute("aria-label", tPlain("drawingDuplicate"));
      duplicate.setAttribute("data-duplicate", "1"); duplicate.textContent = "⧉"; bar.appendChild(duplicate);
      const settings = document.createElement("button");
      settings.className = "bar-act"; settings.type = "button"; settings.setAttribute("aria-label", tPlain("drawingMoreProperties"));
      settings.setAttribute("data-settings", "1"); settings.textContent = "⚙"; bar.appendChild(settings);
      const panel = document.createElement("div");
      panel.className = "draw-settings";
      panel.dataset.settingsKind = d.kind;
      const opacityLabel = document.createElement("label"); opacityLabel.textContent = tPlain("drawingOpacity");
      const opacity = document.createElement("input"); opacity.type = "range"; opacity.min = "15"; opacity.max = "100"; opacity.step = "5"; opacity.value = String(Math.round((d.opacity ?? 1) * 100)); opacity.setAttribute("data-opacity", "1");
      opacityLabel.appendChild(opacity); panel.appendChild(opacityLabel);
      if (getDrawingTool(d.kind)?.capabilities.includes("fill")) {
        const fillLabel = document.createElement("label"); fillLabel.textContent = tPlain("drawingFill");
        const fill = document.createElement("input"); fill.type = "range"; fill.min = "0"; fill.max = "45"; fill.step = "1"; fill.value = String(Math.round((d.fillOpacity ?? .08) * 100)); fill.setAttribute("data-fill-opacity", "1");
        fillLabel.appendChild(fill); panel.appendChild(fillLabel);
      }
      if (d.kind === "fib") {
        const fib = fibonacciSettings(d.meta);
        const heading = document.createElement("div"); heading.className = "draw-settings-heading"; heading.textContent = tPlain("drawingFibLevels"); panel.appendChild(heading);
        const controls = document.createElement("div"); controls.className = "draw-settings-grid";
        const reverseLabel = document.createElement("label"); reverseLabel.textContent = tPlain("drawingFibReverse");
        const reverse = document.createElement("input"); reverse.type = "checkbox"; reverse.checked = fib.reverse; reverse.setAttribute("data-fib-reverse", "1"); reverseLabel.appendChild(reverse); controls.appendChild(reverseLabel);
        const labelModeLabel = document.createElement("label"); labelModeLabel.textContent = tPlain("drawingFibLabels");
        const labelMode = document.createElement("select"); labelMode.setAttribute("data-fib-labels", "1");
        (["ratio", "price", "both"] as const).forEach((value) => {
          const option = document.createElement("option"); option.value = value;
          option.textContent = tPlain(value === "ratio" ? "drawingFibRatio" : value === "price" ? "drawingFibPrice" : "drawingFibBoth");
          option.selected = fib.labels === value; labelMode.appendChild(option);
        });
        labelModeLabel.appendChild(labelMode); controls.appendChild(labelModeLabel); panel.appendChild(controls);
        const levels = document.createElement("div"); levels.className = "draw-fib-levels"; levels.setAttribute("role", "group"); levels.setAttribute("aria-label", tPlain("drawingFibLevels"));
        fib.levels.forEach((level, index) => {
          const row = document.createElement("label"); row.className = "draw-fib-level";
          const visible = document.createElement("input"); visible.type = "checkbox"; visible.checked = level.visible; visible.setAttribute("data-fib-level", String(index));
          const value = document.createElement("input"); value.type = "number"; value.min = "-100"; value.max = "100"; value.step = ".001"; value.value = String(level.value); value.setAttribute("data-fib-value", String(index)); value.setAttribute("aria-label", tPlain("drawingFibLevelValue").replace("{value}", String(level.value)));
          const color = document.createElement("input"); color.type = "color"; color.value = level.color; color.setAttribute("data-fib-color", String(index)); color.setAttribute("aria-label", `${level.value} ${tPlain("drawingCustomColor")}`);
          row.append(visible, value, color); levels.appendChild(row);
        });
        panel.appendChild(levels);
        const reset = document.createElement("button"); reset.type = "button"; reset.className = "draw-settings-reset"; reset.setAttribute("data-reset-tool-settings", "fib"); reset.textContent = tPlain("drawingResetDefaults"); panel.appendChild(reset);
      }
      if (d.kind === "longposition" || d.kind === "shortposition") {
        const position = positionSettings(d.meta);
        const metrics = calculatePositionMetrics(d.points, d.meta);
        const heading = document.createElement("div"); heading.className = "draw-settings-heading"; heading.textContent = getDrawingTool(d.kind)?.label || "Position"; panel.appendChild(heading);
        const controls = document.createElement("div"); controls.className = "draw-settings-grid";
        const accountLabel = document.createElement("label"); accountLabel.textContent = tPlain("drawingAccountSize");
        const account = document.createElement("input"); account.type = "number"; account.min = "1"; account.max = "1000000000000"; account.step = "100"; account.value = String(position.accountSize); account.setAttribute("data-position-account", "1"); accountLabel.appendChild(account); controls.appendChild(accountLabel);
        const riskModeLabel = document.createElement("label"); riskModeLabel.textContent = tPlain("drawingRiskMode");
        const riskMode = document.createElement("select"); riskMode.setAttribute("data-position-risk-mode", "1");
        (["percent", "money"] as const).forEach((mode) => {
          const option = document.createElement("option"); option.value = mode; option.selected = position.riskMode === mode;
          option.textContent = tPlain(mode === "percent" ? "drawingRiskModePercent" : "drawingRiskModeMoney"); riskMode.appendChild(option);
        });
        riskModeLabel.appendChild(riskMode); controls.appendChild(riskModeLabel);
        const riskLabel = document.createElement("label"); riskLabel.textContent = tPlain(position.riskMode === "money" ? "drawingRiskAmount" : "drawingRiskPercent");
        const risk = document.createElement("input"); risk.type = "number"; risk.min = ".01"; risk.max = position.riskMode === "money" ? String(position.accountSize) : "100"; risk.step = position.riskMode === "money" ? "1" : ".1"; risk.value = String(position.riskMode === "money" ? position.riskAmount : position.riskPercent); risk.setAttribute(position.riskMode === "money" ? "data-position-risk-amount" : "data-position-risk", "1"); riskLabel.appendChild(risk); controls.appendChild(riskLabel); panel.appendChild(controls);
        if (metrics) {
          const summary = document.createElement("div"); summary.className = "draw-position-summary";
          summary.innerHTML = `<span>${escH(tPlain("drawingRiskAmount"))}<b>${metrics.riskBudget.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></span><span>${escH(tPlain("drawingPositionSize"))}<b>${metrics.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</b></span>`;
          panel.appendChild(summary);
        }
        const reset = document.createElement("button"); reset.type = "button"; reset.className = "draw-settings-reset"; reset.setAttribute("data-reset-tool-settings", "position"); reset.textContent = tPlain("drawingResetDefaults"); panel.appendChild(reset);
      }
      bar.appendChild(panel);
    };
    let barManual: { x: number; y: number } | null = null, barManualFor: string | null = null;
    bar.addEventListener("pointerdown", (e) => {
      if (replayIdxRef.current != null) return;
      e.stopPropagation();
      if (e.pointerType === "touch") lastBarTouchAt = performance.now();
      const target = e.target as HTMLElement;
      if (target.closest("[data-bar-grip]") && sel) {
        e.preventDefault();
        const r = bar.getBoundingClientRect(), host = wrap.getBoundingClientRect();
        const pointerId = e.pointerId;
        const startX = e.clientX, startY = e.clientY, baseX = r.left - host.left, baseY = r.top - host.top;
        const move = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          barManual = {
            x: Math.max(4, Math.min(el!.clientWidth - bar.offsetWidth - 4, baseX + ev.clientX - startX)),
            y: Math.max(4, Math.min(el!.clientHeight - bar.offsetHeight - 4, baseY + ev.clientY - startY)),
          };
          barManualFor = sel;
          bar.style.left = barManual.x + "px"; bar.style.top = barManual.y + "px";
        };
        const cleanupGrip = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          if (dragCleanup === cleanupGrip) dragCleanup = null;
        };
        const up = (ev: PointerEvent) => { if (ev.pointerId === pointerId) cleanupGrip(); };
        dragCleanup?.();
        dragCleanup = cleanupGrip;
        window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up); return;
      }
    });
    // Click, rather than pointerdown, keeps every inspector action operable with
    // Enter/Space while retaining delegated mouse and touch behavior.
    bar.addEventListener("click", (e) => {
      if (replayIdxRef.current != null) return;
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const tg = target.closest("button") as HTMLElement | null; if (!tg || !sel) return;
      if (tg.getAttribute("data-settings")) { bar.classList.toggle("settings-open"); return; }
      const resetSettings = tg.getAttribute("data-reset-tool-settings");
      if (resetSettings) {
        drawRef.current = drawRef.current.map((drawing) => {
          if (drawing.id !== sel) return drawing;
          const meta = { ...(drawing.meta ?? {}) };
          if (resetSettings === "fib") {
            delete meta.fibLevels; delete meta.fibLevelStyles; delete meta.fibReverse; delete meta.fibLabels;
          } else {
            delete meta.accountSize; delete meta.riskMode; delete meta.riskPercent; delete meta.riskAmount;
          }
          return { ...drawing, ...(Object.keys(meta).length ? { meta } : { meta: undefined }) };
        });
        barSig = ""; onChangeRef.current?.([...drawRef.current]); return;
      }
      if (tg.getAttribute("data-del")) { const s = sel; sel = null; onChangeRef.current?.(drawRef.current.filter((d) => d.id !== s)); return; }
      if (tg.getAttribute("data-lock")) {
        drawRef.current = drawRef.current.map((d) => d.id === sel ? { ...d, locked: !d.locked } : d);
        barSig = ""; onChangeRef.current?.([...drawRef.current]); return;
      }
      if (tg.getAttribute("data-duplicate")) {
        const src = drawRef.current.find((d) => d.id === sel); if (!src) return;
        const bars = barsRef.current;
        const points = src.points.map((pt) => {
          const i = Math.max(0, barIndex(pt.t)), ni = Math.min(bars.length - 1, i + 2);
          return { t: String(bars[ni]?.time ?? pt.t), p: +(pt.p * 1.002).toFixed(precRef.current) };
        });
        const paneAnchor = paneAnchorOf(src.meta);
        const copy = {
          ...src,
          id: uid(),
          locked: false,
          points,
          ...(paneAnchor ? { meta: { ...(src.meta ?? {}), paneAnchor: { x: clampUnit(paneAnchor.x + .025), y: clampUnit(paneAnchor.y + .025) } } } : {}),
          z: (src.z ?? drawRef.current.length) + 1,
        };
        sel = copy.id; drawRef.current = [...drawRef.current, copy]; onChangeRef.current?.([...drawRef.current]); return;
      }
      const cc = tg.getAttribute("data-c"), w = tg.getAttribute("data-w"), dd = tg.getAttribute("data-dash"), fs = tg.getAttribute("data-fs");
      const selectedDrawing = drawRef.current.find((drawing) => drawing.id === sel);
      if (cc && selectedDrawing) rememberRecentColor(cc, selectedDrawing.color);
      const selectedCanFill = getDrawingTool(selectedDrawing?.kind)?.capabilities.includes("fill") ?? false;
      const patch = cc ? { color: cc, ...(selectedCanFill ? { fillColor: cc } : {}) }
        : w ? { width: +w }
        : dd ? { dash: dd as any }
        : fs ? { fontSize: +fs }
        : null;
      if (patch) {
        drawRef.current = drawRef.current.map((d) => d.id === sel ? { ...d, ...patch } : d);
        if (selectedDrawing) {
          try { window.dispatchEvent(new CustomEvent("mm:drawing-style", { detail: { kind: selectedDrawing.kind, ...patch } })); } catch {}
        }
        onChangeRef.current?.([...drawRef.current]);
      }
    });
    const inspectorPatch = (input: HTMLInputElement | HTMLSelectElement): Partial<Drawing> | null => {
      if (input.hasAttribute("data-custom-color")) {
        const selectedDrawing = drawRef.current.find((drawing) => drawing.id === sel);
        const canFill = getDrawingTool(selectedDrawing?.kind)?.capabilities.includes("fill") ?? false;
        return { color: input.value, ...(canFill ? { fillColor: input.value } : {}) };
      }
      if (input.hasAttribute("data-opacity")) return { opacity: +input.value / 100 };
      if (input.hasAttribute("data-fill-opacity")) return { fillOpacity: +input.value / 100 };
      const selectedDrawing = drawRef.current.find((drawing) => drawing.id === sel);
      if (!selectedDrawing) return null;
      if (input.hasAttribute("data-fib-reverse")) return { meta: { ...(selectedDrawing.meta ?? {}), fibReverse: (input as HTMLInputElement).checked } };
      if (input.hasAttribute("data-fib-labels")) {
        const labels = input.value as FibonacciLabelMode;
        if (labels !== "ratio" && labels !== "price" && labels !== "both") return null;
        return { meta: { ...(selectedDrawing.meta ?? {}), fibLabels: labels } };
      }
      const fibLevel = input.getAttribute("data-fib-level"), fibColor = input.getAttribute("data-fib-color"), fibValue = input.getAttribute("data-fib-value");
      if (fibLevel !== null || fibColor !== null || fibValue !== null) {
        const index = Number(fibLevel ?? fibColor ?? fibValue);
        const fib = fibonacciSettings(selectedDrawing.meta);
        if (!Number.isInteger(index) || !fib.levels[index]) return null;
        fib.levels[index] = fibLevel !== null
          ? { ...fib.levels[index], visible: (input as HTMLInputElement).checked }
          : fibColor !== null
            ? { ...fib.levels[index], color: input.value }
            : { ...fib.levels[index], value: Math.max(-100, Math.min(100, Number.isFinite(Number(input.value)) ? +Number(input.value).toFixed(6) : fib.levels[index].value)) };
        return { meta: {
          ...(selectedDrawing.meta ?? {}),
          fibLevels: fib.levels.filter((level) => level.visible).map((level) => level.value),
          fibLevelStyles: fib.levels,
        } };
      }
      if (input.hasAttribute("data-position-risk-mode")) {
        const riskMode = input.value === "money" ? "money" : "percent";
        return { meta: { ...(selectedDrawing.meta ?? {}), riskMode } };
      }
      if (input.hasAttribute("data-position-account") || input.hasAttribute("data-position-risk") || input.hasAttribute("data-position-risk-amount")) {
        const current = positionSettings(selectedDrawing.meta);
        const raw = Number(input.value);
        const accountSize = input.hasAttribute("data-position-account") ? Math.max(1, Math.min(1_000_000_000_000, raw || current.accountSize)) : current.accountSize;
        const riskPercent = input.hasAttribute("data-position-risk") ? Math.max(.01, Math.min(100, raw || current.riskPercent)) : current.riskPercent;
        const riskAmount = input.hasAttribute("data-position-risk-amount") ? Math.max(.01, Math.min(accountSize, raw || current.riskAmount)) : current.riskAmount;
        return { meta: { ...(selectedDrawing.meta ?? {}), accountSize, riskPercent, riskAmount } };
      }
      return null;
    };
    const barSignature = (d: Drawing) => `${d.id}|${d.kind}|${d.color}|${d.fillColor}|${d.width}|${d.dash}|${d.fontSize}|${JSON.stringify(d.meta ?? {})}`;
    let barSig = "";
    bar.addEventListener("input", (e) => {
      if (replayIdxRef.current != null) return;
      e.stopPropagation(); if (!sel) return;
      const input = e.target as HTMLInputElement | HTMLSelectElement;
      const patch = inspectorPatch(input);
      if (patch) {
        drawingTransactionRef.current = true;
        drawRef.current = drawRef.current.map((d) => d.id === sel ? { ...d, ...patch } : d);
        // Color is part of the inspector signature. Keep the live input mounted
        // through its later `change` event instead of rebuilding it mid-gesture.
        const selected = drawRef.current.find((d) => d.id === sel);
        if (selected) barSig = barSignature(selected);
        scheduleDraw();
      }
    });
    bar.addEventListener("change", (e) => {
      if (replayIdxRef.current != null) return;
      e.stopPropagation(); if (!sel) return;
      const input = e.target as HTMLInputElement | HTMLSelectElement;
      const patch = inspectorPatch(input);
      if (patch) {
        if (input.hasAttribute("data-custom-color")) {
          rememberRecentColor(input.value, (input as HTMLInputElement).dataset.previousColor);
          (input as HTMLInputElement).dataset.previousColor = input.value;
          // The quick swatches already promote their colour to the tool family's
          // next-drawing default; the custom picker did not, so a hand-picked
          // colour was lost the moment the next object was created.
          const edited = drawRef.current.find((drawing) => drawing.id === sel);
          if (edited) {
            const patchColor = { color: patch.color, ...(patch.fillColor ? { fillColor: patch.fillColor } : {}) };
            try { window.dispatchEvent(new CustomEvent("mm:drawing-style", { detail: { kind: edited.kind, ...patchColor } })); } catch {}
          }
        }
        drawingTransactionRef.current = false;
        barSig = "";
        onChangeRef.current?.([...drawRef.current]);
        renderDraw();
      }
    });
    bar.addEventListener("pointercancel", () => { drawingTransactionRef.current = false; });
    const positionBar = () => {
      if (replayIdxRef.current != null) {
        bar.style.display = "none"; barSig = "";
        return;
      }
      const d = drawRef.current.find((x) => x.id === sel);
      if (sel && d && d.points[0]) {
        const paneAnchor = getDrawingTool(d.kind)?.creation.anchorSpace === "pane" ? paneAnchorOf(d.meta) : null;
        const ax = paneAnchor ? paneAnchor.x * el!.clientWidth : xOf(d.points[0].t);
        const ay = paneAnchor ? paneAnchor.y * el!.clientHeight : yOfIn(d.points[0].p, drawingPaneKey(d));
        if (ax != null && ay != null) {
          const sig = barSignature(d);
          if (sig !== barSig) { buildBar(d); barSig = sig; }
          // Clear rather than pin to flex — the stylesheet owns the layout (the phone stands the
          // inspector up as a two-column grid), and an inline display would outrank it. Hiding
          // still uses inline `none`, which is what the visibility checks read.
          bar.style.display = "";
          if (barManualFor !== sel) { barManual = null; barManualFor = sel; }
          bar.style.left = (barManual?.x ?? Math.max(4, Math.min(el!.clientWidth - bar.offsetWidth - 4, ax - 8))) + "px";
          const naturalTop = getDrawingTool(d.kind)?.capabilities.includes("fontSize")
            ? ay + (d.fontSize ?? 13) + 8
            : ay - 50;
          bar.style.top = (barManual?.y ?? Math.max(4, Math.min(el!.clientHeight - bar.offsetHeight - 4, naturalTop))) + "px";
          return;
        }
      }
      bar.style.display = "none"; barSig = "";
    };
    // inline, editable text box — type directly on the chart
    let textEditEl: HTMLInputElement | null = null;
    const openTextEditor = (
      at: { t: string; p: number },
      existing?: Drawing,
      newKind: DrawKind = "text",
      newPoints: Drawing["points"] = [at],
      newMeta?: Drawing["meta"],
      activation = toolActivationRef.current,
    ) => {
      if (textEditEl) { try { textEditEl.remove(); } catch {} textEditEl = null; } textEditRef.current = null;
      const paneAnchor = paneAnchorOf(existing?.meta ?? newMeta);
      const ax = paneAnchor ? paneAnchor.x * el!.clientWidth : xOf(at.t);
      const ay = paneAnchor ? paneAnchor.y * el!.clientHeight : yOf(at.p);
      if (ax == null || ay == null) return;
      const fs = existing?.fontSize ?? 13;
      const inp = document.createElement("input");
      inp.className = "text-edit"; inp.value = existing?.text || ""; inp.placeholder = tPlain("drawingAddText");
      inp.style.left = ax + "px"; inp.style.top = (ay - fs - 4) + "px"; inp.style.fontSize = fs + "px";
      inp.style.color = existing ? dcol(existing) : css("--text");
      wrap.appendChild(inp); textEditEl = inp; textEditRef.current = inp;
      window.setTimeout(() => { inp.focus(); inp.select(); }, 0);
      let done = false;
      const commit = (save: boolean) => {
        if (done) return; done = true; const val = inp.value.trim();
        try { inp.remove(); } catch {} textEditEl = null; if (textEditRef.current === inp) textEditRef.current = null;
        if (!save) return;
        if (existing) onChangeRef.current?.(val ? drawRef.current.map((d) => d.id === existing.id ? { ...d, text: val } : d) : drawRef.current.filter((d) => d.id !== existing.id));
        else if (val) {
          const next: Drawing = { id: uid(), kind: newKind, points: newPoints, text: val, fontSize: fs, ...applyStyle(newKind), ...(newMeta ? { meta: newMeta } : {}) };
          sel = drawingStickyRef.current ? null : next.id; drawRef.current = [...drawRef.current, next]; onChangeRef.current?.([...drawRef.current]); announceCommit(newKind, activation);
        }
      };
      inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commit(true); } else if (e.key === "Escape") { e.preventDefault(); commit(false); } });
      inp.addEventListener("blur", () => commit(true));
    };
    // right-click context menu (D1 — TV-style, rebuilt on every open to reflect current state)
    const ctxm = document.createElement("div"); ctxm.className = "ctx-menu"; ctxm.style.display = "none"; wrap.appendChild(ctxm); ctxRef.current = ctxm;
    let ctxPt: { t: string; p: number } = { t: "", p: 0 };
    const hideCtx = () => { if (ctxRef.current) ctxRef.current.style.display = "none"; };
    // submenu state for Chart template
    let tmSubOpen = false;
    // inline SVG helpers — 14×14, stroke only, currentColor
    const icoReset = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 7A5.5 5.5 0 1 0 3.2 3.2"/><polyline points="1.5,2.5 1.5,7 6,7"/></svg>`;
    const icoCopy  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="4.5" width="8" height="8" rx="1.5"/><path d="M9.5 4.5V2.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>`;
    const icoPaste = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="10" height="9.5" rx="1.5"/><path d="M5 3.5V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/></svg>`;
    const icoBell  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 1v1M7 12v1M2.5 4.5a5 5 0 0 1 9 0v3.5l1 1v.5H1.5V9l1-1V4.5"/><path d="M5.5 12.5a1.5 1.5 0 0 0 3 0"/></svg>`;
    const icoLock  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="1" x2="7" y2="13"/><path d="M4 4h6a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/></svg>`;
    const icoTable = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="2" width="12" height="10" rx="1.5"/><line x1="1" y1="5.5" x2="13" y2="5.5"/><line x1="5.5" y1="5.5" x2="5.5" y2="12"/></svg>`;
    const icoTree  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="4" height="3" rx="1"/><rect x="9" y="5" width="4" height="3" rx="1"/><rect x="9" y="10" width="4" height="3" rx="1"/><line x1="5" y1="2.5" x2="7" y2="2.5"/><line x1="7" y1="2.5" x2="7" y2="11.5"/><line x1="7" y1="6.5" x2="9" y2="6.5"/><line x1="7" y1="11.5" x2="9" y2="11.5"/></svg>`;
    const icoTmpl  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="12" height="12" rx="2"/><line x1="1" y1="5" x2="13" y2="5"/><line x1="7" y1="5" x2="7" y2="13"/></svg>`;
    const icoTrash = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,4 3,12.5 11,12.5 12,4"/><line x1="1" y1="4" x2="13" y2="4"/><path d="M5 4V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V4"/><line x1="5.5" y1="6.5" x2="5.5" y2="10.5"/><line x1="8.5" y1="6.5" x2="8.5" y2="10.5"/></svg>`;
    const icoGear  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="2"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.4 2.4l1.1 1.1M10.5 10.5l1.1 1.1M2.4 11.6l1.1-1.1M10.5 3.5l1.1-1.1"/></svg>`;
    const icoArrow = `<svg width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1 5,5 1,9"/></svg>`;
    // helper to build a standard ctx row
    const ctxRow = (action: string, icon: string, label: string, kbd = "", extra = "") =>
      `<div data-a="${action}" class="ctx-row${extra}"><span class="ctx-ico">${icon}</span><span class="ctx-lbl">${label}</span>${kbd ? `<span class="ctx-kbd">${kbd}</span>` : ""}</div>`;

    const buildCtxMenu = () => {
      const sym = symbolRef.current;
      const prec = precRef.current;
      const px = ctxPt.p;
      const pxLabel = px ? px.toFixed(prec) : "—";
      const locked = !!lockedVLineRef.current;
      // count visible (non-hidden) indicators from panesMeta
      const indCount = panesMeta.current.reduce((n, m) => n + m.entries.filter((e) => !hiddenRef.current.has(e.key)).length, 0);
      const hasInds = indCount > 0;
      // alert label: single-line with ellipsis so it never overflows
      ctxm.innerHTML = `
        ${ctxRow("reset", icoReset, escH("Reset chart view"), "Esc Esc")}
        <div class="sep"></div>
        <div data-a="copypx" class="ctx-row"><span class="ctx-ico">${icoCopy}</span><span class="ctx-lbl">${escH("Copy price")} <strong>${pxLabel}</strong></span></div>
        <div data-a="paste" class="ctx-row ctx-dis"><span class="ctx-ico">${icoPaste}</span><span class="ctx-lbl">${escH("Paste")}</span><span class="ctx-kbd">⌘V</span></div>
        <div class="sep"></div>
        <div data-a="alert" class="ctx-row"><span class="ctx-ico">${icoBell}</span><span class="ctx-lbl">${escH(tPlain("cpAddAlertOn", "Add alert on"))} <b>${escH(sym)}</b> @ ${pxLabel}&hellip;</span><span class="ctx-kbd">⌥A</span></div>
        <div class="sep"></div>
        ${ctxRow("lockv", icoLock, escH("Lock vertical cursor line by time"), "", locked ? " ctx-checked" : "")}
        <div class="sep"></div>
        ${ctxRow("tableview", icoTable, escH("Table view"))}
        ${ctxRow("objtree", icoTree, escH("Object tree"))}
        <div data-a="tplmenu" class="ctx-row ctx-has-sub"><span class="ctx-ico">${icoTmpl}</span><span class="ctx-lbl">${escH("Chart template")}</span><span style="flex:0 0 auto;margin-left:auto;color:var(--text-dim);display:flex;align-items:center">${icoArrow}</span></div>
        <div class="sep"></div>
        ${hasInds ? `<div data-a="removeinds" class="ctx-row ctx-danger"><span class="ctx-ico">${icoTrash}</span><span class="ctx-lbl">${escH("Remove")} ${indCount} ${escH("indicator")}${indCount !== 1 ? "s" : ""}</span></div>` : ""}
        ${ctxRow("settings", icoGear, escH("Settings…"))}
      `.trim();
    };
    onCtx = (e: MouseEvent) => {
      e.preventDefault();
      // Right-click is the fast escape hatch from an armed/stay-active drawing
      // tool. Do not stack the chart context menu over a half-finished gesture.
      if (toolRef.current) {
        cancelPendingDrawingRef.current();
        try { window.dispatchEvent(new CustomEvent("mm:set-tool", { detail: null })); } catch {}
        return;
      }
      const r = wrap.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      ctxPt = snap(x, y, e);
      buildCtxMenu();
      // measure after building (display:block first so offsetWidth/Height are real)
      ctxm.style.display = "block";
      ctxm.style.left = "0px"; ctxm.style.top = "0px";
      const mw = ctxm.offsetWidth || 260;
      const mh = ctxm.offsetHeight || 360;
      const margin = 8;
      const cw = el!.clientWidth, ch = el!.clientHeight;
      ctxm.style.left = Math.min(x, Math.max(0, cw - mw - margin)) + "px";
      ctxm.style.top  = Math.min(y, Math.max(0, ch - mh - margin)) + "px";
      tmSubOpen = false;
    };
    ctxm.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const tgt = e.target as HTMLElement;
      const row = tgt.closest("[data-a]") as HTMLElement | null;
      const a = row?.getAttribute("data-a") ?? null;
      if (a === "tplmenu") {
        // open template submenu inline (append rows)
        if (tmSubOpen) return;
        tmSubOpen = true;
        try {
          const tmpl = listTemplates();
          let subHtml = `<div class="sep"></div><div class="ctx-grp">${escH("Chart templates")}</div>`;
          for (const tpl of tmpl) {
            subHtml += `<div data-a="tpl:${escH(tpl.id)}" class="ctx-row ctx-sub"><span class="ctx-lbl">${escH(tpl.name)}</span></div>`;
          }
          subHtml += `<div data-a="savetemplate" class="ctx-row ctx-sub"><span class="ctx-lbl">${escH("Save as template…")}</span></div>`;
          ctxm.insertAdjacentHTML("beforeend", subHtml);
          // re-clamp: after appending rows, re-measure and re-position so menu bottom stays in view
          const mh2 = ctxm.offsetHeight;
          const ch2 = el!.clientHeight;
          const curTop = parseFloat(ctxm.style.top) || 0;
          if (curTop + mh2 > ch2 - 8) {
            ctxm.style.top = Math.max(0, ch2 - mh2 - 8) + "px";
          }
        } catch {}
        return;
      }
      hideCtx();
      if (!a) return;
      if (a === "reset") normalizeChartView();
      else if (a === "copypx") { try { navigator.clipboard.writeText(String(ctxPt.p)); } catch {} }
      else if (a === "alert") { onAddAlertRef.current?.(ctxPt.p); }
      else if (a === "lockv") {
        const newTime = lockedVLineRef.current === ctxPt.t ? null : ctxPt.t;
        onSetLockedVLineRef.current?.(newTime);
      }
      else if (a === "tableview") { onTableViewRef.current?.(); }
      else if (a === "objtree") { onObjectTreeRef.current?.(); }
      else if (a === "settings") { onOpenSettingsModalRef.current?.(); }
      else if (a === "removeinds") {
        // remove all active indicators via custom event (TerminalShell handles)
        const cnt = panesMeta.current.reduce((n, m) => n + m.entries.filter((en) => !hiddenRef.current.has(en.key)).length, 0);
        window.dispatchEvent(new CustomEvent("mm:remove-all-inds", { detail: { count: cnt } }));
      }
      else if (a && a.startsWith("tpl:")) {
        const id = a.slice(4);
        window.dispatchEvent(new CustomEvent("mm:apply-template", { detail: { id } }));
      }
      else if (a === "savetemplate") {
        window.dispatchEvent(new CustomEvent("mm:save-template", {}));
      }
    });
    wrap.addEventListener("contextmenu", onCtx);

    // ── intraday dead-end empty-state: a centered card with a "Back to Daily" button. Shown when the
    //    intraday branch has no bars (feed unavailable OR genuinely empty); a click dispatches
    //    `mm:set-tf` (TerminalShell owns the listener → setTf on the active pane). Kept out of the CSS
    //    files (styling is inline) so it lives entirely in this component. ──
    const empty = document.createElement("div"); empty.className = "chart-empty"; empty.style.cssText = "position:absolute;inset:0;z-index:6;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;pointer-events:auto";
    empty.innerHTML = `<div class="ce-msg" style="color:var(--text-2);font-size:13px;max-width:320px;line-height:1.5"></div><button class="ce-btn" style="cursor:pointer;font:600 12px var(--font-ui),system-ui;color:var(--text);background:var(--panel-2);border:1px solid var(--line-3);border-radius:6px;padding:7px 14px">${tPlain("cpBackToDaily", "Back to Daily")}</button>`;
    wrap.appendChild(empty); emptyRef.current = empty;
    empty.querySelector(".ce-btn")!.addEventListener("pointerdown", (e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("mm:set-tf", { detail: { tf: "D" } })); });
    // `action` gates the CTA: the intraday dead-end offers "Back to Daily", but the DAILY dead-end
    // (no /data file for this symbol) must not — the daily timeframe is where the user already is.
    showEmptyRef.current = (msg: string, action: "daily" | null = "daily") => {
      const e2 = emptyRef.current; if (!e2) return;
      const m = e2.querySelector(".ce-msg"); if (m) m.textContent = msg;
      const b = e2.querySelector<HTMLElement>(".ce-btn"); if (b) b.style.display = action === "daily" ? "" : "none";
      e2.style.display = "flex";
    };
    hideEmptyRef.current = () => { const e2 = emptyRef.current; if (e2) e2.style.display = "none"; };

    // ── Countdown-to-bar-close chip (Day Trade Mode feature) ──
    // Small absolutely-positioned HTML div top-right of price pane; 1s interval; MM:SS to bar close.
    // dayMode is checked at runtime via dayModeRef (no re-mount needed on prop change).
    const cdChip = document.createElement("div");
    cdChip.style.cssText = "position:absolute;top:6px;right:8px;z-index:5;font:600 11px/1 var(--font-ui,system-ui);color:var(--text-2);background:rgba(0,0,0,0.45);border-radius:4px;padding:3px 6px;pointer-events:none;display:none;letter-spacing:0.02em";
    wrap.appendChild(cdChip);
    countdownChipRef.current = cdChip;
    const updateCdChip = () => {
      const chip = countdownChipRef.current; if (!chip) return;
      const isIntraday = isIntradayRef.current;
      const inDayMode = dayModeRef.current;
      if (!inDayMode || !isIntraday) { chip.style.display = "none"; return; }
      const bars = barsRef.current; if (!bars.length) { chip.style.display = "none"; return; }
      const lastBar = bars[bars.length - 1];
      const lastBarTime = lastBar.time as unknown as number; // numeric epoch for intraday
      const tf = timeframeRef.current;
      const intervalSec = tfMinutes(tf) * 60;
      // Market-local "now" via Intl API
      const market = classify(symbolRef.current);
      const tz = market === "cn" || market === "hk" ? "Asia/Shanghai" : market === "us" ? "America/New_York" : "UTC";
      const nowMs = Date.now();
      const nowLocalSec = (() => {
        const parts: Record<string, string> = {};
        for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(nowMs)) parts[p.type] = p.value;
        return (parseInt(parts.hour || "0") * 3600 + parseInt(parts.minute || "0") * 60 + parseInt(parts.second || "0")) + (Math.floor(nowMs / 86400000) * 86400);
      })();
      const barCloseEpoch = lastBarTime + intervalSec;
      const rem = barCloseEpoch - nowLocalSec;
      if (rem <= 0 || rem > intervalSec) { chip.style.display = "none"; return; }
      const mm = Math.floor(rem / 60).toString().padStart(2, "0");
      const ss = Math.floor(rem % 60).toString().padStart(2, "0");
      chip.textContent = `${mm}:${ss}`;
      chip.style.color = rem <= 30 ? "var(--warn)" : "var(--text-2)";
      chip.style.display = "block";
    };
    // Tick every second; started/stopped by the dayMode effect below
    const startCdTimer = () => {
      if (countdownTimerRef.current) return; // already running
      updateCdChip();
      countdownTimerRef.current = setInterval(updateCdChip, 1000);
    };
    const stopCdTimer = () => {
      if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
      if (countdownChipRef.current) countdownChipRef.current.style.display = "none";
    };
    // Expose startCd/stopCd so the dayMode effect (later) can call them without a stale closure.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wrap as any).__dtm_startCd = startCdTimer;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wrap as any).__dtm_stopCd = stopCdTimer;

    winDown = (e: PointerEvent) => { hideCtx(); if (!toolRef.current && sel) { const tg = e.target as Element; if (tg && !tg.closest?.("g[data-id]") && !tg.closest?.(".draw-bar") && !tg.closest?.(".text-edit")) { sel = null; renderDraw(); } } };
    window.addEventListener("pointerdown", winDown);
    // ── Indicator SVG overlay renderer (ichimoku cloud, ribbon fill, vprofile, volbox) ──
    const renderIndOverlays = () => {
      const svgEl = indSvgRef.current; if (!svgEl) return;
      while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
      // dashboards collected from every suite bundle this frame; flushed to React only on change
      const collectedTables: TableSpec[] = [];
      const flushTables = () => {
        const nextTables = collectedTables.slice();
        suiteTablesRef.current = nextTables;
        const sig = collectedTables.length ? JSON.stringify(collectedTables) : "";
        if (sig === suiteTablesSigRef.current) return;
        suiteTablesSigRef.current = sig;
        setSuiteTables(nextTables);
      };
      // ── premium PANE suites — pane-local coordinate space, clipped per pane; must run even while a
      //    sub-pane is maximized (that is exactly when the user is looking at the suite pane) ──
      {
        const indsP = indicatorsRef.current;
        const paneKeys = paneSuiteKeys().filter((k) =>
          indsP.has(k) && activeSuiteModules(k).some((entry) => entry.surface === "pane")
        );
        if (paneKeys.length && barsRef.current.length) {
          if (!suiteColorsRef.current) suiteColorsRef.current = resolveSuiteColors();
          const WP = el!.clientWidth;
          const tsP = chart.timeScale();
          let lrP: { from: number; to: number } | null = null;
          try { const r = tsP.getVisibleLogicalRange(); if (r) lrP = { from: r.from as number, to: r.to as number }; } catch { /* no range yet */ }
          const xiP = (i: number): number | null => { try { const v = tsP.logicalToCoordinate(i as any); return v == null || !isFinite(v as number) ? null : (v as number); } catch { return null; } };
          const xaP = xiP(0), xbP = xiP(1);
          const barWP = xaP != null && xbP != null ? Math.max(0.5, xbP - xaP) : 6;
          const wrapRect = wrapElRef.current?.getBoundingClientRect();
          const langP = typeof document !== "undefined" && document.documentElement.getAttribute("data-lang") === "zh" ? "zh" as const : "en" as const;
          for (const k of paneKeys) {
            const def = peekSuiteRuntime(k); if (!def) { requestSuiteRuntime(k); continue; }   // fetch + repaint when it lands
            const anchor = indSeriesRef.current.get(k)?.[0]; if (!anchor || !wrapRect) continue;
            let paneTop = 0, paneH = 0;
            try { const paneEl = anchor.getPane().getHTMLElement(); if (!paneEl) continue; const rct = paneEl.getBoundingClientRect(); paneTop = rct.top - wrapRect.top; paneH = rct.height; } catch { continue; }
            if (paneH < 12) continue;   // collapsed/hidden pane
            const yP = (pv: number): number | null => { try { const v = anchor.priceToCoordinate(pv); return v == null || !isFinite(v as number) ? null : (v as number) + paneTop; } catch { return null; } };
            try {
              const bundle = computeSuite(def, suiteRenderParams(k), {
                bars: barsRef.current as any, tf: timeframeRef.current, symbol: symbolRef.current,
                isIntraday: isIntradayRef.current, lang: langP,
              }, userTierRef.current, suiteColorsRef.current!);
              // clip id must be DOCUMENT-unique: multi-chart layouts mount several ChartPanels and
              // url(#…) resolves against the whole document, not this SVG
              const clipId = `ic-clip-${syncIdRef.current ?? "x"}-${k}`;
              const defsEl = mk("defs", {});
              const cp = mk("clipPath", { id: clipId });
              cp.appendChild(mk("rect", { x: 0, y: paneTop, width: WP, height: paneH }));
              defsEl.appendChild(cp);
              const g = mk("g", { "clip-path": `url(#${clipId})` }) as SVGGElement;
              svgEl.appendChild(defsEl); svgEl.appendChild(g);
              renderPrims(g, bundle, { xi: xiP, y: yP, W: WP, H: paneH, i0: lrP ? lrP.from : 0, i1: lrP ? lrP.to : barsRef.current.length - 1, barW: barWP });
              if (bundle.tables.length) collectedTables.push(...bundle.tables);
            } catch (e) { console.warn(`[suite:${k}] pane render skipped:`, e); }
          }
        }
      }
      // A dashboard can be selected without any oscillator plot from its family. Compute those
      // table-only suites here so the dashboard remains useful without manufacturing an empty pane.
      {
        const tableOnlyKeys = paneSuiteKeys().filter((k) => {
          if (!indicatorsRef.current.has(k)) return false;
          const modules = activeSuiteModules(k);
          return modules.some((entry) => entry.surface === "dashboard")
            && !modules.some((entry) => entry.surface === "pane");
        });
        if (tableOnlyKeys.length && barsRef.current.length) {
          if (!suiteColorsRef.current) suiteColorsRef.current = resolveSuiteColors();
          const lang = typeof document !== "undefined" && document.documentElement.getAttribute("data-lang") === "zh" ? "zh" as const : "en" as const;
          for (const k of tableOnlyKeys) {
            const def = peekSuiteRuntime(k); if (!def) { requestSuiteRuntime(k); continue; }   // fetch + repaint when it lands
            try {
              const bundle = computeSuite(def, suiteRenderParams(k), {
                bars: barsRef.current as any,
                tf: timeframeRef.current,
                symbol: symbolRef.current,
                isIntraday: isIntradayRef.current,
                lang,
              }, userTierRef.current, suiteColorsRef.current!);
              if (bundle.tables.length) collectedTables.push(...bundle.tables);
            } catch (e) { console.warn(`[suite:${k}] dashboard render skipped:`, e); }
          }
        }
      }
      if (priceProjHidden()) { flushTables(); return; }   // sub-pane maximized → price-anchored fills stay cleared
      const inds = indicatorsRef.current;
      const W = el!.clientWidth, H = el!.clientHeight;
      const priceS = priceSeriesRef.current;
      if (!priceS) return;
      const p2y = (p: number): number | null => { try { const v = priceS.priceToCoordinate(p); return (v == null || !isFinite(v as number)) ? null : v as number; } catch { return null; } };
      const t2x = (tm: string | number): number | null => { try { const v = chart.timeScale().timeToCoordinate(tm as any); return (v == null || !isFinite(v as number)) ? null : v as number; } catch { return null; } };

      // ── Ichimoku cloud fill ──
      if (inds.has("ichimoku") && !hiddenRef.current.has("ichimoku")) {
        const data = indOverlayRef.current["ichimoku"];
        if (data) {
          const { ich } = data as { ich: ReturnType<typeof ichimoku> };
          const times = ich.futureTimes;
          const aVals = ich.spanA, bVals = ich.spanB;
          // Build pairs of points where both span A and B are valid
          const pts: { x: number; yA: number; yB: number }[] = [];
          for (let i = 0; i < times.length; i++) {
            const a = aVals[i], b = bVals[i]; if (a == null || b == null) continue;
            const x = t2x(times[i]); if (x == null || x < -100 || x > W + 100) continue;
            const yA = p2y(a), yB = p2y(b); if (yA == null || yB == null) continue;
            pts.push({ x, yA, yB });
          }
          if (pts.length >= 2) {
            // Draw two polygons: one for where spanA > spanB (bullish cloud), one for spanA < spanB
            // (bearish). Approach: walk forward along spanA top, then backward along spanB — split at
            // crossovers. The fills come from the indicator's own Span A/B params, which carry the
            // Up/Down colors setting; they used to be hardcoded green/red and ignored the params.
            const ip = P("ichimoku");
            const greenPts: string[] = [], redPts: string[] = [];
            // Simple approach: draw rectangle per segment
            for (let i = 0; i < pts.length - 1; i++) {
              const p0 = pts[i], p1 = pts[i + 1];
              const avgA = (p0.yA + p1.yA) / 2, avgB = (p0.yB + p1.yB) / 2;
              const isGreen = avgA <= avgB; // yA < yB means spanA price > spanB price (higher price = lower y)
              const poly = mk("polygon", {
                points: `${p0.x},${p0.yA} ${p1.x},${p1.yA} ${p1.x},${p1.yB} ${p0.x},${p0.yB}`,
                fill: isGreen ? ip.spanACol : ip.spanBCol,
                stroke: "none",
              });
              svgEl.appendChild(poly);
            }
          }
        }
      }

      // ── Trend Ribbon fill between fast and slow EMA ──
      if (inds.has("ribbon") && !hiddenRef.current.has("ribbon")) {
        const data = indOverlayRef.current["ribbon"];
        if (data) {
          const { rb, rows: rbRows } = data as { rb: ReturnType<typeof trendRibbon>; rows: Bar[] };
          // fillUp/fillDn carry the Up/Down colors setting; the neutral state is hue-less by design.
          const rp = P("ribbon");
          const pts: { x: number; yF: number; yS: number; state: string }[] = [];
          for (let i = 0; i < rbRows.length; i++) {
            const f = rb.emaFast[i], s = rb.emaSlow[i]; if (f == null || s == null) continue;
            const x = t2x(rbRows[i].time); if (x == null || x < -50 || x > W + 50) continue;
            const yF = p2y(f), yS = p2y(s); if (yF == null || yS == null) continue;
            pts.push({ x, yF, yS, state: rb.state[i] });
          }
          for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i], p1 = pts[i + 1];
            const fill = p0.state === "ribbonUp" ? rp.fillUp : p0.state === "ribbonDown" ? rp.fillDn : "rgba(139,147,163,0.07)";
            svgEl.appendChild(mk("polygon", {
              points: `${p0.x},${p0.yF} ${p1.x},${p1.yF} ${p1.x},${p1.yS} ${p0.x},${p0.yS}`,
              fill, stroke: "none",
            }));
          }
        }
      }

      // ── Volume Profile right-anchored bars ──
      if (inds.has("vprofile") && !hiddenRef.current.has("vprofile")) {
        const data = indOverlayRef.current["vprofile"];
        if (data) {
          const { vp } = data as { vp: ReturnType<typeof vprofile> };
          if (vp.bins.length) {
            const p = indParamsRef.current["vprofile"] ? { ...IND_DEFS.vprofile.defaults, ...indParamsRef.current["vprofile"] } : IND_DEFS.vprofile.defaults;
            const maxVol = Math.max(...vp.bins.map((b) => b.volume));
            if (maxVol > 0) {
              const maxBarW = W * (p.widthFrac ?? 0.18);
              const pocY = p2y(vp.poc);
              const vahY = p2y(vp.vah);
              const valY = p2y(vp.val);
              for (const bin of vp.bins) {
                const yHi = p2y(bin.priceHi), yLo = p2y(bin.priceLo);
                if (yHi == null || yLo == null) continue;
                const barW = (bin.volume / maxVol) * maxBarW;
                const isPoc = Math.abs(bin.priceMid - vp.poc) < (vp.bins[0]?.priceHi - vp.bins[0]?.priceLo) * 0.6;
                const barH = Math.max(1, Math.abs(yLo - yHi));
                const barY = Math.min(yHi, yLo);
                svgEl.appendChild(mk("rect", {
                  x: W - barW, y: barY, width: barW, height: barH,
                  fill: isPoc ? "rgba(232,179,57,0.55)" : "rgba(77,130,255,0.25)",
                  stroke: "none",
                }));
              }
              // POC gold price line
              if (pocY != null) svgEl.appendChild(mk("line", { x1: W - maxBarW, y1: pocY, x2: W, y2: pocY, stroke: "#e8b339", "stroke-width": 1.5, "stroke-dasharray": "" }));
              // VAH/VAL dashed
              if (vahY != null) svgEl.appendChild(mk("line", { x1: W - maxBarW, y1: vahY, x2: W, y2: vahY, stroke: "rgba(214,218,227,0.5)", "stroke-width": 1, "stroke-dasharray": "4 3" }));
              if (valY != null) svgEl.appendChild(mk("line", { x1: W - maxBarW, y1: valY, x2: W, y2: valY, stroke: "rgba(214,218,227,0.5)", "stroke-width": 1, "stroke-dasharray": "4 3" }));
            }
          }
        }
      }

      // ── Session VWAP ±1σ fill (SVG translucent polygon) ──
      if (inds.has("svwap") && !hiddenRef.current.has("svwap")) {
        const data = indOverlayRef.current["svwap"];
        if (data) {
          const { result, rows: svRows, mults } = data as { result: ReturnType<typeof sessionVwap>; rows: Bar[]; mults: number[] };
          const p = P("svwap");
          if (p.fill && result.bands[0]) {
            // ±1σ fill polygon: upper band points forward, lower band points backward
            const upPts: { x: number; y: number }[] = [];
            const dnPts: { x: number; y: number }[] = [];
            for (let i = 0; i < svRows.length; i++) {
              const uv = result.bands[0].up[i], dv = result.bands[0].dn[i];
              if (uv == null || dv == null) { if (upPts.length > 1 && dnPts.length > 1) { /* flush current segment */ } continue; }
              const x = t2x(svRows[i].time as any); if (x == null || x < -50 || x > W + 50) continue;
              const yu = p2y(uv), yd = p2y(dv); if (yu == null || yd == null) continue;
              upPts.push({ x, y: yu });
              dnPts.push({ x, y: yd });
            }
            if (upPts.length >= 2) {
              const pts = [...upPts, ...[...dnPts].reverse()].map((p) => `${p.x},${p.y}`).join(" ");
              svgEl.appendChild(mk("polygon", { points: pts, fill: p.fillCol as string, stroke: "none" }));
            }
          }
        }
      }

      // (TTM Squeeze dots render as LWC series markers on the histogram itself — see buildTtmsq.)

      // ── Opening Range box + rays ──
      if (inds.has("orb") && !hiddenRef.current.has("orb")) {
        const data = indOverlayRef.current["orb"];
        if (data) {
          const { sessions, rows: orbRows } = data as { sessions: ReturnType<typeof openingRange>; rows: Bar[] };
          const p = P("orb");
          const textColor = getComputedStyle(document.documentElement).getPropertyValue("--text-2").trim() || "#8b93a3";
          for (const sess of sessions) {
            // Box: from startIdx to endIdx
            const boxStart = orbRows[sess.startIdx]?.time, boxEnd = orbRows[sess.endIdx]?.time;
            const sessEnd = orbRows[sess.sessionEndIdx]?.time;
            if (!boxStart || !boxEnd || !sessEnd) continue;
            const x1 = t2x(boxStart as any), x2 = t2x(boxEnd as any);
            const xEnd = t2x(sessEnd as any);
            const yHi = p2y(sess.hi), yLo = p2y(sess.lo);
            if (x1 == null || x2 == null || yHi == null || yLo == null) continue;
            const rxEnd = xEnd ?? W;
            // Viewport cull + density declutter: drawing the box, rays, and (worst of all) the ORH/ORL
            // + ±Nx TEXT labels for EVERY session across ALL loaded history is what froze the chart for
            // 3-4s and flooded it with white text on the "Day" toggle. Skip sessions that are entirely
            // off-screen or too compressed to read, and only draw the extension rays + text labels when
            // the session is wide enough on screen (so a zoomed-out view shows clean boxes, not a wall
            // of overlapping labels).
            if (rxEnd < -60 || x1 > W + 60) continue;      // entirely off the visible viewport
            const sw = rxEnd - x1;                          // session's on-screen width in px
            if (sw < 3) continue;                           // too compressed to be legible — skip whole session
            const showDetail = sw > 40;                     // wide enough for extension rays + text labels
            // Shaded box over the opening range window
            svgEl.appendChild(mk("rect", { x: x1, y: yHi, width: Math.max(0, x2 - x1), height: yLo - yHi, fill: p.boxCol as string, stroke: "none" }));
            // ORH solid ray to session end
            svgEl.appendChild(mk("line", { x1: x1, y1: yHi, x2: rxEnd, y2: yHi, stroke: p.lineCol as string, "stroke-width": p.width, "stroke-dasharray": "" }));
            // ORL solid ray to session end
            svgEl.appendChild(mk("line", { x1: x1, y1: yLo, x2: rxEnd, y2: yLo, stroke: p.lineCol as string, "stroke-width": p.width, "stroke-dasharray": "" }));
            // Mid dashed ray
            if (p.showMid) {
              const yMid = p2y(sess.mid); if (yMid != null) {
                svgEl.appendChild(mk("line", { x1: x1, y1: yMid, x2: rxEnd, y2: yMid, stroke: p.lineCol as string, "stroke-width": 1, "stroke-dasharray": "4 3" }));
              }
            }
            // Extension rays + ±Nx labels — only when the session is wide enough on screen (declutter)
            if (showDetail) for (const ext of sess.exts) {
              const yUp = p2y(ext.up), yDn = p2y(ext.dn);
              if (yUp != null) {
                svgEl.appendChild(mk("line", { x1: x1, y1: yUp, x2: rxEnd, y2: yUp, stroke: p.lineCol as string, "stroke-width": 1, "stroke-dasharray": "4 3" }));
                // Label at right end
                const lbl = mk("text", { x: rxEnd - 4, y: yUp - 3, fill: textColor, "font-size": 9, "text-anchor": "end", "font-family": "var(--font-ui)" });
                lbl.textContent = `+${ext.k}x`;
                svgEl.appendChild(lbl);
              }
              if (yDn != null) {
                svgEl.appendChild(mk("line", { x1: x1, y1: yDn, x2: rxEnd, y2: yDn, stroke: p.lineCol as string, "stroke-width": 1, "stroke-dasharray": "4 3" }));
                const lbl2 = mk("text", { x: rxEnd - 4, y: yDn + 10, fill: textColor, "font-size": 9, "text-anchor": "end", "font-family": "var(--font-ui)" });
                lbl2.textContent = `-${ext.k}x`;
                svgEl.appendChild(lbl2);
              }
            }
            // ORH / ORL price labels — only when the session is wide enough (declutter)
            if (showDetail) {
              const orbLabelX = Math.min(x2 + 4, rxEnd - 4);
              if (yHi != null) { const lh = mk("text", { x: orbLabelX, y: yHi - 3, fill: textColor, "font-size": 9, "text-anchor": "start", "font-family": "var(--font-ui)" }); lh.textContent = `ORH ${sess.hi.toFixed(2)}`; svgEl.appendChild(lh); }
              if (yLo != null) { const ll = mk("text", { x: orbLabelX, y: yLo + 10, fill: textColor, "font-size": 9, "text-anchor": "start", "font-family": "var(--font-ui)" }); ll.textContent = `ORL ${sess.lo.toFixed(2)}`; svgEl.appendChild(ll); }
            }
          }
        }
      }

      // ── Volatility Box ──
      if (inds.has("volbox") && !hiddenRef.current.has("volbox")) {
        const data = indOverlayRef.current["volbox"];
        if (data) {
          const { vb, rows: vbRows } = data as { vb: ReturnType<typeof volbox>; rows: Bar[] };
          if (vb.squeezeStart != null && vb.boxHi > 0) {
            const startIdx = vb.squeezeStart;
            const endIdx = vb.resolutionIdx ?? (vbRows.length - 1);
            const startTime = vbRows[startIdx]?.time, endTime = vbRows[endIdx]?.time;
            if (startTime && endTime) {
              const x1 = t2x(startTime), x2 = t2x(endTime);
              const yHi = p2y(vb.boxHi), yLo = p2y(vb.boxLo);
              if (x1 != null && x2 != null && yHi != null && yLo != null) {
                const rx1 = Math.min(x1, x2), rx2 = Math.max(x1, x2);
                // Shaded rect
                svgEl.appendChild(mk("rect", { x: rx1, y: yHi, width: rx2 - rx1, height: yLo - yHi, fill: "rgba(232,179,57,0.09)", stroke: "#e8a33d", "stroke-width": 1, "stroke-dasharray": "" }));
                // Top/bottom rails
                svgEl.appendChild(mk("line", { x1: rx1, y1: yHi, x2: rx2, y2: yHi, stroke: "#e8a33d", "stroke-width": 1.5 }));
                svgEl.appendChild(mk("line", { x1: rx1, y1: yLo, x2: rx2, y2: yLo, stroke: "#e8a33d", "stroke-width": 1.5 }));
                // Resolution marker
                if (vb.resolution != null && vb.resolutionIdx != null) {
                  const rx = t2x(vbRows[vb.resolutionIdx].time);
                  if (rx != null) {
                    const ry = vb.resolution === "up" ? yHi - 12 : yLo + 12;
                    const txt = mk("text", { x: rx, y: ry, fill: "#e8a33d", "font-size": 10, "text-anchor": "middle", "font-family": "var(--font-ui)" });
                    txt.textContent = vb.resolution === "up" ? "▲" : "▼";
                    svgEl.appendChild(txt);
                  }
                }
              }
            }
          }
        }
      }

      // ── Premium suite draw-lists (IndicatorCanvas) — host-memoized compute, generic renderer ──
      {
        const activeSuites = Object.keys(SUITE_DEFS).filter((k) => SUITE_DEFS[k]?.kind !== "pane" && inds.has(k));
        if (activeSuites.length && barsRef.current.length) {
          if (!suiteColorsRef.current) suiteColorsRef.current = resolveSuiteColors();
          const ts = chart.timeScale();
          let lr: { from: number; to: number } | null = null;
          try { const r = ts.getVisibleLogicalRange(); if (r) lr = { from: r.from as number, to: r.to as number }; } catch { /* no range yet */ }
          const xi = (i: number): number | null => { try { const v = ts.logicalToCoordinate(i as any); return v == null || !isFinite(v as number) ? null : (v as number); } catch { return null; } };
          const xa = xi(0), xb = xi(1);
          const barW = xa != null && xb != null ? Math.max(0.5, xb - xa) : 6;
          // IndicatorCanvas overlay suites use price-pane coordinates, but the SVG spans the
          // entire multi-pane chart. Without a price-pane clip, off-scale TP/SL labels can land
          // below pane 0 and visibly bleed into RSI/Stoch/etc. Resolve the live pane band (pane
          // order is user-movable), offset pane-local price coordinates into root-SVG space, and
          // render every price suite through one shared clip group.
          let pricePaneTop = 0, pricePaneH = H;
          try {
            const paneEl = priceS.getPane().getHTMLElement();
            const wrapRect = wrapElRef.current?.getBoundingClientRect();
            if (paneEl && wrapRect) {
              const paneRect = paneEl.getBoundingClientRect();
              pricePaneTop = paneRect.top - wrapRect.top;
              pricePaneH = paneRect.height;
            }
          } catch { /* retain the single-pane fallback */ }
          const priceSuiteY = (p: number): number | null => {
            const y = p2y(p);
            return y == null ? null : y + pricePaneTop;
          };
          const priceClipId = `ic-price-clip-${syncIdRef.current ?? "x"}`;
          const priceDefs = mk("defs", {});
          const priceClip = mk("clipPath", { id: priceClipId });
          priceClip.appendChild(mk("rect", { x: 0, y: pricePaneTop, width: W, height: pricePaneH }));
          priceDefs.appendChild(priceClip);
          const priceSuiteGroup = mk("g", { "clip-path": `url(#${priceClipId})` }) as SVGGElement;
          svgEl.appendChild(priceDefs);
          svgEl.appendChild(priceSuiteGroup);
          const m: CoordMapper = {
            xi, y: priceSuiteY, W, H: pricePaneTop + pricePaneH,
            i0: lr ? lr.from : 0, i1: lr ? lr.to : barsRef.current.length - 1, barW,
          };
          const lang = typeof document !== "undefined" && document.documentElement.getAttribute("data-lang") === "zh" ? "zh" as const : "en" as const;
          for (const k of activeSuites) {
            const def = peekSuiteRuntime(k); if (!def) { requestSuiteRuntime(k); continue; }   // fetch + repaint when it lands
            try {
              const bundle = computeSuite(def, suiteRenderParams(k), {
                bars: barsRef.current as any, tf: timeframeRef.current, symbol: symbolRef.current,
                isIntraday: isIntradayRef.current, lang,
              }, userTierRef.current, suiteColorsRef.current);
              renderPrims(priceSuiteGroup, bundle, m);
              if (bundle.tables.length) collectedTables.push(...bundle.tables);
            } catch (e) { console.warn(`[suite:${k}] render skipped:`, e); }
          }
        }
        applySuitePaint();   // key-guarded no-op unless suite candle paint actually changed
      }
      flushTables();
    };

    const renderDraw = () => {
      const svgEl = svgRef.current; if (!svgEl) return;
      while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
      if (priceProjHidden()) { positionBar(); renderAllPriceTags(); return; }  // drawings stay cleared while a sub-pane is maximized
      // Build one projection context per document render. Logical-index X is
      // equivalent to snapped timeToCoordinate but materially cheaper for long
      // paths; the normal price scale is affine, so two chart-API samples give
      // a safe fast Y mapper. Log/custom modes retain the authoritative API.
      const xCache = new Map<string, number | null>();
      const yCache = new Map<number, number | null>();
      const timeScale = chart.timeScale();
      const projectX = (time: string) => {
        const key = String(time); if (xCache.has(key)) return xCache.get(key)!;
        const index = barIndex(time);
        const coordinate = index < 0 ? null : timeScale.logicalToCoordinate(index as any) as number | null;
        xCache.set(key, coordinate); return coordinate;
      };
      let affineY: ((price: number) => number) | null = null;
      try {
        const series = priceSeriesRef.current;
        const mode = series?.priceScale().options().mode;
        const base = barsRef.current[barsRef.current.length - 1]?.c ?? 1;
        const step = Math.max(Math.abs(base) * .001, .01);
        const y0 = series?.priceToCoordinate(base), y1 = series?.priceToCoordinate(base + step);
        if (mode === 0 && y0 != null && y1 != null && Number.isFinite(y0) && Number.isFinite(y1)) {
          const slope = (y1 - y0) / step;
          affineY = (price) => y0 + (price - base) * slope;
        }
      } catch { /* use authoritative per-price projection below */ }
      const projectY = (price: number) => {
        if (affineY) return affineY(price);
        if (yCache.has(price)) return yCache.get(price)!;
        const coordinate = yOf(price); yCache.set(price, coordinate); return coordinate;
      };
      const paneProjectors = new Map<string, (price: number) => number | null>();
      const projectYFor = (d: Drawing) => {
        const key = drawingPaneKey(d);
        if (!key || key === PRICE_PANE_KEY) return projectY;
        let fn = paneProjectors.get(key);
        if (!fn) { fn = (price: number) => yOfIn(price, key); paneProjectors.set(key, fn); }
        return fn;
      };
      for (const d of [...drawRef.current].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) svgEl.appendChild(shape(d, false, projectX, projectYFor(d)));
      // ── D2 locked vertical line overlay ──
      const lvt = lockedVLineRef.current;
      if (lvt) {
        const lx = xOf(lvt);
        if (lx != null) {
          const H = el!.clientHeight;
          const g = mk("g", { "pointer-events": "none" });
          g.appendChild(mk("line", { x1: lx, y1: 0, x2: lx, y2: H, stroke: "var(--brand)", "stroke-width": 1.5, "stroke-dasharray": "6 4" }));
          // lock glyph at bottom near time axis
          const gy = H - 18, gx = lx - 8;
          const gb = mk("rect", { x: gx, y: gy, width: 16, height: 14, rx: 2, fill: "var(--brand)", opacity: 0.85 });
          g.appendChild(gb);
          // simple lock path (SVG only — no emoji)
          const lkG = mk("g", { transform: `translate(${lx - 4},${gy + 1})` });
          lkG.appendChild(mk("rect", { x: 1, y: 5, width: 6, height: 5, rx: 1, fill: "white" }));
          lkG.appendChild(mk("path", { d: "M2 5V3.5a2 2 0 0 1 4 0V5", stroke: "white", "stroke-width": 1.2, fill: "none" }));
          g.appendChild(lkG);
          svgEl.appendChild(g);
        }
      }
      positionBar();
      renderAllPriceTags();  // keep persistent and foreground scale labels in step with data/pan/style renders
    };
    renderRef.current = renderDraw;
    clearDrawingSelectionRef.current = () => {
      if (!sel) return;
      sel = null;
      renderDraw();
    };
    // CMX W3: when THIS is the active pane, publish a coordinate resolver so ChartConductor's ghost
    // cursor can map an op's first anchor (epoch-seconds + price) into pane pixels via the exact
    // DrawLayer transform (xOf/yOf). Registration is refreshed on the active-pane effect below; here we
    // just make the resolver available to that effect via a ref-captured closure.
    cmxCoordResolverRef.current = {
      toPx: (tSec: number, price: number) => {
        const x = xOf(String(Math.round(tSec))); const y = yOf(price);
        return (x == null || y == null || !isFinite(x) || !isFinite(y)) ? null : { x, y };
      },
      rect: () => { const w = wrapElRef.current; return w ? w.getBoundingClientRect() : null; },
    };
    if (activeRef.current) setActivePaneCoords(cmxCoordResolverRef.current);
    // coalesce the overlay rebuild to one paint per frame on the hot pan/zoom path
    const scheduleRender = () => { if (rafId != null) return; rafId = requestAnimationFrame(() => { rafId = null; if (!dead) { renderSignals(); renderIndOverlays(); renderDraw(); } }); };
    scheduleRenderRef.current = scheduleRender;
    // Draw-only rAF coalescer for the drawing drag / shape-creation pointermove paths: those fire on
    // every raw pointer event and previously called renderDraw() (→ full SVG clear + renderIndOverlays
    // re-projecting every ichimoku/ribbon/vwap point) synchronously per event. Batching to one rebuild
    // per frame caps the work at ~60fps; a trailing draw callback lets the handler paint its own preview
    // shape after the base layer is rebuilt (see the creation move handler below).
    let drawRaf: number | null = null; let drawTrailer: (() => void) | null = null;
    const scheduleDraw = (trailer?: () => void) => {
      if (trailer) drawTrailer = trailer;
      if (drawRaf != null) return;
      drawRaf = requestAnimationFrame(() => { drawRaf = null; if (dead) { drawTrailer = null; return; } renderDraw(); const t = drawTrailer; drawTrailer = null; if (t) t(); });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleRender);
    // Static drawing geometry must not rebuild on ordinary crosshair hover: a
    // path-heavy document can contain thousands of data-space anchors. LWC does
    // emit crosshairMove during canvas drags, so only use it while an actual
    // chart-canvas pointer gesture is active (vertical price panning included).
    let projectionPointerId: number | null = null;
    const onProjectionPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (toolRef.current || target?.tagName.toLowerCase() !== "canvas") return;
      projectionPointerId = event.pointerId;
    };
    const onProjectionPointerEnd = (event: PointerEvent) => {
      if (projectionPointerId !== event.pointerId) return;
      projectionPointerId = null; scheduleRender();
    };
    const onCrosshairProjection = () => { if (projectionPointerId != null) scheduleRender(); };
    // C6/CHART-06 — scrub OHLC. D2 hid Row B's OHLC run on the premise that TV shows it only under
    // the crosshair, but the scrub replacement was never built, so the shell strictly LOST data the
    // web terminal shows at rest. Writes into the existing .status-ohlc <b> nodes via textContent —
    // a paintStatus() re-render would rebuild the identity <img> and flicker the logo on every
    // crosshair frame. Shell-only: `.is-scrub` never appears on web.
    // Crosshair events also fire from programmatic sources (pane sync, setCrosshairPosition),
    // which carry a valid time with no pointer anywhere near the chart — in headless CI that
    // latched `.is-scrub` at rest on every viewport. Scrub is a POINTER verb: gate it on a
    // real pointer being over the chart, tracked on the wrap itself.
    let scrubPointerLive = false;
    const onScrubEnter = () => { scrubPointerLive = true; };
    const onScrubLeave = () => {
      scrubPointerLive = false;
      statusRef.current?.closest(".statusline")?.classList.remove("is-scrub");
    };
    const scrubStatus = (p: any) => {
      const st = statusRef.current; if (!st) return;
      // statusRef is the Row-A/Row-B <span> INSIDE .statusline; the D-block rules key off
      // .statusline, so the flag belongs on the wrapper.
      const line = st.closest(".statusline"); if (!line) return;
      const tm = p?.time ?? null;
      const on = tm != null && scrubPointerLive;
      if (on) {
        const idx = barIdxMap().get(tm as any) ?? barIdxMap().get(String(tm));
        const bar = idx != null ? barsRef.current[idx] : undefined;
        const vals = st.querySelectorAll<HTMLElement>(".status-ohlc b");
        if (!bar || vals.length !== 4) { line.classList.remove("is-scrub"); return; }
        const f = (x: number) => x.toFixed(precRef.current);
        vals[0].textContent = f(bar.o); vals[1].textContent = f(bar.h);
        vals[2].textContent = f(bar.l); vals[3].textContent = f(bar.c);
      }
      line.classList.toggle("is-scrub", on);
    };
    wrap.addEventListener("pointerdown", onProjectionPointerDown, true);
    window.addEventListener("pointerup", onProjectionPointerEnd);
    window.addEventListener("pointercancel", onProjectionPointerEnd);
    chart.subscribeCrosshairMove(onCrosshairProjection);
    if (shellAxis()) {
      // pointermove/pointerdown are the presence signals, not just pointerenter: headless
      // Chromium (CI) synthesizes moves without reliable boundary events, and a real
      // crosshair drag always bubbles move events through the wrap. Programmatic
      // crosshair sources fire no DOM pointer events at all, so the guard stays sound.
      wrap.addEventListener("pointerenter", onScrubEnter);
      wrap.addEventListener("pointermove", onScrubEnter);
      wrap.addEventListener("pointerdown", onScrubEnter);
      wrap.addEventListener("pointerleave", onScrubLeave);
      wrap.addEventListener("pointercancel", onScrubLeave);
      chart.subscribeCrosshairMove(scrubStatus);
    }
    renderSignals(); renderIndOverlays(); renderDraw();

    // ── pane geometry measurement → drives the legend/pane-menu overlay layer (ChartOverlays) ──
    const measureImpl = () => {
      const ch = chartRef.current, w = wrapElRef.current; if (!ch || dead || !w) return;
      const wr = w.getBoundingClientRect();
      // match panes by current index, not object identity — lightweight-charts hands back fresh
      // IPaneApi wrappers, so series.getPane() !== chart.panes()[i]; paneIndex() stays consistent
      // for the same underlying pane (and updates together after swapPanes reorders).
      const metaByIndex = new Map<number, typeof panesMeta.current[number]>();
      for (const m of panesMeta.current) { let mi = -1; try { mi = m.pane.paneIndex(); } catch {} if (mi >= 0) metaByIndex.set(mi, m); }
      const ctl = paneCtl.current;
      const layout: PaneInfo[] = [];
      let panesApi: IPaneApi<any>[] = []; try { panesApi = ch.panes(); } catch {}
      for (const paneApi of panesApi) {
        let pi = 0; try { pi = paneApi.paneIndex(); } catch {}
        const m = metaByIndex.get(pi); if (!m) continue;
        // while a pane is maximized the other pane rows are DOM-hidden
        // (applyMaximizeDom) — drop them from the overlay layout entirely so
        // their legends/ops can't bleed over the maximized pane and the pane
        // hover/double-tap hit-tests only ever see the visible pane.
        if (ctl.maximized && m.key !== ctl.maximized) continue;
        let top = 0, height = 0;
        try { const pe = paneApi.getHTMLElement(); if (pe) { const r = pe.getBoundingClientRect(); top = r.top - wr.top; height = r.height; } } catch {}
        layout.push({
          key: m.key,
          ...(m.removeKey ? { removeKey: m.removeKey } : {}),
          paneIndex: pi,
          isPrice: m.isPrice,
          top,
          height,
          collapsed: ctl.collapsed.has(m.key),
          maximized: ctl.maximized === m.key,
          entries: m.entries.map((e) => ({ ...e, hidden: isLegendEntryHidden(e.key) })),
        });
      }
      layout.sort((a, b) => a.paneIndex - b.paneIndex);
      paneLayoutRef.current = layout; setPaneLayout(layout);
    };
    measureRef.current = measureImpl;
    const scheduleMeasure = () => { if (measRaf != null) return; measRaf = requestAnimationFrame(() => { measRaf = null; if (!dead) { measureImpl(); renderTagRef.current?.(); } }); };

    // ── pane hover + double-click (maximize-toggle on ANY pane: the tapped pane becomes the only
    //    visible one; a second double-click/tap restores the previous layout) ──
    // B1: synthetic-hover suppression — touch pointerdown records the timestamp; onPaneMove
    // ignores synthetic mousemove events fired ≤700ms after a touch (iOS sends them after lift).
    // Gated on a touch having HAPPENED: the ref starts at 0 and `performance.now()` is measured
    // from the page's time origin, so a bare `now() - 0 < 700` would also eat every hover in the
    // first 700ms of the page's life (same gate as indicator-canvas/render.ts wireTooltipHitTest).
    onPaneMove = (e: MouseEvent) => {
      if (lastTouchTsRef.current > 0 && performance.now() - lastTouchTsRef.current < 700) return;   // B1: skip synthetic mousemove after touch
      const w = wrapElRef.current; if (!w) return; const wr = w.getBoundingClientRect(); const y = e.clientY - wr.top;
      let hk: string | null = null; for (const p of paneLayoutRef.current) { if (y >= p.top && y <= p.top + p.height) { hk = p.key; break; } }
      if (hk !== hoveredKeyRef.current) { hoveredKeyRef.current = hk; setHoveredKey(hk); }
    };
    onPaneLeave = () => { if (hoveredKeyRef.current !== null) { hoveredKeyRef.current = null; setHoveredKey(null); } };
    // double-click on a visible price-axis band is the library's scale auto-fit gesture — exclude
    // either X band from pane maximize so left-positioned scales keep the same interaction contract.
    const inAxisBand = (clientX: number, wr: DOMRect) => {
      let rightW = 0, leftW = 0;
      try { rightW = chartRef.current?.priceScale("right")?.width() ?? 0; } catch {}
      try { leftW = chartRef.current?.priceScale("left")?.width() ?? 0; } catch {}
      return (rightW > 0 && wr.right - clientX < rightW)
        || (leftW > 0 && clientX - wr.left < leftW);
    };
    onPaneDbl = (e: MouseEvent) => {
      // B1: guard against iOS-synthesized dblclick double-fire after a touch double-tap
      if (performance.now() - lastDblHandledRef.current < 600) return;
      if ((e.target as Element)?.closest?.(".chart-overlays")) return; if (toolRef.current) return;
      const w = wrapElRef.current; if (!w) return; const wr = w.getBoundingClientRect(); const y = e.clientY - wr.top;
      if (inAxisBand(e.clientX, wr)) return;
      const p = paneLayoutRef.current.find((q) => y >= q.top && y <= q.top + q.height); if (!p) return;
      doMaximize(p.paneIndex);
    };
    // TV-style wheel-on-price-axis: scale THAT pane's real numeric range around the price under
    // the pointer. The previous margin-based implementation had an unavoidable fixed ceiling;
    // exponential range scaling compounds continuously, so mouse notches stay predictable and
    // high-resolution trackpads remain smooth at any accumulated zoom. The hit pane is resolved
    // from cursor y, so price/StochRSI/MACD/any subpane responds independently. Capture phase keeps
    // LWC's inner wheel handler from spending the same gesture on the time axis.
    const AXIS_MARGINS_DEFAULT: AxisMargins = { top: 0.1, bottom: 0.08 };  // mirrors createEngine rightPriceScale
    // Per-pane state only remembers the pane's own starting margins for reset; unlike the removed
    // zoom accumulator, it has no min/max product clamp.
    const axisZoomState = new Map<string, {
      base: AxisMargins;
      mode?: PriceScaleMode;
      logFormula?: AxisLogFormula;
      logRange?: AxisRange;
    }>();
    const paneSeries = (key: string, paneIndex: number): ISeriesApi<any> | null => {
      if (key === "__price__") return priceSeriesRef.current ?? null;
      try { return chartRef.current?.panes()[paneIndex]?.getSeries()?.[0] ?? null; } catch { return null; }
    };
    const paneScale = (key: string, paneIndex: number) => paneSeries(key, paneIndex)?.priceScale() ?? null;
    const onAxisWheel = (e: WheelEvent) => {
      const w = wrapElRef.current; if (!w) return; const wr = w.getBoundingClientRect();
      if (!inAxisBand(e.clientX, wr)) return;
      const y = e.clientY - wr.top;
      const pane = paneLayoutRef.current.find((q) => y >= q.top && y <= q.top + q.height);
      if (!pane) return;
      const series = paneSeries(pane.key, pane.paneIndex);
      const scale = series?.priceScale() ?? null; if (!series || !scale) return;  // no series on the pane → no-op
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX; if (delta === 0) return;
      const scaleOptions = (() => { try { return scale.options(); } catch { return null; } })();
      if (!scaleOptions) return;
      let st = axisZoomState.get(pane.key);
      if (!st) {  // first touch: capture the pane's current margins BEFORE changing anything
        const base = scaleOptions.scaleMargins ?? AXIS_MARGINS_DEFAULT;
        st = { base: { top: base.top, bottom: base.bottom } };
        axisZoomState.set(pane.key, st);
      }
      e.preventDefault(); e.stopPropagation();
      const localY = Math.max(0, Math.min(pane.height, y - pane.top));
      // LWC 5.2's public price-range getter converts log values back to raw prices, but its setter
      // consumes the hidden logarithmic domain. Preserve that domain locally after the first
      // wheel frame: this both bridges the asymmetric API and avoids its min-move rounding from
      // imposing a second, subtler deep-zoom ceiling. Percent/Indexed modes already expose their
      // displayed domain and can use the public range directly.
      const mode = scaleOptions.mode;
      if (st.mode !== mode) {
        st.mode = mode;
        st.logFormula = undefined;
        st.logRange = undefined;
      }
      const publicRange = (() => { try { return scale.getVisibleRange(); } catch { return null; } })();
      const publicRangeValid = publicRange && Number.isFinite(publicRange.from)
        && Number.isFinite(publicRange.to) && publicRange.to > publicRange.from;
      let range: AxisRange | null = publicRangeValid ? publicRange : null;
      if (mode === PriceScaleMode.Logarithmic) {
        const minMove = Number((series.options() as any)?.priceFormat?.minMove) || 0;
        if (st.logFormula && st.logRange && publicRangeValid) {
          // A native axis drag, symbol switch or timeframe change can replace our custom range.
          // Refresh only when the public range differs beyond its documented min-move rounding.
          const cachedRaw = axisRangeFromLog(st.logRange, st.logFormula);
          const tolerance = Math.max(minMove * 1.5, Math.max(Math.abs(publicRange.from), Math.abs(publicRange.to), 1) * Number.EPSILON * 32);
          if (Math.abs(cachedRaw.from - publicRange.from) > tolerance
            || Math.abs(cachedRaw.to - publicRange.to) > tolerance) {
            st.logFormula = undefined;
            st.logRange = undefined;
          }
        }
        if (!st.logRange) {
          if (!publicRangeValid) return;
          st.logFormula = axisLogFormulaForRange(publicRange);
          st.logRange = axisRangeToLog(publicRange, st.logFormula);
        }
        range = st.logRange;
      }
      if (!range) return;
      const anchor = axisValueAtCoordinate(
        range,
        localY,
        pane.height,
        scaleOptions.scaleMargins ?? AXIS_MARGINS_DEFAULT,
        scaleOptions.invertScale,
      );
      const next = zoomAxisRange(range, anchor, wheelDeltaToZoomFactor(delta, e.deltaMode, pane.height));
      if (next === range) return;
      scale.setVisibleRange(next);
      if (mode === PriceScaleMode.Logarithmic) st.logRange = next;
      scheduleRender();
    };
    const onAxisDbl = (e: MouseEvent) => {
      const w = wrapElRef.current; if (!w) return; const wr = w.getBoundingClientRect();
      if (!inAxisBand(e.clientX, wr)) return;
      const y = e.clientY - wr.top;
      const pane = paneLayoutRef.current.find((q) => y >= q.top && y <= q.top + q.height); if (!pane) return;
      const st = axisZoomState.get(pane.key); if (!st) return;  // never wheel-scaled → nothing to reset
      try {
        const scale = paneScale(pane.key, pane.paneIndex);
        scale?.applyOptions({ scaleMargins: { ...st.base } });
        scale?.setAutoScale(true);
      } catch {}
      axisZoomState.delete(pane.key);
      scheduleRender();
    };
    function normalizeChartView() {
      const panes = paneLayoutRef.current.length
        ? paneLayoutRef.current
        : [{ key: "__price__", paneIndex: 0 }];
      for (const pane of panes) {
        const scale = paneScale(pane.key, pane.paneIndex); if (!scale) continue;
        const st = axisZoomState.get(pane.key);
        try {
          scale.applyOptions(st
            ? { autoScale: true, scaleMargins: { ...st.base } }
            : { autoScale: true });
        } catch {}
      }
      axisZoomState.clear();
      applyView(barsRef.current, replayIdxRef.current);
      scheduleRender();
      scheduleMeasure();
    }
    // B1: touch double-tap handler — two qualifying taps (down→up <300ms, <12px displacement) within
    // 350ms and <40px of each other → trigger the same pane maximize-toggle as dblclick.
    const onTouchDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      // A one-shot drawing can disarm on pointerup before this gesture's
      // wrapper-level onUp runs. Preserve its pointerdown ownership so the
      // finishing tap cannot also become a pane-maximize double tap.
      const startedWithTool = Boolean(toolRef.current);
      lastTouchTsRef.current = performance.now();   // for synthetic-hover suppression
      const now = performance.now();
      const x = e.clientX, y = e.clientY;
      // track up to detect a qualifying single tap; pointercancel (pinch/scroll takeover) must
      // also detach — pointerIds get reused on touch, so a stale onUp would eat a later tap
      const onCancel = (ec: PointerEvent) => {
        if (ec.pointerId !== e.pointerId) return;
        wrap.removeEventListener("pointerup", onUp); wrap.removeEventListener("pointercancel", onCancel);
        lastTapRef.current = null;
      };
      const onUp = (eu: PointerEvent) => {
        if (eu.pointerId !== e.pointerId) return;
        wrap.removeEventListener("pointerup", onUp); wrap.removeEventListener("pointercancel", onCancel);
        const dt = performance.now() - now;
        const dx = eu.clientX - x, dy = eu.clientY - y;
        if (dt > 300 || Math.hypot(dx, dy) > 12) { lastTapRef.current = null; return; }  // not a tap
        const prev = lastTapRef.current;
        if (prev && performance.now() - prev.t < 350 && Math.hypot(eu.clientX - prev.x, eu.clientY - prev.y) < 40) {
          // double-tap confirmed
          lastTapRef.current = null;
          if ((e.target as Element)?.closest?.(".chart-overlays")) return;
          if (startedWithTool || toolRef.current) return;
          const w = wrapElRef.current; if (!w) return;
          const wr = w.getBoundingClientRect(); const py = eu.clientY - wr.top;
          if (inAxisBand(eu.clientX, wr)) return;
          const p = paneLayoutRef.current.find((q) => py >= q.top && py <= q.top + q.height); if (!p) return;
          lastDblHandledRef.current = performance.now();
          doMaximize(p.paneIndex);
        } else {
          lastTapRef.current = { t: performance.now(), x: eu.clientX, y: eu.clientY };
        }
      };
      wrap.addEventListener("pointerup", onUp); wrap.addEventListener("pointercancel", onCancel);
    };
    // B2: isMobileRef stays current via matchMedia change listener; triggers applyStretch re-run
    const mqlMobile = typeof window !== "undefined" ? window.matchMedia("(max-width:860px)") : null;
    const onMqlChange = () => {
      const m = mqlMobile?.matches ?? false;
      isMobileRef.current = m;
      setIsMobile(m);
      applyStretch();
      scheduleMeasure();
    };
    mqlMobile?.addEventListener("change", onMqlChange);
    // ── signal-marker tooltip: hover (mouse) + tap (touch/pen) ──────────────────────────────
    // Read-only listeners on `wrap`. They never call preventDefault or stopPropagation, never
    // capture, and never touch the chart — the canvas below is unaffected, which is the whole
    // point (see the `sigTip` construction note). Registered on `wrap` because the canvas's
    // events already bubble here: `onPaneMove`, `onTouchDown` and the scrub handlers have all
    // relied on that for as long as they have existed.
    /** Measure every currently-painted marker that carries a `<title>`.
     *
     *  Boxes are read in VIEWPORT coordinates (`getBoundingClientRect`) and compared against the
     *  event's own `clientX/clientY`, so the hit test never has to reason about the overlay's SVG
     *  user space versus the wrapper's border box — two spaces that coincide today and would
     *  diverge silently the day anything grows a border or a viewBox.
     *
     *  Nothing here enumerates marker CLASSES: any marker that has a title is hoverable, so a
     *  future class gets its tooltip for free and cannot be forgotten. */
    const buildSigHits = (): MarkerHit[] => {
      const layer = sigRef.current;
      const out: MarkerHit[] = [];
      if (!layer) return out;
      for (const g of layer.querySelectorAll<SVGGElement>(":scope > g")) {
        const title = g.querySelector(":scope > title")?.textContent;
        if (!title) continue;
        let b: DOMRect;
        try { b = g.getBoundingClientRect(); } catch { continue; }
        if (!(b.width > 0) || !(b.height > 0)) continue;
        // every title is emitted as `${m.t} · …`, so the prefix is the marker's bar date
        out.push({ x: b.x, y: b.y, w: b.width, h: b.height, title, t: title.split(" ·")[0] });
      }
      return out;
    };
    const sigHitAt = (clientX: number, clientY: number, slack: number): MarkerHit | null => {
      if (sigHits == null) sigHits = buildSigHits();
      return sigHits.length ? hitTestMarkers(sigHits, clientX, clientY, slack) : null;
    };
    const sigTipShow = (hit: MarkerHit, clientX: number, clientY: number) => {
      const w = wrapElRef.current; if (!sigTip || !w) return;
      // Only rewrite the node when the marker actually changed — this runs on every pointermove
      // while the cursor sits on a marker, and re-setting textContent 60×/s rebuilds a text node
      // for nothing. Keyed on the TITLE, not the date: two markers can share a bar.
      if (sigTip.textContent !== hit.title) {
        sigTip.textContent = hit.title;
        sigTip.setAttribute("data-marker-at", hit.t);
      }
      if (sigTip.style.display === "none") sigTip.style.display = "block";
      const wr = w.getBoundingClientRect();
      const p = placeMarkerTip(
        { x: clientX - wr.left, y: clientY - wr.top },
        { w: sigTip.offsetWidth, h: sigTip.offsetHeight },
        { w: wr.width, h: wr.height },
      );
      sigTip.style.left = `${p.left}px`;
      sigTip.style.top = `${p.top}px`;
    };
    onSigHover = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;                          // touch takes the tap path
      if (lastTouchTsRef.current > 0 && performance.now() - lastTouchTsRef.current < 700) return;   // B1: synthetic post-touch move, gated on a touch having happened
      if (sigTipPinned) return;                     // a tapped tooltip is not chased by the cursor
      if (sigPointerDown) {
        if (e.buttons !== 0) { sigTipHide(); return; }   // mid press-drag → never chase a pan
        // A press whose release landed outside the window never reaches our `pointerup`, and a
        // stuck flag would suppress hover for the rest of the session. A move with no button held
        // is proof the gesture ended, so the flag heals itself instead of needing window listeners.
        sigPointerDown = null;
      }
      const hit = sigHitAt(e.clientX, e.clientY, MARKER_HOVER_SLACK);
      if (hit) sigTipShow(hit, e.clientX, e.clientY);
      else if (sigTip && sigTip.style.display !== "none") sigTipHide();
    };
    onSigDown = (e: PointerEvent) => {
      // Unconditional: a press anywhere dismisses an open tooltip BEFORE the gesture it starts.
      // This is also what makes the pinned (tapped) tooltip dismissable by a tap elsewhere.
      sigTipHide();
      sigPointerDown = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    };
    onSigUp = (e: PointerEvent) => {
      const down = sigPointerDown;
      sigPointerDown = null;
      if (!down || down.id !== e.pointerId) return;
      if (e.pointerType === "mouse") return;      // a mouse click is not a tooltip gesture
      // TOUCH: a tap on a marker must not dead-end. The same thresholds the double-tap detector
      // uses, so one gesture can never be a tap here and a drag for the chart.
      if (!isTapGesture(down, { x: e.clientX, y: e.clientY, t: performance.now() })) return;
      // Hit-tested at the DOWN point — where the finger actually landed — and with the larger
      // touch slack, because a ⊘ ring is ~11px across and a fingertip has no hover to correct with.
      const hit = sigHitAt(down.x, down.y, MARKER_TAP_SLACK);
      if (!hit) return;
      sigTipShow(hit, down.x, down.y);
      sigTipPinned = true;   // stays until the next pointerdown; there is no hover to dismiss it
    };
    onSigCancel = () => { sigPointerDown = null; sigTipHide(); };
    onSigLeave = (e: PointerEvent) => {
      // Touch fires pointerleave immediately after pointerup, which would kill the pin the tap
      // just set. Only a real cursor leaving the chart dismisses a tooltip.
      if (e.pointerType && e.pointerType !== "mouse") return;
      sigTipHide();
    };
    wrap.addEventListener("pointermove", onSigHover);
    wrap.addEventListener("pointerdown", onSigDown);
    wrap.addEventListener("pointerup", onSigUp);
    wrap.addEventListener("pointercancel", onSigCancel);
    wrap.addEventListener("pointerleave", onSigLeave);

    wrap.addEventListener("mousemove", onPaneMove); wrap.addEventListener("mouseleave", onPaneLeave); wrap.addEventListener("dblclick", onPaneDbl);
    wrap.addEventListener("pointerdown", onTouchDown);
    wrap.addEventListener("wheel", onAxisWheel, { passive: false, capture: true });
    wrap.addEventListener("dblclick", onAxisDbl);

    // observe each pane element so separator drags / collapses reposition the overlay + rebaseline sizes.
    // scheduleRender() re-lays the signal-marker + drawing SVG overlays: a pane collapse/maximize/drag
    // changes the price pane's height (→ priceToCoordinate) WITHOUT resizing the chart container, so the
    // container `ro` below never fires — without this the BUY/SELL/CUT/REBUY badges lag at stale Y coords
    // until an unrelated pan/hover triggers a render.
    // A PINNED (tapped) tooltip has no cursor to dismiss it, so a RELAYOUT that moves its marker
    // out from under it leaves litter pointing at nothing — the reachable case being a double-tap
    // ON a marker, where the second tap re-pins while the same gesture maximizes the pane. Hooked
    // to the pane observer and NOT to renderSignals: a repaint is far too broad a trigger. Markers
    // repaint on every visible-range frame and, measurably, on something that lands right after a
    // touch tap — hiding there dismissed the tooltip the tap had just opened, and took the tap
    // tests red on both touch viewports. A pane resize/maximize is the event that actually
    // invalidates the anchor, and a tap does not cause one.
    paneRO = new ResizeObserver(() => { if (dead) return; sigTipHide(); captureNormal(); scheduleMeasure(); scheduleRender(); });
    paneRORef.current = paneRO;

    const rectXY = (ev: PointerEvent) => { const r = svg.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const idAt = (ev: Event) => (ev.target as Element)?.closest?.("g[data-id]")?.getAttribute("data-id") || null;
    // Registry-backed defaults and capabilities are the sole pre-draw style contract.
    const applyStyle = (kind: Drawing["kind"]): Partial<Drawing> => {
      const spec = getDrawingTool(kind), defaults = spec?.defaults;
      const s = styleRef.current;
      const can = (cap: DrawingToolCapability) => spec?.capabilities.includes(cap) ?? false;
      return {
        schemaVersion: DRAWING_SCHEMA_VERSION,
        source: "user",
        locked: false,
        hidden: false,
        z: drawRef.current.length,
        color: s && can("stroke") ? s.color : defaults?.color,
        width: s && can("width") ? s.width : defaults?.width,
        dash: s && can("dash") ? s.dash : defaults?.dash,
        opacity: defaults?.opacity ?? 1,
        extend: defaults?.extend ?? "none",
        fillColor: s && can("fill") ? s.color : defaults?.fillColor,
        fillOpacity: defaults?.fillOpacity,
        fontSize: defaults?.fontSize,
      };
    };
    const announceCommit = (kind: Drawing["kind"], activation = toolActivationRef.current) => {
      // Include the committed tool so the controlled shell can retire only the
      // selection that produced this object. Under a busy concurrent render an
      // older one-shot update must never clear a newer tool choice.
      try { window.dispatchEvent(new CustomEvent("mm:drawing-committed", { detail: { kind, activation } })); } catch {}
    };
    let semanticTimesCache: { signature: string; times: string[] } = { signature: "", times: [] };
    /** Every addressable slot, real bars first then the future grid. */
    const semanticTimes = () => {
      const rows = barsRef.current, signature = `${rows.length}|${rows[0]?.time ?? ""}|${rows[rows.length - 1]?.time ?? ""}`;
      if (semanticTimesCache.signature !== signature) {
        semanticTimesCache = {
          signature,
          times: [...rows.map((row) => String(row.time)), ...futureGrid().times.map((time) => String(time))],
        };
      }
      return semanticTimesCache.times;
    };
    const materializePoints = (kind: Drawing["kind"], points: Drawing["points"]) =>
      getDrawingTool(kind)?.creation.semanticPointCount
        ? materializeSemanticPoints(kind, points, semanticTimes(), precRef.current)
        : points;
    const commitDrawing = (
      kind: Drawing["kind"],
      points: Drawing["points"],
      meta: Drawing["meta"] | undefined,
      activation: number,
      paneKey?: string | null,
    ) => {
      // Only a non-price pane is recorded, so existing price-pane documents keep
      // their exact persisted shape and need no migration.
      const withPane = paneKey && paneKey !== PRICE_PANE_KEY ? { ...(meta ?? {}), pane: paneKey } : meta;
      const next: Drawing = { id: uid(), kind, points: materializePoints(kind, points), ...applyStyle(kind), ...(withPane ? { meta: withPane } : {}) };
      sel = drawingStickyRef.current ? null : next.id; drawRef.current = [...drawRef.current, next]; onChangeRef.current?.([...drawRef.current]); announceCommit(kind, activation);
    };

    // Media tools deliberately pause between geometry placement and persistence.
    // OpenMarket exposes a real choice surface for markers, while Image opens the
    // native file chooser only after its box exists. Keeping this DOM chart-local
    // avoids the mobile double-palette collision and makes teardown deterministic.
    let mediaSurfaceCleanup: (() => void) | null = null;
    let mediaSurfaceKind: "emoji" | "icon" | "image" | null = null;
    let mediaFileReader: FileReader | null = null;
    let mediaFocusReturn: HTMLElement | null = null;
    const closeMediaSurface = (restoreFocus = false) => {
      const cleanup = mediaSurfaceCleanup; mediaSurfaceCleanup = null;
      if (mediaFileReader?.readyState === FileReader.LOADING) {
        try { mediaFileReader.abort(); } catch {}
      }
      mediaFileReader = null;
      cleanup?.();
      if (restoreFocus && mediaFocusReturn?.isConnected) window.setTimeout(() => mediaFocusReturn?.focus({ preventScroll: true }), 0);
      mediaFocusReturn = null;
      mediaSurfaceKind = null;
    };
    cancelMediaToolRef.current = (activeTool) => {
      // The tool-change effect runs after React commits. A very fast pointer can
      // already have opened the new tool's picker by then; only dismiss a surface
      // that belongs to the tool we just left.
      if (mediaSurfaceKind && mediaSurfaceKind === activeTool) return;
      closeMediaSurface(false);
    };

    const mediaCopy = () => document.documentElement.lang.toLowerCase().startsWith("zh") ? {
      emojiTitle: "选择表情",
      iconTitle: "选择图标",
      imageTitle: "添加图片",
      imageHelp: "PNG、JPG 或 WebP · 最大 700 KB",
      browse: "选择图片",
      cancel: "取消",
      close: "关闭",
      chooseError: "请选择 PNG、JPG 或 WebP 图片。",
      sizeError: "图片必须小于 700 KB。",
      dimensionError: "图片尺寸必须不超过 4096 × 4096 和 1200 万像素。",
      decodeError: "无法读取这张图片，请选择另一张。",
      payloadError: "图片会使绘图存储超过安全上限，请选择更小的图片。",
      loading: "正在处理图片…",
      cancelled: "未选择图片。你可以重试或取消。",
    } : {
      emojiTitle: "Choose an emoji",
      iconTitle: "Choose an icon",
      imageTitle: "Add image",
      imageHelp: "PNG, JPG or WebP · 700 KB maximum",
      browse: "Choose image",
      cancel: "Cancel",
      close: "Close",
      chooseError: "Choose a PNG, JPG or WebP image.",
      sizeError: "Image must be smaller than 700 KB.",
      dimensionError: "Image must be at most 4096 × 4096 and 12 megapixels.",
      decodeError: "This image could not be read. Choose another one.",
      payloadError: "This image would exceed the drawing storage limit. Choose a smaller one.",
      loading: "Processing image…",
      cancelled: "No image selected. Try again or cancel.",
    };

    const createMediaSurface = (kind: "emoji" | "icon" | "image", title: string, x: number, y: number) => {
      closeMediaSurface(false);
      mediaSurfaceKind = kind;
      mediaFocusReturn = document.querySelector<HTMLElement>(`[data-tool-id="${kind}"]`) ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      const panel = document.createElement("div");
      panel.className = "drawing-media-picker";
      panel.dataset.mediaKind = kind;
      panel.dataset.testid = "drawing-media-picker";
      panel.setAttribute("role", "dialog");
      panel.tabIndex = -1;
      const titleId = `drawing-media-title-${uid()}`;
      panel.setAttribute("aria-labelledby", titleId);
      const head = document.createElement("div"); head.className = "drawing-media-picker-head";
      const heading = document.createElement("div"); heading.className = "drawing-media-picker-title"; heading.id = titleId; heading.textContent = title;
      const close = document.createElement("button"); close.type = "button"; close.className = "drawing-media-picker-close"; close.setAttribute("aria-label", mediaCopy().close); close.textContent = "×";
      const body = document.createElement("div"); body.className = "drawing-media-picker-body";
      const status = document.createElement("div"); status.className = "drawing-media-picker-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      head.append(heading, close); panel.append(head, body, status); wrap.appendChild(panel); mediaPickerRef.current = panel;
      const stop = (event: Event) => event.stopPropagation();
      panel.addEventListener("pointerdown", stop);
      panel.addEventListener("click", stop);
      const onOutside = (event: PointerEvent) => {
        if (panel.contains(event.target as Node)) return;
        // A chart click is dismissal, not the first press of another marker.
        // Consume it before the still-armed SVG handler can immediately reopen
        // this surface (or the native file chooser) on pointerup.
        if ((event.target as Element | null)?.closest?.(".drawing-layer")) {
          event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
        }
        closeMediaSurface(false);
      };
      const onEscape = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault(); event.stopPropagation(); closeMediaSurface(true);
      };
      window.addEventListener("pointerdown", onOutside, true);
      window.addEventListener("keydown", onEscape, true);
      panel.addEventListener("keydown", (event) => {
        if (event.key !== "Tab") return;
        const focusable = Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        if (!focusable.length) { event.preventDefault(); panel.focus({ preventScroll: true }); return; }
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus({ preventScroll: true }); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }); }
      });
      close.addEventListener("click", () => closeMediaSurface(true));
      mediaSurfaceCleanup = () => {
        window.removeEventListener("pointerdown", onOutside, true);
        window.removeEventListener("keydown", onEscape, true);
        try { panel.remove(); } catch {}
        if (mediaPickerRef.current === panel) mediaPickerRef.current = null;
        const input = mediaInputRef.current;
        if (input) { try { input.remove(); } catch {} mediaInputRef.current = null; }
      };
      panel.style.left = `${Math.max(8, x + 14)}px`;
      panel.style.top = `${Math.max(8, y + 14)}px`;
      requestAnimationFrame(() => {
        if (!panel.isConnected || matchMedia("(max-width:860px)").matches) return;
        const width = panel.offsetWidth, height = panel.offsetHeight;
        panel.style.left = `${Math.max(8, Math.min(el!.clientWidth - width - 8, x + 14))}px`;
        panel.style.top = `${Math.max(8, Math.min(el!.clientHeight - height - 8, y + 14))}px`;
      });
      return { panel, body, status, close };
    };

    const appendMediaDrawing = (next: Drawing, activation: number) => {
      closeMediaSurface(false);
      sel = drawingStickyRef.current ? null : next.id;
      drawRef.current = [...drawRef.current, next];
      onChangeRef.current?.([...drawRef.current]);
      announceCommit(next.kind, activation);
    };

    const openMediaChoicePicker = (kind: "emoji" | "icon", point: Drawing["points"][number], x: number, y: number, activation = toolActivationRef.current) => {
      const copy = mediaCopy();
      const { panel, body } = createMediaSurface(kind, kind === "emoji" ? copy.emojiTitle : copy.iconTitle, x, y);
      body.classList.add("drawing-media-choice-grid");
      const choices = kind === "emoji" ? DRAWING_MEDIA_EMOJIS : DRAWING_MEDIA_ICONS;
      const buttons: HTMLButtonElement[] = [];
      choices.forEach((choice, index) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "drawing-media-choice";
        button.dataset.mediaChoice = kind === "emoji" ? String(index) : (choice as DrawingMediaIcon).id;
        button.dataset.testid = `drawing-media-choice-${kind}-${index}`;
        const label = choice.label; button.setAttribute("aria-label", label);
        if (kind === "emoji") {
          const glyph = document.createElement("span"); glyph.className = "drawing-media-choice-glyph"; glyph.setAttribute("aria-hidden", "true"); glyph.textContent = (choice as typeof DRAWING_MEDIA_EMOJIS[number]).glyph;
          const caption = document.createElement("span"); caption.className = "drawing-media-choice-label"; caption.textContent = label;
          button.append(glyph, caption);
          button.addEventListener("click", () => {
            const emoji = choice as typeof DRAWING_MEDIA_EMOJIS[number];
            appendMediaDrawing({
              id: uid(), kind: "emoji", points: [point], ...applyStyle("emoji"),
              text: emoji.glyph, fontSize: 30,
              meta: { mediaType: "emoji", emojiLabel: emoji.label },
            }, activation);
          });
        } else {
          const icon = choice as DrawingMediaIcon;
          const glyph = document.createElementNS(NS, "svg"); glyph.setAttribute("viewBox", "0 0 24 24"); glyph.setAttribute("aria-hidden", "true"); glyph.classList.add("drawing-media-choice-icon");
          glyph.appendChild(mk("path", { d: icon.path, fill: icon.filled ? "currentColor" : "none", stroke: "currentColor", "stroke-width": icon.filled ? 1 : 1.8, "stroke-linecap": "round", "stroke-linejoin": "round", "fill-rule": "evenodd" }));
          const caption = document.createElement("span"); caption.className = "drawing-media-choice-label"; caption.textContent = icon.label;
          button.append(glyph, caption);
          button.addEventListener("click", () => appendMediaDrawing({
            id: uid(), kind: "icon", points: [point], ...applyStyle("icon"), text: icon.id,
            meta: { mediaType: "icon", iconId: icon.id, iconLabel: icon.label },
          }, activation));
        }
        buttons.push(button); body.appendChild(button);
      });
      panel.addEventListener("keydown", (event) => {
        const current = document.activeElement instanceof HTMLButtonElement ? buttons.indexOf(document.activeElement) : -1;
        if (current < 0) return;
        const columns = matchMedia("(max-width:420px)").matches ? 3 : 4;
        const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? columns : event.key === "ArrowUp" ? -columns : 0;
        if (!delta && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + delta));
        buttons[next]?.focus({ preventScroll: true });
      });
      window.setTimeout(() => {
        if (!panel.contains(document.activeElement)) buttons[0]?.focus({ preventScroll: true });
      }, 0);
    };

    const probeImage = (src: string) => new Promise<{ width: number; height: number }>((resolve, reject) => {
      const probe = new Image();
      probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
      probe.onerror = () => reject(new Error("decode"));
      probe.src = src;
    });

    const openImageUpload = (points: Drawing["points"], x: number, y: number, activation = toolActivationRef.current) => {
      const copy = mediaCopy();
      const { panel, body, status } = createMediaSurface("image", copy.imageTitle, x, y);
      const help = document.createElement("p"); help.className = "drawing-media-picker-help"; help.textContent = copy.imageHelp;
      const actions = document.createElement("div"); actions.className = "drawing-media-picker-actions";
      const browse = document.createElement("button"); browse.type = "button"; browse.className = "drawing-media-picker-primary"; browse.textContent = copy.browse; browse.dataset.testid = "drawing-image-browse";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "drawing-media-picker-secondary"; cancel.textContent = copy.cancel;
      actions.append(browse, cancel); body.append(help, actions);
      const input = document.createElement("input"); input.type = "file"; input.accept = "image/png,image/jpeg,image/webp"; input.className = "drawing-media-file-input"; input.dataset.testid = "drawing-image-input"; input.setAttribute("aria-label", copy.browse);
      wrap.appendChild(input); mediaInputRef.current = input;
      const setStatus = (message: string, state: "idle" | "loading" | "error" = "idle") => {
        status.textContent = message; status.dataset.state = state;
      };
      const choose = () => { input.value = ""; input.click(); };
      browse.addEventListener("click", choose);
      cancel.addEventListener("click", () => closeMediaSurface(true));
      input.addEventListener("cancel", () => { setStatus(copy.cancelled); browse.focus({ preventScroll: true }); });
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) { setStatus(copy.cancelled); browse.focus({ preventScroll: true }); return; }
        if (!DRAWING_IMAGE_MIME.has(file.type)) { setStatus(copy.chooseError, "error"); browse.focus({ preventScroll: true }); return; }
        if (file.size <= 0 || file.size > DRAWING_IMAGE_MAX_FILE_BYTES) { setStatus(copy.sizeError, "error"); browse.focus({ preventScroll: true }); return; }
        setStatus(copy.loading, "loading"); browse.disabled = true; cancel.disabled = true;
        const reader = new FileReader(); mediaFileReader = reader;
        reader.onerror = () => { if (!panel.isConnected) return; mediaFileReader = null; browse.disabled = false; cancel.disabled = false; setStatus(copy.decodeError, "error"); browse.focus({ preventScroll: true }); };
        reader.onabort = () => { mediaFileReader = null; };
        reader.onload = async () => {
          mediaFileReader = null;
          if (!panel.isConnected) return;
          const src = reader.result;
          if (!isSafeDrawingImageDataUrl(src)) { browse.disabled = false; cancel.disabled = false; setStatus(copy.decodeError, "error"); browse.focus({ preventScroll: true }); return; }
          try {
            const dimensions = await probeImage(src);
            if (!panel.isConnected) return;
            if (dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width > DRAWING_IMAGE_MAX_EDGE || dimensions.height > DRAWING_IMAGE_MAX_EDGE || dimensions.width * dimensions.height > DRAWING_IMAGE_MAX_PIXELS) {
              browse.disabled = false; cancel.disabled = false; setStatus(copy.dimensionError, "error"); browse.focus({ preventScroll: true }); return;
            }
            const safeName = file.name.trim().slice(0, 96) || "image";
            const next: Drawing = {
              id: uid(), kind: "image", points, ...applyStyle("image"),
              meta: { mediaType: "image", imageSrc: src, imageName: safeName, imageMime: file.type, imageWidth: dimensions.width, imageHeight: dimensions.height },
            };
            const payloadBytes = new TextEncoder().encode(JSON.stringify([...drawRef.current, next])).byteLength;
            if (payloadBytes > DRAWING_IMAGE_PAYLOAD_BUDGET) {
              browse.disabled = false; cancel.disabled = false; setStatus(copy.payloadError, "error"); browse.focus({ preventScroll: true }); return;
            }
            appendMediaDrawing(next, activation);
          } catch {
            if (!panel.isConnected) return;
            browse.disabled = false; cancel.disabled = false; setStatus(copy.decodeError, "error"); browse.focus({ preventScroll: true });
          }
        };
        reader.readAsDataURL(file);
      });
      // Keep this call synchronous with pointerup so Safari/iOS considers it a
      // trusted user gesture. The visible Browse action remains if it is blocked.
      choose();
      requestAnimationFrame(() => { if (panel.isConnected) browse.focus({ preventScroll: true }); });
    };

    // PointerEvent.detail is always 0 in Chromium. Track presses by stable drawing id so
    // a real double-click still edits text after the first press rebuilds the SVG node.
    let lastTextPress: { id: string; at: number; x: number; y: number } | null = null;
    const setInspectorMoving = (moving: boolean) => bar.classList.toggle("is-drawing-moving", moving);

    // select + drag existing drawings in cursor mode (capture phase; runs before creation)
    svg.addEventListener("pointerdown", (ev) => {
      if (replayIdxRef.current != null || toolRef.current || !activeRef.current || !ev.isPrimary || ev.button !== 0) return; const hitId = idAt(ev); if (!hitId) { if (sel) { sel = null; renderDraw(); } return; }
      const source = drawRef.current.find((x) => x.id === hitId); if (!source) return;
      const handleAttr = (ev.target as Element)?.closest?.("[data-handle]")?.getAttribute("data-handle");
      let id = hitId;
      let d0 = source;
      // Cmd/Ctrl-drag clones the object before movement. The clone is detached,
      // unlocked and selected; pointercancel removes it without touching source.
      const commandClone = Boolean((ev.metaKey || ev.ctrlKey) && handleAttr == null && !source.locked);
      if (commandClone) {
        d0 = cloneDrawing(source, uid());
        d0.z = Math.max(drawRef.current.length, ...drawRef.current.map((drawing) => drawing.z ?? 0)) + 1;
        id = d0.id;
        drawRef.current = [...drawRef.current, d0];
      }
      const pointerId = ev.pointerId;
      ev.stopPropagation();
      if (getDrawingTool(d0.kind)?.capabilities.includes("textInput") && !d0.locked) {
        const now = performance.now();
        const isDoublePress = lastTextPress?.id === id
          && now - lastTextPress.at <= 500
          && Math.hypot(ev.clientX - lastTextPress.x, ev.clientY - lastTextPress.y) <= 12;
        if (isDoublePress) {
          lastTextPress = null;
          ev.preventDefault(); sel = id; renderDraw(); openTextEditor(d0.points[0], d0); return;
        }
        lastTextPress = { id, at: now, x: ev.clientX, y: ev.clientY };
      } else {
        lastTextPress = null;
      }
      sel = id; renderDraw();
      if (d0.locked) return;
      const prec = precRef.current;
      // Editing an indicator-pane object works in that pane's value space, which
      // needs finer rounding than the instrument's price precision.
      const editPane = drawingPaneKey(d0);
      const editPrec = editPane ? Math.max(prec, 6) : prec;
      if (handleAttr != null) {
        const handleIndex = Number(handleAttr);
        if (Number.isInteger(handleIndex) && d0.points[handleIndex]) {
          drawingTransactionRef.current = true;
          setInspectorMoving(true);
          const moveHandle = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            const m0 = rectXY(e);
            const angleOrigin = d0.points.length === 2
              ? d0.points[handleIndex === 0 ? 1 : 0]
              : handleIndex > 0 ? d0.points[0] : undefined;
            // A sub-pane object keeps reading its own scale even if the cursor
            // strays into a neighbouring pane mid-drag.
            const snapped = constrainedSnap(angleOrigin, m0.x, m0.y, e, { paneKey: editPane });
            const paneValue = editPane ? priceAtIn(m0.y, editPane) : null;
            const pt = paneValue == null ? snapped : { t: snapped.t, p: +paneValue.toFixed(editPrec) };
            const paneAnchored = getDrawingTool(d0.kind)?.creation.anchorSpace === "pane" && handleIndex === 0;
            drawRef.current = drawRef.current.map((x) => x.id !== id ? x : {
              ...x,
              points: x.points.map((p, i) => i === handleIndex ? pt : p),
              ...(paneAnchored ? { meta: paneMetaAt(m0.x, m0.y, x.meta) } : {}),
            });
            scheduleDraw();
          };
          const cleanupHandle = () => {
            window.removeEventListener("pointermove", moveHandle); window.removeEventListener("pointerup", endHandle); window.removeEventListener("pointercancel", cancelHandle);
            setInspectorMoving(false);
          };
          const endHandle = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            cleanupHandle();
            dragCleanup = null; drawingTransactionRef.current = false; onChangeRef.current?.([...drawRef.current]);
          };
          const cancelHandle = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            cleanupHandle(); dragCleanup = null; drawingTransactionRef.current = false;
            drawRef.current = drawRef.current.map((x) => x.id === id ? d0 : x);
            renderDraw();
          };
          dragCleanup = cleanupHandle;
          window.addEventListener("pointermove", moveHandle); window.addEventListener("pointerup", endHandle); window.addEventListener("pointercancel", cancelHandle); return;
        }
      }
      const s0 = rectXY(ev); const start = snap(s0.x, s0.y, ev); const orig = d0.points.map((p) => ({ ...p }));
      const origPaneAnchor = getDrawingTool(d0.kind)?.creation.anchorSpace === "pane" ? paneAnchorOf(d0.meta) : null;
      drawingTransactionRef.current = true;
      setInspectorMoving(true);
      const origIndices = orig.map((point) => barIndex(point.t));
      const minOrigIndex = Math.min(...origIndices), maxOrigIndex = Math.max(...origIndices);
      const move = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        const m0 = rectXY(e), cur = snap(m0.x, m0.y, e), bars = barsRef.current;
        if (origPaneAnchor) {
          const nextAnchor = {
            x: clampUnit(origPaneAnchor.x + (m0.x - s0.x) / Math.max(1, el!.clientWidth)),
            y: clampUnit(origPaneAnchor.y + (m0.y - s0.y) / Math.max(1, el!.clientHeight)),
          };
          const point = snap(nextAnchor.x * el!.clientWidth, nextAnchor.y * el!.clientHeight, e);
          drawRef.current = drawRef.current.map((x) => x.id !== id ? x : {
            ...x,
            points: x.points.map((existingPoint, index) => index === 0 ? point : existingPoint),
            meta: { ...(x.meta ?? {}), paneAnchor: nextAnchor },
          });
          scheduleDraw();
          return;
        }
        // Vertical translation is measured in the object's OWN pane, so a drag
        // that crosses a pane boundary cannot rewrite the anchors with a value
        // sampled from a different scale.
        const startValue = editPane ? (priceAtIn(s0.y, editPane) ?? start.p) : start.p;
        const currentValue = editPane ? (priceAtIn(m0.y, editPane) ?? cur.p) : cur.p;
        const dp = currentValue - startValue;
        const requestedDi = barIndex(cur.t!) - barIndex(start.t!);
        // Clamp one shared translation delta so every anchor moves rigidly at
        // the data boundary instead of independently collapsing the geometry.
        const slots = semanticTimes();
        const di = Math.max(-minOrigIndex, Math.min(slots.length - 1 - maxOrigIndex, requestedDi));
        drawRef.current = drawRef.current.map((x) => x.id !== id ? x : { ...x, points: orig.map((pt, index) => { const ni = origIndices[index] + di; return { t: slots[ni] ?? bars[ni]?.time ?? pt.t, p: +(pt.p + dp).toFixed(editPrec) }; }) });
        scheduleDraw();   // rAF-coalesced: one renderDraw() per frame instead of per raw pointermove
      };
      const cleanupMove = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancelMove); setInspectorMoving(false); };
      const up = (e: PointerEvent) => { if (e.pointerId !== pointerId) return; cleanupMove(); dragCleanup = null; drawingTransactionRef.current = false; onChangeRef.current?.([...drawRef.current]); };
      const cancelMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        cleanupMove(); dragCleanup = null; drawingTransactionRef.current = false;
        drawRef.current = commandClone
          ? drawRef.current.filter((x) => x.id !== id)
          : drawRef.current.map((x) => x.id === id ? d0 : x);
        if (commandClone) sel = hitId;
        renderDraw();
      };
      dragCleanup = cleanupMove;
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancelMove);
    }, true);

    // Hover a drawing and scroll to rotate through the quick palette—the same
    // precision shortcut surfaced by OpenMarket's endpoint palette. Only a
    // drawing hit consumes the wheel; normal chart zoom remains untouched.
    let lastPaletteWheel = 0;
    svg.addEventListener("wheel", (event) => {
      if (!activeRef.current || replayIdxRef.current != null) return;
      if (toolRef.current) {
        if (!matchMedia("(pointer:fine)").matches) return;
        const now = performance.now(); if (now - lastPaletteWheel < 90) return;
        lastPaletteWheel = now; event.preventDefault(); event.stopPropagation();
        const current = COLORS.findIndex((color) => color === (styleRef.current?.color || getDrawingTool(toolRef.current)?.defaults.color));
        const direction = event.deltaY >= 0 ? 1 : -1;
        setCreationColor(COLORS[(current < 0 ? 0 : current + direction + COLORS.length) % COLORS.length]);
        positionCreationPalette(event.clientX, event.clientY);
        return;
      }
      const id = idAt(event); if (!id) return;
      const now = performance.now(); if (now - lastPaletteWheel < 90) return;
      lastPaletteWheel = now; event.preventDefault(); event.stopPropagation();
      const drawing = drawRef.current.find((candidate) => candidate.id === id); if (!drawing) return;
      const current = COLORS.findIndex((color) => color === drawing.color);
      const direction = event.deltaY >= 0 ? 1 : -1;
      const next = COLORS[(current < 0 ? 0 : current + direction + COLORS.length) % COLORS.length];
      sel = id;
      rememberRecentColor(next, drawing.color);
      const canFill = getDrawingTool(drawing.kind)?.capabilities.includes("fill") ?? false;
      drawRef.current = drawRef.current.map((candidate) => candidate.id === id
        ? { ...candidate, color: next, ...(canFill ? { fillColor: next } : {}) }
        : candidate);
      onChangeRef.current?.([...drawRef.current]);
    }, { passive: false });

    // creation / erase (bubble; svg is pointer-events:auto only when a tool is active)
    svg.addEventListener("pointerdown", (ev) => {
      const tl = toolRef.current; if (drawingCreationDisabledRef.current || replayIdxRef.current != null || !tl || !ev.isPrimary || ev.button !== 0) return;
      const activation = toolActivationRef.current;
      positionCreationPalette(ev.clientX, ev.clientY);
      const { x, y } = rectXY(ev); const a = snap(x, y, ev); const gesturePane = snapPaneKey;
      const spec = getDrawingTool(tl); if (!spec) return;
      // The palette follows the pointer by a small offset. During a paced
      // diagonal drag its previous frame can otherwise move underneath the
      // next pointer sample and steal the gesture before pointerup. Keep it
      // visible, but make it click-through until this creation transaction
      // ends; swatches become interactive again immediately on release.
      creationPalette.style.pointerEvents = "none";
      if (spec.creation.mode === "one-point") {
        pending = {
          kind: spec.id,
          activation,
          points: [],
          mode: spec.capabilities.includes("textInput") ? "text" : "point",
          pointerId: ev.pointerId,
          candidate: a,
          downX: x,
          downY: y,
          paneKey: gesturePane,
          ...(spec.creation.anchorSpace === "pane" ? { meta: paneMetaAt(x, y) } : {}),
        };
        try { svg.setPointerCapture(ev.pointerId); } catch {}
        renderDraw(); return;
      }
      if (spec.creation.mode === "two-point") {
        if (pending?.kind === spec.id && pending.mode === "drag" && pending.awaitingSecond && pending.activation === activation) {
          pending.pointerId = ev.pointerId;
          pending.candidate = constrainedSnap(pending.points[0], x, y, ev, { paneKey: pending.paneKey });
          pending.downX = x; pending.downY = y;
        } else {
          pending = { kind: spec.id, activation, points: [a], mode: "drag", pointerId: ev.pointerId, awaitingSecond: false, downX: x, downY: y, paneKey: gesturePane };
        }
        try { svg.setPointerCapture(ev.pointerId); } catch {}
        return;
      }
      if (spec.creation.mode === "freehand") {
        pending = { kind: spec.id, activation, points: [a], mode: "freehand", pointerId: ev.pointerId, downX: x, downY: y, paneKey: gesturePane };
        try { svg.setPointerCapture(ev.pointerId); } catch {}
        return;
      }
      // Fixed and variable tools commit click-by-click. Variable paths finish on
      // a repeated final anchor / native double-click; fixed tools auto-commit at
      // their declarative 3–7 point count.
      if (!pending || pending.kind !== spec.id || pending.mode !== "multi" || pending.activation !== activation) {
        pending = { kind: spec.id, activation, points: [], mode: "multi" };
      }
      if (pending.pointerId != null) return;
      pending.pointerId = ev.pointerId; pending.candidate = a;
      pending.downX = x; pending.downY = y;
      if (!pending.points.length) pending.paneKey = gesturePane;
      try { svg.setPointerCapture(ev.pointerId); } catch {}
      renderDraw();
    });
    // Double-click finishes variable segmented tools and edits text in cursor mode.
    svg.addEventListener("dblclick", (ev) => {
      if (!activeRef.current) return;
      const activeTool = toolRef.current, spec = getDrawingTool(activeTool);
      if (activeTool && spec?.creation.mode === "variable-multi" && pending?.kind === activeTool && pending.mode === "multi") {
        ev.stopPropagation(); ev.preventDefault();
        const points = [...pending.points];
        const activation = pending.activation;
        // The second click in a dblclick repeats the endpoint. Persist one clean
        // control anchor while still honoring the repeated-last finish gesture.
        while (points.length > 1) {
          const last = points[points.length - 1], before = points[points.length - 2];
          const lx = xOf(last.t), ly = yOf(last.p), px = xOf(before.t), py = yOf(before.p);
          if (lx == null || ly == null || px == null || py == null || Math.hypot(lx - px, ly - py) > 3) break;
          points.pop();
        }
        if (points.length >= spec.creation.minPoints) { const paneKey = pending.paneKey; pending = null; commitDrawing(activeTool, points.slice(0, spec.creation.maxPoints), undefined, activation, paneKey); renderDraw(); }
        return;
      }
      const id = idAt(ev); const d = drawRef.current.find((x) => x.id === id);
      if (d && replayIdxRef.current == null && !d.locked && getDrawingTool(d.kind)?.capabilities.includes("textInput")) { ev.stopPropagation(); ev.preventDefault(); openTextEditor(d.points[0], d); }
      else if (d && replayIdxRef.current == null && !d.locked) {
        ev.stopPropagation(); ev.preventDefault(); sel = d.id; renderDraw(); bar.classList.add("settings-open");
      }
    });
    svg.addEventListener("pointermove", (ev) => {
      positionCreationPalette(ev.clientX, ev.clientY);
      if (!pending) return;
      if (pending.pointerId != null && pending.pointerId !== ev.pointerId) return;
      const { x, y } = rectXY(ev); const p0 = pending;
      const angleOrigin = pending.mode === "drag"
        ? pending.points[0]
        : pending.mode === "multi" ? pending.points[pending.points.length - 1] : undefined;
      const b = constrainedSnap(angleOrigin, x, y, ev, { paneKey: pending.paneKey });
      if (pending.mode === "multi" || pending.mode === "point" || pending.mode === "text") pending.candidate = b;
      if (getDrawingTool(pending.kind)?.creation.anchorSpace === "pane") pending.meta = paneMetaAt(x, y, pending.meta);
      if (pending.mode === "freehand") {
        const last = pending.points[pending.points.length - 1], lx = xOf(last.t), ly = yOfIn(last.p, pending.paneKey);
        if (lx == null || ly == null || Math.hypot(x - lx, y - ly) >= 3.5) pending.points.push(b);
        if (pending.points.length > 64) pending.points.splice(1, 1);
      }
      const rawPreviewPoints = pending.mode === "freehand" ? [...pending.points]
        : pending.mode === "multi" ? [...pending.points, pending.candidate ?? b]
        : pending.mode === "point" || pending.mode === "text" ? [pending.candidate ?? b]
        : [pending.points[0], b];
      const previewPoints = materializePoints(pending.kind, rawPreviewPoints);
      // One retained preview per animation frame, plus OpenMarket-style placement guides
      // and an explicit halo whenever Weak/Strong magnet acquires an OHLC target.
      scheduleDraw(() => {
        const svgEl = svgRef.current; if (!svgEl || pending !== p0) return;
        const guides = mk("g", { "pointer-events": "none", opacity: .72 });
        guides.appendChild(mk("line", { x1: 0, y1: y, x2: el!.clientWidth, y2: y, stroke: "var(--muted)", "stroke-width": 1, "stroke-dasharray": "4 5", opacity: .48 }));
        guides.appendChild(mk("line", { x1: x, y1: 0, x2: x, y2: el!.clientHeight, stroke: "var(--muted)", "stroke-width": 1, "stroke-dasharray": "4 5", opacity: .48 }));
        if (snapTarget) {
          guides.appendChild(mk("circle", { cx: snapTarget.x, cy: snapTarget.y, r: 8, fill: "none", stroke: "var(--brand-2)", "stroke-width": 1.5, opacity: .9 }));
          guides.appendChild(mk("circle", { cx: snapTarget.x, cy: snapTarget.y, r: 2.5, fill: "var(--brand-2)" }));
        }
        svgEl.appendChild(guides);
        svgEl.appendChild(shape({ id: "_p", kind: p0.kind, points: previewPoints, ...applyStyle(p0.kind), ...(p0.meta ? { meta: p0.meta } : {}) }, true, xOf, (price) => yOfIn(price, p0.paneKey)));
      });
    });
    svg.addEventListener("pointerup", (ev) => {
      if (!pending) return;
      if (pending.pointerId != null && pending.pointerId !== ev.pointerId) return;
      creationPalette.style.pointerEvents = "auto";
      const { x, y } = rectXY(ev), current = pending;
      const angleOrigin = current.mode === "drag"
        ? current.points[0]
        : current.mode === "multi" ? current.points[current.points.length - 1] : undefined;
      const b = constrainedSnap(angleOrigin, x, y, ev, { paneKey: current.paneKey });
      try { if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId); } catch {}
      if (current.mode === "multi") {
        const previous = current.points[current.points.length - 1], px = previous ? xOf(previous.t) : null, py = previous ? yOfIn(previous.p, current.paneKey) : null;
        const repeatRadius = ev.pointerType === "touch" || matchMedia("(pointer:coarse)").matches ? 16 : 3;
        const repeatedAnchor = Boolean(previous && px != null && py != null && Math.hypot(x - px, y - py) <= repeatRadius);
        if (!repeatedAnchor) current.points.push(b);
        current.pointerId = undefined; current.candidate = undefined;
        const spec = getDrawingTool(current.kind);
        const required = spec?.creation.mode === "fixed-multi" && typeof spec.creation.pointCount === "number" ? spec.creation.pointCount : Infinity;
        const repeatedFinish = repeatedAnchor && spec?.creation.mode === "variable-multi" && current.points.length >= spec.creation.minPoints;
        if (current.points.length >= required || repeatedFinish || (spec?.creation.mode === "variable-multi" && current.points.length >= spec.creation.maxPoints)) {
          const points = [...current.points]; pending = null; commitDrawing(current.kind, points, undefined, current.activation, current.paneKey);
        } else renderDraw();
        return;
      }
      const currentMeta = getDrawingTool(current.kind)?.creation.anchorSpace === "pane" ? paneMetaAt(x, y, current.meta) : current.meta;
      if (current.mode === "text") { pending = null; openTextEditor(b, undefined, current.kind, [b], currentMeta, current.activation); renderDraw(); return; }
      if (current.mode === "point") {
        pending = null;
        if (current.kind === "emoji" || current.kind === "icon") openMediaChoicePicker(current.kind, b, x, y, current.activation);
        else commitDrawing(current.kind, [b], currentMeta, current.activation, current.paneKey);
        renderDraw(); return;
      }
      const maxPoints = getDrawingTool(current.kind)?.creation.maxPoints ?? 64;
      // Click-vs-drag is decided by the RAW pointer travel. Deriving it from the
      // projected anchors made a real drag read as a stationary click whenever
      // snapping collapsed both ends onto one point — inside the blank future
      // gutter (every anchor clamped to the last bar) or with the magnet holding
      // both ends on the same bar's OHLC. The gesture then armed click-then-click
      // placement instead of committing, which is the "line keeps following the
      // cursor after I let go" report.
      const clickSlop = ev.pointerType === "touch" || matchMedia("(pointer:coarse)").matches ? 8 : 3;
      const clicked = current.downX == null || current.downY == null
        ? false
        : Math.hypot(x - current.downX, y - current.downY) < clickSlop;
      // A stationary first click arms the documented click-then-click placement
      // mode. A normal drag continues to commit on the first pointerup.
      if (current.mode === "drag" && clicked && !current.awaitingSecond) {
        current.pointerId = undefined;
        current.candidate = b;
        current.awaitingSecond = true;
        renderDraw();
        return;
      }
      // The click that closes a click-then-click placement is stationary by
      // definition, so only a repeat press ON the first anchor stays pending.
      let end = b;
      if (current.mode === "drag" && !current.awaitingSecond) {
        // The pointer travelled but the anchors did not: let the endpoint escape
        // the magnet rather than commit an invisible zero-length object.
        const origin = current.points[0];
        if (origin && samePlacement(origin, end, current.paneKey)) end = constrainedSnap(origin, x, y, ev, { forceMagnet: "off", paneKey: current.paneKey });
      }
      const points = current.mode === "freehand" ? [...current.points, end].slice(0, maxPoints) : [current.points[0], end];
      const a = points[0], last = points[points.length - 1];
      // A brush loop legitimately ends where it started, so a freehand stroke is
      // judged by its whole extent instead of by its two endpoints.
      const degenerate = !a || !last || (current.mode === "freehand"
        ? points.length < 2 || strokeExtentPx(points, current.paneKey) < 3
        : samePlacement(a, last, current.paneKey));
      if (degenerate) { current.pointerId = undefined; current.candidate = end; renderDraw(); return; }
      pending = null;
      if (current.kind === "image") { openImageUpload(points, x, y, current.activation); renderDraw(); return; }
      if (getDrawingTool(current.kind)?.capabilities.includes("textInput")) {
        openTextEditor(last, undefined, current.kind, points, currentMeta, current.activation);
        renderDraw();
        return;
      }
      commitDrawing(current.kind, points, currentMeta, current.activation, current.paneKey); renderDraw();
    });
    svg.addEventListener("pointercancel", (ev) => {
      if (!pending || (pending.pointerId != null && pending.pointerId !== ev.pointerId)) return;
      creationPalette.style.pointerEvents = "auto";
      try { if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId); } catch {}
      if (pending.mode === "multi" && pending.points.length) {
        pending.pointerId = undefined; pending.candidate = undefined;
      } else pending = null;
      renderDraw();
    });

    // Precision shortcut: Shift+drag measures directly from the chart without first
    // opening the drawing rail. Capture on the chart wrapper because the drawing SVG
    // intentionally has pointer-events:none while no tool is armed.
    const onShiftMeasure = (ev: PointerEvent) => {
      if (drawingCreationDisabledRef.current || replayIdxRef.current != null || !ev.shiftKey || toolRef.current || !activeRef.current || ev.button !== 0) return;
      const startXY = rectXY(ev), a = snap(startXY.x, startXY.y, ev), measurePane = snapPaneKey;
      const activation = toolActivationRef.current;
      ev.preventDefault(); ev.stopPropagation();
      const move = (e: PointerEvent) => {
        const xy = rectXY(e), b = snap(xy.x, xy.y, e);
        scheduleDraw(() => {
          const svgEl = svgRef.current; if (!svgEl) return;
          svgEl.appendChild(shape({ id: "_measure", kind: "measure", points: [a, b], ...applyStyle("measure") }, true, xOf, (price) => yOfIn(price, measurePane)));
        });
      };
      const cleanupMeasure = () => {
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", cancel);
        if (dragCleanup === cleanupMeasure) dragCleanup = null;
        drawingTransactionRef.current = false;
      };
      const end = (e: PointerEvent) => {
        cleanupMeasure();
        const xy = rectXY(e), b = snap(xy.x, xy.y, e);
        if (!samePlacement(a, b, measurePane)) commitDrawing("measure", [a, b], undefined, activation, measurePane);
        else renderDraw();
      };
      const cancel = () => { cleanupMeasure(); renderDraw(); };
      drawingTransactionRef.current = true;
      dragCleanup = cleanupMeasure;
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", cancel);
    };
    wrap.addEventListener("pointerdown", onShiftMeasure, true);

    // Alt+<key> → drawing-tool code. Mirrors DrawingSidebar's advertised kbd chips (do NOT edit that
    // file — this is the receiving half). Alt+R was RESET-view but the sidebar advertises it as
    // Rectangle; it now selects Rectangle (as advertised) and reset moves to the double-Esc gesture +
    // the context-menu/toolbar. The tool is a CONTROLLED prop owned by TerminalShell.setTool, so
    // ChartPanel can't set it directly — it dispatches the established `mm:set-tool` window event
    // (same idiom as mm:set-tf / mm:open-pane). NOTE: this requires a matching listener in TerminalShell
    // (`mm:set-tool` → setTool) to take effect — see the lane summary.
    let lastEscTs = 0;
    let drawingClipboard: Drawing | null = null;
    onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase(); if (tag === "input" || tag === "textarea") return;
      // Portalled drawing menus own their first Escape. Window listeners share
      // one event target, so stopPropagation in the sidebar alone cannot keep a
      // later chart listener from also retiring the armed tool.
      if (e.key === "Escape" && document.querySelector("[data-menu-id]")) return;
      if (e.key === "Escape") {
        if (pending) { cancelPendingDrawingRef.current(); return; }
        if (toolRef.current) {
          lastEscTs = 0;
          try { window.dispatchEvent(new CustomEvent("mm:set-tool", { detail: null })); } catch {}
          return;
        }
        // Esc deselects; double-Esc (within 500ms) resets the chart view (the gesture that replaces the
        // former ⌥R — Alt+R is now the Rectangle tool as the sidebar advertises).
        const now = Date.now();
        if (now - lastEscTs < 500) { lastEscTs = 0; if (toolRef.current) { try { window.dispatchEvent(new CustomEvent("mm:set-tool", { detail: null })); } catch {} } normalizeChartView(); }
        else { lastEscTs = now; if (sel) { sel = null; renderDraw(); } }
      }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel && replayIdxRef.current == null) { e.preventDefault(); const s = sel; sel = null; onChangeRef.current?.(drawRef.current.filter((d) => d.id !== s)); }
      else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === "KeyZ" && replayIdxRef.current == null) {
        e.preventDefault();
        try { window.dispatchEvent(new CustomEvent("mm:drawing-history", { detail: e.shiftKey ? "redo" : "undo" })); } catch {}
      }
      else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === "KeyY" && replayIdxRef.current == null) {
        e.preventDefault();
        try { window.dispatchEvent(new CustomEvent("mm:drawing-history", { detail: "redo" })); } catch {}
      }
      else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === "KeyC" && sel) {
        const selected = drawRef.current.find((drawing) => drawing.id === sel);
        if (!selected) return;
        e.preventDefault();
        drawingClipboard = cloneDrawing(selected, "_drawing_clipboard");
      }
      else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === "KeyV" && drawingClipboard && replayIdxRef.current == null) {
        e.preventDefault();
        const source = drawingClipboard;
        const times = semanticTimes();
        const reference = source.points[0];
        const referenceY = reference ? yOf(reference.p) : null;
        const offsetPrice = referenceY == null
          ? 0
          : ((priceSeriesRef.current?.coordinateToPrice(referenceY + 10) as number | null) ?? reference.p) - reference.p;
        const points = translateDrawingAnchors(source, times, 2, offsetPrice, precRef.current);
        const copy = cloneDrawing(source, uid(), points);
        const paneAnchor = paneAnchorOf(source.meta);
        if (paneAnchor) {
          const nextAnchor = { x: clampUnit(paneAnchor.x + .025), y: clampUnit(paneAnchor.y + .025) };
          copy.meta = { ...(copy.meta ?? {}), paneAnchor: nextAnchor };
          copy.points[0] = snap(nextAnchor.x * el!.clientWidth, nextAnchor.y * el!.clientHeight);
        }
        copy.z = Math.max(drawRef.current.length, ...drawRef.current.map((drawing) => drawing.z ?? 0)) + 1;
        sel = copy.id;
        drawRef.current = [...drawRef.current, copy];
        onChangeRef.current?.([...drawRef.current]);
      }
      else if (sel && replayIdxRef.current == null && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        const selected = drawRef.current.find((drawing) => drawing.id === sel);
        if (!selected || selected.locked) return;
        e.preventDefault();
        const amount = e.shiftKey ? 10 : 1;
        const paneAnchor = paneAnchorOf(selected.meta);
        if (paneAnchor) {
          const dx = e.key === "ArrowLeft" ? -amount : e.key === "ArrowRight" ? amount : 0;
          const dy = e.key === "ArrowUp" ? -amount : e.key === "ArrowDown" ? amount : 0;
          const nextAnchor = {
            x: clampUnit(paneAnchor.x + dx / Math.max(1, el!.clientWidth)),
            y: clampUnit(paneAnchor.y + dy / Math.max(1, el!.clientHeight)),
          };
          const point = snap(nextAnchor.x * el!.clientWidth, nextAnchor.y * el!.clientHeight);
          drawRef.current = drawRef.current.map((drawing) => drawing.id === sel ? {
            ...drawing,
            points: drawing.points.map((existing, index) => index === 0 ? point : existing),
            meta: { ...(drawing.meta ?? {}), paneAnchor: nextAnchor },
          } : drawing);
        } else {
          const requestedBars = e.key === "ArrowLeft" ? -amount : e.key === "ArrowRight" ? amount : 0;
          const reference = selected.points[0];
          const referenceY = reference ? yOf(reference.p) : null;
          const targetY = referenceY == null ? null
            : referenceY + (e.key === "ArrowUp" ? -amount : e.key === "ArrowDown" ? amount : 0);
          const targetPrice = targetY == null ? reference?.p
            : (priceSeriesRef.current?.coordinateToPrice(targetY) as number | null) ?? reference?.p;
          const deltaPrice = requestedBars || reference == null || targetPrice == null ? 0 : targetPrice - reference.p;
          const points = translateDrawingAnchors(selected, semanticTimes(), requestedBars, deltaPrice, precRef.current);
          drawRef.current = drawRef.current.map((drawing) => drawing.id === sel ? { ...drawing, points } : drawing);
        }
        onChangeRef.current?.([...drawRef.current]);
      }
      // ⌥A = add alert at last bar close
      else if (e.altKey && e.code === "KeyA") { e.preventDefault(); const b = barsRef.current; if (b.length) onAddAlertRef.current?.(b[b.length - 1].c); }
      // ⌥T/H/V/R/X/M = select the advertised drawing tool (via mm:set-tool → TerminalShell.setTool)
      else {
        const shortcut = drawingToolFromShortcut(e);
        if (!shortcut) return;
        e.preventDefault();
        try { window.dispatchEvent(new CustomEvent("mm:set-tool", { detail: shortcut })); } catch {}
      }
    };
    window.addEventListener("keydown", onKey);

    // Container resize → resize the chart, preserving the visible range. Coalesced through rAF so a
    // window/splitter drag doesn't force a synchronous read(getVisibleLogicalRange) → write(resize) →
    // write(setVisibleLogicalRange) reflow on every RO callback; the read+writes now happen once per
    // frame after layout settles. The ResizeObserver entry carries the new box, avoiding a forced
    // clientWidth/Height layout read inside the callback.
    let resizeRaf: number | null = null; let pendW = 0, pendH = 0;
    ro = new ResizeObserver((entries) => {
      const e0 = entries[entries.length - 1];
      const cr = e0?.contentRect;
      pendW = cr ? Math.round(cr.width) : el.clientWidth;
      pendH = cr ? Math.round(cr.height) : el.clientHeight;
      if (resizeRaf != null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null; if (dead) return; const ch2 = chartRef.current; if (!ch2) return;
        const r = ch2.timeScale().getVisibleLogicalRange();
        ch2.resize(pendW, pendH);
        if (r) ch2.timeScale().setVisibleLogicalRange(r);
        scheduleRender(); scheduleMeasure();
      });
    });
    ro.observe(el);

    // ── mount teardown (base line-416 logic + the new refs) ──
    return () => {
      dead = true; if (rafId != null) cancelAnimationFrame(rafId); if (measRaf != null) cancelAnimationFrame(measRaf);
      try { chart.unsubscribeCrosshairMove(onTagCrosshair); } catch {}
      if (drawRaf != null) cancelAnimationFrame(drawRaf); if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
      if (pineLiveTimerRef.current != null) { clearTimeout(pineLiveTimerRef.current); pineLiveTimerRef.current = null; }
      if (pineHostRef.current) { try { pineHostRef.current.dispose(); } catch {} pineHostRef.current = null; }
      if (syncCleanupRef.current) { try { syncCleanupRef.current(); } catch {} syncCleanupRef.current = null; }
      if (dragCleanup) dragCleanup();
      drawingTransactionRef.current = false;
      window.removeEventListener("mm:snapshot", snapshot);
      if (process.env.NODE_ENV !== "production") { try { delete (window as any).__mmChartSeriesTitles; delete (window as any).__mmChartAxisOpts; delete (window as any).__mmCrosshairDodge; delete (window as any).__mmPriceLabels; delete (window as any).__mmPaneMaximized; } catch {} }
      if (onKey) window.removeEventListener("keydown", onKey);
      if (winDown) window.removeEventListener("pointerdown", winDown);
      window.removeEventListener("pointerup", onProjectionPointerEnd);
      window.removeEventListener("pointercancel", onProjectionPointerEnd);
      const wEl = wrapElRef.current;
      if (onCtx && ref.current?.parentElement) ref.current.parentElement.removeEventListener("contextmenu", onCtx);
      if (wEl) { if (onPaneMove) wEl.removeEventListener("mousemove", onPaneMove); if (onPaneLeave) wEl.removeEventListener("mouseleave", onPaneLeave); if (onPaneDbl) wEl.removeEventListener("dblclick", onPaneDbl); wEl.removeEventListener("pointerdown", onProjectionPointerDown, true); wEl.removeEventListener("pointerdown", onTouchDown); wEl.removeEventListener("pointerdown", onShiftMeasure, true); wEl.removeEventListener("wheel", onAxisWheel, true); wEl.removeEventListener("dblclick", onAxisDbl); wEl.removeEventListener("pointerenter", onScrubEnter); wEl.removeEventListener("pointermove", onScrubEnter); wEl.removeEventListener("pointerdown", onScrubEnter); wEl.removeEventListener("pointerleave", onScrubLeave); wEl.removeEventListener("pointercancel", onScrubLeave);
        if (onSigHover) wEl.removeEventListener("pointermove", onSigHover); if (onSigDown) wEl.removeEventListener("pointerdown", onSigDown); if (onSigUp) wEl.removeEventListener("pointerup", onSigUp); if (onSigCancel) wEl.removeEventListener("pointercancel", onSigCancel); if (onSigLeave) wEl.removeEventListener("pointerleave", onSigLeave); }
      mqlMobile?.removeEventListener("change", onMqlChange);
      paneRO?.disconnect(); paneRORef.current = null; wrapElRef.current = null;
      ro?.disconnect();
      if (textEditRef.current) { try { textEditRef.current.remove(); } catch {} textEditRef.current = null; }
      if (ctxRef.current) { try { ctxRef.current.remove(); } catch {} ctxRef.current = null; }
      if (emptyRef.current) { try { emptyRef.current.remove(); } catch {} emptyRef.current = null; }
      if (barRef.current) { try { barRef.current.remove(); } catch {} barRef.current = null; }
      if (creationPaletteRef.current) { try { creationPaletteRef.current.remove(); } catch {} creationPaletteRef.current = null; }
      hideBarTip();
      window.removeEventListener("resize", hideBarTip);
      document.removeEventListener("scroll", hideBarTip, true);
      try { barTip.remove(); } catch {}
      if (indSvgRef.current) { try { indSvgRef.current.remove(); } catch {} indSvgRef.current = null; }
      suiteTablesRef.current = [];
      if (sigRef.current) { try { sigRef.current.remove(); } catch {} sigRef.current = null; }
      if (svgRef.current) { try { svgRef.current.remove(); } catch {} svgRef.current = null; }
      closeMediaSurface(false);
      cancelPendingDrawingRef.current = () => {};
      cancelMediaToolRef.current = () => {};
      clearDrawingSelectionRef.current = () => {};
      if (tagTimerRef.current != null) { clearInterval(tagTimerRef.current); tagTimerRef.current = null; }
      if (priceTagRef.current) { try { priceTagRef.current.remove(); } catch {} priceTagRef.current = null; }
      if (extendedTagRef.current) { try { extendedTagRef.current.remove(); } catch {} extendedTagRef.current = null; }
      if (hoverTagRef.current) { try { hoverTagRef.current.remove(); } catch {} hoverTagRef.current = null; }
      if (sigTip) { try { sigTip.remove(); } catch {} sigTip = null; }
      sigHits = null; sigPointerDown = null; sigTipPinned = false;
      renderTagRef.current = null;
      renderHoverTagRef.current = null;
      // DT teardown: countdown chip + shading primitive
      if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
      if (countdownChipRef.current) { try { countdownChipRef.current.remove(); } catch {} countdownChipRef.current = null; }
      if (shadingPrimRef.current && priceSeriesRef.current) { try { detachSessionShading(priceSeriesRef.current, shadingPrimRef.current); } catch {} shadingPrimRef.current = null; }
      clearExtendedPriceLine();
      indPriceLinesRef.current = new Map();
      indSeriesRef.current.clear(); cmpSeriesRef.current.clear(); paneMapRef.current.clear();
      pineSeriesRef.current.clear(); pineMarkersRef.current.clear(); pinePaneMapRef.current.clear(); pineErrRef.current.clear(); pineCacheRef.current.clear(); pineAstRef.current.clear();
      priceSeriesRef.current = null; priceFamilyRef.current = null;
      futureAxisRef.current = null;   // the engine disposes every series with the chart
      watermarkPluginRef.current = null;   // plugin is attached to a pane; engine.destroy() tears it down
      // The engine owns disposal (its destroy() is the one chart.remove() call); chartRef
      // was only ever the unwrap bridge, so it just drops.
      if (engineRef.current) { try { engineRef.current.destroy(); } catch {} engineRef.current = null; }
      chartRef.current = null;
    };
  }, []); // eslint-disable-line

  // ────────────────────────────────────────────────────────────────────────────
  // EFFECT 2 — data [symbol, effectiveTimeframe, chartType]. Fetch + full series + indicators + sync.
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current; if (!chart) return;
    cpMark(`chart-effect2-start[${symbol}@${effectiveTimeframe}]`);
    liveTickKeyRef.current = "";
    const liveWrap = wrapElRef.current;
    if (liveWrap) {
      delete liveWrap.dataset.liveDirection;
      delete liveWrap.dataset.liveKind;
      delete liveWrap.dataset.livePulse;
      delete liveWrap.dataset.livePrice;
      delete liveWrap.dataset.liveRevision;
      delete liveWrap.dataset.liveOpen;
      delete liveWrap.dataset.liveHigh;
      delete liveWrap.dataset.liveLow;
      delete liveWrap.dataset.liveClose;
      delete liveWrap.dataset.liveTime;
      liveWrap.style.removeProperty("--mm-live-y");
      liveWrap.style.removeProperty("--mm-live-color");
    }
    const epoch = ++epochRef.current;
    visualReadyRef.current?.cancel();
    visualReadyRef.current = null;
    builtIndicatorRef.current = null;
    let cancelled = false;
    let generationReady: TerminalVisualReadyAnnouncement | null = null;
    const announceVisualReady = (state: "data" | "empty") => {
      generationReady?.cancel();
      generationReady = announceTerminalVisualReady(symbol, state, {
        timeframe: effectiveTimeframe,
        generation: epoch,
        isCurrent: () => !cancelled && epochRef.current === epoch,
        ...(state === "data" ? {
          isReady: () => isTerminalIndicatorSetBuilt(
            dataReadyRef.current,
            epoch,
            indicatorSetKey(indicatorsRef.current),
            builtIndicatorRef.current,
          ),
          // LWC's setData/build calls update its model synchronously, but the first coordinate map is
          // established by its next canvas frame. Re-project the dependent SVG/DOM layers in that
          // frame, then terminalBoot releases consumers only on the following frame.
          renderVisuals: () => {
            renderSignalsRef.current();
            renderRef.current();
            measureRef.current();
          },
          isRendered: () => {
            const last = barsRef.current[barsRef.current.length - 1];
            const series = priceSeriesRef.current;
            if (!last || !series || !chartRef.current) return false;
            try {
              return series.priceToCoordinate(last.c) != null
                && chartRef.current.timeScale().timeToCoordinate(last.time) != null;
            } catch {
              return false;
            }
          },
        } : {}),
      });
      visualReadyRef.current = generationReady;
    };
    const intraday = isIntradayTf(effectiveTimeframe);
    // crossing the intraday↔daily boundary changes the TIME TYPE of every series (numeric epoch vs
    // 'YYYY-MM-DD') — in-place setData updates across it are unsound (LWC one-time-type law) and the
    // DT intraday-only indicators + legend notes need a full rebuild. Force the rebuild path then.
    const crossedIntradayBoundary = isIntradayRef.current !== intraday;
    isIntradayRef.current = intraday;
    // any in-flight pulse belongs to the prior symbol/TF — cancel it (R14 timer cleanup guard)
    if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); highlightTimerRef.current = null; }
    (async () => {
      // ── R12 intraday branch: fetch /api/intraday DIRECTLY (no dataCache — it's no-store; a stale
      //    client cache would lag a fast session). Epoch-second axis. Skip resampleTf + date-keyed
      //    signal/compare overlays (those are "YYYY-MM-DD" keyed). Indicators are bar-agnostic → kept. ──
      if (intraday) {
        let bars: any[] = [];
        let feedErr: string | null = null;       // the route's j.error (route returns {bars:[],error} on an upstream/config failure)
        try {
          const r = await fetch(`/api/intraday?sym=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(effectiveTimeframe)}&ext=${extHours ? "1" : "0"}`, { cache: "no-store" });
          const j = await r.json().catch(() => null);
          bars = Array.isArray(j?.bars) ? j.bars : [];
          if (!r.ok || j?.error) feedErr = String(j?.error || `HTTP ${r.status}`);
        } catch (e: any) { feedErr = e?.message || "network error"; }
        if (cancelled || epochRef.current !== epoch) return;
        sliceRef.current = null;                 // no daily slice on intraday → no sig marks
        sigMarksRef.current = [];
        earlyDotsRef.current = []; warnMarksRef.current = [];   // GC v2 side channels: daily-only too
        dailyBarsRef.current = [];               // splice is daily-only; disable it here
        if (!bars.length) {
          clearChartData();   // never leave the previous symbol's series under this symbol's badge
          // Differentiate a feed/entitlement/config failure ("POLYGON_API_KEY not set", "polygon 403",
          // "unauthenticated", …) from a genuinely-empty symbol. Both dead-end the intraday chart, so
          // surface a "Back to Daily" affordance instead of a blank chart.
          const unavailable = feedErr != null;
          if (statusRef.current) statusRef.current.textContent = unavailable ? "Intraday feed unavailable." : "No intraday data for this symbol.";
          showEmptyRef.current(unavailable
            ? `Intraday feed unavailable for ${symbol} on ${effectiveTimeframe}. Switch back to the daily timeframe to keep charting.`
            : `No intraday data for ${symbol} on ${effectiveTimeframe}. Switch back to the daily timeframe to keep charting.`);
          announceVisualReady("empty");
          return;
        }
        hideEmptyRef.current();                   // data arrived → clear any prior dead-end overlay
        chart.applyOptions({ timeScale: { timeVisible: true, secondsVisible: isSecondTf(effectiveTimeframe) } });
        // epoch-second Bar6 [t,o,h,l,c,v] → Bar with a NUMERIC time (lightweight-charts accepts UTCTimestamp)
        const rows: Bar[] = bars.map((b: any[]) => ({ time: b[0] as any, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }));
        if (onMeta) onMeta({ total: rows.length });
        fullBarsRef.current = rows;
        const ri = replayIdxRef.current;
        const onChart = ri != null ? rows.slice(0, Math.max(20, ri + 1)) : rows;
        barsRef.current = onChart;
        const closes = onChart.map((r) => r.c);
        closesRef.current = closes;
        precRef.current = closes.length && closes[closes.length - 1] < 10 ? 4 : 2;
        tokensRef.current = readTokens();
        // Prefetch daily OHLC for slevels/pivots (fire-and-forget; miss is graceful — empty daily = no lines).
        // Also used by DayStatsStrip for gap% and range-used% computations.
        // Only re-fetch when the symbol changed or cache is empty. Uses the same getOhlc cache path as daily branch.
        if (dailyCacheRef.current?.sym !== symbol) {
          getOhlc(symbol).then((ohlc: any) => {
            if (cancelled || epochRef.current !== epoch) return;
            const rawBars: DailyBar[] = Array.isArray(ohlc?.bars)
              ? ohlc.bars.map((b: any[]) => ({ time: b[0] as string, h: b[2] as number, l: b[3] as number, c: b[4] as number }))
              : [];
            dailyCacheRef.current = { sym: symbol, bars: rawBars };
            // Update strip daily bars now that cache is available
            if (dayModeRef.current) setStripDailyBars(rawBars);
            // First-load race: buildAllIndicators already ran with an EMPTY daily cache, so slevels/
            // pivots drew nothing. Both builders are idempotent (each clears its own price-line pool
            // and creates no LWC series) — re-run them directly now that daily bars exist.
            if (rawBars.length && isIntradayRef.current) {
              try { if (indicatorsRef.current.has("slevels")) buildSlevels(onChart); } catch {}
              try { if (indicatorsRef.current.has("pivots")) buildPivots(onChart); } catch {}
              // The builders create lines visible — re-assert the eye or a hidden
              // slevels/pivots silently resurrects (the pooled-line eye is real now).
              try { applyHidden(); } catch {}
            }
          }).catch(() => { /* silent — slevels/pivots will render with empty history */ });
        }
        const wantFamily = priceSeriesFamily(chartType);
        let priceS = priceSeriesRef.current;
        if (!priceS || priceFamilyRef.current !== wantFamily) {
          if (priceS) { clearExtendedPriceLine(); try { chart.removeSeries(priceS); } catch {} }
          priceS = addPriceSeries(chart, tokensRef.current);
          priceFamilyRef.current = wantFamily;
          priceSeriesRef.current = priceS;
        } else { priceS.applyOptions({ priceFormat: priceFmt() }); }
        if (chartType === "baseline" && onChart.length) priceS!.applyOptions({ baseValue: { type: "price", price: onChart[0].c } });
        priceS!.setData(priceData(onChart) as any);
        applyFutureAxis();   // future dates on the time axis follow the loaded bars
        cpMark(`chart-painted[${symbol}@${effectiveTimeframe}:intraday]`);
        chartDataSymRef.current = symbol;
        clearAllIndicators();
        buildAllIndicators(onChart, closes);
        buildIndDataMap(onChart, closes);
        // compare overlays are cross-market date-string joins → skip on intraday; drop any stale ones
        for (const s of cmpSeriesRef.current.values()) { try { chart.removeSeries(s); } catch {} }
        cmpSeriesRef.current.clear();
        paintStatus(onChart, null);
        applyView(onChart, ri);
        // DayStatsStrip: update bar state so the strip re-renders with current data
        if (dayModeRef.current) {
          setStripBars([...onChart]);
          setStripDailyBars(dailyCacheRef.current?.sym === symbol ? [...dailyCacheRef.current.bars] : []);
        }
        renderSignalsRef.current(); renderRef.current();
        reRegisterSync();
        // A quote can win the race while the REST window is loading. Apply it only after setData so
        // the streamed candle is not immediately erased by the initial payload.
        applyLiveSplice();
        announceVisualReady("data");
        return;
      }

      // daily branch: clear any intraday dead-end overlay + reset the axis to date-only labels (the
      // intraday branch flips timeVisible on; a persistent chart carries that across a TF switch).
      hideEmptyRef.current();
      chart.applyOptions({ timeScale: { timeVisible: false, secondsVisible: false } });

      // ── PERF-FIX (b): clear the resample cache on symbol change so stale entries don't survive ──
      const symbolChanged = symbol !== prevSymbolRef.current;
      if (symbolChanged) { clearResampleCache(prevSymbolRef.current); prevSymbolRef.current = symbol; }
      cpMark(`ohlc-fetch-start[${symbol}]`);

      // ── F2 composite branch: fetch each leg and sum; no slice (no Oracle signal for baskets) ──
      const compositeLegs = parseComposite(symbol);
      let daily: Bar[];
      if (compositeLegs) {
        const legOhlcs = await getCompositeOhlc(compositeLegs);
        if (cancelled || epochRef.current !== epoch) return;
        const legBars = legOhlcs.map((o: any) =>
          o?.bars?.length ? (o.bars as any[][]).map((b) => ({ time: b[0] as string, o: b[1] as number, h: b[2] as number, l: b[3] as number, c: b[4] as number, v: b[5] as number })) : []
        );
        const summed = alignAndSum(legBars);
        if (!summed.length) {
          clearChartData();
          if (statusRef.current) statusRef.current.textContent = "No shared data for composite.";
          showEmptyRef.current(`No overlapping data for ${symbol}. Its legs share no common dates.`, null);
          announceVisualReady("empty");
          return;
        }
        daily = summed;
        sliceRef.current = null;
      } else {
        const { ohlc, slice } = await getSliceAndOhlc(symbol);
        cpMark(`ohlc-fetch-done[${symbol}]`);
        if (cancelled || epochRef.current !== epoch) return;
        sliceRef.current = slice;   // authoritative slice for replay sig-mark re-resolution (Effect 4)
        if (!ohlc?.bars?.length) {
          clearChartData();
          if (statusRef.current) statusRef.current.textContent = "No data for this symbol.";
          showEmptyRef.current(`No daily history for ${symbol} yet.`, null);
          announceVisualReady("empty");
          return;
        }
        daily = ohlc.bars.map((b: any[]) => ({ time: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }));
      }
      dailyBarsRef.current = daily;         // raw daily source — the R11 splice operates on THIS
      // ── PERF-FIX (b): use cached resample; same-symbol TF switches skip the O(N) bucketing pass ──
      let rows: Bar[] = resampleTfCached(daily, effectiveTimeframe, symbol);
      if (onMeta) onMeta({ total: rows.length });
      fullBarsRef.current = rows;
      // Read the LIVE replayIdx (not the effect's closure): if the user started replay while this
      // fetch was in flight, Effect 4 bailed (fullBarsRef was empty) and would NOT re-slice — so we
      // must honor the current replayIdx here or the chart stays stuck on the full series.
      const ri = replayIdxRef.current;
      const onChart = ri != null ? rows.slice(0, Math.max(20, ri + 1)) : rows;
      barsRef.current = onChart;
      const closes = onChart.map((r) => r.c);
      closesRef.current = closes;
      precRef.current = closes.length && closes[closes.length - 1] < 10 ? 4 : 2;
      tokensRef.current = readTokens();

      // ── Lab signal markers (TLT-R4): fetch tech events from cached intel when _lab active ──
      // Fire-and-forget: does NOT block chart render. On 404/absent the ref stays empty.
      // Cap at LAB_MARKER_CAP most-recent fire-days to keep renderSignals responsive.
      labMarkersRef.current = new Map();   // reset on each symbol/data reload
      if (indicatorsRef.current.has("_lab")) {
        getJSON(`/data/${symbol}.intel.json`).then((intelPayload: any) => {
          if (cancelled || epochRef.current !== epoch) return;
          const signals = intelPayload?.tech?.events?.signals;
          if (!signals || typeof signals !== "object") return;
          const profiles = intelPayload?.tech?.profiles ?? {};
          // Collect all fire dates across all signals, accumulate per date.
          const dateMap = new Map<string, { name: string; dir: number }[]>();
          for (const [sigId, state] of Object.entries(signals) as [string, any][]) {
            const fires: string[] = Array.isArray(state?.fires) ? state.fires : [];
            const dir: number = typeof state?.dir === "number" ? state.dir : 0;
            const displayName: string = profiles?.[sigId]?.display_en ?? sigId;
            for (const d of fires) {
              if (typeof d !== "string") continue;
              const arr = dateMap.get(d) ?? [];
              arr.push({ name: displayName, dir });
              dateMap.set(d, arr);
            }
          }
          // Keep only the LAB_MARKER_CAP most recent dates.
          const sortedDates = Array.from(dateMap.keys()).sort();
          const capDates = sortedDates.slice(-LAB_MARKER_CAP);
          const capped = new Map<string, { name: string; dir: number }[]>();
          for (const d of capDates) capped.set(d, dateMap.get(d)!);
          labMarkersRef.current = capped;
          renderSignalsRef.current();   // re-render markers now that data is ready
        }).catch(() => { /* ignore — lab data unavailable */ });
      }

      // ── price series: incremental setData if the type matches, else remove + re-add ──
      const wantFamily = priceSeriesFamily(chartType);
      let priceS = priceSeriesRef.current;
      if (!priceS || priceFamilyRef.current !== wantFamily) {
        if (priceS) { clearExtendedPriceLine(); try { chart.removeSeries(priceS); } catch {} }
        priceS = addPriceSeries(chart, tokensRef.current);
        priceFamilyRef.current = wantFamily;
        priceSeriesRef.current = priceS;
      } else {
        priceS.applyOptions({ priceFormat: priceFmt() });
      }
      if (chartType === "baseline" && onChart.length) priceS!.applyOptions({ baseValue: { type: "price", price: onChart[0].c } });
      priceS!.setData(priceData(onChart) as any);
      applyFutureAxis();   // future dates on the time axis follow the loaded bars
      cpMark(`chart-painted[${symbol}@${effectiveTimeframe}:daily]`);   // first candle on canvas
      chartDataSymRef.current = symbol;
      // ── PERF-FIX (a): indicators — on same-symbol TF/chartType switch, update series data in-place
      //    (setData only, no removeSeries/addSeries lifecycle). On symbol change, do a full rebuild. ──
      // updateAllIndicators() only re-setData's these keys; every other DT-suite indicator
      // (ichimoku/ribbon/supertrend/avwap/vprofile/volbox/rsistack/accum/rvol/ttmsq/adx/cvd)
      // would strand on the PREVIOUS timeframe's data if we took the in-place path. So only
      // take it when EVERY active indicator is in-place-updatable; otherwise full rebuild.
      const INPLACE_KEYS = new Set(["ema", "bb", "vwap", "vol", "stochrsi", "rsi", "macd"]);
      const allInPlaceable = [...indicatorsRef.current].every((k) => INPLACE_KEYS.has(k));
      const canUpdateInPlace = !symbolChanged && !crossedIntradayBoundary && indSeriesRef.current.size > 0 && allInPlaceable;
      if (canUpdateInPlace) {
        updateAllIndicators(onChart, closes);
        // updateAllIndicators only touches the built-in series registry (indSeriesRef); Pine scripts are
        // tracked separately and are date-keyed, so a same-symbol TF switch must still rebuild them onto
        // the new bars — mirror the full-rebuild path (buildAllIndicators) so an active Pine overlay
        // doesn't strand at the previous timeframe's data.
        clearAllPine();
        if (!isIntradayRef.current) buildAllPine(onChart);
      } else {
        clearAllIndicators();
        buildAllIndicators(onChart, closes);
      }
      builtIndicatorRef.current = { generation: epoch, key: indicatorSetKey(indicatorsRef.current) };
      buildIndDataMap(onChart, closes);

      // ── compare overlays ──
      await rebuildCompare(onChart, epoch);
      if (cancelled || epochRef.current !== epoch) return;

      // ── signal marks, status, verdict, view ──
      // sliceRef.current is null for composites (no Oracle signal) — functions guard on null slice.
      sigMarksRef.current = resolveSigMarks(sliceRef.current, onChart);
      { const sc = resolveSideChannels(sliceRef.current, onChart); earlyDotsRef.current = sc.dots; warnMarksRef.current = sc.warns; }
      paintStatus(onChart, sliceRef.current);
      applyView(onChart, ri);

      renderSignalsRef.current(); renderRef.current();

      // ── cross-pane sync: register in the TAIL of Effect 2 (after series + bars exist, §Effect 6) ──
      reRegisterSync();

      // ── R11: re-apply the live splice AFTER setData (which erased any prior splice). No-op under
      //    replay / EOD basis / intraday (guarded inside). Runs last so status + sig marks agree. ──
      applyLiveSplice();
      applyExtendedPriceLine();
      announceVisualReady("data");
    })();
    return () => {
      cancelled = true;
      generationReady?.cancel();
      if (visualReadyRef.current === generationReady) visualReadyRef.current = null;
    };
    // eslint-disable-next-line
  }, [symbol, effectiveTimeframe, chartType, extHours]);

  // Register (or re-register) this pane with paneSync. Cleans up any prior registration first.
  const reRegisterSync = () => {
    if (syncCleanupRef.current) { try { syncCleanupRef.current(); } catch {} syncCleanupRef.current = null; }
    const chart = chartRef.current, priceS = priceSeriesRef.current, syncId = syncIdRef.current;
    if (syncId == null || !chart || !priceS) return;
    const closeByTime = new Map(barsRef.current.map((r) => [r.time, r.c]));
    const cleanup = registerPane(syncId, {
      chart, series: priceS, valueAt: (tm: any) => closeByTime.get(tm as any) ?? null, tf: timeframeRef.current,
      // A mirrored crosshair draws with no crosshairMove event behind it. Feed the independent
      // foreground DOM label directly while keeping both persistent badges untouched.
      onCrosshair: (price, time) => {
        const series = priceSeriesRef.current;
        let y = price == null || !series ? null : (series.priceToCoordinate(price) as number | null);
        let snappedPrice = price;
        if (series && y != null && time != null && chartSettingsRef.current.crosshairMode === 1) {
          const index = barIdxMap().get(time as any) ?? barIdxMap().get(String(time));
          let nearestY: number | null = null;
          let nearestDistance = Infinity;
          let candidates: ISeriesApi<any>[] = [];
          try { candidates = series.getPane()?.getSeries() as ISeriesApi<any>[] ?? []; } catch {}
          for (const candidate of candidates) {
            try {
              if (index == null || candidate.options()?.visible === false || candidate.getPane()?.paneIndex() !== series.getPane()?.paneIndex()) continue;
              const scaleId = candidate.options()?.priceScaleId;
              if (scaleId && scaleId !== "left" && scaleId !== "right") continue;
              const datum = candidate.dataByIndex(index) as any;
              const value = Number.isFinite(datum?.close) ? datum.close : Number.isFinite(datum?.value) ? datum.value : null;
              if (value == null) continue;
              const candidateY = candidate.priceToCoordinate(value) as number | null;
              if (candidateY == null || !Number.isFinite(candidateY)) continue;
              const distance = Math.abs(candidateY - y);
              if (distance < nearestDistance) { nearestDistance = distance; nearestY = candidateY; }
            } catch {}
          }
          if (nearestY != null) {
            y = nearestY;
            const converted = series.coordinateToPrice(nearestY) as number | null;
            if (converted != null && Number.isFinite(converted)) snappedPrice = converted;
          }
        }
        crossLabelYRef.current = y != null && Number.isFinite(y) ? y : null;
        renderHoverTagRef.current?.(crossLabelYRef.current, snappedPrice);
      },
    });
    // v5 subscribe* return void; unsubscribe by passing the SAME handler reference back.
    const onCross = (p: any) => { broadcastCrosshair(syncId, (p.time ?? null) as any); };
    const onRange = (r: any) => { broadcastRange(syncId, r as any); };
    chart.subscribeCrosshairMove(onCross);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    syncCleanupRef.current = () => {
      try { cleanup && cleanup(); } catch {}
      try { chart.unsubscribeCrosshairMove(onCross); } catch {}
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); } catch {}
    };
  };

  // ────────────────────────────────────────────────────────────────────────────
  // EFFECT 3 — indicators [indKey]. Incremental add/remove or bounded sub-pane rebuild.
  // ────────────────────────────────────────────────────────────────────────────
  const indKey = indicatorSetKey(indicators);
  useEffect(() => {
    const chart = chartRef.current; if (!chart) return;
    if (!barsRef.current.length) return;   // no data yet — Effect 2 will build the initial set
    const rows = barsRef.current, closes = closesRef.current;
    // snapshot the visible range so a view-preserving toggle can restore it after series churn (§0.4)
    viewSavedRef.current = PRESERVE_VIEW_ON_INDICATOR_TOGGLE ? (() => { try { const r = chart.timeScale().getVisibleLogicalRange(); return r ? { from: r.from as number, to: r.to as number } : null; } catch { return null; } })() : null;

    const OVERLAY_KEYS = ["ema", "bb", "vwap", "vol", "ichimoku", "ribbon", "supertrend", "avwap", "rvwap", "wvwap", "vprofile", "volbox", "svwap", "orb", "slevels", "pivots", "optlevels"] as const;
    const wantOverlays = new Set<string>(OVERLAY_KEYS.filter((k) => indicators.has(k)));
    const haveOverlays = new Set<string>(OVERLAY_KEYS.filter((k) => indSeriesRef.current.has(k) || indOverlayRef.current[k]));
    const wantSub = activeSubpanes();                                   // canonical-order sub-pane keys
    const haveSub: string[] = [...SUBPANE_ORDER, ...paneSuiteKeys()].filter((k) => indSeriesRef.current.has(k)); // current sub-panes in canonical order

    // ── overlays: always incremental (all live in pane 0, no reindex risk) ──
    for (const k of haveOverlays) if (!wantOverlays.has(k)) {
      const arr = indSeriesRef.current.get(k) || []; for (const s of arr) { try { chart.removeSeries(s); } catch {} } indSeriesRef.current.delete(k);
      delete indOverlayRef.current[k];
      // Restore candle colors when ribbon is removed
      if (k === "ribbon") restoreNormalCandleColors(rows);
      // Remove ONLY this indicator's price lines (keyed pool — the others keep their lines).
      if (k === "slevels" || k === "pivots" || k === "optlevels") removeIndPriceLines(k);
    }
    for (const k of wantOverlays) if (!haveOverlays.has(k)) {
      if (k === "ema") indSeriesRef.current.set("ema", buildEma(chart, rows, closes));
      else if (k === "bb") indSeriesRef.current.set("bb", buildBb(chart, rows, closes));
      else if (k === "vwap") indSeriesRef.current.set("vwap", buildVwap(chart, rows));
      else if (k === "vol") indSeriesRef.current.set("vol", buildVol(chart, rows));
      else if (k === "ichimoku") indSeriesRef.current.set("ichimoku", buildIchimoku(chart, rows));
      else if (k === "ribbon") indSeriesRef.current.set("ribbon", buildRibbon(chart, rows, closes));
      else if (k === "supertrend") indSeriesRef.current.set("supertrend", buildSupertrend(chart, rows));
      else if (k === "avwap") indSeriesRef.current.set("avwap", buildAvwap(chart, rows));
      else if (k === "rvwap") indSeriesRef.current.set("rvwap", buildRvwap(chart, rows));
      else if (k === "wvwap") indSeriesRef.current.set("wvwap", buildWvwap(chart, rows));
      else if (k === "vprofile") indSeriesRef.current.set("vprofile", buildVprofile(rows));
      else if (k === "volbox") indSeriesRef.current.set("volbox", buildVolbox(rows));
      else if (k === "svwap") indSeriesRef.current.set("svwap", buildSvwap(chart, rows));
      else if (k === "orb") indSeriesRef.current.set("orb", buildOrb(rows));
      else if (k === "slevels") indSeriesRef.current.set("slevels", buildSlevels(rows));
      else if (k === "pivots") indSeriesRef.current.set("pivots", buildPivots(rows));
      else if (k === "optlevels") indSeriesRef.current.set("optlevels", buildOptLevels());
    }

    // ── sub-pane topology decision (§pane-topology decision table) ──
    // Compute whether the sub-pane change is a pure tail-append / highest-removal (incremental)
    // or forces reindexing a higher pane / inserting between (→ bounded rebuild).
    const removed = haveSub.filter((k) => !wantSub.includes(k));
    const added = wantSub.filter((k) => !haveSub.includes(k));

    let needBoundedRebuild = false;
    // an ADD that is not strictly at the tail (its canonical position lands before an existing sub-pane) → insert-between
    for (const a of added) {
      const wIdx = wantSub.indexOf(a);
      // if any sub-pane that already exists sits AFTER this new one in canonical order → we'd insert between
      if (wantSub.slice(wIdx + 1).some((k) => haveSub.includes(k))) { needBoundedRebuild = true; break; }
    }
    // a REMOVE that is not the highest existing sub-pane → reindex a higher pane
    if (!needBoundedRebuild) for (const r of removed) {
      const hIdx = haveSub.indexOf(r);
      if (haveSub.slice(hIdx + 1).length > 0) { needBoundedRebuild = true; break; }   // something exists above it
    }

    if (needBoundedRebuild) {
      // FULL SUB-PANE REBUILD: remove every indicator series (price/compare/drawings/sync survive),
      // re-add all requested indicators in canonical order → paneMapRef rebuilt cleanly.
      rebuildIndicators();
    } else {
      // ── incremental sub-pane edits ──
      // removals (highest sub-pane only, by the guard above)
      for (const r of removed) {
        if (r === "ttmsq" && ttmsqMarkersRef.current) { try { ttmsqMarkersRef.current.detach(); } catch {} ttmsqMarkersRef.current = null; }
        if (r === "macd" && macdMarkersRef.current) { try { macdMarkersRef.current.detach(); } catch {} macdMarkersRef.current = null; }
        const arr = indSeriesRef.current.get(r) || []; for (const s of arr) { try { chart.removeSeries(s); } catch {} } indSeriesRef.current.delete(r); paneMapRef.current.delete(r);
      }
      // additions (tail append, by the guard above) — assign the next free pane index
      for (const a of added) {
        const pane = nextFreePane();
        let series: ISeriesApi<any>[] = [];
        if (a === "rsi") series = buildRsiPane(chart, rows, closes, pane);
        else if (a === "stochrsi") series = buildStochRsiPane(chart, rows, closes, pane);
        else if (a === "macd") series = buildMacd(chart, rows, closes, pane);
        else if (a === "rsistack") series = buildRsiStack(chart, rows, pane);
        else if (a === "accum") series = buildAccum(chart, rows, pane);
        else if (a === "rvol") series = buildRvol(chart, rows, pane);
        else if (a === "ttmsq") series = buildTtmsq(chart, rows, pane);
        else if (a === "adx") series = buildAdx(chart, rows, pane);
        else if (a === "cvd") series = buildCvd(chart, rows, pane);
        else if (isSuiteKeyReg(a)) series = buildSuitePane(chart, rows, a, pane);
        series = keepIndicatorPaneAxisLabelsOnly(series);
        indSeriesRef.current.set(a, series);
        // Claim the pane ONLY when the builder rendered ≥1 series: rvol/cvd return [] on daily, and a phantom
        // paneMapRef entry would both desync the next add's nextFreePane() index (splitting a later builder,
        // as in buildAllIndicators) and mis-seat pine sub-panes below (buildAllPine reads paneMapRef). Record
        // the ACTUAL landed index (lightweight-charts clamps the requested one on creation), not `pane`.
        if (series.length > 0) paneMapRef.current.set(a, livePaneIndex(series) ?? pane);
      }
      // ONLY when a built-in SUB-PANE was added/removed → re-seat pine sub-panes ABOVE the new built-in
      // panes so a pine pane index can't collide with a freshly-added built-in one. A pure overlay toggle
      // (ema/bb/vwap/vol on pane 0) leaves sub-pane indices untouched, so pine is left alone. (The
      // bounded-rebuild branch already rebuilt pine via buildAllIndicators.)
      // clearAllPine() removes the pine pane(s), so a built-in appended ABOVE pine slides back down —
      // re-derive paneMapRef from the LIVE indices BEFORE buildAllPine so it seeds pine at the true top
      // (a stale-high seed clamp-splits a multi-plot pine script across two panes), then re-derive again
      // AFTER so pinePaneMapRef holds the actual, not the requested, pane indices. Without this the
      // requested-vs-actual drift compounds +1 per add/re-seat cycle and eventually splits a multi-series
      // builder (e.g. macd: histogram in one pane, line+signal in the next).
      if ((added.length || removed.length) && pineScriptsRef.current.length && !isIntradayRef.current) {
        clearAllPine(); reindexSubPanesFromLive(); buildAllPine(rows); reindexSubPanesFromLive();
      }
    }

    normalizeStretch();
    renderSignalsRef.current(); renderRef.current();
    builtIndicatorRef.current = { generation: epochRef.current, key: indKey };
    visualReadyRef.current?.reevaluate();
    if (PRESERVE_VIEW_ON_INDICATOR_TOGGLE && viewSavedRef.current) { try { chart.timeScale().setVisibleLogicalRange(viewSavedRef.current); } catch {} }
    // eslint-disable-next-line
  }, [indKey]);

  // Preference hydration and requested-indicator identity are owned by React. A pending ready
  // generation waits for these semantic transitions instead of polling animation frames forever.
  // This effect is intentionally after Effect 3 so an indKey transition publishes its build receipt
  // before readiness is re-evaluated; an authoritative empty key ("") follows the same path.
  useEffect(() => {
    visualReadyRef.current?.reevaluate();
  }, [dataReady, indKey]);

  // The next pane index for a tail-appended sub-pane = 1 + max assigned sub-pane index across BOTH the
  // built-in and pine sub-pane maps (or 1 when none exist), so a new built-in pane can't land on a pane
  // a script already occupies. (Effect 3 re-runs buildAllPine afterward to re-seat pine above the new pane.)
  const nextFreePane = () => {
    let mx = 0;
    for (const idx of paneMapRef.current.values()) mx = Math.max(mx, idx);
    for (const idx of pinePaneMapRef.current.values()) mx = Math.max(mx, idx);
    return mx ? mx + 1 : 1;
  };

  // Actual (post-clamp / post-auto-remove) pane index of a tracked series array, or null if it has no
  // live series. lightweight-charts clamps a requested pane index to panes.length on creation and
  // auto-removes an emptied pane (sliding higher panes down), so a REQUESTED index we stored can drift
  // from where the series actually sits — read it back off the series instead of trusting the map.
  const livePaneIndex = (arr?: ISeriesApi<any>[] | null): number | null => {
    const s = arr && arr[0]; if (!s) return null;
    try { return s.getPane().paneIndex(); } catch { return null; }
  };
  // Collapse BOTH sub-pane maps (built-in indKey → pane, pine scriptId → pane) onto their live pane
  // indices. Only touches keys already tracked as sub-panes (pane-0 overlays / overlay scripts are
  // absent from these maps, so they're skipped). Used on the incremental path around the pine re-seat,
  // where requested-vs-actual drift would otherwise compound each add cycle (see Effect 3).
  const reindexSubPanesFromLive = () => {
    for (const [k, arr] of indSeriesRef.current) { if (!paneMapRef.current.has(k)) continue; const p = livePaneIndex(arr); if (p != null) paneMapRef.current.set(k, p); }
    for (const id of [...pinePaneMapRef.current.keys()]) { const p = livePaneIndex(pineSeriesRef.current.get(id)); if (p != null) pinePaneMapRef.current.set(id, p); }
  };

  // Bounded rebuild: drop every indicator series and re-add the full requested set in canonical order.
  const rebuildIndicators = () => {
    const chart = chartRef.current; if (!chart) return;
    const rows = barsRef.current, closes = closesRef.current;
    clearAllIndicators();
    buildAllIndicators(rows, closes);
  };

  // ── EFFECT 3b — indicator params [indParamsKey]. A Settings edit changes the math/style of an active
  //   indicator, so drop + re-add every indicator series in place (bounded rebuild; no chart rebuild).
  //   Skips the mount pass (Effect 2 already builds against the initial params). ──
  const paramsMounted = useRef(false);
  useEffect(() => {
    if (!paramsMounted.current) { paramsMounted.current = true; return; }
    const chart = chartRef.current; if (!chart || !barsRef.current.length) return;
    const saved = PRESERVE_VIEW_ON_INDICATOR_TOGGLE ? (() => { try { const r = chart.timeScale().getVisibleLogicalRange(); return r ? { from: r.from as number, to: r.to as number } : null; } catch { return null; } })() : null;
    rebuildIndicators();
    normalizeStretch();
    renderSignalsRef.current(); renderRef.current();
    if (saved) { try { chart.timeScale().setVisibleLogicalRange(saved); } catch {} }
    // eslint-disable-next-line
  }, [indParamsKey]);

  // Entitlements resolve asynchronously after the chart can already be painted. Rebuild when the
  // tier changes so persisted Essential/Pro modules and their shared panes appear immediately after
  // `/api/me` upgrades the initial fail-closed Free tier (and disappear on a downgrade).
  const tierMounted = useRef(false);
  useEffect(() => {
    if (!tierMounted.current) { tierMounted.current = true; return; }
    const chart = chartRef.current; if (!chart || !barsRef.current.length) return;
    const saved = PRESERVE_VIEW_ON_INDICATOR_TOGGLE ? (() => {
      try {
        const range = chart.timeScale().getVisibleLogicalRange();
        return range ? { from: range.from as number, to: range.to as number } : null;
      } catch { return null; }
    })() : null;
    rebuildIndicators();
    normalizeStretch();
    applyHidden();
    renderSignalsRef.current();
    renderRef.current();
    measureRef.current();
    if (saved) { try { chart.timeScale().setVisibleLogicalRange(saved); } catch {} }
    // eslint-disable-next-line
  }, [userTier]);

  // ── EFFECT 3-lab — reload lab markers when _lab indicator is toggled ON ──────
  // Effect 2 loads markers on symbol change. When the user enables _lab AFTER data is
  // already on the chart, this effect fires a one-shot fetch to populate labMarkersRef
  // without requiring a full symbol reload. Mirrors how gaps/oracle are purely SVG-driven.
  const hasLab = indicators.has("_lab");
  useEffect(() => {
    if (!hasLab) { labMarkersRef.current = new Map(); renderSignalsRef.current(); return; }
    const sym = symbolRef.current; if (!sym) return;
    let alive = true;
    getJSON(`/data/${sym}.intel.json`).then((intelPayload: any) => {
      if (!alive) return;
      const signals = intelPayload?.tech?.events?.signals;
      if (!signals || typeof signals !== "object") return;
      const profiles = intelPayload?.tech?.profiles ?? {};
      const dateMap = new Map<string, { name: string; dir: number }[]>();
      for (const [sigId, state] of Object.entries(signals) as [string, any][]) {
        const fires: string[] = Array.isArray(state?.fires) ? state.fires : [];
        const dir: number = typeof state?.dir === "number" ? state.dir : 0;
        const displayName: string = profiles?.[sigId]?.display_en ?? sigId;
        for (const d of fires) {
          if (typeof d !== "string") continue;
          const arr = dateMap.get(d) ?? [];
          arr.push({ name: displayName, dir });
          dateMap.set(d, arr);
        }
      }
      const sortedDates = Array.from(dateMap.keys()).sort();
      const capDates = sortedDates.slice(-LAB_MARKER_CAP);
      const capped = new Map<string, { name: string; dir: number }[]>();
      for (const d of capDates) capped.set(d, dateMap.get(d)!);
      labMarkersRef.current = capped;
      renderSignalsRef.current();
    }).catch(() => { /* lab data unavailable for this symbol */ });
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [hasLab, symbol]);

  // ── EFFECT 3-optlevels — fetch gex+moves when the Options Levels overlay is ON ──────
  // Mirrors Effect 3-lab: one-shot fetch on toggle-on / symbol change with an alive-flag
  // cancel. flowGet dedupes + SWR-caches and returns null on a hard error (including the
  // /api/flow entitlement 403) — that renders as the legend's gate/unavailable note, the
  // chart never throws on a gated fetch. Ineligible (non-US) symbols skip the network.
  const hasOptLevels = indicators.has("optlevels");
  useEffect(() => {
    if (!hasOptLevels) { optLevelsStateRef.current = null; return; }
    const sym = symbolRef.current; if (!sym) return;
    if (!optLevelsEligible(sym)) {
      optLevelsStateRef.current = { sym, status: "ineligible", res: null };
      rebuildPaneMeta();
      return;
    }
    let alive = true;
    const root = sym.toUpperCase();
    optLevelsStateRef.current = { sym, status: "loading", res: null };
    rebuildPaneMeta();
    Promise.all([flowGet(`gex:${root}`), flowGet(`moves:${root}`)]).then(([g, m]) => {
      if (!alive || symbolRef.current !== sym) return;
      if (g == null && m == null) {
        // Both lanes hard-failed (prod surfaces a missing/uncovered root's artifact as a
        // 503 → flowGet null, NOT the fixture's 200 {}) — could be no coverage OR an
        // outage; "unavailable" is the honest umbrella.
        optLevelsStateRef.current = { sym, status: "unavailable", res: null };
      } else {
        // g == null with a live moves payload is the real-world partial publish (the two
        // lanes are separate publishers) — derive from an empty gex shell so the Tier-A
        // EM band still draws instead of being discarded.
        const res = deriveOptLevels(g ?? {}, m, root);
        optLevelsStateRef.current = { sym, status: res.status, res };
      }
      // First-load race (slevels precedent): Effect 2/3 may have already built against an
      // empty state ref — the builder is idempotent (clears its own price-line pool, adds
      // no LWC series), so re-run it directly now that data exists, then re-assert the eye.
      try { if (indicatorsRef.current.has("optlevels")) { buildOptLevels(); applyHidden(); } } catch {}
      rebuildPaneMeta();
    }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [hasOptLevels, symbol]);

  // ── EFFECT 3c — custom scripts [pineKey]. Add / remove / param-edit a script WITHOUT touching the
  //   built-in indicators (do NOT clearAllIndicators — that would flash + reset every built-in). Only
  //   pine series are dropped + rebuilt; runPineMemo caches per script so a single param change re-runs
  //   ONLY that script. Skips the mount pass (Effect 2 already built the initial set). Runs on the SAME
  //   on-chart bar set the built-ins use. ──
  const pineKey = pineScripts.map((s) => `${s.id}:${s.source.length}:${JSON.stringify(s.params)}`).join("|");
  const pineMounted = useRef(false);
  useEffect(() => {
    if (!pineMounted.current) { pineMounted.current = true; return; }
    const chart = chartRef.current; if (!chart || !barsRef.current.length) return;
    const saved = PRESERVE_VIEW_ON_INDICATOR_TOGGLE ? (() => { try { const r = chart.timeScale().getVisibleLogicalRange(); return r ? { from: r.from as number, to: r.to as number } : null; } catch { return null; } })() : null;
    // drop cache entries for scripts that are no longer enabled (frees memory; a re-add re-runs fresh)
    const live = new Set(pineScriptsRef.current.map((s) => s.id));
    for (const id of Array.from(pineCacheRef.current.keys())) if (!live.has(id)) pineCacheRef.current.delete(id);
    for (const id of Array.from(pineErrRef.current.keys())) if (!live.has(id)) pineErrRef.current.delete(id);
    // drop the worker's cached AST for removed scripts' sources (frees worker memory), then forget them
    for (const [id, a] of Array.from(pineAstRef.current.entries())) if (!live.has(id)) { try { pineHostRef.current?.evict(a.source); } catch {} pineAstRef.current.delete(id); }
    clearAllPine();
    if (!isIntradayRef.current) buildAllPine(barsRef.current);
    normalizeStretch();
    applyHidden();
    renderSignalsRef.current(); renderRef.current();
    if (saved) { try { chart.timeScale().setVisibleLogicalRange(saved); } catch {} }
    // eslint-disable-next-line
  }, [pineKey]);

  // ── eye toggle / tf-visibility [hidden] → flip native series and immediately refresh suite SVG,
  // candle-paint and dashboard output. Module eyes are expressed through suiteRenderParams(). ──
  useEffect(() => {
    hiddenRef.current = hidden;
    applyHidden();
    renderSignalsRef.current();
    renderRef.current();
    measureRef.current();
  }, [hidden]); // eslint-disable-line

  // ────────────────────────────────────────────────────────────────────────────
  // EFFECT 4 — replay [replayIdx]. Slice from fullBarsRef; recompute indicators+sigMarks on the slice.
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current, priceS = priceSeriesRef.current; if (!chart || !priceS) return;
    if (!fullBarsRef.current.length) return;   // no data yet — Effect 2 already honors replayIdx on first load
    if (replayIdx == null) {
      // exit replay → restore the FULL series (price + indicators + compare) + default view
      const full = fullBarsRef.current; barsRef.current = full; const closes = full.map((r) => r.c); closesRef.current = closes;
      precRef.current = closes.length && closes[closes.length - 1] < 10 ? 4 : 2;   // parity: prec from the visible last close
      priceS.setData(priceData(full) as any);
      clearAllIndicators(); buildAllIndicators(full, closes);
      // recompute compare on the full set (fire-and-forget; guarded by epoch)
      void rebuildCompare(full, epochRef.current);
      sigMarksRef.current = resolveSigMarks(sliceRef.current, full);
      { const sc = resolveSideChannels(sliceRef.current, full); earlyDotsRef.current = sc.dots; warnMarksRef.current = sc.warns; }
      paintStatus(full, sliceRef.current);
      applyView(full, null);
    } else {
      const rows = fullBarsRef.current.slice(0, Math.max(20, replayIdx + 1));
      barsRef.current = rows;                          // replicate the base's snap-sees-visible-bars behavior
      const closes = rows.map((r) => r.c); closesRef.current = closes;
      precRef.current = closes.length && closes[closes.length - 1] < 10 ? 4 : 2;   // parity: prec from the visible last close
      priceS.setData(priceData(rows) as any);
      clearAllIndicators(); buildAllIndicators(rows, closes);
      void rebuildCompare(rows, epochRef.current);
      sigMarksRef.current = resolveSigMarks(sliceRef.current, rows);
      { const sc = resolveSideChannels(sliceRef.current, rows); earlyDotsRef.current = sc.dots; warnMarksRef.current = sc.warns; }
      paintStatus(rows, sliceRef.current);
      try {
        const fitRange = fullHistoryLogicalRange(barsRef.current.length);
        if (fitRange) chart.timeScale().setVisibleLogicalRange(fitRange);
        else chart.timeScale().fitContent();
      } catch {}
    }
    normalizeStretch();
    renderSignalsRef.current(); renderRef.current();
    // re-register sync so its close-by-time map matches the visible bar set
    reRegisterSync();
    // exiting replay returns to the live series → re-apply the splice (self-guards under replay/EOD/intraday)
    applyLiveSplice();
    applyExtendedPriceLine();
    // eslint-disable-next-line
  }, [replayIdx]);

  // ────────────────────────────────────────────────────────────────────────────
  // EFFECT 7 — live-bar splice [liveQuote]. Daily-derived bars take the regular quote; intraday
  //   bars consume the one-second aggregate packet. The signature includes packet time + OHLC so
  //   two prints inside one candle still reshape its body/wicks without remounting the chart.
  // ────────────────────────────────────────────────────────────────────────────
  const liveSig = liveQuote
    ? `${liveQuote.last ?? ""}|${liveQuote.ts ?? ""}|${liveQuote.asOfMs ?? ""}|${liveQuote.basis ?? ""}|${liveQuote.tickStartMs ?? ""}|${liveQuote.tickEndMs ?? ""}|${liveQuote.tickOpen ?? ""}|${liveQuote.tickHigh ?? ""}|${liveQuote.tickLow ?? ""}|${liveQuote.tickClose ?? ""}|${liveQuote.tickVol ?? ""}|${liveQuote.extPrice ?? ""}|${liveQuote.extTs ?? ""}|${liveQuote.extSession ?? ""}`
    : "";
  useEffect(() => {
    if (!chartRef.current || !priceSeriesRef.current) return;
    if (!barsRef.current.length) return;   // no data yet — Effect 2's tail will apply it
    applyLiveSplice();
    applyExtendedPriceLine();
    // eslint-disable-next-line
  }, [liveSig]);

  // ────────────────────────────────────────────────────────────────────────────
  // EFFECT 8 — jump-to-signal [mount]. R14: window `mm:chart-jump` {sym, ts}. If this pane's active
  //   symbol matches and the TF is daily-derived, snap ts to the nearest bar (SAME makeNearestBarIndex
  //   the marker resolver uses), center ±40 bars, and pulse the target sigMark ~2.5s (transient highlight flag),
  //   cleared on symbol/TF change (Effect 2 clears the timer) or when the next jump arrives.
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onJump = (e: Event) => {
      const d = (e as CustomEvent).detail as { sym?: string; ts?: string } | undefined;
      if (!d || d.sym !== symbol || !d.ts) return;
      if (isIntradayRef.current) return;                 // ts is a date string; intraday axis is epoch-sec
      const chart = chartRef.current; if (!chart) return;
      const bars = barsRef.current; if (!bars.length) return;
      // nearest-bar snapping identical to resolveSigMarks' (same helper, same tolerance)
      const bi = makeNearestBarIndex(bars.map((b) => b.time))(d.ts);
      if (bi < 0) return;
      try { chart.timeScale().setVisibleLogicalRange({ from: bi - 40, to: bi + 40 }); } catch {}
      // pulse the matching sigMark (if one sits on that bar); transient highlight flag → renderSignals
      const tBar = bars[bi].time;
      if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); highlightTimerRef.current = null; }
      let hit = false;
      for (const m of sigMarksRef.current) { const on = m.t === tBar; m.highlight = on; if (on) hit = true; }
      renderSignalsRef.current();
      if (hit) highlightTimerRef.current = setTimeout(() => {
        for (const m of sigMarksRef.current) m.highlight = false;
        highlightTimerRef.current = null;
        renderSignalsRef.current();
      }, 2500);
    };
    window.addEventListener("mm:chart-jump", onJump as EventListener);
    return () => { window.removeEventListener("mm:chart-jump", onJump as EventListener); if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); highlightTimerRef.current = null; } };
    // eslint-disable-next-line
  }, [symbol]);

  // ── EFFECT 8b — re-title the markers on a language switch [mount] ──────────────────────────
  // The marker tooltips are built imperatively inside renderSignals, so they are not re-rendered
  // by React when the language changes — `applyLang` flips `<html data-lang>` and fires `mm:lang`,
  // and nothing in this canvas-and-SVG path listens to it. Without this, a reader who switches to
  // 中文 keeps every marker's English hover until an unrelated pan happens to repaint the layer.
  // Only the titles depend on language, so a repaint is the whole fix.
  useEffect(() => {
    const onLang = () => renderSignalsRef.current();
    window.addEventListener("mm:lang", onLang);
    return () => window.removeEventListener("mm:lang", onLang);
  }, []);

  // A symbol change no longer unmounts this renderer, so the teardown that used to end an
  // in-flight drawing transaction never runs. End it here instead: a half-drawn trendline, an
  // open media tool, or an inspector pointed at the previous ticker's drawing must not survive
  // onto the next chart. Drawings themselves arrive as a prop and re-render on their own.
  const symbolTransactionRef = useRef(symbol);
  useEffect(() => {
    if (symbolTransactionRef.current === symbol) return;
    symbolTransactionRef.current = symbol;
    cancelPendingDrawingRef.current?.();
    cancelMediaToolRef.current?.(null);
    clearDrawingSelectionRef.current?.();
  }, [symbol]);

  // ────────────────────────────────────────────────────────────────────────────
  // EFFECT 5 — style [csNonce]. Re-read tokens; recolor chart + price + volume. NO createChart/removeSeries.
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current, priceS = priceSeriesRef.current; if (!chart) return;
    const t = readTokens(); tokensRef.current = t;
    const settings = chartSettingsRef.current;
    try {
      chart.applyOptions({
        layout: { textColor: settings.scaleTextColor || t.axis, panes: { separatorColor: settings.paneSeparatorColor || css("--pane-sep"), separatorHoverColor: settings.paneSeparatorColor || css("--pane-sep-h") } },
        grid: { vertLines: { color: settings.gridVColor || t.grid }, horzLines: { color: settings.gridHColor || t.grid } },
        crosshair: { vertLine: { labelBackgroundColor: t.p3 }, horzLine: { labelBackgroundColor: t.p3 } },
        // C2 — this effect re-applies borderColor only (borderVisible from createEngine survives the
        // merge), but the time-axis rule WOULD revert to --line without the shell gate here.
        rightPriceScale: { borderColor: settings.scaleLineColor || t.line },
        timeScale: { borderColor: settings.scaleLineColor || axisLineColor(t.line) },
      });
    } catch {}
    if (priceS) {
      try {
        if (chartType === "bars") priceS.applyOptions({ upColor: settings.candleUpColor || t.up, downColor: settings.candleDownColor || t.down });
        else if (isValueChartType(chartType)) {
          if (chartType === "area") priceS.applyOptions({ lineColor: t.brand2 });
          else if (chartType === "baseline") priceS.applyOptions({
            topLineColor: t.up, topFillColor1: withAlpha(t.up, 0.28), topFillColor2: withAlpha(t.up, 0.03),
            bottomLineColor: t.down, bottomFillColor1: withAlpha(t.down, 0.03), bottomFillColor2: withAlpha(t.down, 0.28),
          });
          else priceS.applyOptions({ color: t.brand2 });
        }
        else priceS.applyOptions({
          upColor: settings.candleBodyVisible === false || chartType === "hollow" ? "rgba(0,0,0,0)" : settings.candleUpColor || t.up,
          downColor: settings.candleBodyVisible === false ? "rgba(0,0,0,0)" : settings.candleDownColor || t.down,
          wickUpColor: settings.candleUpWick || settings.candleUpColor || t.up,
          wickDownColor: settings.candleDownWick || settings.candleDownColor || t.down,
          borderUpColor: settings.candleUpBorder || settings.candleUpColor || t.up,
          borderDownColor: settings.candleDownBorder || settings.candleDownColor || t.down,
        });
      } catch {}
    }
    // recolor the volume histogram by re-setData with token-derived up/down fills (no series churn)
    const vol = indSeriesRef.current.get("vol"); if (vol && vol[0]) { try { vol[0].setData(volData(barsRef.current)); } catch {} }
    // Indicators that resolve --up/--down (or a directional param) at BUILD time need a rebuild on
    // flip: cvd baseline colors, ttmsq momentum shades, adx ±DI, pivots R/S price lines, options
    // levels — plus the classic set, whose crossover bars/dots, guide lines, cloud and ribbon fills
    // are all directional. Flips are rare, so the full rebuild path is the sanctioned fix (skip on
    // mount: csNonce 0 = initial run). Volume is recolored in place just above; `gaps` draws on the
    // signal layer and picks its params up from the renderSignals call below.
    if (csNonce > 0 && barsRef.current.length) {
      const directional = ["cvd", "ttmsq", "adx", "pivots", "optlevels", "stochrsi", "macd", "ichimoku", "ribbon", "supertrend"];
      if (directional.some((k) => indicatorsRef.current.has(k))) { try { rebuildIndicators(); } catch {} }
    }
    renderSignalsRef.current(); renderRef.current();
    // eslint-disable-next-line
  }, [csNonce]);

  // ────────────────────────────────────────────────────────────────────────────
  // EFFECT 6 — sync is registered in the tail of Effect 2 (+ on replay) via reRegisterSync(),
  //   and torn down in the mount cleanup. No standalone sync effect. When syncId changes,
  //   re-register against the live series.
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => { if (chartRef.current && priceSeriesRef.current && barsRef.current.length) reRegisterSync(); return () => { }; /* eslint-disable-line */ }, [syncId]);

  // ── EFFECT 7 ─ chart settings (price scale mode, invert, position, labels, price line, grid, colors).
  // Applies whenever the chartSettings prop changes.
  useEffect(() => {
    const chart = chartRef.current; const priceS = priceSeriesRef.current; if (!chart) return;
    if (chartSettings == null) return;
    const { mode, invertScale, scaleLeft, autoScale, priceLineVisible, lastValueVisible,
      gridHVisible, gridVVisible, candleUpColor, candleDownColor,
      candleUpBorder, candleDownBorder, candleUpWick, candleDownWick,
      showWatermark } = chartSettings;
    try {
      if (scaleLeft != null) {
        chart.applyOptions({ leftPriceScale: { visible: !!scaleLeft }, rightPriceScale: { visible: !scaleLeft } });
        if (priceS) try { priceS.applyOptions({ priceScaleId: scaleLeft ? "left" : "right" } as any); } catch {}
      }
      const scaleId = (chartSettings.scaleLeft) ? "left" : "right";
      if (mode != null || invertScale != null || autoScale != null || chartSettings.scaleMarginsTop != null) {
        const opts: Record<string, any> = {};
        if (mode != null) opts.mode = mode;
        if (invertScale != null) opts.invertScale = invertScale;
        if (autoScale != null) opts.autoScale = autoScale;
        if (chartSettings.scaleMarginsTop != null || chartSettings.scaleMarginsBottom != null) {
          opts.scaleMargins = {
            top: Math.max(0, Math.min(0.5, (chartSettings.scaleMarginsTop ?? 10) / 100)),
            bottom: Math.max(0, Math.min(0.5, (chartSettings.scaleMarginsBottom ?? 8) / 100)),
          };
        }
        chart.priceScale(scaleId).applyOptions(opts);
      }
      const tokens = tokensRef.current;
      const backgroundTop = chartSettings.backgroundTop || "transparent";
      const backgroundBottom = chartSettings.backgroundBottom || backgroundTop;
      const background = chartSettings.backgroundType === "gradient"
        ? { type: ColorType.VerticalGradient, topColor: backgroundTop, bottomColor: backgroundBottom }
        : { type: ColorType.Solid, color: backgroundTop };
      chart.applyOptions({
        layout: {
          background: background as any,
          textColor: chartSettings.scaleTextColor || tokens.axis,
          // C7 — 12 is the SHIPPED DEFAULT, not a user choice, so it must not out-rank the shell's
          // regular-width ramp; only a customised size wins. Web resolves to 12 either way.
          fontSize: chartSettings.scaleFontSize && chartSettings.scaleFontSize !== DEFAULT_CHART_SETTINGS.scaleFontSize
            ? chartSettings.scaleFontSize
            : shellAxisFontSize(),
          panes: {
            separatorColor: chartSettings.paneSeparatorColor || css("--pane-sep"),
            separatorHoverColor: chartSettings.paneSeparatorColor || css("--pane-sep-h"),
          },
        },
        grid: {
          horzLines: { color: chartSettings.gridHColor || tokens.grid, visible: gridHVisible !== false },
          vertLines: { color: chartSettings.gridVColor || tokens.grid, visible: gridVVisible !== false },
        },
        crosshair: {
          mode: chartSettings.crosshairMode === 1 ? CrosshairMode.Magnet : CrosshairMode.Normal,
          vertLine: { color: chartSettings.crosshairColor || "rgba(214,218,227,.32)", labelBackgroundColor: tokens.p3 },
          horzLine: { color: chartSettings.crosshairColor || "rgba(214,218,227,.32)", labelBackgroundColor: tokens.p3 },
        },
        // C2 — borderVisible is never re-applied here, so createEngine's shell value survives the
        // merge; only the time-axis colour needs the gate (see Effect 5).
        leftPriceScale: { borderColor: chartSettings.scaleLineColor || tokens.line },
        rightPriceScale: { borderColor: chartSettings.scaleLineColor || tokens.line },
        timeScale: {
          borderColor: chartSettings.scaleLineColor || axisLineColor(tokens.line),
          rightOffset: chartSettings.rightOffsetBars ?? 10,
          ...chartTimeAxisOptions(chartSettings.hourFormat ?? "24", visibleCalendarSpanDays),
        } as any,
      });
      // Watermark visibility — v5 uses the createTextWatermark plugin (chart-level watermark removed in v5).
      if (showWatermark != null) {
        try {
          // C5 — the plugin stays off in shell mode (it cannot be inset clear of the volume band);
          // the .mm-brandbug DOM node carries the setting there instead.
          const wmShell = shellAxis();
          watermarkPluginRef.current?.applyOptions({
            visible: showWatermark && !wmShell,
            horzAlign: "center",
            vertAlign: "center",
            lines: [{
              text: "Mastermind Terminal",
              color: chartSettings.watermarkColor || "rgba(214,218,227,0.04)",
              fontSize: 48,
              fontStyle: "bold",
              fontFamily: "var(--font-ui, system-ui, sans-serif)",
            }],
          });
          watermarkVisibleRef.current = showWatermark && !wmShell;
          if (brandBugRef.current) brandBugRef.current.style.display = showWatermark ? "" : "none";
        } catch {}
      }
      if (priceS) {
        const sOpts: Record<string, any> = {};
        if (priceLineVisible != null) sOpts.priceLineVisible = priceLineVisible;
        // The built-in lastValueVisible on the series is always false (we use a custom DOM tag);
        // keep the series option in sync for library correctness but also re-render the custom tag
        // immediately so the toggle has instant visible effect.
        if (lastValueVisible != null) sOpts.lastValueVisible = lastValueVisible;
        if (chartTypeRef.current === "bars") {
          sOpts.upColor = candleUpColor || tokens.up;
          sOpts.downColor = candleDownColor || tokens.down;
        } else if (!isValueChartType(chartTypeRef.current)) {
          sOpts.borderVisible = chartSettings.candleBordersVisible !== false;
          sOpts.wickVisible = chartSettings.candleWicksVisible !== false;
          sOpts.upColor = chartSettings.candleBodyVisible === false || chartTypeRef.current === "hollow" ? "rgba(0,0,0,0)" : candleUpColor || tokens.up;
          sOpts.downColor = chartSettings.candleBodyVisible === false ? "rgba(0,0,0,0)" : candleDownColor || tokens.down;
          sOpts.borderUpColor = candleUpBorder || candleUpColor || tokens.up;
          sOpts.borderDownColor = candleDownBorder || candleDownColor || tokens.down;
          sOpts.wickUpColor = candleUpWick || candleUpColor || tokens.up;
          sOpts.wickDownColor = candleDownWick || candleDownColor || tokens.down;
        }
        if (chartSettings.precision && chartSettings.precision !== "auto") {
          precRef.current = Number(chartSettings.precision);
        } else if (barsRef.current.length) {
          precRef.current = barsRef.current[barsRef.current.length - 1].c < 10 ? 4 : 2;
        }
        sOpts.priceFormat = priceFmt();
        if (Object.keys(sOpts).length) priceS.applyOptions(sOpts as any);
        if (barsRef.current.length) {
          priceS.setData(priceData(barsRef.current) as any);
          applyLiveSplice();
        }
      }
      renderTagRef.current?.();
      if (barsRef.current.length) paintStatus(barsRef.current, sliceRef.current);
      applyExtendedPriceLine();
    } catch {}
    // eslint-disable-next-line
  }, [JSON.stringify(chartSettings)]);

  // Descriptive manifest data can land after OHLC. Refresh just the identity line
  // when it arrives instead of waiting for a quote or rebuilding the chart.
  useEffect(() => {
    if (barsRef.current.length) paintStatus(barsRef.current, sliceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentName, instrumentMarket, instrumentColor, timeframe]);

  // ── EFFECT 8 ─ expose the chart API to the parent (for range navigation from the frame bar).
  const onChartApiRef = useRef(onChartApi); onChartApiRef.current = onChartApi;
  useEffect(() => {
    onChartApiRef.current?.(chartRef.current);
    return () => { onChartApiRef.current?.(null); };
    // eslint-disable-next-line
  }, []);

  // ── DT-D1: session shading + countdown chip (dayMode × intraday × market) ──
  // Runs whenever dayMode, timeframe, or symbol changes. Attaches / detaches the
  // SessionShadingPrimitive on the candle series, and starts/stops the 1s countdown timer.
  useEffect(() => {
    const priceS = priceSeriesRef.current;
    const market = classify(symbol);
    const isIntraday = isIntradayTf(timeframe);
    // US-session shading assumes the bars' display axis runs on US Eastern wall clock. An
    // international macro index (^N225, ^FTSE, ^HSI, …) plots on its HOME market's clock
    // (macroDisplayTz), so ET RTH bands would tint arbitrary slices of the Tokyo or London
    // session — suppress shading instead. classify() cannot see this: every macro shape
    // falls through its "us" default.
    const canShade = dayMode && isIntraday && market !== "crypto"
      && !(isMacroSymbol(symbol) && !macroOnEtAxis(symbol));

    // Detach any existing shading primitive first
    if (shadingPrimRef.current && priceS) {
      try { detachSessionShading(priceS, shadingPrimRef.current); } catch {}
      shadingPrimRef.current = null;
    }

    if (canShade && priceS) {
      const imBars = barsRef.current as unknown as import("@/lib/sessionShading").ShadingBar[];
      const prim = attachSessionShading(priceS, imBars);
      shadingPrimRef.current = prim;
    }

    // Countdown chip
    const wrap = wrapElRef.current as any;
    if (dayMode && isIntraday) {
      wrap?.__dtm_startCd?.();
    } else {
      wrap?.__dtm_stopCd?.();
    }

    // DayStatsStrip: propagate current bars/daily to strip state when mode toggles or TF/symbol changes
    if (dayMode && isIntraday && barsRef.current.length) {
      setStripBars([...barsRef.current]);
      setStripDailyBars(dailyCacheRef.current?.sym === symbol ? [...dailyCacheRef.current.bars] : []);
    } else {
      // Clear strip data when mode is off so the strip is hidden clean
      setStripBars([]);
      setStripDailyBars([]);
    }
    // eslint-disable-next-line
  }, [dayMode, timeframe, symbol]);

  // ── D2 locked vline: re-render SVG when the locked time changes ──
  useEffect(() => { renderRef.current?.(); }, [lockedVLine]);

  // ── unchanged: re-render overlay + toggle interactivity on tool/drawings change (no chart rebuild) ──
  useLayoutEffect(() => {
    cancelPendingDrawingRef.current();
    cancelMediaToolRef.current(tool);
    const svg = svgRef.current;
    if (svg) {
      svg.style.pointerEvents = tool ? "auto" : "none";
      svg.style.cursor = tool ? "crosshair" : "default";
      svg.dataset.toolActivation = String(toolActivation);
    }
    if (!tool && creationPaletteRef.current) creationPaletteRef.current.style.display = "none";
  }, [tool, toolActivation]);
  useLayoutEffect(() => {
    if (!drawingCreationDisabled && replayIdx == null) return;
    cancelPendingDrawingRef.current();
    cancelMediaToolRef.current(null);
    if (creationPaletteRef.current) creationPaletteRef.current.style.display = "none";
    // Replay is a read-only historical lens: its first committed frame must
    // retire any live selection so no inspector, handle, keyboard edit, or
    // direct-dispatched pointer event can mutate the document behind it.
    if (replayIdx != null) clearDrawingSelectionRef.current();
  }, [drawingCreationDisabled, replayIdx]);
  useEffect(() => { renderRef.current?.(); }, [drawings]);

  // ── unchanged: detection commands → append auto-drawings (or clear) ──
  useEffect(() => {
    if (!detectCmd) return; let tries = 0; let timer: any;
    const run = () => {
      if (detectCmd.kind === "clearAll") { onChangeRef.current?.([]); return; }   // trash-can: wipe ALL drawings
      const bars = barsRef.current as DBar[];
      if (!bars.length) { if (tries++ < 25) timer = setTimeout(run, 150); return; }
      if (detectCmd.kind === "clear") { onChangeRef.current?.(drawRef.current.filter((d) => !d.auto)); return; }
      let add: Drawing[] = [];
      if (detectCmd.kind === "trendlines") add = autoTrendlines(bars);
      else if (detectCmd.kind === "fib") { const f = autoFib(bars); if (f) add = [f]; }
      else if (detectCmd.kind === "sr") add = srDrawings(bars);
      else if (detectCmd.kind === "mtfa") add = mtfaDrawings(bars);
      if (add.length) onChangeRef.current?.([...drawRef.current.filter((d) => !d.auto), ...add]);
    };
    run();
    return () => clearTimeout(timer);
  }, [detectCmd?.nonce]); // eslint-disable-line

  // ── compare change → rebuild only the compare overlays on the current bar set (no chart rebuild) ──
  const cmpDep = JSON.stringify({ c: compare || [], g: compareCfg });
  useEffect(() => {
    const chart = chartRef.current; if (!chart || !barsRef.current.length) return;
    void rebuildCompare(barsRef.current, epochRef.current).then(() => { rebuildPaneMeta(); renderSignalsRef.current(); renderRef.current(); });
    // eslint-disable-next-line
  }, [cmpDep]);

  // Golden Oracle Confluence is a toggleable/removable study now: its verdict badge + detail chip only
  // show while it's active AND not hidden via the legend eye. (Kept mounted with display:none so the
  // imperative verdict painter can keep verdictRef current in the background — no remount staleness.)
  const oracleVisible = indicators.has("_oracle") && !hidden.has("_oracle");
  const isIntraday = isIntradayTf(timeframe);
  return (
    <div className="chart-wrap">
      {/* DayStatsStrip: slim row pinned above chart when Day Trade Mode is on and TF is intraday */}
      {dayMode && isIntraday && stripBars.length > 0 && (
        <DayStatsStrip
          bars={stripBars}
          market={classify(symbol)}
          dailyBars={stripDailyBars}
        />
      )}
      <div className="statusline">
        <span ref={statusRef} />
        <span className="mm" style={{ display: oracleVisible ? undefined : "none" }}><i style={{ background: "currentColor" }} /><span ref={verdictRef}>GOLDEN ORACLE</span></span>
        {replayIdx != null && <span className="mm" style={{ background: "rgba(232,179,57,.14)", borderColor: "rgba(232,179,57,.35)", color: "var(--signal)" }}><i style={{ background: "var(--signal)" }} />REPLAY</span>}
        {/* GC v2: toggle the early-dots + arm/confirm warning overlay (side channels) */}
        {oracleVisible && <span className="mm" role="button" tabIndex={0} onClick={() => setShowDetail((v) => !v)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowDetail((v) => !v); } }}
          title={tPlain("cpOracleToggle", "Toggle early dots & structure-break warnings")}
          style={{ cursor: "pointer", opacity: showDetail ? 1 : 0.5 }}>
          <i style={{ background: "var(--muted)" }} />{showDetail ? "⚠ detail" : "⚠ off"}
        </span>}
      </div>
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      <ChartTables tables={suiteTables} />
      <ChartOverlays
        panes={paneLayout} hoveredKey={hoveredKey} legendOpen={legendOpen} onToggleLegend={() => setLegendOpen((o) => !o)}
        showTitles={chartSettings?.showIndicatorTitles !== false}
        backgroundOpacity={chartSettings?.indicatorBackgroundOpacity ?? 70}
        paneButtons={chartSettings?.paneButtons ?? "hover"}
        onEye={(k) => onToggleHidden?.(k)} onSettings={(k) => onOpenSettings?.(k)} onSource={(k) => onOpenSource?.(k)} onRemove={(k) => onRemoveInd?.(k)}
        onMoveUp={(pi) => doMove(pi, -1)} onMoveDown={(pi) => doMove(pi, 1)} onCollapse={doCollapse} onMaximize={doMaximize}
        canMoveUp={canMoveUp} canMoveDown={canMoveDown}
        coarse={isMobile}
      />
    </div>
  );
}
