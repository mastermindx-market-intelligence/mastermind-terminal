// Chart-engine performance-budget corpus (P4 harness).
//
// Deterministic daily-40k generator plus the pure helpers the mount hook and the
// Playwright protocol share: business-day arithmetic, live-tick bar-roll planning,
// p95, and the frame-delta reducer (idle-gap exclusion). Browser-safe: no node:
// imports. receipt.ts is the Node-only sibling and must never be imported here.

import type { EngineBar, EnginePoint, EngineTime, MarkerSpec, WatermarkSpec } from "../api";

export const DAILY_40K = { name: "daily-40k", bars: 40000 } as const;

/** Fixed seed so any host regenerates the corpus byte-identically. */
export const DEFAULT_CORPUS_SEED = 0xce401013;

const DAY_SEC = 86400;
/** Monday 2000-01-03 00:00:00Z — a weekday epoch the weekend-skip walks from. */
const START_UNIX = Date.UTC(2000, 0, 3) / 1000;

/** Deltas larger than this are parked-idle gaps, not frames that did work. */
export const IDLE_GAP_MS = 50;

/**
 * "Never measured" sentinel. Far above every budget, so a metric with no
 * samples always yields a violation and `budget_ok=false`; still a finite
 * positive number, so the receipt stays schema-valid (each metric has
 * `exclusiveMinimum: 0` and the schema is not ours to extend).
 */
export const UNMEASURED = 1e9;

export type FrameRecord = {
  frameTs: number;
  start: number;
  end: number;
};

export type DailyCorpus = {
  candles: EngineBar[];
  ma20: EnginePoint[];
  ma50: EnginePoint[];
  volume: EnginePoint[];
  oscillator: EnginePoint[];
  markers: MarkerSpec[];
  watermark: WatermarkSpec;
};

export type TickPlan = {
  kind: "update" | "roll";
  bar: EngineBar;
};

/** mulberry32 — small, seedable, no platform entropy. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function utcWeekday(unixSec: number): number {
  return new Date(unixSec * 1000).getUTCDay();
}

export function isWeekdayUtc(unixSec: number): boolean {
  const d = utcWeekday(unixSec);
  return d >= 1 && d <= 5;
}

export function nextBusinessDayUnix(unixSec: number): number {
  let t = unixSec + DAY_SEC;
  while (!isWeekdayUtc(t)) t += DAY_SEC;
  return t;
}

export function numericTime(time: EngineTime): number {
  if (typeof time === "number") return time;
  if (typeof time === "string") return Number(time);
  return Date.UTC(time.year, time.month - 1, time.day) / 1000;
}

/**
 * FNV-1a 32-bit of a stable JSON serialisation of the corpus rows. Used as the
 * unit-test fixture constant so a seed or generator change is a red digest.
 */
export function fnv1aHex(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function serializeCorpusRows(corpus: DailyCorpus): string {
  return JSON.stringify({
    candles: corpus.candles,
    ma20: corpus.ma20,
    ma50: corpus.ma50,
    volume: corpus.volume,
    oscillator: corpus.oscillator,
    markers: corpus.markers,
    watermark: corpus.watermark,
  });
}

export function digestCorpus(corpus: DailyCorpus): string {
  return fnv1aHex(serializeCorpusRows(corpus));
}

function smaAt(values: number[], index: number, period: number): number {
  const start = Math.max(0, index - period + 1);
  let sum = 0;
  for (let i = start; i <= index; i++) sum += values[i];
  return sum / (index - start + 1);
}

export function buildDailyCorpus(bars = DAILY_40K.bars, seed = DEFAULT_CORPUS_SEED): DailyCorpus {
  const rng = mulberry32(seed);
  const candles: EngineBar[] = [];
  const closes: number[] = [];
  let time = START_UNIX;
  let price = 100;
  for (let i = 0; i < bars; i++) {
    if (i > 0) time = nextBusinessDayUnix(time);
    const open = price;
    const ret = (rng() - 0.5) * 0.04;
    const close = Math.max(0.01, open * (1 + ret));
    const wingHigh = rng() * (Math.abs(close - open) + 0.05) + 0.02;
    const wingLow = rng() * (Math.abs(close - open) + 0.05) + 0.02;
    const high = Math.max(open, close) + wingHigh;
    const low = Math.min(open, close) - wingLow;
    const volume = 1000 + rng() * 15000;
    candles.push({ time, open, high, low, close });
    closes.push(close);
    price = close;
    // volume is stored on a parallel array below; keep rng order stable by
    // recording it alongside the candle rather than drawing later.
    (candles[i] as EngineBar & { _vol?: number })._vol = volume;
  }

  const ma20: EnginePoint[] = [];
  const ma50: EnginePoint[] = [];
  const volume: EnginePoint[] = [];
  const oscillator: EnginePoint[] = [];
  for (let i = 0; i < bars; i++) {
    const t = candles[i].time;
    const m20 = smaAt(closes, i, 20);
    const m50 = smaAt(closes, i, 50);
    ma20.push({ time: t, value: m20 });
    ma50.push({ time: t, value: m50 });
    const vol = (candles[i] as EngineBar & { _vol?: number })._vol ?? 1;
    delete (candles[i] as EngineBar & { _vol?: number })._vol;
    volume.push({ time: t, value: vol });
    oscillator.push({ time: t, value: m20 === 0 ? 0 : ((closes[i] - m20) / m20) * 100 });
  }

  const markerCount = Math.min(200, bars);
  const markers: MarkerSpec[] = [];
  const shapes: MarkerSpec["shape"][] = ["circle", "square", "arrowUp", "arrowDown"];
  const positions: MarkerSpec["position"][] = ["aboveBar", "belowBar", "inBar"];
  for (let i = 0; i < markerCount; i++) {
    const candle = candles[bars - markerCount + i];
    markers.push({
      time: candle.time,
      position: positions[i % positions.length],
      shape: shapes[i % shapes.length],
      color: "#8a8a8a",
      id: `m${i}`,
    });
  }

  const watermark: WatermarkSpec = {
    visible: true,
    horzAlign: "center",
    vertAlign: "center",
    lines: [{ text: "daily-40k", color: "#5a5a5a", fontSize: 48 }],
  };

  return { candles, ma20, ma50, volume, oscillator, markers, watermark };
}

/**
 * Live-tick planner: in-place update of the last bar, with a NEW business-day
 * bar every 50th tick (index 49, 99, … — 10 rolls in a 500-tick run).
 */
export function planTick(last: EngineBar, index: number, jitter: number): TickPlan {
  const j = jitter - 0.5;
  if ((index + 1) % 50 === 0) {
    const open = last.close;
    const close = Math.max(0.01, open * (1 + j * 0.01));
    return {
      kind: "roll",
      bar: {
        time: nextBusinessDayUnix(numericTime(last.time)),
        open,
        high: Math.max(open, close),
        low: Math.min(open, close),
        close,
      },
    };
  }
  const close = Math.max(0.01, last.close * (1 + j * 0.002));
  return {
    kind: "update",
    bar: {
      time: last.time,
      open: last.open,
      high: Math.max(last.high, close),
      low: Math.min(last.low, close),
      close,
    },
  };
}

export function p95(values: number[]): number {
  return percentile(values, 0.95);
}

export function median(values: number[]): number {
  if (values.length === 0) return UNMEASURED;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return UNMEASURED;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Cross-run aggregate with UNMEASURED absorbing (F1). A plain `median()` would
 * average a run that measured nothing away behind the runs that did, so one
 * refused run out of three could still print a green receipt.
 */
export function runMedian(values: readonly number[]): number {
  if (values.length === 0) return UNMEASURED;
  if (values.some((v) => v >= UNMEASURED)) return UNMEASURED;
  return median([...values]);
}

/** Visible logical range as the protocol reads it from the mount hook. */
export type VisibleSpan = { from: number; to: number } | null;

/** True when a drag really moved the visible window (F3: a no-op engine must fail). */
export function panMoved(a: VisibleSpan, b: VisibleSpan): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a.from - b.from) > 1e-6 || Math.abs(a.to - b.to) > 1e-6;
}

/** True when a wheel gesture changed the visible SPAN, i.e. really zoomed (F3). */
export function zoomChangedSpan(a: VisibleSpan, b: VisibleSpan): boolean {
  if (a == null || b == null) return false;
  return Math.abs((a.to - a.from) - (b.to - b.from)) > 1e-6;
}

/**
 * Bench input option (F3). canvas/input.ts mirrors LWC's rule
 * `zoom = handleScale.mouseWheel && (ctrlKey || !handleScroll.mouseWheel)`, so a
 * plain `page.mouse.wheel()` only ZOOMS when handleScroll.mouseWheel is false.
 * With the default (true) the same gesture scrolls: the visible span never
 * changes and B4's pointer-anchor zoom law is never exercised.
 */
export const BENCH_HANDLE_SCROLL = { mouseWheel: false } as const;

/**
 * Inter-frame deltas of frames that did work. Distinct `frameTs` values are
 * frames; idle-gap exclusion drops deltas > IDLE_GAP_MS so a parked-idle stretch
 * is not averaged into the p95.
 */
export function frameDeltas(records: FrameRecord[], idleGapMs = IDLE_GAP_MS): number[] {
  const ts = Array.from(new Set(records.map((r) => r.frameTs))).sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1];
    if (d > 0 && d <= idleGapMs) deltas.push(d);
  }
  return deltas;
}

/** Summed callback duration of every record sharing `frameTs`. */
export function frameWorkMs(records: FrameRecord[], frameTs: number): number {
  let sum = 0;
  for (const r of records) {
    if (r.frameTs === frameTs) sum += r.end - r.start;
  }
  return sum;
}
