// marketStructure — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  { key: "internalLen", label: "Internal structure length", type: "number", min: 2, max: 20, step: 1,
    tip: "Pivot wing for the fast (internal) structure chain." },
  { key: "swingLen", label: "Swing structure length", type: "number", min: 10, max: 100, step: 1,
    tip: "Pivot wing for the major (swing) chain — drives BOS/CHoCH, diamonds and mapping." },
  { key: "source", label: "Pivot source", type: "select",
    options: [{ v: "wick", label: "Wick" }, { v: "body", label: "Body" }],
    tip: "Wick uses high/low; Body uses the candle body extremes." },
  { key: "filter", label: "Direction filter", type: "select",
    options: [{ v: "all", label: "All" }, { v: "bull", label: "Bullish only" }, { v: "bear", label: "Bearish only" }],
    tip: "Gates which direction of structure prints on the chart." },
  { key: "projection", label: "Project pending levels", type: "bool",
    tip: "Extend the current un-broken swing high/low to the right edge." },
  { key: "cisd", label: "CISD (failed delivery)", type: "bool",
    tip: "Flags a break that is fully retraced within 10 bars." },
  { key: "diamonds", label: "Delta diamonds", type: "bool",
    tip: "Net-delta percentile at each confirmed swing pivot; hover for the breakdown." },
  { key: "mapping", label: "Mapping zigzag", type: "bool",
    tip: "Connect confirmed swing pivots wick-to-wick; the forming leg is dashed." },
  { key: "swingLabels", label: "Swing labels (HH/HL/LH/LL)", type: "bool" },
  { key: "strongWeak", label: "Strong / weak high & low", type: "bool",
    tip: "Tags the most recent swing high and low as defended or swept." },
  { key: "dtdb", label: "Double tops / bottoms", type: "bool" },
  { key: "dtdbThreshold", label: "Double top/bottom tolerance %", type: "number", min: 0.05, max: 2, step: 0.05,
    showIf: { key: "dtdb", eq: true },
    tip: "Maximum distance between the two extremes, in percent." },
  { key: "structCandles", label: "Structure candles", type: "bool",
    tip: "Recolor every candle by the internal trend state." },
  { key: "showLast", label: "Show last N structure events", type: "number", min: 4, max: 40, step: 1,
    tip: "Caps what is DRAWN — detection always runs over full history." },
];

const DEFAULTS: Record<string, any> = {
  internalLen: 5,
  swingLen: 50,
  source: "wick",
  filter: "all",
  projection: true,
  cisd: true,
  diamonds: true,
  mapping: false,
  swingLabels: true,
  strongWeak: false,
  dtdb: true,
  dtdbThreshold: 0.3,
  structCandles: false,
  showLast: 12,
};

export const MARKET_STRUCTURE_META: SuiteModuleMeta = {
  key: "ms",
  label: "Market Structure",
  tag: "MS",
  tier: "essential",
  defaultOn: true,
  fields: FIELDS,
  defaults: DEFAULTS,
};
