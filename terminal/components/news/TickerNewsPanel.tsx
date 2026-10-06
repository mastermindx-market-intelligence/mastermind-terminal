"use client";

import { useState } from "react";

import styles from "@/components/news/TickerNewsPanel.module.css";

import {
  parseTickerNewsStory,
  type TickerNewsStory,
  type TickerNewsStoryRow,
} from "@/lib/newsContract";
import {
  type TickerNewsLoadState,
  useTickerNewsFeed,
} from "@/components/news/useTickerNewsFeed";

type Lang = "en" | "zh";

const COPY = {
  en: {
    title: "News",
    loading: "Loading company news…",
    quiet: "No new company news right now.",
    restricted: "News access is unavailable for this account or feed.",
    unavailable: "News is temporarily unavailable.",
    degraded: "Live updates are degraded. Showing the latest verified read.",
    catchingUp: "Catching up…",
    reports: (n: number) => `${n} reports`,
    closeReports: "Hide reports",
    sourceUnavailable: "Source link unavailable",
    liveInterrupted: "Live updates interrupted. Showing the latest read.",
  },
  zh: {
    title: "新闻",
    loading: "正在载入公司新闻…",
    quiet: "暂时没有新的公司新闻。",
    restricted: "此账户或新闻源当前不可用。",
    unavailable: "新闻暂时不可用。",
    degraded: "实时更新降级，显示最近一次已验证读取。",
    catchingUp: "正在补齐新闻…",
    reports: (n: number) => `${n} 条报道`,
    closeReports: "收起报道",
    sourceUnavailable: "原文链接不可用",
    liveInterrupted: "实时更新中断，显示最近一次读取。",
  },
} as const;

function sourceLabel(source: string): string {
  if (!source) return "Source";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function displayTime(row: TickerNewsStoryRow, lang: Lang): string {
  const raw = row.updated_at || row.published_at || row.received_at;
  const dt = new Date(raw);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EmptyState({
  state,
  copy,
}: {
  state: TickerNewsLoadState;
  copy: typeof COPY.en | typeof COPY.zh;
}) {
  if (state === "loading") return <div className={styles.empty} role="status">{copy.loading}</div>;
  if (state === "restricted") return <div className={`${styles.empty} ${styles.restricted}`} role="status">{copy.restricted}</div>;
  if (state === "unavailable") return <div className={styles.empty} role="status">{copy.unavailable}</div>;
  return null;
}

export default function TickerNewsPanel({ symbol, lang }: { symbol: string; lang: Lang }) {
  const copy = COPY[lang];
  const { snapshot, loadState, liveInterrupted } = useTickerNewsFeed(symbol);
  const [details, setDetails] = useState<Record<string, TickerNewsStory | null>>({});
  const [detailBusy, setDetailBusy] = useState<string | null>(null);
  const rows = snapshot?.rows ?? [];
  const state = snapshot?.state;

  const toggleStory = async (row: TickerNewsStoryRow) => {
    if (details[row.story_id]) {
      setDetails((current) => ({ ...current, [row.story_id]: null }));
      return;
    }
    if (detailBusy) return;
    setDetailBusy(row.story_id);
    try {
      const res = await fetch(`/api/news/stories/${encodeURIComponent(row.story_id)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return;
      const parsed = parseTickerNewsStory(await res.json());
      if (parsed.story_id !== row.story_id) return;
      setDetails((current) => ({ ...current, [row.story_id]: parsed }));
    } catch {
      // Grouped-source expansion is optional depth; keep the main feed usable.
    } finally {
      setDetailBusy(null);
    }
  };

  return (
    <section
      className={`board ${styles.board}`}
      id="rail-panel-news"
      role="tabpanel"
      aria-labelledby="rail-tab-news"
      data-testid="ticker-news-panel"
      data-news-state={loadState === "ready" ? state : loadState}
    >
      <div className={styles.bar}>
        <div className={styles.heading}>
          <span className={styles.title}>{copy.title}</span>
          <span className={styles.symbol}>{symbol}</span>
        </div>
        {state === "live" && <span className={styles.liveDot} aria-label="live" />}
        {state === "catching_up" && <span className={styles.stateChip}>{copy.catchingUp}</span>}
      </div>

      <div className={styles.scroll}>
        <EmptyState state={loadState} copy={copy} />
        {loadState === "ready" && state === "degraded" && (
          <div className={styles.note} role="status">{copy.degraded}</div>
        )}
        {loadState === "ready" && liveInterrupted && (
          <div className={styles.note} role="status">{copy.liveInterrupted}</div>
        )}
        {loadState === "ready" && state === "quiet" && rows.length === 0 && (
          <div className={styles.empty} role="status">{copy.quiet}</div>
        )}

        {loadState === "ready" && rows.map((row) => {
          const detail = details[row.story_id];
          const timeRaw = row.updated_at || row.published_at || row.received_at;
          return (
            <article className={styles.row} key={row.story_id} data-story-id={row.story_id}>
              <div className={styles.meta}>
                <span className={styles.source}>{sourceLabel(row.source)}</span>
                <time dateTime={timeRaw}>{displayTime(row, lang)}</time>
              </div>
              {row.url ? (
                <a data-news-headline className={styles.headline} href={row.url} target="_blank" rel="noopener noreferrer">{row.title}</a>
              ) : (
                <span data-news-headline className={`${styles.headline} ${styles.headlineStatic}`} title={copy.sourceUnavailable}>{row.title}</span>
              )}
              {row.teaser && <p className={styles.teaser}>{row.teaser}</p>}
              {row.item_count > 1 && (
                <button
                  type="button"
                  className={styles.sourcesButton}
                  aria-expanded={!!detail}
                  onClick={() => void toggleStory(row)}
                  disabled={detailBusy === row.story_id}
                >
                  {detail ? copy.closeReports : copy.reports(row.item_count)}
                </button>
              )}
              {detail && (
                <div className={styles.sourceList} aria-label={copy.reports(detail.item_count)}>
                  {detail.members.map((member) => (
                    member.url ? (
                      <a key={member.source_item_id} href={member.url} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>
                        <span>{sourceLabel(member.source)}</span><span>{member.title}</span>
                      </a>
                    ) : (
                      <div className={`${styles.sourceLink} ${styles.static}`} key={member.source_item_id}>
                        <span>{sourceLabel(member.source)}</span><span>{member.title}</span>
                      </div>
                    )
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}