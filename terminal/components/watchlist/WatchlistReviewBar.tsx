"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { isSkipped, REVIEW_NOTE_MAX } from "@/lib/watchlistReview";
import type { ReviewNotice, WatchlistReview } from "@/lib/useWatchlistReview";
import { useWatchlistReviewT } from "@/lib/watchlistReviewLex";
import styles from "./WatchlistReviewBar.module.css";

type ManifestName = { name?: string; zh?: string };

/**
 * The review's one surface, mounted once at the top of the rail so it is reachable at desktop,
 * tablet and phone widths. At ≤860px the watchlist board (and its list menu, the desktop entry
 * point) is hidden, so the bar also carries a compact idle "Review <list>" control there.
 */
export default function WatchlistReviewBar({ review, activeSymbol, activeList, activeListCount, manifestSymbols }: {
  review: WatchlistReview;
  activeSymbol: string;
  activeList: string;
  activeListCount: number;
  manifestSymbols: Readonly<Record<string, unknown>> | null;
}) {
  const t = useWatchlistReviewT();
  const { lang } = useLang();
  const [deferFor, setDeferFor] = useState<string | null>(null);
  const [deferNote, setDeferNote] = useState("");
  if (!review.loaded) return null;

  const fill = (key: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), t(key));
  const noticeText = (notice: ReviewNotice): string | null => {
    if (!notice) return null;
    if (notice.kind === "edge") return t(notice.direction === 1 ? "wlrAtEnd" : "wlrAtStart");
    if (notice.kind === "empty") return fill("wlrEmpty", { list: notice.listName });
    if (notice.kind === "moved") return t(notice.ended ? "wlrMovedEnded" : "wlrMoved");
    if (notice.kind === "discardFailed") return t("wlrDiscardFailed");
    const entries = notice.entries
      .map((entry) => fill("wlrSkipEntry", { symbol: entry.symbol, reason: t(entry.availability === "removed" ? "wlrReasonRemoved" : "wlrReasonMissing") }))
      .join(t("wlrSkipJoin"));
    return fill("wlrSkipped", { entries });
  };

  const { itinerary } = review;
  if (!itinerary) {
    if (review.save === "unsaved") {
      return (
        <div className={`${styles.bar} ${styles.alert}`} role="status" data-testid="wl-review-unsaved">
          <p className={styles.warnText}>{t("wlrEndUnsaved")}</p>
          <div className={styles.row}>
            <button type="button" className={styles.textBtn} onClick={review.retrySave}>{t("wlrRetry")}</button>
            <button type="button" className={styles.textBtn} onClick={review.dismissUnsaved}>{t("wlrDismiss")}</button>
          </div>
        </div>
      );
    }
    const notice = noticeText(review.notice);
    return (
      <>
        {notice && <p className={styles.loneNotice} role="status" data-testid="wl-review-notice">{notice}</p>}
        {review.unreadable && (
          <div className={styles.loneNotice} role="status" data-testid="wl-review-unreadable">
            <span>{t("wlrUnreadable")} </span>
            <button type="button" className={styles.textBtn} onClick={review.discardUnreadable}>{t("wlrDiscard")}</button>
          </div>
        )}
        {activeListCount > 0 && (
          <button type="button" className={styles.idle} data-testid="wl-review-idle-start" onClick={() => review.start(activeList)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h11M4 12h11M4 18h7M17 15l3 3-3 3M14 18h6" /></svg>
            <span className={styles.idleText}>
              <b>{fill("wlrStartList", { list: activeList })}</b>
              <span>{fill("wlrStartListCount", { n: activeListCount })}</span>
            </span>
          </button>
        )}
      </>
    );
  }

  const current = review.current;
  const availability = review.currentAvailability;
  const skipped = availability ? isSkipped(availability) : true;
  const mark = review.currentMark;
  const summary = review.summary;
  const row = current ? (manifestSymbols?.[current] as ManifestName | undefined) : undefined;
  const displayName = row ? (lang === "zh" && row.zh ? row.zh : row.name ?? "") : "";
  const editing = deferFor !== null && deferFor === current;
  const notice = noticeText(review.notice);
  const driftCount = review.drift.added.length + review.drift.removed.length;
  const openDefer = () => { setDeferFor(current); setDeferNote(mark?.state === "deferred" ? mark.note ?? "" : ""); };
  const saveDefer = () => { review.defer(deferNote); setDeferFor(null); };
  const markState = mark ? mark.state : undefined;
  const markLabel = markState ? t(markState === "reviewed" ? "wlrReviewed" : "wlrDeferred") : null;

  return (
    <section className={styles.bar} aria-label={t("wlrRegion")} data-testid="wl-review" data-review-list={itinerary.listName}>
      <div className={styles.head}>
        <span className={styles.title}>{fill("wlrTitle", { list: itinerary.listName })}</span>
        {summary && <span className={styles.pos} data-testid="wl-review-position">{fill("wlrPosition", { n: summary.position, total: summary.total })}</span>}
        <button type="button" className={styles.textBtn} onClick={() => { setDeferFor(null); review.end(); }}>{t("wlrEnd")}</button>
      </div>

      <div className={styles.current}>
        <span className={styles.sym} data-testid="wl-review-current">{current}</span>
        {displayName && <span className={styles.name}>{displayName}</span>}
        {markLabel && <span className={styles.chip} data-mark={markState} data-testid="wl-review-mark">{markLabel}</span>}
      </div>
      {mark?.state === "deferred" && mark.note && !editing && <p className={styles.note} data-testid="wl-review-note">{mark.note}</p>}

      {review.listMissing && <p className={styles.warnText}>{fill("wlrListMissing", { list: itinerary.listName })}</p>}
      {!review.listMissing && availability === "removed" && <p className={styles.warnText} data-testid="wl-review-availability">{t("wlrAvailRemoved")}</p>}
      {!review.listMissing && availability === "missing" && <p className={styles.warnText} data-testid="wl-review-availability">{t("wlrAvailMissing")}</p>}
      {availability === "unknown" && <p className={styles.msg} data-testid="wl-review-availability">{t("wlrAvailUnknown")}</p>}
      {current && !skipped && activeSymbol !== current && (
        <div className={styles.row}>
          <span className={styles.msg}>{fill("wlrChartElsewhere", { active: activeSymbol })}</span>
          <button type="button" className={styles.textBtn} onClick={review.resume}>{fill("wlrGoTo", { symbol: current })}</button>
        </div>
      )}

      <div className={styles.controls} role="group" aria-label={t("wlrControls")}>
        <button type="button" className={styles.iconBtn} aria-label={t("wlrPrev")} title={t("wlrPrev")} disabled={!review.canPrev} onClick={review.prev}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <button type="button" aria-pressed={mark?.state === "reviewed"} disabled={skipped} onClick={review.toggleReviewed}>{t("wlrMarkReviewed")}</button>
        <button type="button" aria-pressed={mark?.state === "deferred"} aria-expanded={editing} disabled={skipped} onClick={() => (editing ? setDeferFor(null) : openDefer())}>{t("wlrDefer")}</button>
        <button type="button" className={styles.iconBtn} aria-label={t("wlrNext")} title={review.nextSymbol ? fill("wlrNextIs", { symbol: review.nextSymbol }) : t("wlrNoNext")} disabled={!review.canNext} onClick={review.next}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>

      {editing && (
        <div className={styles.defer}>
          <label className={styles.msg} htmlFor="wl-review-defer-note">{t("wlrDeferNote")}</label>
          <input
            id="wl-review-defer-note"
            autoFocus
            value={deferNote}
            maxLength={REVIEW_NOTE_MAX}
            onChange={(event) => setDeferNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveDefer();
              else if (event.key === "Escape") setDeferFor(null);
            }}
          />
          <p className={styles.msg}>{t("wlrNoteLocal")}</p>
          <div className={styles.row}>
            <button type="button" className={styles.textBtn} onClick={saveDefer}>{t("wlrDeferSave")}</button>
            <button type="button" className={styles.textBtn} onClick={() => setDeferFor(null)}>{t("wlrCancel")}</button>
            {mark && <button type="button" className={styles.textBtn} onClick={() => { review.clearMark(); setDeferFor(null); }}>{t("wlrClearMark")}</button>}
          </div>
        </div>
      )}

      <p className={styles.msg} data-testid="wl-review-next">{review.nextSymbol ? fill("wlrNextIs", { symbol: review.nextSymbol }) : t("wlrNoNext")}</p>
      {summary && (
        <p className={styles.msg} title={t("wlrMarkersOnly")} data-testid="wl-review-summary">
          {fill("wlrSummary", { r: summary.reviewed, d: summary.deferred, u: summary.unavailable })}
          {summary.unknown > 0 && ` · ${fill("wlrUnknownCount", { n: summary.unknown })}`}
        </p>
      )}

      {driftCount > 0 && (
        <div className={styles.drift} data-testid="wl-review-drift">
          <p className={styles.msg}>{fill("wlrDrift", { a: review.drift.added.length, r: review.drift.removed.length })}</p>
          <button type="button" className={styles.textBtn} onClick={review.refresh}>{t("wlrUpdate")}</button>
        </div>
      )}

      <p className={styles.msg} role="status" aria-live="polite" data-testid="wl-review-notice">{notice ?? ""}</p>

      {review.save === "saved"
        ? <p className={styles.saved} data-testid="wl-review-save" data-save="saved">{t("wlrSaved")}</p>
        : (
          <div className={styles.row} data-testid="wl-review-save" data-save="unsaved">
            <span className={styles.warnText}>{t("wlrUnsaved")}</span>
            <button type="button" className={styles.textBtn} onClick={review.retrySave}>{t("wlrRetry")}</button>
          </div>
        )}
    </section>
  );
}
