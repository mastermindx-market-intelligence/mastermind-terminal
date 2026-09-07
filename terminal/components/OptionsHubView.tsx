"use client";
import {
  memo,
  useCallback, useDeferredValue, useEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { useLang, useT } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { daysHeld, daysToExpiry, volAboveOi } from "@/lib/plainAbbrev";
import { CoachProvider, useCoach } from "@/lib/tutorial/coach";
import { getTutStr } from "@/lib/tutorial/tutorialStrings";
import { abbrevSector } from "@/lib/sectorAbbrev";
import { windowGexRows } from "@/lib/windowGexRows.mjs";
import { flowGet, flowInvalidate, flowPrefetch } from "@/lib/flowClientCache";
import { useFlowStream } from "@/lib/flowStream";
import { usOptionsSessionState } from "@/lib/flowFreshness";
import { trackSearch } from "@/lib/searchTrack";
import { normalizeVolUnits } from "@/lib/eodContext";
import {
  OPTIONS_SCREENER_EXPORT_SCHEMA,
  buildOptionsScreenerCsv,
  buildOptionsScreenerCsvFilename,
  buildOptionsTapeCsv,
  buildOptionsTapeCsvFilename,
} from "@/lib/optionsCsv";
import {
  resolveScreenerSort,
  selectFreshRows,
  selectHotRows,
  selectOiRows,
  selectTopPremiumRows,
  selectUnusualRows,
  selectZeroDteRows,
  type OptionsScreenerCsvRow,
  type ScreenerHotView,
  type ScreenerPreset,
} from "@/lib/optionsScreener";
import { VolRegimeChip } from "@/components/eodcontext/VolRegimeChip";
import { OptionsCsvExportButton } from "@/components/options/OptionsCsvExportButton";
import { OptionsFlowBoardView } from "@/components/options/OptionsFlowBoardView";
import { FlowFreshnessReceipt } from "@/components/flowdesk/FlowFreshnessReceipt";
// Shared SVG chart primitives — measured 1:1 viewBox, nice ticks, pixel-gap label
// thinning, padded domains. The hygiene rules live in that module's header.
import {
  useChartWidth, niceTicks, fmtTick, thinLabels, padDomain, MIN_CHART_H,
} from "@/components/charts/svgChart";

// ── Code-split heavy tab sub-views (ssr:false — client-only, chart/canvas heavy) ──
// Each tab is lazy-loaded on first visit; subsequent switches are instant (keep-alive).
function TabSkeleton() {
  const t = useT();
  return <div className="fin-empty" role="status" style={{ color: "var(--muted)" }}>{t("loadingTab")}</div>;
}
/** Index belt roots — the three the flow store always carries structure for. */
const INDEX_ROOTS = ["SPY", "QQQ", "IWM"];
const FlowDeskView = dynamic(
  () => import("@/components/flowdesk/FlowDeskView").then((m) => ({ default: m.FlowDeskView })),
  { ssr: false, loading: () => <TabSkeleton /> },
);
const GexDeskView = dynamic(
  () => import("@/components/gexdesk/GexDeskView").then((m) => ({ default: m.GexDeskView })),
  { ssr: false, loading: () => <TabSkeleton /> },
);
const SurfaceView = dynamic(
  () => import("@/components/surface/SurfaceView").then((m) => ({ default: m.SurfaceView })),
  { ssr: false, loading: () => <TabSkeleton /> },
);
// Session Flow pane (quanted Wave 1) — a sub-toggle of the Tide tab (smaller diff than a
// new top-level tab; consumes the tide payload's per-minute cumulative ncp/npp series).
const SessionFlowPane = dynamic(
  () => import("@/components/surface/SessionFlowPane").then((m) => ({ default: m.SessionFlowPane })),
  { ssr: false, loading: () => <TabSkeleton /> },
);
const VolView = dynamic(
  () => import("@/components/vol/VolView").then((m) => ({ default: m.VolView })),
  { ssr: false, loading: () => <TabSkeleton /> },
);
const StructureView = dynamic(
  () => import("@/components/structure/StructureView").then((m) => ({ default: m.StructureView })),
  { ssr: false, loading: () => <TabSkeleton /> },
);
const PositioningView = dynamic(
  () => import("@/components/msc/PositioningView").then((m) => ({ default: m.PositioningView })),
  { ssr: false, loading: () => <TabSkeleton /> },
);
const ProphetView = dynamic(
  () => import("@/components/prophet/ProphetLanesView").then((m) => ({ default: m.ProphetLanesView })),
  { ssr: false, loading: () => <TabSkeleton /> },
);
const LevelsView = dynamic(
  () => import("@/components/levels/LevelsView").then((m) => ({ default: m.LevelsView })),
  { ssr: false, loading: () => <TabSkeleton /> },
);
/** Tide tab's LWC chart — the hub's ONLY `lightweight-charts` consumer, so it is
 *  code-split like the desks. Keeping it inline put the whole chart engine on the
 *  Tape's first download for a surface the Tape never renders. The loading box
 *  reserves the chart's exact height so nothing reflows when the chunk lands. */
const TIDE_CHART_H = 216;
const TideChart = dynamic(
  () => import("@/components/TideChartLazy"),
  {
    ssr: false,
    loading: () => (
      <div
        className="fin-skel"
        role="status"
        aria-busy="true"
        style={{ width: "100%", height: TIDE_CHART_H, borderRadius: "var(--r-tile)" }}
      />
    ),
  },
);

// ─── Tab definition ─────────────────────────────────────────────────────────

export type TabKey = "prophet" | "levels" | "desk" | "tape" | "tide" | "zero_dte" | "largest" | "tickers" | "screener" | "gex" | "surface" | "structure" | "volatility" | "positioning" | "leaders" | "radar";

const TABS: { key: TabKey; enKey: string; zhKey: string }[] = [
  { key: "prophet",  enKey: "tabProphet",  zhKey: "tabProphet" },
  { key: "levels",   enKey: "tabLevels",   zhKey: "tabLevels" },
  { key: "desk",     enKey: "tabDesk",     zhKey: "tabDesk" },
  { key: "tape",     enKey: "tabTape",     zhKey: "tabTape" },
  { key: "tide",     enKey: "tabTide",     zhKey: "tabTide" },
  { key: "zero_dte", enKey: "tabZeroDte",  zhKey: "tabZeroDte" },
  { key: "largest",  enKey: "tabLargestEvents", zhKey: "tabLargestEvents" },
  { key: "tickers",  enKey: "tabTickers",  zhKey: "tabTickers" },
  { key: "screener", enKey: "tabScreener", zhKey: "tabScreener" },
  // "vol" tab removed from bar — vol surface now lives in the Tickers tab right column
  { key: "gex",      enKey: "tabGex",      zhKey: "tabGex" },
  { key: "surface",  enKey: "tabSurface",  zhKey: "tabSurface" },
  // R3 Structure tab (OI suite: ladder / OI-time / max pain / OI change) —
  // ordered before Volatility per the masterplan §5 category order.
  { key: "structure", enKey: "tabStructure", zhKey: "tabStructure" },
  // R3 Volatility tab (IV rank / term / skew). Distinct from the retired standalone
  // "vol" surface (folded into Tickers) and from the `vol → screener` URL alias.
  { key: "volatility", enKey: "tabVolatility", zhKey: "tabVolatility" },
  // MSC wave R0 — dealer-positioning mechanics over the SAME gex/moves payloads the
  // Exposure desk reads (sign robustness, hedge-flow scenarios, levels in expected moves,
  // gamma topology, front-expiry preview). Its own tab because the desk's left column is
  // ~296px at 1440x900 and could not hold it (see MarketStructureBody's header).
  { key: "positioning", enKey: "tabPositioning", zhKey: "tabPositioning" },
  { key: "leaders",  enKey: "tabLeaders",  zhKey: "tabLeaders" },
  { key: "radar",    enKey: "tabRadar",    zhKey: "tabRadar" },
];

// ─── Types from feed contract ────────────────────────────────────────────────

type DteBucket = "0d" | "1_7d" | "8_30d" | "31_90d" | "90p";
type MnyBucket = "itm" | "atm" | "near_otm" | "far_otm";
type Side = "~buy" | "~sell" | "mixed";

interface FlowEvent {
  id: string; ts: string; root: string; group: string; group_zh: string;
  right: "C" | "P"; exp: string; strike: number; dte: number;
  dte_bucket: DteBucket; mny_bucket: MnyBucket; side: Side;
  n_prints: number; size: number; avg_price: number; premium: number;
  premium_z: number | null; baseline_source: string; vol_gt_oi: boolean | null;
  repeated: boolean; zerodte: boolean; signing_source: string;
  swept?: boolean;
}

interface UnusualName {
  root: string; group: string; group_zh: string;
  gross_premium_today: number; prem_z: number | null; baseline_source: string;
  n_obs: number; call_prem_share: number;
  top_contracts: { right: "C" | "P"; exp: string; strike: number; premium: number }[];
}

interface HeatGroup {
  group: string; group_zh: string; gross_premium: number;
  net_signed_premium_soft: number; call_prem_share: number; n_events: number;
  top: { root: string; premium: number }[];
}

interface FeedPayload {
  schema?: string; asof: string; session_date?: string; session_pct?: number;
  baseline_note?: { en: string; zh: string };
  events: FlowEvent[]; unusual_names: UnusualName[]; stale?: boolean;
}

interface HeatPayload {
  schema?: string; asof: string; groups: HeatGroup[]; stale?: boolean;
}

// Tide types
interface TideMinute { t: string; ncp: number; npp: number; gross: number; vol: number }
interface SpyPoint { t: string; px: number }
interface SectorTide {
  group: string; group_zh: string; ncp: number; npp: number; gross: number;
  minutes: { t: string; ncp: number; npp: number }[];
}
interface ImpactName { root: string; net_prem_soft: number; gross: number }
interface TidePayload {
  schema?: string; asof: string; session_date?: string;
  minutes: TideMinute[]; spy: SpyPoint[];
  sectors: SectorTide[]; top_net_impact: ImpactName[];
}

// DTE Tide
type DteMinute = { t: string; ncp: number; npp: number };
interface DteTidePayload {
  schema?: string; asof: string;
  buckets: Record<DteBucket, DteMinute[]>;
}

// Ticker drill
interface TickerMinute { t: string; ncp: number; npp: number; vol: number }
interface StrikeRow { strike: number; call_prem: number; put_prem: number; vol: number }
interface ExpiryRow { exp: string; call_prem: number; put_prem: number; vol: number }
interface TopContract {
  right: "C" | "P"; exp: string; strike: number; premium: number;
  vol: number; vol_gt_oi: boolean | null;
}
interface TickerPayload {
  schema?: string; asof: string; root: string; group: string; group_zh: string;
  day: {
    gross: number; net_soft: number; call_share: number; n_events: number;
    prem_z: number | null; baseline_source: string | null;
  };
  minutes: TickerMinute[]; strikes: StrikeRow[];
  expiries: ExpiryRow[]; top_contracts: TopContract[];
}

// ─── Screener types ──────────────────────────────────────────────────────────
interface OiMover {
  root: string; right: "C" | "P"; exp: string; strike: number;
  oi: number; oi_prev: number; d_oi: number; mid: number | null;
}
interface OiMoversPayload {
  schema?: string; asof: string; movers: OiMover[];
  coverage?: { n_days: number; universe_note?: string };
}
interface HotContract {
  root: string; right: "C" | "P"; exp: string; strike: number;
  premium: number; vol: number; oi_prev: number | null; vol_gt_oi: boolean | null; close: number;
}
interface HotPayload {
  schema?: string; asof: string;
  by_premium: HotContract[]; by_volume: HotContract[];
  coverage?: { n_days: number; universe_note?: string };
}

// ─── Vol types ───────────────────────────────────────────────────────────────
interface VolTerm { dte: number; exp: string; atm_iv: number }
interface VolSmilePoint { strike: number; call_iv: number; put_iv: number }
interface VolSmileExp { exp: string; points: VolSmilePoint[] }
interface VolHistPoint { date: string; iv_rank: number | null; atm_iv: number; close: number }
interface VolPayload {
  schema?: string; asof: string; root: string;
  iv_rank_252: number | null; atm_iv: number | null;
  iv_52w_hi: number; iv_52w_lo: number;
  rv20: number; vrp: number;
  spot_ref?: number;
  term: VolTerm[]; smile: VolSmileExp[]; history: VolHistPoint[];
  coverage: { n_days: number; since: string };
  /** Full-history rank fields — optional, absent on old payloads */
  iv_rank_all?: number | null;
  coverage_days_all?: number;
  since_all?: string;
}

// ─── GEX types ───────────────────────────────────────────────────────────────
interface GexStrikeRow {
  strike: number;
  gamma_net: number; gamma_call: number; gamma_put: number;
  delta_net: number; vanna_net: number; charm_net: number;
}
interface GexExpiryRow { exp: string; gamma_net: number; delta_net: number }
interface GexHistRow {
  date: string; net_gex_bn: number; gamma_flip: number | null;
  call_wall: number | null; put_wall: number | null; regime: string;
}
interface GexPayload {
  schema?: string; asof: string; root: string;
  spot_ref: number; net_gex_bn: number;
  gamma_flip: number | null; call_wall: number | null; put_wall: number | null;
  by_strike: GexStrikeRow[]; by_expiry: GexExpiryRow[];
  convention: string;
  /** Superset coverage shape: new payloads carry n_days+since; old payloads carry n_contracts+oi_date */
  coverage: {
    n_days?: number; since?: string;
    n_contracts?: number; oi_date?: string;
  };
  by_strike_full_n?: number;
  /** Last 30 sessions of GEX summary — optional, absent on old payloads */
  history?: GexHistRow[];
}

// ─── Leaders types ────────────────────────────────────────────────────────────
interface LeaderDeEscalation {
  earnings_window: boolean | null;
  vol_trade: boolean | null;
  protective_put: boolean | null;
  gamma_caution: boolean;
}

interface LeaderRow {
  ticker: string;
  as_of: string;
  signing_source: string;
  signing_note: string;
  recurrence_count: number | null;
  net_prem_norm_abs: number | null;
  days_since_inflection: number | null;
  flow_z: number | null;
  ts_breadth_count: number | null;
  zerodte_dominated: boolean;
  oi_confirmed: boolean;
  // Board A legs (tri-state: true=pass, false=fail, null=not scored)
  A1_flow_recur: boolean | null;
  A2_flow_z_hot: boolean | null;
  A3_oi_confirmed: boolean;
  A4_ts_breadth: boolean | null;
  A5_price_leader: boolean | null;
  A6_near_high: boolean | null;
  A7_vol_confirm: boolean | null;
  A8_not_trap: boolean | null;
  K_a: number;
  n_avail_a: number;
  // Board B legs
  B1_washout_recent: boolean | null;
  B2_oversold_osc: boolean | null;
  B3_turn_organ: boolean | null;
  B4_htf_cross_near: boolean | null;
  B5_flow_inflect: boolean | null;
  B6_oi_confirmed: boolean;
  B7_vol_confirm: boolean | null;
  B8_not_trap: boolean | null;
  K_b: number;
  n_avail_b: number;
  fire_a: boolean;
  fire_b: boolean;
  // Extra context
  stair_step_leader: boolean | null;
  failed_breakout_trap: boolean | null;
  mtf_upturn_state: string | null;
  gamma_regime: string;
  days_to_earnings: number | null;
  trailing_pe: number | null;
  mktcap_bn: number | null;
  rs_1m: number | null;
  high52w_prox: number | null;
  rel_volume: number | null;
  de_escalation: LeaderDeEscalation;
  // HTF oscillators
  stochrsi_2w_k: number | null;
  stochrsi_2w_d: number | null;
  stochrsi_2w_oversold: boolean | null;
  macd_2w_state: string | null;
  macd_2w_bars_to_cross: number | null;
  macd_2w_bars_since: number | null;
  htf_coverage: boolean;
}

interface LeadersColdStart {
  message?: string;
  required_for_recurrence?: number;
}

interface LeadersPayload {
  schema: string;
  as_of: string;
  stale: boolean;
  cold_start: boolean;
  cold_start_detail?: LeadersColdStart;
  direction_note?: string;
  coverage: {
    n_universe: number;
    n_flow_sessions: number;
    flow_z_live: boolean;
    tape_names: string[];
    n_etfs: number;
  };
  board_a: LeaderRow[];
  board_b: LeaderRow[];
  board_a_total: number;
}

// ─── Leader Radar types ───────────────────────────────────────────────────────

interface RadarTf2dState {
  macd_pos: boolean;
  macd_cross_up: boolean;
  macd_cross_dn: boolean;
  macd_approaching_up: boolean;
  macd_approaching_dn: boolean;
  macd_curl_up: boolean;
  macd_curl_dn: boolean;
  macd_bars_to_cross: number | null;
  stoch_cross_up: boolean;
  stoch_cross_dn: boolean;
  // rsi14, rsi5, stoch, spark_rsi, spark_stoch, spark_hist are transported in the
  // artifact but not rendered — reserved for a future sparkline pass.
}

interface RadarContext {
  pe: number | null;
  fwd_pe: number | null;
  mktcap_bn: number | null;
  personality_labels: string[];
  days_to_earnings: number | null;
  valuation_pctile_5y: number | null;
  tf2d_state: RadarTf2dState;
}

interface RadarRow {
  ticker: string;
  raw_state: string;
  state: string;
  days_in_state: number | null;
  chips: Record<string, boolean | null>;
  de_escalations: Record<string, boolean | null>;
  fire_precipice: boolean;
  fire_onset: boolean;
  context: RadarContext;
  breakaway_watch_state: string;
}

interface RadarRegimeChips {
  dispersion_high: boolean | null;
  corr_low: boolean | null;
  pct_above_200_low: boolean | null;
  top5_share_low: boolean | null;
  zweig_thrust: boolean | null;
  pct_above_200_high: boolean | null;
  [key: string]: boolean | null;
}

interface RadarRegime {
  label: string;
  chips: RadarRegimeChips;
  conditions: string;
  mktcap_n_covered: number;
  top5_weighting: string;
}

interface RadarCoverage {
  n_universe: number;
  revisions_uncovered: string[];
  mktcap_n_covered: number;
  tape_note: string;
  rs_depth_note: string;
}

interface RadarHandoffPair {
  extended_leg: string;
  basing_leg_names: string[];
}

interface RadarReratingRow {
  ticker: string;
  state: string;
  chips: {
    revision_positive: boolean | null;
    revision_breadth_60: boolean | null;
    multiple_compressed: boolean | null;
    earnings_within_14d: boolean | null;
  };
}

interface RadarPayload {
  schema: string;
  as_of: string;
  stale: boolean;
  cold_start?: boolean;
  cold_start_detail?: { message?: string } | null;
  elapsed_s?: number;
  coverage: RadarCoverage;
  regime: RadarRegime;
  rows: RadarRow[];
  handoff_pairs: RadarHandoffPair[];
  rerating_watch: RadarReratingRow[];
}

// ─── Hub context types ────────────────────────────────────────────────────────
interface IndexGexEntry {
  regime: string; net_gex_bn: number;
  gamma_flip: number | null; dist_to_flip_pct: number | null;
}
interface CtxPayload {
  schema?: string; asof?: string;
  index_gex?: Record<string, IndexGexEntry>;
  fear_greed?: { dial: number; label_en: string; label_zh: string };
  sector_etf_flows?: Record<string, { d1: number; w1: number }>;
}

// ─── Ticker context types ─────────────────────────────────────────────────────
interface TctxPayload {
  asof?: string; history_n?: number;
  z?: {
    net_signed_premium_z252: number | null;
    zerodte_share_z252: number | null;
    short_dated_otm_call_share_z252: number | null;
    vol_gt_oi_share_z252: number | null;
    block_share_z252: number | null;
  };
}

// ─── OI-confirmed types ───────────────────────────────────────────────────────
interface OiConfEntry {
  root: string; right: "C" | "P"; exp: string; strike: number;
  prev_premium: number; delta_oi: number;
}
type OiConfPayload = OiConfEntry[];

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtPremium(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/** Plain-language presentation of the premium z-score used by the data contract. */
function activityBand(z: number | null, lang: Lang): string {
  if (z == null) return lang === "zh" ? "积累中" : "Warming";
  const az = Math.abs(z);
  if (az >= 3) return lang === "zh" ? "极异常" : "Extreme";
  if (az >= 2) return lang === "zh" ? "很异常" : "Very unusual";
  if (az >= 1) return lang === "zh" ? "偏高" : "Elevated";
  return lang === "zh" ? "正常" : "Typical";
}

// GICS sector name → its SPDR ETF ticker. sector_etf_flows (ctx) is keyed by ETF
// ticker, but the Tide sector cards key by group NAME — so the proxy chip never
// matched. Covers the live GICS names + the fixture/abbrev variants.
const SECTOR_ETF: Record<string, string> = {
  "Information Technology": "XLK", "Technology": "XLK", "Info Tech": "XLK",
  "Communication Services": "XLC", "Comm Svcs": "XLC",
  "Consumer Discretionary": "XLY", "Cons Disc": "XLY",
  "Consumer Staples": "XLP", "Staples": "XLP",
  "Financials": "XLF", "Financial": "XLF",
  "Health Care": "XLV", "Health": "XLV", "Healthcare": "XLV",
  "Energy": "XLE", "Industrials": "XLI", "Materials": "XLB",
  "Real Estate": "XLRE", "Real Est": "XLRE", "Utilities": "XLU",
};

// Signed premium: "+$8.3M" / "-$8.3M". fmtPremium already emits the $ + K/M/B suffix,
// so callers must pass the RAW dollar amount (not pre-scaled) and NOT append their own
// sign/suffix. (Previously dropped the minus sign for negatives.)
function fmtPremSigned(n: number): string {
  const s = n >= 0 ? "+" : "-";
  return `${s}${fmtPremium(Math.abs(n))}`;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
  } catch { return iso.slice(11, 16); }
}

function fmtAsof(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/New_York" });
  } catch { return iso; }
}

function isStale(iso: string): boolean {
  try { return Date.now() - new Date(iso).getTime() > 10 * 60 * 1000; } catch { return false; }
}

function fmtContract(right: "C" | "P", exp: string, strike: number): string {
  const month = exp.slice(5, 7); const day = exp.slice(8, 10);
  return `${strike}${right} ${month}/${day}`;
}

function netToneGlyph(net: number): string {
  if (net > 0) return "~▲"; if (net < 0) return "~▼"; return "·";
}

// (etOffsetSuffix moved to components/TideChartLazy.tsx with its only caller.)

// ─── Constants ───────────────────────────────────────────────────────────────

const PREM_FILTERS = [
  { label: "$100K", value: 100_000 }, { label: "$250K", value: 250_000 },
  { label: "$500K", value: 500_000 }, { label: "$1M", value: 1_000_000 },
  { label: "$5M", value: 5_000_000 },
];

/** Tape loading skeleton: shimmer-bar width per column, in the tape's column order
 *  (Time · Ticker · Sector · Side · C/P · Contract · DTE · Mny · Size · Prem · Flags).
 *  Sized so the placeholder reads as the tape rather than as a generic grey block. */
const TAPE_SKEL_COLS = [38, 42, 56, 40, 14, 74, 28, 34, 40, 48, 30];
const TAPE_SKEL_ROWS = 12;

const DTE_BUCKETS: { key: DteBucket; en: string; zh: string }[] = [
  { key: "0d", en: "0DTE", zh: "当日" }, { key: "1_7d", en: "1–7d", zh: "1–7天" },
  { key: "8_30d", en: "8–30d", zh: "8–30天" }, { key: "31_90d", en: "31–90d", zh: "31–90天" },
  { key: "90p", en: "90d+", zh: "90天+" },
];

const MNY_BUCKETS: { key: MnyBucket; en: string; zh: string }[] = [
  { key: "itm", en: "ITM", zh: "实值" }, { key: "atm", en: "ATM", zh: "平值" },
  { key: "near_otm", en: "Near OTM", zh: "近虚值" }, { key: "far_otm", en: "Far OTM", zh: "深虚值" },
];

const DTE_LABELS: Record<DteBucket, { en: string; zh: string }> = {
  "0d": { en: "0DTE", zh: "当日" },
  "1_7d": { en: "1–7d", zh: "1–7天" },
  "8_30d": { en: "8–30d", zh: "8–30天" },
  "31_90d": { en: "31–90d", zh: "31–90天" },
  "90p": { en: "90d+", zh: "90天+" },
};

// Presets: filter-state setters labeled as saved views.
type PresetKey = "large_buys" | "repeat" | "zerodte" | "puts_strength";
interface Preset {
  key: PresetKey; labelKey: string;
  apply: (set: FilterSetters) => void;
}
interface FilterSetters {
  setMinPrem: (v: number) => void;
  setDteBuckets: (v: Set<DteBucket>) => void;
  setMnyBuckets: (v: Set<MnyBucket>) => void;
  setSideFilter: (v: string) => void;
  setFlagFilter: (v: string) => void;
}
const PRESETS: Preset[] = [
  {
    key: "large_buys", labelKey: "presetLargeBuys",
    apply: ({ setMinPrem, setSideFilter, setDteBuckets, setMnyBuckets, setFlagFilter }) => {
      setMinPrem(1_000_000); setSideFilter("~buy");
      setDteBuckets(new Set()); setMnyBuckets(new Set()); setFlagFilter("");
    },
  },
  {
    key: "repeat", labelKey: "presetRepeat",
    apply: ({ setMinPrem, setSideFilter, setDteBuckets, setMnyBuckets, setFlagFilter }) => {
      setMinPrem(0); setSideFilter(""); setDteBuckets(new Set()); setMnyBuckets(new Set()); setFlagFilter("repeated");
    },
  },
  {
    key: "zerodte", labelKey: "preset0DTE",
    apply: ({ setMinPrem, setSideFilter, setDteBuckets, setMnyBuckets, setFlagFilter }) => {
      setMinPrem(0); setSideFilter(""); setDteBuckets(new Set(["0d"])); setMnyBuckets(new Set()); setFlagFilter("");
    },
  },
  {
    key: "puts_strength", labelKey: "presetPutsOnStrength",
    apply: ({ setMinPrem, setSideFilter, setDteBuckets, setMnyBuckets, setFlagFilter }) => {
      setMinPrem(0); setSideFilter("~buy"); setDteBuckets(new Set()); setMnyBuckets(new Set()); setFlagFilter("put_buy");
    },
  },
];

// ─── Small LWC chart wrapper (area series for NCP/NPP) ──────────────────────
// MOVED to components/TideChartLazy.tsx and mounted through next/dynamic (see the
// TideChart const near the top of this file). It is the hub's only consumer of
// `lightweight-charts`, so keeping it inline dragged the whole chart engine onto
// the Tape's critical path for a surface the Tape never renders.


// ─── Sparkline SVG (sector mini-chart) ──────────────────────────────────────

const Sparkline = memo(function Sparkline({ data, color, width = 80, height = 30 }: {
  data: number[]; color: string; width?: number; height?: number;
}) {
  if (data.length < 2) return <span style={{ display: "inline-block", width, height }} />;
  const mn = Math.min(...data); const mx = Math.max(...data);
  const range = mx - mn || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - mn) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block" }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  );
});

// ─── Market Tide tutorial launcher ───────────────────────────────────────────
// Replaces the old off-screen Method-note popover: launches the standalone
// Market Tide walkthrough (module 7) on the existing spotlight coach engine,
// which viewport-clamps its own tooltips (so it can't overflow like the popover).

const TIDE_TUTORIAL_MODULE = 7;

function TideTutorialButton({ lang }: { lang: Lang }) {
  const { startModule } = useCoach();
  return (
    <button
      className="chip"
      style={{ height: 24, fontSize: 11, gap: 5, display: "inline-flex", alignItems: "center" }}
      onClick={() => startModule(TIDE_TUTORIAL_MODULE, lang)}
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
      </svg>
      {getTutStr(lang, "tideTutorialBtn")}
    </button>
  );
}

// ─── Strike ladder SVG ───────────────────────────────────────────────────────

const StrikeLadder = memo(function StrikeLadder({ strikes, lang, spotRef }: { strikes: StrikeRow[]; lang: string; spotRef: number | null }) {
  const zh = lang === "zh";
  const ROW_H = 24;
  const LADDER_COLS = "52px 1fr 60px 1fr 52px";
  const [wide, setWide] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => [...strikes].sort((a, b) => a.strike - b.strike), [strikes]);

  // ATM: exact spot when available, else premium-weighted mean strike.
  const spotExact = !!(spotRef && spotRef > 0);
  const atm = useMemo(() => {
    if (spotExact) return spotRef as number;
    if (!sorted.length) return 0;
    let num = 0, den = 0;
    for (const s of sorted) { const w = s.call_prem + s.put_prem; num += s.strike * w; den += w; }
    return den > 0 ? num / den : sorted[Math.floor(sorted.length / 2)].strike;
  }, [sorted, spotExact, spotRef]);

  // Global markers over ALL strikes.
  const callWall = useMemo(() => sorted.length ? sorted.reduce((m, s) => s.call_prem > m.call_prem ? s : m).strike : null, [sorted]);
  const putWall = useMemo(() => sorted.length ? sorted.reduce((m, s) => s.put_prem > m.put_prem ? s : m).strike : null, [sorted]);
  const totalCall = useMemo(() => sorted.reduce((a, s) => a + s.call_prem, 0), [sorted]);
  const totalPut = useMemo(() => sorted.reduce((a, s) => a + s.put_prem, 0), [sorted]);
  // Premium-weighted "max pain": strike minimising aggregate holder loss (premium as notional proxy).
  const maxPain = useMemo(() => {
    if (sorted.length < 3) return null;
    let best = sorted[0].strike, bestPain = Infinity;
    for (const cand of sorted) {
      let pain = 0;
      for (const s of sorted) {
        if (s.strike < cand.strike) pain += s.call_prem * (cand.strike - s.strike);
        else if (s.strike > cand.strike) pain += s.put_prem * (s.strike - cand.strike);
      }
      if (pain < bestPain) { bestPain = pain; best = cand.strike; }
    }
    return best;
  }, [sorted]);

  // Near window ±18% of ATM (fall back to full list if too sparse).
  const rows = useMemo(() => {
    if (wide || !atm) return sorted;
    const lo = atm * 0.82, hi = atm * 1.18;
    const w = sorted.filter((s) => s.strike >= lo && s.strike <= hi);
    return w.length >= 5 ? w : sorted;
  }, [sorted, wide, atm]);

  const maxVal = useMemo(() => Math.max(...rows.flatMap((s) => [s.call_prem, s.put_prem]), 1), [rows]);
  // Power-curve width so mid strikes stay visible next to the single premium wall.
  const barPct = (v: number) => (v <= 0 ? 0 : Math.max(2, Math.pow(v / maxVal, 0.6) * 100));
  const raw = (v: number) => (v <= 0 ? 0 : v / maxVal);

  const spotStrike = useMemo(() => (
    rows.length ? rows.reduce((c, s) => Math.abs(s.strike - atm) < Math.abs(c.strike - atm) ? s : c).strike : null
  ), [rows, atm]);

  // Auto-centre the ATM row on load / window change.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || spotStrike == null) return;
    const idx = rows.findIndex((s) => s.strike === spotStrike);
    if (idx < 0) return;
    el.scrollTop = Math.max(0, idx * ROW_H - el.clientHeight / 2 + ROW_H / 2);
  }, [rows, spotStrike]);

  if (!sorted.length) return null;

  const inspect = sorted.find((s) => s.strike === (hover ?? spotStrike)) ?? null;
  const moneyness = (k: number) => (atm ? ((k - atm) / atm) * 100 : 0);
  const fmtMoney = (k: number) => { const m = moneyness(k); return `${m >= 0 ? "+" : ""}${m.toFixed(1)}%`; };

  const Chip = ({ label, val, color }: { label: string; val: string; color: string }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span className="obs-lbl">{label}</span>
      <span className="num" style={{ fontSize: 12, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{val}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Summary chips */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
        <Chip label={spotExact ? (zh ? "现价" : "Spot") : (zh ? "约平值" : "ATM≈")} val={atm ? `$${atm.toFixed(atm < 50 ? 2 : 0)}` : "—"} color="var(--warn)" />
        {callWall != null && <Chip label={zh ? "认购墙" : "Call Wall"} val={`$${callWall}`} color="var(--up)" />}
        {putWall != null && <Chip label={zh ? "认沽墙" : "Put Wall"} val={`$${putWall}`} color="var(--down)" />}
        {maxPain != null && <Chip label={zh ? "最大痛点" : "Max Pain"} val={`$${maxPain}`} color="var(--text-2)" />}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>{rows.length}{rows.length !== sorted.length ? `/${sorted.length}` : ""}</span>
          <button className={`chip${!wide ? " on" : ""}`} style={{ height: 22, fontSize: 10 }} onClick={() => setWide(false)}>{zh ? "近档" : "Near"}</button>
          <button className={`chip${wide ? " on" : ""}`} style={{ height: 22, fontSize: 10 }} onClick={() => setWide(true)}>{zh ? "全档" : "All"}</button>
        </div>
      </div>

      {/* Inspector strip — hovered row, or spot when idle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, minHeight: 18, color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>
        {inspect ? (
          <>
            <span style={{ fontWeight: 700, color: "var(--text)" }}>${inspect.strike}</span>
            <span style={{ color: "var(--muted)" }}>{fmtMoney(inspect.strike)}</span>
            <span style={{ color: "var(--up)" }}>{zh ? "认购" : "C"} {fmtPremium(inspect.call_prem)}</span>
            <span style={{ color: "var(--down)" }}>{zh ? "认沽" : "P"} {fmtPremium(inspect.put_prem)}</span>
            <span style={{ color: "var(--muted)" }}>{zh ? "量" : "Vol"} {inspect.vol.toLocaleString("en-US")}</span>
          </>
        ) : <span style={{ color: "var(--muted)" }}>{zh ? "悬停查看行权价明细" : "Hover a strike for detail"}</span>}
      </div>

      {/* Column header — 5-col montage: [call $] [call bar] [strike] [put bar] [put $] */}
      <div className="obs-lbl" style={{ display: "grid", gridTemplateColumns: LADDER_COLS, padding: "0 2px", alignItems: "center" }}>
        <span />
        <span style={{ textAlign: "right", color: "var(--up)", fontWeight: 600, paddingRight: 4 }}>{zh ? "认购$" : "Call $"}</span>
        <span style={{ textAlign: "center" }}>{zh ? "行权价" : "Strike"}</span>
        <span style={{ textAlign: "left", color: "var(--down)", fontWeight: 600, paddingLeft: 4 }}>{zh ? "认沽$" : "Put $"}</span>
        <span />
      </div>

      {/* Ladder */}
      <div ref={scrollRef} className="obs-scroll" style={{ maxHeight: 440, overflowY: "auto", position: "relative" }}
        onMouseLeave={() => setHover(null)}>
        {rows.map((s) => {
          const isSpot = s.strike === spotStrike;
          const isCallWall = s.strike === callWall;
          const isPutWall = s.strike === putWall;
          const isPain = s.strike === maxPain;
          const cRaw = raw(s.call_prem), pRaw = raw(s.put_prem);
          const isHover = hover === s.strike;
          return (
            <div key={s.strike}
              onMouseEnter={() => setHover(s.strike)}
              style={{
                display: "grid", gridTemplateColumns: LADDER_COLS, alignItems: "center",
                height: ROW_H,
                background: isHover ? "var(--panel-2)" : isSpot ? "color-mix(in srgb, var(--warn) 7%, transparent)" : "transparent",
                borderTop: isSpot ? "1px solid color-mix(in srgb, var(--warn) 35%, transparent)" : "1px solid transparent",
                borderBottom: isSpot ? "1px solid color-mix(in srgb, var(--warn) 35%, transparent)" : "1px solid transparent",
                transition: "background .12s ease",
              }}>
              {/* Call premium value */}
              <span style={{ fontSize: 9, color: "var(--up)", opacity: .85, textAlign: "right", paddingRight: 5, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden" }}>
                {s.call_prem > 0 ? fmtPremium(s.call_prem) : ""}
              </span>
              {/* Call bar track (grows left toward strike) */}
              <div style={{ display: "flex", justifyContent: "flex-end", overflow: "hidden" }}>
                <div style={{
                  width: `${barPct(s.call_prem)}%`, height: 12, borderRadius: "3px 0 0 3px", flexShrink: 0,
                  background: `linear-gradient(90deg, color-mix(in srgb, var(--up) ${((0.10 + 0.28 * cRaw) * 100).toFixed(1)}%, transparent) 0%, color-mix(in srgb, var(--up) ${((0.4 + 0.5 * cRaw) * 100).toFixed(1)}%, transparent) 100%)`,
                  boxShadow: isCallWall ? "inset 0 0 0 1px var(--up)" : "none",
                }} />
              </div>
              {/* Strike */}
              <div style={{ textAlign: "center", position: "relative" }}>
                <span style={{
                  fontSize: 11, fontWeight: isSpot ? 700 : 500,
                  color: isSpot ? "var(--warn)" : "var(--text-2)", fontVariantNumeric: "tabular-nums",
                }}>{s.strike}</span>
                {(isCallWall || isPutWall || isPain) && (
                  <span style={{
                    position: "absolute", top: "50%", left: "calc(100% - 3px)", transform: "translateY(-50%)",
                    width: 5, height: 5, borderRadius: "50%",
                    background: isPain ? "var(--text-2)" : isCallWall ? "var(--up)" : "var(--down)",
                  }} />
                )}
              </div>
              {/* Put bar track (grows right from strike) */}
              <div style={{ display: "flex", justifyContent: "flex-start", overflow: "hidden" }}>
                <div style={{
                  width: `${barPct(s.put_prem)}%`, height: 12, borderRadius: "0 3px 3px 0", flexShrink: 0,
                  background: `linear-gradient(90deg, color-mix(in srgb, var(--down) ${((0.4 + 0.5 * pRaw) * 100).toFixed(1)}%, transparent) 0%, color-mix(in srgb, var(--down) ${((0.10 + 0.28 * pRaw) * 100).toFixed(1)}%, transparent) 100%)`,
                  boxShadow: isPutWall ? "inset 0 0 0 1px var(--down)" : "none",
                }} />
              </div>
              {/* Put premium value */}
              <span style={{ fontSize: 9, color: "var(--down)", opacity: .85, textAlign: "left", paddingLeft: 5, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden" }}>
                {s.put_prem > 0 ? fmtPremium(s.put_prem) : ""}
              </span>
            </div>
          );
        })}
      </div>

      {/* Totals footer — call/put premium share */}
      {(totalCall + totalPut) > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "var(--panel-2)" }}>
            <div style={{ width: `${(totalCall / (totalCall + totalPut)) * 100}%`, background: "var(--up)" }} />
            <div style={{ width: `${(totalPut / (totalCall + totalPut)) * 100}%`, background: "var(--down)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: "var(--up)" }}>{zh ? "认购" : "Calls"} {fmtPremium(totalCall)} · {((totalCall / (totalCall + totalPut)) * 100).toFixed(0)}%</span>
            <span style={{ color: "var(--down)" }}>{((totalPut / (totalCall + totalPut)) * 100).toFixed(0)}% · {fmtPremium(totalPut)} {zh ? "认沽" : "Puts"}</span>
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Expiry horizontal bars ───────────────────────────────────────────────────

function ExpiryBars({ expiries, lang }: { expiries: ExpiryRow[]; lang: string }) {
  if (!expiries.length) return null;
  const maxVal = Math.max(...expiries.flatMap((e) => [e.call_prem, e.put_prem])) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {expiries.map((e) => {
        const cw = Math.round((e.call_prem / maxVal) * 100);
        const pw = Math.round((e.put_prem / maxVal) * 100);
        const expShort = e.exp.slice(5); // MM-DD
        return (
          <div key={e.exp} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
            <span style={{ color: "var(--text-2)", fontVariantNumeric: "tabular-nums", width: 56, flexShrink: 0 }}>
              {expShort}
            </span>
            <div style={{ flex: 1, display: "flex", gap: 3, alignItems: "center" }}>
              <div style={{ height: 8, width: `${cw}%`, background: "color-mix(in srgb, var(--up) 40%, transparent)", borderRadius: 2, minWidth: 1 }} />
              <div style={{ height: 8, width: `${pw}%`, background: "color-mix(in srgb, var(--down) 35%, transparent)", borderRadius: 2, minWidth: 1 }} />
            </div>
            <span style={{ color: "var(--muted)", width: 60, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {fmtPremium(e.call_prem + e.put_prem)}
            </span>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 16, fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 10, height: 6, background: "color-mix(in srgb, var(--up) 40%, transparent)", borderRadius: 1 }} />
          {lang === "zh" ? "认购" : "Call"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 10, height: 6, background: "color-mix(in srgb, var(--down) 35%, transparent)", borderRadius: 1 }} />
          {lang === "zh" ? "认沽" : "Put"}
        </span>
      </div>
    </div>
  );
}

// ─── Minute net-prem chart (ticker drill, inline SVG) ──────────────────────

/** Numeral styling for SVG axis text — Inter + tabular figures (Terminal law 1). */
const SVG_NUM: CSSProperties = { fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums" };

const MinuteNetChart = memo(function MinuteNetChart({ minutes, height = 160 }: { minutes: TickerMinute[]; height?: number }) {
  const { lang } = useLang();
  // The wrapper is ALWAYS rendered so the ResizeObserver has an element from the
  // first paint — measuring is what makes 1 user unit == 1 CSS px (svgChart R1).
  const boxRef = useRef<HTMLDivElement>(null);
  const W = useChartWidth(boxRef, 560);

  const vals = (minutes ?? [])
    .map((m) => (m.ncp + m.npp) / 1_000_000)
    .filter((v) => Number.isFinite(v));

  let body: ReactNode = null;
  if (vals.length < 2) {
    // Honest empty: say WHY there is no line rather than collapsing to nothing.
    body = (
      <div className="obs-lbl" style={{ color: "var(--muted)", padding: "6px 0" }}>
        {lang === "zh" ? "盘中分钟数据不足，暂无法绘制。" : "Not enough intraday minutes to plot yet."}
      </div>
    );
  } else {
    // Padded domain, zero unioned only when the session actually straddles it —
    // a one-sided day now fills the panel instead of hugging one edge (R7).
    const [mn, mx] = padDomain(Math.min(...vals), Math.max(...vals), { padFrac: 0.08, includeZero: true });
    const range = mx - mn || 1;
    const PAD_L = 44;
    const yOf = (v: number) => height - ((v - mn) / range) * (height - 4) - 2;
    const pts = vals
      .map((v, i) => `${(PAD_L + (i / (vals.length - 1)) * (W - PAD_L - 4)).toFixed(2)},${yOf(v).toFixed(2)}`)
      .join(" ");
    const straddlesZero = mn < 0 && mx > 0;
    const fmtM = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}M`;
    body = (
      <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} style={{ display: "block" }}>
        {straddlesZero && (
          <line
            x1={PAD_L} y1={yOf(0)} x2={W - 4} y2={yOf(0)}
            stroke="var(--line)" strokeWidth="1" strokeDasharray="3,3"
          />
        )}
        <polyline fill="none" stroke="var(--brand-2)" strokeWidth="1.2" points={pts} />
        {/* Scale reference — the chart previously shipped with no y-axis at all. */}
        <text x={2} y={11} fill="var(--text-dim)" fontSize={9} style={SVG_NUM}>{fmtM(mx)}</text>
        <text x={2} y={height - 3} fill="var(--text-dim)" fontSize={9} style={SVG_NUM}>{fmtM(mn)}</text>
      </svg>
    );
  }

  return <div ref={boxRef} style={{ width: "100%" }}>{body}</div>;
});

// ─── Term structure chart (ATM IV vs DTE, dots + line) ──────────────────────

const TermStructureChart = memo(function TermStructureChart({ term }: { term: VolTerm[] }) {
  const { lang } = useLang();
  const boxRef = useRef<HTMLDivElement>(null);
  const W = useChartWidth(boxRef, 600);
  const H = MIN_CHART_H.axis;

  let body: ReactNode = null;
  const pts0 = (term ?? []).filter((p) => Number.isFinite(p.dte) && Number.isFinite(p.atm_iv));
  if (pts0.length < 2) {
    body = (
      <div className="obs-lbl" style={{ color: "var(--muted)", padding: "6px 0" }}>
        {lang === "zh" ? "可用到期不足两个，无法绘制期限结构。" : "Fewer than two expiries priced — no term structure to draw."}
      </div>
    );
  } else {
    const dtes = pts0.map((p) => p.dte);
    const ivs = pts0.map((p) => p.atm_iv);
    const minDte = Math.min(...dtes); const maxDte = Math.max(...dtes);
    const [minIv, maxIv] = padDomain(Math.min(...ivs), Math.max(...ivs), { padFrac: 0.12, clampMin: 0 });
    const PAD = { l: 48, r: 18, t: 14, b: 34 };
    // LOG-DTE spacing: a real chain runs [3,8,11,…,683]. Linear-in-DTE crushes the
    // first six expiries into ~11px and smears their labels into one another.
    const lg = (d: number) => Math.log(Math.max(1, d));
    const lgMin = lg(minDte); const lgMax = lg(maxDte);
    const cx = (dte: number) => PAD.l + ((lg(dte) - lgMin) / ((lgMax - lgMin) || 1)) * (W - PAD.l - PAD.r);
    const cy = (iv: number) => PAD.t + (1 - (iv - minIv) / ((maxIv - minIv) || 1)) * (H - PAD.t - PAD.b);
    const pts = pts0.map((p) => `${cx(p.dte).toFixed(1)},${cy(p.atm_iv).toFixed(1)}`).join(" ");
    const { values: yTicks, step } = niceTicks(minIv, maxIv, 4);
    // 42px ≈ a 4-char "137d" at fontSize 10 plus an 18px gutter.
    const labelled = new Set(thinLabels(pts0, (p) => cx(p.dte), 42).map((p) => p.exp));
    body = (
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }}>
        {/* Y axis — nice ticks, precision derived from the step (no duplicate "17% 17%") */}
        {yTicks.map((iv) => {
          const y = cy(iv);
          return (
            <g key={iv}>
              <line x1={PAD.l - 4} y1={y} x2={W - PAD.r} y2={y} stroke="var(--line)" strokeWidth="0.7" />
              <text x={PAD.l - 8} y={y + 3.5} textAnchor="end" fill="var(--muted)" fontSize={10} style={SVG_NUM}>
                {fmtTick(iv, step)}%
              </text>
            </g>
          );
        })}
        {/* Line */}
        <polyline fill="none" stroke="var(--brand-2)" strokeWidth="1.5" points={pts} />
        {/* Dots + thinned DTE labels; every dot keeps a hover title so unlabelled
            expiries are still readable. */}
        {pts0.map((p) => {
          const x = cx(p.dte); const y = cy(p.atm_iv);
          return (
            <g key={p.exp}>
              <circle cx={x} cy={y} r={3} fill="var(--brand-2)">
                <title>{`${p.exp} · ${daysToExpiry(p.dte, lang)} · ${p.atm_iv.toFixed(1)}%`}</title>
              </circle>
              {labelled.has(p.exp) && (
                <text x={x} y={H - 12} textAnchor="middle" fill="var(--text-dim)" fontSize={10} style={SVG_NUM}>
                  {p.dte}d
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  return <div ref={boxRef} style={{ width: "100%" }}>{body}</div>;
});

// ─── Smile chart (call_iv / put_iv vs strike, spot_ref vertical line) ────────

/** A quoted IV: finite AND positive. A zero/undefined leg is a MISSING quote, not
 *  a 0% vol print — treating it as data floors the whole line (see svgChart R7). */
const okIv = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

const SmileChart = memo(function SmileChart({ points, spotRef }: { points: VolSmilePoint[]; spotRef: number | null }) {
  const { lang } = useLang();
  const boxRef = useRef<HTMLDivElement>(null);
  const W = useChartWidth(boxRef, 600);
  const H = 200;

  let body: ReactNode = null;
  const pts0 = (points ?? []).filter((p) => Number.isFinite(p.strike));
  const allIvs = pts0.flatMap((p) => [p.call_iv, p.put_iv]).filter(okIv);
  // Strikes missing at least one side — reported honestly under the chart.
  const gapped = pts0.filter((p) => !(okIv(p.call_iv) && okIv(p.put_iv))).length;

  if (pts0.length < 2 || allIvs.length < 2) {
    body = (
      <div className="obs-lbl" style={{ color: "var(--muted)", padding: "6px 0" }}>
        {lang === "zh" ? "该到期无有效双边报价，无法绘制微笑曲线。" : "No priced quotes on this expiry — nothing to plot."}
      </div>
    );
  } else {
    const strikes = pts0.map((p) => p.strike);
    const minS = Math.min(...strikes); const maxS = Math.max(...strikes);
    const [minIv, maxIv] = padDomain(Math.min(...allIvs), Math.max(...allIvs), { padFrac: 0.10, clampMin: 0 });
    const PAD = { l: 54, r: 20, t: 16, b: 36 };
    const cx = (s: number) => PAD.l + ((s - minS) / ((maxS - minS) || 1)) * (W - PAD.l - PAD.r);
    const cy = (iv: number) => PAD.t + (1 - (iv - minIv) / ((maxIv - minIv) || 1)) * (H - PAD.t - PAD.b);
    // A missing wing quote becomes a GAP in the line, never a dive to the floor.
    const segs = (key: "call_iv" | "put_iv"): string[] => {
      const out: string[] = [];
      let cur: string[] = [];
      for (const p of pts0) {
        const v = p[key];
        if (okIv(v)) cur.push(`${cx(p.strike).toFixed(1)},${cy(v).toFixed(1)}`);
        else { if (cur.length > 1) out.push(cur.join(" ")); cur = []; }
      }
      if (cur.length > 1) out.push(cur.join(" "));
      return out;
    };
    const { values: yTicks, step } = niceTicks(minIv, maxIv, 4);
    // 46px ≈ a 5-char strike at fontSize 10 plus a gutter.
    const labelled = thinLabels(pts0, (p) => cx(p.strike), 46);
    body = (
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }}>
        {yTicks.map((iv) => {
          const y = cy(iv);
          return (
            <g key={iv}>
              <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="var(--line)" strokeWidth="0.7" />
              <text x={PAD.l - 8} y={y + 3.5} textAnchor="end" fill="var(--muted)" fontSize={10} style={SVG_NUM}>
                {fmtTick(iv, step)}%
              </text>
            </g>
          );
        })}
        {/* Spot reference vertical line */}
        {spotRef != null && spotRef >= minS && spotRef <= maxS && (
          <line
            x1={cx(spotRef)} y1={PAD.t} x2={cx(spotRef)} y2={H - PAD.b}
            stroke="var(--warn)" strokeWidth="1" strokeDasharray="3,2"
          />
        )}
        {/* Call IV line (segmented across missing quotes) */}
        {segs("call_iv").map((s, i) => (
          <polyline key={`c${i}`} fill="none" stroke="var(--up)" strokeWidth="1.5" points={s} />
        ))}
        {/* Put IV dashed line (segmented across missing quotes) */}
        {segs("put_iv").map((s, i) => (
          <polyline key={`p${i}`} fill="none" stroke="var(--down)" strokeWidth="1.5" strokeDasharray="4,2" points={s} />
        ))}
        {/* Strike labels thinned by RENDERED pixel gap, never by array index —
            `i % 3` put the densest labels exactly where strikes cluster (ATM). */}
        {labelled.map((p) => (
          <text key={p.strike} x={cx(p.strike)} y={H - 12} textAnchor="middle" fill="var(--text-dim)" fontSize={10} style={SVG_NUM}>
            {p.strike}
          </text>
        ))}
      </svg>
    );
  }

  return (
    <div ref={boxRef} style={{ width: "100%" }}>
      {body}
      {/* Honest coverage note — a gap in the curve has to say why it is a gap. */}
      {gapped > 0 && (
        <div className="obs-lbl" style={{ color: "var(--text-dim)", marginTop: 4 }}>
          {lang === "zh" ? `${gapped} 个行权价无双边报价` : `${gapped} ${gapped === 1 ? "strike" : "strikes"} had no two-sided quote`}
        </div>
      )}
    </div>
  );
});

// ─── IV Rank history sparkline ────────────────────────────────────────────────

const IvRankHistory = memo(function IvRankHistory({ history }: { history: VolHistPoint[] }) {
  const { lang } = useLang();
  const boxRef = useRef<HTMLDivElement>(null);
  const W = useChartWidth(boxRef, 560);
  const H = MIN_CHART_H.spark;

  const vals = (history ?? [])
    .filter((h) => h.iv_rank != null && Number.isFinite(h.iv_rank))
    .map((h) => h.iv_rank as number);

  let body: ReactNode = null;
  if (vals.length < 2) {
    body = (
      <div className="obs-lbl" style={{ color: "var(--muted)", padding: "6px 0" }}>
        {lang === "zh" ? "IV分位基线仍在积累。" : "IV-rank baseline is still building."}
      </div>
    );
  } else {
    // Domain is fixed 0–100 BY DEFINITION (a rank, not a measurement) — this is the
    // one case svgChart R7 exempts from padDomain.
    const PAD_L = 30, PAD_R = 8, PAD_V = 8;
    const xOf = (i: number) => PAD_L + (i / (vals.length - 1)) * (W - PAD_L - PAD_R);
    const yOf = (v: number) => H - PAD_V - (v / 100) * (H - PAD_V * 2);
    const pts = vals.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
    body = (
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line
              x1={PAD_L} y1={yOf(v)} x2={W - PAD_R} y2={yOf(v)}
              stroke="var(--line)" strokeWidth="0.7" strokeDasharray={v === 50 ? "3,3" : undefined}
            />
            <text x={PAD_L - 6} y={yOf(v) + 3.5} textAnchor="end" fill="var(--muted)" fontSize={10} style={SVG_NUM}>{v}</text>
          </g>
        ))}
        <polyline fill="none" stroke="var(--brand-2)" strokeWidth="1.4" points={pts} />
        <circle cx={xOf(vals.length - 1)} cy={yOf(vals[vals.length - 1])} r={3} fill="var(--brand-2)" />
      </svg>
    );
  }

  return <div ref={boxRef} style={{ width: "100%" }}>{body}</div>;
});

// ─── GEX 30-session history sparkline strip ──────────────────────────────────

const GexHistSparkline = memo(function GexHistSparkline({ history }: { history: GexHistRow[] }) {
  if (history.length < 2) return null;
  const vals = history.map((h) => h.net_gex_bn);
  const mn = Math.min(...vals); const mx = Math.max(...vals);
  const range = (mx - mn) || 1;
  const W = 100; const H = 40;
  const zeroY = H - ((-mn) / range) * (H - 6) - 2;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - ((v - mn) / range) * (H - 6) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const last = history[history.length - 1];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={180} height={H} preserveAspectRatio="none" style={{ display: "block", flexShrink: 0 }}>
        <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="var(--line)" strokeWidth="0.5" strokeDasharray="2,2" />
        <polyline fill="none" stroke="var(--brand-2)" strokeWidth="1.2" points={pts} />
        <circle cx={W} cy={pts.split(" ").pop()!.split(",")[1]} r={2.5} fill="var(--brand-2)" />
      </svg>
      {last.gamma_flip != null && (
        <span style={{ fontSize: 10, color: "var(--warn)", fontVariantNumeric: "tabular-nums" }}>
          flip {last.gamma_flip.toFixed(1)}
        </span>
      )}
      {last.call_wall != null && (
        <span style={{ fontSize: 10, color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>
          call {last.call_wall.toFixed(1)}
        </span>
      )}
      {last.put_wall != null && (
        <span style={{ fontSize: 10, color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>
          put {last.put_wall.toFixed(1)}
        </span>
      )}
    </div>
  );
});

// ─── GEX strike ladder (horizontal bars, net + call/put split) ────────────────

type GreekKey = "gamma" | "delta" | "vanna" | "charm";

function getGreekValues(row: GexStrikeRow, greek: GreekKey): { net: number; call: number; put: number } {
  switch (greek) {
    case "gamma": return { net: row.gamma_net, call: row.gamma_call, put: row.gamma_put };
    case "delta": return { net: row.delta_net, call: row.delta_net > 0 ? row.delta_net : 0, put: row.delta_net < 0 ? row.delta_net : 0 };
    case "vanna": return { net: row.vanna_net, call: row.vanna_net > 0 ? row.vanna_net : 0, put: row.vanna_net < 0 ? row.vanna_net : 0 };
    case "charm": return { net: row.charm_net, call: row.charm_net > 0 ? row.charm_net : 0, put: row.charm_net < 0 ? row.charm_net : 0 };
  }
}

const GexStrikeLadder = memo(function GexStrikeLadder({ rows, greek, spotRef, gammaFlip, callWall, putWall, lang }: {
  rows: GexStrikeRow[];
  greek: GreekKey;
  spotRef: number;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  lang: string;
}) {
  const [wideMode, setWideMode] = useState(false);

  // Empty state — render bilingual pending message instead of null
  if (!rows.length) {
    return (
      <div style={{ padding: "20px 0", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
        {lang === "zh"
          ? "该标的夜间数据待更新"
          : "Nightly data pending for this root"}
      </div>
    );
  }

  // Client-side windowing: Near = ±10% of spot_ref; Wide = full payload
  const displayRows = wideMode ? rows : windowGexRows(rows, spotRef, 0.10);
  // If the windowed view is empty (e.g. very OTM spot_ref), fall back to full
  const visibleRows = displayRows.length > 0 ? displayRows : rows;

  const netVals = visibleRows.map((r) => getGreekValues(r, greek).net);
  const maxAbs = Math.max(...netVals.map(Math.abs), 0.001);
  const BAR_MAX = 120;
  const ROW_H = 28;
  const H = visibleRows.length * ROW_H + 30;
  const MID = BAR_MAX + 60; // center x

  // Closest strike to spot — computed once for the whole set (not per-row).
  const spotStrike = visibleRows.reduce((closest, r) =>
    Math.abs(r.strike - spotRef) < Math.abs(closest.strike - spotRef) ? r : closest
  ).strike;

  return (
    <div>
      {/* Near / Wide toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
        <button
          className={`chip${!wideMode ? " on" : ""}`}
          style={{ height: 22, fontSize: 10 }}
          onClick={() => setWideMode(false)}
        >
          {lang === "zh" ? "近档 ±10%" : "Near ±10%"}
        </button>
        <button
          className={`chip${wideMode ? " on" : ""}`}
          style={{ height: 22, fontSize: 10 }}
          onClick={() => setWideMode(true)}
        >
          {lang === "zh" ? "全档" : "Wide"}
        </button>
        <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 4 }}>
          {visibleRows.length}{rows.length !== visibleRows.length ? `/${rows.length}` : ""} rows
        </span>
      </div>

      {/* SVG ladder — always bounded + scrollable so tall row sets don't over-scale */}
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        <svg viewBox={`0 0 ${MID * 2} ${H}`} width="100%" height={H} preserveAspectRatio="xMinYMin meet" style={{ display: "block" }}>
          {/* Column headers — neutral colors (not up/down) */}
          <text x={MID - 4} y={14} textAnchor="end" fill="var(--text-2)" fontSize={10} fontWeight={600}>
            {lang === "zh" ? "正值" : "+pos"}
          </text>
          <text x={MID + 60 + 4} y={14} textAnchor="start" fill="var(--text-2)" fontSize={10} fontWeight={600}>
            {lang === "zh" ? "负值" : "-neg"}
          </text>
          <text x={MID + 30} y={14} textAnchor="middle" fill="var(--muted)" fontSize={10}>
            {lang === "zh" ? "行权价" : "Strike"}
          </text>

          {visibleRows.map((row, i) => {
            const { net, call, put } = getGreekValues(row, greek);
            const y = 22 + i * ROW_H;
            const netW = Math.abs(net) / maxAbs * BAR_MAX;
            const callW = Math.abs(greek === "gamma" ? call : Math.max(call, 0)) / maxAbs * BAR_MAX;
            const putW = Math.abs(greek === "gamma" ? put : Math.abs(Math.min(put, 0))) / maxAbs * BAR_MAX;
            const isPos = net >= 0;

            // Markers — these remain correct within the windowed domain
            const isFlip = gammaFlip != null && row.strike === gammaFlip;
            const isCallWall = callWall != null && row.strike === callWall;
            const isPutWall = putWall != null && row.strike === putWall;

            return (
              <g key={row.strike}>
                {/* Net bar */}
                {isPos ? (
                  <rect x={MID - netW} y={y + 3} width={netW} height={ROW_H - 10}
                    style={{ fill: "color-mix(in srgb, var(--up) 35%, transparent)" }} rx={2} />
                ) : (
                  <rect x={MID + 60} y={y + 3} width={netW} height={ROW_H - 10}
                    style={{ fill: "color-mix(in srgb, var(--down) 30%, transparent)" }} rx={2} />
                )}
                {/* Call overlay (gamma only — call split) */}
                {greek === "gamma" && call > 0 && (
                  <rect x={MID - callW} y={y + 3} width={callW} height={ROW_H - 10}
                    style={{ fill: "color-mix(in srgb, var(--up) 15%, transparent)" }} rx={2} />
                )}
                {/* Put overlay (gamma only — put split, grows right from center) */}
                {greek === "gamma" && put < 0 && (
                  <rect x={MID + 60} y={y + 3} width={putW} height={ROW_H - 10}
                    style={{ fill: "color-mix(in srgb, var(--down) 12%, transparent)" }} rx={2} />
                )}
                {/* Strike label */}
                <text x={MID + 30} y={y + ROW_H / 2 + 2} textAnchor="middle"
                  fill="var(--text-2)" fontSize={11} fontWeight={row.strike === spotStrike ? 700 : 400}>
                  {row.strike}
                </text>
                {/* Spot ref line */}
                {row.strike === spotStrike && (
                  <line x1={0} y1={y + ROW_H - 1} x2={MID * 2} y2={y + ROW_H - 1}
                    stroke="var(--warn)" strokeWidth="1" strokeDasharray="3,2" opacity={0.6} />
                )}
                {/* Marker labels */}
                {isFlip && (
                  <text x={MID * 2 - 4} y={y + 14} textAnchor="end" fill="var(--warn)" fontSize={9} fontWeight={600}>
                    {lang === "zh" ? "伽马翻转" : "flip"}
                  </text>
                )}
                {isCallWall && (
                  <text x={MID * 2 - 4} y={y + 14} textAnchor="end" fill="var(--warn)" fontSize={9} fontWeight={600}>
                    {lang === "zh" ? "认购集中" : "call concentration"}
                  </text>
                )}
                {isPutWall && (
                  <text x={MID * 2 - 4} y={y + 14} textAnchor="end" fill="var(--warn)" fontSize={9} fontWeight={600}>
                    {lang === "zh" ? "认沽集中" : "put concentration"}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
});

// ─── GEX by-expiry bars ──────────────────────────────────────────────────────

const GexExpiryBars = memo(function GexExpiryBars({ rows, greek, lang }: { rows: GexExpiryRow[]; greek: GreekKey; lang: string }) {
  if (!rows.length) return null;
  const getVal = (r: GexExpiryRow) => greek === "delta" ? r.delta_net : r.gamma_net;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(getVal(r))), 0.001);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r) => {
        const v = getVal(r);
        const w = Math.round((Math.abs(v) / maxAbs) * 100);
        const isPos = v >= 0;
        return (
          <div key={r.exp} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
            <span style={{ color: "var(--text-2)", fontVariantNumeric: "tabular-nums", width: 56, flexShrink: 0 }}>{r.exp.slice(5)}</span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--panel-3)", overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${w}%`,
                background: isPos
                  ? "color-mix(in srgb, var(--up) 50%, transparent)"
                  : "color-mix(in srgb, var(--down) 45%, transparent)",
                borderRadius: 4,
              }} />
            </div>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: isPos ? "var(--up)" : "var(--down)", width: 64, textAlign: "right" }}>
              {isPos ? "+" : ""}{v.toFixed(3)}
            </span>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 16, fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 10, height: 6, background: "color-mix(in srgb, var(--up) 50%, transparent)", borderRadius: 1 }} />
          {lang === "zh" ? "正值（认购端）" : "Positive (call-side)"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 10, height: 6, background: "color-mix(in srgb, var(--down) 45%, transparent)", borderRadius: 1 }} />
          {lang === "zh" ? "负值（认沽端）" : "Negative (put-side)"}
        </span>
      </div>
    </div>
  );
});

// ─── Top-level component ─────────────────────────────────────────────────────

/**
 * OptionsHubView — the Research workspace engine (Wave-2 IA).
 *
 * Two modes, controlled by props (all optional; every live mount is CONTROLLED —
 * the uncontrolled no-prop form survives only as the self-managed fallback and
 * no longer reads the URL):
 *
 *  • CONTROLLED (page-driven): the Research page owns tab state in the URL (`?tab=`)
 *    via WorkspaceTabs and passes `activeTab` + `onTab`. In this mode the hub does
 *    NOT render its own internal tab strip (the page renders WorkspaceTabs above it)
 *    and does NOT touch the URL — `onTab` is the single writer. Pass `hideTabStrip`
 *    to suppress the legacy strip even in uncontrolled mode.
 *
 *  • allowedTabs: restricts which tabs the hub will render at all. The internal
 *    strip (when shown) only lists allowed tabs, and an incoming `?tab=` outside the
 *    set is clamped to the first allowed tab. Tabs NOT in the set never mount — so a
 *    single-tab mount (e.g. Discover › Leaders) instantiates only that tab's data
 *    flow. Internal cross-tab jumps (a Leaders/Radar row → the Tickers drill) still
 *    work: `tickers` is implicitly reachable whenever `leaders` or `radar` is allowed
 *    so the drill-in that those tables depend on is preserved verbatim.
 *
 * Data flow, lazy mount-on-first-visit, and every tab's fetch/render are unchanged
 * from Wave-1 — this parameterization only lifts tab SELECTION out of the component.
 */
export interface OptionsHubViewProps {
  /** Restrict rendered tabs. Undefined = all tabs (legacy). */
  allowedTabs?: TabKey[];
  /** Controlled active tab (page-driven via ?tab=). Undefined = self-managed. */
  activeTab?: TabKey;
  /** Controlled tab setter. Provided ⇒ controlled mode (hub won't write the URL). */
  onTab?: (tab: TabKey) => void;
  /** Suppress the internal legacy tab strip even in uncontrolled mode. */
  hideTabStrip?: boolean;
}

export default function OptionsHubView({
  allowedTabs,
  activeTab: controlledTab,
  onTab,
  hideTabStrip,
}: OptionsHubViewProps = {}) {
  const { lang } = useLang();
  const t = useT();

  const controlled = onTab !== undefined;

  // Tabs the hub is permitted to render. `tickers` is always reachable when
  // leaders/radar are allowed so their row → ticker-drill cross-jump survives
  // (those tables call switchTab("tickers") + setSelectedTicker internally).
  const renderableTabs = useMemo<Set<TabKey>>(() => {
    if (!allowedTabs) return new Set<TabKey>(TABS.map((tb) => tb.key));
    const s = new Set<TabKey>(allowedTabs);
    if (s.has("leaders") || s.has("radar")) s.add("tickers");
    return s;
  }, [allowedTabs]);

  // Tabs shown in the internal strip (allowed set, in canonical TABS order,
  // minus the implicit tickers add-on when it wasn't explicitly allowed).
  const stripTabs = useMemo(
    () => TABS.filter((tb) => !allowedTabs || allowedTabs.includes(tb.key)),
    [allowedTabs],
  );

  const defaultTab: TabKey = useMemo(() => {
    if (allowedTabs && allowedTabs.length) return allowedTabs[0];
    return "tape";
  }, [allowedTabs]);

  // ── Tab state ─────────────────────────────────────────────────────────────
  // Controlled mode mirrors the page's `controlledTab`. Uncontrolled mode is
  // self-managed from `defaultTab` — URL seeding is the PAGE's job (see
  // OptionsWorkspace, which resolves ?tab= synchronously via useSearchParams;
  // the hub's old post-mount ?tab= → setState seed was the flaky deep-link hop,
  // and its last uncontrolled consumer — the retired /flow mount — is gone).
  const [internalTab, setInternalTab] = useState<TabKey>(defaultTab);
  const activeTab: TabKey = controlled ? (controlledTab ?? defaultTab) : internalTab;

  // Track which tabs have been visited so they stay mounted (keep-alive pattern).
  // Seeded from the FIRST activeTab (not defaultTab) so a controlled deep-link
  // renders only its own tab from the very first pass. Later visits are recorded
  // during render (React's derived-state idiom — an effect here was a needless
  // extra render and a react-hooks/set-state-in-effect finding); the active
  // body itself always mounts via the `activeTab === key` disjuncts below, so
  // this set only keeps previously-visited tabs alive after you switch away.
  // NOTE: the §5.3 ?tab=prism → Exposure alias lives in OptionsWorkspace's
  // HUB_KEY (the controlled entry point) — the uncontrolled copy of it died
  // with this seed; GexDeskView still reads ?tab=prism to open on the matrix.
  const [visitedTabs, setVisitedTabs] = useState<Set<TabKey>>(() => new Set<TabKey>([activeTab]));
  if (!visitedTabs.has(activeTab)) {
    setVisitedTabs(new Set(visitedTabs).add(activeTab));
  }

  function switchTab(tab: TabKey) {
    // Guard: never switch to a tab the hub can't render (e.g. a stray internal
    // jump under a restricted allowedTabs set that didn't opt the tab in).
    // Visited-tab bookkeeping happens in render (above) once activeTab moves.
    if (!renderableTabs.has(tab)) return;
    if (controlled) {
      onTab!(tab);
      return;
    }
    setInternalTab(tab);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", tab);
    window.history.replaceState({}, "", u.toString());
  }

  // ── Shared fetch: feed + heat (Tape tab) ─────────────────────────────────
  // Tape feed rides the SSE live spine — the LAST in-repo consumer migrated off
  // polling (Phase 1c). The server pushes only on change (asof + byte-length
  // signature), so the old client asof-dedup ref is gone and new events under an
  // unchanged asof can no longer be silently dropped. Subscribed unconditionally:
  // `feed` also drives cross-tab consumers (unusual_names → ticker candidates)
  // and the shared freshness chrome, so it must stay fresh off the Tape tab too.
  const { data: feed, connected: feedConnected, error: fetchError } = useFlowStream<FeedPayload>("feed");
  const flowTimingTab = activeTab === "tape" || activeTab === "zero_dte" || activeTab === "largest" || activeTab === "tide";
  const { data: flowMeta } = useFlowStream<unknown>(flowTimingTab ? "meta" : null, { pollMs: 60_000 });
  const lastFeedTs = feed?.asof ?? "";
  const [heat, setHeat] = useState<HeatPayload | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Chain-heat stays on the 45s poll (not on the SSE spine); the tape feed now
  // arrives via useFlowStream above, so this only refreshes heat.
  const doFetch = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      // flowGet's SWR TTL (25s) is shorter than the 45s poll, so invalidate first
      // or every tick returns the previous cycle's cached heat.
      flowInvalidate("heat");
      const hj = await flowGet("heat");
      if (hj) setHeat(hj as HeatPayload);
    } catch { /* heat is secondary — the tape feed carries its own SSE error state */ }
  }, []);

  // ── Tide fetch ────────────────────────────────────────────────────────────
  // Tide (intraday NCP/NPP + sector tide + top-net-impact) streams over the SSE spine
  // while the Tide tab is open. The hook keeps the last payload after you leave the tab
  // (so the cross-tab top-net-impact memos below still resolve) and reconnects on
  // re-entry. This also fixes a latent bug: the old 45s poll never actually refreshed
  // tide — fetchTide short-circuited on `if (tideData) return` after the first load.
  const { data: tideData, connected: tideConnected, error: tideStreamError } = useFlowStream<TidePayload>(
    activeTab === "tide" ? "tide" : null,
  );
  const [dteTide, setDteTide] = useState<DteTidePayload | null>(null);
  const tideLoading = activeTab === "tide" && !tideData;

  // DTE-tide is a secondary sub-view — fetch once when the Tide tab first opens.
  const fetchDte = useCallback(async () => {
    if (dteTide) return;
    try {
      const dd = await flowGet("dte");
      if (dd) setDteTide(dd as DteTidePayload);
    } catch { /* secondary view — fail soft */ }
  }, [dteTide]);

  // ── Ticker drill ─────────────────────────────────────────────────────────
  const [tickerSearch, setTickerSearch] = useState("");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tickerData, setTickerData] = useState<TickerPayload | null>(null);
  const [tickerLoading, setTickerLoading] = useState(false);

  const fetchTicker = useCallback(async (root: string) => {
    setTickerLoading(true); setTickerData(null);
    try {
      const d = await flowGet(`ticker:${root}`);
      // A payload without `day` (fixture honest-empty {}, malformed upstream) is
      // "no drill data", not a renderable drill — the render path derefs day.gross.
      if (d && (d as TickerPayload).day) setTickerData(d as TickerPayload);
    } catch {}
    setTickerLoading(false);
  }, []);

  // ── Filter state (Tape tab) ───────────────────────────────────────────────
  const [minPrem, setMinPrem] = useState<number>(0);
  const [dteBuckets, setDteBuckets] = useState<Set<DteBucket>>(new Set());
  const [mnyBuckets, setMnyBuckets] = useState<Set<MnyBucket>>(new Set());
  const [groupFilter, setGroupFilter] = useState<string>("");
  // Tide tab sub-view: the classic net-premium tide chart, or the quanted-style Session
  // Flow pane (C+P|calls|puts · cumulative|per-min · off-open · fill · absolute).
  const [tideView, setTideView] = useState<"tide" | "session">("tide");
  const [drillTicker, setDrillTicker] = useState<string | null>(null);
  const [tapeTickerSearch, setTapeTickerSearch] = useState<string>("");
  const [sideFilter, setSideFilter] = useState<string>("");
  const [flagFilter, setFlagFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<"ts" | "premium">("ts");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [showPresets, setShowPresets] = useState(false);
  const presetsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPresets) return;
    const h = (e: MouseEvent) => { if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) setShowPresets(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showPresets]);

  // Settle-tracking for the tape ticker filter — a live filter has no discrete
  // commit point, so log once the typed value sits unchanged for 1.2s.
  useEffect(() => {
    const v = tapeTickerSearch.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(v)) return;
    const id = setTimeout(() => trackSearch(v, "flow-tape", v), 1200);
    return () => clearTimeout(id);
  }, [tapeTickerSearch]);

  // Bootstrap heat; the tape feed bootstraps itself via useFlowStream (initial SSE
  // snapshot). The 45s poll refreshes heat only.
  //
  // PERF (v7b): nothing else awaits this any more. The old body awaited flowGet
  // ("heat" — a 2 KB payload) and only THEN started flowPrefetch("tide") +
  // flowPrefetch("prophet_idx"), which added a whole serial round trip to every
  // cold load and pulled ~319 KB of production payload for two tabs the visitor
  // had not opened. Neither is consumable by the Tape: `tide` via flowGet is read
  // only by FlowDeskView (the Tide tab itself rides SSE) and `prophet_idx` only by
  // ProphetView. Both are now warmed by the tab-activation effect below.
  useEffect(() => {
    void (async () => {
      try {
        const hj = await flowGet("heat");
        if (hj) setHeat(hj as HeatPayload);
      } catch { /* heat secondary */ }
    })();
    pollRef.current = setInterval(doFetch, 45_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch tide when the tab activates. The transport and measured producer timing
  // are disclosed separately; neither the watcher interval nor an open SSE claims
  // source freshness.
  useEffect(() => {
    if (activeTab !== "tide") return;
    void fetchDte();
  }, [activeTab, fetchDte]);

  // Warm a tab's OWN payloads at the moment that tab activates — never on hub mount.
  //   · manifest, Macro Prophet, and Options Alpha shadow are Prophet's.
  //   · tide via flowGet (~183 KB) is FlowDeskView's — the Tide tab itself rides SSE.
  // flowClientCache dedupes in-flight keys, so racing the sub-view's own fetch
  // collapses onto one request rather than doubling it.
  useEffect(() => {
    if (activeTab === "prophet") {
      flowPrefetch("prophet_idx");
      flowPrefetch("options_prophet_idx");
      flowPrefetch("manifest");
    }
    if (activeTab === "desk") flowPrefetch("tide");
  }, [activeTab]);

  // Fetch ticker data when selected; also sync vol surface for the merged right column.
  // The existing vol useEffect (below) triggers fetchVol when selectedVolRoot changes.
  useEffect(() => {
    if (selectedTicker) {
      fetchTicker(selectedTicker);
      // Sync vol root → triggers the existing vol useEffect which calls fetchVol
      setSelectedVolRoot(selectedTicker);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTicker]);

  // ── Filtered events (Tape) ────────────────────────────────────────────────
  // Deferred so typing in the ticker filter doesn't block on re-filtering ~2k events.
  const deferredTapeSearch = useDeferredValue(tapeTickerSearch);
  const events = useMemo<FlowEvent[]>(() => {
    const all = feed?.events ?? [];
    return all.filter((e) => {
      if (minPrem > 0 && e.premium < minPrem) return false;
      if (dteBuckets.size > 0 && !dteBuckets.has(e.dte_bucket)) return false;
      if (mnyBuckets.size > 0 && !mnyBuckets.has(e.mny_bucket)) return false;
      const ag = drillTicker ? "" : groupFilter;
      if (ag && e.group !== ag) return false;
      if (drillTicker && e.root !== drillTicker) return false;
      const q = deferredTapeSearch.trim().toUpperCase();
      if (q && !e.root.includes(q)) return false;
      if (sideFilter && e.side !== sideFilter) return false;
      if (flagFilter === "repeated" && !e.repeated) return false;
      if (flagFilter === "put_buy" && !(e.right === "P" && e.side === "~buy")) return false;
      if (flagFilter === "swept" && !e.swept) return false;
      return true;
    }).sort((a, b) => {
      const va = sortKey === "ts" ? new Date(a.ts).getTime() : a.premium;
      const vb = sortKey === "ts" ? new Date(b.ts).getTime() : b.premium;
      return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir;
    });
  }, [feed, minPrem, dteBuckets, mnyBuckets, groupFilter, drillTicker, deferredTapeSearch, sideFilter, flagFilter, sortKey, sortDir]);

  // Windowed rendering: only ~150 rows in the DOM at once (was all ~2k). An
  // IntersectionObserver sentinel grows the window on scroll; changing filters
  // resets it (but a 45s feed poll does NOT, so scroll position is kept).
  const TAPE_PAGE = 150;
  const [tapeLimit, setTapeLimit] = useState(TAPE_PAGE);
  const tapeSentinelRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => { setTapeLimit(TAPE_PAGE); }, [minPrem, dteBuckets, mnyBuckets, groupFilter, drillTicker, deferredTapeSearch, sideFilter, flagFilter, sortKey, sortDir]);
  useEffect(() => {
    const el = tapeSentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((ents) => {
      if (ents.some((x) => x.isIntersecting)) setTapeLimit((l) => l + TAPE_PAGE);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [events, tapeLimit]);
  const tapeRows = useMemo(() => events.slice(0, tapeLimit), [events, tapeLimit]);

  const drillUnusual = useMemo<UnusualName | null>(() => {
    if (!drillTicker) return null;
    return feed?.unusual_names.find((u) => u.root === drillTicker) ?? null;
  }, [feed, drillTicker]);

  function handleSort(k: "ts" | "premium") {
    if (sortKey === k) setSortDir((d) => (d === -1 ? 1 : -1));
    else { setSortKey(k); setSortDir(-1); }
  }

  function toggleDteMid() {
    const mid: DteBucket[] = ["8_30d", "31_90d"];
    const allOn = mid.every((b) => dteBuckets.has(b));
    setDteBuckets((prev) => {
      const next = new Set(prev);
      if (allOn) { mid.forEach((b) => next.delete(b)); } else { mid.forEach((b) => next.add(b)); }
      return next;
    });
  }
  const dteMidOn = ["8_30d", "31_90d"].every((b) => dteBuckets.has(b as DteBucket));
  const dataStale = (feed?.stale) || (lastFeedTs ? isStale(lastFeedTs) : false);
  const buildTapeCsvDownload = useCallback(() => {
    const metadata = {
      feedSchema: feed?.schema,
      sessionDate: feed?.session_date,
      feedAsof: feed?.asof,
      displayStale: Boolean(dataStale),
    };
    return {
      csv: buildOptionsTapeCsv(events, metadata),
      filename: buildOptionsTapeCsvFilename(metadata),
    };
  }, [dataStale, events, feed?.asof, feed?.schema, feed?.session_date]);
  const heatGroups = heat?.groups ?? [];
  const unusualNames = feed?.unusual_names ?? [];

  // ── Highlights: the session's loudest events, DISPLAY-ONLY ────────────────────
  // Pure ordering over fields the feed already carries — `premium` (biggest single
  // prints) and `n_prints` (the repeat-hitters, a field the payload has always shipped
  // but nothing rendered). No scoring, no ranking model, nothing fused. Computed off the
  // RAW feed, not the filtered rows, so it stays a stable read on the whole session.
  const highlights = useMemo(() => {
    const all = feed?.events ?? [];
    if (!all.length) return { biggest: [] as FlowEvent[], repeats: [] as FlowEvent[] };
    const biggest = [...all].sort((a, b) => b.premium - a.premium).slice(0, 3);
    const repeats = all
      .filter((e) => (e.n_prints ?? 0) > 1)
      .sort((a, b) => (b.n_prints ?? 0) - (a.n_prints ?? 0))
      .slice(0, 3);
    return { biggest, repeats };
  }, [feed]);
  const hasHighlights = highlights.biggest.length > 0 || highlights.repeats.length > 0;

  // ── Source health — distinguish an outage/delay from a genuinely quiet tape
  // so an empty Tape/Tide isn't silently shown as "no events match these filters".
  const rawTapeCount = feed?.events?.length ?? 0;
  const feedUnavailable = fetchError && !feed;        // couldn't load the feed at all
  const feedDelayed = !!feed && dataStale;            // have data, but it isn't fresh
  // ── Active-tab freshness ──────────────────────────────────────────────────
  // The status row + banner below are SHARED by the Tape and Tide tabs, but the
  // Tide tab renders tideData — a SEPARATE stream. Its source/as-of/delayed state
  // must come from tideData.asof, NOT the tape feed; otherwise the Tide tab shows
  // the tape's clock (and tape-specific "the tape may not be refreshing" copy)
  // over an independently-fresh series. `active*` resolves to the tape-derived
  // values off the Tide tab, preserving each tab's independent source clock.
  const onTide = activeTab === "tide";
  const onTapeFeed = activeTab === "tape" || activeTab === "zero_dte" || activeTab === "largest";
  const tideAsof = tideData?.asof ?? "";
  const tideStale = tideAsof ? isStale(tideAsof) : false;
  const tideUnavailable = onTide && tideStreamError && !tideData;
  const tideDelayed = !!tideData && tideStale;
  const activeUnavailable = onTide ? tideUnavailable : feedUnavailable;
  const activeDelayed     = onTide ? tideDelayed     : feedDelayed;
  const activeAsof        = onTide ? tideAsof         : lastFeedTs;
  const activeStale       = onTide ? tideStale        : dataStale;
  const activeSessionDate = onTide ? tideData?.session_date : feed?.session_date;
  const activeConnected   = onTide ? tideConnected : feedConnected;
  const marketOpenNow     = usOptionsSessionState(activeSessionDate, new Date()) === "regular";
  const activeProblem     = activeUnavailable || (activeDelayed && marketOpenNow);
  const activeUpdatedLabel = activeAsof
    ? `${activeSessionDate ? activeSessionDate + " · " : ""}${fmtAsof(activeAsof)} ET`
    : "";

  // Ticker search candidates from tide top_net_impact + unusual names
  const tickerCandidates: string[] = useMemo(() => {
    const set = new Set<string>();
    (tideData?.top_net_impact ?? []).forEach((n) => set.add(n.root));
    (feed?.unusual_names ?? []).forEach((n) => set.add(n.root));
    return Array.from(set).sort();
  }, [tideData, feed]);

  const filteredCandidates = tickerSearch.trim()
    ? tickerCandidates.filter((r) => r.includes(tickerSearch.toUpperCase()))
    : tickerCandidates.slice(0, 20);

  // ── Screener fetch ────────────────────────────────────────────────────────
  const [oiData, setOiData] = useState<OiMoversPayload | null>(null);
  const [hotData, setHotData] = useState<HotPayload | null>(null);
  const [screenerLoading, setScreenerLoading] = useState(false);

  const fetchScreener = useCallback(async () => {
    if (oiData && hotData) return;
    setScreenerLoading(true);
    try {
      const [od, hd] = await Promise.all([
        flowGet("oi"),
        flowGet("hot"),
      ]);
      if (od) setOiData(od as OiMoversPayload);
      if (hd) setHotData(hd as HotPayload);
    } catch {}
    setScreenerLoading(false);
  }, [oiData, hotData]);

  useEffect(() => {
    if (activeTab === "screener") fetchScreener();
  }, [activeTab, fetchScreener]);

  const [hotView, setHotView] = useState<ScreenerHotView>("by_premium");

  // ── Screener preset view state ────────────────────────────────────────────
  const [screenerPreset, setScreenerPreset] = useState<ScreenerPreset>("top_prem");
  // Screener belt filters (index root / sector group). ΔOI + Hot Contracts rows carry no
  // `group`, so the sector half of the belt is hidden — and cleared — on those views rather
  // than sitting there as a control that silently does nothing.
  const [scrRoot, setScrRoot] = useState("");
  const [scrGroup, setScrGroup] = useState("");
  const scrHasGroups = ["top_prem", "unusual_z", "fresh", "zerodte"].includes(screenerPreset);
  const scrBeltOn = Boolean(scrRoot || scrGroup);
  /**
   * Empty-row copy for a belt-filtered table. Once a chip can empty a table, the old
   * copy ("No data yet this session") becomes a false statement about the SESSION when
   * the truth is "your filter matched nothing". `had` is the UNFILTERED count: >0 means
   * the belt is the reason, so say that and offer the way out. Otherwise the session
   * copy stands, unchanged.
   */
  // Plain function, deliberately NOT useCallback: it renders at most one row per pass and
  // memoizing it only blocks the React Compiler (its inferred deps read scrRoot/scrGroup,
  // not the derived scrBeltOn, so a manual dep array cannot be preserved).
  const scrEmptyRow = (cols: number, sessionEn: string, sessionZh: string, had: number) => (
    <tr>
      <td colSpan={cols} style={{ textAlign: "center", color: "var(--muted)", padding: "30px 0" }}>
        {scrBeltOn && had > 0 ? (
          <>
            <div className="fin-empty-title" style={{ fontSize: 12.5 }}>{t("scrNoMatch")}</div>
            <div className="fin-empty-why" style={{ margin: "6px auto 9px" }}>
              {lang === "zh"
                ? `筛选前共 ${had.toLocaleString("en-US")} 行 — 当前的指数／板块筛选把它们全部排除了。`
                : `${had.toLocaleString("en-US")} rows before filtering — the index/sector chips exclude every one of them.`}
            </div>
            <button
              className="chip"
              style={{ height: 24, fontSize: 11 }}
              onClick={() => { setScrRoot(""); setScrGroup(""); }}
            >
              {t("clearFilter")}
            </button>
          </>
        ) : (
          <>
            <div className="fin-empty-title" style={{ fontSize: 12.5 }}>{lang === "zh" ? sessionZh : sessionEn}</div>
            {/* Why: nightly dataset vs a quiet current snapshot vs the last session. */}
            <div className="fin-empty-why" style={{ margin: "6px auto 0" }}>
              {screenerPreset === "doi" || screenerPreset === "hot"
                ? (lang === "zh"
                    ? "该视图来自夜间收盘构建，今晚运行后刷新。"
                    : "This view is built from the nightly close — it refreshes after tonight’s run.")
                : marketOpenNow
                ? (lang === "zh"
                    ? "当前常规交易时段仍在进行 — 达标成交进入新的源数据快照后显示。"
                    : "The regular-hours session is current — rows appear in new published source snapshots.")
                : (lang === "zh"
                    ? "市场休市 — 显示上一交易时段；下次开盘后恢复新的源数据快照。"
                    : "Market closed — showing the last session; new source snapshots resume after the next open.")}
            </div>
          </>
        )}
      </td>
    </tr>
  );
  // Sort state for screener preset tables
  const [scrSortKey, setScrSortKey] = useState<string>("");
  const [scrSortDir, setScrSortDir] = useState<1 | -1>(-1);

  function scrSort(key: string) {
    if (scrSortKey === key) setScrSortDir((d) => (d === -1 ? 1 : -1));
    else { setScrSortKey(key); setScrSortDir(-1); }
  }

  // The table and CSV consume the same memoized collections. That makes the
  // active preset's filters and ordering an executable contract instead of two
  // implementations that can drift apart.
  const screenerFilter = useMemo(() => ({ root: scrRoot, group: scrGroup }), [scrRoot, scrGroup]);
  const topPremiumRows = useMemo(
    () => selectTopPremiumRows(feed?.unusual_names ?? [], screenerFilter, scrSortKey, scrSortDir),
    [feed?.unusual_names, screenerFilter, scrSortDir, scrSortKey],
  );
  const unusualRows = useMemo(
    () => selectUnusualRows(feed?.unusual_names ?? [], screenerFilter, scrSortKey, scrSortDir),
    [feed?.unusual_names, screenerFilter, scrSortDir, scrSortKey],
  );
  const freshRows = useMemo(
    () => selectFreshRows(feed?.events ?? [], feed?.unusual_names ?? [], screenerFilter, scrSortKey, scrSortDir),
    [feed?.events, feed?.unusual_names, screenerFilter, scrSortDir, scrSortKey],
  );
  const oiRows = useMemo(
    () => selectOiRows(oiData?.movers ?? [], screenerFilter, scrSortKey, scrSortDir),
    [oiData?.movers, screenerFilter, scrSortDir, scrSortKey],
  );
  const zeroDteRows = useMemo(
    () => selectZeroDteRows(feed?.events ?? [], screenerFilter, scrSortKey, scrSortDir),
    [feed?.events, screenerFilter, scrSortDir, scrSortKey],
  );
  const hotRows = useMemo(
    () => selectHotRows(hotData?.[hotView] ?? [], screenerFilter),
    [hotData, hotView, screenerFilter],
  );
  const activeScreenerRows = useMemo<OptionsScreenerCsvRow[]>(() => {
    switch (screenerPreset) {
      case "top_prem": return topPremiumRows;
      case "unusual_z": return unusualRows;
      case "fresh": return freshRows;
      case "doi": return oiRows;
      case "zerodte": return zeroDteRows;
      case "hot": return hotRows;
    }
  }, [freshRows, hotRows, oiRows, screenerPreset, topPremiumRows, unusualRows, zeroDteRows]);
  const activeScreenerSort = useMemo(
    () => resolveScreenerSort(screenerPreset, scrSortKey, scrSortDir, hotView),
    [hotView, scrSortDir, scrSortKey, screenerPreset],
  );
  const screenerSourceSchema = screenerPreset === "doi"
    ? oiData?.schema
    : screenerPreset === "hot"
      ? hotData?.schema
      : feed?.schema;
  const screenerSourceAsof = screenerPreset === "doi"
    ? oiData?.asof
    : screenerPreset === "hot"
      ? hotData?.asof
      : feed?.asof;
  const screenerSessionDate = screenerPreset === "doi" || screenerPreset === "hot"
    ? screenerSourceAsof?.slice(0, 10)
    : feed?.session_date;
  const screenerDisplayStale = screenerPreset === "doi" || screenerPreset === "hot"
    ? null
    : Boolean(dataStale);
  const buildScreenerCsvDownload = useCallback(() => {
    const metadata = {
      preset: screenerPreset,
      hotView,
      sourceSchema: screenerSourceSchema,
      sourceAsof: screenerSourceAsof,
      sessionDate: screenerSessionDate,
      displayStale: screenerDisplayStale,
      rootFilter: scrRoot,
      groupFilter: scrGroup,
      sortKey: activeScreenerSort.key,
      sortDirection: activeScreenerSort.direction,
    };
    return {
      csv: buildOptionsScreenerCsv(activeScreenerRows, metadata),
      filename: buildOptionsScreenerCsvFilename(metadata),
    };
  }, [
    activeScreenerRows, activeScreenerSort.direction, activeScreenerSort.key,
    hotView, scrGroup, scrRoot, screenerDisplayStale, screenerPreset,
    screenerSessionDate, screenerSourceAsof, screenerSourceSchema,
  ]);

  // ── Vol fetch ─────────────────────────────────────────────────────────────
  const [selectedVolRoot, setSelectedVolRoot] = useState<string | null>(null);
  const [volData, setVolData] = useState<VolPayload | null>(null);
  const [volLoading, setVolLoading] = useState(false);

  const fetchVol = useCallback(async (root: string) => {
    setVolLoading(true); setVolData(null);
    try {
      const d = (await flowGet(`vol:${root}`)) as Record<string, unknown> | null;
      if (d) setVolData(normalizeVolUnits(d) as unknown as VolPayload);
    } catch {}
    setVolLoading(false);
  }, []);

  useEffect(() => {
    if (selectedVolRoot) fetchVol(selectedVolRoot);
  }, [selectedVolRoot, fetchVol]);

  // ── Hub context (ctx) fetch — consumed by Tide + GEX tabs, lazy on activate ──
  const [ctxData, setCtxData] = useState<CtxPayload | null>(null);
  const fetchCtx = useCallback(async () => {
    if (ctxData) return; // already loaded
    try {
      const d = await flowGet("ctx");
      if (d) setCtxData(d as CtxPayload);
    } catch {}
  }, [ctxData]);

  // ── OI-confirmed fetch — consumed by Tape tab only, lazy on activate ─────────
  const [oiConfData, setOiConfData] = useState<OiConfPayload>([]);
  const oiConfLoaded = useRef(false);
  const fetchOiConf = useCallback(async () => {
    if (oiConfLoaded.current) return; // already loaded
    oiConfLoaded.current = true;
    try {
      const raw = await flowGet("oiconf");
      if (raw) {
        // Payload is either an array directly or wrapped
        setOiConfData(Array.isArray(raw) ? raw as OiConfPayload : ((raw as Record<string, unknown>).confirmed as OiConfPayload ?? []));
      }
    } catch { oiConfLoaded.current = false; }
  }, []);
  // Membership set for O(1) per-row OI-confirmed lookup (avoids per-row .some())
  const oiConfSet = useMemo(
    () => new Set(oiConfData.map((oc) => `${oc.root}|${oc.right}|${oc.exp}|${oc.strike}`)),
    [oiConfData],
  );

  // ── Ticker context (tctx) fetch ───────────────────────────────────────────
  const [tctxData, setTctxData] = useState<TctxPayload | null>(null);
  const [tctxRoot, setTctxRoot] = useState<string | null>(null);
  const tctxFetch = useCallback(async (root: string) => {
    if (tctxRoot === root && tctxData) return;
    setTctxRoot(root); setTctxData(null);
    try {
      const d = await flowGet(`tctx:${root}`);
      if (d) setTctxData(d as TctxPayload);
    } catch {}
  }, [tctxRoot, tctxData]);

  // Lazy-load ctx (Tide + GEX) and oiconf (Tape) when their consuming tab activates
  useEffect(() => {
    if (activeTab === "tide" || activeTab === "gex") fetchCtx();
    if (activeTab === "tape") fetchOiConf();
  }, [activeTab, fetchCtx, fetchOiConf]);

  // Fetch tctx when ticker is selected
  useEffect(() => {
    if (selectedTicker) tctxFetch(selectedTicker);
  }, [selectedTicker, tctxFetch]);

  // ── GEX fetch ─────────────────────────────────────────────────────────────
  const [gexSearch, setGexSearch] = useState("");
  const [selectedGexRoot, setSelectedGexRoot] = useState<string | null>(null);
  const [gexData, setGexData] = useState<GexPayload | null>(null);
  const [gexLoading, setGexLoading] = useState(false);
  const [gexGreek, setGexGreek] = useState<GreekKey>("gamma");

  const gexCandidates: string[] = useMemo(() => {
    const from = tideData?.top_net_impact.map((x) => x.root) ?? [];
    const defaults = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA"];
    const set = new Set([...from, ...defaults]);
    return Array.from(set).sort();
  }, [tideData]);

  const filteredGexCandidates = gexSearch.trim()
    ? gexCandidates.filter((r) => r.includes(gexSearch.toUpperCase()))
    : gexCandidates.slice(0, 20);

  const fetchGex = useCallback(async (root: string) => {
    setGexLoading(true); setGexData(null);
    try {
      const d = await flowGet(`gex:${root}`);
      if (d) setGexData(d as GexPayload);
    } catch {}
    setGexLoading(false);
  }, []);

  useEffect(() => {
    if (selectedGexRoot) fetchGex(selectedGexRoot);
  }, [selectedGexRoot, fetchGex]);

  // ── Leaders fetch ─────────────────────────────────────────────────────────
  const [leadersData, setLeadersData] = useState<LeadersPayload | null>(null);
  const [leadersLoading, setLeadersLoading] = useState(false);
  const [leadersError, setLeadersError] = useState(false);
  const [leadersBoard, setLeadersBoard] = useState<"a" | "b">("a");

  const fetchLeaders = useCallback(async () => {
    if (leadersData) return;
    setLeadersLoading(true); setLeadersError(false);
    try {
      const d = await flowGet("leaders");
      if (d) setLeadersData(d as unknown as LeadersPayload);
      else setLeadersError(true);
    } catch { setLeadersError(true); }
    setLeadersLoading(false);
  }, [leadersData]);

  useEffect(() => {
    if (activeTab === "leaders") fetchLeaders();
  }, [activeTab, fetchLeaders]);

  // ── Leader Radar fetch ────────────────────────────────────────────────────
  const [radarData, setRadarData] = useState<RadarPayload | null>(null);
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarError, setRadarError] = useState(false);
  const [showNone, setShowNone] = useState(false);

  const fetchRadar = useCallback(async () => {
    if (radarData) return;
    setRadarLoading(true); setRadarError(false);
    try {
      const d = await flowGet("radar");
      if (d) setRadarData(d as unknown as RadarPayload);
      else setRadarError(true);
    } catch { setRadarError(true); }
    setRadarLoading(false);
  }, [radarData]);

  useEffect(() => {
    if (activeTab === "radar") fetchRadar();
  }, [activeTab, fetchRadar]);

  // ─── Render ───────────────────────────────────────────────────────────────

  // Tape header row, shared by the real table and by the loading skeleton so the
  // column widths, the sort affordances and the belt above them are all identical
  // before and after the first SSE frame — nothing reflows when data lands.
  // COLUMN ORDER IS LOAD-BEARING: the ≤640px rules hide `.scr-table table.scr`
  // columns 3/5/6/7/8/9 by nth-child. Never reorder these.
  const tapeThead = (
    <thead>
      <tr>
        <th style={{ textAlign: "left", cursor: "pointer" }} className={sortKey === "ts" ? "sorted" : ""} onClick={() => handleSort("ts")}>
          {t("colTime", "Time")} ET{sortKey === "ts" ? (sortDir === -1 ? " ↓" : " ↑") : ""}
        </th>
        <th style={{ textAlign: "left" }}>{t("colTicker", "Ticker")}</th>
        <th style={{ textAlign: "left" }}>{t("colSector", "Sector")}</th>
        <th>{t("colSide", "Side")}</th>
        <th>{t("colCP", "C/P")}</th>
        <th>{t("colContract", "Contract")}</th>
        <th>{t("colDte", "DTE")}</th>
        <th>{t("colMny", "Mny")}</th>
        <th>{t("colSize", "Size")}</th>
        <th style={{ cursor: "pointer" }} className={sortKey === "premium" ? "sorted" : ""} onClick={() => handleSort("premium")}>
          {t("colPrem", "Prem")}{sortKey === "premium" ? (sortDir === -1 ? " ↓" : " ↑") : ""}
        </th>
        <th>{t("colFlags", "Flags")}</th>
      </tr>
    </thead>
  );

  // Wrapper element: STANDALONE (legacy / self-managed) owns its own `.main2`
  // grid cell — the chrome (.app2 grid + topbar + AppNav) is the route layout's.
  // EMBEDDED (controlled by a workspace page) renders a bare flex column instead,
  // because the page already provides the single `.main2` and mounts WorkspaceTabs
  // above this engine — a second nested <main className="main2"> would be invalid
  // HTML and double the grid cell.
  const Wrapper: "main" | "div" = controlled ? "div" : "main";
  const wrapperProps = controlled
    ? { style: { flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" as const } }
    : { className: "main2", style: { overflow: "hidden", display: "flex", flexDirection: "column" as const } };

  return (
    <CoachProvider>
      {/* Chrome (.app2 grid + MobileNav + topbar + AppNav) is owned by the route
          layout (AppShell for /research, FlowChrome legacy). Standalone renders the
          .main2 grid cell; embedded renders a bare flex column inside the page's
          .main2 (see Wrapper above) so a crash surfaces the error boundary in-place. */}
      <Wrapper {...wrapperProps}>

        {/* ── Tab bar (Observatory pill-nav) + source timing status ──
            In CONTROLLED mode (page-driven) the page renders WorkspaceTabs above
            this engine, so the internal strip is suppressed — but the live-feed
            status row still shows (it is view-state coupled, not tab chrome). The
            strip is also suppressed when hideTabStrip is set.
            The whole row collapses when there is neither a strip NOR source timing
            status to show (e.g. a Discover single-tab Leaders/Radar mount), so it
            doesn't leave an empty bordered bar. */}
        {(() => {
          const showStrip = !controlled && !hideTabStrip;
          const showFlowTiming = onTapeFeed || onTide;
          // Vol-regime chip (OEU T-E): hub-wide settled vol weather, so it belongs to the
          // hub's own header wherever the hub is acting as a HUB — standalone or inside the
          // workspace. A Discover single-tab embed (one allowed tab) is a bare mount of one
          // surface, not a hub header, and must stay bare.
          const showVol = stripTabs.length > 1;
          if (!showStrip && !showFlowTiming && !activeAsof && !showVol) return null;
          return (
        <div className="options-flow-status-row" style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0, gap: 8 }}>
          {showStrip && (
            <nav className="obs-pillnav" aria-label={lang === "zh" ? "期权工具选项卡" : "Options Hub tabs"}>
              {stripTabs.map((tb) => (
                <button
                  key={tb.key}
                  className={`obs-pillnav-tab${activeTab === tb.key ? " on" : ""}`}
                  onClick={() => switchTab(tb.key)}
                >
                  {lang === "zh"
                    ? t(tb.zhKey, tb.key)
                    : t(tb.enKey, tb.key)}
                </button>
              ))}
            </nav>
          )}
          <div className="spacer" />
          {/* Settled vol weather from macro's vol/regime.json — macro's verdict wording and
              its one-line read, passed through verbatim. Sits BEFORE the live-status cluster
              so the header reads left-to-right from slowest cadence to fastest. */}
          {showVol && <VolRegimeChip lang={lang} />}
          {/* Transport and producer timing are separate claims. Connected means
              EventSource-open only; source ages require strict live_flow.meta/v2. */}
          {showFlowTiming && (
            <FlowFreshnessReceipt
              meta={flowMeta}
              connected={activeConnected}
              lang={lang}
              sessionDate={activeSessionDate}
              className="options-flow-freshness"
            />
          )}
          {activeAsof && (
            <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
              {t("asOf", "as of")} {fmtAsof(activeAsof)}
              {activeStale && (
                <span style={{ marginLeft: 6, color: "var(--warn)", fontWeight: 600 }}>
                  {lang === "zh" ? "延迟" : "delayed"}
                </span>
              )}
            </span>
          )}
        </div>
          );
        })()}

        {/* ── Source status banner (Tape + Tide are intraday session artifacts) ── */}
        {(onTapeFeed || onTide) && (activeUnavailable || activeDelayed) && (
          <div
            role="status"
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 12px", fontSize: 12, fontWeight: 600, lineHeight: 1.4,
              borderBottom: "1px solid var(--border, #222)",
              color: activeProblem ? "var(--warn)" : "var(--text-dim)",
              background: activeProblem ? "color-mix(in srgb, var(--warn) 12%, transparent)" : "transparent",
            }}
          >
            <span aria-hidden>{activeProblem ? "⚠" : "◷"}</span>
            <span>
              {activeUnavailable
                ? (lang === "zh"
                    ? `${onTide ? "市场潮汐" : "期权流"}不可用 — 暂时无法连接数据源。`
                    : `${onTide ? "Market tide" : "Options flow"} unavailable — can’t reach the data source right now.`)
                : marketOpenNow
                ? (lang === "zh"
                    ? `${onTide ? "市场潮汐" : "期权流"}延迟 — 最近源快照 ${activeUpdatedLabel}，${onTide ? "潮汐" : "盘口"}可能未在刷新。`
                    : `${onTide ? "Market tide" : "Options flow"} delayed — last source snapshot ${activeUpdatedLabel}; ${onTide ? "the tide" : "the tape"} may not be refreshing.`)
                : (lang === "zh"
                    ? `市场休市 — 显示上一交易时段（${activeUpdatedLabel}）。下次开盘后恢复新的源数据快照。`
                    : `Market closed — showing the last session (${activeUpdatedLabel}). New source snapshots resume after the next open.`)}
            </span>
          </div>
        )}

        {/* ── Tab content ── */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

          {/* ═══ DESK TAB ══════════════════════════════════════════════════ */}
          {/* Keep-alive: stay mounted once visited so tab switches are instant.
              `|| activeTab===` mounts it on the SAME render the page moves the tab
              (controlled mode moves it via a prop, not the hub's switchTab which
              seeds visitedTabs synchronously) — no one-frame skeleton flash. */}
          {(activeTab === "desk" || visitedTabs.has("desk")) && (
            <div style={{ flex: 1, overflow: "hidden", display: activeTab === "desk" ? "flex" : "none", flexDirection: "column", minHeight: 0 }}>
              <FlowDeskView />
            </div>
          )}

          {/* ═══ TAPE TAB ═══════════════════════════════════════════════════ */}
          {activeTab === "tape" && (
            <>
              {/* Belt: index roots, then sector groups. Both drive the SAME table below —
                  index chips reuse drillTicker (per-root), sector chips groupFilter, and the
                  two are mutually exclusive by construction. */}
              <div className="flow-heat-strip">
                <span className="belt-cap">{t("beltIndex")}</span>
                {INDEX_ROOTS.map((r) => (
                  <button
                    key={r}
                    className={`chip${drillTicker === r ? " on" : ""}`}
                    onClick={() => { setGroupFilter(""); setTapeTickerSearch(""); setDrillTicker((d) => (d === r ? null : r)); }}
                    aria-pressed={drillTicker === r}
                  >
                    {r}
                  </button>
                ))}
                <span className="belt-div" aria-hidden="true" />
                <span className="belt-cap">{t("beltSector")}</span>
                {heatGroups.length === 0 && !fetchError && (
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>
                    {t("loadingHeat", "Loading group data…")}
                  </span>
                )}
                {heatGroups.map((g) => {
                  const glyph = netToneGlyph(g.net_signed_premium_soft);
                  const toneUp = g.net_signed_premium_soft > 0;
                  const toneDown = g.net_signed_premium_soft < 0;
                  const on = groupFilter === g.group && !drillTicker;
                  const gName = lang === "zh" ? g.group_zh : abbrevSector(g.group);
                  return (
                    <button
                      key={g.group}
                      className={`chip${on ? " on" : ""}`}
                      onClick={() => { setDrillTicker(null); setGroupFilter((f) => (f === g.group ? "" : g.group)); }}
                      style={{ gap: 5 }}
                    >
                      <span>{gName}</span>
                      <span style={{ color: "var(--text-2)", fontWeight: 700 }}>{fmtPremium(g.gross_premium)}</span>
                      <span style={{ color: toneUp ? "var(--up)" : toneDown ? "var(--down)" : "var(--muted)", fontWeight: 700, fontSize: 10 }}>
                        {glyph}
                      </span>
                    </button>
                  );
                })}
                {groupFilter && !drillTicker && (
                  <button className="chip" onClick={() => setGroupFilter("")} style={{ marginLeft: 4, color: "var(--muted)" }} aria-label={t("clearFilter")} title={t("clearFilter")}>✕</button>
                )}
              </div>

              {/* Highlights — the session's loudest events. Display-only: an ordering over
                  fields the feed already ships, never a score. Click drills the tape. */}
              {hasHighlights && (
                <div className="flow-highlights">
                  <span className="belt-cap">{t("highlights")}</span>
                  {highlights.biggest.length > 0 && (
                    <span className="hl-group">
                      <span className="hl-lbl">{t("hlBiggest")}</span>
                      {highlights.biggest.map((e) => (
                        <button key={`b-${e.id}`} className="chip hl-chip" onClick={() => { setGroupFilter(""); setDrillTicker((d) => (d === e.root ? null : e.root)); }}>
                          <span className="hl-tk">{e.root}</span>
                          <span className="hl-v">{fmtPremium(e.premium)}</span>
                        </button>
                      ))}
                    </span>
                  )}
                  {highlights.repeats.length > 0 && (
                    <span className="hl-group">
                      <span className="hl-lbl">{t("hlRepeats")}</span>
                      {highlights.repeats.map((e) => (
                        <button key={`r-${e.id}`} className="chip hl-chip" onClick={() => { setGroupFilter(""); setDrillTicker((d) => (d === e.root ? null : e.root)); }}>
                          <span className="hl-tk">{e.root}</span>
                          <span className="hl-v">×{e.n_prints}</span>
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              )}

              {/* Filter bar */}
              <div className="flow-filter-bar">
                {/* Presets dropdown */}
                <div ref={presetsRef} style={{ position: "relative" }}>
                  <button className={`chip${showPresets ? " on" : ""}`} style={{ height: 26, fontSize: 11 }} onClick={() => setShowPresets((v) => !v)}>
                    {t("presets", "Presets")} ▾
                  </button>
                  {showPresets && (
                    <div className="pop show" style={{ top: "calc(100% + 5px)", left: 0, minWidth: 180 }}>
                      {PRESETS.map((p) => (
                        <button
                          key={p.key}
                          className="menu-row"
                          style={{ width: "100%" }}
                          onClick={() => {
                            p.apply({ setMinPrem, setDteBuckets, setMnyBuckets, setSideFilter, setFlagFilter });
                            setShowPresets(false);
                          }}
                        >
                          {t(p.labelKey, p.key)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Min premium */}
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span className="hub-cap obs-lbl">{t("minPrem", "Min prem")}</span>
                  <select
                    value={minPrem}
                    onChange={(e) => setMinPrem(Number(e.target.value))}
                    style={{ height: 28, padding: "0 8px", borderRadius: "var(--r-md)", background: "var(--inset)", border: "1px solid var(--line)", color: "var(--text)", font: "600 12px var(--font-ui)", cursor: "pointer" }}
                  >
                    <option value={0}>{t("anyPrem", "Any")}</option>
                    {PREM_FILTERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>

                {/* DTE buckets */}
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="hub-cap obs-lbl">{t("dte", "DTE")}</span>
                  <button className={`chip${dteMidOn ? " on" : ""}`} style={{ height: 26, fontSize: 11 }} onClick={toggleDteMid} title={lang === "zh" ? "8–90天快选" : "8–90d preset"}>8–90d</button>
                  {DTE_BUCKETS.map((b) => (
                    <button
                      key={b.key}
                      className={`chip${dteBuckets.has(b.key) ? " on" : ""}`}
                      style={{ height: 26, fontSize: 11 }}
                      onClick={() => setDteBuckets((prev) => { const next = new Set(prev); if (next.has(b.key)) next.delete(b.key); else next.add(b.key); return next; })}
                    >
                      {lang === "zh" ? b.zh : b.en}
                    </button>
                  ))}
                </div>

                {/* Moneyness */}
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="hub-cap obs-lbl">{t("mny", "Mny")}</span>
                  {MNY_BUCKETS.map((b) => (
                    <button
                      key={b.key}
                      className={`chip${mnyBuckets.has(b.key) ? " on" : ""}`}
                      style={{ height: 26, fontSize: 11 }}
                      onClick={() => setMnyBuckets((prev) => { const next = new Set(prev); if (next.has(b.key)) next.delete(b.key); else next.add(b.key); return next; })}
                    >
                      {lang === "zh" ? b.zh : b.en}
                    </button>
                  ))}
                </div>

                {/* Ticker search */}
                <input
                  type="text"
                  placeholder={t("tapeTickerPlaceholder", "Ticker…")}
                  value={tapeTickerSearch}
                  onChange={(e) => { setTapeTickerSearch(e.target.value); setDrillTicker(null); }}
                  style={{ height: 28, padding: "0 10px", borderRadius: "var(--r-md)", background: "var(--inset)", border: "1px solid var(--line)", color: "var(--text)", font: "13px var(--font-ui)", width: 110 }}
                />

                {/* Reset */}
                {(minPrem > 0 || dteBuckets.size > 0 || mnyBuckets.size > 0 || groupFilter || tapeTickerSearch || drillTicker || sideFilter || flagFilter) && (
                  <button
                    className="chip"
                    style={{ marginLeft: 4, color: "var(--muted)", height: 26, fontSize: 11 }}
                    onClick={() => { setMinPrem(0); setDteBuckets(new Set()); setMnyBuckets(new Set()); setGroupFilter(""); setTapeTickerSearch(""); setDrillTicker(null); setSideFilter(""); setFlagFilter(""); }}
                  >
                    {t("tapeReset", "Reset")}
                  </button>
                )}

                <OptionsCsvExportButton
                  label={t("exportCsv")}
                  rowCount={events.length}
                  buildDownload={buildTapeCsvDownload}
                />
              </div>

              {/* Drill card */}
              {drillTicker && (
                <div className="flow-drill-card">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{drillTicker}</span>
                    {drillUnusual && (
                      <>
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>{lang === "zh" ? drillUnusual.group_zh : drillUnusual.group}</span>
                        <span style={{ color: "var(--text-2)", fontSize: 12 }}>
                          {t("tapeRunningPrem", "Running prem")} <strong>{fmtPremium(drillUnusual.gross_premium_today)}</strong>
                        </span>
                        <span style={{ color: "var(--text-2)", fontSize: 12 }}>
                          {activityBand(drillUnusual.prem_z, lang)}
                        </span>
                        {drillUnusual.top_contracts.length > 0 && (
                          <span style={{ color: "var(--muted)", fontSize: 11 }}>
                            {lang === "zh" ? "主力合约：" : "Top: "}
                            {drillUnusual.top_contracts.slice(0, 3).map((c, i) => (
                              <span key={i} style={{ marginRight: 8 }}>{fmtContract(c.right, c.exp, c.strike)} {fmtPremium(c.premium)}</span>
                            ))}
                          </span>
                        )}
                      </>
                    )}
                    <button className="chip" style={{ marginLeft: "auto", height: 24, fontSize: 11, color: "var(--muted)" }} onClick={() => setDrillTicker(null)} aria-label={t("clearFilter")} title={t("clearFilter")}>✕</button>
                  </div>
                </div>
              )}

              {/* Main body: table + unusual rail */}
              <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
                <div className="scr-table" style={{ flex: 1 }}>
                  {fetchError && !feed && (
                    <div className="fin-empty fin-empty-lg" role="status">
                      <div className="fin-empty-title">
                        {lang === "zh" ? "数据暂时不可用，请稍后重试。" : "Feed unavailable — retrying…"}
                      </div>
                      <div className="fin-empty-why">
                        {lang === "zh"
                          ? "无法连接期权盘口数据流，本时段尚无缓存数据。"
                          : "Can’t reach the options tape stream, and nothing is cached for this session yet."}
                      </div>
                    </div>
                  )}
                  {/* Loading: paint the tape's OWN shape — real header row plus shimmer
                      rows — instead of a one-line "Loading…". The SSE first frame is the
                      longest leg of a cold load, and a blank stare there reads as broken. */}
                  {!fetchError && !feed && (
                    <table
                      className="scr"
                      style={{ fontSize: 12 }}
                      role="status"
                      aria-busy="true"
                      aria-label={t("loading", "Loading…")}
                    >
                      {tapeThead}
                      <tbody>
                        {Array.from({ length: TAPE_SKEL_ROWS }, (_, r) => (
                          <tr key={r} aria-hidden="true">
                            {TAPE_SKEL_COLS.map((w, c) => (
                              <td key={c} style={{ textAlign: c < 3 ? "left" : undefined }}>
                                <span
                                  className="fin-skel"
                                  style={{
                                    display: "inline-block", height: 9, width: w,
                                    borderRadius: 3, verticalAlign: "middle",
                                    opacity: 0.85 - r * 0.045,
                                  }}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {feed && (
                    <table className="scr" style={{ fontSize: 12 }}>
                      {tapeThead}
                      <tbody>
                        {events.length === 0 && (
                          <tr className="empty-row">
                            <td colSpan={11} style={{ textAlign: "center", padding: "40px 16px" }}>
                              <div className="fin-empty-title">
                                {rawTapeCount > 0
                                  ? (lang === "zh" ? "暂无符合条件的记录。" : "No events match these filters.")
                                  : feedDelayed && marketOpenNow
                                  ? (lang === "zh" ? "源数据快照暂未刷新。" : "The source snapshot isn’t updating right now.")
                                  : feedDelayed
                                  ? (lang === "zh" ? "市场休市 — 显示上一交易时段。" : "Market closed — showing the last session.")
                                  : (lang === "zh" ? "本时段暂无异常期权流。" : "No unusual options flow yet this session.")}
                              </div>
                              {/* Why: every empty tape states which of filters / stalled feed /
                                  closed market / quiet session is responsible. */}
                              <div className="fin-empty-why" style={{ margin: "6px auto 0" }}>
                                {rawTapeCount > 0
                                  ? (lang === "zh"
                                      ? `本时段共 ${rawTapeCount.toLocaleString("en-US")} 笔 — 请放宽或重置筛选条件。`
                                      : `${rawTapeCount.toLocaleString("en-US")} prints in this session’s tape — loosen a filter or reset.`)
                                  : feedDelayed && marketOpenNow
                                  ? (lang === "zh"
                                      ? `最近更新 ${activeUpdatedLabel}。`
                                      : `Last update ${activeUpdatedLabel}.`)
                                  : feedDelayed
                                  ? (lang === "zh" ? "显示上一完整交易时段。" : "Showing the last completed session.")
                                  : (lang === "zh"
                                      ? "最新源数据快照暂时清淡 — 达标大单进入后显示。"
                                      : "The latest source snapshot is quiet — qualifying prints appear when published.")}
                              </div>
                            </td>
                          </tr>
                        )}
                        {tapeRows.map((e) => {
                          const isBuy = e.side === "~buy"; const isSell = e.side === "~sell";
                          return (
                            <tr key={e.id} style={{ cursor: "pointer" }} onClick={() => setDrillTicker((d) => (d === e.root ? null : e.root))}>
                              <td style={{ textAlign: "left", fontVariantNumeric: "tabular-nums", color: "var(--text-dim)" }}>{fmtTime(e.ts)}</td>
                              <td style={{ textAlign: "left", fontWeight: 600 }}>{e.root}</td>
                              <td style={{ textAlign: "left", color: "var(--text-2)", fontSize: 11 }}>
                                {lang === "zh" ? e.group_zh : abbrevSector(e.group)}
                              </td>
                              <td>
                                <span className={isBuy ? "pill buy" : isSell ? "pill sell" : ""} style={!isBuy && !isSell ? { color: "var(--muted)", fontSize: 11 } : {}}>
                                  {e.side}
                                </span>
                              </td>
                              <td>
                                <span style={{ color: e.right === "C" ? "var(--up)" : "var(--down)", fontWeight: 700 }}>{e.right}</span>
                              </td>
                              <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-2)" }}>{fmtContract(e.right, e.exp, e.strike)}</td>
                              <td>
                                <span className="flow-dte-chip">
                                  {lang === "zh" ? DTE_BUCKETS.find((b) => b.key === e.dte_bucket)?.zh ?? e.dte_bucket : DTE_BUCKETS.find((b) => b.key === e.dte_bucket)?.en ?? e.dte_bucket}
                                </span>
                              </td>
                              <td>
                                <span className="flow-mny-chip">
                                  {lang === "zh" ? MNY_BUCKETS.find((b) => b.key === e.mny_bucket)?.zh ?? e.mny_bucket : MNY_BUCKETS.find((b) => b.key === e.mny_bucket)?.en ?? e.mny_bucket}
                                </span>
                              </td>
                              <td style={{ fontVariantNumeric: "tabular-nums" }}>{e.size.toLocaleString("en-US")}</td>
                              <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtPremium(e.premium)}</td>
                              <td>
                                <span style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap", alignItems: "flex-start" }}>
                                  {e.zerodte && <span className="flow-flag-chip">{lang === "zh" ? "当日" : "0DTE"}</span>}
                                  {e.vol_gt_oi && <span className="flow-flag-chip is-long">{volAboveOi(lang)}</span>}
                                  {e.repeated && <span className="flow-flag-chip">{lang === "zh" ? "重复" : "repeat"}</span>}
                                  {e.swept && <span className="flow-flag-chip" style={{ color: "var(--warn)", borderColor: "color-mix(in srgb, var(--warn) 40%, transparent)" }}>{lang === "zh" ? "扫单" : "swept"}</span>}
                                  {oiConfSet.has(`${e.root}|${e.right}|${e.exp}|${e.strike}`) && (
                                    <span className="flow-flag-chip" style={{ color: "var(--brand-2)", borderColor: "color-mix(in srgb, var(--brand) 35%, transparent)" }}>{t("tapeOiConfirmed", "OI-confirmed")}</span>
                                  )}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                        {events.length > tapeLimit && (
                          <tr ref={tapeSentinelRef}>
                            <td colSpan={10} style={{ textAlign: "center", padding: "8px", color: "var(--muted)", fontSize: 11 }}>
                              {lang === "zh" ? `显示 ${tapeLimit} / ${events.length} 条 · 向下滚动加载更多` : `showing ${tapeLimit} of ${events.length} · scroll for more`}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Unusual names rail */}
                {unusualNames.length > 0 && (
                  <div className="flow-unusual-rail">
                    <div className="flow-unusual-heading">
                      <span>{lang === "zh" ? "活跃度领先" : "Activity Leaders"}</span>
                      <small>{lang === "zh" ? "对比过去一年" : "vs the past trading year"}</small>
                    </div>
                    {unusualNames.map((u) => (
                      <button
                        key={u.root}
                        className={`flow-unusual-row${drillTicker === u.root ? " on" : ""}`}
                        onClick={() => setDrillTicker((d) => (d === u.root ? null : u.root))}
                      >
                        <span className="flow-unusual-symbol">{u.root}</span>
                        <span className="flow-unusual-group">{lang === "zh" ? u.group_zh : u.group}</span>
                        <div className="flow-unusual-meta">
                          <span className="num">{fmtPremium(u.gross_premium_today)}</span>
                          <span className="flow-unusual-band">{activityBand(u.prem_z, lang)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Provenance — the tape says what it is, where it came from and when it was cut. */}
              <div className="obs-asof" style={{ padding: "6px 14px", borderTop: "1px solid var(--line)", flex: "none" }}>
                {!activeUnavailable && !activeDelayed && activeAsof && <span className="obs-live-dot" />}
                <span>
                  {lang === "zh"
                    ? `期权逐笔 · 方向为启发式推断（~） · ${activeUpdatedLabel || "等待首个快照"}`
                    : `Options tape · direction ~inferred · ${activeUpdatedLabel || "awaiting first snapshot"}`}
                </span>
                {rawTapeCount > 0 && (
                  <span className="num" style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
                    {lang === "zh"
                      ? `${events.length.toLocaleString("en-US")} / ${rawTapeCount.toLocaleString("en-US")} 笔`
                      : `${events.length.toLocaleString("en-US")} of ${rawTapeCount.toLocaleString("en-US")} prints`}
                  </span>
                )}
              </div>
            </>
          )}

          {/* ═══ R5 DERIVED FLOW BOARDS ════════════════════════════════════
              Both panes consume the same immutable live_flow.feed/v1 snapshot.
              The only mode difference is the publisher-owned `zerodte` predicate;
              ordering and receipts stay descriptive/display-only. */}
          {(activeTab === "zero_dte" || activeTab === "largest") && (
            <OptionsFlowBoardView
              mode={activeTab === "zero_dte" ? "zero_dte" : "largest"}
              lang={lang}
              events={feed?.events ?? null}
              feedSchema={feed?.schema}
              feedAsof={feed?.asof}
              sessionDate={feed?.session_date}
              stale={Boolean(dataStale)}
              unavailable={Boolean(fetchError && !feed)}
              onOpenTicker={(root) => {
                switchTab("tickers");
                setSelectedTicker(root);
              }}
            />
          )}

          {/* ═══ TIDE TAB ═══════════════════════════════════════════════════ */}
          {activeTab === "tide" && (
            <div style={{ flex: 1, overflow: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Honest wait-state: a tide stream that ERRORED used to sit on "Loading…"
                  forever. Say which of unreachable-stream / still-loading it is. */}
              {tideLoading && !tideData && (
                tideUnavailable ? (
                  <div className="fin-empty fin-empty-lg" role="status">
                    <div className="fin-empty-title">
                      {lang === "zh" ? "市场潮汐不可用。" : "Market tide unavailable."}
                    </div>
                    <div className="fin-empty-why">
                      {lang === "zh"
                        ? "无法连接盘中潮汐数据流，本时段尚无缓存序列。"
                        : "Can’t reach the intraday tide stream, and no series is cached for this session yet."}
                    </div>
                  </div>
                ) : (
                  <div className="fin-empty" role="status">{t("loading", "Loading…")}</div>
                )
              )}
              {tideData && (
                <>
                  {/* Hero chart header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 650, fontSize: 14 }}>{t("tideTitle", "Market Tide")}</span>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-2)", marginLeft: 8 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ display: "inline-block", width: 14, height: 3, background: "var(--up)", borderRadius: 2 }} />
                        {lang === "zh" ? "净认购保费（~累计）" : "NCP (~cumulative)"}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ display: "inline-block", width: 14, height: 3, background: "var(--down)", borderRadius: 2 }} />
                        {lang === "zh" ? "净认沽保费（~累计）" : "NPP (~cumulative)"}
                      </span>
                      {tideData.spy.length > 0 && (
                        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ display: "inline-block", width: 14, height: 3, background: "var(--warn)", borderRadius: 2 }} />
                          SPY
                        </span>
                      )}
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                      {/* Tide | Session sub-view toggle (quanted Wave 1) */}
                      <div className="obs-pillnav" role="group" aria-label={lang === "zh" ? "资金潮视图" : "Tide view"} style={{ padding: 2 }}>
                        <button
                          className={`obs-pillnav-tab${tideView === "tide" ? " on" : ""}`}
                          onClick={() => setTideView("tide")}
                        >
                          {t("tabTide", "Tide")}
                        </button>
                        <button
                          className={`obs-pillnav-tab${tideView === "session" ? " on" : ""}`}
                          onClick={() => setTideView("session")}
                        >
                          {lang === "zh" ? "盘中" : "Session"}
                        </button>
                      </div>
                      <TideTutorialButton lang={lang} />
                    </div>
                  </div>

                  {/* Main tide chart — explicit height so LWC canvas isn't clipped.
                      Session view swaps in the quanted-style Session Flow pane. */}
                  {tideView === "tide" ? (
                    <div data-tut="tide-chart" className="obs-card" style={{ padding: "12px 4px 4px", height: 240, boxSizing: "border-box" }}>
                      <TideChart minutes={tideData.minutes} spy={tideData.spy} height={TIDE_CHART_H} sessionDate={tideData.session_date} />
                    </div>
                  ) : (
                    <div className="obs-card" style={{ padding: "12px 12px 8px" }}>
                      <SessionFlowPane minutes={tideData.minutes} sessionDate={tideData.session_date} height={240} />
                    </div>
                  )}

                  {/* Provenance for the hero series */}
                  <div className="obs-asof" style={{ marginTop: -12 }}>
                    {!tideDelayed && !tideUnavailable && tideAsof && <span className="obs-live-dot" />}
                    <span>
                      {lang === "zh"
                        ? `盘中净权利金潮汐 · 逐分钟累计（方向为启发式推断 ~） · ${activeUpdatedLabel || "等待首个快照"}`
                        : `Intraday net-premium tide · per-minute cumulative (direction ~inferred) · ${activeUpdatedLabel || "awaiting first snapshot"}`}
                    </span>
                  </div>

                  {/* Sector tide grid */}
                  <div data-tut="tide-sector">
                    <div className="obs-lbl" style={{ marginBottom: 10 }}>{t("tideSectorTitle", "Sector Tide")}</div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                        gap: 10,
                      }}
                    >
                      {tideData.sectors.map((s) => {
                        const ncpVals = s.minutes.map((m) => m.ncp / 1_000_000);
                        const net = s.ncp + s.npp;
                        const toneUp = net > 0; const toneDown = net < 0;
                        const color = toneUp ? "var(--up)" : toneDown ? "var(--down)" : "var(--muted)";
                        return (
                          <button
                            key={s.group}
                            className="obs-card"
                            onClick={() => { switchTab("tape"); setGroupFilter(s.group); }}
                            style={{ padding: "10px 12px", textAlign: "left", cursor: "pointer" }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                              <span style={{ fontWeight: 600, fontSize: 12 }}>
                                {lang === "zh" ? s.group_zh : abbrevSector(s.group)}
                              </span>
                              <span className="num" style={{ marginLeft: "auto", color, fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                                {fmtPremSigned(net)}
                              </span>
                            </div>
                            <Sparkline data={ncpVals} color={color} width={120} height={28} />
                            {/* ETF flow chip from ctx — d1 creation/redemption proxy (keyed by the
                                sector's ETF ticker, not the GICS name; d1 is in $millions) */}
                            {ctxData?.sector_etf_flows && SECTOR_ETF[s.group] && ctxData.sector_etf_flows[SECTOR_ETF[s.group]] != null && (() => {
                              const fl = ctxData.sector_etf_flows![SECTOR_ETF[s.group]];
                              const pos = fl.d1 >= 0;
                              return (
                                <div style={{ fontSize: 10, color: pos ? "var(--up)" : "var(--down)", marginTop: 3, display: "flex", alignItems: "center", gap: 3 }}>
                                  <span style={{ color: "var(--text-dim)" }}>{t("tideEtfFlowProxy", "proxy")}</span>
                                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                                    {fmtPremSigned(fl.d1 * 1_000_000)}
                                  </span>
                                </div>
                              );
                            })()}
                            <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
                              {lang === "zh" ? "点击筛选逐笔" : "click to filter Tape"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Top net impact */}
                  <div data-tut="tide-impact">
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                      <span className="obs-lbl">{t("tideImpactTitle", "Top Net Impact")}</span>
                      {/* Legend — resolves the "why is the #1 name red?" confusion (semantic, honors theme up/down swap) */}
                      <span style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "var(--muted)" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ display: "inline-block", width: 12, height: 8, borderRadius: 2, background: "var(--up)" }} />
                          {lang === "zh" ? "净认购 · 偏多" : "net call · bullish"}
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ display: "inline-block", width: 12, height: 8, borderRadius: 2, background: "var(--down)" }} />
                          {lang === "zh" ? "净认沽 · 偏空" : "net put · bearish"}
                        </span>
                        <span style={{ color: "var(--text-dim)" }}>
                          {lang === "zh" ? "条形长度 = 净方向权利金规模" : "bar length = size of net directional premium"}
                        </span>
                      </span>
                    </div>
                    <div className="obs-card" style={{ overflow: "hidden" }}>
                      {(() => {
                        // Hoisted once — bar scale is the max |net_prem_soft| across the set.
                        const maxNet = Math.max(...tideData.top_net_impact.map((x) => Math.abs(x.net_prem_soft)), 1);
                        return tideData.top_net_impact.slice(0, 20).map((item, i) => {
                        const barW = Math.round((Math.abs(item.net_prem_soft) / maxNet) * 100);
                        const isPos = item.net_prem_soft >= 0;
                        return (
                          <div
                            key={item.root}
                            style={{
                              display: "grid", gridTemplateColumns: "60px 1fr 80px 80px",
                              gap: 10, alignItems: "center",
                              padding: "8px 14px", borderBottom: i < 19 ? "1px solid var(--line-2)" : "none",
                              fontSize: 12,
                            }}
                          >
                            <span style={{ fontWeight: 700 }}>{item.root}</span>
                            <div style={{ height: 8, borderRadius: 999, background: "var(--panel-3)", overflow: "hidden" }}>
                              <div
                                style={{
                                  height: "100%", width: `${barW}%`,
                                  background: isPos
                                    ? "color-mix(in srgb, var(--up) 50%, transparent)"
                                    : "color-mix(in srgb, var(--down) 45%, transparent)",
                                  borderRadius: 999,
                                }}
                              />
                            </div>
                            <span style={{ textAlign: "right", color: isPos ? "var(--up)" : "var(--down)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                              {fmtPremSigned(item.net_prem_soft)}
                            </span>
                            <span style={{ textAlign: "right", color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>
                              {fmtPremium(item.gross)}
                            </span>
                          </div>
                        );
                        });
                      })()}
                    </div>
                  </div>

                  {/* DTE Tide */}
                  {dteTide && (
                    <div data-tut="tide-dte">
                      <div className="obs-lbl" style={{ marginBottom: 10 }}>{t("tideDteTitle", "DTE Buckets")}</div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                          gap: 10,
                        }}
                      >
                        {(Object.keys(DTE_LABELS) as DteBucket[]).map((bk) => {
                          const mins = dteTide.buckets[bk] ?? [];
                          const vals = mins.map((m) => (m.ncp + m.npp) / 1_000_000);
                          const last = vals[vals.length - 1] ?? 0;
                          const color = last > 0 ? "var(--up)" : last < 0 ? "var(--down)" : "var(--muted)";
                          const lbl = lang === "zh" ? DTE_LABELS[bk].zh : DTE_LABELS[bk].en;
                          return (
                            <div key={bk} className="obs-card" style={{ padding: "10px 12px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                <span style={{ fontWeight: 600, fontSize: 12 }}>{lbl}</span>
                                <span className="num" style={{ color, fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                                  {fmtPremSigned(last * 1_000_000)}
                                </span>
                              </div>
                              <Sparkline data={vals} color={color} width={120} height={28} />
                            </div>
                          );
                        })}
                      </div>
                      {/* DTE tide is its own cut — say so rather than inherit the hero clock. */}
                      <div className="obs-asof">
                        {lang === "zh"
                          ? `按到期分桶的净权利金 · 截至 ${fmtAsof(dteTide.asof)} ET`
                          : `Net premium by DTE bucket · as of ${fmtAsof(dteTide.asof)} ET`}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ═══ TICKERS TAB ════════════════════════════════════════════════
               Merged layout: ticker search sidebar + main area split:
                 LEFT col: intraday flow (minute chart + top contracts list)
                 RIGHT col: strike ladder (full width of column) + vol surface below
               The standalone "Vol" tab is removed from the tab bar; its content
               lives here to surface IV surface in the same per-ticker context.
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === "tickers" && (
            <div style={{ flex: 1, overflow: "hidden", display: "flex", minHeight: 0 }}>
              {/* Left sidebar — ticker search + candidate list */}
              <div
                style={{
                  width: 180, flexShrink: 0, borderRight: "1px solid var(--line)",
                  display: "flex", flexDirection: "column", minHeight: 0,
                }}
              >
                <div style={{ padding: "10px 10px 8px" }}>
                  <input
                    type="text"
                    placeholder={lang === "zh" ? "搜索代码…" : "Search ticker…"}
                    value={tickerSearch}
                    onChange={(e) => setTickerSearch(e.target.value)}
                    style={{
                      width: "100%", height: 30, padding: "0 10px",
                      borderRadius: "var(--r-md)", background: "var(--inset)",
                      border: "1px solid var(--line)", color: "var(--text)",
                      font: "13px var(--font-ui)",
                    }}
                  />
                </div>
                <div style={{ flex: 1, overflow: "auto" }}>
                  {filteredCandidates.map((root) => {
                    const imp = tideData?.top_net_impact.find((x) => x.root === root);
                    const isPos = imp ? imp.net_prem_soft > 0 : null;
                    return (
                      <button
                        key={root}
                        onClick={() => { if (tickerSearch.trim()) trackSearch(root, "flow-tickers", tickerSearch.trim()); setSelectedTicker(root); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          width: "100%", padding: "8px 12px", textAlign: "left",
                          fontSize: 13, fontWeight: selectedTicker === root ? 700 : 400,
                          color: selectedTicker === root ? "var(--text)" : "var(--text-2)",
                          background: selectedTicker === root ? "color-mix(in srgb, var(--brand) 10%, transparent)" : "none",
                          borderRadius: "var(--r)", cursor: "pointer",
                          transition: "background var(--t)",
                        }}
                        onMouseEnter={(e) => { if (selectedTicker !== root) e.currentTarget.style.background = "var(--panel-2)"; }}
                        onMouseLeave={(e) => { if (selectedTicker !== root) e.currentTarget.style.background = "none"; }}
                      >
                        {root}
                        {imp && (
                          <span style={{ marginLeft: "auto", fontSize: 11, color: isPos ? "var(--up)" : "var(--down)", fontVariantNumeric: "tabular-nums" }}>
                            {fmtPremSigned(imp.net_prem_soft)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {filteredCandidates.length === 0 && (
                    <div style={{ padding: "20px 12px" }}>
                      <div className="fin-empty-title" style={{ fontSize: 12 }}>
                        {lang === "zh" ? "无结果" : "No results"}
                      </div>
                      {/* Why: the list is session-scoped, not a universe search. */}
                      <div className="fin-empty-why" style={{ marginTop: 5 }}>
                        {tickerCandidates.length === 0
                          ? (lang === "zh"
                              ? "本时段尚无带期权流的标的。"
                              : "No names have carried options flow this session yet.")
                          : (lang === "zh"
                              ? `仅列出本时段有期权流的 ${tickerCandidates.length} 个标的。`
                              : `Only the ${tickerCandidates.length} names with flow this session are listed.`)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Main area — fills remaining width */}
              <div style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
                {!selectedTicker && (
                  <div style={{ padding: "24px 16px" }}>
                    <div className="fin-empty fin-empty-lg">
                      <div className="fin-empty-title">
                        {t("tickersSelectPrompt", "Select a ticker from the list or search above")}
                      </div>
                      <div className="fin-empty-why">
                        {lang === "zh"
                          ? "左侧按今日净权利金影响排序，仅列出本时段有期权流的标的。"
                          : "The list is ranked by today’s net premium impact, and only names with flow this session appear."}
                      </div>
                    </div>
                  </div>
                )}
                {selectedTicker && (tickerLoading && !tickerData) && (
                  <div className="fin-empty" role="status">{t("loading", "Loading…")}</div>
                )}
                {selectedTicker && !tickerLoading && !tickerData && (
                  <div style={{ padding: "24px 16px" }}>
                    <div className="fin-empty fin-empty-lg" role="status">
                      <div className="fin-empty-title">
                        {t("tickersNoData", "No flow data for this ticker yet")}
                      </div>
                      {/* Why: quiet name vs closed market — both derivable from state already here. */}
                      <div className="fin-empty-why">
                        {marketOpenNow
                          ? (lang === "zh"
                              ? `${selectedTicker} 本时段暂无达标的期权成交；一旦出现即会显示。`
                              : `${selectedTicker} has no qualifying options prints this session — the drill fills in as they cross.`)
                          : (lang === "zh"
                              ? `市场休市 — ${selectedTicker} 在上一交易时段没有达标的期权成交。`
                              : `Market closed — ${selectedTicker} carried no qualifying options prints in the last session.`)}
                      </div>
                    </div>
                  </div>
                )}
                {selectedTicker && tickerData && (
                  <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>

                    {/* ── Header: ticker + spot ref + IV chips ── */}
                    <div style={{
                      display: "flex", alignItems: "center", flexWrap: "wrap", gap: 14,
                      borderBottom: "1px solid var(--line)", paddingBottom: 12,
                    }}>
                      <div>
                        <div className="obs-lbl">
                          {lang === "zh" ? tickerData.group_zh : abbrevSector(tickerData.group)}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1, marginTop: 5 }}>{tickerData.root}</div>
                      </div>
                      {/* Flow stats chips */}
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {[
                          { lk: "tickersDayGross", lb: "Day Gross", v: fmtPremium(tickerData.day.gross) },
                          { lk: "tickersNetSoft", lb: "Net", v: fmtPremSigned(tickerData.day.net_soft), color: tickerData.day.net_soft >= 0 ? "var(--up)" : "var(--down)" },
                          { lk: "tickersCallShare", lb: "Call%", v: `${(tickerData.day.call_share * 100).toFixed(1)}%`, color: tickerData.day.call_share > 0.5 ? "var(--up)" : "var(--down)" },
                          { lk: "tickersPremZ", lb: "Activity", v: activityBand(tickerData.day.prem_z, lang) },
                        ].map((kv) => (
                          <div key={kv.lk} style={{ border: "1px solid var(--line)", borderRadius: "var(--r-tile)", padding: "5px 10px", background: "var(--panel)" }}>
                            <div className="obs-lbl">{t(kv.lk, kv.lb)}</div>
                            <div className="num" style={{ fontWeight: 650, fontSize: 13, marginTop: 4, color: (kv as any).color ?? "var(--text)", fontVariantNumeric: "tabular-nums" }}>{kv.v}</div>
                          </div>
                        ))}
                        {/* IV30 and IV rank chips from vol data */}
                        {volData && volData.root === selectedTicker && (
                          <>
                            <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-tile)", padding: "5px 10px", background: "var(--panel)" }}>
                              <div className="obs-lbl">{t("tickersAtmIv", "ATM IV")}</div>
                              <div className="num" style={{ fontWeight: 650, fontSize: 13, marginTop: 4, color: volData.atm_iv == null ? "var(--text-dim)" : "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                                {volData.atm_iv != null ? `${volData.atm_iv.toFixed(1)}%` : (lang === "zh" ? "积累中" : "—")}
                              </div>
                            </div>
                            <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-tile)", padding: "5px 10px", background: "var(--panel)" }}>
                              <div className="obs-lbl">{t("tickersIvRank", "IV Rank")}</div>
                              <div className="num" style={{ fontWeight: 650, fontSize: 13, marginTop: 4, fontVariantNumeric: "tabular-nums",
                                color: volData.iv_rank_252 == null ? "var(--text-dim)"
                                  : volData.iv_rank_252 > 75 ? "var(--down)"
                                  : volData.iv_rank_252 > 50 ? "var(--warn)" : "var(--up)" }}>
                                {volData.iv_rank_252 != null ? volData.iv_rank_252.toFixed(0) : (lang === "zh" ? "积累中" : "—")}
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Ticker context compared with its recent one-year norm */}
                      {tctxData && (() => {
                        const histN = tctxData.history_n ?? 0;
                        const minN = 20;
                        const warming = histN < minN;
                        const chips: { labelKey: string; label: string; zKey: keyof NonNullable<TctxPayload["z"]> }[] = [
                          { labelKey: "tctxNetPremZ", label: "Net activity", zKey: "net_signed_premium_z252" },
                          { labelKey: "tctxVolGtOiShare", label: "New-position activity", zKey: "vol_gt_oi_share_z252" },
                        ];
                        return chips.map((c) => {
                          const zVal = tctxData.z?.[c.zKey];
                          return (
                            <div key={c.zKey} style={{ border: "1px solid var(--line)", borderRadius: "var(--r-tile)", padding: "5px 10px", background: "var(--panel)" }}>
                              <div className="obs-lbl">{t(c.labelKey, c.label)}</div>
                              <div className="num" style={{ fontSize: 13, fontWeight: 650, marginTop: 4, fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>
                                {warming || zVal == null
                                  ? <span style={{ fontSize: 10, color: "var(--text-dim)" }}>—</span>
                                  : activityBand(zVal, lang)}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>

                    {/* Provenance — the drill fuses a live intraday cut with a nightly vol build. */}
                    <div className="obs-asof" style={{ marginTop: -6 }}>
                      {!activeUnavailable && !activeDelayed && <span className="obs-live-dot" />}
                      <span>
                        {lang === "zh"
                          ? `盘中期权流 · 截至 ${fmtAsof(tickerData.asof)} ET`
                          : `Intraday options flow · as of ${fmtAsof(tickerData.asof)} ET`}
                        {volData && volData.root === selectedTicker && (lang === "zh"
                          ? ` · 波动率面为夜间构建（${volData.asof.slice(0, 10)}）`
                          : ` · vol surface from the nightly build (${volData.asof.slice(0, 10)})`)}
                      </span>
                    </div>

                    {/* ── Two-column body ── */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 16,
                      alignItems: "start",
                    }}>

                      {/* LEFT: intraday flow */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div className="obs-lbl" style={{ color: "var(--text-2)" }}>
                          {t("tickersIntraday", "Intraday Flow")}
                        </div>

                        {/* Minute net-premium chart */}
                        <div className="obs-card" style={{ padding: "12px 13px" }}>
                          <div className="obs-lbl" style={{ marginBottom: 8 }}>
                            {t("tickersMinChart", "Minute Net Prem")}
                          </div>
                          <MinuteNetChart minutes={tickerData.minutes} height={160} />
                        </div>

                        {/* Top contracts list */}
                        {tickerData.top_contracts.length > 0 && (
                          <div className="obs-card" style={{ overflow: "hidden" }}>
                            <div className="obs-lbl" style={{ padding: "11px 13px 9px", borderBottom: "1px solid var(--line)" }}>
                              {t("tickersTopContracts", "Top Contracts")}
                            </div>
                            <table className="scr" style={{ fontSize: 11 }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: "left" }}>{t("colCP", "C/P")}</th>
                                  <th style={{ textAlign: "left" }}>{lang === "zh" ? "到期日" : "Exp"}</th>
                                  <th>{lang === "zh" ? "行权价" : "Strike"}</th>
                                  <th>{t("colPrem", "Prem")}</th>
                                  <th>{lang === "zh" ? "数量" : "Vol"}</th>
                                  <th>{lang === "zh" ? "标记" : "Flags"}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tickerData.top_contracts.map((c, i) => (
                                  <tr key={i}>
                                    <td style={{ textAlign: "left" }}>
                                      <span style={{ color: c.right === "C" ? "var(--up)" : "var(--down)", fontWeight: 700 }}>{c.right}</span>
                                    </td>
                                    <td style={{ textAlign: "left", fontVariantNumeric: "tabular-nums", color: "var(--text-2)" }}>{c.exp.slice(5)}</td>
                                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{c.strike}</td>
                                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtPremium(c.premium)}</td>
                                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{c.vol.toLocaleString("en-US")}</td>
                                    <td>
                                      {c.vol_gt_oi && (
                                        <span className="flow-flag-chip">{lang === "zh" ? "量超持仓" : "vol>OI"}</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Expiry bars */}
                        {tickerData.expiries.length > 0 && (
                          <div className="obs-card" style={{ padding: "12px 13px" }}>
                            <div className="obs-lbl" style={{ marginBottom: 8 }}>
                              {t("tickersExpBars", "By Expiry")}
                            </div>
                            <ExpiryBars expiries={tickerData.expiries} lang={lang} />
                          </div>
                        )}
                      </div>

                      {/* RIGHT: strike ladder + vol surface below */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div className="obs-lbl" style={{ color: "var(--text-2)" }}>
                          {t("tickersStrikeLadder", "Strike Ladder")} · {t("tickersIvSurface", "Vol Surface")}
                        </div>

                        {/* Strike ladder — fills full column width */}
                        {tickerData.strikes.length > 0 && (
                          <div className="obs-card" style={{ padding: "12px 13px" }}>
                            <StrikeLadder
                              strikes={tickerData.strikes}
                              lang={lang}
                              spotRef={volData && volData.root === selectedTicker ? (volData.spot_ref ?? null) : null}
                            />
                          </div>
                        )}

                        {/* Vol surface: IV rank sparkline + term structure + skew */}
                        {volData && volData.root === selectedTicker && !volLoading && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                            {/* IV rank history sparkline */}
                            {volData.history.length >= 2 && (
                              <div className="obs-card" style={{ padding: "12px 13px" }}>
                                <div className="obs-lbl" style={{ marginBottom: 8 }}>
                                  {t("tickersIvRankHistory", "IV Rank History")}
                                </div>
                                <IvRankHistory history={volData.history} />
                              </div>
                            )}

                            {/* Term structure */}
                            {volData.term.length >= 2 && (
                              <div className="obs-card" style={{ padding: "12px 13px" }}>
                                <div className="obs-lbl" style={{ marginBottom: 8 }}>
                                  {t("volTermTitle", "Term Structure")}
                                </div>
                                <TermStructureChart term={volData.term} />
                              </div>
                            )}

                            {/* Skew (first two expiries) */}
                            {volData.smile.length > 0 && (
                              <div className="obs-card" style={{ padding: "12px 13px" }}>
                                <div className="obs-lbl" style={{ marginBottom: 8 }}>
                                  {t("volSmileTitle", "Volatility Smile")}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                  {volData.smile.slice(0, 2).map((se) => (
                                    <div key={se.exp}>
                                      <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                                        {lang === "zh" ? "到期：" : "Exp: "}{se.exp}
                                      </div>
                                      <SmileChart points={se.points} spotRef={volData.spot_ref ?? null} />
                                    </div>
                                  ))}
                                </div>
                                <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 6, display: "flex", gap: 14 }}>
                                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <span style={{ display: "inline-block", width: 10, height: 2, background: "var(--up)" }} />
                                    {lang === "zh" ? "认购IV" : "Call IV"}
                                  </span>
                                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <span style={{ display: "inline-block", width: 10, height: 2, borderBottom: "1px dashed var(--down)" }} />
                                    {lang === "zh" ? "认沽IV" : "Put IV"}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {volLoading && (
                          <div style={{ color: "var(--muted)", fontSize: 12, padding: "12px 0" }}>
                            {lang === "zh" ? "波动率数据加载中…" : "Loading vol surface…"}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ SCREENER TAB ═══════════════════════════════════════════════
               Ranked insight views over data already fetched.
               Preset chips each render a sortable table; no new endpoints.
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === "screener" && (
            /* Screener shell: a fixed filter head over ONE internal scroller.
               `minHeight:0` is load-bearing here — a flex item defaults to
               `min-height:auto`, so without it this column refuses to shrink,
               `overflow` never engages, and a long preset table simply ran off the
               bottom of the tab with no way to scroll to it. */
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>

              {/* ── Filter head — presets + belt + provenance stay put while the
                     results below them scroll. The `maxHeight` cap is the mobile
                     guard: on a phone the chip rows wrap several lines deep, and an
                     uncapped pinned head would swallow the results region. At desktop
                     sizes the head is ~110px, so the cap never engages. ── */}
              {(feed || oiData || hotData) && (
              <div style={{
                flexShrink: 0, display: "flex", flexDirection: "column", gap: 16,
                padding: "14px 18px 12px", borderBottom: "1px solid var(--line)",
                maxHeight: "40svh", overflowY: "auto", overscrollBehavior: "contain",
              }}>

              {/* Preset view chip bar */}
              {(feed || oiData || hotData) && (() => {
                type PresetDef = { key: ScreenerPreset; en: string; zh: string; needsFeed?: boolean; needsOi?: boolean; needsHot?: boolean };
                const PRESET_DEFS: PresetDef[] = [
                  { key: "top_prem",  en: "Top Premium",       zh: "保费最大",     needsFeed: true },
                  { key: "unusual_z", en: "Unusual Activity",   zh: "异常活跃",     needsFeed: true },
                  { key: "fresh",     en: "Fresh Positioning",  zh: "新建仓位",     needsFeed: true },
                  { key: "doi",       en: "ΔOI Builds",         zh: "持仓增长",     needsOi: true },
                  { key: "zerodte",   en: "0DTE Heavy",         zh: "高0DTE占比",   needsFeed: true },
                  { key: "hot",       en: "Hot Contracts",      zh: "热门合约",     needsHot: true },
                ];
                // Filter out chips whose data isn't available
                const available = PRESET_DEFS.filter((p) =>
                  (p.needsFeed && feed) || (p.needsOi && oiData) || (p.needsHot && hotData)
                );
                return (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {available.map((p) => (
                      <button
                        key={p.key}
                        className={`chip${screenerPreset === p.key ? " on" : ""}`}
                        style={{ height: 28, fontSize: 12 }}
                        onClick={() => {
                          setScreenerPreset(p.key);
                          setScrSortKey(""); setScrSortDir(-1);
                          // ΔOI / Hot rows have no group — drop a sector pick rather than
                          // leave it armed and invisible.
                          if (!["top_prem", "unusual_z", "fresh", "zerodte"].includes(p.key)) setScrGroup("");
                        }}
                      >
                        {lang === "zh" ? p.zh : p.en}
                      </button>
                    ))}
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)" }}>
                      {lang === "zh" ? "ETF品种覆盖，个股扩展中" : "ETF universe · single names expanding"}
                    </span>
                    <OptionsCsvExportButton
                      label={t("exportCsv")}
                      rowCount={activeScreenerRows.length}
                      buildDownload={buildScreenerCsvDownload}
                      exportId="screener-csv-v1"
                      exportContract={OPTIONS_SCREENER_EXPORT_SCHEMA}
                    />
                  </div>
                );
              })()}

              {/* Belt — index roots + sector groups, filtering the table below. */}
              {(feed || oiData || hotData) && (
                <div className="flow-heat-strip scr-belt">
                  <span className="belt-cap">{t("beltIndex")}</span>
                  {INDEX_ROOTS.map((r) => (
                    <button
                      key={r}
                      className={`chip${scrRoot === r ? " on" : ""}`}
                      style={{ height: 26, fontSize: 11 }}
                      aria-pressed={scrRoot === r}
                      onClick={() => setScrRoot((v) => (v === r ? "" : r))}
                    >
                      {r}
                    </button>
                  ))}
                  {scrHasGroups && heatGroups.length > 0 && (
                    <>
                      <span className="belt-div" aria-hidden="true" />
                      <span className="belt-cap">{t("beltSector")}</span>
                      {heatGroups.map((g) => (
                        <button
                          key={g.group}
                          className={`chip${scrGroup === g.group ? " on" : ""}`}
                          style={{ height: 26, fontSize: 11 }}
                          aria-pressed={scrGroup === g.group}
                          onClick={() => setScrGroup((v) => (v === g.group ? "" : g.group))}
                        >
                          {lang === "zh" ? g.group_zh : abbrevSector(g.group)}
                        </button>
                      ))}
                    </>
                  )}
                  {(scrRoot || scrGroup) && (
                    <button
                      className="chip"
                      style={{ height: 26, fontSize: 11, marginLeft: 4, color: "var(--muted)" }}
                      onClick={() => { setScrRoot(""); setScrGroup(""); }}
                      aria-label={t("clearFilter")}
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              {/* Source + as-of for the ACTIVE preset — intraday tape and nightly-close
                  views live side by side here, so the provenance has to say which. */}
              {(feed || oiData || hotData) && (() => {
                const nightly = screenerPreset === "doi" || screenerPreset === "hot";
                const stamp = nightly
                  ? (screenerPreset === "doi" ? oiData?.asof : hotData?.asof)
                  : feed?.asof;
                if (!stamp) return null;
                const cov = screenerPreset === "doi" ? oiData?.coverage : screenerPreset === "hot" ? hotData?.coverage : undefined;
                return (
                  <div className="obs-asof" style={{ marginTop: -8 }}>
                    {!nightly && !activeUnavailable && !activeDelayed && <span className="obs-live-dot" />}
                    <span>
                      {nightly
                        ? (lang === "zh"
                            ? `夜间收盘构建 · 截至 ${stamp.slice(0, 10)}${cov?.n_days ? ` · ${cov.n_days} 个交易日` : ""}`
                            : `Nightly close build · as of ${stamp.slice(0, 10)}${cov?.n_days ? ` · ${cov.n_days} sessions` : ""}`)
                        : (lang === "zh"
                            ? `盘中期权流 · 截至 ${fmtAsof(stamp)} ET`
                            : `Intraday options tape · as of ${fmtAsof(stamp)} ET`)}
                    </span>
                  </div>
                );
              })()}

              </div>
              )}

              {/* ── Results region — the ONLY scroller on this tab (obs-scroll idiom,
                     same thin thumb as the flow feed / GEX ladder / watchlist). The
                     preset tables keep their own horizontal `overflowX:auto` wrappers,
                     so the ≤640px nth-child column rules are untouched. ── */}
              <div className="obs-scroll" style={{
                flex: 1, minHeight: 0, overscrollBehavior: "contain",
                padding: "14px 18px", display: "flex", flexDirection: "column", gap: 16,
              }}>

              {screenerLoading && !oiData && !hotData && !feed && (
                <div className="fin-empty" role="status">{t("loading", "Loading…")}</div>
              )}
              {/* Both lanes empty AND not loading — say so instead of an empty page. */}
              {!screenerLoading && !oiData && !hotData && !feed && (
                <div className="fin-empty fin-empty-lg" role="status">
                  <div className="fin-empty-title">
                    {lang === "zh" ? "暂无可筛选的数据" : "Nothing to screen yet"}
                  </div>
                  <div className="fin-empty-why">
                    {lang === "zh"
                      ? "盘中期权流与夜间收盘构建当前均无法读取。"
                      : "Neither the intraday options tape nor the nightly close build could be read right now."}
                  </div>
                </div>
              )}

              {/* ── Top Premium view — unusual_names sorted by gross_premium_today ── */}
              {screenerPreset === "top_prem" && feed && (() => {
                const rows = topPremiumRows;
                const hdr = (key: string, en: string, zh: string, tip?: string) => (
                  <th
                    style={{ cursor: "pointer" }}
                    className={scrSortKey === key ? "sorted" : ""}
                    onClick={() => scrSort(key)}
                    title={tip}
                  >
                    {lang === "zh" ? zh : en}{scrSortKey === key ? (scrSortDir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                );
                return (
                  <div className="obs-card" style={{ overflow: "hidden" }}>
                    <div className="obs-card-hd" style={{ borderBottom: "1px solid var(--line)" }}>
                      <span className="obs-lbl">{lang === "zh" ? "保费最大（今日）" : "Top Premium — Today"}</span>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="scr" style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left" }}>{lang === "zh" ? "代码" : "Ticker"}</th>
                            <th style={{ textAlign: "left" }}>{t("screenerColSector", "Sector")}</th>
                            {hdr("gross", "Gross Prem", "总保费", "Total premium across all flow events today")}
                            {hdr("z", "Activity", "活跃度", "Premium activity compared with roughly one trading year")}
                            {hdr("call_share", "Call%", "认购占比", "Call premium share of total")}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((u) => (
                            <tr key={u.root}
                              style={{ cursor: "pointer" }}
                              onClick={() => { switchTab("tickers"); setSelectedTicker(u.root); }}
                            >
                              <td style={{ textAlign: "left", fontWeight: 700 }}>{u.root}</td>
                              <td style={{ textAlign: "left", color: "var(--text-2)", fontSize: 11 }}>
                                {lang === "zh" ? u.group_zh : abbrevSector(u.group)}
                              </td>
                              <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtPremium(u.gross_premium_today)}</td>
                              <td style={{ color: u.prem_z != null && Math.abs(u.prem_z) > 2 ? "var(--warn)" : "var(--text)" }}>
                                {activityBand(u.prem_z, lang)}
                              </td>
                              <td style={{ fontVariantNumeric: "tabular-nums", color: u.call_prem_share > 0.6 ? "var(--up)" : u.call_prem_share < 0.4 ? "var(--down)" : "var(--text)" }}>
                                {(u.call_prem_share * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                          {rows.length === 0 &&
                            scrEmptyRow(5, "No data yet this session", "本时段暂无数据", (feed.unusual_names ?? []).length)}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ padding: "6px 14px", fontSize: 10, color: "var(--text-dim)", borderTop: "1px solid var(--line)" }}>
                      {lang === "zh" ? "活跃度将今日权利金与约一年的交易历史比较。点击行查看详情。" : "Activity compares today’s premium with roughly one trading year. Click a row for details."}
                    </div>
                  </div>
                );
              })()}

              {/* ── Unusual (z) view — sorted by prem_z descending ── */}
              {screenerPreset === "unusual_z" && feed && (() => {
                const rows = unusualRows;
                const warming = (feed.unusual_names ?? []).filter((u) => u.prem_z == null);
                const hdr = (key: string, en: string, zh: string, tip?: string) => (
                  <th style={{ cursor: "pointer" }} className={scrSortKey === key ? "sorted" : ""} onClick={() => scrSort(key)} title={tip}>
                    {lang === "zh" ? zh : en}{scrSortKey === key ? (scrSortDir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                );
                return (
                  <div className="obs-card" style={{ overflow: "hidden" }}>
                    <div className="obs-card-hd" style={{ borderBottom: "1px solid var(--line)" }}>
                      <span className="obs-lbl">{lang === "zh" ? "异常活跃度" : "Unusual Activity"}</span>
                      {warming.length > 0 && (
                        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                          {lang === "zh" ? `${warming.length} 基线积累中（未显示）` : `${warming.length} warming baselines hidden`}
                        </span>
                      )}
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="scr" style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left" }}>{lang === "zh" ? "代码" : "Ticker"}</th>
                            <th style={{ textAlign: "left" }}>{t("screenerColSector", "Sector")}</th>
                            {hdr("z", "Activity", "活跃度", "Premium activity compared with roughly one trading year")}
                            {hdr("gross", "Gross", "总保费", "Total premium today")}
                            {hdr("call_share", "Call%", "认购占比")}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((u) => {
                            const absZ = Math.abs(u.prem_z ?? 0);
                            return (
                              <tr key={u.root} style={{ cursor: "pointer" }} onClick={() => { switchTab("tickers"); setSelectedTicker(u.root); }}>
                                <td style={{ textAlign: "left", fontWeight: 700 }}>{u.root}</td>
                                <td style={{ textAlign: "left", color: "var(--text-2)", fontSize: 11 }}>
                                  {lang === "zh" ? u.group_zh : abbrevSector(u.group)}
                                </td>
                                <td style={{
                                  fontWeight: absZ > 2 ? 700 : 400,
                                  color: absZ > 3 ? "var(--warn)" : absZ > 2 ? "var(--text)" : "var(--text-2)",
                                }}>
                                  {activityBand(u.prem_z, lang)}
                                </td>
                                <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtPremium(u.gross_premium_today)}</td>
                                <td style={{ fontVariantNumeric: "tabular-nums", color: u.call_prem_share > 0.6 ? "var(--up)" : u.call_prem_share < 0.4 ? "var(--down)" : "var(--text)" }}>
                                  {(u.call_prem_share * 100).toFixed(1)}%
                                </td>
                              </tr>
                            );
                          })}
                          {rows.length === 0 &&
                            scrEmptyRow(5, "Activity baseline is still building", "活跃度基线仍在积累",
                              (feed.unusual_names ?? []).filter((u) => u.prem_z != null).length)}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ padding: "6px 14px", fontSize: 10, color: "var(--text-dim)", borderTop: "1px solid var(--line)" }}>
                      {lang === "zh" ? "“很异常”和“极异常”表示今日活动明显高于一年常态。点击行查看详情。" : "Very unusual and Extreme mean today’s activity is well above its one-year norm. Click a row for details."}
                    </div>
                  </div>
                );
              })()}

              {/* ── Fresh Positioning view — unusual_names with vol>OI flow count ── */}
              {screenerPreset === "fresh" && feed && (() => {
                const rows = freshRows;
                const hdr = (key: string, en: string, zh: string, tip?: string) => (
                  <th style={{ cursor: "pointer" }} className={scrSortKey === key ? "sorted" : ""} onClick={() => scrSort(key)} title={tip}>
                    {lang === "zh" ? zh : en}{scrSortKey === key ? (scrSortDir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                );
                return (
                  <div className="obs-card" style={{ overflow: "hidden" }}>
                    <div className="obs-card-hd" style={{ borderBottom: "1px solid var(--line)" }}>
                      <span className="obs-lbl">{lang === "zh" ? "新建仓位（vol>OI 信号）" : "Fresh Positioning — vol > OI signals"}</span>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="scr" style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left" }}>{lang === "zh" ? "代码" : "Ticker"}</th>
                            <th style={{ textAlign: "left" }}>{t("screenerColSector", "Sector")}</th>
                            {hdr("n", "Fresh hits", "新开仓次数", "Number of vol>OI events today")}
                            {hdr("prem", "Prem", "保费", "Total premium on vol>OI events")}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.root} style={{ cursor: "pointer" }} onClick={() => { switchTab("tickers"); setSelectedTicker(r.root); }}>
                              <td style={{ textAlign: "left", fontWeight: 700 }}>{r.root}</td>
                              <td style={{ textAlign: "left", color: "var(--text-2)", fontSize: 11 }}>
                                {lang === "zh" ? r.group_zh : abbrevSector(r.group)}
                              </td>
                              <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.n}</td>
                              <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtPremium(r.prem)}</td>
                            </tr>
                          ))}
                          {rows.length === 0 &&
                            scrEmptyRow(4, "No vol>OI signals this session", "本时段暂无 vol>OI 信号",
                              (feed.events ?? []).filter((e) => e.vol_gt_oi).length)}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ padding: "6px 14px", fontSize: 10, color: "var(--text-dim)", borderTop: "1px solid var(--line)" }}>
                      {lang === "zh" ? "vol>OI 表示当日成交量超过昨日持仓，为新开仓信号（非确认）。" : "vol>OI means today's volume exceeds prior OI — a fresh-positioning signal (not confirmed)."}
                    </div>
                  </div>
                );
              })()}

              {/* ── ΔOI Builds view — oiData.movers ── */}
              {screenerPreset === "doi" && oiData && (() => {
                const rows = oiRows;
                const hdr = (key: string, en: string, zh: string, tip?: string) => (
                  <th style={{ cursor: "pointer" }} className={scrSortKey === key ? "sorted" : ""} onClick={() => scrSort(key)} title={tip}>
                    {lang === "zh" ? zh : en}{scrSortKey === key ? (scrSortDir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                );
                return (
                  <div className="obs-card" style={{ overflow: "hidden" }}>
                    <div className="obs-card-hd" style={{ borderBottom: "1px solid var(--line)" }}>
                      <span className="obs-lbl">{lang === "zh" ? "持仓增长（ΔOI）" : "OI Builds — ΔOI"}</span>
                      <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                        {lang === "zh" ? "截至上一交易日" : "as of previous session"}
                      </span>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="scr" style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left" }}>{lang === "zh" ? "代码" : "Ticker"}</th>
                            <th style={{ textAlign: "left" }}>{lang === "zh" ? "认购/认沽" : "C/P"}</th>
                            <th style={{ textAlign: "left" }}>{lang === "zh" ? "到期日" : "Exp"}</th>
                            <th>{lang === "zh" ? "行权价" : "Strike"}</th>
                            {hdr("doi", "ΔOI", "持仓变动", "Open interest change (t-1 vs t-2)")}
                            {hdr("oi", "OI t-1", "持仓（前日）")}
                            {hdr("mid", "Mid", "中间价")}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((m, i) => {
                            const isAdd = m.d_oi > 0;
                            return (
                              <tr key={i} style={{ cursor: "pointer" }} onClick={() => { switchTab("tickers"); setSelectedTicker(m.root); }}>
                                <td style={{ textAlign: "left", fontWeight: 700 }}>{m.root}</td>
                                <td style={{ textAlign: "left" }}>
                                  <span style={{ color: m.right === "C" ? "var(--up)" : "var(--down)", fontWeight: 700 }}>{m.right}</span>
                                </td>
                                <td style={{ textAlign: "left", color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>{m.exp.slice(5)}</td>
                                <td style={{ fontVariantNumeric: "tabular-nums" }}>{m.strike}</td>
                                <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: isAdd ? "var(--up)" : "var(--down)" }}>
                                  {isAdd ? "+" : ""}{m.d_oi.toLocaleString("en-US")}
                                </td>
                                <td style={{ fontVariantNumeric: "tabular-nums" }}>{m.oi.toLocaleString("en-US")}</td>
                                <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-2)" }}>
                                  {m.mid != null ? `$${m.mid.toFixed(2)}` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                          {rows.length === 0 &&
                            scrEmptyRow(7, "No open-interest builds to show", "暂无持仓变动数据", oiData.movers.length)}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ padding: "6px 14px", fontSize: 10, color: "var(--text-dim)", borderTop: "1px solid var(--line)" }}>
                      {lang === "zh" ? "ΔOI为前两个交易日持仓差值，不代表当日方向。" : "ΔOI = OI(t-1)−OI(t-2); does not imply direction of today's flow."}
                    </div>
                  </div>
                );
              })()}

              {/* ── 0DTE Heavy view — aggregate 0DTE premium per ticker ── */}
              {screenerPreset === "zerodte" && feed && (() => {
                const rows = zeroDteRows;
                const hdr = (key: string, en: string, zh: string, tip?: string) => (
                  <th style={{ cursor: "pointer" }} className={scrSortKey === key ? "sorted" : ""} onClick={() => scrSort(key)} title={tip}>
                    {lang === "zh" ? zh : en}{scrSortKey === key ? (scrSortDir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                );
                return (
                  <div className="obs-card" style={{ overflow: "hidden" }}>
                    <div className="obs-card-hd" style={{ borderBottom: "1px solid var(--line)" }}>
                      <span className="obs-lbl">{lang === "zh" ? "高0DTE占比" : "0DTE Heavy"}</span>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="scr" style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left" }}>{lang === "zh" ? "代码" : "Ticker"}</th>
                            <th style={{ textAlign: "left" }}>{t("screenerColSector", "Sector")}</th>
                            {hdr("prem", "0DTE Prem", "0DTE保费", "Premium in 0DTE contracts today")}
                            {hdr("share", "0DTE%", "0DTE占比", "0DTE share of total flow premium")}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.root} style={{ cursor: "pointer" }} onClick={() => { switchTab("tickers"); setSelectedTicker(r.root); }}>
                              <td style={{ textAlign: "left", fontWeight: 700 }}>{r.root}</td>
                              <td style={{ textAlign: "left", color: "var(--text-2)", fontSize: 11 }}>
                                {lang === "zh" ? r.group_zh : abbrevSector(r.group)}
                              </td>
                              <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtPremium(r.zd_prem)}</td>
                              <td style={{ fontVariantNumeric: "tabular-nums", color: r.zd_share > 0.5 ? "var(--warn)" : "var(--text)" }}>
                                {(r.zd_share * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                          {rows.length === 0 &&
                            scrEmptyRow(4, "No 0DTE events this session", "本时段暂无0DTE事件",
                              (feed.events ?? []).filter((e) => e.zerodte).length)}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ padding: "6px 14px", fontSize: 10, color: "var(--text-dim)", borderTop: "1px solid var(--line)" }}>
                      {lang === "zh" ? "0DTE=当日到期合约；高占比可能反映日内投机活动。" : "0DTE = same-day expiry contracts. High share may indicate intraday speculative activity."}
                    </div>
                  </div>
                );
              })()}

              {/* ── Hot Contracts view — hotData by_premium / by_volume ── */}
              {screenerPreset === "hot" && hotData && (
                <div className="obs-card" style={{ overflow: "hidden" }}>
                  <div className="obs-card-hd" style={{ borderBottom: "1px solid var(--line)", alignItems: "center" }}>
                    <span className="obs-lbl">
                      {lang === "zh" ? "热门合约" : "Hot Contracts"}
                    </span>
                    <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                      <button
                        className={`chip${hotView === "by_premium" ? " on" : ""}`}
                        style={{ height: 26, fontSize: 11 }}
                        onClick={() => setHotView("by_premium")}
                      >
                        {t("screenerByPrem", "By Premium")}
                      </button>
                      <button
                        className={`chip${hotView === "by_volume" ? " on" : ""}`}
                        style={{ height: 26, fontSize: 11 }}
                        onClick={() => setHotView("by_volume")}
                      >
                        {t("screenerByVol", "By Volume")}
                      </button>
                    </div>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="scr" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left" }}>{t("colTicker", "Ticker")}</th>
                          <th style={{ textAlign: "left" }}>{t("colRight", "C/P")}</th>
                          <th style={{ textAlign: "left" }}>{t("colExp", "Exp")}</th>
                          <th>{t("colStrike", "Strike")}</th>
                          <th>{t("colPrem", "Prem")}</th>
                          <th>{t("colVol", "Vol")}</th>
                          <th>{t("colClose", "Close")}</th>
                          <th>{t("colVolGtOi", "vol>OI")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hotRows.map((c, i) => (
                          <tr key={i} style={{ cursor: "pointer" }} onClick={() => { switchTab("tickers"); setSelectedTicker(c.root); }}>
                            <td style={{ textAlign: "left", fontWeight: 700 }}>{c.root}</td>
                            <td style={{ textAlign: "left" }}>
                              <span style={{ color: c.right === "C" ? "var(--up)" : "var(--down)", fontWeight: 700 }}>{c.right}</span>
                            </td>
                            <td style={{ textAlign: "left", color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>{c.exp.slice(5)}</td>
                            <td style={{ fontVariantNumeric: "tabular-nums" }}>{c.strike}</td>
                            <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtPremium(c.premium)}</td>
                            <td style={{ fontVariantNumeric: "tabular-nums" }}>{c.vol.toLocaleString("en-US")}</td>
                            <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-2)" }}>{c.close.toFixed(2)}</td>
                            <td>
                              {c.vol_gt_oi && (
                                <span className="flow-flag-chip">{lang === "zh" ? "量超持仓" : "vol>OI"}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {hotRows.length === 0 &&
                          scrEmptyRow(8, "No hot contracts to show", "暂无活跃合约", (hotData[hotView] ?? []).length)}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: "6px 14px", fontSize: 10, color: "var(--text-dim)", borderTop: "1px solid var(--line)" }}>
                    {lang === "zh" ? "ETF覆盖；仅供展示参考，非投资建议。" : "ETF universe. Display only — not investment advice."}
                  </div>
                </div>
              )}
              </div>{/* /results scroller */}
            </div>
          )}

          {/* ═══ GEX TAB ════════════════════════════════════════════════════ */}
          {/* Wave 2: replaced inline GEX panel with GexDeskView (see components/gexdesk/).
              Old inline code retained below as a comment so other waves can reference the
              GexStrikeLadder / GexExpiryBars / GexHistSparkline sub-components.
              ── OLD INLINE CODE PRESERVED (do not delete) ──────────────────────
              The inline GEX sidebar + drill pane that was here used:
                selectedGexRoot, gexData, gexLoading, gexGreek, gexSearch,
                gexCandidates, filteredGexCandidates, ctxData, fetchGex,
                GexStrikeLadder, GexExpiryBars, GexHistSparkline
              All those state vars / components are still defined above and remain available
              for any wave that imports or extends this file.
              ──────────────────────────────────────────────────────────────────── */}
          {(activeTab === "gex" || visitedTabs.has("gex")) && (
            <div style={{ flex: 1, overflow: "hidden", display: activeTab === "gex" ? "flex" : "none", minHeight: 0 }}>
              <GexDeskView />
            </div>
          )}

          {/* ═══ SURFACE TAB (quanted Wave 1 — paint surface + replay spine) ══ */}
          {(activeTab === "surface" || visitedTabs.has("surface")) && (
            <div style={{ flex: 1, overflow: "hidden", display: activeTab === "surface" ? "flex" : "none", minHeight: 0 }}>
              <SurfaceView />
            </div>
          )}


          {/* ═══ STRUCTURE TAB (R3 — OI ladder / OI-time / max pain / OI change) ═ */}
          {(activeTab === "structure" || visitedTabs.has("structure")) && (
            <div style={{ flex: 1, overflow: "hidden", display: activeTab === "structure" ? "flex" : "none", minHeight: 0 }}>
              <StructureView />
            </div>
          )}

          {/* ═══ VOLATILITY TAB (R3 — IV rank / term structure / skew) ═════ */}
          {(activeTab === "volatility" || visitedTabs.has("volatility")) && (
            <div style={{ flex: 1, overflow: "hidden", display: activeTab === "volatility" ? "flex" : "none", minHeight: 0 }}>
              <VolView />
            </div>
          )}

          {/* ═══ POSITIONING TAB (MSC R0 — dealer-positioning mechanics) ═══ */}
          {(activeTab === "positioning" || visitedTabs.has("positioning")) && (
            <div style={{ flex: 1, overflow: "hidden", display: activeTab === "positioning" ? "flex" : "none", minHeight: 0 }}>
              <PositioningView />
            </div>
          )}

          {/* ═══ LEVELS TAB (named gamma-level weather map) ═══════════════ */}
          {(activeTab === "levels" || visitedTabs.has("levels")) && (
            <div style={{ flex: 1, overflow: "hidden", display: activeTab === "levels" ? "flex" : "none", minHeight: 0 }}>
              <LevelsView />
            </div>
          )}

          {/* ═══ PROPHET TAB ════════════════════════════════════════════════ */}
          {(activeTab === "prophet" || visitedTabs.has("prophet")) && (
            <div style={{ flex: 1, overflow: "hidden", display: activeTab === "prophet" ? "flex" : "none", minHeight: 0 }}>
              <ProphetView />
            </div>
          )}

          {/* ═══ LEADERS TAB ════════════════════════════════════════════════ */}
          {activeTab === "leaders" && (
            <div style={{ flex: 1, overflow: "auto", padding: "14px 16px" }}>
              {/* Loading */}
              {leadersLoading && !leadersData && (
                <div className="fin-empty" role="status" style={{ color: "var(--muted)" }}>
                  {t("loading", "Loading…")}
                </div>
              )}

              {/* Error / absent */}
              {leadersError && !leadersData && (
                <div style={{ padding: "40px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 8 }}>
                    {t("leadersAbsent", "Flow Leaders publishes after tonight's build")}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {lang === "zh" ? "数据每晚收盘后构建" : "Data builds nightly after market close"}
                  </div>
                </div>
              )}

              {leadersData && (() => {
                const cov = leadersData.coverage;
                // Render all rows as delivered — server already caps at 25 per board.
                // No client-side qualification filter: accruing rows (all legs null) render so the
                // board shows honestly. Chips/badges convey state. Sorted by K desc for signal rows.
                const boardARows = [...leadersData.board_a].sort((a, b) => b.K_a - a.K_a);
                const boardBRows = [...leadersData.board_b].sort((a, b) => b.K_b - a.K_b);
                const displayRows = leadersBoard === "a" ? boardARows : boardBRows;

                return (
                  <>
                    {/* ── Header strip ── */}
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                        {t("asOf", "as of")} {fmtAsof(leadersData.as_of)}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        {lang === "zh"
                          ? `前 ${displayRows.length} / 共 ${cov.n_universe}`
                          : `top ${displayRows.length} of ${cov.n_universe}`}
                        {" · "}
                        {(() => {
                          const reqSessions = leadersData.cold_start_detail?.required_for_recurrence ?? 5;
                          return lang === "zh"
                            ? `会话 ${cov.n_flow_sessions}/${reqSessions}`
                            : `sessions ${cov.n_flow_sessions}/${reqSessions}`;
                        })()}
                      </span>
                      {leadersData.stale && (
                        <span style={{ fontSize: 11, color: "var(--warn)", fontWeight: 600 }}>
                          {t("leadersStale", "Snapshot from prior session")}
                        </span>
                      )}
                    </div>

                    {/* Cold-start banner */}
                    {leadersData.cold_start && (
                      <div style={{
                        padding: "8px 12px", borderRadius: "var(--r-md)",
                        background: "color-mix(in srgb, var(--warn) 10%, transparent)",
                        border: "1px solid color-mix(in srgb, var(--warn) 30%, transparent)",
                        fontSize: 12, color: "var(--warn)", marginBottom: 10,
                      }}>
                        {leadersData.cold_start_detail?.message
                          ?? (lang === "zh"
                            ? "基线建立中 — 今晚构建后发布"
                            : "Baseline building — publishes after tonight's nightly run")}
                      </div>
                    )}

                    {/* Direction note */}
                    {leadersData.direction_note && (
                      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 10, fontStyle: "italic" }}>
                        {leadersData.direction_note}
                      </div>
                    )}

                    {/* ── Board toggle ── */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 14, alignItems: "center" }}>
                      <button
                        className={`chip${leadersBoard === "a" ? " on" : ""}`}
                        style={{ height: 26, fontSize: 11 }}
                        onClick={() => setLeadersBoard("a")}
                      >
                        {t("leadersBoardALbl", "Flow Leadership")}
                      </button>
                      <button
                        className={`chip${leadersBoard === "b" ? " on" : ""}`}
                        style={{ height: 26, fontSize: 11 }}
                        onClick={() => setLeadersBoard("b")}
                      >
                        {t("leadersBoardBLbl", "Washout Turn")}
                      </button>
                    </div>

                    {/* ── Table ── */}
                    {displayRows.length === 0 ? (
                      <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                        {t("leadersNoQualifying", "No qualifying names yet — updates after tonight's build")}
                      </div>
                    ) : (
                      <div className="obs-scroll" style={{ overflowX: "auto" }}>
                        <table className="scr" style={{ fontSize: 12, minWidth: 680 }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left", minWidth: 60 }}>
                                {t("leadersColTicker", "Ticker")}
                              </th>
                              <th style={{ textAlign: "center", minWidth: 56 }}>
                                {leadersBoard === "a" ? t("leadersColRecur", "Recur") : t("leadersColDays", "Days")}
                              </th>
                              {leadersBoard === "a" && (
                                <th style={{ textAlign: "right", minWidth: 80 }}>
                                  {t("leadersNetPremNorm", "Net Prem / $bn cap (~)")}
                                </th>
                              )}
                              {leadersBoard === "a" && (
                                <th style={{ textAlign: "right", minWidth: 56 }}>
                                  {t("leadersFlowZ", "Flow activity")}
                                </th>
                              )}
                              <th style={{ textAlign: "center", minWidth: 80 }}>
                                {t("leadersKN", "K/N legs")}
                              </th>
                              {leadersBoard === "b" && (
                                <th style={{ textAlign: "left", minWidth: 120 }}>
                                  {t("leadersColOsc", "Oscillators")}
                                </th>
                              )}
                              <th style={{ textAlign: "left", minWidth: 140 }}>
                                {t("leadersColFlags", "Flags")}
                              </th>
                              <th style={{ textAlign: "left", minWidth: 80 }}>
                                {t("leadersColSource", "Source")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayRows.map((row) => {
                              const isA = leadersBoard === "a";
                              const K = isA ? row.K_a : row.K_b;
                              const nAvail = isA ? row.n_avail_a : row.n_avail_b;
                              const recur = isA ? row.recurrence_count : row.days_since_inflection;
                              // Leg definitions for Board A
                              const aLegs: [string, boolean | null][] = [
                                ["A1 flow recur", row.A1_flow_recur],
                                ["A2 flow activity hot", row.A2_flow_z_hot],
                                ["A3 OI conf", row.A3_oi_confirmed as boolean | null],
                                ["A4 breadth", row.A4_ts_breadth],
                                ["A5 price lead", row.A5_price_leader],
                                ["A6 near high", row.A6_near_high],
                                ["A7 vol conf", row.A7_vol_confirm],
                                ["A8 not trap", row.A8_not_trap],
                              ];
                              const bLegs: [string, boolean | null][] = [
                                ["B1 washout", row.B1_washout_recent],
                                ["B2 oversold", row.B2_oversold_osc],
                                ["B3 turn", row.B3_turn_organ],
                                ["B4 HTF cross", row.B4_htf_cross_near],
                                ["B5 flow inflect", row.B5_flow_inflect],
                                ["B6 OI conf", row.B6_oi_confirmed as boolean | null],
                                ["B7 vol conf", row.B7_vol_confirm],
                                ["B8 not trap", row.B8_not_trap],
                              ];
                              const legs = isA ? aLegs : bLegs;
                              // Only legs that scored (not null)
                              const scoredLegs = legs.filter(([, v]) => v !== null);

                              const de = row.de_escalation;
                              const warnEarnings = de.earnings_window === true;
                              const warnVol = de.vol_trade === true;
                              const warnPut = de.protective_put === true;
                              const warnGamma = de.gamma_caution;

                              return (
                                <tr
                                  key={row.ticker}
                                  style={{ cursor: "pointer" }}
                                  onClick={() => {
                                    switchTab("tickers");
                                    setSelectedTicker(row.ticker);
                                  }}
                                >
                                  {/* Ticker */}
                                  <td style={{ fontWeight: 700, color: "var(--text)" }}>
                                    {row.ticker}
                                  </td>

                                  {/* Recur / Days */}
                                  <td style={{ textAlign: "center" }}>
                                    {recur !== null && recur !== undefined
                                      ? recur
                                      : (
                                        <span style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>
                                          {t("leadersAccruing", "accruing")}
                                        </span>
                                      )}
                                  </td>

                                  {/* Net prem norm (Board A only) — normalized ratio abs(net_premium_mn / mktcap_bn) */}
                                  {isA && (
                                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-2)" }}>
                                      {row.net_prem_norm_abs !== null && row.net_prem_norm_abs !== undefined
                                        ? `~${row.net_prem_norm_abs.toFixed(2)}`
                                        : <span style={{ color: "var(--muted)" }}>—</span>}
                                    </td>
                                  )}

                                  {/* Flow activity compared with its recent norm (Board A only) */}
                                  {isA && (
                                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                      {row.flow_z !== null && row.flow_z !== undefined
                                        ? (
                                          <span style={{
                                            display: "inline-block", padding: "1px 5px", borderRadius: 3,
                                            background: "var(--panel-3)", fontSize: 11,
                                            color: Math.abs(row.flow_z) >= 2 ? "var(--warn)" : "var(--text-2)",
                                          }}>
                                            {activityBand(row.flow_z, lang)}
                                          </span>
                                        )
                                        : <span style={{ color: "var(--muted)" }}>—</span>}
                                    </td>
                                  )}

                                  {/* K/N chip cluster */}
                                  <td style={{ textAlign: "center" }}>
                                    <div style={{ display: "flex", gap: 2, justifyContent: "center", flexWrap: "wrap" }}>
                                      <span style={{
                                        fontSize: 11, fontWeight: 700,
                                        color: K >= 2 ? "var(--up)" : K >= 1 ? "var(--warn)" : "var(--muted)",
                                        marginRight: 3,
                                      }}>
                                        {K}/{nAvail}
                                      </span>
                                      {scoredLegs.map(([label, val]) => (
                                        <span
                                          key={label}
                                          title={label}
                                          style={{
                                            display: "inline-block", width: 8, height: 8,
                                            borderRadius: 2,
                                            background: val === true
                                              ? "var(--up)"
                                              : val === false
                                              ? "color-mix(in srgb, var(--down) 40%, transparent)"
                                              : "var(--panel-3)",
                                            border: "1px solid var(--line-3)",
                                          }}
                                        />
                                      ))}
                                    </div>
                                  </td>

                                  {/* Board B oscillators */}
                                  {!isA && (
                                    <td>
                                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                                        {row.macd_2w_state && row.macd_2w_state !== "none" && (
                                          <span style={{
                                            fontSize: 10, padding: "1px 5px", borderRadius: 3,
                                            background: row.macd_2w_state === "crossed" ? "color-mix(in srgb, var(--up) 20%, transparent)" : "color-mix(in srgb, var(--warn) 15%, transparent)",
                                            color: row.macd_2w_state === "crossed" ? "var(--up)" : "var(--warn)",
                                          }}>
                                            {row.macd_2w_state === "crossed"
                                              ? t("leadersMacdCrossed", `MACD ×${row.macd_2w_bars_since ?? ""}`).replace("{n}", String(row.macd_2w_bars_since ?? ""))
                                              : t("leadersMacdApproach", `MACD ~${row.macd_2w_bars_to_cross != null ? row.macd_2w_bars_to_cross.toFixed(1) + "b" : "?"}`).replace("{b}", row.macd_2w_bars_to_cross != null ? row.macd_2w_bars_to_cross.toFixed(1) + "b" : "?")}
                                          </span>
                                        )}
                                        {row.stochrsi_2w_oversold === true && (
                                          <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "color-mix(in srgb, var(--up) 15%, transparent)", color: "var(--up)" }}>
                                            {t("leadersOversoldChip", "oversold")}
                                          </span>
                                        )}
                                        {row.htf_coverage && row.stochrsi_2w_k !== null && (
                                          <span style={{ fontSize: 10, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                                            K{row.stochrsi_2w_k.toFixed(0)}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                  )}

                                  {/* Warn chips + 0DTE */}
                                  <td>
                                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                                      {warnEarnings && (
                                        <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "color-mix(in srgb, var(--down) 15%, transparent)", color: "var(--down)" }}>
                                          {t("leadersWarnEarningsShort", "earns")}
                                        </span>
                                      )}
                                      {warnVol && (
                                        <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "color-mix(in srgb, var(--warn) 15%, transparent)", color: "var(--warn)" }}>
                                          {t("leadersWarnVolShort", "vol")}
                                        </span>
                                      )}
                                      {warnPut && (
                                        <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "color-mix(in srgb, var(--down) 12%, transparent)", color: "var(--down)" }}>
                                          {t("leadersWarnPutShort", "put hedge")}
                                        </span>
                                      )}
                                      {warnGamma && (
                                        <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "color-mix(in srgb, var(--warn) 12%, transparent)", color: "var(--warn)" }}>
                                          {t("leadersWarnGammaShort", "gamma")}
                                        </span>
                                      )}
                                      {row.zerodte_dominated && (
                                        <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "var(--panel-3)", color: "var(--text-dim)" }}>
                                          0DTE
                                        </span>
                                      )}
                                    </div>
                                  </td>

                                  {/* Source tag */}
                                  <td>
                                    <span style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>
                                      {row.signing_source === "minute_tick" ? "min" : row.signing_source}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Per-source footnote */}
                    <div style={{ marginTop: 14, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.6 }}>
                      {t("leadersFootnote", "Direction ~-soft (approximate). Sources: {sources}. All readings display-only — not investment advice.").replace("{sources}", leadersData.coverage.tape_names.join(", "))}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              Leader Radar tab
          ══════════════════════════════════════════════════════════════════ */}
          {activeTab === "radar" && (
            <div style={{ flex: 1, overflow: "auto", padding: "14px 16px" }}>
              {/* Loading */}
              {radarLoading && !radarData && (
                <div className="fin-empty" role="status" style={{ color: "var(--muted)" }}>
                  {t("radarLoading", "Loading Leader Radar…")}
                </div>
              )}

              {/* Error / absent */}
              {radarError && !radarData && (
                <div style={{ padding: "40px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 8 }}>
                    {t("radarAbsent", "Leader Radar publishes after tonight's build")}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {t("radarAbsentSub", "Data builds nightly after market close")}
                  </div>
                </div>
              )}

              {/* Cold-start banner — shown when cold_start flag is set OR rows is empty */}
              {radarData && (radarData.cold_start === true || radarData.rows.length === 0) && (
                <div style={{
                  padding: "8px 12px", borderRadius: "var(--r-md)",
                  background: "color-mix(in srgb, var(--warn) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--warn) 30%, transparent)",
                  fontSize: 12, color: "var(--warn)", marginBottom: 10,
                }}>
                  {radarData.cold_start_detail?.message
                    ?? t("radarColdStart", "Baseline building — publishes after tonight's nightly run")}
                </div>
              )}

              {radarData && !radarData.cold_start && radarData.rows.length > 0 && (() => {
                const cov = radarData.coverage;
                const reg = radarData.regime;

                // State display order per spec
                const STATE_ORDER = [
                  "CROWDED", "LEADERSHIP", "BREAKAWAY", "CATALYST_WINDOW",
                  "QUIET_ACCUMULATION", "SUPPRESSED", "FAILED", "NONE",
                ];

                // State color map via CSS vars (all via inline style, no new class names)
                const stateColor: Record<string, string> = {
                  CROWDED:              "var(--up)",
                  LEADERSHIP:           "var(--up)",
                  BREAKAWAY:            "var(--up)",
                  CATALYST_WINDOW:      "var(--warn)",
                  QUIET_ACCUMULATION:   "var(--accent, #5b9cf6)",
                  SUPPRESSED:           "var(--text-dim)",
                  FAILED:               "var(--down)",
                  NONE:                 "var(--muted)",
                };
                const stateBg: Record<string, string> = {
                  CROWDED:              "color-mix(in srgb, var(--up) 25%, transparent)",
                  LEADERSHIP:           "color-mix(in srgb, var(--up) 18%, transparent)",
                  BREAKAWAY:            "color-mix(in srgb, var(--up) 12%, transparent)",
                  CATALYST_WINDOW:      "color-mix(in srgb, var(--warn) 18%, transparent)",
                  QUIET_ACCUMULATION:   "color-mix(in srgb, var(--accent, #5b9cf6) 12%, transparent)",
                  SUPPRESSED:           "color-mix(in srgb, var(--muted) 14%, transparent)",
                  FAILED:               "color-mix(in srgb, var(--down) 15%, transparent)",
                  NONE:                 "color-mix(in srgb, var(--muted) 9%, transparent)",
                };

                // Group rows by state
                const grouped: Record<string, RadarRow[]> = {};
                for (const s of STATE_ORDER) grouped[s] = [];
                for (const row of radarData.rows) {
                  const s = row.state in grouped ? row.state : "NONE";
                  grouped[s].push(row);
                }

                const noneCount = grouped["NONE"].length;

                // Chip tri-state renderer
                const ChipDot = ({ label, val }: { label: string; val: boolean | null }) => (
                  <span
                    title={label}
                    style={{
                      display: "inline-block", width: 8, height: 8, borderRadius: 2,
                      background: val === true
                        ? "var(--up)"
                        : val === false
                        ? "color-mix(in srgb, var(--down) 40%, transparent)"
                        : "var(--panel-3)",
                      border: "1px solid var(--line-3)",
                      flexShrink: 0,
                    }}
                  />
                );

                // Regime chip labels (EN only — these are condition identifiers, not UI prose)
                const regimeChipLabel: Record<string, [string, string]> = {
                  dispersion_high:    ["dispersion high", "高离散度"],
                  corr_low:           ["corr low", "低相关"],
                  pct_above_200_low:  ["<200d% low", "<200d%低"],
                  top5_share_low:     ["top5 wt low", "前5权重低"],
                  zweig_thrust:       ["Zweig thrust", "Zweig冲击"],
                  pct_above_200_high: ["<200d% high", "<200d%高"],
                };

                return (
                  <>
                    {/* ── Header strip ── */}
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        {t("radarTitle", "Leader Radar")}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                        {t("asOf", "as of")} {radarData.as_of.replace("T", " ").slice(0, 16)} UTC
                      </span>
                      {radarData.stale && (
                        <span style={{ fontSize: 11, color: "var(--warn)", fontWeight: 600 }}>
                          {t("radarStale", "Snapshot from prior session")}
                        </span>
                      )}
                    </div>

                    {/* Coverage line */}
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                      {cov.n_universe} {t("radarNames", "names")}{" · "}
                      {(() => {
                        const uncovered = cov?.revisions_uncovered ?? [];
                        return (
                          <span
                            title={uncovered.length > 0 ? uncovered.join(", ") : undefined}
                            style={uncovered.length > 0 ? { cursor: "help", borderBottom: "1px dashed var(--line-3)" } : undefined}
                          >
                            {uncovered.length}{" "}
                            {t("radarRevUncovered", "revision-uncovered")}
                          </span>
                        );
                      })()}
                    </div>

                    {/* ── Regime banner ── */}
                    {reg && reg.label && (
                      <div style={{
                        padding: "8px 12px", borderRadius: "var(--r-md)",
                        background: "color-mix(in srgb, var(--accent, #5b9cf6) 8%, transparent)",
                        border: "1px solid color-mix(in srgb, var(--accent, #5b9cf6) 20%, transparent)",
                        marginBottom: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6,
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: ".04em" }}>
                          {reg.label.replace(/_/g, " ")}
                        </span>
                        {reg.conditions && (
                          <span style={{ fontSize: 11, color: "var(--text-2)", fontStyle: "italic" }}>
                            — {reg.conditions}
                          </span>
                        )}
                        {(reg.chips ? Object.entries(reg.chips) : []).map(([k, v]) => v === true && (
                          <span key={k} style={{
                            fontSize: 10, padding: "1px 6px", borderRadius: 3,
                            background: "color-mix(in srgb, var(--accent, #5b9cf6) 15%, transparent)",
                            color: "var(--text-2)",
                          }}>
                            {lang === "zh" ? (regimeChipLabel[k]?.[1] ?? k) : (regimeChipLabel[k]?.[0] ?? k)}
                          </span>
                        ))}
                        {reg.top5_weighting && reg.top5_weighting !== "equal_fallback" && (
                          <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: "auto" }}>
                            {t("radarRegimeWeighting", "weighting")}: {reg.top5_weighting}
                          </span>
                        )}
                      </div>
                    )}

                    {/* ── Lifecycle board grouped by state ── */}
                    {STATE_ORDER.filter((s) => s !== "NONE" || showNone).map((stateName) => {
                      const rows = grouped[stateName];
                      if (rows.length === 0) return null;
                      return (
                        <div key={stateName} style={{ marginBottom: 18 }}>
                          {/* State group header */}
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 3,
                              background: stateBg[stateName] ?? "var(--panel-3)",
                              color: stateColor[stateName] ?? "var(--text)",
                              textTransform: "uppercase", letterSpacing: ".05em",
                            }}>
                              {stateName.replace(/_/g, " ")}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>
                              {rows.length}
                            </span>
                          </div>

                          {/* Rows */}
                          <div className="obs-scroll" style={{ overflowX: "auto" }}>
                            <table className="scr" style={{ fontSize: 12, minWidth: 560 }}>
                              <tbody>
                                {rows.map((row) => {
                                  // Chips: collect all boolean entries for tri-state display
                                  const chipEntries = Object.entries(row.chips).filter(
                                    ([, v]) => v !== undefined
                                  ) as [string, boolean | null][];
                                  const trueCount = chipEntries.filter(([, v]) => v === true).length;
                                  const availCount = chipEntries.filter(([, v]) => v !== null).length;

                                  const tf = row.context.tf2d_state;
                                  const hasOscSignal =
                                    tf.macd_cross_up || tf.macd_approaching_up ||
                                    tf.stoch_cross_up || tf.stoch_cross_dn;

                                  const deEntries = Object.entries(row.de_escalations).filter(
                                    ([, v]) => v === true
                                  );

                                  return (
                                    <tr
                                      key={row.ticker}
                                      style={{ cursor: "pointer" }}
                                      onClick={() => {
                                        switchTab("tickers");
                                        setSelectedTicker(row.ticker);
                                      }}
                                    >
                                      {/* Ticker + state chip */}
                                      <td style={{ minWidth: 68, fontWeight: 700, color: "var(--text)" }}>
                                        {row.ticker}
                                      </td>

                                      {/* Days in state */}
                                      <td style={{ textAlign: "center", minWidth: 52, color: "var(--text-dim)", fontSize: 11 }}>
                                        {row.days_in_state !== null && row.days_in_state !== undefined
                                          ? daysHeld(row.days_in_state, lang)
                                          : <span style={{ fontStyle: "italic", color: "var(--muted)" }}>{t("radarSeeding", "seeding")}</span>}
                                      </td>

                                      {/* Evidence chip cluster (tri-state) */}
                                      <td style={{ minWidth: 100 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                                          <span style={{
                                            fontSize: 11, fontWeight: 700, marginRight: 3,
                                            color: trueCount >= 3 ? "var(--up)" : trueCount >= 1 ? "var(--warn)" : "var(--muted)",
                                          }}>
                                            {trueCount}/{availCount}
                                          </span>
                                          {chipEntries.map(([k, v]) => (
                                            <ChipDot key={k} label={k.replace(/_/g, " ")} val={v} />
                                          ))}
                                        </div>
                                      </td>

                                      {/* De-escalation warn chips */}
                                      <td style={{ minWidth: 80 }}>
                                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                                          {deEntries.map(([k]) => (
                                            <span key={k} style={{
                                              fontSize: 10, padding: "1px 5px", borderRadius: 3,
                                              background: "color-mix(in srgb, var(--down) 15%, transparent)", color: "var(--down)",
                                            }}>
                                              {k.replace(/_/g, " ")}
                                            </span>
                                          ))}
                                        </div>
                                      </td>

                                      {/* Fire badges */}
                                      <td style={{ minWidth: 90 }}>
                                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                                          {row.fire_precipice && (
                                            <span style={{
                                              fontSize: 10, padding: "1px 5px", borderRadius: 3,
                                              background: "color-mix(in srgb, var(--warn) 20%, transparent)", color: "var(--warn)", fontWeight: 600,
                                            }}>
                                              {t("radarFireWatch", "watch-window entry")}
                                            </span>
                                          )}
                                          {row.fire_onset && (
                                            <span style={{
                                              fontSize: 10, padding: "1px 5px", borderRadius: 3,
                                              background: "color-mix(in srgb, var(--up) 20%, transparent)", color: "var(--up)", fontWeight: 600,
                                            }}>
                                              {t("radarFireOnset", "onset entry")}
                                            </span>
                                          )}
                                        </div>
                                      </td>

                                      {/* 2W/2D oscillator chips */}
                                      <td style={{ minWidth: 110 }}>
                                        {hasOscSignal && (
                                          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                                            {tf.macd_cross_up && (
                                              <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "color-mix(in srgb, var(--up) 15%, transparent)", color: "var(--up)" }}>
                                                {t("radarOscMacdCrossUp", "MACD cross up")}
                                              </span>
                                            )}
                                            {tf.macd_approaching_up && tf.macd_bars_to_cross !== null && (
                                              <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "color-mix(in srgb, var(--warn) 15%, transparent)", color: "var(--warn)" }}>
                                                {t("radarOscMacdApproachUp", "MACD approaching up {b}").replace("{b}", `${tf.macd_bars_to_cross.toFixed(1)}b`)}
                                              </span>
                                            )}
                                            {tf.stoch_cross_up && (
                                              <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "color-mix(in srgb, var(--up) 12%, transparent)", color: "var(--up)" }}>
                                                {t("radarOscStochCrossUp", "Stoch cross up")}
                                              </span>
                                            )}
                                            {tf.stoch_cross_dn && (
                                              <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "color-mix(in srgb, var(--down) 12%, transparent)", color: "var(--down)" }}>
                                                {t("radarOscStochCrossDn", "Stoch cross dn")}
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}

                    {/* NONE toggle */}
                    <div style={{ marginBottom: 16 }}>
                      <button
                        className="chip"
                        style={{ height: 24, fontSize: 11 }}
                        onClick={() => setShowNone((v) => !v)}
                      >
                        {showNone
                          ? t("radarHideNone", "Hide NONE")
                          : t("radarNoneToggle", "Show NONE ({n})").replace("{n}", String(noneCount))}
                      </button>
                    </div>

                    {/* ── Handoff Watch ── */}
                    <div style={{ marginTop: 4, marginBottom: 18 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".04em" }}>
                        {t("radarHandoffTitle", "Handoff Watch")}
                      </div>
                      {radarData.handoff_pairs.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
                          {t("radarHandoffEmpty", "No extended-leg baskets currently")}
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {radarData.handoff_pairs.map((pair, i) => (
                            <div key={i} style={{
                              padding: "8px 12px", borderRadius: "var(--r-md)",
                              background: "var(--panel-2)", border: "1px solid var(--line-3)",
                              display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap",
                            }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--up)" }}>
                                {pair.extended_leg}
                              </span>
                              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>→</span>
                              <span style={{ fontSize: 11, color: "var(--text-2)" }}>
                                {(pair.basing_leg_names ?? []).join(", ")}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ── Re-rating Watch ── */}
                    {radarData.rerating_watch.length > 0 && (
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".04em" }}>
                          {t("radarReratingTitle", "Re-rating Watch")}
                        </div>
                        <div className="obs-scroll" style={{ overflowX: "auto" }}>
                          <table className="scr" style={{ fontSize: 12, minWidth: 400 }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", minWidth: 68 }}>{t("leadersColTicker", "Ticker")}</th>
                                <th style={{ textAlign: "left", minWidth: 80 }}>{t("radarStateGroup", "State")}</th>
                                <th style={{ textAlign: "center", minWidth: 60 }}>{t("radarReratingRevPos", "revision +")}</th>
                                <th style={{ textAlign: "center", minWidth: 70 }}>{t("radarReratingRevBreadth", "breadth 60d")}</th>
                                <th style={{ textAlign: "center", minWidth: 80 }}>{t("radarReratingMultComp", "multiple compressed")}</th>
                                <th style={{ textAlign: "center", minWidth: 80 }}>{t("radarReratingEarnings", "earnings caution")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {radarData.rerating_watch.map((rr) => (
                                <tr
                                  key={rr.ticker}
                                  style={{ cursor: "pointer" }}
                                  onClick={() => {
                                    switchTab("tickers");
                                    setSelectedTicker(rr.ticker);
                                  }}
                                >
                                  <td style={{ fontWeight: 700 }}>{rr.ticker}</td>
                                  <td>
                                    <span style={{
                                      fontSize: 10, padding: "1px 5px", borderRadius: 3,
                                      background: stateBg[rr.state] ?? "var(--panel-3)",
                                      color: stateColor[rr.state] ?? "var(--text)",
                                    }}>
                                      {rr.state.replace(/_/g, " ")}
                                    </span>
                                  </td>
                                  {/* revision_positive */}
                                  <td style={{ textAlign: "center" }}>
                                    <ChipDot label="revision positive" val={rr.chips.revision_positive} />
                                  </td>
                                  {/* revision_breadth_60 */}
                                  <td style={{ textAlign: "center" }}>
                                    <ChipDot label="revision breadth 60d" val={rr.chips.revision_breadth_60} />
                                  </td>
                                  {/* multiple_compressed */}
                                  <td style={{ textAlign: "center" }}>
                                    <ChipDot label="multiple compressed" val={rr.chips.multiple_compressed} />
                                  </td>
                                  {/* earnings_within_14d — CAUTION style only when true */}
                                  <td style={{ textAlign: "center" }}>
                                    {rr.chips.earnings_within_14d === true ? (
                                      <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "color-mix(in srgb, var(--down) 15%, transparent)", color: "var(--down)" }}>
                                        {t("radarReratingEarningsCaution", "caution")}
                                      </span>
                                    ) : (
                                      <span style={{ color: "var(--muted)" }}>—</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Footnote */}
                    <div style={{ marginTop: 14, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.6 }}>
                      {t("radarFootnote", "4H data for select names only; null-honest elsewhere. Display-only — not investment advice.")}
                      {cov?.tape_note && (
                        <span style={{ marginLeft: 4 }}>{cov.tape_note}</span>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

        </div>

        {/* ── Disclaimer ── */}
        <div className="flow-disclaimer">
          {lang === "zh"
            ? "标注与方向标签为启发式近似（~），仅供展示，不构成投资建议。"
            : "Notability and direction labels are heuristic and approximate (~). Display only — not investment advice."}
        </div>
      </Wrapper>
    </CoachProvider>
  );
}
