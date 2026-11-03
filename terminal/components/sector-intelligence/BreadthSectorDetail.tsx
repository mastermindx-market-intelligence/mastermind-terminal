import type { MouseEventHandler } from "react";
import { useLang } from "@/lib/i18n";
import { formatValue, text, type Row } from "@/lib/sectorIntelligence";
import { breadthMove, breadthOvertakes, type BreadthSector, type BreadthWindow } from "@/lib/sectorBreadth";
import styles from "./SectorBreadthBoard.module.css";

interface Props {
  sector: BreadthSector;
  series: BreadthSector[];
  dates: string[] | null;
  horizon: BreadthWindow;
  priorRank: number | null;
  rank: number | null;
  onOpen: MouseEventHandler<HTMLButtonElement>;
}

export default function BreadthSectorDetail({sector, series, dates, horizon, priorRank, rank, onOpen}: Props) {
  const {lang} = useLang();
  const tr = (en: string, zh: string) => lang === "zh" ? zh : en;
  const name = (r: Row) => text(lang === "zh" ? r.name_zh : r.name) || text(r.name) || text(r.ticker);
  const pct = (v: number | null) => formatValue(v, 1, "%");
  const pp = (v: number) => formatValue(v, 1, tr(" pp", " 个百分点"), true);
  const move = breadthMove(sector, horizon);
  const reversals = breadthOvertakes(sector, series);
  const peers = [...reversals.ahead, ...reversals.behind];
  const indices = [0, 4, 5];
  const ticker = text(sector.row.ticker);
  const dateLabel = (date: string) => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    month:"short", day:"numeric", timeZone:"UTC",
  }).format(new Date(date + "T12:00:00Z"));
  return <section className={styles.detail} aria-label={tr("Sector evidence", "板块数据")} data-testid="sector-discovery-selection">
    <header><div><span className={styles.kicker}>{tr("Selected sector", "所选板块")} · {ticker}</span><h4>{name(sector.row)}</h4></div>
      <button type="button" data-sector-return-focus={"discover-open-" + text(sector.row.id)} onClick={onOpen}>{tr("Open sector intelligence", "打开板块情报")} →</button></header>
    {sector.pct === null ? <p>{dates && sector.matched !== null
      ? tr("Matched " + sector.matched + " of " + sector.eligible + " stocks. At least 90% coverage is required to rank.", "可比股票 " + sector.matched + " / " + sector.eligible + "，覆盖率达到90%才参与排名。")
      : tr("The source did not supply a usable participation reading.", "来源尚未提供可用的参与度读数。")}</p> :
    <><dl className={styles.facts}>
      <div><dt>{tr("Advancing", "上涨")}</dt><dd>{sector.adv}</dd></div>
      <div><dt>{tr("Declining", "下跌")}</dt><dd>{sector.dec}</dd></div>
      {dates && <><div><dt>{tr("Unchanged", "持平")}</dt><dd>{sector.flat}</dd></div>
        <div><dt>{tr("Coverage", "覆盖")}</dt><dd>{sector.matched} / {sector.eligible}</dd></div>
        <div><dt>{tr("Rank", "名次")}</dt><dd>#{priorRank} → #{rank}</dd></div>
        <div><dt>{tr("Velocity per session", "每交易日速度")}</dt><dd>{move === null ? "—" : pp(move / horizon)}</dd></div></>}
    </dl>
    {dates && sector.history.length === 6 && <div className={styles.evidence}>
      <figure className={styles.trail}><figcaption>{tr("Advancing share at six closes", "六次收盘上涨占比")}</figcaption>
        <div className={styles.chart}><span className={styles.axis} aria-hidden="true">50%</span>
          <ol>{sector.history.map((v,i) => <li key={dates[i]}>
            <span className={styles.plot} aria-hidden="true"><i style={{height:v + "%"}} /></span>
            <b>{pct(v)}</b><time dateTime={dates[i]} title={dates[i]}>{dateLabel(dates[i])}</time>
          </li>)}</ol></div>
        <p>{tr("Fixed 0–100% scale. Each close uses the same stocks.", "固定0–100%刻度。每次收盘使用同一批股票。")}</p>
      </figure>
      <div className={styles.overtakes}><h5>{tr("Breadth overtakes", "广度名次反转")}</h5>
        <p>{tr("A reversal from five sessions ago must hold at both of the latest closes.", "与五个交易日前相比，反转须连续维持至最近两次收盘。")}</p>
        {peers.length ? <><dl>
          {reversals.ahead.length > 0 && <div><dt>{tr("Overtook", "已超越")}</dt><dd>{reversals.ahead.map(name).join(" · ")}</dd></div>}
          {reversals.behind.length > 0 && <div><dt>{tr("Fell behind", "已落后于")}</dt><dd>{reversals.behind.map(name).join(" · ")}</dd></div>}
        </dl><details><summary>{tr("Compare the three closes", "比较三次收盘读数")}</summary>
          <table><caption className={styles.sr}>{tr("Advancing share by sector and close", "板块收盘上涨占比")}</caption>
            <thead><tr><th scope="col">{tr("Sector", "板块")}</th>{indices.map(i => <th scope="col" key={i}><time dateTime={dates[i]}>{dateLabel(dates[i])}</time></th>)}</tr></thead>
            <tbody>{[sector, ...series.filter(s => peers.includes(s.row))].map(s => <tr key={text(s.row.id)}>
              <th scope="row" title={name(s.row)}>{text(s.row.ticker)}</th>{indices.map(i => <td key={i}>{pct(s.history[i])}</td>)}</tr>)}</tbody>
          </table></details></> : <p>{tr("No confirmed overtake in this window.", "该区间内没有确认的名次反转。")}</p>}
      </div>
    </div>}</>}
  </section>;
}
