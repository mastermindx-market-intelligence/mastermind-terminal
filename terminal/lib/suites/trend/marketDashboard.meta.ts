// marketDashboard — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "pos",
    label: "Position",
    type: "select",
    options: [
      { v: "tl", label: "Top Left" },
      { v: "tr", label: "Top Right" },
      { v: "bl", label: "Bottom Left" },
      { v: "br", label: "Bottom Right" },
    ],
    tip: "Corner of the price pane the dashboard anchors to.",
  },
  { key: "compact", label: "Compact", type: "bool", tip: "Tighter paddings and smaller type." },
  {
    key: "volatility",
    label: "Volatility Row",
    type: "bool",
    tip: "ATR(14)/close percentile vs the last 252 bars.",
  },
  {
    key: "compression",
    label: "Compression Row",
    type: "bool",
    tip: "Bollinger(20,2) bandwidth percentile inverted to 0–10; 10 = tightest.",
  },
  {
    key: "trendScore",
    label: "Trend Score Row",
    type: "bool",
    tip: "−10..+10 blend of Trend Engine regime, EMA20/50 and close vs EMA200.",
  },
  {
    key: "pressure",
    label: "Pressure Row",
    type: "bool",
    tip: "20-bar volume-weighted candle-geometry delta, percentile-mapped to −10..+10.",
  },
  {
    key: "rating",
    label: "Rating Row",
    type: "bool",
    tip: "STRONG BUY…STRONG SELL vote of trend, pressure and compression.",
  },
  {
    key: "mtf",
    label: "MTF Row",
    type: "bool",
    tip: "Trend Engine regime on the chart bars and on 2×/4× resamples of them.",
  },
];

const DEFAULTS: Record<string, any> = {
  pos: "tr",
  compact: false,
  volatility: true,
  compression: true,
  trendScore: true,
  pressure: true,
  rating: true,
  mtf: true,
};

export const MARKET_DASHBOARD_META: SuiteModuleMeta = {
  key: "dash",
  label: "Market Dashboard",
  // "MD" was already taken by MACD Divergence (macdx suite). Legend chips are only qualified by
  // suite in Settings, so an accidental cross-suite collision is a legibility bug — see the pinned
  // collision list in suiteModules.test.ts.
  tag: "DSH",
  tier: "pro",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
