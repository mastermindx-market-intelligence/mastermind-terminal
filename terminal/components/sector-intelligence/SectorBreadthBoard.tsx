"use client";

import { Fragment, useState } from "react";
import { useLang } from "@/lib/i18n";
import { formatValue, text, type Row, type SectorBreadthSort } from "@/lib/sectorIntelligence";
import { breadthMove, breadthRank, dailyBreadth, monthlyBreadth, type BreadthSector } from "@/lib/sectorBreadth";
import type { SectorCentralDiscoveryProps } from "./SectorCentralDiscovery";
import BreadthRotationGroups from "./BreadthRotationGroups";
import BreadthSectorDetail from "./BreadthSectorDetail";
import styles from "./SectorBreadthBoard.module.css";

const pct = (value: number | null) => formatValue(value, 1, "%");

export default function SectorBreadthBoard(props: SectorCentralDiscoveryProps) {
  const { lang } = useLang();
  const tr = (en: string, zh: string) => lang === "zh" ? zh : en;
  const name = (row: Row) => text(lang === "zh" ? row.name_zh : row.name) || text(row.name) || text(row.ticker);
  const delta = (v: number | null) => formatValue(v, 1, tr(" pp", " 个百分点"), true);
  const [rotationOpen, setRotationOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<string | null>(null);
  const rows = props.status === "ready" ? props.rows : [];
  const daily = props.heatmapStatus === "ready" ? dailyBreadth(props.heatmapData, props.heatmapAsOf, rows) : null;
  const series = daily?.sectors ?? monthlyBreadth(rows);
  const horizon = props.breadthWindow;
  const levels = series.map(s => s.pct);
  const prior = series.map(s => s.history[5 - horizon] ?? null);
  const moves = series.map(s => breadthMove(s, horizon));
  const ranked = levels.filter(v => v !== null).length;
  const majority = levels.filter(v => v !== null && v > 50).length;
  const expanding = moves.filter(v => v !== null && v > 0).length;
  const contracting = moves.filter(v => v !== null && v < 0).length;
  const flat = moves.filter(v => v === 0).length;
  const ambiguous = new Set(rows.map(r => r.ticker)).size !== rows.length;
  const coverage = daily && series.length > 0 && series.every(s => s.matched !== null && s.eligible !== null)
    ? series.reduce((sum, s) => ({matched: sum.matched + s.matched!, eligible: sum.eligible + s.eligible!}), {matched:0, eligible:0})
    : null;
  const query = props.query.normalize("NFKC").trim().toLowerCase();
  const sort = !daily && (props.breadthSort === "expand" || props.breadthSort === "contract") ? "strong" : props.breadthSort;
  const sortValue = (s: BreadthSector) => sort === "expand" || sort === "contract" ? breadthMove(s, horizon) : s.pct;
  const visible = series.filter(s => [s.row.name, s.row.name_zh, s.row.ticker].some(
    v => text(v).normalize("NFKC").toLowerCase().includes(query)
  )).sort((a, b) => {
    const x = sortValue(a), y = sortValue(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const diff = sort === "weak" || sort === "contract" ? x - y : y - x;
    return diff || text(a.row.ticker).localeCompare(text(b.row.ticker));
  });

  function readout(order: SectorBreadthSort, label: string) {
    const movement = order === "expand" || order === "contract";
    const high = order === "strong" || order === "expand";
    const values = movement ? moves : levels;
    const candidates = values.filter((v): v is number => v !== null && (!movement || (high ? v > 0 : v < 0)));
    const extreme = candidates.length ? (high ? Math.max(...candidates) : Math.min(...candidates)) : null;
    const peers = series.filter((_, i) => extreme !== null && values[i] !== null && Math.abs(values[i]! - extreme) < 1e-8);
    const first = peers[0];
    let detail = "";
    if (peers.length > 1) detail = peers.map(s => text(s.row.ticker)).join(" · ");
    else if (first && movement) detail = pct(first.history[5 - horizon]) + " → " + pct(first.pct);
    else if (first) detail = first.adv + " / " + (daily ? first.matched : first.adv! + first.dec!) + tr(" advancing", " 上涨");
    else detail = ranked && movement ? tr("No move in this direction", "此方向暂无变化") : tr("Insufficient observations", "观测不足");
    return <button type="button" className={styles.readout} data-readout={order} aria-pressed={sort === order}
      disabled={!peers.length} onClick={() => props.onBreadthSort(order)}>
      <span className={styles.kicker}>{label}</span>
      <strong>{peers.length > 2 ? tr(peers.length + " sectors tied", peers.length + " 个板块并列") : peers.map(s => name(s.row)).join(" · ") || "—"}</strong>
      <b data-direction={movement && extreme !== null ? order : undefined}>{movement ? delta(extreme) : pct(extreme)}</b>
      <small>{detail}</small>
    </button>;
  }

  const session = daily?.dates[5] ?? props.asOf;
  const loadingHistory = rows.length > 0 && props.heatmapStatus === "loading";
  const unavailable = props.status === "loading" ? tr("Loading sector snapshots…", "正在加载板块快照…")
    : props.status === "access" ? tr("Sector snapshots require access.", "板块快照需要访问权限。")
    : tr("Sector snapshots are unavailable.", "板块快照暂不可用。");
  return <section className={styles.root} data-testid="sector-discovery">
    <header className={styles.header}>
      <div><h2>{tr("Breadth leadership", "板块广度排名")}</h2>
        <p>{!rows.length || loadingHistory ? tr("Compare stock participation across sectors.", "比较各板块的股票参与度。")
          : daily ? tr("Share of matched stocks above their previous close.", "同一批股票中收盘高于前一交易日的比例。")
          : tr("Monthly snapshot · share of moving stocks with a positive one-month return.", "月度快照 · 一个月内价格上涨股票占有涨跌股票的比例。")}</p></div>
      <div className={styles.receipt}><span>{daily ? tr("Session close", "收盘日期") : tr("Snapshot", "快照")}</span>
        {session ? <time dateTime={session}>{session}</time> : <span>—</span>}
        {daily && !ambiguous && ranked > 0 && <button type="button" data-sector-return-focus="breadth-rotation" aria-expanded={rotationOpen}
          aria-controls={rotationOpen ? "breadth-rotation-groups" : undefined} onClick={() => setRotationOpen(v => !v)}>{tr("Rotation groups", "轮动分组")}</button>}
        <button type="button" onClick={e => { e.currentTarget.focus({preventScroll:true}); props.onSources(); }}>{tr("Sources", "来源")}</button></div>
    </header>
    {ambiguous ? <p className={styles.message} role="status">{tr("Sector records share a ticker. Rankings are unavailable until the source identities agree.", "板块记录之间存在重复代码。待来源标识一致后再显示排名。")}</p> : !rows.length || loadingHistory ? <p className={styles.message} role="status" aria-busy={loadingHistory || props.status === "loading"}>{loadingHistory ? tr("Loading closing comparisons…", "正在加载收盘比较…") : unavailable}</p> : <>
      <div className={styles.brief} aria-label={tr("All sectors", "全部板块")}>
        <section className={styles.briefGroup}><h3>{daily ? tr("Participation at the close", "收盘参与度") : tr("Monthly participation", "月度参与度")}</h3>
          <div className={styles.pair}>{readout("strong", tr("Broadest", "最广"))}{readout("weak", tr("Narrowest", "最窄"))}</div>
          {ranked > 0 && <p className={styles.summaryLine}>{tr(majority + " of " + ranked + " ranked sectors above 50% advancing", "上涨占比超过50%的板块：" + majority + " / " + ranked)}</p>}
        </section>
        {daily && <section className={styles.briefGroup}><div className={styles.groupTitle}>
          <h3>{tr("Change in participation", "参与度变化")}</h3>
          <label className={styles.window}><span className={styles.sr}>{tr("Compare closes", "收盘比较")}</span>
            <select value={horizon} onChange={e => props.onBreadthWindow(e.target.value === "1" ? 1 : 5)}>
              <option value="1">{tr("1 session", "1 个交易日")}</option><option value="5">{tr("5 sessions", "5 个交易日")}</option>
            </select></label></div>
          <div className={styles.pair}>{readout("expand", tr("Fastest expansion", "扩张最快"))}{readout("contract", tr("Fastest contraction", "收缩最快"))}</div>
          {ranked > 0 && <p className={styles.summaryLine}>{tr(expanding + " expanding · " + contracting + " contracting · " + flat + " flat", expanding + " 个扩张 · " + contracting + " 个收缩 · " + flat + " 个持平")}</p>}
        </section>}
      </div>
      {rotationOpen && daily && ranked > 0 && <BreadthRotationGroups sectors={series} horizon={horizon} dates={daily.dates} onOpen={props.onOpenResearch} />}
      {!daily && <p className={styles.note}>{tr("Comparable daily history is unavailable. Unchanged stocks are excluded from the monthly share.", "暂无可比较的日度历史。月度占比不含价格持平股票。")}</p>}
      <div className={styles.bar}><div><h3>{tr("Sector ranking", "板块排名")}</h3>
        <span role="status">{query ? visible.length + " / " + series.length + " " + tr("shown", "个已显示") : ranked + "/" + series.length + " " + tr("sectors ranked", "板块已排名")}</span>
        {coverage && coverage.eligible > 0 && <span className={styles.sample}>{coverage.matched}/{coverage.eligible} {tr("stocks matched", "只股票可比")}</span>}</div>
        <div className={styles.filters}>
          <input type="search" aria-label={tr("Find a sector", "查找板块")} placeholder={tr("Find sector or ticker", "输入板块或代码")} value={props.query} maxLength={60} onChange={e => props.onQuery(e.target.value)} />
          <select aria-label={tr("Display order", "排序")} value={sort} onChange={e => props.onBreadthSort(e.target.value as SectorBreadthSort)}>
            <option value="strong">{tr("Highest participation", "参与度降序")}</option><option value="weak">{tr("Lowest participation", "参与度升序")}</option>
            {daily && <><option value="expand">{tr("Fastest expansion", "扩张最快")}</option><option value="contract">{tr("Fastest contraction", "收缩最快")}</option></>}
          </select>
        </div>
      </div>
      {visible.length === 0 ? <div className={styles.message} role="status">{tr("No sectors match this search.", "没有匹配的板块。")}
        <button onClick={() => props.onQuery("")}>{tr("Clear search", "清除搜索")}</button></div> :
      <div className={styles.tableFrame}><table className={styles.table}>
        <caption className={styles.sr}>{tr("Sector participation ranking", "板块参与度排名")}</caption>
        <thead><tr><th scope="col">{tr("Sector / rank", "板块 / 排名")}</th><th scope="col">{tr("Advancing", "上涨占比")}</th>
          {daily && <th scope="col">{tr("Change", "变化")}<small>{horizon}{tr(" session", " 个交易日")}{lang !== "zh" && horizon > 1 ? "s" : ""}</small></th>}
          <th scope="col" className={styles.wide}>{daily ? tr("Up / down / flat", "上涨 / 下跌 / 持平") : tr("Up / down", "上涨 / 下跌")}</th>
          {daily && <><th scope="col" className={styles.wide}>{tr("Velocity", "变化速度")}<small>{tr("pp / session", "百分点 / 交易日")}</small></th>
            <th scope="col" className={styles.wide}>{tr("Prior → now", "此前 → 当前")}</th><th scope="col" className={styles.wide}>{tr("Coverage", "覆盖")}</th></>}
        </tr></thead><tbody>{visible.map(s => {
          const id = text(s.row.id), chosen = id === props.selected, expanded = chosen && collapsed !== id;
          const order = breadthRank(levels, s.pct), prevRank = breadthRank(prior, s.history[5 - horizon] ?? null);
          const move = breadthMove(s, horizon), panelId = "breadth-evidence-" + id;
          return <Fragment key={id}><tr className={styles.sectorRow} data-selected={chosen || undefined}>
            <th scope="row"><button type="button" data-sector-choice={id} aria-pressed={chosen} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
              aria-label={tr("Inspect ", "查看") + name(s.row)} onClick={e => {
                e.currentTarget.focus({preventScroll:true});
                setCollapsed(expanded ? id : null);
                if (!chosen) props.onSelect(id);
              }}><span className={styles.rank}>{order ?? "—"}</span><span className={styles.identity}><strong>{name(s.row)}</strong><small>{text(s.row.ticker)}</small></span>
                <span aria-hidden="true" className={styles.chevron}>{expanded ? "−" : "+"}</span></button></th>
            <td><b>{pct(s.pct)}</b><span className={styles.meter} aria-hidden="true">{s.pct !== null && <i style={{width:s.pct + "%"}} />}</span></td>
            {daily && <td data-direction={move ? move > 0 ? "expand" : "contract" : undefined}>{delta(move)}</td>}
            <td className={styles.wide}>{s.adv ?? "—"} / {s.dec ?? "—"}{daily && " / " + (s.flat ?? "—")}</td>
            {daily && <><td className={styles.wide}>{delta(move === null ? null : move / horizon)}</td>
              <td className={styles.wide}>{prevRank === null ? "—" : "#" + prevRank + " → #" + order}</td>
              <td className={styles.wide}>{s.matched ?? "—"} / {s.eligible ?? "—"}</td></>}
          </tr>
          {expanded && <tr className={styles.detailRow}><td colSpan={daily ? 7 : 3} id={panelId}>
            <BreadthSectorDetail sector={s} series={series} dates={daily?.dates ?? null} horizon={horizon} priorRank={prevRank} rank={order}
              onOpen={e => { e.currentTarget.focus({preventScroll:true}); props.onOpenResearch(id); }} />
          </td></tr>}</Fragment>;
        })}</tbody></table></div>}
      {daily && <p className={styles.note}>{daily.dates[5 - horizon]} → {daily.dates[5]} · {tr("Change uses unrounded shares and is shown in percentage points. Rankings require 90% matched coverage. Flat stocks count in the denominator.", "变化按未取整的占比计算，以百分点显示。覆盖率达到90%才参与排名，持平股票计入分母。")}</p>}
    </>}
  </section>;
}
