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
  ProvenanceLine, PanelEmpty, PLOT_PAD, AXIS_TXT, REF_TXT, NEUTRAL_CHIP,
} from "./volShared";

// Local override, not MIN_CHART_H.axis (190) — see the matching comment in
// VolHistoryPanel.tsx: 244 is the height that makes this card's TOTAL land
// equal to VolHistoryPanel (H=250) and VolVrpPanel (H=169) once each panel's
// own chrome (header/chip row, provenance line) is accounted for.
const H = 244;
const MARKER_MAX_DTE = 60;

interface Pt { dte: number; exp: string; v: number }

export function VolTermPanel({
  term,
  lang,
}: {
  term: VolTermRow[] | undefined;
  lang: Lang;
}) {
  const t = makeVolT(lang);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const w = useChartWidth(boxRef);

  const pts = useMemo<Pt[]>(() => {
    const out: Pt[] = [];
    for (const r of term ?? []) {
      const dte = Number(r?.dte);
      const v = Number(r?.atm_iv);
      if (!Number.isFinite(dte) || dte < 0 || !Number.isFinite(v)) continue;
      out.push({ dte, exp: typeof r.exp === "string" ? r.exp : "", v });
    }
    out.sort((a, b) => a.dte - b.dte);
    return out;
  }, [term]);

  const drawable = pts.length >= 2;

  // Structure chip: front vs nearest-to-90d. Suppressed unless both exist and differ.
  const structure = useMemo<{ key: "termContango" | "termInverted"; front: Pt; far: Pt } | null>(() => {
    if (pts.length < 2) return null;
    const front = pts[0];
    let far = pts[0];
    for (const p of pts) {
      if (Math.abs(p.dte - 90) < Math.abs(far.dte - 90)) far = p;
    }
    if (far === front || far.v === front.v) return null;
    return { key: front.v < far.v ? "termContango" : "termInverted", front, far };
  }, [pts]);

  const [x0, x1] = useMemo(() => {
    if (!drawable) return [0, 1] as [number, number];
    return padDomain(pts[0].dte, pts[pts.length - 1].dte, { padFrac: 0.04, clampMin: 0 });
  }, [pts, drawable]);

  const [y0, y1] = useMemo(() => {
    if (!drawable) return [0, 1] as [number, number];
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
    return padDomain(lo, hi, { clampMin: 0 });
  }, [pts, drawable]);

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

  const markers = pts.filter((p) => p.dte <= MARKER_MAX_DTE);

  // Slope chips (R2.3): the two segments a desk actually quotes — front→~30d and
  // ~30d→~90d, in vol points. Suppressed when the curve lacks the anchor tenors.
  const slopes = useMemo(() => {
    if (pts.length < 2) return [] as { key: "termSlopeFront" | "termSlopeBack"; v: number }[];
    const nearest = (target: number) =>
      pts.reduce((a, b) => (Math.abs(b.dte - target) < Math.abs(a.dte - target) ? b : a));
    const front = pts[0];
    const d30 = nearest(30);
    const d90 = nearest(90);
    const out: { key: "termSlopeFront" | "termSlopeBack"; v: number }[] = [];
    if (d30 !== front && Math.abs(d30.dte - 30) <= 15) out.push({ key: "termSlopeFront", v: d30.v - front.v });
    if (d90 !== d30 && Math.abs(d90.dte - 90) <= 45) out.push({ key: "termSlopeBack", v: d90.v - d30.v });
    return out;
  }, [pts]);

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
              .replace("{far}", structure.far.v.toFixed(1))}
          >
            {t(structure.key)}
          </span>
        )}
        {slopes.map((s) => (
          <span key={s.key} style={{ ...NEUTRAL_CHIP, fontVariantNumeric: "tabular-nums" }}>
            {t(s.key).replace("{v}", fmtSlope(s.v))}
          </span>
        ))}
      </div>
      <div ref={boxRef} style={{ width: "100%", minWidth: 0 }}>
        {!drawable ? (
          <PanelEmpty title={t("termEmptyTitle")} why={t("termEmptyWhy")} minHeight={H} />
        ) : (
          <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img" aria-label={t("termTitle")}>
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
            <path
              d={pts.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.dte).toFixed(1)},${yOf(p.v).toFixed(1)}`).join("")}
              fill="none"
              stroke="var(--brand-2)"
              strokeWidth={1.6}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {markers.map((p) => (
              <circle key={`${p.dte}:${p.exp}`} cx={xOf(p.dte)} cy={yOf(p.v)} r={3} fill="var(--brand-2)" />
            ))}
          </svg>
        )}
      </div>
      <ProvenanceLine lang={lang} />
    </section>
  );
}
