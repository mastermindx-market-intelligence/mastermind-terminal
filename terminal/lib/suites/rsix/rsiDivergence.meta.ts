// rsiDivergence — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "hidden",
    label: "Hidden Divergences",
    type: "bool",
    tip: "Also detect continuation (hidden) divergences — drawn dashed and softer than reversal ones.",
  },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 2,
    max: 16,
    step: 1,
    tip: "How many divergences stay on the pane. Alerts still fire for every one.",
  },
];

const DEFAULTS: Record<string, any> = { hidden: true, showLast: 8 };

export const RSI_DIVERGENCE_META: SuiteModuleMeta = {
  key: "div",
  label: "RSI Divergence",
  tag: "RD",
  tier: "pro",
  defaultOn: true,
  fields: FIELDS,
  defaults: DEFAULTS,
};
