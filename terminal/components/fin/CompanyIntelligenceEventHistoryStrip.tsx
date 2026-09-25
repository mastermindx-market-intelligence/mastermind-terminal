"use client";

import "../../app/company-intelligence-event-history.css";
import { pick } from "../../lib/finFormat";

export type CompanyIntelligenceEventHistoryStatus = "current" | "latest" | "historical" | "context";

export interface CompanyIntelligenceEventHistoryItem {
  id: string;
  label: string;
  date: string;
  status: CompanyIntelligenceEventHistoryStatus;
  onSelect?: () => void;
}

interface CompanyIntelligenceEventHistoryStripProps {
  zh: boolean;
  items: CompanyIntelligenceEventHistoryItem[];
  contextOnly?: boolean;
  onOpenHistory?: () => void;
}

function statusLabel(status: CompanyIntelligenceEventHistoryStatus, zh: boolean): string {
  if (status === "current") return pick(zh, "Current", "当期");
  if (status === "latest") return pick(zh, "Latest", "最新");
  if (status === "context") return pick(zh, "v1 context", "v1 背景");
  return pick(zh, "History", "历史");
}

function HistoryItem({
  item,
  zh,
}: {
  item: CompanyIntelligenceEventHistoryItem;
  zh: boolean;
}) {
  const content = (
    <>
      <i aria-hidden />
      <span>
        <strong>{item.label}</strong>
        <time dateTime={item.date}>{item.date}</time>
      </span>
      <b>{statusLabel(item.status, zh)}</b>
    </>
  );
  const shared = {
    className: `ci-event-history-item ${item.status}`,
    "data-ci-event-history-item": item.id,
    "data-ci-event-history-status": item.status,
  } as const;

  if (item.onSelect) {
    return (
      <button
        type="button"
        {...shared}
        onClick={item.onSelect}
        aria-pressed={item.status === "current"}
      >
        {content}
      </button>
    );
  }

  return (
    <div {...shared} aria-current={item.status === "current" ? "true" : undefined}>
      {content}
    </div>
  );
}

export default function CompanyIntelligenceEventHistoryStrip({
  zh,
  items,
  contextOnly = false,
  onOpenHistory,
}: CompanyIntelligenceEventHistoryStripProps) {
  if (!items.length) return null;
  return (
    <section
      className="ci-event-history-strip"
      data-ci-event-history-strip=""
      data-ci-event-history-mode={contextOnly ? "current-plus-context" : "selectable-history"}
      aria-label={pick(zh, "Company event history", "公司事件历史")}
    >
      <header>
        <span>{pick(zh, "EVENT HISTORY", "事件历史")}</span>
        <strong>{contextOnly
          ? pick(zh, "Selected event with historical context", "所选事件与历史背景")
          : pick(zh, "Quarter-by-quarter event record", "逐季度事件记录")}</strong>
        <small>{contextOnly
          ? pick(zh, "Historical v1 rows do not control current-event truth.", "历史 v1 行不控制当期事件事实。")
          : pick(zh, "Select a period without leaving the Brief.", "无需离开简报即可选择期间。")}</small>
      </header>
      <div className="ci-event-history-track">
        {items.slice(0, 4).map((item) => <HistoryItem key={item.id} item={item} zh={zh} />)}
      </div>
      {onOpenHistory ? (
        <button type="button" className="ci-event-history-open" onClick={onOpenHistory}>
          {pick(zh, "All events", "全部事件")} <span aria-hidden>›</span>
        </button>
      ) : null}
    </section>
  );
}
