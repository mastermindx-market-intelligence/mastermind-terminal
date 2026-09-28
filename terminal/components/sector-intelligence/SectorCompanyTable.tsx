"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useLang } from "@/lib/i18n";
import {
  companyHref,
  formatValue,
  number,
  text,
  type FeedStatus,
  type Row,
  type SectorCapBand,
  type SectorCompanyTableSort,
  type SectorMatrixTimeframe,
} from "@/lib/sectorIntelligence";
import { sectorCapBandForSize } from "./SectorCompanyHeatmap";
import {
  MATRIX_CAP_BANDS,
  MATRIX_TIMEFRAMES,
  sectorMatrixPopulation,
  type SectorMatrixTile,
} from "./SectorIndustryMatrix";
import styles from "./SectorCompanyTable.module.css";

export interface SectorCompanyTableProps {
  data: unknown;
  status: FeedStatus;
  asOf: string | null;
  sectors: readonly Row[];
  selectedSector: string;
  selectedSectorName: string;
  selectedSectorSourceName: string;
  timeframe: SectorMatrixTimeframe;
  industry: string;
  band: SectorCapBand | "";
  selectedCompany: string;
  query: string;
  sort: SectorCompanyTableSort;
  onSector: (sector: string) => void;
  onTimeframe: (timeframe: SectorMatrixTimeframe) => void;
  onIndustry: (industry: string) => void;
  onBand: (band: SectorCapBand | "") => void;
  onCompany: (ticker: string) => void;
  onQuery: (query: string) => void;
  onSort: (sort: SectorCompanyTableSort) => void;
  onClearFilters: () => void;
  onOpenResearch: (sector: string) => void;
  onSources: () => void;
}

const COPY = {
  title: ["Company table", "公司表格"],
  subtitle: ["Exact companies in the selected sector", "所选板块的精确公司样本"],
  marketRead: ["Market read", "市场解读"],
  sector: ["Sector", "板块"],
  timeframe: ["Performance window", "表现周期"],
  industry: ["Industry", "行业"],
  allIndustries: ["All industries", "全部行业"],
  capBand: ["Market-cap band", "市值区间"],
  allBands: ["All market caps", "全部市值"],
  search: ["Find a company", "搜索公司"],
  sort: ["Display order", "显示顺序"],
  sourceOrder: ["Source order", "来源顺序"],
  performanceOrder: ["Performance", "表现"],
  marketCapOrder: ["Market cap", "市值"],
  tickerOrder: ["Ticker", "代码"],
  company: ["Company", "公司"],
  performance: ["Performance", "表现"],
  marketCap: ["Market cap", "市值"],
  shown: ["shown", "已显示"],
  selected: ["Selected company", "所选公司"],
  hiddenSelected: ["Selected company is outside the current filters.", "所选公司不在当前筛选范围内。"],
  openCompany: ["Open company intelligence", "打开公司情报"],
  openSector: ["Open sector intelligence", "打开板块情报"],
  sources: ["Review sources", "查看来源"],
  sourceDate: ["Source date", "来源日期"],
  unknownDate: ["Date unavailable", "日期不可用"],
  names: ["names", "家公司"],
  observed: ["observed", "有观察"],
  loading: ["Loading the company table…", "正在加载公司表格…"],
  access: ["The company table requires access.", "公司表格需要访问权限。"],
  unavailable: ["Company table data is unavailable.", "公司表格数据暂不可用。"],
  invalid: ["The exact company population could not be read safely.", "无法安全读取精确公司样本。"],
  empty: ["No exact companies match the current filters.", "当前筛选条件下没有精确匹配的公司。"],
  clear: ["Clear filters", "清除筛选"],
  noRead: ["Performance observations are unavailable for this exact scope and window.", "此精确范围与周期暂无表现观察。"],
  exactScope: ["This table uses the same exact population, filters and performance window as Heatmap and Matrix.", "此表格与热图和矩阵使用相同的精确样本、筛选条件和表现周期。"],
  mega: ["≥ $200B", "≥ 2000亿美元"],
  large: ["$50–200B", "500–2000亿美元"],
  mid: ["$10–50B", "100–500亿美元"],
  smaller: ["< $10B", "< 100亿美元"],
} as const;

type Language = "en" | "zh";

const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();

export function sectorCompanyTableRows(
  population: readonly SectorMatrixTile[],
  timeframe: SectorMatrixTimeframe,
  query = "",
  industry = "",
  band: SectorCapBand | "" = "",
  sort: SectorCompanyTableSort = "source",
): SectorMatrixTile[] {
  const q = normalize(query);
  const found = population.filter(tile => (!industry || tile.industry === industry)
    && (!band || sectorCapBandForSize(tile.size) === band)
    && (!q || [tile.ticker, tile.name, tile.industry].some(value => normalize(value).includes(q))));
  if (sort === "source") return [...found].sort((a, b) => a.sourceOrder - b.sourceOrder);
  if (sort === "ticker") return [...found].sort((a, b) => a.ticker.localeCompare(b.ticker, "en") || a.sourceOrder - b.sourceOrder);
  if (sort === "marketcap") return [...found].sort((a, b) => b.size - a.size || a.sourceOrder - b.sourceOrder);
  return [...found].sort((a, b) => {
    const av = number(a.perf[timeframe]), bv = number(b.perf[timeframe]);
    if (av === null && bv === null) return a.sourceOrder - b.sourceOrder;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av || a.sourceOrder - b.sourceOrder;
  });
}

export function sectorCompanyTableRead(rows: readonly SectorMatrixTile[], timeframe: SectorMatrixTimeframe, lang: Language): string | null {
  const observed = rows.map((tile, order) => ({ tile, order, value: number(tile.perf[timeframe]) }))
    .filter((item): item is typeof item & { value: number } => item.value !== null);
  if (!observed.length) return null;
  const leader = [...observed].sort((a, b) => b.value - a.value || a.order - b.order)[0];
  const advancing = observed.filter(item => item.value > 0).length;
  const largest = [...rows].sort((a, b) => b.size - a.size || a.sourceOrder - b.sourceOrder)[0];
  if (!leader || !largest) return null;
  return lang === "zh"
    ? `${leader.tile.ticker}在${timeframe}表现领先（${formatValue(leader.value, 2, "%", true)}）；${advancing}/${observed.length}家有观察公司上涨。${largest.ticker}是此范围市值最大的公司。`
    : `${leader.tile.ticker} leads ${timeframe} performance (${formatValue(leader.value, 2, "%", true)}); ${advancing} of ${observed.length} observed names are up. ${largest.ticker} is the largest company in scope.`;
}

const capLabel = (value: number): string => value >= 1_000_000_000_000
  ? `$${(value / 1_000_000_000_000).toFixed(value >= 10_000_000_000_000 ? 0 : 2)}T`
  : `$${(value / 1_000_000_000).toFixed(value >= 100_000_000_000 ? 0 : 1)}B`;

export default function SectorCompanyTable(props: SectorCompanyTableProps) {
  const { lang } = useLang();
  const language: Language = lang === "zh" ? "zh" : "en";
  const t = (key: keyof typeof COPY) => COPY[key][language === "zh" ? 1 : 0];
  const population = useMemo(() => props.status === "ready"
    ? sectorMatrixPopulation(props.data, props.selectedSectorSourceName)
    : { status: "invalid" as const, supplied: 0, readable: 0, tiles: [] }, [props.status, props.data, props.selectedSectorSourceName]);
  const rows = useMemo(() => population.status === "ready"
    ? sectorCompanyTableRows(population.tiles, props.timeframe, props.query, props.industry, props.band, props.sort)
    : [], [population, props.timeframe, props.query, props.industry, props.band, props.sort]);
  const industries = useMemo(() => population.status === "ready" ? [...new Set(population.tiles.map(tile => tile.industry))] : [], [population]);
  const selectedExact = population.status === "ready" ? population.tiles.find(tile => tile.ticker === props.selectedCompany) || null : null;
  const selected = selectedExact || rows[0] || null;
  const selectedVisible = !!selected && rows.some(tile => tile.ticker === selected.ticker);
  const read = sectorCompanyTableRead(rows, props.timeframe, language);
  const sectorName = (row: Row) => text(language === "zh" ? row.name_zh : row.name) || text(row.name) || text(row.ticker);
  const bandLabel = (band: SectorCapBand) => t(band);
  const statusCopy = props.status === "loading" ? t("loading") : props.status === "access" ? t("access")
    : props.status === "unavailable" ? t("unavailable")
      : props.status !== "ready" || population.status === "invalid" ? t("invalid") : t("empty");
  const clearFilters = props.onClearFilters;

  return <section className={styles.root} data-testid="sector-company-table">
    <header className={styles.header}>
      <div><h2>{props.selectedSectorName || props.selectedSector.toUpperCase()}</h2><p>{t("title")} · {t("subtitle")}</p></div>
      <p className={styles.receipt}>{props.asOf || t("unknownDate")} · {population.status === "ready" ? population.tiles.length : 0} {t("names")} · {props.timeframe}</p>
    </header>
    <div className={styles.answer} data-testid="company-table-answer"><span>{t("marketRead")}</span><p>{read || t("noRead")}</p></div>
    <div className={styles.controls}>
      <label>{t("sector")}<select value={props.selectedSector} onChange={event => props.onSector(event.target.value)}>
        {props.sectors.map(row => <option key={text(row.id)} value={text(row.id)}>{sectorName(row)} · {text(row.ticker)}</option>)}
      </select></label>
      <label>{t("timeframe")}<select value={props.timeframe} onChange={event => props.onTimeframe(event.target.value as SectorMatrixTimeframe)}>
        {MATRIX_TIMEFRAMES.map(timeframe => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
      </select></label>
      <label>{t("industry")}<select value={props.industry} onChange={event => props.onIndustry(event.target.value)}>
        <option value="">{t("allIndustries")}</option>{industries.map(industry => <option key={industry} value={industry}>{industry}</option>)}
      </select></label>
      <label>{t("capBand")}<select value={props.band} onChange={event => props.onBand(event.target.value as SectorCapBand | "")}>
        <option value="">{t("allBands")}</option>{MATRIX_CAP_BANDS.map(item => <option key={item.key} value={item.key}>{bandLabel(item.key)}</option>)}
      </select></label>
      <label>{t("search")}<input type="search" value={props.query} maxLength={60} onChange={event => props.onQuery(event.target.value)} /></label>
      <label>{t("sort")}<select value={props.sort} onChange={event => props.onSort(event.target.value as SectorCompanyTableSort)}>
        <option value="source">{t("sourceOrder")}</option><option value="performance">{t("performanceOrder")}</option>
        <option value="marketcap">{t("marketCapOrder")}</option><option value="ticker">{t("tickerOrder")}</option>
      </select></label>
      <span role="status">{rows.length} / {population.status === "ready" ? population.tiles.length : 0} {t("shown")}</span>
      <button type="button" onClick={props.onSources}>{t("sources")} →</button>
    </div>

    {selected && <aside className={styles.selectedBar} data-testid="company-table-selection">
      <div><span>{t("selected")}</span><strong>{selected.ticker} · {selected.name}</strong><small>{selected.industry} · {capLabel(selected.size)}</small>
        {selectedExact && !selectedVisible && <em>{t("hiddenSelected")}</em>}</div>
      <div>{companyHref(selected.ticker) && <Link href={companyHref(selected.ticker)!}>{t("openCompany")} →</Link>}
        <button type="button" data-sector-return-focus={`table-open-${props.selectedSector}`} onClick={event => { event.currentTarget.focus({ preventScroll: true }); props.onOpenResearch(props.selectedSector); }}>{t("openSector")} →</button></div>
    </aside>}

    {props.status !== "ready" || population.status !== "ready" ? <div className={styles.empty} role="status"><p>{statusCopy}</p><button type="button" onClick={props.onSources}>{t("sources")} →</button></div>
      : rows.length === 0 ? <div className={styles.empty} role="status"><p>{t("empty")}</p><button type="button" onClick={clearFilters}>{t("clear")}</button></div>
        : <div className={styles.tableWrap}><table><thead><tr>
          <th>{t("company")}</th><th>{t("industry")}</th><th>{t("capBand")}</th><th>{t("marketCap")}</th><th>{props.timeframe} {t("performance")}</th>
        </tr></thead><tbody>{rows.map(tile => {
          const value = number(tile.perf[props.timeframe]);
          return <tr key={tile.ticker} aria-selected={selected?.ticker === tile.ticker} data-company-table-row={tile.ticker}>
            <th scope="row"><button type="button" onClick={event => { event.currentTarget.focus({ preventScroll: true }); props.onCompany(tile.ticker); }}>
              <strong>{tile.ticker}</strong><small>{tile.name}</small></button></th>
            <td data-label={t("industry")}>{tile.industry}</td>
            <td data-label={t("capBand")}>{bandLabel(sectorCapBandForSize(tile.size))}</td>
            <td data-label={t("marketCap")}>{capLabel(tile.size)}</td>
            <td data-label={`${props.timeframe} ${t("performance")}`} data-sign={value === null || value === 0 ? undefined : value > 0 ? "up" : "down"}>{formatValue(value, 2, "%", true)}</td>
          </tr>;
        })}</tbody></table></div>}
    <p className={styles.note}>{t("exactScope")}</p>
  </section>;
}
