"use client";

import { useMemo } from "react";
import { useLang } from "@/lib/i18n";
import { formatValue, number, object, text, type Row, type FeedStatus } from "@/lib/sectorIntelligence";
import styles from "./SectorCentralDiscovery.module.css";

export type DiscoverySort = "source" | "return" | "participation";
export interface SectorCentralDiscoveryProps {
  rows: readonly Row[];
  status: FeedStatus;
  asOf: string | null;
  selected: string;
  query: string;
  sort: DiscoverySort;
  breadth: boolean;
  onQuery: (query: string) => void;
  onSort: (sort: DiscoverySort) => void;
  onSelect: (id: string) => void;
  onSources: () => void;
}
const COPY = {
  title: ["Find the leadership", "寻找领涨方向"],
  breadthTitle: ["See how widely gains are shared", "观察上涨的参与广度"],
  query: ["Find a sector", "搜索板块"],
  sort: ["Display order", "显示顺序"],
  source: ["Source order", "来源顺序"],
  return: ["1M return", "1个月收益"],
  participation: ["Advancing share", "上涨占比"],
  name: ["Sector", "板块"],
  trend: ["200-day trend", "200日趋势"],
  above: ["Above", "上方"], below: ["Below", "下方"], unknown: ["Not supplied", "未提供"],
  scope: ["Sector snapshots · not company entry signals", "板块快照 · 非个股入场信号"],
  sources: ["Sources", "来源"],
  gains: ["sectors gained over 1M", "个板块近1个月上涨"],
  observed: ["with observed returns", "个板块有收益数据"],
  advancing: ["advancing", "上涨"], declining: ["declining", "下跌"],
  population: ["Advancing/declining company population", "上涨/下跌公司样本"],
  dated: ["Source date", "来源日期"], unknownDate: ["Date unavailable", "日期不可用"],
  open: ["Open sector research", "打开板块研究"], selected: ["Selected", "已选择"],
  shown: ["sectors shown", "个板块已显示"],
  loading: ["Loading sector snapshots…", "正在加载板块快照…"],
  access: ["Sector snapshots require access.", "板块快照需要访问权限。"],
  unavailable: ["Sector snapshots are unavailable.", "板块快照暂不可用。"],
  noMatches: ["No sectors match this search.", "没有匹配的板块。"],
  clear: ["Clear search", "清除搜索"],
  noData: ["Missing observations stay blank, not zero.", "缺失观察保持为空，而不是零。"],
} as const;

const count = (v: unknown): number | null => {
  const n = number(v); return n !== null && n >= 0 && Number.isInteger(n) ? n : null;
};
const share = (v: unknown): number | null => {
  const n = number(v); return n !== null && n >= 0 && n <= 100 ? n : null;
};
export function discoveryRows(rows: readonly Row[], query: string, sort: DiscoverySort): Row[] {
  const q = query.normalize("NFKC").trim().toLowerCase();
  const found = rows.filter(row => [row.name, row.name_zh, row.ticker].some(value => text(value).normalize("NFKC").toLowerCase().includes(q)));
  if (sort === "source") return found;
  const measure = (row: Row) => sort === "return" ? number(object(row.heat).heat_1M) : share(object(row.heat).breadth_pct);
  return [...found].sort((a, b) => {
    const av = measure(a), bv = measure(b);
    return av === null && bv === null ? 0 : av === null ? 1 : bv === null ? -1 : bv - av;
  });
}

/** Presentation of the source's sector collection only. Never invents a sector/group join. */
export default function SectorCentralDiscovery(props: SectorCentralDiscoveryProps) {
  const { lang } = useLang();
  const t = (key: keyof typeof COPY) => COPY[key][lang === "zh" ? 1 : 0];
  const readyRows = props.status === "ready" ? props.rows : [];
  const visible = useMemo(() => props.status === "ready" ? discoveryRows(props.rows, props.query, props.sort) : [], [props.status, props.rows, props.query, props.sort]);
  const observed = readyRows.map(row => number(object(row.heat).heat_1M)).filter((value): value is number => value !== null);
  const positive = observed.filter(value => value > 0).length;
  const name = (row: Row) => text(lang === "zh" ? row.name_zh : row.name) || text(row.name);
  return <section className={styles.root} data-testid="sector-discovery">
    <header className={styles.header}>
      <div><p className={styles.scope}>{t("scope")}</p><h2>{t(props.breadth ? "breadthTitle" : "title")}</h2>
        <p className={styles.date}>{t("dated")}: {props.asOf || t("unknownDate")}</p></div>
      {observed.length > 0 && <div className={styles.summary}><strong>{positive}<span> / {observed.length}</span></strong><p>{t("gains")}</p></div>}
    </header>
    <div className={styles.controls}>
      <label>{t("query")}<input type="search" value={props.query} maxLength={60} onChange={event => props.onQuery(event.target.value)} /></label>
      <label>{t("sort")}<select value={props.sort} onChange={event => props.onSort(event.target.value as DiscoverySort)}>
        <option value="source">{t("source")}</option><option value="return">{t("return")}</option><option value="participation">{t("participation")}</option>
      </select></label>
      <span role="status">{visible.length} / {readyRows.length} {t("shown")}</span>
      <button type="button" onClick={event => { event.currentTarget.focus({ preventScroll: true }); props.onSources(); }}>{t("sources")}</button>
    </div>
    {props.status !== "ready" ? <div className={styles.empty} role="status">{t(props.status === "loading" ? "loading" : props.status === "access" ? "access" : "unavailable")}</div>
      : visible.length === 0 ? <div className={styles.empty} role="status"><p>{t(readyRows.length ? "noMatches" : "unavailable")}</p>{props.query && <button type="button" onClick={() => props.onQuery("")}>{t("clear")}</button>}</div>
      : props.breadth ? <div className={styles.breadthGrid}>{visible.map(row => {
        const heat = object(row.heat), pct = share(heat.breadth_pct), adv = count(heat.adv), dec = count(heat.dec);
        return <button type="button" key={text(row.id)} className={styles.breadthCard} data-sector-choice={text(row.id)} aria-pressed={props.selected === row.id}
          aria-label={`${t("open")}: ${name(row)}`} onClick={event => { event.currentTarget.focus({ preventScroll: true }); props.onSelect(text(row.id)); }}>
          <span className={styles.cardName}>{name(row)}<small>{text(row.ticker)}</small></span>
          <span className={styles.cardValue}>{formatValue(pct, 0, "%")}<small>{t("participation")}</small></span>
          <span className={styles.track} aria-hidden="true">{pct !== null && <span style={{ width: `${pct}%` }} />}</span>
          <span className={styles.coverage}>{formatValue(adv, 0)} {t("advancing")} · {formatValue(dec, 0)} {t("declining")}</span>
        </button>;
      })}</div> : <div className={styles.tableWrap}><table><thead><tr><th>{t("name")}</th><th>{t("return")}</th><th>{t("participation")}</th><th>{t("population")}</th><th>{t("trend")}</th></tr></thead>
        <tbody>{visible.map(row => { const heat = object(row.heat), momentum = object(row.momentum), value = number(heat.heat_1M);
          return <tr key={text(row.id)} aria-selected={props.selected === row.id}>
            <th scope="row"><button type="button" data-sector-choice={text(row.id)} onClick={event => { event.currentTarget.focus({ preventScroll: true }); props.onSelect(text(row.id)); }} aria-label={`${t("open")}: ${name(row)}`}>{name(row)}<small>{text(row.ticker)}</small></button></th>
            <td data-label={t("return")} data-sign={value === null || value === 0 ? undefined : value > 0 ? "up" : "down"}>{formatValue(value, 2, "%", true)}</td>
            <td data-label={t("participation")}>{formatValue(share(heat.breadth_pct), 0, "%")}</td>
            <td data-label={t("population")}>{formatValue(count(heat.adv), 0)} / {formatValue(count(heat.dec), 0)}</td>
            <td data-label={t("trend")}>{t(momentum.above_200d === true ? "above" : momentum.above_200d === false ? "below" : "unknown")}</td>
          </tr>;
        })}</tbody></table></div>}
    <p className={styles.note}>{t("noData")}</p>
  </section>;
}
