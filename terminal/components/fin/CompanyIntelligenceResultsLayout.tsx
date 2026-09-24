"use client";

import { pick } from "../../lib/finFormat";

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
          <span>{pick(zh, "RESULTS & OUTLOOK", "业绩与展望")}</span>
          <h3>{pick(zh, "Reported performance, guidance and the next decision points", "已报告表现、指引与下一步决策点")}</h3>
        </div>
        <div className="ci-paper-results-period">
          <strong>{periodLabel}</strong>
          <time dateTime={eventDate}>{eventDate}</time>
        </div>
      </header>

      <section className="ci-paper-results-glance" aria-label={pick(zh, "Results at a glance", "业绩概览")}>
        <div className="ci-paper-results-section-label">
          <span>{pick(zh, "AT A GLANCE", "概览")}</span>
          <small>{pick(zh, `Selected event · ${periodLabel}`, `当前事件 · ${periodLabel}`)}</small>
        </div>
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
      </section>

      <div className="ci-paper-results-columns">
        <section className="ci-paper-results-card">
          <header>
            <div>
              <h4>{pick(zh, "Guidance & outlook", "指引与展望")}</h4>
              <p>{guidanceNote || (pick(zh, "Only structured, traceable guidance from the selected event.", "仅显示当前事件的结构化、可追溯指引。"))}</p>
            </div>
            <span>{guidance.length ? pick(zh, "Available", "可用") : pick(zh, "Not asserted", "未断言")}</span>
          </header>
          <div className="ci-paper-results-list">
            {guidance.length ? guidance.slice(0, 4).map((item) => (
              <ResultRow key={item.id} item={item} selected={selectedId === item.id} onSelect={onSelect} />
            )) : (
              <p className="ci-paper-results-empty">{pick(zh, "This path has no structured guidance object; none is inferred from summaries or scores.", "此路径没有结构化指引对象；不会从摘要或评分中推断。")}</p>
            )}
          </div>
        </section>

        <section className="ci-paper-results-card">
          <header>
            <div>
              <h4>{pick(zh, "Call read-through", "电话会解读")}</h4>
              <p>{callNote || (pick(zh, "Canonical Q&A context from the selected event.", "来自所选事件的规范化问答记录。"))}</p>
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
              <p className="ci-paper-results-empty">{pick(zh, "No normalized Q&A read-through is available for this research layer.", "没有可用于此研究层的规范化问答摘要。")}</p>
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

        <aside className="ci-paper-results-boundary" aria-label={pick(zh, "Not asserted capabilities", "未断言能力")}>
          <span>{pick(zh, "NOT ASSERTED", "未断言")}</span>
          <div>
            {nonAssertions.map((item) => (
              <div key={item.id}>
                <strong>{item.label}</strong>
                <small>{item.value}</small>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
