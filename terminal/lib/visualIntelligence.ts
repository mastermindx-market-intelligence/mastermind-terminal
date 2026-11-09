/** Read-only chart projection. No forecasts, trading commands, persistent store or new data feed. */
import type { Bar, Fund } from "@/lib/fund";
import { analyzeCandleSeries, normalizeCandleMode, type CandleFacts, type CandleMode } from "@/lib/suites/trend/candlePainter";
import type { CoordMapper, Prim, SuiteColors, SuiteRenderBundle, TooltipDef } from "@/lib/indicator-canvas/types";

export interface VisualIntelligenceSettings {
  visualContext: boolean;
  visualRegime: boolean;
  visualVolume: boolean;
  visualLevels: boolean;
  visualEvents: boolean;
}
export const VISUAL_INTELLIGENCE_DEFAULTS: VisualIntelligenceSettings = {
  visualContext: true, visualRegime: false, visualVolume: false, visualLevels: false, visualEvents: false,
};
export function visualSettings(input: Partial<VisualIntelligenceSettings> | undefined): VisualIntelligenceSettings {
  const out = { ...VISUAL_INTELLIGENCE_DEFAULTS };
  for (const key of Object.keys(out) as (keyof VisualIntelligenceSettings)[]) {
    if (typeof input?.[key] === "boolean") out[key] = input[key]!;
  }
  return out;
}

export interface VisualBar extends CandleFacts {
  time: Bar["time"];
  open: number | null;
  close: number | null;
  barChangePct: number | null;
  priorHigh20: number | null;
  priorLow20: number | null;
}
export interface VisualSeries {
  symbol: string;
  timeframe: string;
  mode: CandleMode;
  bars: readonly Bar[];
  facts: readonly VisualBar[];
  indexByTime: ReadonlyMap<string, number>;
}
/** Existing per-bar readout callback metadata; a view of rendered bars, not another bar store. */
export interface ChartReadoutMeta { symbol: string; timeframe: string; bars: readonly Bar[] }
export interface VisualFrame {
  series: VisualSeries;
  replay: boolean;
  colored: boolean;
  basis: string | null;
}
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const usable = (b: Bar | undefined): b is Bar => !!b && [b.o, b.h, b.l, b.c].every(finite) && b.c > 0;

export function buildVisualSeries(symbol: string, timeframe: string, rows: readonly Bar[], mode: unknown): VisualSeries {
  // Copy the source projection: the chart can replace an in-flight bar in place later.
  const bars = rows.map((bar) => ({ ...bar }));
  const candleFacts = analyzeCandleSeries(bars, mode);
  const facts = candleFacts.map((fact, i): VisualBar => {
    const bar = bars[i];
    const earlier = bars.slice(Math.max(0, i - 20), i);
    const complete = earlier.length === 20 && earlier.every(usable);
    return {
      ...fact, time: bar.time,
      open: usable(bar) ? bar.o : null, close: usable(bar) ? bar.c : null,
      barChangePct: usable(bar) && bar.o > 0 ? (bar.c - bar.o) / bar.o * 100 : null,
      priorHigh20: complete ? Math.max(...earlier.map((b) => b.h)) : null,
      priorLow20: complete ? Math.min(...earlier.map((b) => b.l)) : null,
    };
  });
  return { symbol, timeframe, mode: normalizeCandleMode(mode), bars, facts, indexByTime: new Map(bars.map((b, i) => [String(b.time), i])) };
}

export function visualReadout(fact: VisualBar): Record<string, number | null> {
  return {
    "mc.rsi14": fact.rsi14, "mc.ema20": fact.ema20, "mc.ema50": fact.ema50,
    "mc.volumePct": fact.volumePercentile === null ? null : fact.volumePercentile * 100,
    "mc.volumeSamples": fact.volumeSamples, "mc.priorHigh20": fact.priorHigh20, "mc.priorLow20": fact.priorLow20,
  };
}
export function visualReadoutColumns(lang: "en" | "zh") {
  return [
    ["mc.rsi14", "Mastermind RSI (14)", "Mastermind RSI (14)"],
    ["mc.ema20", "Mastermind EMA (20)", "Mastermind EMA (20)"],
    ["mc.ema50", "Mastermind EMA (50)", "Mastermind EMA (50)"],
    ["mc.volumePct", "Prior-volume percentile", "前期成交量百分位"],
    ["mc.volumeSamples", "Volume samples", "成交量样本数"],
    ["mc.priorHigh20", "Prior 20-bar high", "前20根最高价"],
    ["mc.priorLow20", "Prior 20-bar low", "前20根最低价"],
  ].map(([key, en, zh]) => ({ key, label: lang === "zh" ? zh : en, tag: lang === "zh" ? zh : en }));
}

export type CalendarKind = "earnings" | "dividend" | "split";
export interface CalendarEvent { kind: CalendarKind; date: string; scheduled: boolean }
export interface VisualCalendar {
  state: "loading" | "available" | "unavailable" | "withheld";
  asof: string | null;
  events: readonly CalendarEvent[];
}
export const EMPTY_VISUAL_CALENDAR: VisualCalendar = { state: "unavailable", asof: null, events: [] };
function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(day + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}
/** Current artifact calendar only. Replay has no point-in-time knowledge evidence and gets none. */
export function visualCalendar(fund: Fund | null, symbol: string, replay: boolean): VisualCalendar {
  if (replay) return { state: "withheld", asof: null, events: [] };
  if (!fund || typeof fund.ticker !== "string" || fund.ticker.toUpperCase() !== symbol.toUpperCase()) return EMPTY_VISUAL_CALENDAR;
  const asof = isoDate(fund.asof);
  const events = new Map<string, CalendarEvent>();
  const add = (kind: CalendarKind, value: unknown, scheduled = false) => {
    const date = isoDate(value); if (!date) return;
    const key = kind + ":" + date;
    if (!events.has(key) || !scheduled) events.set(key, { kind, date, scheduled });
  };
  if (Array.isArray(fund.earnings?.q)) for (const row of fund.earnings.q) add("earnings", row?.report_date);
  if (Array.isArray(fund.dividends?.events)) for (const row of fund.dividends.events) add("dividend", row?.ex);
  if (Array.isArray(fund.dividends?.splits)) for (const row of fund.dividends.splits) add("split", row?.date);
  add("earnings", fund.earnings?.next_date, true);
  return { state: "available", asof, events: [...events.values()].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind)).slice(-128) };
}

export function chartDay(time: Bar["time"]): string | null {
  if (typeof time !== "number") return isoDate(time);
  const date = new Date(time * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}
export function formatVisualTime(time: Bar["time"]): string {
  if (typeof time === "number") {
    const date = new Date(time * 1000);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16).replace("T", " ") : "";
  }
  return String(time).slice(0, 24);
}

/** Existing volume colors remain the hue. Unknown ranks/colors are left alone, not made 'quiet'. */
export function participationColor(color: string, percentile: number | null): string {
  if (percentile === null || !Number.isFinite(percentile)) return color;
  const factor = percentile >= .65 ? 1 : percentile >= .35 ? .65 : .35;
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(color);
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${Math.min(1, Number(rgb[4] ?? 1)) * factor})`;
  const hex = /^#([a-f\d]{6})$/i.exec(color);
  if (hex) return `rgba(${parseInt(hex[1].slice(0, 2), 16)},${parseInt(hex[1].slice(2, 4), 16)},${parseInt(hex[1].slice(4, 6), 16)},${factor})`;
  return color;
}

const blankBundle = (): SuiteRenderBundle => ({ prims: [], candlePaint: [], events: [], tables: [], tooltips: new Map() });
/** Bounded draw-list for the EXISTING SVG renderer. No autorange mutation or new series. */
export function visualOverlayBundle(series: VisualSeries, settings: VisualIntelligenceSettings, colors: SuiteColors,
  visible: Pick<CoordMapper, "i0" | "i1">, selectedIndex: number | null, calendar: VisualCalendar,
  replay: boolean, lang: "en" | "zh"): SuiteRenderBundle {
  const out = blankBundle();
  if (!settings.visualContext || !series.facts.length) return out;
  const lo = Math.max(0, Math.floor(visible.i0)), hi = Math.min(series.facts.length - 1, Math.ceil(visible.i1));
  if (hi < lo) return out;
  const copy = (en: string, zh: string) => lang === "zh" ? zh : en;
  if (settings.visualRegime) {
    const segments: Prim[] = [];
    let from = lo;
    for (let i = lo + 1; i <= hi + 1; i++) {
      if (i <= hi && series.facts[i].trend === series.facts[from].trend) continue;
      const state = series.facts[from].trend;
      if (state === "up" || state === "down") segments.push({
        kind: "bgshade", id: "visual:regime:" + from, i1: from - .5, i2: i - .5,
        color: state === "up" ? colors.up : colors.down, alpha: .035,
      });
      from = i;
    }
    out.prims.push(...segments.slice(-128));
  }
  const index = selectedIndex !== null && series.facts[selectedIndex] ? selectedIndex : series.facts.length - 1;
  const fact = series.facts[index];
  if (settings.visualLevels) {
    for (const [side, price] of [["high", fact.priorHigh20], ["low", fact.priorLow20]] as const) {
      if (price === null) continue;
      const id = "visual:range:" + side;
      const label = side === "high" ? copy("Prior 20-bar high", "前20根最高价") : copy("Prior 20-bar low", "前20根最低价");
      out.prims.push({ kind: "line", id, a: { i: Math.max(0, index - 20), p: price }, b: { i: "right", p: price }, color: colors.muted, w: 1, dash: "4 4", alpha: .7 });
      out.prims.push({ kind: "label", id: id + ":label", i: "right", p: price, text: label + " " + price.toFixed(2), place: "left", style: "bare", color: colors.muted, minPxPerBar: 1 });
      const tip: TooltipDef = { id, title: label, rows: [
        { k: copy("Selected bar", "所选K线"), v: formatVisualTime(fact.time) },
        { k: copy("Basis", "依据"), v: copy("Previous 20 plotted bars; current bar excluded. Reference, not a forecast.", "前20根已绘制K线，不含当前K线。仅供参考，非预测。") },
      ] };
      out.tooltips.set(id, tip); out.tooltips.set(id + ":label", { ...tip, id: id + ":label" });
    }
  }
  // Current-calendar knowledge is never mixed into replay or selected historical-bar inspection.
  if (settings.visualEvents && !replay && index === series.facts.length - 1 && calendar.state === "available") {
    const dates = series.bars.map((bar) => chartDay(bar.time) ?? "");
    const eligible = calendar.events.filter((event) => !event.scheduled && event.date >= dates[lo] && event.date <= dates[hi]).slice(-12);
    let slot = 0;
    for (const event of eligible) {
      let left = lo, right = hi;
      while (left < right) { const mid = (left + right) >>> 1; if (dates[mid] < event.date) left = mid + 1; else right = mid; }
      const bar = series.bars[left]; if (!usable(bar)) continue;
      const id = "visual:event:" + slot++;
      const glyph = event.kind === "earnings" ? "E" : event.kind === "dividend" ? "D" : "S";
      const title = event.kind === "earnings" ? copy("Earnings", "财报") : event.kind === "dividend" ? copy("Ex-dividend", "除息") : copy("Stock split", "拆股");
      out.prims.push({ kind: "label", id, i: left, p: bar.h, text: glyph, place: "above", style: "chip", color: colors.brand });
      out.tooltips.set(id, { id, title: title + " / " + event.date, accent: colors.brand, rows: [
        { k: copy("Source as of", "来源日期"), v: calendar.asof ?? copy("Not stated", "未提供") },
        { k: copy("Placement", "位置"), v: copy("First plotted bar on/after the date. Current calendar, not point-in-time evidence.", "日期当天或之后的首根K线。使用当前日历，非当时已知证据。") },
      ] });
    }
  }
  // Match the existing host's renderer annotation without altering the frozen Prim contract.
  for (const prim of out.prims) {
    if (out.tooltips.has(prim.id)) (prim as Prim & { tooltipId?: string }).tooltipId = prim.id;
  }
  return out;
}
