"use client";
/**
 * FlowDeskView — three-pane MomoEdge-parity options flow desk.
 *
 * Layout:
 *   Left  — WatchlistRail (session overview + watchlist chips)
 *   Center — FlowGauge strip + RadarStrip + FiltersPanel (slide-in) + FeedPane
 *   Right  — InspectorPane + ChainHeatRail
 *
 * State owned here:
 *   - feed transport + tide / chainHeat watcher intervals (not producer cadence)
 *   - selectedEvent for inspector
 *   - tickerCtx fetch (on selection)
 *   - watchlist (localStorage "flowdesk.watchlist")
 *   - filters (passed down to FeedPane → FiltersPanel)
 *
 * HONESTY DOCTRINE: rank/color by MAGNITUDE, never by asserted direction.
 * Direction is surfaced only as a soft "lean" chip with tooltip.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { flowGet, flowGetResult, flowInvalidate } from "../../lib/flowClientCache";
import { useFlowStream } from "../../lib/flowStream";
import { useLang } from "../../lib/i18n";
import { makeFlowT } from "../../lib/flowdeskStrings";
import { artifactSourceAgeMs } from "../../lib/flowFreshness";
import { WatchlistRail } from "./WatchlistRail";
import { RadarStrip } from "./RadarStrip";
import { FlowGauge } from "./FlowGauge";
import { FeedPane, type FlowEvent, type FeedPayload, type EnrichPayload, normalizeEnrichPayload } from "./FeedPane";
import { InspectorPane } from "./InspectorPane";
import { DEFAULT_FILTERS, type FlowFilters } from "./FiltersPanel";
import { TutorialOverlay } from "../tutorial/TutorialOverlay";
import { ArtifactSourceReceipt } from "./FlowFreshnessReceipt";

const TUTORIAL_KEY = "flowdesk.tutorial";
/** Written the moment the auto-prompt fires so it never re-fires on future visits,
 *  independent of whether the user completes a module (which writes TUTORIAL_KEY). */
const TUTORIAL_SEEN_KEY = "flowdesk.tutorial.seen";
const AUTO_PROMPT_DELAY_MS = 1500;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TideMinute { t: string; ncp: number; npp: number; gross: number; vol: number }
interface TidePayload {
  schema?: string; asof: string; session_date?: string;
  minutes: TideMinute[];
  spy: { t: string; px: number }[];
  sectors: unknown[]; top_net_impact: unknown[];
}

interface TickerPayload {
  schema?: string; asof: string; root: string; group: string; group_zh: string;
  day: {
    gross: number; net_soft: number; call_share: number; n_events: number;
    prem_z: number | null; baseline_source: string | null;
  };
  minutes: { t: string; ncp: number; npp: number; vol: number }[];
  strikes: { strike: number; call_prem: number; put_prem: number; vol: number }[];
  expiries: { exp: string; call_prem: number; put_prem: number; vol: number }[];
  top_contracts: {
    right: "C" | "P"; exp: string; strike: number; premium: number;
    vol: number; vol_gt_oi: boolean | null; close: number;
  }[];
}

interface ChainHeatCampaign {
  option_symbol: string;
  ticker: string;
  type: "CALL" | "PUT";
  strike: number;
  expiry: string;
  dte: number;
  total_premium_mn: number;
  alert_count: number;
  span_minutes: number;
  first_seen: string;
  ask_share: number;
  lean: "accumulation" | "distribution" | "contested";
  direction_reliability: string;
  authority_tier: string;
  note?: string;
  category_proxy?: ChainHeatCategoryProxy;
}

// Additive side-category proxy.  This is a fixed mapping category — NOT a
// measured NBBO and NOT the legacy ask_share.  Absent on legacy payloads.
interface ChainHeatCategoryProxy {
  schema?: string;
  basis?: string;
  share?: number | null;
  known_premium_usd?: number;
  unknown_premium_usd?: number;
  source_premium_usd?: number;
  invalid_premium_count?: number;
  source_certified_accepted?: boolean;
}

type CategoryProxyState =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "valid"; share: number | null; known: number; source: number };

/**
 * Resolve the additive category_proxy object with the exact contract guard.
 *
 *   none    — payload carries no object (legacy); legacy bar may be shown,
 *             clearly labelled as legacy with coverage unavailable.
 *   invalid — a NEW object was claimed but fails the schema/basis/bounds
 *             contract; render unavailable and NEVER fall back to legacy.
 *   valid   — schema + basis match and every share/mass is finite and bounded.
 */
function resolveCategoryProxy(
  p: unknown,
): CategoryProxyState {
  // Only an ABSENT field is legacy.  null / primitives / arrays are a claimed
  // but malformed object → invalid, and must NEVER fall back to the legacy bar.
  if (p === undefined) return { kind: "none" };
  if (p === null || typeof p !== "object" || Array.isArray(p)) {
    return { kind: "invalid" };
  }
  const o = p as Record<string, unknown>;
  const finiteNonNeg = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (
    o.schema !== "options_flow.category_proxy/v1" ||
    o.basis !== "side_category" ||
    o.source_certified_accepted !== false ||
    !finiteNonNeg(o.known_premium_usd) ||
    !finiteNonNeg(o.unknown_premium_usd) ||
    !finiteNonNeg(o.source_premium_usd) ||
    !Number.isInteger(o.invalid_premium_count) ||
    (o.invalid_premium_count as number) < 0
  ) {
    return { kind: "invalid" };
  }
  const known = o.known_premium_usd as number;
  const unknown = o.unknown_premium_usd as number;
  const source = o.source_premium_usd as number;
  const invalidCount = o.invalid_premium_count as number;
  // Mass must reconcile to the selected source within rounding: known+unknown
  // ≈ source (0.02 USD + 1e-12 relative), and known ≤ source within rounding.
  const tol = 0.02 + 1e-12 * source;
  if (Math.abs(known + unknown - source) > tol) return { kind: "invalid" };
  if (known > source + tol) return { kind: "invalid" };
  // share: null is allowed; a numeric share requires real known mass and no
  // invalid premium rows.
  let share: number | null;
  if (o.share === null) {
    share = null;
  } else if (
    typeof o.share === "number" &&
    Number.isFinite(o.share) &&
    o.share >= 0 &&
    o.share <= 1 &&
    known > 0 &&
    invalidCount === 0
  ) {
    share = o.share;
  } else {
    return { kind: "invalid" };
  }
  return { kind: "valid", share, known, source };
}

interface ChainHeatPayload {
  schema?: string; asof: string; session_date?: string;
  source_asof?: string;
  built_at?: string;
  threshold_mn?: number;
  note_en?: string; note_zh?: string;
  campaigns: ChainHeatCampaign[];
}

// ─── Polling constants ────────────────────────────────────────────────────────

const TIDE_POLL_MS   = 60_000;
const CHAIN_POLL_MS  = 45_000;

const WATCHLIST_KEY = "flowdesk.watchlist";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {}
  return [];
}

function saveWatchlist(list: string[]) {
  try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list)); } catch {}
}

/**
 * Run `cb` once the browser is idle (or after a short delay when
 * requestIdleCallback is unavailable). Used to keep the 3.2 MB enrich artifact
 * off the desk's first-paint request batch.
 */
function whenIdle(cb: () => void): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const h = w.requestIdleCallback(cb, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(h);
  }
  const h = setTimeout(cb, 900);
  return () => clearTimeout(h);
}

async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const f = new URL(url, "http://x").searchParams.get("f") ?? url;
    const data = await flowGet(f);
    return (data as T) ?? null;
  } catch {
    return null;
  }
}

/**
 * What the last chain-heat read established. "unavailable" with campaigns still held
 * is a failed refresh: the rows stay, labelled as the last read.
 */
type ChainHeatStatus = "loading" | "data" | "absent" | "unavailable";

/** A 200 whose body is not a chain-heat payload is a read that did not land. */
function isChainHeatPayload(v: unknown): v is ChainHeatPayload {
  return typeof v === "object" && v !== null && Array.isArray((v as { campaigns?: unknown }).campaigns);
}

// ─── ChainHeatRail ────────────────────────────────────────────────────────────

interface ChainHeatRailProps {
  data: ChainHeatPayload | null;
  status: ChainHeatStatus;
  onRetry: () => void;
  lang: "en" | "zh";
}

const CHAIN_LOAD_ERROR: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
  padding: 16, fontSize: 11, textAlign: "center", color: "var(--muted)",
};
const CHAIN_LOAD_ERROR_TITLE: React.CSSProperties = { color: "var(--text)", fontWeight: 600 };
const CHAIN_REFRESH_FAILED: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  padding: "6px 16px", fontSize: 10, lineHeight: 1.4, color: "var(--warn)",
  borderBottom: "1px solid var(--line-2)",
};
const RETRY_INLINE: React.CSSProperties = { padding: "2px 10px", fontSize: 11, flexShrink: 0 };

function ChainHeatRail({ data, status, onRetry, lang }: ChainHeatRailProps) {
  const zh = lang === "zh";
  const t = makeFlowT(lang);

  if (!data) {
    return (
      <div className="obs-card obs-fd-chain obs-scroll" data-tut="chain-heat">
        <div className="obs-card-hd">
          <span className="obs-lbl">{t("chainHeatTitle")}</span>
        </div>
        {status === "unavailable" ? (
          <div style={CHAIN_LOAD_ERROR} data-testid="chainheat-load-error" role="alert">
            <span style={CHAIN_LOAD_ERROR_TITLE}>{t("chainHeatError")}</span>
            <span>{t("chainHeatErrorWhy")}</span>
            <button type="button" className="btn btn-ghost load-retry" style={RETRY_INLINE} onClick={onRetry}>
              {t("errRetry")}
            </button>
          </div>
        ) : status === "absent" ? (
          <div className="obs-fd-chain-empty" data-testid="chainheat-absent">{t("chainHeatAbsent")}</div>
        ) : (
          <div className="obs-fd-chain-empty">{t("chainHeatLoading")}</div>
        )}
      </div>
    );
  }

  const campaigns = [...data.campaigns].sort(
    (a, b) => b.total_premium_mn - a.total_premium_mn
  );

  const threshold = data.threshold_mn ?? 3;
  const note = zh ? (data.note_zh ?? "") : (data.note_en ?? "");

  return (
    <div className="obs-card obs-fd-chain obs-scroll" data-tut="chain-heat">
      <div className="obs-card-hd">
        <span className="obs-lbl">{t("chainHeatTitle")}</span>
        <ArtifactSourceReceipt artifact={data} lang={lang} sessionDate={data.session_date} />
        <span className="obs-lbl" style={{ color: "var(--muted)" }}>
          {zh ? `≥$${threshold}M` : `≥$${threshold}M cumul`}
        </span>
      </div>

      {status === "unavailable" && (
        <div style={CHAIN_REFRESH_FAILED} data-testid="chainheat-refresh-failed" role="status">
          <span>{t("chainHeatRefreshFailed")}</span>
          <button type="button" className="btn btn-ghost load-retry" style={RETRY_INLINE} onClick={onRetry}>
            {t("errRetry")}
          </button>
        </div>
      )}

      {note && <div className="obs-fd-chain-note">{note}</div>}

      {campaigns.length === 0 && (
        <div className="obs-fd-chain-empty">{t("chainHeatEmpty")}</div>
      )}

      {campaigns.map((c, idx) => (
        <ChainCampaignRow key={c.option_symbol} campaign={c} zh={zh} t={t} firstCampaign={idx === 0} />
      ))}
    </div>
  );
}

function ChainCampaignRow({
  campaign,
  zh,
  t,
  firstCampaign,
}: {
  campaign: ChainHeatCampaign;
  zh: boolean;
  t: (key: Parameters<ReturnType<typeof makeFlowT>>[0]) => string;
  firstCampaign?: boolean;
}) {
  const isCall = campaign.type === "CALL";
  const isContested = campaign.lean === "contested";

  // Lean label (soft, never buy/sell assertion)
  const leanLabel = campaign.lean === "accumulation"
    ? t("chainHeatLeanAccum")
    : campaign.lean === "distribution"
    ? t("chainHeatLeanDist")
    : t("chainHeatContested");

  // Premium magnitude formatting
  const premStr = `$${campaign.total_premium_mn.toFixed(1)}M`;
  const isBig = campaign.total_premium_mn >= 10;

  // Category proxy state: "none" (legacy payload) | "invalid" (claimed but
  // malformed) | "valid" (exact schema/basis + bounded finite share/mass).
  const proxyState = resolveCategoryProxy(campaign.category_proxy);
  const proxyW =
    proxyState.kind === "valid" && proxyState.share !== null
      ? Math.round(Math.min(1, Math.max(0, proxyState.share)) * 100)
      : 0;
  // Legacy numeric bar — shown ONLY when no new object is present, and clearly
  // labelled as legacy with coverage unavailable.  A legacy ask_share that is
  // not a finite 0..1 number renders as unavailable with NO fill (never NaN,
  // never a 0 fallback).  Never presented as "at ask" or a measured neutral.
  const legacyShareOk =
    typeof campaign.ask_share === "number" &&
    Number.isFinite(campaign.ask_share) &&
    campaign.ask_share >= 0 &&
    campaign.ask_share <= 1;
  const legacyBarW = legacyShareOk
    ? Math.round(Math.min(1, Math.max(0, campaign.ask_share)) * 100)
    : null;

  // First-seen time (ET)
  let firstSeenStr = "";
  try {
    firstSeenStr = new Date(campaign.first_seen).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: false,
      timeZone: "America/New_York",
    }) + " ET";
  } catch {
    firstSeenStr = campaign.first_seen.slice(11, 16);
  }

  return (
    <div className="obs-fd-chain-row" {...(firstCampaign ? { "data-tut": "chain-heat-campaign" } : {})}>
      {/* Row 1: ticker / type / strike / premium */}
      <div className="obs-fd-chain-row1">
        <span className="obs-fd-chain-ticker">{campaign.ticker}</span>
        <span className={`obs-fd-chain-cp ${isCall ? "call" : "put"}`}>
          {isCall ? t("chainHeatCall") : t("chainHeatPut")}
        </span>
        <span className="obs-fd-chain-strike">${campaign.strike} · {campaign.expiry.slice(5)}</span>
        <span className="obs-fd-chain-prem num" style={{ color: isBig ? "var(--signal)" : "var(--text)" }}>
          {premStr}
        </span>
      </div>

      {/* Row 2: lean chip + caveat */}
      <div className="obs-fd-chain-row2">
        <span
          className="obs-fd-chain-lean"
          style={{ color: isContested ? "var(--muted)" : "var(--text-2)" }}
        >
          {leanLabel}
        </span>
        <span className="obs-fd-chain-caveat">{t("chainHeatLeanNote")}</span>
      </div>

      {/* Row 3: stats */}
      <div className="obs-fd-chain-stats">
        <span>
          <span className="obs-fd-chain-stat-key">{t("chainHeatAlertCt")}</span>
          {" "}{campaign.alert_count}
        </span>
        <span>
          <span className="obs-fd-chain-stat-key">{t("chainHeatSpan")}</span>
          {" "}{campaign.span_minutes}m
        </span>
        <span>
          <span className="obs-fd-chain-stat-key">{t("chainHeatFirstSeen")}</span>
          {" "}{firstSeenStr}
        </span>
      </div>

      {/* Category proxy bar — additive; never a measured NBBO */}
      {proxyState.kind === "valid" ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--sp-1)" }}>
            <span className="obs-fd-chain-stat-key">{t("chainHeatAskShare")}</span>
            <span className="num" style={{ fontSize: "var(--fs-micro)", color: "var(--text-2)" }}>
              {proxyState.share === null ? t("chainHeatProxyUnavailable") : `${proxyW}%`}
            </span>
          </div>
          <div className="obs-fd-chain-askbar-track">
            {proxyState.share !== null && (
              <div className="obs-fd-chain-askbar-fill" style={{ width: `${proxyW}%` }} />
            )}
          </div>
          <div style={{ display: "grid", gap: "var(--sp-1)", marginTop: "var(--sp-1)" }}>
            <span className="obs-fd-chain-caveat">{t("chainHeatProxyNote")}</span>
            <span className="num" style={{ fontSize: "var(--fs-micro)", color: "var(--text-2)" }}>
              {t("chainHeatProxyCoverage")} {(proxyState.known / 1e6).toFixed(1)}M / {(proxyState.source / 1e6).toFixed(1)}M
            </span>
          </div>
        </div>
      ) : proxyState.kind === "invalid" ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--sp-1)" }}>
            <span className="obs-fd-chain-stat-key">{t("chainHeatAskShare")}</span>
            <span className="num" style={{ fontSize: "var(--fs-micro)", color: "var(--text-2)" }}>
              {t("chainHeatProxyUnavailable")}
            </span>
          </div>
          <div className="obs-fd-chain-askbar-track" />
          <div style={{ marginTop: "var(--sp-1)" }}>
            <span className="obs-fd-chain-caveat">{t("chainHeatProxyNote")}</span>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--sp-1)" }}>
            <span className="obs-fd-chain-stat-key">{t("chainHeatProxyLegacy")}</span>
            <span className="num" style={{ fontSize: "var(--fs-micro)", color: "var(--text-2)" }}>
              {legacyBarW === null ? t("chainHeatProxyUnavailable") : `${legacyBarW}%`}
            </span>
          </div>
          <div className="obs-fd-chain-askbar-track">
            {legacyBarW !== null && (
              <div className="obs-fd-chain-askbar-fill" style={{ width: `${legacyBarW}%` }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FlowDeskView ─────────────────────────────────────────────────────────────

export function FlowDeskView() {
  const { lang } = useLang();

  // ── Data state ──────────────────────────────────────────────────────────────
  // The order-flow tape rides the SSE transport (push) instead of a 30s poll; the
  // hook falls back to flowGet polling if SSE is unavailable, so this is never worse
  // than before. `feedConnected` describes only that transport; measured source
  // timing comes from live_flow.meta/v2 and is rendered separately. The SSE endpoint
  // pushes only on change (asof+size signature), so the old client-side asof dedup is
  // no longer needed.
  const { data: feed, connected: feedConnected } = useFlowStream<FeedPayload>("feed");
  const { data: flowMeta } = useFlowStream<unknown>("meta", { pollMs: 60_000 });
  const [tide,      setTide]      = useState<TidePayload | null>(null);
  const [chainHeat, setChainHeat] = useState<ChainHeatPayload | null>(null);
  const [chainHeatStatus, setChainHeatStatus] = useState<ChainHeatStatus>("loading");
  const [enrich,    setEnrich]    = useState<EnrichPayload | null>(null);


  // ── Selection state ──────────────────────────────────────────────────────────
  const [selectedEvent, setSelectedEvent] = useState<FlowEvent | null>(null);
  const [tickerCtx,     setTickerCtx]     = useState<TickerPayload | null>(null);

  // Stable reference so React.memo on FlowCard does not re-render all 200 cards
  // when the selection changes (an inline arrow at the JSX call site creates a new
  // reference on every render).
  const handleSelect = useCallback((ev: FlowEvent) => {
    setSelectedEvent((prev) => prev?.id === ev.id ? null : ev);
  }, []);

  // ── Watchlist ────────────────────────────────────────────────────────────────
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    return loadWatchlist();
  });

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<FlowFilters>(DEFAULT_FILTERS);

  // ── Tutorial ─────────────────────────────────────────────────────────────────
  const [tutOpen, setTutOpen] = useState(false);
  const autoPromptRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Polling refs ─────────────────────────────────────────────────────────────
  const tideTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const chainTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const enrichTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch functions ──────────────────────────────────────────────────────────

  const fetchTide = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    const data = await safeFetch<TidePayload>("/api/flow?f=tide");
    if (data) setTide(data);
  }, []);

  // Chain heat keeps the read's outcome: a 404 withdraws the campaigns, a read that
  // did not land keeps whatever was last read and says so.
  const mountedRef = useRef(true);
  const readChainHeat = useCallback(async () => {
    const outcome = await flowGetResult("chainheat");
    if (!mountedRef.current) return;
    if (outcome.status === "data" && isChainHeatPayload(outcome.data)) {
      setChainHeat(outcome.data);
      setChainHeatStatus("data");
    } else if (outcome.status === "absent") {
      setChainHeat(null);
      setChainHeatStatus("absent");
    } else {
      // A payload that is not chain heat must not be served again as if it were.
      if (outcome.status === "data") flowInvalidate("chainheat");
      setChainHeatStatus("unavailable");
    }
  }, []);

  const fetchChainHeat = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    await readChainHeat();
  }, [readChainHeat]);

  // Retry is the reader's own request, so it is not visibility-guarded.
  const retryChainHeat = useCallback(() => {
    flowInvalidate("chainheat");
    setChainHeatStatus("loading");
    void readChainHeat();
  }, [readChainHeat]);

  /** Fetch enrich artifact — fail-soft (absent/stale → null → v1 fallback in UI)
   *
   * Stale rule: source_asof >16h old → treat as absent (v1 fallback, tier chips hidden).
   * `asof` and `built_at` are never freshness fallbacks: older publishers rewrote
   * those build clocks while the source feed stayed unchanged.
   * Exception: source === "fixture" → skip stale gate (dev mode fixture data
   * carries a fixed historical asof but is always current for UI testing).
   * Published stale artifacts are detected by the route emitting `stale: true`.
   */
  const fetchEnrich = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await safeFetch<any>("/api/flow?f=enrich");
    if (!raw) return;
    let normalized: EnrichPayload;
    try { normalized = normalizeEnrichPayload(raw); } catch { return; }
    const sourceAgeMs = artifactSourceAgeMs(normalized, Date.now());
    if (sourceAgeMs === null) { setEnrich(null); return; }
    const src = (raw as Record<string, unknown>).source as string | undefined;
    if (src === "fixture") { setEnrich(normalized); return; }
    const ageH = sourceAgeMs / 3_600_000;
    if (ageH > 16) { setEnrich(null); return; }
    setEnrich(normalized);
  }, []);

  const fetchTickerCtx = useCallback(async (root: string) => {
    setTickerCtx(null);
    const data = await safeFetch<TickerPayload>(`/api/flow?f=ticker:${root}`);
    // Fixture honest-empty {} (unknown root) has no `day`; InspectorPane derefs
    // day.gross behind a truthiness check, so a day-less payload must stay null.
    if (data?.day) setTickerCtx(data);
  }, []);

  // ── Mount: initial fetch + polling ───────────────────────────────────────────

  useEffect(() => {
    // Initial fetches (bypass visibility guard on mount).
    // feed is streamed via useFlowStream — bootstrap only the still-polled feeds.
    //
    // PERF (v7b): the enrich artifact is deliberately NOT in this batch. It is
    // 3.2 MB in production and is a pure ENHANCEMENT layer (tier chips + v2
    // detections; fetchEnrich below documents the v1 fallback when it is absent),
    // yet it used to compete for bandwidth with the desk's own ~2 MB feed SSE
    // frame — i.e. the artifact nobody needs for the first cards delayed the one
    // that draws them. It now loads on the first idle slice after mount, once the
    // feed has had the pipe to itself.
    mountedRef.current = true;
    void (async () => {
      const [ti] = await Promise.all([
        safeFetch<TidePayload>("/api/flow?f=tide"),
        readChainHeat(),
      ]);
      if (ti) setTide(ti);
    })();

    // Deferred enrich bootstrap — same stale gate as the fetchEnrich poll, minus
    // the visibility guard (this is the one-shot bootstrap).
    const cancelIdle = whenIdle(() => {
      void (async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const en = await safeFetch<any>("/api/flow?f=enrich");
        if (!en) return;
        let normalizedEn: EnrichPayload | null = null;
        try { normalizedEn = normalizeEnrichPayload(en); } catch { /* ignore */ }
        if (!normalizedEn) return;
        const sourceAgeMs = artifactSourceAgeMs(normalizedEn, Date.now());
        if (sourceAgeMs === null) {
          setEnrich(null);
          return;
        }
        const src = (en as Record<string, unknown>).source as string | undefined;
        if (src === "fixture") {
          setEnrich(normalizedEn);
          return;
        }
        const ageH = sourceAgeMs / 3_600_000;
        if (ageH <= 16) setEnrich(normalizedEn);
        else setEnrich(null);
      })();
    });

    tideTimerRef.current   = setInterval(fetchTide,      TIDE_POLL_MS);
    chainTimerRef.current  = setInterval(fetchChainHeat, CHAIN_POLL_MS);
    // Enrich polls at 5-min cadence (offset from feed)
    enrichTimerRef.current = setInterval(fetchEnrich, 5 * 60_000);

    return () => {
      mountedRef.current = false;
      cancelIdle();
      if (tideTimerRef.current)   clearInterval(tideTimerRef.current);
      if (chainTimerRef.current)  clearInterval(chainTimerRef.current);
      if (enrichTimerRef.current) clearInterval(enrichTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Ticker context fetch on event selection ───────────────────────────────────

  useEffect(() => {
    if (selectedEvent) {
      void fetchTickerCtx(selectedEvent.root);
    } else {
      setTickerCtx(null);
    }
  }, [selectedEvent, fetchTickerCtx]);

  // ── Watchlist handlers ────────────────────────────────────────────────────────

  const handleToggleTicker = useCallback((root: string) => {
    setWatchlist((prev) => {
      const next = prev.includes(root)
        ? prev.filter((t) => t !== root)
        : [...prev, root];
      saveWatchlist(next);
      return next;
    });
  }, []);

  const handlePickTicker = useCallback((root: string) => {
    // Selecting a ticker from the watchlist selects its most recent event (latest timestamp)
    if (!feed) return;
    const eventsForRoot = feed.events.filter((ev) => ev.root === root);
    if (eventsForRoot.length === 0) return;
    // Pick the event with the latest timestamp
    const ev = eventsForRoot.reduce((best, cur) =>
      new Date(cur.ts) > new Date(best.ts) ? cur : best
    );
    setSelectedEvent(ev);
  }, [feed]);

  // ── WatchlistRail needs typed unusual_names ────────────────────────────────────

  const feedForWatchlist = feed
    ? {
        ...feed,
        unusual_names: (feed.unusual_names ?? []) as {
          root: string;
          gross_premium_today: number;
          prem_z: number | null;
          call_prem_share: number;
        }[],
      }
    : null;

  // ── FlowGauge needs feed with typed events ────────────────────────────────────

  const feedForGauge = feed ?? { events: [], session_pct: undefined };

  // ── RadarStrip needs feed with typed unusual_names ────────────────────────────

  const feedForRadar = feed
    ? {
        unusual_names: (feed.unusual_names ?? []) as {
          root: string;
          group: string;
          group_zh: string;
          gross_premium_today: number;
          prem_z: number | null;
          baseline_source: string;
          n_obs: number;
          call_prem_share: number;
          top_contracts: { right: "C" | "P"; exp: string; strike: number; premium: number }[];
        }[],
        baseline_note: feed.baseline_note,
      }
    : { unusual_names: [], baseline_note: undefined };

  // ── Auto-prompt tutorial exactly once per browser (gate on seen flag) ────────
  // We check TUTORIAL_SEEN_KEY (not TUTORIAL_KEY) so that a user who opens and
  // then closes/skips the overlay without completing a module is still marked as
  // having seen the auto-prompt and does not see it again on the next /flow visit.
  useEffect(() => {
    let alreadySeen = false;
    try {
      alreadySeen = localStorage.getItem(TUTORIAL_SEEN_KEY) !== null;
    } catch {}
    if (!alreadySeen) {
      // Mark as seen immediately — before the timeout fires — so that even if the
      // component unmounts before the delay elapses the flag is persisted.
      try {
        localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
      } catch {}
      autoPromptRef.current = setTimeout(() => {
        setTutOpen(true);
      }, AUTO_PROMPT_DELAY_MS);
    }
    return () => {
      if (autoPromptRef.current) clearTimeout(autoPromptRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="obs obs-ambient obs-flowdesk">

      {/* ═══ LEFT RAIL (FlowGauge strip + WatchlistRail + Smart Money Radar) ═ */}
      <div className="obs-fd-left">
        {/* FlowGauge — slim strip pinned at top of left rail */}
        <FlowGauge feed={feedForGauge} lang={lang} />

        {/* WatchlistRail — compacted rings (26px) + tighter rows */}
        {feedForWatchlist && (
          <WatchlistRail
            feed={feedForWatchlist}
            tide={tide}
            lang={lang}
            watchlist={watchlist}
            onToggleTicker={handleToggleTicker}
            onPickTicker={handlePickTicker}
            onOpenTutorial={() => setTutOpen(true)}
          />
        )}
        {!feedForWatchlist && <div className="fin-skel" style={RAIL_LOADING} aria-hidden="true" />}

        {/* Smart Money Radar — fills remaining left-rail height, obs-scroll inside */}
        {feedForRadar.unusual_names.length > 0 && (
          <RadarStrip feed={feedForRadar} lang={lang} />
        )}
      </div>

      {/* ═══ CENTER — feed ONLY (toolbar + card grid) ════════════════════════ */}
      <div className="obs-fd-center">
        {/* FeedPane takes full center column height */}
        <FeedPane
          feed={feed}
          connected={feedConnected}
          flowMeta={flowMeta}
          enrich={enrich}
          lang={lang}
          selectedId={selectedEvent?.id ?? null}
          onSelect={handleSelect}
          filters={filters}
          onFiltersChange={setFilters}
        />
      </div>

      {/* ═══ RIGHT RAIL — Chain Heat FIRST, then Inspector ═══════════════════
          `has-sel` hands the height budget to the Inspector once an event is
          selected (Chain Heat keeps the rail when nothing is). */}
      <div className={`obs-fd-right${selectedEvent ? " has-sel" : ""}`}>
        {/* Chain Heat Rail — top of right column, scrollable */}
        <ChainHeatRail data={chainHeat} status={chainHeatStatus} onRetry={retryChainHeat} lang={lang} />

        {/* Inspector — slim one-line hint when nothing selected; full view on click */}
        <InspectorPane
          event={selectedEvent}
          tickerCtx={tickerCtx}
          enrichEv={selectedEvent ? (enrich?.events[selectedEvent.id] ?? null) : null}
          lang={lang}
        />
      </div>

      {/* Tutorial overlay (portal-like; renders above everything) */}
      {tutOpen && (
        <TutorialOverlay
          open={tutOpen}
          onClose={() => setTutOpen(false)}
        />
      )}

    </div>
  );
}

// ─── Layout styles ────────────────────────────────────────────────────────────

// Left-rail placeholder while the first feed payload lands — a shimmer skeleton
// rather than an unexplained blank panel (doctrine: never a mute blank).
const RAIL_LOADING: React.CSSProperties = {
  height: 220,
  margin: "var(--sp-2) 0",
  borderRadius: "var(--r-card)",
};

// ChainHeat styles moved to observatory.css (.obs-fd-chain-*)
