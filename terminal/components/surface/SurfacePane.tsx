"use client";
/**
 * SurfacePane — the flagship "paint surface": intraday price candles over a premium-flow
 * heat field, driven by the replay spine.
 *
 * Data:
 *   - surface_idx:{ROOT}  → seeds the replay stamps (once per root)
 *   - surface:{ROOT}:{STAMP} → the realized-so-far field for the scrubbed time
 *   - /api/intraday?sym={ROOT}&tf={agg}m&date={session} → selected-session candles
 *
 * When the replay is on an ARCHIVED session the first two swap to their date-keyed twins
 * (surface_idx_at / surface_at). Candles request that same date from the deep intraday
 * store; the client filters defensively too. Drawing a year of price history under one
 * session's field flattened the candles and reduced the field to a sliver, while drawing
 * today's price under a past field would be a point-in-time lie.
 *
 * Rendering: HeatSeries custom-series (lib/heatSeries) paints the field; a candlestick
 * series draws price on top. The shader's pos/neg RGB are resolved from --up/--down at
 * mount and re-resolved on theme / data-updown change (MutationObserver) — never a
 * hardcoded direction hex.
 *
 * Controls: metric tabs (Net Prem active; Gamma/Vanna/Charm disabled-with-tooltip),
 * candle interval 1m/5m/15m, opacity slider, strike-range slider (filters price_levels to spot±q),
 * Fit price / Fit strikes, crosshair readout pill top-left (Strike · metric · value),
 * as-of + cadence stamp bottom-right. Empty state: honest "No surface data yet — accruing."
 *
 * Y axis: the field spans every strike in range (hundreds of points) while price spans a
 * few dollars of it, and both share ONE price scale — so the default window is anchored to
 * the CANDLE extent (priceWindow) and the field is allowed to overflow past the pane.
 * Anchoring on the strikes, which is what this pane used to do, left price as a ~12px
 * hairline. "Fit strikes" restores the whole field; shift+wheel (or wheel over the price
 * gutter) zooms continuously between them.
 */

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import { useLang } from "@/lib/i18n";
import { flowGet } from "@/lib/flowClientCache";
import {
  HeatSeries,
  heatShade,
  resolveMetricColors,
  type HeatData,
  type HeatSeriesOptions,
  type Rgb,
} from "@/lib/heatSeries";
import {
  archivedOverlayPolicy,
  buildHeatBars,
  filterFrameToRange,
  gridMaxAbs,
  gridPercentileAbs,
  isSurfaceFrame,
  isSurfaceIndex,
  metricEnabled,
  observedSurfaceCadenceSec,
  parseOiChangeRows,
  removeHostedLines,
  topOiChangeStrikes,
  type SurfaceFrame,
  type MatrixCell,
} from "@/lib/surfaceContract";
import { filterBarsToSessionDate, sessionEpoch, type Bar6 } from "@/lib/intradayShared";
import { useReplay } from "./replayContext";
import { StrikeEvolutionModal } from "./StrikeEvolutionModal";
import { makeSurfaceT } from "./surfaceStrings";
import type { SurfaceKey } from "./surfaceStrings";
import { useSurfaceSync } from "./surfaceSync";
import type { SurfacePin } from "./surfacePins";
import type { ContrastMode } from "./surfaceTheme";
import { EodReplayTag } from "./EodReplayTag";
import { deriveOptLevels, sessionsOldEt, type OptLevelKey, type OptLevelsResult } from "@/lib/optionsLevels";
import { parseGlanceState, REGIME_COLORS } from "@/lib/mscGlance";
import { makeGexT } from "@/components/gexdesk/gexStrings";
import { regimeLabel as plainRegime } from "@/lib/plainLabels";

/** Shared empty OptLevelsResult — used when a derive-memo's store isn't for the current
 *  root/session yet (F8 stale-root gate), so the pane reads "no coverage" rather than
 *  undefined during the gap between a root/session switch and its fetch resolving. */
const EMPTY_OPT_LEVELS: OptLevelsResult = {
  status: "empty", levels: [], asofDate: null, signed: false, spot: null, netGexBn: null,
};

// ─── Config ─────────────────────────────────────────────────────────────────

// Metric identity === the snapshot grid key. Gamma's grid key is `gex` (matches the macro
// lane's grids:{gex,dex,vanna,charm}); the tab is labelled "Gamma". Enablement is
// feature-detected per-frame (metricEnabled) — a greek tab is live ONLY when the loaded
// snapshot carries its grid, otherwise disabled-with-tooltip ("accruing").
type Metric = "netprem" | "gex" | "vanna" | "charm";
const METRICS: { key: Metric; labelKey: SurfaceKey }[] = [
  { key: "netprem", labelKey: "metricNetPrem" },
  { key: "gex", labelKey: "metricGamma" },
  { key: "vanna", labelKey: "metricVanna" },
  { key: "charm", labelKey: "metricCharm" },
];

const AGGS: { min: number; labelKey: SurfaceKey }[] = [
  { min: 1, labelKey: "agg1m" },
  { min: 5, labelKey: "agg5m" },
  { min: 15, labelKey: "agg15m" },
  { min: 30, labelKey: "agg30m" },
];

// Range slider stops (± strikes/points around spot); 0 = All. Eighty points keeps the
// field contextual without letting remote LEAPS strikes flatten the useful chart.
const RANGE_STOPS = [20, 40, 80, 0];

/**
 * The CSS custom properties each metric's swatches read — the same pair the shader
 * resolves (lib/heatSeries METRIC_COLOR_VARS) and the same pair the theme engine writes
 * (components/surface/surfaceTheme METRIC_VAR). Keeping the legend/badge on these vars is
 * what makes a preset switch recolour the chrome and the field together.
 */
const METRIC_CSS: Record<Metric, { pos: string; neg: string }> = {
  netprem: { pos: "--metric-netprem-pos", neg: "--metric-netprem-neg" },
  gex: { pos: "--metric-gamma-pos", neg: "--metric-gamma-neg" },
  vanna: { pos: "--metric-vanna-pos", neg: "--metric-vanna-neg" },
  charm: { pos: "--metric-charm-pos", neg: "--metric-charm-neg" },
};

function css(n: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}

function fmtDollarSigned(v: number): string {
  const s = v < 0 ? "-" : "+";
  const a = Math.abs(v);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}

/** ISO asof → "HH:MM ET" in America/New_York (empty when absent). */
function fmtAsofLabel(asof: string | undefined): string {
  if (!asof) return "";
  try {
    return new Date(asof).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York",
    }) + " ET";
  } catch { return asof.slice(11, 16); }
}

/** Human-sized observed gap, without implying more precision than the snapshots carry. */
function fmtObservedCadence(seconds: number): string {
  if (seconds >= 60) {
    const minutes = seconds / 60;
    return `${Number.isInteger(minutes) ? minutes.toFixed(0) : minutes.toFixed(1)}m`;
  }
  return `${Math.round(seconds)}s`;
}

// ─── Y-axis framing ──────────────────────────────────────────────────────────
// The heat field and the candles share ONE price scale, and the field is two orders of
// magnitude taller than a session's price range (SPY: strikes 663-823 under a $743 spot
// that moves ~$5). Framing the axis on the strike extent — the only behaviour this pane
// had — left price as a ~12px hairline. The default window is therefore anchored to
// PRICE; strike rows outside it are simply clipped by the pane, which is the honest
// trade (the field is context, price is the subject). "Fit strikes" restores the whole
// field on demand, and the wheel/drag zoom moves between them continuously.

/** Zoom-out factor applied per wheel notch (its reciprocal zooms in). */
const Y_WHEEL_STEP = 1.12;
/** Narrowest / widest y window a wheel zoom may produce — stops a runaway scroll. */
const Y_SPAN_MIN = 0.05;
const Y_SPAN_MAX = 100_000;
/** Minimum hit width of the right price gutter, for the wheel-over-axis gesture. */
const Y_AXIS_HIT_MIN = 44;

export type SurfaceTimeWindow = "surface" | "session";

/**
 * A readable x-window around the timestamps the surface actually contains. A sparse live
 * field should occupy the chart instead of being compressed into the left edge of a full
 * 6.5-hour canvas. Twelve minutes of context on either side preserves price lead-in and
 * follow-through; a one-frame field still receives a useful 60-minute window.
 */
function observedTimeWindow(date: string, steps: string[]): { from: Time; to: Time } | null {
  if (!date || !steps.length) return null;
  const epochs = steps.map((s) => sessionEpoch(date, s)).filter((v) => Number.isFinite(v));
  if (!epochs.length) return null;
  const first = epochs[0];
  const last = epochs[epochs.length - 1];
  const context = 12 * 60;
  const minimum = 60 * 60;
  let from = first - context;
  let to = last + context;
  if (to - from < minimum) {
    const extra = (minimum - (to - from)) / 2;
    from -= extra;
    to += extra;
  }
  return { from: from as Time, to: to as Time };
}

/**
 * The PRICE-anchored window: the extent of the candles that will actually be drawn,
 * padded so price occupies ~37% of the pane and the field overflows around it. The caller
 * supplies bars already filtered to the selected session. Returns null when there is
 * nothing to anchor to (illiquid root or missing archive), which is the caller's cue to
 * fall back to the field window.
 */
function priceWindow(bars: Bar6[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const bar of bars) {
    if (Number.isFinite(bar[3]) && bar[3] < lo) lo = bar[3];
    if (Number.isFinite(bar[2]) && bar[2] > hi) hi = bar[2];
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return null;
  const center = (lo + hi) / 2;
  // 0.8% floor: a dead-flat session must still get a readable band rather than a
  // magnified tick, and it keeps the field visible either side of price.
  const focus = Math.max(hi - lo, Math.abs(center) * 0.008);
  if (!(focus > 0)) return null;
  return [center - focus * 1.35, center + focus * 1.35];
}

/**
 * The FIELD window: every painted strike row plus a 5.5% margin. This was the only
 * framing before; it is now the no-candles fallback and the explicit "Fit strikes" chip.
 */
function strikeWindow(levels: number[], spot?: number | null): [number, number] | null {
  if (!levels.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of levels) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const span = Math.max(max - min, Math.max(2, Math.abs(spot ?? max) * 0.01));
  const padding = span * 0.055;
  return [min - padding, max + padding];
}

interface Readout { strike: number; value: number }

/** A hovered strike row: the level, its index, the active-metric value, all-greek values
 *  at the current stamp, and the screen point to anchor the popover to. */
interface StrikeHover {
  strike: number;
  strikeIdx: number;
  pctFromSpot: number | null;
  active: { key: Metric; value: number };
  others: { key: Metric; value: number }[]; // other metrics present in this frame's grids
  x: number; // clientX for the fixed popover
  y: number; // clientY
}

/** All greek grid keys we might surface, in a stable order (label mapping via METRICS). */
const GREEK_KEYS: Metric[] = ["gex", "vanna", "charm"];

export interface SurfacePaneProps {
  root?: string;
  /**
   * Quad-view cell: pin this pane to one metric and drop the metric tabs. The cell still
   * feature-detects — a greek the snapshot doesn't carry shows the same "accruing" state
   * the tab strip uses, rather than an empty chart with no explanation.
   */
  fixedMetric?: Metric;
  /** `cell` strips the controls row / honesty note (the quad's shared toolbar owns them). */
  chrome?: "full" | "cell";
  /** Identity for crosshair sync inside a quad. Ignored outside a SurfaceSyncProvider. */
  syncId?: string;
  /** Aggregation is lifted to the shared toolbar in quad mode. */
  aggMinOverride?: number;
  /**
   * Signature of the active surface theme. Colours are read from CSS custom properties, so
   * a theme change only needs a re-resolve + re-shade — this prop is the trigger. The chart
   * is never torn down for a recolour.
   */
  themeSig?: string;
  /**
   * R1.4: which day-max normalizer feeds the shader — the 95th-percentile "Balanced"
   * default (kills the wash-out from one outlier strike-minute) or the pre-R1.4 "Raw"
   * literal max. Set from SurfaceView's persisted theme, same as `themeSig`.
   */
  contrastMode?: ContrastMode;
  /** Pinned strike levels, drawn as price lines ("send to chart"). */
  pins?: SurfacePin[];
  onTogglePin?: (strike: number, metric: string, value: number | null) => void;
  /** X-axis framing is shared across single/quad layouts by SurfaceView. */
  timeWindow?: SurfaceTimeWindow;
  onTimeWindowChange?: (window: SurfaceTimeWindow) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SurfacePane({
  root = "SPY",
  fixedMetric,
  chrome = "full",
  syncId,
  aggMinOverride,
  themeSig,
  contrastMode = "balanced",
  pins,
  onTogglePin,
  timeWindow = "surface",
  onTimeWindowChange,
}: SurfacePaneProps) {
  const { lang } = useLang();
  // F3: memoized on [lang] — these used to be fresh closures on EVERY render, and since
  // the Levels overlay effect below has `t` in its dep list, that tore down and recreated
  // up to 6 price lines on every crosshair mousemove (which re-renders via setReadout/
  // setHover). A stable function identity across a lang-unchanged render fixes it.
  const t = useMemo(() => makeSurfaceT(lang), [lang]);
  const gexT = useMemo(() => makeGexT(lang), [lang]);
  const { state: replayState, dispatch, asOfStamp, live, sessionDate, archived } = useReplay();
  const sync = useSurfaceSync();
  const isCell = chrome === "cell";
  // Nightly-derived overlays (Levels / regime / OI Δ) never truncate or interpolate to the
  // scrubbed minute — there is no intraday history behind gex:/gexstate:/oi_change:, so
  // truncating them would be fabrication. Off the live head they keep showing the value
  // they genuinely describe and wear EodReplayTag, exactly like the GEX ladder (T-B).
  // EodReplayTag reads its own off-head state from replayBus — no local mirror needed.

  // A quad cell is pinned to one metric by its parent; the full pane owns its own via the
  // tab strip. Deriving rather than mirroring into state keeps the two from drifting.
  const [metricState, setMetricState] = useState<Metric>("netprem");
  const metric: Metric = fixedMetric ?? metricState;
  const [aggMin, setAggMin] = useState<number>(5);
  const [opacity, setOpacity] = useState<number>(1);
  const [rangeQ, setRangeQ] = useState<number>(80);
  const [frame, setFrame] = useState<SurfaceFrame | null>(null);
  const [candles, setCandles] = useState<Bar6[]>([]);
  /** Session whose candle request has completed (including an honest empty response). */
  const [candleSession, setCandleSession] = useState<string | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [loading, setLoading] = useState(true);
  // Strike hover popover (RECON §4.2): the row under the crosshair + its screen anchor.
  const [hover, setHover] = useState<StrikeHover | null>(null);
  // Intraday-Evolution modal: the strike index it opened on (null = closed).
  const [modalIdx, setModalIdx] = useState<number | null>(null);
  // Per-strike-per-expiry cells for the modal's expiry breakdown (matrix payload; optional).
  const [matrixCells, setMatrixCells] = useState<MatrixCell[] | null>(null);

  // ── Nightly overlays (Levels / regime chip / OI Δ) — opt-in, session-only toggles.
  // Not persisted (unlike the Contrast toggle, which lives on the theme): these mirror
  // the pane's other session controls (opacity/range/agg), none of which survive a reload.
  const [levelsOn, setLevelsOn] = useState(false);
  const [oiDeltaOn, setOiDeltaOn] = useState(false);
  // F8: {root, ...} tuples rather than bare payload state, so a derive-memo can gate on
  // `store.root === root` and never read the PREVIOUS root's payload as if it were the
  // new root's while its own fetch is still in flight (same outcome GexDeskView gets by
  // nulling statePayload/matrix synchronously on ticker change — this achieves it via the
  // read-side gate instead of a write-side clear).
  const [levelsStore, setLevelsStore] = useState<{ root: string; gex: unknown; moves: unknown } | null>(null);
  const [regimeStore, setRegimeStore] = useState<{ root: string; data: unknown } | null>(null);
  const [oiChangeStore, setOiChangeStore] = useState<{ root: string; data: unknown } | null>(null);
  // F1: the ARCHIVED session's own dated Levels payload (gex_at:{root}:{date}) — kept
  // separate from `levelsStore` (the live gex:/moves: pair) so switching sessions can
  // never mix a dated snapshot into the live derivation or vice versa.
  const [archivedLevelsStore, setArchivedLevelsStore] =
    useState<{ root: string; sessionDate: string; gex: unknown } | null>(null);
  const [archivedLevelsLoading, setArchivedLevelsLoading] = useState(false);
  // True when the picked session has no published dated snapshot (accrual hole / a date
  // predating the gex_history plane) — its own honest state, never a silent fallback to
  // live gex:/moves:.
  const [archivedLevelsMissing, setArchivedLevelsMissing] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const heatSeriesRef = useRef<ISeriesApi<"Custom"> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const colorsRef = useRef<{ pos: Rgb; neg: Rgb }>(resolveMetricColors("netprem"));
  const frameRef = useRef<SurfaceFrame | null>(null);
  const metricRef = useRef<Metric>("netprem");
  const opacityRef = useRef<number>(1);
  // R1.4: which day-max normalizer applyShaderRef reads — set from the `contrastMode` prop.
  const contrastRef = useRef<ContrastMode>("balanced");
  const hoverIdxRef = useRef<number | null>(null); // latest hovered strike idx for click→modal
  // B9: the frame's time axis in display epochs, rebuilt ONCE per frame. The crosshair
  // handler used to construct one Date per session column on every mousemove (~390 for a
  // full 1-min day); it now binary-free scans this prebuilt array instead.
  const timeEpochsRef = useRef<number[]>([]);
  // The vertical viewport is set on first paint and when the user explicitly changes the
  // strike range. Replay frames and metric switches must not re-enable autoscale and crush
  // the useful strikes back into a thin line.
  const priceRangeKeyRef = useRef<string | null>(null);
  // The y window we last committed, mirrored here so the wheel zoom always has a base to
  // scale from. IPriceScaleApi.getVisibleRange is preferred when it answers (it also picks
  // up an axis DRAG), but it is not relied on — this ref is the fallback.
  const yDomainRef = useRef<[number, number]>([0, 0]);
  // The strike levels actually painted (post range-filter) — what "Fit strikes" fits to.
  const levelsRef = useRef<number[]>([]);
  // The session's full stamp list, so the axis can be pinned to the WHOLE day.
  const stampsRef = useRef<string[]>([]);
  // Live price lines for pinned strikes, by pin id (send-to-chart).
  const pinLinesRef = useRef<Map<string, { series: ISeriesApi<"Candlestick"> | ISeriesApi<"Custom">; line: unknown }>>(new Map());
  // Options-levels overlay lines (call/put wall, flip, EM band), keyed by OptLevelKey —
  // redrawn wholesale on toggle/data change (small, fixed-size set; unlike pins there is
  // nothing to reconcile incrementally).
  // N1: each entry carries the HOST it was drawn on (same idiom as pinLinesRef's `series`
  // field below) — a host flip (F4/R1: candle series gains/loses its first plotted bar)
  // between the draw run and a later cleanup run must remove each line from the series it
  // actually lives on. LWC's removePriceLine() is a silent no-op for a line belonging to a
  // DIFFERENT series, so removing via "whichever host this effect run currently resolves
  // to" orphaned the old host's lines — the exact set doubling this fixes.
  const levelLinesRef = useRef<{ key: string; host: unknown; line: unknown }[]>([]);
  // OI Δ strike-axis badges: lineVisible:false price lines (axis-label-only markers), one
  // per top-N strike — "subtle... on the field's strike axis", never a full-width line.
  // N1: same host-per-entry fix as levelLinesRef above.
  const oiLinesRef = useRef<{ host: unknown; line: unknown }[]>([]);
  // F1: request counter for the archived-Levels dated fetch (gex_at:{root}:{sessionDate})
  // — mirrors GexDeskView.loadSession's sessionReqRef, dropping a stale response that
  // resolves after a newer pick (or a return-to-live) already superseded it.
  const archivedLevelsReqRef = useRef(0);
  // The crosshair handler is registered once at mount; reading sync through a ref keeps it
  // off the mount effect's dep list (and out of stale-closure territory).
  const syncRef = useRef({ sync, id: syncId });
  useEffect(() => { syncRef.current = { sync, id: syncId }; }, [sync, syncId]);
  useEffect(() => { metricRef.current = metric; }, [metric]);
  useEffect(() => { opacityRef.current = opacity; }, [opacity]);
  useEffect(() => { contrastRef.current = contrastMode; }, [contrastMode]);
  useEffect(() => { hoverIdxRef.current = hover?.strikeIdx ?? null; }, [hover]);
  const effAggMin = aggMinOverride ?? aggMin;
  // The route slices server-side so a single-session pane does not receive 20,000 deep
  // history bars. Keep the same filter client-side as a contract boundary: a stale CDN,
  // fixture, or older server must never be able to flatten this chart again.
  const candleSessionDate = frame?.session_date ?? null;
  const sessionCandles = useMemo(
    () => candleSessionDate ? filterBarsToSessionDate(candles, candleSessionDate) : [],
    [candles, candleSessionDate],
  );
  // F4/R1: candleSeriesRef.current is assigned UNCONDITIONALLY once the chart mounts (the
  // candle series is always created — see the mount effect below), so
  // `candleSeriesRef.current ?? heatSeriesRef.current` never actually falls back, even
  // when the candle series has ZERO plotted rows — and Lightweight-Charts draws NO price
  // line on a series with no data. Host selection for every price-line overlay (pins,
  // Levels, OI Δ) must key on DATA PRESENCE, not ref truthiness.
  //
  // `sessionCandles.length` alone is NOT that presence signal: the candle series below is
  // fed CUTOFF-filtered bars plus a whitespace tail (PIT truncation to the replay stamp),
  // so a scrub before this session's first drawn bar leaves the series with zero real plot
  // rows (LWC: null firstValue, no price line drawable) while `sessionCandles.length` is
  // still > 0 (the whitespace tail alone). The cutoff computation is hoisted here so both
  // the candle-draw effect below and host selection agree on what's actually plotted.
  const cutoffBars = useMemo(() => {
    if (!sessionCandles.length) return { cutoff: Infinity, kept: [] as Bar6[], drawn: [] as Bar6[] };
    const date = frame?.session_date;
    let cutoff = Infinity;
    if (!live && asOfStamp && date && asOfStamp.length >= 4) {
      const e = sessionEpoch(date, `${asOfStamp.slice(0, 2)}:${asOfStamp.slice(2, 4)}`);
      if (Number.isFinite(e)) cutoff = e;
    }
    const kept = sessionCandles.filter((b, i, arr) => i === 0 || b[0] !== arr[i - 1][0]);
    const drawn = kept.filter((b) => b[0] <= cutoff);
    return { cutoff, kept, drawn };
  }, [sessionCandles, live, asOfStamp, frame?.session_date]);
  // The boolean host selection actually needs. It only flips at the empty/non-empty
  // boundary (not per-frame during ordinary playback once past the first drawn bar), so
  // this doesn't churn the price-line effects on every scrub tick — see N1 above for why a
  // flip, however rare, must be orphan-safe (each line remembers the host it was drawn on).
  const hasDrawnBars = cutoffBars.drawn.length > 0;

  // Apply the shader to the heat series from the CURRENT frame/metric/opacity/colors.
  // Ref-backed (reads *Ref values) so the chart-mount effect and the MutationObserver
  // can call it without a declaration-order/stale-closure hazard.
  const applyShaderRef = useRef(() => {
    const heat = heatSeriesRef.current;
    if (!heat) return;
    const grid = frameRef.current?.grids[metricRef.current];
    // R1.4 ("kill the bland"): Balanced clamps the day-max normalizer to the 95th
    // percentile of |cell| (gridPercentileAbs) instead of the single largest cell, so one
    // outlier strike-minute cannot wash out the rest of the field. heatShade itself is
    // untouched — its o = min(1, |amount|/maxAbs) clamp already saturates everything past
    // the percentile to full intensity. Raw keeps the pre-R1.4 literal max.
    const maxAbs = grid ? (contrastRef.current === "raw" ? gridMaxAbs(grid) : gridPercentileAbs(grid)) : 0;
    const { pos, neg } = colorsRef.current;
    const W = opacityRef.current;
    // F9: re-measured properly (double requestAnimationFrame awaited before checksumming
    // the canvas, instead of a synchronous read) — the prior "pane doesn't repaint" claim
    // does not hold up against the pinned lightweight-charts 5.2.0 source. Series.
    // applyOptions() (below) calls model._internal_updateSource(this), which fires
    // _private__invalidate() at InvalidationLevel.Light — the SAME requestAnimationFrame-
    // scheduled _private__invalidateHandler the removed chart-level `applyOptions({})`
    // no-op rode (it forced InvalidationLevel.Full instead; ChartModel._internal_
    // applyOptions unconditionally ends in _internal_fullUpdate(), even for `{}`). A
    // synchronous pixel-checksum taken immediately after either call reads the canvas
    // BEFORE that rAF-scheduled frame has painted — that race, not a real invalidation
    // gap, is what the original measurement caught. The series call already schedules its
    // own repaint; no forced chart-level no-op is needed.
    heat.applyOptions({
      cellShader: (amount: number) => heatShade(amount, maxAbs, pos, neg, W),
      opacity: W,
    } as Partial<HeatSeriesOptions>);
  });

  // Commit a y window. THE single writer of the price scale's visible range: every path
  // (first framing, the fit chips, the wheel zoom) goes through here so yDomainRef can
  // never drift from what is drawn. Returns false when the chart has not finished its
  // first layout — the caller then declines to commit its key and a later frame retries.
  const applyYRef = useRef((from: number, to: number): boolean => {
    const scale = chartRef.current?.priceScale("right");
    if (!scale || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return false;
    try {
      scale.setVisibleRange({ from, to });
      scale.setAutoScale(false);
      yDomainRef.current = [from, to];
      return true;
    } catch {
      return false;
    }
  });

  // The window a wheel zoom scales from. The live range when the API answers (so an axis
  // drag is respected), otherwise the last window we wrote.
  const readYRef = useRef((): [number, number] | null => {
    try {
      const r = chartRef.current?.priceScale("right").getVisibleRange();
      if (r && Number.isFinite(r.from) && Number.isFinite(r.to) && r.to > r.from) return [r.from, r.to];
    } catch {
      /* not available on this build — the mirror below is the contract */
    }
    const [lo, hi] = yDomainRef.current;
    return hi > lo ? [lo, hi] : null;
  });

  // ── Seed the replay stamps from the index (once per root/session) ────────────
  // An archived session reads its own dated index; today reads the legacy live path, which
  // is untouched. A dated index that comes back malformed (or empty) yields no stamps — the
  // bar says so rather than falling back to another day's frame list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await flowGet(
        sessionDate ? `surface_idx_at:${root}:${sessionDate}` : `surface_idx:${root}`,
      );
      if (cancelled) return;
      if (isSurfaceIndex(data)) {
        dispatch({ type: "setStamps", stamps: data.stamps, keepHead: true });
      } else {
        dispatch({ type: "setStamps", stamps: [] });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, sessionDate]);

  // ── Fetch the frame for the scrubbed stamp ───────────────────────────────────
  // All state writes happen inside the async task (never synchronously in the effect
  // body) so mounting doesn't fire a synchronous cascading re-render before the fetch
  // even starts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!asOfStamp) {
        if (!cancelled) { setFrame(null); setLoading(false); }
        return;
      }
      setLoading(true);
      const data = await flowGet(
        sessionDate
          ? `surface_at:${root}:${sessionDate}:${asOfStamp}`
          : `surface:${root}:${asOfStamp}`,
      );
      if (cancelled) return;
      const nextFrame = isSurfaceFrame(data) ? data : null;
      setFrame(nextFrame);
      // If the active greek metric isn't carried by this frame, fall back to the premium
      // field (always present) so the pane never sits on a dead tab. Done here inside the
      // async task (with the frame write) rather than a separate setState-in-effect.
      // A quad cell is EXEMPT: its whole job is to hold one metric's slot, so an absent
      // greek must show the honest "accruing" state, not silently become a second
      // Net-Premium panel next to the real one.
      if (!fixedMetric && metricRef.current !== "netprem" && (!nextFrame || !metricEnabled(nextFrame, metricRef.current))) {
        setMetricState("netprem");
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [root, sessionDate, asOfStamp, fixedMetric]);

  useEffect(() => { frameRef.current = frame; }, [frame]);
  useEffect(() => { stampsRef.current = replayState.stamps ?? []; }, [replayState.stamps]);

  // B9: precompute the frame's column epochs once per frame. The crosshair handler reads
  // this array; it used to build a Date per column on every single mousemove.
  useEffect(() => {
    if (!frame || !frame.time_steps.length) { timeEpochsRef.current = []; return; }
    const date = frame.session_date ?? new Date().toISOString().slice(0, 10);
    timeEpochsRef.current = frame.time_steps.map((hhmm) => sessionEpoch(date, hhmm));
  }, [frame]);

  // ── Per-strike-per-expiry matrix (modal expiry breakdown; optional per root) ──
  // The matrix payload (options_structure.matrix) exists only for some roots — absent →
  // the modal simply omits the expiry-breakdown section rather than fabricating it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await flowGet(`matrix:${root}`);
        if (cancelled) return;
        const raw = (data as { cells?: unknown })?.cells;
        if (!Array.isArray(raw)) { setMatrixCells(null); return; }
        const cells: MatrixCell[] = [];
        for (const c of raw) {
          if (!c || typeof c !== "object") continue;
          const rec = c as Record<string, unknown>;
          const strike = Number(rec.strike);
          const expiry = typeof rec.expiry === "string" ? rec.expiry : "";
          const gex = Number(rec.gex);
          if (Number.isFinite(strike) && expiry) cells.push({ strike, expiry, gex: Number.isFinite(gex) ? gex : 0 });
        }
        setMatrixCells(cells.length ? cells : null);
      } catch {
        if (!cancelled) setMatrixCells(null);
      }
    })();
    return () => { cancelled = true; };
  }, [root]);

  // ── Nightly overlays: options levels + regime + OI Δ (root-keyed, once per root) ─────
  // These are the SAME options_hub / options_structure payloads ChartPanel's Options
  // Levels overlay and the screener/watchlist/ticker regime dot already read — fetched
  // here (not stamp-keyed: nightly data has no intraday history to re-fetch per scrub).
  // F8: no explicit "clear on root switch" call is needed here — every derive-memo below
  // is gated on `store.root === root`, so a store still holding the PREVIOUS root's
  // payload while this fetch is in flight already reads as unusable/stale there (same
  // outcome GexDeskView gets by nulling statePayload/matrix synchronously on ticker
  // change; this achieves it via the read-side gate instead, which avoids a synchronous
  // setState directly in the effect body — see react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [g, m] = await Promise.all([flowGet(`gex:${root}`), flowGet(`moves:${root}`)]);
      if (!cancelled) setLevelsStore({ root, gex: g, moves: m });
    })();
    return () => { cancelled = true; };
  }, [root]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await flowGet(`gexstate:${root}`);
      if (!cancelled) setRegimeStore({ root, data });
    })();
    return () => { cancelled = true; };
  }, [root]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await flowGet(`oi_change:${root}`);
      if (!cancelled) setOiChangeStore({ root, data });
    })();
    return () => { cancelled = true; };
  }, [root]);

  // ── F1: archived-session Levels — the dated gex_at:{root}:{sessionDate} twin ────────
  // Mirrors GexDeskView.loadSession: a request counter drops a stale response (a slow
  // probe superseded by a newer pick, or a return-to-live). `gex_dates:{root}` is an
  // ENUMERATION aid for the desk's own session picker elsewhere, never a fetch gate (see
  // GexDeskView's own comment on `sessionDates` — "the scrubber's explicit per-date probe
  // still works") — SurfacePane has no picker of its own, so it probes the specific date
  // `sessionDate` (owned by the shared ReplayProvider) directly, exactly like the desk's
  // scrubber does. `gex_at:` carries the identical options_hub.gex/v1 schema as the live
  // `gex:` key, so it derives through the SAME deriveOptLevels the live path uses below —
  // never a second, drifting implementation.
  useEffect(() => {
    const req = ++archivedLevelsReqRef.current;
    // The whole body (including the synchronous "reset" branches) runs inside the async
    // task rather than directly in the effect body — same reasoning as the frame-fetch
    // effect above (react-hooks/set-state-in-effect): a setState call textually inside a
    // nested async function is not "synchronously within the effect".
    void (async () => {
      if (!archived || !sessionDate) {
        setArchivedLevelsStore(null);
        setArchivedLevelsLoading(false);
        setArchivedLevelsMissing(false);
        return;
      }
      setArchivedLevelsStore(null);
      setArchivedLevelsLoading(true);
      setArchivedLevelsMissing(false);
      const data = await flowGet(`gex_at:${root}:${sessionDate}`);
      if (archivedLevelsReqRef.current !== req) return; // superseded — drop
      const rec = data as { by_strike?: unknown } | null;
      const ok = !!rec && Array.isArray(rec.by_strike) && rec.by_strike.length > 0;
      setArchivedLevelsStore(ok ? { root, sessionDate, gex: data } : null);
      setArchivedLevelsMissing(!ok);
      setArchivedLevelsLoading(false);
    })();
  }, [root, sessionDate, archived]);

  // F1: which overlays may draw during an archived session (lib/surfaceContract) —
  // regime + OI Δ are withdrawn outright (no dated twin); Levels stays live, sourced ONLY
  // from the dated payload above.
  const overlayPolicy = archivedOverlayPolicy(archived);

  // Pure derivations (lib/optionsLevels, lib/mscGlance, lib/surfaceContract) — never
  // recomputed on a replay scrub, only when the root/session or the raw payload changes.
  // F8: each is gated on `store.root === root` so a root switch mid-flight can never
  // derive against the previous ticker's payload.
  const liveOptLevels = useMemo(
    () => (levelsStore && levelsStore.root === root ? deriveOptLevels(levelsStore.gex, levelsStore.moves, root) : EMPTY_OPT_LEVELS),
    [levelsStore, root],
  );
  // F1: derived from the DATED payload only, with movesRaw=null — there is no dated
  // `moves:` twin, and deriveOptLevels already treats a null movesRaw as "drop only the
  // EM band" (see optionsLevels.test.ts "missing moves drops only the EM band"), so this
  // reuses that existing, already-tested path rather than a new EM-omission branch.
  const archivedOptLevels = useMemo(
    () => (archivedLevelsStore && archivedLevelsStore.root === root && archivedLevelsStore.sessionDate === sessionDate
      ? deriveOptLevels(archivedLevelsStore.gex, null, root)
      : EMPTY_OPT_LEVELS),
    [archivedLevelsStore, root, sessionDate],
  );
  // The effective Levels result every consumer below draws from. During an archived
  // session this is ALWAYS archivedOptLevels — liveOptLevels is never read for drawing,
  // satisfying F1's "do NOT run deriveOptLevels(live gex, live moves) for an archived
  // session" (liveOptLevels still computes — hooks can't branch — it is simply unused).
  const optLevels = overlayPolicy.useDatedLevels ? archivedOptLevels : liveOptLevels;

  // Regime + OI Δ: the memos still compute during an archived session (hooks can't
  // branch), but are never rendered or drawn while overlayPolicy.regimeWithdrawn /
  // .oiDeltaWithdrawn is true — see the render section and the two overlay effects below.
  const glanceRow = useMemo(
    () => (regimeStore && regimeStore.root === root ? parseGlanceState(regimeStore.data, root) : null),
    [regimeStore, root],
  );
  const oiChangeCells = useMemo(
    () => (oiChangeStore && oiChangeStore.root === root ? parseOiChangeRows(oiChangeStore.data, root) : []),
    [oiChangeStore, root],
  );
  const topOiStrikes = useMemo(() => topOiChangeStrikes(oiChangeCells, 5), [oiChangeCells]);

  // ── Intraday candles (per agg) ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const date = frame?.session_date;
      if (!date) {
        if (!cancelled) { setCandles([]); setCandleSession(null); }
        return;
      }
      try {
        const r = await fetch(
          `/api/intraday?sym=${encodeURIComponent(root)}&tf=${effAggMin}m&date=${encodeURIComponent(date)}`,
          { cache: "no-store" },
        );
        if (!r.ok) {
          if (!cancelled) { setCandles([]); setCandleSession(date); }
          return;
        }
        const j = await r.json();
        if (!cancelled) {
          setCandles(Array.isArray(j?.bars) ? (j.bars as Bar6[]) : []);
          setCandleSession(date);
        }
      } catch {
        if (!cancelled) { setCandles([]); setCandleSession(date); }
      }
    })();
    return () => { cancelled = true; };
  }, [root, effAggMin, frame?.session_date]);

  // ── Chart lifecycle: create once, tear down on unmount ───────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Captured for the cleanup closure — the Map identity is stable for the pane's life.
    const pinLines = pinLinesRef.current;

    const chart = createChart(el, {
      width: el.clientWidth || 800,
      height: el.clientHeight || 420,
      layout: { background: { color: "transparent" }, textColor: css("--muted") || "#868d9c", fontSize: 10, attributionLogo: false },
      grid: {
        vertLines: { color: css("--grid") || "rgba(255,255,255,0.04)" },
        horzLines: { color: css("--grid") || "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        vertLine: { color: "rgba(214,218,227,.28)", labelBackgroundColor: css("--panel-3") || "#1a1d24" },
        horzLine: { color: "rgba(214,218,227,.28)", labelBackgroundColor: css("--panel-3") || "#1a1d24" },
      },
      rightPriceScale: { borderColor: css("--line") || "#242832", scaleMargins: { top: 0.06, bottom: 0.06 } },
      // fixLeftEdge: the replay truncates the series as you scrub back, and without this
      // Lightweight-Charts keeps the RIGHT edge anchored — so the shrinking day slides across
      // the pane instead of emptying out from the right. Pinning the left edge keeps 09:31
      // where it is and lets the session drain backwards, which is what a scrubber should do.
      timeScale: {
        borderColor: css("--line") || "#242832", timeVisible: true, secondsVisible: false,
        rightOffset: 3, fixLeftEdge: true,
      },
      // axisDoubleClickReset.price OFF: the default "reset" re-enables autoscale, which
      // autoscales to the UNION of the candles and the heat field — i.e. it restores the
      // full strike extent and squeezes price back into a hairline. There is nothing for
      // a price reset to restore here that "Fit price" / "Fit strikes" don't do honestly.
      // The time axis keeps its reset; the price axis keeps its press-drag scale.
      handleScale: {
        axisDoubleClickReset: { price: false, time: true },
        axisPressedMouseMove: { price: true, time: true },
        mouseWheel: true,
        pinch: true,
      },
    });
    chartRef.current = chart;

    const heat = chart.addCustomSeries(new HeatSeries(), {
      cellShader: () => "rgba(0,0,0,0)",
      opacity: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    } as Partial<HeatSeriesOptions>);
    heatSeriesRef.current = heat as ISeriesApi<"Custom">;

    // Resolved from the theme's directional tokens (East-Asian flip aware) — never a
    // hardcoded direction hex. css() reads :root, which always defines --up/--down.
    const up = css("--up");
    const down = css("--down");
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down,
      borderUpColor: up, borderDownColor: down,
      wickUpColor: up, wickDownColor: down,
      priceLineVisible: false, lastValueVisible: true,
    });
    candleSeriesRef.current = candle;

    // Crosshair readout: nearest strike level + its amount at the crosshair time.
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      const f = frameRef.current;
      if (!param.point || !f || !f.price_levels.length) {
        setReadout(null);
        setHover(null);
        const s0 = syncRef.current;
        if (s0.sync.active && s0.id) s0.sync.publish(s0.id, null);
        return;
      }
      // Map the crosshair Y → price via the price scale. Prefer the candle series, but fall
      // back to the heat series when candles are empty (fixture / illiquid roots) — they
      // share the right price scale, and the heat field always has data when a frame loads.
      const price = candle.coordinateToPrice(param.point.y) ?? heat.coordinateToPrice(param.point.y);
      if (price == null) { setReadout(null); setHover(null); return; }
      // nearest strike level to the crosshair price
      let li = 0, best = Infinity;
      for (let i = 0; i < f.price_levels.length; i++) {
        const d = Math.abs(f.price_levels[i] - price);
        if (d < best) { best = d; li = i; }
      }
      // nearest time column to the crosshair time — scans the epochs precomputed on the
      // frame effect (B9: this loop used to allocate a Date per column per mousemove).
      const grid = f.grids[metricRef.current];
      let ti = (grid?.[li]?.length ?? 1) - 1;
      const timeSec = typeof param.time === "number" ? (param.time as number) : null;
      const epochs = timeEpochsRef.current;
      if (timeSec != null && epochs.length) {
        let bestT = Infinity;
        for (let k = 0; k < epochs.length; k++) {
          const d = Math.abs(epochs[k] - timeSec);
          if (d < bestT) { bestT = d; ti = k; }
        }
      }
      const value = grid?.[li]?.[ti] ?? 0;
      const strike = f.price_levels[li];
      setReadout({ strike, value });

      // Quad: broadcast the pointer so the other three fields light the same strike-minute.
      const s = syncRef.current;
      if (s.sync.active && s.id && timeSec != null) {
        s.sync.publish(s.id, { time: timeSec, price: strike });
      }

      // Strike hover popover: active-metric value + any other greek grids present, at this
      // stamp. Anchored to the wrapper's client rect (fixed layer → no overflow clipping).
      const others: { key: Metric; value: number }[] = [];
      for (const k of GREEK_KEYS) {
        if (k === metricRef.current) continue;
        const g2 = f.grids[k];
        if (metricEnabled(f, k) && g2?.[li]) others.push({ key: k, value: g2[li][ti] ?? 0 });
      }
      const rect = el.getBoundingClientRect();
      const spot = f.spot;
      setHover({
        strike,
        strikeIdx: li,
        pctFromSpot: spot != null && spot !== 0 ? ((strike - spot) / spot) * 100 : null,
        active: { key: metricRef.current, value },
        others,
        x: rect.left + param.point.x,
        y: rect.top + param.point.y,
      });
    });

    // Click a strike → open the Intraday-Evolution modal for the hovered strike row.
    chart.subscribeClick((param: MouseEventParams) => {
      if (!param.point) return;
      const idx = hoverIdxRef.current;
      if (idx != null) setModalIdx(idx);
    });

    const ro = new ResizeObserver(() => {
      if (el && chartRef.current) {
        chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      }
    });
    ro.observe(el);

    // Y zoom. Lightweight-Charts spends the wheel on the TIME axis and leaves the price
    // axis with nothing but an undiscoverable gutter drag — on a field this tall that is
    // the difference between reading price and guessing at it. Wheel over the price
    // gutter, or shift+wheel anywhere, scales the price window around the pointer.
    //
    // CAPTURE phase + stopPropagation: the library's own wheel handler lives on the chart
    // widget element INSIDE this container and ignores modifiers, so a bubble-phase
    // listener would arrive after the time axis had already zoomed. Claiming the event on
    // the way down is what keeps the two gestures separate.
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      let gutter = Y_AXIS_HIT_MIN;
      try { gutter = Math.max(Y_AXIS_HIT_MIN, chartRef.current?.priceScale("right").width() ?? 0); } catch {}
      const overAxis = e.clientX > rect.right - gutter;
      if (!overAxis && !e.shiftKey) return; // plain wheel over the field keeps time zoom
      // macOS reports a shift-held wheel on the X axis, so read whichever one moved —
      // otherwise shift+wheel would fall through and SCROLL the chart sideways.
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      const domain = readYRef.current();
      if (!domain) return;
      const [lo, hi] = domain;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      const y = e.clientY - rect.top;
      const anchor =
        candleSeriesRef.current?.coordinateToPrice(y) ??
        heatSeriesRef.current?.coordinateToPrice(y) ??
        (lo + hi) / 2;
      const k = delta > 0 ? Y_WHEEL_STEP : 1 / Y_WHEEL_STEP;
      const from = anchor - (anchor - lo) * k;
      const to = anchor + (hi - anchor) * k;
      const span = to - from;
      if (span < Y_SPAN_MIN || span > Y_SPAN_MAX) return;
      applyYRef.current(from, to);
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });

    // Re-resolve shader colors on theme / data-updown flips. Resolve against the pane
    // element so the .obs-scoped greek pair vars (vanna/charm) are seen — not just :root.
    const mo = new MutationObserver(() => {
      colorsRef.current = resolveMetricColors(metricRef.current, el);
      applyShaderRef.current();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-updown", "class"] });

    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("wheel", onWheel, { capture: true });
      try { chart.remove(); } catch {}
      chartRef.current = null;
      heatSeriesRef.current = null;
      candleSeriesRef.current = null;
      // The removed chart took its price lines with it; drop the handles so a remount
      // re-creates them from `pins` instead of holding references to a dead chart.
      pinLines.clear();
      levelLinesRef.current = [];
      oiLinesRef.current = [];
    };
  }, []);

  // ── Push heat bars + candles when data / controls change ────────────────────
  useEffect(() => {
    const heat = heatSeriesRef.current;
    if (!heat) return;
    colorsRef.current = resolveMetricColors(metric, wrapRef.current);

    if (!frame || !frame.grids[metric]) {
      heat.setData([]);
      return;
    }
    const date = frame.session_date ?? new Date().toISOString().slice(0, 10);
    // B11: the DISPLAY-EPOCH convention every intraday series on this axis uses (see
    // lib/intradayShared sessionEpoch). Anchoring to the true UTC instant instead put the
    // field 4h (EDT) to the right of its own candles and labelled the 09:31 column "13:31".
    const anchor = (hhmm: string): Time => sessionEpoch(date, hhmm) as unknown as Time;
    const shown = rangeQ > 0 && frame.spot != null ? filterFrameToRange(frame, frame.spot, rangeQ) : frame;
    const bars: HeatData[] = buildHeatBars(shown, metric, anchor);
    heat.setData(bars);
    applyShaderRef.current();
    const levelValues = shown.price_levels.filter((v) => Number.isFinite(v));
    levelsRef.current = levelValues;
    // `sessionCandles.length` is in the key so the window is (re)computed once the bars actually
    // arrive — the first pass runs with an empty array and would otherwise lock in the
    // candle-less fallback for the session. Nothing else in the key moves on a replay
    // scrub or a metric switch, so a scrub still cannot yank the user's zoom.
    const rangeKey = `${root}:${frame.session_date ?? ""}:${rangeQ}:${sessionCandles.length}`;
    if (levelValues.length > 0 && priceRangeKeyRef.current !== rangeKey) {
      // Price first, field second. The bars are already pinned to this frame's session.
      const win = priceWindow(sessionCandles) ?? strikeWindow(levelValues, frame.spot);
      // A failed apply leaves the key uncommitted on purpose: the chart may still be
      // completing its first layout, and a later frame retries.
      if (win && applyYRef.current(win[0], win[1])) priceRangeKeyRef.current = rangeKey;
    }
  }, [frame, metric, rangeQ, root, sessionCandles, candleSession]);

  // Re-apply the shader when opacity changes (data unchanged).
  useEffect(() => { applyShaderRef.current(); }, [opacity]);

  // Re-apply the shader when the Contrast mode changes (R1.4) — the frame doesn't change,
  // only which day-max normalizer feeds heatShade.
  useEffect(() => { applyShaderRef.current(); }, [contrastMode]);

  // ── Theme engine: recolour in place, no remount ─────────────────────────────
  // The pane's colours come from CSS custom properties, and the theme writes those onto an
  // ancestor. Custom properties inherit, so by the time this effect runs the new values are
  // already computed on our element — re-resolving and re-shading is the whole update. The
  // chart, its data and the user's zoom all survive a palette change untouched.
  useEffect(() => {
    if (!heatSeriesRef.current) return;
    colorsRef.current = resolveMetricColors(metricRef.current, wrapRef.current);
    applyShaderRef.current();
  }, [themeSig]);

  // ── Quad crosshair sync: mirror a sibling cell's pointer ────────────────────
  useEffect(() => {
    if (!sync.active || !syncId) return;
    return sync.subscribe(syncId, (pos) => {
      const chart = chartRef.current;
      const target = candleSeriesRef.current ?? heatSeriesRef.current;
      if (!chart || !target) return;
      try {
        if (pos) chart.setCrosshairPosition(pos.price, pos.time as unknown as Time, target);
        else chart.clearCrosshairPosition();
      } catch {
        /* the sibling may be on a time the chart hasn't painted — ignore, don't crash */
      }
    });
  }, [sync, syncId]);

  // ── Pinned strike levels → price lines (send to chart) ──────────────────────
  // Reconciled against the incoming pin list: add what's new, drop what's gone. The line is
  // attached to the candle series when candles exist and to the heat series otherwise —
  // they share the right price scale, so the level lands in the same place either way, and
  // a root with no candle data (illiquid, or fixture) still gets its pins drawn.
  // F4/R1: host selection keys on `hasDrawnBars` (whether the candle series actually has
  // plotted rows right now, not merely `sessionCandles.length`), not `candleSeriesRef.
  // current` truthiness — the candle series is always non-null once mounted, so a
  // `?? heatSeriesRef.current` fallback never actually fired, and LWC draws no price line
  // on a series with zero plotted rows (illiquid root, or a replay scrub before this
  // session's first DRAWN candle — sessionCandles can be non-empty from the whitespace
  // tail alone) — silently vanishing pins while the chip still read "on".
  useEffect(() => {
    const host = hasDrawnBars ? candleSeriesRef.current : heatSeriesRef.current;
    if (!host) return;
    const want = new Map((pins ?? []).map((p) => [p.id, p]));
    const drawn = pinLinesRef.current; // NOT the replay `live` flag — different thing

    for (const [id, rec] of drawn) {
      if (want.has(id)) continue;
      try { (rec.series as unknown as { removePriceLine: (l: unknown) => void }).removePriceLine(rec.line); } catch {}
      drawn.delete(id);
    }
    for (const [id, pin] of want) {
      if (drawn.has(id)) continue;
      try {
        const line = (host as unknown as { createPriceLine: (o: unknown) => unknown }).createPriceLine({
          price: pin.strike,
          color: css("--signal") || "#e8b339",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: String(pin.strike),
        });
        drawn.set(id, { series: host, line });
      } catch {
        /* LWC rejected the level (no price scale yet) — the chip still lists it */
      }
    }
  }, [pins, hasDrawnBars]);

  // ── Options-levels overlay ("Levels" toggle) — call wall / put wall / gamma flip / abs-γ
  // / EM band as createPriceLine, mirroring ChartPanel's Options Levels overlay idiom
  // exactly (same colours, same dash convention: solid walls, dashed flip, dotted abs-γ/EM)
  // so a level reads the same whether it's found on the price chart or the surface field.
  // Redrawn wholesale (not reconciled like pins) — the set is small and fixed-shape.
  // `optLevels` is already the F1-effective result (archived → the dated derivation only,
  // live → the live one) — this effect never has to branch on `overlayPolicy` itself.
  useEffect(() => {
    const host = hasDrawnBars ? candleSeriesRef.current : heatSeriesRef.current; // F4/R1
    if (!host) return;
    const h = host as unknown as {
      createPriceLine: (o: unknown) => unknown;
      removePriceLine: (l: unknown) => void;
    };
    // N1: remove each line from the host it was ACTUALLY drawn on (lib/surfaceContract
    // removeHostedLines), not the host this run resolves to — a run can start after a
    // host flip (candle series gains/loses its first plotted bar between draws), and
    // removePriceLine() silently no-ops on a foreign series.
    removeHostedLines(levelLinesRef.current);
    levelLinesRef.current = [];
    if (!levelsOn || optLevels.status !== "ok") return;
    const style: Record<OptLevelKey, { color: string; dash: number; title: string }> = {
      call_wall: { color: css("--brand-2") || "#4d82ff", dash: 0, title: t("levelCallWall") },
      put_wall: { color: css("--down") || "#f0566b", dash: 0, title: t("levelPutWall") },
      gamma_flip: { color: css("--ai") || "#9d86ff", dash: 2, title: t("levelFlip") },
      abs_gamma: { color: css("--signal") || "#e8b339", dash: 1, title: t("levelAbsGamma") },
      em_hi: { color: css("--muted") || "#8b93a3", dash: 1, title: t("levelEmHi") },
      em_lo: { color: css("--muted") || "#8b93a3", dash: 1, title: t("levelEmLo") },
    };
    for (const lv of optLevels.levels) {
      const s = style[lv.key];
      if (!s) continue;
      try {
        const line = h.createPriceLine({
          price: lv.price, color: s.color, lineWidth: 1, lineStyle: s.dash,
          axisLabelVisible: true, title: s.title,
        });
        levelLinesRef.current.push({ key: lv.key, host, line });
      } catch {
        /* LWC rejected the level (no price scale yet) — the toggle stays on and retries
           on the next data/root change. */
      }
    }
  }, [levelsOn, optLevels, t, hasDrawnBars]);

  // ── OI Δ toggle: badge the top-5 strikes by |ΔOI| on the strike axis. `lineVisible:
  // false` draws NOTHING across the pane's width — only the coloured axis-label badge —
  // so this reads as a subtle strike-axis marker (per the brief) rather than a second set
  // of full-width lines competing visually with the Levels overlay.
  useEffect(() => {
    const host = hasDrawnBars ? candleSeriesRef.current : heatSeriesRef.current; // F4/R1
    if (!host) return;
    const h = host as unknown as {
      createPriceLine: (o: unknown) => unknown;
      removePriceLine: (l: unknown) => void;
    };
    // N1: remove from the host each line was actually drawn on (see levelLinesRef above).
    removeHostedLines(oiLinesRef.current);
    oiLinesRef.current = [];
    // F1: withdrawn outright during an archived session — never draw badges from TODAY's
    // oi_change: data under a past session's field.
    if (!oiDeltaOn || overlayPolicy.oiDeltaWithdrawn || !topOiStrikes.size) return;
    const badge = css("--signal") || "#e8b339";
    for (const strike of topOiStrikes.keys()) {
      try {
        const line = h.createPriceLine({
          price: strike, color: badge, lineWidth: 1, lineStyle: 0,
          lineVisible: false, axisLabelVisible: true,
          axisLabelColor: badge, axisLabelTextColor: "#1a1d24",
        });
        oiLinesRef.current.push({ host, line });
      } catch {
        /* LWC rejected the level (no price scale yet) — retries on the next data change. */
      }
    }
  }, [oiDeltaOn, topOiStrikes, hasDrawnBars, overlayPolicy.oiDeltaWithdrawn]);

  // Candles → chart.
  // PIT: the heat field is server-truncated to the scrubbed stamp, so the candles must stop
  // there too. Leaving the full session drawn under a replayed field showed price the user
  // could not have known yet — the same class of point-in-time lie as B4's expiry panel,
  // and a much louder one. At the head of the LIVE session nothing is cut.
  useEffect(() => {
    const candle = candleSeriesRef.current;
    if (!candle) return;
    if (!sessionCandles.length) { candle.setData([]); return; }
    // R1: cutoff/kept/drawn now come from the `cutoffBars` memo above — the SAME
    // computation `hasDrawnBars` reads, so the candle series' actual plotted rows and the
    // price-line overlays' host selection can never disagree about what's drawn.
    const { cutoff, kept, drawn } = cutoffBars;
    const data = drawn.map((b) => ({ time: b[0] as unknown as Time, open: b[1], high: b[2], low: b[3], close: b[4] }));
    // Keep the time axis on the WHOLE session by padding the cut tail with whitespace points.
    // This is half of a pair: the padding extends the scale to 15:56, and `fixLeftEdge` on the
    // time scale stops Lightweight-Charts re-anchoring the shorter series to the right edge.
    // Without BOTH, scrubbing back slides the whole day across the pane. With them, the
    // gridlines never move and the session simply drains backwards, leaving the right-hand
    // side blank — which reads honestly as "not known at this moment".
    // (Padding the custom heat series instead does not hold the scale; the built-in
    // candlestick series does, so the whitespace lives here.)
    const tail = kept.filter((b) => b[0] > cutoff).map((b) => ({ time: b[0] as unknown as Time }));
    candle.setData([...data, ...tail] as Parameters<typeof candle.setData>[0]);
  }, [sessionCandles, cutoffBars]);

  // ── X framing: observed field vs full selected session ──────────────────────
  // Surface is a session-native view, not a generic daily chart. The default follows the
  // time span the field actually covers; this is what keeps a sparse 10-frame live field
  // readable on a phone. Full session remains one click away for open-to-close context.
  // Replaying a frame intentionally advances the observed window. The session mode only
  // fits after its candle request resolves, so an early field response cannot lock the axis
  // to a partial range.
  useEffect(() => {
    const chart = chartRef.current;
    const date = frame?.session_date;
    if (!chart || !date) return;
    if (timeWindow === "surface") {
      const window = observedTimeWindow(date, frame.time_steps);
      if (window) chart.timeScale().setVisibleRange(window);
      return;
    }
    if (sessionCandles.length > 0 || candleSession === date) chart.timeScale().fitContent();
  }, [timeWindow, frame?.session_date, frame?.time_steps, sessionCandles.length, candleSession]);

  // ── Stamps / labels ──────────────────────────────────────────────────────────
  // Plain computations, cheap enough to run every render — no memoization needed.
  const asofLabel = fmtAsofLabel(frame?.asof);
  const snapshotCount = frame?.time_steps.length ?? 0;
  const observedCadenceSec = frame ? observedSurfaceCadenceSec(frame.time_steps) : null;
  const metricLabel = t(METRICS.find((m) => m.key === metric)?.labelKey ?? "metricNetPrem");
  const hasData = !!frame && !!frame.grids[metric] && frame.time_steps.length > 0;
  // A quad cell whose greek the snapshot doesn't carry: say "accruing" over the empty
  // field instead of leaving a blank rectangle with no explanation.
  const cellAccruing = isCell && !!fixedMetric && fixedMetric !== "netprem" && !metricEnabled(frame, fixedMetric);
  const pinnedHere = hover ? (pins ?? []).some((p) => p.strike === hover.strike) : false;

  // ── Nightly-overlay provenance notes (honesty tiering) ───────────────────────
  // Mirrors ChartPanel's Options Levels legend-row construction exactly (same "EOD
  // {date}", "signed estimate", "{n} sessions old" vocabulary) — these are the same
  // options_hub payloads, so they read the same wherever they're drawn.
  const nightlyDateNote = (asofDate: string | null, signed: boolean): string => {
    const age = asofDate ? sessionsOldEt(asofDate) : 0;
    const parts = [
      asofDate ? t("nightlyAsOf").replace("{date}", asofDate.slice(5)) : "",
      signed ? t("nightlySigned") : "",
      age > 3 ? t("nightlyStale").replace("{n}", String(age)) : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : t("nightlyNoDate");
  };
  // F5: loading / hard-fetch-failure (outage or entitlement gate) / genuine no-coverage
  // used to all collapse into the same "no coverage for this root" string. Split to
  // mirror ChartPanel's Options Levels legend split (ChartPanel.tsx optLevelsStateRef
  // block, ~1755-1786): `flowGet` returns null on BOTH lanes hard-failing (an outage or a
  // 403 gate reads identically to "no coverage" upstream) — status "unavailable" is that
  // honest umbrella, distinct from a genuinely empty derivation.
  const levelsFetchState: "loading" | "ok" | "unavailable" =
    !levelsStore || levelsStore.root !== root
      ? "loading"
      : levelsStore.gex == null && levelsStore.moves == null
        ? "unavailable"
        : "ok";
  // F1: archived Levels — loading / no-dated-snapshot / EM-omitted-but-drawn / no-coverage.
  const levelsNote = overlayPolicy.useDatedLevels
    ? archivedLevelsLoading
      ? t("nightlyLoading")
      : archivedLevelsMissing
        ? t("archivedLevelsMissing")
        : archivedOptLevels.status === "ok"
          // F1b: no dated `moves:` twin exists, so the EM band is ALWAYS omitted while
          // replaying — the note says so rather than silently dropping two of six lines.
          ? `${nightlyDateNote(archivedOptLevels.asofDate, archivedOptLevels.signed)} · ${t("archivedEmOmitted")}`
          : t("nightlyNoCov")
    : levelsFetchState === "loading"
      ? t("nightlyLoading")
      : levelsFetchState === "unavailable"
        ? t("nightlyUnavail")
        : optLevels.status === "ok" ? nightlyDateNote(optLevels.asofDate, optLevels.signed) : t("nightlyNoCov");
  // F6: the EOD date alone, survives the ≤460px hide of the full sentence above (see
  // .obs-surf-compact-only in observatory.css).
  const levelsCompactDate = overlayPolicy.useDatedLevels
    ? (archivedOptLevels.status === "ok" ? archivedOptLevels.asofDate : null)
    : (optLevels.status === "ok" ? optLevels.asofDate : null);

  // R2: mirrors levelsFetchState above — loading / hard-fetch-failure (outage or gate) /
  // genuine no-coverage used to all collapse into oiDeltaNote's "no coverage" fallback
  // (a fetch still in flight, or `flowGet` returning null on a hard failure, read
  // identically to "this root just has no OI-change coverage").
  const oiChangeFetchState: "loading" | "ok" | "unavailable" =
    !oiChangeStore || oiChangeStore.root !== root
      ? "loading"
      : oiChangeStore.data == null
        ? "unavailable"
        : "ok";
  const oiChangeAsofDate = (() => {
    if (oiChangeFetchState !== "ok" || !oiChangeStore) return null;
    const raw = (oiChangeStore.data as { asof?: unknown } | null)?.asof;
    const s = typeof raw === "string" ? raw.slice(0, 10) : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  })();
  // F11: Σ|ΔOI| conflates strikes being built and strikes being unwound — the note leads
  // with that honesty phrase (mirrors the toggle's aria-label) rather than only the date.
  const oiDeltaNote =
    oiChangeFetchState === "loading"
      ? t("nightlyLoading")
      : oiChangeFetchState === "unavailable"
        ? t("nightlyUnavail")
        : oiChangeCells.length
          ? `${t("oiDeltaMoversNote")} · ${nightlyDateNote(oiChangeAsofDate, false)}`
          : t("nightlyNoCov");

  // ── Regime chip (pane header) — same vocabulary/colour table the screener, watchlist
  // dot and ticker page already use (lib/mscGlance REGIME_COLORS + gexStrings `regime*`).
  // REGIME-DYNAMICS LAW: the state word never stands alone — stability and dist-to-flip
  // ride with it, same as MarketStateCard / StockAnalysis.
  const regimeLabel = glanceRow ? plainRegime(gexT, glanceRow.regime, lang) : null;
  const regimeNote = glanceRow ? nightlyDateNote(glanceRow.asofDate, true) : "";
  // R3: the ≤460px compact-slot text — whichever of dist-to-flip/stability the payload
  // actually carries, preferring dist-to-flip when both are present (it is more directly
  // actionable — "how far to the regime boundary" — than a stability score). Null when
  // neither is present, matching the verbose spans' own per-field null-guards above.
  const regimeCompactStat = glanceRow?.distToFlipPct != null
    ? `${Math.abs(glanceRow.distToFlipPct).toFixed(1)}% ${t("regimeToFlip")}`
    : glanceRow?.stabilityPct != null
      ? `${Math.round(glanceRow.stabilityPct)}% ${t("regimeStability")}`
      : null;
  // F6: compact "· MM-DD" form, shown ONLY at ≤460px alongside the regime label + the
  // regimeCompactStat detail, which the REGIME-DYNAMICS LAW above requires never ship alone.
  const shortDateNote = (asofDate: string | null): string => (asofDate ? `· ${asofDate.slice(5)}` : "");

  // ── Y framing (explicit) ─────────────────────────────────────────────────────
  // Both chips write through applyYRef — the same single writer the automatic framing and
  // the wheel zoom use — so the mirrored domain can never drift from what is drawn.
  // "Fit price" is null (and the chip inert) when no candle will be drawn for this
  // session, which the aria-label says rather than leaving a dead control.
  // Memoized deliberately (B9 spirit): the crosshair re-renders this component on every
  // mousemove and this walks the whole session's bars — it must not ride along.
  const priceFit = useMemo(
    () => priceWindow(sessionCandles),
    [sessionCandles],
  );
  const fitPrice = () => { if (priceFit) applyYRef.current(priceFit[0], priceFit[1]); };
  const fitStrikes = () => {
    const win = strikeWindow(levelsRef.current, frame?.spot);
    if (win) applyYRef.current(win[0], win[1]);
  };

  return (
    <div style={PANE} className="obs-surf-pane">
      {/* Controls row — the quad's shared toolbar owns these in cell mode. */}
      {!isCell && (
      <div style={CONTROLS} className="obs-surf-controls">
        {/* Metric tabs — greek tabs feature-detect on the loaded frame's grids. */}
        <div style={GROUP} role="group" aria-label={t("metricLensAria")}>
          {METRICS.map((m) => {
            // netprem is always available (Wave-1 field); greeks light up only when the
            // loaded snapshot actually carries their grid.
            const enabled = m.key === "netprem" || metricEnabled(frame, m.key);
            return (
              <button
                key={m.key}
                className={`obs-chip${metric === m.key ? " on" : ""}`}
                style={{ ...CHIP, ...(enabled ? {} : DISABLED_CHIP) }}
                aria-pressed={metric === m.key}
                aria-disabled={!enabled}
                aria-label={enabled ? undefined : `${t(m.labelKey)} — ${t("metricAccruing")}`}
                onClick={() => enabled && setMetricState(m.key)}
              >
                {t(m.labelKey)}
                {!enabled && <span style={ACCRUING_DOT} aria-hidden>·</span>}
              </button>
            );
          })}
        </div>

        {/* X-axis framing. "Surface window" is the useful default for a sparse live field;
            "Full session" restores open-to-close context and makes manual pan/zoom useful. */}
        <div style={GROUP} role="group" aria-label={t("timeWindowAria")}>
          <span className="obs-lbl">{t("timeWindow")}</span>
          <button
            className={`obs-chip${timeWindow === "surface" ? " on" : ""}`}
            style={CHIP}
            aria-pressed={timeWindow === "surface"}
            aria-label={t("timeWindowSurfaceAria")}
            onClick={() => onTimeWindowChange?.("surface")}
          >
            {t("timeWindowSurface")}
          </button>
          <button
            className={`obs-chip${timeWindow === "session" ? " on" : ""}`}
            style={CHIP}
            aria-pressed={timeWindow === "session"}
            aria-label={t("timeWindowSessionAria")}
            onClick={() => onTimeWindowChange?.("session")}
          >
            {t("timeWindowSession")}
          </button>
        </div>

        {/* Candle interval. These controls never change or resample the field snapshots. */}
        <div style={GROUP} role="group" aria-label={t("aggAria")}>
          <span className="obs-lbl">{t("candleInterval")}</span>
          {AGGS.map((a) => (
            <button key={a.min} className={`obs-chip${effAggMin === a.min ? " on" : ""}`} style={CHIP}
              aria-pressed={effAggMin === a.min} onClick={() => setAggMin(a.min)}>
              {t(a.labelKey)}
            </button>
          ))}
        </div>

        {/* Opacity */}
        <label style={SLIDER_WRAP}>
          <span className="obs-lbl">{t("opacity")}</span>
          <input type="range" min={0} max={100} step={5} value={Math.round(opacity * 100)}
            aria-label={t("opacityAria")} style={SLIDER}
            onChange={(e) => setOpacity(Number(e.target.value) / 100)} />
          <span style={SLIDER_VAL} className="num">{Math.round(opacity * 100)}%</span>
        </label>

        {/* Strike range */}
        <label style={SLIDER_WRAP}>
          <span className="obs-lbl">{t("range")}</span>
          <input type="range" min={0} max={RANGE_STOPS.length - 1} step={1}
            value={Math.max(0, RANGE_STOPS.indexOf(rangeQ))}
            aria-label={t("strikeRangeAria")} style={SLIDER}
            onChange={(e) => setRangeQ(RANGE_STOPS[Number(e.target.value)])} />
          <span style={SLIDER_VAL} className="num">{rangeQ === 0 ? t("rangeAll") : `±${rangeQ}`}</span>
        </label>

        {/* Nightly overlays: options levels + OI Δ. Both are options_hub/gex_state EOD
            payloads drawn under an intraday field — each toggle carries its own "as of
            {date}" provenance so it never reads as LIVE, matching ChartPanel's Options
            Levels legend-row idiom. Off the replay head both keep showing the value they
            genuinely describe (no intraday history to truncate to) and the shared
            EodReplayTag below says so once. */}
        <div style={GROUP} role="group" aria-label={t("overlaysAria")}>
          <span className="obs-lbl">{t("overlaysGroup")}</span>
          <button
            className={`obs-chip${levelsOn ? " on" : ""}`}
            style={CHIP}
            aria-pressed={levelsOn}
            aria-label={t("levelsToggleAria")}
            onClick={() => setLevelsOn((v) => !v)}
          >
            {t("levelsToggle")}
          </button>
          {levelsOn && (
            <>
              <span className="obs-surf-data-detail">{levelsNote}</span>
              {levelsCompactDate && (
                <span className="obs-surf-compact-only">{shortDateNote(levelsCompactDate)}</span>
              )}
            </>
          )}
          {/* F1: OI Δ has no dated twin — withdrawn outright during an archived session
              (never merely disabled-because-no-data-loaded-yet; see archivedOverlayPolicy
              in lib/surfaceContract). */}
          <button
            className={`obs-chip${oiDeltaOn ? " on" : ""}`}
            style={{ ...CHIP, ...(overlayPolicy.oiDeltaWithdrawn ? DISABLED_CHIP : {}) }}
            // NIT: aria-pressed is a toggle-state attribute — dropped entirely (not just
            // `false`) while the control is aria-disabled/withdrawn, and restored once the
            // session goes live again.
            aria-pressed={overlayPolicy.oiDeltaWithdrawn ? undefined : oiDeltaOn}
            aria-disabled={overlayPolicy.oiDeltaWithdrawn}
            aria-label={
              overlayPolicy.oiDeltaWithdrawn
                ? `${t("oiDeltaToggle")} — ${t("archivedOverlaysWithdrawn")}`
                : t("oiDeltaToggleAria")
            }
            onClick={() => !overlayPolicy.oiDeltaWithdrawn && setOiDeltaOn((v) => !v)}
          >
            {t("oiDeltaToggle")}
          </button>
          {overlayPolicy.oiDeltaWithdrawn ? (
            // NIT: hidden together with its (aria-disabled, already display:none at
            // ≤460px) control at that width — the regime chip's WITHDRAWN_NOTE copy below
            // already discloses "Regime state AND OI Δ..." on its own, so this second copy
            // is the verbose remainder there, not the only disclosure.
            <span className="obs-surf-oi-withdrawn-note" style={WITHDRAWN_NOTE}>{t("archivedOverlaysWithdrawn")}</span>
          ) : oiDeltaOn && (
            <>
              <span className="obs-surf-data-detail">{oiDeltaNote}</span>
              {oiChangeAsofDate && (
                <span className="obs-surf-compact-only">{shortDateNote(oiChangeAsofDate)}</span>
              )}
            </>
          )}
          {/* Covers all THREE nightly overlays (Levels, OI Δ, and the always-on regime
              chip below) — renders nothing unless a replay is active and off its head.
              Regime is excluded once withdrawn (F1): no chip is drawn from glanceRow then,
              so a tag referencing it would dangle. */}
          {(levelsOn || oiDeltaOn || (!!glanceRow && !overlayPolicy.regimeWithdrawn)) && (
            <EodReplayTag lang={lang} />
          )}
        </div>

      </div>
      )}

      {/* Compact data contract: three separate clocks, named where the user reads them.
          This replaces the giant amber paragraph and the on-canvas provenance sentence. */}
      {!isCell && (
        <div className="obs-surf-data-strip" role="status">
          <span className="obs-surf-data-item">
            <span className="obs-lbl">{t("dataStripSession")}</span>
            <strong className="num">{frame?.session_date ?? "—"}</strong>
          </span>
          <span className="obs-surf-data-item">
            <span className="obs-lbl">{t("dataStripSurface")}</span>
            <strong className="num">{snapshotCount} {t("observedFrames")}</strong>
            <span className="obs-surf-data-detail">
              {observedCadenceSec != null ? `· ~${fmtObservedCadence(observedCadenceSec)} ${t("observedCadence")}` : `· ${t("cadencePending")}`}
            </span>
          </span>
          <span className="obs-surf-data-item">
            <span className="obs-lbl">{t("dataStripPrice")}</span>
            <strong className="num">{effAggMin}m {t("candleInterval").toLowerCase()}</strong>
          </span>
          <span className="obs-surf-observed-badge">
            <span className="obs-live-dot" aria-hidden />
            {t("observedOnly")}
          </span>
          <span className="obs-surf-data-legend">
            <span style={LEGEND_ITEM}><span style={{ ...SWATCH, background: `var(${METRIC_CSS[metric].pos})` }} /><span className="obs-lbl">{t("legendPos")}</span></span>
            <span style={LEGEND_ITEM}><span style={{ ...SWATCH, background: `var(${METRIC_CSS[metric].neg})` }} /><span className="obs-lbl">{t("legendNeg")}</span></span>
          </span>
          {/* Regime chip — nightly gexstate:{ROOT}, same word/colour as the screener's msc_*
              column, the watchlist dot and the ticker page's positioning block. Never stands
              alone: dist-to-flip (when the payload carries it) rides beside it.
              F1c: withdrawn outright during an archived session — gexstate: has no dated
              twin, so this replaces the chip entirely rather than showing TODAY's regime
              under a past session's field (same honest-withdrawn idiom as GexDeskView's
              archived pane, post-#344). */}
          {overlayPolicy.regimeWithdrawn ? (
            <span className="obs-surf-data-item" aria-label={t("regimeChipAria")}>
              <span style={WITHDRAWN_NOTE}>{t("archivedOverlaysWithdrawn")}</span>
            </span>
          ) : glanceRow && regimeLabel && (
            <span className="obs-surf-data-item" aria-label={t("regimeChipAria")}>
              <strong className="num" style={{ color: REGIME_COLORS[glanceRow.regime] }}>{regimeLabel}</strong>
              {glanceRow.distToFlipPct != null && (
                <span className="obs-surf-data-detail">
                  {Math.abs(glanceRow.distToFlipPct).toFixed(1)}% {t("regimeToFlip")}
                </span>
              )}
              {glanceRow.stabilityPct != null && (
                <span className="obs-surf-data-detail">
                  {Math.round(glanceRow.stabilityPct)}% {t("regimeStability")}
                </span>
              )}
              <span className="obs-surf-data-detail">{regimeNote}</span>
              {/* R3: ≤460px compact slot — whichever of dist-to-flip/stability the payload
                  actually carries (preferring dist-to-flip when both are present), not
                  dist-to-flip only. A payload with stability but a null dist_to_flip used
                  to ship the regime label bare at this width once the verbose spans above
                  were hidden (mscGlance.ts REGIME-DYNAMICS LAW, lines 14-16). */}
              {regimeCompactStat && (
                <span className="obs-surf-compact-only">{regimeCompactStat}</span>
              )}
              {glanceRow.asofDate && (
                <span className="obs-surf-compact-only">{shortDateNote(glanceRow.asofDate)}</span>
              )}
            </span>
          )}
          <span className="obs-surf-data-source">{t("sourceOpra")}</span>
        </div>
      )}

      {/* Chart area */}
      <div style={CHART_AREA} className="obs-surf-chart-area">
        <div ref={wrapRef} style={{ width: "100%", height: "100%" }} />

        {/* Y framing lives on the axis it changes, instead of wrapping the main toolbar.
            These are momentary reset actions, not modes. */}
        {!isCell && (
          <div className="obs-surf-yfit" role="group" aria-label={t("yFitAria")}>
            <span className="obs-lbl">Y</span>
            <button
              className="obs-chip"
              aria-disabled={!priceFit}
              aria-label={priceFit ? undefined : `${t("yFitPrice")} — ${t("yFitPriceNone")}`}
              onClick={fitPrice}
            >
              {t("yFitPrice")}
            </button>
            <button
              className="obs-chip"
              aria-disabled={!hasData}
              aria-label={hasData ? undefined : `${t("yFitStrikes")} — ${t("yFitStrikesNone")}`}
              onClick={fitStrikes}
            >
              {t("yFitStrikes")}
            </button>
          </div>
        )}

        {/* Quad cell: the metric name lives on the cell itself (no tab strip here). */}
        {isCell && (
          <div className="obs-lbl" style={CELL_BADGE}>
            <span style={{ ...SWATCH, background: `var(${METRIC_CSS[metric].pos})`, marginRight: 5 }} />
            {metricLabel}
            {cellAccruing && <span style={CELL_ACCRUING}>{t("quadAccruing")}</span>}
          </div>
        )}

        {/* Crosshair readout pill (top-left) */}
        {readout && hasData && (
          <div style={READOUT_PILL} className="num">
            <span style={{ color: "var(--muted)" }}>{t("strike")}</span>
            <span style={{ color: "var(--text)", fontWeight: 700 }}>{readout.strike}</span>
            <span style={{ color: "var(--muted)" }}>{metricLabel}</span>
            <span style={{ color: readout.value >= 0 ? "var(--up)" : "var(--down)", fontWeight: 700 }}>
              {fmtDollarSigned(readout.value)}
            </span>
          </div>
        )}

        {/* Empty / loading — never a bare "no data": the second line names WHICH of
            still-loading / greek-not-carried / nothing-painted-yet applies. */}
        {!hasData && (
          <div style={EMPTY}>
            <span style={EMPTY_TITLE}>
              {loading ? t("surfaceLoading") : cellAccruing ? t("metricAccruing") : t("surfaceEmpty")}
            </span>
            {!isCell && (
              <span style={EMPTY_WHY}>
                {loading ? t("surfaceLoadingWhy") : t("surfaceEmptyWhy")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Strike hover popover (RECON §4.2) — fixed layer, never clipped by the chart. */}
      {hover && hasData && modalIdx == null && (
        <div
          className="obs-surf-pop"
          style={{
            left: Math.min(hover.x + 16, (typeof window !== "undefined" ? window.innerWidth : 1200) - 244),
            top: Math.max(8, hover.y - 30),
          }}
          role="tooltip"
        >
          <div className="obs-surf-pop-hd">
            <span className="obs-surf-pop-strike">{hover.strike}</span>
            {hover.pctFromSpot != null && (
              <span className="obs-surf-pop-pct">
                {hover.pctFromSpot >= 0 ? "+" : ""}{hover.pctFromSpot.toFixed(1)}% {t("popFromSpot")}
              </span>
            )}
          </div>
          <div className="obs-surf-pop-row">
            <span className="k">{metricLabel}</span>
            <span className="v" style={{ color: hover.active.value >= 0 ? "var(--up)" : "var(--down)" }}>
              {fmtDollarSigned(hover.active.value)}
            </span>
          </div>
          {hover.others.length > 0 && (
            <>
              <div className="obs-surf-pop-sep" />
              {hover.others.map((o) => (
                <div className="obs-surf-pop-row" key={o.key}>
                  <span className="k">{t(METRICS.find((m) => m.key === o.key)?.labelKey ?? "metricNetPrem")}</span>
                  <span className="v" style={{ color: o.value >= 0 ? "var(--up)" : "var(--down)" }}>
                    {fmtDollarSigned(o.value)}
                  </span>
                </div>
              ))}
            </>
          )}
          {/* Send to chart — pin this strike as a level line. Pointer events are on for
              this one control; the rest of the popover stays click-through. */}
          {onTogglePin && (
            <button
              type="button"
              className="obs-surf-pop-pin"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onTogglePin(hover.strike, hover.active.key, hover.active.value)}
              aria-pressed={pinnedHere}
            >
              {pinnedHere ? t("pinnedUnpin") : t("pinToChart")}
            </button>
          )}
          <div className="obs-surf-pop-hint">{t("popClickHint")}</div>
        </div>
      )}

      {/* Intraday-Evolution modal (RECON §4.2) */}
      {modalIdx != null && frame && (
        <StrikeEvolutionModal
          // The frame is ALREADY server-truncated to the scrubbed stamp, so its time_steps /
          // grid rows are the realized-so-far window — the modal's series is replay-aware by
          // construction (NOW = the last realized column). scrubbedTimeIdx=null = full frame.
          frame={frame}
          root={root}
          strikeIdx={modalIdx}
          metric={metric}
          metricLabel={metricLabel}
          scrubbedTimeIdx={null}
          matrixCells={matrixCells}
          asofLabel={asofLabel}
          lang={lang}
          // B4: the per-expiry matrix is ONE head-of-day fetch keyed on root, so it always
          // describes the present. Telling the modal whether the replay is at the head lets
          // it label that panel honestly instead of captioning present-time shares "at NOW"
          // over a scrubbed-back moment.
          replayLive={live}
          pinned={(pins ?? []).some((p) => p.strike === frame.price_levels[modalIdx])}
          onTogglePin={onTogglePin}
          onClose={() => setModalIdx(null)}
        />
      )}

    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const PANE: React.CSSProperties = { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" };

// 16px horizontal padding is the family's shared left rail (toolbar → controls → replay
// bar → session strip all stack on one vertical edge).
const CONTROLS: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap",
  padding: "var(--sp-2) var(--sp-4)", borderBottom: "1px solid var(--line)",
  background: "var(--panel)", flexShrink: 0,
};

const GROUP: React.CSSProperties = { display: "flex", gap: "var(--sp-1)", alignItems: "center" };

const CHIP: React.CSSProperties = {
  height: 28, minWidth: 34, justifyContent: "center",
  fontSize: "var(--fs-label)", fontWeight: 600, padding: "0 var(--sp-2)",
};

const DISABLED_CHIP: React.CSSProperties = { opacity: 0.4, cursor: "not-allowed" };

/** F1c: the honest-withdrawn note for regime/OI Δ during an archived session. A plain
 *  inline style (not `.obs-surf-data-detail`) so it survives the ≤460px hide — it IS the
 *  primary content of that slot while archived, never verbose remainder. */
const WITHDRAWN_NOTE: React.CSSProperties = {
  fontSize: "var(--fs-micro)", color: "var(--muted)", lineHeight: 1.4,
};

const ACCRUING_DOT: React.CSSProperties = { marginLeft: 3, color: "var(--signal)", fontWeight: 900 };

const SLIDER_WRAP: React.CSSProperties = { display: "flex", alignItems: "center", gap: "var(--sp-2)" };

const SLIDER: React.CSSProperties = { width: 64, height: 4, accentColor: "var(--brand)", cursor: "pointer" };

const SLIDER_VAL: React.CSSProperties = {
  fontSize: "var(--fs-micro)", color: "var(--text-2)", minWidth: 30,
  fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums",
};

const LEGEND_ITEM: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: "var(--sp-1)" };

const SWATCH: React.CSSProperties = { display: "inline-block", width: 10, height: 8, borderRadius: 2 };

const CHART_AREA: React.CSSProperties = { position: "relative", flex: 1, minHeight: 260 };

const READOUT_PILL: React.CSSProperties = {
  position: "absolute", top: "var(--sp-3)", left: "var(--sp-3)", zIndex: 5,
  display: "flex", alignItems: "center", gap: "var(--sp-2)",
  padding: "5px var(--sp-3)", fontSize: "var(--fs-label)",
  background: "color-mix(in srgb, var(--panel) 88%, transparent)",
  border: "1px solid var(--line-2, var(--line))", borderRadius: "var(--r-tile)",
  backdropFilter: "blur(6px)", pointerEvents: "none",
  fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums",
};

const EMPTY: React.CSSProperties = {
  position: "absolute", inset: 0,
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  gap: "var(--sp-2)", padding: "0 var(--sp-6)", textAlign: "center", pointerEvents: "none",
};

const EMPTY_TITLE: React.CSSProperties = {
  fontSize: "var(--fs-emph)", fontWeight: 600, color: "var(--text-2)",
};

const EMPTY_WHY: React.CSSProperties = {
  fontSize: "var(--fs-label)", lineHeight: 1.55, color: "var(--muted)", maxWidth: 440,
};

/** .obs-lbl supplies the micro-label type; only the pill chrome and the brighter
 *  on-canvas colour are set here (muted would sink into the heat field). */
const CELL_BADGE: React.CSSProperties = {
  position: "absolute", top: "var(--sp-2)", left: "var(--sp-2)", zIndex: 5,
  display: "inline-flex", alignItems: "center",
  color: "var(--text-2)", padding: "3px var(--sp-2)",
  background: "color-mix(in srgb, var(--panel) 82%, transparent)",
  borderRadius: "var(--r-tile)", pointerEvents: "none",
};

const CELL_ACCRUING: React.CSSProperties = {
  marginLeft: 6, color: "var(--signal)", fontWeight: 600, textTransform: "none", letterSpacing: 0,
};
