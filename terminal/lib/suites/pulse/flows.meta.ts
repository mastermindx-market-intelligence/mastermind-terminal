// flows — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "source",
    label: "Flow Line",
    type: "select",
    options: [
      { v: "mfi", label: "Money Flow (MFI)" },
      { v: "cvd", label: "Volume Flow (CVD)" },
      { v: "both", label: "Both" },
    ],
    tip: "MFI = volume-weighted money flow, ±40 marks the 70/30 extremes. CVD = cumulative aggressor delta, normalized around its own mean. Divergences run on MFI whenever it is shown.",
  },
  {
    key: "divergences",
    label: "Divergences",
    type: "bool",
    tip: "Dashed connectors between flow pivots: D = regular (reversal), H = hidden (continuation).",
  },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 2,
    max: 12,
    step: 1,
    tip: "How many divergence drawings stay on the pane. Alerts keep firing on every one.",
  },
];

const DEFAULTS: Record<string, any> = {
  source: "mfi",
  divergences: true,
  showLast: 6,
};

export const FLOWS_META: SuiteModuleMeta = {
  key: "flow",
  label: "Money Flows",
  tag: "MF",
  tier: "pro",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
