"use client";
/**
 * VolSkewPanel — Panel D: per-strike call/put IV smile for one expiration.
 *
 * Expiration chips come from smile[] (default = first). The live store's deep
 * wings carry garbage deep-ITM IVs (197%-style prints), so the DEFAULT view
 * trims to strikes within ±20% of a display proxy — the supplied strike minimizing
 * |call_iv − put_iv| — with a disclosure chip naming the trim and a "Full supplied
 * range" toggle for everything supplied. No spot marker: spot is not in this payload,
 * and borrowing it from another store would cross sessions.
 *
 * Neutral palette (vol is non-directional): call = --brand-2, put = --ai.
 */

import React, { useId, useMemo, useRef, useState } from "react";
import {
  useChartWidth, niceTicks, fmtTick, thinLabels, padDomain,
} from "@/components/charts/svgChart";
import type { Lang } from "@/lib/i18n";
import { Tip } from "@/components/ui/Tip";
import { makeVolT } from "./volStrings";
import { makeVolSkewT } from "./volSkewStrings";
import styles from "./VolSkewPanel.module.css";
import type { VolSmileExp, VolSmilePoint } from "./volTypes";
import {
  admitVolSmileExpiries, finiteSegments, reportedVolNumber, ProvenanceLine, PanelEmpty, PLOT_PAD, AXIS_TXT, REF_TXT,
} from "./volShared";

const H = 210; // two overlaid series + legend want a little more than the 190 floor
const TRIM_FRAC = 0.20;

const CALL_COLOR = "var(--brand-2)";
const PUT_COLOR = "var(--ai)";

export function VolSkewPanel({
  smile,
  lang,
  selectedExp,
  onSelectExp,
}: {
  smile: VolSmileExp[] | undefined;
  lang: Lang;
  selectedExp?: string | null;
  onSelectExp?: (exp: string) => void;
}) {
  const t = makeVolT(lang);
  const tx = makeVolSkewT(lang);
  const descriptionId = useId();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const tableButtonRef = useRef<HTMLButtonElement | null>(null);
  const w = useChartWidth(boxRef);

  const admission = useMemo(() => admitVolSmileExpiries(smile), [smile]);
  const exps = admission.expiries;

  // Selection is keyed to the expiration LIST it was made against: a root
  // switch swaps smile[] out from under it, and a selection made for another
  // root must be ignored (default = first expiration), not carried over.
  const expsKey = useMemo(() => exps.map((s) => s.exp).join("|"), [exps]);
  const [sel, setSel] = useState<{ key: string; exp: string } | null>(null);
  const [fullChain, setFullChain] = useState(false);
  const [view, setView] = useState<"chart" | "table">("chart");

  const controlledSelection = selectedExp !== undefined;
  const active = controlledSelection
    ? (selectedExp ? exps.find((s) => s.exp === selectedExp) ?? null : exps[0] ?? null)
    : ((sel && sel.key === expsKey ? exps.find((s) => s.exp === sel.exp) : undefined) ?? exps[0] ?? null);

  const selectExpiry = (exp: string) => {
    if (onSelectExp) onSelectExp(exp);
    else setSel({ key: expsKey, exp });
  };

  // Strike admission is already normalized by the shared source-truth owner.
  // Duplicate strikes remain NaN placeholders so line/interpolation continuity breaks.
  const allPts = useMemo(() => active?.points ?? [], [active]);
  const activeConflictCount = active?.conflictStrikes.size ?? 0;
  const selectedExpiryConflict = selectedExp != null && admission.conflictExpiries.has(selectedExp);
  const activeHasFinite = allPts.some((point) =>
    Number.isFinite(reportedVolNumber(point.call_iv)) || Number.isFinite(reportedVolNumber(point.put_iv)),
  );
  const conflictEmpty = selectedExpiryConflict || (!!active && activeConflictCount > 0 && !activeHasFinite);
  const conflictSummary = selectedExpiryConflict
    ? t("skewExpiryConflict").replace("{exp}", selectedExp ?? "—")
    : activeConflictCount > 0
      ? t("skewConflictCount").replace("{n}", String(activeConflictCount))
      : null;

  // ATM proxy: the strike minimizing |call_iv − put_iv| (both legs finite).
  const atmProxy = useMemo<number | null>(() => {
    let best: number | null = null;
    let bestGap = Infinity;
    for (const p of allPts) {
      const c = reportedVolNumber(p.call_iv), q = reportedVolNumber(p.put_iv);
      if (!Number.isFinite(c) || !Number.isFinite(q)) continue;
      const gap = Math.abs(c - q);
      if (gap < bestGap) { bestGap = gap; best = p.strike; }
    }
    return best;
  }, [allPts]);

  // Default view trims the wings to ±20% of the ATM proxy; a trim that would
  // leave a degenerate chart (<2 strikes) falls back to the full chain.
  const trimmedPts = useMemo<VolSmilePoint[]>(() => {
    if (atmProxy == null) return allPts;
    const lo = atmProxy * (1 - TRIM_FRAC);
    const hi = atmProxy * (1 + TRIM_FRAC);
    const kept = allPts.filter((p) => p.strike >= lo && p.strike <= hi);
    return kept.length >= 2 ? kept : allPts;
  }, [allPts, atmProxy]);

  const trimming = !fullChain && trimmedPts.length < allPts.length;
  const pts = fullChain ? allPts : trimmedPts;

  const callSegs = useMemo(() => finiteSegments(pts, (p) => reportedVolNumber(p.call_iv)), [pts]);
  const putSegs = useMemo(() => finiteSegments(pts, (p) => reportedVolNumber(p.put_iv)), [pts]);

  // ── Descriptive proxy skew (R2.3): 95% put IV − 105% call IV around the display proxy.
  // This is not spot moneyness: spot is absent from this payload. Interpolate only
  // through adjacent supplied finite legs; an explicit gap suppresses the read.
  const skewRead = useMemo(() => {
    if (atmProxy == null) return null;
    const interp = (target: number, leg: "call_iv" | "put_iv"): number | null => {
      const exact = allPts.find(p => p.strike === target);
      if (exact) { const value = reportedVolNumber(exact[leg]); return Number.isFinite(value) ? value : null; }
      for (let i = 1; i < allPts.length; i++) {
        const a = allPts[i - 1], b = allPts[i];
        if (!(a.strike < target && target < b.strike)) continue;
        const av = reportedVolNumber(a[leg]), bv = reportedVolNumber(b[leg]);
        // Never bridge an explicitly unavailable leg, or extrapolate outside supplied strikes.
        if (!Number.isFinite(av) || !Number.isFinite(bv)) return null;
        return av + (bv - av) * (target - a.strike) / (b.strike - a.strike);
      }
      return null;
    };
    const put95 = interp(atmProxy * 0.95, "put_iv");
    const call105 = interp(atmProxy * 1.05, "call_iv");
    if (put95 == null || call105 == null) return null;
    const v = put95 - call105;
    const biasKey: "skewPutBias" | "skewCallBias" | "skewFlat" =
      v > 0.5 ? "skewPutBias" : v < -0.5 ? "skewCallBias" : "skewFlat";
    return { v, biasKey };
  }, [allPts, atmProxy]);

  const drawable =
    pts.length >= 1 && (callSegs.length > 0 || putSegs.length > 0);

  const [x0, x1] = useMemo(() => {
    if (!drawable) return [0, 1] as [number, number];
    return padDomain(pts[0].strike, pts[pts.length - 1].strike, { padFrac: 0.04 });
  }, [pts, drawable]);

  const [y0, y1] = useMemo(() => {
    if (!drawable) return [0, 1] as [number, number];
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) {
      for (const v of [reportedVolNumber(p.call_iv), reportedVolNumber(p.put_iv)]) {
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return padDomain(lo, hi, { clampMin: 0 });
  }, [pts, drawable]);

  const plotW = Math.max(10, w - PLOT_PAD.l - PLOT_PAD.r);
  const plotH = H - PLOT_PAD.t - PLOT_PAD.b;
  const xOf = (k: number) => PLOT_PAD.l + ((k - x0) / Math.max(1e-9, x1 - x0)) * plotW;
  const yOf = (v: number) => PLOT_PAD.t + (1 - (v - y0) / Math.max(1e-9, y1 - y0)) * plotH;

  const { values: yTicks, step: yStep } = niceTicks(y0, y1, 4);
  const { values: xTickVals, step: xStep } = niceTicks(x0, x1, 6);
  const xTicks = useMemo(
    () => thinLabels(xTickVals, (v) => xOf(v), 48),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [xTickVals, w, x0, x1],
  );

  const pathOf = (seg: VolSmilePoint[], leg: "call_iv" | "put_iv") =>
    seg.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.strike).toFixed(1)},${yOf(reportedVolNumber(p[leg])).toFixed(1)}`).join("");

  return (
    <section className={`fin-card ${styles.panel}`} data-testid="vol-skew-panel">
      <div className={`fin-card-h ${styles.header}`}>
        <span className={styles.title}>{t("skewTitle")}</span>
        <span className={styles.legend} role="img" aria-label={tx("callKey")}>
          <span className={styles.key} aria-hidden="true" />{t("skewCallLeg")}
        </span>
        <span className={styles.legend} role="img" aria-label={tx("putKey")}>
          <span className={`${styles.key} ${styles.putKey}`} aria-hidden="true" />{t("skewPutLeg")}
        </span>
      </div>
      {exps.length > 0 && (
        <div role="group" aria-label={t("skewExpAria")} className={styles.controls}>
          {exps.map((s) => (
            <button
              key={s.exp}
              type="button"
              className={styles.button}
              aria-pressed={(active?.exp ?? "") === s.exp}
              onClick={() => selectExpiry(s.exp)}
            >
              {s.exp}
            </button>
          ))}
        </div>
      )}
      {active && (
        <>
          <div className={styles.toolbar}>
            <div role="group" aria-label={tx("view")} className={styles.viewGroup}>
              <button type="button" className={styles.button} aria-pressed={view === "chart"} onClick={() => setView("chart")}>
                {tx("chart")}
              </button>
              <button ref={tableButtonRef} type="button" className={styles.button} aria-pressed={view === "table"} onClick={() => setView("table")}>
                {tx("exact")}
              </button>
            </div>
            <p className={styles.context} role="status" data-testid="smile-range-status">
              {active.exp} · {tx("count").replace("{shown}", String(pts.length)).replace("{total}", String(allPts.length))}
            </p>
          </div>
          <div className={styles.controls}>
          {skewRead && (
            <Tip label={t("skewReadTip")} size="card">
              <button type="button" className={styles.button}>
                {t("skewRead")} {skewRead.v > 0 ? "+" : skewRead.v < 0 ? "−" : ""}
                {Math.abs(skewRead.v).toFixed(1)} · {t(skewRead.biasKey)}
              </button>
            </Tip>
          )}
          {trimming && (
            <Tip label={t("skewTrimTip")} size="card">
              <button type="button" className={styles.button}>
                {t("skewTrimmedChip")}
              </button>
            </Tip>
          )}
          {/* Only offered when the trim actually removed strikes — otherwise the
              toggle highlights and changes nothing, a dead control. */}
          {trimmedPts.length < allPts.length && (
            <button
              type="button"
              className={styles.button}
              aria-pressed={fullChain}
              onClick={() => setFullChain((v) => !v)}
            >
              {t("skewFullChain")}
            </button>
          )}
          </div>
        </>
      )}
      {conflictSummary && (
        <div data-testid="smile-conflict-status" role="status" className={`${styles.note} ${styles.conflict}`}>
          {conflictSummary}
        </div>
      )}
      <div ref={boxRef} className={styles.content}>
        {view === "table" && active && pts.length > 0 ? (
          <>
            <table className={styles.table} data-testid="smile-exact-table">
              <caption>{tx("caption").replace("{exp}", active.exp)}</caption>
              <thead><tr>
                <th scope="col">{tx("strike")}</th>
                <th scope="col">{tx("call")}</th>
                <th scope="col">{tx("put")}</th>
              </tr></thead>
              <tbody>{pts.map(point => (
                <tr key={point.strike}>
                  <th scope="row">{String(point.strike)}</th>
                  {(["call_iv", "put_iv"] as const).map(leg => {
                    const value = reportedVolNumber(point[leg]);
                    const state = active.conflictStrikes.has(point.strike) ? "conflict"
                      : Number.isFinite(value) ? "supplied" : "unavailable";
                    return <td key={leg} data-state={state}>
                      {state === "supplied" ? String(value) : tx(state === "conflict" ? "conflict" : "unavailable")}
                    </td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
            <details className={styles.source}>
              <summary>{tx("source")}</summary>
              <p className={styles.note}>{tx("precision")}</p>
              <p className={styles.note}>{tx("scope")}</p>
              <p className={styles.note}>{tx("method")}</p>
            </details>
          </>
        ) : !drawable ? (
          <PanelEmpty
            title={conflictEmpty
              ? t("skewSelectedConflictTitle")
              : controlledSelection && selectedExp && !active ? t("skewSelectedMissingTitle") : t("skewEmptyTitle")}
            why={conflictEmpty
              ? t("skewSelectedConflictWhy").replace("{exp}", selectedExp ?? active?.exp ?? "—")
              : controlledSelection && selectedExp && !active
                ? t("skewSelectedMissingWhy").replace("{exp}", selectedExp)
                : t("skewEmptyWhy")}
            minHeight={H}
          />
        ) : (
          <>
          <div className={styles.narrow}>
            <p className={styles.note}>{tx("narrow")}</p>
            <button type="button" className={styles.button} onClick={() => { setView("table"); tableButtonRef.current?.focus(); }}>{tx("exact")}</button>
          </div>
          <svg className={styles.plot} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
            aria-label={`${t("skewTitle")} · ${active?.exp ?? ""}${conflictSummary ? `. ${conflictSummary}` : ""}`}
            aria-describedby={descriptionId}>
            <desc id={descriptionId}>{tx("chartDescription")}</desc>
            {yTicks.map((v) => (
              <g key={`y${v}`}>
                <line x1={PLOT_PAD.l} x2={w - PLOT_PAD.r} y1={yOf(v)} y2={yOf(v)} stroke="var(--grid)" />
                <text x={PLOT_PAD.l - 6} y={yOf(v) + 3} textAnchor="end" style={AXIS_TXT}>
                  {fmtTick(v, yStep)}%
                </text>
              </g>
            ))}
            {xTicks.map((v) => (
              <text key={`x${v}`} x={xOf(v)} y={H - 8} textAnchor="middle" style={AXIS_TXT}>
                {fmtTick(v, xStep)}
              </text>
            ))}
            {/* x-axis caption, inside the plot band (mirrors VolTermPanel) */}
            <text x={w - PLOT_PAD.r} y={PLOT_PAD.t + 10} textAnchor="end" style={REF_TXT}>
              {t("skewStrikeAxis")}
            </text>
            {callSegs.map((seg, i) => (
              <path key={`c${i}`} d={pathOf(seg, "call_iv")} fill="none" stroke={CALL_COLOR}
                strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {putSegs.map((seg, i) => (
              <path key={`p${i}`} d={pathOf(seg, "put_iv")} fill="none" stroke={PUT_COLOR}
                strokeWidth={1.6} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {pts.map((p) => {
              const c = reportedVolNumber(p.call_iv), q = reportedVolNumber(p.put_iv);
              return (
                <g key={p.strike}>
                  {Number.isFinite(c) && <circle data-vol-leg="call" cx={xOf(p.strike)} cy={yOf(c)} r={2.5} fill={CALL_COLOR} />}
                  {Number.isFinite(q) && <polygon data-vol-leg="put" points={`${xOf(p.strike)},${yOf(q) - 3.5} ${xOf(p.strike) + 3.5},${yOf(q)} ${xOf(p.strike)},${yOf(q) + 3.5} ${xOf(p.strike) - 3.5},${yOf(q)}`} fill={PUT_COLOR} />}
                </g>
              );
            })}
          </svg>
          </>
        )}
      </div>
      <div className={styles.provenance}><ProvenanceLine lang={lang} /></div>
    </section>
  );
}
