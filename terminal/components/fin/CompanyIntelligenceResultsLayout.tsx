"use client";

import { pick } from "../../lib/finFormat";
import styles from "./CompanyIntelligenceResultsLayout.module.css";

export interface CompanyIntelligenceResultsItem {
  id: string;
  label: string;
  value: string;
  detail?: string | null;
}

export interface CompanyIntelligenceResultsComparison {
  id: string;
  label: string;
  current: string;
  prior: string;
  change: string;
  detail?: string | null;
}

interface CompanyIntelligenceResultsLayoutProps {
  zh: boolean;
  periodLabel: string;
  eventDate: string;
  metrics: CompanyIntelligenceResultsItem[];
  metricContext?: CompanyIntelligenceResultsItem[];
  guidance: CompanyIntelligenceResultsItem[];
  callReadthrough: CompanyIntelligenceResultsItem[];
  comparisons: CompanyIntelligenceResultsComparison[];
  nonAssertions: CompanyIntelligenceResultsItem[];
  selectedId?: string | null;
  onSelect?: (item: CompanyIntelligenceResultsItem) => void;
  onOpenCall?: () => void;
  guidanceNote?: string | null;
  callNote?: string | null;
}

function ResultRow({
  item,
  selected,
  onSelect,
}: {
  item: CompanyIntelligenceResultsItem;
  selected: boolean;
  onSelect?: (item: CompanyIntelligenceResultsItem) => void;
}) {
  if (!onSelect) {
    return (
      <div className="ci-paper-results-row">
        <span>{item.label}</span>
        <strong>{item.value}</strong>
        {item.detail && <small>{item.detail}</small>}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`ci-paper-results-row${selected ? " selected" : ""}`}
      onClick={() => onSelect(item)}
      aria-pressed={selected}
    >
      <span>{item.label}</span>
      <strong>{item.value}</strong>
      {item.detail && <small>{item.detail}</small>}
      <i aria-hidden>›</i>
    </button>
  );
}

export default function CompanyIntelligenceResultsLayout({
  zh,
  periodLabel,
  eventDate,
  metrics,
  metricContext = [],
  guidance,
  callReadthrough,
  comparisons,
  nonAssertions,
  selectedId,
  onSelect,
  onOpenCall,
  guidanceNote,
  callNote,
}: CompanyIntelligenceResultsLayoutProps) {
  return (
    <section className="ci-paper-results" data-ci-paper-results="">
      <header className="ci-paper-results-head">
        <div>
          <h3>{pick(zh, "Results & outlook", "业绩与展望")}</h3>
        </div>
        <div className="ci-paper-results-period">
          <strong>{periodLabel}</strong>
          <time dateTime={eventDate}>{eventDate}</time>
        </div>
      </header>

      <section className="ci-paper-results-glance" aria-label={pick(zh, "Results at a glance", "业绩概览")}>
        {metrics.length ? (
          <div className="ci-paper-results-metrics">
            {metrics.slice(0, 4).map((item) => (
              <button
                type="button"
                key={item.id}
                className={selectedId === item.id ? "selected" : ""}
                onClick={() => onSelect?.(item)}
                aria-pressed={selectedId === item.id}
                disabled={!onSelect}
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail || (pick(zh, "Reported", "已报告"))}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="ci-paper-results-empty">{pick(zh, "No structured metrics are available for this event.", "当前事件没有可展示的结构化指标。")}</p>
        )}
        {metricContext.length > 0 && (
          <div className={`ci-paper-results-list ${styles.metricContext}`} data-ci-metric-context="">
            {metricContext.map((item) => (
              <ResultRow key={item.id} item={item} selected={selectedId === item.id} onSelect={onSelect} />
            ))}
          </div>
        )}
      </section>

      <div className="ci-paper-results-columns">
        <section className="ci-paper-results-card">
          <header>
            <div>
              <h4>{pick(zh, "Guidance & outlook", "指引与展望")}</h4>
              {guidance.length > 0 && guidanceNote && <p>{guidanceNote}</p>}
            </div>
            <span>{guidance.length ? pick(zh, "Available", "可用") : pick(zh, "Unavailable", "暂无数据")}</span>
          </header>
          <div className="ci-paper-results-list">
            {guidance.length ? guidance.slice(0, 4).map((item) => (
              <ResultRow key={item.id} item={item} selected={selectedId === item.id} onSelect={onSelect} />
            )) : (
              <p className="ci-paper-results-empty">{guidanceNote || pick(zh, "Structured guidance is not available for this event.", "当前事件暂无结构化业绩指引。")}</p>
            )}
          </div>
        </section>

        <section className="ci-paper-results-card">
          <header>
            <div>
              <h4>{pick(zh, "Call read-through", "电话会解读")}</h4>
              {callReadthrough.length > 0 && callNote && <p>{callNote}</p>}
            </div>
            <span>{callReadthrough.length ? pick(zh, `${callReadthrough.length} items`, `${callReadthrough.length} 项`) : pick(zh, "Unstructured", "未结构化")}</span>
          </header>
          <div className="ci-paper-results-list">
            {callReadthrough.length ? callReadthrough.slice(0, 4).map((item) => (
              <div className="ci-paper-results-call" key={item.id}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                {item.detail && <small>{item.detail}</small>}
              </div>
            )) : (
              <p className="ci-paper-results-empty">{callNote || pick(zh, "A structured Q&A summary is not available. Open the call to explore the transcript.", "暂无结构化问答摘要。打开电话会以浏览正文。")}</p>
            )}
          </div>
          {onOpenCall && (
            <button type="button" className="ci-paper-results-call-action" onClick={onOpenCall}>
              {pick(zh, "Open Call + Q&A", "打开 Call + Q&A")} <span aria-hidden>›</span>
            </button>
          )}
        </section>
      </div>

      <div className="ci-paper-results-footer">
        <section className="ci-paper-results-compare">
          <header>
            <span>{pick(zh, "COMPARED WITH PRIOR EVENT", "与上期比较")}</span>
            <small>{pick(zh, "comparable structured fields only", "仅限可比结构化字段")}</small>
          </header>
          {comparisons.length ? (
            <div className="ci-paper-results-compare-list">
              {comparisons.slice(0, 4).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={selectedId === item.id ? "selected" : ""}
                  onClick={() => onSelect?.({ id: item.id, label: item.label, value: item.current, detail: item.detail })}
                  aria-pressed={selectedId === item.id}
                  disabled={!onSelect}
                >
                  <span>{item.label}</span>
                  <strong>{item.current}</strong>
                  <small>{item.prior}</small>
                  <b>{item.change}</b>
                </button>
              ))}
            </div>
          ) : (
            <p className="ci-paper-results-empty">{pick(zh, "No comparable prior-event fields are bound.", "没有绑定的可比上期字段。")}</p>
          )}
        </section>

        <details className="ci-paper-results-boundary">
          <summary>{pick(zh, "Coverage limits", "数据覆盖限制")}</summary>
          <div>
            {nonAssertions.map((item) => (
              <div key={item.id}>
                <strong>{item.label}</strong>
                <small>{item.value}</small>
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}
