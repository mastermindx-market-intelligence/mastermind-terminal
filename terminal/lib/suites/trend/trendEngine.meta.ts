// trendEngine — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "sensitivity",
    label: "Sensitivity",
    type: "number",
    min: 1,
    max: 10,
    step: 1,
    tip: "1 = fastest flips, 10 = strongest trends only",
  },
  {
    key: "autoOpt",
    label: "Auto-Optimize",
    type: "bool",
    tip: "Re-optimizes on new data — historical signals can restyle; leave off for stable history",
  },
  { key: "bands", label: "Trend Band", type: "bool" },
  { key: "shadow", label: "Shadow Band", type: "bool", tip: "Second band one ATR further with a soft cloud." },
  { key: "bgTint", label: "Background Tint", type: "bool" },
  { key: "pills", label: "BUY/SELL Pills", type: "bool", tip: "Entry pills at trend flips." },
  {
    key: "tiers",
    label: "Signal Tiers",
    type: "bool",
    tip: "\"+\" strong-signal tier + Power Bottom/Top badges.",
  },
  { key: "retests", label: "Retest Dots", type: "bool", tip: "Band touches that hold post-flip." },
  {
    key: "tpMode",
    label: "Take Profit",
    type: "select",
    options: [
      { v: "off", label: "Off" },
      { v: "dynamic", label: "Dynamic (ATR ladder)" },
      { v: "fixed", label: "Fixed %" },
    ],
  },
  {
    key: "tpCount",
    label: "TP Levels",
    type: "number",
    min: 1,
    max: 6,
    step: 1,
    showIf: { key: "tpMode", eq: "dynamic" },
  },
  { key: "tpFixed1", label: "TP1 %", type: "number", min: 0.1, max: 90, step: 0.5, showIf: { key: "tpMode", eq: "fixed" } },
  { key: "tpFixed2", label: "TP2 %", type: "number", min: 0.1, max: 90, step: 0.5, showIf: { key: "tpMode", eq: "fixed" } },
  { key: "tpFixed3", label: "TP3 %", type: "number", min: 0.1, max: 90, step: 0.5, showIf: { key: "tpMode", eq: "fixed" } },
  {
    key: "slMode",
    label: "Stop Loss",
    type: "select",
    options: [
      { v: "off", label: "Off" },
      { v: "fixed", label: "Fixed %" },
      { v: "trailing", label: "Trailing (band)" },
    ],
  },
  { key: "slFixed", label: "SL %", type: "number", min: 0.1, max: 50, step: 0.5, showIf: { key: "slMode", eq: "fixed" } },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 1,
    max: 6,
    step: 1,
    tip: "Signal episodes with full TP/SL chrome.",
  },
];

const DEFAULTS: Record<string, any> = {
  sensitivity: 5,
  autoOpt: false,
  bands: true,
  shadow: false,
  bgTint: true,
  pills: true,
  tiers: true,
  retests: true,
  tpMode: "dynamic",
  tpCount: 3,
  tpFixed1: 2,
  tpFixed2: 4,
  tpFixed3: 8,
  slMode: "trailing",
  slFixed: 3,
  showLast: 2,
};

export const TREND_ENGINE_META: SuiteModuleMeta = {
  key: "te",
  label: "Trend Engine",
  tag: "TE",
  tier: "essential",
  defaultOn: true,
  fields: FIELDS,
  defaults: DEFAULTS,
};
