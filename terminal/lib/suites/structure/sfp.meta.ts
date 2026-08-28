// sfp — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "swingLen",
    label: "Swing Lookback",
    type: "number",
    min: 5,
    max: 50,
    step: 1,
    tip: "Bars required either side of a pivot. Larger = fewer, more significant swings to sweep.",
  },
  {
    key: "threshold",
    label: "Min Volume Strength %",
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    tip: "Hide sweeps scoring below this. 70% volume percentile + 30% reclaim speed; 50 and up print the +SFP tier.",
  },
  {
    key: "filter",
    label: "Trend Filter",
    type: "select",
    options: [
      { v: "none", label: "All" },
      { v: "withTrend", label: "With trend" },
      { v: "counterTrend", label: "Counter-trend" },
    ],
    tip: "Trend is read from EMA20 vs EMA50 on this timeframe, at the bar the pattern confirms.",
  },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 2,
    max: 16,
    step: 1,
    tip: "How many swing failures stay on the chart. Detection always runs over full history.",
  },
  {
    key: "deviationZone",
    label: "Deviation Zone",
    type: "bool",
    tip: "Tinted band from the sweep extreme back to the swept level, 12 bars wide.",
  },
  {
    key: "showInvalid",
    label: "Keep Invalidated",
    type: "bool",
    tip: "A pattern whose sweep extreme is later closed through stays on the chart, greyed out, instead of being removed.",
  },
  {
    key: "textSize",
    label: "Label Size",
    type: "select",
    options: [
      { v: "small", label: "Small" },
      { v: "normal", label: "Normal" },
      { v: "large", label: "Large" },
    ],
  },
];

const DEFAULTS: Record<string, any> = {
  swingLen: 20,
  threshold: 0,
  filter: "none",
  showLast: 8,
  deviationZone: true,
  showInvalid: false,
  textSize: "normal",
};

export const SFP_META: SuiteModuleMeta = {
  key: "sfp",
  label: "Swing Failure",
  tag: "SFP",
  tier: "pro",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
