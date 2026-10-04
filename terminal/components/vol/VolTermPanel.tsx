"use client";
/**
 * VolTermPanel — Panel C: ATM IV term structure (atm_iv vs DTE, linear x).
 *
 * Finite-filtered per R7. Markers only on the near curve (dte ≤ 60) — the long
 * tail stays a clean line. The structure chip compares the FRONT expiration to
 * the row nearest 90 DTE: front below → Contango, front above → Inverted — a
 * geometric description in neutral tones (vol is non-directional), suppressed
 * whenever either point is missing (or they are the same row).
 */

import React, { useMemo, useRef } from "react";
import {
  useChartWidth, niceTicks, fmtTick, thinLabels, padDomain,
} from "@/components/charts/svgChart";
import type { Lang } from "@/lib/i18n";
import { makeVolT } from "./volStrings";
import type { VolTermRow } from "./volTypes";
import {
  admitVolTermRows, finiteSegments, fmtPct, volIsoDay, ProvenanceLine, PanelEmpty, PLOT_PAD, AXIS_TXT, REF_TXT, NEUTRAL_CHIP,
  type AdmittedVolTermPoint,
} from "./volShared";

// Local override, not MIN_CHART_H.axis (190) — see the matching comment in
// VolHistoryPanel.tsx: 244 is the height that makes this card's TOTAL land
// equal to VolHistoryPanel (H=250) and VolVrpPanel (H=169) once each panel's
// own chrome (header/chip row, provenance line) is accounted for.
const H = 244;
const MARKER_MAX_DTE = 60;

export function VolTermPanel({
  term,
  lang,
  selectedExp,
  onSelectExp,
}: {
  term: VolTermRow[] | undefined;
  lang: Lang;
  selectedExp?: string | null;
  onSelectExp?: (exp: string) => void;
}) {
  const t = makeVolT(lang);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const w = useChartWidth(boxRef);

  const admission = useMemo(() => admitVolTermRows(term), [term]);
  const pts = admission.rows;
  // Keep the shared identity even when this surface has no admitted term row.
  const selectedExpiry = volIsoDay(selectedExp) ? selectedExp : null;
  const selectedUnavailable = selectedExpiry != null && !pts.some((p) => p.exp === selectedExpiry);
  const finite = useMemo(() => pts.filter((p) => Number.isFinite(p.v)), [pts]);
  const segments = useMemo(
    () => admission.ambiguousCoordinateExpiries.size > 0
      ? finite.map((point) => [point])
      : finiteSegments(pts, (point) => point.v),
    [admission.ambiguousCoordinateExpiries, finite, pts],
  );
  const drawable = finite.length >= 1;
  const conflictSummary = admission.ambiguousCoordinateExpiries.size > 0
    ? t("termConflictAmbiguous").replace("{n}", String(admission.ambiguousCoordinateExpiries.size))
    : admission.conflictExpiries.size > 0
      ? t("termConflictCount").replace("{n}", String(admission.conflictExpiries.size))
      : null;

  // Structure chip: front vs nearest-to-90d. Suppressed unless both exist and differ.
  const structure = useMemo<{ key: "termContango" | "termInverted"; front: AdmittedVolTermPoint; far: AdmittedVolTermPoint } | null>(() => {
    if (admission.conflictExpiries.size > 0 || pts.length < 2) return null;
    const front = pts[0];
    let far = pts[0];
    for (const p of pts) {
      if (Math.abs(p.dte - 90) < Math.abs(far.dte - 90)) far = p;
    }
    if (far === front || !Number.isFinite(front.v) || !Number.isFinite(far.v) || far.v === front.v) return null;
    return { key: front.v < far.v ? "termContango" : "termInverted", front, far };
  }, [admission.conflictExpiries, pts]);

  const [x0, x1] = useMemo(() => {
    if (!drawable) return [0, 1] as [number, number];
    return padDomain(pts[0].dte, pts[pts.length - 1].dte, { padFrac: 0.04, clampMin: 0 });
  }, [pts, drawable]);

  const [y0, y1] = useMemo(() => {
    if (!drawable) return [0, 1] as [number, number];
    let lo = Infinity, hi = -Infinity;
    for (const p of finite) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
    return padDomain(lo, hi, { clampMin: 0 });
  }, [finite, drawable]);

  const plotW = Math.max(10, w - PLOT_PAD.l - PLOT_PAD.r);
  const plotH = H - PLOT_PAD.t - PLOT_PAD.b;
  const xOf = (dte: number) => PLOT_PAD.l + ((dte - x0) / Math.max(1e-9, x1 - x0)) * plotW;
  const yOf = (v: number) => PLOT_PAD.t + (1 - (v - y0) / Math.max(1e-9, y1 - y0)) * plotH;

  const { values: yTicks, step: yStep } = niceTicks(y0, y1, 4);
  const { values: xTickVals, step: xStep } = niceTicks(x0, x1, 6);
  const xTicks = useMemo(
    () => thinLabels(xTickVals, (v) => xOf(v), 40),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [xTickVals, w, x0, x1],
  );

  const singletonPoints = new Set(segments.filter((seg) => seg.length === 1).flat());
  const markers = finite.filter((p) => p.dte <= MARKER_MAX_DTE || singletonPoints.has(p));

  // Slope chips (R2.3): the two segments a desk actually quotes — front→~30d and
  // ~30d→~90d, in vol points. Suppressed when the curve lacks the anchor tenors.
  const slopes = useMemo(() => {
    if (admission.conflictExpiries.size > 0 || pts.length < 2) return [] as { key: "termSlopeFront" | "termSlopeBack"; v: number; from: number; to: number }[];
    const nearest = (target: number) =>
      pts.reduce((a, b) => (Math.abs(b.dte - target) < Math.abs(a.dte - target) ? b : a));
    const front = pts[0];
    const d30 = nearest(30);
    const d90 = nearest(90);
    const out: { key: "termSlopeFront" | "termSlopeBack"; v: number; from: number; to: number }[] = [];
    if (d30 !== front && Math.abs(d30.dte - 30) <= 15 && Number.isFinite(front.v) && Number.isFinite(d30.v)) out.push({ key: "termSlopeFront", v: d30.v - front.v, from: front.dte, to: d30.dte });
    if (d90 !== d30 && Math.abs(d90.dte - 90) <= 45 && Number.isFinite(d30.v) && Number.isFinite(d90.v)) out.push({ key: "termSlopeBack", v: d90.v - d30.v, from: d30.dte, to: d90.dte });
    return out;
  }, [admission.conflictExpiries, pts]);

  const fmtSlope = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;

  return (
    <section className="fin-card" style={{ minWidth: 0 }}>
      <div className="fin-card-h" style={{ flexWrap: "wrap" }}>
        <span>{t("termTitle")}</span>
        {structure && (
          <span
            style={NEUTRAL_CHIP}
            aria-label={t("termChipAria")
              .replace("{front}", structure.front.v.toFixed(1))
              .replace("{far}", structure.far.v.toFixed(1))
              .replace("{frontDte}", String(structure.front.dte)).replace("{farDte}", String(structure.far.dte))}
          >
            {t(structure.key)}
          </span>
        )}
        {slopes.map((s) => (
          <span key={s.key} style={{ ...NEUTRAL_CHIP, fontVariantNumeric: "tabular-nums" }}>
            {t("termSlopeActual").replace("{v}", fmtSlope(s.v)).replace("{from}", String(s.from)).replace("{to}", String(s.to))}
          </span>
        ))}
      </div>
      {conflictSummary && (
        <div data-testid="term-conflict-status" role="status" style={CONFLICT_NOTE}>
          {conflictSummary}
        </div>
      )}
      {onSelectExp && (pts.length > 0 || selectedUnavailable) && (
        <div role="group" aria-label={t("termExpAria")} style={EXPIRY_ROW}>
          <span style={EXPIRY_LABEL}>{t("termExpControl")}</span>
          <select
            data-testid="term-expiry-select"
            aria-label={t("termExpAria")}
            value={selectedExpiry ?? pts[0]?.exp ?? ""}
            onChange={(event) => onSelectExp(event.target.value)}
            style={EXPIRY_SELECT}
          >
            {selectedUnavailable && (
              <option value={selectedExpiry!}>
                {selectedExpiry} · {t("termExpUnavailable")}
              </option>
            )}
            {pts.map((p) => (
              <option key={p.exp} value={p.exp}>
                {p.exp} · {p.dte}D · {Number.isFinite(p.v) ? fmtPct(p.v) : t("termExpUnavailable")}
              </option>
            ))}
          </select>
          <span style={EXPIRY_COUNT}>{t("termExpCount").replace("{n}", String(pts.length))}</span>
        </div>
      )}
      <div ref={boxRef} style={{ width: "100%", minWidth: 0 }}>
        {!drawable ? (
          <PanelEmpty title={t("termEmptyTitle")} why={t("termEmptyWhy")} minHeight={H} />
        ) : (
          <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img" aria-label={conflictSummary ? `${t("termTitle")}. ${conflictSummary}` : t("termTitle")}>
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
            {/* x-axis caption — INSIDE the plot band: at PLOT_PAD.t−2 the 9px em-box
                top sat at y≈1 and fonts with taller ascents clipped at the SVG edge. */}
            <text x={w - PLOT_PAD.r} y={PLOT_PAD.t + 10} textAnchor="end" style={REF_TXT}>
              {t("termXAxis")}
            </text>
            {segments.map((seg, index) => <path key={index}
              d={seg.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.dte).toFixed(1)},${yOf(p.v).toFixed(1)}`).join("")}
              fill="none"
              stroke="var(--brand-2)"
              strokeWidth={1.6}
              strokeLinejoin="round"
              strokeLinecap="round"
            />)}
            {markers.map((p) => {
              const selected = p.exp === selectedExp;
              return (
                <circle
                  key={`${p.dte}:${p.exp}`}
                  cx={xOf(p.dte)}
                  cy={yOf(p.v)}
                  r={selected ? 5 : 3}
                  fill={selected ? "var(--panel)" : "var(--brand-2)"}
                  stroke="var(--brand-2)"
                  strokeWidth={selected ? 2 : 0}
                />
              );
            })}
          </svg>
        )}
      </div>
      <ProvenanceLine lang={lang} />
    </section>
  );
}

const CONFLICT_NOTE: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 10.5,
  lineHeight: 1.45,
  color: "var(--warn)",
};

const EXPIRY_ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  margin: "0 0 8px",
};

const EXPIRY_LABEL: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  color: "var(--text-2)",
};

const EXPIRY_SELECT: React.CSSProperties = {
  minWidth: 0,
  width: "100%",
  gridColumn: "1 / -1",
  height: 36,
  padding: "0 30px 0 10px",
  background: "var(--panel-2)",
  color: "var(--text)",
  border: "1px solid var(--line-3)",
  borderRadius: "var(--r-md)",
  fontSize: 11.5,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
};

const EXPIRY_COUNT: React.CSSProperties = {
  fontSize: 10,
  color: "var(--muted)",
  whiteSpace: "nowrap",
};
