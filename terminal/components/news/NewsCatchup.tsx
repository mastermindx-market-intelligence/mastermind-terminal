"use client";

import styles from "@/components/news/NewsCatchup.module.css";
import type { NewsCatchup, NewsReviewFilter } from "@/components/news/useNewsCatchup";
import {
  newsCatchupText,
  type NewsCatchupKey,
  type NewsCatchupLang,
} from "@/lib/newsCatchupLex";
import type { ReviewClass } from "@/lib/newsReviewState";

const FILTERS: readonly NewsReviewFilter[] = ["all", "new", "updated", "reviewed"];
const FILTER_KEY: Record<NewsReviewFilter, NewsCatchupKey> = {
  all: "ncAll",
  new: "ncNew",
  updated: "ncUpdated",
  reviewed: "ncReviewed",
};

function receiptTime(at: string, lang: NewsCatchupLang): string {
  const dt = new Date(at);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Summary, review filters, optional source filter and the "mark shown" action. */
export function NewsCatchupBar({
  catchup,
  lang,
  labelForSource,
  curated = false,
}: {
  catchup: NewsCatchup;
  lang: NewsCatchupLang;
  labelForSource: (source: string) => string;
  curated?: boolean;
}) {
  const t = (key: NewsCatchupKey, vars?: Record<string, string | number>) => newsCatchupText(key, lang, vars);

  if (catchup.mode === "unavailable") {
    return <div className={styles.note} data-news-review-mode="unavailable">{t("ncNeedsAccount")}</div>;
  }
  if (catchup.mode === "pending") return null;

  const { counts } = catchup;
  const unread = counts.new + counts.updated;
  const total = counts.new + counts.updated + counts.reviewed;
  const countFor = (filter: NewsReviewFilter) => (filter === "all" ? total : counts[filter]);
  const time = catchup.through ? receiptTime(catchup.through.at, lang) : "";

  return (
    <div className={styles.catchup} data-news-catchup data-news-review-mode={catchup.mode}>
      <div className={styles.summaryRow}>
        <span className={styles.summary} aria-live="polite" data-news-catchup-summary>
          {unread > 0 ? t("ncSummary", { new: counts.new, updated: counts.updated }) : t("ncCaughtUp")}
        </span>
        <button
          type="button"
          className={styles.markShown}
          onClick={catchup.markShown}
          disabled={catchup.unreadShown === 0}
          data-news-mark-shown
        >
          {t("ncMarkShown")}
        </button>
      </div>
      <div className={styles.filters}>
        <div className={styles.chips} role="group" aria-label={t("ncFilterLabel")}>
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={styles.chip}
              aria-pressed={catchup.filter === filter}
              onClick={() => catchup.setFilter(filter)}
              data-news-filter={filter}
            >
              <span>{t(FILTER_KEY[filter])}</span>
              <span className={styles.count}>{countFor(filter)}</span>
            </button>
          ))}
        </div>
        {catchup.sources.length > 1 && (
          <select
            className={styles.source}
            aria-label={t("ncSourceLabel")}
            value={catchup.source ?? ""}
            onChange={(event) => catchup.setSource(event.target.value || null)}
            data-news-source-filter
          >
            <option value="">{t(curated ? "ncCuratedSources" : "ncAllSources")}</option>
            {catchup.sources.map((source) => (
              <option key={source} value={source}>{labelForSource(source)}</option>
            ))}
          </select>
        )}
      </div>
      {time && <div className={styles.receipt} data-news-review-receipt>{t("ncThrough", { time })}</div>}
      {catchup.mode === "session" && <div className={styles.note}>{t("ncSessionOnly")}</div>}
    </div>
  );
}

/** "New" / "Updated" / "Reviewed" label for one story row. */
export function NewsReviewTag({ cls, lang }: { cls: ReviewClass | null; lang: NewsCatchupLang }) {
  if (!cls) return null;
  const t = (key: NewsCatchupKey) => newsCatchupText(key, lang);
  const tone = cls.status === "new" ? styles.tagNew : cls.status === "updated" ? styles.tagUpdated : styles.tagReviewed;
  return <span className={`${styles.tag} ${tone}`}>{t(FILTER_KEY[cls.status])}</span>;
}

/** What changed since the user's review: a revision, or more grouped reports. */
export function NewsReviewChange({ cls, lang }: { cls: ReviewClass | null; lang: NewsCatchupLang }) {
  if (!cls || cls.status !== "updated") return null;
  const t = (key: NewsCatchupKey, vars?: Record<string, string | number>) => newsCatchupText(key, lang, vars);
  const text = cls.change === "more_reports"
    ? (cls.added === 1 ? t("ncMoreReport") : t("ncMoreReports", { n: cls.added }))
    : t("ncRevised");
  return <p className={styles.change} data-news-change>{text}</p>;
}

/** Per-story "Mark reviewed" — a local write only; it never touches the story or the network.
 *  `title` (the story headline) only feeds the accessible name, so each button is
 *  distinguishable in a screen-reader button list; the visible text stays ncMarkOne. */
export function NewsMarkReviewed({
  cls,
  lang,
  onMark,
  title,
}: {
  cls: ReviewClass | null;
  lang: NewsCatchupLang;
  onMark: () => void;
  title?: string;
}) {
  if (!cls || cls.status === "reviewed") return null;
  const t = (key: NewsCatchupKey, vars?: Record<string, string | number>) => newsCatchupText(key, lang, vars);
  return (
    <button
      type="button"
      className={styles.markOne}
      onClick={onMark}
      data-news-mark-one
      aria-label={title ? t("ncMarkOneFor", { title }) : undefined}
    >
      {t("ncMarkOne")}
    </button>
  );
}

/** Shown when the review/source filters leave none of the presented stories. */
export function NewsFilterEmpty({ lang }: { lang: NewsCatchupLang }) {
  const t = (key: NewsCatchupKey) => newsCatchupText(key, lang);
  return <div className={styles.empty} role="status" data-news-filter-empty>{t("ncNoMatch")}</div>;
}
