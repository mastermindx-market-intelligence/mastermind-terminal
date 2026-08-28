// macdEngine — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteField, SuiteModuleMeta } from "@/lib/indicator-canvas/types";

/** Moving-average choices offered by the Engine's settings schema. */
export type MacdMaType = "ema" | "sma";
export const MACDX_MA_OPTIONS: Array<{ v: string; label: string }> = [
  { v: "ema", label: "EMA" },
  { v: "sma", label: "SMA" },
];

/**
 * Engine parameter DEFAULTS for the whole suite.
 *
 * `ModuleCtx.s` is scoped to ONE module, so the Signals / Divergence / Histogram / Trend modules
 * read the Engine's LIVE fast/slow/signalLen/oscMa/sigMa out of `ctx.suite` (the suite's flat,
 * module-prefixed params) via `sharedMacd(bars, ctx.suite)`. These values are the fallback only.
 *
 * They live here, with the metadata, because the settings schema below is built from them — and
 * a settings dialog must be able to read them without pulling in the engine's computation.
 */
export const MACDX_ENGINE_DEFAULTS = {
  fast: 10,
  slow: 20,
  signalLen: 9,
  oscMa: "ema" as MacdMaType,
  sigMa: "ema" as MacdMaType,
};

const FIELDS: SuiteField[] = [
  {
    key: "fast",
    label: "Fast Length",
    type: "number",
    min: 2,
    max: 50,
    step: 1,
    tip: "Bars in the fast moving average of the MACD difference.",
  },
  {
    key: "slow",
    label: "Slow Length",
    type: "number",
    min: 5,
    max: 100,
    step: 1,
    tip: "Bars in the slow moving average. Keep it above the fast length or the curve inverts.",
  },
  {
    key: "signalLen",
    label: "Signal Length",
    type: "number",
    min: 2,
    max: 50,
    step: 1,
    tip: "Smoothing applied to the normalized MACD to draw the signal line.",
  },
  {
    key: "oscMa",
    label: "MACD MA Type",
    type: "select",
    options: MACDX_MA_OPTIONS,
    tip: "Average used for the fast and slow legs.",
  },
  {
    key: "sigMa",
    label: "Signal MA Type",
    type: "select",
    options: MACDX_MA_OPTIONS,
    tip: "Average used for the signal line.",
  },
  {
    key: "colorMode",
    label: "Color Mode",
    type: "select",
    options: [
      { v: "heatmap", label: "HeatMap" },
      { v: "slope", label: "Rising / Falling" },
    ],
    tip: "HeatMap colors the curve by how extreme the value is; Rising/Falling colors it by slope.",
  },
];

const DEFAULTS: Record<string, any> = {
  fast: MACDX_ENGINE_DEFAULTS.fast,
  slow: MACDX_ENGINE_DEFAULTS.slow,
  signalLen: MACDX_ENGINE_DEFAULTS.signalLen,
  oscMa: MACDX_ENGINE_DEFAULTS.oscMa,
  sigMa: MACDX_ENGINE_DEFAULTS.sigMa,
  colorMode: "heatmap",
};

export const MACD_ENGINE_META: SuiteModuleMeta = {
  key: "eng",
  label: "MACD Engine",
  tag: "ME",
  tier: "essential",
  defaultOn: true,
  fields: FIELDS,
  defaults: DEFAULTS,
};
