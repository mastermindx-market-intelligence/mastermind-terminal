"use client";
/**
 * StrikeEvolutionModal — the "Intraday Evolution" drill for a single strike (RECON §4.2),
 * in our design language. Opened by clicking a strike row in the SurfacePane.
 *
 * Shows:
 *   - a Lightweight-Charts line of that strike's active-metric value across the session's
 *     realized stamps, with a NOW marker at the last realized column. The frame passed in is
 *     already server-truncated to the replay-scrubbed stamp, so the line is replay-aware by
 *     construction (left of NOW = realized) — no forward projection is fabricated.
 *   - a horizontal "Expiry breakdown at NOW" bar list, when the matrix payload carries
 *     per-expiry cells for this strike (else the section is omitted, never faked).
 *   - a footer: spot · stamp count · Esc-to-close.
 *
 * The native modal contains focus and sits above the chart and sticky navigation.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import ui from "./SurfaceWorkspace.module.css";
import {
  createChart,
  LineSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { Lang } from "@/lib/i18n";
import {
  buildStrikeSeries,
  expiryPanelState,
  topExpiriesForStrike,
  type SurfaceFrame,
  type MatrixCell,
} from "@/lib/surfaceContract";
import { sessionEpoch } from "@/lib/intradayShared";
import { makeSurfaceT } from "./surfaceStrings";

interface Props {
  frame: SurfaceFrame;
  /** Underlying root — the symbol an alert created from this drill is filed against. */
  root: string;
  strikeIdx: number;
  onSelectStrike: (index: number) => void;
  metric: string;
  metricLabel: string;
  /** Column index the replay is scrubbed to; null = use the (already-truncated) frame as-is. */
  scrubbedTimeIdx: number | null;
  matrixCells: MatrixCell[] | null;
  matrixSession: string | null;
  asofLabel: string;
  lang: Lang;
  /**
   * B4 — is the replay sitting at the head? The per-expiry matrix is a SINGLE head-of-day
   * fetch keyed on root, so it always describes the present. When the user has scrubbed
   * back, present-time expiry shares are not what was true at that moment, and there is no
   * stored per-stamp matrix to substitute. So the panel withdraws and says why rather than
   * captioning today's split "at NOW" over a replayed moment.
   */
  replayLive: boolean;
  pinned?: boolean;
  onTogglePin?: (strike: number, metric: string, value: number | null) => void;
  onClose: () => void;
}

function css(n: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}

function fmtDollarSigned(v: number): string {
  const s = v < 0 ? "-" : "+";
  const a = Math.abs(v);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}

export function StrikeEvolutionModal({
  frame, root, strikeIdx, onSelectStrike, metric, metricLabel, scrubbedTimeIdx, matrixCells, matrixSession, asofLabel, lang,
  replayLive, pinned, onTogglePin, onClose,
}: Props) {
  const t = makeSurfaceT(lang);
  const chartWrap = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Alert-from-drill state. `needsAuth` is set from the API's own 401 — the hub carries no
  // session prop, so the request itself is what tells us the user is signed out.
  const [alertDirection, setAlertDirection] = useState<"above" | "below" | null>(null);
  const [alertState, setAlertState] = useState<"idle" | "busy" | "done" | "error" | "auth">("idle");

  const series = useMemo(
    () => buildStrikeSeries(frame, strikeIdx, metric, scrubbedTimeIdx),
    [frame, strikeIdx, metric, scrubbedTimeIdx],
  );

  // Expiry breakdown at NOW — top expiries for this strike from the matrix cells (optional).
  const topExpiries = useMemo(
    () => topExpiriesForStrike(matrixCells, series.strike),
    [matrixCells, series.strike],
  );
  const expMaxAbs = useMemo(
    () => topExpiries.reduce((m, e) => Math.max(m, Math.abs(e.gex)), 0.0001),
    [topExpiries],
  );
  // B4: "none" omit · "live" show the bars · "stale" withdraw them with a plain-word reason.
  const expiryState = expiryPanelState(topExpiries.length, replayLive);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);

  const hasObservations = series.points.some(point => point.v != null);
  // ── LWC line: strike's metric value across realized stamps + NOW marker ──────
  useEffect(() => {
    const el = chartWrap.current;
    if (!el || !hasObservations) return;

    const date = frame.session_date ?? new Date().toISOString().slice(0, 10);
    // Same display-epoch convention as the pane and the candle feed (B11) — see
    // lib/intradayShared sessionEpoch.
    const toTs = (hhmm: string): Time => sessionEpoch(date, hhmm) as unknown as Time;

    const chart: IChartApi = createChart(el, {
      width: el.clientWidth || 700,
      height: el.clientHeight || 260,
      layout: { background: { color: "transparent" }, textColor: css("--muted") || "#868d9c", fontSize: 10, attributionLogo: false },
      grid: {
        vertLines: { color: css("--grid") || "rgba(255,255,255,0.04)" },
        horzLines: { color: css("--grid") || "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        vertLine: { color: "rgba(214,218,227,.3)", labelBackgroundColor: css("--panel-3") || "#1a1d24" },
        horzLine: { color: "rgba(214,218,227,.3)", labelBackgroundColor: css("--panel-3") || "#1a1d24" },
      },
      rightPriceScale: { borderColor: css("--line") || "#242832", scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: css("--line") || "#242832", timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: (v: number) => fmtDollarSigned(v) },
    });

    // The line color follows sign at NOW (up when the current value is ≥0, else down) — a
    // directional read of the strike's exposure, so it honors the East-Asian flip via tokens.
    // The fallback is deliberately NEUTRAL: a hardcoded green/red here would survive a
    // failed resolve and paint the wrong side under html[data-updown="east"].
    const lineColor = css(series.nowValue == null ? "--text-2" : series.nowValue >= 0 ? "--up" : "--down") || "#9ba3b4";
    const line: ISeriesApi<"Line"> = chart.addSeries(LineSeries, {
      color: lineColor, lineWidth: 2 as never, priceLineVisible: false, lastValueVisible: true, title: metricLabel,
    });
    line.setData(series.points.map(p => p.v == null ? { time: toTs(p.t) } : { time: toTs(p.t), value: p.v }));

    // Zero baseline (sign flips are the read) + NOW marker at the last realized column.
    try {
      line.createPriceLine({ price: 0, color: "rgba(214,218,227,.22)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false } as never);
    } catch {}
    if (series.nowT && series.nowValue != null) {
      try {
        createSeriesMarkers(line, [{
          time: toTs(series.nowT),
          position: "inBar",
          color: css("--signal") || "#e8b339",
          shape: "circle",
          text: `${series.nowT} ET`,
        }] as never);
      } catch {}
    }

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (el) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      try { chart.remove(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, metricLabel, lang, hasObservations]);

  const strikeDisp = Number.isFinite(series.strike) ? series.strike : "—";
  const spotDisp = Number.isFinite(frame.spot) ? frame.spot : null;

  // ── Alert from the drill ─────────────────────────────────────────────────────
  // Uses the SAME endpoint and condition shape AlertsView posts (`{symbol, condition}`
  // with `{type:"price", op, value}`) — the only condition the alerts engine carries that
  // takes an arbitrary level, which is exactly what a strike is. The options-flow condition
  // kinds (opt_wall_touch and friends) are root-level and have no strike parameter, so
  // prefilling a strike into one of them is not expressible; nothing in lib/optionsAlerts
  // is touched here.
  // Direction follows the strike's side of spot: a level above spot is something price has
  // to rise into, below is something it has to fall into.
  const direction = alertDirection ?? (spotDisp == null ? null : series.strike >= spotDisp ? "above" : "below");
  async function createStrikeAlert() {
    if (!direction || alertState === "busy" || alertState === "done" || !Number.isFinite(series.strike)) return;
    setAlertState("busy");
    try {
      const r = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: root,
          condition: { type: "price", op: direction, value: series.strike },
        }),
      });
      if (r.status === 401 || r.status === 403) { setAlertState("auth"); return; }
      const d = await r.json().catch(() => ({}));
      setAlertState(r.ok && d?.alert ? "done" : "error");
    } catch {
      setAlertState("error");
    }
  }

  return (
    <dialog ref={dialogRef} className={`obs-modal obs ${ui.strikeDialog}`}
      aria-label={`${t("evoTitle")} · ${root} · ${strikeDisp}`}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onKeyDown={event => event.stopPropagation()}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
        <div className={ui.inspectionHead}>
          <span className={`obs-lbl ${ui.inspectionContext}`}>
            {root} · {t("evoTitle")} {frame.session_date && <time dateTime={frame.session_date}>· {frame.session_date}</time>}
          </span>
          <label className={ui.strikeLabel}>
              <span>{t("selectStrike")}</span>
              <select value={strikeIdx} disabled={alertState === "busy"} onChange={event => {
                setAlertDirection(null);
                setAlertState("idle");
                onSelectStrike(Number(event.target.value));
              }}>
                {frame.price_levels.map((strike, index) => Number.isFinite(strike) &&
                  <option key={index} value={index}>{strike}</option>)}
              </select>
          </label>
          <div className={ui.inspectionValue}>
            <span>{t("strikeValueAt").replace("{metric}", metricLabel).replace("{time}", frame.time_steps.at(-1) ?? "—")}</span>
            <strong>{series.nowValue == null ? "—" : fmtDollarSigned(series.nowValue)}</strong>
          </div>
          <button ref={closeRef} className="obs-modal-close" style={CLOSE_BTN}
            onClick={onClose} aria-label={t("evoCloseAria")}>{t("evoClose")}</button>
        </div>

        {/* Body */}
        <div className="obs-modal-body">
          {hasObservations ? (
            <div className="obs-modal-chart" ref={chartWrap} />
          ) : (
            /* Honest empty: name the state and why it is empty for THIS strike. */
            <div className="obs-xdrawer-empty">
              <div style={EMPTY_TITLE}>{t("evoNoSeries")}</div>
              <div style={EMPTY_WHY}>{t("evoNoSeriesWhy")}</div>
            </div>
          )}

          {/* B4 — Expiry breakdown. The matrix is a single head-of-day fetch, so it is a
              PRESENT-TIME split. Live: label it "at NOW" as before. Replayed: withdraw the
              bars and say plainly that this reading isn't stored for past moments. Showing
              today's shares under an "at NOW" caption while the user is scrubbed back would
              be a silent point-in-time lie. */}
          {expiryState === "stale" && (
            <div style={{ marginTop: 14 }}>
              <div className="obs-lbl" style={{ marginBottom: 7, display: "flex", alignItems: "center", gap: 7 }}>
                {t("evoExpiryReplayTitle")}
                <span className="obs-surf-replay-badge">{t("evoReplayBadge")}</span>
              </div>
              <div className="obs-xdrawer-empty" style={{ fontSize: 11.5, textAlign: "left", padding: "9px 11px" }}>
                {t("evoExpiryReplayNote")}
              </div>
            </div>
          )}
          {expiryState === "live" && (
            <div style={{ marginTop: 14 }}>
              <div className="obs-lbl" style={{ marginBottom: 7 }}>{t("matrixGexByExpiry")} · {matrixSession}</div>
              <span className={ui.matrixBasis}>{t("matrixGexShare")}</span>
              {topExpiries.map((e) => {
                const frac = Math.abs(e.gex) / expMaxAbs;
                const isPos = e.gex >= 0;
                return (
                  <div className="obs-modal-exp-row" key={e.exp}>
                    <span className="obs-modal-exp-lbl num">{e.exp.length >= 10 ? e.exp.slice(5, 10) : e.exp}</span>
                    <span className="obs-modal-exp-track">
                      <span
                        className="obs-modal-exp-bar"
                        style={{
                          left: isPos ? "50%" : undefined,
                          right: isPos ? undefined : "50%",
                          width: `${Math.max(frac * 50, frac > 0 ? 1.5 : 0)}%`,
                          background: isPos ? "var(--up)" : "var(--down)",
                        }}
                      />
                    </span>
                    <span className="obs-modal-exp-val num" style={{ color: isPos ? "var(--up)" : "var(--down)" }}>
                      {fmtDollarSigned(e.gex)} <span className="num" style={{ color: "var(--muted)", fontWeight: 400 }}>{(e.share * 100).toFixed(0)}%</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Actions: take this strike somewhere ────────────────────────────── */}
          <div className="obs-modal-actions">
            {onTogglePin && (
              <button
                type="button"
                className={`obs-chip${pinned ? " on" : ""}`}
                style={ACTION_CHIP}
                aria-pressed={!!pinned}
                onClick={() => onTogglePin(series.strike, metric, series.nowValue)}
              >
                {pinned ? t("pinnedUnpin") : t("pinToChart")}
              </button>
            )}

            <details className={ui.alertDetails}>
              <summary>{t("priceAlert")}</summary>
              <div className={ui.alertCondition}>
                <b>{root}</b>
                <select aria-label={t("alertCondition")} value={direction ?? ""}
                  disabled={alertState === "busy"} onChange={event => {
                    const next = event.target.value;
                    if (next !== "above" && next !== "below") return;
                    setAlertDirection(next);
                    setAlertState("idle");
                  }}>
                  {!direction && <option value="">{t("chooseDirection")}</option>}
                  <option value="above">{t("alertAbove")}</option>
                  <option value="below">{t("alertBelow")}</option>
                </select>
                <b className="num">{strikeDisp}</b>
                <button type="button" className="obs-chip" style={ACTION_CHIP}
                  disabled={!direction || alertState === "busy" || alertState === "done"} onClick={createStrikeAlert}>
                  {alertState === "busy" ? t("alertCreating") : alertState === "done" ? t("alertCreated") : t("createAlert")}
                </button>
              </div>
            {/* Anon: the POST's own 401 is what tells us — the hub carries no session prop.
                Same nudge shape the rest of the terminal uses. */}
            {alertState === "auth" && (
              <span className="obs-modal-actions-note">
                {t("alertSignIn")}{" "}
                <a href="/login" className="obs-modal-actions-cta">{t("alertSignInCta")}</a>
              </span>
            )}
            {alertState === "error" && (
              <span className="obs-modal-actions-note" style={{ color: "var(--down)" }}>{t("alertFailed")}</span>
            )}
            {alertState === "done" && (
              <a href="/alerts" className="obs-modal-actions-cta">{t("alertManage")}</a>
            )}
            </details>
          </div>
        </div>

        {/* Footer: provenance (source · spot · stamp count · as-of) then the Esc hint */}
        <div className="obs-modal-foot">
          <span style={{ color: "var(--muted)" }}>{t(metric === "netprem" ? "sourceOpra" : "sourceGreek")}</span>
          {spotDisp != null && (
            <span>· {t("evoSpot")} <b className="num" style={{ color: "var(--text)" }}>{spotDisp}</b></span>
          )}
          <span>· <b className="num" style={{ color: "var(--text)" }}>{series.total}</b> {t("evoSnapshots")}</span>
          {asofLabel && <span style={{ color: "var(--muted)" }}>· {t("asOf")} {asofLabel}</span>}
          <span className={ui.escapeHint}>{t("evoEscHint")}</span>
        </div>
    </dialog>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CLOSE_BTN: React.CSSProperties = {
  height: 40, minWidth: 44, padding: "0 var(--sp-4)",
  borderRadius: "var(--r-tile)", fontSize: "var(--fs-ui)", fontWeight: 600,
};

const ACTION_CHIP: React.CSSProperties = {
  height: 32, fontSize: "var(--fs-label)", fontWeight: 600, padding: "0 var(--sp-3)",
};

const EMPTY_TITLE: React.CSSProperties = {
  fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text-2)",
};

const EMPTY_WHY: React.CSSProperties = {
  marginTop: "var(--sp-1)", fontSize: "var(--fs-label)", lineHeight: 1.55, color: "var(--muted)",
};
