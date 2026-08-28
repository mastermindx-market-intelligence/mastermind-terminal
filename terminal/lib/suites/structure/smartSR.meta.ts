// smartSR — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "sensitivity",
    label: "Sensitivity",
    type: "select",
    options: [
      { v: "high", label: "High" },
      { v: "medium", label: "Medium" },
      { v: "low", label: "Low" },
    ],
    tip: "Pivot wing behind every level: High = 5 bars (many fine levels), Low = 12 (few major ones).",
  },
  {
    key: "minTouches",
    label: "Min Touches",
    type: "number",
    min: 2,
    max: 5,
    step: 1,
    tip: "How many pivots must stack inside one level before it is drawn.",
  },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 2,
    max: 12,
    step: 1,
    tip: "How many levels stay on the chart — the highest scoring ones win.",
  },
  {
    key: "bufferZone",
    label: "Buffer Zone",
    type: "bool",
    tip: "Draw a ±0.25×ATR band around each level instead of a bare line.",
  },
  {
    key: "labels",
    label: "Labels",
    type: "bool",
    tip: "Right-edge chip with the level price and its touch count.",
  },
];

const DEFAULTS: Record<string, any> = {
  sensitivity: "medium",
  minTouches: 2,
  showLast: 6,
  bufferZone: false,
  labels: true,
};

export const SMART_SR_META: SuiteModuleMeta = {
  key: "sr",
  label: "Smart S/R",
  tag: "SR",
  tier: "essential",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
