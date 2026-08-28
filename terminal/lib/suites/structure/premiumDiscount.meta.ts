// premiumDiscount — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";

/** Upper bound on the range count — the settings schema and the compute share this one value. */
export const MAX_SHOW_LAST = 3;
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "rangeLen",
    label: "Range Length",
    type: "number",
    min: 3,
    max: 12,
    step: 1,
    tip: "Swing pairs that define the active range",
  },
  {
    key: "zones",
    label: "Premium / Discount",
    type: "bool",
    tip: "Tint the upper and lower 30% of the range.",
  },
  {
    key: "equilibrium",
    label: "Equilibrium",
    type: "bool",
    tip: "Dashed line at the 50% midpoint of the range.",
  },
  {
    key: "showFib",
    label: "Fib Levels",
    type: "bool",
    tip: "Retracement overlay anchored on the trend side of the range.",
  },
  {
    key: "goldenPocket",
    label: "Golden Pocket",
    type: "bool",
    tip: "Shade the 0.618–0.650 band inside the retracement.",
    showIf: { key: "showFib", eq: true },
  },
  {
    key: "labels",
    label: "Labels",
    type: "bool",
    tip: "Price labels at levels",
  },
  {
    key: "showLast",
    label: "Ranges Kept",
    type: "number",
    min: 1,
    max: MAX_SHOW_LAST,
    step: 1,
    tip: "Ranges kept",
  },
];

const DEFAULTS: Record<string, any> = {
  rangeLen: 5,
  zones: true,
  equilibrium: true,
  showFib: true,
  goldenPocket: true,
  labels: true,
  showLast: 1,
};

export const PREMIUM_DISCOUNT_META: SuiteModuleMeta = {
  key: "pd",
  label: "Premium & Discount",
  tag: "PD",
  tier: "essential",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
