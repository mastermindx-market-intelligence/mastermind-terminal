// Native chart-engine price formatting (P3 canvas renderer).
//
// The price axis, the last-value labels and the price-line labels have to print the
// same strings LWC prints, or the two engines disagree on what a price reads as. These
// are line-for-line mirrors of lightweight-charts v5.2.0 (dist/…development.mjs):
//   numberToStringWithLeadingZero  dev:1615   PriceFormatter       dev:1631
//   PercentageFormatter            dev:1691   VolumeFormatter      dev:1700
//   Series._recreateFormatter      dev:3873   Series.base()        dev:3725
//   PriceScale.updateFormatter     dev:4988   PriceScale.format*   dev:4934, dev:5187
//   precisionByMinMove             dev:7389   patchPriceFormat     dev:12996
// Nothing here paints; frame.ts asks for strings.

import type { ChartModel, SeriesModel } from "./model";
import { coercePriceScaleMode, priceToDisplay, type PriceScaleState } from "./scales";

export type EnginePriceFormatter = {
  format(price: number): string;
  formatTickmarks(prices: readonly number[]): string[];
};

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): boolean {
  return typeof value === "number" && value % 1 === 0;
}

function numberToStringWithLeadingZero(value: number, length: number): string {
  if (!isNumber(value)) return "n/a";
  if (!isInteger(length) || length < 0 || length > 16) throw new TypeError("invalid length");
  if (length === 0) return value.toString();
  return ("0000000000000000" + value.toString()).slice(-length);
}

function mapFormat(formatter: { format(price: number): string }): (prices: readonly number[]) => string[] {
  return (prices) => prices.map((p) => formatter.format(p));
}

/** LWC PriceFormatter(priceScale, minMove): `priceScale` is 10^precision. */
export function priceFormatter(priceScale: number, minMove?: number): EnginePriceFormatter {
  const move = minMove ? minMove : 1;
  const scale = isNumber(priceScale) && isInteger(priceScale) ? priceScale : 100;
  if (scale < 0) throw new TypeError("invalid base");
  let fracLength = 0;
  if (scale > 0 && move > 0) {
    for (let b = scale; b > 1; b /= 10) fracLength++;
  }
  const formatAsDecimal = (price: number): string => {
    const base = scale / move;
    let intPart = Math.floor(price);
    let fracString = "";
    if (base > 1) {
      let fracPart = +(Math.round(price * base) - intPart * base).toFixed(fracLength);
      if (fracPart >= base) {
        fracPart -= base;
        intPart += 1;
      }
      fracString = "." + numberToStringWithLeadingZero(+fracPart.toFixed(fracLength) * move, fracLength);
    } else {
      intPart = Math.round(intPart * base) / base;
      if (fracLength > 0) fracString = "." + numberToStringWithLeadingZero(0, fracLength);
    }
    return intPart.toFixed(0) + fracString;
  };
  const self: EnginePriceFormatter = {
    // U+2212 is as wide as "+", which is why LWC uses it.
    format: (price) => (price < 0 ? "−" : "") + formatAsDecimal(Math.abs(price)),
    formatTickmarks: (prices) => prices.map((p) => self.format(p)),
  };
  return self;
}

/** LWC PercentageFormatter(priceScale = 100): a PriceFormatter with a "%" suffix. */
export function percentageFormatter(priceScale = 100): EnginePriceFormatter {
  const inner = priceFormatter(priceScale);
  const self: EnginePriceFormatter = {
    format: (price) => `${inner.format(price)}%`,
    formatTickmarks: (prices) => prices.map((p) => self.format(p)),
  };
  return self;
}

/** LWC VolumeFormatter(precision): K / M / B abbreviations, ASCII minus. */
export function volumeFormatter(precision: number): EnginePriceFormatter {
  const formatNumber = (input: number): string => {
    const scale = Math.pow(10, precision);
    const value = Math.round(input * scale) / scale;
    const res = value >= 1e-15 && value < 1
      ? value.toFixed(precision).replace(/\.?0+$/, "")
      : String(value);
    return res.replace(/(\.[1-9]*)0+$/, (_e, p1: string) => p1);
  };
  const self: EnginePriceFormatter = {
    format: (input) => {
      let vol = input;
      let sign = "";
      if (vol < 0) {
        sign = "-";
        vol = -vol;
      }
      if (vol < 995) return sign + formatNumber(vol);
      if (vol < 999995) return sign + formatNumber(vol / 1000) + "K";
      if (vol < 999999995) {
        vol = 1000 * Math.round(vol / 1000);
        return sign + formatNumber(vol / 1000000) + "M";
      }
      vol = 1000000 * Math.round(vol / 1000000);
      return sign + formatNumber(vol / 1000000000) + "B";
    },
    formatTickmarks: (prices) => prices.map((p) => self.format(p)),
  };
  return self;
}

export function precisionByMinMove(minMove: number): number {
  if (minMove >= 1) return 0;
  let m = minMove;
  let i = 0;
  for (; i < 8; i++) {
    if (Math.abs(Math.round(m) - m) < 1e-8) return i;
    m *= 10;
  }
  return i;
}

export type ResolvedPriceFormat = {
  type: string;
  precision: number;
  minMove: number;
  base?: number;
  formatter?: (price: number) => string;
  tickmarksFormatter?: (prices: readonly number[]) => string[];
};

const PRICE_FORMAT_DEFAULTS = { type: "price", precision: 2, minMove: 0.01 } as const;

/**
 * The series' effective priceFormat: LWC's defaults deep-merged with the caller's bag.
 * LWC fills a missing precision from minMove (patchPriceFormat) when the series is
 * added. Every bag mm holds reached it through addSeries or applyOptions, and the
 * applyOptions path in LWC skips that patch; mm applies it to both. ChartPanel always
 * passes precision with minMove, so the two only differ for a caller that changes
 * minMove alone after creation.
 */
export function resolvePriceFormat(bag: unknown): ResolvedPriceFormat {
  const pf = bag && typeof bag === "object" ? (bag as Record<string, unknown>) : {};
  const type = typeof pf.type === "string" ? pf.type : PRICE_FORMAT_DEFAULTS.type;
  const minMove = isNumber(pf.minMove) ? pf.minMove : PRICE_FORMAT_DEFAULTS.minMove;
  let precision: number = isNumber(pf.precision) ? pf.precision : PRICE_FORMAT_DEFAULTS.precision;
  if (type !== "custom" && isNumber(pf.minMove) && !isNumber(pf.precision)) precision = precisionByMinMove(pf.minMove);
  const out: ResolvedPriceFormat = { type, precision, minMove };
  if (isNumber(pf.base)) out.base = pf.base;
  if (typeof pf.formatter === "function") out.formatter = pf.formatter as (price: number) => string;
  if (typeof pf.tickmarksFormatter === "function") {
    out.tickmarksFormatter = pf.tickmarksFormatter as (prices: readonly number[]) => string[];
  }
  return out;
}

/** LWC Series._recreateFormatter. */
export function seriesFormatter(series: Pick<SeriesModel, "options">): EnginePriceFormatter {
  const pf = resolvePriceFormat(series.options.priceFormat);
  switch (pf.type) {
    case "custom": {
      const fn = pf.formatter;
      if (!fn) break;
      return { format: fn, formatTickmarks: pf.tickmarksFormatter ?? ((prices) => prices.map(fn)) };
    }
    case "volume":
      return volumeFormatter(pf.precision);
    case "percent":
      return percentageFormatter(pf.precision);
    default:
      break;
  }
  const priceScale = Math.pow(10, pf.precision);
  return priceFormatter(priceScale, pf.minMove * priceScale);
}

/** LWC Series.base(): `priceFormat.base ?? 1 / priceFormat.minMove`. */
export function seriesBase(series: Pick<SeriesModel, "options">): number {
  const pf = resolvePriceFormat(series.options.priceFormat);
  return pf.base ?? 1 / pf.minMove;
}

/**
 * The series LWC formats a price scale with: the lowest z-order source on it. mm
 * keeps pane.seriesIds in creation order, which is LWC's z-order for series.
 */
export function formatterSourceOf(model: ChartModel, paneIndex: number, priceScaleId: string): SeriesModel | null {
  const pane = model.panes[paneIndex];
  if (!pane) return null;
  for (const sid of pane.seriesIds) {
    const s = model.getSeries(sid);
    if (s && !s.removed && s.priceScaleId === priceScaleId) return s;
  }
  return null;
}

type LocalizationFormatters = {
  priceFormatter?: (price: number) => string;
  tickmarksPriceFormatter?: (prices: readonly number[]) => string[];
  percentageFormatter?: (pct: number) => string;
  tickmarksPercentageFormatter?: (pcts: readonly number[]) => string[];
};

function localizationFormatters(options: ChartModel["options"]): LocalizationFormatters {
  const bag = options.localization && typeof options.localization === "object"
    ? (options.localization as Record<string, unknown>) : {};
  const out: LocalizationFormatters = {};
  if (typeof bag.priceFormatter === "function") out.priceFormatter = bag.priceFormatter as LocalizationFormatters["priceFormatter"];
  if (typeof bag.tickmarksPriceFormatter === "function") {
    out.tickmarksPriceFormatter = bag.tickmarksPriceFormatter as LocalizationFormatters["tickmarksPriceFormatter"];
  }
  if (typeof bag.percentageFormatter === "function") {
    out.percentageFormatter = bag.percentageFormatter as LocalizationFormatters["percentageFormatter"];
  }
  if (typeof bag.tickmarksPercentageFormatter === "function") {
    out.tickmarksPercentageFormatter = bag.tickmarksPercentageFormatter as LocalizationFormatters["tickmarksPercentageFormatter"];
  }
  return out;
}

export type ScaleFormatter = {
  /** LWC PriceScale.base(): the tick builder's minimum-move base. */
  base: number;
  /** Price → axis text, converted to the scale's mode (percent / indexed). */
  formatPrice(price: number, state: PriceScaleState): string;
  /** Already-converted display value → text (LWC formatLogical). */
  formatLogical(logical: number): string;
  /** LWC formatLogicalTickmarks. */
  formatLogicalTickmarks(logicals: readonly number[]): string[];
};

/** LWC PriceScale.updateFormatter + the formatPrice / formatLogical* family. */
export function scaleFormatter(model: ChartModel, paneIndex: number, priceScaleId: string, mode: PriceScaleState["mode"]): ScaleFormatter {
  const source = formatterSourceOf(model, paneIndex, priceScaleId);
  const loc = localizationFormatters(model.options);
  let base = source ? Math.round(seriesBase(source)) : 100;
  let formatter: EnginePriceFormatter = priceFormatter(100, 1);
  const m = coercePriceScaleMode(mode) ?? "normal";
  if (m === "percent") {
    formatter = percentageFormatter();
    base = 100;
  } else if (m === "indexed100") {
    formatter = priceFormatter(100, 1);
    base = 100;
  } else if (source) {
    formatter = seriesFormatter(source);
  }
  const one = (value: number, fn: ((v: number) => string) | undefined): string => (fn ? fn(value) : formatter.format(value));
  const many = (values: readonly number[], fn: ((v: readonly number[]) => string[]) | undefined): string[] => (
    fn ? fn(values) : formatter.formatTickmarks(values)
  );
  const price = (v: number) => one(v, loc.priceFormatter);
  const percent = (v: number) => one(v, loc.percentageFormatter);
  const priceMarks = loc.tickmarksPriceFormatter
    ?? (loc.priceFormatter ? mapFormat({ format: loc.priceFormatter }) : undefined);
  const percentMarks = loc.tickmarksPercentageFormatter
    ?? (loc.percentageFormatter ? mapFormat({ format: loc.percentageFormatter }) : undefined);
  return {
    base,
    formatPrice: (p, state) => {
      if (m === "percent") return percent(priceToDisplay(p, state));
      if (m === "indexed100") return formatter.format(priceToDisplay(p, state));
      return price(p);
    },
    formatLogical: (logical) => {
      if (m === "percent") return percent(logical);
      if (m === "indexed100") return formatter.format(logical);
      return price(logical);
    },
    formatLogicalTickmarks: (logicals) => {
      if (m === "percent") return many(logicals, percentMarks);
      if (m === "indexed100") return formatter.formatTickmarks(logicals);
      return many(logicals, priceMarks);
    },
  };
}
