"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { SHARED_SHELL_LEGACY_ORIGIN } from "@/lib/sharedShellOrigins";
import { archiveFilter, editorialTopics, filterEditorialReports, type ArchiveFilter, type EditorialReport } from "@/lib/shared-shell/editorialReports";
import styles from "./archive.module.css";

const COPY = {
  en: { parent: "Research", title: "Research Reports", intro: "Editorial briefings and in-depth market research.",
    latest: "Latest report", read: "Read report", min: "min", archive: "Report archive", topics: "Filter by topic",
    all: "All topics", search: "Search reports", order: "Sort reports", newest: "Newest first", oldest: "Oldest first",
    clear: "Clear filters", none: "No reports match these filters.", empty: "No reports have been published.",
    unavailable: "The report archive is temporarily unavailable.", original: "Open the published archive", singular: "report", plural: "reports", reading: "min of reading" },
  zh: { parent: "研究", title: "研究报告", intro: "编辑简报与深度市场研究。",
    latest: "最新报告", read: "阅读报告", min: "分钟", archive: "报告归档", topics: "按主题筛选",
    all: "所有主题", search: "搜索报告", order: "报告排序", newest: "最新在前", oldest: "最早在前",
    clear: "清除筛选", none: "没有符合这些条件的报告。", empty: "尚未发布报告。",
    unavailable: "报告归档暂时不可用。", original: "打开已发布的报告归档", singular: "篇报告", plural: "篇报告", reading: "分钟阅读" },
};

function reportHref(report: EditorialReport) {
  return SHARED_SHELL_LEGACY_ORIGIN + "/" + report.slug + ".html";
}

export default function EditorialArchive({ reports }: { reports: EditorialReport[] | null }) {
  const { lang } = useLang();
  const c = COPY[lang];
  const params = useSearchParams();
  const topics = useMemo(() => editorialTopics(reports ?? []), [reports]);
  const filter = archiveFilter(new URLSearchParams(params.toString()), topics);
  const [draft, setDraft] = useState(filter.q);
  const search = useRef<HTMLInputElement>(null);
  const latest = reports?.[0];
  const matches = filterEditorialReports(reports ?? [], { ...filter, q: draft });
  const date = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
  const dateLabel = (value: string) => date.format(new Date(value + "T00:00:00Z"));
  const title = (report: EditorialReport) => lang === "zh" ? report.title_zh : report.title_en;
  const dek = (report: EditorialReport) => lang === "zh" ? report.dek_zh : report.dek_en;

  useEffect(() => {
    // A link within the app can change the query without remounting the archive.
    // Preserve trailing spaces typed locally while the canonical URL is trimmed.
    setDraft(previous => previous.trim() === filter.q ? previous : filter.q);
  }, [filter.q]);
  useEffect(() => {
    // History navigation restores the exact shared URL, including the query text.
    function restore() { setDraft(new URLSearchParams(location.search).get("q") ?? ""); }
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.isComposing ||
        !search.current || document.querySelector("dialog[open]")) return;
      const target = event.target;
      if (event.key === "/" && !(target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)))) {
        event.preventDefault(); search.current.focus();
      }
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);

  function change(next: ArchiveFilter, push: boolean) {
    const url = new URL(location.href);
    for (const key of ["q", "tag", "sort"]) url.searchParams.delete(key);
    if (next.q.trim()) url.searchParams.set("q", next.q.trim());
    if (next.tag !== "all") url.searchParams.set("tag", next.tag);
    if (next.sort === "old") url.searchParams.set("sort", next.sort);
    if (url.href !== location.href) {
      // Next.js synchronizes useSearchParams for native pushState/replaceState.
      if (push) history.pushState(null, "", url);
      else history.replaceState(null, "", url);
    }
    setDraft(next.q);
  }
  function clear() {
    change({ q: "", tag: "all", sort: filter.sort }, true);
    search.current?.focus();
  }

  return <main id="shared-shell-content" tabIndex={-1} className={"main2 " + styles.reader}>
    <div className={styles.column} id="rf-top">
      <header><p className={styles.crumb}>{c.parent}</p><h1>{c.title}</h1><p>{c.intro}</p></header>
      {reports === null ? <section className={styles.notice}>
        <p>{c.unavailable}</p><a href={SHARED_SHELL_LEGACY_ORIGIN + "/reports.html"}>{c.original} ↗</a>
      </section> : !latest ? <p>{c.empty}</p> : <>
        <section className={styles.feature} aria-labelledby="latest-report-title">
          <p className={styles.eyebrow}>{c.latest} <span>·</span> <time dateTime={latest.date}>{dateLabel(latest.date)}</time> <span>·</span> {latest.read_min} {c.min}</p>
          <h2 id="latest-report-title">{title(latest)}</h2><p>{dek(latest)}</p>
          <a href={reportHref(latest)}>{c.read} <span aria-hidden="true">↗</span></a>
        </section>
        <div id="covBars"><div id="tagBar" role="group" aria-label={c.topics} className={styles.topics}>
          <button type="button" aria-pressed={filter.tag === "all"} onClick={() => change({ ...filter, q: draft, tag: "all" }, true)}>{c.all}</button>
          {topics.map(topic => <button key={topic.key} type="button" aria-pressed={filter.tag === topic.key}
            onClick={() => change({ ...filter, q: draft, tag: filter.tag === topic.key ? "all" : topic.key }, true)}>
            {topic[lang]} <span>{topic.count}</span>
          </button>)}
        </div></div>
        <section aria-labelledby="report-archive-title" className={styles.archive}>
          <h2 id="report-archive-title">{c.archive}</h2>
          <div className={styles.controls}>
            <input ref={search} id="repSearch" type="search" aria-label={c.search} placeholder={c.search} value={draft}
              onChange={event => change({ ...filter, q: event.target.value }, false)}
              onKeyDown={event => {
                if (event.key === "Escape" && draft) { event.preventDefault(); change({ ...filter, q: "" }, false); }
              }} />
            <select id="repSort" aria-label={c.order} value={filter.sort} onChange={event =>
              change({ ...filter, q: draft, sort: event.target.value === "old" ? "old" : "new" }, true)}>
              <option value="new">{c.newest}</option><option value="old">{c.oldest}</option>
            </select>
            <span role="status" id="repCount">{matches.length} {matches.length === 1 ? c.singular : c.plural} · {matches.reduce((total, report) => total + report.read_min, 0)} {c.reading}</span>
          </div>
          {matches.length > 0 && (draft || filter.tag !== "all") && <button id="repClear" type="button" className={styles.clear} onClick={clear}>{c.clear}</button>}
          {matches.length === 0 && <div id="noResults"><p>{c.none}</p><button id="repClear2" type="button" className={styles.clear} onClick={clear}>{c.clear}</button></div>}
          <ul id="reportList" className={styles.reports}>{matches.map(report => <li key={report.slug}>
            <a href={reportHref(report)}>
              <time dateTime={report.date}>{dateLabel(report.date)}</time>
              <div><h3>{title(report)}</h3><p>{dek(report)}</p></div>
              <span className={styles.minutes}>{report.read_min} {c.min} <i aria-hidden="true">↗</i></span>
            </a>
          </li>)}</ul>
        </section>
      </>}
    </div>
  </main>;
}
