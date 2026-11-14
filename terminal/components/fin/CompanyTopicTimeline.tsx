"use client";

import { useMemo, useState } from "react";
import type { CompanyIntelligenceTopic } from "@/lib/companyIntelligence";
import { topicTagLabel } from "@/lib/companyIntelligenceLabels";
import { topicStatusLabel } from "@/lib/plainLabels";
import { pick } from "@/lib/finFormat";

/** Browse the existing published topic history; filters never synthesize event claims. */
export default function CompanyTopicTimeline({ topics, zh }: { topics: CompanyIntelligenceTopic[]; zh: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("frequency");
  const visible = useMemo(() => topics.filter(topic =>
    (status === "all" || topic.status === status) &&
    `${topic.tag} ${topicTagLabel(topic.tag, zh)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ).sort((a, b) => sort === "frequency"
    ? b.event_count - a.event_count || a.tag.localeCompare(b.tag)
    : topicTagLabel(a.tag, zh).localeCompare(topicTagLabel(b.tag, zh))), [topics, query, status, sort, zh]);

  if (!topics.length) return <p className="ci-inline-empty">{pick(zh, "Topic history is not available for this company yet.", "该公司暂无主题历史。")}</p>;
  return <div className="ci-topics-browser">
    <div className="ci-topics-controls">
      <label className="ci-topics-search">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
        <input value={query} onChange={event => setQuery(event.target.value)} type="search"
          aria-label={pick(zh, "Search topics", "搜索主题")} placeholder={pick(zh, "Search topics…", "搜索主题…")} />
      </label>
      <select value={status} onChange={event => setStatus(event.target.value)} aria-label={pick(zh, "Topic status", "主题状态")}>
        <option value="all">{pick(zh, "All changes", "全部变化")}</option>
        {(["added", "persistent", "dropped"] as const).map(value => <option key={value} value={value}>{topicStatusLabel(value, zh ? "zh" : "en")}</option>)}
      </select>
      <select value={sort} onChange={event => setSort(event.target.value)} aria-label={pick(zh, "Sort topics", "主题排序")}>
        <option value="frequency">{pick(zh, "Most discussed", "讨论最多")}</option>
        <option value="name">{pick(zh, "Name", "名称")}</option>
      </select>
    </div>
    <p className="ci-topics-count" role="status">{pick(zh, `${visible.length} of ${topics.length} topics`, `${visible.length} / ${topics.length} 个主题`)}</p>
    {visible.length ? <div className="ci-topic-table-wrap"><table className="ci-topic-table">
      <thead><tr><th scope="col">{pick(zh, "Topic", "主题")}</th><th scope="col">{pick(zh, "Change", "变化")}</th><th scope="col">{pick(zh, "Events", "事件数")}</th></tr></thead>
      <tbody>{visible.map(topic => <tr key={topic.tag}>
        <th scope="row">{topicTagLabel(topic.tag, zh)}</th>
        <td><span className={`ci-topic-change ${topic.status}`}>{topicStatusLabel(topic.status, zh ? "zh" : "en")}</span></td>
        <td className="num">{topic.event_count}</td>
      </tr>)}</tbody>
    </table></div> : <p className="ci-inline-empty">{pick(zh, "No topics match these filters.", "没有符合筛选条件的主题。")}</p>}
  </div>;
}
