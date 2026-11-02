"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { formatValue, text, type Row } from "@/lib/sectorIntelligence";
import { dailyBreadth, monthlyBreadth, breadthMove, breadthRank, breadthOvertakes, type BreadthSector, type BreadthWindow } from "@/lib/sectorBreadth";
import type { SectorCentralDiscoveryProps } from "./SectorCentralDiscovery";
import shared from "./SectorCentralDiscovery.module.css";
import styles from "./SectorBreadthBoard.module.css";

export default function SectorBreadthBoard(props: SectorCentralDiscoveryProps) {
  const { lang } = useLang();
  const tr = (en: string, zh: string) => lang === "zh" ? zh : en;
  const [window, setWindow] = useState<BreadthWindow>(5);
  const [sort, setSort] = useState("strong");
  const rows = props.status === "ready" ? props.rows : [];
  const daily = props.heatmapStatus === "ready" ? dailyBreadth(props.heatmapData, props.heatmapAsOf, rows) : null;
  const series = daily?.sectors ?? monthlyBreadth(rows);
  const name = (r: Row) => text(lang === "zh" ? r.name_zh : r.name) || text(r.name) || text(r.ticker);
  const levels = series.map(s => s.pct);
  const prior = series.map(s => s.history[5 - window] ?? null);
  const ranked = series.filter(s => s.pct !== null);
  const moves = series.map(s => breadthMove(s, window));
  const delta = (v: number | null) => formatValue(v, 1, tr(" pp", " 个百分点"), true);
  const fmt = (v: number | null) => formatValue(v, 1, "%");
  const rank = (s: BreadthSector) => breadthRank(levels, s.pct);
  const query = props.query.normalize("NFKC").trim().toLowerCase();
  const sortByMove = Boolean(daily) && (sort === "expand" || sort === "contract");
  const direction = sort === "weak" || (sortByMove && sort === "contract") ? 1 : -1;
  const value = (s: BreadthSector) => sortByMove ? breadthMove(s, window) : s.pct;
  const visible = series.filter(s => [s.row.name_zh, s.row.name, s.row.ticker].some(v => text(v).normalize("NFKC").toLowerCase().includes(query)))
    .sort((a,b) => {
      const x = value(a), y = value(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return direction * (x-y) || text(a.row.ticker).localeCompare(text(b.row.ticker));
    });
  const selected = series.find(s => s.row.id === props.selected);
  const reversals = selected ? breadthOvertakes(selected, series) : null;
  function highlight(label: string, values: (number | null)[], high: boolean, movement: boolean) {
    const observed = values.filter((v): v is number => v !== null && (!movement || (high ? v > 0 : v < 0)));
    const extreme = observed.length ? (high ? Math.max(...observed) : Math.min(...observed)) : null;
    const peers = series.filter((_, i) => extreme !== null && values[i] !== null && Math.abs(values[i]! - extreme) < 1e-8);
    const tickers = peers.map(s => text(s.row.ticker));
    return <div className={styles.highlight}><span>{label}</span><strong>{extreme === null ? "—" : movement ? delta(extreme) : fmt(extreme)}</strong>
      <b>{peers.length > 2 ? tr(peers.length + " sectors tied", peers.length + " 个板块并列") : peers.map(s => name(s.row)).join(" · ")}</b>
      <small>{tickers.join(" · ") || (movement && moves.some(v => v !== null) ? tr("None in this window", "此区间内无") : tr("No comparable reading", "无可比读数"))}</small></div>;
  }
  const unavailable = props.status === "loading" ? tr("Loading sector snapshots…", "正在加载板块快照…") : props.status === "access" ? tr("Sector snapshots require access.", "板块快照需要访问权限。") : tr("Sector snapshots are unavailable.", "板块快照暂不可用。");
  return <section className={shared.root} data-testid="sector-discovery">
    <header className={styles.header}><div><span className={styles.eyebrow}>{tr("Sector Central / Participation", "板块中心 / 参与度")}</span>
      <h2>{tr("Breadth leadership", "板块广度排名")}</h2>
      <p>{daily ? tr("Share of matched stocks closing above the previous session’s close.", "收盘高于前一交易日的可比股票占比。")
        : tr("Monthly snapshot · share of moving stocks with a positive one-month return.", "月度快照 · 一个月内价格上涨股票占有涨跌股票的比例。")}</p></div>
      <div className={styles.stamp}>{daily ? tr("Session close", "收盘日期") : tr("Sector snapshot", "板块快照")} <strong>{(daily ? daily.dates[5] : props.asOf) || "—"}</strong>
        <button type="button" onClick={e => { e.currentTarget.focus({ preventScroll: true }); props.onSources(); }}>{tr("Sources", "来源")}</button></div></header>
    {!rows.length ? <p className={shared.empty} role="status">{unavailable}</p> : <>
      <div className={styles.highlights} aria-label={tr("All sectors", "全部板块")}>
        {highlight(tr("Broadest participation", "参与度最高"), levels, true, false)}
        {highlight(tr("Narrowest participation", "参与度最低"), levels, false, false)}
        {highlight(tr("Fastest expansion", "扩张最快"), moves, true, true)}
        {highlight(tr("Fastest contraction", "收缩最快"), moves, false, true)}
      </div>
      <div className={styles.tools}><label>{tr("Find a sector", "查找板块")}<input type="search" value={props.query} maxLength={60} onChange={e => props.onQuery(e.target.value)} /></label>
        <label>{tr("Display order", "排序")}<select value={sortByMove || sort === "weak" ? sort : "strong"} onChange={e => setSort(e.target.value)}>
          <option value="strong">{tr("Highest participation", "参与度降序")}</option><option value="weak">{tr("Lowest participation", "参与度升序")}</option>
          {daily && <><option value="expand">{tr("Fastest expansion", "扩张最快")}</option><option value="contract">{tr("Fastest contraction", "收缩最快")}</option></>}
        </select></label>
        {daily && <label>{tr("Compare closes", "收盘比较")}<select value={window} onChange={e => setWindow(e.target.value === "5" ? 5 : 1)}>
          <option value={1}>{tr("1 session", "1 个交易日")}</option><option value={5}>{tr("5 sessions", "5 个交易日")}</option></select></label>}
        <span role="status">{ranked.length}/{series.length} {tr("sectors ranked", "板块已排名")}</span></div>
      <p className={styles.note}>{daily ? <>{daily.dates[5 - window]} → {daily.dates[5]} · {tr("Change in percentage points. Velocity is average change per trading session.", "变化以百分点计。速度为每个交易日的平均变化。")}</>
        : tr("Comparable daily history is unavailable. Unchanged stocks are excluded from the monthly share.", "暂无可比较的日度历史。月度占比不含价格持平股票。")}</p>
      {!visible.length ? <p role="status">{tr("No sectors match this search.", "没有匹配的板块。")} <button onClick={() => props.onQuery("")}>{tr("Clear search", "清除搜索")}</button></p> :
      <div className={shared.tableWrap + " " + styles.boardTable}><table><caption className={styles.caption}>{tr("Sector participation ranking", "板块参与度排名")}</caption><thead><tr>
        <th>{tr("Sector / rank", "板块 / 排名")}</th><th>{tr("Advancing share", "上涨占比")}</th><th>{tr("Up / down", "上涨 / 下跌")}{daily && tr(" / flat", " / 持平")}</th>
        {daily && <><th>{tr("Change", "变化")}</th><th>{tr("Velocity / session", "每交易日速度")}</th><th>{tr("Prior → now", "此前 → 当前名次")}</th><th>{tr("Coverage", "覆盖")}</th></>}
      </tr></thead><tbody>{visible.map(s => {
        const move = breadthMove(s, window), prevRank = breadthRank(prior, s.history[5-window] ?? null);
        const order = rank(s), id = text(s.row.id);
        return <tr key={id} aria-selected={props.selected === id}><th scope="row"><button type="button" data-sector-choice={id} aria-pressed={props.selected === id}
          aria-label={tr("Select ", "选择") + name(s.row)} onClick={e => { e.currentTarget.focus({ preventScroll: true }); props.onSelect(id); }}><b className={styles.rank}>{order ?? "—"}</b>{name(s.row)}<small>{text(s.row.ticker)}</small></button></th>
          <td data-label={tr("Advancing share", "上涨占比")}><strong>{fmt(s.pct)}</strong><span className={styles.meter} aria-hidden="true">{s.pct !== null && <i style={{width: s.pct + "%"}} />}</span></td>
          <td data-label={daily ? tr("Up / down / flat", "上涨 / 下跌 / 持平") : tr("Up / down", "上涨 / 下跌")}>{s.adv ?? "—"} / {s.dec ?? "—"}{daily && " / " + (s.flat ?? "—")}</td>
          {daily && <><td data-label={tr("Change", "变化")} data-sign={move ? move > 0 ? "up" : "down" : undefined}>{delta(move)}</td>
            <td data-label={tr("Velocity / session", "每交易日速度")}>{delta(move === null ? null : move / window)}</td>
            <td data-label={tr("Prior → now", "此前 → 当前名次")}>{prevRank === null ? "—" : "#" + prevRank + " → #" + order}</td>
            <td data-label={tr("Coverage", "覆盖")}>{s.matched ?? "—"} / {s.eligible ?? "—"}</td></>}
        </tr>;})}</tbody></table></div>}
      {selected && <div className={shared.selectedBar} data-testid="sector-discovery-selection"><div><span>{tr("Selected sector", "所选板块")}</span><strong>{name(selected.row)} · {text(selected.row.ticker)}</strong></div>
        <button type="button" data-sector-return-focus={"discover-open-" + props.selected} onClick={e => { e.currentTarget.focus({ preventScroll: true }); props.onOpenResearch(props.selected); }}>{tr("Open sector intelligence", "打开板块情报")} →</button></div>}
      {daily && selected?.history.length === 6 && reversals && <section className={styles.rotation}>
        <h3>{name(selected.row)} · {tr("Leadership changes", "广度排名变化")}</h3>
        <p>{tr("Compared with five sessions ago, this sector has finished ahead of or behind these peers for two consecutive closes.", "与五个交易日前相比，该板块已连续两个收盘日在以下板块之前或之后。")}</p>
        <dl><div><dt>{tr("Overtook", "已超越")}</dt><dd>{reversals.ahead.map(name).join(" · ") || tr("None", "无")}</dd></div>
          <div><dt>{tr("Fell behind", "已落后于")}</dt><dd>{reversals.behind.map(name).join(" · ") || tr("None", "无")}</dd></div></dl>
      </section>}
      {daily && selected && selected.history.length === 6 && <details className={styles.trail}>
        <summary>{name(selected.row)} · {tr("Six closing readings", "六次收盘读数")}</summary>
        <ol>{selected.history.map((v,i) => <li key={daily.dates[i]}><time dateTime={daily.dates[i]}>{daily.dates[i]}</time><strong>{fmt(v)}</strong></li>)}</ol>
      </details>}
      {daily && <p className={styles.note}>{tr("History uses the heatmap membership at publication. The same stocks must have all seven closes. A sector needs 90% coverage to rank. Unchanged stocks count in the denominator. Ranks compare only measured sectors.", "历史按发布时的热图成员回算。同一批股票必须具备七次收盘价。覆盖达90%的板块才进入排名，持平股票计入分母。仅比较有数据的板块。")}</p>}
    </>}
  </section>;
}
