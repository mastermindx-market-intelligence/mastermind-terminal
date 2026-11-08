"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { readingJson } from "@/lib/shared-shell/useReadingScope";
import { catalogItems, readingBody, record, type CatalogItem } from "@/lib/shared-shell/readingPayloads";
import { loadBrowserReadingProgress, readingHref, type ReadingProgress } from "@/lib/shared-shell/readingProgress";
import { isDocId, type ReadingSelection } from "@/lib/shared-shell/readingContracts";
import styles from "@/components/workspaces/ReadingWorkspace.module.css";
import today from "./TodayWorkspace.module.css";

export type TodayResearchParts = { continuation: ReactNode; briefing: ReactNode };

export type TodayResearchAttentionProps = {
  ownerKey: string;
  scope: { current: AbortController | null };
  onUnauthenticated: () => void;
  render?: (parts: TodayResearchParts) => ReactNode;
};

const CATALOG_URL = "/api/shared-shell/research/catalog";
// Explicit current-revision probe: the local pins are deliberately NOT sent,
// so the answer describes the server's current revision, never a cached one.
const readUrl = (docId: string) => `/api/shared-shell/research/read/${docId}?segment_start=0&max_segments=2`;

const EN = {
  eyebrow: "Research attention",
  heading: "Today's research briefing",
  resumeEyebrow: "Saved position",
  continuation: "Pick up where you left off",
  noPosition: "Choose a report from the Research library to start reading.",
  localScope: "Reading position is kept only on this origin and browser profile. Current access is checked again on reopen.",
  resume: "Resume reading",
  segmentAt: (segmentStart: number): string => `text window starting at segment ${segmentStart + 1}`,
  segment0: "Start of report",
  checkCurrent: "Check current report revision",
  allowance: "This check uses one report text window from your viewing allowance.",
  openCurrent: "Check report revision",
  readRevision: "Read this revision",
  differentCurrent: "A different current revision is available",
  matchesCurrent: "Your saved revision matches the current revision.",
  checking: "Checking the current revision…",
  rateLimited: "The report service asked you to wait before another read. Try again shortly.",
  readFailed: "The current revision could not be confirmed. Nothing was changed.",
  readDenied: "Current access does not permit this research selection.",
  plans: "View plans",
  retryCheck: "Retry check",
  retryCatalog: "Retry catalog",
  catalogLoading: "Loading the research catalog…",
  catalogUnavailable: "The research catalog is unavailable right now.",
  catalogDenied: "Current access does not permit this research selection.",
  catalogEmpty: "No reports are available in the catalog yet.",
  catalogPreview: "Your access includes a catalog preview. Full report text requires current Pro access.",
  catalogStale: "The catalog is behind. Each report keeps its own publication date.",
  catalogGenerated: "Catalog generated ",
  ended: "Your session ended. Sign in again to continue.",
  library: "Open the research library",
};
const ZH: typeof EN = {
  eyebrow: "研究关注",
  heading: "今日研究简报",
  resumeEyebrow: "已保存位置",
  continuation: "接续上次阅读",
  noPosition: "从研究资料库选择报告，开始阅读。",
  localScope: "阅读位置仅保留在当前来源与浏览器配置中。重新打开时会再次核验当前权限。",
  resume: "继续阅读",
  segmentAt: (segmentStart: number): string => `文本窗口从第 ${segmentStart + 1} 段开始`,
  segment0: "报告开头",
  checkCurrent: "检查当前报告修订",
  allowance: "此检查会使用您浏览额度中的一个报告文本窗口。",
  openCurrent: "检查报告修订",
  readRevision: "阅读此修订",
  differentCurrent: "有一个不同的当前修订可用",
  matchesCurrent: "您保存的修订与当前修订一致。",
  checking: "正在检查当前修订…",
  rateLimited: "报告服务要求等待后再读取，请稍后重试。",
  readFailed: "无法确认当前修订，未做任何更改。",
  readDenied: "当前访问权限不允许此研究内容。",
  plans: "查看方案",
  retryCheck: "重试检查",
  retryCatalog: "重试目录",
  catalogLoading: "正在加载研究目录…",
  catalogUnavailable: "研究目录目前不可用。",
  catalogDenied: "当前访问权限不允许此研究内容。",
  catalogEmpty: "目录中暂无可用报告。",
  catalogPreview: "当前权限提供目录预览；完整报告正文需要当前 Pro 权限。",
  catalogStale: "目录更新滞后。各报告保留自己的发布日期。",
  catalogGenerated: "目录生成于 ",
  ended: "会话已结束，请重新登录。",
  library: "打开研究库",
};

type CatalogState =
  | { phase: "loading" }
  | { phase: "ready"; items: CatalogItem[]; preview: boolean; stale: boolean; generatedAt: string | null }
  | { phase: "empty" }
  | { phase: "denied" }
  | { phase: "unavailable" }
  | { phase: "ended" };

type CheckOrigin = "resume" | "catalog";

type CheckState =
  | { kind: "idle" }
  | { kind: "busy"; origin: CheckOrigin; docId: string }
  | { kind: "result"; origin: CheckOrigin; docId: string; selection: ReadingSelection; comparison: "same" | "different" | "none" }
  | { kind: "wait"; origin: CheckOrigin; docId: string }
  | { kind: "denied"; origin: CheckOrigin; docId: string }
  | { kind: "failed"; origin: CheckOrigin; docId: string }
  | { kind: "ended" };

const sameSelection = (a: ReadingSelection, b: ReadingSelection): boolean =>
  a.docId === b.docId &&
  a.sourcePdfSha256 === b.sourcePdfSha256 &&
  a.extractedTextSha256 === b.extractedTextSha256 &&
  a.extractorVersion === b.extractorVersion &&
  a.segmenterVersion === b.segmenterVersion;

function TodayResearchAttentionSession({ ownerKey, scope, onUnauthenticated, render }: TodayResearchAttentionProps) {
  const { lang } = useLang();
  const t = lang === "zh" ? ZH : EN;
  const headingId = useId();
  const [catalog, setCatalog] = useState<CatalogState>({ phase: "loading" });
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const catalogRun = useRef(0);
  const readRun = useRef(0);
  const readPending = useRef(false);
  const unauthenticatedRef = useRef(onUnauthenticated);
  useEffect(() => { unauthenticatedRef.current = onUnauthenticated; });

  // The resume pointer is read exactly once per keyed owner lifetime and is
  // never written by this component.
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => { if (alive) setProgress(loadBrowserReadingProgress(ownerKey)); });
    return () => { alive = false; };
  }, [ownerKey]);

  const runCatalog = useCallback(async () => {
    const controller = scope.current;
    if (!controller || controller.signal.aborted) return;
    const run = ++catalogRun.current;
    setCatalog({ phase: "loading" });
    try {
      const { response, value } = await readingJson(scope, CATALOG_URL);
      if (catalogRun.current !== run || scope.current !== controller || controller.signal.aborted) return;
      if (response.status === 401) { setCatalog({ phase: "ended" }); unauthenticatedRef.current(); return; }
      if (response.status === 402 || response.status === 403) { setCatalog({ phase: "denied" }); return; }
      if (!response.ok) { setCatalog({ phase: "unavailable" }); return; }
      const items = catalogItems(value);
      if (items === null) { setCatalog({ phase: "unavailable" }); return; }
      if (items.length === 0) { setCatalog({ phase: "empty" }); return; }
      const envelope = record(value) ? value : {};
      setCatalog({
        phase: "ready",
        items,
        preview: envelope.preview === true,
        stale: envelope.stale === true,
        generatedAt: typeof envelope.generated_at === "string" ? envelope.generated_at : null,
      });
    } catch {
      // A superseded run or an aborted/inactive scope discards its result
      // silently; a live failure of the current run stays visible.
      if (catalogRun.current !== run || scope.current !== controller || controller.signal.aborted) return;
      setCatalog({ phase: "unavailable" });
    }
  }, [scope]);

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => { if (alive) void runCatalog(); });
    return () => { alive = false; catalogRun.current += 1; readRun.current += 1; };
  }, [runCatalog]);

  const checkReport = useCallback(async (origin: CheckOrigin, rawDocId: string) => {
    const controller = scope.current;
    if (!controller || controller.signal.aborted) return;
    if (!isDocId(rawDocId) || readPending.current) return;
    readPending.current = true;
    const docId = rawDocId;
    const run = ++readRun.current;
    setCheck({ kind: "busy", origin, docId });
    try {
      const { response, value } = await readingJson(scope, readUrl(docId));
      if (readRun.current !== run || scope.current !== controller || controller.signal.aborted) return;
      if (response.status === 401) { setCheck({ kind: "ended" }); unauthenticatedRef.current(); return; }
      if (response.status === 429) { setCheck({ kind: "wait", origin, docId }); return; }
      if (response.status === 402 || response.status === 403) { setCheck({ kind: "denied", origin, docId }); return; }
      if (!response.ok) { setCheck({ kind: "failed", origin, docId }); return; }
      const parsed = readingBody(value, docId, null, 0);
      if (!parsed) { setCheck({ kind: "failed", origin, docId }); return; }
      // Only the revision tuple is kept; the returned segment text is dropped.
      const selection = parsed.selection;
      const comparison = progress && progress.selection.docId === docId
        ? (sameSelection(progress.selection, selection) ? "same" : "different")
        : "none";
      setCheck({ kind: "result", origin, docId, selection, comparison });
    } catch {
      if (readRun.current !== run || scope.current !== controller || controller.signal.aborted) return;
      setCheck({ kind: "failed", origin, docId });
    } finally {
      if (readRun.current === run) readPending.current = false;
    }
  }, [progress, scope]);

  const showStatus = (origin: CheckOrigin, docId?: string): ReactNode => {
    if (check.kind === "idle" || check.kind === "ended") return null;
    if (check.origin !== origin) return null;
    if (docId !== undefined && check.docId !== docId) return null;
    switch (check.kind) {
      case "busy":
        return <p className={styles.muted}>{t.checking}</p>;
      case "wait":
        return (
          <div>
            <p className={styles.notice}>{t.rateLimited}</p>
            <div className={styles.actions}>
              <button type="button" onClick={() => void checkReport(origin, check.docId)}>{t.retryCheck}</button>
            </div>
          </div>
        );
      case "denied":
        return (
          <div>
            <p className={styles.notice}>{t.readDenied}</p>
            <div className={styles.actions}>
              <Link className={styles.action} href="/plans.html">{t.plans}</Link>
            </div>
          </div>
        );
      case "failed":
        return (
          <div>
            <p className={styles.notice}>{t.readFailed}</p>
            <div className={styles.actions}>
              <button type="button" onClick={() => void checkReport(origin, check.docId)}>{t.retryCheck}</button>
            </div>
          </div>
        );
      case "result":
        return (
          <div>
            {check.comparison === "same" && <p className={styles.muted}>{t.matchesCurrent}</p>}
            {check.comparison === "different" && <p className={styles.notice}>{t.differentCurrent}</p>}
            {check.comparison !== "same" && (
              <div className={styles.actions}>
                <Link className={styles.action} href={readingHref(check.selection, 0)}>{t.readRevision}</Link>
                <small className={styles.source}>{check.selection.docId} · {t.segment0}</small>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  // Layout slots share this single reader lifetime and request generation. The
  // caller can put continuation before secondary coverage without mounting a
  // second data owner or using CSS to reverse keyboard/reading order.
  const continuation = <section aria-labelledby={`${headingId}-continue`}>
    <h2 id={`${headingId}-continue`}>{t.continuation}</h2>
    {progress ? <div className={today.resumeBody}>
      <p className={today.kicker}>{t.resumeEyebrow}</p>
      <h3>{catalog.phase === "ready" ? catalog.items.find(item => item.id === progress.selection.docId)?.title || progress.selection.docId : progress.selection.docId}</h3>
      <p className={today.readingPosition}>{t.segmentAt(progress.segmentStart)}</p>
      <Link className={today.resumeLink} href={readingHref(progress.selection, progress.segmentStart)}>{t.resume}<span aria-hidden="true">→</span></Link>
      {showStatus("resume")}
      <div className={today.revisionCheck}>
        <button className={today.quietAction} type="button" disabled={check.kind === "busy"} aria-describedby={`${headingId}-resume-allowance`} onClick={() => void checkReport("resume", progress.selection.docId)}>{t.checkCurrent}</button>
        <p className={today.helper} id={`${headingId}-resume-allowance`}>{t.allowance}</p>
      </div>
      <p className={today.localNote}>{t.localScope}</p>
    </div> : <p className={styles.muted}>{t.noPosition}</p>}
    <Link className={today.libraryLink} href="/research">{t.library}<span aria-hidden="true">→</span></Link>
  </section>;
  const briefing = <section aria-labelledby={headingId}>
    <div className={today.jobHeader}><h2 id={headingId}>{t.heading}</h2></div>
    {catalog.phase === "loading" && <p className={styles.muted}>{t.catalogLoading}</p>}
    {catalog.phase === "unavailable" && <div className={styles.notice}>
      <p>{t.catalogUnavailable}</p><div className={styles.actions}><button type="button" onClick={() => void runCatalog()}>{t.retryCatalog}</button></div>
    </div>}
    {catalog.phase === "denied" && <div className={styles.notice}>
      <p>{t.catalogDenied}</p><div className={styles.actions}><Link className={styles.action} href="/plans.html">{t.plans}</Link></div>
    </div>}
    {catalog.phase === "empty" && <p className={styles.notice}>{t.catalogEmpty}</p>}
    {catalog.phase === "ended" && <p className={styles.muted}>{t.ended}</p>}
    {catalog.phase === "ready" && <>
      {catalog.preview && <p className={styles.notice}>{t.catalogPreview}</p>}
      {catalog.stale && <p className={styles.notice}>{t.catalogStale}</p>}
      <p className={today.helper} id={`${headingId}-catalog-allowance`}>{t.allowance}</p>
      <ul className={today.researchList}>
        {catalog.items.slice(0, 3).map(item => <li key={item.id} className={today.researchRow}>
          <p className={today.researchMeta}>{[item.institution, item.published_at].filter(Boolean).join(" · ")}</p>
          <h3>{item.title}</h3>
          {item.summary_points && item.summary_points.length > 0 && <p className={today.researchSummary}>{item.summary_points[0]}</p>}
          <button className={today.quietAction} type="button" disabled={check.kind === "busy"} aria-describedby={`${headingId}-catalog-allowance`} onClick={() => void checkReport("catalog", item.id)}>{t.openCurrent}<span aria-hidden="true">→</span></button>
          {showStatus("catalog", item.id)}
        </li>)}
      </ul>
      {catalog.generatedAt && <p className={today.catalogClock}>{t.catalogGenerated}{catalog.generatedAt}</p>}
    </>}
    <Link className={today.libraryLink} href="/research">{t.library}<span aria-hidden="true">→</span></Link>
  </section>;
  return render ? <>{render({ continuation, briefing })}</> : <>{continuation}{briefing}</>;

}

/** Keyed by owner so any subject departure - including A→B→A - destroys the
 * whole inner session state instead of resurrecting it. */
export default function TodayResearchAttention(props: TodayResearchAttentionProps) {
  return <TodayResearchAttentionSession key={props.ownerKey} {...props} />;
}
