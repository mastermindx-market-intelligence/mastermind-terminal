// macdHistogram — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "flips",
    label: "Flip Markers",
    type: "bool",
    tip: 'Print a "+" where the histogram changes side and the new side holds for a second bar.',
  },
];

const DEFAULTS: Record<string, any> = {
  flips: true,
};

export const MACD_HISTOGRAM_META: SuiteModuleMeta = {
  key: "hist",
  label: "Histogram",
  tag: "MH",
  tier: "essential",
  defaultOn: true,
  fields: FIELDS,
  defaults: DEFAULTS,
};
