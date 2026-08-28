// flowBand — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "length",
    label: "Length",
    type: "number",
    min: 20,
    max: 100,
    step: 1,
    tip: "Hull moving average length for the band midline.",
  },
  {
    key: "atrMult",
    label: "Band Width (ATR)",
    type: "number",
    min: 1,
    max: 4,
    step: 0.1,
    tip: "Envelope distance from the midline, in ATR(14) multiples.",
  },
  {
    key: "htf",
    label: "Source Timeframe",
    type: "select",
    options: [
      { v: "chart", label: "Chart" },
      { v: "2x", label: "2× bars" },
      { v: "4x", label: "4× bars" },
    ],
    tip: "Compute on a coarser resample for smoother trend",
  },
  {
    key: "cloud",
    label: "Cloud",
    type: "bool",
    tip: "Fill the envelope between the upper and lower band.",
  },
  {
    key: "turnSignals",
    label: "Turn Signals",
    type: "bool",
    tip: "Triangle plus price label at every direction flip.",
  },
  {
    key: "retestSignals",
    label: "Retest Signals",
    type: "bool",
    tip: "Mark pullbacks that tag the band and close back with the trend.",
  },
  {
    key: "qualityChips",
    label: "Quality Chips",
    type: "bool",
    tip: "0-100 retest quality score",
    showIf: { key: "retestSignals", eq: true },
  },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 2,
    max: 16,
    step: 1,
    tip: "How many recent trend segments keep their turn and retest markers.",
  },
];

const DEFAULTS: Record<string, any> = {
  length: 50,
  atrMult: 1.8,
  htf: "chart",
  cloud: true,
  turnSignals: true,
  retestSignals: true,
  qualityChips: true,
  showLast: 8,
};

export const FLOW_BAND_META: SuiteModuleMeta = {
  key: "fb",
  label: "Flow Band",
  tag: "FB",
  tier: "essential",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
