"use client";

import Link from "next/link";
import { useMemo, useRef } from "react";
import { useLang } from "@/lib/i18n";
import { companyHref, formatValue, type FeedPayload, type SectorState, type FinvizMode, type FinvizAxis } from "@/lib/sectorIntelligence";
import { normalizeFinviz, visibleGroups, bubblePoints, metric, TIMEFRAMES, type ThemeGroup } from "@/lib/finvizThemes";
import { useChartWidth, padDomain, niceTicks, fmtTick, thinLabels } from "@/components/charts/svgChart";
import styles from "./FinvizDiscovery.module.css";

const MODES: [FinvizMode, string, string][] = [
  ["heatmap", "Heatmap", "热图"], ["bubbles", "Bubbles", "气泡"], ["clusters", "Clusters", "分组"], ["matrix", "Matrix", "矩阵"], ["table", "Table", "表格"],
];
const sign = (v: number | null) => v === null ? "missing" : v > 0 ? "up" : v < 0 ? "down" : "flat";
const pct = (v: number | null) => formatValue(v, 2, "%", true);

function BubblePlot({ groups, state, select, zh }: { groups: ThemeGroup[]; state: SectorState; select: (g: ThemeGroup) => void; zh: boolean }) {
  const ref = useRef<HTMLDivElement>(null), width = useChartWidth(ref, 700);
  const { points, unavailable } = bubblePoints(groups, state.bubbleX, state.bubbleY);
  const domain = (values: number[]) => padDomain(Math.min(...values), Math.max(...values));
  const [x0, x1] = domain(points.map(p => p.x)), [y0, y1] = domain(points.map(p => p.y));
  const xt = niceTicks(x0, x1, 4), yt = niceTicks(y0, y1, 4), height = 390;
  const x = (v: number) => 68 + (v - x0) / (x1 - x0) * (width - 112);
  const y = (v: number) => height - 55 - (v - y0) / (y1 - y0) * (height - 100);
  const maxMembers = Math.max(1, ...groups.map(g => g.members.length));
  const label = (axis: FinvizAxis) => axis === "members" ? zh ? "成员数" : "Members" : axis + (zh ? " 收益 %" : " return %");
  return <div ref={ref}>
    <p role="status" data-testid="finviz-bubble-count">{points.length} {zh ? "个气泡" : "plotted"} · {unavailable} {zh ? "组因坐标缺失未绘制，仍保留在矩阵和表格中。" : "unavailable axes; these groups remain in Matrix and Table."}</p>
    {!!points.length && <div className={styles.plot}><svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label={zh ? "主题收益气泡图" : "Theme performance bubble plot"} role="group">
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
    <details className={styles.readout} open={width < 600}><summary>{zh ? "气泡数值列表" : "Bubble values — accessible list"}</summary>
      <div className={styles.bubbleList}>{points.map(p => <button type="button" key={p.group.id} aria-pressed={state.finvizSubtheme === p.group.id} onClick={() => select(p.group)}>
        <strong>{p.group.name}</strong><span>{label(state.bubbleX)} {formatValue(p.x, 2)} · {label(state.bubbleY)} {formatValue(p.y, 2)}</span>
      </button>)}</div>
    </details>
  </div>;
}

export default function FinvizDiscovery({ feed, state, onChange }: { feed?: FeedPayload; state: SectorState; onChange: (patch: Partial<SectorState>) => void }) {
  const { lang } = useLang(), zh = lang === "zh";
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
  if (!result) return <section className={styles.root} data-testid="finviz-discovery"><h2>{zh ? "Finviz 主题" : "Finviz themes"}</h2><div className={styles.empty} role="status">
    {!feed || feed.receipt.status === "loading" ? (zh ? "正在加载主题…" : "Loading themes…") : feed.receipt.status === "access" ? (zh ? "此来源目前仅限内部授权使用。" : "This source is currently restricted to authorized internal use.") : (zh ? "主题来源暂不可用。" : "The theme source is unavailable.")}
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
    <header className={styles.heading}><div><p className={styles.eyebrow}>{zh ? "内部研究 · Finviz" : "INTERNAL RESEARCH · FINVIZ"}</p><h2>{zh ? "探索主题" : "Explore themes"}</h2><p>{zh ? "从主题到子主题，再到推动变化的公司。" : "Follow themes to subthemes and the companies behind each move."}</p></div><p>{date} {stale ? (zh ? "· 已陈旧" : "· Stale") : ""}</p></header>
    <div className={styles.stats} data-testid="finviz-population"><span><strong>{result.counts.themes}</strong> {zh ? "主题" : "themes"}</span><span><strong>{result.counts.subthemes}</strong> {zh ? "子主题" : "subthemes"}</span><span><strong>{result.counts.tickers}</strong> {zh ? "不同股票" : "distinct tickers"}</span><span><strong>{result.counts.appearances}</strong> {zh ? "成员归属" : "member appearances"}</span></div>
    <nav className={styles.modes} aria-label={zh ? "主题视图" : "Theme representation"}>{MODES.map(([mode, en, cn]) => <button key={mode} type="button" aria-pressed={state.finvizMode === mode} onClick={() => onChange({ finvizMode: mode })}>{zh ? cn : en}</button>)}</nav>
    <div className={styles.controls}>
      <label>{zh ? "搜索主题或股票" : "Find a theme or ticker"}<input value={state.discoveryQuery} onChange={e => onChange({ discoveryQuery: e.target.value.slice(0, 60) })} /></label>
      <label>{zh ? "主题" : "Theme"}<select value={state.finvizTheme} onChange={e => onChange({ finvizTheme: e.target.value })}><option value="">{zh ? "全部主题" : "All themes"}</option>{themeMissing && <option value={state.finvizTheme}>{zh ? "所选主题已移除" : "Selected theme removed"}</option>}{result.themes.map(t => <option key={t.id} value={t.id}>{parentName(t.id)}</option>)}</select></label>
      <label>{zh ? "时间范围" : "Timeframe"}<select value={state.matrixTimeframe} onChange={e => onChange({ matrixTimeframe: e.target.value as SectorState["matrixTimeframe"] })}>{TIMEFRAMES.map(tf => <option key={tf}>{tf}</option>)}</select></label>
      <button type="button" onClick={() => onChange({ finvizTheme: "", discoveryQuery: "" })}>{zh ? "清除筛选" : "Clear filters"}</button>
    </div>
    <p className={styles.scope} data-testid="finviz-visible-count">{groups.length} / {result.counts.subthemes} {zh ? "子主题可见 · 筛选仅改变显示范围" : "subthemes visible · filters change visibility only"}</p>
    {themeMissing && <p role="status">{zh ? "此版本已不包含所选主题，筛选已保留。" : "The selected theme is absent from this generation; its filter has been preserved."}</p>}
    {selectedTheme && <section className={styles.themeSummary} aria-label={zh ? "主题覆盖" : "Theme coverage"}>
      <div><h3>{parentName(selectedTheme.id)}</h3><p>Finviz · {selectedTheme.id}</p></div>
      <p>{themeGroups.length} {zh ? "子主题" : "subthemes"} · {themeTickers.size} {zh ? "不同股票" : "distinct tickers"} · {themeAppearances} {zh ? "成员归属" : "member appearances"}</p>
      <p>{themeGroups.filter(g => metric(g, state.matrixTimeframe) !== null).length} / {themeGroups.length} {zh ? "子主题有观测" : "subthemes measured"} · {state.matrixTimeframe} · {date}</p>
      <p>{zh ? "成员可能属于多个子主题；未将子主题收益合成为主题收益。" : "Members can belong to several subthemes; subtheme returns are not combined into an invented theme return."}</p>
    </section>}
    <div className={styles.explorer}><div className={styles.inventory} data-testid="finviz-inventory">
    {state.finvizMode === "bubbles" && <><div className={styles.controls}>{(["bubbleX", "bubbleY"] as const).map(key => <label key={key}>{key === "bubbleX" ? (zh ? "X 轴" : "X axis") : (zh ? "Y 轴" : "Y axis")}<select value={state[key]} onChange={e => onChange({ [key]: e.target.value as FinvizAxis })}>{TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf} {zh ? "收益" : "return"}</option>)}<option value="members">{zh ? "成员数" : "Member count"}</option></select></label>)}
      <label>{zh ? "气泡大小" : "Bubble size"}<select value={state.bubbleSize} onChange={e => onChange({ bubbleSize: e.target.value as SectorState["bubbleSize"] })}><option value="members">{zh ? "成员数" : "Member count"}</option><option value="equal">{zh ? "等大" : "Equal size"}</option><option disabled>{zh ? "市值 — 来源未提供" : "Market cap — not supplied"}</option></select></label></div><BubblePlot groups={groups} state={state} select={select} zh={zh} /></>}
    {(state.finvizMode === "heatmap" || state.finvizMode === "clusters") && <>
      {state.finvizMode === "clusters" && <p>{zh ? "按主题归类；位置不代表相关性。" : "Categorical grouping; proximity does not represent correlation."}</p>}
      <div className={styles.hierarchy}>{result.themes.filter(t => groups.some(g => g.parentId === t.id)).map(t => <section key={t.id} className={styles.themeGroup}>
        <h3><button type="button" onClick={() => onChange({ finvizTheme: t.id })}>{parentName(t.id)}</button></h3>
        <div className={state.finvizMode === "clusters" ? styles.cluster : styles.tiles}>{groups.filter(g => g.parentId === t.id).map(g => <button type="button" key={g.id} data-testid="finviz-group" data-source-id={g.id} data-sign={sign(metric(g, state.matrixTimeframe))} aria-pressed={selected?.id === g.id} onClick={() => select(g)} style={state.finvizMode === "heatmap" ? { flexGrow: g.members.length } : undefined}>
          <strong>{g.name}</strong><span>{pct(metric(g, state.matrixTimeframe))}</span><small>{g.members.length} {zh ? "成员" : "members"}</small>
        </button>)}</div>
      </section>)}</div>
    </>}
    {(state.finvizMode === "table" || state.finvizMode === "matrix") && <div className={styles.tableWrap}><table><caption>{zh ? "同一主题全集；破折号表示缺失观测。" : "Same complete inventory; a dash means an unavailable observation."}</caption><thead><tr><th>{zh ? "子主题 / 主题" : "Subtheme / theme"}</th><th>{zh ? "有观测 / 成员" : "Measured / members"}</th>{metrics.map(tf => <th key={tf}>{tf}</th>)}</tr></thead><tbody>{groups.map(g => <tr key={g.id} data-testid="finviz-row" data-source-id={g.id} aria-selected={selected?.id === g.id}><th scope="row"><button type="button" onClick={() => select(g)}>{g.name}</button><small>{parentName(g.parentId)}</small><small className={styles.sourceId}>{g.id}</small></th><td data-label={zh ? "有观测 / 成员" : "Measured / members"}>{g.members.filter(m => m.perf[state.matrixTimeframe] !== null).length} / {g.members.length}<small>{state.matrixTimeframe}</small></td>{metrics.map(tf => <td key={tf} data-label={tf} data-sign={sign(metric(g, tf))}>{pct(metric(g, tf))}</td>)}</tr>)}</tbody></table></div>}
    {!groups.length && <p className={styles.empty}>{zh ? "没有匹配的子主题。" : "No subthemes match these filters."}</p>}
    </div>
    <aside ref={inspectorRef} tabIndex={-1} className={styles.inspector} data-testid="finviz-inspector" aria-label={zh ? "子主题详情" : "Subtheme details"}>
      {!selected ? <p>{state.finvizSubtheme ? (zh ? "所选子主题已不在此版本中；没有自动切换到其他对象。" : "The selected subtheme is absent from this generation; no replacement was selected.") : (zh ? "选择子主题以查看全部成员。" : "Select a subtheme to inspect every member.")}</p> : <>
        <p className={styles.eyebrow}>{parentName(selected.parentId)}</p><h3>{selected.name}</h3><p className={styles.sourceId}>{selected.id}</p><p>{known.length} / {selected.members.length} {zh ? "成员有观测" : "members measured"} · {advancers} {zh ? "上涨" : "advancing"} · {state.matrixTimeframe}</p>
        <div className={styles.members}>{selected.members.map(member => <button type="button" key={member.ticker} aria-pressed={state.company === member.ticker} onClick={() => onChange({ company: member.ticker })}><strong>{member.ticker}</strong><span data-sign={sign(member.perf[state.matrixTimeframe])}>{pct(member.perf[state.matrixTimeframe])}</span></button>)}</div>
        {state.company && selected.members.some(m => m.ticker === state.company) && <p><Link href={companyHref(state.company)!}>{zh ? "研究公司" : "Research company"}: {state.company} →</Link></p>}
        <details><summary>{zh ? "重叠子主题" : "Overlapping subthemes"}</summary>{result.groups.filter(g => g.id !== selected.id && g.members.some(m => selected.members.some(s => s.ticker === m.ticker))).map(g => <button className={styles.overlap} key={g.id} type="button" onClick={() => select(g)}>{parentName(g.parentId)} / {g.name} · {g.members.filter(m => selected.members.some(s => s.ticker === m.ticker)).length}</button>)}</details>
      </>}
    </aside></div>
    <details className={styles.receipt}><summary>{zh ? "来源与覆盖" : "Source and coverage"}</summary><dl>
      <dt>{zh ? "来源" : "Source"}</dt><dd>Finviz · {feed?.receipt.path}</dd><dt>{zh ? "行情日期" : "Market date"}</dt><dd>{date}</dd><dt>{zh ? "生成时间" : "Generated"}</dt><dd>{result.generatedAt || "—"}</dd><dt>{zh ? "读取时间" : "Retrieved"}</dt><dd>{feed?.receipt.observedAt || "—"}</dd><dt>{zh ? "版本指纹" : "Content fingerprint"}</dt><dd>{feed?.receipt.contentHash || "—"}</dd><dt>{zh ? "所选来源标识" : "Selected source identity"}</dt><dd>{selected?.id || "—"}</dd>
    </dl><p>{zh ? "数据源报告的子主题与股票数量已核对。成员版本、未解析成员和缺失组清单仍需来源方确认。" : "Owner-reported subtheme and ticker totals reconcile. Membership vintage, unresolved members and missing-group manifest still require source-owner confirmation."}</p><p>{zh ? "来源标签按原文保留。未提供市值、相关性、历史成员变化或规范主题映射。" : "Source labels are preserved. Capitalization, correlation, historical membership changes and canonical theme mappings are not supplied."}</p><p>{zh ? "仅限内部研究；客户展示权限尚未开放。" : "Internal research only; customer display remains gated."}</p></details>
  </section>;
}
