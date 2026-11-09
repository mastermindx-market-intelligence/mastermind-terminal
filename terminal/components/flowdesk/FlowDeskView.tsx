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
import { feedEvents } from "../../lib/flowPrintInspector";
import { WatchlistRail } from "./WatchlistRail";
import styles from "./CommandWorkspace.module.css";
import { RadarStrip } from "./RadarStrip";
import { FlowGauge } from "./FlowGauge";
import { FeedPane, type FlowEvent, type FeedPayload, type EnrichPayload, normalizeEnrichPayload } from "./FeedPane";
import { InspectorPane } from "./InspectorPane";
import { DEFAULT_FILTERS, type FlowFilters } from "./FiltersPanel";
import { TutorialOverlay } from "../tutorial/TutorialOverlay";
import { ArtifactSourceReceipt } from "./FlowFreshnessReceipt";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { pick } from "@/lib/finFormat";
import { createDefaultTapeView, encodeTapeView } from "@/lib/optionsTapeView";
import heat from "./ChainHeat.module.css";

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
  const rail = useRef<HTMLDivElement>(null);
  const activeTab = useSearchParams()?.get("tab");
  const session = data?.session_date ?? data?.asof?.slice(0, 10);

  // The return target belongs to this history entry. A fresh desk or another
  // market session must never inherit focus from a previous investigation.
  useEffect(() => {
    const state = window.history.state;
    const target = state?.commandChainReturn;
    if (!data || !target || target.session !== session) return;
    const row = Array.from(rail.current?.querySelectorAll<HTMLDetailsElement>("[data-campaign-symbol]") ?? [])
      .find(element => element.dataset.campaignSymbol === target.symbol);
    if (!row) return;
    const frame = requestAnimationFrame(() => {
      row.open = true;
      row.querySelector("summary")?.focus();
      const restored = { ...window.history.state };
      delete restored.commandChainReturn;
      window.history.replaceState(restored, "");
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, data, session]);


  if (!data) {
    return (
      <div className="obs-card obs-fd-chain obs-scroll" data-tut="chain-heat" tabIndex={-1}>
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
    <div ref={rail} className="obs-card obs-fd-chain obs-scroll" data-tut="chain-heat" tabIndex={-1}>
      <div className={heat.heading}>
        <div className={heat.headingLine}>
          <span className="obs-lbl">{t("chainHeatTitle")}</span>
          <span className={heat.count}>{campaigns.length} {pick(zh, campaigns.length === 1 ? "contract" : "contracts", "个合约")}</span>
          <span className={heat.threshold}>
            {pick(zh, "Premium", "权利金")} ≥${threshold}M
          </span>
        </div>
        <ArtifactSourceReceipt artifact={data} lang={lang} sessionDate={data.session_date} />
      </div>

      {status === "unavailable" && (
        <div style={CHAIN_REFRESH_FAILED} data-testid="chainheat-refresh-failed" role="status">
          <span>{t("chainHeatRefreshFailed")}</span>
          <button type="button" className="btn btn-ghost load-retry" style={RETRY_INLINE} onClick={onRetry}>
            {t("errRetry")}
          </button>
        </div>
      )}

      {note && (
        <details className={heat.source}>
          <summary>{pick(zh, "Source notes", "来源说明")}</summary>
          <p>{note}</p>
        </details>
      )}

      {campaigns.length === 0 && (
        <div className="obs-fd-chain-empty">{pick(zh, "No campaigns today", "本时段无合约集群")}</div>
      )}

      {campaigns.map((c, idx) => (
        <ChainCampaignRow key={c.option_symbol} campaign={c} session={session} zh={zh} t={t} firstCampaign={idx === 0} />
      ))}
    </div>
  );
}

function tickerTapeHref(ticker: string): string | null {
  try {
    const tapeView = encodeTapeView({ ...createDefaultTapeView(), drillTicker: ticker });
    return `/options?${new URLSearchParams({ tab: "tape", tapeView })}`;
  } catch {
    return null; // An unsupported root cannot link to an unfiltered tape.
  }
}

function ChainCampaignRow({
  campaign,
  session,
  zh,
  t,
  firstCampaign,
}: {
  campaign: ChainHeatCampaign;
  session?: string;
  zh: boolean;
  t: (key: Parameters<ReturnType<typeof makeFlowT>>[0]) => string;
  firstCampaign?: boolean;
}) {
  const isCall = campaign.type === "CALL";
  // Lean label (soft, never buy/sell assertion)
  const leanLabel = campaign.lean === "accumulation"
    ? t("chainHeatLeanAccum")
    : campaign.lean === "distribution"
    ? t("chainHeatLeanDist")
    : t("chainHeatContested");

  const premStr = `$${campaign.total_premium_mn.toFixed(1)}M`;
  const tapeHref = tickerTapeHref(campaign.ticker);
  // A malformed modern proxy cannot inherit a legacy bar.
  const proxyState = resolveCategoryProxy(campaign.category_proxy);
  let rawShare: number | null = null;
  if (proxyState.kind === "none") rawShare = campaign.ask_share;
  if (proxyState.kind === "valid") rawShare = proxyState.share;
  const share = typeof rawShare === "number" && Number.isFinite(rawShare) && rawShare >= 0 && rawShare <= 1
    ? Math.round(rawShare * 100)
    : null;

  const observedAt = new Date(campaign.first_seen);
  const firstSeen = Number.isFinite(observedAt.getTime())
    ? observedAt.toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit", timeZone: "America/New_York",
      }) + " ET"
    : "—";

  return (
    <details data-campaign-symbol={campaign.option_symbol} className={`obs-fd-chain-row ${heat.campaign}`} {...(firstCampaign ? { "data-tut": "chain-heat-campaign" } : {})}>
      <summary className={heat.contract}>
        <span className={heat.identity}>
          <span className="obs-fd-chain-ticker">{campaign.ticker}</span>
          <span className={heat.option}>{t(isCall ? "chainHeatCall" : "chainHeatPut")} ${campaign.strike}</span>
        </span>
        <strong className={`num ${heat.premium}`}>{premStr}</strong>
        <span className={heat.expiry}>
          <time dateTime={campaign.expiry}>{campaign.expiry}</time>
          <span aria-hidden="true"> · </span>
          {campaign.alert_count} {t("chainHeatAlertCt")}
        </span>
        <span aria-hidden="true" className={heat.chevron} />
      </summary>

      <div className={heat.breakdown}>
        <dl className={heat.stats}>
          <div><dt>{t("chainHeatFirstSeen")}</dt><dd>{firstSeen}</dd></div>
          <div><dt>{t("chainHeatSpan")}</dt><dd>{campaign.span_minutes}m</dd></div>
          <div><dt>{pick(zh, "Inferred lean", "推测倾向")}</dt><dd>{leanLabel}</dd></div>
        </dl>
        <div className={heat.proxyLine}>
          <span>{t(proxyState.kind === "none" ? "chainHeatProxyLegacy" : "chainHeatAskShare")}</span>
          <strong>{share === null ? t("chainHeatProxyUnavailable") : `${share}%`}</strong>
        </div>
        {share !== null && (
          <div className="obs-fd-chain-askbar-track" aria-hidden="true">
            <div className="obs-fd-chain-askbar-fill" style={{ width: `${share}%` }} />
          </div>
        )}
        {proxyState.kind === "valid" && (
          <span className={heat.coverage}>{t("chainHeatProxyCoverage")} {(proxyState.known / 1e6).toFixed(1)}M / {(proxyState.source / 1e6).toFixed(1)}M</span>
        )}
        <span className="obs-fd-chain-caveat">{t("chainHeatProxyNote")}</span>
        {tapeHref && (
          <Link href={tapeHref} prefetch={false} className={heat.tapeLink}
            onNavigate={() => window.history.replaceState({
              ...window.history.state, commandChainReturn: { symbol: campaign.option_symbol, session },
            }, "")}>
            {pick(zh, "View {ticker} tape", "查看 {ticker} 成交流").replace("{ticker}", campaign.ticker)}
            <span aria-hidden="true">↗</span>
          </Link>
        )}
      </div>
    </details>
  );
}

// ─── FlowDeskView ─────────────────────────────────────────────────────────────

function reveal(target: HTMLElement | null) {
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

export function FlowDeskView() {
  const { lang } = useLang();
  const t = makeFlowT(lang);

  // ── Data state ──────────────────────────────────────────────────────────────
  // The order-flow tape rides the SSE transport (push) instead of a 30s poll; the
  // hook falls back to flowGet polling if SSE is unavailable, so this is never worse
  // than before. `feedConnected` describes only that transport; measured source
  // timing comes from live_flow.meta/v2 and is rendered separately. The SSE endpoint
  // pushes only on change (asof+size signature), so the old client-side asof dedup is
  // no longer needed.
  const { data: feed, connected: feedConnected, status: feedStatus, stale: feedStale, retry: retryFeed } = useFlowStream<FeedPayload>("feed");
  const { data: flowMeta } = useFlowStream<unknown>("meta", { pollMs: 60_000 });
  const [tide,      setTide]      = useState<TidePayload | null>(null);
  const [chainHeat, setChainHeat] = useState<ChainHeatPayload | null>(null);
  const [chainHeatStatus, setChainHeatStatus] = useState<ChainHeatStatus>("loading");
  const [enrich,    setEnrich]    = useState<EnrichPayload | null>(null);


  // ── Selection state ──────────────────────────────────────────────────────────
  const [selectedEvent, setSelectedEvent] = useState<FlowEvent | null>(null);
  const [tickerCtx, setTickerCtx] = useState<TickerPayload | null>(null);
  const selectedRoot = selectedEvent?.root ?? null;
  const feedRef = useRef<HTMLDivElement>(null);
  const marketRef = useRef<HTMLDivElement>(null);
  const researchRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const guideButton = useRef<HTMLButtonElement>(null);

  const returnToFeed = useCallback(() => {
    const target = opener.current?.isConnected ? opener.current : feedRef.current;
    setSelectedEvent(null);
    reveal(target);
  }, []);

  // Stable reference so React.memo on FlowCard does not re-render all 200 cards
  // when the selection changes (an inline arrow at the JSX call site creates a new
  // reference on every render).
  const handleSelect = useCallback((ev: FlowEvent) => {
    opener.current = document.getElementById(`inspect-flow-${ev.id}`);
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
    let current = true;
    setTickerCtx(null);
    if (selectedRoot) {
      void safeFetch<TickerPayload>(`/api/flow?f=ticker:${selectedRoot}`).then((data) => {
        if (current && data?.root === selectedRoot && data.day) setTickerCtx(data);
      });
    }
    return () => { current = false; };
  }, [selectedRoot]);

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
    // Read through the one tape guard: a malformed `events` is no prints, so nothing is picked.
    const eventsForRoot = feedEvents(feed).filter((ev) => ev?.root === root);
    if (eventsForRoot.length === 0) return;
    // Pick the event with the latest timestamp
    const ev = eventsForRoot.reduce((best, cur) =>
      new Date(cur.ts) > new Date(best.ts) ? cur : best
    );
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className={`obs obs-ambient obs-flowdesk ${styles.desk}`}>
      <header className={styles.heading}>
        <div className={styles.title}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M2 15h4l3-9 4 13 3-10 2 4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>
          <h2>{t("tabFlow")}</h2>
        </div>
        <button type="button" className={styles.guide} ref={guideButton} onClick={() => setTutOpen(true)}>
          {pick(lang === "zh", "Desk guide", "工作台指南")}
        </button>
      </header>
      <nav className={styles.sectionLinks} aria-label={pick(lang === "zh", "Flow Desk sections", "资金流工作台区域")}>
        <button onClick={() => reveal(feedRef.current)}>{pick(lang === "zh", "Flow feed", "资金流事件")}</button>
        <button onClick={() => reveal(researchRef.current?.querySelector<HTMLElement>('[data-tut="chain-heat"]') ?? researchRef.current)}>{t("chainHeatTitle")}</button>
        <button onClick={() => reveal(marketRef.current)}>{pick(lang === "zh", "Session & watchlist", "时段与自选")}</button>
      </nav>

      {/* ═══ LEFT RAIL (FlowGauge strip + WatchlistRail + Smart Money Radar) ═ */}
      <div ref={marketRef} tabIndex={-1} role="region" aria-label={pick(lang === "zh", "Session and watchlist", "时段与自选")} className="obs-fd-left">
        {/* FlowGauge — slim strip pinned at top of left rail. Unknown is not zero: with
            no feed there is no session total or call/put split to draw, so the gauge is
            not rendered and the rail states below say what the read established. */}
        {feed !== null && (
          <div data-testid="flow-gauge-slot" style={{ display: "contents" }}>
            {/* Held exactly when the feed list says its cards are the last read. */}
            <FlowGauge
              feed={feed}
              lang={lang}
              held={feedStale && (feedStatus === "unavailable" || feedStatus === "absent")}
            />
          </div>
        )}

        {/* WatchlistRail — compacted rings (26px) + tighter rows */}
        {feedForWatchlist && (
          <WatchlistRail
            feed={feedForWatchlist}
            tide={tide}
            lang={lang}
            watchlist={watchlist}
            onToggleTicker={handleToggleTicker}
            onPickTicker={handlePickTicker}
          />
        )}
        {/* A feed the desk could not read is not an endless skeleton (UI-truth law):
            unavailable says what failed, absent says nothing is published, and only
            a genuine in-flight read keeps the loading skeleton. */}
        {!feedForWatchlist && feedStatus === "unavailable" && (
          <div className="obs-card" data-testid="watchlist-feed-unavailable" role="status" style={WATCHLIST_FEED_STATE}>
            {t("watchlistFeedUnavailable")}
          </div>
        )}
        {!feedForWatchlist && feedStatus === "absent" && (
          <div className="obs-card" data-testid="watchlist-feed-absent" role="status" style={WATCHLIST_FEED_STATE}>
            {t("feedAbsent")}
          </div>
        )}
        {!feedForWatchlist && feedStatus !== "unavailable" && feedStatus !== "absent" && (
          <div className="fin-skel" style={RAIL_LOADING} aria-hidden="true" />
        )}

        {/* Smart Money Radar — fills remaining left-rail height, obs-scroll inside */}
        {feedForRadar.unusual_names.length > 0 && (
          <RadarStrip feed={feedForRadar} lang={lang} />
        )}
      </div>

      {/* ═══ CENTER — feed ONLY (toolbar + card grid) ════════════════════════ */}
      <div ref={feedRef} tabIndex={-1} aria-label={pick(lang === "zh", "Flow feed", "资金流事件")} role="region" className="obs-fd-center">
        {/* FeedPane takes full center column height */}
        <FeedPane
          feed={feed}
          connected={feedConnected}
          status={feedStatus}
          stale={feedStale}
          onRetry={retryFeed}
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
      <div ref={researchRef} tabIndex={-1} role="region" aria-label={pick(lang === "zh", "Contract research", "合约研究")} className={`obs-fd-right${selectedEvent ? " has-sel" : ""}`}>
        {/* Chain Heat Rail — top of right column, scrollable */}
        <ChainHeatRail data={chainHeat} status={chainHeatStatus} onRetry={retryChainHeat} lang={lang} />

        {/* Inspector — slim one-line hint when nothing selected; full view on click */}
        <InspectorPane
          event={selectedEvent}
          tickerCtx={tickerCtx?.root === selectedRoot ? tickerCtx : null}
          onReturn={returnToFeed}
          enrichEv={selectedEvent ? (enrich?.events[selectedEvent.id] ?? null) : null}
          lang={lang}
        />
      </div>

      {/* Tutorial overlay (portal-like; renders above everything) */}
      {tutOpen && (
        <TutorialOverlay
          open={tutOpen}
          onClose={() => { setTutOpen(false); guideButton.current?.focus(); }}
        />
      )}

    </div>
  );
}

// ─── Layout styles ────────────────────────────────────────────────────────────

// Left-rail placeholder while the first feed payload lands — a shimmer skeleton
// rather than an unexplained blank panel (doctrine: never a mute blank).
// Neutral note for the left rail when the flow feed did not land — existing card
// surface, muted text, no new colour.
const WATCHLIST_FEED_STATE: React.CSSProperties = {
  padding: 16,
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--muted)",
};
const RAIL_LOADING: React.CSSProperties = {
  height: 220,
  margin: "var(--sp-2) 0",
  borderRadius: "var(--r-card)",
};

// ChainHeat styles moved to observatory.css (.obs-fd-chain-*)
