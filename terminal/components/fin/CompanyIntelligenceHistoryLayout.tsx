"use client";

import "../../app/company-intelligence-history.css";
import { pick } from "../../lib/finFormat";

export type CompanyIntelligenceHistoryMode = "selectable-history" | "current-plus-context";
export type CompanyIntelligenceHistoryStatus = "selected" | "latest" | "historical" | "context";

export interface CompanyIntelligenceHistoryMetric {
  id: string;
  label: string;
  value: string;
  detail?: string | null;
}

export interface CompanyIntelligenceHistoryEvent {
  id: string;
  label: string;
  date: string;
  status: CompanyIntelligenceHistoryStatus;
  summary?: string | null;
  reference?: string | null;
  metrics: CompanyIntelligenceHistoryMetric[];
  onSelect?: () => void;
}

interface CompanyIntelligenceHistoryLayoutProps {
  zh: boolean;
  mode: CompanyIntelligenceHistoryMode;
  currentLabel: string;
  currentDate: string;
  currentFacts?: CompanyIntelligenceHistoryMetric[];
  events: CompanyIntelligenceHistoryEvent[];
  onOpenBrief?: () => void;
}

function statusLabel(status: CompanyIntelligenceHistoryStatus, zh: boolean): string {
  if (status === "selected") return pick(zh, "Selected", "已选择");
  if (status === "latest") return pick(zh, "Latest", "最新");
  if (status === "context") return pick(zh, "v1 context", "v1 背景");
  return pick(zh, "History", "历史");
}

function EventRow({
  event,
  zh,
}: {
  event: CompanyIntelligenceHistoryEvent;
  zh: boolean;
}) {
  const content = (
    <>
      <i aria-hidden />
      <span>
        <strong>{event.label}</strong>
        <time dateTime={event.date}>{event.date}</time>
        {event.summary ? <small>{event.summary}</small> : null}
        {event.reference ? <code>{event.reference}</code> : null}
      </span>
      <b>{statusLabel(event.status, zh)}</b>
    </>
  );
  const shared = {
    className: `ci-history-vnext-event ${event.status}`,
    "data-ci-history-event": event.id,
    "data-ci-history-status": event.status,
  } as const;

  if (event.onSelect) {
    return (
      <button
        type="button"
        {...shared}
        onClick={event.onSelect}
        aria-pressed={event.status === "selected"}
      >
        {content}
      </button>
    );
  }

  return <div {...shared}>{content}</div>;
}

export default function CompanyIntelligenceHistoryLayout({
  zh,
  mode,
  currentLabel,
  currentDate,
  currentFacts = [],
  events,
  onOpenBrief,
}: CompanyIntelligenceHistoryLayoutProps) {
  const metricColumns = events.find((event) => event.metrics.length)?.metrics ?? [];
  const isContextOnly = mode === "current-plus-context";

  return (
    <section
      className="ci-history-vnext"
      data-ci-paper-history=""
      data-ci-history-mode={mode}
    >
      <header className="ci-history-vnext-head">
        <div>
          <span>{pick(zh, "EVENT HISTORY & COMPARISON", "事件历史与比较")}</span>
          <h3>{isContextOnly
            ? pick(zh, "Keep the verified event separate from historical context", "将已验证事件与历史背景分开")
            : pick(zh, "See how reported performance changed across events", "查看披露表现如何随事件变化")}</h3>
        </div>
        <div className="ci-history-vnext-period">
          <strong>{currentLabel}</strong>
          <time dateTime={currentDate}>{currentDate}</time>
        </div>
      </header>

      {isContextOnly ? (
        <section className="ci-history-vnext-current" aria-label={pick(zh, "Current verified event", "当前已验证事件")}>
          <header>
            <div>
              <span>{pick(zh, "CURRENT VERIFIED EVENT", "当前已验证事件")}</span>
              <strong>{currentLabel}</strong>
            </div>
            <small>{pick(zh, "EventWorkspace authority · historical v1 values remain separate", "EventWorkspace 权限 · 历史 v1 数值保持分离")}</small>
          </header>
          {currentFacts.length ? (
            <div className="ci-history-vnext-facts">
              {currentFacts.slice(0, 4).map((fact) => (
                <article key={fact.id}>
                  <span>{fact.label}</span>
                  <strong>{fact.value}</strong>
                  {fact.detail ? <small>{fact.detail}</small> : null}
                </article>
              ))}
            </div>
          ) : (
            <p>{pick(zh, "No receipt-backed current facts are available for this view.", "本视图暂无凭证支持的当期事实。")}</p>
          )}
        </section>
      ) : null}

      <div className="ci-history-vnext-grid">
        <section className="ci-history-vnext-tape" aria-label={pick(zh, "Event tape", "事件序列")}>
          <header>
            <div>
              <span>{isContextOnly ? pick(zh, "HISTORICAL V1 CONTEXT", "历史 v1 背景") : pick(zh, "EVENT TAPE", "事件序列")}</span>
              <strong>{isContextOnly
                ? pick(zh, "Context only · does not control the selected event", "仅供背景 · 不控制所选事件")
                : pick(zh, "Select an event to update the research workspace", "选择事件以更新研究工作区")}</strong>
            </div>
            <small>{events.length} {pick(zh, "events", "个事件")}</small>
          </header>
          <div className="ci-history-vnext-events">
            {events.map((event) => <EventRow key={event.id} event={event} zh={zh} />)}
          </div>
        </section>

        <section className="ci-history-vnext-matrix" aria-label={pick(zh, "Reported metric history", "披露指标历史")}>
          <header>
            <div>
              <span>{isContextOnly ? pick(zh, "HISTORICAL CONTEXT MATRIX", "历史背景矩阵") : pick(zh, "REPORTED METRIC HISTORY", "披露指标历史")}</span>
              <strong>{isContextOnly
                ? pick(zh, "v1 structured values only", "仅显示 v1 结构化数值")
                : pick(zh, "Comparable structured fields only", "仅显示可比较的结构化字段")}</strong>
            </div>
            <small>{pick(zh, "No forecast · no score promotion", "无预测 · 不提升评分")}</small>
          </header>
          {events.length && metricColumns.length ? (
            <div className="ci-history-vnext-table-wrap">
              <table className="ci-history-vnext-table">
                <thead>
                  <tr>
                    <th>{pick(zh, "Event", "事件")}</th>
                    {metricColumns.map((metric) => <th key={metric.id}>{metric.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} data-status={event.status}>
                      <th scope="row">
                        <strong>{event.label}</strong>
                        <time dateTime={event.date}>{event.date}</time>
                      </th>
                      {metricColumns.map((column) => {
                        const metric = event.metrics.find((candidate) => candidate.id === column.id);
                        return (
                          <td key={column.id}>
                            <strong>{metric?.value ?? "—"}</strong>
                            {metric?.detail ? <small>{metric.detail}</small> : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ci-history-vnext-empty">{pick(zh, "No comparable structured history is attached.", "暂无可比较的结构化历史。")}</p>
          )}
        </section>
      </div>

      <footer className="ci-history-vnext-boundary">
        <div>
          <span>{pick(zh, "AUTHORITY BOUNDARY", "权限边界")}</span>
          <strong>{isContextOnly
            ? pick(zh, "The verified event remains current; v1 history is contextual only.", "已验证事件仍为当期；v1 历史仅供背景。")
            : pick(zh, "Values come from the selected structured event history.", "数值来自所选结构化事件历史。")}</strong>
        </div>
        {onOpenBrief ? (
          <button type="button" onClick={onOpenBrief}>{pick(zh, "Back to Brief", "返回简报")} <span aria-hidden>›</span></button>
        ) : null}
      </footer>
    </section>
  );
}
