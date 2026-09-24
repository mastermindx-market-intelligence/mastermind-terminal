"use client";

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
          <span>{zh ? "业绩与展望" : "RESULTS & OUTLOOK"}</span>
          <h3>{zh ? "已报告表现、指引与下一步决策点" : "Reported performance, guidance and the next decision points"}</h3>
        </div>
        <div className="ci-paper-results-period">
          <strong>{periodLabel}</strong>
          <time dateTime={eventDate}>{eventDate}</time>
        </div>
      </header>

      <section className="ci-paper-results-glance" aria-label={zh ? "业绩概览" : "Results at a glance"}>
        <div className="ci-paper-results-section-label">
          <span>{zh ? "概览" : "AT A GLANCE"}</span>
          <small>{zh ? `当前事件 · ${periodLabel}` : `Selected event · ${periodLabel}`}</small>
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
                <small>{item.detail || (zh ? "已报告" : "Reported")}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="ci-paper-results-empty">{zh ? "当前事件没有可展示的结构化指标。" : "No structured metrics are available for this event."}</p>
        )}
      </section>

      <div className="ci-paper-results-columns">
        <section className="ci-paper-results-card">
          <header>
            <div>
              <h4>{zh ? "指引与展望" : "Guidance & outlook"}</h4>
              <p>{guidanceNote || (zh ? "仅显示当前事件的结构化、可追溯指引。" : "Only structured, traceable guidance from the selected event.")}</p>
            </div>
            <span>{guidance.length ? (zh ? "可用" : "Available") : (zh ? "未断言" : "Not asserted")}</span>
          </header>
          <div className="ci-paper-results-list">
            {guidance.length ? guidance.slice(0, 4).map((item) => (
              <ResultRow key={item.id} item={item} selected={selectedId === item.id} onSelect={onSelect} />
            )) : (
              <p className="ci-paper-results-empty">{zh ? "此路径没有结构化指引对象；不会从摘要或评分中推断。" : "This path has no structured guidance object; none is inferred from summaries or scores."}</p>
            )}
          </div>
        </section>

        <section className="ci-paper-results-card">
          <header>
            <div>
              <h4>{zh ? "电话会解读" : "Call read-through"}</h4>
              <p>{callNote || (zh ? "来自所选事件的规范化问答记录。" : "Canonical Q&A context from the selected event.")}</p>
            </div>
            <span>{callReadthrough.length ? `${callReadthrough.length} ${zh ? "项" : "items"}` : (zh ? "未结构化" : "Unstructured")}</span>
          </header>
          <div className="ci-paper-results-list">
            {callReadthrough.length ? callReadthrough.slice(0, 4).map((item) => (
              <div className="ci-paper-results-call" key={item.id}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                {item.detail && <small>{item.detail}</small>}
              </div>
            )) : (
              <p className="ci-paper-results-empty">{zh ? "没有可用于此研究层的规范化问答摘要。" : "No normalized Q&A read-through is available for this research layer."}</p>
            )}
          </div>
          {onOpenCall && (
            <button type="button" className="ci-paper-results-call-action" onClick={onOpenCall}>
              {zh ? "打开 Call + Q&A" : "Open Call + Q&A"} <span aria-hidden>›</span>
            </button>
          )}
        </section>
      </div>

      <div className="ci-paper-results-footer">
        <section className="ci-paper-results-compare">
          <header>
            <span>{zh ? "与上期比较" : "COMPARED WITH PRIOR EVENT"}</span>
            <small>{zh ? "仅限可比结构化字段" : "comparable structured fields only"}</small>
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
            <p className="ci-paper-results-empty">{zh ? "没有绑定的可比上期字段。" : "No comparable prior-event fields are bound."}</p>
          )}
        </section>

        <aside className="ci-paper-results-boundary" aria-label={zh ? "未断言能力" : "Not asserted capabilities"}>
          <span>{zh ? "未断言" : "NOT ASSERTED"}</span>
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
