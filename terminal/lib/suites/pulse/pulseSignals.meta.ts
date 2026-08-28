// pulseSignals — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "buySell",
    label: "Buy / Sell Markers",
    type: "bool",
    tip: "Triple-line marker when the wave turns up from oversold or rolls over from overbought.",
  },
  {
    key: "dipDiamonds",
    label: "Dip Diamonds",
    type: "bool",
    tip: "Small diamond on an in-trend dip that holds its side of zero — pullback cue.",
  },
  {
    key: "peaks",
    label: "Peak Dots",
    type: "bool",
    tip: "Dot on the wave at local extremes beyond ±80.",
  },
  {
    key: "gappedCross",
    label: "Gapped Crosses",
    type: "bool",
    tip: "Diamond when the wave crosses its gapped line inside the extreme zone.",
  },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 4,
    max: 40,
    step: 1,
    tip: "How many glyphs of each family stay on the chart.",
  },
];

const DEFAULTS: Record<string, any> = {
  buySell: true,
  dipDiamonds: true,
  peaks: false,
  gappedCross: false,
  showLast: 16,
};

export const PULSE_SIGNALS_META: SuiteModuleMeta = {
  key: "sig",
  label: "Pulse Signals",
  tag: "PS",
  tier: "essential",
  defaultOn: true,
  fields: FIELDS,
  defaults: DEFAULTS,
};
