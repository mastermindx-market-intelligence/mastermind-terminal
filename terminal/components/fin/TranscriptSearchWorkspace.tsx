"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../../lib/i18n";
import { pick } from "../../lib/finFormat";
import {
  browserCompanySourceSearchAdapter,
  normalizeTranscriptLiteralPhrase,
  type CompanySourceCompareRequest,
  type CompanySourceSearchAdapter,
  type CompanySourceSearchEvent,
  type CompanySourceSearchResult,
  type CompanySourceSpan,
} from "../../lib/companySourceSearch";
import { toCompanySourceContextRef, type CompanySourceContextRef } from "../../lib/companySourceContext";
import {
  bindMastermindBrainCompanySource,
  openMastermindBrainForCompanySource,
} from "../../lib/mastermindBrain";
import type { TranscriptOpenTarget } from "../../lib/transcriptSearch";

type RequestPhase = "idle" | "loading" | "settled";

interface RequestState {
  phase: RequestPhase;
  result: CompanySourceSearchResult | null;
}

export interface TranscriptSearchWorkspaceProps {
  ticker: string;
  events: CompanySourceSearchEvent[];
  initialEventId: string;
  onOpenTranscript: (target: TranscriptOpenTarget) => void;
  /** Tests may inject the deterministic fixture adapter; production uses the BFF. */
  adapter?: CompanySourceSearchAdapter;
}

function highlightExact(text: string, needle: string): ReactNode {
  const target = needle.trim();
  if (!target) return text;
  const lower = text.toLocaleLowerCase();
  const targetLower = target.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match = lower.indexOf(targetLower);
  while (match >= 0) {
    if (match > cursor) parts.push(text.slice(cursor, match));
    parts.push(<mark key={`${match}-${cursor}`}>{text.slice(match, match + target.length)}</mark>);
    cursor = match + target.length;
    match = lower.indexOf(targetLower, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length ? parts : text;
}

// This workspace was authored with the Chinese source copy first.  `pick`
// deliberately accepts English first across Terminal, so keep the inversion in
// one named helper rather than letting it leak into every visible string.
function localized(zh: boolean, chinese: string, english: string): string {
  return pick(zh, english, chinese);
}

function totalExactMatches(result: Extract<CompanySourceSearchResult, { state: "ready" }>): number {
  return Object.values(result.match_count_by_event).reduce((sum, count) => sum + count, 0);
}

function resultLabel(result: CompanySourceSearchResult, zh: boolean): string {
  if (result.state === "ready") {
    const total = totalExactMatches(result);
    if (total === 0) return localized(zh, "未找到精确命中", "No exact matches");
    if (result.count_capped_event_ids.length > 0) {
      return localized(zh, `至少 ${total} 个精确命中 · 显示 ${result.spans.length} 个`, `At least ${total} exact matches · ${result.spans.length} shown`);
    }
    return result.truncated
      ? localized(zh, `${total} 个精确命中 · 显示 ${result.spans.length} 个`, `${total} exact matches · ${result.spans.length} shown`)
      : localized(zh, `${total} 个精确命中`, `${total} exact matches`);
  }
  if (result.state === "not_covered") return localized(zh, "尚未覆盖", "Not covered");
  if (result.state === "stale_revision") return localized(zh, "版本已过期", "Revision stale");
  if (result.state === "unavailable") return localized(zh, "来源暂不可用", "Source unavailable");
  return localized(zh, "请求未完成", "Request unavailable");
}

function stateCopy(result: CompanySourceSearchResult, zh: boolean): string {
  if (result.state === "not_covered") return localized(zh, "该公司或选定事件目前没有已提交的电话会正文。", "This company or selected event does not have a committed transcript body yet.");
  if (result.state === "stale_revision") return localized(zh, "选定的电话会修订已发生变化。请刷新公司情报后重新搜索。", "The selected transcript revision changed. Refresh Company Intelligence and run the search again.");
  if (result.state === "unavailable") return localized(zh, "已验证的电话会来源暂时不可用。请重试，搜索范围不会自动扩大。", "The verified transcript source is temporarily unavailable. Retry without broadening the search.");
  if (result.state === "error") return result.retryable
    ? localized(zh, "精确来源搜索未能完成。请重试。", "Exact source search did not complete. Please retry.")
    : localized(zh, "请检查搜索短语与所选事件后重试。", "Check the phrase and selected events, then try again.");
  if (totalExactMatches(result) === 0) {
    return localized(
      zh,
      "已在选定事件中进行精确字面匹配；没有段落包含该短语。系统没有扩展、改写或推断关联内容。",
      "The selected events were checked for this literal phrase. No segment contains it; no expansion, paraphrase, or inferred relevance was used.",
    );
  }
  if (result.count_capped_event_ids.length > 0) return localized(zh, "结果按事件公平分配显示；标为“至少”的总数在每事件安全上限处停止计数。", "Shown results are allocated fairly across events; totals marked “at least” stopped counting at the per-event safety ceiling.");
  if (result.truncated) return localized(zh, "结果按事件公平分配显示；总数包含因显示上限而省略的精确命中。", "Shown results are allocated fairly across events; totals include exact matches omitted by the display cap.");
  return localized(zh, "每项均为带修订凭证的字面匹配。", "Every result is a literal match with a revision receipt.");
}

function EventName({ event, zh }: { event: CompanySourceSearchEvent; zh: boolean }) {
  return <>{event.label}{event.call_date ? <small>{event.call_date}</small> : null}{!event.transcript_id && <i title={localized(zh, "未关联已验证电话会正文", "No verified transcript body linked")}>!</i>}</>;
}

function linkedEvents(events: readonly CompanySourceSearchEvent[]): CompanySourceSearchEvent[] {
  return events.filter((event) => !!event.transcript_id);
}

function initialLinkedEventId(events: readonly CompanySourceSearchEvent[], preferred: string): string {
  return events.find((event) => event.event_id === preferred && event.transcript_id)?.event_id
    ?? events.find((event) => event.transcript_id)?.event_id
    ?? "";
}

function ResultState({ result, zh, onRetry }: { result: CompanySourceSearchResult; zh: boolean; onRetry: () => void }) {
  const kind = result.state === "ready" ? result.spans.length ? "ready" : "empty" : result.state;
  return (
    <div className={`ci-ts-state ${kind}`} role={result.state === "error" ? "alert" : "status"}>
      <span className="ci-ts-state-mark" aria-hidden>{kind === "ready" ? "✓" : kind === "empty" ? "⌕" : kind === "stale_revision" ? "!" : "—"}</span>
      <div>
        <strong>{resultLabel(result, zh)}</strong>
        <p title={result.state === "ready" ? undefined : result.message}>{stateCopy(result, zh)}</p>
      </div>
      {(result.state === "error" || result.state === "unavailable") && result.retryable && <button className="btn btn-ghost" onClick={onRetry}>{localized(zh, "重试", "Retry")}</button>}
    </div>
  );
}

function SpanCard({
  span,
  phrase,
  zh,
  onOpenTranscript,
  onReceipt,
  onAttach,
}: {
  span: CompanySourceSpan;
  phrase: string;
  zh: boolean;
  onOpenTranscript: (target: TranscriptOpenTarget) => void;
  onReceipt: (span: CompanySourceSpan, trigger: HTMLButtonElement) => void;
  onAttach: (span: CompanySourceSpan) => void;
}) {
  return (
    <article className="ci-ts-span" data-span-id={span.span_id}>
      <header>
        <div className="ci-ts-span-identity">
          <span className={`ci-ts-section ${span.section}`}>{span.section === "qa" ? "Q&A" : span.section === "prepared" ? localized(zh, "陈述", "Prepared") : localized(zh, "未知段落", "Unclassified")}</span>
          <span className="ci-ts-segment num">{localized(zh, "段", "Segment")} {span.segment_index + 1}</span>
        </div>
        <div className="ci-ts-span-actions">
          <button className="ci-ts-link" onClick={() => onOpenTranscript({ id: span.transcript_id, segment_index: span.segment_index, expected_document_sha256: span.document_sha256, query: phrase })}>{localized(zh, "打开原文", "Open source")}</button>
          <button className="ci-ts-link" onClick={(event) => onReceipt(span, event.currentTarget)}>{localized(zh, "凭证", "Receipt")}</button>
          <button className="ci-ts-link" type="button" onClick={() => onAttach(span)} disabled={span.receipt.verification !== "verified"}>{localized(zh, "附加给 Mastermind", "Attach to Mastermind")}</button>
        </div>
      </header>
      <div className="ci-ts-speaker">
        <strong>{span.speaker}</strong>
        {span.role && <span>{span.role}</span>}
      </div>
      <p>{highlightExact(span.excerpt, phrase)}</p>
      <footer><code>{span.transcript_id}</code><span>{span.receipt.verification === "verified" ? localized(zh, "已验证修订", "Verified revision") : localized(zh, "过期修订", "Stale revision")}</span></footer>
    </article>
  );
}

function ReceiptDialog({
  span,
  zh,
  onClose,
}: {
  span: CompanySourceSpan;
  zh: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const wrap = wrapRef.current;
    if (!wrap || wrap.parentElement !== document.body) return;

    const activeBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrollContainer = activeBeforeOpen?.closest<HTMLElement>(".fin-body") ?? null;
    const scrollTop = scrollContainer?.scrollTop ?? 0;
    const scrollLeft = scrollContainer?.scrollLeft ?? 0;
    const windowX = window.scrollX;
    const windowY = window.scrollY;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    const background = [...document.body.children]
      .filter((child): child is HTMLElement => child !== wrap && child instanceof HTMLElement);
    const prior = background.map((child) => ({ child, hadInert: child.hasAttribute("inert") }));

    prior.forEach(({ child }) => child.setAttribute("inert", ""));
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      prior.forEach(({ child, hadInert }) => {
        if (!hadInert) child.removeAttribute("inert");
      });
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollTop;
        scrollContainer.scrollLeft = scrollLeft;
      }
      window.scrollTo(windowX, windowY);
      activeBeforeOpen?.focus({ preventScroll: true });
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])',
      )].filter((control) => !control.hasAttribute("hidden"));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mounted, onClose]);

  const receipt = span.receipt;
  const node = (
    <div ref={wrapRef} className="ci-ts-dialog-wrap" role="presentation">
      <button className="ci-ts-dialog-scrim" aria-label={localized(zh, "关闭来源凭证", "Close source receipt")} onClick={onClose} />
      <aside ref={dialogRef} className="ci-ts-dialog" role="dialog" aria-modal="true" aria-labelledby="ci-ts-receipt-title">
        <header>
          <div>
            <span className="fin-eyebrow">{localized(zh, "修订绑定来源凭证", "REVISION-BOUND SOURCE RECEIPT")}</span>
            <h3 id="ci-ts-receipt-title">{span.speaker} · {span.transcript_id}</h3>
          </div>
          <button ref={closeRef} className="ci-icon-button" onClick={onClose} aria-label={localized(zh, "关闭来源凭证", "Close source receipt")}>×</button>
        </header>
        <dl>
          <div><dt>{localized(zh, "验证状态", "Verification")}</dt><dd><span className={`ci-ts-verify ${receipt.verification}`}>{receipt.verification === "verified" ? localized(zh, "已验证", "Verified") : localized(zh, "版本已过期", "Revision stale")}</span></dd></div>
          <div><dt>{localized(zh, "索引版本", "Corpus revision")}</dt><dd><code>{receipt.revision_id}</code></dd></div>
          <div><dt>{localized(zh, "文档 SHA-256", "Document SHA-256")}</dt><dd><code>{receipt.document_sha256}</code></dd></div>
          <div><dt>{localized(zh, "UTF-8 字节坐标", "UTF-8 byte coordinates")}</dt><dd><code>{span.segment_index}:{span.start_byte}-{span.end_byte}</code></dd></div>
          <div><dt>{localized(zh, "段落文本 SHA-256", "Segment text SHA-256")}</dt><dd><code>{span.segment_text_sha256}</code></dd></div>
          <div><dt>{localized(zh, "索引时间", "Indexed at")}</dt><dd><time dateTime={receipt.indexed_at}>{receipt.indexed_at.replace("T", " ").replace("Z", " UTC")}</time></dd></div>
          <div><dt>{localized(zh, "来源", "Source")}</dt><dd>{receipt.source_url ? <a href={receipt.source_url} target="_blank" rel="noreferrer">{receipt.source_label} ↗</a> : receipt.source_label}</dd></div>
        </dl>
        <p className="ci-ts-dialog-note">{localized(zh, "此窗口显示服务器签发的修订与坐标；Terminal 不生成、拼接或重新解释原始文本。", "This receipt exposes server-issued revision and coordinates; Terminal does not generate, join, or reinterpret source text.")}</p>
      </aside>
    </div>
  );
  return mounted ? createPortal(node, document.body) : null;
}

function compareColumns(
  result: CompanySourceSearchResult | null,
  left: string,
  right: string,
): [CompanySourceSpan[], CompanySourceSpan[]] {
  if (!result || (result.state !== "ready" && result.state !== "stale_revision")) return [[], []];
  return [result.spans.filter((span) => span.event_id === left), result.spans.filter((span) => span.event_id === right)];
}

export default function TranscriptSearchWorkspace({
  ticker,
  events,
  initialEventId,
  onOpenTranscript,
  adapter = browserCompanySourceSearchAdapter,
}: TranscriptSearchWorkspaceProps) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const sourceEvents = useMemo(() => linkedEvents(events), [events]);
  const initialSourceEventId = useMemo(() => initialLinkedEventId(events, initialEventId), [events, initialEventId]);
  const [phrase, setPhrase] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSourceEventId ? [initialSourceEventId] : []);
  const [search, setSearch] = useState<RequestState>({ phase: "idle", result: null });
  const [compare, setCompare] = useState<RequestState>({ phase: "idle", result: null });
  const [leftEventId, setLeftEventId] = useState(initialSourceEventId);
  const [rightEventId, setRightEventId] = useState(sourceEvents.find((event) => event.event_id !== initialSourceEventId)?.event_id ?? "");
  const [receiptSpan, setReceiptSpan] = useState<CompanySourceSpan | null>(null);
  const [attachedSource, setAttachedSource] = useState<CompanySourceContextRef | null>(null);
  const [brainError, setBrainError] = useState<string | null>(null);
  const attachedSourceRef = useRef<CompanySourceContextRef | null>(null);
  const receiptTriggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRequestIdRef = useRef(0);
  const compareRequestIdRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const compareAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    searchAbortRef.current?.abort();
    compareAbortRef.current?.abort();
    searchRequestIdRef.current += 1;
    compareRequestIdRef.current += 1;
    // The selected calls are derived from a new producer context. Schedule the
    // reset after this render so the external-context sync does not create a
    // synchronous render cascade while the Intelligence payload is resolving.
    const frame = window.requestAnimationFrame(() => {
      setSelectedIds(initialSourceEventId ? [initialSourceEventId] : []);
      setLeftEventId(initialSourceEventId);
      setRightEventId(sourceEvents.find((event) => event.event_id !== initialSourceEventId)?.event_id ?? "");
      setSearch({ phase: "idle", result: null });
      setCompare({ phase: "idle", result: null });
      setReceiptSpan(null);
      setAttachedSource(null);
      setBrainError(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ticker, initialSourceEventId, sourceEvents]);

  useEffect(() => () => {
    searchAbortRef.current?.abort();
    compareAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    attachedSourceRef.current = attachedSource;
    return bindMastermindBrainCompanySource(
      () => attachedSourceRef.current,
      undefined,
      () => {
        attachedSourceRef.current = null;
        setAttachedSource(null);
        setBrainError(null);
      },
    ) ?? undefined;
  }, [attachedSource]);

  const invalidateSearch = useCallback(() => {
    searchAbortRef.current?.abort();
    searchRequestIdRef.current += 1;
    setSearch({ phase: "idle", result: null });
  }, []);

  const invalidateCompare = useCallback(() => {
    compareAbortRef.current?.abort();
    compareRequestIdRef.current += 1;
    setCompare({ phase: "idle", result: null });
  }, []);

  const eventById = useMemo(() => new Map(events.map((event) => [event.event_id, event])), [events]);
  const selectedEvents = useMemo(
    () => selectedIds.map((eventId) => eventById.get(eventId)).filter((event): event is CompanySourceSearchEvent => !!event),
    [eventById, selectedIds],
  );
  const normalizedPhrase = normalizeTranscriptLiteralPhrase(phrase);

  const toggleEvent = useCallback((eventId: string) => {
    invalidateSearch();
    setSelectedIds((current) => current.includes(eventId)
      // The control means "search these events", never an ambiguous empty
      // selection that silently broadens a reader's search to all history.
      ? (current.length === 1 ? current : current.filter((candidate) => candidate !== eventId))
      : [...current, eventId]);
  }, [invalidateSearch]);

  const runSearch = useCallback(async () => {
    const query = normalizeTranscriptLiteralPhrase(phrase);
    if (!query) {
      setSearch({ phase: "settled", result: { state: "error", ticker, query: "", message: "Enter a literal phrase to search.", retryable: false } });
      return;
    }
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const requestId = ++searchRequestIdRef.current;
    setSearch({ phase: "loading", result: null });
    try {
      const result = await adapter.search({ ticker, phrase: query, events: selectedEvents, signal: controller.signal });
      if (requestId === searchRequestIdRef.current) setSearch({ phase: "settled", result });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (requestId === searchRequestIdRef.current) setSearch({ phase: "settled", result: { state: "error", ticker, query, message: "Source search was interrupted.", retryable: true } });
    }
  }, [adapter, phrase, selectedEvents, ticker]);

  const runCompare = useCallback(async () => {
    const query = normalizeTranscriptLiteralPhrase(phrase);
    if (!query || !leftEventId || !rightEventId || leftEventId === rightEventId) {
      setCompare({ phase: "settled", result: { state: "error", ticker, query: query ?? "", message: "Enter a literal phrase and select two different events to compare.", retryable: false } });
      return;
    }
    compareAbortRef.current?.abort();
    const controller = new AbortController();
    compareAbortRef.current = controller;
    const requestId = ++compareRequestIdRef.current;
    setCompare({ phase: "loading", result: null });
    const request: CompanySourceCompareRequest = {
      ticker,
      phrase: query,
      events: [leftEventId, rightEventId]
        .map((eventId) => eventById.get(eventId))
        .filter((event): event is CompanySourceSearchEvent => !!event),
      left_event_id: leftEventId,
      right_event_id: rightEventId,
      signal: controller.signal,
    };
    try {
      const result = await adapter.compare(request);
      if (requestId === compareRequestIdRef.current) setCompare({ phase: "settled", result });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (requestId === compareRequestIdRef.current) setCompare({ phase: "settled", result: { state: "error", ticker, query, message: "Exact comparison was interrupted.", retryable: true } });
    }
  }, [adapter, eventById, leftEventId, phrase, rightEventId, ticker]);

  const openReceipt = useCallback((span: CompanySourceSpan, trigger: HTMLButtonElement) => {
    receiptTriggerRef.current = trigger;
    setReceiptSpan(span);
  }, []);
  const closeReceipt = useCallback(() => {
    setReceiptSpan(null);
    window.requestAnimationFrame(() => receiptTriggerRef.current?.focus({ preventScroll: true }));
  }, []);

  const attachSource = useCallback((span: CompanySourceSpan) => {
    const reference = toCompanySourceContextRef(span);
    if (!reference) {
      setBrainError(localized(zh, "该来源凭证不再有效，未附加任何上下文。", "This source receipt is no longer valid; no context was attached."));
      return;
    }
    setAttachedSource(reference);
    setBrainError(null);
  }, [zh]);

  const askWithAttachedSource = useCallback(() => {
    if (!attachedSource || !openMastermindBrainForCompanySource(ticker)) {
      setBrainError(localized(zh, "无法将此精确来源交给当前页面中的 Mastermind；未改用仅代码导航。", "This exact source cannot be handed to the in-document Mastermind; no ticker-only fallback was used."));
      return;
    }
    setBrainError(null);
  }, [attachedSource, ticker, zh]);

  const [leftSpans, rightSpans] = compareColumns(compare.result, leftEventId, rightEventId);

  return (
    <section className="ci-ts-explorer" aria-labelledby="ci-ts-title">
      <header className="ci-ts-hero">
        <div>
          <span className="fin-eyebrow">{localized(zh, "修订绑定的文本发现", "REVISION-BOUND TEXT DISCOVERY")}</span>
          <h3 id="ci-ts-title">{localized(zh, "在电话会中找到准确出处", "Find exact words across calls")}</h3>
          <p>{localized(zh, "仅做字面短语匹配。结果携带段落、发言人、章节和修订绑定的文档凭证；没有 AI 摘要或扩展匹配。", "Literal phrase matching only. Every result carries its segment, speaker, section, and revision-bound document receipt — no AI summary or expanded match.")}</p>
        </div>
        <span className="ci-ts-contract"><i />{localized(zh, "精确跨度 · 仅背景", "Exact spans · context only")}</span>
      </header>

      <form className="ci-ts-search" role="search" onSubmit={(event) => { event.preventDefault(); void runSearch(); }}>
        <label>
          <span className="fin-skel-sr">{localized(zh, "搜索准确短语", "Search exact phrase")}</span>
          <span aria-hidden>⌕</span>
          <input
            value={phrase}
            onChange={(event) => {
              invalidateSearch();
              invalidateCompare();
              setPhrase(event.target.value);
            }}
            placeholder={localized(zh, "输入短语，例如 “data center demand”", "Enter a phrase, e.g. “data center demand”")}
            spellCheck={false}
          />
          {phrase && <button type="button" onClick={() => { invalidateSearch(); invalidateCompare(); setPhrase(""); }} aria-label={localized(zh, "清除搜索", "Clear search")}>×</button>}
        </label>
        <button className="btn btn-primary" type="submit" disabled={search.phase === "loading"}>{search.phase === "loading" ? localized(zh, "正在搜索…", "Searching…") : localized(zh, "搜索准确短语", "Search exact phrase")}</button>
      </form>
      <p className="ci-ts-hint">{localized(zh, "请输入 2–240 个字符；可选引号仅用于标记短语，匹配仍按精确字面文本进行。", "Use 2–240 characters; optional quotes only delimit the phrase, and matching remains exact and literal.")}</p>

      <div className="ci-ts-filters" role="group" aria-label={localized(zh, "按事件筛选", "Filter by event")}>
        <div><span>{localized(zh, "搜索事件", "Search events")}</span><small>{localized(zh, "选择一个或多个", "Choose one or more")}</small></div>
        <div className="ci-ts-event-chips">
          {events.map((event) => {
            const selected = selectedIds.includes(event.event_id);
            return <button key={event.event_id} type="button" className={selected ? "on" : ""} aria-pressed={selected} disabled={!event.transcript_id} onClick={() => toggleEvent(event.event_id)}><EventName event={event} zh={zh} /></button>;
          })}
        </div>
      </div>

      {search.phase === "loading" && <div className="ci-ts-loading" role="status" aria-live="polite"><span className="ci-ts-pulse" aria-hidden /><span>{localized(zh, "正在验证来源修订…", "Verifying source revisions…")}</span></div>}
      {search.phase === "settled" && search.result && <ResultState result={search.result} zh={zh} onRetry={() => void runSearch()} />}

      {search.result && search.result.state === "ready" && search.result.spans.length > 0 && (
        <div className="ci-ts-results" aria-label={localized(zh, "准确文本命中", "Exact text matches")}>
          {search.result.spans.map((span) => <SpanCard key={span.span_id} span={span} phrase={search.result!.query} zh={zh} onOpenTranscript={onOpenTranscript} onReceipt={openReceipt} onAttach={attachSource} />)}
        </div>
      )}

      {attachedSource && (
        <aside className="ci-ts-state ready" data-testid="company-source-context-attachment" aria-label={localized(zh, "已附加的精确来源", "Attached exact source")}>
          <span className="ci-ts-state-mark" aria-hidden>✓</span>
          <div>
            <strong>{localized(zh, "已附加精确来源", "Exact source attached")}</strong>
            <p><code>{attachedSource.transcript_id}</code> · {localized(zh, "段", "segment")} {attachedSource.segment_index + 1} · <code>{attachedSource.revision_id}</code></p>
          </div>
          <div className="ci-ts-attachment-actions">
            <button className="btn btn-primary" type="button" onClick={askWithAttachedSource}>{localized(zh, "带来源询问 Mastermind", "Ask Mastermind with source")}</button>
            <button className="btn btn-ghost" type="button" onClick={() => { setAttachedSource(null); setBrainError(null); }}>{localized(zh, "移除", "Remove")}</button>
          </div>
        </aside>
      )}
      {brainError && <p className="ci-ts-state error" role="alert">{brainError}</p>}

      <section className="ci-ts-compare" aria-labelledby="ci-ts-compare-title">
        <div className="ci-ts-compare-head">
          <div><span className="fin-eyebrow">{localized(zh, "叙事对比", "NARRATIVE COMPARE")}</span><h4 id="ci-ts-compare-title">{localized(zh, "并列查看两个事件中的相同短语", "Place the same phrase beside two events")}</h4></div>
          <span>{localized(zh, "无模型改写", "No model paraphrase")}</span>
        </div>
        <div className="ci-ts-compare-controls">
          <label><span>{localized(zh, "左侧事件", "Left event")}</span><select value={leftEventId} onChange={(event) => { invalidateCompare(); setLeftEventId(event.target.value); }}>{sourceEvents.map((event) => <option key={event.event_id} value={event.event_id}>{event.label} · {event.call_date}</option>)}</select></label>
          <span className="ci-ts-compare-swap" aria-hidden>⇄</span>
          <label><span>{localized(zh, "右侧事件", "Right event")}</span><select value={rightEventId} onChange={(event) => { invalidateCompare(); setRightEventId(event.target.value); }}>{sourceEvents.map((event) => <option key={event.event_id} value={event.event_id}>{event.label} · {event.call_date}</option>)}</select></label>
          <button className="btn btn-ghost" type="button" onClick={() => void runCompare()} disabled={compare.phase === "loading" || !normalizedPhrase || sourceEvents.length < 2}>{compare.phase === "loading" ? localized(zh, "正在比较…", "Comparing…") : localized(zh, "对比准确出处", "Compare exact excerpts")}</button>
        </div>

        {sourceEvents.length < 2 && <p className="ci-ts-compare-prompt">{localized(zh, "并列比较需要两个关联了已验证电话会正文的事件。", "Side-by-side comparison requires two events linked to verified transcript bodies.")}</p>}

        {compare.phase === "settled" && compare.result && <ResultState result={compare.result} zh={zh} onRetry={() => void runCompare()} />}
        {compare.result?.state === "ready" && compare.result.spans.length > 0 && (
          <div className="ci-ts-compare-grid">
            {([leftEventId, rightEventId] as const).map((eventId, index) => {
              const event = eventById.get(eventId);
              const spans = index === 0 ? leftSpans : rightSpans;
              const total = compare.result?.state === "ready" ? compare.result.match_count_by_event[eventId] ?? spans.length : spans.length;
              const countCapped = compare.result?.state === "ready" && compare.result.count_capped_event_ids.includes(eventId);
              return <div className="ci-ts-compare-col" key={eventId}>
                <header><div><strong>{event?.label ?? eventId}</strong><small>{event?.call_date}</small></div><span className="num" title={countCapped ? localized(zh, `显示 ${spans.length} 个；至少 ${total} 个命中`, `${spans.length} shown; at least ${total} matches`) : total > spans.length ? localized(zh, `显示 ${spans.length} / 共 ${total} 个`, `${spans.length} of ${total} shown`) : undefined}>{countCapped ? `≥${total}` : total}</span></header>
                {total > 0 ? spans.map((span) => <SpanCard key={span.span_id} span={span} phrase={compare.result!.query} zh={zh} onOpenTranscript={onOpenTranscript} onReceipt={openReceipt} onAttach={attachSource} />) : <div className="ci-ts-compare-empty">{localized(zh, "该事件没有此精确短语。", "This event contains no exact phrase match.")}</div>}
              </div>;
            })}
          </div>
        )}
        {compare.phase === "idle" && <p className="ci-ts-compare-prompt">{localized(zh, "输入一个准确短语，然后选择两个不同事件以并列比较原始片段。", "Enter an exact phrase, then select two different events to compare the raw excerpts side by side.")}</p>}
      </section>

      {receiptSpan && <ReceiptDialog span={receiptSpan} zh={zh} onClose={closeReceipt} />}
    </section>
  );
}
