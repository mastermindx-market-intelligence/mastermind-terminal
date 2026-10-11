"use client";

import type { ReactNode } from "react";
import CompanyVisual from "./CompanyVisual";

export interface CompanyIntelligenceBriefItem {
  id: string;
  label: string;
  value: string;
  detail?: string | null;
}

interface CompanyIntelligenceBriefLayoutProps {
  zh: boolean;
  ticker: string;
  periodLabel: string;
  eventDate: string;
  headline: string;
  summary?: string | null;
  metrics: CompanyIntelligenceBriefItem[];
  takeaways: CompanyIntelligenceBriefItem[];
  changes: CompanyIntelligenceBriefItem[];
  implications: CompanyIntelligenceBriefItem[];
  risks: CompanyIntelligenceBriefItem[];
  watch: CompanyIntelligenceBriefItem[];
  selectedId?: string | null;
  onSelect: (item: CompanyIntelligenceBriefItem) => void;
  footer?: ReactNode;
}
function label(zh: boolean, en: string, cn: string): string {
  return zh ? cn : en;
}

function BriefList({
  items,
  selectedId,
  onSelect,
  empty,
}: {
  items: CompanyIntelligenceBriefItem[];
  selectedId?: string | null;
  onSelect: (item: CompanyIntelligenceBriefItem) => void;
  empty: string;
}) {
  if (!items.length) return <p className="ci-paper-brief-empty">{empty}</p>;
  return (
    <ol className="ci-paper-brief-list">
      {items.slice(0, 3).map((item, index) => (
        <li key={item.id}>
          <button
            className={selectedId === item.id ? "selected" : ""}
            onClick={() => onSelect(item)}
            aria-pressed={selectedId === item.id}
          >
            <span className="num">{String(index + 1).padStart(2, "0")}</span>
            <span>
              <strong>{item.value}</strong>
              {item.detail && <small>{item.detail}</small>}
            </span>
            <i aria-hidden>›</i>
          </button>
        </li>
      ))}
    </ol>
  );
}

function InsightPanel({
  eyebrow,
  title,
  subtitle,
  items,
  selectedId,
  onSelect,
  empty,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  items: CompanyIntelligenceBriefItem[];
  selectedId?: string | null;
  onSelect: (item: CompanyIntelligenceBriefItem) => void;
  empty: string;
}) {
  return (
    <section className="ci-paper-insight">
      <header>
        <span className="ci-paper-insight-mark" aria-hidden>{eyebrow}</span>
        <div>
          <h4>{title}</h4>
          <p>{subtitle}</p>
        </div>
      </header>
      <BriefList
        items={items}
        selectedId={selectedId}
        onSelect={onSelect}
        empty={empty}
      />
    </section>
  );
}

export default function CompanyIntelligenceBriefLayout({
  zh,
  ticker,
  periodLabel,
  eventDate,
  headline,
  summary,
  metrics,
  takeaways,
  changes,
  implications,
  risks,
  watch,
  selectedId,
  onSelect,
  footer,
}: CompanyIntelligenceBriefLayoutProps) {
  return (
    <div className="ci-brief ci-paper-brief" data-ci-paper-brief="">
      <section className="ci-paper-brief-hero">
        <div className="ci-paper-brief-copy">
          <div className="ci-paper-brief-meta">
            <span>{label(zh, "30-SECOND BRIEF · SOURCE-BACKED", "30 秒简报 · 来源支持")}</span>
            <i aria-hidden />
            <time dateTime={eventDate}>{periodLabel} · {eventDate}</time>
            <b>{label(zh, "context only", "仅供背景参考")}</b>
          </div>
          <h3>{headline}</h3>
          {summary && <p>{summary}</p>}
          {!!takeaways.length && (
            <div className="ci-paper-takeaways">
              {takeaways.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  className={selectedId === item.id ? "selected" : ""}
                  onClick={() => onSelect(item)}
                  aria-pressed={selectedId === item.id}
                >
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </button>
              ))}
            </div>
          )}
        </div>
        <CompanyVisual ticker={ticker} />
      </section>

      {!!metrics.length && (
        <section className="ci-paper-metrics" aria-label={label(zh, "Current event facts", "当期事件事实")}>
          {metrics.slice(0, 4).map((item) => (
            <button
              key={item.id}
              className={selectedId === item.id ? "selected" : ""}
              onClick={() => onSelect(item)}
              aria-pressed={selectedId === item.id}
            >
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              {item.detail && <small>{item.detail}</small>}
            </button>
          ))}
        </section>
      )}

      <div className="ci-paper-insights">
        <InsightPanel
          eyebrow="↗"
          title={label(zh, "What changed", "发生了什么变化")}
          subtitle={label(zh, "Source-backed changes in the selected event", "所选事件中有来源支持的变化")}
          items={changes}
          selectedId={selectedId}
          onSelect={onSelect}
          empty={label(zh, "No comparable change is asserted for this event.", "本事件未断言可比变化。")}
        />
        <InsightPanel
          eyebrow="i"
          title={label(zh, "Why it matters", "为何重要")}
          subtitle={label(zh, "Governed business implications · not a signal", "受治理的业务含义 · 非交易信号")}
          items={implications}
          selectedId={selectedId}
          onSelect={onSelect}
          empty={label(
            zh,
            "Not asserted · no governed implication synthesis is attached to this generation.",
            "未断言 · 本版本未附带受治理的业务含义综合。",
          )}
        />
        <InsightPanel
          eyebrow="!"
          title={label(zh, "Key risks", "关键风险")}
          subtitle={label(zh, "Retained watchpoints from the selected event", "所选事件中保留的关注点")}
          items={risks}
          selectedId={selectedId}
          onSelect={onSelect}
          empty={label(zh, "No source-backed risk watchpoint is retained.", "未保留有来源支持的风险关注点。")}
        />
      </div>

      <section className="ci-paper-watch">
        <header>
          <div>
            <h4>{label(zh, "What to watch next", "接下来关注什么")}</h4>
            <p>{label(zh, "Upcoming qualified context and unresolved watchpoints", "后续合格背景与未解决关注点")}</p>
          </div>
          <span>{label(zh, "context only", "仅供背景参考")}</span>
        </header>
        {watch.length ? (
          <div className="ci-paper-watch-list">
            {watch.slice(0, 4).map((item) => (
              <button
                key={item.id}
                className={selectedId === item.id ? "selected" : ""}
                onClick={() => onSelect(item)}
                aria-pressed={selectedId === item.id}
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <i aria-hidden>›</i>
              </button>
            ))}
          </div>
        ) : (
          <p className="ci-paper-brief-empty">
            {label(zh, "No future watchpoint is asserted for this generation.", "本版本未断言后续关注点。")}
          </p>
        )}
      </section>

      {footer}
    </div>
  );
}
