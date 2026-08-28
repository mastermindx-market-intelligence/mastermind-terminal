// voltixBands — METADATA ONLY (identity, settings schema, parameter defaults).
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
    min: 10,
    max: 60,
    step: 1,
    tip: "Bars in the midline EMA and in the ATR that sets the band width.",
  },
  {
    key: "mult",
    label: "Width (× ATR)",
    type: "number",
    min: 1,
    max: 4,
    step: 0.1,
    tip: "Half-width of the envelope as a multiple of smoothed ATR. Bands widen at once on a volatility burst and deflate slowly.",
  },
  {
    key: "midline",
    label: "Midline",
    type: "bool",
    tip: "Dotted mean line, colored by its own slope regime.",
  },
  {
    key: "glow",
    label: "Overextension Glow",
    type: "bool",
    tip: "Shade the space between a band and the price extreme while price closes beyond it.",
  },
  {
    key: "retestSignals",
    label: "Reversal Signals",
    type: "bool",
    tip: "Triangle on the bar that re-enters the envelope and closes inside after an excursion.",
  },
  {
    key: "showLast",
    label: "Show Last",
    type: "number",
    min: 2,
    max: 20,
    step: 1,
    tip: "How many reversal triangles stay on the chart.",
  },
];

const DEFAULTS: Record<string, any> = {
  length: 20,
  mult: 2.2,
  midline: true,
  glow: true,
  retestSignals: true,
  showLast: 10,
};

export const VOLT_BANDS_META: SuiteModuleMeta = {
  key: "vb",
  label: "Volt Bands",
  tag: "VB",
  tier: "essential",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
