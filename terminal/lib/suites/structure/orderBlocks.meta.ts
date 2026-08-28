// orderBlocks — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";

export const ORDER_BLOCKS_META: SuiteModuleMeta = {
  key: "ob",
  label: "Order Blocks",
  tag: "OB",
  tier: "pro",
  defaultOn: true,
  defaults: {
    method: "volume",
    showLast: 6,
    type: "all",
    boundsMode: "range",
    mitigation: "close",
    kImpulse: 1.6,
    volPercentile: 60,
    breaker: true,
    showInternals: true,
    showRating: true,
    sizeDetail: "small",
    extendRight: true,
    macro: false,
  },
  fields: [
    {
      key: "method",
      label: "Detection",
      type: "select",
      options: [
        { v: "volume", label: "Volume" },
        { v: "priceAction", label: "Price Action" },
        { v: "peak", label: "Peak (exhaustion)" },
      ],
      tip: "Volume = range expansion confirmed by a volume percentile. Price Action = close through the last internal pivot. Peak = expansion on a local volume maximum closing at its extreme (confirms one bar later).",
    },
    { key: "showLast", label: "Show last", type: "number", min: 1, max: 12, step: 1, tip: "How many live blocks stay on the chart." },
    {
      key: "type",
      label: "Block type",
      type: "select",
      options: [
        { v: "all", label: "All" },
        { v: "bull", label: "Bullish only" },
        { v: "bear", label: "Bearish only" },
      ],
    },
    {
      key: "boundsMode",
      label: "Zone bounds",
      type: "select",
      options: [
        { v: "range", label: "Full range (high/low)" },
        { v: "body", label: "Body (open/close)" },
      ],
    },
    {
      key: "mitigation",
      label: "Mitigation",
      type: "select",
      options: [
        { v: "touch", label: "Touch" },
        { v: "wick", label: "Wick" },
        { v: "close", label: "Close" },
        { v: "avg", label: "Average (midline)" },
      ],
      tip: "What counts as the block being used up.",
    },
    { key: "kImpulse", label: "Impulse × ATR", type: "number", min: 0.8, max: 3, step: 0.1, tip: "Body size relative to ATR(14) required to call a bar an impulse." },
    { key: "volPercentile", label: "Volume percentile", type: "number", min: 30, max: 90, step: 1, tip: "Trailing 200-bar volume percentile gate (Volume detection).", showIf: { key: "method", eq: "volume" } },
    { key: "breaker", label: "Breaker blocks", type: "bool", tip: "Keep mitigated blocks as role-flipped breakers instead of removing them." },
    { key: "showInternals", label: "Volume internals", type: "bool", tip: "Buy/sell ratio capsules and the volume + delta chips." },
    { key: "showRating", label: "Rating bar", type: "bool" },
    {
      key: "sizeDetail",
      label: "Tier label size",
      type: "select",
      options: [
        { v: "small", label: "Small" },
        { v: "large", label: "Large" },
      ],
    },
    { key: "extendRight", label: "Extend right", type: "bool", tip: "Off = the zone stops 15 bars after it forms." },
    { key: "macro", label: "Macro blocks", type: "bool", tip: "Adds larger-scale blocks detected on 4× resampled bars." },
  ],
};
