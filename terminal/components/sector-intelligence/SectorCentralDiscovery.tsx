"use client";

import { useMemo } from "react";
import { useLang } from "@/lib/i18n";
import {
  formatValue,
  number,
  object,
  text,
  type FeedStatus,
  type Row,
  type SectorCapBand,
  type SectorDiscoveryMode,
  type SectorMatrixTimeframe,
} from "@/lib/sectorIntelligence";
import SectorIndustryMatrix from "./SectorIndustryMatrix";
import styles from "./SectorCentralDiscovery.module.css";

export type DiscoverySort = "source" | "return" | "participation";
export interface SectorCentralDiscoveryProps {
  rows: readonly Row[];
  status: FeedStatus;
  asOf: string | null;
  selected: string;
  selectedSourceName: string;
  query: string;
  sort: DiscoverySort;
  breadth: boolean;
  mode: SectorDiscoveryMode;
  heatmapData: unknown;
  heatmapStatus: FeedStatus;
  heatmapAsOf: string | null;
  matrixTimeframe: SectorMatrixTimeframe;
  matrixIndustry: string;
  matrixBand: SectorCapBand | "";
  onQuery: (query: string) => void;
  onSort: (sort: DiscoverySort) => void;
  onMode: (mode: SectorDiscoveryMode) => void;
  onTimeframe: (timeframe: SectorMatrixTimeframe) => void;
  onMatrixCell: (industry: string, band: SectorCapBand) => void;
  onSelect: (id: string) => void;
  onOpenResearch: (id: string) => void;
  onSources: () => void;
}
const COPY = {
  title: ["Sector discovery", "板块发现"],
  breadthTitle: ["Market breadth", "市场广度"],
  marketRead: ["Market read", "市场解读"],
  table: ["Table", "表格"], matrix: ["Matrix", "矩阵"], representation: ["Discover representation", "发现视图"],
  query: ["Find a sector", "搜索板块"],
  sort: ["Display order", "显示顺序"],
  source: ["Source order", "来源顺序"],
  return: ["1M return", "1个月收益"],
  participation: ["Advancing share", "上涨占比"],
  name: ["Sector", "板块"],
  trend: ["200-day trend", "200日趋势"],
  above: ["Above", "上方"], below: ["Below", "下方"], unknown: ["Not supplied", "未提供"],
  scope: ["Exact sector snapshots; not company entry signals.", "精确板块快照；非个股入场信号。"],
  sources: ["Sources", "来源"],
  advancing: ["advancing", "上涨"], declining: ["declining", "下跌"],
  population: ["Advancing/declining company population", "上涨/下跌公司样本"],
  dated: ["Source date", "来源日期"], unknownDate: ["Date unavailable", "日期不可用"],
  open: ["Open sector intelligence", "打开板块情报"], selected: ["Selected sector", "所选板块"],
  shown: ["sectors shown", "个板块已显示"],
  loading: ["Loading sector snapshots…", "正在加载板块快照…"],
  access: ["Sector snapshots require access.", "板块快照需要访问权限。"],
  unavailable: ["Sector snapshots are unavailable.", "板块快照暂不可用。"],
  noMatches: ["No sectors match this search.", "没有匹配的板块。"],
  clear: ["Clear search", "清除搜索"],
  noData: ["Missing observations stay blank, not zero.", "缺失观察保持为空，而不是零。"],
  discoverUnavailable: ["A current leadership read is unavailable.", "当前领涨解读不可用。"],
  breadthUnavailable: ["A current participation read is unavailable.", "当前参与度解读不可用。"],
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

export function discoveryRead(rows: readonly Row[], lang: "en" | "zh"): string | null {
  const observed = rows.map((row, sourceOrder) => ({ row, sourceOrder, value: number(object(row.heat).heat_1M), breadth: share(object(row.heat).breadth_pct) }))
    .filter((item): item is typeof item & { value: number } => item.value !== null);
  if (!observed.length) return null;
  const leader = [...observed].sort((a, b) => b.value - a.value || a.sourceOrder - b.sourceOrder)[0];
  const localName = text(lang === "zh" ? leader.row.name_zh : leader.row.name) || text(leader.row.name);
  const majority = observed.filter(item => item.breadth !== null && item.breadth >= 50).length;
  return lang === "zh"
    ? `${localName}的1个月收益领先（${formatValue(leader.value, 2, "%", true)}）；${majority}/${observed.length}个板块有多数公司参与上涨。`
    : `${localName} leads 1M returns (${formatValue(leader.value, 2, "%", true)}); ${majority} of ${observed.length} observed sectors have majority participation.`;
}

export function breadthRead(rows: readonly Row[], lang: "en" | "zh"): string | null {
  const observed = rows.map((row, sourceOrder) => ({ row, sourceOrder, value: share(object(row.heat).breadth_pct) }))
    .filter((item): item is typeof item & { value: number } => item.value !== null);
  if (!observed.length) return null;
  const majority = observed.filter(item => item.value >= 50);
  const strongest = [...observed].sort((a, b) => b.value - a.value || a.sourceOrder - b.sourceOrder)[0];
  const localName = text(lang === "zh" ? strongest.row.name_zh : strongest.row.name) || text(strongest.row.name);
  if (majority.length === 1) return lang === "zh"
    ? `市场广度偏窄；${localName}是唯一多数公司上涨的板块。`
    : `Breadth is narrow; ${localName} is the only sector with majority participation.`;
  return lang === "zh"
    ? `${majority.length}/${observed.length}个板块有多数公司上涨；${localName}参与度最高（${formatValue(strongest.value, 0, "%")}）。`
    : `${majority.length} of ${observed.length} sectors have majority participation; ${localName} is highest at ${formatValue(strongest.value, 0, "%")}.`;
}

/** Presentation of exact owner collections only. Never invents a sector/group join. */
export default function SectorCentralDiscovery(props: SectorCentralDiscoveryProps) {
  const { lang } = useLang();
  const language = lang === "zh" ? "zh" : "en";
  const t = (key: keyof typeof COPY) => COPY[key][language === "zh" ? 1 : 0];
  const readyRows = props.status === "ready" ? props.rows : [];
  const visible = useMemo(() => props.status === "ready" ? discoveryRows(props.rows, props.query, props.sort) : [], [props.status, props.rows, props.query, props.sort]);
  const selectedRow = readyRows.find(row => row.id === props.selected) || null;
  const selectedName = selectedRow ? text(language === "zh" ? selectedRow.name_zh : selectedRow.name) || text(selectedRow.name) : "";
  const read = props.breadth ? breadthRead(readyRows, language) : discoveryRead(readyRows, language);
  const name = (row: Row) => text(language === "zh" ? row.name_zh : row.name) || text(row.name);

  if (!props.breadth && props.mode === "matrix") return <section className={styles.root} data-testid="sector-discovery">
    <div className={styles.representations} role="group" aria-label={t("representation")}>
      {(["table", "matrix"] as const).map(mode => <button type="button" key={mode} aria-pressed={props.mode === mode} onClick={() => props.onMode(mode)}>{t(mode)}</button>)}
    </div>
    <SectorIndustryMatrix data={props.heatmapData} status={props.heatmapStatus} asOf={props.heatmapAsOf}
      sectors={readyRows} selectedSector={props.selected} selectedSectorName={selectedName}
      selectedSectorSourceName={props.selectedSourceName}
      timeframe={props.matrixTimeframe} industry={props.matrixIndustry} band={props.matrixBand}
      onSector={props.onSelect} onTimeframe={props.onTimeframe} onCell={props.onMatrixCell}
      onOpenResearch={props.onOpenResearch} onSources={props.onSources} />
  </section>;

  return <section className={styles.root} data-testid="sector-discovery">
    {!props.breadth && <div className={styles.representations} role="group" aria-label={t("representation")}>
      {(["table", "matrix"] as const).map(mode => <button type="button" key={mode} aria-pressed={props.mode === mode} onClick={() => props.onMode(mode)}>{t(mode)}</button>)}
    </div>}
    <header className={styles.header}>
      <div><p className={styles.scope}>{t("scope")}</p><h2>{t(props.breadth ? "breadthTitle" : "title")}</h2>
        <p className={styles.date}>{t("dated")}: {props.asOf || t("unknownDate")}</p></div>
      <p className={styles.receipt}>{readyRows.length} {t("shown")}</p>
    </header>
    <div className={styles.answer}><span>{t("marketRead")}</span><p>{read || t(props.breadth ? "breadthUnavailable" : "discoverUnavailable")}</p></div>
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
          aria-label={`${t("selected")}: ${name(row)}`} onClick={event => { event.currentTarget.focus({ preventScroll: true }); props.onSelect(text(row.id)); }}>
          <span className={styles.cardName}>{name(row)}<small>{text(row.ticker)}</small></span>
          <span className={styles.cardValue}>{formatValue(pct, 0, "%")}<small>{t("participation")}</small></span>
          <span className={styles.track} aria-hidden="true">{pct !== null && <span style={{ width: `${pct}%` }} />}</span>
          <span className={styles.coverage}>{formatValue(adv, 0)} {t("advancing")} · {formatValue(dec, 0)} {t("declining")}</span>
        </button>;
      })}</div> : <div className={styles.tableWrap}><table><thead><tr><th>{t("name")}</th><th>{t("return")}</th><th>{t("participation")}</th><th>{t("population")}</th><th>{t("trend")}</th></tr></thead>
        <tbody>{visible.map(row => { const heat = object(row.heat), momentum = object(row.momentum), value = number(heat.heat_1M);
          return <tr key={text(row.id)} aria-selected={props.selected === row.id}>
            <th scope="row"><button type="button" data-sector-choice={text(row.id)} onClick={event => { event.currentTarget.focus({ preventScroll: true }); props.onSelect(text(row.id)); }} aria-label={`${t("selected")}: ${name(row)}`}>{name(row)}<small>{text(row.ticker)}</small></button></th>
            <td data-label={t("return")} data-sign={value === null || value === 0 ? undefined : value > 0 ? "up" : "down"}>{formatValue(value, 2, "%", true)}</td>
            <td data-label={t("participation")}>{formatValue(share(heat.breadth_pct), 0, "%")}</td>
            <td data-label={t("population")}>{formatValue(count(heat.adv), 0)} / {formatValue(count(heat.dec), 0)}</td>
            <td data-label={t("trend")}>{t(momentum.above_200d === true ? "above" : momentum.above_200d === false ? "below" : "unknown")}</td>
          </tr>;
        })}</tbody></table></div>}
    {selectedRow && <div className={styles.selectedBar} data-testid="sector-discovery-selection"><div><span>{t("selected")}</span><strong>{selectedName} · {text(selectedRow.ticker)}</strong></div><button type="button" data-sector-return-focus={`discover-open-${text(selectedRow.id)}`} onClick={event => { event.currentTarget.focus({ preventScroll: true }); props.onOpenResearch(text(selectedRow.id)); }}>{t("open")} →</button></div>}
    <p className={styles.note}>{t("noData")}</p>
  </section>;
}
