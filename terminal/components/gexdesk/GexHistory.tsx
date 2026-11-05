/**
 * GexHistory.tsx — scrubbable net-GEX history strip for the Exposure Desk.
 *
 * Slice 1 surfaced the GexPayload `history[]` (net_gex_bn + gamma_flip + walls + regime per
 * session) as a static sparkline. Slice 2 turns it into a SESSION SCRUBBER: hover / drag /
 * arrow keys move a cursor across sessions and read out that session's settled structure
 * (net-GEX, gamma-flip, call/put walls, γ-polarity) with the per-session change. This is
 * "playback on the EOD data we already own" — every value is a real archived session, no
 * reconstruction, no empty states.
 *
 * Honesty / regime-dynamics doctrine:
 *   - The γ-polarity chip never stands alone — it always rides next to the net value (level),
 *     its Δ vs the prior session (velocity), and the sparkline shape (trend).
 *   - The net line + selected dot are a neutral brand color: GEX sign is a dealer-convention
 *     ASSUMPTION, not price direction, so a rising net-GEX is not "bullish" → the Δ arrow is
 *     neutral too (never var(--up)/var(--down)).
 *   - Display-only. Full by-strike ladders per past date are a separate follow-on (needs the
 *     macro EOD-surface backfill); this slice plays back the scalar structure we already ship.
 *
 * v7b chart pass — this strip now obeys components/charts/svgChart.ts:
 *   R1  the svg is measured (useChartWidth) and emits viewBox 0 0 W H with width/height=W/H,
 *       so one user unit is one CSS pixel — the selection marker is a round dot again and the
 *       trend stroke is a uniform 2.2px instead of fattening on steep segments.
 *   R2  preserveAspectRatio="none" is gone (it was the distortion source).
 *   R4  the plot band is 120px, the sparkline floor — 88px could not carry a line plus ticks.
 *   R5  gridlines are VALUE ticks from niceTicks()/fmtTick(step), labelled in the right gutter.
 *       They used to sit at 25/50/75% of panel height: pure decoration, no data meaning.
 *   R7  the domain comes from padDomain(); zero is unioned only when the series straddles it,
 *       and non-finite sessions are filtered out before the extents are taken.
 *   R9  every var() inside the card's background gradient carries a fallback.
 * The endpoint dots at index 0 / lastIdx are no longer half-clipped: the plot is inset by
 * PAD_L/PAD_R, which also buys the right gutter the tick labels live in.
 */
import React, { memo, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { makeGexT } from "./gexStrings";
import type { GexPayload } from "./GexDeskView";
import { fmtTick, niceTicks, padDomain, useChartWidth } from "@/components/charts/svgChart";

const WRAP: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 9,
  padding: "11px 14px 12px", border: "1px solid var(--line)", borderRadius: "var(--r-card, 14px)",
  /* R9: an undefined token inside linear-gradient() kills the WHOLE declaration — this card
     used to render with no background at all because of `var(--surface-1)`, which nothing
     defines. Every stop now names a real token and carries a literal fallback. */
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--brand, #2962ff) 4%, var(--panel, #0d0f13)), var(--panel-2, #15171d))",
};
const HEADER: React.CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 };
const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: "var(--text-2)", textTransform: "uppercase" };
const HEADER_RIGHT: React.CSSProperties = { display: "flex", alignItems: "baseline", gap: 8 };
const SESSIONS: React.CSSProperties = { fontSize: 10, color: "var(--muted)", fontVariantNumeric: "tabular-nums" };
const HINT: React.CSSProperties = { fontSize: 10, color: "var(--muted)", opacity: 0.8 };
const ROW: React.CSSProperties = { display: "flex", alignItems: "stretch", gap: 18 };
const HISTORY_HEIGHT = 120;
/* R1: the MEASURED element. Carries the track's flex sizing; the svg inside it is drawn at
   this box's own pixel width. min() so a 375px phone never gets a horizontal scrollbar. */
const TRACK_WRAP: React.CSSProperties = { flex: 1, minWidth: "min(300px, 100%)", minHeight: 0 };
const TRACK: React.CSSProperties = { display: "block", cursor: "ew-resize", outlineOffset: 2, touchAction: "none" };
const READOUT: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "1fr", alignContent: "center", gap: 3,
  flexShrink: 0, width: 210, height: HISTORY_HEIGHT, boxSizing: "border-box", padding: "7px 10px",
  border: "1px solid var(--line-2)", borderRadius: "var(--r-tile, 10px)", background: "rgba(255,255,255,.025)",
};
const READOUT_HEAD: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, minWidth: 0, marginBottom: 1,
};
const RDATE: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" };
const NOW_BADGE: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
  color: "var(--brand-2)", border: "1px solid var(--brand-2)", borderRadius: 4, padding: "0 4px", lineHeight: "13px",
};
const STAT: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 11 };
const STAT_K: React.CSSProperties = { color: "var(--muted)" };
const STAT_V: React.CSSProperties = { fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--text)" };
const DELTA: React.CSSProperties = { marginLeft: 6, color: "var(--muted)", fontSize: 10, fontWeight: 600, fontVariantNumeric: "tabular-nums" };
const REGIME_V: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 700, fontSize: 11, color: "var(--text)" };
const SHIFT_DOT: React.CSSProperties = { color: "var(--warn)", fontSize: 12, lineHeight: 1 };
const RANGE: React.CSSProperties = { fontSize: 10, color: "var(--muted)", fontVariantNumeric: "tabular-nums" };
/* Honest-thin state: the strip keeps its header and says WHICH condition it is in, instead of
   the whole section silently vanishing (the old `return null`). */
const THIN: React.CSSProperties = {
  display: "flex", flexDirection: "column", justifyContent: "center", gap: 4,
  minHeight: 64, padding: "10px 2px",
};
const THIN_WHY: React.CSSProperties = { fontSize: 10.5, color: "var(--muted)", lineHeight: 1.5, maxWidth: 460 };
/* Dated-replay controls (R0.10). The select mirrors the ticker input's inset idiom at the
   strip's compact scale; the load button is a quiet bordered action, not a primary CTA —
   replay is an inspection tool, not a headline feature. */
const PICKER: React.CSSProperties = {
  height: 24, padding: "0 6px", fontSize: 10.5, fontWeight: 600,
  background: "var(--inset)", color: "var(--text)",
  border: "1px solid var(--line)", borderRadius: 6, outline: "none",
  fontVariantNumeric: "tabular-nums", maxWidth: 150,
};
const LOAD_BTN: React.CSSProperties = {
  height: 20, padding: "0 7px", fontSize: 9.5, fontWeight: 700, whiteSpace: "nowrap",
  letterSpacing: "0.03em", background: "transparent", color: "var(--brand-2)",
  border: "1px solid var(--brand-2)", borderRadius: 6, cursor: "pointer",
};
const VIEWING_TAG: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: "0.03em", whiteSpace: "nowrap",
  color: "var(--warn)",
};

/** Level formatter: drop a trailing ".0" on round strikes, else one decimal. */
const fmtLvl = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const fmtBn = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

// Plot band geometry (CSS px — the viewBox is 1:1, R1).
const H = HISTORY_HEIGHT; // R4: sparkline floor and fixed readout footprint
const PAD_L = 8;    // keeps the index-0 endpoint dot off the left edge
const PAD_R = 40;   // right gutter: tick value labels live here
const PAD_T = 10;
const PAD_B = 10;

export const GexHistory = memo(function GexHistory({
  history,
  lang,
  sessionDates,
  activeSession,
  liveDate,
  onLoadSession,
  historyState,
}: {
  history: GexPayload["history"];
  lang: Lang;
  /**
   * Set while the live payload that carries `history` is not in hand: "pending" while it
   * is being read, "unavailable" when the read did not land. Either way an empty strip is
   * not "no settled sessions" — nothing was read to count.
   */
  historyState?: "pending" | "unavailable";
  /**
   * Dated-replay wiring (R0.10) — all optional so the strip renders unchanged where the
   * desk doesn't offer replay. `sessionDates` is the gex_history dates.json index
   * (newest-first, validated by isGexDates upstream; null = index absent → dropdown
   * hidden, the readout's explicit per-date probe remains). `liveDate` is the live
   * payload's own session, filtered out of the dropdown (loading it would just replay
   * the present). `onLoadSession(null)` returns to live.
   */
  sessionDates?: string[] | null;
  activeSession?: string | null;
  liveDate?: string | null;
  onLoadSession?: (date: string | null) => void;
}) {
  const t = makeGexT(lang);
  // R7: non-finite sessions are dropped BEFORE the extents are taken — one NaN used to drag
  // the whole domain to NaN and blank the strip.
  const rows = (history ?? []).filter((h) => h && h.net_gex_bn != null && Number.isFinite(h.net_gex_bn));
  // `null` selection resolves to the latest session, so the strip reads "now" at rest and a
  // pointer-leave (setSel(null)) returns there. Hooks run before the thin-history branch.
  const [sel, setSel] = useState<number | null>(null);
  // The wrapper this ref points at is rendered in BOTH branches — svgChart's observer only
  // attaches once, so a track that exists only in the "has data" branch would stay pinned at
  // the fallback width forever.
  const trackRef = useRef<HTMLDivElement | null>(null);
  const W = useChartWidth(trackRef, 720);

  const hasSeries = rows.length >= 2;
  const lastIdx = Math.max(0, rows.length - 1);
  const selIdx = sel == null ? lastIdx : Math.max(0, Math.min(sel, lastIdx));
  const cur = hasSeries ? rows[selIdx] : null;
  const prev = hasSeries && selIdx > 0 ? rows[selIdx - 1] : null;
  const dNet = cur && prev ? cur.net_gex_bn - prev.net_gex_bn : null;
  const isNow = selIdx === lastIdx;

  // R7: padded domain, zero unioned only when the series actually straddles it (net-GEX sign
  // is meaningful, but an all-positive series should not spend half the panel on empty space).
  const vals = rows.map((h) => h.net_gex_bn);
  const [mn, mx] = hasSeries
    ? padDomain(Math.min(...vals), Math.max(...vals), { padFrac: 0.10, includeZero: true })
    : [0, 1];
  const range = mx - mn || 1;
  const plotW = Math.max(1, W - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const px = (i: number) => PAD_L + (lastIdx > 0 ? (i / lastIdx) * plotW : plotW / 2);
  const py = (v: number) => PAD_T + (1 - (v - mn) / range) * plotH;
  // Area baseline: the zero line when it is on-panel, otherwise the nearer domain edge — an
  // off-panel baseline used to drag the fill off the plot entirely on a one-sided series.
  const zeroInView = mn <= 0 && mx >= 0;
  const baseY = py(Math.min(Math.max(0, mn), mx));
  const pts = rows.map((h, i) => `${px(i).toFixed(1)},${py(h.net_gex_bn).toFixed(1)}`).join(" ");
  const areaPts = `${PAD_L.toFixed(1)},${baseY.toFixed(1)} ${pts} ${(PAD_L + plotW).toFixed(1)},${baseY.toFixed(1)}`;
  // R5: real value gridlines. The old lines sat at 25/50/75% of panel height — decoration with
  // no data meaning and no labels. Precision comes from the STEP, so two ticks can't collide.
  const { values: tickVals, step: tickStep } = niceTicks(mn, mx, 3);

  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    if (!r.width || lastIdx <= 0) return 0;
    // The viewBox is 1:1 with CSS px (R1); the scale term only matters if a parent ever
    // CSS-transforms the pane. The PAD_L/plotW terms are what keep the dot under the cursor
    // now that the plot is inset — without them the pick drifts ~1 session at the right edge.
    const scale = r.width / W || 1;
    const frac = ((clientX - r.left) / scale - PAD_L) / plotW;
    return Math.max(0, Math.min(lastIdx, Math.round(frac * lastIdx)));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    let n = selIdx;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") n = selIdx - 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") n = selIdx + 1;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = lastIdx;
    else return;
    e.preventDefault();
    setSel(Math.max(0, Math.min(lastIdx, n)));
  };

  const regimeLabel = (r: string) => {
    const k = (r || "").toLowerCase();
    if (k === "long" || k === "positive" || k === "long-gamma") return t("gexHistRegimeLong");
    if (k === "short" || k === "negative" || k === "short-gamma") return t("gexHistRegimeShort");
    return t("gexHistRegimeFlat");
  };
  const regimeShifted = !!prev && !!cur && prev.regime !== cur.regime;

  // Dropdown dates: the index minus the live session (loading "today" as an archive is a
  // no-op wearing a chip). The dropdown enumerates ONLY what the index promises — blind
  // probing is the readout button's explicit, one-date-per-click job.
  const pickerDates = (sessionDates ?? []).filter((d) => d !== liveDate);
  const showPicker = !!onLoadSession && pickerDates.length > 0;
  // The scrubbed session can be loaded as a full ladder when it isn't the live one.
  const canLoadCur = !!onLoadSession && !!cur && !isNow && cur.date !== liveDate;
  const curIsActive = !!cur && activeSession === cur.date;

  return (
    <div style={WRAP} className="obs obs-gex-history">
      <div style={HEADER}>
        <span style={LABEL}>{t("gexHistTitle")}</span>
        <span style={HEADER_RIGHT}>
          {showPicker && (
            <select
              style={PICKER}
              value={activeSession ?? ""}
              aria-label={t("sessionPickerAria")}
              onChange={(e) => onLoadSession?.(e.target.value || null)}
            >
              <option value="">{t("sessionLive")}</option>
              {/* A session loaded via the readout probe may be absent from the index
                  (that's the point of the probe) — keep the select honest about it. */}
              {activeSession && !pickerDates.includes(activeSession) && (
                <option value={activeSession}>{activeSession}</option>
              )}
              {pickerDates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
          {hasSeries && <span style={HINT}>{t("gexHistScrubHint")}</span>}
          {!(historyState && rows.length === 0) && (
            <span style={SESSIONS}>{rows.length} {t("gexHistSessions")}</span>
          )}
        </span>
      </div>

      <div style={ROW} className="obs-gex-history-row">
        <div ref={trackRef} style={TRACK_WRAP}>
          {!hasSeries || !cur ? (
            /* Honest thin state — names WHICH condition this is (nothing archived yet vs a
               single settled session) rather than removing the section from the page. */
            historyState && rows.length === 0 ? (
              <div style={THIN}>
                <span className="obs-lbl">
                  {historyState === "pending" ? t("loading") : t("gexHistUnread")}
                </span>
              </div>
            ) : (
              <div style={THIN}>
                <span className="obs-lbl">
                  {rows.length === 0
                    ? t("gexHistThinNone")
                    : t("gexHistThin").replace("{n}", String(rows.length))}
                </span>
                <span style={THIN_WHY}>{t("gexHistThinWhy")}</span>
              </div>
            )
          ) : (
            <svg
              viewBox={`0 0 ${W} ${H}`}
              width={W}
              height={H}
              style={TRACK}
              role="slider"
              tabIndex={0}
              aria-label={t("gexHistAria")}
              aria-valuemin={0}
              aria-valuemax={lastIdx}
              aria-valuenow={selIdx}
              aria-valuetext={`${cur.date} · ${fmtBn(cur.net_gex_bn)}B`}
              onPointerMove={(e) => setSel(pick(e.clientX, e.currentTarget))}
              onPointerDown={(e) => { e.currentTarget.focus(); setSel(pick(e.clientX, e.currentTarget)); }}
              onPointerLeave={() => setSel(null)}
              onKeyDown={onKeyDown}
            >
              <defs>
                <linearGradient id="gex-history-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand-2, #4d82ff)" stopOpacity="0.26" />
                  <stop offset="100%" stopColor="var(--brand-2, #4d82ff)" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {/* R5: value gridlines + right-gutter labels (billions, signed) */}
              {tickVals.map((v) => {
                const y = py(v);
                const isZero = zeroInView && Math.abs(v) < 1e-9;
                return (
                  <g key={v}>
                    {/* the dashed zero rule below already draws this row */}
                    {!isZero && (
                      <line x1={PAD_L} y1={y} x2={PAD_L + plotW} y2={y} stroke="var(--line-2)" strokeWidth="0.7" />
                    )}
                    <text
                      x={PAD_L + plotW + 6}
                      y={y + 3}
                      fill="var(--muted)"
                      fontSize={9}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {`${v >= 0 ? "+" : ""}${fmtTick(v, tickStep)}B`}
                    </text>
                  </g>
                );
              })}
              {/* zero reference — drawn only when zero is actually inside the domain */}
              {zeroInView && (
                <line
                  x1={PAD_L} y1={py(0)} x2={PAD_L + plotW} y2={py(0)}
                  stroke="var(--line-3)" strokeWidth="0.9" strokeDasharray="4,4"
                />
              )}
              <polygon points={areaPts} fill="url(#gex-history-fill)" />
              {/* net-GEX trend (neutral brand — sign is a dealer-convention assumption, not direction) */}
              <polyline fill="none" stroke="var(--brand-2)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" points={pts} />
              {/* scrub cursor + selected session */}
              <line x1={px(selIdx)} y1={PAD_T - 6} x2={px(selIdx)} y2={H - PAD_B + 6} stroke="var(--brand-2)" strokeWidth="1" strokeOpacity="0.48" />
              <circle cx={px(selIdx)} cy={py(cur.net_gex_bn)} r={4.2} fill="var(--panel)" stroke="var(--brand-2)" strokeWidth="2.2" />
              {/* faint marker on the latest point when the cursor is parked in the past */}
              {!isNow && <circle cx={px(lastIdx)} cy={py(rows[lastIdx].net_gex_bn)} r={1.8} fill="none" stroke="var(--brand-2)" strokeWidth="0.8" strokeOpacity="0.6" />}
            </svg>
          )}
        </div>

        {cur && (
          <div style={READOUT} className="obs-gex-history-readout">
            <div style={READOUT_HEAD}>
              <span style={RDATE}>{cur.date}</span>
              {isNow && <span style={NOW_BADGE}>{t("gexHistNow")}</span>}
              {/* Keep replay actions in the existing header row. Rendering them as another
                  grid row made the history card grow whenever the scrubber entered the past,
                  shifting every Exposure section below it. */}
              {canLoadCur && (
                curIsActive ? (
                  <span style={VIEWING_TAG}>{t("viewingSession")}</span>
                ) : (
                  <button style={LOAD_BTN} onClick={() => onLoadSession?.(cur.date)}>
                    {t("loadFullLadder")}
                  </button>
                )
              )}
            </div>
            <span style={STAT}>
              <span style={STAT_K}>{t("sumNetGex")}</span>
              <span style={STAT_V}>
                {fmtBn(cur.net_gex_bn)}B
                {dNet != null && Math.abs(dNet) >= 0.05 && (
                  <span style={DELTA}>{dNet > 0 ? "▲" : "▼"}{Math.abs(dNet).toFixed(1)}</span>
                )}
              </span>
            </span>
            {cur.gamma_flip != null && (
              <span style={STAT}>
                <span style={STAT_K}>{t("gexHistFlip")}</span>
                <span style={{ ...STAT_V, color: "var(--warn)" }}>{fmtLvl(cur.gamma_flip)}</span>
              </span>
            )}
            {cur.call_wall != null && (
              <span style={STAT}>
                <span style={STAT_K}>{t("sumCallWall")}</span>
                <span style={STAT_V}>{fmtLvl(cur.call_wall)}</span>
              </span>
            )}
            {cur.put_wall != null && (
              <span style={STAT}>
                <span style={STAT_K}>{t("sumPutSupport")}</span>
                <span style={STAT_V}>{fmtLvl(cur.put_wall)}</span>
              </span>
            )}
            <span style={STAT}>
              <span style={STAT_K}>{t("stateRegimeLabel")}</span>
              <span style={REGIME_V}>
                {regimeShifted && <span style={SHIFT_DOT} role="img" aria-label={t("gexHistShift")}>•</span>}
                {regimeLabel(cur.regime)}
              </span>
            </span>
          </div>
        )}
      </div>

      {hasSeries && (
        <div style={RANGE}>
          {rows[0].date}{" → "}{rows[lastIdx].date}
        </div>
      )}
    </div>
  );
});
