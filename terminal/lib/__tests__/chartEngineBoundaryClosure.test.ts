/**
 * M04 boundary closure — extra ratchets beyond chartEngineBoundary.test.ts (G01).
 * Proves ChartPanel stayed clean and contract enum values match LWC 5.2.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  LineType,
  MismatchDirection,
  PriceScaleMode,
} from "lightweight-charts";
import {
  EngineColorType,
  EngineCrosshairMode,
  EngineLineStyle,
  EngineLineType,
  EnginePriceScaleMode,
} from "../chart-engine/api";

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
    expect(MismatchDirection.None).toBe(0);
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
