"use client";
/**
 * VolView — the Volatility tab (R3): per-root IV posture from options_hub.vol/v1.
 *
 * Layout:
 *   Header  — uppercase root input + datalist (shared lib/optionsRoots universe)
 *             + "Nightly EOD · as of {date}" chip (warn tone past 3 sessions).
 *   Panel A — stat tiles: ATM IV / IV Rank 252d / IV Rank all-history /
 *             52-week range with position marker / RV20 / VRP.
 *   Panel B — ATM IV 90-day history line (VolHistoryPanel).
 *   Panel C — term structure with Contango/Inverted chip (VolTermPanel).
 *   Panel D — call/put smile with wing trim + Full chain (VolSkewPanel).
 *
 * Data is NIGHTLY EOD — deliberately no "LIVE" chrome anywhere; the asof chip is
 * the only freshness truth, and every panel carries an options_hub provenance
 * footer. Vol is NON-DIRECTIONAL: neutral brand accents only, never --up/--down.
 *
 * Fetch: ONE flowGet(`vol:{ROOT}`) per committed root (the store publishes once
 * a night — polling would only re-download the same snapshot). A request counter
 * drops stale responses so a slow root can't clobber a newer pick.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flowGet } from "@/lib/flowClientCache";
import { useLang } from "@/lib/i18n";
import { GEX_AUTOCOMPLETE_ROOTS } from "@/lib/optionsRoots";
import { trackSearch } from "@/lib/searchTrack";
import { makeVolT } from "./volStrings";
import type { VolPayload } from "./volTypes";
import { ProvenanceLine, fmtPct, fmtRank } from "./volShared";
import { VolHistoryPanel } from "./VolHistoryPanel";
import { VolVrpPanel } from "./VolVrpPanel";
import type { AggTrendPayload } from "@/lib/aggTrend";
import { VolTermPanel } from "./VolTermPanel";
import { VolSkewPanel } from "./VolSkewPanel";

const DEFAULT_ROOT = "SPY";
const STALE_SESSIONS = 3;

/**
 * ET weekday sessions elapsed since `asofDate` (YYYY-MM-DD). Calendar weekdays
 * stand in for trading sessions (holidays read one high — acceptable for a
 * staleness tone, never shown as a precise trading-day count anywhere else).
 */
function sessionsOld(asofDate: string): number {
  const start = Date.parse(`${asofDate}T00:00:00Z`);
  if (!Number.isFinite(start)) return 0;
  const todayEt = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const end = Date.parse(`${todayEt}T00:00:00Z`);
  if (!Number.isFinite(end) || end <= start) return 0;
  let n = 0;
  const cur = new Date(start);
  for (let guard = 0; guard < 800; guard++) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (cur.getTime() > end) break;
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

export interface VolViewProps {
  rootChoices?: readonly string[];
}

export function VolView({ rootChoices = GEX_AUTOCOMPLETE_ROOTS }: VolViewProps = {}) {
  const { lang } = useLang();
  const t = makeVolT(lang);

  const [root, setRoot] = useState(DEFAULT_ROOT);
  const [inputVal, setInputVal] = useState(DEFAULT_ROOT);
  const [payload, setPayload] = useState<VolPayload | null>(null);
  // `agg:{ROOT}` — the aggregate-trend store, fetched non-gating for the VRP
  // regime band. Optional: its absence hides one panel, never the tab.
  const [agg, setAgg] = useState<AggTrendPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reqRef = useRef(0);

  // One-shot fetch per committed root (nightly store — no polling). The
  // loading/error/payload RESETS live in commitRoot (the event that changes the
  // root) — the effect body itself only starts the async load and resolves its
  // states in the awaited callback, so a slow root can never clobber a newer
  // pick (request counter) and the effect never sets state synchronously.
  useEffect(() => {
    const req = ++reqRef.current;
    void (async () => {
      let data: unknown = null;
      try {
        data = await flowGet(`vol:${root}`);
      } catch {
        data = null;
      }
      if (reqRef.current !== req) return;
      if (data == null) {
        // A null here is almost always an UNCOVERED root (the nightly build's R2 key
        // does not exist → /api/flow 5xx → flowGet null), not a broken desk. On prod
        // this rendered "Could not load" for every name outside the build — the
        // honest state is the coverage-gap empty, which also tells the reader what
        // to do about it.
        setPayload(null);
        setError(false);
        setLoading(false);
        return;
      }
      const rec = data as VolPayload;
      // Root-match guard (fixture convention): {} or another root's payload is
      // the honest empty, never data wearing the wrong header.
      const ok = typeof rec.root === "string" && rec.root.toUpperCase() === root;
      setPayload(ok ? rec : null);
      setLoading(false);

      // VRP regime context, after first paint (the series is ~250KB for SPY).
      void (async () => {
        const a = (await flowGet(`agg:${root}`).catch(() => null)) as
          | (AggTrendPayload & { root?: string })
          | Record<string, unknown>
          | null;
        if (reqRef.current !== req) return;
        const inner = (a && typeof a === "object" && !("series" in a) && (a as Record<string, unknown>)[root]
          ? (a as Record<string, unknown>)[root]
          : a) as (AggTrendPayload & { root?: string }) | null;
        const okA =
          inner != null &&
          Array.isArray(inner.series) &&
          (typeof inner.root !== "string" || inner.root.toUpperCase() === root);
        setAgg(okA ? inner : null);
      })();
    })();
  }, [root]);

  const commitRoot = useCallback(() => {
    const next = inputVal.trim().toUpperCase();
    if (next && next !== root) {
      trackSearch(next, "vol-tab", inputVal.trim() || undefined);
      setLoading(true);
      setError(false);
      setPayload(null);
      setAgg(null);
      setRoot(next);
    }
  }, [inputVal, root]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") commitRoot();
    },
    [commitRoot],
  );

  // ── asof chip (the freshness truth on this nightly surface) ────────────────
  const asofDate = (payload?.asof ?? "").slice(0, 10);
  const age = asofDate ? sessionsOld(asofDate) : 0;
  const stale = age > STALE_SESSIONS;

  // ── Panel A derived bits ───────────────────────────────────────────────────
  const atmIv = payload?.atm_iv ?? null;
  const lo52 = payload?.iv_52w_lo ?? null;
  const hi52 = payload?.iv_52w_hi ?? null;
  const rangePos = useMemo(() => {
    if (atmIv == null || lo52 == null || hi52 == null) return null;
    if (![atmIv, lo52, hi52].every((v) => Number.isFinite(v)) || !(hi52 > lo52)) return null;
    return Math.min(1, Math.max(0, (atmIv - lo52) / (hi52 - lo52)));
  }, [atmIv, lo52, hi52]);

  const sinceAll = typeof payload?.since_all === "string" ? payload.since_all.slice(0, 10) : null;
  const covDaysAll =
    payload?.coverage_days_all != null && Number.isFinite(payload.coverage_days_all)
      ? Math.round(payload.coverage_days_all)
      : null;

  const vrp = payload?.vrp ?? null;
  const vrpStr =
    vrp != null && Number.isFinite(vrp)
      ? `${vrp >= 0 ? "+" : "−"}${Math.abs(vrp).toFixed(1)}`
      : "—";

  return (
    <div style={OUTER}>
      {/* ── Controls bar ──────────────────────────────────────────────────── */}
      <div style={CONTROLS_BAR}>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--muted)" strokeWidth="2"
            style={{ position: "absolute", left: 8, pointerEvents: "none" }} aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" />
          </svg>
          <input
            style={TICKER_INPUT}
            list="vol-roots"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value.toUpperCase())}
            onBlur={commitRoot}
            onKeyDown={handleKeyDown}
            placeholder={t("tickerPlaceholder")}
            aria-label={t("tickerInputLabel")}
            spellCheck={false}
            maxLength={12}
          />
          <datalist id="vol-roots">
            {rootChoices.map((r) => <option key={r} value={r} />)}
          </datalist>
        </div>
        <div style={CONTROLS_RIGHT}>
          {asofDate && (
            <span style={stale ? { ...ASOF_CHIP, color: "var(--warn)", borderColor: "var(--warn)" } : ASOF_CHIP}>
              {t("asofChip").replace("{date}", asofDate)}
              {stale && (
                <span style={{ marginLeft: 5, fontWeight: 700 }}>
                  · {t("asofStaleAge").replace("{n}", String(age))}
                </span>
              )}
            </span>
          )}
          {loading && <span style={LOADING_BADGE}>{t("loading")}</span>}
          {error && !loading && <span style={ERROR_BADGE}>{t("errorLoad")}</span>}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="fin-scroll" style={BODY}>
        {loading && !payload ? (
          <div style={CENTER_STATE}>{t("loading")}</div>
        ) : !payload ? (
          /* Honest empty / error: name WHICH emptiness this is. */
          <div style={CENTER_STATE}>
            <div style={EMPTY_TITLE}>{error ? t("errorLoad") : t("emptyTitle")}</div>
            {!error && <div style={EMPTY_WHY}>{t("emptyWhy").replace("{sym}", root)}</div>}
          </div>
        ) : (
          <div style={GRID}>
            {/* ═══ Panel A — stat tiles ═══════════════════════════════════ */}
            <section className="fin-card" style={{ gridColumn: "1 / -1", minWidth: 0 }}>
              <div className="fin-card-h">{t("statsTitle")}</div>
              <div className="fin-kpis">
                <div className="fin-kpi">
                  <span className="k">{t("statAtmIv")}</span>
                  <span className="v">{fmtPct(atmIv)}</span>
                </div>
                <div className="fin-kpi">
                  <span className="k">{t("statIvRank252")}</span>
                  <span className="v">{fmtRank(payload.iv_rank_252)}</span>
                </div>
                <div className="fin-kpi">
                  <span className="k">{t("statIvRankAll")}</span>
                  <span className="v">{fmtRank(payload.iv_rank_all)}</span>
                  {sinceAll && covDaysAll != null && (
                    <span className="s">
                      {t("statSinceCaption").replace("{date}", sinceAll).replace("{n}", String(covDaysAll))}
                    </span>
                  )}
                </div>
                <div className="fin-kpi">
                  <span className="k">{t("stat52wRange")}</span>
                  <span className="v" style={{ fontSize: "var(--fs-body)" }}>
                    {fmtPct(lo52)} – {fmtPct(hi52)}
                  </span>
                  {rangePos != null && (
                    <span role="img" aria-label={t("statRangeAria")} style={RANGE_TRACK}>
                      <span style={{ ...RANGE_MARK, left: `calc(${(rangePos * 100).toFixed(1)}% - 2px)` }} />
                    </span>
                  )}
                </div>
                <div className="fin-kpi">
                  <span className="k">{t("statRv20")}</span>
                  <span className="v">{fmtPct(payload.rv20)}</span>
                  <span className="s">{t("statRv20Caption")}</span>
                </div>
                <div className="fin-kpi">
                  <span className="k">{t("statVrp")}</span>
                  <span className="v">{vrpStr}</span>
                  <span className="s">{t("statVrpCaption")}</span>
                </div>
              </div>
              <ProvenanceLine lang={lang} />
            </section>

            {/* ═══ Panel B — ATM IV history ═══════════════════════════════ */}
            <VolHistoryPanel
              history={payload.history}
              iv52wHi={hi52}
              iv52wLo={lo52}
              lang={lang}
            />

            {/* ═══ Panel B2 — VRP regime (R2.3) ═══════════════════════════ */}
            <VolVrpPanel vrp={payload.vrp} agg={agg} lang={lang} />

            {/* ═══ Panel C — term structure ═══════════════════════════════ */}
            <VolTermPanel term={payload.term} lang={lang} />

            {/* ═══ Panel D — smile / skew ═════════════════════════════════ */}
            <div style={{ gridColumn: "1 / -1", minWidth: 0, display: "flex", flexDirection: "column" }}>
              <VolSkewPanel smile={payload.smile} lang={lang} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Layout styles ────────────────────────────────────────────────────────────

const OUTER: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  height: "100%",
  overflow: "hidden",
  background: "var(--bg)",
};

const CONTROLS_BAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 14px",
  borderBottom: "1px solid var(--line)",
  background: "var(--panel)",
  flexShrink: 0,
  flexWrap: "wrap",
};

const TICKER_INPUT: React.CSSProperties = {
  width: 118,
  height: 30,
  padding: "0 10px 0 26px",
  background: "var(--inset)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-md)",
  color: "var(--text)",
  fontSize: 13,
  fontWeight: 700,
  textAlign: "left",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  outline: "none",
  fontVariantNumeric: "tabular-nums",
};

const CONTROLS_RIGHT: React.CSSProperties = {
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const ASOF_CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 24,
  padding: "0 9px",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.03em",
  color: "var(--muted)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-md)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const LOADING_BADGE: React.CSSProperties = {
  fontSize: 10,
  color: "var(--brand-2)",
};

const ERROR_BADGE: React.CSSProperties = {
  fontSize: 10,
  color: "var(--warn)",
};

const BODY: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "12px 14px",
};

/* Panels stack single-column as soon as two 460px tracks stop fitting — pure
   grid math, no media query, so there is never a horizontal-overflow band. */
const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(460px, 100%), 1fr))",
  gap: 12,
  alignItems: "start",
};

const CENTER_STATE: React.CSSProperties = {
  minHeight: 260,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "40px 20px",
  textAlign: "center",
  fontSize: "var(--fs-ui)",
  color: "var(--muted)",
};

const EMPTY_TITLE: React.CSSProperties = {
  fontSize: "var(--fs-body)",
  fontWeight: 700,
  color: "var(--text-2)",
};

const EMPTY_WHY: React.CSSProperties = {
  fontSize: "var(--fs-label)",
  color: "var(--muted)",
  lineHeight: 1.5,
  maxWidth: 380,
};

const RANGE_TRACK: React.CSSProperties = {
  position: "relative",
  display: "block",
  height: 4,
  marginTop: 5,
  borderRadius: 2,
  background: "var(--panel-3)",
};

const RANGE_MARK: React.CSSProperties = {
  position: "absolute",
  top: -3,
  width: 4,
  height: 10,
  borderRadius: 2,
  background: "var(--brand-2)",
};
