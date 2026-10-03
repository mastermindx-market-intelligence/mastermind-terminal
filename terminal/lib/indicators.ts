// Central registry for the chart's built-in indicators — the single source of truth shared by the
// legend (ChartOverlays), the settings dialog (IndicatorSettings), the chart engine (ChartPanel) and
// the workspace state (TerminalShell). Each indicator declares:
//   • how it shows up (label/tag, overlay-on-price vs its own sub-pane)
//   • its full set of user-editable inputs + style fields (drives the Settings dialog)
//   • default parameter values (used to seed state and to backfill older persisted params)
//   • a read-only Pine-style source snippet (shown by the legend's "Source code" action)
//
// Pine custom scripts are NOT in this registry — they carry their own source/params and are handled
// directly in TerminalShell/ChartPanel.

export type IndKey = "ema" | "bb" | "vwap" | "vol" | "rsi" | "stochrsi" | "macd" | "mtfconfluence" | "mtfstoch" | "mtfmacd" | "gaps"
  | "ichimoku" | "ribbon" | "supertrend" | "avwap" | "rvwap" | "wvwap" | "vprofile" | "volbox"
  | "rsistack" | "accum" | "_lab"
  // Day Trade suite
  | "svwap" | "orb" | "slevels" | "pivots" | "rvol" | "ttmsq" | "adx" | "cvd"
  // Market Structure Core (R3.1) — dealer-positioning levels from the nightly options build
  | "optlevels";
export type IndKind = "overlay" | "pane";
export type FieldType = "number" | "color" | "bool";

export interface IndField {
  key: string;
  label: string;
  tkey?: string;
  type: FieldType;
  group: "inputs" | "style";
  min?: number;
  max?: number;
  step?: number;
}

export interface IndDef {
  key: IndKey;
  tkey?: string;
  label: string;   // full legend name
  tag: string;     // short label (used in compact contexts)
  kind: IndKind;   // overlay = draws on the price pane; pane = gets its own sub-pane
  defaults: Record<string, any>;
  fields: IndField[];
  source: string;  // read-only pseudo-Pine, shown by "Source code…"
}

// canonical display/draw order — overlays first, then sub-pane indicators top→bottom
export const IND_ORDER: IndKey[] = [
  "ema", "bb", "vwap", "vol", "gaps",
  "ichimoku", "ribbon", "supertrend", "avwap", "rvwap", "wvwap", "vprofile", "volbox",
  // Day Trade suite overlays (price pane)
  "svwap", "orb", "slevels", "pivots",
  // Options positioning levels (price pane, data-fed — nightly options build)
  "optlevels",
  "rsi", "stochrsi", "macd", "mtfstoch", "mtfmacd", "mtfconfluence", "rsistack", "accum",
  // Day Trade suite sub-panes
  "rvol", "ttmsq", "adx", "cvd",
  "_lab",
];

// TV-parity palette for the native shell only (docs/tv-parity, measured). Web keeps locked v5.
// Module scope is safe: the pre-paint LOCALE_INIT script (app/layout.tsx) stamps data-shell on
// <html> before any bundle executes, and these values never reach SSR'd HTML (no hydration risk).
// Three deliberate deviations from the raw measurement — do NOT "fix" them:
//  1. C4/CHART-04 RESOLVED the old geometry-vs-alpha trade: the band itself shrank 22% → 12%
//     (ChartPanel's "volume" scaleMargins), so upFill/downFill no longer have to compensate and
//     carry 0.70. upHist/downHist stay at 0.55 — the histograms live in their own sub-panes and
//     were never oversized. Alpha and band size must move TOGETHER; changing one alone re-breaks it.
//  2. COL.faint (MA-200) darkens — in the shell it was the brightest line on the chart.
//  3. MACD-RSI cyan/yellow are untouched; TV's own oscillator pills measure the same family.
const _SHELL = typeof document !== "undefined"
  && document.documentElement.getAttribute("data-shell") === "app";
const COL = {
  warn: "#e8a33d",
  link: _SHELL ? "#2962ff" : "#4d82ff",
  faint: _SHELL ? "rgba(177,181,190,0.38)" : "rgba(214,218,227,0.5)",
  up: _SHELL ? "#089981" : "#26c281",
  down: _SHELL ? "#f23645" : "#f0566b",
  gold: "#e8b339", yellow: "#f5c518",
  upFill: _SHELL ? "rgba(8,153,129,0.70)" : "rgba(38,194,129,0.4)",
  downFill: _SHELL ? "rgba(242,54,69,0.70)" : "rgba(240,86,107,0.4)",
  upHist: _SHELL ? "rgba(8,153,129,0.55)" : "rgba(38,194,129,0.5)",
  downHist: _SHELL ? "rgba(242,54,69,0.55)" : "rgba(240,86,107,0.5)",
  bbBand: "rgba(77,130,255,0.55)", bbBasis: "rgba(214,218,227,0.45)",
};

const MTF_DEFAULTS = {
  dOn: true, d3On: true, wOn: true, w2On: true, mOn: true,
  dCol: "#2962ff", d3Col: "#00bcd4", wCol: "#26c281", w2Col: "#e8b339", mCol: "#b06cff", width: 1.4,
};
const MTF_FIELDS: IndField[] = [
  ...([ ["dOn", "D"], ["d3On", "3D"], ["wOn", "W"], ["w2On", "2W"], ["mOn", "1M"] ] as const)
    .map(([key, label]) => ({ key, label, type: "bool" as const, group: "inputs" as const })),
  ...([ ["dCol", "D"], ["d3Col", "3D"], ["wCol", "W"], ["w2Col", "2W"], ["mCol", "1M"] ] as const)
    .map(([key, label]) => ({ key, label: `${label} color`, tkey: `mtfColor${label}`, type: "color" as const, group: "style" as const })),
  { key: "width", label: "Line width", tkey: "mtfLineWidth", type: "number", group: "style", min: 1, max: 4, step: 0.2 },
];

export const IND_DEFS: Record<IndKey, IndDef> = {
  ema: {
    key: "ema", label: "Moving Averages", tag: "MA", kind: "overlay",
    defaults: {
      ma1On: true, ma1Len: 20, ma1Col: COL.warn,
      ma2On: true, ma2Len: 50, ma2Col: COL.link,
      ma3On: true, ma3Len: 200, ma3Col: COL.faint,
      width: 1,
    },
    fields: [
      { key: "ma1On", label: "MA 1", type: "bool", group: "inputs" },
      { key: "ma1Len", label: "MA 1 length", type: "number", group: "inputs", min: 1, max: 500, step: 1 },
      { key: "ma2On", label: "MA 2", type: "bool", group: "inputs" },
      { key: "ma2Len", label: "MA 2 length", type: "number", group: "inputs", min: 1, max: 500, step: 1 },
      { key: "ma3On", label: "MA 3", type: "bool", group: "inputs" },
      { key: "ma3Len", label: "MA 3 length", type: "number", group: "inputs", min: 1, max: 500, step: 1 },
      { key: "ma1Col", label: "MA 1 color", type: "color", group: "style" },
      { key: "ma2Col", label: "MA 2 color", type: "color", group: "style" },
      { key: "ma3Col", label: "MA 3 color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 1 },
    ],
    source: `//@version=6
indicator("Moving Averages", overlay = true)
len1 = input.int(20, "MA 1 length")
len2 = input.int(50, "MA 2 length")
len3 = input.int(200, "MA 3 length")
plot(ta.ema(close, len1), "MA 1", color.new(#e8a33d, 0))
plot(ta.ema(close, len2), "MA 2", color.new(#4d82ff, 0))
plot(ta.ema(close, len3), "MA 3", color.new(#d6dae3, 50))`,
  },
  bb: {
    key: "bb", label: "Bollinger Bands", tag: "BB", kind: "overlay",
    defaults: { length: 20, mult: 2, basisCol: COL.bbBasis, bandCol: COL.bbBand, width: 1 },
    fields: [
      { key: "length", label: "Length", type: "number", group: "inputs", min: 2, max: 200, step: 1 },
      { key: "mult", label: "StdDev", type: "number", group: "inputs", min: 0.1, max: 5, step: 0.1 },
      { key: "basisCol", label: "Basis color", type: "color", group: "style" },
      { key: "bandCol", label: "Bands color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 1 },
    ],
    source: `//@version=6
indicator("Bollinger Bands", overlay = true)
length = input.int(20, "Length")
mult = input.float(2.0, "StdDev")
basis = ta.sma(close, length)
dev = mult * ta.stdev(close, length)
plot(basis, "Basis")
plot(basis + dev, "Upper")
plot(basis - dev, "Lower")`,
  },
  vwap: {
    key: "vwap", label: "VWAP", tag: "VWAP", kind: "overlay",
    defaults: { col: COL.gold, width: 1.4 },
    fields: [
      { key: "col", label: "Color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 0.5 },
    ],
    source: `//@version=6
indicator("VWAP", overlay = true)
typical = (high + low + close) / 3
plot(ta.cum(typical * volume) / ta.cum(volume), "VWAP", color.new(#e8b339, 0))`,
  },
  vol: {
    // pane-less: drawn embedded at the bottom of the price pane on its own hidden overlay scale
    key: "vol", label: "Volume", tag: "Vol", kind: "overlay",
    defaults: { upCol: COL.upFill, downCol: COL.downFill },
    fields: [
      { key: "upCol", label: "Up color", type: "color", group: "style" },
      { key: "downCol", label: "Down color", type: "color", group: "style" },
    ],
    source: `//@version=6
indicator("Volume")
col = close >= open ? color.new(#26c281, 60) : color.new(#f0566b, 60)
plot(volume, "Volume", col, style = plot.style_columns)`,
  },
  rsi: {
    key: "rsi", label: "RSI", tag: "RSI", kind: "pane",
    defaults: { length: 14, col: COL.link, width: 1.2, obLevel: 70, osLevel: 30, showLevels: true },
    fields: [
      { key: "length", label: "Length", type: "number", group: "inputs", min: 2, max: 100, step: 1 },
      { key: "obLevel", label: "Overbought", type: "number", group: "inputs", min: 50, max: 100, step: 1 },
      { key: "osLevel", label: "Oversold", type: "number", group: "inputs", min: 0, max: 50, step: 1 },
      { key: "showLevels", label: "Show OB/OS lines", type: "bool", group: "inputs" },
      { key: "col", label: "RSI color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 1 },
    ],
    source: `//@version=6
indicator("RSI")
length = input.int(14, "Length")
r = ta.rsi(close, length)
plot(r, "RSI", color.new(#4d82ff, 0))
hline(input.int(70, "Overbought"))
hline(input.int(30, "Oversold"))`,
  },
  stochrsi: {
    // NOTE: math is now the CM_Stochastic_MTF *price* stochastic (stoch of close/high/low),
    // NOT a stochastic-of-RSI. Label kept as "Stochastic RSI" (the user's term). The Golden
    // Oracle confluence keeps its own high-amplitude stoch-of-RSI — this indicator is chart-only.
    key: "stochrsi", label: "Stochastic RSI", tag: "Stoch RSI", kind: "pane",
    defaults: { length: 14, smoothK: 3, smoothD: 3, upLine: 80, lowLine: 20, kCol: COL.up, dCol: COL.down, width: 1.6 },
    fields: [
      { key: "length", label: "Length", type: "number", group: "inputs", min: 2, max: 100, step: 1 },
      { key: "smoothK", label: "Smooth %K", type: "number", group: "inputs", min: 1, max: 20, step: 1 },
      { key: "smoothD", label: "Smooth %D", type: "number", group: "inputs", min: 1, max: 20, step: 1 },
      { key: "upLine", label: "Upper line", type: "number", group: "inputs", min: 50, max: 100, step: 1 },
      { key: "lowLine", label: "Lower line", type: "number", group: "inputs", min: 0, max: 50, step: 1 },
      { key: "kCol", label: "%K color", type: "color", group: "style" },
      { key: "dCol", label: "%D color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 0.5 },
    ],
    source: `//@version=5
// CM_Stochastic_MTF — ChrisMoody. Regular (price) stochastic, current timeframe.
indicator("CM_Stochastic_MTF", shorttitle="CM_Stoch_MTF")
len = input.int(14, "Length")
smoothK = input.int(3, "SmoothK")
smoothD = input.int(3, "SmoothD")
upLine = input.int(80, "Upper Line Value?")
lowLine = input.int(20, "Lower Line Value?")
k = ta.sma(ta.stoch(close, high, low, len), smoothK)
d = ta.sma(k, smoothD)
plot(k, "Stoch K", color=color.lime, linewidth=3)
plot(d, "Stoch D", color=color.red, linewidth=3)
hline(upLine, "Upper", color=color.red)
hline(lowLine, "Lower", color=color.lime)
hline(50, "Mid", color=color.gray)`,
  },
  mtfstoch: {
    key: "mtfstoch", label: "MTF Stochastic (HLC)", tkey: "indMtfStoch", tag: "MTF Stoch", kind: "pane",
    defaults: { ...MTF_DEFAULTS, showSignal: false },
    fields: [...MTF_FIELDS, { key: "showSignal", label: "Show %D (dashed)", tkey: "mtfShowD", type: "bool", group: "inputs" }],
    source: `// Existing Terminal price stochastic, not stochastic-of-RSI.
// %K = SMA(100 * (close - lowest(low,14)) / (highest(high,14) - lowest(low,14)),3).
// %D = SMA(%K,3). Each selected horizon uses canonical aggregated H/L/C.
// Solid = %K; optional dashed = %D. Closed bars only; calendar lanes appear next session.
// Raw values warm independently of RSI-MACD. No calibrated entry probability.`,
  },
  mtfmacd: {
    key: "mtfmacd", label: "MTF MACD-RSI", tkey: "indMtfMacd", tag: "MTF MACD-RSI", kind: "pane",
    defaults: { ...MTF_DEFAULTS, showSignal: false },
    fields: [...MTF_FIELDS, { key: "showSignal", label: "Show signal (dashed)", tkey: "mtfShowSignal", type: "bool", group: "inputs" }],
    source: `// Existing Terminal TH_RSIMACD+ convention, not price MACD.
// RSI(14) -> SMA-seeded EMA(14) - EMA(60); signal = EMA(5).
// Solid = raw RSI-MACD; optional dashed = signal, in the same horizon color.
// Native oscillator units, with zero included in the scale. Not normalized to 0-100.
// Closed bars only. Calendar horizons become visible at the next observed session.`,
  },
  mtfconfluence: {
    key: "mtfconfluence", label: "MTF Momentum Confluence", tkey: "indMtfConfluence", tag: "MTF Confluence", kind: "pane",
    defaults: { ...MTF_DEFAULTS },
    fields: [...MTF_FIELDS],
    source: `// Descriptive 0-100 prior from the existing Terminal HLC stochastic and RSI-MACD.
// D / 3D / W / 2W / 1M use the same closed-bar availability as the raw MTF panes.
// Missing warmup is unavailable, never zero. This is not a calibrated entry probability.`,
  },
  macd: {
    // RSI-based MACD (TH_RSIMACD+): MACD of the RSI, not of price. This is the same math the
    // Golden Oracle confluence uses for its "RSI-MACD" (rsi=RSI(close,14); macd=EMA(rsi,14)-EMA(rsi,60); signal=EMA(macd,5)).
    key: "macd", label: "MACD-RSI", tag: "MACD-RSI", kind: "pane",
    defaults: { rsiLen: 14, fastLen: 14, baseLen: 60, signalLen: 5, macdCol: "#00bcd4", signalCol: "#d4ac0d", upHist: COL.upHist, downHist: COL.downHist, width: 1.3 },
    fields: [
      { key: "rsiLen", label: "RSI length", type: "number", group: "inputs", min: 1, max: 100, step: 1 },
      { key: "fastLen", label: "Fast MA (on RSI)", type: "number", group: "inputs", min: 1, max: 100, step: 1 },
      { key: "baseLen", label: "Base MA (on RSI)", type: "number", group: "inputs", min: 1, max: 200, step: 1 },
      { key: "signalLen", label: "Signal length", type: "number", group: "inputs", min: 1, max: 100, step: 1 },
      { key: "macdCol", label: "MACD color", type: "color", group: "style" },
      { key: "signalCol", label: "Signal color", type: "color", group: "style" },
      { key: "upHist", label: "Histogram +", type: "color", group: "style" },
      { key: "downHist", label: "Histogram −", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 0.1 },
    ],
    source: `//@version=5
// TH_RSIMACD+ — RSI-based MACD (MACD computed on the RSI, not price).
indicator("TH_RSIMACD+", shorttitle="TH_RSIMACD+")
rsiLen    = input.int(14, "RSI")
fastLen   = input.int(14, "Fast MA")
baseLen   = input.int(60, "Base MA")
signalLen = input.int(5,  "Signal RSI")
rsi    = ta.rsi(close, rsiLen)
macd   = ta.ema(rsi, fastLen) - ta.ema(rsi, baseLen)
signal = ta.ema(macd, signalLen)
hist   = macd - signal
plot(hist,   "Histogram", style = plot.style_columns)
plot(macd,   "RSI MACD",  color = #00bcd4)
plot(signal, "Signal",    color = #d4ac0d)`,
  },
  gaps: {
    // signal-style overlay (no plotted series): zones are drawn on the chart's signal layer, so this
    // rides the same render path as the Golden Oracle marks (see ChartPanel renderSignals). Detects
    // true DAILY gaps (a day whose whole range clears the prior day's) — computed on the daily bars so
    // they show on ANY timeframe — and draws each as a shaded supply/demand ZONE that extends right
    // until price trades back into it (fills it). Unfilled gaps are solid; filled gaps fade back.
    key: "gaps", label: "Gap Zones", tag: "Gaps", kind: "overlay",
    defaults: {
      showGaps: true, minGapPct: 0.3, hideFilled: false, maxGaps: 40,
      gapUpCol: COL.up, gapDownCol: COL.down,
    },
    fields: [
      { key: "showGaps", label: "Show gap zones", type: "bool", group: "inputs" },
      { key: "minGapPct", label: "Min gap size %", type: "number", group: "inputs", min: 0, max: 20, step: 0.1 },
      { key: "hideFilled", label: "Hide filled gaps", type: "bool", group: "inputs" },
      { key: "maxGaps", label: "Max gaps shown", type: "number", group: "inputs", min: 1, max: 200, step: 1 },
      { key: "gapUpCol", label: "Gap-up (support) color", type: "color", group: "style" },
      { key: "gapDownCol", label: "Gap-down (resistance) color", type: "color", group: "style" },
    ],
    source: `//@version=6
indicator("Gap Zones", overlay = true, max_boxes_count = 200)
minGap  = input.float(0.3, "Min gap size %") / 100
hideFil = input.bool(false, "Hide filled gaps")
// A true daily gap: today's whole range clears yesterday's, leaving an unfilled price band.
gapUp   = low  > high[1] and (low  - high[1]) / high[1] >= minGap   // band [high[1], low]  → support
gapDown = high < low[1]  and (low[1] - high)  / low[1]  >= minGap   // band [high, low[1]]  → resistance
// The empty band is drawn as a zone (box) that extends right until a later bar trades back into it
// (up-gap fills when a low re-touches high[1]; down-gap fills when a high re-touches low[1]).
// Rendering is handled by the terminal's gap-zone renderer.`,
  },

  // ── DT Technicals Suite (display-tier descriptive) ──

  ichimoku: {
    key: "ichimoku", label: "Ichimoku Cloud", tag: "Ichi", kind: "overlay",
    defaults: {
      tenkan: 9, kijun: 26, senkouB: 52, displacement: 26,
      tenkanCol: "#4d82ff", kijunCol: "#e8a33d",
      spanACol: "rgba(38,194,129,0.18)", spanBCol: "rgba(240,86,107,0.18)",
      width: 1,
    },
    fields: [
      { key: "tenkan", label: "Tenkan length", type: "number", group: "inputs", min: 1, max: 100, step: 1 },
      { key: "kijun", label: "Kijun length", type: "number", group: "inputs", min: 1, max: 200, step: 1 },
      { key: "senkouB", label: "Senkou B length", type: "number", group: "inputs", min: 1, max: 300, step: 1 },
      { key: "displacement", label: "Displacement", type: "number", group: "inputs", min: 1, max: 100, step: 1 },
      { key: "tenkanCol", label: "Tenkan color", type: "color", group: "style" },
      { key: "kijunCol", label: "Kijun color", type: "color", group: "style" },
      { key: "spanACol", label: "Span A fill", type: "color", group: "style" },
      { key: "spanBCol", label: "Span B fill", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 1 },
    ],
    source: `//@version=6
indicator("Ichimoku Cloud", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — classic Ichimoku (Goichi Hosoda, 1969 / public domain)
tenkan = input.int(9, "Tenkan length")
kijun  = input.int(26, "Kijun length")
senkouBLen = input.int(52, "Senkou B length")
disp = input.int(26, "Displacement")
tenkanLine = (ta.highest(high, tenkan) + ta.lowest(low, tenkan)) / 2
kijunLine  = (ta.highest(high, kijun)  + ta.lowest(low, kijun))  / 2
spanA = (tenkanLine + kijunLine) / 2
spanB = (ta.highest(high, senkouBLen) + ta.lowest(low, senkouBLen)) / 2
plot(tenkanLine, "Tenkan", color.new(#4d82ff, 0))
plot(kijunLine,  "Kijun",  color.new(#e8a33d, 0))
p1 = plot(spanA, "Span A", offset = disp)
p2 = plot(spanB, "Span B", offset = disp)
fill(p1, p2, color = spanA >= spanB ? color.new(#26c281, 82) : color.new(#f0566b, 82))`,
  },

  ribbon: {
    key: "ribbon", label: "Trend Ribbon", tag: "Ribbon", kind: "overlay",
    defaults: {
      fast: 20, slow: 50, slopeWin: 10, colorCandles: true,
      colUp: "#26c281", colDn: "#f0566b",
      fillUp: "rgba(38,194,129,0.12)", fillDn: "rgba(240,86,107,0.12)",
      width: 1.5,
    },
    fields: [
      { key: "fast", label: "Fast EMA", type: "number", group: "inputs", min: 1, max: 200, step: 1 },
      { key: "slow", label: "Slow EMA", type: "number", group: "inputs", min: 1, max: 500, step: 1 },
      { key: "slopeWin", label: "Slope window", type: "number", group: "inputs", min: 2, max: 50, step: 1 },
      { key: "colorCandles", label: "Color candles", type: "bool", group: "inputs" },
      { key: "colUp", label: "Up line color", type: "color", group: "style" },
      { key: "colDn", label: "Down line color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 0.5 },
    ],
    source: `//@version=6
indicator("Trend Ribbon", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — dual-EMA ribbon with slope filter
fast = input.int(20, "Fast EMA")
slow = input.int(50, "Slow EMA")
slopeWin = input.int(10, "Slope window")
ef = ta.ema(close, fast)
es = ta.ema(close, slow)
ribbonUp = ef > es and es > es[slopeWin] and close > es
ribbonDn = ef < es and es < es[slopeWin] and close < es
plot(ef, "Fast EMA", color = ribbonUp ? #26c281 : ribbonDn ? #f0566b : #8b93a3)
plot(es, "Slow EMA", color = ribbonUp ? #26c281 : ribbonDn ? #f0566b : #8b93a3)`,
  },

  supertrend: {
    key: "supertrend", label: "SuperTrend", tag: "ST", kind: "overlay",
    defaults: { period: 10, mult: 3, colUp: "#26c281", colDn: "#f0566b", width: 2 },
    fields: [
      { key: "period", label: "ATR period", type: "number", group: "inputs", min: 1, max: 100, step: 1 },
      { key: "mult", label: "Multiplier", type: "number", group: "inputs", min: 0.5, max: 10, step: 0.5 },
      { key: "colUp", label: "Up color", type: "color", group: "style" },
      { key: "colDn", label: "Down color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 0.5 },
    ],
    source: `//@version=6
indicator("SuperTrend", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — classic SuperTrend (Olivier Seban, public domain)
period = input.int(10, "ATR period")
mult   = input.float(3.0, "Multiplier")
hl2    = (high + low) / 2
atrVal = ta.atr(period)
up     = hl2 - mult * atrVal
dn     = hl2 + mult * atrVal
var float upLine = na
var float dnLine = na
var bool  trend  = true
upLine := close[1] > upLine[1] ? math.max(up, upLine[1]) : up
dnLine := close[1] < dnLine[1] ? math.min(dn, dnLine[1]) : dn
trend  := close > dnLine[1] ? true : close < upLine[1] ? false : trend[1]
plot(trend ? upLine : na, "Up rail",   color.new(#26c281, 0), 2)
plot(trend ? na : dnLine, "Down rail", color.new(#f0566b, 0), 2)`,
  },

  avwap: {
    key: "avwap", label: "Anchored VWAP", tag: "AVWAP", kind: "overlay",
    defaults: { anchor: 0, lookback: 252, col: "#e8b339", width: 1.4 },
    fields: [
      // anchor: 0=swing_low, 1=swing_high, 2=max_history, 3=vol_spike (number field as proxy for select).
      // vol_spike anchors on the trailing max-volume bar — an EARNINGS PROXY (quarter's top-volume
      // session), NOT a true earnings date.
      { key: "anchor", label: "Anchor (0=swing low, 1=swing high, 2=full history, 3=vol-spike/earnings proxy)", type: "number", group: "inputs", min: 0, max: 3, step: 1 },
      { key: "lookback", label: "Lookback bars", type: "number", group: "inputs", min: 20, max: 2000, step: 1 },
      { key: "col", label: "Line color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 0.5 },
    ],
    source: `//@version=6
indicator("Anchored VWAP", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — cumulative Σ(TP×Vol)/Σ(Vol) from anchor bar (TP=(H+L+C)/3)
// anchor 0=swing_low, 1=swing_high, 2=max_history, 3=vol_spike (over lookback window)
// vol_spike = trailing max-volume bar (ties → most recent): a Vol-spike anchor (earnings PROXY,
// the quarter's top-volume session) — NOT a true earnings date.
lookback = input.int(252, "Lookback bars")
anchor   = input.int(0, "Anchor (0=low, 1=high, 2=history, 3=vol-spike/earnings proxy)")
// implementation: locate anchor in lookback window, compute cumulative VWAP from there
typical = (high + low + close) / 3
// (platform-specific anchor logic omitted from Pine stub)
plot(ta.cum(typical * volume) / ta.cum(volume), "AVWAP", color.new(#e8b339, 0), 1, plot.style_line, linestyle = plot.style_linebr, trackprice = false)`,
  },

  rvwap: {
    key: "rvwap", label: "Rolling VWAP (20)", tag: "RVWAP", kind: "overlay",
    defaults: { length: 20, col: "#4dd0c4", width: 1.3 },
    fields: [
      { key: "length", label: "Window (bars)", type: "number", group: "inputs", min: 2, max: 500, step: 1 },
      { key: "col", label: "Line color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 0.1 },
    ],
    source: `//@version=6
indicator("Rolling VWAP", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — trailing-window Σ(TP×Vol)/Σ(Vol), TP=(H+L+C)/3.
// Daily-bar approximation — not intraday-true VWAP. Null until 'length' bars.
length  = input.int(20, "Window (bars)")
typical = (high + low + close) / 3
plot(math.sum(typical * volume, length) / math.sum(volume, length), "RVWAP", color.new(#4dd0c4, 0))`,
  },

  wvwap: {
    key: "wvwap", label: "Weekly VWAP", tag: "WVWAP", kind: "overlay",
    defaults: { col: "#b57bff", width: 1.3 },
    fields: [
      { key: "col", label: "Line color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 0.1 },
    ],
    source: `//@version=6
indicator("Weekly VWAP", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — VWAP anchored to each week's first session (resets weekly,
// pandas W-FRI buckets), cumulative Σ(TP×Vol)/Σ(Vol), TP=(H+L+C)/3.
// Daily-bar approximation — not intraday-true VWAP.
typical = (high + low + close) / 3
newWeek = weekofyear != weekofyear[1]
var float cumTPV = na
var float cumV   = na
cumTPV := newWeek ? typical * volume : nz(cumTPV) + typical * volume
cumV   := newWeek ? volume           : nz(cumV)   + volume
plot(cumTPV / cumV, "WVWAP", color.new(#b57bff, 0))`,
  },

  vprofile: {
    key: "vprofile", label: "Volume Profile", tag: "Vol Profile", kind: "overlay",
    defaults: { window: 126, bins: 24, shelfMode: false, widthFrac: 0.18 },
    fields: [
      { key: "window", label: "Window (bars)", type: "number", group: "inputs", min: 20, max: 500, step: 1 },
      { key: "bins", label: "Price bins", type: "number", group: "inputs", min: 8, max: 64, step: 1 },
      { key: "shelfMode", label: "Money-flow weighted", type: "bool", group: "inputs" },
      { key: "widthFrac", label: "Bar width (fraction)", type: "number", group: "style", min: 0.05, max: 0.4, step: 0.01 },
    ],
    source: `//@version=6
indicator("Volume Profile", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — volume-by-price histogram (right-anchored)
// shelfMode weights each bar's volume by money-flow buy_share = ((c-l)-(h-c))/(h-l) mapped to [0,1]
// POC = price-bin with highest volume; VAH/VAL = 70% value area (symmetric from POC)
// Rendered via SVG overlay (not a native LWC series)`,
  },

  volbox: {
    key: "volbox", label: "Volatility Box", tag: "VolBox", kind: "overlay",
    defaults: { bbLen: 20, mult: 2, pctileWin: 126, squeezePct: 25, boxWin: 20 },
    fields: [
      { key: "bbLen", label: "BB length", type: "number", group: "inputs", min: 5, max: 100, step: 1 },
      { key: "mult", label: "BB StdDev", type: "number", group: "inputs", min: 0.5, max: 5, step: 0.5 },
      { key: "pctileWin", label: "Percentile window", type: "number", group: "inputs", min: 20, max: 500, step: 1 },
      { key: "squeezePct", label: "Squeeze threshold %", type: "number", group: "inputs", min: 5, max: 50, step: 5 },
      { key: "boxWin", label: "Box range window", type: "number", group: "inputs", min: 5, max: 100, step: 1 },
    ],
    source: `//@version=6
indicator("Volatility Box", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — Bollinger Band squeeze → consolidation box
// bandwidth = (upper-lower)/basis; squeeze when rolling percentile <= squeezePct
// box_hi = rolling max(high, boxWin); box_lo = rolling min(low, boxWin) during squeeze
// Rendered via SVG overlay; "resolved up/down" = descriptive breakout direction only`,
  },

  rsistack: {
    key: "rsistack", label: "RSI Stack", tag: "RSI Stack", kind: "pane",
    defaults: {
      len1: 7, len2: 14, len3: 21,
      ob: 70, os: 30, showLevels: true,
      col1: "#26c281", col2: "#4d82ff", col3: "#e8a33d", width: 1.4,
    },
    fields: [
      { key: "len1", label: "RSI 1 length", type: "number", group: "inputs", min: 2, max: 100, step: 1 },
      { key: "len2", label: "RSI 2 length", type: "number", group: "inputs", min: 2, max: 100, step: 1 },
      { key: "len3", label: "RSI 3 length", type: "number", group: "inputs", min: 2, max: 100, step: 1 },
      { key: "ob", label: "Overbought", type: "number", group: "inputs", min: 50, max: 100, step: 1 },
      { key: "os", label: "Oversold", type: "number", group: "inputs", min: 0, max: 50, step: 1 },
      { key: "showLevels", label: "Show OB/OS lines", type: "bool", group: "inputs" },
      { key: "col1", label: "RSI 1 color", type: "color", group: "style" },
      { key: "col2", label: "RSI 2 color", type: "color", group: "style" },
      { key: "col3", label: "RSI 3 color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 0.5 },
    ],
    source: `//@version=6
indicator("RSI Stack")
// DISPLAY-TIER DESCRIPTIVE — three RSI periods overlaid in one pane
len1 = input.int(7, "RSI 1 length")
len2 = input.int(14, "RSI 2 length")
len3 = input.int(21, "RSI 3 length")
ob   = input.int(70, "Overbought")
os   = input.int(30, "Oversold")
plot(ta.rsi(close, len1), "RSI 7",  color.new(#26c281, 0))
plot(ta.rsi(close, len2), "RSI 14", color.new(#4d82ff, 0))
plot(ta.rsi(close, len3), "RSI 21", color.new(#e8a33d, 0))
hline(ob); hline(os)`,
  },

  accum: {
    key: "accum", label: "Accumulation %", tag: "Accum", kind: "pane",
    defaults: { win: 63, showBands: true },
    fields: [
      { key: "win", label: "Window (bars)", type: "number", group: "inputs", min: 10, max: 500, step: 1 },
      { key: "showBands", label: "Show reference bands", type: "bool", group: "inputs" },
    ],
    source: `//@version=6
indicator("Accumulation %")
// Descriptive money-flow share (close-in-range). Does not identify institutional vs retail activity.
// 35/50/75 are public charting reference bands, not signals.
win = input.int(63, "Window (bars)")
range_ = high - low
buy_share = range_ == 0 ? 0.5 : ((close - low) - (high - close)) / range_ * 0.5 + 0.5
accum = 100 * ta.sum(buy_share * volume, win) / ta.sum(volume, win)
plot(accum, "Accum %", color.new(#4d82ff, 0))
hline(75, "ref", color.new(color.gray, 60), linestyle = hline.style_dashed)
hline(50, "ref", color.new(color.gray, 60), linestyle = hline.style_dashed)
hline(35, "ref", color.new(color.gray, 60), linestyle = hline.style_dashed)`,
  },

  // ── Tech Lab Signal Markers (TLT-R4, display-tier, default OFF) ──────────────────
  // Signal-layer overlay: fire-date markers from the Macro Dashboard Technical Lab.
  // Rendered by ChartPanel renderSignals when active. No buy/sell wording.
  // Survivor universe — descriptive research surfaces only.
  _lab: {
    key: "_lab", label: "Lab Signals", tag: "Lab", kind: "overlay",
    defaults: {},
    fields: [],
    source: `//@version=6
// Lab Signals — Macro Dashboard Technical Lab fire-date markers.
// DISPLAY-TIER DESCRIPTIVE. Survivor universe, not a verdict.
// Data is produced by the macro Python engine and rendered by the Terminal.
// TLT-R3: fires are computed only by the macro engine — the Terminal only renders them.`,
  },

  // ── Day Trade Suite (display-tier descriptive, intraday-only where noted) ─────────

  svwap: {
    key: "svwap", label: "Session VWAP", tag: "sVWAP", kind: "overlay",
    defaults: {
      includePm: false,
      showB1: true, showB2: true, showB3: false,
      m1: 1, m2: 2, m3: 3,
      col: "#e8b339",
      b1Col: "rgba(77,130,255,0.55)",
      b2Col: "rgba(232,163,61,0.5)",
      b3Col: "rgba(240,86,107,0.45)",
      width: 1.6,
      fill: true,
      fillCol: "rgba(77,130,255,0.06)",
    },
    fields: [
      { key: "includePm", label: "Include premarket in VWAP", type: "bool", group: "inputs" },
      { key: "showB1", label: "Show ±1σ bands", type: "bool", group: "inputs" },
      { key: "showB2", label: "Show ±2σ bands", type: "bool", group: "inputs" },
      { key: "showB3", label: "Show ±3σ bands", type: "bool", group: "inputs" },
      // band multipliers modeled as bounded number fields (1=m1×σ label)
      { key: "m1", label: "Band 1 multiplier (σ)", type: "number", group: "inputs", min: 0.5, max: 5, step: 0.5 },
      { key: "m2", label: "Band 2 multiplier (σ)", type: "number", group: "inputs", min: 0.5, max: 5, step: 0.5 },
      { key: "m3", label: "Band 3 multiplier (σ)", type: "number", group: "inputs", min: 0.5, max: 5, step: 0.5 },
      { key: "fill", label: "Fill ±1σ zone", type: "bool", group: "inputs" },
      { key: "col", label: "VWAP color", type: "color", group: "style" },
      { key: "b1Col", label: "Band 1 color", type: "color", group: "style" },
      { key: "b2Col", label: "Band 2 color", type: "color", group: "style" },
      { key: "b3Col", label: "Band 3 color", type: "color", group: "style" },
      { key: "fillCol", label: "Fill color", type: "color", group: "style" },
      { key: "width", label: "VWAP line width", type: "number", group: "style", min: 1, max: 4, step: 0.1 },
    ],
    source: `//@version=6
indicator("Session VWAP", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — session-reset VWAP with σ bands.
// Intraday only. Resets at session open (09:30 ET for US). Premarket bars
// optionally included in cumulative. σ² = Σ(v·tp²)/Σv − vwap²; clamped ≥ 0.
// Band series use autoscaleInfoProvider: () => null (excluded from autoscale).
// v≤0 bars contribute 0 to cumulative sums.
includePm = input.bool(false, "Include premarket")
m1 = input.float(1.0, "Band 1 σ")
m2 = input.float(2.0, "Band 2 σ")
m3 = input.float(3.0, "Band 3 σ")
// session reset on each new day; typical = (h+l+c)/3
// Implementation: intradayMath.sessionVwap()`,
  },

  orb: {
    key: "orb", label: "Opening Range", tag: "OR", kind: "overlay",
    defaults: {
      rangeMin: 15,
      showMid: true,
      ext1On: true, ext1: 1,
      ext2On: true, ext2: 2,
      boxCol: "rgba(232,179,57,0.10)",
      lineCol: "#e8a33d",
      width: 1,
    },
    fields: [
      { key: "rangeMin", label: "Range window (minutes)", type: "number", group: "inputs", min: 1, max: 60, step: 1 },
      { key: "showMid", label: "Show midpoint", type: "bool", group: "inputs" },
      { key: "ext1On", label: "Show extension 1", type: "bool", group: "inputs" },
      { key: "ext1", label: "Extension 1 multiplier", type: "number", group: "inputs", min: 0.5, max: 5, step: 0.5 },
      { key: "ext2On", label: "Show extension 2", type: "bool", group: "inputs" },
      { key: "ext2", label: "Extension 2 multiplier", type: "number", group: "inputs", min: 0.5, max: 5, step: 0.5 },
      { key: "boxCol", label: "Box fill color", type: "color", group: "style" },
      { key: "lineCol", label: "Line color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 0.5 },
    ],
    source: `//@version=6
indicator("Opening Range", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — opening range breakout levels (intraday only).
// Window: bars with minOfDay ∈ [openMin, openMin+rangeMin). Locked after window.
// Shaded box over range window; ORH/ORL rays to session end; dashed mid; dashed extensions.
// One set of levels per session in view. SVG text labels at ray right ends.
// Implementation: intradayMath.openingRange()
rangeMin = input.int(15, "Range window (minutes)")`,
  },

  slevels: {
    key: "slevels", label: "Session Levels", tag: "Levels", kind: "overlay",
    defaults: {
      pdh: true, pdl: true, pdc: true,
      open: true, pmh: true, pml: true,
      pwh: false, pwl: false,
      pdCol: "#4d82ff",
      pdcCol: "#e8a33d",
      pmCol: "#e8b339",
      pwCol: "#8b93a3",
      openCol: "#d6dae3",
    },
    fields: [
      { key: "pdh", label: "Show PDH", type: "bool", group: "inputs" },
      { key: "pdl", label: "Show PDL", type: "bool", group: "inputs" },
      { key: "pdc", label: "Show PDC", type: "bool", group: "inputs" },
      { key: "open", label: "Show Session Open", type: "bool", group: "inputs" },
      { key: "pmh", label: "Show PMH (US)", type: "bool", group: "inputs" },
      { key: "pml", label: "Show PML (US)", type: "bool", group: "inputs" },
      { key: "pwh", label: "Show PWH", type: "bool", group: "inputs" },
      { key: "pwl", label: "Show PWL", type: "bool", group: "inputs" },
      { key: "pdCol", label: "PDH/PDL color", type: "color", group: "style" },
      { key: "pdcCol", label: "PDC color", type: "color", group: "style" },
      { key: "pmCol", label: "PMH/PML color", type: "color", group: "style" },
      { key: "pwCol", label: "PWH/PWL color", type: "color", group: "style" },
      { key: "openCol", label: "Open color", type: "color", group: "style" },
    ],
    source: `//@version=6
indicator("Session Levels", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — key intraday reference levels (intraday only).
// PDH/PDL: prior day high/low (solid w1). PDC: prior day close (dashed).
// PMH/PML: today's premarket high/low (US only; omitted when no premarket bars).
// Open: first bar at or after session open today (dotted).
// PWH/PWL: prior ISO week high/low from daily bars (dotted, faint).
// Implemented as createPriceLine() on the price series. PriceLines excluded from autoscale.
// Daily bars via dataCache.getOhlc(sym). Implementation: intradayMath.sessionLevels()`,
  },

  optlevels: {
    key: "optlevels", label: "Options Levels", tag: "OptLvl", kind: "overlay",
    defaults: {
      cw: true, pw: true, flip: true, ags: true, em: true,
      // Colors are NOT user-editable: they resolve from the options desk's level
      // convention at build time (call wall var(--brand-2), put wall var(--down) —
      // directional-color law, East-Asian flip safe — flip var(--ai) violet, abs-gamma
      // var(--signal) amber, EM band muted). The chart and the Exposure desk must never
      // disagree about which colour a level is.
    },
    fields: [
      { key: "cw", label: "Show call wall", type: "bool", group: "inputs" },
      { key: "pw", label: "Show put wall", type: "bool", group: "inputs" },
      { key: "flip", label: "Show gamma flip", type: "bool", group: "inputs" },
      { key: "ags", label: "Show absolute-gamma strike", type: "bool", group: "inputs" },
      { key: "em", label: "Show expected-move band", type: "bool", group: "inputs" },
    ],
    source: `//@version=6
indicator("Options Levels", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — dealer-positioning landmarks from the nightly options build
// (options_hub.gex/v1 + options_hub.moves/v1; EOD open interest, refreshed nightly).
// CW/PW: strikes with the largest net call/put dealer gamma. FLIP: zero-gamma spot from
// the re-priced profile curve (crossing nearest spot; scalar fallback). ABS γ: argmax of
// |gamma_call|+|gamma_put| (yields to a wall at the same strike). EM±: the published
// expected-move band at its calibrated multiplier.
// HONESTY: positioning landmarks, NOT support/resistance — the live Level Report Card
// measures single-name P(hold | touched) ≈ coin flip for every role. Walls/flip inherit
// the dealer-sign convention (signed estimate); the EM band is arithmetic on quoted
// prices. Levels are EOD as-of the legend date; nothing here is live.
// Implemented as createPriceLine() set; excluded from autoscale. lib/optionsLevels.ts`,
  },

  pivots: {
    key: "pivots", label: "Pivot Points", tag: "Pivots", kind: "overlay",
    defaults: {
      // 0=classic, 1=camarilla, 2=fib (bounded number field as select proxy)
      mode: 0,
      extra: false,
      ppCol: "#d6dae3",
      // R/S line colors are NOT user-editable: they resolve from var(--down)/var(--up) at build time
      // so the East-Asian red-up flip stays correct (directional-color law).
    },
    fields: [
      // mode: 0=classic, 1=camarilla, 2=fib
      { key: "mode", label: "Mode (0=classic, 1=camarilla, 2=fibonacci)", type: "number", group: "inputs", min: 0, max: 2, step: 1 },
      { key: "extra", label: "Show R3/S3 (+ R4/S4 camarilla)", type: "bool", group: "inputs" },
      { key: "ppCol", label: "Pivot color", type: "color", group: "style" },
    ],
    source: `//@version=6
indicator("Pivot Points", overlay = true)
// DISPLAY-TIER DESCRIPTIVE — classic / camarilla / fibonacci pivots (intraday only).
// Classic: PP=(H+L+C)/3; R1=2PP−L; S1=2PP−H; R2=PP+(H−L); S2=PP−(H−L); R3/S3 optional.
// Camarilla: R1..R4=C+(H−L)×1.1/{12,6,4,2}; S1..S4=C−(H−L)×1.1/{12,6,4,2}.
// Fibonacci: PP=(H+L+C)/3; R/S = PP ± {0.382,0.618,1.0}×(H−L).
// R/S colors resolve from var(--down)/var(--up) via getComputedStyle at render time.
// Implemented as createPriceLine() set; PP heavier, all dashed.
// Implementation: intradayMath.pivotLevels()`,
  },

  rvol: {
    key: "rvol", label: "Relative Volume", tag: "RVOL", kind: "pane",
    defaults: {
      baseline: 10,
      lineCol: "#e8b339",
      histCol: "rgba(139,147,163,0.45)",
      width: 1.6,
    },
    fields: [
      { key: "baseline", label: "Baseline sessions", type: "number", group: "inputs", min: 3, max: 30, step: 1 },
      { key: "lineCol", label: "Cumulative RVOL color", type: "color", group: "style" },
      { key: "histCol", label: "Slot RVOL color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 0.1 },
    ],
    source: `//@version=6
indicator("Relative Volume", overlay = false)
// DISPLAY-TIER DESCRIPTIVE — relative volume vs same time-of-day baseline (intraday only).
// Slot RVOL: current bar volume / mean bar volume at same minOfDay over prior baseline sessions.
// Cumulative RVOL: current session cumulative / mean cumulative at same point in prior sessions.
// Baseline excludes the current session. If sessionsUsed < 3: all null + amber note shown.
// Legend tier coloring: <1 muted, 1–1.5 text, 1.5–2 warn, ≥2 up (legend only; pane is calm).
// priceLine at 1.0 (dashed, --muted). Time-of-day baseline method — honest null law.
// Implementation: intradayMath.rvolSeries()`,
  },

  ttmsq: {
    key: "ttmsq", label: "TTM Squeeze", tag: "Squeeze", kind: "pane",
    defaults: {
      len: 20,
      bbMult: 2,
      momLen: 20,
      showDots: true,
    },
    fields: [
      { key: "len", label: "Length", type: "number", group: "inputs", min: 5, max: 100, step: 1 },
      { key: "bbMult", label: "BB StdDev multiplier", type: "number", group: "inputs", min: 0.5, max: 5, step: 0.5 },
      { key: "momLen", label: "Momentum length", type: "number", group: "inputs", min: 5, max: 100, step: 1 },
      { key: "showDots", label: "Show squeeze dots", type: "bool", group: "inputs" },
    ],
    source: `//@version=6
indicator("TTM Squeeze", overlay = false)
// DISPLAY-TIER DESCRIPTIVE — TTM Squeeze momentum + squeeze state. All timeframes.
// BB = SMA ± bbMult·stdev(pop, ÷N — matches ChartPanel inline convention).
// KC = SMA ± mult·RMA(TR,len) for each KC multiplier tier.
// Squeeze tier = highest k where BBwidth < KCwidth(k): 3=tightest (1.0×KC), 0=none.
// Momentum = linreg slope-fit of: close − ((highest(len)+lowest(len))/2 + sma(close,len))/2
// Histogram: rising-above-0 var(--up); falling-above-0 lighter alpha; below-0 mirror var(--down).
// Squeeze dots: SVG circles at y(0) per bar — tier0 --muted; tier1 #e8a33d; tier2 #e8734d; tier3 #f0566b.
// Implementation: intradayMath.ttmSqueeze()`,
  },

  adx: {
    key: "adx", label: "ADX", tag: "ADX", kind: "pane",
    defaults: {
      len: 10,
      showDi: false,
      col: "#4d82ff",
      width: 1.4,
    },
    fields: [
      { key: "len", label: "Length", type: "number", group: "inputs", min: 2, max: 50, step: 1 },
      { key: "showDi", label: "Show +DI / −DI", type: "bool", group: "inputs" },
      { key: "col", label: "ADX color", type: "color", group: "style" },
      { key: "width", label: "Line width", type: "number", group: "style", min: 1, max: 4, step: 0.1 },
    ],
    source: `//@version=6
indicator("ADX", overlay = false)
// DISPLAY-TIER DESCRIPTIVE — Average Directional Index (Wilder DMI). All timeframes.
// Wilder RMA for smoothing (1/len decay — same as indicatorMath.ts rma()).
// +DI = RMA(max(high−high[1],0), len) / RMA(TR, len) × 100
// −DI = RMA(max(low[1]−low,0), len) / RMA(TR, len) × 100
// DX = |+DI−−DI| / (+DI+−DI) × 100; ADX = RMA(DX, len)
// hlines at 20 and 25 (dashed priceLines). Optional +DI/−DI: var(--up) / var(--down).
// Implementation: intradayMath.adx()`,
  },

  cvd: {
    key: "cvd", label: "Est. CVD (approx)", tag: "Est. CVD", kind: "pane",
    // No user-editable colors: baseline up/down resolve from var(--up)/var(--down) at build time
    // (directional-color law — a picker here would be a silent no-op).
    defaults: {},
    fields: [],
    source: `//@version=6
indicator("Est. CVD (OHLCV approx)", overlay = false)
// DISPLAY-TIER DESCRIPTIVE — session-reset cumulative volume delta (intraday only).
// ⚠️  APPROXIMATION: true CVD requires tick-level or bid/ask data.
// This is a close-position-in-range proxy:
//   delta = v × ((c−l) − (h−c)) / (h−l)
//   if h === l: use sign(c − prevClose) × v (0 for first bar of session).
// Cumulative sum resets at each session open.
// Rendered as LWC BaselineSeries at 0. Legend MUST read "Est. CVD (OHLCV approx)".
// Default OFF — not in day-mode preset.
// Implementation: intradayMath.cvdApprox()`,
  },
};

export function isIndKey(k: string): k is IndKey {
  return Object.prototype.hasOwnProperty.call(IND_DEFS, k);
}

// ── visibility-on-intervals (TradingView's "Visibility" tab) ──
// The terminal is daily-EOD, so only Day/Week/Month timeframes are real; each unit can be toggled
// off or bounded to a [min,max] multiplier (e.g. show only on D/2D by setting Days max=2). Stored
// per-indicator under `_vis`, so it persists + resets alongside the rest of the settings.
export type VisUnit = "days" | "weeks" | "months";
export type VisRange = { on: boolean; min: number; max: number };
export function defaultVis(): Record<VisUnit, VisRange> {
  return { days: { on: true, min: 1, max: 366 }, weeks: { on: true, min: 1, max: 52 }, months: { on: true, min: 1, max: 12 } };
}
export const VIS_UNITS: { key: VisUnit; label: string; max: number }[] = [
  { key: "days", label: "Days", max: 366 },
  { key: "weeks", label: "Weeks", max: 52 },
  { key: "months", label: "Months", max: 12 },
];

// ── Up / Down colors setting (Settings → Terminal) ────────────────────────────────────────────
// The operator picks the direction convention: WEST = green up / red down, EAST = red up / green
// down (CN/HK/TW/MO). It is stamped pre-paint on <html data-updown> by app/layout.tsx and carried
// through CSS by var(--up)/var(--down) — but lightweight-charts paints to CANVAS and cannot resolve
// a CSS var, so every directional indicator color has to be swapped in JS instead.
//
// The registry defaults above stay the WEST pair: they are what `mm.indParams` persists and what
// the Settings dialog swatches show. DIR_FIELDS names the style params that carry price-DIRECTION
// semantics; indDefaults()/withDefaults() rewrite such a param to the ACTIVE convention whenever it
// still holds a convention default. A color the user actually picked matches neither convention's
// default for that field, so an explicit override always wins over the setting.
//
// Params that merely happen to use a green or a red are deliberately NOT listed — rsistack.col1 is
// one of three palette slots (RSI 7/14/21) and svwap.b3Col is a σ-band magnitude. Neither is a
// direction, so flipping them under `east` would state something untrue.
export const DIR_FIELDS: Partial<Record<IndKey, Record<string, "up" | "down">>> = {
  vol: { upCol: "up", downCol: "down" },
  stochrsi: { kCol: "up", dCol: "down" },
  macd: { upHist: "up", downHist: "down" },
  gaps: { gapUpCol: "up", gapDownCol: "down" },
  ichimoku: { spanACol: "up", spanBCol: "down" },
  ribbon: { colUp: "up", colDn: "down", fillUp: "up", fillDn: "down" },
  supertrend: { colUp: "up", colDn: "down" },
};

// The two directional hue families, web + native shell (see COL). Only the RGB triple moves —
// notation and alpha are preserved — so every tint (0.12 … 1) flips with its base color.
const HUE_RGB_PAIRS: [string, string][] = [["38,194,129", "240,86,107"], ["8,153,129", "242,54,69"]];
const HUE_HEX_RGB: Record<string, string> = {
  "#26c281": "38,194,129", "#f0566b": "240,86,107", "#089981": "8,153,129", "#f23645": "242,54,69",
};
const RGB_TWIN = new Map<string, string>();
const RGB_TO_HEX = new Map<string, string>();
for (const [u, d] of HUE_RGB_PAIRS) { RGB_TWIN.set(u, d); RGB_TWIN.set(d, u); }
for (const [hex, rgb] of Object.entries(HUE_HEX_RGB)) RGB_TO_HEX.set(rgb, hex);

/** The opposite-convention twin of a directional default, or null if `v` is not one of them. */
function hueTwin(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const asHex = HUE_HEX_RGB[s.toLowerCase()];
  if (asHex) { const t = RGB_TWIN.get(asHex); return t ? RGB_TO_HEX.get(t) ?? null : null; }
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,([^)]*))?\)$/i.exec(s);
  if (!m) return null;
  const twin = RGB_TWIN.get(`${+m[1]},${+m[2]},${+m[3]}`);
  if (!twin) return null;
  return m[4] != null ? `rgba(${twin},${m[4].trim()})` : `rgb(${twin})`;
}

/** True when the operator's Up/Down colors setting is East (red = up). SSR reads as West. */
export function isEastUpDown(): boolean {
  return typeof document !== "undefined"
    && document.documentElement.getAttribute("data-updown") === "east";
}

/**
 * Rewrite `params`' directional style colors to the active Up/Down convention, in place.
 * Only ever called on a freshly-built params object (indDefaults / withDefaults below).
 */
export function applyUpDownConvention(key: string, params: Record<string, any>): Record<string, any> {
  const map = isIndKey(key) ? DIR_FIELDS[key] : undefined;
  if (!map) return params;
  const east = isEastUpDown();
  const base = IND_DEFS[key as IndKey].defaults;
  for (const field of Object.keys(map)) {
    const west = base[field];
    const twin = hueTwin(west);
    if (typeof west !== "string" || !twin) continue;
    const cur = params[field];
    if (cur !== west && cur !== twin) continue;   // user picked their own → the setting must not touch it
    params[field] = east ? twin : west;
  }
  return params;
}

export function indDefaults(key: string): Record<string, any> {
  return isIndKey(key)
    ? applyUpDownConvention(key, { ...IND_DEFS[key].defaults, _vis: defaultVis() })
    : {};
}
// merge persisted params over the registry defaults so older saved params backfill new fields
export function withDefaults(key: string, params?: Record<string, any> | null): Record<string, any> {
  return applyUpDownConvention(key, { ...indDefaults(key), ...(params || {}) });
}
export function allDefaults(): Record<string, Record<string, any>> {
  const o: Record<string, Record<string, any>> = {};
  for (const k of IND_ORDER) o[k] = indDefaults(k);
  return o;
}
