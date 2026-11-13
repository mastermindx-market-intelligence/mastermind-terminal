"use client";
/**
 * evaluationCharts.tsx — the inline-SVG charts of the Strategy Evaluation
 * surface, built on the shared svgChart primitives (chart law: 1:1 measured
 * viewBox, niceTicks, thinLabels-legal pixel spacing, never
 * preserveAspectRatio="none").
 *
 * All charts are descriptive only. The forest plot draws intervals exactly as
 * published — point estimates stay small (a 3px hollow circle), the zero line
 * is the visual anchor, and a row whose interval spans zero gets the NEUTRAL
 * colour, never a win-implying one. Numbers live in the adjacent tables; each
 * chart's aria-label points at its table alternative.
 */
import { useRef } from "react";
import { MIN_CHART_H, niceTicks, useChartWidth } from "@/components/charts/svgChart";

export interface ForestRow {
  key: string;
  label: string;
  point: number;
  lo: number;
  hi: number;
  includesZero: boolean;
}

/** Tick label for a fraction axis shown in pp: precision derives from the STEP
 * (chart law R5) so adjacent ticks can never render identical. */
function fmtTickPp(value: number, step: number): string {
  const dp = step >= 0.01 ? 0 : step >= 0.001 ? 1 : 2;
  return (value * 100).toFixed(dp);
}

export function ForestPlot({ rows, ariaLabel }: { rows: ForestRow[]; ariaLabel: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const w = useChartWidth(wrapRef);
  if (rows.length === 0) return <div ref={wrapRef} className="pev-chart-wrap" />;
  // D12/E1+E2 (extended to this chart): below 430px the end-anchored side
  // labels physically render at negative x (the longest strategy name is wider
  // than the old 124px column — "Simple participation rule" lost its first
  // letters off the SVG's left edge), so narrow widths stack each label on its
  // own line above its row, exactly like PlaceboRangeChart. The x-domain is
  // padded 7% both sides so the extreme band never touches the plot edge, and
  // the axis carries its unit ("pp") in a right gutter.
  const stacked = w < 430;
  const labelW = stacked ? 0 : w >= 620 ? 200 : 156;
  const rowH = stacked ? 44 : 30;
  const padTop = 6;
  const axisH = 26;
  const h = stacked
    ? rows.length * rowH + padTop + axisH
    : Math.max(MIN_CHART_H.axis, rows.length * rowH + padTop + axisH);
  const plotL = stacked ? 10 : labelW + 8;
  const unitW = 30;
  const plotR = w - 12 - unitW;
  const lo = Math.min(0, ...rows.map(r => r.lo));
  const hi = Math.max(0, ...rows.map(r => r.hi));
  const span = hi - lo || 1;
  const x = (v: number) => plotL + ((v - (lo - span * 0.07)) / (span * 1.14)) * (plotR - plotL);
  const { values: ticks, step } = niceTicks(lo - span * 0.07, hi + span * 0.07,
    Math.max(3, Math.min(6, Math.floor((plotR - plotL) / 90))));
  const zeroX = x(0);
  return (
    <div ref={wrapRef} className="pev-chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={ariaLabel} className="pev-forest">
        {/* Zero line — the anchor of the whole chart. */}
        <line x1={zeroX} y1={padTop} x2={zeroX} y2={h - axisH} className="pev-forest-zero" />
        {rows.map((row, i) => {
          const rowTop = padTop + i * rowH;
          const cy = stacked ? rowTop + 30 : rowTop + rowH / 2;
          const cls = row.includesZero ? "pev-ci-neutral" : row.lo > 0 ? "pev-ci-pos" : "pev-ci-neg";
          return (
            <g key={row.key}>
              <text x={stacked ? plotL : labelW} y={stacked ? rowTop + 11 : cy} textAnchor={stacked ? "start" : "end"} className="pev-forest-lbl">{row.label}</text>
              <line x1={x(row.lo)} y1={cy} x2={x(row.hi)} y2={cy} className={cls} strokeWidth={2} />
              <line x1={x(row.lo)} y1={cy - 4} x2={x(row.lo)} y2={cy + 4} className={cls} strokeWidth={2} />
              <line x1={x(row.hi)} y1={cy - 4} x2={x(row.hi)} y2={cy + 4} className={cls} strokeWidth={2} />
              <circle cx={x(row.point)} cy={cy} r={3} className={`${cls} pev-ci-point`} />
            </g>
          );
        })}
        <line x1={plotL} y1={h - axisH} x2={plotR} y2={h - axisH} className="pev-forest-axis" />
        {ticks.map(t => (
          <g key={t}>
            <line x1={x(t)} y1={h - axisH} x2={x(t)} y2={h - axisH + 4} className="pev-forest-axis" />
            <text x={x(t)} y={h - 8} textAnchor="middle" className="pev-forest-tick">{fmtTickPp(t, step)}</text>
          </g>
        ))}
        <text x={w - 12} y={h - 8} textAnchor="end" className="pev-forest-tick">pp</text>
      </svg>
    </div>
  );
}

export interface WaterfallBar {
  key: string;
  label: string;
  /** Fraction on the wire; the caller maps bridge legs → bars. */
  value: number;
  kind: "base" | "delta" | "total";
}

/** Sequential waterfall: base bar, floating delta bars, total bar. Values are
 * drawn exactly as published (labels carry the number); the y-domain unions
 * zero and pads (chart law R7). */
export function WaterfallChart({ bars, ariaLabel }: { bars: WaterfallBar[]; ariaLabel: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const w = useChartWidth(wrapRef);
  if (bars.length === 0) return <div ref={wrapRef} className="pev-chart-wrap" />;
  const n = bars.length;
  const padL = 10, padR = 10, padT = 22, axisH = 26;
  const h = Math.max(MIN_CHART_H.axis, 240);
  const plotW = w - padL - padR;
  const slot = plotW / n;
  const barW = Math.min(52, slot * 0.6);
  // Cumulative walk mirrors the published bridge identity exactly; the running
  // level travels as the reduce accumulator (base resets it, total re-anchors
  // at the published sum, deltas stack on top).
  const steps = bars.reduce<Array<{ bar: WaterfallBar; from: number; to: number; cum: number }>>(
    (acc, bar) => {
      const cum = acc.length > 0 ? acc[acc.length - 1].cum : 0;
      if (bar.kind === "base") return [...acc, { bar, from: 0, to: bar.value, cum: bar.value }];
      if (bar.kind === "total") return [...acc, { bar, from: 0, to: bar.value, cum: bar.value }];
      return [...acc, { bar, from: cum, to: cum + bar.value, cum: cum + bar.value }];
    }, []);
  const lo = Math.min(0, ...steps.map(s => Math.min(s.from, s.to)));
  const hi = Math.max(0, ...steps.map(s => Math.max(s.from, s.to)));
  const span = (hi - lo) || Math.max(Math.abs(hi), Math.abs(lo), 1e-9);
  const plotH = h - padT - axisH;
  const y = (v: number) => padT + ((hi - v) / span) * plotH;
  return (
    <div ref={wrapRef} className="pev-chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={ariaLabel} className="pev-waterfall">
        <line x1={padL} y1={y(0)} x2={w - padR} y2={y(0)} className="pev-forest-axis" />
        {steps.map((step, i) => {
          const cx = padL + slot * i + slot / 2;
          const top = Math.min(y(step.from), y(step.to));
          const bottom = Math.max(y(step.from), y(step.to));
          const barH = Math.max(bottom - top, 1.5);
          const cls = step.bar.kind === "delta"
            ? (step.bar.value >= 0 ? "pev-wf-pos" : "pev-wf-neg")
            : "pev-wf-total";
          const labelY = step.bar.value >= 0 || step.bar.kind !== "delta" ? top - 6 : bottom + 14;
          return (
            <g key={step.bar.key}>
              <rect x={cx - barW / 2} y={top} width={barW} height={barH} className={cls} rx={2} />
              <text x={cx} y={labelY} textAnchor="middle" className="pev-wf-val">
                {`${step.bar.value >= 0 ? "+" : ""}${(step.bar.value * 100).toFixed(step.bar.kind === "delta" && Math.abs(step.bar.value) < 0.0005 ? 2 : 1)}`}
              </text>
              <text x={cx} y={h - 10} textAnchor="middle" className="pev-forest-lbl">{step.bar.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export interface PlaceboRangeRow {
  key: string;
  label: string;
  /** Middle 95% of the random-member draws (fraction on the wire). */
  bandLo: number;
  bandHi: number;
  /** The picks' observed leg versus the sector ETF (fraction). */
  point: number;
}

/** One row per horizon on a shared pp axis: where random same-sector members
 * landed (band), zero (the anchor line), and the picks (mark). Descriptive
 * only — the numbers live in the adjacent text rows; aria-label points there.
 * The band is NEUTRAL by law (it is a distribution, not a result); the mark is
 * the plain text colour, never a win/loss colour, because outside-vs-inside
 * the band is the artifact's statement, not ours.
 *
 * D12 chart law (E1/E2): the x-domain is padded on both sides so every mark
 * and band keeps clear space from the plot edges (a mark at the data maximum
 * never touches the axis edge again); the axis carries its unit (pp) in a
 * right gutter; the height is exactly the rows plus the axis — no filler band
 * below; and under 620px each row label sits on its own line ABOVE its row
 * (the beside-the-row label column cuts long "N sessions later (n plans)"
 * labels at the left on phones). */
export function PlaceboRangeChart({ rows, ariaLabel }: { rows: PlaceboRangeRow[]; ariaLabel: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const w = useChartWidth(wrapRef);
  if (rows.length === 0) return <div ref={wrapRef} className="pev-chart-wrap" />;
  // Stacked labels below 620px: the side-label column cannot hold the full
  // "42 sessions later (414 plans)" text without cutting it at the left.
  const stacked = w < 620;
  const labelW = stacked ? 0 : 200;
  const rowH = stacked ? 46 : 34;
  const bandH = 16;
  const padTop = 8;
  const axisH = 26;
  const h = rows.length * rowH + padTop + axisH;
  const plotL = stacked ? 10 : labelW + 8;
  const unitW = 30;
  const plotR = w - 12 - unitW;
  // The data domain unions every row's band AND mark, plus zero — a mark
  // outside its band must stay inside the plot (that outside-ness is the
  // whole finding) — then pads 7% on both sides so extremes keep clear air.
  const dataLo = Math.min(0, ...rows.map(r => Math.min(r.bandLo, r.point)));
  const dataHi = Math.max(0, ...rows.map(r => Math.max(r.bandHi, r.point)));
  const span = dataHi - dataLo || 1;
  const lo = dataLo - span * 0.07;
  const hi = dataHi + span * 0.07;
  const x = (v: number) => plotL + ((v - lo) / (hi - lo)) * (plotR - plotL);
  const { values: ticks, step } = niceTicks(lo, hi,
    Math.max(3, Math.min(6, Math.floor((plotR - plotL) / 90))));
  const zeroX = x(0);
  return (
    <div ref={wrapRef} className="pev-chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={ariaLabel} className="pev-range">
        {/* Zero line — the anchor of the whole chart. */}
        <line x1={zeroX} y1={padTop} x2={zeroX} y2={h - axisH} className="pev-forest-zero" />
        {rows.map((row, i) => {
          const rowTop = padTop + i * rowH;
          const cy = stacked ? rowTop + 32 : rowTop + rowH / 2;
          return (
            <g key={row.key}>
              <text
                x={stacked ? plotL : labelW}
                y={stacked ? rowTop + 11 : cy}
                textAnchor={stacked ? "start" : "end"}
                className="pev-forest-lbl"
              >{row.label}</text>
              <rect
                x={x(row.bandLo)} y={cy - bandH / 2}
                width={Math.max(x(row.bandHi) - x(row.bandLo), 2)} height={bandH} rx={3}
                className="pev-range-band"
              />
              <circle cx={x(row.point)} cy={cy} r={4} className="pev-range-mark" />
            </g>
          );
        })}
        <line x1={plotL} y1={h - axisH} x2={plotR} y2={h - axisH} className="pev-forest-axis" />
        {ticks.map(t => (
          <g key={t}>
            <line x1={x(t)} y1={h - axisH} x2={x(t)} y2={h - axisH + 4} className="pev-forest-axis" />
            <text x={x(t)} y={h - 8} textAnchor="middle" className="pev-forest-tick">{fmtTickPp(t, step)}</text>
          </g>
        ))}
        {/* The axis unit, in its own gutter past the last tick. */}
        <text x={w - 12} y={h - 8} textAnchor="end" className="pev-forest-tick">pp</text>
      </svg>
    </div>
  );
}
