"use client";
import { useEffect, useMemo, useRef, useState, startTransition, useDeferredValue, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useT, useLang } from "@/lib/i18n";
import { displayName, marketOf, isSymbolVisible, ALL_MARKETS, type MarketId } from "@/lib/markets";
import { useMarketPrefs } from "@/lib/useMarketPrefs";
import type { AccountIdentity } from "@/lib/accountIdentity";
import { MARKET_TKEY } from "@/lib/markets";
import { getJSONResult, invalidate } from "@/lib/dataCache";
import { trackSearch } from "@/lib/searchTrack";
import { verdictIsStale } from "@/lib/signalVerdict";
// R3.2 msc_* positioning columns: one cross-root index fetch joined by symbol (the
// heatmap's flowMap pattern). Entitlement 403 / outage → null → the columns never
// render and the table is exactly what it was (degrade-to-absent, "do not fake it").
import { flowGet } from "@/lib/flowClientCache";
import { parseGlanceIndex, REGIME_COLORS, REGIME_RANK, type GexRegime, type GlanceIndex } from "@/lib/mscGlance";
import { makeGexT } from "@/components/gexdesk/gexStrings";
import { notClassified, verdictLabel } from "@/lib/plainLabels";
import AssetLogo from "@/components/AssetLogo";
// E03 cross-market screening: native taxonomies (no crosswalk), listing currency on every money
// cell, one currency scope per monetary floor, and named clears on a market change. The rules
// live in lib/crossMarketScreen.ts; this view only wires them in.
import { useClassificationScan } from "@/lib/useClassificationScan";
import { TAXONOMY_IDS, labelOf, listingHref, type TaxonomyId } from "@/lib/classificationScan";
import {
  NO_EXCLUSIONS, UNCLASSIFIED, classPredicateOf, compareMoney, effectiveTaxonomy, formatFloor, formatMoney,
  floorState, labelStanding, moneyCurrency, reconcileFilters, resolveCurrencyScope, resolveLabel, sanitizeCrossMarketFields,
  screenCrossMarket, sectorDisplay, smartScreenHandover, type ClearedFilter, type ExclusionCounts, type MoneyCurrency, type SectorDisplay,
} from "@/lib/crossMarketScreen";
import { TAXONOMY_LEX, YAHOO_SECTOR_ZH, useCrossMarketT } from "@/lib/crossMarketLex";
import CrossMarketStrip, { CurrencyBadge, EmptyExclusionNote, SectorCellContent, type LabelCoverage } from "@/components/screener/CrossMarketStrip";
import SmartScreensPanel from "@/components/screener/SmartScreensPanel";
import type { ScreenerFilters } from "@/lib/smartScreen/predicate";
// E01 technical screen: one bounded scan read (/data/scan/technical.json), classified per row by
// lib/technicalScan — never inferred from per-symbol OHLC in the browser.
import TechnicalScreenBar, { TechnicalCell, TECH_CELL_CLASS, TECH_ON_CLASS, TECH_TH_CLASS } from "@/components/screener/TechnicalScreenBar";
import { useTechnicalScan } from "@/lib/useTechnicalScan";
import { classifyTechnical, evaluateTechnicalScreen, technicalChartHandover } from "@/lib/technicalScan";
import { passes } from "@/lib/screenerScan";
import { TECH_DEFAULT_CONTROLS, techControlsActive, technicalCoverageSummary, technicalScreenOf, type TechControls } from "@/lib/technicalScreenControls";
import { DAILY_FUNCTIONAL_TIMEFRAMES } from "@/lib/startTf";
import { useTechnicalT } from "@/lib/technicalScanLex";
// E02 period-aware fundamental screen: one lazily-read scan (scan/fundamental.json), applied
// AFTER every manifest filter so its tally explains exactly the rows the user would see.
import {
  FUNDAMENTAL_FIELD_IDS,
  classifyFundamental,
  createFundamentalTally,
  evaluateFundamentalScreen,
  summarizeFundamentalField,
  type FundamentalClassification,
  type FundamentalFieldId,
  type FundamentalFieldSummary,
  type FundamentalPredicate,
  type FundamentalTally,
} from "@/lib/fundamentalScan";
import { fieldColumn, fieldName, useFundT } from "@/lib/fundamentalScanLex";
import { useFundamentalScan } from "@/components/screener/useFundamentalScan";
import {
  FundamentalCell,
  FundamentalScreenBar,
  FundamentalStatusItems,
  fundamentalTdClass,
  fundamentalThClass,
  type FundamentalEvidenceTarget,
} from "@/components/screener/FundamentalScreen";
// The evidence drawer (projector + statement math) loads only when a fundamental cell is opened.
const FundamentalEvidence = dynamic(() => import("@/components/screener/FundamentalEvidence"), { ssr: false });

/* ────────────────────────────────────────────────────────────────────────────
 * PHASE-2 DATA PLUMBING — deliberately NOT built in this component (D5-6).
 *
 * Every filter below is computed from fields the manifest already carries. The
 * six screens users ask for next each need SERVER/pipeline work first, and a
 * client-side approximation of any of them would be a lie. Do not fake them:
 *
 *  1. Signal filter over the FULL universe — broad-universe verdicts already
 *     exist in the per-symbol slice.json files (gen_slices_all.py computes a
 *     signal for every OHLC symbol) but are NOT hydrated into manifest rows.
 *     Needs a nightly manifest field, added to BOTH /usr/local/bin/terminal-data
 *     copies (two-copies law). Until then the coverage tag IS the product truth.
 *  2. Tech-rating / trend-state column + filter — techRating.ts and trend.ts
 *     take Bar[] per symbol; 9.5k OHLC fetches from the browser is infeasible.
 *     Needs a nightly scan artifact (compact rating in the manifest, or a
 *     screener_scan.json). E01 ships the flagship-engine STATE half of this as
 *     the nightly technical scan (ingest/gen_technical_scan.py → TechnicalScreenBar);
 *     techRating/trend ratings are still not produced.
 *  3. Fundamental filters — BUILT (E02) on a merged nightly scan: scan/fundamental.json
 *     (scripts/gen_fundamental_scan.ts → lib/fundamentalScan.ts) carries P/E TTM and
 *     latest-fiscal-year margins / ROE / revenue growth with their period, currency and
 *     per-field availability. fund.json units law: percents are 0..1 FRACTIONS, scaled
 *     once at the display boundary. Dividend yield is not in the v1 field set.
 *  4. Sector for CN/HK names — BUILT (E03) as native taxonomies from each listing's
 *     owner record (scan/classification.json), shown with their taxonomy and age.
 *     There is still no crosswalk between them (e.g. SW-industry ↔ GICS); none is faked.
 *  5. Fresh market caps — reference.parquet is frozen Jul-9 (open macro bug), so
 *     the mcap floors ship labeled approximate (scr2McapNote) until it refreshes.
 *  6. Preset sync to the account (Supabase user_metadata, like marketPrefs) —
 *     phase 1 is device-local localStorage, matching the guest pattern.
 * ──────────────────────────────────────────────────────────────────────────── */

// ── types ──────────────────────────────────────────────────────────────────
type Row = {
  sym: string; name: string; zh?: string; sec: string; col: string; mkt?: string;
  last: number | null; chg: number | null; vol: number | null;
  hi52: number | null; lo52: number | null;
  gics: string | null; mcap: number | null;
  verdict: string | null; vts?: string | null; wr: number | null; pf: number | null;
  cagr: number | null; regimeBull: boolean | null;
  // derived ONCE at normalization — the sort comparator must never recompute these
  dv: number | null;      // traded value (last × vol) in the LISTING'S currency — never USD by assumption
  offHi: number | null;   // % away from the 52-week high (negative = below)
  offLo: number | null;   // % above the 52-week low
  mktId: MarketId;        // marketOf(sym, row), precomputed for the market select
  // R3.2 msc_* positioning columns — joined from gexstate_index AFTER load. mscRank is the
  // sortable scalar (REGIME_RANK — structural risk PIN→CASCADE); mscRegime the display word.
  mscRank?: number | null; mscRegime?: GexRegime | null; mscNetGex?: number | null; mscFlip?: number | null;
};

/**
 * Why the scan is not on screen. `null` = no fault.
 *
 * `dataCache.getJSON` answers `null` for BOTH "the file 404s" and "the request failed", and it
 * never rejects — so `.then(m => { if (m) apply(m) })` silently did nothing on any failure and
 * left `loaded` false forever: a manifest outage rendered as a permanent loading skeleton with
 * no reachable Retry. The view now reads `getJSONResult`, so a failure is a state, not a no-op.
 */
type ScreenerFault = "absent" | "unavailable";

/** A manifest is an object carrying a `symbols` map. Anything else parsed fine but is not a
 *  scan — rendering it as zero rows would print "No matches" over an unread universe. */
function isManifestShape(m: unknown): m is { as_of?: string; symbols?: Record<string, any> } {
  if (!m || typeof m !== "object" || Array.isArray(m)) return false;
  const symbols = (m as { symbols?: unknown }).symbols;
  return !!symbols && typeof symbols === "object" && !Array.isArray(symbols);
}

type Sig = "any" | "buy" | "sell" | "tracked";
type W52 = "any" | "nearHigh" | "within15" | "dd30" | "nearLow";
type Move = "any" | "up3" | "down3" | "abs5";
type Density = "c" | "k";

type FilterState = {
  market: "all" | MarketId;
  asset: "all" | string;    // manifest `sec`
  sector: "all" | string;   // a label of `taxonomy`, or UNCLASSIFIED
  signal: Sig;
  uptrend: boolean;
  liq: number;              // traded-value floor in the `ccy` scope currency; 0 = no floor
  mcap: number;             // USD (US reference data); 0 = no floor
  w52: W52;
  move: Move;
  unpriced: boolean;        // true = also show rows with no price
  taxonomy?: TaxonomyId | null; // the native taxonomy `sector` belongs to (E03)
  classStale?: boolean;         // a stale label may match — explicit opt-in (E03)
  ccy?: string;                 // "auto" | the currency a traded-value floor applies in (E03)
  liqCcy?: string | null;       // the currency `liq` was set in; null = not yet bound (E03)
};

const DEFAULT_FILTERS: FilterState = {
  market: "all", asset: "all", sector: "all", signal: "any",
  uptrend: false, liq: 0, mcap: 0, w52: "any", move: "any", unpriced: false,
  taxonomy: null, classStale: false, ccy: "auto", liqCcy: null,
};

type SortKey =
  | "sym" | "last" | "chg" | "dv" | "mcap" | "offHi" | "gics"
  | "verdict" | "regimeBull" | "wr" | "pf" | "cagr"
  | "mscRank" | "mscNetGex" | "mscFlip"
  | `fund:${FundamentalFieldId}`;

/** A fundamental column's sort key → its field (null for every manifest column). */
const fundSortField = (k: SortKey): FundamentalFieldId | null =>
  k.startsWith("fund:") ? (k.slice(5) as FundamentalFieldId) : null;

// Column sets per view. The signal columns exist for the Oracle-tracked names only, so they
// are shown ONLY while a signal-scoped filter is on — that is what keeps 5-of-9 columns from
// rendering "—" for 99% of the universe.
const U_KEYS: SortKey[] = ["sym", "last", "chg", "dv", "mcap", "offHi", "gics", "mscRank", "mscNetGex", "mscFlip", "verdict"];
const S_KEYS: SortKey[] = ["sym", "last", "chg", "verdict", "regimeBull", "wr", "pf", "cagr", "dv"];
const DEF_SORT_U: { k: SortKey; dir: 1 | -1 } = { k: "dv", dir: -1 };   // defensible over the whole universe
const DEF_SORT_S: { k: SortKey; dir: 1 | -1 } = { k: "cagr", dir: -1 }; // every visible row has it here

// ── formatters ─────────────────────────────────────────────────────────────
const fmt = (n: number | null | undefined, d = 2) =>
  (n == null || !isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));

// share/coin volume — tooltip only now that the column itself shows dollar volume
const shares = (v: number | null | undefined): string => {
  if (v == null || !isFinite(v)) return "—";
  return v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : String(v);
};

// abbreviated USD for dollar volume / market cap cells
const usd = (n: number | null | undefined): string => {
  if (n == null || !isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

// round-number floors read better without trailing zeros ($5M, not $5.0M)
const floorUsd = (n: number): string =>
  n >= 1e12 ? `$${n / 1e12}T` : n >= 1e9 ? `$${n / 1e9}B` : n >= 1e6 ? `$${n / 1e6}M` : `$${n}`;

const isBuy = (v: string | null) => v === "BUY" || v === "REBUY" || v === "RECLAIM";

// ── option tables ──────────────────────────────────────────────────────────
const ASSET_OPTS: { v: string; key: string }[] = [
  { v: "Equities", key: "equities" },
  { v: "Funds", key: "scr2Funds" },
  { v: "Crypto", key: "crypto" },
  { v: "Indices", key: "scr2Indices" },
  { v: "Bonds", key: "scr2Bonds" },
  { v: "Forex", key: "scr2Forex" },
  { v: "Futures", key: "scr2Futures" },
];

// GICS sector strings as they arrive from the Polygon reference cache (gics_sector).
// Unmapped values fall through to the raw string rather than disappearing.
const GICS_TKEY: Record<string, string> = {
  "Information Technology": "gicsInfoTech",
  "Health Care": "gicsHealth",
  "Financials": "gicsFin",
  "Consumer Discretionary": "gicsConsDisc",
  "Communication Services": "gicsComm",
  "Industrials": "gicsInd",
  "Consumer Staples": "gicsStaples",
  "Energy": "gicsEnergy",
  "Utilities": "gicsUtil",
  "Real Estate": "gicsRE",
  "Materials": "gicsMat",
};

const LIQ_FLOORS = [1e6, 5e6, 20e6, 100e6];
const MCAP_FLOORS = [300e6, 2e9, 10e9, 100e9];
const W52_OPTS: { v: W52; key: string }[] = [
  { v: "nearHigh", key: "scr2NearHigh" },
  { v: "within15", key: "scr2Within15" },
  { v: "dd30", key: "scr2Drawdown" },
  { v: "nearLow", key: "scr2NearLow" },
];
const MOVE_OPTS: { v: Move; key: string }[] = [
  { v: "up3", key: "scr2MoveUp3" },
  { v: "down3", key: "scr2MoveDown3" },
  { v: "abs5", key: "scr2MoveAbs5" },
];

// ── presets ────────────────────────────────────────────────────────────────
const BUILTIN_PRESETS: { id: string; key: string; f: Partial<FilterState> }[] = [
  { id: "psBuys", key: "scr2PsBuys", f: { signal: "buy" } },
  // A floor names its currency: the all-markets presets screen in USD (their auto scope), the
  // single-market ones in that market's listing currency — never one number read in two units.
  { id: "psGainers", key: "scr2PsGainers", f: { move: "up3", liq: 5e6, liqCcy: "USD" } },
  { id: "psDecliners", key: "scr2PsDecliners", f: { move: "down3", liq: 5e6, liqCcy: "USD" } },
  { id: "psNearHigh", key: "scr2PsNearHigh", f: { w52: "nearHigh", liq: 5e6, liqCcy: "USD" } },
  { id: "psDrawdown", key: "scr2PsDrawdown", f: { w52: "dd30" } },
  { id: "psCn", key: "scr2PsCn", f: { market: "cn", liq: 20e6, liqCcy: "CNY" } },
  { id: "psHk", key: "scr2PsHk", f: { market: "hk", liq: 5e6, liqCcy: "HKD" } },
];

type SavedPreset = { id: string; name: string; f: FilterState };
const PRESET_LS = "mm.scrPresets";
const PRESET_CAP = 12;

// Device-local, both for guests and accounts — server sync is out of scope for phase 1
// (see the D5-6 block above; mirrors the useMarketPrefs guest pattern).
function readPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_LS);
    if (!raw) return [];
    const p = JSON.parse(raw);
    if (!p || p.v !== 1 || !Array.isArray(p.items)) return [];   // unknown schema → discard silently
    return p.items
      .filter((x: any) => x && typeof x.id === "string" && typeof x.name === "string" && x.f && typeof x.f === "object")
      .slice(0, PRESET_CAP)
      .map((x: any) => ({ id: x.id, name: x.name, f: { ...DEFAULT_FILTERS, ...x.f, ...sanitizeCrossMarketFields(x.f) } as FilterState }));
  } catch { return []; }
}
function writePresets(items: SavedPreset[]) {
  try { localStorage.setItem(PRESET_LS, JSON.stringify({ v: 1, items })); } catch { /* storage blocked */ }
}

// ── virtualization constants ───────────────────────────────────────────────
// CSS↔constant coupling — both pairs move together or the scroll math drifts:
//   comfortable — table.scr2 tbody td{height:44px;padding:0 16px}
//   compact     — .scr2.den-k table.scr2 tbody td{height:36px}
// The row pitch is PINNED in CSS (explicit td height + zero vertical padding + fixed
// .tk/.nm line-heights), not inferred from padding. Inferring is what made the old
// ROW_H = 44 wrong: with padding:11px the two-line symbol cell measured 57.8px/row, so the
// spacer heights under-reported the list by ~24% and the scrollbar never reached the end.
const ROW_H_COMFORT = 44;
const ROW_H_COMPACT = 36;
const OVERSCAN = 6; // extra rows above/below viewport
const DENSITY_LS = "mm.scrDensity";

// ── loading skeleton ───────────────────────────────────────────────────────
const SHIMMER_ROWS = 12;

const EmptyIcon = () => (
  <svg className="fin-empty-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="21" cy="21" r="12" />
    <path d="M30 30l9 9" strokeLinecap="round" />
  </svg>
);

export default function ScreenerView({ identity }: { identity: AccountIdentity }) {
  const router = useRouter();
  const t = useT();
  const { lang } = useLang();
  // The market universe this user sees is OWNER state, so it is keyed on the identity's uuid,
  // not on an address the account can change out from under it.
  const { prefs, ready: prefsReady } = useMarketPrefs(identity);

  // ── data state ─────────────────────────────────────────────────────────
  const [rows, setRows] = useState<Row[]>([]);
  const [asOf, setAsOf] = useState<string>("");
  const [manifestLoaded, setLoaded] = useState(false);
  // Four distinct load states, never collapsed: skeleton (!loaded), a scan (loaded, err null),
  // "the manifest is not published" (absent) and "we could not reach it" (unavailable). The
  // last two both mean NO SCAN — but they are different facts, so the why-line names which.
  const [err, setErr] = useState<ScreenerFault | null>(null);
  const [reloadN, setReloadN] = useState(0);

  // ── filter state ───────────────────────────────────────────────────────
  const [f, setF] = useState<FilterState>(DEFAULT_FILTERS);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  // Session-only widening of the market preference. NEVER writes prefs — a screener
  // toggle must not silently change what search shows on the next page.
  const [showAllMarkets, setShowAllMarkets] = useState(false);

  // ── search state (wrapped in deferred for perf) ────────────────────────
  const [searchRaw, setSearchRaw] = useState("");
  const search = useDeferredValue(searchRaw);

  // ── presets + density (device-local) ───────────────────────────────────
  const [saved, setSaved] = useState<SavedPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [density, setDensity] = useState<Density>("c");

  useEffect(() => {
    setSaved(readPresets());
    try { const d = localStorage.getItem(DENSITY_LS); if (d === "c" || d === "k") setDensity(d); } catch { /* storage blocked */ }
  }, []);

  const pickDensity = useCallback((d: Density) => {
    setDensity(d);
    try { localStorage.setItem(DENSITY_LS, d); } catch { /* storage blocked */ }
  }, []);

  // ── sort state ─────────────────────────────────────────────────────────
  // null = "no explicit pick yet", so each view lands on ITS default ($ Vol in the universe
  // view, CAGR in the signal view). Storing a concrete key up front would carry $ Vol into the
  // signal view, where CAGR is the meaningful default.
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 } | null>(null);

  // ── fundamental screen (E02) ───────────────────────────────────────────
  // The scan is read only once the user opens the controls, holds a fundamental filter, or the
  // smart-screens panel shows a saved screen with fundamental conditions (to count/explain it).
  // Columns exist for the field being edited and for every active predicate — never for the
  // whole field set, so the table does not grow "—" columns nobody asked for.
  const ft = useFundT();
  const [fundOpen, setFundOpen] = useState(false);
  const [fundField, setFundField] = useState<FundamentalFieldId>("fund.net_margin_fy");
  const [fundPreds, setFundPreds] = useState<FundamentalPredicate[]>([]);
  // Counts the times the table's conditions were replaced whole (Clear filters, a saved screen
  // opened); the fundamental editor reloads its draft on each one, even when the selected field
  // had no condition before or after — see FundamentalScreenBar.sourceEpoch (issue #916).
  const [fundEpoch, setFundEpoch] = useState(0);
  const [evidence, setEvidence] = useState<FundamentalEvidenceTarget | null>(null);
  const [fundWanted, setFundWanted] = useState(false);
  const fund = useFundamentalScan(fundOpen || fundPreds.length > 0 || fundWanted);
  const fundCtx = useMemo(() => ({ source: fund.source, nowMs: fund.nowMs }), [fund.source, fund.nowMs]);
  const fundCols = useMemo(
    () => FUNDAMENTAL_FIELD_IDS.filter((id) => (fundOpen && id === fundField) || fundPreds.some((p) => p.field === id)),
    [fundOpen, fundField, fundPreds],
  );
  const closeEvidence = useCallback(() => setEvidence(null), []);

  // ── scroll tracking for virtualization ────────────────────────────────
  const tableRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600); // fallback until measured

  const onScroll = useCallback(() => {
    if (tableRef.current) {
      setScrollTop(tableRef.current.scrollTop);
    }
  }, []);

  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    setViewportH(el.clientHeight);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); };
  }, [onScroll]);

  // ── fetch manifest via dataCache (dedup + SWR) + mounted guard ─────────
  useEffect(() => {
    let alive = true;
    // onRevalidate: dataCache serves the persisted manifest stale on every load, so without
    // it the screener — including the "as of" date it prints — would show whatever board
    // this browser last cached. An honest-looking date on a stale table is the worst case.
    const apply = (m: any) => {
        setAsOf(m.as_of || "");
        setRows(
          Object.entries(m.symbols || {}).map(([sym, r]: any) => {
            // normalise nulls so thin rows are distinguishable
            const last = r.last ?? null;
            const vol = r.vol ?? null;
            // 0 is MISSING for an equity price, never a print (cn-premarket-zero-ohlc law)
            const hi52 = r.hi52 || null;
            const lo52 = r.lo52 || null;
            const sec = r.sec || "";
            const mkt = r.mkt;
            return {
              sym,
              last, chg: r.chg ?? null, vol,
              hi52, lo52,
              gics: r.gics ?? null,
              mcap: typeof r.mcap === "number" && r.mcap > 0 ? r.mcap : null,
              verdict: r.verdict ?? null,
              vts: r.vts ?? null,
              wr: r.wr ?? null,
              pf: r.pf ?? null,
              cagr: r.cagr ?? null,
              regimeBull: r.regimeBull ?? null,
              name: r.name || sym,
              zh: r.zh,
              sec,
              col: r.col || "#888",
              mkt,
              dv: last != null && vol != null ? last * vol : null,
              offHi: last != null && hi52 != null ? (last / hi52 - 1) * 100 : null,
              offLo: last != null && lo52 != null ? (last / lo52 - 1) * 100 : null,
              mktId: marketOf(sym, { mkt, sec }),
            } as Row;
          })
        );
        setLoaded(true);
    };
    // A background revalidation that FAILS leaves the last good scan on screen (it is still a
    // real answer, just older) — onRevalidate only ever fires with data.
    getJSONResult("/data/manifest.json", {
      onRevalidate: (m: any) => { if (alive && isManifestShape(m)) apply(m); },
    })
      .then((res) => {
        if (!alive) return;
        if (res.status === "data" && isManifestShape(res.data)) { apply(res.data); return; }
        // No scan. `absent` = the manifest is not published at this address; anything else
        // (network, 5xx, unparseable body, a 200 that is not a manifest) = we could not find out.
        setErr(res.status === "absent" ? "absent" : "unavailable");
        setLoaded(true);
      })
      .catch(() => { if (alive) { setErr("unavailable"); setLoaded(true); } });
    return () => { alive = false; };
  }, [reloadN]);

  // R3.2: one cross-root positioning fetch per mount (EOD data — no polling).
  const [glance, setGlance] = useState<GlanceIndex | null>(null);
  const gexT = useMemo(() => makeGexT(lang), [lang]);
  useEffect(() => {
    let alive = true;
    flowGet("gexstate_index").then((d) => { if (alive) setGlance(parseGlanceIndex(d)); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Join by symbol (heatmap flowMap pattern) — rows without coverage keep null msc fields
  // (comparator sorts nulls last); no index at all leaves `rows` untouched.
  const rowsJoined = useMemo(() => {
    if (!glance) return rows;
    return rows.map((r) => {
      const g = glance.rows.get(r.sym);
      return g ? { ...r, mscRank: REGIME_RANK[g.regime], mscRegime: g.regime, mscNetGex: g.netGexBn, mscFlip: g.distToFlipPct } : r;
    });
  }, [rows, glance]);

  // E03: listing classifications + currencies. The table waits for this read to SETTLE (any
  // outcome) — a money cell drawn before the listing currency is known would read as "?" and
  // then change unit under the user. A failed or absent scan is a stated state in the strip,
  // never a reason to hide the manifest.
  const { source: scan, retry: retryScan } = useClassificationScan();
  const loaded = manifestLoaded && (err !== null || scan !== null);
  // One evaluation clock per scan read: ages (stale labels, old generations) are fixed at read.
  const now = useMemo(() => (scan ? Date.now() : 0), [scan]);

  // invalidate() also clears the in-session 404 negative cache, without which a manifest that
  // once 404'd would answer `absent` from memory forever and Retry could never reach the network.
  const retry = useCallback(() => {
    invalidate("/data/manifest.json");
    setErr(null);
    setLoaded(false);
    setReloadN((n) => n + 1);
  }, []);

  // ── E01 technical screen ─────────────────────────────────────────────────
  // Opt-in: the scan is read only once the user opens the technical screen. Its controls live
  // OUTSIDE FilterState, so saved presets (#884) keep exactly the shape they had.
  const tt = useTechnicalT();
  const [techOpen, setTechOpen] = useState(false);
  const [techControls, setTechControls] = useState<TechControls>(TECH_DEFAULT_CONTROLS);
  const techScan = useTechnicalScan(techOpen);
  const techSource = techScan.phase === "settled" && techScan.source.kind === "ready" ? techScan.source : null;
  const techNow = techScan.phase === "settled" ? techScan.now : 0;
  const techOnScreen = techOpen && techSource !== null;
  const techScreen = useMemo(() => technicalScreenOf(techControls), [techControls]);
  const techGate = techOnScreen && techControlsActive(techControls);

  // ── label helpers ──────────────────────────────────────────────────────
  const gicsLabel = useCallback((g: string) => (GICS_TKEY[g] ? t(GICS_TKEY[g]) : g), [t]);
  const assetLabel = useCallback((v: string) => {
    const o = ASSET_OPTS.find((x) => x.v === v);
    return o ? t(o.key) : v;
  }, [t]);

  // Coverage is COMPUTED, never the hardcoded 91 — the flagship set grows (it was 37 before).
  const trackedCount = useMemo(() => {
    let n = 0;
    for (const r of rows) if (r.verdict != null) n++;
    return n;
  }, [rows]);

  // ── E03 cross-market projection ────────────────────────────────────────
  const ct = useCrossMarketT();
  const zi = lang === "zh" ? 1 : 0;
  // Labels are stored as their source's own string and only DISPLAYED translated, so a language
  // change never changes what a filter selects.
  const labelText = useCallback((tax: TaxonomyId, l: string) => (
    tax === "gics_sector" ? gicsLabel(l) : tax === "yahoo_sector" && lang === "zh" ? (YAHOO_SECTOR_ZH[l] ?? l) : l
  ), [gicsLabel, lang]);
  const tax = effectiveTaxonomy(f);

  // Per listing, computed once per scan/taxonomy: the unit of its money cells and what its
  // sector cell says (with taxonomy, age and staleness). `key` is the sector sort key.
  const annot = useMemo(() => {
    const m = new Map<string, { cur: MoneyCurrency; disp: SectorDisplay; key: string | null }>();
    if (!scan) return m;
    for (const r of rows) {
      const disp = sectorDisplay(scan, r, tax, now);
      m.set(r.sym, {
        cur: moneyCurrency(scan, r.sym),
        disp,
        key: disp.kind === "label" ? `${TAXONOMY_IDS.indexOf(disp.taxonomy)}|${disp.label}` : null,
      });
    }
    return m;
  }, [rows, scan, tax, now]);

  // The market population a screen is set against: the named market, or — for "all markets" —
  // the markets this user's preferences show (unless widened for the session).
  // Prefs narrow the base scope only when the user has NOT named a market: an explicit market
  // selection always shows that market (explicit intent wins, as in SearchModal).
  const prefsGate = prefsReady && !showAllMarkets && prefs.enabled.length < ALL_MARKETS.length;
  const gateByPrefs = f.market === "all" && prefsGate;
  const populationOf = useCallback((market: FilterState["market"]) => rows.filter((r) => (
    market !== "all" ? r.mktId === market : !prefsGate || isSymbolVisible(r.sym, r, prefs)
  )), [rows, prefs, prefsGate]);
  const marketPop = useMemo(() => populationOf(f.market), [populationOf, f.market]);

  // The ONE currency a traded-value floor (and the traded-value sort) applies in. Auto = USD
  // for the all-markets screen, the market's most common listing currency otherwise.
  const scope = useMemo(() => {
    const cur = marketPop.map((r) => annot.get(r.sym)?.cur ?? { kind: "unknown" as const, reason: "scan_pending" });
    return resolveCurrencyScope(f.ccy, cur, f.market === "all" ? "USD" : null);
  }, [marketPop, annot, f.ccy, f.market]);
  const autoCode = useMemo(() => {
    if (scope.auto) return scope.code;
    const cur = marketPop.map((r) => annot.get(r.sym)?.cur ?? { kind: "unknown" as const, reason: "scan_pending" });
    return resolveCurrencyScope("auto", cur, f.market === "all" ? "USD" : null).code;
  }, [scope, marketPop, annot, f.market]);

  // Labels present (current or stale) in this market under the screened taxonomy. A label the
  // user already picked stays selectable even when no listing here carries it.
  const labelOptions = useMemo(() => {
    if (!scan || !tax) return [] as string[];
    const s = new Set<string>();
    for (const r of marketPop) {
      const c = resolveLabel(scan, r, tax, now);
      const st = labelStanding(c);
      if (st === "current" || st === "stale") s.add(labelOf(c) as string);
    }
    if (f.sector !== "all" && f.sector !== UNCLASSIFIED) s.add(f.sector);
    return Array.from(s).sort((a, b) => labelText(tax, a).localeCompare(labelText(tax, b)));
  }, [scan, tax, marketPop, now, f.sector, labelText]);

  // Filters a market change (or a preset) cleared because they describe nothing in the new
  // market — named in the strip until dismissed, never silently dropped.
  const [cleared, setCleared] = useState<{ market: string; items: ClearedFilter[] } | null>(null);
  // Until the scan has been READ (pending, absent, unreadable) listing currencies and labels are
  // unknown, so nothing is cleared for lacking them: the filters are kept as set, and a floor
  // stays named but inactive (floorState) until a read can apply it.
  const scanReady = scan?.kind === "ready";
  const reconcileTo = useCallback((next: FilterState): FilterState => {
    const r = reconcileFilters(next, populationOf(next.market), {
      currency: (row: Row) => annot.get(row.sym)?.cur ?? { kind: "unknown", reason: "scan_pending" },
      mcap: (row: Row) => row.mcap,
      label: (row: Row, t2: TaxonomyId) => (scan
        ? resolveLabel(scan, row, t2, now)
        : { taxonomy: t2, coverage: { status: "unavailable", reason: "scan_pending" }, cell: null }),
    }, { preferred: next.market === "all" ? "USD" : null, readable: scanReady });
    setCleared(r.cleared.length > 0 ? { market: next.market, items: r.cleared } : null);
    return r.next;
  }, [scan, scanReady, populationOf, annot, now]);

  // Whether the traded-value floor is APPLIED here (one currency, read), or set but inactive —
  // and then named in the strip and on its chip, never silently filtering on an unread unit.
  const floorSt = useMemo(() => floorState(f.liq, f.liqCcy, scope.code, scanReady), [f.liq, f.liqCcy, scope.code, scanReady]);
  const appliedLiq = floorSt.kind === "applied" ? f.liq : 0;
  const floorText = formatFloor(f.liq, f.liqCcy ?? scope.code);
  // A floor set before any currency was read (or by a legacy preset without one) is bound to
  // the first scope it applies in — from then on a scope change clears it by name.
  useEffect(() => {
    if (!scanReady || scope.code === null || !(f.liq > 0) || f.liqCcy != null) return;
    const code = scope.code;
    setF((cur) => (cur.liq > 0 && cur.liqCcy == null ? { ...cur, liqCcy: code } : cur));
  }, [scanReady, scope.code, f.liq, f.liqCcy]);

  // E04 smart screens hold a GICS sector and a floor in US dollars. The bar is handed to them only
  // in a sense that grammar can hold; otherwise Save refuses (smartScreenHandover), so a Yahoo
  // label is never filed as GICS nor an HKD floor as dollars.
  const smartFilters = useMemo(() => smartScreenHandover(f, floorSt, scope).filters, [f, floorSt, scope]);

  // ── view mode: signal scope switches the whole column set ──────────────
  const signalView = f.signal !== "any" || f.uptrend;

  // A sort key that does not exist in the active column set falls back to that view's default
  // rather than being written back to state — switching views and back restores the user's pick.
  const effSort = useMemo(() => {
    const def = signalView ? DEF_SORT_S : DEF_SORT_U;
    if (!sort) return def;
    const ff = fundSortField(sort.k);
    if (ff) return fundCols.includes(ff) ? sort : def;
    return (signalView ? S_KEYS : U_KEYS).includes(sort.k) ? sort : def;
  }, [signalView, sort, fundCols]);

  // ── filtered view (single pass) ────────────────────────────────────────
  // Aggregates are computed AFTER the predicates run, on the filtered array — the old
  // component accumulated them inside the predicate, so the counts never reacted to a filter.
  const { view, nBuy, nSell, hiddenN, hiddenFrom, excl, coverage, techReq, techHidden, fundCells, fundTally, fundSummary, fundWait } = useMemo(() => {
    const qRaw = search.trim();
    const q = qRaw.toLowerCase();
    const explicitMkt = f.market !== "all";
    let hidden = 0;
    const from = new Set<MarketId>();
    // E03: the classification predicate (native taxonomy, stale only by opt-in) and the money
    // floor (one currency scope) run after every other filter, so their exclusion counts and the
    // current/stale/unclassified split describe rows that would OTHERWISE be results.
    const pred = classPredicateOf(f);
    const ex: ExclusionCounts = { ...NO_EXCLUSIONS };
    const cov: LabelCoverage | null = scan && tax ? { current: 0, stale: 0, unclassified: 0, unavailable: 0 } : null;
    // E01: the technical screen's REQUESTED universe is every row the manifest filters admit
    // and the market gate shows; the coverage strip accounts for all of them (AC-E01-02).
    const techReq: string[] = [];
    let techHidden = 0;

    const base = rowsJoined.filter((r) => {
      if (!f.unpriced && r.last == null) return false;
      if (explicitMkt && r.mktId !== f.market) return false;
      if (f.asset !== "all" && r.sec !== f.asset) return false;

      if (f.signal === "buy" && !isBuy(r.verdict)) return false;
      if (f.signal === "sell" && (r.verdict == null || isBuy(r.verdict))) return false;
      if (f.signal === "tracked" && r.verdict == null) return false;
      if (f.uptrend && r.regimeBull !== true) return false;

      if (f.mcap > 0 && (r.mcap == null || r.mcap < f.mcap)) return false;

      if (f.w52 === "nearHigh" && (r.offHi == null || r.offHi < -5)) return false;
      if (f.w52 === "within15" && (r.offHi == null || r.offHi < -15)) return false;
      if (f.w52 === "dd30" && (r.offHi == null || r.offHi > -30)) return false;
      if (f.w52 === "nearLow" && (r.offLo == null || r.offLo > 10)) return false;

      if (f.move !== "any") {
        if (r.chg == null) return false;
        if (f.move === "up3" && r.chg < 3) return false;
        if (f.move === "down3" && r.chg > -3) return false;
        if (f.move === "abs5" && Math.abs(r.chg) < 5) return false;
      }

      // zh names are searchable here now — they were unreachable in the old component
      if (q && !r.sym.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q) && !(r.zh && r.zh.includes(qRaw))) return false;

      const visible = !gateByPrefs || isSymbolVisible(r.sym, r, prefs);
      if (scan) {
        const cls = pred || cov ? resolveLabel(scan, r, tax as TaxonomyId, now) : null;
        if (cov && cls && visible) cov[labelStanding(cls)]++;
        const cur = annot.get(r.sym)?.cur ?? { kind: "unknown" as const, reason: "not_in_scan" };
        const x = screenCrossMarket(cls, pred, { v: r.dv, cur }, appliedLiq, scope.code);
        if (x !== null) { if (x !== "fail" && visible) ex[x]++; return false; }
      } else if (f.liq > 0 || pred) {
        return false; // no read has settled: nothing is admitted on a rule it cannot evaluate
      }

      if (techOnScreen) {
        if (visible) techReq.push(r.sym);
        if (techGate) {
          const m = evaluateTechnicalScreen(techSource!, r.sym, techScreen, techNow).match;
          // A name that was not evaluated is hidden only as "unknown" and counted, never
          // dropped silently or shown as a negative signal.
          if (!passes(m)) { if (visible && m === "unknown") techHidden++; return false; }
        }
      }

      // Market-visibility gate LAST, so the hidden count describes rows that would OTHERWISE
      // be results — the same semantics as SearchModal's hiddenByMarket notice.
      if (!visible) { hidden++; from.add(r.mktId); return false; }
      return true;
    });

    // ── fundamental screen (E02) — after every other filter and the market gate ──
    // A predicate is applied only against a settled scan. Until it answers, the table waits
    // (skeleton) instead of showing the unfiltered rows as if the filter had run.
    const fsrc = fund.source;
    const fundWaiting = fundPreds.length > 0 && fsrc === null;
    let kept = fundWaiting ? [] : base;
    let cellsBy: Map<string, Partial<Record<FundamentalFieldId, FundamentalClassification>>> | null = null;
    let tallyOut: FundamentalTally | null = null;
    let summary: FundamentalFieldSummary | null = null;
    if (fsrc && (fundCols.length > 0 || fundPreds.length > 0)) {
      cellsBy = new Map();
      const tally = fundPreds.length > 0 ? createFundamentalTally(fundPreds) : null;
      const out: Row[] = [];
      for (const r of base) {
        const res = evaluateFundamentalScreen(fsrc, r.sym, fundPreds, fund.nowMs);
        for (const id of fundCols) if (!res.cells[id]) res.cells[id] = classifyFundamental(fsrc, r.sym, id, fund.nowMs);
        cellsBy.set(r.sym, res.cells);
        tally?.record(r.sym, res);
        if (fundPreds.length === 0 || passes(res.match)) out.push(r);
      }
      kept = out;
      tallyOut = tally ? tally.result() : null;
      // The edited field's coverage over the rows the OTHER filters left — the same population
      // the tally's "of N" names — with the period span its known values belong to.
      if (fundOpen) {
        const by = cellsBy;
        summary = summarizeFundamentalField(base.map((r) => r.sym), (id) => by.get(id)?.[fundField] ?? classifyFundamental(fsrc, id, fundField, fund.nowMs), fundField);
      }
    }

    let b = 0, s = 0;
    for (const r of kept) { if (isBuy(r.verdict)) b++; else if (r.verdict) s++; }

    // sort — nulls always last regardless of direction. Traded value is compared only within
    // one currency (scope currency first, then each other currency as its own block; a listing
    // whose currency was not read is ordered only against its own market); the sector column
    // sorts by taxonomy, then label. A fundamental column sorts on EVALUATED values only: a
    // stale or unknown cell is never ranked as if it were current.
    const noCur = { kind: "unknown" as const, reason: "not_in_scan" };
    const ff = fundSortField(effSort.k);
    const keyOf = (r: Row): unknown => {
      if (ff) {
        const c = cellsBy?.get(r.sym)?.[ff];
        return c && c.coverage.status === "evaluated" ? c.value : null;
      }
      if (effSort.k === "gics") return annot.get(r.sym)?.key ?? null;
      return r[effSort.k as keyof Row];
    };
    const sorted = [...kept].sort((a, b2) => {
      if (effSort.k === "dv") {
        return compareMoney(
          { v: a.dv, cur: annot.get(a.sym)?.cur ?? noCur, mkt: a.mktId },
          { v: b2.dv, cur: annot.get(b2.sym)?.cur ?? noCur, mkt: b2.mktId },
          scope.code, effSort.dir,
        );
      }
      const x: any = keyOf(a);
      const y: any = keyOf(b2);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * effSort.dir;
    });

    return {
      view: sorted, nBuy: b, nSell: s, hiddenN: hidden, hiddenFrom: Array.from(from), excl: ex, coverage: cov, techReq, techHidden,
      fundCells: cellsBy, fundTally: tallyOut, fundSummary: summary, fundWait: fundWaiting,
    };
  }, [
    rowsJoined, f, search, effSort, prefs, gateByPrefs, scan, tax, now, annot, scope.code, appliedLiq,
    techOnScreen, techGate, techSource, techScreen, techNow,
    fund.source, fund.nowMs, fundPreds, fundCols, fundOpen, fundField,
  ]);
  const exclTotal = excl.stale + excl.unclassified + excl.unread + excl.otherCurrency + excl.currencyUnknown + excl.notMoney;
  // Rows / counts / empty state render only over a settled result (manifest AND, when a
  // fundamental filter is held, the fundamental scan).
  const tableReady = loaded && !err && !fundWait;

  const techSummary = useMemo(
    () => (techSource ? technicalCoverageSummary(techReq, techSource, techControls.tf, techNow) : null),
    [techReq, techSource, techControls.tf, techNow],
  );

  // ── virtualization window ──────────────────────────────────────────────
  const rowH = density === "k" ? ROW_H_COMPACT : ROW_H_COMFORT;
  const skelH = density === "k" ? 14 : 20;
  const totalH = view.length * rowH;
  const startIdx = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
  const visibleCount = Math.ceil(viewportH / rowH) + OVERSCAN * 2;
  const endIdx = Math.min(view.length, startIdx + visibleCount);
  const paddingTop = startIdx * rowH;
  const paddingBottom = Math.max(0, totalH - endIdx * rowH);
  const windowedRows = view.slice(startIdx, endIdx);

  // ── filter mutation (any manual change drops the active-preset highlight) ──
  const patchF = useCallback((p: Partial<FilterState>) => {
    startTransition(() => { setActivePreset(null); setF((cur) => ({ ...cur, ...p })); });
  }, []);

  const clearAll = useCallback(() => {
    setCleared(null);
    startTransition(() => {
      setActivePreset(null);
      setF(DEFAULT_FILTERS);
      setTechControls((c) => ({ ...TECH_DEFAULT_CONTROLS, tf: c.tf }));
      setFundPreds([]);
      setFundEpoch((n) => n + 1);
    });
  }, []);

  // A market change keeps every filter that still describes part of the new market and clears
  // (by name, in the strip) each one that describes none of it — AC-E03-05.
  const changeMarket = useCallback((market: FilterState["market"]) => {
    const next = reconcileTo({ ...f, market });
    startTransition(() => { setActivePreset(null); setF(next); });
  }, [f, reconcileTo]);

  // A currency-scope change moves the unit a floor is read in, so it is reconciled the same way:
  // a floor set in another currency is cleared by name, never re-read as the same number.
  const changeCcy = useCallback((ccy: string) => {
    const next = reconcileTo({ ...f, ccy });
    startTransition(() => { setActivePreset(null); setF(next); });
  }, [f, reconcileTo]);

  // Clicking a preset replaces the whole FilterState; clicking the active one clears the
  // FilterState only. Presets never carry fundamental (E02) conditions, so any the table holds are
  // kept either way and stay visible as chips. Saved payloads are spread over DEFAULT_FILTERS so
  // an older stored shape can never leave a filter key undefined.
  const applyPreset = useCallback((id: string, patch: Partial<FilterState>) => {
    const off = activePreset === id;
    const next = off ? DEFAULT_FILTERS : reconcileTo({ ...DEFAULT_FILTERS, ...patch });
    if (off) setCleared(null);
    startTransition(() => {
      setActivePreset(off ? null : id);
      setF(next);
    });
  }, [activePreset, reconcileTo]);

  // A smart screen hands the bar back in ITS vocabulary — a GICS sector, a floor shown in US
  // dollars — so it is read in that sense and reconciled like a preset: opened on another
  // currency, the floor is cleared by name instead of being re-read as the same number.
  const openSmartScreen = useCallback((next: ScreenerFilters, o: { showAllMarkets: boolean | null; fund: FundamentalPredicate[] }) => {
    const merged = reconcileTo({ ...DEFAULT_FILTERS, ...next, ...sanitizeCrossMarketFields(next) });
    startTransition(() => {
      setActivePreset(null);
      setF(merged);
      // A saved screen is applied whole: its fundamental conditions replace the table's, and the
      // editor's draft follows even where the screen has no condition on the selected field.
      setFundPreds(o.fund);
      setFundEpoch((n) => n + 1);
      if (o.showAllMarkets !== null) setShowAllMarkets(o.showAllMarkets);
    });
  }, [reconcileTo]);

  const commitPreset = useCallback(() => {
    const name = presetName.trim().slice(0, 40);
    setSaving(false);
    setPresetName("");
    if (!name) return;
    setSaved((prev) => {
      const next = [...prev, { id: "sp" + Date.now().toString(36), name, f: { ...f } }].slice(-PRESET_CAP);
      writePresets(next);
      return next;
    });
  }, [presetName, f]);

  const deletePreset = useCallback((id: string) => {
    setSaved((prev) => { const next = prev.filter((p) => p.id !== id); writePresets(next); return next; });
    setActivePreset((cur) => (cur === id ? null : cur));
  }, []);

  // ── active-filter chips for the status row ─────────────────────────────
  const tags: { id: string; label: string; clear: Partial<FilterState> }[] = [];
  if (f.market !== "all") tags.push({ id: "market", label: t(MARKET_TKEY[f.market]), clear: { market: "all" } });
  if (f.asset !== "all") tags.push({ id: "asset", label: assetLabel(f.asset), clear: { asset: "all" } });
  if (f.sector !== "all" && tax) {
    const lbl = f.sector === UNCLASSIFIED ? ct("cmUnclassified") : labelText(tax, f.sector);
    tags.push({
      id: "sector",
      label: `${TAXONOMY_LEX[tax].chip[zi]} · ${lbl}${f.classStale ? ` · ${ct("cmInclStale")}` : ""}`,
      clear: { sector: "all", classStale: false },
    });
  }
  if (f.signal !== "any") {
    tags.push({
      id: "signal",
      label: t(f.signal === "buy" ? "scr2SigBuy" : f.signal === "sell" ? "scr2SigSell" : "scr2SigTracked"),
      clear: { signal: "any" },
    });
  }
  if (f.uptrend) tags.push({ id: "uptrend", label: t("uptrendRegime"), clear: { uptrend: false } });
  if (f.liq > 0) {
    tags.push({
      id: "liq",
      label: `${ct("cmMinTraded")} ≥ ${floorText}${floorSt.kind === "applied" ? "" : ` · ${ct("cmNotApplied")}`}`,
      clear: { liq: 0, liqCcy: null },
    });
  }
  if (f.ccy && f.ccy !== "auto") tags.push({ id: "ccy", label: `${ct("cmCcy")} · ${f.ccy}`, clear: { ccy: "auto" } });
  if (f.mcap > 0) tags.push({ id: "mcap", label: `${t("scr2Mcap")} ≥ ${floorUsd(f.mcap)}`, clear: { mcap: 0 } });
  if (f.w52 !== "any") tags.push({ id: "w52", label: t(W52_OPTS.find((o) => o.v === f.w52)!.key), clear: { w52: "any" } });
  if (f.move !== "any") tags.push({ id: "move", label: t(MOVE_OPTS.find((o) => o.v === f.move)!.key), clear: { move: "any" } });
  if (f.unpriced) tags.push({ id: "unpriced", label: t("scr2InclThin"), clear: { unpriced: false } });

  // ── column set for the active view ─────────────────────────────────────
  type ColDef = { k: SortKey; label: string; w: string; title?: string; fund?: FundamentalFieldId };
  const dvCol = { k: "dv" as SortKey, label: ct("cmTraded"), w: "76px", title: ct("cmTradedTitle") };
  const viewCols: ColDef[] = signalView
    ? [
      { k: "sym", label: t("symbol"), w: "150px" },
      { k: "last", label: t("colLast"), w: "70px" },
      { k: "chg", label: t("colChgPctShort"), w: "62px" },
      { k: "verdict", label: t("signalCol"), w: "66px" },
      { k: "regimeBull", label: t("regime"), w: "68px" },
      { k: "wr", label: t("winRate"), w: "54px" },
      { k: "pf", label: t("profitFactor"), w: "50px" },
      { k: "cagr", label: t("cagr"), w: "96px" },
      dvCol,
    ]
    : [
      { k: "sym", label: t("symbol"), w: "150px" },
      { k: "last", label: t("colLast"), w: "70px" },
      { k: "chg", label: t("colChgPctShort"), w: "62px" },
      dvCol,
      { k: "mcap", label: t("colMcap"), w: "76px", title: ct("cmMcapUsd") },
      { k: "offHi", label: t("colOffHigh"), w: "66px" },
      { k: "gics", label: tax === "yahoo_industry" ? ct("cmIndustry") : t("colSector"), w: "110px" },
      // R3.2 msc_* columns exist only while the positioning index is loaded — the thead
      // and the tbody share this ONE condition so the positional cells can't misalign.
      ...(glance ? [
        { k: "mscRank" as SortKey, label: t("colMscRegime"), w: "78px" },
        { k: "mscNetGex" as SortKey, label: t("colMscNetGex"), w: "70px" },
        { k: "mscFlip" as SortKey, label: t("colMscFlip"), w: "64px" },
      ] : []),
      { k: "verdict", label: t("signalCol"), w: "66px" },
    ];
  // Fundamental columns ride at the END of either view (positional cells stay aligned).
  const cols: ColDef[] = [
    ...viewCols,
    ...fundCols.map((id) => ({ k: `fund:${id}` as SortKey, label: fieldColumn(ft, id), w: "60px", fund: id })),
  ];

  // Every full-width row spans the visible columns, including the technical one when shown.
  const colN = cols.length + (techOnScreen ? 1 : 0);

  // "{n} results" with the numeral in a <b> so it can carry tabular-nums
  const resultLine = (() => {
    const tpl = t("scr2Results");
    const n = view.length.toLocaleString();
    const i = tpl.indexOf("{n}");
    if (i < 0) return <>{tpl}</>;
    return <>{tpl.slice(0, i)}<b>{n}</b>{tpl.slice(i + 3)}</>;
  })();

  return (
    <main className={`main2 screener-main scr2 ${signalView ? "s-view" : "u-view"}${density === "k" ? " den-k" : ""}${techOnScreen ? ` ${TECH_ON_CLASS}` : ""}`}>
      <div className="scr2-bar">
        {/* ── scope row ── */}
        <div className="scr2-row">
          <select
            className="scr2-select"
            aria-label={t("scr2Market")}
            title={t("scr2Market")}
            value={f.market}
            onChange={(e) => changeMarket(e.target.value as FilterState["market"])}
          >
            <option value="all">{t("scr2AllMarkets")}</option>
            {ALL_MARKETS.map((m) => <option key={m} value={m}>{t(MARKET_TKEY[m])}</option>)}
          </select>

          <select
            className="scr2-select"
            aria-label={t("scr2Asset")}
            title={t("scr2Asset")}
            value={f.asset}
            onChange={(e) => patchF({ asset: e.target.value })}
          >
            <option value="all">{t("scr2AssetAll")}</option>
            {ASSET_OPTS.map((o) => <option key={o.v} value={o.v}>{t(o.key)}</option>)}
          </select>

          {/* E03: a label is picked WITHIN one native taxonomy — no crosswalk between them */}
          <select
            className="scr2-select"
            aria-label={ct("cmTaxonomy")}
            title={ct("cmTaxonomy")}
            data-cm-control="taxonomy"
            value={tax ?? ""}
            onChange={(e) => patchF({ taxonomy: (e.target.value || null) as TaxonomyId | null, sector: "all", classStale: false })}
          >
            <option value="">{ct("cmTaxonomyAny")}</option>
            {TAXONOMY_IDS.map((id) => <option key={id} value={id}>{TAXONOMY_LEX[id].name[zi]}</option>)}
          </select>

          <select
            className="scr2-select"
            aria-label={ct("cmLabel")}
            title={tax ? ct("cmLabel") : ct("cmLabelPick")}
            data-cm-control="label"
            disabled={!tax}
            value={f.sector}
            onChange={(e) => patchF({ sector: e.target.value, classStale: false })}
          >
            <option value="all">{ct("cmLabelAll")}</option>
            {tax && labelOptions.map((l) => <option key={l} value={l}>{labelText(tax, l)}</option>)}
            {/* "Unclassified" is a population only of listings that were READ and carry no label;
                without a read there is none to offer (an unread label is unknown, not absent). */}
            {tax && (scanReady || f.sector === UNCLASSIFIED) && (
              <option value={UNCLASSIFIED} disabled={!scanReady}>{ct("cmUnclassified")}</option>
            )}
          </select>

          <input
            className="scr2-search"
            type="search"
            placeholder={t("scrSearchPlaceholder")}
            aria-label={t("scrSearchPlaceholder")}
            value={searchRaw}
            onChange={(e) => { const v = e.target.value; startTransition(() => setSearchRaw(v)); }}
          />

          <div className="scr2-presetbar">
            <div className="scr2-presets">
              {BUILTIN_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`fin-tab${activePreset === p.id ? " on" : ""}`}
                  onClick={() => applyPreset(p.id, p.f)}
                >{t(p.key)}</button>
              ))}
              {saved.map((p) => (
                <span key={p.id} className="scr2-preset-wrap">
                  <button
                    type="button"
                    className={`fin-tab${activePreset === p.id ? " on" : ""}`}
                    onClick={() => applyPreset(p.id, p.f)}
                  >{p.name}</button>
                  <button
                    type="button"
                    className="scr2-preset-x"
                    aria-label={`${t("scr2DeletePreset")}: ${p.name}`}
                    onClick={() => deletePreset(p.id)}
                  >×</button>
                </span>
              ))}
            </div>

            {/* Save sits OUTSIDE the scrolling strip — it is an action, not a preset, and must
                not scroll (or wrap) out of reach once the strip overflows. */}
            <div className="scr2-presets-tail">
              {saving ? (
                <input
                  className="scr2-preset-name"
                  autoFocus
                  placeholder={t("scr2PresetName")}
                  aria-label={t("scr2PresetName")}
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitPreset();
                    else if (e.key === "Escape") { setSaving(false); setPresetName(""); }
                  }}
                  onBlur={() => { setSaving(false); setPresetName(""); }}
                />
              ) : (
                <button type="button" className="fin-tab" onClick={() => setSaving(true)}>{t("scr2Save")}</button>
              )}
            </div>
          </div>
        </div>

        {/* ── criteria row ── */}
        <div className="scr2-row">
          <div className="fin-toggle" role="group" aria-label={t("signalCol")}>
            <button type="button" className={f.signal === "any" ? "on" : ""} onClick={() => patchF({ signal: "any" })}>{t("scr2Any")}</button>
            <button type="button" className={f.signal === "buy" ? "on" : ""} onClick={() => patchF({ signal: "buy" })}>{t("scr2SigBuy")}</button>
            <button type="button" className={f.signal === "sell" ? "on" : ""} onClick={() => patchF({ signal: "sell" })}>{t("scr2SigSell")}</button>
            <button type="button" className={f.signal === "tracked" ? "on" : ""} onClick={() => patchF({ signal: "tracked" })}>{t("scr2SigTracked")}</button>
          </div>

          <button
            type="button"
            className={`chip${f.uptrend ? " on" : ""}`}
            aria-pressed={f.uptrend}
            onClick={() => patchF({ uptrend: !f.uptrend })}
          >{t("uptrendRegime")}</button>

          {/* E03: a traded-value floor is applied in ONE currency scope — never across currencies */}
          <select
            className="scr2-select"
            aria-label={ct("cmMinTraded")}
            title={scope.code === null ? ct("cmLiqOff") : ct("cmMinTraded")}
            data-cm-control="liq"
            disabled={scope.code === null && f.liq === 0}
            value={String(f.liq)}
            onChange={(e) => {
              const v = Number(e.target.value);
              // the floor is set IN the scope currency shown beside it, and remembers it
              patchF({ liq: v, liqCcy: v > 0 && scanReady ? scope.code : null });
            }}
          >
            <option value="0">{`${ct("cmMinTraded")} · ${t("scr2Any")}`}</option>
            {/* the floor that is set reads in the currency it was set in; the others in the scope's */}
            {LIQ_FLOORS.map((n) => (
              <option key={n} value={String(n)}>{`≥ ${formatFloor(n, n === f.liq && f.liqCcy ? f.liqCcy : scope.code)}`}</option>
            ))}
          </select>

          <select
            className="scr2-select"
            aria-label={ct("cmCcy")}
            title={ct("cmCcy")}
            data-cm-control="ccy"
            disabled={scope.codes.length === 0 && (f.ccy ?? "auto") === "auto"}
            value={f.ccy ?? "auto"}
            onChange={(e) => changeCcy(e.target.value)}
          >
            <option value="auto">{autoCode ? ct("cmCcyAuto").replace("{c}", autoCode) : ct("cmCcyNone")}</option>
            {scope.codes.map(({ code, n }) => (
              <option key={code} value={code}>{ct("cmCcyOpt").replace("{c}", code).replace("{n}", n.toLocaleString())}</option>
            ))}
            {f.ccy && f.ccy !== "auto" && !scope.codes.some((c) => c.code === f.ccy) && <option value={f.ccy}>{f.ccy}</option>}
          </select>

          <select
            className="scr2-select"
            aria-label={t("scr2Mcap")}
            title={`${t("scr2Mcap")} — ${ct("cmMcapUsd")}`}
            value={String(f.mcap)}
            onChange={(e) => patchF({ mcap: Number(e.target.value) })}
          >
            <option value="0">{`${t("scr2Mcap")} · ${t("scr2Any")}`}</option>
            {MCAP_FLOORS.map((n) => <option key={n} value={String(n)}>{`≥ ${floorUsd(n)}`}</option>)}
          </select>

          <select
            className="scr2-select"
            aria-label={t("scr2W52")}
            title={t("scr2W52")}
            value={f.w52}
            onChange={(e) => patchF({ w52: e.target.value as W52 })}
          >
            <option value="any">{`${t("scr2W52")} · ${t("scr2Any")}`}</option>
            {W52_OPTS.map((o) => <option key={o.v} value={o.v}>{t(o.key)}</option>)}
          </select>

          <select
            className="scr2-select"
            aria-label={t("scr2Move")}
            title={t("scr2Move")}
            value={f.move}
            onChange={(e) => patchF({ move: e.target.value as Move })}
          >
            <option value="any">{`${t("scr2Move")} · ${t("scr2Any")}`}</option>
            {MOVE_OPTS.map((o) => <option key={o.v} value={o.v}>{t(o.key)}</option>)}
          </select>

          <button
            type="button"
            className={`chip${f.unpriced ? " on" : ""}`}
            aria-pressed={f.unpriced}
            title={t("scrShowAllTitle")}
            onClick={() => patchF({ unpriced: !f.unpriced })}
          >{t("scr2InclThin")}</button>

          <button
            type="button"
            className={`chip${fundOpen ? " on" : ""}`}
            aria-pressed={fundOpen}
            aria-expanded={fundOpen}
            title={ft("fsToggleTitle")}
            onClick={() => setFundOpen((o) => !o)}
            data-fund-toggle=""
          >{ft("fsToggle")}{fundPreds.length > 0 ? ` · ${fundPreds.length}` : ""}</button>

          {/* margin-left:auto rides the toggle itself, not a spacer element — an auto-margin
              spacer in a wrapping flex row eats the free space and strands the toggle left. */}
          <div className="fin-toggle" role="group" aria-label={t("scr2Density")} style={{ marginLeft: "auto" }}>
            <button type="button" className={density === "c" ? "on" : ""} onClick={() => pickDensity("c")}>{t("scr2DenComfort")}</button>
            <button type="button" className={density === "k" ? "on" : ""} onClick={() => pickDensity("k")}>{t("scr2DenCompact")}</button>
          </div>
        </div>

        {/* ── technical screen row (E01) ── */}
        <TechnicalScreenBar
          open={techOpen}
          onToggle={() => setTechOpen((o) => !o)}
          scan={techScan}
          controls={techControls}
          onControls={setTechControls}
          summary={techSummary}
          hiddenUnknown={techHidden}
        />

        {/* ── fundamental row (E02): typed ranges / explicit unknown, basis + coverage ── */}
        {fundOpen && (
          <FundamentalScreenBar
            scan={fund}
            field={fundField}
            onField={setFundField}
            predicates={fundPreds}
            onPredicates={setFundPreds}
            summary={tableReady ? fundSummary : null}
            sourceEpoch={fundEpoch}
          />
        )}
      </div>

      {/* ── E03: scan state, screened taxonomy, money scope and market-change clears ── */}
      {loaded && !err && scan && (
        <CrossMarketStrip
          source={scan}
          now={now}
          taxonomy={tax}
          sector={f.sector}
          classStale={f.classStale === true}
          coverage={coverage}
          excl={excl}
          liq={f.liq}
          floor={floorSt}
          floorText={floorText}
          scope={scope}
          cleared={cleared}
          marketName={(m) => (m === "all" ? t("scr2AllMarkets") : t(MARKET_TKEY[m as MarketId]))}
          labelText={labelText}
          onRetry={retryScan}
          onToggleStale={() => patchF({ classStale: !f.classStale })}
          onShowUnclassified={() => patchF({ sector: UNCLASSIFIED, classStale: false })}
          onDismissCleared={() => setCleared(null)}
        />
      )}
      {/* E04 smart screens: account-saved, explainable screens with on-demand entered/left review. */}
      <SmartScreensPanel
        identity={identity}
        rows={rows}
        ready={loaded && !err}
        asOf={asOf}
        filters={smartFilters}
        fundPreds={fundPreds}
        fundScan={fundCtx}
        onFundNeeded={setFundWanted}
        prefsEnabled={prefsReady ? prefs.enabled : null}
        showAllMarkets={showAllMarkets}
        labelGics={gicsLabel}
        labelAsset={assetLabel}
        onOpen={openSmartScreen}
      />

      {/* ── status row: counts computed over the FILTERED set, plus scope honesty ── */}
      <div className="scr2-status">
        {/* no count before the manifest answers — "0 results" under a skeleton is a lie */}
        {tableReady && <span>{resultLine}</span>}

        {tableReady && signalView && (
          <>
            <span className="fin-tag" style={{ "--c": "var(--brand-2)" } as React.CSSProperties}>
              {t("scr2Coverage").replace("{n}", trackedCount.toLocaleString())}
            </span>
            <span><b className="up">{nBuy.toLocaleString()}</b> {t("buyLc")}</span>
            <span><b className="down">{nSell.toLocaleString()}</b> {t("sellLc")}</span>
          </>
        )}

        {tags.map((tg) => (
          <button
            key={tg.id}
            type="button"
            className="fin-tag scr2-ftag"
            style={{ "--c": "var(--brand-2)" } as React.CSSProperties}
            aria-label={`${t("remove")}: ${tg.label}`}
            onClick={() => (tg.id === "market" ? changeMarket("all") : tg.id === "ccy" ? changeCcy("auto") : patchF(tg.clear))}
          >{tg.label} ×</button>
        ))}
        <FundamentalStatusItems
          predicates={fundPreds}
          tally={tableReady ? fundTally : null}
          onRemove={(id) => setFundPreds((ps) => ps.filter((p) => p.field !== id))}
        />
        {tags.length + fundPreds.length >= 2 && (
          <button type="button" className="scr2-clear" onClick={clearAll}>{t("scr2ClearAll")}</button>
        )}

        {/* scope caveats + the hidden-markets notice ride right; one group so the auto margin
            survives a wrap instead of stranding them on the next line's left edge */}
        {(f.mcap > 0 || hiddenN > 0) && (
          <span className="scr2-status-tail">
            {f.mcap > 0 && (
              <span className="fin-tag" style={{ "--c": "var(--warn)" } as React.CSSProperties}>{t("scr2McapNote")}</span>
            )}
            {hiddenN > 0 && (
              <span className="scr2-hidden">
                {t("mktHiddenLead")} {hiddenN.toLocaleString()} {t("mktHiddenMore")}{" "}
                {hiddenFrom.map((m) => t(MARKET_TKEY[m])).join(" · ")}{" "}
                <button type="button" className="scr2-clear" onClick={() => setShowAllMarkets(true)}>{t("mktShowAll")}</button>
              </span>
            )}
          </span>
        )}
      </div>

      <div className="scr2-table" ref={tableRef}>
        <table className="scr2">
          <thead>
            <tr>
              {cols.map((c) => {
                const on = effSort.k === c.k;
                return (
                  <th
                    key={c.k}
                    className={[on ? "sorted" : "", c.fund ? fundamentalThClass : ""].filter(Boolean).join(" ")}
                    aria-sort={on ? (effSort.dir === -1 ? "descending" : "ascending") : "none"}
                    title={c.fund ? fieldName(ft, c.fund) : c.title}
                    data-fund-col={c.fund}
                    onClick={() => setSort({ k: c.k, dir: on && effSort.dir === -1 ? 1 : -1 })}
                  >
                    {c.label}{on ? (effSort.dir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                );
              })}
              {techOnScreen && <th className={TECH_TH_CLASS} data-tech-col>{tt("tsColumn", { tf: techControls.tf })}</th>}
            </tr>
          </thead>
          <tbody>
            {/* loading skeleton — .fin-skel, sized to the active density */}
            {(!loaded || fundWait) && !err && Array.from({ length: SHIMMER_ROWS }).map((_, i) => (
              <tr key={`sk${i}`} className="scr2-skel-row" style={{ height: rowH }}>
                {cols.map((c, j) => (
                  <td key={c.k} className={c.fund ? fundamentalTdClass : undefined}>
                    <div className="fin-skel" style={{ height: skelH, width: c.w, marginLeft: j === 0 ? 0 : "auto" }} />
                  </td>
                ))}
                {techOnScreen && <td className={TECH_CELL_CLASS}><div className="fin-skel" style={{ height: skelH, width: "96px", marginLeft: "auto" }} /></td>}
              </tr>
            ))}

            {/* error — never the no-match copy; the why-line names WHICH failure */}
            {loaded && err && (
              <tr className="empty-row">
                <td colSpan={colN}>
                  <div className="fin-empty fin-empty-lg" data-scr-fault={err}>
                    <EmptyIcon />
                    <div className="fin-empty-title">{t("scr2ErrTitle")}</div>
                    <div className="fin-empty-why">{t(err === "absent" ? "scr2ErrWhyAbsent" : "scr2ErrWhy")}</div>
                    <button type="button" className="chip" onClick={retry}>{t("scr2Retry")}</button>
                  </div>
                </td>
              </tr>
            )}

            {/* empty — the why line names WHICH reason */}
            {tableReady && view.length === 0 && (
              <tr className="empty-row">
                <td colSpan={colN}>
                  <div className="fin-empty fin-empty-lg">
                    <EmptyIcon />
                    <div className="fin-empty-title">{t("scr2EmptyTitle")}</div>
                    <div className="fin-empty-why">
                      {techGate && techSummary
                        ? tt("tsEmptyWhy", { tf: techControls.tf, u: (techSummary.account.total - techSummary.account.evaluated).toLocaleString() })
                        : signalView
                          ? t("scr2EmptySigWhy").replace("{n}", trackedCount.toLocaleString())
                          : t("scr2EmptyWhy")}
                    </div>
                    <EmptyExclusionNote n={exclTotal} />
                    {(tags.length > 0 || techGate || fundPreds.length > 0) && (
                      <button type="button" className="chip" onClick={clearAll}>{t("scr2ClearAll")}</button>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {/* top spacer preserving scroll height */}
            {tableReady && paddingTop > 0 && (
              <tr className="scr2-spacer" style={{ height: paddingTop }}><td colSpan={colN} /></tr>
            )}

            {/* windowed rows */}
            {tableReady && windowedRows.map((r) => {
              // chg coloring: neutral when chg is null (thin row or missing)
              const chgCls = r.chg == null ? "" : r.chg >= 0 ? "up" : "down";
              const buy = isBuy(r.verdict);
              const a = annot.get(r.sym);
              const cur: MoneyCurrency = a?.cur ?? { kind: "unknown", reason: "not_in_scan" };
              const symCell = (
                <td>
                  <div className="sym-cell">
                    <AssetLogo
                      className="ic"
                      symbol={r.sym}
                      name={r.name}
                      market={r.mkt || r.sec}
                      color={r.col}
                      size={density === "k" ? 20 : 24}
                    />
                    <div>
                      <div className="tk">{r.sym}<CurrencyBadge cur={cur} /></div>
                      <div className="nm">{displayName(r, lang)}</div>
                    </div>
                  </div>
                </td>
              );
              const lastCell = <td>{r.last == null ? "—" : fmt(r.last, r.last < 10 ? 4 : 2)}</td>;
              const chgCell = <td className={chgCls}>{r.chg == null ? "—" : `${r.chg >= 0 ? "+" : ""}${fmt(r.chg)}%`}</td>;
              // A data attribute for tests and styling, never rendered: the ISO code, or the kind.
              const ccyAttr = cur.kind === "code" ? cur.code : cur.kind;
              const dvCell = (
                <td
                  style={{ color: "var(--text-2)" }}
                  data-ccy={ccyAttr}
                  title={cur.kind === "unknown" ? ct("cmCcyUnknownTitle") : cur.kind === "not_money" ? ct("cmNotMoneyTitle")
                    : r.vol != null ? `${t("colVolShort")} ${shares(r.vol)}` : undefined}
                >{formatMoney(r.dv, cur)}</td>
              );
              const sigCell = (
                <td>
                  {r.verdict
                    ? <span className={`pill ${buy ? "buy" : "sell"}${verdictIsStale(r.vts) ? " stale" : ""}`} title={r.vts ? `${verdictLabel(r.verdict, lang)} · ${r.vts}` : undefined}>{verdictLabel(r.verdict, lang)}</span>
                    : "—"}
                </td>
              );
              return (
                <tr key={r.sym} onClick={() => {
                  if (searchRaw.trim()) trackSearch(r.sym, "screener", searchRaw.trim());
                  // With the technical screen on, the row opens the chart AT the screened
                  // timeframe when the chart can honour it (AC-E01-05); the strip discloses when not.
                  // Otherwise the listing href (canonical symbol, URL-encoded — E03).
                  const h = techOnScreen ? technicalChartHandover(r.sym, techControls.tf, DAILY_FUNCTIONAL_TIMEFRAMES) : null;
                  const href = h ? h.href : listingHref(r.sym);
                  if (href) router.push(href);
                }}>
                  {symCell}
                  {lastCell}
                  {chgCell}
                  {signalView ? (
                    <>
                      {sigCell}
                      <td>
                        {r.regimeBull == null
                          ? "—"
                          : <span className={`regchip ${r.regimeBull ? "up" : "warn"}`}>{r.regimeBull ? t("uptrend") : t("mixed")}</span>}
                      </td>
                      <td>{r.wr != null ? (r.wr * 100).toFixed(0) + "%" : "—"}</td>
                      <td>{r.pf != null ? r.pf.toFixed(2) : "—"}</td>
                      <td>{r.cagr != null ? <>{(r.cagr * 100).toFixed(1)}%<span className="bar"><i style={{ width: `${Math.max(2, Math.min(100, r.cagr * 250))}%` }} /></span></> : "—"}</td>
                      {dvCell}
                    </>
                  ) : (
                    <>
                      {dvCell}
                      <td>{usd(r.mcap)}</td>
                      {/* position, not day direction — never up/down coloured */}
                      <td>{r.offHi == null ? "—" : `${r.offHi > 0 ? "+" : ""}${r.offHi.toFixed(1)}%`}</td>
                      <td className="scr2-sec">{a ? <SectorCellContent d={a.disp} labelText={labelText} /> : "—"}</td>
                      {glance && (
                        <>
                          {/* γ regime — the desk's word + colour (one table, lib/mscGlance) */}
                          <td>{r.mscRegime ? <span style={{ color: REGIME_COLORS[r.mscRegime] }}>{gexT(`regime${r.mscRegime}`) || notClassified(lang)}</span> : "—"}</td>
                          {/* net dealer gamma — polarity tone (the desk's POSITIVE/NEGATIVE pairing) */}
                          <td className={r.mscNetGex != null ? (r.mscNetGex >= 0 ? "up" : "down") : ""}>{r.mscNetGex != null ? `${r.mscNetGex >= 0 ? "+" : ""}${r.mscNetGex.toFixed(1)}B` : "—"}</td>
                          {/* distance to flip — position, not day direction (offHi precedent) */}
                          <td>{r.mscFlip != null ? `${r.mscFlip > 0 ? "+" : ""}${r.mscFlip.toFixed(1)}%` : "—"}</td>
                        </>
                      )}
                      {sigCell}
                    </>
                  )}
                  {fundCols.map((id) => (
                    <FundamentalCell
                      key={id}
                      field={id}
                      c={fundCells?.get(r.sym)?.[id]}
                      sym={r.sym}
                      t={ft}
                      onOpen={(sym, field, el) => setEvidence({ sym, name: displayName(r, lang), field, opener: el })}
                    />
                  ))}
                  {techOnScreen && <TechnicalCell c={classifyTechnical(techSource!, r.sym, techControls.tf, techNow)} />}
                </tr>
              );
            })}

            {/* bottom spacer preserving scroll height */}
            {tableReady && paddingBottom > 0 && (
              <tr className="scr2-spacer" style={{ height: paddingBottom }}><td colSpan={colN} /></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* provenance waits for real numbers — an as-of of "—" beside "0 tracked names" would
          describe a dataset that does not exist yet */}
      {loaded && !err && (
        <div className="fin-asof scr2-asof">
          <span>{t("scr2Prov1").replace("{d}", asOf || "—")}</span>
          <span aria-hidden="true">·</span>
          <span>{t("scr2Prov2").replace("{n}", trackedCount.toLocaleString())}</span>
        </div>
      )}

      {evidence && (
        <FundamentalEvidence
          key={`${evidence.sym}|${evidence.field}`}
          sym={evidence.sym}
          name={evidence.name}
          field={evidence.field}
          source={fund.source}
          nowMs={fund.nowMs}
          onClose={closeEvidence}
          returnFocus={evidence.opener}
        />
      )}
    </main>
  );
}
