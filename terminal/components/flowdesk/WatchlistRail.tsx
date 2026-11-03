/**
 * WatchlistRail — market-overview block + per-ticker watchlist chips.
 * Observatory restyle: glass obs-card panels, RingGauge sm for scores.
 */
"use client";
import { useMemo } from "react";
import type React from "react";
import { pick, fmtNum } from "../../lib/finFormat";
import type { Lang } from "../../lib/i18n";
import type { FlowScore } from "./FeedPane";
import { FD } from "../../lib/flowdeskStrings";
import { feedEvents, printAttributable } from "../../lib/flowPrintInspector";
import styles from "./EvidenceDisclosure.module.css";
import { RingGauge } from "../ui/RingGauge";

// ─── Shared feed/tide shape ────────────────────────────────────────────────

interface FlowEvent {
  id: string; ts: string; root: string; group: string; group_zh: string;
  right: "C" | "P"; exp: string; strike: number; dte: number;
  dte_bucket: string; mny_bucket: string; side: string;
  n_prints: number; size: number; avg_price: number; premium: number;
  premium_z: number | null; baseline_source: string; vol_gt_oi: boolean | null;
  repeated: boolean; zerodte: boolean; signing_source: string; swept?: boolean;
  flowScore?: FlowScore;
}
interface TideMinute { t: string; ncp: number; npp: number; gross: number; vol: number }
interface TidePayload {
  schema?: string; asof: string; session_date?: string;
  minutes: TideMinute[];
  spy: { t: string; px: number }[];
  sectors: unknown[]; top_net_impact: unknown[];
}
interface FeedPayload {
  schema?: string; asof: string; session_date?: string; session_pct?: number;
  baseline_note?: { en: string; zh: string };
  events: FlowEvent[];
  unusual_names: { root: string; gross_premium_today: number; prem_z: number | null; call_prem_share: number }[];
  stale?: boolean;
}

export interface WatchlistRailProps {
  feed: FeedPayload;
  tide: TidePayload | null;
  lang: Lang;
  watchlist: string[];
  onToggleTicker: (root: string) => void;
  onPickTicker: (root: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtPrem(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// ─── Component ────────────────────────────────────────────────────────────

export function WatchlistRail({ feed, tide, lang, watchlist, onToggleTicker, onPickTicker }: WatchlistRailProps) {
  const zh = lang === "zh";

  // The tape through the ONE guard the gauge, the coverage line and the feed list read it
  // through: a malformed `events` reads as no prints, never a throw. For an array it is the
  // identity, so the memos below keep their per-tape identity.
  const events = feedEvents(feed);
  // With no tide, use only a fully attributable loaded tape, just like FlowGauge.
  // Zero premium is measured; its call/put split has no denominator.
  const overview = useMemo(() => {
    let callPrem = 0, putPrem = 0;
    if (tide && !Array.isArray(tide.minutes)) return null;
    if (tide?.minutes.length) {
      const last = tide.minutes[tide.minutes.length - 1];
      if (!last || !Number.isFinite(last.ncp) || !Number.isFinite(last.npp)) return null;
      callPrem = Math.abs(last.ncp);
      putPrem = Math.abs(last.npp);
    } else {
      if (!events.length) return null;
      for (const ev of events) {
        if (!printAttributable(ev)) return null;
        if (ev.right === "C") callPrem += ev.premium;
        else putPrem += ev.premium;
      }
    }
    const total = callPrem + putPrem;
    return { total, callPrem, putPrem, callShare: total > 0 ? callPrem / total : null };
  }, [events, tide]);

  const na = pick(zh, FD.gaugeNa.en, FD.gaugeNa.zh);
  const pc = overview === null
    ? na
    : overview.callPrem > 0
      ? (overview.putPrem / overview.callPrem).toFixed(2)
      : "—";

  // Best score per ticker. Unknown is not zero: a root whose events carry no
  // finite score maps to null (a missing score is not a 0-scored root), and the
  // best-of is taken over FINITE scores only.
  const tickerBestScore = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const ev of events) {
      if (!ev || typeof ev.root !== "string") continue;
      const score = ev.flowScore && Number.isFinite(ev.flowScore.score) ? ev.flowScore.score : null;
      const cur = map[ev.root];
      map[ev.root] = cur === undefined || (score !== null && (cur === null || score > cur))
        ? score
        : cur;
    }
    return map;
  }, [events]);

  const watchlistTickers = watchlist.filter((t) => t in tickerBestScore);

  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
      {/* ── Session stats card ── */}
      <details className={`obs-card obs-fd-session ${styles.session}`} data-tut="session-overview">
        <summary>
          {pick(zh, "Session breakdown", "时段明细")}
          <small>{!overview ? na : tide?.minutes?.length ? pick(zh, "Tide", "潮汐") : pick(zh, "Loaded prints", "已载入成交")}</small>
        </summary>
        <div className="obs-card-hr" />
        <div className="obs-fd-stat-grid">
          <div className="obs-fd-stat-cell">
            <span className="obs-lbl">{tide?.minutes?.length ? pick(zh, "Net magnitudes", "净额绝对值之和") : pick(zh, "Premium", "权利金")}</span>
            <span className="obs-fd-stat-val num">{overview ? fmtPrem(overview.total) : na}</span>
          </div>
          <div className="obs-fd-stat-cell">
            <span className="obs-lbl">{pick(zh, "Calls", "认购")}</span>
            <span className="obs-fd-stat-val num">{overview?.callShare != null ? fmtPct(overview.callShare) : na}</span>
          </div>
          <div className="obs-fd-stat-cell">
            <span className="obs-lbl">P/C</span>
            <span className="obs-fd-stat-val num">{pc}</span>
          </div>
        </div>
        <div className="obs-fd-bar-wrap">
          <div className="obs-fd-bar-track">
            {/* No reading draws no split: an even 50% fill is a reading the rail never made. */}
            {overview?.callShare != null && (
              <div
                className="obs-fd-bar-fill"
                style={{ width: `${Math.round(overview.callShare * 100)}%` }}
              />
            )}
          </div>
          <div className="obs-fd-bar-labels">
            <span className="obs-lbl" style={{ color: "var(--brand-2)" }}>
              {pick(zh, "Calls", "认购")}
            </span>
            <span className="obs-lbl">{pick(zh, "Puts", "认沽")}</span>
          </div>
        </div>
      </details>

      {/* ── Watchlist card ── */}
      <div className="obs-card obs-fd-wl" data-tut="watchlist">
        <div className="obs-card-hd">
          <span className="obs-lbl">{pick(zh, FD.watchlist.en, FD.watchlist.zh)}</span>
          <span className="obs-lbl" style={{ color: "var(--muted)" }}>
            {pick(zh, FD.watchlistScoreCol.en, FD.watchlistScoreCol.zh)}
          </span>
        </div>
        <div className="obs-card-hr" />
        <div className="obs-fd-wl-rows obs-scroll">
          {watchlist.length === 0 && (
            <div className="obs-fd-wl-empty">
              {pick(zh, "Click a ticker to watch", "点击标的加入观察")}
            </div>
          )}

          {watchlist.map((root) => {
            const score = tickerBestScore[root] ?? null;
            const inFeed = root in tickerBestScore;
            return (
              <WatchRow
                key={root}
                root={root}
                score={score}
                inFeed={inFeed}
                zh={zh}
                onPick={() => onPickTicker(root)}
                onRemove={() => onToggleTicker(root)}
                isWatch
              />
            );
          })}

          {/* Suggest unwatched tickers active today (max 5) */}
          {watchlistTickers.length === 0 && (
            <>
              <div className="obs-fd-wl-sublabel">
                {pick(zh, "Active today", "今日活跃")}
              </div>
              {Object.entries(tickerBestScore)
                // Scored roots first, best score on top; an unknown score is not a
                // zero, so unscored roots sort last (stable) instead of the bottom.
                .sort(([, a], [, b]) => {
                  if (a === null && b === null) return 0;
                  if (a === null) return 1;
                  if (b === null) return -1;
                  return b - a;
                })
                .slice(0, 5)
                .map(([root, score]) => (
                  <WatchRow
                    key={root}
                    root={root}
                    score={score}
                    inFeed
                    zh={zh}
                    onPick={() => onPickTicker(root)}
                    onRemove={() => onToggleTicker(root)}
                    isWatch={false}
                  />
                ))}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

// ─── WatchRow ─────────────────────────────────────────────────────────────

interface WatchRowProps {
  root: string;
  score: number | null;
  inFeed: boolean;
  zh: boolean;
  onPick: () => void;
  onRemove: () => void;
  isWatch?: boolean;
}

const WATCH_ROW_BTN: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  background: "none",
  border: "none",
  cursor: "pointer",
  minWidth: 0,
  padding: 0,
};

function WatchRow({ root, score, inFeed, zh, onPick, onRemove, isWatch = true }: WatchRowProps) {
  return (
    <div className="obs-fd-wl-row">
      <button style={WATCH_ROW_BTN} onClick={onPick}>
        <span className="obs-fd-wl-ticker">{root}</span>
        {!inFeed && (
          <span className="obs-fd-wl-inactive">{pick(zh, "no events", "无事件")}</span>
        )}
        <span style={{ marginLeft: "auto", flexShrink: 0 }}>
          {inFeed
            ? <RingGauge value={score} size="sm" tone="auto" naLabel={pick(zh, FD.scoreUnavailable.en, FD.scoreUnavailable.zh)} />
            : null}
        </span>
      </button>
      <div className="obs-fd-wl-btns">
        {isWatch ? (
          <button className="obs-fd-wl-btn" onClick={onRemove} aria-label={pick(zh, `Remove ${root} from watchlist`, `将 ${root} 移出观察列表`)}>×</button>
        ) : (
          <button className="obs-fd-wl-btn add" onClick={onRemove} aria-label={pick(zh, `Add ${root} to watchlist`, `将 ${root} 加入观察列表`)}>+</button>
        )}
      </div>
    </div>
  );
}
