// rsiSignals — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "signals",
    label: "Reversal Signals",
    type: "bool",
    tip: "Triangle on the confirmed turn out of the 65/35 zones — one per excursion.",
  },
  {
    key: "deviations",
    label: "Deviation +1 / +2",
    type: "bool",
    tip: "Follow-through levels projected 12 and 24 RSI points from a signal, held 12 bars. Solid until touched, dashed after.",
  },
  {
    key: "crossDots",
    label: "Crossover Dots",
    type: "bool",
    tip: "RSI × smoothing-MA crosses, plotted only outside the 45–55 neutral band.",
  },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 4,
    max: 30,
    step: 1,
    tip: "How many reversal signals (and their deviation levels) stay on the pane.",
  },
];

const DEFAULTS: Record<string, any> = {
  signals: true,
  deviations: true,
  crossDots: true,
  showLast: 12,
};

export const RSI_SIGNALS_META: SuiteModuleMeta = {
  key: "sig",
  label: "RSI Signals",
  tag: "RS",
  tier: "essential",
  defaultOn: true,
  fields: FIELDS,
  defaults: DEFAULTS,
};
