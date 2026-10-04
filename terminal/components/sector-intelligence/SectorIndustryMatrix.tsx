"use client";

import Link from "next/link";
import { useMemo, type CSSProperties } from "react";
import { useLang } from "@/lib/i18n";
import {
  companyHref,
  formatValue,
  number,
  object,
  readableOwnerEnvelope,
  text,
  type FeedStatus,
  type Row,
  type SectorCapBand,
  type SectorMatrixTimeframe,
} from "@/lib/sectorIntelligence";
import styles from "./SectorIndustryMatrix.module.css";

const SYMBOL = /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/;
export const MATRIX_TIMEFRAMES: readonly SectorMatrixTimeframe[] = ["1D", "1W", "MTD", "1M", "3M", "6M", "YTD", "1Y"];
export const MATRIX_CAP_BANDS: readonly { key: SectorCapBand; min: number; max: number | null }[] = [
  { key: "mega", min: 200_000_000_000, max: null },
  { key: "large", min: 50_000_000_000, max: 200_000_000_000 },
  { key: "mid", min: 10_000_000_000, max: 50_000_000_000 },
  { key: "smaller", min: 0, max: 10_000_000_000 },
];

export interface SectorMatrixTile {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  size: number;
  perf: Row;
  sourceOrder: number;
}
export interface SectorMatrixPopulation {
  status: "ready" | "empty" | "invalid";
  supplied: number;
  readable: number;
  tiles: SectorMatrixTile[];
}
export interface SectorMatrixCell {
  industry: string;
  band: SectorCapBand;
  members: SectorMatrixTile[];
  total: number;
  observed: number;
  advancing: number;
  declining: number;
  unchanged: number;
}
export interface SectorIndustryMatrixProps {
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
  onSector: (sector: string) => void;
  onTimeframe: (timeframe: SectorMatrixTimeframe) => void;
  onCell: (industry: string, band: SectorCapBand) => void;
  onOpenResearch: (sector: string) => void;
  onSources: () => void;
}

const COPY = {
  title: ["Industry × market cap", "行业 × 市值"],
  answer: ["Market read", "市场解读"],
  sector: ["Sector", "板块"],
  timeframe: ["Performance window", "表现周期"],
  sourceDate: ["Source date", "来源日期"],
  unknownDate: ["Date unavailable", "日期不可用"],
  names: ["names", "家公司"],
  industry: ["Industry", "行业"],
  up: ["up", "上涨"],
  observed: ["observed", "有观察"],
  unavailable: ["No observation", "无观察"],
  loading: ["Loading the industry matrix…", "正在加载行业矩阵…"],
  access: ["The industry matrix requires access.", "行业矩阵需要访问权限。"],
  feedUnavailable: ["Industry matrix data is unavailable.", "行业矩阵数据暂不可用。"],
  invalid: ["The exact heatmap population could not be read safely.", "无法安全读取精确热图样本。"],
  empty: ["No exact heatmap names match this sector label.", "没有热图名称与此板块标签精确匹配。"],
  noRead: ["No performance observations are available for this exact population and window.", "此精确样本与周期暂无表现观察。"],
  selected: ["Selected cell", "所选单元格"],
  choose: ["Choose a populated cell to inspect its companies.", "选择有数据的单元格以查看公司。"],
  marketCap: ["Market cap", "市值"],
  performance: ["Performance", "表现"],
  company: ["Company", "公司"],
  openCompany: ["Open company", "打开公司"],
  openResearch: ["Open sector intelligence", "打开板块情报"],
  sources: ["Review sources", "查看来源"],
  exactScope: ["Exact sector labels only; missing names are never inferred.", "仅使用精确板块标签；不会推断缺失名称。"],
  browseCells: ["Browse matrix cells", "浏览矩阵单元格"],
  cells: ["cells", "个单元格"],
  mega: ["≥ $200B", "≥ 2000亿美元"],
  large: ["$50–200B", "500–2000亿美元"],
  mid: ["$10–50B", "100–500亿美元"],
  smaller: ["< $10B", "< 100亿美元"],
} as const;

type Language = "en" | "zh";
const bandForSize = (size: number): SectorCapBand =>
  size >= 200_000_000_000 ? "mega" : size >= 50_000_000_000 ? "large" : size >= 10_000_000_000 ? "mid" : "smaller";

export function sectorMatrixPopulation(data: unknown, sectorName: string): SectorMatrixPopulation {
  if (!sectorName || !readableOwnerEnvelope("heatmap", data)) return { status: "invalid", supplied: 0, readable: 0, tiles: [] };
  const raw = object(data).tiles as unknown[];
  const supplied = raw.map(object).filter(row => row.sector === sectorName);
  if (!supplied.length) return { status: "empty", supplied: 0, readable: 0, tiles: [] };
  const tiles: SectorMatrixTile[] = [];
  for (const [sourceOrder, row] of supplied.entries()) {
    const ticker = text(row.t), name = text(row.name), sector = text(row.sector), industry = text(row.industry), size = number(row.size);
    const perf = object(row.perf);
    const valuesValid = Object.values(perf).every(value => number(value) !== null);
    if (!SYMBOL.test(ticker) || ticker.length > 20 || !name || !industry || sector !== sectorName || size === null || size <= 0 || !valuesValid) {
      return { status: "invalid", supplied: supplied.length, readable: tiles.length, tiles: [] };
    }
    tiles.push({ ticker, name, sector, industry, size, perf, sourceOrder });
  }
  if (new Set(tiles.map(tile => tile.ticker)).size !== tiles.length) {
    return { status: "invalid", supplied: supplied.length, readable: 0, tiles: [] };
  }
  return { status: "ready", supplied: supplied.length, readable: tiles.length, tiles };
}

export function sectorMatrixCells(tiles: readonly SectorMatrixTile[], timeframe: SectorMatrixTimeframe): SectorMatrixCell[] {
  const order: string[] = [], grouped = new Map<string, SectorMatrixTile[]>();
  for (const tile of tiles) {
    const key = `${tile.industry}\u0000${bandForSize(tile.size)}`;
    if (!grouped.has(key)) { grouped.set(key, []); order.push(key); }
    grouped.get(key)!.push(tile);
  }
  return order.map(key => {
    const members = grouped.get(key)!;
    const [industry, band] = key.split("\u0000") as [string, SectorCapBand];
    const values = members.map(member => number(member.perf[timeframe])).filter((value): value is number => value !== null);
    return {
      industry, band, members, total: members.length, observed: values.length,
      advancing: values.filter(value => value > 0).length,
      declining: values.filter(value => value < 0).length,
      unchanged: values.filter(value => value === 0).length,
    };
  });
}

export function sectorMatrixRead(cells: readonly SectorMatrixCell[], lang: Language): string | null {
  const industries = new Map<string, { industry: string; observed: number; advancing: number; sourceOrder: number }>();
  for (const cell of cells) {
    const current = industries.get(cell.industry) || { industry: cell.industry, observed: 0, advancing: 0, sourceOrder: industries.size };
    current.observed += cell.observed; current.advancing += cell.advancing; industries.set(cell.industry, current);
  }
  const ready = [...industries.values()].filter(item => item.observed > 0);
  if (!ready.length) return null;
  const ratio = (item: { observed: number; advancing: number }) => item.advancing / item.observed;
  const strongest = [...ready].sort((a, b) => ratio(b) - ratio(a) || b.observed - a.observed || a.sourceOrder - b.sourceOrder)[0];
  const weakest = [...ready].sort((a, b) => ratio(a) - ratio(b) || b.observed - a.observed || a.sourceOrder - b.sourceOrder)[0];
  if (strongest.industry === weakest.industry || ratio(strongest) === ratio(weakest)) {
    return lang === "zh"
      ? `${strongest.industry}有${strongest.advancing}/${strongest.observed}家公司上涨。`
      : `${strongest.industry} has ${strongest.advancing} of ${strongest.observed} observed names up.`;
  }
  return lang === "zh"
    ? `${strongest.industry}参与度最强（${strongest.advancing}/${strongest.observed}上涨）；${weakest.industry}最弱（${weakest.advancing}/${weakest.observed}上涨）。`
    : `${strongest.industry} has the broadest participation (${strongest.advancing}/${strongest.observed} up); ${weakest.industry} is weakest (${weakest.advancing}/${weakest.observed} up).`;
}

const capLabel = (value: number): string => value >= 1_000_000_000_000
  ? `$${(value / 1_000_000_000_000).toFixed(value >= 10_000_000_000_000 ? 0 : 2)}T`
  : `$${(value / 1_000_000_000).toFixed(value >= 100_000_000_000 ? 0 : 1)}B`;

export default function SectorIndustryMatrix(props: SectorIndustryMatrixProps) {
  const { lang } = useLang();
  const language: Language = lang === "zh" ? "zh" : "en";
  const t = (key: keyof typeof COPY) => COPY[key][language === "zh" ? 1 : 0];
  const population = useMemo(() => props.status === "ready" ? sectorMatrixPopulation(props.data, props.selectedSectorSourceName)
    : { status: "invalid" as const, supplied: 0, readable: 0, tiles: [] }, [props.status, props.data, props.selectedSectorSourceName]);
  const cells = useMemo(() => population.status === "ready" ? sectorMatrixCells(population.tiles, props.timeframe) : [], [population, props.timeframe]);
  const industries = useMemo(() => [...new Set(population.tiles.map(tile => tile.industry))], [population.tiles]);
  const cellMap = useMemo(() => new Map(cells.map(cell => [`${cell.industry}\u0000${cell.band}`, cell])), [cells]);
  const selectedCell = cellMap.get(`${props.industry}\u0000${props.band}`) || cells[0] || null;
  const read = sectorMatrixRead(cells, language);
  const sectorName = (row: Row) => text(language === "zh" ? row.name_zh : row.name) || text(row.name) || text(row.ticker);
  const statusCopy = props.status === "loading" ? t("loading") : props.status === "access" ? t("access")
    : props.status === "unavailable" ? t("feedUnavailable")
      : props.status !== "ready" || population.status === "invalid" ? t("invalid") : t("empty");
  const bandLabel = (band: SectorCapBand) => t(band);
  const cellButton = (cell: SectorMatrixCell, mobile = false) => {
    const participation = cell.observed ? Math.round(cell.advancing / cell.observed * 100) : null;
    return <button type="button" key={`${mobile ? "m" : "d"}-${cell.industry}-${cell.band}`}
      className={mobile ? styles.mobileCell : styles.cell}
      data-matrix-cell={`${cell.industry}::${cell.band}`} aria-pressed={selectedCell === cell}
      style={{ "--matrix-participation": `${participation || 0}%` } as CSSProperties}
      onClick={() => props.onCell(cell.industry, cell.band)}>
      {mobile && <span className={styles.mobileCellName}>{cell.industry}<small>{bandLabel(cell.band)}</small></span>}
      <strong>{cell.observed ? `${cell.advancing}/${cell.observed}` : "—"}</strong>
      <span>{cell.observed ? t("up") : t("unavailable")}</span><small>{cell.total} {t("names")}</small>
    </button>;
  };

  return <section className={styles.root} data-testid="sector-industry-matrix">
    <header className={styles.header}>
      <div><h2>{props.selectedSectorName || t("title")}</h2><p>{t("title")}</p></div>
      <p className={styles.receipt}>{props.asOf || t("unknownDate")} · {population.status === "ready" ? population.tiles.length : 0} {t("names")} · {props.timeframe}</p>
    </header>
    <div className={styles.answer} data-testid="matrix-answer"><span>{t("answer")}</span><p>{read || t("noRead")}</p></div>
    <div className={styles.controls}>
      <label>{t("sector")}<select aria-label={t("sector")} value={props.selectedSector} onChange={event => props.onSector(event.target.value)}>
        {props.sectors.map(row => <option key={text(row.id)} value={text(row.id)}>{sectorName(row)} · {text(row.ticker)}</option>)}
      </select></label>
      <label>{t("timeframe")}<select aria-label={t("timeframe")} value={props.timeframe} onChange={event => props.onTimeframe(event.target.value as SectorMatrixTimeframe)}>
        {MATRIX_TIMEFRAMES.map(timeframe => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
      </select></label>
      <button type="button" onClick={props.onSources}>{t("sources")} →</button>
    </div>

    {props.status !== "ready" || population.status !== "ready" ? <div className={styles.empty} role="status"><p>{statusCopy}</p><button type="button" onClick={props.onSources}>{t("sources")} →</button></div>
      : <div className={styles.layout}>
        <div className={styles.matrixPanel}>
          <div className={styles.matrix} role="table" data-testid="matrix-grid" aria-label={`${props.selectedSectorName} ${t("title")}`}>
            <div className={styles.corner} role="columnheader">{t("industry")}</div>
            {MATRIX_CAP_BANDS.map(item => <div key={item.key} className={styles.columnHead} role="columnheader">{bandLabel(item.key)}</div>)}
            {industries.map(industry => <div key={industry} className={styles.matrixRow} role="row">
              <div className={styles.rowHead} role="rowheader">{industry}</div>
              {MATRIX_CAP_BANDS.map(item => {
                const cell = cellMap.get(`${industry}\u0000${item.key}`);
                return cell ? cellButton(cell) : <span key={`${industry}-${item.key}`} className={styles.emptyCell} aria-label={`${industry} ${bandLabel(item.key)}: 0 ${t("names")}`}>—</span>;
              })}
            </div>)}
          </div>
          <details className={styles.mobileMatrixDisclosure} data-testid="matrix-mobile-disclosure">
            <summary>{t("browseCells")}<span>{cells.length} {t("cells")}</span></summary>
            <div className={styles.mobileMatrix} data-testid="matrix-mobile-list" aria-label={`${props.selectedSectorName} ${t("title")}`}>
              {cells.map(cell => cellButton(cell, true))}
            </div>
          </details>
        </div>
        <aside className={styles.inspector} data-testid="matrix-inspector">
          {!selectedCell ? <><span>{t("selected")}</span><p>{t("choose")}</p></> : <>
            <span>{t("selected")}</span><h3>{selectedCell.industry}</h3><p className={styles.band}>{bandLabel(selectedCell.band)} · {selectedCell.total} {t("names")} · {selectedCell.observed} {t("observed")}</p>
            <div className={styles.memberList}>
              {selectedCell.members.map(member => {
                const href = companyHref(member.ticker), value = number(member.perf[props.timeframe]);
                return href ? <Link key={member.ticker} href={href} aria-label={`${t("openCompany")}: ${member.name}`}>
                  <span><strong>{member.ticker}</strong><small>{member.name}</small></span>
                  <span><strong data-sign={value === null || value === 0 ? undefined : value > 0 ? "up" : "down"}>{formatValue(value, 2, "%", true)}</strong><small>{capLabel(member.size)}</small></span>
                </Link> : null;
              })}
            </div>
            <button type="button" data-sector-return-focus={`matrix-open-${props.selectedSector}`} onClick={event => { event.currentTarget.focus({ preventScroll: true }); props.onOpenResearch(props.selectedSector); }}>{t("openResearch")} →</button>
          </>}
        </aside>
      </div>}
    <p className={styles.note}>{t("exactScope")}</p>
  </section>;
}
