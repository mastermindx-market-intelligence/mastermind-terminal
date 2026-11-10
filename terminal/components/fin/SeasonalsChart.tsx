"use client";
/**
 * SeasonalsChart — the interactive multi-year seasonality overlay.
 *
 * Beyond the old <YearOverlay> it adds:
 *   • a timeline crosshair that snaps to the grid and shows the approx calendar
 *     DATE on the x-axis (+ a per-year value tooltip),
 *   • month separator bands in the background (calendar-accurate boundaries),
 *   • per-year toggles (click a legend chip / All / Clear) — everything, incl.
 *     the dotted average, recomputes over the ACTIVE years only,
 *   • press-and-drag over the plot to select a time span: a live popup (and a
 *     persistent panel) auto-computes each active year's % gain over that span,
 *     plus the average, median, win-rate and best/worst — active years only.
 *
 * Pure prop-driven; the active-year Set is owned by the parent so the advanced
 * analytics section stays in sync.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import styles from "./SeasonalControls.module.css";
import { fmtNum, fmtPct, pick } from "../../lib/finFormat";
import { FinTip, useFinTip } from "./FinCharts";
import { fmtTick, niceTicks, padDomain, useChartWidth } from "../charts/svgChart";
import {
  HORIZON,
  MONTHS_EN,
  MONTHS_ZH,
  monthBoundIdx,
  idxToDateLabel,
  rangeStats,
  yearColor,
  type YearData,
} from "../../lib/seasonal";

interface SeasonalsChartProps {
  years: YearData[];
  active: Set<string>;
  onToggleYear: (year: string) => void;
  onSetActive: (next: Set<string>) => void;
  zh?: boolean;
  height?: number;
}

const PAD = { t: 12, r: 68, b: 30, l: 8 };
const MIN_DRAG_IDX = 3; // below this a press is treated as a click (clears selection)

const num = (v: number | null | undefined): v is number => v != null && isFinite(v);

export function SeasonalsChart({ years, active, onToggleYear, onSetActive, zh = false, height = 420 }: SeasonalsChartProps) {
  const { tip, show, hide } = useFinTip();
  // Percent-normalized is the ONLY mode (v7b): the raw-price overlay was killed by the
  // seasonal audit — overlaying absolute price levels from different years shares one
  // y-axis across regimes and reads as a comparison it isn't. The pct plumbing below is
  // kept as a constant so the normalization branches stay in one obvious place.
  const pct = true;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hiYear, setHiYear] = useState<string | null>(null); // legend/line hover-highlight
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const dragStart = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const vw = useChartWidth(boxRef, 840);

  const vh = height;
  const iw = vw - PAD.l - PAD.r;
  const ih = vh - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (HORIZON <= 1 ? 0 : (i / (HORIZON - 1)) * iw);

  const months = zh ? MONTHS_ZH : MONTHS_EN;
  const bounds = useMemo(() => monthBoundIdx(), []);

  const activeYears = useMemo(() => years.filter((y) => active.has(y.year)), [years, active]);

  // normalize (Percent = rebase to first finite value → % change)
  const normed = useMemo(() => {
    const rebase = (vals: (number | null)[]) => {
      if (!pct) return vals;
      const base = vals.find((v) => num(v)) as number | undefined;
      if (base == null || base === 0) return vals;
      return vals.map((v) => (num(v) ? ((v as number) / base - 1) * 100 : null));
    };
    return activeYears.map((y, i) => ({
      year: y.year,
      isCurrent: y.isCurrent,
      color: yearColor(y.year, i),
      values: rebase(y.price),
    }));
  }, [activeYears, pct]);

  const avg = useMemo<(number | null)[]>(() => {
    return Array.from({ length: HORIZON }, (_, i) => {
      const xs = normed.map((p) => p.values[i]).filter(num) as number[];
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    });
  }, [normed]);

  const dom = useMemo(() => {
    const flat: number[] = [];
    for (const p of normed) for (const v of p.values) if (num(v)) flat.push(v);
    for (const v of avg) if (num(v)) flat.push(v);
    if (flat.length === 0) return [0, 1] as [number, number];
    return padDomain(Math.min(...flat), Math.max(...flat), { includeZero: true, padFrac: 0.08 });
  }, [normed, avg]);
  const tk = niceTicks(dom[0], dom[1], 5);
  const y = (v: number) => PAD.t + ih - ((v - dom[0]) / (dom[1] - dom[0])) * ih;

  const fmtY = (v: number) =>
    pct ? `${v > 0 ? "+" : ""}${fmtTick(v, tk.step)}%` : fmtNum(v);
  const fmtG = (v: number) => fmtPct(v, { decimals: 1, alreadyPct: true, sign: true });

  const line = (vals: (number | null)[]) => {
    const pts: string[] = [];
    vals.forEach((v, i) => {
      if (num(v)) pts.push(`${x(i).toFixed(1)},${y(v as number).toFixed(1)}`);
    });
    return pts.join(" ");
  };
  // soft area under the mean path, dropping to the baseline (0 when Percent,
  // else the domain floor). Gives the mean visual weight without a hard fill.
  const meanArea = (vals: (number | null)[]) => {
    const base = pct ? 0 : dom[0];
    const top: string[] = [];
    let first: number | null = null;
    let lastI = -1;
    vals.forEach((v, i) => {
      if (num(v)) { top.push(`${x(i).toFixed(1)},${y(v as number).toFixed(1)}`); if (first == null) first = i; lastI = i; }
    });
    if (top.length < 2 || first == null) return "";
    return `M${x(first).toFixed(1)},${y(base).toFixed(1)} L` + top.join(" L") + ` L${x(lastI).toFixed(1)},${y(base).toFixed(1)} Z`;
  };
  const lastFinite = (vals: (number | null)[]): [number, number] | null => {
    for (let i = vals.length - 1; i >= 0; i--) if (num(vals[i])) return [i, vals[i] as number];
    return null;
  };

  // v6: individual prior years are CONTEXT — 1px at 22% alpha, receding to a
  // cloud as the count climbs; the mean path and the current year carry the
  // signal. A hovered/legend-picked year lifts to full opacity. End-labels drop
  // past ~12 years and the per-year hover tooltip collapses into a summary.
  const YEAR_BASE_OP = 0.22;
  const manyYears = normed.length;
  const yearLineOp = manyYears <= 12 ? YEAR_BASE_OP : Math.max(0.1, (YEAR_BASE_OP * 12) / manyYears);
  const collapseLegend = years.length > 12; // "N years" chip + popover past 12

  /* ── pointer → grid index ─────────────────────────────────────────────── */
  const idxAt = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const scaleX = vw / rect.width;
    const localX = (clientX - rect.left) * scaleX;
    const i = Math.round(((localX - PAD.l) / Math.max(1, iw)) * (HORIZON - 1));
    return Math.max(0, Math.min(HORIZON - 1, i));
  };

  const selRange = drag ?? sel;
  const rs = useMemo(
    () => (selRange ? rangeStats(years, (yr) => active.has(yr), selRange.a, selRange.b, yearColor) : null),
    [selRange, years, active],
  );

  const onMove = (e: RPointerEvent) => {
    const i = idxAt(e.clientX);
    setHoverIdx(i);
    if (dragStart.current != null) {
      setDrag({ a: dragStart.current, b: i });
      if (rs) {
        // live selection popup
        show(e, `${idxToDateLabel(Math.min(dragStart.current, i), zh)} → ${idxToDateLabel(Math.max(dragStart.current, i), zh)}`, [
          { label: pick(zh, "Average", "平均"), value: rs.mean != null ? fmtG(rs.mean) : "—", color: "var(--brand-2)" },
          { label: pick(zh, "Win rate", "胜率"), value: rs.wr != null ? `${Math.round(rs.wr * 100)}% (${rs.n})` : "—", color: "var(--text-2)" },
        ]);
      }
    } else if (manyYears > 12) {
      // hover: summary (avg · current year · range) — too many years for a per-year list
      const vs = normed.map((p) => p.values[i]).filter(num) as number[];
      const cur = normed.find((p) => p.isCurrent);
      const rows = [{ label: pick(zh, "Average", "平均"), value: num(avg[i]) ? fmtY(avg[i] as number) : "—", color: "var(--brand-2)" }];
      if (cur) rows.push({ label: cur.year, value: num(cur.values[i]) ? fmtY(cur.values[i] as number) : "—", color: cur.color });
      if (vs.length) rows.push({ label: pick(zh, `Range · ${vs.length}y`, `区间 · ${vs.length}年`), value: `${fmtY(Math.min(...vs))} … ${fmtY(Math.max(...vs))}`, color: "var(--muted)" });
      show(e, idxToDateLabel(i, zh), rows);
    } else {
      // hover: per-year value at this position
      show(e, idxToDateLabel(i, zh), [
        ...normed.map((p) => ({ label: p.year, value: num(p.values[i]) ? fmtY(p.values[i] as number) : "—", color: p.color })),
        { label: pick(zh, "Average", "平均"), value: num(avg[i]) ? fmtY(avg[i] as number) : "—", color: "var(--muted)" },
      ]);
    }
  };
  const onDown = (e: RPointerEvent) => {
    const i = idxAt(e.clientX);
    dragStart.current = i;
    setDrag({ a: i, b: i });
    setSel(null);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onUp = (e: RPointerEvent) => {
    if (dragStart.current != null) {
      const a = dragStart.current;
      const b = idxAt(e.clientX);
      dragStart.current = null;
      setDrag(null);
      if (Math.abs(a - b) >= MIN_DRAG_IDX) setSel({ a, b });
      else setSel(null);
    }
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };
  const onLeave = () => {
    setHoverIdx(null);
    if (dragStart.current == null) hide();
  };

  const empty = activeYears.length === 0;

  return (
    <div className="fin-seas-chart">
      {/* controls */}
      <div className="fin-yo-controls">
        <div className="fin-seas-hint">
          {sel ? (
            <button className="fin-seas-clear" onClick={() => setSel(null)}>✕ {pick(zh, "Clear selection", "清除选区")}</button>
          ) : (
            <span>{pick(zh, "Drag across the chart to measure a span", "拖动图表以测量区间")}</span>
          )}
        </div>
      </div>

      {/* chart */}
      <div className="fin-seas-chartbox" ref={boxRef} style={{ height: vh }}>
        <svg ref={svgRef} viewBox={`0 0 ${vw} ${vh}`} width={vw} height={vh} className="fin-svg">
          {/* month background bands + separators */}
          {bounds.map((bi, m) => {
            const x0 = x(bi);
            const x1 = m < 11 ? x(bounds[m + 1]) : x(HORIZON - 1);
            return (
              <g key={m}>
                {m % 2 === 1 && <rect className="fin-seas-band" x={x0} y={PAD.t} width={Math.max(0, x1 - x0)} height={ih} />}
                {m > 0 && <line className="fin-seas-sep" x1={x0} x2={x0} y1={PAD.t} y2={PAD.t + ih} />}
              </g>
            );
          })}

          {/* y grid + ticks */}
          {tk.values.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "fin-grid fin-grid-0" : "fin-grid"} x1={PAD.l} x2={vw - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="fin-axis-y" x={vw - PAD.r + 4} y={y(t) + 3}>{fmtY(t)}</text>
            </g>
          ))}

          {/* selection band */}
          {selRange && Math.abs(selRange.a - selRange.b) >= 1 && (
            <g>
              <rect className="fin-seas-selband" x={x(Math.min(selRange.a, selRange.b))} y={PAD.t}
                width={Math.abs(x(selRange.b) - x(selRange.a))} height={ih} />
              <line className="fin-seas-seledge" x1={x(selRange.a)} x2={x(selRange.a)} y1={PAD.t} y2={PAD.t + ih} />
              <line className="fin-seas-seledge" x1={x(selRange.b)} x2={x(selRange.b)} y1={PAD.t} y2={PAD.t + ih} />
            </g>
          )}

          {/* per-year paths (context: 1px, 22% alpha). Current year + a hovered
              year lift above the mean; everything else recedes to a cloud. */}
          {normed.filter((p) => !p.isCurrent).map((p) => {
            const lifted = hiYear === p.year;
            const dimmed = hiYear != null && !lifted;
            return (
              <polyline
                key={p.year}
                className="fin-seas-yline"
                points={line(p.values)}
                fill="none"
                stroke={p.color}
                strokeOpacity={lifted ? 1 : dimmed ? Math.min(yearLineOp, 0.1) : yearLineOp}
                strokeWidth={lifted ? 1.5 : 1}
                onPointerEnter={() => setHiYear(p.year)}
                onPointerLeave={() => setHiYear((h) => (h === p.year ? null : h))}
              />
            );
          })}

          {/* mean path — soft brand area + 2px brand line (the typical year) */}
          {meanArea(avg) && <path className="fin-seas-meanarea" d={meanArea(avg)} />}
          {line(avg) && <polyline className="fin-seas-meanline" points={line(avg)} fill="none" />}

          {/* current year — 1.5px --signal (attention, non-directional) */}
          {normed.filter((p) => p.isCurrent).map((p) => {
            const end = lastFinite(p.values);
            return (
              <g key={p.year}>
                <polyline className="fin-seas-curline" points={line(p.values)} fill="none" />
                {end && <circle className="fin-seas-curnode" cx={x(end[0])} cy={y(end[1])} r={3.2} />}
                {end && (
                  <text
                    className="fin-seas-curlbl"
                    x={end[0] > HORIZON - 20 ? x(end[0]) - 6 : x(end[0]) + 6}
                    y={y(end[1]) - 6}
                    textAnchor={end[0] > HORIZON - 20 ? "end" : "start"}
                  >
                    {p.year}
                  </text>
                )}
              </g>
            );
          })}

          {/* month labels (calendar-centered) */}
          {bounds.map((bi, m) => {
            const x0 = x(bi);
            const x1 = m < 11 ? x(bounds[m + 1]) : x(HORIZON - 1);
            return (
              <text key={m} className="fin-seas-mlbl" x={(x0 + x1) / 2} y={vh - 8} textAnchor="middle">{months[m]}</text>
            );
          })}

          {/* crosshair + date pill */}
          {hoverIdx != null && !empty && (
            <g className="fin-seas-cross">
              <line className="fin-seas-crossline" x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD.t} y2={PAD.t + ih} />
              <g transform={`translate(${x(hoverIdx)}, ${vh - 20})`}>
                <rect className="fin-seas-datepill" x={-26} y={0} width={52} height={16} rx={3} />
                <text className="fin-seas-datepilltxt" x={0} y={11} textAnchor="middle">{idxToDateLabel(hoverIdx, zh)}</text>
              </g>
            </g>
          )}

          {/* interaction overlay */}
          <rect x={PAD.l} y={PAD.t} width={iw} height={ih} fill="transparent" className="fin-seas-overlay"
            onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onPointerLeave={onLeave} />

          {empty && (
            <text className="fin-seas-emptytxt" x={vw / 2} y={vh / 2} textAnchor="middle">
              {pick(zh, "Select at least one year", "请至少选择一个年份")}
            </text>
          )}
        </svg>
      </div>

      {/* legend — inline chips when few, an "N years" chip + popover past 12 */}
      <div className="fin-seas-legend">
        {/* `.collapsed` un-clips the row: the un-collapsed legend caps its height
            and scrolls, and that scroll container was clipping the year-picker
            popover (an abspos box can never escape an ancestor's overflow, no
            matter its z-index) — so the "N of M years" chip appeared dead. In
            the collapsed case the row is a single line of chips, so dropping
            the cap costs nothing. */}
        <div className={"fin-seas-legend-years" + (collapseLegend ? " collapsed" : "")}>
          <span className="fin-seas-legkey"><i className="fin-seas-legkey-mean" />{pick(zh, "Mean", "平均")}</span>
          {years.some((y) => y.isCurrent) && <span className="fin-seas-legkey"><i className="fin-seas-legkey-cur" />{pick(zh, "This year", "今年")}</span>}
          {collapseLegend ? (
            <YearPopover years={years} active={active} onToggleYear={onToggleYear} onHiYear={setHiYear} zh={zh} />
          ) : (
            years.map((yd, i) => {
              const on = active.has(yd.year);
              return (
                <button
                  key={yd.year}
                  className={styles.toggle + " fin-seas-chip" + (on ? "" : " off") + (yd.isCurrent ? " cur" : "")}
                  onClick={() => onToggleYear(yd.year)}
                  onPointerEnter={() => setHiYear(yd.year)}
                  onPointerLeave={() => setHiYear((h) => (h === yd.year ? null : h))}
                  aria-pressed={on}
                >
                  <i className="fin-seas-chip-dot" style={{ background: on ? yearColor(yd.year, i) : "var(--text-dim)" }} />
                  {yd.year}
                </button>
              );
            })
          )}
        </div>
        <div className="fin-seas-legend-acts">
          <button type="button" className={styles.toggle + " fin-seas-mini"} onClick={() => onSetActive(new Set(years.map((y) => y.year)))}>{pick(zh, "All", "全部")}</button>
          <button type="button" className={styles.toggle + " fin-seas-mini"} onClick={() => onSetActive(new Set())}>{pick(zh, "None", "清空")}</button>
        </div>
      </div>

      {/* committed selection summary */}
      {sel && rs && rs.n > 0 && <SelectionSummary rs={rs} zh={zh} />}

      <FinTip tip={tip} />
    </div>
  );
}

/* Collapsed year legend: an "N years" chip that opens a frosted popover of all
   year toggles (used past 12 years so the legend never becomes a scroll wall). */
function YearPopover({
  years,
  active,
  onToggleYear,
  onHiYear,
  zh,
}: {
  years: YearData[];
  active: Set<string>;
  onToggleYear: (year: string) => void;
  onHiYear: (year: string | null) => void;
  zh: boolean;
}) {
  const [open, setOpen] = useState(false);
  const popupId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    onHiYear(null);
  }, [onHiYear]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: globalThis.PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open, close]);

  // Keep the existing anchored disclosure inside both the visual viewport and
  // the pane's actual scroll clips. Year selection never changes or resets.
  useLayoutEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!wrap || !trigger || !popup) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const position = () => {
      frame = 0;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const bounds = {
        left, top,
        right: left + (viewport?.width ?? window.innerWidth),
        bottom: top + (viewport?.height ?? window.innerHeight),
      };
      for (let parent = wrap.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        const rect = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) {
          bounds.left = Math.max(bounds.left, rect.left + parent.clientLeft);
          bounds.right = Math.min(bounds.right, rect.left + parent.clientLeft + parent.clientWidth);
        }
        if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) {
          bounds.top = Math.max(bounds.top, rect.top + parent.clientTop);
          bounds.bottom = Math.min(bounds.bottom, rect.top + parent.clientTop + parent.clientHeight);
        }
        // The phone pane is fixed to the viewport; the chart slot behind it
        // is not one of its clipping ancestors.
        if (css.position === "fixed") break;
      }
      const tabs = wrap.closest(".fin-pane")?.querySelector<HTMLElement>(".fin-local-tabs-mobile");
      const tabsRect = tabs?.getBoundingClientRect();
      if (tabsRect && tabsRect.height > 0) bounds.bottom = Math.min(bounds.bottom, tabsRect.top);
      const anchor = trigger.getBoundingClientRect();
      const origin = wrap.getBoundingClientRect();
      const minX = bounds.left + 8;
      const maxX = bounds.right - 8;
      const minY = bounds.top + 8;
      const maxY = bounds.bottom - 8;
      const width = Math.min(300, Math.max(0, maxX - minX));
      popup.style.width = width + "px";
      const below = Math.max(0, maxY - anchor.bottom - 7);
      const above = Math.max(0, anchor.top - 7 - minY);
      const upwards = below < Math.min(240, popup.scrollHeight) && above > below;
      const clipHeight = Math.max(0, maxY - minY);
      popup.style.maxHeight = Math.min(240, clipHeight, upwards ? above : below) + "px";
      const height = popup.getBoundingClientRect().height;
      const x = Math.max(minX, Math.min(anchor.left, maxX - width));
      const preferredY = upwards ? anchor.top - 7 - height : anchor.bottom + 7;
      const y = Math.max(minY, Math.min(preferredY, maxY - height));
      popup.style.left = x - origin.left + "px";
      popup.style.top = y - origin.top + "px";
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(position);
    };
    position();
    const observer = new ResizeObserver(schedule);
    observer.observe(trigger);
    observer.observe(popup);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [open]);

  const nOn = years.filter((y) => active.has(y.year)).length;
  return (
    <div
      className="fin-seas-yearpop-wrap"
      ref={wrapRef}
      data-open={open}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
        triggerRef.current?.focus();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.toggle + " fin-seas-chip fin-seas-yearpop-trig" + (open ? " open" : "")}
        onClick={() => { if (open) close(); else setOpen(true); }}
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
      >
        {pick(zh, `${nOn} of ${years.length} years`, `${years.length} 年中的 ${nOn} 年`)}
        <svg className="fin-seas-yearpop-caret" width="9" height="9" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div ref={popupRef} id={popupId} className={styles.popup + " fin-seas-yearpop"} role="group" aria-label={pick(zh, "Toggle years", "切换年份")}>
          {years
            .slice()
            .reverse()
            .map((yd) => {
              const on = active.has(yd.year);
              const i = years.findIndex((y) => y.year === yd.year);
              return (
                <button
                  key={yd.year}
                  type="button"
                  aria-pressed={on}
                  className={styles.toggle + " fin-seas-yearpop-item" + (on ? " on" : "") + (yd.isCurrent ? " cur" : "")}
                  onClick={() => onToggleYear(yd.year)}
                  onPointerEnter={() => onHiYear(yd.year)}
                  onPointerLeave={() => onHiYear(null)}
                >
                  <i className="fin-seas-chip-dot" style={{ background: on ? yearColor(yd.year, i) : "var(--text-dim)" }} />
                  {yd.year}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

/* Persistent breakdown of a committed drag-selection (active years only). */
function SelectionSummary({ rs, zh }: { rs: NonNullable<ReturnType<typeof rangeStats>>; zh: boolean }) {
  const fmtG = (v: number) => fmtPct(v, { decimals: 1, alreadyPct: true, sign: true });
  const dateA = idxToDateLabel(rs.a, zh);
  const dateB = idxToDateLabel(rs.b, zh);
  const approxDays = Math.round(((rs.b - rs.a) / (HORIZON - 1)) * 365);
  return (
    <div className="fin-seas-selsum">
      <div className="fin-seas-selsum-head">
        <span className="fin-seas-selsum-range">{dateA} → {dateB}</span>
        <span className="fin-seas-selsum-days">≈ {approxDays} {pick(zh, "days", "天")}</span>
      </div>
      <div className="fin-seas-selsum-stats">
        <Stat label={pick(zh, "Avg gain", "平均涨幅")} value={rs.mean != null ? fmtG(rs.mean) : "—"} tone={rs.mean != null && rs.mean >= 0 ? "up" : "down"} big />
        <Stat label={pick(zh, "Median", "中位数")} value={rs.median != null ? fmtG(rs.median) : "—"} tone={rs.median != null && rs.median >= 0 ? "up" : "down"} />
        <Stat label={pick(zh, "Win rate", "胜率")} value={rs.wr != null ? `${Math.round(rs.wr * 100)}%` : "—"} sub={`${rs.gains.filter((g) => g.gain > 0).length}/${rs.n}`} />
        <Stat label={pick(zh, "Best", "最佳")} value={rs.best ? fmtG(rs.best.gain) : "—"} sub={rs.best?.year} tone="up" />
        <Stat label={pick(zh, "Worst", "最差")} value={rs.worst ? fmtG(rs.worst.gain) : "—"} sub={rs.worst?.year} tone="down" />
      </div>
      <div className="fin-seas-selsum-years">
        {rs.gains
          .slice()
          .sort((a, b) => b.gain - a.gain)
          .map((g) => (
            <div className="fin-seas-selsum-yrow" key={g.year}>
              <span className="fin-seas-chip-dot" style={{ background: g.color }} />
              <span className="fin-seas-selsum-yr">{g.year}</span>
              <span className={"fin-seas-selsum-yg " + (g.gain >= 0 ? "up" : "down")}>{fmtG(g.gain)}</span>
              <span className="fin-seas-selsum-bar">
                <span
                  className={"fin-seas-selsum-barfill " + (g.gain >= 0 ? "up" : "down")}
                  style={{ width: `${Math.min(100, (Math.abs(g.gain) / Math.max(1, maxAbs(rs.gains.map((x) => x.gain)))) * 100)}%` }}
                />
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone, big }: { label: string; value: string; sub?: string; tone?: "up" | "down"; big?: boolean }) {
  return (
    <div className={"fin-seas-stat" + (big ? " big" : "")}>
      <div className="fin-seas-stat-lbl">{label}</div>
      <div className={"fin-seas-stat-val" + (tone ? " " + tone : "")}>{value}</div>
      {sub && <div className="fin-seas-stat-sub">{sub}</div>}
    </div>
  );
}

function maxAbs(xs: number[]): number {
  return xs.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
}
