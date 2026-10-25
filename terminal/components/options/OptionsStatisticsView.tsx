"use client";

import { useEffect, useState } from "react";
import { useFlowStream } from "@/lib/flowStream";
import { useLang } from "@/lib/i18n";
import { optionsWorkspaceCopy } from "@/lib/optionsWorkspaceCopy";
import { decodeObservedStatistics, type ObservedBucket, type ObservedStatisticsResult } from "@/lib/optionsObservedStatistics";
import s from "./OptionsStatisticsView.module.css";

const locationLabels: Record<string, [string, string]> = {
  below_bid: ["Below bid", "低于买价"], at_bid: ["At bid", "等于买价"],
  inside_below_mid: ["Inside · below midpoint", "价差内 · 低于中间价"], at_mid: ["At midpoint", "等于中间价"],
  inside_above_mid: ["Inside · above midpoint", "价差内 · 高于中间价"], at_ask: ["At ask", "等于卖价"],
  above_ask: ["Above ask", "高于卖价"], UNKNOWN: ["Unknown", "未知"],
};

export function OptionsStatisticsPanel({ result, lang, transportStale = false }: {
  result: ObservedStatisticsResult; lang: string; transportStale?: boolean;
}) {
  const zh = lang === "zh";
  const text = (en: string, cn: string) => zh ? cn : en;
  const num = (n: number) => n.toLocaleString(zh ? "zh-CN" : "en-US");
  const pct = (n: number | null) => n === null ? "—" : `${(n * 100).toFixed(1)}%`;
  const premium = (b: ObservedBucket) => b.premium_total_status === "UNREPRESENTABLE"
    ? text("Outside display range", "超出显示范围") : b.qualified_premium_usd === null
      ? text("Unavailable", "暂无数据") : b.qualified_premium_usd.toLocaleString(zh ? "zh-CN" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const clock = (value: string | null) => value ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC") : text("Unavailable", "暂无数据");
  if (result.state !== "available") return <div className={s.empty} data-statistics-state={result.state} role="status">
    <span className={s.eyebrow}>{text("Observed trading", "已观测交易")}</span>
    <h2>{result.state === "invalid" ? text("This snapshot could not be verified", "此快照未通过校验") : text("No qualified observations yet", "暂无合格观测数据")}</h2>
    <p>{result.state === "invalid" ? text("Counts are withheld because the snapshot does not reconcile. Previously displayed values are not substituted.", "快照数据无法核对，因此暂不显示统计值，也不以旧数据替代。") : result.reason === "root_unobserved"
      ? text("This symbol is not present in the observed snapshot. Its activity is unknown, not zero.", "当前观测快照未包含此代码。其交易活动未知，并非为零。")
      : text("Statistics will appear after the existing source publishes a qualified observation. Tape highlights cannot supply a whole-market denominator.", "现有数据源发布合格观测后，统计结果将显示于此。精选逐笔记录不能作为全市场统计的分母。")}</p>
    <p className={s.muted}>{text("No values shown", "当前不显示数值")}</p>
  </div>;
  const r = result;
  const rows = (entries: [string, ObservedBucket][], labels?: Record<string, [string, string]>) => entries.map(([key, b]) => <tr key={key}>
    <th scope="row">{labels?.[key]?.[zh ? 1 : 0] ?? (key === "UNKNOWN" ? text("Unknown", "未知") : key)}</th>
    <td>{num(b.print_count)}</td><td>{num(b.contract_volume)}</td>
    <td>{premium(b)}<small>{text("Print coverage", "笔数覆盖率")} {pct(b.premium_print_coverage)}</small></td>
  </tr>);
  const table = (entries: [string, ObservedBucket][], caption: string, labels?: Record<string, [string, string]>) => <div className={s.tableScroll} tabIndex={0} role="region" aria-label={caption}>
    <table><caption className={s.srOnly}>{caption}</caption><thead><tr><th scope="col">{text("Group", "分组")}</th><th scope="col">{text("Prints", "笔数")}</th><th scope="col">{text("Contracts", "合约量")}</th><th scope="col">{text("Qualified premium", "合格权利金小计")}</th></tr></thead><tbody>{rows(entries, labels)}</tbody></table>
  </div>;
  const venues = Object.entries(r.venues).sort((a, b) => b[1].print_count - a[1].print_count || a[0].localeCompare(b[0]));
  const stale = transportStale || r.stale;
  return <div data-statistics-state="available" data-statistics-stale={stale}>
    <div className={s.status} role="status">
      <strong>{stale ? text("Retained observations · stale", "保留观测 · 已过期") : text("Recent observations", "近期观测")}</strong>
      <span>{text("Session", "交易日")} {r.sessionDate} · {text("Last observed", "最近观测")} {clock(r.lastObservedAt)}</span>
      {(transportStale || r.cachedFallback) && <span>{text("Latest delivery failed; retained snapshot shown.", "最新数据传输失败，当前显示保留快照。")}</span>}
      <span>{text("Acquisition", "数据获取")}: {({ CURRENT_CYCLE_FAILED: text("Latest scheduled source request failed", "最近计划的数据源请求失败"), CURRENT_CYCLE_SUCCESS: text("Latest scheduled source request succeeded", "最近计划的数据源请求成功"), NOT_SCHEDULED: text("Not requested in the latest cycle", "最近周期未请求此代码"), UNKNOWN: text("Current source status unknown", "当前数据源状态未知") })[r.acquisition.status]}</span>
    </div>
    <div className={s.metrics}>
      <div><span>{text("Observed prints", "已观测笔数")}</span><strong>{num(r.totals.print_count)}</strong></div>
      <div><span>{text("Observed contracts", "已观测合约量")}</span><strong>{num(r.totals.contract_volume)}</strong></div>
      <div><span>{text("Qualified premium subtotal", "合格权利金小计")}</span><strong>{premium(r.totals)}</strong><small>{text("Print coverage", "笔数覆盖率")} {pct(r.totals.premium_print_coverage)}</small></div>
      <div><span>{text("Usable NBBO coverage", "可用 NBBO 覆盖率")}</span><strong>{pct(r.nbboPrintCoverage)}</strong><small>{text("Share of observed prints", "占已观测笔数比例")}</small></div>
    </div>
    {r.status !== "OBSERVED" && <p className={s.notice}>{({ OBSERVED_EMPTY: text("The observed batches contained no source rows. This does not establish zero trading for the session.", "观测批次没有数据行，不代表整个交易日没有成交。"), NO_VALID_SOURCE_ROWS: text("Source rows were received, but none passed validation.", "已收到数据行，但没有通过校验的交易。"), NO_NEW_VALID_ROWS: text("No new valid prints were observed beyond the existing source watermark.", "现有数据水位之后未观测到新的有效交易。"), NO_UNAMBIGUOUS_VALID_ROWS: text("No unambiguous valid prints were available to count.", "没有可供统计的无歧义有效交易。") })[r.status]}</p>}
    <div className={s.grid}>
      <section className={s.card}><h2>{text("Calls & puts", "认购与认沽")}</h2><p>{text("Observed contracts by option right.", "按期权类型统计已观测合约。")}</p>{table(Object.entries(r.rights), text("Calls and puts", "认购与认沽"), { C: ["Calls", "认购"], P: ["Puts", "认沽"] })}</section>
      <section className={s.card}><h2>{text("Execution location", "成交位置")}</h2><p>{text("Price relative to the usable bid and ask. Location does not identify buyer or seller intent.", "成交价相对于可用买卖报价的位置，不代表买卖方意图。")}</p>{table(Object.entries(r.locations), text("Execution location", "成交位置"), locationLabels)}</section>
      <section className={s.card}><h2>{text("Reported venues", "来源场所代码")}</h2><p>{text("Original source codes; exchange names are not inferred. This is not market share.", "保留原始来源代码，不推断交易所名称。这不是市场份额。")} {text("Known-code print coverage", "已知代码笔数覆盖率")} {pct(r.venuePrintCoverage)}.</p>{table(venues.slice(0, 8), text("Reported venues", "来源场所代码"))}{venues.length > 8 && <details><summary>{text(`See ${venues.length - 8} more venues`, `查看其余 ${venues.length - 8} 个场所`)}</summary>{table(venues.slice(8), text("Other reported venues", "其余场所代码"))}</details>}</section>
      <section className={s.card}><h2>{text("What these counts cover", "统计范围")}</h2><p>{text("Only new, valid, unambiguous prints observed for this symbol after measurement began. Selected symbols and sampled batches do not establish whole-market, whole-session or continuous coverage.", "仅统计开始观测后，此代码新增、有效且无歧义的交易。选定代码及观测批次不代表全市场、完整交易日或连续覆盖。")}</p>
        <dl className={s.provenance}><dt>{text("Observation window", "观测窗口")}</dt><dd>{clock(r.firstObservedAt)} → {clock(r.lastObservedAt)}</dd><dt>{text("Source print range", "源交易时间范围")}</dt><dd>{clock(r.firstTradeAt)} → {clock(r.lastTradeAt)}</dd><dt>{text("Last successful source request", "最近成功的数据源请求")}</dt><dd>{clock(r.acquisition.lastSuccessAt)}</dd></dl>
        <details><summary>{text("Source quality & exclusions", "数据质量与排除项")}</summary><p>{text("Received-row counters include repeated observations across batches; they are not unique-trade denominators.", "收到的数据行包含跨批次重复观测，不可作为唯一成交笔数的分母。")}</p><dl className={s.provenance}>{([
          ["source_input_row_count", "Received source rows", "收到的来源行"], ["source_rejected_row_count", "Rejected source rows", "被拒绝的来源行"], ["source_non_novel_row_count", "Rows at/below source watermark", "不超过数据水位的行"], ["duplicate_row_count", "Duplicate rows", "重复行"], ["rejected_row_count", "Rejected measurement rows", "被拒绝的统计行"], ["ambiguous_row_count", "Ambiguous rows", "歧义行"], ["conflicting_identity_count", "Conflicting identities", "冲突交易标识"],
        ] as const).map(([key, en, cn]) => <div key={key}><dt>{text(en, cn)}</dt><dd>{num(r.counters[key])}</dd></div>)}</dl></details>
      </section>
    </div>
  </div>;
}

export default function OptionsStatisticsView() {
  const { lang } = useLang();
  const copy = optionsWorkspaceCopy(lang);
  const stream = useFlowStream<unknown>("meta");
  const [root, setRoot] = useState("SPY");
  const [draft, setDraft] = useState("SPY");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const result = decodeObservedStatistics(stream.data, root, now);
  const zh = lang === "zh";
  return <section id="wpanel-statistics" className={s.workspace} data-options-ia-state="statistics-observed" aria-labelledby="wtab-cat-statistics">
    <header className={s.header}><div><span className={s.eyebrow}>{copy.statisticsEyebrow}</span><h1>{copy.statisticsTitle}</h1><p>{copy.statisticsDescription}</p></div>
      <form onSubmit={event => { event.preventDefault(); const value = draft.trim().toUpperCase(); if (/^[A-Z0-9.^=-]{1,16}$/.test(value)) setRoot(value); }}><label htmlFor="options-statistics-symbol">{zh ? "代码" : "Symbol"}</label><div><input id="options-statistics-symbol" value={draft} onChange={e => setDraft(e.target.value)} maxLength={16} pattern="[A-Za-z0-9.\^=\-]+" required autoCapitalize="characters" autoComplete="off" spellCheck={false} /><button type="submit">{zh ? "查看" : "View"}</button></div><small>{zh ? "当前显示" : "Showing"} {root}</small></form>
    </header>
    {stream.status === "loading" && !stream.data ? <p role="status">{copy.statisticsLoading}</p> : <OptionsStatisticsPanel result={result} lang={lang} transportStale={stream.stale} />}
    {stream.error && <p className={s.notice} role="status">{copy.statisticsUnavailable} <button onClick={stream.retry}>{zh ? "重试" : "Retry"}</button></p>}
  </section>;
}
