"use client";
/**
 * svgChart — shared primitives for the hand-rolled inline-SVG charts.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SVG CHART HYGIENE RULES. Every hand-rolled chart in this app follows these.
 * They exist because each one is a defect we shipped and had to dig out.
 *
 * R1. ONE USER UNIT == ONE CSS PIXEL. Measure the container (useChartWidth)
 *     and emit `viewBox="0 0 {w} {h}" width={w} height={h}`. Never a synthetic
 *     viewBox width.
 * R2. NEVER set `preserveAspectRatio="none"`. It distorts strokes (a 1.2px line
 *     becomes 6.7px on steep segments), turns circles into ellipses, and shears
 *     text. If R1 holds you never need it.
 * R3. NEVER set `height={viewBoxHeight}` with the default `meet`. It caps the
 *     scale at 1.0 and letterboxes the chart; the plot can then never use extra
 *     container width.
 * R4. MINIMUM HEIGHTS: 120px for an axis-free sparkline, 190px for anything
 *     with a labelled x-axis (MIN_CHART_H below). A 74px plot band cannot carry
 *     a line plus ticks.
 * R5. TICKS COME FROM niceTicks() AND ARE FORMATTED BY fmtTick(step). Never
 *     `min + i/n*(max-min)` with a fixed `toFixed(0)` — that renders duplicate
 *     adjacent labels ("17% 17%").
 * R6. LABELS ARE THINNED BY RENDERED PIXEL GAP (thinLabels), never by array
 *     index. `i % 3` is a bug on any axis whose spacing is non-uniform or
 *     non-linear — it puts the densest labels exactly where the data is densest.
 * R7. DOMAINS COME FROM padDomain(). Zero is unioned only when the data
 *     straddles it. Filter non-finite values out of the domain BEFORE computing
 *     extents, and break the series into segments at the gaps rather than
 *     plotting them as zero.
 * R8. THE DOMAIN IS ANCHORED TO WHAT THE USER IS LOOKING AT. If price and a
 *     strike grid share an axis, price sets the default window and the grid
 *     overflows — not the reverse. Every locked axis ships a visible zoom/reset
 *     affordance.
 * R9. EVERY var() IN A GRADIENT OR SHADOW CARRIES A FALLBACK. An undefined
 *     token in a color property degrades to inheritance; inside
 *     `linear-gradient()` it kills the whole declaration.
 * ───────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * Measure a chart's container so 1 SVG user unit == 1 CSS pixel (R1).
 *
 * Attach the ref to a wrapper that is ALWAYS rendered — including in the
 * empty/loading branch — otherwise the observer never gets an element to watch
 * and the chart stays pinned at `fallback` forever.
 *
 * For a conditionally mounted surface, pass its open state as active so the
 * observer binds after the ref appears and disconnects when it closes.
 *
 * Returns at least 240 so a collapsed/hidden container can never produce a
 * degenerate (or negative) plot band.
 */
export function useChartWidth(ref: RefObject<HTMLElement | null>, fallback = 600, active = true): number {
  const [w, setW] = useState<number>(fallback);

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const next = el.clientWidth;
      if (next > 0) setW((prev) => (Math.abs(prev - next) >= 1 ? next : prev));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);

  return Math.max(240, w);
}

/**
 * Nice-number axis ticks (R5). Returns round values a trader actually reads off
 * an axis, plus the step that produced them — feed that step to fmtTick so the
 * label precision can never collapse two adjacent ticks onto the same string.
 */
export function niceTicks(lo: number, hi: number, target = 4): { values: number[]; step: number } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo) || target < 1) {
    return { values: [], step: 0 };
  }
  const raw = (hi - lo) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const mult = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10;
  const step = mult * mag;
  const first = Math.ceil(lo / step);
  const last = Math.floor(hi / step);
  const values: number[] = [];
  // Guard: a pathological domain must never spin here.
  for (let i = first; i <= last && values.length < 64; i++) {
    const v = i * step;
    values.push(Object.is(v, -0) ? 0 : v);
  }
  return { values, step };
}

/**
 * Format a tick at a precision DERIVED FROM THE STEP (R5), so adjacent ticks
 * can never render identical.
 */
export function fmtTick(v: number, step: number): string {
  if (!Number.isFinite(v)) return String(v);
  const gap = Math.abs(step);
  if (!Number.isFinite(gap) || gap === 0) return String(v);

  // Fit the actual step, including fractional strike grids. A small tolerance
  // absorbs subtraction noise, but must never admit a display quantum larger
  // than the gap: otherwise offset ticks can still round to the same label.
  for (let digits = 0; digits <= 100; digits++) {
    const quantum = Number(`1e-${digits}`);
    const scaled = gap / quantum;
    if (!Number.isFinite(scaled)) break;
    const integer = Math.round(scaled);
    if (integer > 0 && quantum <= gap && Math.abs(scaled - integer) <= 1e-9) {
      const label = v.toFixed(digits);
      return Number(label) === 0 && label.startsWith("-") ? label.slice(1) : label;
    }
  }
  // toFixed supports at most 100 decimals. The shortest representation keeps
  // finite subnormal values distinct instead of rendering them all as zero.
  return String(v);
}

/**
 * Thin a label set by RENDERED PIXEL GAP (R6), never by array index.
 *
 * `items` must already be sorted ascending by `xOf`. The first and last items
 * are always kept; if keeping the last would crowd the previously kept label,
 * that previous label is dropped instead (the endpoints anchor the axis).
 */
export function thinLabels<T>(items: T[], xOf: (t: T) => number, minGapPx: number): T[] {
  if (items.length <= 1) return items.slice();
  const kept: T[] = [items[0]];
  let lastX = xOf(items[0]);
  for (let i = 1; i < items.length - 1; i++) {
    const x = xOf(items[i]);
    if (!Number.isFinite(x)) continue;
    if (x - lastX >= minGapPx) { kept.push(items[i]); lastX = x; }
  }
  const last = items[items.length - 1];
  const lastX2 = xOf(last);
  if (Number.isFinite(lastX2)) {
    while (kept.length > 1 && lastX2 - xOf(kept[kept.length - 1]) < minGapPx) kept.pop();
    kept.push(last);
  }
  return kept;
}

export interface PadDomainOpts {
  /** Fraction of the span added to each end. Default 0.10. */
  padFrac?: number;
  /** Union zero into the domain — but only when the data actually straddles it. */
  includeZero?: boolean;
  /** Hard floor for the low end (e.g. 0 for an implied-vol axis). */
  clampMin?: number;
}

/**
 * Build a padded domain from raw extents (R7). Zero is NEVER forced in: a
 * one-sided series gets the whole panel instead of spending most of it on the
 * empty half.
 */
export function padDomain(lo: number, hi: number, opts: PadDomainOpts = {}): [number, number] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  const padFrac = opts.padFrac ?? 0.10;
  const span = (hi - lo) || Math.max(Math.abs(hi), 1);
  let out0 = lo - span * padFrac;
  let out1 = hi + span * padFrac;
  if (opts.includeZero && lo < 0 && hi > 0) {
    out0 = Math.min(out0, 0);
    out1 = Math.max(out1, 0);
  }
  if (opts.clampMin != null) out0 = Math.max(out0, opts.clampMin);
  return [out0, out1];
}

/** Minimum readable heights (R4). */
export const MIN_CHART_H = { spark: 120, axis: 190 } as const;
