"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/news/TickerNewsPanel.module.css";
import NewsLiveDot from "@/components/news/NewsLiveDot";
import {
  normalizeTickerNewsSymbol,
  parseTickerNewsStory,
  type TickerNewsStory,
  type TickerNewsStoryRow,
} from "@/lib/newsContract";
import { decodeNewsText, formatRailTime, sourceLabel } from "@/lib/newsDisplay";
import { newsFlowText } from "@/lib/newsFlowLex";
import {
  type TickerNewsLoadState,
  useTickerNewsFeed,
} from "@/components/news/useTickerNewsFeed";

type Lang = "en" | "zh";

const NO_ROWS: readonly TickerNewsStoryRow[] = [];

type DetailRevision = { storyId: string; revision: string };
type CachedDetail = { revision: string; story: TickerNewsStory };

// Bind detail to the complete canonical row, not only its reusable story ID.
function storyRevision(row: TickerNewsStoryRow): string {
  return JSON.stringify([
    row.sequence, row.source, row.source_item_id, row.story_id,
    row.source_count, row.item_count, row.title, row.url, row.teaser,
    row.published_at, row.updated_at, row.received_at, row.universe_revision,
  ]);
}

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
    sourceFilter: "Filter news by source",
    allSources: "All sources",
    loaded: (n: number) => `${n} ${n === 1 ? "headline" : "headlines"} shown`,
    reportsUnavailable: "Reports could not be loaded. Try again.",
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
    sourceFilter: "按新闻来源筛选",
    allSources: "全部来源",
    loaded: (n: number) => `显示 ${n} 条新闻`,
    reportsUnavailable: "无法载入报道，请重试。",
  },
} as const;

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

function storyTime(row: TickerNewsStoryRow): string {
  return row.updated_at || row.published_at || row.received_at;
}

function storyDate(row: TickerNewsStoryRow, lang: Lang): string {
  const date = new Date(storyTime(row));
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function TickerNewsPanel({ symbol, lang }: { symbol: string; lang: Lang; userId?: string }) {
  const copy = COPY[lang];
  const { snapshot, loadState, liveInterrupted } = useTickerNewsFeed(symbol);
  const [details, setDetails] = useState<Record<string, CachedDetail | null>>({});
  const [detailBusy, setDetailBusy] = useState<DetailRevision | null>(null);
  const [detailError, setDetailError] = useState<DetailRevision | null>(null);
  const [source, setSource] = useState("");
  const detailGen = useRef(0);
  const detailReq = useRef<(DetailRevision & { controller: AbortController; gen: number }) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const state = snapshot?.state;
  const symbolsMatch = (() => {
    if (!snapshot) return false;
    try {
      return normalizeTickerNewsSymbol(snapshot.ticker) === normalizeTickerNewsSymbol(symbol);
    } catch {
      return false;
    }
  })();
  // The reading surface never presents stale-symbol or inaccessible rows.
  const hasAuthoritativeRows = loadState === "ready" && symbolsMatch &&
    state !== "restricted" && state !== "unavailable" && snapshot !== null;
  const presented = hasAuthoritativeRows && snapshot ? snapshot.rows : NO_ROWS;
  const rowRevisions = useMemo(
    () => new Map(presented.map((row) => [row.story_id, storyRevision(row)])),
    [presented],
  );
  const sources = useMemo(() => [...new Set(presented.map((row) => row.source))].sort(), [presented]);
  const activeSource = sources.includes(source) ? source : "";
  // Sort a display copy by the same timestamp used by dates and times. Stable
  // ties retain upstream order; canonical sequence, revisions and rows stay intact.
  const ordered = useMemo(() => [...presented].sort((a, b) => {
    const aTime = Date.parse(storyTime(a));
    const bTime = Date.parse(storyTime(b));
    if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? 1 : 0;
    if (!Number.isFinite(bTime)) return -1;
    return bTime - aTime;
  }), [presented]);
  const visible = activeSource ? ordered.filter((row) => row.source === activeSource) : ordered;

  useEffect(() => {
    detailGen.current += 1;
    detailReq.current?.controller.abort();
    detailReq.current = null;
    setDetailBusy(null);
    setDetailError(null);
    setDetails({});
    setSource("");
    scrollRef.current?.scrollTo?.({ top: 0 });
    return () => {
      detailGen.current += 1;
      detailReq.current?.controller.abort();
      detailReq.current = null;
    };
  }, [symbol]);

  useLayoutEffect(() => {
    // Only a ready, unfiltered snapshot establishes that a publisher disappeared.
    // Loading and failed refreshes preserve intent; a later return starts at All.
    if (hasAuthoritativeRows) setSource((current) => sources.includes(current) ? current : "");
  }, [hasAuthoritativeRows, sources]);

  useLayoutEffect(() => {
    // Revoke pending work at the canonical membership/revision boundary.
    // Abort alone cannot stop an already-started JSON completion.
    const pending = detailReq.current;
    if (pending && rowRevisions.get(pending.storyId) !== pending.revision) {
      detailGen.current += 1;
      pending.controller.abort();
      detailReq.current = null;
      setDetailBusy(null);
    }
    setDetails((current) => {
      const entries = Object.entries(current).filter(([storyId, detail]) =>
        detail && rowRevisions.get(storyId) === detail.revision);
      return entries.length === Object.keys(current).length
        ? current : Object.fromEntries(entries);
    });
    setDetailError((current) => current &&
      rowRevisions.get(current.storyId) !== current.revision ? null : current);
  }, [rowRevisions]);

  const toggleStory = async (row: TickerNewsStoryRow) => {
    const revision = storyRevision(row);
    if (details[row.story_id]?.revision === revision) {
      setDetails((current) => ({ ...current, [row.story_id]: null }));
      return;
    }
    if (detailBusy) return;
    const gen = detailGen.current;
    const controller = new AbortController();
    detailReq.current = { controller, gen, storyId: row.story_id, revision };
    const isCurrentRequest = () => gen === detailGen.current &&
      detailReq.current?.controller === controller;
    setDetailBusy({ storyId: row.story_id, revision });
    setDetailError(null);
    try {
      const res = await fetch(`/api/news/stories/${encodeURIComponent(row.story_id)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!isCurrentRequest()) return;
      if (!res.ok) throw new Error("Reports unavailable");
      const parsed = parseTickerNewsStory(await res.json());
      if (!isCurrentRequest()) return;
      if (parsed.story_id !== row.story_id) throw new Error("Story mismatch");
      setDetails((current) => ({ ...current, [row.story_id]: { revision, story: parsed } }));
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (isCurrentRequest()) setDetailError({ storyId: row.story_id, revision });
    } finally {
      if (isCurrentRequest()) {
        detailReq.current = null;
        setDetailBusy(null);
      }
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
        <div className={styles.tools}>
          {sources.length > 1 && (
            <select
              className={styles.sourceFilter}
              aria-label={copy.sourceFilter}
              data-news-source-filter
              value={activeSource}
              onChange={(event) => {
                setSource(event.target.value);
                scrollRef.current?.scrollTo?.({ top: 0 });
              }}
            >
              <option value="">{copy.allSources}</option>
              {sources.map((value) => <option key={value} value={value}>{sourceLabel(value)}</option>)}
            </select>
          )}
          {loadState === "ready" && symbolsMatch && state === "live" && !liveInterrupted && <NewsLiveDot lang={lang} />}
          {loadState === "ready" && symbolsMatch && state === "catching_up" && <span className={styles.stateChip}>{copy.catchingUp}</span>}
        </div>
      </div>

      <div className={styles.scroll} ref={scrollRef}>
        <EmptyState state={loadState} copy={copy} />
        {loadState === "ready" && state === "degraded" && (
          <div className={styles.note} role="status">{copy.degraded}</div>
        )}
        {loadState === "ready" && liveInterrupted && (
          <div className={styles.note} role="status">{copy.liveInterrupted}</div>
        )}
        {loadState === "ready" && state === "quiet" && presented.length === 0 && (
          <div className={styles.empty} role="status">{copy.quiet}</div>
        )}
        {presented.length > 0 && <span className={styles.srOnly} role="status">{copy.loaded(visible.length)}</span>}

        {visible.map((row, index) => {
          const revision = rowRevisions.get(row.story_id);
          const cached = details[row.story_id];
          // Suppress a changed revision in this render, before any effect runs.
          const detail = cached && cached.revision === revision ? cached.story : null;
          const timeRaw = storyTime(row);
          const title = decodeNewsText(row.title);
          const teaser = decodeNewsText(row.teaser);
          const date = storyDate(row, lang);
          const showDate = date && (index === 0 || storyDate(visible[index - 1], lang) !== date);
          const detailId = `news-reports-${encodeURIComponent(row.story_id)}`;
          return (
            <Fragment key={row.story_id}>
              {showDate && <h3 className={styles.date} data-news-date>{date}</h3>}
              <article className={styles.row} data-story-id={row.story_id}>
                <div className={styles.meta}>
                  <span className={styles.source}>{sourceLabel(row.source)}</span>
                  <time dateTime={timeRaw}>{formatRailTime(timeRaw, lang)}</time>
                </div>
                {row.url ? (
                  <a data-news-headline className={styles.headline} href={row.url} target="_blank" rel="noopener noreferrer">{title}</a>
                ) : (
                  <>
                    <span data-news-headline className={`${styles.headline} ${styles.headlineStatic}`}>{title}</span>
                    <span className={styles.srOnly}>{copy.sourceUnavailable}</span>
                  </>
                )}
                {teaser && teaser.trim() !== title.trim() && <p className={styles.teaser}>{teaser}</p>}
                {row.item_count > 1 && (
                  <button
                    type="button"
                    className={styles.sourcesButton}
                    aria-expanded={!!detail}
                    aria-controls={detail ? detailId : undefined}
                    onClick={() => void toggleStory(row)}
                    disabled={detailBusy?.storyId === row.story_id && detailBusy.revision === revision}
                  >
                    {detail
                      ? copy.closeReports
                      : row.source_count > 1
                        ? newsFlowText("row.outlets", lang, { n: row.item_count, k: row.source_count })
                        : copy.reports(row.item_count)}
                    <span aria-hidden="true" className={styles.disclosure}>{detail ? "−" : "+"}</span>
                  </button>
                )}
                {detailError?.storyId === row.story_id && detailError.revision === revision && <p className={styles.reportError} role="status">{copy.reportsUnavailable}</p>}
                {detail && (
                  <div id={detailId} className={styles.sourceList} role="group" aria-label={copy.reports(detail.item_count)}>
                    <p className={styles.groupNote}>{newsFlowText("row.groupNote", lang)}</p>
                    {detail.members.map((member) => (
                      member.url ? (
                        <a key={JSON.stringify([member.source, member.source_item_id])} href={member.url} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>
                          <span>{sourceLabel(member.source)}</span><span>{decodeNewsText(member.title)}</span>
                        </a>
                      ) : (
                        <div className={`${styles.sourceLink} ${styles.static}`} key={JSON.stringify([member.source, member.source_item_id])}>
                          <span>{sourceLabel(member.source)}</span><span>{decodeNewsText(member.title)}</span>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </article>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
