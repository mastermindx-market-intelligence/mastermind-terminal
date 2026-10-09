"use client";
/**
 * FinCharts — hand-rolled SVG primitive kit for the TradingView-parity
 * fundamentals suite (BUILD-SPEC §3.2, R9). NO chart library: every visual is
 * a viewBox-scaled SVG that stretches to `width:100%` and themes off the
 * globals.css `:root` custom properties (--panel/--line/--text/--up/--down/
 * --brand …). Every component is null/empty-safe: pass no data (or empty
 * series) and it renders a `.fin-empty` placeholder instead of crashing.
 *
 * FE2 lanes consume these components — the exported prop types below are the
 * frozen API. Read the JSDoc on each component before wiring it.
 *
 * Number formatting lives in lib/finFormat.ts (fmtNum/fmtPct/pick). These
 * primitives take already-formatted axis/tooltip strings via optional
 * `fmt`/`fmtY` callbacks so the caller owns units (USD/CNY/%/ratio).
 */
import {
  useId,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  type CSSProperties,
  type ReactNode,
} from "react";
import { fmtNum, fmtPct, fmtDate, pick } from "../../lib/finFormat";

/**
 * Measure the chart box's live pixel width so the SVG viewBox can be set to
 * (measuredWidth × SVGH). Because every chart uses `preserveAspectRatio="none"`,
 * a fixed small viewBox (e.g. 320) stretches ~4× horizontally on a wide desktop
 * container — distorting the y-axis TEXT (and turning dots into ellipses). Driving
 * the viewBox width from the real box width makes the scale 1:1 → crisp, undistorted
 * labels and round dots at any width. Falls back to `fallback` until first measured.
 */
function useBoxW(fallback: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(fallback);
  // `measured` gates anchored overlays (the dumbbell tooltip): before the first
  // real measurement — or on a mount inside a hidden tab, where clientWidth reads
  // 0 — `w` is the fallback while the SVG stretches to the real box, so anything
  // positioned in viewBox units lands in the wrong place.
  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => { const cw = Math.round(el.clientWidth); if (cw > 0) { setW(cw); setMeasured(true); } };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w, measured };
}

/* ─────────────────────────────────────────────────────────────────────────
 * shared types + helpers
 * ───────────────────────────────────────────────────────────────────────── */

/** A single numeric datum aligned to a period; `null` renders a gap/hole. */
export type NumOrNull = number | null | undefined;

/** One named series: values array is index-aligned to the chart's `labels`. */
export interface Series {
  /** Legend + tooltip name. */
  name: string;
  /** Index-aligned values; `null` = missing (hole, not zero). */
  values: NumOrNull[];
  /** CSS color (may be a `var(--…)`); defaults cycle through the palette. */
  color?: string;
}

/** Optional per-value formatter (axis ticks, tooltips). Falls back to fmtNum. */
export type ValFmt = (v: number) => string;

/** Default categorical palette (matches the TV reference legend colors). */
const PALETTE = [
  "var(--brand)",
  "var(--up)",
  "var(--warn)",
  "var(--down)",
  "var(--code-fn)",
  "var(--brand-2)",
];

const NBSP = " ";

/** Null-safe finite check. */
const num = (v: NumOrNull): v is number => v != null && isFinite(v as number);

/** Every value in every series null/empty? → drives the empty placeholder. */
function allEmpty(series: Series[] | undefined, labels?: unknown[]): boolean {
  if (!series || series.length === 0) return true;
  if (labels && labels.length === 0) return true;
  return series.every((s) => !s.values || s.values.every((v) => !num(v)));
}

/** Compute a [min,max] domain across series, padded, always including 0 when asked. */
function domain(
  series: Series[],
  includeZero = true,
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series)
    for (const v of s.values || [])
      if (num(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    const pad = Math.abs(lo) || 1;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** "Nice" tick values across a domain (≈`count` ticks, includes 0 if in range). */
function ticks([lo, hi]: [number, number], count = 4): number[] {
  if (lo === hi) return [lo];
  const span = hi - lo;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.001; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/** Empty placeholder — shared by every primitive when it has nothing to draw. */
function Empty({ zh, label }: { zh?: boolean; label?: string }) {
  return (
    <div className="fin-empty" role="status">
      {label ?? pick(!!zh, "No data", "暂无数据")}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * FinTip — shared fixed-position tooltip (the `.sa-trust-pop` pattern)
 * ───────────────────────────────────────────────────────────────────────── */

/** One row inside a FinTip: colored dot + label + right-aligned value. */
export interface TipRow {
  label: string;
  value: string;
  color?: string;
}

/** Data the hover handlers feed into the shared tooltip. */
export interface TipState {
  /** Viewport x (clientX). */
  x: number;
  /** Viewport y (clientY). */
  y: number;
  /** Bold title line (e.g. the period label). */
  title?: string;
  rows: TipRow[];
}

/**
 * FinTip — a fixed-position, viewport-clamped tooltip. Render ONE per chart and
 * drive it with a `TipState | null` you set from `onMouseMove`/`onMouseLeave`.
 * Pointer-events are disabled so it never eats hover. The rendered box is
 * MEASURED after paint and clamped/flipped so it can never leave the viewport
 * on any edge (the old right-anchor math pushed mid-screen mobile taps off the
 * LEFT edge — the tooltip is a fixed 220px but a right-anchored box has an
 * unbounded left edge).
 */
export function FinTip({ tip }: { tip: TipState | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Layout effect: measure + clamp BEFORE paint so the box never flashes at
  // the raw cursor offset (client component — no SSR concern).
  useLayoutEffect(() => {
    if (!tip || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = tip.x + 14;
    if (left + r.width > vw - 8) left = tip.x - 14 - r.width; // flip to the pointer's left
    left = Math.min(Math.max(8, left), Math.max(8, vw - r.width - 8));
    let top = tip.y + 14;
    if (top + r.height > vh - 8) top = tip.y - 14 - r.height; // flip above the pointer
    top = Math.min(Math.max(8, top), Math.max(8, vh - r.height - 8));
    setPos({ left, top });
  }, [tip]);
  if (!tip) return null;
  // First paint is measured invisibly; the effect above then places + reveals it.
  const style: CSSProperties = pos
    ? { left: pos.left, top: pos.top }
    : { left: tip.x + 14, top: tip.y + 14, visibility: "hidden" };
  return (
    <div className="fin-tip" style={style} role="tooltip" ref={ref}>
      {tip.title && <div className="fin-tip-h">{tip.title}</div>}
      {tip.rows.map((r, i) => (
        <div className="fin-tip-row" key={i}>
          <span className="fin-tip-dot" style={{ background: r.color ?? "var(--text-2)" }} />
          <span className="fin-tip-lbl">{r.label}</span>
          <span className="fin-tip-val">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Hook: manage a FinTip's state + convenience move/leave handlers. */
export function useFinTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = (e: { clientX: number; clientY: number }, title: string | undefined, rows: TipRow[]) =>
    setTip({ x: e.clientX, y: e.clientY, title, rows });
  const hide = () => setTip(null);
  return { tip, show, hide, setTip };
}

/* ─────────────────────────────────────────────────────────────────────────
 * chart frame — shared axis/grid scaffold
 * ───────────────────────────────────────────────────────────────────────── */

/* padding inside the viewBox (right gutter holds the y-axis tick labels).
 * r is now computed dynamically per-chart from the longest formatted tick
 * label — call `rPad(ticks, fmtY)` to get the right gutter in viewBox px.
 * The estimate is 6.2px per character (matches the 9.5px font at 1:1 scale),
 * plus 8px inset gap, clamped to [36, 90]. The static PAD.r fallback is kept
 * for components that don't call rPad (YearOverlay has its own RPAD). */
const PAD = { t: 8, r: 46, b: 20, l: 6 };
const CHAR_W = 6.2;   // px per character at fin-axis-y 9.5px font, 1:1 viewBox scale
function rPad(tk: number[], fmtY: (v: number) => string): number {
  const longest = tk.reduce((max, t) => Math.max(max, fmtY(t).length), 0);
  return Math.min(90, Math.max(36, Math.ceil(longest * CHAR_W) + 8));
}

/* ─────────────────────────────────────────────────────────────────────────
 * <Bars> — grouped, signed vertical bars
 * ───────────────────────────────────────────────────────────────────────── */

/** Props for {@link Bars}. */
export interface BarsProps {
  /** x-axis category labels (period labels). */
  labels: string[];
  /** One or more series; multiple → grouped bars per category. */
  series: Series[];
  /** Format axis ticks + tooltip values. Defaults to fmtNum. */
  fmtY?: ValFmt;
  vw?: number;
  vh?: number;
  /** Hide the built-in legend (caller draws its own). */
  noLegend?: boolean;
  zh?: boolean;
  /** Height in CSS px (SVG is responsive; this caps the box). */
  height?: number;
}

/**
 * Grouped/signed vertical bars. Negative values draw below the zero baseline.
 * Multiple series render as clustered bars sharing each category slot.
 */
export function Bars({ labels, series, fmtY = fmtNum, vw = 320, vh = 180, noLegend, zh, height }: BarsProps) {
  const { tip, show, hide } = useFinTip();
  const box = useBoxW(vw);
  if (allEmpty(series, labels)) return <Empty zh={zh} />;
  vw = box.w; vh = height ?? 170;   // viewBox = real px box size → 1:1 scale, no text distortion
  const dom = domain(series, true);
  const tk = ticks(dom, 4);
  const PR = rPad(tk, fmtY);
  const iw = vw - PAD.l - PR;
  const ih = vh - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ih - ((v - dom[0]) / (dom[1] - dom[0])) * ih;
  const y0 = y(0);
  const slot = iw / Math.max(1, labels.length);
  const groupW = slot * 0.66;
  const barW = groupW / series.length;
  const SVGH = height ?? 170;
  return (
    <div className="fin-chart">
      <div className="fin-svg-box" ref={box.ref} style={{ height: SVGH }}>
      <svg viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none" className="fin-svg" aria-hidden>
        {tk.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "fin-grid fin-grid-0" : "fin-grid"} x1={PAD.l} x2={vw - PR} y1={y(t)} y2={y(t)} />
            <text className="fin-axis-y" x={vw - PR + 4} y={y(t) + 3}>{fmtY(t)}</text>
          </g>
        ))}
        {labels.map((lb, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          return (
            <g key={i}
              onMouseMove={(e) => show(e, lb, series.map((s, si) => ({ label: s.name, value: num(s.values[i]) ? fmtY(s.values[i] as number) : "—", color: s.color ?? PALETTE[si % PALETTE.length] })))}
              onMouseLeave={hide}>
              <rect className="fin-hoverband" x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} />
              {series.map((s, si) => {
                const v = s.values[i];
                if (!num(v)) return null;
                const bx = cx - groupW / 2 + barW * si;
                const yv = y(v);
                return <rect key={si} className="fin-bar" x={bx} y={Math.min(yv, y0)} width={barW * 0.86} height={Math.max(1, Math.abs(yv - y0))} fill={s.color ?? PALETTE[si % PALETTE.length]} rx={1} />;
              })}
            </g>
          );
        })}
      </svg>
      </div>
      <XAxis labels={labels} boxW={box.w} rpad={PR} />
      {!noLegend && <Legend series={series} />}
      <FinTip tip={tip} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * <StackedBars> — stacked vertical bars (positive stack)
 * ───────────────────────────────────────────────────────────────────────── */

/** Props for {@link StackedBars}. */
export interface StackedBarsProps extends Omit<BarsProps, "series"> {
  series: Series[];
}

/**
 * Stacked vertical bars — each category is a single column with series stacked
 * bottom→top. Negatives are clamped (use {@link Waterfall} for bridges).
 */
export function StackedBars({ labels, series, fmtY = fmtNum, vw = 320, vh = 180, noLegend, zh, height }: StackedBarsProps) {
  const { tip, show, hide } = useFinTip();
  const box = useBoxW(vw);
  if (allEmpty(series, labels)) return <Empty zh={zh} />;
  vw = box.w; vh = height ?? 170;   // viewBox = real px box size → 1:1 scale, no text distortion
  const totals = labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, num(s.values[i]) ? (s.values[i] as number) : 0), 0));
  const hi = Math.max(...totals, 1);
  const tk = ticks([0, hi], 4);
  const PR = rPad(tk, fmtY);
  const iw = vw - PAD.l - PR;
  const ih = vh - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ih - (v / hi) * ih;
  const slot = iw / Math.max(1, labels.length);
  const barW = slot * 0.5;
  const SVGH = height ?? 170;
  return (
    <div className="fin-chart">
      <div className="fin-svg-box" ref={box.ref} style={{ height: SVGH }}>
      <svg viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none" className="fin-svg" aria-hidden>
        {tk.map((t) => (
          <g key={t}>
            <line className="fin-grid" x1={PAD.l} x2={vw - PR} y1={y(t)} y2={y(t)} />
            <text className="fin-axis-y" x={vw - PR + 4} y={y(t) + 3}>{fmtY(t)}</text>
          </g>
        ))}
        {labels.map((lb, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          let acc = 0;
          return (
            <g key={i}
              onMouseMove={(e) => show(e, lb, series.map((s, si) => ({ label: s.name, value: num(s.values[i]) ? fmtY(s.values[i] as number) : "—", color: s.color ?? PALETTE[si % PALETTE.length] })))}
              onMouseLeave={hide}>
              <rect className="fin-hoverband" x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} />
              {series.map((s, si) => {
                const v = num(s.values[i]) ? Math.max(0, s.values[i] as number) : 0;
                if (v === 0) return null;
                const yTop = y(acc + v);
                const h = Math.max(1, y(acc) - yTop);
                acc += v;
                return <rect key={si} className="fin-bar" x={cx - barW / 2} y={yTop} width={barW} height={h} fill={s.color ?? PALETTE[si % PALETTE.length]} />;
              })}
            </g>
          );
        })}
      </svg>
      </div>
      <XAxis labels={labels} boxW={box.w} rpad={PR} />
      {!noLegend && <Legend series={series} />}
      <FinTip tip={tip} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * <LineSeries> — multi-line, optional dotted, node markers
 * ───────────────────────────────────────────────────────────────────────── */

/** Props for {@link LineSeries}. */
export interface LineSeriesProps {
  labels: string[];
  series: Series[];
  fmtY?: ValFmt;
  vw?: number;
  vh?: number;
  /** Draw circular node markers at each point. */
  markers?: boolean;
  /** Series indices (or names) to render dotted (e.g. a moving average). */
  dotted?: number[] | string[];
  /** Force zero into the y-domain. Default false (auto-fit). */
  includeZero?: boolean;
  /** Draw a horizontal reference line at this value (e.g. 0 baseline). */
  refLine?: number | null;
  noLegend?: boolean;
  zh?: boolean;
  height?: number;
}

/**
 * Multi-line chart with an optional dotted variant per series and optional node
 * markers. Holes (null values) break the path. Right y-axis, faint gridlines.
 */
export function LineSeries({ labels, series, fmtY = fmtNum, vw = 320, vh = 180, markers, dotted, includeZero = false, refLine = null, noLegend, zh, height }: LineSeriesProps) {
  const { tip, show, hide } = useFinTip();
  const box = useBoxW(vw);
  if (allEmpty(series, labels)) return <Empty zh={zh} />;
  vw = box.w; vh = height ?? 190;   // viewBox = real px box size → 1:1 scale, no text distortion
  const withRef = refLine != null ? [...series, { name: "__ref", values: [refLine] }] : series;
  const dom = domain(withRef, includeZero);
  const tk = ticks(dom, 4);
  const PR = rPad(tk, fmtY);
  const iw = vw - PAD.l - PR;
  const ih = vh - PAD.t - PAD.b;
  const n = labels.length;
  // Place points in slots so the first/last point are inset by half-slot,
  // matching how bar charts centre bars — this keeps the last point clear of
  // the right y-label gutter.  For n=1 the single point sits at mid-plot.
  const slot = iw / Math.max(1, n);
  const x = (i: number) => PAD.l + slot * i + slot / 2;
  const y = (v: number) => PAD.t + ih - ((v - dom[0]) / (dom[1] - dom[0])) * ih;
  const isDotted = (s: Series, si: number) => (dotted as any[])?.some((d) => (typeof d === "number" ? d === si : d === s.name)) ?? false;
  const SVGH = height ?? 190;
  return (
    <div className="fin-chart">
      <div className="fin-svg-box" ref={box.ref} style={{ height: SVGH }}>
      <svg viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none" className="fin-svg" aria-hidden>
        {tk.map((t) => (
          <g key={t}>
            <line className="fin-grid" x1={PAD.l} x2={vw - PR} y1={y(t)} y2={y(t)} />
            <text className="fin-axis-y" x={vw - PR + 4} y={y(t) + 3}>{fmtY(t)}</text>
          </g>
        ))}
        {refLine != null && <line className="fin-refline" x1={PAD.l} x2={vw - PR} y1={y(refLine)} y2={y(refLine)} />}
        {series.map((s, si) => {
          const col = s.color ?? PALETTE[si % PALETTE.length];
          const pts: string[] = [];
          s.values.forEach((v, i) => { if (num(v)) pts.push(`${x(i)},${y(v as number)}`); });
          if (pts.length === 0) return null;
          return (
            <g key={si}>
              <polyline className={"fin-line" + (isDotted(s, si) ? " fin-line-dotted" : "")} points={pts.join(" ")} fill="none" stroke={col} />
              {markers && s.values.map((v, i) => num(v) ? <circle key={i} className="fin-node" cx={x(i)} cy={y(v as number)} r={2.4} fill={col} /> : null)}
            </g>
          );
        })}
        {labels.map((lb, i) => (
          <rect key={i} className="fin-hitcol" x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} fill="transparent"
            onMouseMove={(e) => show(e, lb, series.map((s, si) => ({ label: s.name, value: num(s.values[i]) ? fmtY(s.values[i] as number) : "—", color: s.color ?? PALETTE[si % PALETTE.length] })))}
            onMouseLeave={hide} />
        ))}
      </svg>
      </div>
      <XAxis labels={labels} boxW={box.w} rpad={PR} />
      {!noLegend && <Legend series={series} />}
      <FinTip tip={tip} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * <ComboChart> — bars + line on a right axis (financials mini)
 * ───────────────────────────────────────────────────────────────────────── */

/** Props for {@link ComboChart}. */
export interface ComboChartProps {
  labels: string[];
  /** Series drawn as (grouped) bars against the LEFT/value axis. */
  bars: Series[];
  /** A single overlaid line against the RIGHT axis (e.g. a margin %). */
  line: Series;
  fmtBar?: ValFmt;
  fmtLine?: ValFmt;
  vw?: number;
  vh?: number;
  noLegend?: boolean;
  zh?: boolean;
  height?: number;
}

/**
 * Combo chart: value bars (grouped) + one line on an independent right axis.
 * Mirrors the TV "Financials mini" Income/Balance variants (Revenue bars +
 * Net-margin line). Both axes auto-fit; the line axis is drawn on the right.
 */
export function ComboChart({ labels, bars, line, fmtBar = fmtNum, fmtLine = (v) => fmtPct(v, { alreadyPct: true }), vw = 320, vh = 190, noLegend, zh, height }: ComboChartProps) {
  const { tip, show, hide } = useFinTip();
  const box = useBoxW(vw);
  const barsEmpty = allEmpty(bars, labels);
  const lineEmpty = allEmpty([line], labels);
  if (barsEmpty && lineEmpty) return <Empty zh={zh} />;
  vw = box.w; vh = height ?? 170;   // viewBox = real px box size → 1:1 scale, no text distortion
  const bdom = domain(bars, true);
  const btk = ticks(bdom, 4);
  const ldom = domain([line], false);
  const PR = rPad(btk, fmtBar);
  const iw = vw - PAD.l - PR;
  const ih = vh - PAD.t - PAD.b;
  const yb = (v: number) => PAD.t + ih - ((v - bdom[0]) / (bdom[1] - bdom[0])) * ih;
  const yl = (v: number) => PAD.t + ih - ((v - ldom[0]) / (ldom[1] - ldom[0])) * ih;
  const y0 = yb(0);
  const n = labels.length;
  const slot = iw / Math.max(1, n);
  const groupW = slot * 0.6;
  const barW = groupW / Math.max(1, bars.length);
  const x = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const lcol = line.color ?? "var(--warn)";
  const lpts: string[] = [];
  line.values.forEach((v, i) => { if (num(v)) lpts.push(`${PAD.l + slot * i + slot / 2},${yl(v as number)}`); });
  const SVGH = height ?? 170;
  return (
    <div className="fin-chart">
      <div className="fin-svg-box" ref={box.ref} style={{ height: SVGH }}>
      <svg viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none" className="fin-svg" aria-hidden>
        {btk.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "fin-grid fin-grid-0" : "fin-grid"} x1={PAD.l} x2={vw - PR} y1={yb(t)} y2={yb(t)} />
            <text className="fin-axis-y" x={vw - PR + 4} y={yb(t) + 3}>{fmtBar(t)}</text>
          </g>
        ))}
        {labels.map((lb, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          return (
            <g key={i}
              onMouseMove={(e) => show(e, lb, [...bars.map((s, si) => ({ label: s.name, value: num(s.values[i]) ? fmtBar(s.values[i] as number) : "—", color: s.color ?? PALETTE[si % PALETTE.length] })), { label: line.name, value: num(line.values[i]) ? fmtLine(line.values[i] as number) : "—", color: lcol }])}
              onMouseLeave={hide}>
              <rect className="fin-hoverband" x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} />
              {bars.map((s, si) => {
                const v = s.values[i];
                if (!num(v)) return null;
                const bx = cx - groupW / 2 + barW * si;
                const yv = yb(v);
                return <rect key={si} className="fin-bar" x={bx} y={Math.min(yv, y0)} width={barW * 0.86} height={Math.max(1, Math.abs(yv - y0))} fill={s.color ?? PALETTE[si % PALETTE.length]} rx={1} />;
              })}
            </g>
          );
        })}
        {lpts.length > 0 && <polyline className="fin-line" points={lpts.join(" ")} fill="none" stroke={lcol} />}
        {line.values.map((v, i) => num(v) ? <circle key={i} className="fin-node" cx={PAD.l + slot * i + slot / 2} cy={yl(v as number)} r={2.4} fill={lcol} /> : null)}
      </svg>
      </div>
      <XAxis labels={labels} boxW={box.w} rpad={PR} />
      {!noLegend && <Legend series={[...bars, { name: line.name, values: [], color: lcol }]} />}
      <FinTip tip={tip} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * <Dumbbell> — actual/estimate paired dots + FORECAST hatched zone
 * ───────────────────────────────────────────────────────────────────────── */

/** One period column in a {@link Dumbbell} (EPS actual vs estimate). */
export interface DumbbellPoint {
  label: string;
  /** Reported actual (filled dot). `null` for a future/pending period. */
  actual: NumOrNull;
  /** Estimate/consensus (hollow ring). */
  estimate: NumOrNull;
  /** Report date (ISO) — rendered as the tooltip "Date" row (TV parity). */
  date?: string | null;
  /** Surprise % vs estimate — drives beat/miss dot color + tooltip Surprise row. */
  surp_pct?: number | null;
}

/** Props for {@link Dumbbell}. */
export interface DumbbellProps {
  points: DumbbellPoint[];
  fmtY?: ValFmt;
  vw?: number;
  vh?: number;
  /**
   * Index at which the FORECAST hatched zone begins (inclusive). Columns from
   * here to the end get a diagonal-hatch background — the "estimate only" tail.
   * Defaults to the first column whose `actual` is null.
   */
  forecastFrom?: number;
  actualColor?: string;
  estimateColor?: string;
  noLegend?: boolean;
  zh?: boolean;
  height?: number;
  /** Disable the width-adaptive trailing window (rail minis pass a curated
   *  short set — e.g. last 4Q + next — that must never be trimmed). */
  noWindow?: boolean;
}

/**
 * Dumbbell / paired-dot plot: filled Actual dot + hollow Estimate ring per
 * period. A diagonal-hatched FORECAST band shades the forward (estimate-only)
 * columns. This is the TV Earnings dumbbell, at TV parity:
 *   • WIDTH-ADAPTIVE WINDOW — only as many TRAILING periods as fit at a
 *     comfortable slot width are drawn (TV mobile shows ~5 quarters), so the
 *     x-axis can never crowd. Desktop keeps the full set.
 *   • Beat/miss coloring — when a point carries `surp_pct`, the actual dot is
 *     green (beat) / red (miss); otherwise `actualColor`.
 *   • ANCHORED tooltip — hover/tap selects a column; a Date/Actual/Estimate/
 *     Surprise card renders INSIDE the chart box, clamped to its bounds, so it
 *     can never leave the screen (the old cursor-chasing FinTip could). A tap
 *     pins it; tapping the column again or anywhere outside dismisses it.
 */
export function Dumbbell({ points, fmtY = fmtNum, vw = 320, vh = 180, forecastFrom, actualColor = "var(--up)", estimateColor = "var(--text-2)", noLegend, zh, height, noWindow }: DumbbellProps) {
  const hatchId = useId().replace(/:/g, "");
  const box = useBoxW(vw);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinIdx, setPinIdx] = useState<number | null>(null); // tap-to-pin (touch)
  // ── TV-parity trailing window: keep the most recent N periods that fit at
  // ≥56px per column (estimated with the default gutter; the exact gutter is
  // recomputed from the windowed domain below). Hoisted above the early
  // returns so the selection-reset effect can key on it.
  const MIN_SLOT = 56;
  const nPts = points?.length ?? 0;
  const maxCols = noWindow ? Math.max(1, nPts) : Math.max(4, Math.floor(Math.max(1, box.w - PAD.l - PAD.r) / MIN_SLOT));
  // hover/pin index INTO THE WINDOW — when the window shifts (resize changes
  // maxCols, or the points set changes e.g. A/Q toggle) the same index would
  // denote a different period, so drop any selection. Keyed on a VALUE
  // signature, not array identity: parents rebuild the points array on every
  // render (quote polls etc.) and identity-keying would dismiss an open card.
  const winSig = `${nPts}:${points?.[0]?.label ?? ""}:${points?.[nPts - 1]?.label ?? ""}:${maxCols}`;
  useEffect(() => { setPinIdx(null); setHoverIdx(null); }, [winSig]);
  // Dismiss the card on any press outside this chart's box. Clears hover too:
  // touch taps fire an emulated mouseenter that never gets a mouseleave, so
  // hoverIdx would otherwise keep the card alive after an outside tap.
  const cardOpen = pinIdx != null || hoverIdx != null;
  useEffect(() => {
    if (!cardOpen) return;
    const onDown = (e: PointerEvent) => {
      if (box.ref.current && !box.ref.current.contains(e.target as Node)) {
        setPinIdx(null);
        setHoverIdx(null);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [cardOpen, box.ref]);
  if (!points || points.length === 0 || points.every((p) => !num(p.actual) && !num(p.estimate)))
    return <Empty zh={zh} />;
  vw = box.w; vh = height ?? 170;   // viewBox = real px box size → 1:1 scale, round dots + crisp labels

  // Window start: normally the trailing maxCols slice, but if that slice is
  // entirely null (sparse recent data) anchor it at the LAST period holding a
  // value so the chart never says "No data" while older points have some.
  let start = Math.max(0, points.length - maxCols);
  if (points.slice(start).every((p) => !num(p.actual) && !num(p.estimate))) {
    for (let i = points.length - 1; i >= 0; i--) {
      if (num(points[i].actual) || num(points[i].estimate)) { start = Math.max(0, i + 1 - maxCols); break; }
    }
  }
  const win = points.slice(start, start + maxCols);
  const offset = start;

  const vals: number[] = [];
  win.forEach((p) => { if (num(p.actual)) vals.push(p.actual as number); if (num(p.estimate)) vals.push(p.estimate as number); });
  if (vals.length === 0) return <Empty zh={zh} />;
  const dom = domain([{ name: "", values: vals }], true);
  const tk = ticks(dom, 4);
  const PR = rPad(tk, fmtY);
  const iw = vw - PAD.l - PR;
  const ih = vh - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ih - ((v - dom[0]) / (dom[1] - dom[0])) * ih;
  const slot = iw / Math.max(1, win.length);
  const R = Math.max(5, Math.min(10, slot * 0.16)); // TV-sized dots, scaled to slot
  let fFrom: number;
  if (forecastFrom != null) {
    const rel = forecastFrom - offset;
    fFrom = rel >= win.length ? -1 : Math.max(0, rel);
  } else {
    fFrom = win.findIndex((p) => !num(p.actual) && num(p.estimate));
  }
  const labels = win.map((p) => p.label);
  const active = pinIdx ?? hoverIdx;
  const SVGH = height ?? 170;
  return (
    <div className="fin-chart">
      <div className="fin-svg-box" ref={box.ref} style={{ height: SVGH }}>
      <svg viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none" className="fin-svg" aria-hidden>
        <defs>
          <pattern id={hatchId} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={6} className="fin-hatch" />
          </pattern>
        </defs>
        {fFrom >= 0 && (
          <rect className="fin-forecast" x={PAD.l + slot * fFrom} y={PAD.t} width={iw - slot * fFrom} height={ih} fill={`url(#${hatchId})`} />
        )}
        {tk.map((t) => (
          <g key={t}>
            <line className="fin-grid" x1={PAD.l} x2={vw - PR} y1={y(t)} y2={y(t)} />
            <text className="fin-axis-y" x={vw - PR + 4} y={y(t) + 3}>{fmtY(t)}</text>
          </g>
        ))}
        {win.map((p, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          const ya = num(p.actual) ? y(p.actual as number) : null;
          const ye = num(p.estimate) ? y(p.estimate as number) : null;
          const dotCol = num(p.surp_pct) ? ((p.surp_pct as number) >= 0 ? "var(--up)" : "var(--down)") : actualColor;
          return (
            <g key={i}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
              onClick={(e) => { e.stopPropagation(); if (pinIdx === i) { setPinIdx(null); setHoverIdx(null); } else { setPinIdx(i); } }}>
              <rect className={"fin-hoverband" + (active === i ? " on" : "")} x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} />
              {ya != null && ye != null && <line className="fin-stem" x1={cx} x2={cx} y1={ya} y2={ye} />}
              {ye != null && <circle className="fin-dot-est" cx={cx} cy={ye} r={R} fill="var(--panel)" stroke={estimateColor} style={{ strokeWidth: Math.max(1.8, R * 0.28) }} />}
              {ya != null && <circle className="fin-dot-act" cx={cx} cy={ya} r={R} fill={dotCol} />}
            </g>
          );
        })}
      </svg>
      {active != null && win[active] != null && box.measured && (() => {
        const p = win[active];
        const cx = PAD.l + slot * active + slot / 2;
        // Clamp in MEASURED px space only (box.measured gate above): before the first
        // real measurement vw is the 320 fallback while the SVG stretches to the full
        // module width, so cx lands in 320-unit space and the old clamp pinned the tip
        // into the leftmost ~134px — the reported "bleeding off the container".
        const INSET = 8;
        // A 180px card is too narrow for legitimate low-denominator surprises such as
        // "+0.22 (3162.41%)". Give the card room on normal charts, but keep the same
        // measured-box clamp so compact panes can never push it outside the plot.
        const TIPW = Math.min(232, Math.max(96, vw - INSET * 2));
        const left = Math.min(Math.max(INSET, cx - TIPW / 2), Math.max(INSET, vw - TIPW - INSET));
        const diff = num(p.actual) && num(p.estimate) ? (p.actual as number) - (p.estimate as number) : null;
        const sp = num(p.surp_pct)
          ? (p.surp_pct as number)
          : diff != null && (p.estimate as number) !== 0 ? (diff / Math.abs(p.estimate as number)) * 100 : null;
        // Sign + color BOTH follow the displayed actual-vs-estimate diff so
        // they can never disagree (provider surp_pct only breaks ties).
        const beat = (diff ?? sp ?? 0) >= 0;
        return (
          <div className="fin-dumbtip" style={{ left, top: 6, width: TIPW }} role="tooltip">
            <div className="r"><span className="k">{pick(!!zh, "Date", "日期")}</span><span className="v">{p.date ? fmtDate(p.date) : p.label}</span></div>
            <div className="r"><span className="k">{pick(!!zh, "Actual", "实际")}</span><span className="v">{num(p.actual) ? fmtY(p.actual as number) : "—"}</span></div>
            <div className="r"><span className="k">{pick(!!zh, "Estimate", "预期")}</span><span className="v">{num(p.estimate) ? fmtY(p.estimate as number) : "—"}</span></div>
            {diff != null && (
              <div className="r"><span className="k">{pick(!!zh, "Surprise", "超预期")}</span>
                <span className={"v surprise " + (beat ? "up" : "down")}>
                  <span>{(diff >= 0 ? "+" : "−") + fmtY(Math.abs(diff))}</span>
                  {sp != null && <span>({Math.abs(sp).toFixed(2)}%)</span>}
                </span></div>
            )}
          </div>
        );
      })()}
      </div>
      <XAxis labels={labels} boxW={box.w} rpad={PR} />
      {!noLegend && (
        <div className="fin-legend">
          <span className="fin-leg"><i className="fin-leg-dot" style={{ background: actualColor }} />{pick(!!zh, "Actual", "实际")}</span>
          <span className="fin-leg"><i className="fin-leg-dot fin-leg-ring" style={{ borderColor: estimateColor }} />{pick(!!zh, "Estimate", "预期")}</span>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * <Donut> — ring chart with center label + legend
 * ───────────────────────────────────────────────────────────────────────── */

/** One slice of a {@link Donut}. */
export interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

/** Props for {@link Donut}. */
export interface DonutProps {
  slices: DonutSlice[];
  /** Big number in the ring center (already formatted). */
  centerValue?: string;
  /** Small caption under the center value. */
  centerLabel?: string;
  /** Show a value + % legend beneath. */
  legend?: boolean;
  /** Format legend values. Defaults to fmtNum. */
  fmtV?: ValFmt;
  size?: number;
  zh?: boolean;
}

/**
 * Donut / ring chart with a centered numeric label and an optional value+share
 * legend. Slices with non-positive values are dropped. The TV Ownership /
 * Revenue-breakdown donuts use this.
 */
export function Donut({ slices, centerValue, centerLabel, legend = true, fmtV = fmtNum, size = 132, zh }: DonutProps) {
  const clean = (slices || []).filter((s) => num(s.value) && s.value > 0);
  const total = clean.reduce((a, s) => a + s.value, 0);
  if (clean.length === 0 || total <= 0) return <Empty zh={zh} />;
  const r = size / 2;
  const sw = size * 0.16;
  const rr = r - sw / 2;
  const C = 2 * Math.PI * rr;
  let acc = 0;
  return (
    <div className="fin-donut">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="fin-donut-svg" aria-hidden>
        <circle cx={r} cy={r} r={rr} fill="none" stroke="var(--line)" strokeWidth={sw} />
        {clean.map((s, i) => {
          const frac = s.value / total;
          const dash = `${frac * C} ${C}`;
          const off = -acc * C;
          acc += frac;
          return (
            <circle key={i} cx={r} cy={r} r={rr} fill="none" stroke={s.color ?? PALETTE[i % PALETTE.length]} strokeWidth={sw}
              strokeDasharray={dash} strokeDashoffset={off} transform={`rotate(-90 ${r} ${r})`} />
          );
        })}
        {centerValue && <text className="fin-donut-c" x={r} y={r} textAnchor="middle" dominantBaseline="central">{centerValue}</text>}
        {centerLabel && <text className="fin-donut-cl" x={r} y={r + size * 0.14} textAnchor="middle">{centerLabel}</text>}
      </svg>
      {legend && (
        <div className="fin-donut-legend">
          {clean.map((s, i) => (
            <div className="fin-donut-row" key={i}>
              <span className="fin-leg-dot" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} />
              <span className="fin-donut-lbl">{s.label}</span>
              <span className="fin-donut-val">{fmtV(s.value)}{NBSP}<span className="fin-donut-pct">({fmtPct((s.value / total) * 100, { alreadyPct: true })})</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * <Waterfall> — bridge (running total) bars
 * ───────────────────────────────────────────────────────────────────────── */

/** One step in a {@link Waterfall}. */
export interface WaterfallStep {
  label: string;
  /** Signed contribution; positive = green rise, negative = red fall. */
  value: NumOrNull;
  /**
   * When true, this step is an absolute subtotal/total drawn from the zero
   * baseline (blue), not a floating delta (e.g. Op income, Net income).
   */
  total?: boolean;
}

/** Props for {@link Waterfall}. */
export interface WaterfallProps {
  steps: WaterfallStep[];
  fmtY?: ValFmt;
  vw?: number;
  vh?: number;
  zh?: boolean;
  height?: number;
}

/**
 * Waterfall / bridge chart — floating bars that step a running total up (green)
 * and down (red); `total` steps draw from zero (blue). Dashed connectors link
 * consecutive bar tops. This is the TV "Revenue to profit conversion" and
 * "Capital structure" bridge.
 */
export function Waterfall({ steps, fmtY = fmtNum, vw = 340, vh = 200, zh, height }: WaterfallProps) {
  const { tip, show, hide } = useFinTip();
  const box = useBoxW(vw);
  const clean = (steps || []).filter((s) => num(s.value));
  if (clean.length === 0) return <Empty zh={zh} />;
  vw = box.w; vh = height ?? 170;   // viewBox = real px box size → 1:1 scale, no text distortion
  // compute running tops/bottoms
  let run = 0;
  const bars = clean.map((s) => {
    const v = s.value as number;
    if (s.total) { run = v; return { s, lo: Math.min(0, v), hi: Math.max(0, v), top: v }; }
    const start = run; run += v;
    return { s, lo: Math.min(start, run), hi: Math.max(start, run), top: run };
  });
  const lo = Math.min(0, ...bars.map((b) => b.lo));
  const hi = Math.max(0, ...bars.map((b) => b.hi));
  const dom: [number, number] = [lo - (hi - lo) * 0.06, hi + (hi - lo) * 0.06];
  const tk = ticks(dom, 4);
  const PR = rPad(tk, fmtY);
  const iw = vw - PAD.l - PR;
  const ih = vh - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ih - ((v - dom[0]) / (dom[1] - dom[0])) * ih;
  const slot = iw / Math.max(1, bars.length);
  const barW = slot * 0.56;
  const labels = clean.map((s) => s.label);
  const SVGH = height ?? 170;
  return (
    <div className="fin-chart">
      <div className="fin-svg-box" ref={box.ref} style={{ height: SVGH }}>
      <svg viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none" className="fin-svg" aria-hidden>
        {tk.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "fin-grid fin-grid-0" : "fin-grid"} x1={PAD.l} x2={vw - PR} y1={y(t)} y2={y(t)} />
            <text className="fin-axis-y" x={vw - PR + 4} y={y(t) + 3}>{fmtY(t)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          const v = b.s.value as number;
          const cls = b.s.total ? "var(--brand)" : v >= 0 ? "var(--up)" : "var(--down)";
          const yTop = y(b.hi);
          const bh = Math.max(1, y(b.lo) - y(b.hi));
          const prev = bars[i - 1];
          return (
            <g key={i}
              onMouseMove={(e) => show(e, b.s.label, [{ label: b.s.label, value: fmtY(v), color: cls }])}
              onMouseLeave={hide}>
              <rect className="fin-hoverband" x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} />
              {prev && <line className="fin-wf-conn" x1={PAD.l + slot * (i - 1) + slot / 2 + barW / 2} y1={y(prev.top)} x2={cx - barW / 2} y2={y(prev.top)} />}
              <rect className="fin-bar" x={cx - barW / 2} y={yTop} width={barW} height={bh} fill={cls} rx={1} />
            </g>
          );
        })}
      </svg>
      </div>
      <WaterfallXAxis labels={labels} boxW={box.w} rpad={PR} />
      <FinTip tip={tip} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * <CapitalStructure> — purpose-built enterprise-value bridge
 *
 * NOT a Waterfall reuse. The old build routed capital structure through the
 * sign-colored Waterfall, which (a) painted Debt green / Cash red by numeric
 * sign — meaningless for a composition — and (b) FLIPPED those colors under the
 * east red-up theme, and (c) carried a detached legend whose dot colors
 * contradicted the bars. Capital structure is a COMPOSITION, not a directional
 * delta: it uses stable, non-directional tokens only (brand / warn / outline).
 * ───────────────────────────────────────────────────────────────────────── */

/** One horizontal composition row in the EV bridge. */
export interface CapStructRow {
  /** Stable row key (locale-independent) — drives the color token. */
  key: "mcap" | "debt" | "cash" | "ev";
  /** Full bilingual label, never truncated. */
  label: string;
  /** Signed magnitude: cash is negative (it subtracts from EV). */
  value: number;
  /** Bar fill token — non-directional, locale-stable. */
  color: string;
  /** Grammar prefix rendered before the label ("+", "−", "="). */
  op: "" | "+" | "−" | "=";
  /** Bar width as a fraction 0..1 of the widest row (|value| / max|value|). */
  frac: number;
  /** True for the outline-notch cash row (subtracts, drawn hollow). */
  outline: boolean;
}

/**
 * buildCapStructRows — PURE mapping (market cap / debt / cash → bridge rows).
 * Exported for the smoke test. Rows model the accounting identity
 * `EV = market cap + debt − cash`: market cap is the base, debt adds, cash
 * subtracts (drawn as an outline notch), enterprise value is the solid total.
 * Bar fractions are relative to the largest absolute magnitude in the set so
 * the visual reads as share-of-EV without a numeric axis.
 */
export function buildCapStructRows(
  marketCap: number,
  debt: number,
  cash: number,
  ev: number | null,
  zh: boolean,
): CapStructRow[] {
  const enterprise = num(ev) ? (ev as number) : marketCap + debt - cash;
  const base: Omit<CapStructRow, "frac">[] = [
    { key: "mcap", label: pick(zh, "Market cap", "市值"), value: marketCap, color: "var(--brand)", op: "", outline: false },
    { key: "debt", label: pick(zh, "Debt", "债务"), value: debt, color: "var(--warn)", op: "+", outline: false },
    { key: "cash", label: pick(zh, "Cash & equivalents", "现金及等价物"), value: -cash, color: "var(--text-2)", op: "−", outline: true },
    { key: "ev", label: pick(zh, "Enterprise value", "企业价值"), value: enterprise, color: "var(--brand)", op: "=", outline: false },
  ];
  const maxMag = Math.max(1, ...base.map((r) => Math.abs(r.value)));
  return base.map((r) => ({ ...r, frac: Math.min(1, Math.abs(r.value) / maxMag) }));
}

/** Props for {@link CapitalStructure}. */
export interface CapitalStructureProps {
  marketCap: NumOrNull;
  debt: NumOrNull;
  cash: NumOrNull;
  /** Enterprise value. Derived (mktcap + debt − cash) if omitted. */
  ev?: NumOrNull;
  fmtV?: ValFmt;
  zh?: boolean;
}

/**
 * Capital structure bridge: horizontal composition rows —
 * `Market cap` (brand) `+ Debt` (warn) `− Cash` (outline notch) `= Enterprise
 * value` (brand solid). Inline mono value on every bar, full labels left (never
 * truncated), dotted hairline connectors, and an `EV = market cap + debt −
 * cash` explainer. No axis, no directional tokens, no detached legend.
 */
export function CapitalStructure({ marketCap, debt, cash, ev, fmtV = fmtNum, zh }: CapitalStructureProps) {
  if (!num(marketCap)) return <Empty zh={zh} />;
  const mc = marketCap as number;
  const d = num(debt) ? (debt as number) : 0;
  const c = num(cash) ? (cash as number) : 0;
  const rows = buildCapStructRows(mc, d, c, num(ev) ? (ev as number) : null, !!zh);
  return (
    <div className="fin-capbridge">
      {rows.map((r, i) => (
        <div className={"fin-capbridge-row" + (r.key === "ev" ? " is-total" : "")} key={r.key}>
          <span className="fin-capbridge-op" aria-hidden>{r.op}</span>
          <span className="fin-capbridge-lbl">{r.label}</span>
          <span className="fin-capbridge-track">
            {/* dotted connector to the prior row's bar top — pure decoration */}
            {i > 0 && <span className="fin-capbridge-conn" aria-hidden />}
            <span
              className={"fin-capbridge-bar" + (r.outline ? " is-outline" : "")}
              style={r.outline
                ? { width: `${r.frac * 100}%`, borderColor: r.color }
                : { width: `${r.frac * 100}%`, background: r.color }}
            />
          </span>
          <span className="fin-capbridge-val">{fmtV(Math.abs(r.value))}</span>
        </div>
      ))}
      <div className="fin-capbridge-note">{pick(!!zh, "EV = market cap + debt − cash", "企业价值 = 市值 + 债务 − 现金")}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * <YearOverlay> — multi-year normalized paths + slider + Percent/Regular
 * ───────────────────────────────────────────────────────────────────────── */

/** One year's daily/weekly path in a {@link YearOverlay}. */
export interface YearPath {
  /** Year label (e.g. "2026"). */
  year: string;
  /**
   * Per-position values across a shared Jan→Dec horizon. Index maps to the
   * calendar position (0…N-1); use `null` for positions past "now".
   */
  values: NumOrNull[];
  color?: string;
  /** Emphasize (current year) — thicker line + end dot. */
  current?: boolean;
}

/** Props for {@link YearOverlay}. */
export interface YearOverlayProps {
  paths: YearPath[];
  /** x-axis position count (e.g. 252 trading days / 12 months). */
  horizon: number;
  /** Sparse month labels along the x-axis. */
  monthLabels?: string[];
  vw?: number;
  vh?: number;
  zh?: boolean;
  height?: number;
}

/**
 * Seasonality overlay: multiple years' normalized paths on one Jan→Dec horizon,
 * a dotted AVERAGE line, right-edge year+value labels, a year-range slider to
 * add/drop years, and a Percent/Regular normalization toggle. The TV Seasonals
 * chart. `current` year gets an emphasized end dot.
 */
export function YearOverlay({ paths, horizon, monthLabels, vw = 640, vh = 260, zh, height }: YearOverlayProps) {
  const { tip, show, hide } = useFinTip();
  const [pct, setPct] = useState(true);
  const [range, setRange] = useState<[number, number]>(() => [0, Math.max(0, (paths?.length ?? 1) - 1)]);
  const box = useBoxW(vw);
  if (!paths || paths.length === 0 || paths.every((p) => p.values.every((v) => !num(v)))) return <Empty zh={zh} />;
  vw = box.w; vh = height ?? 340;   // viewBox = real px box size → 1:1 scale, no text distortion
  const active = paths.slice(range[0], range[1] + 1);
  // Percent = rebase each path to its first finite value (→ % change); Regular = raw.
  const norm = (vals: NumOrNull[]) => {
    if (!pct) return vals;
    const base = vals.find((v) => num(v)) as number | undefined;
    if (base == null || base === 0) return vals;
    return vals.map((v) => (num(v) ? ((v as number) / base - 1) * 100 : null));
  };
  const normed = active.map((p) => ({ ...p, values: norm(p.values) }));
  // average across active years per position
  const avg: NumOrNull[] = Array.from({ length: horizon }, (_, i) => {
    const xs = normed.map((p) => p.values[i]).filter(num) as number[];
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  });
  const domSeries: Series[] = [...normed.map((p) => ({ name: p.year, values: p.values })), { name: "avg", values: avg }];
  const dom = domain(domSeries, pct);
  const tk = ticks(dom, 4);
  const RPAD = 42;
  const iw = vw - PAD.l - RPAD;
  const ih = vh - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (horizon <= 1 ? 0 : (i / (horizon - 1)) * iw);
  const y = (v: number) => PAD.t + ih - ((v - dom[0]) / (dom[1] - dom[0])) * ih;
  const fmtY = (v: number) => (pct ? fmtPct(v, { decimals: 1, alreadyPct: true, sign: true }) : fmtNum(v));
  const path = (vals: NumOrNull[]) => {
    const pts: string[] = [];
    vals.forEach((v, i) => { if (num(v)) pts.push(`${x(i)},${y(v as number)}`); });
    return pts.join(" ");
  };
  const lastFinite = (vals: NumOrNull[]): [number, number] | null => {
    for (let i = vals.length - 1; i >= 0; i--) if (num(vals[i])) return [i, vals[i] as number];
    return null;
  };
  return (
    <div className="fin-yearoverlay">
      <div className="fin-yo-controls">
        <div className="fin-toggle">
          <button className={pct ? "on" : ""} onClick={() => setPct(true)}>{pick(!!zh, "Percent", "百分比")}</button>
          <button className={!pct ? "on" : ""} onClick={() => setPct(false)}>{pick(!!zh, "Regular", "原始")}</button>
        </div>
        {paths.length > 1 && (
          <div className="fin-slider">
            <span className="fin-slider-lbl">{paths[range[0]].year}–{paths[range[1]].year}</span>
            <input type="range" min={0} max={paths.length - 1} value={range[0]}
              onChange={(e) => setRange(([_, hi]) => [Math.min(+e.target.value, hi), hi])} aria-label={pick(!!zh, "Start year", "起始年")} />
            <input type="range" min={0} max={paths.length - 1} value={range[1]}
              onChange={(e) => setRange(([lo]) => [lo, Math.max(+e.target.value, lo)])} aria-label={pick(!!zh, "End year", "结束年")} />
          </div>
        )}
      </div>
      <div className="fin-chart">
        <div className="fin-svg-box" ref={box.ref} style={{ height: height ?? 340 }}>
        <svg viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none" className="fin-svg" aria-hidden>
          {tk.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "fin-grid fin-grid-0" : "fin-grid"} x1={PAD.l} x2={vw - RPAD} y1={y(t)} y2={y(t)} />
              <text className="fin-axis-y" x={vw - RPAD + 4} y={y(t) + 3}>{fmtY(t)}</text>
            </g>
          ))}
          {/* average dotted */}
          {path(avg) && <polyline className="fin-line fin-line-dotted" points={path(avg)} fill="none" stroke="var(--muted)" />}
          {normed.map((p, i) => {
            const col = p.color ?? PALETTE[i % PALETTE.length];
            const end = lastFinite(p.values);
            return (
              <g key={p.year}>
                <polyline className={"fin-line" + (p.current ? " fin-line-emph" : "")} points={path(p.values)} fill="none" stroke={col} />
                {end && p.current && <circle className="fin-node" cx={x(end[0])} cy={y(end[1])} r={3.2} fill={col} />}
                {end && <text className="fin-yo-endlbl" x={vw - RPAD + 3} y={y(end[1]) - 3} fill={col}>{p.year}</text>}
              </g>
            );
          })}
          {Array.from({ length: horizon }).map((_, i) => (
            <rect key={i} className="fin-hitcol" x={x(i) - iw / (2 * Math.max(1, horizon))} y={PAD.t} width={iw / Math.max(1, horizon)} height={ih} fill="transparent"
              onMouseMove={(e) => show(e, monthLabels && horizon ? `${Math.round((i / horizon) * 100)}%` : String(i),
                normed.map((p, pi) => ({ label: p.year, value: num(p.values[i]) ? fmtY(p.values[i] as number) : "—", color: p.color ?? PALETTE[pi % PALETTE.length] })))}
              onMouseLeave={hide} />
          ))}
        </svg>
        </div>
        {monthLabels && monthLabels.length > 0 && (
          <div className="fin-xaxis">
            {monthLabels.map((m, i) => <span key={i} className="fin-xlbl">{m}</span>)}
          </div>
        )}
        <div className="fin-legend">
          {normed.map((p, i) => (
            <span className="fin-leg" key={p.year}><i className="fin-leg-dot" style={{ background: p.color ?? PALETTE[i % PALETTE.length] }} />{p.year}</span>
          ))}
          <span className="fin-leg"><i className="fin-leg-dot fin-leg-dotted" />{pick(!!zh, "Average", "平均")}</span>
        </div>
      </div>
      <FinTip tip={tip} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * <MiniTable> — metric rows × period cols, sticky first col, expandable rows,
 * green/red change sub-values, blue row highlight, period paging chevrons
 * ───────────────────────────────────────────────────────────────────────── */

/** One row of a {@link MiniTable}. */
export interface MiniRow {
  /** Metric label (sticky first column). */
  label: string;
  /** Values index-aligned to `periods`. */
  values: NumOrNull[];
  /**
   * Optional per-period YoY/QoQ change (percent). Rendered as a green/red
   * sub-value beneath each value when the row is expanded.
   */
  change?: NumOrNull[];
  /** Indent level (nested/child rows under an expandable parent). */
  depth?: number;
  /** Child rows revealed when this row is expanded. */
  children?: MiniRow[];
  /** Emphasize (bold) — e.g. subtotal/total rows. */
  bold?: boolean;
  /** Per-row value formatter override (e.g. ratio vs currency). */
  fmt?: ValFmt;
  /** Optional trailing cell content per period (e.g. a transcript doc-icon). */
  cellAdorn?: (periodIdx: number) => ReactNode;
}

/** Props for {@link MiniTable}. */
export interface MiniTableProps {
  /** Column period labels (oldest→newest or as supplied). */
  periods: string[];
  rows: MiniRow[];
  /** Format values (per-row `fmt` overrides this). Defaults to fmtNum. */
  fmt?: ValFmt;
  /** Show green/red change sub-values under each value. */
  showChange?: boolean;
  /** How many period columns fit before paging chevrons appear. */
  pageSize?: number;
  zh?: boolean;
  /** Sticky-first-column header label. */
  cornerLabel?: string;
}

/**
 * MiniTable — the TV statements/estimates table. Sticky first column, expandable
 * parent rows (children indent), optional green/red change sub-values, a blue
 * highlight on the hovered row, and left/right period-paging chevrons when there
 * are more periods than `pageSize`. Per-cell adornments (e.g. a transcript
 * doc-icon) render via `row.cellAdorn`.
 */
export function MiniTable({ periods, rows, fmt = fmtNum, showChange, pageSize = 6, zh, cornerLabel }: MiniTableProps) {
  // Paging is counted BACKWARD from the newest period (0 = newest page), not forward from
  // index 0. `periods` is oldest→newest, so a forward counter opens on the OLDEST columns —
  // invisible while yfinance supplied ~5 periods (one page), but the Massive backfill takes
  // AAPL to 17 fiscal years / 69 quarters, and landing the reader on 2009 would be wrong.
  // The page is stored WITH the period-set signature it was chosen for, so a different set
  // (A/Q toggle, symbol switch) reads as "newest" in the very render that introduces it —
  // no reset effect, and never a frame showing 2009 before correcting. Keyed on a VALUE
  // signature, not array identity: parents rebuild these arrays on unrelated renders and
  // identity-keying would yank the reader back mid-browse.
  const [paging, setPaging] = useState<{ sig: string; back: number }>({ sig: "", back: 0 });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<string | null>(null);
  const nPeriods = periods?.length ?? 0;
  const setSig = `${nPeriods}:${periods?.[0] ?? ""}:${periods?.[nPeriods - 1] ?? ""}`;
  if (!periods || periods.length === 0 || !rows || rows.length === 0) return <Empty zh={zh} />;
  const pages = Math.ceil(periods.length / pageSize);
  // clamp: a shorter set (e.g. annual→quarterly on a thin name) must not strand the reader
  // past the end.
  const back = paging.sig === setSig ? Math.min(paging.back, pages - 1) : 0;
  const start = (pages - 1 - back) * pageSize;
  const cols = periods.map((p, i) => ({ p, i })).slice(start, start + pageSize);
  const rowKey = (r: MiniRow, path: string) => `${path}/${r.label}`;
  const renderRow = (r: MiniRow, path: string, key: string): ReactNode[] => {
    const rf = r.fmt ?? fmt;
    const hasChildren = !!r.children && r.children.length > 0;
    const isOpen = !!open[key];
    const out: ReactNode[] = [
      <tr key={key} className={"fin-row" + (r.bold ? " fin-row-b" : "") + (hover === key ? " fin-row-hl" : "")}
        onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover((h) => (h === key ? null : h))}>
        <th className="fin-cell fin-cell-sticky" style={{ paddingLeft: 8 + (r.depth ?? 0) * 12 }} scope="row">
          {hasChildren && (
            <button className="fin-row-toggle" onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} aria-expanded={isOpen}>
              {isOpen ? "▾" : "▸"}
            </button>
          )}
          <span>{r.label}</span>
        </th>
        {cols.map(({ i }) => (
          <td key={i} className="fin-cell fin-cell-num">
            <span className="fin-cell-v">{num(r.values[i]) ? rf(r.values[i] as number) : "—"}{r.cellAdorn?.(i)}</span>
            {showChange && r.change && num(r.change[i]) && (
              <span className={"fin-cell-chg " + ((r.change[i] as number) >= 0 ? "up" : "down")}>{fmtPct(r.change[i] as number, { decimals: 1, alreadyPct: true, sign: true })}</span>
            )}
          </td>
        ))}
      </tr>,
    ];
    if (hasChildren && isOpen)
      for (const ch of r.children!) out.push(...renderRow(ch, key, rowKey(ch, key)));
    return out;
  };
  return (
    <div className="fin-table-wrap">
      {pages > 1 && (
        <div className="fin-table-pager">
          <button className="fin-pg-chev" disabled={back >= pages - 1} onClick={() => setPaging({ sig: setSig, back: Math.min(pages - 1, back + 1) })} aria-label={pick(!!zh, "Earlier periods", "较早期")}>‹</button>
          <span className="fin-pg-info">{cols[0]?.p}–{cols[cols.length - 1]?.p}</span>
          <button className="fin-pg-chev" disabled={back <= 0} onClick={() => setPaging({ sig: setSig, back: Math.max(0, back - 1) })} aria-label={pick(!!zh, "Later periods", "较近期")}>›</button>
        </div>
      )}
      <div className="fin-table-scroll">
        <table className="fin-table">
          <thead>
            <tr>
              <th className="fin-cell fin-cell-sticky fin-cell-corner" scope="col">{cornerLabel ?? ""}</th>
              {cols.map(({ p, i }) => <th key={i} className="fin-cell fin-cell-num fin-cell-head" scope="col">{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r) => renderRow(r, "", rowKey(r, "")))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * shared sub-components: XAxis + Legend
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Shared x-axis label row. Two crowding mitigations stack:
 *   1. Width-aware THINNING — given the measured box width (`boxW`), only as many
 *      labels as physically fit (≈`MIN_LABEL_PX` apart) are shown; the rest render
 *      as empty spans so the flex geometry (and thus label centering under each
 *      category slot) is preserved. First + last are ALWAYS kept.
 *   2. Font-shrink — the surviving labels still shrink at higher densities.
 * When thinning alone would leave the axis very sparse (≤4 visible on a dense set),
 * we switch to a rotated variant so more labels fit legibly instead of dropping them.
 */
const MIN_LABEL_PX = 44;   // horizontal budget per straight (centered, non-rotated) label
const MIN_LABEL_PX_ROT = 26;   // rotated labels pack tighter
function XAxis({ labels, small, boxW, rpad }: { labels: string[]; small?: boolean; boxW?: number; rpad?: number }) {
  const n = labels.length;
  // usable width ≈ box minus the y-axis gutter (dynamic rpad when supplied, else ~56px default).
  const gutterPx = rpad != null ? rpad + 8 : 56;
  const usable = Math.max(0, (boxW ?? 0) - gutterPx);
  const maxTicks = boxW ? Math.max(2, Math.floor(usable / MIN_LABEL_PX)) : n;
  const needsThin = n > maxTicks;
  // How many labels survive straight thinning — if too few on a dense axis, rotate.
  const straightVisible = needsThin ? Math.floor((n - 1) / Math.ceil(n / maxTicks)) + 1 : n;
  const maxTicksRot = boxW ? Math.max(2, Math.floor(usable / MIN_LABEL_PX_ROT)) : n;
  const rotate = boxW != null && n > 8 && straightVisible < 4 && n <= maxTicksRot;

  // In rotated mode every label is shown (they fit at ~-35°); otherwise thin.
  // Kept indices are precomputed so the always-kept LAST label can evict a
  // stride-kept neighbor that would jam against it (e.g. n=10, stride=2 kept
  // BOTH 8 and 9 → "Q1 '26Q2 '26" collided at the right edge).
  const kept = new Set<number>();
  if (rotate || !needsThin) {
    for (let i = 0; i < n; i++) kept.add(i);
  } else {
    const stride = Math.ceil(n / maxTicks);
    for (let i = 0; i < n; i += stride) kept.add(i);
    kept.add(n - 1);
    let prev = -1;
    for (const i of kept) if (i !== n - 1 && i > prev) prev = i;
    if (prev > 0 && n - 1 - prev < stride * 0.6) kept.delete(prev);
  }
  const keep = (i: number): boolean => kept.has(i);

  // Auto-shrink the font as labels get crowded so period labels (e.g. "Q2 '26")
  // stay whole instead of being clipped to "Q2 '.." on narrow containers.
  const visibleCount = rotate ? n : labels.filter((_, i) => keep(i)).length;
  const size = small || visibleCount > 8 ? " fin-xaxis-xs" : visibleCount > 5 ? " fin-xaxis-sm" : "";
  // Sync the HTML x-axis right padding to the SVG's right gutter so labels
  // sit under their bars/points. The base CSS rule has 50px; override when rpad
  // is supplied (rpad + 8px breathing room to match the SVG text inset).
  const xAxisStyle = rpad != null ? { paddingRight: rpad + 8 + "px" } : undefined;
  return (
    <div className={"fin-xaxis" + size + (rotate ? " fin-xaxis-rot" : "")} style={xAxisStyle}>
      {labels.map((l, i) => (
        <span key={i} className="fin-xlbl">{keep(i) ? l : ""}</span>
      ))}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="fin-legend">
      {series.filter((s) => s.name && !s.name.startsWith("__")).map((s, i) => (
        <span className="fin-leg" key={s.name + i}><i className="fin-leg-dot" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} />{s.name}</span>
      ))}
    </div>
  );
}

/**
 * WaterfallXAxis — label row for Waterfall charts that avoids overlapping text.
 * Each label is placed under its bar slot centre.  When two adjacent labels
 * would collide (estimated by char-count × approx font width), the even-indexed
 * label is pushed down to a second row, creating a stagger layout.  At very
 * narrow widths where even staggering cannot prevent overlap, long labels are
 * wrapped at a space to reduce their rendered width.
 */
function WaterfallXAxis({ labels, boxW, rpad }: { labels: string[]; boxW?: number; rpad?: number }) {
  const n = labels.length;
  const gutterPx = rpad != null ? rpad + 8 : 56;
  const usable = Math.max(1, (boxW ?? 320) - gutterPx);
  const slotPx = usable / Math.max(1, n);
  // Approximate rendered label width. CONSERVATIVE 7px/char latin: the ≤860px
  // media floor bumps this axis to a 10px font (~6.7px/char) and the old
  // 6px/char estimate under-detected collisions there — labels like
  // "Op expenses" / "Non-op & others" jammed into one unreadable run on real
  // devices. CJK glyphs render full-em (~11px at that floor): without the
  // wider estimate zh labels like 营业费用/营业利润 both ellipsized to 营业…
  const CJK_RE = /[⺀-鿿　-ヿ豈-﫿＀-￯]/;
  const labelPx = (lbl: string) => { let w = 0; for (const ch of lbl) w += CJK_RE.test(ch) ? 11 : 7; return w; };
  // Detect collision between adjacent pair assuming each is centred in its slot
  const collides = (a: string, b: string) => (labelPx(a) + labelPx(b)) / 2 > slotPx * 0.95;
  // Check if ANY adjacent pair collides → need stagger
  const needsStagger = labels.some((lbl, i) => i > 0 && collides(labels[i - 1], lbl));
  // Wrap any label wider than its slot at a space near the midpoint —
  // independent of stagger (a lone long label like "Enterprise value" can
  // overflow its slot even when no adjacent PAIR collides). CJK labels carry
  // no spaces but may break anywhere: split at the midpoint (营业外及其他 →
  // 营业外 / 及其他) instead of falling through to the ellipsis clamp.
  const wrap = (lbl: string): string[] => {
    if (labelPx(lbl) <= slotPx * 1.05) return [lbl];
    const mid = Math.floor(lbl.length / 2);
    const sp = lbl.lastIndexOf(" ", mid);
    const sp2 = lbl.indexOf(" ", mid);
    const cut = sp > 0 ? sp : sp2 > 0 ? sp2 : -1;
    if (cut >= 0) return [lbl.slice(0, cut), lbl.slice(cut + 1)];
    const chars = [...lbl];
    if (chars.length >= 4 && CJK_RE.test(lbl)) {
      const half = Math.ceil(chars.length / 2);
      return [chars.slice(0, half).join(""), chars.slice(half).join("")];
    }
    return [lbl];
  };
  return (
    <div className={"fin-wf-xaxis fin-xaxis-xs"} style={{ paddingRight: gutterPx + "px" }}>
      {labels.map((lbl, i) => {
        const staggerDown = needsStagger && i % 2 === 1;
        // Always render lines as .fin-wf-lline spans — the CSS clamps each line
        // to its slot (overflow:hidden + ellipsis) so a mis-estimated width can
        // never bleed into the neighboring label again.
        const lines = wrap(lbl);
        return (
          <span
            key={i}
            className={"fin-xlbl fin-wf-xlbl" + (staggerDown ? " fin-wf-xlbl-lo" : "")}
          >
            {lines.map((ln, li) => <span key={li} className="fin-wf-lline" title={lines.length > 1 || labelPx(lbl) > slotPx ? lbl : undefined}>{ln}</span>)}
          </span>
        );
      })}
    </div>
  );
}
