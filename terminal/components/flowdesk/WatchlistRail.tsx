/**
 * WatchlistRail — market-overview block + per-ticker watchlist chips.
 * Observatory restyle: glass obs-card panels, RingGauge sm for scores.
 */
"use client";
import { useMemo } from "react";
import type React from "react";
import { pick, fmtNum } from "../../lib/finFormat";
import { useT, type Lang } from "../../lib/i18n";
import type { FlowScore } from "./FeedPane";
import { FD } from "../../lib/flowdeskStrings";
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
  onOpenTutorial?: () => void;
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

export function WatchlistRail({ feed, tide, lang, watchlist, onToggleTicker, onPickTicker, onOpenTutorial }: WatchlistRailProps) {
  const zh = lang === "zh";
  const t = useT();

  // Session overview
  const overview = useMemo(() => {
    if (!tide || !tide.minutes.length) {
      let callPrem = 0; let putPrem = 0;
      for (const ev of feed.events) {
        if (ev.right === "C") callPrem += ev.premium;
        else putPrem += ev.premium;
      }
      const total = callPrem + putPrem;
      return { total, callPrem, putPrem, callShare: total > 0 ? callPrem / total : 0.5 };
    }
    // ncp/npp are CUMULATIVE signed nets — the last minute IS the session total.
    // (Summing every minute double-counts the running total → billions.) npp is
    // stored negative (net put premium); take magnitudes for the call/put split.
    const last = tide.minutes[tide.minutes.length - 1];
    const callPrem = Math.abs(last.ncp);
    const putPrem = Math.abs(last.npp);
    const total = callPrem + putPrem;
    return { total, callPrem, putPrem, callShare: total > 0 ? callPrem / total : 0.5 };
  }, [feed.events, tide]);

  const pc = overview.callPrem > 0
    ? (overview.putPrem / overview.callPrem).toFixed(2)
    : "—";

  // Best score per ticker
  const tickerBestScore = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ev of feed.events) {
      const score = ev.flowScore?.score ?? 0;
      if (!(ev.root in map) || score > map[ev.root]) map[ev.root] = score;
    }
    return map;
  }, [feed.events]);

  const watchlistTickers = watchlist.filter((t) => t in tickerBestScore);

  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
      {/* ── Session stats card ── */}
      <div className="obs-card obs-fd-session" data-tut="session-overview">
        <div className="obs-card-hd">
          <span className="obs-lbl">{pick(zh, FD.sessionOverview.en, FD.sessionOverview.zh)}</span>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <span className="obs-lbl" style={{ color: "var(--muted)" }}>
              {pick(zh, "nightly + intraday", "夜盘+盘中")}
            </span>
            {onOpenTutorial && (
              <button
                onClick={onOpenTutorial}
                aria-label={t("openTutorial")}
                style={TUT_ICON_BTN}
                title={t("openTutorial")}
              >
                ?
              </button>
            )}
          </span>
        </div>
        <div className="obs-card-hr" />
        <div className="obs-fd-stat-grid">
          <div className="obs-fd-stat-cell">
            <span className="obs-lbl">{pick(zh, "Premium", "权利金")}</span>
            <span className="obs-fd-stat-val num">{fmtPrem(overview.total)}</span>
          </div>
          <div className="obs-fd-stat-cell">
            <span className="obs-lbl">{pick(zh, "Calls", "认购")}</span>
            <span className="obs-fd-stat-val num">{fmtPct(overview.callShare)}</span>
          </div>
          <div className="obs-fd-stat-cell">
            <span className="obs-lbl">P/C</span>
            <span className="obs-fd-stat-val num">{pc}</span>
          </div>
        </div>
        <div className="obs-fd-bar-wrap">
          <div className="obs-fd-bar-track">
            <div
              className="obs-fd-bar-fill"
              style={{ width: `${Math.round(overview.callShare * 100)}%` }}
            />
          </div>
          <div className="obs-fd-bar-labels">
            <span className="obs-lbl" style={{ color: "var(--brand-2)" }}>
              {pick(zh, "Calls", "认购")}
            </span>
            <span className="obs-lbl">{pick(zh, "Puts", "认沽")}</span>
          </div>
        </div>
      </div>

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
                .sort((a, b) => b[1] - a[1])
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

const TUT_ICON_BTN: React.CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: "50%",
  border: "1px solid color-mix(in srgb, var(--brand) 40%, transparent)",
  background: "color-mix(in srgb, var(--brand) 10%, transparent)",
  color: "var(--brand-2)",
  font: "700 var(--fs-micro)/1 var(--font-ui)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  padding: 0,
};

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
          {score != null
            ? <RingGauge value={score} size="sm" tone="auto" />
            : null}
        </span>
      </button>
      <div className="obs-fd-wl-btns">
        {isWatch ? (
          <button className="obs-fd-wl-btn" onClick={onRemove} aria-label="Remove">×</button>
        ) : (
          <button className="obs-fd-wl-btn add" onClick={onRemove} aria-label="Watch">+</button>
        )}
      </div>
    </div>
  );
}
