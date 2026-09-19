/**
 * LWC v5 series primitive for conditional-scenario zero contours.
 *
 * The primitive owns drawing only. It receives already-adjudicated adjacent-horizon
 * segments from surfaceScenarioOverlay and clips them to NOW + the visible pane.
 */
import type { CanvasRenderingTarget2D, MediaCoordinatesRenderingScope } from "fancy-canvas";
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { ScenarioContourSegment } from "@/lib/surfaceScenarioOverlay";

export interface ScenarioContourProjection {
  continuity: "adjacent_horizon_only";
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface ScenarioContourViewport {
  width: number;
  height: number;
}

export interface ScenarioContourStyle {
  strokeStyle: string;
  lineWidth: number;
  lineDash?: number[];
  lineCap?: CanvasLineCap;
  globalAlpha?: number;
}

type TimeToX = (time: Time) => number | null;
type PriceToY = (price: number) => number | null;

interface Point {
  x: number;
  y: number;
}

function finitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Liang-Barsky clip against the media-coordinate pane rectangle. */
function clipSegment(
  from: Point,
  to: Point,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): { from: Point; to: Point } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const p = [-dx, dx, -dy, dy];
  const q = [from.x - xMin, xMax - from.x, from.y - yMin, yMax - from.y];
  let enter = 0;
  let leave = 1;

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const ratio = q[i] / p[i];
    if (p[i] < 0) {
      if (ratio > leave) return null;
      if (ratio > enter) enter = ratio;
    } else {
      if (ratio < enter) return null;
      if (ratio < leave) leave = ratio;
    }
  }

  return {
    from: { x: from.x + enter * dx, y: from.y + enter * dy },
    to: { x: from.x + leave * dx, y: from.y + leave * dy },
  };
}

export function projectScenarioContourSegments(
  segments: readonly ScenarioContourSegment[],
  boundaryTime: Time,
  timeToX: TimeToX,
  priceToY: PriceToY,
  viewport: ScenarioContourViewport,
): ScenarioContourProjection[] {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return [];
  }

  const boundaryX = timeToX(boundaryTime);
  if (
    boundaryX === null ||
    !Number.isFinite(boundaryX) ||
    boundaryX > viewport.width
  ) {
    return [];
  }
  const xMin = Math.max(0, boundaryX);
  const out: ScenarioContourProjection[] = [];

  for (const segment of segments) {
    if (
      segment.continuity !== "adjacent_horizon_only" ||
      !Number.isFinite(segment.from.price) ||
      !Number.isFinite(segment.to.price) ||
      segment.to.horizon_minutes <= segment.from.horizon_minutes
    ) {
      continue;
    }

    const fromX = timeToX(segment.from.time);
    const toX = timeToX(segment.to.time);
    const fromY = priceToY(segment.from.price);
    const toY = priceToY(segment.to.price);
    if (fromX === null || toX === null || fromY === null || toY === null) continue;

    const from = { x: fromX, y: fromY };
    const to = { x: toX, y: toY };
    if (!finitePoint(from) || !finitePoint(to)) continue;

    const clipped = clipSegment(
      from,
      to,
      xMin,
      viewport.width,
      0,
      viewport.height,
    );
    if (!clipped) continue;
    out.push({ continuity: segment.continuity, ...clipped });
  }
  return out;
}

class ScenarioContourRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly _segments: readonly ScenarioContourSegment[],
    private readonly _boundaryTime: Time,
    private readonly _style: ScenarioContourStyle,
    private readonly _chart: IChartApi,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly _series: ISeriesApi<SeriesType, any>,
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace((scope: MediaCoordinatesRenderingScope) => {
      const timeScale = this._chart.timeScale();
      const projected = projectScenarioContourSegments(
        this._segments,
        this._boundaryTime,
        (time) => timeScale.timeToCoordinate(time),
        (price) => this._series.priceToCoordinate(price),
        {
          width: scope.mediaSize.width,
          height: scope.mediaSize.height,
        },
      );
      if (!projected.length) return;

      const ctx = scope.context;
      ctx.save();
      ctx.strokeStyle = this._style.strokeStyle;
      ctx.lineWidth = this._style.lineWidth;
      ctx.lineCap = this._style.lineCap ?? "round";
      ctx.globalAlpha = this._style.globalAlpha ?? 1;
      ctx.setLineDash(this._style.lineDash ?? []);

      for (const segment of projected) {
        ctx.beginPath();
        ctx.moveTo(segment.from.x, segment.from.y);
        ctx.lineTo(segment.to.x, segment.to.y);
        ctx.stroke();
      }
      ctx.restore();
    });
  }
}

class ScenarioContourPaneView implements IPrimitivePaneView {
  constructor(private readonly _renderer: ScenarioContourRenderer) {}

  zOrder(): PrimitivePaneViewZOrder {
    return "top";
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

export class ScenarioContourPrimitive implements ISeriesPrimitive<Time> {
  private _segments: readonly ScenarioContourSegment[];
  private _boundaryTime: Time;
  private _style: ScenarioContourStyle;
  private _chart: IChartApi | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _series: ISeriesApi<SeriesType, any> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: ScenarioContourPaneView[] = [];

  constructor(
    segments: readonly ScenarioContourSegment[],
    boundaryTime: Time,
    style: ScenarioContourStyle,
  ) {
    this._segments = segments;
    this._boundaryTime = boundaryTime;
    this._style = { ...style, lineDash: style.lineDash ? [...style.lineDash] : undefined };
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart as unknown as IChartApi;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this._rebuildViews();
  }

  detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._paneViews = [];
  }

  update(
    segments: readonly ScenarioContourSegment[],
    boundaryTime: Time,
    style: ScenarioContourStyle = this._style,
  ): void {
    this._segments = segments;
    this._boundaryTime = boundaryTime;
    this._style = { ...style, lineDash: style.lineDash ? [...style.lineDash] : undefined };
    this._rebuildViews();
    this._requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
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
    const renderer = new ScenarioContourRenderer(
      this._segments,
      this._boundaryTime,
      this._style,
      this._chart,
      this._series,
    );
    this._paneViews = [new ScenarioContourPaneView(renderer)];
  }
}

export function attachScenarioContours(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  series: ISeriesApi<SeriesType, any>,
  segments: readonly ScenarioContourSegment[],
  boundaryTime: Time,
  style: ScenarioContourStyle,
): ScenarioContourPrimitive {
  const primitive = new ScenarioContourPrimitive(segments, boundaryTime, style);
  series.attachPrimitive(primitive as unknown as ISeriesPrimitive<Time>);
  return primitive;
}

export function detachScenarioContours(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  series: ISeriesApi<SeriesType, any>,
  primitive: ScenarioContourPrimitive,
): void {
  series.detachPrimitive(primitive as unknown as ISeriesPrimitive<Time>);
}
