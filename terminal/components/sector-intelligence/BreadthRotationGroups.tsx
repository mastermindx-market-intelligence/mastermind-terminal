import { useLang } from "@/lib/i18n";
import { breadthMove, breadthRegime, type BreadthSector, type BreadthWindow } from "@/lib/sectorBreadth";
import { formatValue, text } from "@/lib/sectorIntelligence";
import styles from "./SectorBreadthBoard.module.css";

const LEX = {
  title: ["Breadth rotation", "广度轮动"],
  none: ["None", "无"], sample: ["stocks matched", "只股票可比"],
  key: ["Share rising · change in percentage points", "上涨占比 · 变化以百分点计"],
  noMajority: ["No sector above 50%.", "没有板块超过半数上涨。"],
  summary: ["{b} above 50% · {n} of them losing breadth", "{b} 个板块过半上涨，其中 {n} 个上涨面收窄"],
  "broad-up": ["Majority rising · gaining breadth", "过半上涨 · 上涨面扩大"],
  "broad-down": ["Majority rising · losing breadth", "过半上涨 · 上涨面收窄"],
  "narrow-up": ["Minority rising · gaining breadth", "不足半数上涨 · 上涨面扩大"],
  "narrow-down": ["Minority rising · losing breadth", "不足半数上涨 · 上涨面收窄"],
  even: ["Half rising", "半数上涨"], flat: ["Share unchanged", "上涨占比不变"], unknown: ["No comparison", "无法比较"],
} as const;
const keys = ["broad-up","broad-down","narrow-up","narrow-down","even","flat","unknown"] as const;

type Props = { sectors: readonly BreadthSector[]; horizon: BreadthWindow; dates: readonly string[]; onOpen: (id: string) => void };

export default function BreadthRotationGroups({ sectors, horizon, dates, onOpen }: Props) {
  const zh = useLang().lang === "zh";
  const t = (key: keyof typeof LEX) => LEX[key][zh ? 1 : 0];
  const groups = sectors.map(s => ({s, key:breadthRegime(s,horizon)}));
  const coverageKnown = sectors.length > 0 && sectors.every(s => s.matched !== null && s.eligible !== null);
  const matched = sectors.reduce((n,s) => n + (s.matched ?? 0),0), eligible = sectors.reduce((n,s) => n + (s.eligible ?? 0),0);
  const broad = groups.filter(({s,key}) => key !== "unknown" && s.pct! > 50).length;
  const narrowing = groups.filter(({key}) => key === "broad-down").length;
  return <section className={styles.rotation} id="breadth-rotation-groups" aria-labelledby="breadth-rotation-title">
    <header><h3 id="breadth-rotation-title">{t("title")}</h3><span>{dates[5-horizon]} → {dates[5]}</span></header>
    <p>{broad ? t("summary").replace("{b}",String(broad)).replace("{n}",String(narrowing)) : t("noMajority")}</p>
    <div className={styles.rotationGrid}>{keys.map((key,index) => {
      const members = groups.filter(x => x.key === key).map(x => x.s).sort((a,b) => (b.pct ?? -1)-(a.pct ?? -1) || text(a.row.ticker).localeCompare(text(b.row.ticker)));
      if (index >= 4 && !members.length) return null;
      return <section key={key} className={styles.rotationCell} data-breadth-regime={key}>
        <h4>{t(key)} <b>{members.length}</b></h4>
        {members.length ? <ul>{members.map(s => {
          const ticker=text(s.row.ticker), sectorName=text(zh ? s.row.name_zh : s.row.name)||text(s.row.name)||ticker;
          return <li key={text(s.row.id)}><button type="button" data-sector-return-focus="breadth-rotation" onClick={e => {e.currentTarget.focus({preventScroll:true}); onOpen(text(s.row.id));}}>
            <span>{sectorName}</span><small>{ticker} · {formatValue(s.pct,1,"%")} · {formatValue(breadthMove(s,horizon),1,zh ? " 个百分点" : " pp",true)}</small>
          </button></li>;
        })}</ul> : <p>{t("none")}</p>}
      </section>;
    })}</div>
    <footer>{t("key")}{coverageKnown && eligible > 0 && <span>{matched}/{eligible} {t("sample")}</span>}</footer>
  </section>;
}
