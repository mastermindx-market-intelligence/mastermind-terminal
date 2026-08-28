// liquidity — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "tolerance",
    label: "Level Tolerance (ATR)",
    type: "number",
    min: 0.05,
    max: 1,
    step: 0.05,
    tip: "ATR fraction for equal-level clustering.",
  },
  {
    key: "minTouches",
    label: "Min Touches",
    type: "number",
    min: 2,
    max: 5,
    step: 1,
    tip: "How many pivots must stack before a liquidity line is drawn.",
  },
  {
    key: "grabs",
    label: "Liquidity Grabs",
    type: "bool",
    tip: "Mark the sweep bar when a wick pierces a level and closes back through it.",
  },
  {
    key: "grabSens",
    label: "Grab Sensitivity (ATR)",
    type: "number",
    min: 0.2,
    max: 2,
    step: 0.1,
    tip: "ATR multiple a sweep must exceed.",
    showIf: { key: "grabs", eq: true },
  },
  {
    key: "heatLines",
    label: "Heat Coloring",
    type: "bool",
    tip: "Age-tint the lines: fresh levels accent, ageing levels warn.",
  },
  {
    key: "maxLines",
    label: "Max Lines",
    type: "number",
    min: 4,
    max: 20,
    step: 1,
    tip: "How many liquidity lines may be tracked at once (weakest dropped first).",
  },
  {
    key: "bubbles",
    label: "Volume Bubbles",
    type: "bool",
    tip: "Circle each confirmed pivot, sized by the volume percentile of its bar.",
  },
  {
    key: "bubbleThreshold",
    label: "Bubble Volume Floor (%ile)",
    type: "number",
    min: 20,
    max: 80,
    step: 5,
    tip: "Skip pivots whose volume percentile is under this floor.",
    showIf: { key: "bubbles", eq: true },
  },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 4,
    max: 24,
    step: 1,
    tip: "How many liquidity lines stay on the chart (detection is unaffected).",
  },
];

const DEFAULTS: Record<string, any> = {
  tolerance: 0.25,
  minTouches: 2,
  grabs: true,
  grabSens: 0.5,
  heatLines: true,
  maxLines: 10,
  bubbles: false,
  bubbleThreshold: 20,
  showLast: 12,
};

export const LIQUIDITY_META: SuiteModuleMeta = {
  key: "liq",
  label: "Liquidity",
  tag: "LIQ",
  tier: "pro",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
