// rsiChannels — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "model",
    label: "Channel Model",
    type: "select",
    options: [
      { v: "bollinger", label: "Bollinger" },
      { v: "keltner", label: "Keltner" },
      { v: "donchian", label: "Donchian" },
    ],
    tip: "Bollinger breathes with RSI volatility, Keltner is smoother, Donchian steps between RSI extremes.",
  },
  {
    key: "length",
    label: "Length",
    type: "number",
    min: 10,
    max: 60,
    step: 1,
    tip: "Window of the channel statistics, in bars.",
  },
  {
    key: "mult",
    label: "Width (×)",
    type: "number",
    min: 1,
    max: 3,
    step: 0.1,
    tip: "Half-width multiplier — stdev for Bollinger, mean RSI range for Keltner. Unused by Donchian.",
  },
];

const DEFAULTS: Record<string, any> = { model: "bollinger", length: 20, mult: 2 };

export const RSI_CHANNELS_META: SuiteModuleMeta = {
  key: "chan",
  label: "RSI Channels",
  tag: "RC",
  tier: "pro",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
