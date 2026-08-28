// fvg — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "thresholdATR",
    label: "Min Gap Size (ATR)",
    type: "number",
    min: 0,
    max: 1,
    step: 0.05,
    tip: "Ignore imbalances smaller than this multiple of ATR(14).",
  },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 2,
    max: 20,
    step: 1,
    tip: "How many still-open gaps stay on the chart.",
  },
  {
    key: "type",
    label: "Type",
    type: "select",
    options: [
      { v: "all", label: "All" },
      { v: "bull", label: "Bullish only" },
      { v: "bear", label: "Bearish only" },
    ],
  },
  {
    key: "showPoc",
    label: "POC Line",
    type: "select",
    options: [
      { v: "off", label: "Off" },
      { v: "highestVolume", label: "Highest volume" },
      { v: "mean", label: "Midpoint" },
    ],
    tip: "Point of control inside the gap: the typical price of the heaviest formation bar, or the gap midpoint.",
  },
  {
    key: "iFvg",
    label: "Inversion (iFVG)",
    type: "bool",
    tip: "Keep a gap that is closed through by a full body and flip its role instead of deleting it.",
  },
  {
    key: "hideOverlap",
    label: "Hide Overlapped",
    type: "bool",
    tip: "Skip a new gap that is already ≥60% covered by an open gap on the same side.",
  },
  {
    key: "signals",
    label: "Signals",
    type: "select",
    options: [
      { v: "off", label: "Off" },
      { v: "created", label: "Creation" },
      { v: "retest", label: "Retest" },
      { v: "both", label: "Both" },
    ],
  },
  {
    key: "extend",
    label: "Extend",
    type: "select",
    options: [
      { v: "right", label: "To right edge" },
      { v: "limited", label: "20 bars" },
    ],
  },
];

const DEFAULTS: Record<string, any> = {
  thresholdATR: 0.25,
  showLast: 8,
  type: "all",
  showPoc: "highestVolume",
  iFvg: true,
  hideOverlap: true,
  signals: "created",
  extend: "right",
};

export const FVG_META: SuiteModuleMeta = {
  key: "fvg",
  label: "Fair Value Gaps",
  tag: "FVG",
  tier: "essential",
  defaultOn: true,
  fields: FIELDS,
  defaults: DEFAULTS,
};
