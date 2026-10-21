"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/news/TickerNewsPanel.module.css";
import {
  NewsCatchupBar,
  NewsFilterEmpty,
  NewsMarkReviewed,
  NewsReviewChange,
  NewsReviewTag,
} from "@/components/news/NewsCatchup";
import NewsFlowStrip from "@/components/news/NewsFlowStrip";
import NewsLiveDot from "@/components/news/NewsLiveDot";
import { useNewsCatchup } from "@/components/news/useNewsCatchup";

import {
  normalizeTickerNewsSymbol,
  parseTickerNewsStory,
  type TickerNewsStory,
  type TickerNewsStoryRow,
} from "@/lib/newsContract";
import { formatRailTime, reportSourceLabel, sourceLabel } from "@/lib/newsDisplay";
import { newsFlowText } from "@/lib/newsFlowLex";
import {
  type TickerNewsLoadState,
  useTickerNewsFeed,
} from "@/components/news/useTickerNewsFeed";

type Lang = "en" | "zh";
type CachedDetail = { token: string; story: TickerNewsStory };
type DetailBusy = { storyId: string; token: string };
type DetailRequest = DetailBusy & { controller: AbortController; gen: number };

const NO_ROWS: readonly TickerNewsStoryRow[] = [];

const COPY = {
  en: {
    title: "News",
    loading: "Loading company news…",
    quiet: "No new company news right now.",
    curatedQuiet: "No qualifying company news right now.",
    curated: "Curated reporting and company announcements",
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
    curatedQuiet: "暂时没有符合精选标准的公司新闻。",
    curated: "精选报道与公司公告",
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

export default function TickerNewsPanel({ symbol, lang, userId }: { symbol: string; lang: Lang; userId?: string }) {
  const copy = COPY[lang];
  const { snapshot, loadState, liveInterrupted } = useTickerNewsFeed(symbol);
  const [details, setDetails] = useState<Record<string, CachedDetail | null>>({});
  const [detailBusy, setDetailBusy] = useState<DetailBusy | null>(null);
  const detailGen = useRef(0);
  const detailReq = useRef<DetailRequest | null>(null);
  const latestDetailTokens = useRef<ReadonlyMap<string, string>>(new Map());
  const rows = snapshot?.rows ?? [];
  const state = snapshot?.state;
  const curated = snapshot?.editorial_policy === "ticker_news.curated.v1";
  // Only rows of a successful load are presented, so only they can ever be marked reviewed.
  const presented = loadState === "ready" && snapshot ? snapshot.rows : NO_ROWS;
  const catchup = useNewsCatchup({ userId, ticker: snapshot?.ticker ?? symbol, presented });

  // Wave B3: the news-flow strip rides on page one of a ready snapshot only. It is
  // hidden for a null flow (old API, cursor page), no_accessible_sources, an empty
  // feed (the empty state already speaks), restricted/unavailable panel states, and
  // while the snapshot describes a different symbol than the one on screen — a stale
  // strip describes the wrong security.
  const flow = loadState === "ready" && snapshot ? snapshot.flow : null;
  const symbolsMatch = (() => {
    if (!snapshot) return false;
    try {
      return normalizeTickerNewsSymbol(snapshot.ticker) === normalizeTickerNewsSymbol(symbol);
    } catch {
      return false; // an odd symbol never throws the panel; the strip is simply hidden
    }
  })();
  const showFlow =
    flow !== null &&
    flow.reason !== "no_accessible_sources" &&
    presented.length > 0 &&
    state !== "restricted" &&
    state !== "unavailable" &&
    symbolsMatch;

  // Group sequence changes when any member changes. Policy also belongs to the
  // detail identity: a rolling deployment must not retain pre-curation members.
  const detailTokens = useMemo(() => new Map(
    (symbolsMatch ? presented : NO_ROWS).map((row) => [row.story_id, JSON.stringify([
      symbol, snapshot?.security_id, row.story_id, row.sequence, snapshot?.editorial_policy ?? null,
    ])]),
  ), [presented, symbolsMatch, symbol, snapshot?.security_id, snapshot?.editorial_policy]);
  const activeDetailBusy = detailBusy && detailTokens.get(detailBusy.storyId) === detailBusy.token
    ? detailBusy : null;

  useLayoutEffect(() => {
    latestDetailTokens.current = detailTokens;
    const request = detailReq.current;
    if (request && detailTokens.get(request.storyId) !== request.token) {
      request.controller.abort();
      detailReq.current = null;
    }
  }, [detailTokens]);

  useEffect(() => {
    detailGen.current += 1;
    detailReq.current?.controller.abort();
    detailReq.current = null;
    setDetailBusy(null);
    setDetails({});
    return () => {
      detailGen.current += 1;
      detailReq.current?.controller.abort();
      detailReq.current = null;
    };
  }, [symbol]);

  const toggleStory = async (row: TickerNewsStoryRow) => {
    const token = detailTokens.get(row.story_id);
    if (!token) return;
    if (details[row.story_id]?.token === token) {
      setDetails((current) => ({ ...current, [row.story_id]: null }));
      return;
    }
    if (activeDetailBusy) return;
    const gen = detailGen.current;
    const controller = new AbortController();
    const request: DetailRequest = { controller, gen, storyId: row.story_id, token };
    detailReq.current = request;
    setDetailBusy({ storyId: row.story_id, token });
    const isCurrent = () => gen === detailGen.current && detailReq.current === request
      && latestDetailTokens.current.get(row.story_id) === token;
    try {
      const res = await fetch(`/api/news/stories/${encodeURIComponent(row.story_id)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (!res.ok) return;
      const parsed = parseTickerNewsStory(await res.json());
      if (!isCurrent()) return;
      if (parsed.story_id !== row.story_id) return;
      setDetails((current) => ({ ...current, [row.story_id]: { token, story: parsed } }));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof Error && error.name === "AbortError") return;
      // Grouped-source expansion is optional depth; keep the main feed usable.
    } finally {
      if (gen === detailGen.current && detailReq.current === request) {
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
      data-news-editorial-policy={snapshot?.editorial_policy}
    >
      <div className={styles.bar}>
        <div className={styles.heading}>
          <span className={styles.title}>{copy.title}</span>
          <span className={styles.symbol}>{symbol}</span>
        </div>
        {state === "live" && <NewsLiveDot lang={lang} />}
        {state === "catching_up" && <span className={styles.stateChip}>{copy.catchingUp}</span>}
      </div>

      {curated && loadState === "ready" && <div className={styles.sourceNote}>{copy.curated}</div>}

      {showFlow && flow && snapshot ? (
        <NewsFlowStrip key={snapshot.ticker} flow={flow} lang={lang} />
      ) : null}

      {presented.length > 0 && (
        <NewsCatchupBar catchup={catchup} lang={lang} labelForSource={sourceLabel} curated={curated} />
      )}

      <div className={styles.scroll}>
        <EmptyState state={loadState} copy={copy} />
        {loadState === "ready" && state === "degraded" && (
          <div className={styles.note} role="status">{copy.degraded}</div>
        )}
        {loadState === "ready" && liveInterrupted && (
          <div className={styles.note} role="status">{copy.liveInterrupted}</div>
        )}
        {loadState === "ready" && state === "quiet" && rows.length === 0 && (
          <div className={styles.empty} role="status">{curated ? copy.curatedQuiet : copy.quiet}</div>
        )}

        {presented.length > 0 && catchup.visible.length === 0 && <NewsFilterEmpty lang={lang} />}

        {presented.length > 0 && catchup.visible.map((row) => {
          const cached = details[row.story_id];
          const detail = cached && cached.token === detailTokens.get(row.story_id) ? cached.story : null;
          const timeRaw = row.updated_at || row.published_at || row.received_at;
          const review = catchup.classify(row);
          return (
            <article
              className={styles.row}
              key={row.story_id}
              data-story-id={row.story_id}
              data-news-review={review?.status} // plain-language-ok: data attribute, not rendered text
            >
              <div className={styles.meta}>
                <NewsReviewTag cls={review} lang={lang} />
                <span className={styles.source}>{reportSourceLabel(row.source, row.content_kind, lang)}</span>
                <time dateTime={timeRaw}>{formatRailTime(timeRaw, lang)}</time>
              </div>
              {row.url ? (
                <a data-news-headline className={styles.headline} href={row.url} target="_blank" rel="noopener noreferrer">{row.title}</a>
              ) : (
                <>
                  <span data-news-headline className={`${styles.headline} ${styles.headlineStatic}`}>{row.title}</span>
                  <span className={styles.srOnly}>{copy.sourceUnavailable}</span>
                </>
              )}
              {row.teaser && <p className={styles.teaser}>{row.teaser}</p>}
              <NewsReviewChange cls={review} lang={lang} />
              <NewsMarkReviewed cls={review} lang={lang} onMark={() => catchup.markStory(row.story_id)} title={row.title} />
              {row.item_count > 1 && (
                <button
                  type="button"
                  className={styles.sourcesButton}
                  aria-expanded={!!detail}
                  onClick={() => void toggleStory(row)}
                  disabled={activeDetailBusy?.storyId === row.story_id}
                >
                  {detail
                    ? copy.closeReports
                    : row.item_count > 1 && row.source_count > 1
                      ? newsFlowText("row.outlets", lang, { n: row.item_count, k: row.source_count })
                      : copy.reports(row.item_count)}
                </button>
              )}
              {detail && (
                <div className={styles.sourceList} role="group" aria-label={copy.reports(detail.item_count)}>
                  <p className={styles.groupNote}>{newsFlowText("row.groupNote", lang)}</p>
                  {detail.members.map((member) => (
                    member.url ? (
                      <a key={JSON.stringify([member.source, member.source_item_id])} href={member.url} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>
                        <span>{reportSourceLabel(member.source, member.content_kind, lang)}</span><span>{member.title}</span>
                      </a>
                    ) : (
                      <div className={`${styles.sourceLink} ${styles.static}`} key={JSON.stringify([member.source, member.source_item_id])}>
                        <span>{reportSourceLabel(member.source, member.content_kind, lang)}</span><span>{member.title}</span>
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