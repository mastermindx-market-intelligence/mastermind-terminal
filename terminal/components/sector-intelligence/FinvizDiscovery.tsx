"use client";

import Link from "next/link";
import { useMemo, useRef } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import { companyHref, formatValue, type FeedPayload, type SectorState, type FinvizMode, type FinvizAxis } from "@/lib/sectorIntelligence";
import { normalizeFinviz, visibleGroups, bubblePoints, metric, TIMEFRAMES, type ThemeGroup } from "@/lib/finvizThemes";
import { useChartWidth, padDomain, niceTicks, fmtTick, thinLabels } from "@/components/charts/svgChart";
import styles from "./FinvizDiscovery.module.css";

const MODES: [FinvizMode, string][] = [
  ["heatmap", "siFinvizHeatmap"], ["bubbles", "siFinvizBubbles"], ["clusters", "siFinvizClusters"], ["matrix", "siFinvizMatrix"], ["table", "siFinvizTable"],
];
const sign = (v: number | null) => v === null ? "missing" : v > 0 ? "up" : v < 0 ? "down" : "flat";
const pct = (v: number | null) => formatValue(v, 2, "%", true);

function BubblePlot({ groups, state, select }: { groups: ThemeGroup[]; state: SectorState; select: (g: ThemeGroup) => void }) {
  const t = useSectorT();
  const ref = useRef<HTMLDivElement>(null), width = useChartWidth(ref, 700);
  const { points, unavailable } = bubblePoints(groups, state.bubbleX, state.bubbleY);
  const domain = (values: number[]) => padDomain(Math.min(...values), Math.max(...values));
  const [x0, x1] = domain(points.map(p => p.x)), [y0, y1] = domain(points.map(p => p.y));
  const xt = niceTicks(x0, x1, 4), yt = niceTicks(y0, y1, 4), height = 390;
  const x = (v: number) => 68 + (v - x0) / (x1 - x0) * (width - 112);
  const y = (v: number) => height - 55 - (v - y0) / (y1 - y0) * (height - 100);
  const maxMembers = Math.max(1, ...groups.map(g => g.members.length));
  const label = (axis: FinvizAxis) => axis === "members" ? t("siFinvizMembers") : axis + (t("siFinvizReturn"));
  return <div ref={ref}>
    <p role="status" data-testid="finviz-bubble-count">{points.length} {t("siFinvizPlotted")} · {unavailable} {t("siFinvizUnavailableAxesTheseGroupsRemainInMatrix")}</p>
    {!!points.length && <div className={styles.plot}><svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label={t("siFinvizThemePerformanceBubblePlot")} role="group">
      {thinLabels(xt.values.filter(v => v >= x0 && v <= x1), x, 55).map(v => <g key={v}><line x1={x(v)} x2={x(v)} y1={35} y2={height - 55} /><text x={x(v)} y={height - 31} textAnchor="middle">{fmtTick(v, xt.step)}</text></g>)}
      {thinLabels(yt.values.filter(v => v >= y0 && v <= y1).reverse(), y, 32).map(v => <g key={v}><line x1={68} x2={width - 44} y1={y(v)} y2={y(v)} /><text x={58} y={y(v) + 4} textAnchor="end">{fmtTick(v, yt.step)}</text></g>)}
      {points.map(p => <circle key={p.group.id} cx={x(p.x)} cy={y(p.y)} r={state.bubbleSize === "members" ? 5 + 17 * Math.sqrt(p.group.members.length / maxMembers) : 9}
        data-sign={sign(metric(p.group, state.matrixTimeframe))} data-selected={state.finvizSubtheme === p.group.id}
        role="button" tabIndex={0} aria-label={`${p.group.name}: ${label(state.bubbleX)} ${p.x}, ${label(state.bubbleY)} ${p.y}`}
        onClick={() => select(p.group)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(p.group); } }}>
        <title>{p.group.name} · {p.x} / {p.y}</title>
      </circle>)}
      <text x={width / 2} y={height - 5} textAnchor="middle">{label(state.bubbleX)}</text>
      <text transform={`translate(14 ${height / 2}) rotate(-90)`} textAnchor="middle">{label(state.bubbleY)}</text>
    </svg></div>}
    <details className={styles.readout} open={width < 600}><summary>{t("siFinvizBubbleValuesAccessibleList")}</summary>
      <div className={styles.bubbleList}>{points.map(p => <button type="button" key={p.group.id} aria-pressed={state.finvizSubtheme === p.group.id} onClick={() => select(p.group)}>
        <strong>{p.group.name}</strong><span>{label(state.bubbleX)} {formatValue(p.x, 2)} · {label(state.bubbleY)} {formatValue(p.y, 2)}</span>
      </button>)}</div>
    </details>
  </div>;
}

export default function FinvizDiscovery({ feed, state, onChange }: { feed?: FeedPayload; state: SectorState; onChange: (patch: Partial<SectorState>) => void }) {
  const { lang } = useLang(), zh = lang === "zh", t = useSectorT();
  const inspectorRef = useRef<HTMLElement>(null);
  const result = useMemo(() => {
    if (!feed || feed.receipt.status !== "ready") return null;
    try { return normalizeFinviz(feed.data); } catch { return null; }
  }, [feed]);
  const groups = useMemo(() => result ? visibleGroups(result, state.discoveryQuery, state.finvizTheme) : [], [result, state.discoveryQuery, state.finvizTheme]);
  const selected = result?.groups.find(g => g.id === state.finvizSubtheme);
  const select = (g: ThemeGroup) => {
    onChange({ finvizSubtheme: g.id });
    if (window.matchMedia("(max-width: 900px)").matches) window.requestAnimationFrame(() => {
      inspectorRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      inspectorRef.current?.focus({ preventScroll: true });
    });
  };
  const parentName = (id: string) => { const parent = result?.themes.find(t => t.id === id); return (zh ? parent?.nameZh : parent?.name) || parent?.name || id; };
  const date = feed?.receipt.asOf || result?.asOf;
  const stale = feed?.receipt.stale === true;
  if (!result) return <section className={styles.root} data-testid="finviz-discovery"><h2>{t("siFinvizFinvizThemes")}</h2><div className={styles.empty} role="status">
    {!feed || feed.receipt.status === "loading" ? (t("siFinvizLoadingThemes")) : feed.receipt.status === "access" ? (t("siFinvizThisSourceIsCurrentlyRestrictedToAuthorized")) : (t("siFinvizTheThemeSourceIsUnavailable"))}
  </div></section>;
  const themeMissing = state.finvizTheme && !result.themes.some(t => t.id === state.finvizTheme);
  const selectedTheme = result.themes.find(t => t.id === state.finvizTheme);
  const themeGroups = selectedTheme ? result.groups.filter(g => g.parentId === selectedTheme.id) : [];
  const themeTickers = new Set(themeGroups.flatMap(g => g.members.map(m => m.ticker)));
  const themeAppearances = themeGroups.reduce((sum, g) => sum + g.members.length, 0);
  const metrics = state.finvizMode === "matrix" ? TIMEFRAMES : [state.matrixTimeframe];
  const known = selected?.members.filter(m => m.perf[state.matrixTimeframe] !== null) || [];
  const advancers = known.filter(m => m.perf[state.matrixTimeframe]! > 0).length;
  return <section className={styles.root} data-testid="finviz-discovery">
    <header className={styles.heading}><div><p className={styles.eyebrow}>{t("siFinvizINTERNALRESEARCHFINVIZ")}</p><h2>{t("siFinvizExploreThemes")}</h2><p>{t("siFinvizFollowThemesToSubthemesAndTheCompanies")}</p></div><p>{date} {stale ? (t("siFinvizStale")) : ""}</p></header>
    <div className={styles.stats} data-testid="finviz-population"><span><strong>{result.counts.themes}</strong> {t("siFinvizThemes")}</span><span><strong>{result.counts.subthemes}</strong> {t("siFinvizSubthemes")}</span><span><strong>{result.counts.tickers}</strong> {t("siFinvizDistinctTickers")}</span><span><strong>{result.counts.appearances}</strong> {t("siFinvizMemberAppearances")}</span></div>
    <nav className={styles.modes} aria-label={t("siFinvizThemeRepresentation")}>{MODES.map(([mode, key]) => <button key={mode} type="button" aria-pressed={state.finvizMode === mode} onClick={() => onChange({ finvizMode: mode })}>{t(key)}</button>)}</nav>
    <div className={styles.controls}>
      <label>{t("siFinvizFindAThemeOrTicker")}<input value={state.discoveryQuery} onChange={e => onChange({ discoveryQuery: e.target.value.slice(0, 60) })} /></label>
      <label>{t("siFinvizTheme")}<select value={state.finvizTheme} onChange={e => onChange({ finvizTheme: e.target.value })}><option value="">{t("siFinvizAllThemes")}</option>{themeMissing && <option value={state.finvizTheme}>{t("siFinvizSelectedThemeRemoved")}</option>}{result.themes.map(t => <option key={t.id} value={t.id}>{parentName(t.id)}</option>)}</select></label>
      <label>{t("siFinvizTimeframe")}<select value={state.matrixTimeframe} onChange={e => onChange({ matrixTimeframe: e.target.value as SectorState["matrixTimeframe"] })}>{TIMEFRAMES.map(tf => <option key={tf}>{tf}</option>)}</select></label>
      <button type="button" onClick={() => onChange({ finvizTheme: "", discoveryQuery: "" })}>{t("siFinvizClearFilters")}</button>
    </div>
    <p className={styles.scope} data-testid="finviz-visible-count">{groups.length} / {result.counts.subthemes} {t("siFinvizSubthemesVisibleFiltersChangeVisibilityOnly")}</p>
    {themeMissing && <p role="status">{t("siFinvizTheSelectedThemeIsAbsentFromThis")}</p>}
    {selectedTheme && <section className={styles.themeSummary} aria-label={t("siFinvizThemeCoverage")}>
      <div><h3>{parentName(selectedTheme.id)}</h3><p>Finviz · {selectedTheme.id}</p></div>
      <p>{themeGroups.length} {t("siFinvizSubthemes")} · {themeTickers.size} {t("siFinvizDistinctTickers")} · {themeAppearances} {t("siFinvizMemberAppearances")}</p>
      <p>{themeGroups.filter(g => metric(g, state.matrixTimeframe) !== null).length} / {themeGroups.length} {t("siFinvizSubthemesMeasured")} · {state.matrixTimeframe} · {date}</p>
      <p>{t("siFinvizMembersCanBelongToSeveralSubthemesSubtheme")}</p>
    </section>}
    <div className={styles.explorer}><div className={styles.inventory} data-testid="finviz-inventory">
    {state.finvizMode === "bubbles" && <><div className={styles.controls}>{(["bubbleX", "bubbleY"] as const).map(key => <label key={key}>{key === "bubbleX" ? (t("siFinvizXAxis")) : (t("siFinvizYAxis"))}<select value={state[key]} onChange={e => onChange({ [key]: e.target.value as FinvizAxis })}>{TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf} {t("siFinvizReturn2")}</option>)}<option value="members">{t("siFinvizMemberCount")}</option></select></label>)}
      <label>{t("siFinvizBubbleSize")}<select value={state.bubbleSize} onChange={e => onChange({ bubbleSize: e.target.value as SectorState["bubbleSize"] })}><option value="members">{t("siFinvizMemberCount")}</option><option value="equal">{t("siFinvizEqualSize")}</option><option disabled>{t("siFinvizMarketCapNotSupplied")}</option></select></label></div><BubblePlot groups={groups} state={state} select={select} /></>}
    {(state.finvizMode === "heatmap" || state.finvizMode === "clusters") && <>
      {state.finvizMode === "clusters" && <p>{t("siFinvizCategoricalGroupingProximityDoesNotRepresentCorrelation")}</p>}
      <div className={styles.hierarchy}>{result.themes.filter(parent => groups.some(g => g.parentId === parent.id)).map(parent => <section key={parent.id} className={styles.themeGroup}>
        <h3><button type="button" onClick={() => onChange({ finvizTheme: parent.id })}>{parentName(parent.id)}</button></h3>
        <div className={state.finvizMode === "clusters" ? styles.cluster : styles.tiles}>{groups.filter(g => g.parentId === parent.id).map(g => <button type="button" key={g.id} data-testid="finviz-group" data-source-id={g.id} data-sign={sign(metric(g, state.matrixTimeframe))} aria-pressed={selected?.id === g.id} onClick={() => select(g)} style={state.finvizMode === "heatmap" ? { flexGrow: g.members.length } : undefined}>
          <strong>{g.name}</strong><span>{pct(metric(g, state.matrixTimeframe))}</span><small>{g.members.length} {t("siFinvizMembers2")}</small>
        </button>)}</div>
      </section>)}</div>
    </>}
    {(state.finvizMode === "table" || state.finvizMode === "matrix") && <div className={styles.tableWrap}><table><caption>{t("siFinvizSameCompleteInventoryADashMeansAn")}</caption><thead><tr><th>{t("siFinvizSubthemeTheme")}</th><th>{t("siFinvizMeasuredMembers")}</th>{metrics.map(tf => <th key={tf}>{tf}</th>)}</tr></thead><tbody>{groups.map(g => <tr key={g.id} data-testid="finviz-row" data-source-id={g.id} aria-selected={selected?.id === g.id}><th scope="row"><button type="button" onClick={() => select(g)}>{g.name}</button><small>{parentName(g.parentId)}</small><small className={styles.sourceId}>{g.id}</small></th><td data-label={t("siFinvizMeasuredMembers")}>{g.members.filter(m => m.perf[state.matrixTimeframe] !== null).length} / {g.members.length}<small>{state.matrixTimeframe}</small></td>{metrics.map(tf => <td key={tf} data-label={tf} data-sign={sign(metric(g, tf))}>{pct(metric(g, tf))}</td>)}</tr>)}</tbody></table></div>}
    {!groups.length && <p className={styles.empty}>{t("siFinvizNoSubthemesMatchTheseFilters")}</p>}
    </div>
    <aside ref={inspectorRef} tabIndex={-1} className={styles.inspector} data-testid="finviz-inspector" aria-label={t("siFinvizSubthemeDetails")}>
      {!selected ? <p>{state.finvizSubtheme ? (t("siFinvizTheSelectedSubthemeIsAbsentFromThis")) : (t("siFinvizSelectASubthemeToInspectEveryMember"))}</p> : <>
        <p className={styles.eyebrow}>{parentName(selected.parentId)}</p><h3>{selected.name}</h3><p className={styles.sourceId}>{selected.id}</p><p>{known.length} / {selected.members.length} {t("siFinvizMembersMeasured")} · {advancers} {t("siFinvizAdvancing")} · {state.matrixTimeframe}</p>
        <div className={styles.members}>{selected.members.map(member => <button type="button" key={member.ticker} aria-pressed={state.company === member.ticker} onClick={() => onChange({ company: member.ticker })}><strong>{member.ticker}</strong><span data-sign={sign(member.perf[state.matrixTimeframe])}>{pct(member.perf[state.matrixTimeframe])}</span></button>)}</div>
        {state.company && selected.members.some(m => m.ticker === state.company) && <p><Link href={companyHref(state.company)!}>{t("siFinvizResearchCompany")}: {state.company} →</Link></p>}
        <details><summary>{t("siFinvizOverlappingSubthemes")}</summary>{result.groups.filter(g => g.id !== selected.id && g.members.some(m => selected.members.some(s => s.ticker === m.ticker))).map(g => <button className={styles.overlap} key={g.id} type="button" onClick={() => select(g)}>{parentName(g.parentId)} / {g.name} · {g.members.filter(m => selected.members.some(s => s.ticker === m.ticker)).length}</button>)}</details>
      </>}
    </aside></div>
    <details className={styles.receipt}><summary>{t("siFinvizSourceAndCoverage")}</summary><dl>
      <dt>{t("siFinvizSource")}</dt><dd>Finviz · {feed?.receipt.path}</dd><dt>{t("siFinvizMarketDate")}</dt><dd>{date}</dd><dt>{t("siFinvizGenerated")}</dt><dd>{result.generatedAt || "—"}</dd><dt>{t("siFinvizRetrieved")}</dt><dd>{feed?.receipt.observedAt || "—"}</dd><dt>{t("siFinvizContentFingerprint")}</dt><dd>{feed?.receipt.contentHash || "—"}</dd><dt>{t("siFinvizSelectedSourceIdentity")}</dt><dd>{selected?.id || "—"}</dd>
    </dl><p>{t("siFinvizOwnerReportedSubthemeAndTickerTotalsReconcile")}</p><p>{t("siFinvizSourceLabelsArePreservedCapitalizationCorrelationHistorical")}</p><p>{t("siFinvizInternalResearchOnlyCustomerDisplayRemainsGated")}</p></details>
  </section>;
}
