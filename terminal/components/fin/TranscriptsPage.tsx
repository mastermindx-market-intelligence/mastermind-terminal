"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../../lib/i18n";
import { fmtDate, pick } from "../../lib/finFormat";
import type { Fund } from "../../lib/fund";
import {
  getTickerTranscriptIndex,
  type TranscriptIndexCall,
  type TranscriptIndexResult,
  type TranscriptIndexWarning,
} from "../../lib/transcripts";
import type { TranscriptOpenTarget } from "../../lib/transcriptSearch";
import {
  readTranscriptCompareParams,
  writeTranscriptCompareParams,
  type TranscriptCompareLink,
} from "../../lib/transcriptCompare";
import { useTranscriptCompareT } from "../../lib/transcriptCompareLex";
import TranscriptCompare from "./TranscriptCompare";

export interface TranscriptsPageProps {
  sym: string;
  fund: Fund | null;
  onOpenTx: (target: string | TranscriptOpenTarget) => void;
}

interface ArchiveState {
  sym: string;
  retryNonce: number;
  result: TranscriptIndexResult | null;
}

/** Drop the comparison keys from the address bar without adding a history entry. */
function clearCompareParams() {
  const url = new URL(window.location.href);
  const before = url.search;
  writeTranscriptCompareParams(url.searchParams, null);
  if (url.search !== before) window.history.replaceState(window.history.state, "", url.toString());
}

const WARNING_ZH: Record<TranscriptIndexWarning, string> = {
  rebuilding: "单只股票元数据正在重建；当前显示全档案回退索引。",
  timeout: "单只股票元数据请求超时；当前显示全档案回退索引。",
  invalid: "单只股票元数据未提交或无效；当前显示全档案回退索引。",
};

function fallbackCall(sym: string, id: string): TranscriptIndexCall {
  return {
    id,
    period: `Q${id.slice(5)} FY${id.slice(0, 4)}`,
    date: null,
    title: `${sym} Earnings Call`,
    url: `/data/tx/${sym}/${id}.json.gz`,
    bytes: 0,
    segment_count: 0,
    speaker_count: 0,
    speakers: [],
    word_count: 0,
    qa_start: null,
    has_qa: false,
    source: "DefeatBeta",
  };
}

export default function TranscriptsPage({ sym, fund, onOpenTx }: TranscriptsPageProps) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const ticker = sym.toUpperCase();
  const [retryNonce, setRetryNonce] = useState(0);
  const [archive, setArchive] = useState<ArchiveState>({ sym: "", retryNonce: -1, result: null });
  const [queryState, setQueryState] = useState({ sym: "", value: "" });
  const [filterState, setFilterState] = useState<{ sym: string; value: "all" | "qa" }>({ sym: "", value: "all" });
  const tc = useTranscriptCompareT();
  const [compare, setCompare] = useState<{ sym: string; link: TranscriptCompareLink | null } | null>(null);
  const compareEntryRef = useRef<HTMLButtonElement>(null);
  const returnFocusToEntry = useRef(false);
  const previousSym = useRef(sym);

  // A comparison link is read once, after the client URL is available. A link
  // for another ticker is still shown as "not applied" but leaves the URL now.
  useEffect(() => {
    const link = readTranscriptCompareParams(new URL(window.location.href).searchParams);
    if (!link) return;
    if (link.ticker !== sym.toUpperCase()) clearCompareParams();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot URL hydration
    setCompare({ sym, link });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once per mount
  }, []);

  // Calls belong to one ticker: a symbol change closes the comparison and its URL keys.
  // The page stays mounted across a picker switch, so the state must close too — otherwise
  // NVDA -> AMD -> NVDA would reopen the old comparison while the address bar no longer
  // names it. Focus is not pulled back to the entry button: the user is in the picker.
  useEffect(() => {
    if (previousSym.current === sym) return;
    previousSym.current = sym;
    clearCompareParams();
    setCompare(null);
  }, [sym]);

  // A ticker switch, a retry, or unmount cancels the requests still in flight.
  useEffect(() => {
    const controller = new AbortController();
    getTickerTranscriptIndex(sym, { retryNonce, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setArchive({ sym, retryNonce, result });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setArchive({ sym, retryNonce, result: { status: "error", message: "Archive request failed" } });
        }
      });
    return () => controller.abort();
  }, [sym, retryNonce]);

  const fundFallback = useMemo<TranscriptIndexCall[]>(() => {
    const ids = new Set<string>();
    for (const row of fund?.earnings?.q ?? []) if (row.tx) ids.add(row.tx);
    return [...ids].sort((a, b) => b.localeCompare(a)).map((id) => fallbackCall(ticker, id));
  }, [fund?.earnings, ticker]);

  const loading = archive.sym !== sym || archive.retryNonce !== retryNonce;
  const result = loading ? null : archive.result;
  const query = queryState.sym === sym ? queryState.value : "";
  const filter = filterState.sym === sym ? filterState.value : "all";
  const canonicalCalls = result?.status === "ok" ? result.index.calls : [];
  const calls = canonicalCalls.length ? canonicalCalls : fundFallback;
  const degraded = result?.status === "error" || result?.status === "not_found" && fundFallback.length > 0;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCalls = calls.filter((call) => {
    if (filter === "qa" && !call.has_qa) return false;
    if (!normalizedQuery) return true;
    return [call.id, call.period, call.date, call.title, ...call.speakers]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery));
  });

  const retry = () => setRetryNonce(Date.now());

  const compareOpen = compare?.sym === sym;
  useEffect(() => {
    if (compareOpen || !returnFocusToEntry.current) return;
    returnFocusToEntry.current = false;
    compareEntryRef.current?.focus();
  }, [compareOpen]);
  const closeCompare = () => {
    clearCompareParams();
    returnFocusToEntry.current = true;
    setCompare(null);
  };

  return (
    <div className="fin-transcripts">
      <section className="fin-sec">
        <div className="fin-eyebrow">{pick(zh, "TRANSCRIPT INTELLIGENCE", "电话会情报")}</div>
        <div className="fin-sec-h fin-rail fin-rule" style={{ "--rail": "var(--brand)" } as React.CSSProperties}>
          <span>{pick(zh, "Earnings call archive", "财报电话会档案")}</span>
          {!loading && <span className="fin-tag" style={{ "--c": "var(--brand)" } as React.CSSProperties}>{calls.length}</span>}
        </div>
        <div className="fin-sec-cap">
          {pick(
            zh,
            "Search normalized call records across periods, speakers, and Q&A coverage. Transcript text is sourced from the DefeatBeta corpus and indexed by Mastermind; it is not an issuer-hosted first-party document.",
            "可按期间、发言人和问答覆盖搜索标准化电话会记录。正文来自 DefeatBeta 语料库并由 Mastermind 建立索引，并非发行人托管的第一方文件。",
          )}
        </div>
      </section>

      {compareOpen && archive.sym === sym ? (
        <TranscriptCompare
          key={sym}
          sym={sym}
          calls={calls}
          initialLink={compare?.link ?? null}
          onOpenTx={onOpenTx}
          onClose={closeCompare}
          onDetachLink={clearCompareParams}
        />
      ) : !loading && calls.length >= 2 ? (
        <div className="fin-tx-notice" data-testid="transcript-compare-entry">
          <span>{tc("tcOpenWhy")}</span>
          <button ref={compareEntryRef} type="button" onClick={() => setCompare({ sym, link: null })}>{tc("tcOpen")}</button>
        </div>
      ) : null}

      {!loading && calls.length > 0 && (
        <div className="fin-tx-controls" role="search" aria-label={pick(zh, "Search transcript archive", "搜索电话会档案")}>
          <label className="fin-tx-search">
            <span aria-hidden>⌕</span>
            <span className="fin-skel-sr">{pick(zh, "Search calls", "搜索电话会")}</span>
            <input
              value={query}
              onChange={(event) => setQueryState({ sym, value: event.target.value })}
              placeholder={pick(zh, "Search period, title, or speaker", "搜索期间、标题或发言人")}
            />
          </label>
          <div className="fin-tx-filters" role="group" aria-label={pick(zh, "Transcript filters", "电话会筛选")}>
            <button className={filter === "all" ? "on" : ""} onClick={() => setFilterState({ sym, value: "all" })} aria-pressed={filter === "all"}>
              {pick(zh, "All", "全部")}
            </button>
            <button className={filter === "qa" ? "on" : ""} onClick={() => setFilterState({ sym, value: "qa" })} aria-pressed={filter === "qa"}>
              {pick(zh, "Q&A", "问答")}
            </button>
          </div>
          <span className="fin-tx-result-count" aria-live="polite">
            {visibleCalls.length} / {calls.length}
          </span>
        </div>
      )}

      {result?.status === "ok" && result.warning && (
        <div className="fin-tx-notice" role="status">
          <span>{pick(zh, result.warning, WARNING_ZH[result.warningCode ?? "invalid"])}</span>
          <button onClick={retry}>{pick(zh, "Retry", "重试")}</button>
        </div>
      )}
      {degraded && calls.length > 0 && (
        <div className="fin-tx-notice warn" role="status">
          <span>
            {pick(
              zh,
              "Live archive verification failed. Showing legacy fund links; metadata may be incomplete.",
              "实时档案验证失败。当前显示旧版基金链接；元数据可能不完整。",
            )}
          </span>
          <button onClick={retry}>{pick(zh, "Retry", "重试")}</button>
        </div>
      )}

      {loading ? (
        <div role="status" aria-busy="true" className="fin-card">
          <span className="fin-skel-sr">{pick(zh, "Loading transcript archive…", "正在加载电话会档案…")}</span>
          <div className="fin-skel fin-skel-rows" aria-hidden />
        </div>
      ) : result?.status === "error" && calls.length === 0 ? (
        <div className="fin-empty fin-empty-lg fin-tx-error" role="alert">
          <div className="fin-empty-title">{pick(zh, "Archive unavailable", "档案不可用")}</div>
          <div className="fin-empty-why">
            {pick(zh, result.message, result.timedOut ? "档案提交标记请求超时，请重试。" : "无法验证档案索引。")}
          </div>
          <button className="fin-tx-retry" onClick={retry}>{pick(zh, "Retry archive", "重试档案")}</button>
        </div>
      ) : calls.length > 0 && visibleCalls.length > 0 ? (
        <ul className="fin-card fin-tx-library" aria-label={pick(zh, `${ticker} transcript archive`, `${ticker} 电话会档案`)}>
          {visibleCalls.map((call) => (
            <li key={call.id}>
              <button className="fin-tx-library-row" onClick={() => onOpenTx(call.id)}>
                <span className="fin-tx-library-icon" aria-hidden>
                  <svg viewBox="0 0 24 24">
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                    <path d="M14 3v5h5M9 13h6M9 17h6" />
                  </svg>
                </span>
                <span className="fin-tx-library-copy">
                  <span className="fin-tx-library-title"><b>{call.period}</b>{call.date && <time dateTime={call.date}>{fmtDate(call.date)}</time>}</span>
                  <strong>{call.title}</strong>
                  <small>
                    {call.segment_count > 0 && <span>{call.segment_count.toLocaleString()} {pick(zh, "segments", "段")}</span>}
                    {call.speaker_count > 0 && <span>{call.speaker_count} {pick(zh, "speakers", "位发言人")}</span>}
                    {call.has_qa && <span className="fin-tx-qa-chip">Q&amp;A</span>}
                    <span>{call.source} · {call.id}</span>
                  </small>
                </span>
                <span className="fin-tx-library-open">{pick(zh, "Read", "阅读")} ›</span>
              </button>
            </li>
          ))}
        </ul>
      ) : calls.length > 0 ? (
        <div className="fin-empty fin-empty-lg" role="status">
          <div className="fin-empty-title">{pick(zh, "No matching calls", "无匹配电话会")}</div>
          <div className="fin-empty-why">{pick(zh, "Try a broader search or clear the Q&A filter.", "请扩大搜索范围或清除问答筛选。")}</div>
        </div>
      ) : (
        <div className="fin-empty fin-empty-lg" role="status">
          <div className="fin-empty-title">{pick(zh, "No transcript archived", "暂无已归档记录")}</div>
          <div className="fin-empty-why">
            {pick(
              zh,
              `The verified archive contains no earnings-call document for ${sym}. This is a source-coverage state, not a loading queue.`,
              `经验证的档案中没有 ${sym} 的财报电话会文档。这是数据源覆盖状态，并非等待加载。`,
            )}
          </div>
        </div>
      )}

      <div className="fin-asof">
        {pick(zh, "Source: DefeatBeta transcript corpus · normalized and indexed by Mastermind", "来源：DefeatBeta 电话会语料库 · 由 Mastermind 标准化并建立索引")}
      </div>
    </div>
  );
}
