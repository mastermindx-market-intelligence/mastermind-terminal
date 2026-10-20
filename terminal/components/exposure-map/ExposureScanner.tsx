"use client";
import { exposureMapT } from "./exposureMapStrings";
import { useEffect, useMemo, useState } from "react";
import { flowGetResult, flowInvalidate } from "@/lib/flowClientCache";
import { parseGlanceIndex, type GlanceIndex } from "@/lib/mscGlance";
import { quadBoard, type QuadBoard, type QuadPayload } from "@/lib/quadBoard";
import { isObservedSession } from "@/lib/exposureWorkspace";
import { exposureValue } from "@/lib/exposureMap";
import { useLang } from "@/lib/i18n";
import styles from "./ExposureMap.module.css";

/** The existing cross-root index is the scanner owner. Full books load on drill-down. */
export default function ExposureScanner({ onOpen }: { onOpen: (root: string) => void }) {
  const { lang } = useLang(); const zh = lang === "zh"; const t = useMemo(() => exposureMapT(lang), [lang]);
  const [stored, setStored] = useState<{ request:number; today: string; index: GlanceIndex | null; ranks: QuadBoard; failed: boolean } | null>(null);
  const [request, refresh] = useState(0);
  const data = stored?.request === request ? stored : null;
  const loading = data == null;
  const [filter, setFilter] = useState(""), [sort, setSort] = useState("distance"), [sign, setSign] = useState("all");
  useEffect(() => {
    let active = true;
    if (request) { flowInvalidate("gexstate_index"); flowInvalidate("quad"); }
    void Promise.all([flowGetResult("gexstate_index"), flowGetResult("quad")]).then(([index, ranks]) => {
      if (!active) return;
      setStored({ request, today: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }), index: parseGlanceIndex(index.status === "data" ? index.data : null), ranks: quadBoard(ranks.status === "data" ? ranks.data as QuadPayload : null), failed: index.status === "unavailable" });
    });
    return () => { active = false; };
  }, [request]);
  const withheld = [...(data?.index?.rows ?? [])].filter(([, row]) => !isObservedSession(row.asofDate, data!.today)).length;
  const rows = useMemo(() => [...(data?.index?.rows ?? [])].filter(([, row]) => isObservedSession(row.asofDate, data!.today)).map(([root, row]) => {
    const candidate = data?.ranks.rows.find(r => r.root === root);
    // Rank-build time cannot stand in for the constituent's source session.
    // Withhold older, future, missing and malformed rank dates from this join.
    const rank = candidate?.asof === row.asofDate && isObservedSession(candidate?.asof, data!.today) ? candidate : null;
    const levels = [{ name: t("callWall"), price: row.callWall }, { name: t("putWall"), price: row.putWall }, { name: t("gammaFlip"), price: row.gammaFlip }]
      .filter((l): l is {name:string;price:number} => l.price != null && l.price > 0 && row.spot != null && row.spot > 0).sort((a,b) => Math.abs(a.price - row.spot!) - Math.abs(b.price - row.spot!));
    const near = levels[0] ?? null, distance = near && row.spot ? (near.price / row.spot - 1) * 100 : null;
    return { root, row, rank, near, distance };
  }).filter(r => r.root.includes(filter.toUpperCase().trim()) && (sign === "all" || (r.row.netGexBn != null && (sign === "positive" ? r.row.netGexBn > 0 : r.row.netGexBn < 0)))).sort((a,b) => {
    const value = (r: typeof a) => sort === "gamma" ? (r.row.netGexBn == null ? null : Math.abs(r.row.netGexBn)) : sort === "rank" ? r.rank?.gamma_pctile ?? null : r.distance == null ? null : Math.abs(r.distance);
    const av = value(a), bv = value(b);
    if (av == null || bv == null) return av == null ? bv == null ? a.root.localeCompare(b.root) : 1 : -1;
    return (sort === "distance" ? av - bv : bv - av) || a.root.localeCompare(b.root);
  }), [data, filter, sort, sign, t]);
  return <section className={styles.board} data-testid="exposure-scanner"><header className={styles.sectionHead}><div><span className={styles.eyebrow}>{t("crossMarketStructure")}</span><h2>{t("findTheStructureWorthInvestigating")}</h2><p className={styles.note}>{t("publishedStructureIndexAndOwnHistoryRanksEach")}</p></div><button type="button" disabled={loading} onClick={() => refresh(n => n + 1)}>{loading ? (t("reading")) : (t("refreshScan"))}</button></header>
    <div className={styles.toolbar}><input value={filter} onChange={e => setFilter(e.target.value)} aria-label={t("filterSymbols")} placeholder={t("filterSymbols")} /><select value={sign} onChange={e => setSign(e.target.value)} aria-label={t("gammaSign")}><option value="all">{t("allBooks")}</option><option value="positive">{t("positiveNetGamma")}</option><option value="negative">{t("negativeNetGamma")}</option></select><select value={sort} onChange={e => setSort(e.target.value)} aria-label={t("scannerRanking")}><option value="distance">{t("nearestPublishedLevel")}</option><option value="gamma">{t("largestAbsoluteNetGamma")}</option><option value="rank">{t("highestOwnHistoryRank")}</option></select><span className={styles.note}>{rows.length} {t("instruments")}</span></div>
    {!loading && !data?.index && <p role="status" className={styles.empty}>{data?.failed ? (t("theStructureIndexCouldNotBeReadRetry")) : (t("noPublishedStructureIndexIsAvailable"))}</p>}
    {withheld > 0 && <p role="status" className={styles.note}>{zh ? `${withheld} 个标的因来源日期缺失、无效或尚未发生而隐藏。` : `${withheld} instruments withheld because their source session is missing, invalid, or in the future.`}</p>}
    <div className={styles.scanScroll}><table className={styles.scanTable}><thead><tr>{(zh ? ["标的", "账簿日期", "参考现价", "最近关键位", "距离", "净 Gamma / 十亿", "Gamma 分位数", "Vanna 分位数", "历史样本"] : ["Instrument", "Book session", "Reference spot", "Nearest level", "Distance", "Net gamma / $bn", "Gamma rank", "Vanna rank", "History"]).map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.root}><td><button type="button" onClick={() => onOpen(r.root)}>{r.root} ↗</button></td><td>{r.row.asofDate ?? "—"}</td><td>{exposureValue(r.row.spot)}</td><td>{r.near ? <>{r.near.price}<small> · {r.near.name}</small></> : "—"}</td><td>{r.distance == null ? "—" : `${exposureValue(r.distance)}%`}</td><td data-sign={(r.row.netGexBn ?? 0) < 0 ? "negative" : "positive"}>{exposureValue(r.row.netGexBn)}</td><td>{r.rank ? `${exposureValue(r.rank.gamma_pctile,1)}%` : "—"}</td><td>{r.rank ? `${exposureValue(r.rank.vanna_pctile,1)}%` : "—"}</td><td>{r.rank ? `${r.rank.n_days} ${t("days")}` : "—"}</td></tr>)}</tbody></table></div>
    <p className={styles.note}>{t("rankSnapshot")}: {data?.ranks.asof ?? "—"} · {t("percentileWindow")}: {data?.ranks.pctileWindowDays ?? "—"} · {data?.ranks.skipped.length ?? 0} {t("excludedForInsufficientHistoryALowPercentileDoes")}</p>
  </section>;
}
