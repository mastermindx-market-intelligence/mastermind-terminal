// rsiEngine — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteField, SuiteModuleMeta } from "@/lib/indicator-canvas/types";

export type RsiSource = "close" | "hl2" | "hlc3";
export type RsiSmoothType = "ema" | "sma" | "wma";

/**
 * Engine parameter DEFAULTS. `ctx.s` is per-module, so a satellite (Signals / Divergence /
 * Channels) reads the user's live Engine settings from `ctx.suite` (the whole suite's flat,
 * module-prefixed params) via `sharedRsi()` and falls back to these only when a key is absent.
 *
 * They live with the metadata because the settings schema below is built from them — a settings
 * dialog must be able to read them without pulling in the engine's computation.
 */
export const RSI_DEFAULTS = {
  len: 14,
  source: "close" as RsiSource,
  smooth: true,
  smoothLen: 14,
  smoothType: "ema" as RsiSmoothType,
};

const FIELDS: SuiteField[] = [
  {
    key: "len",
    label: "RSI Length",
    type: "number",
    min: 2,
    max: 50,
    step: 1,
    tip: "Wilder RSI period. Shorter reacts faster and spends more time beyond 65/35.",
  },
  {
    key: "source",
    label: "Source",
    type: "select",
    options: [
      { v: "close", label: "Close" },
      { v: "hl2", label: "HL2" },
      { v: "hlc3", label: "HLC3" },
    ],
    tip: "Price series the RSI is computed on.",
  },
  {
    key: "smooth",
    label: "Smoothing MA",
    type: "bool",
    tip: "Signal line over the RSI — crosses of the two drive the Signals module's dots.",
  },
  {
    key: "smoothLen",
    label: "Smoothing Length",
    type: "number",
    min: 1,
    max: 50,
    step: 1,
    tip: "Length of the smoothing MA. 1 = no smoothing (the line sits on the wave).",
    showIf: { key: "smooth", eq: true },
  },
  {
    key: "smoothType",
    label: "Smoothing Type",
    type: "select",
    options: [
      { v: "ema", label: "EMA" },
      { v: "sma", label: "SMA" },
      { v: "wma", label: "WMA" },
    ],
    tip: "WMA turns fastest, SMA slowest; EMA sits between them.",
    showIf: { key: "smooth", eq: true },
  },
];

const DEFAULTS: Record<string, any> = { ...RSI_DEFAULTS };

export const RSI_ENGINE_META: SuiteModuleMeta = {
  key: "eng",
  label: "RSI Engine",
  tag: "RE",
  tier: "essential",
  defaultOn: true,
  fields: FIELDS,
  defaults: DEFAULTS,
};
