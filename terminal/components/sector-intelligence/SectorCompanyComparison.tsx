"use client";

import Link from "next/link";
import { useMemo, useRef, type KeyboardEvent } from "react";
import { useChartWidth, padDomain, niceTicks, thinLabels, fmtTick } from "@/components/charts/svgChart";
import { formatValue, companyHref, type SectorMember } from "@/lib/sectorIntelligence";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import styles from "./SectorCompanyComparison.module.css";

export interface SectorCompanyComparisonProps {
  rows: readonly SectorMember[];
  selected: string;
  expanded: boolean;
  groupName: string;
  asOf: string | null;
  onSelect: (ticker: string) => void;
  onExpand: () => void;
  onOpenTable: () => void;
}

/** One shared point scale, never a price-return bar silently truncated at zero.
 * Both displayed measures remain the source values. No recomputed stock signal.
 */
export default function SectorCompanyComparison({ rows, selected, expanded, groupName, asOf,
  onSelect, onExpand, onOpenTable }: SectorCompanyComparisonProps) {
  const t = useSectorT();
  const wrapper = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const width = useChartWidth(wrapper, 600);
  const visible = useMemo(() => expanded ? rows : rows.slice(0, 6), [rows, expanded]);
  // An explicit selection remains exact even outside the collapsed subset.
  // Do not silently choose the first/highest-return name as a recommendation.
  const member = rows.find(row => row.ticker === selected) ?? null;
  const finite = visible.flatMap(row => row.relative === null ? [] : [row.relative]);
  const [lo, hi] = finite.length ? padDomain(Math.min(...finite), Math.max(...finite), { includeZero: true }) : [0, 1];
  const left = 57, right = width - 75;
  const scale = (value: number) => left + (value - lo) / (hi - lo) * (right - left);
  const ticks = niceTicks(lo, hi, width < 400 ? 3 : 5);
  const labels = thinLabels(ticks.values, scale, 52);
  const top = 40, step = 48, bottom = top + step * visible.length, height = Math.max(190, bottom + 34);
  const active = visible.some(row => row.ticker === selected) ? selected : visible[0]?.ticker;
  const onKey = (event: KeyboardEvent<SVGGElement>, index: number, ticker: string) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(ticker); return; }
    const next = event.key === "ArrowDown" ? (index + 1) % visible.length : event.key === "ArrowUp" ? (index + visible.length - 1) % visible.length : event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); onSelect(visible[next].ticker);
    svg.current?.querySelectorAll<SVGGElement>("[data-company-choice]")[next]?.focus();
  };
  return <section className={styles.comparison} aria-label={t("siCompareTitle")}>
    <header className={styles.heading}><div><h2>{t("siCompareTitle")}</h2><p>{groupName || t("siGroup")} · {t("siCompareWindow")}</p></div>
      <button type="button" onClick={onOpenTable}>{t("siFullCompanyTable")} →</button>
    </header>
    <div className={styles.layout}>
      <div className={styles.chart} ref={wrapper}>
        {visible.length ? <svg ref={svg} viewBox={`0 0 ${width} ${height}`} width={width} height={height}
          className={styles.plot} role="group" aria-label={t("siCompareTitle")}>
          <text x={0} y={17} className={styles.axis}>{t("siTicker")}</text>
          <text x={(left + right) / 2} y={17} textAnchor="middle" className={styles.axis}>{t("siCompareRelative")} · pp</text>
          <text x={width - 4} y={17} textAnchor="end" className={styles.axis}>{t("siReturn20")}</text>
          {finite.length > 0 && labels.map(value => <g key={value} aria-hidden="true">
            <line x1={scale(value)} x2={scale(value)} y1={top - 7} y2={bottom - 2} className={styles.grid} />
            <text x={scale(value)} y={bottom + 21} textAnchor="middle" className={styles.axis}>{fmtTick(value, ticks.step)}</text>
          </g>)}
          {finite.length > 0 && lo <= 0 && hi >= 0 && <line x1={scale(0)} x2={scale(0)} y1={top - 7} y2={bottom - 2} className={styles.zero} aria-hidden="true" />}
          {visible.map((row, index) => {
            const y = top + index * step;
            return <g key={row.ticker} data-company-choice={row.ticker} className={styles.row}
              role="button" tabIndex={active === row.ticker ? 0 : -1} aria-pressed={selected === row.ticker}
              aria-label={`${t("siSelectCompany")}: ${row.ticker}; ${t("siCompareRelative")} ${formatValue(row.relative, 1, "pp", true)}; ${t("siReturn20")} ${formatValue(row.return20d, 1, "%", true)}`}
              onClick={() => onSelect(row.ticker)} onKeyDown={event => onKey(event, index, row.ticker)}>
              <rect x={1} y={y - 4} width={width - 2} height={44} rx={7} className={styles.hit} />
              <text x={7} y={y + 23} className={styles.ticker}>{row.ticker}</text>
              {row.relative === null ? <text x={(left + right) / 2} y={y + 22} className={styles.missing}>—</text>
                : <><circle cx={scale(row.relative)} cy={y + 17} r={selected === row.ticker ? 5 : 4} className={styles.dot} />
                  <text x={scale(row.relative)} y={y + 33} textAnchor="middle" className={styles.value}>{formatValue(row.relative, 1, "", true)}</text></>}
              <text x={width - 5} y={y + 22} textAnchor="end" className={styles.returnValue}
                data-sign={row.return20d === null || row.return20d === 0 ? undefined : row.return20d > 0 ? "up" : "down"}>{formatValue(row.return20d, 1, "%", true)}</text>
            </g>;
          })}
        </svg> : <p className={styles.empty}>{t("siComparisonMissing")}</p>}
        <div className={styles.chartFooter}><span>{visible.length} / {rows.length} {t("siShowing")}</span>
          {rows.length > 6 && <button type="button" aria-expanded={expanded} onClick={onExpand}>{t(expanded ? "siCompareLess" : "siCompareAll")}</button>}
        </div>
      </div>
      <aside className={styles.inspector} aria-label={t("siSelectedCompany")} data-testid="sector-company-inspector" aria-live="polite">
        <p className={styles.eyebrow}>{t("siSelectedCompany")}</p>
        {member ? <>
          <h3>{member.ticker}</h3>
          <dl className={styles.numbers}><div><dt>{t("siCompareAbsolute")}</dt><dd>{formatValue(member.return20d, 1, "%", true)}</dd></div>
            <div><dt>{t("siCompareRelative")}</dt><dd>{formatValue(member.relative, 1, "pp", true)}</dd></div></dl>
          <p className={styles.clock}>{t("siGroupClock")} · {asOf || t("siUnknownDate")}</p>
          <Link className={styles.primaryAction} href={companyHref(member.ticker)!}>{t("siOpenCompany")} ↗</Link>
          <details className={styles.details}><summary>{t("siSourceSignalDetails")}</summary>
            <dl><div><dt>{t("siTier")}</dt><dd>{member.tier || t("siSourceUnrated")}</dd></div>
              <div><dt>{t("siSourceFlag")}</dt><dd>{member.buyable === null ? "—" : t(member.buyable ? "siYes" : "siNo")}</dd></div>
              <div><dt>{t("siTicks")}</dt><dd>{formatValue(member.ticks, 0)}</dd></div></dl>
            <p>{t("siCompanyCaution")}</p>
          </details>
        </> : <p className={styles.empty}>{t("siCompanyPrompt")}</p>}
      </aside>
    </div>
    <details className={styles.details}><summary>{t("siCompareMethods")}</summary><p>{t("siCompareMethodsBody")}</p><p>{t("siMembershipCopy")}</p></details>
  </section>;
}
