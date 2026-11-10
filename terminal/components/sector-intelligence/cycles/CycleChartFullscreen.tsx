"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  MIN_CHART_H,
  fmtTick,
  niceTicks,
  padDomain,
  useChartWidth,
} from "@/components/charts/svgChart";
import { formatValue, type SectorRotationHistoryCycleTurn } from "@/lib/sectorIntelligence";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import type { CycleSeriesData } from "./CycleChartPanel";
import s from "../SectorCycleLens.module.css";

/* Landscape/fullscreen chart (844×486, R3 2V3-0): the full-width measured
 * chart with a pointer/keyboard crosshair, exact values bottom-left, ✕ close
 * top-right. Escape closes; focus returns to the opener. Same svgChart law as
 * the inline panel — measured pixel-space viewBox, no distortion. */

const DAY_MS = 86_400_000;
const GAP_DAYS = 4;
const stamp = (d: string) => Date.parse(d + "T00:00:00Z");

export interface CycleChartFullscreenProps {
  open: boolean;
  onClose: () => void;
  series: CycleSeriesData[];
  turns: SectorRotationHistoryCycleTurn[];
  range: [number, number] | null;
  scale: "linear" | "log";
  cursor: string | null;
  onCursor: (date: string | null) => void;
  benchmark: string;
}

export default function CycleChartFullscreen(props: CycleChartFullscreenProps) {
  const t = useSectorCycleT();
  const { open, onClose } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const w = useChartWidth(wrapRef, 320);
  const [h, setH] = useState(300);
  const openerRef = useRef<Element | null>(null);
  const [labelId] = useState(() => "cycle-fs-" + Math.random().toString(36).slice(2, 8));

  useLayoutEffect(() => {
    if (!props.open) return;
    const el = wrapRef.current;
    const measure = () => {
      const nh = el ? el.clientHeight : 0;
      if (nh > 0) setH(nh);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [props.open]);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    wrapRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const active = props.series.filter((x) => x.points.length > 0);
  const all = active.flatMap((x) => x.points);
  const tExtent: [number, number] =
    all.length > 0
      ? [Math.min(...all.map((p) => p.t)), Math.max(...all.map((p) => p.t))]
      : [0, 1];
  const domain: [number, number] = props.range ?? tExtent;
  const shown = active
    .map((x) => ({ ...x, points: x.points.filter((p) => p.t >= domain[0] - DAY_MS / 2 && p.t <= domain[1] + DAY_MS / 2) }))
    .filter((x) => x.points.length > 0);
  const dates = Array.from(new Set(shown.flatMap((x) => x.points.map((p) => p.date)))).sort();

  const values = shown.flatMap((x) => x.points.map((p) => p.value));
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const straddle = lo < 0 && hi > 0;
  const canLog = values.length > 0 && values.every((v) => v > 0);
  const logScale = props.scale === "log" && canLog;
  const tf = (v: number) => (logScale ? Math.log10(v) : v);
  const [y0, y1] = padDomain(tf(lo), tf(hi), { includeZero: straddle && !logScale, padFrac: 0.1 });
  const ticks = niceTicks(y0, y1, 5);
  const chartH = Math.max(MIN_CHART_H.axis, h);
  const padL = 46, padR = 12, padT = 16, padB = 26;
  const y = (v: number) => padT + (chartH - padT - padB) * (1 - (tf(v) - y0) / Math.max(1e-9, y1 - y0));
  const x = (t0: number) =>
    all.length > 0 ? padL + ((t0 - domain[0]) / Math.max(1, domain[1] - domain[0])) * (w - padL - padR) : (w + padL) / 2;

  const cursorDate =
    props.cursor && dates.includes(props.cursor) ? props.cursor : (dates[dates.length - 1] ?? null);
  const cursorPoints = cursorDate
    ? shown
        .map((x2) => ({ label: x2.label, p: x2.points.find((q) => q.date === cursorDate) }))
        .filter((r): r is { label: string; p: { date: string; t: number; value: number } } => Boolean(r.p))
    : [];

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

  const nearestDate = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || dates.length === 0) return null;
    const px = clientX - rect.left;
    let best: string | null = null, bestDist = Infinity;
    for (const d of dates) {
      const dist = Math.abs(x(stamp(d) || 0) - px);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (dates.length === 0) return;
    const idx = cursorDate ? dates.indexOf(cursorDate) : dates.length - 1;
    if (e.key === "ArrowLeft" || e.key === "Home") {
      e.preventDefault();
      props.onCursor(dates[Math.max(0, e.key === "Home" ? 0 : idx - 1)] ?? null);
    } else if (e.key === "ArrowRight" || e.key === "End") {
      e.preventDefault();
      props.onCursor(dates[Math.min(dates.length - 1, e.key === "End" ? dates.length - 1 : idx + 1)] ?? null);
    }
  };

  const chartLabel = t("scChartTitle", { bench: props.benchmark });
  const fmtSeries = (v: number) => formatValue(v, 1, "%", true);

  return (
    <div className={s.fullscreenScrim}>
      <div
        ref={wrapRef}
        className={s.fullscreenStage}
        role="dialog"
        aria-modal="true"
        aria-label={t("scFullscreen")}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className={s.fullscreenTop}>
          <p id={labelId}>{chartLabel}</p>
          <button type="button" onClick={props.onClose} aria-label={t("scCloseFullscreen")}>
            ✕
          </button>
        </div>
        {shown.length === 0 || !cursorDate ? (
          <p role="status">{t("scNoHistory")}</p>
        ) : (
          <svg
            viewBox={`0 0 ${w} ${chartH}`}
            width={w}
            height={chartH}
            role="img"
            aria-labelledby={labelId}
            onPointerMove={(e) => {
              const d = nearestDate(e.clientX);
              if (d && d !== cursorDate) props.onCursor(d);
            }}
          >
            {ticks.values.map((v) => {
              const value = logScale ? Math.pow(10, v) : v;
              return (
                <g key={v}>
                  <line x1={padL} x2={w - padR} y1={y(value)} y2={y(value)} className={s.grid} />
                  <text x={padL - 6} y={y(value) + 3.5} textAnchor="end" className={s.tickLabel}>
                    {logScale ? formatValue(value, value >= 10 ? 0 : 1) : fmtTick(v, ticks.step)}
                  </text>
                </g>
              );
            })}
            {straddle && !logScale && (
              <line x1={padL} x2={w - padR} y1={y(0)} y2={y(0)} className={s.zeroLine} />
            )}
            {shown.map((x2, i) => (
              <path
                key={x2.subjectId + x2.label}
                d={path(x2.points)}
                className={i === 0 ? s.lineA : i === 1 ? s.lineB : s.lineC}
              />
            ))}
            {props.turns.map((turn) => {
              const t0 = stamp(turn.date);
              if (!Number.isFinite(t0) || t0 < domain[0] || t0 > domain[1]) return null;
              const cx = x(t0);
              return (
                <path
                  key={turn.date + turn.kind}
                  className={turn.provisional ? s.turnProv : s.turnConfirmed}
                  d={
                    turn.kind === "peak"
                      ? `M${cx - 4} ${padT + 4} L${cx} ${padT - 2} L${cx + 4} ${padT + 4} Z`
                      : `M${cx - 4} ${padT + 8} L${cx} ${padT + 2} L${cx + 4} ${padT + 8} Z`
                  }
                >
                  <title>{`${turn.date} · ${turn.kind}${turn.provisional ? " · " + t("scProvisional") : ""}`}</title>
                </path>
              );
            })}
            <line
              x1={x(stamp(cursorDate) || 0)}
              x2={x(stamp(cursorDate) || 0)}
              y1={padT - 4}
              y2={chartH - padB}
              className={s.cursor}
            />
            {cursorPoints.map((r, i) => (
              <circle
                key={r.label}
                cx={x(r.p.t)}
                cy={y(r.p.value)}
                r={4}
                className={i === 0 ? s.dotA : s.dotB}
              />
            ))}
          </svg>
        )}
        <div className={s.fullscreenValues} data-testid="cycle-fullscreen-values" aria-live="polite">
          <time dateTime={cursorDate ?? undefined}>{cursorDate ?? "—"}</time>
          {cursorPoints.map((r) => (
            <span key={r.label}>
              {r.label} <strong>{fmtSeries(r.p.value)}</strong>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
