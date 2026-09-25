"use client";

import "../../app/company-intelligence-topics.css";
import { pick } from "../../lib/finFormat";

export type CompanyIntelligenceTopicMemoryMode = "structured-context" | "historical-context";
export type CompanyIntelligenceTopicMemoryStatus = "added" | "persistent" | "dropped";

export interface CompanyIntelligenceTopicMemoryItem {
  id: string;
  label: string;
  status: CompanyIntelligenceTopicMemoryStatus;
  statusLabel: string;
  eventCount: number;
  firstLabel?: string | null;
  firstDate?: string | null;
  lastLabel?: string | null;
  lastDate?: string | null;
}

interface CompanyIntelligenceTopicMemoryLayoutProps {
  zh: boolean;
  mode: CompanyIntelligenceTopicMemoryMode;
  currentLabel: string;
  currentDate: string;
  topics: CompanyIntelligenceTopicMemoryItem[];
  onOpenHistory?: () => void;
}

const STATUSES: readonly CompanyIntelligenceTopicMemoryStatus[] = ["added", "persistent", "dropped"];

function bucketLabel(status: CompanyIntelligenceTopicMemoryStatus, zh: boolean): string {
  if (status === "added") return pick(zh, "Added", "新增");
  if (status === "persistent") return pick(zh, "Persistent", "持续");
  return pick(zh, "Dropped", "退出");
}

function bucketDetail(status: CompanyIntelligenceTopicMemoryStatus, zh: boolean): string {
  if (status === "added") return pick(zh, "Entered in the latest structured history", "在最新结构化历史中进入");
  if (status === "persistent") return pick(zh, "Appeared across multiple tracked events", "在多个追踪事件中持续出现");
  return pick(zh, "No longer present in the latest tracked event", "在最新追踪事件中不再出现");
}

function TopicCard({ item, zh }: { item: CompanyIntelligenceTopicMemoryItem; zh: boolean }) {
  const first = item.firstLabel || pick(zh, "Unknown first event", "首次事件未知");
  const last = item.lastLabel || pick(zh, "Unknown latest event", "最近事件未知");
  return (
    <article className={`ci-topics-vnext-card ${item.status}`} data-ci-topic={item.id} data-ci-topic-status={item.status}>
      <header>
        <i aria-hidden />
        <strong>{item.label}</strong>
        <b>{item.statusLabel}</b>
      </header>
      <dl>
        <div>
          <dt>{pick(zh, "First seen", "首次出现")}</dt>
          <dd>
            <strong>{first}</strong>
            {item.firstDate ? <time dateTime={item.firstDate}>{item.firstDate}</time> : null}
          </dd>
        </div>
        <div>
          <dt>{pick(zh, "Last seen", "最近出现")}</dt>
          <dd>
            <strong>{last}</strong>
            {item.lastDate ? <time dateTime={item.lastDate}>{item.lastDate}</time> : null}
          </dd>
        </div>
      </dl>
      <footer>
        <span>{pick(zh, "Tracked events", "追踪事件")}</span>
        <strong>{item.eventCount}</strong>
      </footer>
    </article>
  );
}

export default function CompanyIntelligenceTopicMemoryLayout({
  zh,
  mode,
  currentLabel,
  currentDate,
  topics,
  onOpenHistory,
}: CompanyIntelligenceTopicMemoryLayoutProps) {
  const historicalOnly = mode === "historical-context";
  const counts = Object.fromEntries(STATUSES.map((status) => [
    status,
    topics.filter((topic) => topic.status === status).length,
  ])) as Record<CompanyIntelligenceTopicMemoryStatus, number>;

  return (
    <section className="ci-topics-vnext" data-ci-paper-topics="" data-ci-topics-mode={mode}>
      <header className="ci-topics-vnext-head">
        <div>
          <span>{pick(zh, "TOPIC MEMORY", "主题记忆")}</span>
          <h3>{historicalOnly
            ? pick(zh, "Historical topics do not rewrite the verified event", "历史主题不会改写已验证事件")
            : pick(zh, "What entered, persisted, or dropped across events", "查看跨事件新增、持续或退出的主题")}</h3>
        </div>
        <div className="ci-topics-vnext-period">
          <strong>{currentLabel}</strong>
          <time dateTime={currentDate}>{currentDate}</time>
        </div>
      </header>

      <section className="ci-topics-vnext-summary" aria-label={pick(zh, "Topic memory summary", "主题记忆摘要")}>
        <article>
          <span>{pick(zh, "Tracked", "追踪")}</span>
          <strong>{topics.length}</strong>
          <small>{pick(zh, "structured topics", "个结构化主题")}</small>
        </article>
        {STATUSES.map((status) => (
          <article key={status} data-status={status}>
            <span>{bucketLabel(status, zh)}</span>
            <strong>{counts[status]}</strong>
            <small>{bucketDetail(status, zh)}</small>
          </article>
        ))}
      </section>

      {historicalOnly ? (
        <aside className="ci-topics-vnext-boundary" role="note">
          <span>{pick(zh, "HISTORICAL V1 CONTEXT", "历史 v1 背景")}</span>
          <strong>{pick(
            zh,
            "Topic memory describes the older structured history only. It does not label, rank or explain the verified current event.",
            "主题记忆仅描述较早的结构化历史；不会标记、排名或解释当前已验证事件。",
          )}</strong>
        </aside>
      ) : null}

      <div className="ci-topics-vnext-board">
        {STATUSES.map((status) => {
          const bucket = topics.filter((topic) => topic.status === status);
          return (
            <section key={status} className={`ci-topics-vnext-bucket ${status}`} data-ci-topic-bucket={status}>
              <header>
                <div>
                  <span>{bucketLabel(status, zh).toUpperCase()}</span>
                  <strong>{bucketDetail(status, zh)}</strong>
                </div>
                <b>{bucket.length}</b>
              </header>
              <div>
                {bucket.length ? bucket.map((item) => <TopicCard key={item.id} item={item} zh={zh} />) : (
                  <p>{pick(zh, "No topics in this state.", "此状态暂无主题。")}</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <footer className="ci-topics-vnext-footer">
        <div>
          <span>{pick(zh, "AUTHORITY BOUNDARY", "权限边界")}</span>
          <strong>{historicalOnly
            ? pick(zh, "v1 topic context remains separate from current EventWorkspace claims.", "v1 主题背景与当前 EventWorkspace 主张保持分离。")
            : pick(zh, "Status and spans come from the structured topic timeline; no topic importance is inferred.", "状态和时间跨度来自结构化主题时间线；不会推断主题重要性。")}</strong>
        </div>
        {onOpenHistory ? (
          <button type="button" onClick={onOpenHistory}>{pick(zh, "Open event history", "打开事件历史")} <span aria-hidden>›</span></button>
        ) : null}
      </footer>
    </section>
  );
}
