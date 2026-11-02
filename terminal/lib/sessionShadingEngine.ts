/**
 * sessionShadingEngine.ts — the engine-neutral session shading overlay (P03).
 *
 * The native mm renderer accepts only EnginePrimitive overlays: its attachPrimitive runs
 * assertEnginePrimitive and throws EngineRefusalError for anything else, so the LWC
 * ISeriesPrimitive in sessionShading.ts is refused there. This is the same tint —
 * premarket amber, after-hours blue, one rect per contiguous run of bars, half a bar
 * of padding each side — drawn through EngineProjection instead of the LWC time scale.
 *
 * ChartPanel attaches this one when the mounted engine is mm; the lwc engine keeps the
 * LWC primitive unchanged. Like the LWC primitive, the bars array is held by reference
 * and read on every paint. This module must not import lightweight-charts.
 */

import type { EnginePrimitive, EngineProjection, PrimitiveAttachContext } from "./chart-engine/primitive";
import type { EngineTime } from "./chart-engine/api";
import {
  AFTERHOURS_COLOR,
  PREMARKET_COLOR,
  RTH_END,
  RTH_START,
  minOfDay,
  type SeriesHostLike,
  type ShadingBar,
} from "./sessionShading";

export type SessionShadingRun = { color: string; xLeft: number; xRight: number };

/** The tint a bar gets, or null inside regular trading hours. */
function sessionColor(time: number): string | null {
  const mod = minOfDay(time);
  return mod < RTH_START ? PREMARKET_COLOR : mod >= RTH_END ? AFTERHOURS_COLOR : null;
}

/**
 * Contiguous runs of premarket / after-hours bars as x extents, clamped to [0, widthPx].
 * A bar with no coordinate ends the run it would have extended, exactly as the LWC
 * renderer does. Runs that clamp to nothing are dropped.
 */
export function sessionShadingRuns(
  bars: readonly ShadingBar[],
  timeToX: (time: number) => number | null,
  widthPx: number,
): SessionShadingRun[] {
  // Half a bar of padding, estimated from the first two bars (the LWC renderer's rule).
  let halfBarW = 2;
  if (bars.length >= 2) {
    const x0 = timeToX(bars[0].time);
    const x1 = timeToX(bars[1].time);
    if (x0 != null && x1 != null) halfBarW = Math.max(1, Math.abs(x1 - x0) / 2);
  }

  const runs: SessionShadingRun[] = [];
  let runColor: string | null = null;
  let runStart = 0;
  let runEnd = 0;
  const flush = () => {
    if (runColor) {
      const xLeft = Math.max(0, runStart - halfBarW);
      const xRight = Math.min(widthPx, runEnd + halfBarW);
      if (xRight > xLeft) runs.push({ color: runColor, xLeft, xRight });
    }
    runColor = null;
  };

  for (const bar of bars) {
    const color = sessionColor(bar.time);
    if (!color) { flush(); continue; }
    const x = timeToX(bar.time);
    if (x == null || !Number.isFinite(x)) { flush(); continue; }
    if (color !== runColor) {
      flush();
      runColor = color;
      runStart = x;
    }
    runEnd = x;
  }
  flush();
  return runs;
}

/** The numeric time at x, or the given fallback when x lies off the data grid. */
function edgeTime(proj: EngineProjection, x: number, fallback: number): number {
  const t = proj.xToTime(x);
  return typeof t === "number" && Number.isFinite(t) ? t : fallback;
}

let nextId = 0;

export class SessionShadingEnginePrimitive implements EnginePrimitive {
  readonly id = `session-shading-${++nextId}`;
  readonly zOrder = "bottom" as const;
  private _bars: ShadingBar[];
  private _requestUpdate: (() => void) | null = null;

  constructor(bars: ShadingBar[]) {
    this._bars = bars;
  }

  attached(ctx: PrimitiveAttachContext): void {
    this._requestUpdate = () => ctx.requestUpdate();
  }

  detached(): void {
    this._requestUpdate = null;
  }

  /** Replace the bars array (e.g. after a data update) and repaint. */
  updateBars(bars: ShadingBar[]): void {
    this._bars = bars;
    this._requestUpdate?.();
  }

  update(): void {
    // Stateless: paint() reads the bars and the projection it is handed.
  }

  paint(ctx: CanvasRenderingContext2D, proj: EngineProjection): void {
    const W = proj.widthPx;
    const H = proj.heightPx;
    if (!this._bars.length || !(W > 0) || !(H > 0)) return;
    // Visible window, padded by 300 s like the LWC renderer. An edge in the whitespace
    // beyond the data maps to no time, so that side is unbounded; the clamp in
    // sessionShadingRuns keeps anything off screen from painting.
    const from = edgeTime(proj, 0, -Infinity) - 300;
    const to = edgeTime(proj, W, Infinity) + 300;
    const visible = this._bars.filter((b) => b.time >= from && b.time <= to);
    if (!visible.length) return;
    const runs = sessionShadingRuns(visible, (t) => proj.timeToX(t as EngineTime), W);
    for (const run of runs) {
      ctx.save();
      ctx.fillStyle = run.color;
      ctx.fillRect(run.xLeft, 0, run.xRight - run.xLeft, H);
      ctx.restore();
    }
  }
}

/** Attach an engine-neutral shading primitive through a handle-shaped host (mm path). */
export function attachSessionShadingEngineToHandle(
  host: SeriesHostLike,
  bars: ShadingBar[],
): SessionShadingEnginePrimitive {
  const prim = new SessionShadingEnginePrimitive(bars);
  host.attachPrimitive(prim);
  return prim;
}
