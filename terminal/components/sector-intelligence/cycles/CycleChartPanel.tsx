"use client";
import { useRef } from "react";
import {
  MIN_CHART_H,
  fmtTick,
  niceTicks,
  padDomain,
  thinLabels,
  useChartWidth,
} from "@/components/charts/svgChart";
import { formatValue, type SectorRotationHistoryCycleTurn } from "@/lib/sectorIntelligence";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import type { OscPoint } from "@/lib/sectorCycleRecord";
import s from "../SectorCycleLens.module.css";

/* The donor #1249 chart drew a fixed 600×132 viewBox with
 * preserveAspectRatio="none" — a distortion defect. This panel is the repair:
 * a measured 1:1 pixel-space chart on the shared svgChart helpers (R1–R7),
 * where valid zero and negative relative values survive, with an exact-value
 * table always one toggle away. The oscillator's own 0–100 history keeps its
 * decimal-year source coordinates and is disclosed as an exact-values table —
 * the two measures never share a scale. */

export interface CycleSeriesData {
  subjectId: string;
  label: string;
  /** Measurement basis for the pill; null when not a return series. */
  basis: "price" | "tr" | null;
  points: { date: string; t: number; value: number }[];
}

export interface CycleChartPanelProps {
  series: CycleSeriesData[];
  turns: SectorRotationHistoryCycleTurn[];
  osc: OscPoint[] | null;
  range: [number, number] | null;
  rangeLimit: number;
  onRangeLimit: (limit: number) => void;
  scale: "linear" | "log";
  onScale: (scale: "linear" | "log") => void;
  cursor: string | null;
  onCursor: (date: string | null) => void;
  view: "chart" | "table";
  onView: (view: "chart" | "table") => void;
  onOpenSeriesPicker: () => void;
  valuesOpen: boolean;
  onValuesOpen: (open: boolean) => void;
  valuesOffset: number;
  onValuesOffset: (offset: number) => void;
  benchmark: string;
}

const DAY_MS = 86_400_000;
const GAP_DAYS = 4;
const stamp = (d: string) => Date.parse(d + "T00:00:00Z");

export default function CycleChartPanel(props: CycleChartPanelProps) {
  const t = useSectorCycleT();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const w = useChartWidth(wrapRef);
  const h = MIN_CHART_H.axis;
  const padL = 46, padR = 12, padT = 14, padB = 24;

  const active = props.series.filter((x) => x.points.length > 0);
  const all = active.flatMap((x) => x.points);
  const tExtent: [number, number] =
    all.length > 0
      ? [Math.min(...all.map((p) => p.t)), Math.max(...all.map((p) => p.t))]
      : [0, 1];
  const domain: [number, number] = props.range ?? tExtent;
  const inWindow = (p: { t: number }) =>
    p.t >= domain[0] - DAY_MS / 2 && p.t <= domain[1] + DAY_MS / 2;
  const shown = active
    .map((x) => ({ ...x, points: x.points.filter(inWindow) }))
    .filter((x) => x.points.length > 0);

  const values = shown.flatMap((x) => x.points.map((p) => p.value));
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const straddle = lo < 0 && hi > 0;
  const canLog = values.length > 0 && values.every((v) => v > 0);
  const logScale = props.scale === "log" && canLog;
  const tf = (v: number) => (logScale ? Math.log10(v) : v);
  const [y0, y1] = padDomain(tf(lo), tf(hi), {
    includeZero: straddle && !logScale,
    padFrac: 0.12,
  });
  const ticks = niceTicks(y0, y1, 4);
  const y = (v: number) =>
    padT + (h - padT - padB) * (1 - (tf(v) - y0) / Math.max(1e-9, y1 - y0));
  const x = (t0: number) =>
    all.length > 0
      ? padL + ((t0 - domain[0]) / Math.max(1, domain[1] - domain[0])) * (w - padL - padR)
      : (w + padL) / 2;

  const dates = Array.from(
    new Set(shown.flatMap((x) => x.points.map((p) => p.date))),
  ).sort();
  const cursorDate =
    props.cursor && dates.includes(props.cursor)
      ? props.cursor
      : (dates[dates.length - 1] ?? null);
  const cursorPoint = cursorDate
    ? shown
        .map((x) => ({ label: x.label, p: x.points.find((q) => q.date === cursorDate) }))
        .filter((r) => r.p)
    : [];
  const cursorT = cursorDate
    ? (shown[0]?.points.find((p) => p.date === cursorDate)?.t ?? null)
    : null;

  const path = (points: { t: number; value: number }[]) => {
    let d = "", open = false, prev: number | null = null;
    for (const p of points) {
      if (prev !== null && p.t - prev > GAP_DAYS * DAY_MS) open = false;
      d += `${open ? "L" : "M"}${x(p.t).toFixed(2)} ${y(p.value).toFixed(2)}`;
      open = true;
      prev = p.t;
    }
    return d;
  };

  const labelDates = thinLabels(dates, (d) => x(stamp(d) || 0), 64);
  const fmtSeries = (v: number) => formatValue(v, 1, "%", true);
  const chartLabel = t("scChartTitle", { bench: props.benchmark });

  return (
    <section className={s.plotCard} data-testid="cycle-chart-panel">
      <div className={s.tools}>
        <h3>{chartLabel}</h3>
        <div className={s.toggle} role="group" aria-label={chartLabel}>
          <button type="button" aria-pressed={props.view === "chart"} onClick={() => props.onView("chart")}>
            {t("scChart")}
          </button>
          <button type="button" aria-pressed={props.view === "table"} onClick={() => props.onView("table")}>
            {t("scTable")}
          </button>
        </div>
      </div>

      <div className={s.controls}>
        <label>
          {t("scChartRange")}
          <select
            value={props.rangeLimit}
            onChange={(e) => props.onRangeLimit(Number(e.target.value))}
          >
            <option value={21}>{t("scRange1m")}</option>
            <option value={63}>{t("scRange3m")}</option>
            <option value={252}>{t("scRange1y")}</option>
            <option value={0}>{t("scRangeAll")}</option>
          </select>
        </label>
        <label>
          {t("scScale")}
          <select
            value={logScale ? "log" : "linear"}
            aria-describedby={canLog ? undefined : "sc-scale-note"}
            onChange={(e) => props.onScale(e.target.value as "linear" | "log")}
          >
            <option value="linear">{t("scScaleLinear")}</option>
            <option value="log" disabled={!canLog}>
              {t("scScaleLog")}
            </option>
          </select>
        </label>
        <button
          type="button"
          className={s.pickerButton}
          onClick={props.onOpenSeriesPicker}
          aria-haspopup="dialog"
        >
          {t("scSeries")}
          <span aria-hidden="true">＋</span>
        </button>
      </div>
      {!canLog && props.scale === "log" && (
        <p className={s.note} id="sc-scale-note" role="status">
          {t("scScaleLogUnavailable")}
        </p>
      )}

      <div className={s.legend}>
        {active.map((x) => (
          <span
            key={x.subjectId + x.label}
            className={x === active[0] ? s.legendA : x === active[1] ? s.legendB : s.legendC}
          >
            <span className={s.swatch} aria-hidden="true" />
            {x.label}
            {x.basis && (
              <span className={s.basisPill}>
                {t(x.basis === "price" ? "scBasisPillPrice" : "scBasisPillTr")}
              </span>
            )}
          </span>
        ))}
      </div>

      {shown.length === 0 || !cursorDate ? (
        <p role="status">{t("scNoHistory")}</p>
      ) : props.view === "table" ? (
        <div className={s.scrollTable}>
          <table>
            <caption>{chartLabel}</caption>
            <thead>
              <tr>
                <th>{t("scObservationDate")}</th>
                {shown.map((x) => (
                  <th key={x.subjectId + x.label} scope="col">
                    {x.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...dates].reverse().map((date) => (
                <tr key={date}>
                  <th scope="row">{date}</th>
                  {shown.map((x) => {
                    const point = x.points.find((p) => p.date === date);
                    return (
                      <td key={x.subjectId + x.label}>
                        {point ? fmtSeries(point.value) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className={s.metrics} data-testid="cycle-observation" aria-live="polite">
            {cursorPoint.map((r) => (
              <div key={r.label}>
                <span>{r.label}</span>
                <strong>{fmtSeries(r.p!.value)}</strong>
              </div>
            ))}
            <time dateTime={cursorDate}>{cursorDate}</time>
          </div>
          <div ref={wrapRef} className={s.graphWrap}>
            <svg
              viewBox={`0 0 ${w} ${h}`}
              width={w}
              height={h}
              role="img"
              aria-label={chartLabel}
            >
              {ticks.values.map((v) => {
                const value = logScale ? Math.pow(10, v) : v;
                return (
                  <g key={v}>
                    <line
                      x1={padL}
                      x2={w - padR}
                      y1={y(value)}
                      y2={y(value)}
                      className={s.grid}
                    />
                    <text
                      x={padL - 6}
                      y={y(value) + 3.5}
                      textAnchor="end"
                      className={s.tickLabel}
                    >
                      {logScale
                        ? formatValue(value, value >= 10 ? 0 : 1)
                        : fmtTick(v, ticks.step)}
                    </text>
                  </g>
                );
              })}
              {straddle && !logScale && (
                <line x1={padL} x2={w - padR} y1={y(0)} y2={y(0)} className={s.zeroLine} />
              )}
              {shown.map((x, i) => (
                <path
                  key={x.subjectId + x.label}
                  d={path(x.points)}
                  className={i === 0 ? s.lineA : i === 1 ? s.lineB : s.lineC}
                />
              ))}
              {props.turns.map((turn) => {
                const t0 = stamp(turn.date);
                if (!Number.isFinite(t0) || t0 < domain[0] || t0 > domain[1]) return null;
                const cx = x(t0);
                return (
                  <g
                    key={turn.date + turn.kind}
                    className={turn.provisional ? s.turnProv : s.turnConfirmed}
                  >
                    <title>{`${turn.date} · ${turn.kind}${turn.provisional ? " · " + t("scProvisional") : ""}`}</title>
                    <path
                      d={
                        turn.kind === "peak"
                          ? `M${cx - 4} ${padT + 4} L${cx} ${padT - 2} L${cx + 4} ${padT + 4} Z`
                          : `M${cx - 4} ${padT + 8} L${cx} ${padT + 2} L${cx + 4} ${padT + 8} Z`
                      }
                    />
                  </g>
                );
              })}
              {cursorT !== null && (
                <line
                  x1={x(cursorT)}
                  x2={x(cursorT)}
                  y1={padT - 4}
                  y2={h - padB}
                  className={s.cursor}
                />
              )}
              {cursorPoint.map((r, i) =>
                r.p ? (
                  <circle
                    key={r.label}
                    cx={x(r.p.t)}
                    cy={y(r.p.value)}
                    r={3}
                    className={i === 0 ? s.dotA : s.dotB}
                  />
                ) : null,
              )}
              {labelDates.map((d) => (
                <text
                  key={d}
                  x={x(stamp(d))}
                  y={h - 6}
                  textAnchor="middle"
                  className={s.tickLabel}
                >
                  {d}
                </text>
              ))}
            </svg>
          </div>
          <input
            aria-label={t("scObservationDate")}
            aria-valuetext={cursorDate}
            type="range"
            min={0}
            max={Math.max(0, dates.length - 1)}
            step={1}
            disabled={dates.length < 2}
            value={Math.max(0, dates.indexOf(cursorDate))}
            onChange={(e) => props.onCursor(dates[Number(e.target.value)] ?? null)}
          />
          <div className={s.dates}>
            <span>{dates[0]}</span>
            <span>{dates[dates.length - 1]}</span>
          </div>
        </>
      )}

      <div className={s.turns}>
        <h4>{t("scTurns")}</h4>
        {(() => {
          const list = props.turns
            .filter((v) => {
              const t0 = stamp(v.date);
              return Number.isFinite(t0) && t0 >= domain[0] && (!cursorDate || v.date <= cursorDate);
            })
            .slice(-3)
            .reverse();
          return list.length ? (
            list.map((v) => (
              <div key={v.date + v.kind}>
                <time>{v.date}</time> <b>{t(v.kind === "peak" ? "scPeak" : "scTrough")}</b>{" "}
                {v.provisional ? <em>{t("scProvisional")}</em> : <em>{t("scConfirmed")}</em>}
              </div>
            ))
          ) : (
            <span>{t("scNoTurns")}</span>
          );
        })()}
      </div>

      {props.osc && props.osc.length > 1 && (
        <details
          className={s.values}
          open={props.valuesOpen}
          onToggle={(e) => props.onValuesOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>{t("scExactValues")}</summary>
          <p className={s.note}>{t("scOscExactNote")}</p>
          <OscTable
            rows={props.osc}
            offset={props.valuesOffset}
            onOffset={props.onValuesOffset}
          />
        </details>
      )}

      <details>
        <summary>{t("scCompareMore")}</summary>
        <p className={s.note}>{t("scChartNote", { bench: props.benchmark })}</p>
        <p className={s.note}>{t("scReconBody")}</p>
      </details>
    </section>
  );
}

function OscTable({
  rows,
  offset,
  onOffset,
}: {
  rows: OscPoint[];
  offset: number;
  onOffset: (offset: number) => void;
}) {
  const t = useSectorCycleT();
  const page = 50;
  const lastPage = Math.floor((rows.length - 1) / page) * page;
  const start = Math.min(offset, lastPage);
  return (
    <>
      {rows.length > page && (
        <div className={s.pager}>
          <button
            type="button"
            disabled={start === 0}
            onClick={() => onOffset(Math.max(0, start - page))}
          >
            {t("scPrevious")}
          </button>
          <button
            type="button"
            disabled={start + page >= rows.length}
            onClick={() => onOffset(Math.min(lastPage, start + page))}
          >
            {t("scNext")}
          </button>
        </div>
      )}
      <div className={s.scrollTable}>
        <table>
          <thead>
            <tr>
              <th>{t("scAsOf")}</th>
              <th>{t("scOscSeries")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(start, start + page).map((p) => (
              <tr key={p.x}>
                <th scope="row">{p.x}</th>
                <td>{formatValue(p.value, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.note} aria-live="polite">
        {t("scShowing")} {start + 1}–{Math.min(start + page, rows.length)} {t("scOf")}{" "}
        {rows.length} {t("scPoints")}
      </p>
    </>
  );
}
