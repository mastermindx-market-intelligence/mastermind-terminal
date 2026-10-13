// Mastermind Chart Engine — public entry point (P0).
//
// Re-exports the renderer-agnostic contract and the factory. The `impl` parameter is the
// flag the masterplan hangs the whole program on: "lwc" is the rented renderer behind the
// adapter and "mm" is the owned Canvas2D renderer. Every consumer goes through
// createEngine so the renderer is a one-word flip, never a rewrite. See
// docs/CHART_ENGINE_MASTERPLAN.md.

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
  EngineMismatchDirection,
} from "./api";
export type { EngineCapabilities, EnginePriceScaleMode, NormalizeEngineOptionsResult } from "./options";
export { normalizeEngineOptions } from "./options";
export { LWC_CAPABILITIES } from "./lwc";
export { CANVAS_CAPABILITIES, CANVAS_ENGINE_IMPL, EngineRefusalError } from "./canvas";

import type { ChartEngine, EngineOptions } from "./api";
import { createLwcEngine } from "./lwc";
import { createCanvasEngine } from "./canvas";

// "lwc" = the rented renderer behind the adapter; "mm" = the owned Canvas2D renderer (P3).
export type EngineImpl = "lwc" | "mm";

export function createEngine(
  container: HTMLElement,
  options?: EngineOptions,
  impl: EngineImpl = "lwc",
): ChartEngine {
  switch (impl) {
    case "lwc":
      return createLwcEngine(container, options);
    case "mm":
      return createCanvasEngine(container, options);
    default: {
      // Exhaustiveness guard: adding an EngineImpl variant without a branch is a compile
      // error here. Keeps the flag honest as P3 lands "mm".
      const _never: never = impl;
      throw new Error(`chart-engine: unknown impl ${String(_never)}`);
    }
  }
}
