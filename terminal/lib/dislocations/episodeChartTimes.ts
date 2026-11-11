import { etDateOf, etDisplay } from "../intradaySources";
import {
  snapToBars,
  toMarkerSpecs,
  type EpisodeMark,
  type MarkTone,
  type PlainLang,
} from "./episodeMarks";
import type { MarkerSpec } from "../chart-engine/api";

export type ChartBarTime = number | string;

export type ChartMark = EpisodeMark & { chartTime: number | string };

function dayNum(s: string): number {
  return Date.parse(s.slice(0, 10) + "T00:00:00Z") / 1000;
}

export function toChartMarks(
  marks: readonly EpisodeMark[],
  barTimes: readonly ChartBarTime[],
  intraday: boolean,
): ChartMark[] {
  if (barTimes.length === 0) return [];

  if (intraday) {
    for (const t of barTimes) {
      if (typeof t !== "number" || !Number.isFinite(t)) return [];
    }
    const bars = barTimes as number[];
    const marksPrime = marks.map((m) => ({
      ...m,
      at: etDisplay(m.at * 1000).epoch,
    }));
    const snapped = snapToBars(marksPrime, bars);
    const out: ChartMark[] = snapped.map((m) => ({
      ...m,
      chartTime: m.at,
    }));
    out.sort((a, b) => a.at - b.at);
    return out;
  }

  const strings: string[] = [];
  for (const t of barTimes) {
    if (typeof t !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(t)) return [];
    strings.push(t);
  }
  const map = new Map<number, string>();
  const dayNums: number[] = [];
  for (const s of strings) {
    const dn = dayNum(s);
    map.set(dn, s);
    dayNums.push(dn);
  }
  const marksPrime = marks.map((m) => ({
    ...m,
    at: dayNum(etDateOf(m.at * 1000)),
  }));
  const snapped = snapToBars(marksPrime, dayNums);
  const out: ChartMark[] = [];
  for (const m of snapped) {
    const chartTime = map.get(m.at);
    if (chartTime === undefined) continue;
    out.push({ ...m, chartTime });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

export function chartMarkerSpecs(
  marks: readonly ChartMark[],
  palette: Record<MarkTone, string>,
  lang: PlainLang,
): MarkerSpec[] {
  const specs = toMarkerSpecs(marks, palette, lang);
  return specs.map((spec, i) => ({
    ...spec,
    time: marks[i]!.chartTime as MarkerSpec["time"],
  }));
}
