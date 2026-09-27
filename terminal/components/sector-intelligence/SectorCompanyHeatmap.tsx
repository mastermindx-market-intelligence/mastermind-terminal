"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLang } from "@/lib/i18n";
import {
  companyHref,
  formatValue,
  number,
  text,
  type FeedStatus,
  type Row,
  type SectorCapBand,
  type SectorMatrixTimeframe,
} from "@/lib/sectorIntelligence";
import {
  MATRIX_CAP_BANDS,
  MATRIX_TIMEFRAMES,
  sectorMatrixPopulation,
  type SectorMatrixTile,
} from "./SectorIndustryMatrix";
import styles from "./SectorCompanyHeatmap.module.css";

const CANVAS_W = 1000;
const CANVAS_H = 620;
const INDUSTRY_HEADER = 28;
const BLOCK_GAP = 3;
const TILE_GAP = 1.5;

interface Rect { x: number; y: number; w: number; h: number }
interface Weighted<T> { value: number; item: T; order: number }
export interface SectorHeatmapCompanyRect extends Rect {
  tile: SectorMatrixTile;
  value: number | null;
  industry: string;
}
export interface SectorHeatmapIndustryRect extends Rect {
  industry: string;
  headerHeight: number;
  totalSize: number;
  total: number;
  observed: number;
  advancing: number;
  sourceOrder: number;
  companies: SectorHeatmapCompanyRect[];
}
export interface SectorHeatmapLayout {
  industries: SectorHeatmapIndustryRect[];
  visible: SectorMatrixTile[];
  domain: number;
  observed: number;
}

export interface SectorCompanyHeatmapProps {
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
  onSector: (sector: string) => void;
  onTimeframe: (timeframe: SectorMatrixTimeframe) => void;
  onIndustry: (industry: string) => void;
  onBand: (band: SectorCapBand | "") => void;
  onCompany: (ticker: string) => void;
  onOpenResearch: (sector: string) => void;
  onSources: () => void;
}

const COPY = {
  title: ["Company heatmap", "公司热图"],
  subtitle: ["Area = market cap · color = performance", "面积 = 市值 · 颜色 = 表现"],
  marketRead: ["Market read", "市场解读"],
  sector: ["Sector", "板块"],
  timeframe: ["Performance window", "表现周期"],
  industry: ["Industry", "行业"],
  allIndustries: ["All industries", "全部行业"],
  capBand: ["Market-cap band", "市值区间"],
  allBands: ["All market caps", "全部市值"],
  clearScope: ["Clear scope", "清除范围"],
  sources: ["Review sources", "查看来源"],
  sourceDate: ["Source date", "来源日期"],
  unknownDate: ["Date unavailable", "日期不可用"],
  names: ["names", "家公司"],
  observed: ["observed", "有观察"],
  up: ["up", "上涨"],
  selected: ["Selected company", "所选公司"],
  largest: ["Largest company in scope", "范围内最大公司"],
  marketCap: ["Market cap", "市值"],
  performance: ["Performance", "表现"],
  openCompany: ["Open company intelligence", "打开公司情报"],
  openSector: ["Open sector intelligence", "打开板块情报"],
  browseMap: ["Browse company heatmap", "浏览公司热图"],
  loading: ["Loading the company heatmap…", "正在加载公司热图…"],
  access: ["The company heatmap requires access.", "公司热图需要访问权限。"],
  unavailable: ["Company heatmap data is unavailable.", "公司热图数据暂不可用。"],
  invalid: ["The exact heatmap population could not be read safely.", "无法安全读取精确热图样本。"],
  empty: ["No exact names match this scope.", "此范围没有精确匹配的公司。"],
  noRead: ["Performance observations are unavailable for this exact scope and window.", "此精确范围与周期暂无表现观察。"],
  exactScope: ["Exact owner labels only. Filters never rescale color; the smallest industry blocks receive a visibility floor so no source name disappears.", "仅使用精确来源标签。筛选不会重设颜色；最小行业区块采用可见性下限，确保来源公司不会消失。"],
  negative: ["Negative", "下跌"],
  flat: ["Flat / unavailable", "持平 / 不可用"],
  positive: ["Positive", "上涨"],
  mega: ["≥ $200B", "≥ 2000亿美元"],
  large: ["$50–200B", "500–2000亿美元"],
  mid: ["$10–50B", "100–500亿美元"],
  smaller: ["< $10B", "< 100亿美元"],
} as const;

type Language = "en" | "zh";

export function sectorCapBandForSize(size: number): SectorCapBand {
  return size >= 200_000_000_000 ? "mega"
    : size >= 50_000_000_000 ? "large"
      : size >= 10_000_000_000 ? "mid" : "smaller";
}

function worstAspect(sum: number, max: number, min: number, short: number): number {
  const sum2 = sum * sum, short2 = short * short;
  return Math.max((short2 * max) / sum2, sum2 / (short2 * min));
}

function squarifyRecurse<T>(items: Weighted<T>[], rect: Rect, total: number, result: Array<Rect & { item: T }>): void {
  if (!items.length || rect.w <= 0.5 || rect.h <= 0.5 || total <= 0) return;
  if (items.length === 1) { result.push({ ...rect, item: items[0].item }); return; }
  const scale = rect.w * rect.h / total;
  const areas = items.map(item => Math.max(item.value * scale, 1e-9));
  const short = Math.min(rect.w, rect.h);
  let count = 1, sum = areas[0], max = areas[0], min = areas[0];
  let worst = worstAspect(sum, max, min, short);
  for (let index = 1; index < areas.length; index += 1) {
    const nextSum = sum + areas[index], nextMax = Math.max(max, areas[index]), nextMin = Math.min(min, areas[index]);
    const nextWorst = worstAspect(nextSum, nextMax, nextMin, short);
    if (nextWorst > worst) break;
    count = index + 1; sum = nextSum; max = nextMax; min = nextMin; worst = nextWorst;
  }
  const thickness = sum / short, wide = rect.w >= rect.h;
  let position = wide ? rect.y : rect.x;
  for (let index = 0; index < count; index += 1) {
    const length = areas[index] / thickness;
    result.push(wide
      ? { x: rect.x, y: position, w: thickness, h: length, item: items[index].item }
      : { x: position, y: rect.y, w: length, h: thickness, item: items[index].item });
    position += length;
  }
  const rest = items.slice(count), restTotal = rest.reduce((sumValue, item) => sumValue + item.value, 0);
  squarifyRecurse(rest, wide
    ? { x: rect.x + thickness, y: rect.y, w: rect.w - thickness, h: rect.h }
    : { x: rect.x, y: rect.y + thickness, w: rect.w, h: rect.h - thickness }, restTotal, result);
}

export function squarifyItems<T>(items: readonly Weighted<T>[], rect: Rect): Array<Rect & { item: T }> {
  if (!items.length || rect.w <= 0 || rect.h <= 0) return [];
  const positive = items.map(item => ({ ...item, value: item.value > 0 ? item.value : 1 }));
  positive.sort((a, b) => b.value - a.value || a.order - b.order);
  const result: Array<Rect & { item: T }> = [];
  squarifyRecurse(positive, rect, positive.reduce((sum, item) => sum + item.value, 0), result);
  return result;
}

export function sectorHeatmapDomain(tiles: readonly SectorMatrixTile[], timeframe: SectorMatrixTimeframe): number {
  const values = tiles.map(tile => number(tile.perf[timeframe])).filter((value): value is number => value !== null);
  if (!values.length) return 1;
  const max = Math.max(...values.map(value => Math.abs(value)));
  return Math.max(1, Math.ceil(max * 10) / 10);
}

export function sectorHeatmapRead(tiles: readonly SectorMatrixTile[], timeframe: SectorMatrixTimeframe, lang: Language): string | null {
  if (!tiles.length) return null;
  const totalCap = tiles.reduce((sum, tile) => sum + tile.size, 0);
  const industries = new Map<string, { name: string; size: number; observed: number; advancing: number; order: number }>();
  for (const tile of tiles) {
    const current = industries.get(tile.industry) || { name: tile.industry, size: 0, observed: 0, advancing: 0, order: industries.size };
    current.size += tile.size;
    const value = number(tile.perf[timeframe]);
    if (value !== null) { current.observed += 1; current.advancing += value > 0 ? 1 : 0; }
    industries.set(tile.industry, current);
  }
  const groups = [...industries.values()];
  const largest = [...groups].sort((a, b) => b.size - a.size || a.order - b.order)[0];
  const observed = groups.filter(group => group.observed > 0);
  if (!largest || !observed.length || totalCap <= 0) return null;
  const broadest = [...observed].sort((a, b) => b.advancing / b.observed - a.advancing / a.observed || b.observed - a.observed || a.order - b.order)[0];
  const share = Math.round(largest.size / totalCap * 100);
  if (largest.name === broadest.name) return lang === "zh"
    ? `${largest.name}占此范围市值的${share}%，且${broadest.advancing}/${broadest.observed}家公司上涨。`
    : `${largest.name} holds ${share}% of market cap and has ${broadest.advancing} of ${broadest.observed} observed names up.`;
  return lang === "zh"
    ? `${largest.name}占此范围市值的${share}%；${broadest.name}参与度最强（${broadest.advancing}/${broadest.observed}上涨）。`
    : `${largest.name} holds ${share}% of market cap; ${broadest.name} has the broadest participation (${broadest.advancing}/${broadest.observed} up).`;
}

export function sectorHeatmapLayout(
  population: readonly SectorMatrixTile[],
  timeframe: SectorMatrixTimeframe,
  industryFilter = "",
  bandFilter: SectorCapBand | "" = "",
): SectorHeatmapLayout {
  const domain = sectorHeatmapDomain(population, timeframe);
  const visible = population.filter(tile => (!industryFilter || tile.industry === industryFilter)
    && (!bandFilter || sectorCapBandForSize(tile.size) === bandFilter));
  const groups = new Map<string, { industry: string; tiles: SectorMatrixTile[]; sourceOrder: number }>();
  for (const tile of visible) {
    if (!groups.has(tile.industry)) groups.set(tile.industry, { industry: tile.industry, tiles: [], sourceOrder: tile.sourceOrder });
    groups.get(tile.industry)!.tiles.push(tile);
  }
  const grouped = [...groups.values()];
  const totalVisibleSize = visible.reduce((sum, tile) => sum + tile.size, 0);
  // Layout-only 0.1% visibility floor: without it an exact but very small industry
  // can fall below one display pixel and disappear from the reachable population.
  // The source size remains unchanged in receipts, reads, filters and inspectors.
  const industryVisibilityFloor = totalVisibleSize * 0.001;
  const industryItems: Weighted<{ industry: string; tiles: SectorMatrixTile[]; sourceOrder: number }>[] = grouped.map(group => ({
    value: Math.max(group.tiles.reduce((sum, tile) => sum + tile.size, 0), industryVisibilityFloor), item: group, order: group.sourceOrder,
  }));
  const industryRects = squarifyItems(industryItems, { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
  const industries = industryRects.map(rect => {
    const group = rect.item, values = group.tiles.map(tile => number(tile.perf[timeframe])).filter((value): value is number => value !== null);
    // Tiny source industries still retain their complete company population. A fixed
    // 28px title band used to consume the whole smallest block and silently drop one
    // exact owner row. Demote chrome before data instead of shrinking the denominator.
    const headerHeight = rect.h >= 40 ? INDUSTRY_HEADER : 0;
    const minimumInner = 0.6;
    const padding = Math.min(BLOCK_GAP,
      Math.max(0, (rect.w - minimumInner) / 2),
      Math.max(0, (rect.h - headerHeight - minimumInner) / 2));
    const inner = {
      x: rect.x + padding,
      y: rect.y + headerHeight + padding,
      w: Math.max(0, rect.w - padding * 2),
      h: Math.max(0, rect.h - headerHeight - padding * 2),
    };
    const companies = squarifyItems(group.tiles.map(tile => ({ value: tile.size, item: tile, order: tile.sourceOrder })), inner)
      .map(company => {
        const inset = Math.min(TILE_GAP / 2, company.w / 4, company.h / 4);
        return {
          x: company.x + inset, y: company.y + inset,
          w: Math.max(0, company.w - inset * 2), h: Math.max(0, company.h - inset * 2),
          tile: company.item, value: number(company.item.perf[timeframe]), industry: group.industry,
        };
      });
    return {
      x: rect.x, y: rect.y, w: rect.w, h: rect.h, industry: group.industry, headerHeight,
      totalSize: group.tiles.reduce((sum, tile) => sum + tile.size, 0), total: group.tiles.length,
      observed: values.length, advancing: values.filter(value => value > 0).length,
      sourceOrder: group.sourceOrder, companies,
    };
  });
  return { industries, visible, domain, observed: visible.filter(tile => number(tile.perf[timeframe]) !== null).length };
}

const capLabel = (value: number): string => value >= 1_000_000_000_000
  ? `$${(value / 1_000_000_000_000).toFixed(value >= 10_000_000_000_000 ? 0 : 2)}T`
  : `$${(value / 1_000_000_000).toFixed(value >= 100_000_000_000 ? 0 : 1)}B`;

function colorStyle(value: number | null, domain: number): CSSProperties {
  if (value === null) return { background: "var(--panel-2)" };
  if (value === 0) return { background: "color-mix(in srgb, var(--text-2) 10%, var(--panel))" };
  const intensity = Math.round(22 + Math.min(Math.abs(value) / domain, 1) * 70);
  return { background: `color-mix(in srgb, ${value > 0 ? "var(--up)" : "var(--down)"} ${intensity}%, var(--panel))` };
}

export default function SectorCompanyHeatmap(props: SectorCompanyHeatmapProps) {
  const { lang } = useLang();
  const language: Language = lang === "zh" ? "zh" : "en";
  const t = (key: keyof typeof COPY) => COPY[key][language === "zh" ? 1 : 0];
  const [mapOpen, setMapOpen] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 761px)");
    const sync = () => setMapOpen(media.matches);
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const population = useMemo(() => props.status === "ready"
    ? sectorMatrixPopulation(props.data, props.selectedSectorSourceName)
    : { status: "invalid" as const, supplied: 0, readable: 0, tiles: [] }, [props.status, props.data, props.selectedSectorSourceName]);
  const layout = useMemo(() => population.status === "ready"
    ? sectorHeatmapLayout(population.tiles, props.timeframe, props.industry, props.band)
    : { industries: [], visible: [], domain: 1, observed: 0 }, [population, props.timeframe, props.industry, props.band]);
  const industries = useMemo(() => population.status === "ready" ? [...new Set(population.tiles.map(tile => tile.industry))] : [], [population]);
  const selectedTile = layout.visible.find(tile => tile.ticker === props.selectedCompany)
    || [...layout.visible].sort((a, b) => b.size - a.size || a.sourceOrder - b.sourceOrder)[0] || null;
  const read = sectorHeatmapRead(layout.visible, props.timeframe, language);
  const sectorName = (row: Row) => text(language === "zh" ? row.name_zh : row.name) || text(row.name) || text(row.ticker);
  const bandLabel = (band: SectorCapBand) => t(band);
  const statusCopy = props.status === "loading" ? t("loading") : props.status === "access" ? t("access")
    : props.status === "unavailable" ? t("unavailable")
      : props.status !== "ready" || population.status === "invalid" ? t("invalid") : t("empty");
  const companyCount = population.status === "ready" ? population.tiles.length : 0;

  return <section className={styles.root} data-testid="sector-company-heatmap" data-domain={layout.domain}>
    <header className={styles.header}>
      <div><h2>{props.selectedSectorName || props.selectedSector.toUpperCase()}</h2><p>{t("title")} · {t("subtitle")}</p></div>
      <p className={styles.receipt}>{props.asOf || t("unknownDate")} · {companyCount} {t("names")} · {props.timeframe}</p>
    </header>
    <div className={styles.answer} data-testid="heatmap-answer"><span>{t("marketRead")}</span><p>{read || t("noRead")}</p></div>
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
      {(props.industry || props.band) && <button type="button" onClick={() => { props.onIndustry(""); props.onBand(""); }}>{t("clearScope")}</button>}
      <button type="button" onClick={props.onSources}>{t("sources")} →</button>
    </div>

    {props.status !== "ready" || population.status !== "ready" ? <div className={styles.empty} role="status"><p>{statusCopy}</p><button type="button" onClick={props.onSources}>{t("sources")} →</button></div>
      : !layout.visible.length ? <div className={styles.empty} role="status"><p>{t("empty")}</p>{(props.industry || props.band) && <button type="button" onClick={() => { props.onIndustry(""); props.onBand(""); }}>{t("clearScope")}</button>}</div>
        : <div className={styles.layout}>
          <aside className={styles.inspector} data-testid="heatmap-inspector">
            {selectedTile ? <>
              <span>{props.selectedCompany ? t("selected") : t("largest")}</span>
              <h3>{selectedTile.ticker}</h3><p className={styles.companyName}>{selectedTile.name}</p>
              <dl><div><dt>{t("industry")}</dt><dd>{selectedTile.industry}</dd></div>
                <div><dt>{t("marketCap")}</dt><dd>{capLabel(selectedTile.size)}</dd></div>
                <div><dt>{props.timeframe} {t("performance")}</dt><dd data-sign={number(selectedTile.perf[props.timeframe]) === null || number(selectedTile.perf[props.timeframe]) === 0 ? undefined : number(selectedTile.perf[props.timeframe])! > 0 ? "up" : "down"}>{formatValue(number(selectedTile.perf[props.timeframe]), 2, "%", true)}</dd></div></dl>
              {companyHref(selectedTile.ticker) && <Link href={companyHref(selectedTile.ticker)!}>{t("openCompany")} →</Link>}
              <button type="button" data-sector-return-focus={`heatmap-open-${props.selectedSector}`} onClick={event => { event.currentTarget.focus({ preventScroll: true }); props.onOpenResearch(props.selectedSector); }}>{t("openSector")} →</button>
            </> : <p>{t("empty")}</p>}
          </aside>
          <details className={styles.mapDisclosure} data-testid="heatmap-map-disclosure" open={mapOpen}
            onToggle={event => setMapOpen(event.currentTarget.open)}>
            <summary>{t("browseMap")}<span>{layout.visible.length} {t("names")}</span></summary>
            <div className={styles.mapViewport} data-testid="heatmap-map" data-domain={layout.domain}>
              {layout.industries.map(industry => <section key={industry.industry} className={styles.industryBlock}
                aria-label={`${industry.industry} · ${industry.total} ${t("names")}`}
                style={{ left: `${industry.x / CANVAS_W * 100}%`, top: `${industry.y / CANVAS_H * 100}%`, width: `${industry.w / CANVAS_W * 100}%`, height: `${industry.h / CANVAS_H * 100}%` }}>
                {industry.headerHeight > 0 && <header><strong>{industry.industry}</strong><span>{industry.advancing}/{industry.observed} {t("up")}</span></header>}
                {industry.companies.map(company => {
                  const area = company.w * company.h, compact = area < 9500, tiny = area < 3000;
                  return <button type="button" key={company.tile.ticker} className={styles.tile}
                    data-company-heatmap-tile={company.tile.ticker} data-industry={company.industry}
                    data-sign={company.value === null || company.value === 0 ? undefined : company.value > 0 ? "up" : "down"}
                    aria-pressed={props.selectedCompany === company.tile.ticker}
                    aria-label={`${company.tile.ticker} · ${company.tile.name} · ${formatValue(company.value, 2, "%", true)} · ${capLabel(company.tile.size)}`}
                    style={{ left: `${(company.x - industry.x) / industry.w * 100}%`, top: `${(company.y - industry.y) / industry.h * 100}%`, width: `${company.w / industry.w * 100}%`, height: `${company.h / industry.h * 100}%`, ...colorStyle(company.value, layout.domain) }}
                    onClick={event => { event.currentTarget.focus({ preventScroll: true }); props.onCompany(company.tile.ticker); }}>
                    {!tiny && <><strong>{company.tile.ticker}</strong>{!compact && <><span>{formatValue(company.value, 2, "%", true)}</span><small>{capLabel(company.tile.size)}</small></>}</>}
                  </button>;
                })}
              </section>)}
            </div>
          </details>
        </div>}
    <div className={styles.legend} aria-label={`${t("negative")} · ${t("flat")} · ${t("positive")}`}><span>{formatValue(-layout.domain, 1, "%")}</span><i data-tone="down" /><i data-tone="flat" /><i data-tone="up" /><span>{formatValue(layout.domain, 1, "%", true)}</span></div>
    <p className={styles.note}>{t("exactScope")}</p>
  </section>;
}
