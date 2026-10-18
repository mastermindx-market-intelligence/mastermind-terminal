// Mastermind Chart Engine — engine-neutral mirror of the pane-view primitive protocol
// (P04-A01).
//
// Hand-rolled series primitives such as lib/sessionShading.ts are written against the
// pane-view protocol that lightweight-charts hosts: attached({ chart, series,
// requestUpdate }) → paneViews() → renderer().draw/drawBackground(target) →
// target.useMediaCoordinateSpace(({ context, mediaSize }) => …). This module states the
// slice of that protocol those primitives actually use, structurally, so they no longer
// import "lightweight-charts" or "fancy-canvas" and drop out of the primary chart's LWC
// import closure.
//
// Contract law 1 applies: like api.ts and primitive.ts, this file must NOT import
// "lightweight-charts" (nor fancy-canvas). The lwc adapter forwards such a primitive to
// LWC unchanged (SeriesHandle.attachPrimitive's raw branch), so the boundary mapping is
// the identity; chartEngineBoundaryClosure.test.ts pins at compile time that these
// mirrors stay assignable to LWC's ISeriesPrimitive<Time> family. Members are declared in
// method syntax on purpose — LWC's own interfaces do the same, and method parameters are
// compared bivariantly, which is what lets the narrower mirror shapes stand in for the
// richer LWC objects (Coordinate/Logical brands, DrawingUtils, bitmap space) without casts.
//
// This is NOT the engine-neutral overlay vocabulary (EnginePrimitive in ./primitive):
// the canvas renderer accepts only EnginePrimitive and refuses these shapes.

import type { EngineTime } from "./api";
import type { PrimitiveZOrder } from "./primitive";

/** The media-space (CSS pixel) size of the pane being drawn. */
export interface PaneMediaSize {
  readonly width: number;
  readonly height: number;
}

/** Mirror of fancy-canvas MediaCoordinatesRenderingScope. */
export interface PaneMediaScope {
  readonly context: CanvasRenderingContext2D;
  readonly mediaSize: PaneMediaSize;
}

/** Mirror of the media-space slice of fancy-canvas CanvasRenderingTarget2D. */
export interface PaneRenderTarget {
  useMediaCoordinateSpace<T>(f: (scope: PaneMediaScope) => T): T;
}

/** Mirror of LWC IPrimitivePaneRenderer. */
export interface PanePrimitiveRenderer {
  draw(target: PaneRenderTarget): void;
  drawBackground?(target: PaneRenderTarget): void;
}

/** Mirror of LWC IPrimitivePaneView. */
export interface PanePrimitiveView {
  zOrder?(): PrimitiveZOrder;
  renderer(): PanePrimitiveRenderer | null;
}

/** A logical-index range (LWC LogicalRange without the Logical brand). */
export interface PaneLogicalRange {
  readonly from: number;
  readonly to: number;
}

/** Mirror of the slice of LWC ITimeScaleApi a pane primitive reads. */
export interface PaneTimeScaleLike {
  getVisibleLogicalRange(): PaneLogicalRange | null;
  timeToCoordinate(time: EngineTime): number | null;
}

/** Mirror of the slice of LWC IChartApi a pane primitive reads. */
export interface PaneChartLike {
  timeScale(): PaneTimeScaleLike;
}

/** Mirror of LWC BarsInfo's time bounds. */
export interface PaneBarsInfo {
  readonly from?: EngineTime;
  readonly to?: EngineTime;
}

/** Mirror of the slice of LWC ISeriesApi a pane primitive reads. */
export interface PaneSeriesLike {
  barsInLogicalRange(range: PaneLogicalRange): PaneBarsInfo | null;
}

/** Mirror of LWC SeriesAttachedParameter (the members a pane primitive uses). */
export interface PanePrimitiveAttachedParam {
  readonly chart: PaneChartLike;
  readonly series: PaneSeriesLike;
  requestUpdate(): void;
}

/** Mirror of the LWC ISeriesPrimitive members a pane-view primitive implements. */
export interface PanePrimitive {
  attached?(param: PanePrimitiveAttachedParam): void;
  detached?(): void;
  updateAllViews?(): void;
  paneViews?(): readonly PanePrimitiveView[];
}
