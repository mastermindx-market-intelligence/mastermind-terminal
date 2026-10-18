"use client";

import { useMemo } from "react";
import { useLang } from "@/lib/i18n";
import {
  formatValue,
  number,
  text,
  type FeedStatus,
  type Row,
  type SectorMatrixTimeframe,
} from "@/lib/sectorIntelligence";
import {
  MATRIX_TIMEFRAMES,
  sectorMatrixPopulation,
  type SectorMatrixTile,
} from "./SectorIndustryMatrix";
import styles from "./SectorIndustrySummary.module.css";

export interface SectorIndustrySummaryProps {
  data: unknown;
  status: FeedStatus;
  asOf: string | null;
  sectors: readonly Row[];
  selectedSector: string;
  selectedSectorName: string;
  selectedSectorSourceName: string;
  timeframe: SectorMatrixTimeframe;
  onSector: (sector: string) => void;
  onTimeframe: (timeframe: SectorMatrixTimeframe) => void;
  onInspectIndustry: (industry: string) => void;
  onSources: () => void;
}

export interface SectorIndustrySummaryRow {
  industry: string;
  sourceOrder: number;
  names: number;
  totalMarketCap: number;
  observed: number;
  observedMarketCap: number;
  advancing: number;
  declining: number;
  unchanged: number;
  populationShare: number;
  marketCapShare: number;
  observedCapShare: number;
  participation: number | null;
  capWeightedPerformance: number | null;
}

export interface SectorIndustrySummaryModel {
  totalNames: number;
  totalMarketCap: number;
  observedNames: number;
  observedMarketCap: number;
  advancing: number;
  declining: number;
  unchanged: number;
  observedIndustries: number;
  atLeastHalfUpIndustries: number;
  rows: SectorIndustrySummaryRow[];
}

const COPY = {
  title: ["Industry summary", "行业摘要"],
  subtitle: ["Answer-first view of the selected sector", "所选板块的答案优先概览"],
  marketRead: ["Market read", "市场解读"],
  sector: ["Sector", "板块"],
  timeframe: ["Performance window", "表现周期"],
  sources: ["Review sources", "查看来源"],
  sourceDate: ["Source date", "来源日期"],
  unknownDate: ["Date unavailable", "日期不可用"],
  names: ["names", "家公司"],
  observationCoverage: ["Observation coverage", "观察覆盖"],
  positiveParticipation: ["Positive participation", "上涨参与度"],
  industryBreadth: ["Industry breadth", "行业广度"],
  largestIndustry: ["Largest industry", "最大行业"],
  observed: ["observed", "有观察"],
  marketCapObserved: ["market cap observed", "市值有观察"],
  up: ["up", "上涨"],
  atLeastHalfUp: ["industries with ≥50% up", "上涨占比≥50%的行业"],
  ofObservedIndustries: ["of observed industries", "占有观察行业"],
  sectorMarketCap: ["of sector market cap", "占板块市值"],
  industry: ["Industry", "行业"],
  companies: ["Companies", "公司数"],
  marketCap: ["Market cap", "市值"],
  participation: ["Participation", "参与度"],
  performance: ["Cap-weighted performance", "市值加权表现"],
  viewCompanies: ["View companies", "查看公司"],
  companyDenominator: ["of sector companies", "占板块公司"],
  capDenominator: ["of sector cap", "占板块市值"],
  participationDenominator: ["of observed names up", "有观察公司中上涨"],
  performanceDenominator: ["names observed", "家公司有观察"],
  capCoverage: ["cap coverage", "市值覆盖"],
  loading: ["Loading the industry summary…", "正在加载行业摘要…"],
  access: ["The industry summary requires access.", "行业摘要需要访问权限。"],
  unavailable: ["Industry summary data is unavailable.", "行业摘要数据暂不可用。"],
  invalid: ["The exact selected-sector population could not be read safely.", "无法安全读取所选板块的精确样本。"],
  empty: ["No exact companies match this sector label.", "没有公司与此板块标签精确匹配。"],
  noRead: ["Performance observations are unavailable for this exact population and window.", "此精确样本与周期暂无表现观察。"],
  exactScope: [
    "Exact owner population only. Participation uses advancing / observed names; cap-weighted performance uses observed market cap. Missing observations stay missing, never zero.",
    "仅使用精确所有者样本。参与度采用上涨公司/有观察公司；市值加权表现采用有观察市值。缺失观察保持缺失，绝不视为零。",
  ],
} as const;

type Language = "en" | "zh";
const percentage = (numerator: number, denominator: number): number | null => denominator > 0 ? numerator / denominator * 100 : null;

export function summarizeSectorIndustries(
  tiles: readonly SectorMatrixTile[],
  timeframe: SectorMatrixTimeframe,
): SectorIndustrySummaryModel {
  const totalMarketCap = tiles.reduce((sum, tile) => sum + tile.size, 0);
  const groups = new Map<string, {
    industry: string;
    sourceOrder: number;
    names: number;
    totalMarketCap: number;
    observed: number;
    observedMarketCap: number;
    advancing: number;
    declining: number;
    unchanged: number;
    weightedPerformance: number;
  }>();
  let observedNames = 0, observedMarketCap = 0, advancing = 0, declining = 0, unchanged = 0;
  for (const tile of tiles) {
    const current = groups.get(tile.industry) || {
      industry: tile.industry,
      sourceOrder: tile.sourceOrder,
      names: 0,
      totalMarketCap: 0,
      observed: 0,
      observedMarketCap: 0,
      advancing: 0,
      declining: 0,
      unchanged: 0,
      weightedPerformance: 0,
    };
    current.names += 1;
    current.totalMarketCap += tile.size;
    const value = number(tile.perf[timeframe]);
    if (value !== null) {
      current.observed += 1;
      current.observedMarketCap += tile.size;
      current.weightedPerformance += tile.size * value;
      observedNames += 1;
      observedMarketCap += tile.size;
      if (value > 0) { current.advancing += 1; advancing += 1; }
      else if (value < 0) { current.declining += 1; declining += 1; }
      else { current.unchanged += 1; unchanged += 1; }
    }
    groups.set(tile.industry, current);
  }
  const rows = [...groups.values()].map(group => ({
    industry: group.industry,
    sourceOrder: group.sourceOrder,
    names: group.names,
    totalMarketCap: group.totalMarketCap,
    observed: group.observed,
    observedMarketCap: group.observedMarketCap,
    advancing: group.advancing,
    declining: group.declining,
    unchanged: group.unchanged,
    populationShare: percentage(group.names, tiles.length) || 0,
    marketCapShare: percentage(group.totalMarketCap, totalMarketCap) || 0,
    observedCapShare: percentage(group.observedMarketCap, group.totalMarketCap) || 0,
    participation: percentage(group.advancing, group.observed),
    capWeightedPerformance: group.observedMarketCap > 0 ? group.weightedPerformance / group.observedMarketCap : null,
  })).sort((a, b) => b.totalMarketCap - a.totalMarketCap || a.sourceOrder - b.sourceOrder);
  const observedRows = rows.filter(row => row.observed > 0);
  return {
    totalNames: tiles.length,
    totalMarketCap,
    observedNames,
    observedMarketCap,
    advancing,
    declining,
    unchanged,
    observedIndustries: observedRows.length,
    atLeastHalfUpIndustries: observedRows.filter(row => row.advancing * 2 >= row.observed).length,
    rows,
  };
}

export function sectorIndustrySummaryRead(
  summary: SectorIndustrySummaryModel,
  timeframe: SectorMatrixTimeframe,
  lang: Language,
): string | null {
  const observed = summary.rows.filter((row): row is SectorIndustrySummaryRow & { capWeightedPerformance: number; participation: number } =>
    row.capWeightedPerformance !== null && row.participation !== null);
  if (!observed.length || summary.observedNames === 0) return null;
  const performanceLeader = [...observed].sort((a, b) => b.capWeightedPerformance - a.capWeightedPerformance
    || b.observedMarketCap - a.observedMarketCap || a.sourceOrder - b.sourceOrder)[0];
  const participationLeader = [...observed].sort((a, b) => b.participation - a.participation
    || b.observed - a.observed || a.sourceOrder - b.sourceOrder)[0];
  const capCoverage = percentage(summary.observedMarketCap, summary.totalMarketCap);
  if (lang === "zh") {
    const observedPhrase = performanceLeader.observed === 1
      ? `仅${performanceLeader.observed}/${performanceLeader.names}家公司有观察`
      : `${performanceLeader.observed}/${performanceLeader.names}家公司有观察`;
    const first = `${performanceLeader.industry}的${timeframe}市值加权表现领先（${formatValue(performanceLeader.capWeightedPerformance, 2, "%", true)}，${observedPhrase}）`;
    const second = performanceLeader.industry === participationLeader.industry
      ? `且参与度最高（${participationLeader.advancing}/${participationLeader.observed}上涨）`
      : `；${participationLeader.industry}参与度最高（${participationLeader.advancing}/${participationLeader.observed}上涨）`;
    return `${first}${second}。整体覆盖${summary.observedNames}/${summary.totalNames}家公司和${formatValue(capCoverage, 0, "%")}板块市值。`;
  }
  const observedPhrase = performanceLeader.observed === 1
    ? `only ${performanceLeader.observed}/${performanceLeader.names} name observed`
    : `${performanceLeader.observed}/${performanceLeader.names} names observed`;
  const first = `${performanceLeader.industry} leads cap-weighted ${timeframe} performance (${formatValue(performanceLeader.capWeightedPerformance, 2, "%", true)} on ${observedPhrase})`;
  const second = performanceLeader.industry === participationLeader.industry
    ? ` and has the broadest participation (${participationLeader.advancing}/${participationLeader.observed} up)`
    : `; ${participationLeader.industry} has the broadest participation (${participationLeader.advancing}/${participationLeader.observed} up)`;
  return `${first}${second}. Coverage is ${summary.observedNames}/${summary.totalNames} names and ${formatValue(capCoverage, 0, "%")} of sector market cap.`;
}

const capLabel = (value: number): string => value >= 1_000_000_000_000
  ? `$${(value / 1_000_000_000_000).toFixed(value >= 10_000_000_000_000 ? 0 : 2)}T`
  : `$${(value / 1_000_000_000).toFixed(value >= 100_000_000_000 ? 0 : 1)}B`;
const shareLabel = (value: number | null): string => value !== null && value > 0 && value < 1 ? "<1%" : formatValue(value, 0, "%");

export default function SectorIndustrySummary(props: SectorIndustrySummaryProps) {
  const { lang } = useLang();
  const language: Language = lang === "zh" ? "zh" : "en";
  const t = (key: keyof typeof COPY) => COPY[key][language === "zh" ? 1 : 0];
  const population = useMemo(() => props.status === "ready"
    ? sectorMatrixPopulation(props.data, props.selectedSectorSourceName)
    : { status: "invalid" as const, supplied: 0, readable: 0, tiles: [] }, [props.status, props.data, props.selectedSectorSourceName]);
  const summary = useMemo(() => population.status === "ready"
    ? summarizeSectorIndustries(population.tiles, props.timeframe)
    : null, [population, props.timeframe]);
  const read = summary ? sectorIndustrySummaryRead(summary, props.timeframe, language) : null;
  const sectorName = (row: Row) => text(language === "zh" ? row.name_zh : row.name) || text(row.name) || text(row.ticker);
  const statusCopy = props.status === "loading" ? t("loading") : props.status === "access" ? t("access")
    : props.status === "unavailable" ? t("unavailable")
      : props.status !== "ready" || population.status === "invalid" ? t("invalid") : t("empty");
  const coverage = summary ? percentage(summary.observedNames, summary.totalNames) : null;
  const capCoverage = summary ? percentage(summary.observedMarketCap, summary.totalMarketCap) : null;
  const participation = summary ? percentage(summary.advancing, summary.observedNames) : null;
  const largest = summary?.rows[0] || null;

  return <section className={styles.root} data-testid="sector-industry-summary">
    <header className={styles.header}>
      <div><h2>{props.selectedSectorName || props.selectedSector.toUpperCase()}</h2><p>{t("title")} · {t("subtitle")}</p></div>
      <p className={styles.receipt}><span>{props.asOf || t("unknownDate")}</span><span>{summary?.totalNames || 0} {t("names")}</span><span>{props.timeframe}</span></p>
    </header>
    <div className={styles.answer} data-testid="industry-summary-answer"><span>{t("marketRead")}</span><p>{read || t("noRead")}</p></div>
    <div className={styles.controls}>
      <label>{t("sector")}<select value={props.selectedSector} onChange={event => props.onSector(event.target.value)}>
        {props.sectors.map(row => <option key={text(row.id)} value={text(row.id)}>{sectorName(row)} · {text(row.ticker)}</option>)}
      </select></label>
      <label>{t("timeframe")}<select value={props.timeframe} onChange={event => props.onTimeframe(event.target.value as SectorMatrixTimeframe)}>
        {MATRIX_TIMEFRAMES.map(timeframe => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
      </select></label>
      <button type="button" onClick={props.onSources}>{t("sources")} →</button>
    </div>

    {props.status !== "ready" || population.status !== "ready" || !summary ? <div className={styles.empty} role="status"><p>{statusCopy}</p><button type="button" onClick={props.onSources}>{t("sources")} →</button></div> : <>
      <div className={styles.metrics} data-testid="industry-summary-metrics">
        <article><span>{t("observationCoverage")}</span><strong>{summary.observedNames} / {summary.totalNames}</strong><small>{formatValue(coverage, 0, "%")} {t("observed")} · {formatValue(capCoverage, 0, "%")} {t("marketCapObserved")}</small></article>
        <article><span>{t("positiveParticipation")}</span><strong>{summary.advancing} / {summary.observedNames || "—"}</strong><small>{formatValue(participation, 0, "%")} {t("up")}</small></article>
        <article><span>{t("industryBreadth")}</span><strong>{summary.atLeastHalfUpIndustries} / {summary.observedIndustries || "—"}</strong><small>{t("atLeastHalfUp")} · {t("ofObservedIndustries")}</small></article>
        <article><span>{t("largestIndustry")}</span><strong>{largest?.industry || "—"}</strong><small>{shareLabel(largest?.marketCapShare ?? null)} {t("sectorMarketCap")}</small></article>
      </div>
      <div className={styles.tableWrap}><table><thead><tr>
        <th>{t("industry")}</th><th>{t("companies")}</th><th>{t("marketCap")}</th><th>{t("participation")}</th><th>{t("performance")}</th><th><span className={styles.srOnly}>{t("viewCompanies")}</span></th>
      </tr></thead><tbody>{summary.rows.map(row => {
        const sign = row.capWeightedPerformance === null || row.capWeightedPerformance === 0 ? undefined : row.capWeightedPerformance > 0 ? "up" : "down";
        return <tr key={row.industry} data-summary-industry-row={row.industry}>
          <th scope="row"><strong>{row.industry}</strong><span className={styles.shareTrack} aria-hidden="true"><span style={{ width: `${Math.min(100, row.marketCapShare)}%` }} /></span></th>
          <td data-label={t("companies")}><strong>{row.names} / {summary.totalNames}</strong><small>{shareLabel(row.populationShare)} {t("companyDenominator")}</small></td>
          <td data-label={t("marketCap")}><strong>{capLabel(row.totalMarketCap)}</strong><small>{shareLabel(row.marketCapShare)} {t("capDenominator")}</small></td>
          <td data-label={t("participation")}><strong>{row.observed ? `${row.advancing} / ${row.observed}` : "—"}</strong><small>{formatValue(row.participation, 0, "%")} {t("participationDenominator")}</small></td>
          <td data-label={t("performance")}><strong data-sign={sign}>{formatValue(row.capWeightedPerformance, 2, "%", true)}</strong><small>{row.observed} / {row.names} {t("performanceDenominator")} · {formatValue(row.observedCapShare, 0, "%")} {t("capCoverage")}</small></td>
          <td><button type="button" data-summary-industry-action={row.industry} onClick={() => props.onInspectIndustry(row.industry)} aria-label={`${t("viewCompanies")}: ${row.industry}`}>{t("viewCompanies")} →</button></td>
        </tr>;
      })}</tbody></table></div>
    </>}
    <p className={styles.note}>{t("exactScope")}</p>
  </section>;
}
