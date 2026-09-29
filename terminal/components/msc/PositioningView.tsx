"use client";
/**
 * PositioningView — the Positioning tab (Market Structure Core, wave R0).
 *
 * Program of record: docs/MARKET_STRUCTURE_CORE_MASTERPLAN_2026-08-01.md §R0.
 *
 * Shell only: root picker + "Nightly EOD · as of" chip + loading/error/empty states.
 * The five analytic modules live in <MarketStructureBody>, and every number in them is
 * arithmetic over two payloads that already exist — no new f-param, no new builder.
 *
 * Fetches ONE `gex:{ROOT}` and ONE `moves:{ROOT}` per committed root. Both stores publish
 * once a night, so there is no polling; flowClientCache is a module-level SWR store with
 * in-flight dedup, so the Exposure desk and the EOD context belt share these responses.
 *
 * FRESHNESS: this is nightly EOD data. There is deliberately no LIVE chrome anywhere —
 * the as-of chip is the only freshness truth (the same ruling the Exposure desk carries).
 *
 * ROOT-MATCH GUARD: root-keyed fixtures return `{}` for an unknown root, and the prod
 * payload carries its own `root`. A payload whose root does not match the committed one is
 * treated as absent — never another ticker's structure wearing this ticker's header.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { flowGet } from "@/lib/flowClientCache";
import { useLang } from "@/lib/i18n";
import { GEX_AUTOCOMPLETE_ROOTS } from "@/lib/optionsRoots";
import { trackSearch } from "@/lib/searchTrack";
import { makeMscT } from "./mscStrings";
import { MarketStructureBody } from "./MarketStructureBody";
import type { MscMoves } from "@/lib/marketStructure";
import type { AggTrendPayload } from "@/lib/aggTrend";
import type { QuadPayload } from "@/lib/quadBoard";
import type { GradesPayload } from "./GradesCard";
import type { GexMatrix } from "@/lib/gexLadder";
import type { GexPayload } from "@/components/gexdesk/GexDeskView";

const DEFAULT_ROOT = "SPY";
const STALE_SESSIONS = 3;

/**
 * ET weekday sessions elapsed since `asofDate` (YYYY-MM-DD). Calendar weekdays stand in
 * for trading sessions (a holiday reads one high — acceptable for a staleness tone, and
 * never shown as a precise trading-day count). Mirrors VolView/StructureView.
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

/** Unwrap a root-keyed envelope or a bare payload; reject another root's data. */
function pickRoot<T extends { root?: unknown }>(data: unknown, root: string): T | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  const inner = (rec[root] as T | undefined) ?? (rec as unknown as T);
  if (!inner || typeof inner !== "object") return null;
  if (typeof inner.root === "string" && inner.root.toUpperCase() !== root) return null;
  return inner;
}

export interface PositioningViewProps {
  rootChoices?: readonly string[];
}

export function PositioningView({ rootChoices = GEX_AUTOCOMPLETE_ROOTS }: PositioningViewProps = {}) {
  const { lang } = useLang();
  const t = makeMscT(lang);

  const [root, setRoot] = useState(DEFAULT_ROOT);
  const [inputVal, setInputVal] = useState(DEFAULT_ROOT);
  const [gex, setGex] = useState<GexPayload | null>(null);
  const [moves, setMoves] = useState<MscMoves | null>(null);
  // W2 history cards. Both stores are optional and independently cadenced from the
  // nightly ladder, so neither is allowed to gate loading or error state — a root with
  // no published history still renders the full single-session tab.
  const [agg, setAgg] = useState<AggTrendPayload | null>(null);
  const [matrix, setMatrix] = useState<GexMatrix | null>(null);
  // The cross-root board is ONE artifact shared by every root, so it is fetched once and
  // deliberately NOT reset when the root changes — re-fetching the same file on every
  // ticker change would be pure waste. flowClientCache dedupes it anyway; not clearing it
  // also means the screener never blinks out while a new root's ladder loads.
  const [quad, setQuad] = useState<QuadPayload | null>(null);
  // R2.4 report cards: the root's own (single names) + the universe aggregate
  // (context for uncovered roots). Both tiny, both optional, both non-gating.
  const [grades, setGrades] = useState<GradesPayload | null>(null);
  const [gradesUni, setGradesUni] = useState<GradesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reqRef = useRef(0);

  // One-shot per committed root. The reset lives in commitRoot (the event that changes
  // the root), so this effect only starts the load and resolves inside the awaited
  // callback — a slow root can never clobber a newer pick (request counter).
  useEffect(() => {
    const req = ++reqRef.current;
    void (async () => {
      let g: unknown = null;
      let m: unknown = null;
      try {
        [g, m] = await Promise.all([flowGet(`gex:${root}`), flowGet(`moves:${root}`)]);
      } catch {
        g = null;
        m = null;
      }
      if (reqRef.current !== req) return;
      const gp = pickRoot<GexPayload>(g, root);
      const mp = pickRoot<MscMoves & { root?: unknown }>(m, root);
      setGex(gp && Array.isArray(gp.by_strike) && gp.by_strike.length > 0 ? gp : null);
      // The band is optional: without it the expected-move card falls back to percent
      // distances and says so, rather than the whole tab failing.
      setMoves(mp && "expected_move" in mp ? mp : null);
      setError(g == null);
      setLoading(false);

      // W2 history, fetched AFTER the tab has already rendered. Both stores are optional
      // and much larger than the ladder (a nine-year SPY series is ~250KB), so blocking
      // the first paint on them would make every root feel slower to serve two cards that
      // are not the reason anyone opened the tab.
      void (async () => {
        const [a, mx, q, gr, gu] = await Promise.all([
          flowGet(`agg:${root}`).catch(() => null),
          flowGet(`matrix:${root}`).catch(() => null),
          flowGet("quad").catch(() => null),
          flowGet(`grades:${root}`).catch(() => null),
          flowGet("grades_universe").catch(() => null),
        ]);
        if (reqRef.current !== req) return;
        const ap = pickRoot<AggTrendPayload & { root?: unknown }>(a, root);
        setAgg(ap && Array.isArray(ap.series) && ap.series.length > 0 ? ap : null);
        // The matrix payload is not root-keyed the way gex/agg are, but it does carry its
        // own root — reuse the same refusal so another ticker's strike×expiry grid can
        // never render under this ticker's header.
        const mxp = pickRoot<GexMatrix & { root?: unknown }>(mx, root);
        setMatrix(mxp && Array.isArray(mxp.cells) && mxp.cells.length > 0 ? mxp : null);
        // Not root-keyed: one board, every root on it.
        const qp = q as QuadPayload | null;
        setQuad(qp && Array.isArray(qp.rows) && qp.rows.length > 0 ? qp : null);
        const grp = pickRoot<GradesPayload & { root?: unknown }>(gr, root);
        setGrades(grp && grp.roles && Object.keys(grp.roles).length > 0 ? grp : null);
        const gup = gu as (GradesPayload & { root?: string }) | null;
        setGradesUni(
          gup && gup.roles && Object.keys(gup.roles).length > 0 && gup.root === "_universe"
            ? gup
            : null,
        );
      })();
    })();
  }, [root]);

  const commitRoot = useCallback(() => {
    const next = inputVal.trim().toUpperCase();
    if (next && next !== root) {
      trackSearch(next, "positioning-tab", inputVal.trim() || undefined);
      setLoading(true);
      setError(false);
      setGex(null);
      setMoves(null);
      setAgg(null);
      setMatrix(null);
      setGrades(null);
      setRoot(next);
    }
  }, [inputVal, root]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") commitRoot();
    },
    [commitRoot],
  );

  const asofDate = (gex?.asof ?? "").slice(0, 10);
  const age = asofDate ? sessionsOld(asofDate) : 0;
  const stale = age > STALE_SESSIONS;

  return (
    <div style={OUTER}>
      <div style={CONTROLS_BAR}>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="var(--muted)"
            strokeWidth="2"
            style={{ position: "absolute", left: 8, pointerEvents: "none" }}
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
          </svg>
          <input
            style={TICKER_INPUT}
            list="msc-roots"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value.toUpperCase())}
            onBlur={commitRoot}
            onKeyDown={handleKeyDown}
            placeholder={DEFAULT_ROOT}
            aria-label={t("panelTitle")}
            spellCheck={false}
            maxLength={12}
          />
          <datalist id="msc-roots">
            {rootChoices.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
        <div style={CONTROLS_RIGHT}>
          {asofDate && (
            <span
              style={
                stale
                  ? { ...ASOF_CHIP, color: "var(--warn)", borderColor: "var(--warn)" }
                  : ASOF_CHIP
              }
            >
              {t("asofChip").replace("{date}", asofDate)}
              {stale && (
                <span style={{ marginLeft: 5, fontWeight: 700 }}>
                  · {t("asofStale").replace("{n}", String(age))}
                </span>
              )}
            </span>
          )}
          {loading && <span style={BADGE}>{t("loading")}</span>}
          {error && !loading && (
            <span style={{ ...BADGE, color: "var(--warn)", borderColor: "var(--warn)" }}>
              {t("errorLoad")}
            </span>
          )}
        </div>
      </div>

      <div className="fin-scroll" style={BODY}>
        {loading && !gex ? (
          <div style={CENTER}>{t("loading")}</div>
        ) : !gex ? (
          <div style={CENTER}>
            <div style={{ color: "var(--text-2)", marginBottom: 4 }}>{t("emptyTitle")}</div>
            <div>{t("emptyWhy").replace("{sym}", root)}</div>
          </div>
        ) : (
          <MarketStructureBody
            gex={gex}
            moves={moves}
            agg={agg}
            matrix={matrix}
            quad={quad}
            grades={grades}
            gradesUniverse={gradesUni}
            root={root}
            lang={lang}
          />
        )}
      </div>
    </div>
  );
}

// ─── Styles (v5 tokens; mirrors VolView's shell) ─────────────────────────────────────

const OUTER: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  height: "100%",
};

const CONTROLS_BAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  padding: "8px 12px",
  borderBottom: "1px solid var(--line)",
  flexShrink: 0,
};

const CONTROLS_RIGHT: React.CSSProperties = {
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const TICKER_INPUT: React.CSSProperties = {
  width: 120,
  padding: "5px 8px 5px 26px",
  background: "var(--inset)",
  border: "1px solid var(--line-2)",
  borderRadius: "var(--r-tile)",
  color: "var(--text)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: ".02em",
  outline: "none",
};

const ASOF_CHIP: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
  border: "1px solid var(--line-2)",
  borderRadius: 999,
  padding: "2px 8px",
  whiteSpace: "nowrap",
};

const BADGE: React.CSSProperties = { ...ASOF_CHIP };

const BODY: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: "10px 12px 16px",
};

const CENTER: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 200,
  gap: 2,
  fontSize: 12,
  color: "var(--muted)",
  textAlign: "center",
};
