"use client";

import "../../app/company-intelligence-call.css";

import type { ReactNode } from "react";
import { pick } from "../../lib/finFormat";

export interface CompanyIntelligenceCallExchange {
  id: string;
  ordinal: number;
  analyst: string;
  affiliation?: string | null;
  question: string;
  respondents: string[];
  segmentIndex?: number | null;
}

interface CompanyIntelligenceCallLayoutProps {
  zh: boolean;
  periodLabel: string;
  eventDate: string;
  transcriptId?: string | null;
  transcriptAvailable: boolean;
  eventId?: string | null;
  eventAlias?: string | null;
  exchanges: CompanyIntelligenceCallExchange[];
  selectedId?: string | null;
  onOpenExchange?: (exchange: CompanyIntelligenceCallExchange) => void;
  onOpenFullTranscript?: () => void;
  onOpenSources?: () => void;
  searchContent?: ReactNode;
  fallbackNote?: string | null;
}

export default function CompanyIntelligenceCallLayout({
  zh,
  periodLabel,
  eventDate,
  transcriptId,
  transcriptAvailable,
  eventId,
  eventAlias,
  exchanges,
  selectedId,
  onOpenExchange,
  onOpenFullTranscript,
  onOpenSources,
  searchContent,
  fallbackNote,
}: CompanyIntelligenceCallLayoutProps) {
  return (
    <section
      className="ci-paper-call"
      data-ci-paper-call=""
      data-ci-call-event-id={eventId || ""}
      data-ci-call-event-alias={eventAlias || ""}
      data-ci-call-transcript-id={transcriptId || ""}
    >
      <header className="ci-paper-call-head">
        <div>
          <span>{pick(zh, "CALL + Q&A", "电话会 + 问答")}</span>
          <h3>{pick(
            zh,
            "Earnings call & discussion",
            "财报电话会与讨论",
          )}</h3>
        </div>
        <div className="ci-paper-call-period">
          <strong>{periodLabel}</strong>
          <time dateTime={eventDate}>{eventDate}</time>
        </div>
      </header>

      {exchanges.length > 0 ? <>
      <div className="ci-paper-call-toolbar">
        <div>
          <span>{pick(zh, "Selected call", "当前电话会")}</span>
          <strong>{transcriptId || pick(zh, "Transcript unavailable", "电话会不可用")}</strong>
        </div>
        <div>
          <span>{pick(zh, "Verified Q&A", "已验证问答")}</span>
          <strong>{pick(zh, `${exchanges.length} exchanges`, `${exchanges.length} 轮`)}</strong>
        </div>
        <div>
          <span>{pick(zh, "Topic map", "主题图")}</span>
          <strong>{pick(zh, "Unavailable", "不可用")}</strong>
        </div>
      </div>

      <div className="ci-paper-call-grid ci-paper-call-grid--full">

        <section className="ci-paper-call-qa" aria-label={pick(zh, "Analyst Q&A", "分析师问答")}>
          <header>
            <div>
              <h4>{pick(zh, "Analyst Q&A", "分析师问答")}</h4>
              <p>{pick(
                zh,
                "Select an exchange to open its exact normalized transcript position.",
                "选择问答以打开其在规范化电话会中的精确位置。",
              )}</p>
            </div>
            <span>{pick(zh, `${exchanges.length} verified`, `${exchanges.length} 已验证`)}</span>
          </header>

          {exchanges.length ? (
            <div className="ci-paper-call-exchanges">
              {exchanges.slice(0, 8).map((exchange) => {
                const canOpen = transcriptAvailable && exchange.segmentIndex != null && onOpenExchange;
                return (
                  <button
                    type="button"
                    key={exchange.id}
                    className={selectedId === exchange.id ? "selected" : ""}
                    onClick={() => canOpen && onOpenExchange?.(exchange)}
                    disabled={!canOpen}
                  >
                    <b>Q{exchange.ordinal + 1}</b>
                    <span>
                      <strong>
                        {exchange.analyst}
                        {exchange.affiliation ? ` · ${exchange.affiliation}` : ""}
                      </strong>
                      <small>{exchange.question || pick(zh, "Question text unavailable", "问题文本不可用")}</small>
                      <i>
                        {exchange.respondents.length
                          ? pick(zh, `Management · ${exchange.respondents.join(" · ")}`, `管理层 · ${exchange.respondents.join(" · ")}`)
                          : pick(zh, "Management response structure unavailable", "管理层回答结构不可用")}
                      </i>
                    </span>
                    <em aria-hidden>›</em>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="ci-paper-call-empty">
              <strong>{pick(zh, "Structured Q&A unavailable", "结构化问答不可用")}</strong>
              <p>{pick(
                zh,
                "The transcript may still be readable, but this path does not carry canonical normalized Q&A exchanges.",
                "电话会正文仍可能可读，但此路径没有规范化的标准问答轮次。",
              )}</p>
            </div>
          )}
        </section>
      </div>

      <footer className="ci-paper-call-integrity">
        <div>
          <span>{pick(zh, "TRANSCRIPT SOURCE", "电话会来源")}</span>
          <strong>{transcriptAvailable
            ? pick(zh, "Normalized call record available", "规范化电话会记录可用")
            : pick(zh, "Transcript body unavailable", "电话会正文不可用")}</strong>
          <small>{pick(zh, "The existing transcript reader remains the document owner.", "现有电话会阅读器仍是文档所有者。")}</small>
        </div>
        <div>
          <span>{pick(zh, "Q&A STRUCTURE", "问答结构")}</span>
          <strong>{exchanges.length
            ? pick(zh, "Verified exchange structure preserved", "已保留验证过的问答结构")
            : pick(zh, "Not available in this path", "此路径不可用")}</strong>
          <small>{pick(zh, "No topic or importance label is inferred.", "不会推断主题或重要性标签。")}</small>
        </div>
        <div>
          <span>{pick(zh, "CLAIM PINNING", "主张定位")}</span>
          <strong>{pick(zh, "Exact transcript positions remain explicit", "精确电话会位置保持显式")}</strong>
          <small>{pick(zh, "Source-family-only claims are not upgraded to exact spans.", "仅来源族的主张不会被升级为精确片段。")}</small>
        </div>
        <div className="ci-paper-call-actions">
          {onOpenSources ? (
            <button type="button" onClick={onOpenSources}>{pick(zh, "Source manifest", "来源清单")}</button>
          ) : null}
          {onOpenFullTranscript ? (
            <button type="button" onClick={onOpenFullTranscript}>{pick(zh, "Read full transcript", "阅读完整电话会")}</button>
          ) : null}
        </div>
      </footer>

      </> : <div className="ci-call-reader-start">
        <div>
          <h4>{transcriptAvailable ? pick(zh, "Read the earnings call", "阅读财报电话会") : pick(zh, "Transcript unavailable", "电话会正文不可用")}</h4>
          <p>{transcriptAvailable
            ? pick(zh, "The full transcript is available. Structured Q&A and topic navigation are not available for this event.", "完整电话会正文可用。此事件暂无结构化问答和主题导航。")
            : pick(zh, "A readable transcript has not been linked to this event. Check Sources for the available records.", "此事件尚未关联可读的电话会正文。请查看来源以了解可用记录。")}</p>
        </div>
        {transcriptAvailable && onOpenFullTranscript && <button type="button" className="btn btn-primary" onClick={onOpenFullTranscript}>{pick(zh, "Read full transcript", "阅读完整电话会")} <span aria-hidden="true">↗</span></button>}
        {onOpenSources && <button type="button" className="btn btn-ghost" onClick={onOpenSources}>{pick(zh, "View sources", "查看来源")}</button>}
      </div>}

      {searchContent ? (
        <section className="ci-paper-call-search">
          <header>
            <span>{pick(zh, "Search the transcript", "搜索电话会")}</span>
            <p>{pick(
              zh,
              "Find an exact phrase, then open the matching passage in context.",
              "搜索原文短语，打开匹配片段并查看上下文。",
            )}</p>
          </header>
          {searchContent}
        </section>
      ) : null}
    </section>
  );
}
