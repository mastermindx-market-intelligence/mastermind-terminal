"use client";

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
  const respondents = new Set(exchanges.flatMap((exchange) => exchange.respondents));
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
            "Read the selected call by verified exchange, speaker and exact source span",
            "按已验证问答、发言人和精确来源片段阅读当前电话会",
          )}</h3>
        </div>
        <div className="ci-paper-call-period">
          <strong>{periodLabel}</strong>
          <time dateTime={eventDate}>{eventDate}</time>
        </div>
      </header>

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

      <div className="ci-paper-call-grid">
        <aside className="ci-paper-call-map">
          <header>
            <h4>{pick(zh, "Call map", "电话会地图")}</h4>
            <p>{pick(zh, "Structure from the selected event only", "仅显示当前事件的结构")}</p>
          </header>
          <div className="ci-paper-call-map-state">
            <span>{pick(zh, "TOPIC MAP UNAVAILABLE", "主题图不可用")}</span>
            <strong>{pick(
              zh,
              "No governed Q&A topic taxonomy is published for this event workspace.",
              "此事件工作区尚未发布受治理的问答主题分类。",
            )}</strong>
            <p>{pick(
              zh,
              "Paper's illustrative topic groups are not promoted into runtime truth. Verified exchange and speaker structure remains available.",
              "不会将 Paper 中的示意主题分组提升为运行时事实；已验证的问答与发言人结构仍然可用。",
            )}</p>
          </div>
          <dl className="ci-paper-call-structure">
            <div>
              <dt>{pick(zh, "Q&A exchanges", "问答轮次")}</dt>
              <dd>{exchanges.length}</dd>
            </div>
            <div>
              <dt>{pick(zh, "Management identities", "管理层身份")}</dt>
              <dd>{respondents.size}</dd>
            </div>
            <div>
              <dt>{pick(zh, "Transcript", "电话会")}</dt>
              <dd>{transcriptAvailable ? pick(zh, "Available", "可用") : pick(zh, "Unavailable", "不可用")}</dd>
            </div>
          </dl>
          {fallbackNote ? <p className="ci-paper-call-fallback">{fallbackNote}</p> : null}
        </aside>

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

      {searchContent ? (
        <section className="ci-paper-call-search">
          <header>
            <span>{pick(zh, "EXACT TRANSCRIPT SEARCH", "电话会精确搜索")}</span>
            <p>{pick(
              zh,
              "Revision-bound literal search remains owned by the existing source-search workflow.",
              "修订绑定的字面搜索仍由现有来源搜索工作流负责。",
            )}</p>
          </header>
          {searchContent}
        </section>
      ) : null}
    </section>
  );
}
