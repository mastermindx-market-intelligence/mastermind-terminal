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

import React, { useMemo, useRef, useState } from "react";
import {
  useChartWidth, niceTicks, fmtTick, thinLabels, padDomain,
} from "@/components/charts/svgChart";
import type { Lang } from "@/lib/i18n";
import { Tip } from "@/components/ui/Tip";
import { makeVolT } from "./volStrings";
import type { VolSmileExp, VolSmilePoint } from "./volTypes";
import {
  finiteSegments, reportedVolNumber, volIsoDay, retainUniqueBy, ProvenanceLine, PanelEmpty, PLOT_PAD, AXIS_TXT, REF_TXT, NEUTRAL_CHIP,
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
  const boxRef = useRef<HTMLDivElement | null>(null);
  const w = useChartWidth(boxRef);

  const exps = useMemo(() => {
    const valid = (smile ?? []).filter((s) => volIsoDay(s?.exp) !== null && Array.isArray(s.points));
    return retainUniqueBy(valid, (row) => row.exp);
  }, [smile]);

  // Selection is keyed to the expiration LIST it was made against: a root
  // switch swaps smile[] out from under it, and a selection made for another
  // root must be ignored (default = first expiration), not carried over.
  const expsKey = useMemo(() => exps.map((s) => s.exp).join("|"), [exps]);
  const [sel, setSel] = useState<{ key: string; exp: string } | null>(null);
  const [fullChain, setFullChain] = useState(false);

  const controlledSelection = selectedExp !== undefined;
  const active = controlledSelection
    ? (selectedExp ? exps.find((s) => s.exp === selectedExp) ?? null : exps[0] ?? null)
    : ((sel && sel.key === expsKey ? exps.find((s) => s.exp === sel.exp) : undefined) ?? exps[0] ?? null);

  const selectExpiry = (exp: string) => {
    if (onSelectExp) onSelectExp(exp);
    else setSel({ key: expsKey, exp });
  };

  // Strike-valid, ascending points for the active expiration (IVs stay raw —
  // per-series segmentation below handles missing legs).
  const allPts = useMemo<VolSmilePoint[]>(() => {
    const valid = (active?.points ?? [])
      .filter((p) => typeof p?.strike === "number" && Number.isFinite(p.strike) && p.strike > 0)
      .map((p) => ({ strike: p.strike, call_iv: reportedVolNumber(p.call_iv), put_iv: reportedVolNumber(p.put_iv) }));
    const out = retainUniqueBy(valid, (point) => point.strike);
    out.sort((a, b) => a.strike - b.strike);
    return out;
  }, [active]);

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
    <section className="fin-card" style={{ minWidth: 0 }}>
      <div className="fin-card-h" style={{ flexWrap: "wrap", rowGap: 6 }}>
        <span>{t("skewTitle")}</span>
        <span style={{ flex: 1 }} />
        {/* legend — the two non-directional legs */}
        <span style={LEGEND_ITEM}><span style={{ ...LEGEND_SWATCH, background: CALL_COLOR }} />{t("skewCallLeg")}</span>
        <span style={LEGEND_ITEM}><span style={{ ...LEGEND_SWATCH, background: PUT_COLOR }} />{t("skewPutLeg")}</span>
      </div>
      {exps.length > 0 && (
        <div role="group" aria-label={t("skewExpAria")} style={CONTROLS_ROW}>
          {exps.map((s) => (
            <button
              key={s.exp}
              className={`chip${(active?.exp ?? "") === s.exp ? " on" : ""}`}
              style={EXP_CHIP}
              aria-pressed={(active?.exp ?? "") === s.exp}
              onClick={() => selectExpiry(s.exp)}
            >
              {s.exp}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {skewRead && (
            <Tip label={t("skewReadTip")} size="card">
              <span style={{ ...NEUTRAL_CHIP, cursor: "help", fontVariantNumeric: "tabular-nums" }} tabIndex={0}>
                {t("skewRead")} {skewRead.v > 0 ? "+" : skewRead.v < 0 ? "−" : ""}
                {Math.abs(skewRead.v).toFixed(1)} · {t(skewRead.biasKey)}
              </span>
            </Tip>
          )}
          {trimming && (
            <Tip label={t("skewTrimTip")} size="card">
              <button type="button" style={{ ...NEUTRAL_CHIP, cursor: "help" }}>
                {t("skewTrimmedChip")}
              </button>
            </Tip>
          )}
          {/* Only offered when the trim actually removed strikes — otherwise the
              toggle highlights and changes nothing, a dead control. */}
          {(fullChain || trimmedPts.length < allPts.length) && (
            <button
              className={`chip${fullChain ? " on" : ""}`}
              style={EXP_CHIP}
              aria-pressed={fullChain}
              onClick={() => setFullChain((v) => !v)}
            >
              {t("skewFullChain")}
            </button>
          )}
        </div>
      )}
      <div ref={boxRef} style={{ width: "100%", minWidth: 0 }}>
        {!drawable ? (
          <PanelEmpty
            title={controlledSelection && selectedExp && !active ? t("skewSelectedMissingTitle") : t("skewEmptyTitle")}
            why={controlledSelection && selectedExp && !active
              ? t("skewSelectedMissingWhy").replace("{exp}", selectedExp)
              : t("skewEmptyWhy")}
            minHeight={H}
          />
        ) : (
          <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img" aria-label={t("skewTitle")}>
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
                strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {pts.map((p) => {
              const c = reportedVolNumber(p.call_iv), q = reportedVolNumber(p.put_iv);
              return (
                <g key={p.strike}>
                  {Number.isFinite(c) && <circle cx={xOf(p.strike)} cy={yOf(c)} r={2} fill={CALL_COLOR} />}
                  {Number.isFinite(q) && <circle cx={xOf(p.strike)} cy={yOf(q)} r={2} fill={PUT_COLOR} />}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <ProvenanceLine lang={lang} />
    </section>
  );
}

const CONTROLS_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
  marginBottom: 8,
};

const EXP_CHIP: React.CSSProperties = {
  height: 24,
  padding: "0 9px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.02em",
  fontVariantNumeric: "tabular-nums",
};

const LEGEND_ITEM: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 10.5,
  fontWeight: 500,
  color: "var(--text-2)",
};

const LEGEND_SWATCH: React.CSSProperties = {
  width: 12,
  height: 3,
  borderRadius: 2,
  display: "inline-block",
};
