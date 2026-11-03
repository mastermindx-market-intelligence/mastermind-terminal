import { useLang } from "@/lib/i18n";
import { breadthMove, breadthRegime, type BreadthSector, type BreadthWindow } from "@/lib/sectorBreadth";
import { formatValue, text } from "@/lib/sectorIntelligence";
import styles from "./SectorBreadthBoard.module.css";

const labels = {
  "broad-up": ["Broad and widening", "多数上涨，广度扩大"],
  "broad-down": ["Broad but narrowing", "多数上涨，广度收窄"],
  "narrow-up": ["Narrow but widening", "少数上涨，广度扩大"],
  "narrow-down": ["Narrow and narrowing", "少数上涨，广度收窄"],
  even: ["Exactly half advancing", "刚好半数上涨"],
  flat: ["Unchanged share", "上涨占比持平"],
  unknown: ["No comparable reading", "缺少可比数据"],
} as const;
const keys = Object.keys(labels) as (keyof typeof labels)[];

type Props = { sectors: readonly BreadthSector[]; horizon: BreadthWindow; dates: readonly string[]; onOpen: (id: string) => void };

export default function BreadthRotationGroups({ sectors, horizon, dates, onOpen }: Props) {
  const zh = useLang().lang === "zh";
  const groups = sectors.map(s => ({s, key:breadthRegime(s,horizon)}));
  const coverageKnown = sectors.length > 0 && sectors.every(s => s.matched !== null && s.eligible !== null);
  const matched = sectors.reduce((n,s) => n + (s.matched ?? 0),0), eligible = sectors.reduce((n,s) => n + (s.eligible ?? 0),0);
  const broad = groups.filter(({s,key}) => key !== "unknown" && s.pct! > 50).length;
  const narrowing = groups.filter(({key}) => key === "broad-down").length;
  return <section className={styles.rotation} id="breadth-rotation-groups" aria-labelledby="breadth-rotation-title">
    <header><h3 id="breadth-rotation-title">{zh ? "广度轮动" : "Breadth rotation"}</h3><span>{dates[5-horizon]} → {dates[5]}</span></header>
    <p>{broad ? zh ? `${broad} 个板块中有过半股票上涨，其中 ${narrowing} 个板块的上涨占比下降。`
      : `${broad} ${broad === 1 ? "sector had" : "sectors had"} a majority advancing. ${narrowing} of those ${broad} lost breadth.`
      : zh ? "可比板块中，没有板块的上涨股票占比超过一半。" : "No measured sector had a majority advancing."}</p>
    <div className={styles.rotationGrid}>{keys.map((key,index) => {
      const members = groups.filter(x => x.key === key).map(x => x.s).sort((a,b) => (b.pct ?? -1)-(a.pct ?? -1) || text(a.row.ticker).localeCompare(text(b.row.ticker)));
      if (index >= 4 && !members.length) return null;
      return <section key={key} className={styles.rotationCell} data-breadth-regime={key}>
        <h4>{labels[key][zh ? 1 : 0]} <b>{members.length}</b></h4>
        {members.length ? <ul>{members.map(s => {
          const ticker=text(s.row.ticker), sectorName=text(zh ? s.row.name_zh : s.row.name)||text(s.row.name)||ticker;
          return <li key={text(s.row.id)}><button type="button" data-sector-return-focus="breadth-rotation" onClick={e => {e.currentTarget.focus({preventScroll:true}); onOpen(text(s.row.id));}}>
            <span>{sectorName}</span><small>{ticker} · {formatValue(s.pct,1,"%")} · {formatValue(breadthMove(s,horizon),1,zh ? " 个百分点" : " pp",true)}</small>
          </button></li>;
        })}</ul> : <p>{zh ? "无板块" : "No sectors"}</p>}
      </section>;
    })}</div>
    <footer>{zh ? "“多数”指上涨股票占比超过一半。变化使用同一批股票的收盘价。" : "Broad means more than half advancing. Change compares the same stocks at both closes."}{coverageKnown && eligible > 0 && <span>{matched}/{eligible} {zh ? "只股票可比" : "stocks matched"}</span>}</footer>
  </section>;
}
