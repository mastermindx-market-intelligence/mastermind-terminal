"use client";
import { pick } from "../../lib/finFormat";
import { prophetObservationSummary, TRIGGER_NAMES, type ProphetObservationRead, type ProphetSourceTiming } from "../../lib/prophetObservations";
import styles from "./IntelligenceWorkspace.module.css";
import evidenceStyles from "./ProphetObservationEvidence.module.css";

const BLOCKER_NAMES: Record<string, readonly [string, string]> = {
  macd_below_signal: ["MACD below signal", "MACD 低于信号线"],
};
function timingFacts(timing: ProphetSourceTiming, zh: boolean) {
  const money = (value: number) => "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: value < 1 ? 4 : 2 });
  const confirmation = timing.slow_tier_evaluated !== true ? pick(zh, "Not evaluated", "尚未评估")
    : timing.slow_tier_eligible === true ? pick(zh, "Confirmed", "已确认") + (timing.slow_tier_tier ? ` · ${timing.slow_tier_tier}` : "")
    : timing.slow_tier_eligible === false ? pick(zh, "Pending", "等待确认") : pick(zh, "Not reported", "未提供");
  return <>
    <dl className={evidenceStyles.facts}>
      {timing.close !== null && <div><dt>{pick(zh, "Recorded close", "记录收盘价")}</dt><dd>{money(timing.close)}</dd></div>}
      {timing.reset_low !== null && <div><dt>{pick(zh, "Source reset low", "来源重置低点")}</dt><dd>{money(timing.reset_low)}{timing.reset_low_date && <small>{timing.reset_low_date}</small>}</dd></div>}
      {timing.off_reset_low_pct !== null && <div><dt>{pick(zh, "From reset low", "距重置低点")}</dt><dd>{timing.off_reset_low_pct >= 0 ? "+" : ""}{timing.off_reset_low_pct.toFixed(2)}%</dd></div>}
      {timing.slow_tier_evaluated !== null && <div><dt>{pick(zh, "Slow confirmation", "慢周期确认")}</dt><dd>{confirmation}</dd></div>}
    </dl>
    <p className={evidenceStyles.date}>{timing.asof
      ? pick(zh, `Price as of ${timing.asof}`, `价格日期 ${timing.asof}`)
      : pick(zh, "Per-stock price date not recorded", "未记录个股价格日期")}</p>
  </>;
}

/** The existing B03 read, including observations that did not join a new B1 episode. */
export default function ProphetObservationEvidence({ read, zh = false }: { read: ProphetObservationRead; zh?: boolean }) {
  const summary = prophetObservationSummary(read, zh);
  const data = read.status === "ready" ? read.data : null;
  return <section className={styles.section} data-testid="workspace-prophet-observations">
    <h3 className={styles.sectionHeading}>{pick(zh, "Prophet early evidence", "Prophet 早期迹象")}<span>{pick(zh, "Source observations", "数据源记录")}</span></h3>
    <p className={evidenceStyles.summary}>{summary.label}</p>
    {summary.detail && <div className={evidenceStyles.date}>{summary.detail}</div>}
    {data?.rows.map(row => <div key={row.source_event_id}>
      <ul className={styles.evidenceList}>{row.triggers_fired.map(id => <li key={id}>
        {TRIGGER_NAMES[id][zh ? 1 : 0]}{row.source_evidence.triggers[id].last_date ? ` · ${row.source_evidence.triggers[id].last_date}` : ""}
      </li>)}</ul>
      {row.source_timing && timingFacts(row.source_timing, zh)}
      {(row.source_timing?.slow_tier_blocking ?? row.source_evidence.counterevidence ?? []).length > 0 && <p className={evidenceStyles.blockers}>
        {pick(zh, "Confirmation conditions", "确认条件")}: {(row.source_timing?.slow_tier_blocking ?? row.source_evidence.counterevidence ?? []).map(key =>
          BLOCKER_NAMES[key]?.[zh ? 1 : 0] ?? pick(zh, "Other recorded condition", "其他来源条件")).join(" · ")}
      </p>}
      {row.episode_relation.state === "BLOCKED_BY_ACTIVE_EPISODE" && <p className={styles.meta}>
        {pick(zh, "An existing episode has a different anchor. This new observation remains available for review.", "现有候选周期使用不同锚点。此新记录仍可供评估。")}
      </p>}
      <details className={styles.method}><summary>{pick(zh, "Source & candidate relation", "来源与候选关联")}</summary>
        <p>{pick(zh, "Observation session", "记录日期")}: {row.source_session}</p>
        <p>{pick(zh, "Exact candidate relation", "精确候选关联")}: <code>{row.episode_relation.state}</code></p>
        <p style={{ overflowWrap: "anywhere" }}><code>{row.episode_relation.reason}</code></p>
        {row.episode_relation.episode_id && <p style={{ overflowWrap: "anywhere" }}><code>{row.episode_relation.episode_id}</code></p>}
        <p style={{ overflowWrap: "anywhere" }}>{pick(zh, "Source receipt", "来源凭证")}: <code>{row.source_receipt}</code></p>
        <p>{pick(zh, "Actual delivery time is not supplied by this source.", "该数据源未提供实际送达时间。")}</p>
      </details>
    </div>)}
    <p className={evidenceStyles.note}>{pick(zh, "Watch evidence, not an entry instruction", "观察依据，非入场指令")}</p>
    {read.status === "unavailable" && read.retry && <button type="button" className={styles.textButton} onClick={read.retry}>{pick(zh, "Check source again", "重新检查数据源")}</button>}
  </section>;
}
