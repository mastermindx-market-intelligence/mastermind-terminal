// Pine built-in constants (color.*, shape.*, plot.style_*, location.*, …) and color helpers.
// Constant namespace members resolve to plain strings/numbers; calls (ta.*, math.*, …) are
// dispatched by the interpreter instead.

export const NA = NaN; // Pine `na` for numeric series is modeled as NaN

// TradingView-ish named colors (exact hex isn't load-bearing — only needs to read sanely)
export const NAMED_COLORS: Record<string, string> = {
  red: "#f23645", maroon: "#880e4f", orange: "#ff9800", yellow: "#ffeb3b",
  lime: "#00e676", green: "#089981", teal: "#00897b", aqua: "#00bcd4",
  blue: "#2962ff", navy: "#311b92", fuchsia: "#e040fb", purple: "#9c27b0",
  gray: "#787b86", silver: "#b2b5be", white: "#ffffff", black: "#000000",
};

// namespace.member -> constant. Anything missing resolves to `na` (kept tolerant on purpose).
export const NS_CONST: Record<string, Record<string, any>> = {
  color: NAMED_COLORS,
  plot: {
    style_line: "line", style_linebr: "line", style_stepline: "stepline", style_stepline_diamond: "stepline",
    style_histogram: "histogram", style_columns: "columns", style_area: "area", style_areabr: "area",
    style_circles: "circles", style_cross: "cross",
  },
  shape: {
    xcross: "xcross", cross: "cross", circle: "circle", triangleup: "triangleup", triangledown: "triangledown",
    flag: "flag", arrowup: "arrowup", arrowdown: "arrowdown", labelup: "labelup", labeldown: "labeldown",
    square: "square", diamond: "diamond",
  },
  location: { abovebar: "abovebar", belowbar: "belowbar", top: "top", bottom: "bottom", absolute: "absolute" },
  size: { auto: "auto", tiny: "tiny", small: "small", normal: "normal", large: "large", huge: "huge" },
  hline: { style_solid: "solid", style_dotted: "dotted", style_dashed: "dashed" },
  line: { style_solid: "solid", style_dotted: "dotted", style_dashed: "dashed", style_arrow_left: "solid", style_arrow_right: "solid", style_arrow_both: "solid" },
  barmerge: { lookahead_off: "off", lookahead_on: "on", gaps_off: "off", gaps_on: "on" },
  display: { none: "none", all: "all", pane: "pane", data_window: "dw", price_scale: "ps", status_line: "sl" },
  format: { inherit: "inherit", price: "price", volume: "volume", percent: "percent", mintick: "mintick" },
  position: {
    top_left: "tl", top_center: "tc", top_right: "tr", middle_left: "ml", middle_center: "mc",
    middle_right: "mr", bottom_left: "bl", bottom_center: "bc", bottom_right: "br",
  },
  xloc: { bar_index: "bi", bar_time: "bt" },
  yloc: { price: "price", abovebar: "abovebar", belowbar: "belowbar" },
  extend: { none: "none", left: "left", right: "right", both: "both" },
  text: { align_left: "left", align_center: "center", align_right: "right", align_top: "top", align_bottom: "bottom", wrap_none: "none", wrap_auto: "auto" },
  scale: { right: "right", left: "left", none: "none" },
  math: { pi: Math.PI, e: Math.E, phi: 1.618033988749895, rphi: 0.618033988749895 },
  dayofweek: { sunday: 1, monday: 2, tuesday: 3, wednesday: 4, thursday: 5, friday: 6, saturday: 7 },
  currency: { USD: "USD", NONE: "" },
};

// hex (#rgb/#rrggbb/#rrggbbaa) -> {r,g,b,a}
function parseHex(h: string): { r: number; g: number; b: number; a: number } | null {
  if (h[0] !== "#") return null;
  let s = h.slice(1);
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  if (s.length === 6) s += "ff";
  if (s.length !== 8) return null;
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: n(6) / 255 };
}

// Convert a Pine color value (hex string, rgba() string, or named) + optional transparency
// (0 = opaque … 100 = invisible) into a CSS rgba() string LWC can consume.
export function toCss(color: any, transp?: number): string {
  if (color == null || (typeof color === "number" && isNaN(color))) return "rgba(0,0,0,0)"; // na color → transparent
  if (typeof color !== "string") return "#787b86";
  let r = 0, g = 0, b = 0, a = 1;
  if (color.startsWith("#")) { const h = parseHex(color); if (h) ({ r, g, b, a } = h); }
  else if (color.startsWith("rgba") || color.startsWith("rgb")) {
    const m = color.match(/[\d.]+/g); if (m) { r = +m[0]; g = +m[1]; b = +m[2]; a = m[3] != null ? +m[3] : 1; }
  } else if (NAMED_COLORS[color]) { const h = parseHex(NAMED_COLORS[color])!; ({ r, g, b, a } = h); }
  if (transp != null && !isNaN(transp)) a = Math.max(0, Math.min(1, (100 - transp) / 100));
  return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${+a.toFixed(3)})`;
}

// str.tostring number formatting — honor a "#.##" style mask by counting fractional '#'/'0'
export function fmtNum(v: number, mask?: string): string {
  if (typeof v !== "number" || isNaN(v)) return "NaN";
  if (!mask || typeof mask !== "string") return String(+v.toFixed(10)).replace(/\.?0+$/, (m) => (m.includes(".") ? "" : m));
  const dot = mask.indexOf(".");
  const decimals = dot < 0 ? 0 : (mask.slice(dot + 1).match(/[#0]/g) || []).length;
  return v.toFixed(decimals);
}

// Terminal chart TFs are case-sensitive (lib/startTf.ts TF_CANONICAL_ORDER):
//   "1m"/"15m" = minutes, "1M"/"3M" = months, "1s"/"1S" = seconds, "1h"/"1H" = hours,
//   "D"/"W" as today. Pine: a bare number is minutes.
// One parser: tfParts, then tfPartsToSeconds. tfSeconds keeps a 1-day fallback for junk.
export type TfParts = { n: number; unit: string };

export function tfParts(tf: string): TfParts | null {
  const m = String(tf).trim().match(/^(\d*)([A-Za-z]*)$/);
  if (!m) return null;
  const n = m[1] === "" ? 1 : parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const raw = m[2];
  // "m" vs "M" must not fold: a blanket toUpperCase() reads "1m" as a month.
  const unit = raw === "m" || raw === "M" ? raw : raw.toUpperCase();
  return { n, unit };
}

export function tfPartsToSeconds(p: TfParts): number | null {
  const { n, unit } = p;
  if (unit === "" || unit === "MIN" || unit === "m") return n * 60;
  if (unit === "S") return n;
  if (unit === "H") return n * 3600;
  if (unit === "D") return n * 86400;
  if (unit === "W") return n * 604800;
  if (unit === "M") return n * 2592000;                       // calendar month ≈ 30d
  return null;
}

export function tfSeconds(tf: string): number {
  if (!tf) return 86400;
  const p = tfParts(tf);
  if (!p) return 86400;
  return tfPartsToSeconds(p) ?? 86400;
}
