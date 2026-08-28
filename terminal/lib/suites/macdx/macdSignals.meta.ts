// macdSignals — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "threshold",
    label: "Extreme Zone",
    type: "number",
    min: 60,
    max: 95,
    step: 1,
    tip: "How deep into the ±100 range a cross must happen to count. Higher = fewer, stronger signals.",
  },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 4,
    max: 24,
    step: 1,
    tip: "How many triangles stay on the chart. Alerts still fire on every signal.",
  },
];

const DEFAULTS: Record<string, any> = {
  threshold: 80,
  showLast: 12,
};

export const MACD_SIGNALS_META: SuiteModuleMeta = {
  key: "sig",
  label: "MACD Signals",
  tag: "MS",
  tier: "essential",
  defaultOn: true,
  fields: FIELDS,
  defaults: DEFAULTS,
};
