// autoPatterns — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "size",
    label: "Size",
    type: "select",
    options: [
      { v: "small", label: "Small" },
      { v: "medium", label: "Medium" },
      { v: "big", label: "Big" },
    ],
    tip: "Pivot wing used to anchor lines: small 5, medium 8, big 12 bars each side.",
  },
  {
    key: "targets",
    label: "Measured-Move Targets",
    type: "bool",
    tip: "Project the channel height from a channel break as a dashed target level.",
  },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 1,
    max: 4,
    step: 1,
    tip: "How many pattern sets (newest first) stay on the chart.",
  },
];

const DEFAULTS: Record<string, any> = {
  size: "medium",
  targets: true,
  showLast: 2,
};

export const AUTO_PATTERNS_META: SuiteModuleMeta = {
  key: "pat",
  label: "Auto Patterns",
  tag: "PAT",
  tier: "pro",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
