// Mastermind Chart Engine — public entry point (P0).
//
// Re-exports the renderer-agnostic contract and the factory. The `impl` parameter is the
// flag the masterplan hangs the whole program on: today the only implementation is "lwc",
// but every consumer goes through createEngine so P3's canvas renderer is a one-word flip
// (impl: "mm") rather than a rewrite. See docs/CHART_ENGINE_MASTERPLAN.md.

export type {
  ChartEngine,
  EngineInventory,
  EngineOptions,
  EngineSeriesKind,
  EngineSeriesOptions,
  EngineBar,
  EnginePoint,
  EngineTime,
  EngineBusinessDay,
  EngineWhitespace,
  EngineBarRow,
  EnginePointRow,
  EngineSeriesRow,
  EngineRange,
  EngineLogicalRange,
  EngineMouseEventParams,
  EngineMouseHandler,
  EngineLogicalRangeHandler,
  SeriesHandle,
  PriceLineHandle,
  PriceLineSpec,
  PriceScaleHandle,
  PaneHandle,
  TimeScaleHandle,
  MarkerSpec,
  EngineMarkerPosition,
  EngineMarkerShape,
  WatermarkSpec,
  WatermarkLine,
} from "./api";

import type { ChartEngine, EngineOptions } from "./api";
import { createLwcEngine } from "./lwc";

export type EngineImpl = "lwc";

export function createEngine(
  container: HTMLElement,
  options?: EngineOptions,
  impl: EngineImpl = "lwc",
): ChartEngine {
  switch (impl) {
    case "lwc":
      return createLwcEngine(container, options);
    default: {
      // Exhaustiveness guard: adding an EngineImpl variant without a branch is a compile
      // error here. Keeps the flag honest as P3 lands "mm".
      const _never: never = impl;
      throw new Error(`chart-engine: unknown impl ${String(_never)}`);
    }
  }
}
