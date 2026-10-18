/**
 * M04 boundary closure — extra ratchets beyond chartEngineBoundary.test.ts (G01).
 * Proves ChartPanel stayed clean and contract enum values match LWC 5.2.
 * P04-A01: also pins the engine-neutral mirrors lib/chartTimeAxis.ts and lib/sessionShading.ts
 * now speak (EngineTickMarkType, chart-engine/paneViewPrimitive) to the LWC shapes the lwc
 * adapter hands them to unchanged. The typed assignments below are compile-time checks: the
 * tsc gate type-checks this file, so a drifted mirror fails `tsc --noEmit`, not just vitest.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  LineType,
  MismatchDirection,
  PriceScaleMode,
  TickMarkType,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesPrimitive,
  type SeriesAttachedParameter,
  type SeriesType,
  type TickMarkFormatter,
  type Time,
} from "lightweight-charts";
import {
  EngineColorType,
  EngineCrosshairMode,
  EngineLineStyle,
  EngineLineType,
  EnginePriceScaleMode,
  EngineTickMarkType,
} from "../chart-engine/api";
import type {
  PanePrimitive,
  PanePrimitiveAttachedParam,
  PanePrimitiveRenderer,
  PanePrimitiveView,
  PaneRenderTarget,
} from "../chart-engine/paneViewPrimitive";
import { chartTimeAxisOptions } from "../chartTimeAxis";
import { SessionShadingPrimitive, type SeriesHostLike } from "../sessionShading";

const TERMINAL_ROOT = path.resolve(__dirname, "..", "..");
const CHART_PANEL = path.join(TERMINAL_ROOT, "components", "ChartPanel.tsx");

const stripComments = (src: string): string => {
  let out = "";
  let quote: '"' | "'" | "`" | null = null;
  let block = false;
  let line = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = i + 1 < src.length ? src[i + 1] : "";
    if (line) {
      if (c === "\n") { line = false; out += c; }
      continue;
    }
    if (block) {
      if (c === "*" && next === "/") { block = false; i++; continue; }
      if (c === "\n") out += c;
      continue;
    }
    if (quote) {
      out += c;
      if (c === "\\") {
        if (i + 1 < src.length) out += src[i + 1];
        i++;
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === "/" && next === "/") { line = true; i++; continue; }
    if (c === "/" && next === "*") { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; continue; }
    out += c;
  }
  return out;
};

const LWC_IMPORT_RE =
  /\bfrom\s*["']lightweight-charts["']|\brequire\s*\(\s*["']lightweight-charts["']\s*\)|\bimport\s*\(\s*["']lightweight-charts["']\s*\)|\bimport\s*["']lightweight-charts["']/;

describe("chart-engine M04 boundary closure", () => {
  it("contract engine enums match lightweight-charts 5.2 numeric values", () => {
    for (const key of Object.keys(EngineCrosshairMode) as (keyof typeof EngineCrosshairMode)[]) {
      expect(EngineCrosshairMode[key]).toBe(CrosshairMode[key]);
    }
    for (const key of Object.keys(EngineColorType) as (keyof typeof EngineColorType)[]) {
      expect(EngineColorType[key]).toBe(ColorType[key]);
    }
    for (const key of Object.keys(EngineLineStyle) as (keyof typeof EngineLineStyle)[]) {
      expect(EngineLineStyle[key]).toBe(LineStyle[key]);
    }
    for (const key of Object.keys(EngineLineType) as (keyof typeof EngineLineType)[]) {
      expect(EngineLineType[key]).toBe(LineType[key]);
    }
    for (const key of Object.keys(EnginePriceScaleMode) as (keyof typeof EnginePriceScaleMode)[]) {
      expect(EnginePriceScaleMode[key]).toBe(PriceScaleMode[key]);
    }
    for (const key of Object.keys(EngineTickMarkType) as (keyof typeof EngineTickMarkType)[]) {
      expect(EngineTickMarkType[key]).toBe(TickMarkType[key]);
    }
    expect(MismatchDirection.None).toBe(0);
  });

  it("EngineTickMarkType mirrors every LWC TickMarkType member (P04-A01)", () => {
    // Numeric enums carry reverse-mapping keys ("0".."4"); compare the named members only, so
    // a member LWC adds (or one the mirror drops) is a red here, not a silently-null label.
    const lwcNames = Object.keys(TickMarkType).filter((k) => Number.isNaN(Number(k))).sort();
    expect(Object.keys(EngineTickMarkType).sort()).toEqual(lwcNames);
  });

  it("chartTimeAxis's formatter still fits LWC's TickMarkFormatter (P04-A01, compile-time)", () => {
    // LWC calls tickMarkFormatter(time: Time, tickMarkType: TickMarkType, locale). The
    // annotation is checked under strictFunctionTypes, so LWC's Time and TickMarkType must stay
    // assignable to EngineTime / EngineTickMarkType for this file to compile.
    const fmt: TickMarkFormatter = chartTimeAxisOptions("12").tickMarkFormatter;
    const noon = (Date.UTC(2026, 0, 2, 12, 5) / 1000) as Time;
    expect(fmt(noon, TickMarkType.Time, "en-US")).toBe("12:05 PM");
    expect(fmt(noon, TickMarkType.DayOfMonth, "en-US")).toBeNull();
  });

  it("pane-view mirrors stay assignable to the LWC primitive family (P04-A01, compile-time)", () => {
    // Direction the lwc adapter's raw-forward branch relies on: our primitive IS an LWC primitive.
    const asLwcPrimitive = (p: PanePrimitive): ISeriesPrimitive<Time> => p;
    const asLwcView = (v: PanePrimitiveView): IPrimitivePaneView => v;
    const asLwcRenderer = (r: PanePrimitiveRenderer): IPrimitivePaneRenderer => r;
    // Direction LWC exercises at runtime: what it passes in satisfies the mirror's reads.
    const lwcParamFits = (p: SeriesAttachedParameter<Time, SeriesType>): PanePrimitiveAttachedParam => p;
    const lwcTargetFits = (t: CanvasRenderingTarget2D): PaneRenderTarget => t;
    // The raw attachSessionShading/detachSessionShading helpers still accept a real LWC series.
    const lwcSeriesFits = (s: ISeriesApi<SeriesType>): SeriesHostLike => s;

    const prim = new SessionShadingPrimitive([]);
    const lwcPrim: ISeriesPrimitive<Time> = prim;
    expect(asLwcPrimitive(prim)).toBe(lwcPrim);
    expect(prim.paneViews()).toEqual([]);
    for (const fn of [asLwcView, asLwcRenderer, lwcParamFits, lwcTargetFits, lwcSeriesFits]) {
      expect(typeof fn).toBe("function");
    }
  });

  it("ChartPanel live source has no lightweight-charts import", () => {
    const stripped = stripComments(readFileSync(CHART_PANEL, "utf8"));
    expect(LWC_IMPORT_RE.test(stripped)).toBe(false);
  });

  it("detects aliased lightweight-charts imports (A01 mutant)", () => {
    const mutant = 'import * as L from "lightweight-charts";';
    expect(LWC_IMPORT_RE.test(stripComments(mutant))).toBe(true);
  });

  it("detects type-only lightweight-charts imports (A01 mutant)", () => {
    const mutant = 'import type { IChartApi } from "lightweight-charts";';
    expect(LWC_IMPORT_RE.test(stripComments(mutant))).toBe(true);
  });

  it("detects dynamic lightweight-charts import (A01 mutant)", () => {
    const mutant = 'const m = await import("lightweight-charts");';
    expect(LWC_IMPORT_RE.test(stripComments(mutant))).toBe(true);
  });

  it("ChartPanel injects no vendor plugin directly (A01)", () => {
    const stripped = stripComments(readFileSync(CHART_PANEL, "utf8"));
    // attachPrimitive is a CONTRACT member (SeriesHandle.attachPrimitive) and stays allowed.
    expect(/createSeriesMarkers\s*\(/.test(stripped)).toBe(false);
    expect(/createTextWatermark\s*\(/.test(stripped)).toBe(false);
    expect(/\bnew\s+[A-Z][A-Za-z]*Primitive\b/.test(stripped)).toBe(false);
  });
});
