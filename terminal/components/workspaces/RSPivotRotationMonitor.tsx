"use client";

import { useMemo, useState } from "react";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { useLang } from "@/lib/i18n";
import { buildRotationMonitor, type RotationReason } from "@/lib/rotationMonitor";
import { useRotationMonitorInputs } from "./useRotationMonitorInputs";
import RSPivotWatchPreview from "./RSPivotWatchPreview";
import styles from "./RSPivotRotationMonitor.module.css";

const NAMES: Record<string, [string, string]> = {
  XLC: ["Communication services", "通信服务"], XLY: ["Consumer discretionary", "可选消费"],
  XLP: ["Consumer staples", "必需消费"], XLE: ["Energy", "能源"], XLF: ["Financials", "金融"],
  XLV: ["Health care", "医疗保健"], XLI: ["Industrials", "工业"], XLB: ["Materials", "材料"],
  XLRE: ["Real estate", "房地产"], XLK: ["Technology", "科技"], XLU: ["Utilities", "公用事业"],
};
const REASONS: Record<RotationReason, [string, string]> = {
  unavailable: ["Unavailable", "不可用"], missing_benchmark: ["SPY unavailable", "SPY不可用"],
  untimed: ["Source time unknown", "来源时间未知"], misaligned: ["Times do not align", "时间未对齐"],
  mixed_freshness: ["Different source ages", "来源时效不同"], invalid_clock: ["Clock unavailable", "时钟不可用"],
  invalid_series: ["Invalid bar history", "K线历史无效"], unknown_basis: ["Source unverified", "来源未核验"],
  missing_interval: ["Interval incomplete", "区间不完整"], source_stale: ["Archived bars", "存档K线"],
};
function percent(value: number) {
  return (value > 0 ? "+" : value < 0 ? "−" : "") + Math.abs(value).toFixed(2) + "%";
}
function clock(ms: number | null) {
  return ms === null ? "—" : new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(ms) + " ET";
}
const barClock = (epoch: number | null) => epoch === null ? "—" : new Date(epoch * 1000).toISOString().slice(11, 16) + " ET";

/** Source-qualified observations beside the incumbent study. No alerts, scores or trade authority. */
export default function RSPivotRotationMonitor({ hydrated, onSelectSymbol, selectDisabled = false }: {
  hydrated: boolean; onSelectSymbol?: (symbol: string) => void; selectDisabled?: boolean;
}) {
  const identity = useShellIdentity(), { lang } = useLang(), zh = lang === "zh";
  const pick = (en: string, cn: string) => zh ? cn : en;
  const accountId = identity.kind === "account" ? identity.userId : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const open = accountId !== null && openedFor === accountId;
  const inputs = useRotationMonitorInputs(accountId, open && hydrated);
  const report = useMemo(() => buildRotationMonitor(inputs.quotes, inputs.histories, inputs.nowMs),
    [inputs.quotes, inputs.histories, inputs.nowMs]);
  const access = inputs.quoteState === "access" || inputs.historyState === "access";
  const reason = (key: RotationReason | null) => key ? REASONS[key][zh ? 1 : 0] : pick("Unavailable", "不可用");
  const kind = (key: string) => ({
    live: pick("Recent print", "近期成交"), delayed: pick("Delayed print", "延迟成交"),
    untimed: pick("Source time unknown", "来源时间未知"), close: pick("Session close", "交易日收盘"),
    unavailable: pick("Unavailable", "不可用"),
  }[key] ?? pick("Unavailable", "不可用"));
  const metric = (v: number | null, why: RotationReason | null = null) => v === null
    ? <span className={styles.missing}>{reason(why)}</span>
    : <span className={styles.metric} data-sign={v > 0 ? "up" : v < 0 ? "down" : undefined}>{percent(v)}</span>;
  const measured5 = report.rows.filter(row => row.windows[5].state === "measured").length;
  const measured30 = report.rows.filter(row => row.windows[30].state === "measured").length;

  return <section className={styles.root} data-testid="rotation-monitor" aria-labelledby="rotation-monitor-title">
    <header className={styles.header}>
      <div>
        <h2 id="rotation-monitor-title">{pick("Rotation monitor", "板块轮动监测")}</h2>
        <p>{pick("Sector ETFs relative to SPY · current session and completed intervals", "板块ETF相对SPY · 当前交易日与已完成区间")}</p>
      </div>
      <button className={styles.toggle} type="button" disabled={!hydrated || !accountId}
        aria-expanded={open} aria-controls="rotation-monitor-content"
        onClick={() => setOpenedFor(open ? null : accountId)}>
        {open ? pick("Close monitor", "关闭监测") : pick("Open rotation monitor", "打开轮动监测")}
      </button>
    </header>
    {open && <div id="rotation-monitor-content">
      {access ? <p className={styles.note} role="status">{pick(
        "Source access is unavailable. Sign in through Terminal to restore access.",
        "无法访问行情来源。请通过Terminal登录以恢复访问。")}</p> : <>
        <p className={styles.status} role="status" data-testid="rotation-coverage">
          <span>{report.sessionDate ?? pick("Waiting for source", "等待来源")} · {report.sessionOpen
            ? pick("Regular session", "常规交易时段") : report.sessionOpen === false ? pick("Last completed session", "最近完成的交易日") : pick("Session unavailable", "交易时段不可用")}</span>
          <span>{pick("Comparable quotes", "可比较行情")} <strong>{report.quoteCoverage.relative} / {report.quoteCoverage.expected}</strong></span>
          <span>5m <strong>{measured5} / 11</strong> · 30m <strong>{measured30} / 11</strong></span>
        </p>
        <div className={styles.scroller} role="region" tabIndex={0}
          aria-label={pick("Sector rotation comparisons; scroll horizontally for all intervals", "板块轮动比较，可横向滚动查看所有区间")}>
          <table className={styles.table}>
            <thead><tr>
              <th scope="col">{pick("Sector proxy", "板块代理")}</th>
              <th scope="col">5m {pick("vs SPY", "相对SPY")}</th>
              <th scope="col">30m {pick("vs SPY", "相对SPY")}</th>
              <th scope="col">{pick("Since prior close vs SPY", "较前收盘 · 相对SPY")}</th>
              <th scope="col">{pick("Since prior close", "较前收盘")}</th>
              <th scope="col">{pick("Quote observation", "行情观测")}</th>
            </tr></thead>
            <tbody>{report.rows.map(row => <tr key={row.symbol} data-testid={"rotation-row-" + row.symbol}>
              <th scope="row">{onSelectSymbol ? <button className={styles.symbol} type="button" disabled={selectDisabled}
                aria-label={pick("Study " + row.symbol + " in RS × 30m", "在相对强度 × 30分钟中研究 " + row.symbol)}
                onClick={() => onSelectSymbol(row.symbol)}>{row.symbol}</button> : row.symbol}<small>{NAMES[row.symbol]?.[zh ? 1 : 0] ?? row.symbol}</small></th>
              <td data-metric="5">{metric(row.windows[5].relativePct, row.windows[5].reason)}</td>
              <td data-metric="30">{metric(row.windows[30].relativePct, row.windows[30].reason)}</td>
              <td data-metric="relative">{metric(row.quote.relativePct, row.quote.reason)}</td>
              <td data-metric="absolute">{metric(row.quote.sincePreviousClosePct, row.quote.reason)}</td>
              <td className={styles.source}>
                <span>{kind(row.quote.kind)}</span>
                <span>{clock(row.quote.observedAtMs)}</span>
                {row.quote.ageMs !== null && <span>{Math.floor(row.quote.ageMs / 1000)} s {pick("old", "前")}</span>}
              </td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className={styles.note}>{pick(
          "5m and 30m compare matching completed bars ending at ",
          "5分钟和30分钟使用相同结束时间的已完成K线：")}{barClock(report.barEndpointDisplayEpoch)}.
          {report.barEndpointAgeSeconds !== null && <> {Math.floor(report.barEndpointAgeSeconds)} s {pick("since bar endpoint.", "距离区间结束。")}</>}
          {" "}{pick("Bar data may be delayed. These are observed returns; pivot forecasts are not yet qualified.",
            "K线行情可能延迟。此处为已观测收益，枢轴预测尚未通过验证。")}</p>
        {inputs.historyState === "loading" && <p className={styles.note}>{pick("Loading current-session intervals…", "正在加载当前交易日区间…")}</p>}
        {(inputs.quoteState === "unavailable" || inputs.historyState === "unavailable" || inputs.historyState === "partial")
          && <p className={styles.note} role="status">{pick("Some inputs are unavailable; affected comparisons remain unavailable.",
            "部分输入不可用；对应比较暂不显示。")}</p>}
        <RSPivotWatchPreview monitor={report} histories={inputs.histories} nowMs={inputs.nowMs} zh={zh} />
        <details className={styles.evidence}>
          <summary>{pick("Source details", "来源详情")}</summary>
          <dl>
            <dt>{pick("Quote request received", "行情请求接收时间")}</dt><dd>{clock(inputs.quoteReceivedAt)}</dd>
            <dt>{pick("Bar request received", "K线请求接收时间")}</dt><dd>{clock(inputs.historyReceivedAt)}</dd>
            <dt>{pick("Bar endpoint", "K线区间结束时间")}</dt><dd>{report.sessionDate ?? "—"} {barClock(report.barEndpointDisplayEpoch)}</dd>
            <dt>{pick("Coverage", "覆盖范围")}</dt><dd>{pick("11 sector ETF proxies; no constituent breadth or fund-flow estimate.", "11个板块ETF代理；不代表成分股广度或资金流估计。")}</dd>
            <dt>{pick("Comparison", "比较方法")}</dt><dd>{pick("Relative wealth: sector price ratio ÷ SPY price ratio − 1. No missing inputs are filled.",
              "相对财富收益：板块价格比 ÷ SPY价格比 − 1。缺失输入不填补。")}</dd>
            <dt>{pick("Timing", "时间规则")}</dt><dd>{pick("Quote event times use UTC. Bar labels use New York session time. Receipt time is not price freshness.",
              "行情事件采用UTC时间；K线标签采用纽约交易时段时间。接收时间不代表价格时效。")}</dd>
            <dt>{pick("Research status", "研究状态")}</dt><dd>{pick("Descriptive current inputs and corrected bar history. No point-in-time backtest or predictive validation is claimed.",
              "当前输入与历史修正K线仅供描述。不代表已完成历史时点回测或预测验证。")}</dd>
          </dl>
        </details>
      </>}
    </div>}
  </section>;
}
