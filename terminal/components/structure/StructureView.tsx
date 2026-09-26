"use client";
/**
 * StructureView — the Structure (OI) tab (R3): per-root open-interest posture
 * from the options_hub.oi_time/max_pain/oi_change payloads.
 *
 * Layout:
 *   Header  — uppercase root input + datalist (shared lib/optionsRoots universe)
 *             + "Nightly EOD · as of {date}" chip (warn tone past 3 sessions)
 *             + the "OI = t-1" law chip (Tip discloses OPRA arrears reporting).
 *   Panels  — OI by strike (diverging ladder) · OI by expiration ·
 *             OI over time (18-month calls/puts lines) · put/call OI history ·
 *             Max pain (intrinsic-value curve) · Max pain by expiration ·
 *             OI change (sortable table, root/all-roots scope).
 *
 * Data is NIGHTLY EOD — deliberately no "LIVE" chrome anywhere; the asof chip
 * is the only freshness truth, and every panel carries an options_hub + t-1
 * provenance footer. OI is NON-DIRECTIONAL: neutral accents only.
 *
 * Fetch: three flowGets per committed root (max_pain / oi_time / oi_change —
 * the store publishes once a night, polling would re-download the same
 * snapshot) + ONE lazy flowGet("oi_change") for the cross-root board the first
 * time the scope toggle asks for it. A request counter drops stale responses
 * so a slow root can't clobber a newer pick (VolView convention).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flowGet } from "@/lib/flowClientCache";
import { useLang } from "@/lib/i18n";
import { GEX_AUTOCOMPLETE_ROOTS } from "@/lib/optionsRoots";
import { trackSearch } from "@/lib/searchTrack";
import { Tip } from "@/components/ui/Tip";
import { makeStructureT } from "./structureStrings";
import type { MaxPainPayload, OiChangePayload, OiTimePayload } from "./structureTypes";
import { NEUTRAL_CHIP, oiLadderHeight } from "./structureShared";
import { OiLadderPanel } from "./OiLadderPanel";
import { OiExpiryPanel } from "./OiExpiryPanel";
import { OiTimePanel } from "./OiTimePanel";
import { PutCallHistoryPanel } from "./PutCallHistoryPanel";
import { MaxPainPanel } from "./MaxPainPanel";
import { MaxPainTimePanel } from "./MaxPainTimePanel";
import { OiChangePanel } from "./OiChangePanel";

const DEFAULT_ROOT = "SPY";
const STALE_SESSIONS = 3;

/** ET weekday sessions elapsed since asofDate (the VolView staleness read). */
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

/** Root-match guard (fixture convention): {} or another root's payload is the
 *  honest empty, never data wearing the wrong header. */
function guardRoot<T extends { root?: string }>(data: unknown, root: string): T | null {
  if (data == null || typeof data !== "object") return null;
  const rec = data as T;
  return typeof rec.root === "string" && rec.root.toUpperCase() === root ? rec : null;
}

export interface StructureViewProps {
  rootChoices?: readonly string[];
}

export function StructureView({ rootChoices = GEX_AUTOCOMPLETE_ROOTS }: StructureViewProps = {}) {
  const { lang } = useLang();
  const t = makeStructureT(lang);

  const [root, setRoot] = useState(DEFAULT_ROOT);
  const [inputVal, setInputVal] = useState(DEFAULT_ROOT);
  const [maxPain, setMaxPain] = useState<MaxPainPayload | null>(null);
  const [oiTime, setOiTime] = useState<OiTimePayload | null>(null);
  const [oiChange, setOiChange] = useState<OiChangePayload | null>(null);
  const [cross, setCross] = useState<OiChangePayload | null>(null);
  const [scope, setScope] = useState<"root" | "all">("root");
  const [crossLoading, setCrossLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reqRef = useRef(0);
  const crossReqRef = useRef(false);

  // One-shot fetch per committed root (nightly store — no polling). Loading/
  // error/payload resets live in commitRoot; the effect only starts the async
  // load and resolves in the awaited callback (request counter drops stale).
  useEffect(() => {
    const req = ++reqRef.current;
    void (async () => {
      const get = async (f: string) => {
        try { return await flowGet(f); } catch { return null; }
      };
      const [mp, ot, oc] = await Promise.all([
        get(`max_pain:${root}`),
        get(`oi_time:${root}`),
        get(`oi_change:${root}`),
      ]);
      if (reqRef.current !== req) return;
      if (mp == null && ot == null && oc == null) {
        setError(true);
        setLoading(false);
        return;
      }
      setMaxPain(guardRoot<MaxPainPayload>(mp, root));
      setOiTime(guardRoot<OiTimePayload>(ot, root));
      setOiChange(guardRoot<OiChangePayload>(oc, root));
      setLoading(false);
    })();
  }, [root]);

  // Cross-root board: fetched once, the first time the scope toggle asks.
  const onScope = useCallback((s: "root" | "all") => {
    setScope(s);
    if (s === "all" && !crossReqRef.current) {
      crossReqRef.current = true;
      setCrossLoading(true);
      void (async () => {
        let data: unknown = null;
        try { data = await flowGet("oi_change"); } catch { data = null; }
        const rec = data && typeof data === "object" ? (data as OiChangePayload) : null;
        const ok = rec != null && Array.isArray(rec.rows);
        setCross(ok ? rec : null);
        setCrossLoading(false);
        // One-shot ONLY on success. Leaving the ref latched after a transient
        // failure made the All-roots board permanently empty until a full reload —
        // re-toggling the scope now retries.
        if (!ok) crossReqRef.current = false;
      })();
    }
  }, []);

  const commitRoot = useCallback(() => {
    const next = inputVal.trim().toUpperCase();
    if (next && next !== root) {
      trackSearch(next, "structure-tab", inputVal.trim() || undefined);
      setLoading(true);
      setError(false);
      setMaxPain(null);
      setOiTime(null);
      setOiChange(null);
      setScope("root");
      setRoot(next);
    }
  }, [inputVal, root]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") commitRoot();
    },
    [commitRoot],
  );

  // ── asof chip (freshness truth) — max_pain is primary, oi_time fallback ────
  const asofDate = (maxPain?.asof ?? oiTime?.asof ?? "").slice(0, 10);
  const age = asofDate ? sessionsOld(asofDate) : 0;
  const stale = age > STALE_SESSIONS;

  const hasAny =
    (maxPain?.expiries?.length ?? 0) > 0 ||
    (oiTime?.history?.length ?? 0) > 0 ||
    (oiChange?.rows?.length ?? 0) > 0;

  // Row-1 shared height (see structureShared.oiLadderHeight): computed here
  // from the SAME by_strike row count OiLadderPanel itself filters to, then
  // handed to both OiLadderPanel and OiExpiryPanel so the pair stays
  // card-height-equal regardless of chain density (dense ladders grow taller,
  // and OiExpiryPanel now grows with them instead of sitting fixed at 210).
  const ladderRowCount = useMemo(
    () => (maxPain?.by_strike ?? []).filter((r) => Number.isFinite(Number(r?.strike))).length,
    [maxPain],
  );
  const ladderH = oiLadderHeight(ladderRowCount);

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
            list="structure-roots"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value.toUpperCase())}
            onBlur={commitRoot}
            onKeyDown={handleKeyDown}
            placeholder={t("tickerPlaceholder")}
            aria-label={t("tickerInputLabel")}
            spellCheck={false}
            maxLength={12}
          />
          <datalist id="structure-roots">
            {rootChoices.map((r) => <option key={r} value={r} />)}
          </datalist>
        </div>
        <div style={CONTROLS_RIGHT}>
          {asofDate && (
            <>
              <span style={stale ? { ...ASOF_CHIP, color: "var(--warn)", borderColor: "var(--warn)" } : ASOF_CHIP}>
                {t("asofChip").replace("{date}", asofDate)}
                {stale && (
                  <span style={{ marginLeft: 5, fontWeight: 700 }}>
                    · {t("asofStaleAge").replace("{n}", String(age))}
                  </span>
                )}
              </span>
              {/* The OI timing law — always beside the freshness chip. */}
              <Tip label={t("oiTimingTip").replace("{date}", asofDate)} size="card">
                <button type="button" style={{ ...NEUTRAL_CHIP, cursor: "help" }}>
                  {t("oiTimingChip")}
                </button>
              </Tip>
            </>
          )}
          {loading && <span style={LOADING_BADGE}>{t("loading")}</span>}
          {error && !loading && <span style={ERROR_BADGE}>{t("errorLoad")}</span>}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="fin-scroll" style={BODY}>
        {loading && !hasAny ? (
          <div style={CENTER_STATE}>{t("loading")}</div>
        ) : !hasAny ? (
          <div style={CENTER_STATE}>
            <div style={EMPTY_TITLE}>{error ? t("errorLoad") : t("emptyTitle")}</div>
            {!error && <div style={EMPTY_WHY}>{t("emptyWhy").replace("{sym}", root)}</div>}
          </div>
        ) : (
          <div style={GRID}>
            <OiLadderPanel
              byStrike={maxPain?.by_strike}
              byStrikeFullN={maxPain?.by_strike_full_n}
              spotRef={maxPain?.spot_ref}
              lang={lang}
              sharedH={ladderH}
            />
            <OiExpiryPanel
              expiries={maxPain?.expiries}
              expiriesFullN={maxPain?.expiries_full_n}
              lang={lang}
              sharedH={ladderH}
            />
            <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
              <OiTimePanel history={oiTime?.history} lang={lang} />
            </div>
            <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
              <PutCallHistoryPanel
                history={oiTime?.history}
                lang={lang}
                sourceSchema={oiTime?.schema}
                oiDate={oiTime?.oi_date}
              />
            </div>
            <MaxPainPanel
              expiries={maxPain?.expiries}
              spotRef={maxPain?.spot_ref}
              lang={lang}
            />
            <MaxPainTimePanel
              expiries={maxPain?.expiries}
              spotRef={maxPain?.spot_ref}
              lang={lang}
            />
            <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
              <OiChangePanel
                rootPayload={oiChange}
                crossPayload={cross}
                scope={scope}
                onScope={onScope}
                crossLoading={crossLoading}
                lang={lang}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Layout styles (the VolView shell) ───────────────────────────────────────

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
