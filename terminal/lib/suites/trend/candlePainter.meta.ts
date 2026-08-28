// candlePainter — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "mode",
    label: "Mode",
    type: "select",
    options: [
      { v: "trend", label: "Trend" },
      { v: "momentum", label: "Momentum" },
      { v: "trendVolume", label: "Trend + Volume" },
      { v: "momentumVolume", label: "Momentum + Volume" },
    ],
    tip: "Trend = EMA20/50 regime. Momentum = RSI(14) bands with a weakening shade. The +Volume variants keep the same hue but paint less of the candle on quiet bars.",
  },
];

const DEFAULTS: Record<string, any> = {
  mode: "momentum",
};

export const CANDLE_PAINTER_META: SuiteModuleMeta = {
  key: "cp",
  label: "Candle Painter",
  tag: "CP",
  tier: "free",
  defaultOn: true,
  fields: FIELDS,
  defaults: DEFAULTS,
};
