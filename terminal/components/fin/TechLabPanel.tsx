"use client";

import { memo, useId, useMemo, useState } from "react";
import Link from "next/link";
import { pick } from "../../lib/finFormat";
import { buildLabModel, sortLabSetups, type LabModel, type LabSetup, type LabSort } from "../../lib/techLabView";
import styles from "./TechLabPanel.module.css";

interface TechLabPanelProps { sym: string; intel?: unknown; zh?: boolean }
type EvidenceFilter = "ranked" | "above" | "below" | "unrated";

const FAMILIES: Record<string, [string, string]> = {
  ma_crosses: ["Moving averages", "均线"], pivot_patterns: ["Price pivots", "价格枢轴"],
  rsi_extremes: ["RSI", "RSI"], pattern_recognition: ["Price patterns", "价格形态"],
  bollinger_signals: ["Bollinger bands", "布林带"], trend_regime: ["Trend", "趋势"],
  momentum_breakout: ["Momentum", "动量"], return_z: ["Returns", "收益"],
  strength_flag: ["Relative strength", "相对强度"], fundamental_valuation: ["Valuation", "估值"],
  valuation: ["Valuation", "估值"], insider: ["Insiders", "内部人"],
  ma_stars: ["Moving averages", "均线"], ichimoku: ["Ichimoku", "一目均衡"],
  trend_ribbon: ["Trend ribbon", "趋势带"], rsi_stack: ["RSI stack", "多周期 RSI"],
  trend_strength: ["Trend strength", "趋势强度"], compression: ["Breakouts", "突破"],
  volume_flow: ["Volume", "成交量"], adaptive_trend: ["Adaptive trend", "自适应趋势"],
  atr_adaptive_trend: ["Supertrend", "超级趋势"], rank_trend: ["Trend consistency", "趋势一致性"],
  path_risk: ["Volatility", "波动率"], momentum_context: ["Momentum", "动量"],
  performance: ["Performance", "表现"],
};
const NAMES: Record<string, [string, string]> = {
  return_1d: ["One-day return", "单日收益"],
  valuation_pctile: ["Valuation percentile", "估值百分位"],
  insider_power_state: ["Insider activity score", "内部人活动评分"],
  ichimoku_above_cloud: ["Price above the Ichimoku cloud", "价格位于一目云层上方"],
  ichimoku_tk_cross_up: ["Ichimoku bullish crossover", "一目均衡看涨交叉"],
  ribbon_up: ["Moving-average ribbon trending up", "均线带向上"],
  rsi_stack_curl_up: ["Three RSI periods turning up", "三个周期的 RSI 转升"],
  adx_weak: ["Weak trend / ranging market", "趋势较弱 / 区间震荡"],
  aroon_cross_up: ["Aroon bullish crossover", "阿隆指标看涨交叉"],
  vi_cross_up: ["Vortex bullish crossover", "涡流指标看涨交叉"],
  elder_bulls_dominant: ["Buyers dominating the Elder Ray", "艾尔德力量指标显示买方占优"],
  donch_break_up: ["Price breaking the 20-day high", "价格突破 20 日高点"],
  obv_slope_dn: ["Volume trend pointing down", "成交量趋势向下"],
  kama_slope_up: ["Adaptive moving average rising", "自适应均线上升"],
  er_efficient: ["Efficient price trend", "价格趋势效率较高"],
  st_flip_up: ["Supertrend turning up", "超级趋势转升"],
  st_bull_state: ["Price holding above trend support", "价格保持在趋势支撑上方"],
  sprm_strong_up: ["Consistent upward price trend", "价格持续向上"],
  natr_low: ["Low relative volatility", "相对波动率较低"],
  mom121_pos: ["Positive medium-term momentum", "中期动量为正"],
};
function nameOf(s: LabSetup, zh: boolean) {
  const label = NAMES[s.id];
  return label ? pick(zh, ...label) : (zh && s.nameZh ? s.nameZh : s.name);
}
function familyOf(s: LabSetup, zh: boolean) {
  const label = FAMILIES[s.family];
  return label ? pick(zh, ...label) : s.family.replace(/_/g, " ");
}
const percentage = (v: number | null) => v === null ? "—" : (v * 100).toFixed(1) + "%";
function difference(v: number | null, zh: boolean) {
  if (v === null) return "—";
  const rounded = Math.round(v * 1000) / 10;
  return (rounded > 0 ? "+" : "") + rounded.toFixed(1) + pick(zh, " pp", " 个百分点");
}
const number = (v: number | null, zh: boolean) => v === null ? "—" : v.toLocaleString(zh ? "zh-CN" : "en-US");
function date(value: string | null, zh: boolean, time = false) {
  if (!value) return pick(zh, "Not reported", "未提供");
  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
    ...(time && value.length > 10 ? { hour: "2-digit", minute: "2-digit", timeZoneName: "short" } as const : {}),
  }).format(new Date(value.length === 10 ? value + "T00:00:00Z" : value));
}
function directionLabel(s: LabSetup, zh: boolean) {
  if (s.direction === null) return pick(zh, "Not reported", "未提供");
  return s.direction === 1 ? pick(zh, "Up", "向上") : s.direction === -1 ? pick(zh, "Down", "向下") : pick(zh, "Neutral", "中性");
}
function stateLabel(s: LabSetup, zh: boolean) {
  if (s.contextOnly) return pick(zh, "Context", "背景指标");
  if (s.active === null) return pick(zh, "State unavailable", "状态未提供");
  if (!s.active) return pick(zh, "Inactive", "未触发");
  return s.kind === "event" ? pick(zh, "Event", "事件") : pick(zh, "Ongoing state", "持续状态");
}
function tone(s: LabSetup) { return s.direction === 1 ? styles.up : s.direction === -1 ? styles.down : styles.muted; }

export default memo(TechLabPanel);
function TechLabPanel({ sym, intel = null, zh = false }: TechLabPanelProps) {
  const model = useMemo(() => buildLabModel(sym, intel), [sym, intel]);
  // Ticker changes reset local exploration; no state is persisted or shared with chart markers.
  return <LabWorkspace key={sym} sym={sym} model={model} zh={zh} />;
}

function LabWorkspace({ sym, model, zh }: { sym: string; model: LabModel; zh: boolean }) {
  const [library, setLibrary] = useState(false);
  const [filter, setFilter] = useState<EvidenceFilter>("ranked");
  const [search, setSearch] = useState("");
  const [dir, setDir] = useState("all");
  const [sort, setSort] = useState<LabSort>("lift");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const uid = useId();
  const active = model.setups.filter(s => s.active === true && !s.contextOnly);
  const ranked = active.filter(s => s.comparison);
  const above = ranked.filter(s => s.history.lift! > 0);
  const below = ranked.filter(s => s.history.lift! < 0);
  const unrated = active.filter(s => !s.comparison);
  const candidates = library ? model.setups : filter === "unrated" ? unrated : filter === "above" ? above : filter === "below" ? below : ranked;
  const query = search.trim().toLocaleLowerCase();
  const rows = sortLabSetups(candidates.filter(s =>
    (dir === "all" || String(s.direction) === dir) &&
    (!query || [s.id, s.name, s.nameZh, nameOf(s, zh), familyOf(s, zh)].some(v => v?.toLocaleLowerCase().includes(query))),
  ), sort);
  const chartUrl = "/terminal?symbol=" + encodeURIComponent(sym);
  const changeFilter = (next: EvidenceFilter) => { setFilter(next); setLibrary(false); setOpen(null); };
  const reset = () => { setSearch(""); setDir("all"); setFilter("ranked"); };
  const hasFilters = Boolean(search || dir !== "all" || filter !== "ranked");

  return (
    <section className={styles.panel} aria-label={pick(zh, "Technical Lab", "技术实验室")} data-testid="lab-workspace" data-lab-version="active-setups-v1">
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>{pick(zh, "LAB", "实验室")} <span> / {sym}</span></div>
          <h2>{library ? pick(zh, "Research library", "研究库") : pick(zh, "Active setups", "活跃形态")}</h2>
          <p>{pick(zh, "Compare active conditions and their historical outcomes.", "比较活跃条件及其历史表现。")}</p>
        </div>
        <Link className={styles.chartLink} href={chartUrl} aria-label={pick(zh, "View price chart", "查看价格图表")}><span className={styles.actionLabel}>{pick(zh, "View price chart", "查看价格图表")}</span><span aria-hidden="true">↗</span></Link>
      </header>

      {model.status !== "ready" ? (
        <div className={styles.empty} role="status">
          <h3>{model.status === "unbound" ? pick(zh, "This snapshot cannot be matched to " + sym, "无法确认此快照属于 " + sym) : pick(zh, "No Lab snapshot for " + sym, sym + " 暂无实验室快照")}</h3>
          <p>{pick(zh, "Current setups need a published, symbol-specific Lab evaluation. Explore the price chart while coverage is unavailable.", "当前形态需要该标的已发布的实验室评估。暂无数据时，可先查看价格图表。")}</p>
        </div>
      ) : (
        <>
          <div className={styles.snapshot}>
            <span className={styles.snapshotDot} aria-hidden="true" />
            <span>{pick(zh, "Latest published snapshot", "最近发布的快照")}</span>
            <strong>{date(model.publishedAt, zh, true)}</strong>
          </div>
          <div className={styles.tabs} role="group" aria-label={pick(zh, "Lab view", "实验室视图")}>
            <button type="button" aria-pressed={!library} onClick={() => { setLibrary(false); setOpen(null); }}>
              {pick(zh, "Active setups", "活跃形态")} <span>{active.length}</span>
            </button>
            <button type="button" aria-pressed={library} onClick={() => { setLibrary(true); setOpen(null); }}>
              {pick(zh, "All research", "全部研究")} <span>{model.setups.length}</span>
            </button>
          </div>

          {!library && (
            <div className={styles.summary} role="group" aria-label={pick(zh, "Filter historical evidence", "筛选历史证据")}>
              {([
                ["ranked", ranked.length, pick(zh, "With history", "有历史比较"), styles.neutral],
                ["above", above.length, pick(zh, "Above baseline", "高于基准"), styles.positive],
                ["below", below.length, pick(zh, "Below baseline", "低于基准"), styles.negative],
                ["unrated", unrated.length, pick(zh, "No comparison", "无可用比较"), styles.neutral],
              ] as const).map(([value, total, label, color]) => (
                <button type="button" key={value} className={color} aria-pressed={filter === value} onClick={() => changeFilter(value)}>
                  <span>{label}</span><strong>{total}</strong>
                </button>
              ))}
            </div>
          )}

          <button type="button" className={styles.refineButton} aria-label={pick(zh, "Filter and sort setups", "筛选和排序形态")} aria-expanded={filtersOpen} aria-controls={uid + "-filters"} onClick={() => setFiltersOpen(!filtersOpen)}>
            <span>{pick(zh, "Filter & sort", "筛选与排序")}</span>
            <span>{sort === "recent" ? pick(zh, "Latest trigger", "最近触发") : sort === "history" ? pick(zh, "Most observations", "最多历史记录") : pick(zh, "Historical lift", "历史胜率差")}</span>
            <span aria-hidden="true">{filtersOpen ? "−" : "+"}</span>
          </button>
          <div id={uid + "-filters"} className={styles.toolbar} data-open={filtersOpen}>
            <label className={styles.search}>
              <span className={styles.srOnly}>{pick(zh, "Search setups", "搜索形态")}</span>
              <span aria-hidden="true">⌕</span>
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={pick(zh, "Search a setup or indicator", "搜索形态或指标")} />
            </label>
            <label>
              <span>{pick(zh, "Direction", "方向")}</span>
              <select aria-label={pick(zh, "Direction", "方向")} value={dir} onChange={e => setDir(e.target.value)}>
                <option value="all">{pick(zh, "All directions", "全部方向")}</option>
                <option value="1">{pick(zh, "Up", "向上")}</option>
                <option value="-1">{pick(zh, "Down", "向下")}</option>
                <option value="0">{pick(zh, "Neutral", "中性")}</option>
              </select>
            </label>
            <label>
              <span>{pick(zh, "Sort", "排序")}</span>
              <select aria-label={pick(zh, "Sort", "排序")} value={sort} onChange={e => setSort(e.target.value as LabSort)}>
                <option value="lift">{pick(zh, "Historical lift", "历史胜率差")}</option>
                <option value="recent">{pick(zh, "Latest trigger", "最近触发")}</option>
                <option value="history">{pick(zh, "Most observations", "最多历史记录")}</option>
              </select>
            </label>
          </div>

          <div className={styles.listIntro}>
            <span role="status">{pick(zh, rows.length + (library ? (rows.length === 1 ? " research profile" : " research profiles") : (rows.length === 1 ? " setup" : " setups")), rows.length + (library ? " 项研究" : " 个形态"))}</span>
            <span>{pick(zh, "21 trading days · Pooled survivor-universe history", "21 个交易日 · 幸存者样本的合并历史")}</span>
          </div>
          {library && <p className={styles.contextNote}>{pick(zh, "Context indicators and inactive conditions remain here for research. Only active, discrete setups enter the ranking.", "背景指标和未触发的条件保留供研究；排名仅包含活跃的离散形态。")}</p>}
          {!library && filter === "unrated" && <p className={styles.contextNote}>{pick(zh, "These conditions are active in the source snapshot, but cannot be ranked without a consistent historical comparison.", "这些条件在来源快照中处于活跃状态，但缺少一致的历史比较，无法排名。")}</p>}

          {rows.length === 0 ? (
            <div className={styles.empty} role="status">
              <h3>{hasFilters ? pick(zh, "No setups match these filters", "没有符合筛选条件的形态") : active.length > 0 ? pick(zh, "Active conditions need more evidence", "活跃条件尚缺历史证据") : pick(zh, "No active setups in this snapshot", "此快照中没有活跃形态")}</h3>
              <p>{pick(zh, "Explore all research or adjust the filters to see the available conditions.", "可查看全部研究，或调整筛选以浏览已有条件。")}</p>
              <div className={styles.emptyActions}>
                {hasFilters && <button type="button" onClick={reset}>{pick(zh, "Clear filters", "清除筛选")}</button>}
                <button type="button" onClick={() => { reset(); setLibrary(true); }}>{pick(zh, "Explore all research", "查看全部研究")}</button>
              </div>
            </div>
          ) : (
            <div className={styles.list}>
              <div className={styles.columns} aria-hidden="true">
                <span>{library || filter === "unrated" ? "" : "#"}</span><span>{pick(zh, "Setup / latest trigger", "形态 / 最近触发")}</span>
                <span>{pick(zh, "Direction", "方向")}</span><span>{pick(zh, "21d win rate", "21 日胜率")}</span>
                <span>{pick(zh, "Vs baseline", "相比基准")}</span><span>{pick(zh, "Observations", "历史记录")}</span><span />
              </div>
              <ol className={styles.rows}>
                {rows.map((setup, i) => (
                  <SetupRow key={setup.id} setup={setup} rank={!library && setup.comparison ? i + 1 : null} zh={zh} sym={sym}
                    expanded={open === setup.id} onToggle={() => setOpen(open === setup.id ? null : setup.id)}
                    detailId={uid + "-" + encodeURIComponent(setup.id)} chartUrl={chartUrl} />
                ))}
              </ol>
            </div>
          )}

          {!library && filter !== "unrated" && unrated.length > 0 && (
            <button type="button" className={styles.unrated} onClick={() => changeFilter("unrated")}>
              {pick(zh, unrated.length + (unrated.length === 1 ? " more active condition has no usable historical comparison" : " more active conditions have no usable historical comparison"), "另有 " + unrated.length + " 个活跃条件缺少可用历史比较")} <span aria-hidden="true">→</span>
            </button>
          )}
          <details className={styles.method}>
            <summary>{pick(zh, "How to read this ranking", "如何理解排名")}</summary>
            <p>{pick(zh, "Historical lift is the supplied 21-trading-day win rate minus its direction-matched baseline, in percentage points. Higher values come first; observation count and trigger date break ties. The direction describes the condition, while the lift describes its historical performance.", "历史胜率差为来源提供的 21 个交易日胜率减去同方向基准，以百分点表示。默认差值越高越靠前，同值时按历史记录数和触发日期排序。方向描述形态，差值描述其历史表现。")}</p>
            <p>{pick(zh, "History is pooled across the Lab's surviving research universe. It is descriptive, with potentially overlapping observations; it is not a probability for " + sym + " or evidence of independent confirmation. Publication time is not the latest market-bar time. Open a row to inspect its source definition and trigger dates.", "历史数据合并自实验室的幸存者研究样本，记录可能重叠。这是描述性统计，并非 " + sym + " 的预测概率，也不能视为独立确认。发布时间不代表最新行情时间。展开形态可核查来源定义和触发日期。")}</p>
          </details>
        </>
      )}
      <footer className={styles.footer}><a href="https://www.mastermind-x.com/tech_lab.html" target="_blank" rel="noopener noreferrer">{pick(zh, "Explore the full Technical Lab", "浏览完整技术实验室")} <span aria-hidden="true">↗</span></a></footer>
    </section>
  );
}

function SetupRow({ setup: s, rank, zh, sym, expanded, onToggle, detailId, chartUrl }: {
  setup: LabSetup; rank: number | null; zh: boolean; sym: string; expanded: boolean;
  onToggle: () => void; detailId: string; chartUrl: string;
}) {
  const h = s.history;
  const liftTone = !s.comparison || h.lift === 0 ? styles.muted : h.lift! > 0 ? styles.positive : styles.negative;
  const comparable = s.comparison;
  return (
    <li className={styles.row} data-setup-id={s.id} data-expanded={expanded}>
      <button type="button" className={styles.rowButton} onClick={onToggle} aria-expanded={expanded} aria-controls={detailId} id={detailId + "-button"}>
        <span className={styles.rank}>{rank ?? "—"}</span>
        <span className={styles.setupName}>
          <strong>{nameOf(s, zh)}</strong>
          <span>{familyOf(s, zh)}{s.family ? " · " : ""}{stateLabel(s, zh)}{s.latestFire ? " · " + date(s.latestFire, zh) : ""}<span className={styles.compactHistory}>{h.observations !== null && h.observations > 0 ? " · " + number(h.observations, zh) + pick(zh, " observations", " 条历史记录") : ""}</span></span>
        </span>
        <span className={styles.direction + " " + tone(s)}><span aria-hidden="true">{s.direction === 1 ? "↗" : s.direction === -1 ? "↘" : "—"}</span> {directionLabel(s, zh)}</span>
        <span className={styles.winCell}>
          <strong>{comparable ? percentage(h.wins) : "—"}</strong>
          <small>{comparable ? pick(zh, "Base ", "基准 ") + percentage(h.baseline) : pick(zh, "No comparison", "无可用比较")}</small>
        </span>
        <span className={styles.lift + " " + liftTone}>
          <strong>{comparable ? difference(h.lift, zh) : "—"}</strong>
          <small>{!comparable ? pick(zh, "Unranked", "未排名") : h.lift! > 0 ? pick(zh, "Above baseline", "高于基准") : h.lift! < 0 ? pick(zh, "Below baseline", "低于基准") : pick(zh, "At baseline", "与基准相同")}</small>
        </span>
        <span className={styles.observations}>{number(h.observations, zh)}</span>
        <span className={styles.chevron} aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div id={detailId} className={styles.detail} role="region" aria-labelledby={detailId + "-button"}>
          <div className={styles.detailMain}>
            <div>
              <h3>{pick(zh, "What this condition means", "此条件的含义")}</h3>
              <p>{zh && s.nameZh ? s.nameZh : s.name}</p>
              <div className={styles.sourceId}>{s.id}</div>
              <p className={styles.muted}>{s.contextOnly
                ? pick(zh, "This is a context indicator, not a discrete setup for the active ranking.", "这是背景指标，不是活跃排名中的离散形态。")
                : s.active === true ? pick(zh, "Reported active in the published snapshot. The source does not provide the latest evaluated market-bar timestamp or current indicator value.", "在已发布的快照中处于活跃状态。来源未提供最近评估的行情时间或当前指标数值。")
                  : pick(zh, "Not reported active in this snapshot. Historical triggers do not establish a current setup.", "此快照未报告活跃状态。历史触发不代表当前形态。")}</p>
            </div>
            <div>
              <h3>{pick(zh, "Recent triggers for " + sym, sym + " 的近期触发")}</h3>
              {s.fires.length ? <div className={styles.dates}>{s.fires.slice(-6).reverse().map(d => <time dateTime={d} key={d}>{date(d, zh)}</time>)}</div>
                : <p className={styles.muted}>{pick(zh, "No dated triggers supplied.", "未提供带日期的触发记录。")}</p>}
              <p className={styles.muted}>{pick(zh, "Dates mark source-reported events or state transitions, not time held in a trade.", "日期表示来源报告的事件或状态转变，并非持仓时长。")}</p>
              <Link className={styles.chartLink} href={chartUrl}>{pick(zh, "Inspect " + sym + " on chart", "在图表中查看 " + sym)} <span aria-hidden="true">↗</span></Link>
            </div>
          </div>
          <div className={styles.history}>
            <h3>{pick(zh, "Historical comparison", "历史比较")}</h3>
            <p className={styles.historyScope}>{pick(zh, "Pooled research universe · 21 trading days · " + directionLabel(s, false).toLowerCase() + " direction", "研究样本合并统计 · 21 个交易日 · " + directionLabel(s, true))}</p>
            {comparable ? (
              <>
                <div className={styles.rateLine}><span>{pick(zh, "After this setup", "此形态之后")}</span><strong>{percentage(h.wins)}</strong></div>
                <div className={styles.track}><span style={{ width: (h.wins! * 100) + "%" }} /></div>
                <div className={styles.rateLine}><span>{pick(zh, "Direction-matched baseline", "同方向基准")}</span><strong>{percentage(h.baseline)}</strong></div>
                <div className={styles.track + " " + styles.baseTrack}><span style={{ width: (h.baseline! * 100) + "%" }} /></div>
                <p className={liftTone}>{difference(h.lift, zh)} {pick(zh, "versus baseline", "相比基准")}</p>
                <dl>
                  <div><dt>{pick(zh, "Historical observations", "历史记录")}</dt><dd>{number(h.observations, zh)}</dd></div>
                  {h.months !== null && <div><dt>{pick(zh, "Months with observations", "有记录的月份")}</dt><dd>{number(h.months, zh)}</dd></div>}
                  {h.excursionRatio !== null && <div><dt>{pick(zh, "Median favorable / adverse excursion", "有利 / 不利波动幅度中位比")}</dt><dd>{h.excursionRatio.toFixed(2)}</dd></div>}
                  {h.pre2010 !== null && <div><dt>{pick(zh, "Win rate before 2010", "2010 年前胜率")}</dt><dd>{percentage(h.pre2010)}</dd></div>}
                  {h.post2010 !== null && <div><dt>{pick(zh, "Win rate from 2010", "2010 年起胜率")}</dt><dd>{percentage(h.post2010)}</dd></div>}
                </dl>
              </>
            ) : <p>{s.inconsistent ? pick(zh, "The supplied profile fields disagree. This condition is excluded from historical ranking until the source is consistent.", "来源档案字段存在冲突。在来源一致前，此条件不参与历史排名。") : pick(zh, "The source has not supplied a complete win rate, baseline and observation count for this condition.", "来源尚未提供此条件完整的胜率、基准和历史记录数。")}</p>}
          </div>
        </div>
      )}
    </li>
  );
}
