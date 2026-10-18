/**
 * sessionShading.ts — pane-view series primitive for intraday session background shading.
 *
 * Draws translucent background rects tinting bars outside regular trading hours:
 *   • Premarket (minOfDay < 570):   amber  rgba(232,179,57,0.045)
 *   • After-hours (minOfDay >= 960): blue   rgba(77,130,255,0.045)
 *
 * Attached to the candle series by lane C (ChartPanel) when sessionShade=true AND
 * tf is intraday AND market has sessions (skip crypto). This file is self-contained;
 * do NOT edit ChartPanel here — lane C wires attach/detach.
 *
 * Engine-neutral since P04-A01: the primary chart's import closure reaches this module, so it is
 * typed against the structural mirrors in lib/chart-engine/paneViewPrimitive.ts instead of
 * importing lightweight-charts / fancy-canvas. The lwc adapter forwards the primitive to LWC
 * unchanged (identity mapping; assignability to ISeriesPrimitive<Time> is pinned at compile time
 * in chartEngineBoundaryClosure.test.ts). The mm canvas renderer accepts only EnginePrimitive.
 *
 * LWC v5 primitive API facts the mirrors follow (verified from typings.d.ts + fancy-canvas):
 *   • ISeriesPrimitive<Time> = ISeriesPrimitiveBase<SeriesAttachedParameter<Time, SeriesType>>
 *   • attached(param) gives { chart, series, requestUpdate }
 *   • paneViews() returns IPrimitivePaneView[]  →  { zOrder(), renderer() }
 *   • IPrimitivePaneRenderer.drawBackground(target: CanvasRenderingTarget2D)
 *   • target.useMediaCoordinateSpace(scope => { scope.context, scope.mediaSize })
 *   • chart.timeScale().timeToCoordinate(time: Time): Coordinate | null
 *   • chart.timeScale().getVisibleLogicalRange(): LogicalRange | null
 *   • series.barsInLogicalRange(range) → BarsInfo (has .from/.to time props)
 *
 * Design: bars array is passed by reference (updated externally by lane C).
 * The renderer reads bars + chart refs on every draw — no stale captures.
 */

import type {
  PaneChartLike,
  PaneMediaScope,
  PanePrimitive,
  PanePrimitiveAttachedParam,
  PanePrimitiveRenderer,
  PanePrimitiveView,
  PaneRenderTarget,
  PaneSeriesLike,
} from "./chart-engine/paneViewPrimitive";
import type { PrimitiveZOrder } from "./chart-engine/primitive";

// ── Bar type matching intradayMath.ts (display-epoch numeric seconds) ──────────
export interface ShadingBar {
  time: number; // display-epoch seconds (numeric)
  o: number; h: number; l: number; c: number; v: number;
}

export type Market = "us" | "cn" | "hk" | "crypto" | "ca";

/** minOfDay: minutes elapsed since midnight in market-local wall-clock time (display-epoch). */
const minOfDay = (t: number): number => Math.floor(t / 60) % 1440;

const RTH_START = 570;  // 09:30 in minutes
const RTH_END   = 960;  // 16:00 in minutes

const PREMARKET_COLOR  = "rgba(232,179,57,0.045)";
const AFTERHOURS_COLOR = "rgba(77,130,255,0.045)";

// ── Renderer ──────────────────────────────────────────────────────────────────

class SessionShadingRenderer implements PanePrimitiveRenderer {
  private _bars: ShadingBar[];
  private _chart: PaneChartLike;
  private _series: PaneSeriesLike;

  constructor(
    bars: ShadingBar[],
    chart: PaneChartLike,
    series: PaneSeriesLike,
  ) {
    this._bars = bars;
    this._chart = chart;
    this._series = series;
  }

  draw(_target: PaneRenderTarget): void {
    // main drawing not needed — session shading goes in the background layer
  }

  drawBackground(target: PaneRenderTarget): void {
    const bars = this._bars;
    if (!bars.length) return;

    const ts = this._chart.timeScale();
    const visRange = ts.getVisibleLogicalRange();
    if (!visRange) return;

    // Use series.barsInLogicalRange to discover visible time bounds
    const barsInfo = this._series.barsInLogicalRange(visRange);
    const fromTime = barsInfo?.from as number | undefined;
    const toTime   = barsInfo?.to   as number | undefined;
    if (fromTime == null || toTime == null) return;

    target.useMediaCoordinateSpace(({ context, mediaSize }: PaneMediaScope) => {
      const H = mediaSize.height;
      const W = mediaSize.width;

      // Find bars in the visible time window
      const visibleBars = bars.filter(
        (b) => b.time >= (fromTime as number) - 300 && b.time <= (toTime as number) + 300,
      );
      if (!visibleBars.length) return;

      // Estimate bar pixel half-width: use first two adjacent bars
      let halfBarW = 2;
      if (visibleBars.length >= 2) {
        const x0 = ts.timeToCoordinate(visibleBars[0].time);
        const x1 = ts.timeToCoordinate(visibleBars[1].time);
        if (x0 != null && x1 != null) {
          halfBarW = Math.max(1, Math.abs(x1 - x0) / 2);
        }
      }

      // Collect contiguous runs of premarket / after-hours bars and draw a rect per run
      type Run = { color: string; xLeft: number; xRight: number };
      const runs: Run[] = [];
      let runColor: string | null = null;
      let runStart: number | null = null; // x coord of run start bar center
      let runEnd: number | null = null;   // x coord of run end bar center

      const flushRun = () => {
        if (runColor && runStart != null && runEnd != null) {
          runs.push({
            color: runColor,
            xLeft:  Math.max(0, runStart  - halfBarW),
            xRight: Math.min(W, runEnd    + halfBarW),
          });
        }
        runColor = null; runStart = null; runEnd = null;
      };

      for (const bar of visibleBars) {
        const mod = minOfDay(bar.time);
        const color =
          mod < RTH_START   ? PREMARKET_COLOR  :
          mod >= RTH_END     ? AFTERHOURS_COLOR :
          null;

        if (!color) { flushRun(); continue; }

        const xCoord = ts.timeToCoordinate(bar.time);
        if (xCoord == null) { flushRun(); continue; }

        if (color !== runColor) {
          flushRun();
          runColor = color;
          runStart = xCoord;
          runEnd   = xCoord;
        } else {
          runEnd = xCoord;
        }
      }
      flushRun();

      for (const run of runs) {
        if (run.xRight <= run.xLeft) continue;
        context.save();
        context.fillStyle = run.color;
        context.fillRect(run.xLeft, 0, run.xRight - run.xLeft, H);
        context.restore();
      }
    });
  }
}

// ── Pane view ─────────────────────────────────────────────────────────────────

class SessionShadingPaneView implements PanePrimitiveView {
  private _renderer: SessionShadingRenderer;

  constructor(renderer: SessionShadingRenderer) {
    this._renderer = renderer;
  }

  zOrder(): PrimitiveZOrder {
    return "bottom";
  }

  renderer(): PanePrimitiveRenderer {
    return this._renderer;
  }
}

// ── Series primitive implementation ───────────────────────────────────────────

/**
 * SessionShadingPrimitive — attach to the candle series on an intraday US/HK/CN chart.
 * Pass the bars array by reference; update it externally and call requestUpdate() to redraw.
 *
 * @example
 *   const prim = new SessionShadingPrimitive(bars);
 *   series.attachPrimitive(prim);
 *   // later: series.detachPrimitive(prim);
 */
export class SessionShadingPrimitive implements PanePrimitive {
  private _bars: ShadingBar[];
  private _chart: PaneChartLike | null = null;
  private _series: PaneSeriesLike | null = null;
  private _paneViews: SessionShadingPaneView[] = [];

  constructor(bars: ShadingBar[]) {
    this._bars = bars;
  }

  /** Called by LWC when the primitive is attached to a series. */
  attached(param: PanePrimitiveAttachedParam): void {
    this._chart  = param.chart;
    this._series = param.series;
    this._rebuildViews();
  }

  /** Called by LWC when the primitive is detached. */
  detached(): void {
    this._chart  = null;
    this._series = null;
    this._paneViews = [];
  }

  /** Replace the bars array (e.g. after a data update). Call requestUpdate() separately. */
  updateBars(bars: ShadingBar[]): void {
    this._bars = bars;
    this._rebuildViews();
  }

  paneViews(): readonly PanePrimitiveView[] {
    return this._paneViews;
  }

  updateAllViews(): void {
    this._rebuildViews();
  }

  private _rebuildViews(): void {
    if (!this._chart || !this._series) {
      this._paneViews = [];
      return;
    }
    const renderer = new SessionShadingRenderer(this._bars, this._chart, this._series);
    this._paneViews = [new SessionShadingPaneView(renderer)];
  }
}

// ── Attach / detach helpers (called by lane C, ChartPanel) ───────────────────

/**
 * Attach a SessionShadingPrimitive to a series.
 * Returns the primitive so the caller can detach it later.
 */
export function attachSessionShading(
  series: SeriesHostLike,
  bars: ShadingBar[],
): SessionShadingPrimitive {
  const prim = new SessionShadingPrimitive(bars);
  series.attachPrimitive(prim);
  return prim;
}

/**
 * Detach a previously attached SessionShadingPrimitive from a series.
 */
export function detachSessionShading(
  series: SeriesHostLike,
  prim: SessionShadingPrimitive,
): void {
  series.detachPrimitive(prim);
}

// ── Handle-based attach / detach (chart-engine M03) ───────────────────────────
// The owned chart-engine contract (lib/chart-engine/api.ts) exposes
// attachPrimitive/detachPrimitive on SeriesHandle. These additive helpers let a
// caller attach the shading primitive through ANY host carrying that slice — the
// owned SeriesHandle, a test double, a future canvas handle — without this module
// importing the contract (the parameter is the minimal structural type needed).
// The raw-series helpers above take the same structural host since P04-A01 (a LWC
// ISeriesApi still satisfies it — pinned in chartEngineBoundaryClosure.test.ts), so
// callers still on the unwrap path keep compiling.
export interface SeriesHostLike {
  attachPrimitive(primitive: unknown): void;
  detachPrimitive(primitive: unknown): void;
}

/** Attach a SessionShadingPrimitive through a handle-shaped host (contract path). */
export function attachSessionShadingToHandle(
  host: SeriesHostLike,
  bars: ShadingBar[],
): SessionShadingPrimitive {
  const prim = new SessionShadingPrimitive(bars);
  host.attachPrimitive(prim);
  return prim;
}

/** Detach a previously attached SessionShadingPrimitive through a handle-shaped host. */
export function detachSessionShadingFromHandle(
  host: SeriesHostLike,
  prim: SessionShadingPrimitive,
): void {
  host.detachPrimitive(prim);
}
