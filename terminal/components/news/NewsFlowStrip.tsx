"use client";
/**
 * The quiet "news flow" line on the ticker news rail (Wave B3 design pin P7): one
 * glance answer to "is this name busier than usual right now", with a details
 * section behind a native button. Never sentiment, never a call, never direction
 * colour — busier, typical and quieter differ only in the words. No title
 * attributes; no CSS rule selects data-comparison.
 */
import { useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import styles from "@/components/news/NewsFlowStrip.module.css";
import NewsFlowTally from "@/components/news/NewsFlowTally";
import type { NewsCatchupLang } from "@/lib/newsCatchupLex";
import { formatRailTime, sourceLabel } from "@/lib/newsDisplay";
import { newsFlowText, type NewsFlowKey } from "@/lib/newsFlowLex";
import type { TickerNewsFlow } from "@/lib/newsTypes";

export default function NewsFlowStrip({
  flow,
  lang,
  initialOpen = false,
  timeZone,
}: {
  flow: TickerNewsFlow;
  lang: NewsCatchupLang;
  /** Specimen-only props; the panel never passes them. */
  initialOpen?: boolean;
  timeZone?: string;
}) {
  const t = (key: NewsFlowKey, vars?: Record<string, string | number>) => newsFlowText(key, lang, vars);
  const [open, setOpen] = useState(initialOpen);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const detailId = useId();
  const headingId = useId();

  // The details contain no focusable elements, so a keydown inside .flow can only
  // originate from the button itself: handling Escape there is behaviourally
  // identical to handling it on the wrapper (P7) and keeps .flow a static element.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  if (flow.state === "unavailable") {
    return (
      <div className={styles.flow} data-flow-state="unavailable">
        <p className={styles.unavailable}>{t("state.unavailable")}</p>
      </div>
    );
  }

  const n = flow.reports_24h ?? 0;
  const countText = n === 0 ? t("count.zero") : n === 1 ? t("count.one") : t("count.many", { n });
  // Partial coverage wins over every comparison (flow_compare.v1 rule row 1).
  const compareText =
    flow.coverage === "partial"
      ? t("cmp.partial")
      : flow.comparison === "busier"
        ? t("cmp.busier")
        : flow.comparison === "quieter"
          ? t("cmp.quieter")
          : flow.comparison === "typical"
            ? t("cmp.typical")
            : t("cmp.insufficient");

  const medianDisplay =
    flow.median_daily_28d === null ? null : String(Math.round(flow.median_daily_28d * 10) / 10);
  const provenance = flow.provenance;
  const sourcesList = provenance
    ? provenance.sources_counted.map(sourceLabel).join(lang === "zh" ? "、" : ", ")
    : "";

  return (
    <div
      className={styles.flow}
      data-flow-state={flow.state}
      data-comparison={flow.comparison ?? "none"}
      data-coverage={flow.coverage}
    >
      <p className={styles.line}>
        <span className={styles.count}>{countText}</span>
        <span className={styles.sep} aria-hidden="true">·</span>
        <span className={styles.srOnly}>, </span>
        <span className={styles.compare}>{compareText}</span>
      </p>
      <button
        ref={buttonRef}
        type="button"
        className={styles.more}
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={t("more.label")}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        ?
      </button>
      {open ? (
        <section id={detailId} className={styles.detail} aria-labelledby={headingId}>
          <h3 id={headingId} className={styles.detailTitle}>{t("d.title")}</h3>
          <NewsFlowTally flow={flow} lang={lang} />
          <dl className={styles.facts}>
            <dt>{t("f.typical.dt")}</dt>
            {flow.state === "ok" && medianDisplay !== null ? (
              <dd className={styles.words}>{t("f.typical.dd", { m: medianDisplay })}</dd>
            ) : (
              <dd className={styles.words}>{t("f.typical.thin.dd", { d: flow.history_days_observed ?? 0 })}</dd>
            )}
            <dt>{t("f.week.dt")}</dt>
            <dd className={styles.num}>{t("f.week.dd", { n: flow.reports_7d ?? 0 })}</dd>
            <dt>{t("f.day.dt")}</dt>
            <dd className={styles.num}>{t("f.day.dd", { n, k: flow.stories_24h ?? 0 })}</dd>
            {provenance ? (
              <>
                <dt>{t("f.published.dt")}</dt>
                <dd className={styles.num}>{t("f.basis.dd", { n: provenance.time_basis_counts_24h.published_at })}</dd>
                <dt>{t("f.received.dt")}</dt>
                <dd className={styles.num}>{t("f.basis.dd", { n: provenance.time_basis_counts_24h.received_at })}</dd>
                <dt>{t("f.sources.dt")}</dt>
                <dd className={styles.words}>{sourcesList}</dd>
              </>
            ) : null}
            <dt>{t("f.asof.dt")}</dt>
            <dd className={styles.num}>{formatRailTime(flow.as_of ?? "", lang, timeZone)}</dd>
          </dl>
          {flow.coverage === "partial" ? <p className={styles.partial}>{t("d.partial")}</p> : null}
          <p className={styles.rule}>{t("d.rule")}</p>
          <p className={styles.method}>{t("d.method")}</p>
          <p className={styles.disclaimer}>{t("d.disclaimer")}</p>
        </section>
      ) : null}
    </div>
  );
}
