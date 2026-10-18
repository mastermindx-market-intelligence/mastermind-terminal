// Nine-Bar Exhaustion — native Trend-suite rendering and event adapter.
//
// One canonical kernel (lib/nineBarExhaustion.ts) owns all counting semantics. This file only
// maps its deterministic output into IndicatorCanvas primitives/tooltips/SuiteEvents. It is an
// independent close-versus-four-bars-back implementation, not licensed DeMARK Sequential 9–13.

import type {
  LabelPrim,
  MarkerPrim,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteEvent,
  SuiteModuleDef,
  TooltipDef,
} from "@/lib/indicator-canvas/types";
import {
  computeNineBarExhaustion,
  type NineBarCycleMode,
  type NineBarDensity,
  type NineBarDirection,
  type NineBarDisplayPolicy,
  type NineBarPoint,
} from "@/lib/nineBarExhaustion";
import { NINE_BAR_EXHAUSTION_META } from "./nineBarExhaustion.meta";

const MAX_VISIBLE_POINTS = 300;
const INTERMEDIATE_MIN_PX = 2.1;
const COMPLETION_MIN_PX = 0.7;
const MARKER_SIZE = 4;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
const boolOpt = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
const numOpt = (value: unknown, fallback: number, lo: number, hi: number) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return finite(parsed) ? clamp(parsed, lo, hi) : fallback;
};
const selectOpt = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;

/** Normalize equivalent daily/weekly spellings so chart, replay, and alert adapters share IDs. */
function identityTimeframe(value: string): string {
  const raw = String(value || "unknown").trim();
  const lower = raw.toLowerCase();
  if (raw === "D" || lower === "1d" || lower === "day" || lower === "daily") return "1d";
  if (raw === "W" || lower === "1w" || lower === "week" || lower === "weekly") return "1w";
  return lower;
}

function fmt(value: number): string {
  if (!finite(value)) return "—";
  const abs = Math.abs(value);
  const places = abs >= 100 ? 2 : abs >= 1 ? 3 : 5;
  return value.toFixed(places).replace(/\.?0+$/, "");
}

function stamp(epoch: number, intraday: boolean, zh: boolean): string {
  if (!finite(epoch)) return "—";
  const iso = new Date(epoch * 1000).toISOString();
  return intraday ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} ${zh ? "图表时间" : "chart time"}` : iso.slice(0, 10);
}

function directionCopy(direction: NineBarDirection, zh: boolean): string {
  if (zh) return direction === "rising" ? "上涨序列" : "下跌序列";
  return direction === "rising" ? "Rising sequence" : "Falling sequence";
}

function titleCopy(point: NineBarPoint, zh: boolean): string {
  if (point.count === 9 && point.forming) return zh
    ? `${point.direction === "rising" ? "上涨" : "下跌"}九转形成中`
    : `${point.direction === "rising" ? "Rising" : "Falling"} nine forming`;
  if (point.completed) return zh
    ? `${point.direction === "rising" ? "上涨" : "下跌"}九转完成`
    : `${point.direction === "rising" ? "Rising" : "Falling"} nine completed`;
  return zh
    ? `${point.direction === "rising" ? "上涨" : "下跌"}计数 ${point.count}`
    : `${point.direction === "rising" ? "Rising" : "Falling"} count ${point.count}`;
}

function statusCopy(point: NineBarPoint, zh: boolean): string {
  if (point.forming) return zh ? "形成中——等待K线收盘" : "Forming — waits for bar close";
  if (point.completed) return zh ? "已确认完成" : "Confirmed completion";
  return zh ? "已收盘计数" : "Closed-bar count";
}

function comparisonCopy(point: NineBarPoint, zh: boolean): string {
  const op = point.direction === "rising" ? ">" : "<";
  const suffix = zh ? "（向前4根图表K线）" : " (4 chart bars back)";
  return `${fmt(point.close)} ${op} ${fmt(point.compareClose)}${suffix}`;
}

function tooltip(point: NineBarPoint, ctx: ModuleCtx, color: string): TooltipDef {
  const zh = ctx.lang === "zh";
  return {
    id: `nine-tip-${point.id}`,
    title: titleCopy(point, zh),
    accent: color,
    rows: [
      { k: zh ? "方向" : "Direction", v: directionCopy(point.direction, zh), color },
      { k: zh ? "计数" : "Count", v: `${point.count}/9 · ${zh ? "周期" : "cycle"} ${point.cycle}` },
      { k: zh ? "周期" : "Timeframe", v: ctx.tf },
      { k: zh ? "比较" : "Comparison", v: comparisonCopy(point, zh) },
      { k: zh ? "时间" : "Source bar", v: stamp(point.sourceT, ctx.isIntraday, zh) },
      { k: zh ? "可用" : "Available", v: stamp(point.earliestObservableT, ctx.isIntraday, zh) },
      { k: zh ? "状态" : "Status", v: statusCopy(point, zh) },
      { k: zh ? "含义" : "Meaning", v: zh ? "可能衰竭，并不保证反转" : "Possible exhaustion — not a guaranteed reversal" },
    ],
  };
}

function compute(ctx: ModuleCtx): ModuleResult {
  const bars = ctx.bars ?? [];
  if (bars.length < 5) return { prims: [], tooltips: [], events: [] };
  const s = ctx.s ?? {};
  const displayPolicy = selectOpt<NineBarDisplayPolicy>(s.displayPolicy, ["progressive", "retro6", "completed"], "retro6");
  const density = selectOpt<NineBarDensity>(s.density, ["all", "late", "completion"], "all");
  const cycleMode = selectOpt<NineBarCycleMode>(s.cycleMode, ["single", "repeat"], "single");
  const showMarkers = boolOpt(s.showMarkers, true);
  const historyBars = Math.round(numOpt(s.historyBars, 500, 50, 5000));
  const labelSize = Math.round(numOpt(s.labelSize, 10, 8, 16));

  const result = computeNineBarExhaustion(
    bars.map((bar, i) => ({
      id: String(bar.t),
      t: bar.t,
      availableT: finite(bar.availableT)
        ? bar.availableT
        : (i + 1 < bars.length && finite(bars[i + 1]?.t) ? bars[i + 1].t : bar.t),
      o: bar.o,
      h: bar.h,
      l: bar.l,
      c: bar.c,
      v: bar.v,
    })),
    {
      symbol: ctx.symbol,
      timeframe: identityTimeframe(ctx.tf),
      session: ctx.session ?? (ctx.isIntraday ? "chart-session" : "daily"),
      requirePriceFlip: boolOpt(s.requireFlip, false),
      cycleMode,
      displayPolicy,
      density,
      historyBars,
      formingBarIndex: ctx.formingBarIndex ?? null,
    },
  );
  if (!result.ok) return { prims: [], tooltips: [], events: [] };

  const eligible = result.points.filter((point) => point.displayEligible).slice(-MAX_VISIBLE_POINTS);
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];

  for (const point of eligible) {
    const bar = bars[point.i];
    if (!bar || !finite(bar.h) || !finite(bar.l)) continue;
    const color = point.direction === "rising" ? ctx.colors.down : ctx.colors.up;
    const completed = point.completed;
    const formingNine = point.count === 9 && point.forming;
    const tip = tooltip(point, ctx, color);
    tooltips.push(tip);
    const above = point.direction === "rising";
    const label: LabelPrim = {
      kind: "label",
      id: `nine-label-${point.id}`,
      z: completed || formingNine ? 8 : 7,
      i: point.i,
      p: above ? bar.h : bar.l,
      text: String(point.count),
      place: above ? "above" : "below",
      style: completed ? "pill" : formingNine ? "tag" : "bare",
      color,
      bg: completed || formingNine ? ctx.colors.neutral : undefined,
      fs: completed ? Math.min(16, labelSize + 1) : labelSize,
      bold: completed,
      dyPx: above ? (completed ? -8 : -4) : (completed ? 8 : 4),
      pointer: completed,
      minPxPerBar: completed || formingNine ? COMPLETION_MIN_PX : INTERMEDIATE_MIN_PX,
      tooltipId: tip.id,
    };
    prims.push(label);

    if (completed && showMarkers) {
      const range = Math.max(Math.abs(bar.h - bar.l), Math.abs(bar.c) * 0.001, 1e-9);
      const marker: MarkerPrim = {
        kind: "marker",
        id: `nine-marker-${point.id}`,
        z: 9,
        i: point.i,
        p: above ? bar.h + range * 0.28 : bar.l - range * 0.28,
        shape: "diamond",
        size: MARKER_SIZE,
        fill: color,
        stroke: ctx.colors.text,
        alpha: 0.95,
        tooltipId: tip.id,
      };
      prims.push(marker);
    }
  }

  const events: SuiteEvent[] = result.events.map((event) => ({
    eventId: event.id,
    type: event.direction === "rising" ? "nine_rising" : "nine_falling",
    dir: event.reversalDir,
    i: event.i,
    confirmedAt: event.confirmedAt,
    p: event.close,
    label: ctx.lang === "zh"
      ? `${event.direction === "rising" ? "上涨" : "下跌"}九转完成 · 可能衰竭，不保证反转`
      : `${event.direction === "rising" ? "Rising" : "Falling"} nine completed · possible exhaustion, not a guaranteed reversal`,
  }));

  return { prims, tooltips, events };
}

export const NINE_BAR_EXHAUSTION_MODULE: SuiteModuleDef = {
  ...NINE_BAR_EXHAUSTION_META,
  compute,
};

export default NINE_BAR_EXHAUSTION_MODULE;
