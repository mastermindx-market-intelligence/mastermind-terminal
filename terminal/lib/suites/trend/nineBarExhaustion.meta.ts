// Nine-Bar Exhaustion — METADATA ONLY (identity, settings schema, parameter defaults).
// The pure calculation lives in lib/nineBarExhaustion.ts; this module is the native Trend-suite
// adapter and does not import proprietary DeMARK code or claim full Sequential 9–13 parity.

import type { SuiteField, SuiteModuleMeta } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "displayPolicy",
    label: "Display",
    type: "select",
    options: [
      { v: "retro6", label: "Reveal at 6 (vendor style)" },
      { v: "progressive", label: "Progressive 1–9" },
      { v: "completed", label: "Completed patterns only" },
    ],
    tip: "Reveal-at-6 hides an unfinished sequence until count 6, then shows 1–6 together.",
  },
  {
    key: "density",
    label: "Annotation Density",
    type: "select",
    options: [
      { v: "all", label: "All eligible counts" },
      { v: "late", label: "Late counts 6–9" },
      { v: "completion", label: "Completed 9 only" },
    ],
    tip: "Reduces chart clutter without changing the calculation or alert events.",
  },
  {
    key: "requireFlip",
    label: "Require Price Flip",
    type: "bool",
    tip: "Optional DeMARK-like start prerequisite: count 1 must follow the opposite four-bar relation.",
  },
  {
    key: "cycleMode",
    label: "Sustained Trend",
    type: "select",
    options: [
      { v: "single", label: "One completion per uninterrupted run" },
      { v: "repeat", label: "Repeat every 9 qualifying bars" },
    ],
    tip: "Repeat mode emits completions at streaks 9, 18, 27… — never on every later candle.",
  },
  {
    key: "showMarkers",
    label: "Completion Markers",
    type: "bool",
    tip: "Draw a diamond at each finalized 9. Forming nines never receive a confirmed marker.",
  },
  {
    key: "historyBars",
    label: "Recent History",
    type: "number",
    min: 50,
    max: 5000,
    step: 50,
    tip: "Only annotations inside this many recent chart bars are drawn; events remain deterministic.",
  },
  {
    key: "labelSize",
    label: "Label Size",
    type: "number",
    min: 8,
    max: 16,
    step: 1,
  },
];

const DEFAULTS: Record<string, unknown> = {
  displayPolicy: "retro6",
  density: "all",
  requireFlip: false,
  cycleMode: "single",
  showMarkers: true,
  historyBars: 500,
  labelSize: 10,
};

export const NINE_BAR_EXHAUSTION_META: SuiteModuleMeta = {
  key: "nine",
  label: "Nine-Bar Exhaustion",
  tag: "9X",
  tier: "free",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
