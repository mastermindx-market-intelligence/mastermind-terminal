"use client";
/**
 * FeedPane — center feed pane for the Flow Desk.
 *
 * Presentational only — no fetching, no global state.
 * All filtering, sorting, and view-preset persistence happens here.
 * LocalStorage key: 'flowdesk.views' (view preset + sort).
 *
 * HONESTY DOCTRINE: rank by MAGNITUDE and score tier; direction is a soft lean
 * chip with tooltip — never green/red assertion. See FlowCard.tsx for badge
 * derivation; see FiltersPanel for lean-filter labeling.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { FlowCard } from "./FlowCard";
import { FiltersPanel, DEFAULT_FILTERS } from "./FiltersPanel";
import type { FlowFilters } from "./FiltersPanel";
import { trackSearch } from "@/lib/searchTrack";
import { pick } from "@/lib/finFormat";
import { FD } from "@/lib/flowdeskStrings";
import { usOptionsSessionState } from "@/lib/flowFreshness";
import { FlowFreshnessReceipt } from "./FlowFreshnessReceipt";
import { useT } from "@/lib/i18n";
import {
  buildFlowProjection,
  selectFlowProjectionBucket,
  type FlowProjectionIntervalMinutes,
} from "@/lib/flowProjection";

// ── Re-export shared types so FlowCard / FiltersPanel import from one place ──

export type DteBucket = "0d" | "1_7d" | "8_30d" | "31_90d" | "90p";
export type MnyBucket = "itm" | "atm" | "near_otm" | "far_otm";
export type Side = "~buy" | "~sell" | "mixed";

// ── Public flow-score shape (attached server-side by /api/flow) ───────────────
// The scoring MODEL (weights/curves) lives in lib/flowScore.ts and runs only on
// the server; the client receives just this computed result per event. `weight`
// is deliberately absent — the server omits it (see route.ts attachFlowScores).
export type ScoreTier = "ELITE" | "STRONG" | "HIGH" | "MEDIUM" | "LOW";
export interface FlowScoreComponent {
  key: string;
  label: string;
  value: number;
}
export interface FlowScore {
  score: number;
  tier: ScoreTier;
  components: FlowScoreComponent[];
}

/** Single flow event from feed_current.json `events[]` */
export interface FlowEvent {
  id: string;
  ts: string;
  root: string;
  group: string;
  group_zh: string;
  right: "C" | "P";
  exp: string;
  strike: number;
  dte: number;
  dte_bucket: DteBucket;
  mny_bucket: MnyBucket;
  side: Side;
  n_prints: number;
  size: number;
  avg_price: number;
  premium: number;
  premium_z: number | null;
  baseline_source: string;
  vol_gt_oi: boolean | null;
  repeated: boolean;
  zerodte: boolean;
  signing_source: string;
  swept?: boolean;
  // Optional enriched fields (may be absent on older feed payloads)
  oi?: number | null;
  iv?: number | null;
  spot?: number | null;
  /** Precomputed flow_score_v1 result, attached server-side by /api/flow.
   *  Optional so the UI degrades gracefully if a payload predates scoring. */
  flowScore?: FlowScore;
}

// ── v2 enrich types ──────────────────────────────────────────────────────────

/** Badge names from flow.enrich/v1 */
export type EnrichBadge =
  | "MULTI_LEG"
  | "LADDER"
  | "REPEAT_HITTER"
  | "SIZE_VS_OI"
  | "WHALE"
  | "FRESH"
  | "Z_OUTLIER"
  | "OI_CONFIRMED";

/**
 * Per-event enrichment record (normalized).
 * Real artifact ships why/why_zh as plain strings (pipe-separated badge
 * reasons). After normalization these are ready to display directly.
 */
export interface EnrichEvent {
  badges: EnrichBadge[];
  direction_discounted: boolean;
  /** Session quality tier from the enrich pipeline (e.g. "elite", "strong", "high", "medium", "below_medium") */
  session_tier: string;
  /** Raw Q-score (0-100) from the pipeline */
  q_score: number;
  /** EN explanation string (pipe-separated badge reasons, or empty) */
  why: string;
  /** ZH explanation string, if available */
  why_zh?: string;
}

export interface EnrichThresholds {
  elite: number;
  strong: number;
  high: number;
  medium: number;
}

/** Top-level enrich artifact (flow.enrich/v1) — normalized shape */
export interface EnrichPayload {
  schema?: string;
  asof: string;
  source_asof?: string;
  built_at?: string;
  session_date?: string;
  thresholds: EnrichThresholds;
  /** keyed by event id (normalized from list) */
  events: Record<string, EnrichEvent>;
  confirmed_yesterday?: { id: string; root: string; contract: string; oi_change: number }[];
}

/**
 * Normalize the raw enrich artifact from the API into EnrichPayload.
 *
 * Handles two schema divergences between the real R2 artifact and the
 * types the UI expects:
 *   (a) events may be a LIST [{id,...}] instead of a DICT keyed by id
 *   (b) threshold keys ship without the "_q" suffix (elite not elite_q)
 *
 * Call this immediately after fetching — all downstream code receives the
 * normalized shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeEnrichPayload(raw: any): EnrichPayload {
  if (!raw || typeof raw !== "object") throw new Error("enrich: null payload");

  // Normalize thresholds — real API: {elite,strong,high,medium}
  // Old fixture used {elite_q,strong_q,high_q,medium_q} — accept both.
  const rawT = raw.thresholds ?? {};
  const thresholds: EnrichThresholds = {
    elite:  rawT.elite  ?? rawT.elite_q  ?? 69,
    strong: rawT.strong ?? rawT.strong_q ?? 62,
    high:   rawT.high   ?? rawT.high_q   ?? 57,
    medium: rawT.medium ?? rawT.medium_q ?? 52,
  };

  // Normalize events — real API: list; fixture may be dict
  let eventsDict: Record<string, EnrichEvent> = {};
  const rawEvents = raw.events;
  if (Array.isArray(rawEvents)) {
    // Real production shape: list of event objects with inline enrichment
    for (const ev of rawEvents) {
      if (!ev?.id) continue;
      eventsDict[ev.id] = {
        badges: ev.badges ?? [],
        direction_discounted: ev.direction_discounted ?? false,
        session_tier: ev.session_tier ?? "",
        q_score: ev.q_score ?? 0,
        why: typeof ev.why === "string" ? ev.why : "",
        why_zh: typeof ev.why_zh === "string" ? ev.why_zh : undefined,
      };
    }
  } else if (rawEvents && typeof rawEvents === "object") {
    // Legacy fixture shape: dict keyed by id
    for (const [id, ev] of Object.entries(rawEvents)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = ev as any;
      // fixture why may be a dict (old fixture) or string (new)
      let why = "";
      let why_zh: string | undefined;
      if (typeof e.why === "string") {
        why = e.why;
        why_zh = typeof e.why_zh === "string" ? e.why_zh : undefined;
      } else if (e.why && typeof e.why === "object") {
        // Old fixture: why is a dict of badge→string; concatenate
        why = Object.entries(e.why as Record<string, string>)
          .filter(([k]) => !k.endsWith("_zh"))
          .map(([, v]) => v)
          .join(" | ");
        why_zh = Object.entries(e.why as Record<string, string>)
          .filter(([k]) => k.endsWith("_zh"))
          .map(([, v]) => v)
          .join(" | ") || undefined;
      }
      eventsDict[id] = {
        badges: e.badges ?? [],
        direction_discounted: e.direction_discounted ?? false,
        session_tier: e.session_tier ?? "",
        q_score: e.q_score ?? e.q_pctl ?? 0,
        why,
        why_zh,
      };
    }
  }

  return {
    schema: raw.schema,
    asof: raw.asof ?? "",
    source_asof: typeof raw.source_asof === "string" ? raw.source_asof : undefined,
    built_at: typeof raw.built_at === "string" ? raw.built_at : undefined,
    session_date: raw.session_date,
    thresholds,
    events: eventsDict,
    confirmed_yesterday: raw.confirmed_yesterday,
  };
}

/** Top-level feed payload */
export interface FeedPayload {
  schema?: string;
  asof: string;
  session_date?: string;
  session_pct?: number;
  baseline_note?: { en: string; zh: string };
  events: FlowEvent[];
  unusual_names?: unknown[];
  stale?: boolean;
}

// ── View presets ──────────────────────────────────────────────────────────────

type ViewPreset = "ALL" | "ELITE" | "WHALES" | "0DTE" | "SWEEPS";

interface PersistedPrefs {
  preset: ViewPreset;
  sort: SortMode;
}

const STORAGE_KEY = "flowdesk.views";

type SortMode = "NEW" | "SCORE";

function loadPrefs(): PersistedPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PersistedPrefs;
  } catch {
    // localStorage unavailable (SSR / private mode) — use defaults
  }
  return { preset: "ALL", sort: "NEW" };
}

function savePrefs(p: PersistedPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

// ── Preset → filter overrides ─────────────────────────────────────────────────

function presetFilters(preset: ViewPreset): Partial<FlowFilters> {
  switch (preset) {
    case "ELITE":
      // v2: ELITE is session_tier-based (top 2% + premium ≥$1M).
      // Filtering happens in the pipeline via enrich data.
      // When enrich is absent, fall back to minPremium gate so preset is never vacuous.
      return {};
    case "WHALES":
      // Whale = premium >= $1M; we use minPremium gate as a proxy
      return { minPremium: 1_000_000 };
    case "0DTE":
      return { dteBuckets: ["0d"] };
    case "SWEEPS":
      return { badges: new Set(["sweep" as const]) };
    default:
      return {};
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface FeedPaneProps {
  feed: FeedPayload | null;
  /** SSE transport state only; never interpreted as producer freshness. */
  connected?: boolean;
  /** Strict measured timing is accepted only from live_flow.meta/v2. */
  flowMeta?: unknown;
  enrich: EnrichPayload | null;
  lang: "en" | "zh";
  selectedId: string | null;
  onSelect: (ev: FlowEvent) => void;
  filters: FlowFilters;
  onFiltersChange: (next: FlowFilters) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FeedPane({
  feed,
  connected,
  flowMeta,
  enrich,
  lang,
  selectedId,
  onSelect,
  filters,
  onFiltersChange,
}: FeedPaneProps) {
  const zh = lang === "zh";
  const t = useT();

  // Persist preset + sort across page loads
  const [prefs, setPrefs] = useState<PersistedPrefs>(() => loadPrefs());

  const { preset, sort } = prefs;

  function updatePrefs(next: Partial<PersistedPrefs>) {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    savePrefs(merged);
  }

  // Ticker search
  const [search, setSearch] = useState("");

  // Settle-tracking for the ticker filter — a live filter has no discrete
  // commit point, so log once the typed value sits unchanged for 1.2s.
  useEffect(() => {
    const v = search.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(v)) return;
    const id = setTimeout(() => trackSearch(v, "flow-desk", v), 1200);
    return () => clearTimeout(id);
  }, [search]);

  // FiltersPanel open/close
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [projectionInterval, setProjectionInterval] = useState<FlowProjectionIntervalMinutes>(15);
  const [projectionBucketKey, setProjectionBucketKey] = useState<string | null>(null);

  // ── Card expansion (v7b) ───────────────────────────────────────────────────
  // Expansion lives HERE, not inside FlowCard.
  //
  // Root cause of the old "sticky / unclosable" panel: each card kept its own
  // `expanded` useState while `.obs-fc-expand-btn` was `position:absolute;
  // bottom:8px`. Opening a card grew it in-flow (the feed is a CSS grid, so the
  // whole row stretched and neighbours gaped) and the ONE toggle drifted with the
  // card's new bottom edge — down onto the honesty note ~200px below the click, at
  // an ~11×12px hit size. Every miss bubbled to the card's onClick, which only
  // toggled SELECTION, so the panel stayed open and the desk felt frozen. The
  // per-card state also meant nothing could ever close a panel from the outside.
  //
  // One id here ⇒ one card open at a time, and Esc / outside-click / the card
  // itself can all close it.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // Esc + outside-click close. Bound only while a panel is open; the listeners are
  // attached in an effect (post-commit), so the very click that opened the panel is
  // already finished dispatching and cannot immediately close it again.
  useEffect(() => {
    if (expandedId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedId(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.('[data-fc-open="1"]')) return; // inside the open card/panel
      setExpandedId(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [expandedId]);

  // ── Feed virtualization — cap initial render; auto-load via IntersectionObserver ──
  const PAGE_SIZE = 200;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset visible count when filters/sort change so users always see newest/top results.
  // We compare a serialized key of the effective filter state.
  // Any re-slice can drop the open card out of the rendered set, which would strand
  // the expansion state on an event nobody can see — so collapse alongside it.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setExpandedId(null);
  }, [search, preset, sort, filters]);

  // Merge preset overrides into the base filter set
  const effectiveFilters = useMemo<FlowFilters>(() => {
    const over = presetFilters(preset);
    return {
      ...filters,
      ...over,
      // badge merge: union of base + preset
      badges: new Set([
        ...filters.badges,
        ...(over.badges ?? []),
      ]),
    };
  }, [filters, preset]);

  // Filter + sort pipeline (pure derivation from props — no internal state)
  const filtered = useMemo(() => {
    if (!feed) return [];
    let events = feed.events;

    const enrichEvents = enrich?.events ?? {};

    // Ticker search
    const q = search.trim().toUpperCase();
    if (q) {
      events = events.filter((ev) => ev.root.includes(q));
    }

    // Right (C/P)
    if (effectiveFilters.right !== "all") {
      events = events.filter((ev) => ev.right === effectiveFilters.right);
    }

    // Lean
    if (effectiveFilters.lean !== "all") {
      events = events.filter((ev) => ev.side === effectiveFilters.lean);
    }

    // Min premium
    if (effectiveFilters.minPremium > 0) {
      events = events.filter((ev) => ev.premium >= effectiveFilters.minPremium);
    }

    // DTE buckets
    if (effectiveFilters.dteBuckets.length > 0) {
      const s = new Set(effectiveFilters.dteBuckets);
      events = events.filter((ev) => s.has(ev.dte_bucket));
    }

    // Moneyness buckets
    if (effectiveFilters.mnyBuckets.length > 0) {
      const s = new Set(effectiveFilters.mnyBuckets);
      events = events.filter((ev) => s.has(ev.mny_bucket));
    }

    // Min score — read the server-precomputed score (missing → 0, filtered out)
    if (effectiveFilters.minScore > 0) {
      events = events.filter((ev) => (ev.flowScore?.score ?? 0) >= effectiveFilters.minScore);
    }

    // ELITE preset: use session_tier EXCLUSIVELY (per spec §3).
    // The pipeline stamps session_tier="elite" on the top ~2% of the session
    // (q_score ≥ enrich thresholds.elite, premium ≥$1M).
    // Fallback when enrich absent: premium ≥$1M (so preset is never vacuous).
    if (preset === "ELITE") {
      if (enrich) {
        events = events.filter((ev) => {
          const enrichEv: EnrichEvent | undefined = enrichEvents[ev.id];
          return enrichEv?.session_tier === "elite";
        });
      } else {
        // Fallback: v1 behavior (no enrich)
        events = events.filter((ev) => ev.premium >= 1_000_000);
      }
    }

    // Badge flags — event must satisfy ALL checked badges (v1 client-derived)
    if (effectiveFilters.badges.size > 0) {
      events = events.filter((ev) => {
        for (const flag of effectiveFilters.badges) {
          switch (flag) {
            case "whale":   if (ev.premium < 1_000_000) return false; break;
            case "cluster": if (!ev.repeated) return false; break;
            case "sweep":   if (!(ev.n_prints >= 3 && ev.swept)) return false; break;
            case "unusual": if (ev.premium_z == null || ev.premium_z < 2) return false; break;
            case "block":   if (!(ev.n_prints === 1 && ev.size >= 5000)) return false; break;
            // v2 detection flags used in badges set fall through to detections filter
            default: break;
          }
        }
        return true;
      });
    }

    // Detections filter lens (v2) — show events that have ANY of the selected detections
    if (effectiveFilters.detections.size > 0 && enrich) {
      events = events.filter((ev) => {
        const enrichEv: EnrichEvent | undefined = enrichEvents[ev.id];
        if (!enrichEv) return false;
        const badgeSet = new Set(enrichEv.badges);
        for (const det of effectiveFilters.detections) {
          if (badgeSet.has(det)) return true;
        }
        return false;
      });
    }

    // Sort
    if (sort === "SCORE") {
      events = [...events].sort(
        (a, b) => (b.flowScore?.score ?? 0) - (a.flowScore?.score ?? 0)
      );
    } else {
      // NEW: newest-first (feed is already newest-first from the poller, but re-sort for safety)
      events = [...events].sort(
        (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
      );
    }

    return events;
  }, [feed, enrich, search, effectiveFilters, preset, sort]);

  const flowProjection = useMemo(
    () => buildFlowProjection(filtered, projectionInterval),
    [filtered, projectionInterval],
  );
  const projectionBucket = useMemo(
    () => flowProjection.buckets.find((bucket) => bucket.key === projectionBucketKey) ?? null,
    [flowProjection, projectionBucketKey],
  );
  const projectedEvents = useMemo(
    () => selectFlowProjectionBucket(filtered, projectionBucket),
    [filtered, projectionBucket],
  );

  useEffect(() => {
    if (projectionBucketKey && !projectionBucket) setProjectionBucketKey(null);
  }, [projectionBucket, projectionBucketKey]);

  // (Placed after `filtered` — the deps array evaluates at render time, so
  // referencing it above the declaration is a TDZ ReferenceError.)
  // Wire IntersectionObserver to sentinel so scrolling to the bottom auto-loads
  // the next page without requiring a button click.
  // deps=[filtered.length, visibleCount]: the sentinel div only exists in the DOM
  // when filtered.length > visibleCount (line 566). At mount, feed is null so
  // filtered.length === 0 and the sentinel is absent; sentinelRef.current is null
  // and a mount-only effect would return early without ever attaching the IO.
  // Re-running when filtered.length or visibleCount changes ensures the IO is
  // attached as soon as the sentinel appears.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((n) => n + PAGE_SIZE);
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, visibleCount]);


  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="obs-fd-feed-wrap">
      {/* ── Toolbar ── */}
      <div className="obs-fd-toolbar">
        {/* N SIGNALS count */}
        <div className="obs-fd-count">
          <span style={{ color: "var(--signal)", fontWeight: 700 }}>
            {filtered.length}
          </span>{" "}
          {zh ? "信号" : "SIGNALS"}
          {feed?.stale && (
            <span
              className="obs-tag"
              style={{ "--c": "var(--warn)", marginLeft: 6 } as React.CSSProperties}
            >
              {zh ? "数据较旧" : "STALE"}
            </span>
          )}
        </div>

        {/* Ticker search */}
        <input
          type="text"
          placeholder={zh ? "搜索标的…" : "Search ticker…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="obs-fd-search"
          maxLength={12}
          spellCheck={false}
        />

        {/* Sort toggle — reuse fin-toggle (unchanged) */}
        <div className="fin-toggle">
          <button
            className={sort === "NEW" ? "on" : ""}
            onClick={() => updatePrefs({ sort: "NEW" })}
          >
            {zh ? "最新" : "NEW"}
          </button>
          <button
            className={sort === "SCORE" ? "on" : ""}
            onClick={() => updatePrefs({ sort: "SCORE" })}
          >
            {zh ? "评分" : "SCORE"}
          </button>
        </div>

        {/* Filters toggle */}
        <button
          className="obs-chip"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          {zh ? "筛选" : "Filters"}
          {isFiltersDirty(filters) && (
            <span style={FILTER_DOT_STYLE} />
          )}
        </button>
      </div>

      <FlowFreshnessReceipt
        meta={flowMeta}
        connected={connected}
        lang={lang}
        sessionDate={feed?.session_date}
        className="obs-fd-freshness"
      />

      {/* ── View presets ── */}
      <div className="obs-fd-preset-bar">
        {(["ALL", "ELITE", "WHALES", "0DTE", "SWEEPS"] as ViewPreset[]).map((p) => (
          <button
            key={p}
            className={`obs-chip${preset === p ? " on" : ""}`}
            onClick={() => updatePrefs({ preset: p })}
          >
            {p === "ALL"    ? (zh ? "全部" : "ALL")
              : p === "ELITE"  ? t("eliteTop2")
              : p === "WHALES" ? (zh ? "巨单" : "WHALES")
              : p === "0DTE"   ? "0DTE"
              : (zh ? "扫单" : "SWEEPS")}
          </button>
        ))}
      </div>

      {/* ── FiltersPanel ── */}
      {filtersOpen && (
        <FiltersPanel
          filters={filters}
          onFiltersChange={onFiltersChange}
          lang={lang}
        />
      )}

      {/* ── Feed list ── */}
      <div className="obs-fd-list obs-scroll" data-tut="flow-feed">
        {/* Loading state */}
        {feed === null && <LoadingState zh={zh} />}

        {/* Empty state */}
        {feed !== null && filtered.length === 0 && (
          <EmptyState
            zh={zh}
            hasFilters={isFiltersDirty(effectiveFilters) || search.length > 0}
            stale={feed.stale === true}
            sessionDate={feed.session_date}
          />
        )}

        {/* Cards — capped to visibleCount; sentinel triggers Load-more */}
        {filtered.slice(0, visibleCount).map((ev) => (
          <FlowCard
            key={ev.id}
            ev={ev}
            enrichEv={enrich?.events[ev.id] ?? null}
            lang={lang}
            selected={ev.id === selectedId}
            onSelect={onSelect}
            expanded={ev.id === expandedId}
            onToggleExpand={handleToggleExpand}
          />
        ))}

        {/* Load-more sentinel — only shown when more cards exist beyond the cap */}
        {filtered.length > visibleCount && (
          <div
            ref={sentinelRef}
            style={LOAD_MORE_STYLE}
            // Span full grid width so it sits below the card grid, not in a column slot
            // grid-column: 1/-1 is set via the class in observatory.css
            className="obs-fd-load-more"
          >
            <button
              style={LOAD_MORE_BTN}
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
            >
              {zh
                ? `加载更多 — 已显示 ${visibleCount} / ${filtered.length}`
                : `Load more — showing ${visibleCount} of ${filtered.length}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty / loading states ────────────────────────────────────────────────────

// Empty-state session tone is resolved by the pure flowFreshness helper using
// both the ET window and payload session_date, so pre-open/closed/holiday data
// stays explicitly on the last-session path.
function LoadingState({ zh }: { zh: boolean }) {
  return (
    <>
      <div className="obs-fd-feed-state obs-fd-feed-status" role="status" aria-live="polite">
        {pick(zh, FD.feedLoading.en, FD.feedLoading.zh)}
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="fin-skel obs-fd-card-skel" aria-hidden="true" />
      ))}
    </>
  );
}

function EmptyState({
  zh,
  hasFilters,
  stale,
  sessionDate,
}: {
  zh: boolean;
  hasFilters: boolean;
  stale: boolean;
  sessionDate?: string;
}) {
  // Honest "why": the component states which of the three it can actually tell —
  // filters exclude everything / the payload is stale / the tape is closed or quiet.
  const title = hasFilters ? FD.feedEmptyFiltered : FD.feedEmptyQuiet;
  const why = hasFilters
    ? FD.feedEmptyFilteredWhy
    : stale
    ? FD.feedEmptyStaleWhy
    : usOptionsSessionState(sessionDate, new Date()) === "regular"
    ? FD.feedEmptyOpenWhy
    : FD.feedEmptyClosedWhy;

  return (
    <div className="obs-fd-feed-state fin-empty fin-empty-lg">
      <svg className="fin-empty-icon" viewBox="0 0 56 56" fill="none" aria-hidden="true">
        <circle cx="28" cy="28" r="19" stroke="currentColor" strokeWidth="2" />
        <circle cx="28" cy="28" r="7" stroke="currentColor" strokeWidth="2" />
        <path d="M28 9v10M28 37v10M9 28h10M37 28h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="fin-empty-title">{pick(zh, title.en, title.zh)}</div>
      <div className="fin-empty-why">{pick(zh, why.en, why.zh)}</div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isFiltersDirty(f: FlowFilters): boolean {
  return (
    f.right !== "all" ||
    f.lean !== "all" ||
    f.minScore !== 0 ||
    f.minPremium !== 0 ||
    f.dteBuckets.length > 0 ||
    f.mnyBuckets.length > 0 ||
    f.badges.size > 0 ||
    f.detections.size > 0
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// Layout moved to observatory.css (.obs-fd-*)

const FILTER_DOT_STYLE: React.CSSProperties = {
  display: "inline-block",
  width: 5,
  height: 5,
  borderRadius: "50%",
  background: "var(--brand)",
  marginLeft: 4,
  verticalAlign: "middle",
};

// Empty / loading states now ride the shared primitives (.fin-empty*, .fin-skel)
// plus the .obs-fd-feed-state grid-span helper — no bespoke inline shells.

// ── Load-more sentinel ────────────────────────────────────────────────────────

const LOAD_MORE_STYLE: React.CSSProperties = {
  padding: "var(--sp-3) 0 var(--sp-1)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
};

const LOAD_MORE_BTN: React.CSSProperties = {
  padding: "var(--sp-2) var(--sp-4)",
  borderRadius: "var(--r-pill)",
  border: "1px solid var(--line-2)",
  background: "transparent",
  color: "var(--text-2)",
  font: "500 var(--fs-label)/1 var(--font-ui)",
  fontVariantNumeric: "tabular-nums",
  cursor: "pointer",
};
