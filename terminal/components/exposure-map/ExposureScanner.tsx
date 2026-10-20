"use client";
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
  const { lang } = useLang(); const zh = lang === "zh";
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
    const levels = [{ name: zh ? "看涨墙" : "Call wall", price: row.callWall }, { name: zh ? "看跌墙" : "Put wall", price: row.putWall }, { name: zh ? "Gamma 翻转" : "Gamma flip", price: row.gammaFlip }]
      .filter((l): l is {name:string;price:number} => l.price != null && l.price > 0 && row.spot != null && row.spot > 0).sort((a,b) => Math.abs(a.price - row.spot!) - Math.abs(b.price - row.spot!));
    const near = levels[0] ?? null, distance = near && row.spot ? (near.price / row.spot - 1) * 100 : null;
    return { root, row, rank, near, distance };
  }).filter(r => r.root.includes(filter.toUpperCase().trim()) && (sign === "all" || (r.row.netGexBn != null && (sign === "positive" ? r.row.netGexBn > 0 : r.row.netGexBn < 0)))).sort((a,b) => {
    const value = (r: typeof a) => sort === "gamma" ? (r.row.netGexBn == null ? null : Math.abs(r.row.netGexBn)) : sort === "rank" ? r.rank?.gamma_pctile ?? null : r.distance == null ? null : Math.abs(r.distance);
    const av = value(a), bv = value(b);
    if (av == null || bv == null) return av == null ? bv == null ? a.root.localeCompare(b.root) : 1 : -1;
    return (sort === "distance" ? av - bv : bv - av) || a.root.localeCompare(b.root);
  }), [data, filter, sort, sign, zh]);
  return <section className={styles.board} data-testid="exposure-scanner"><header className={styles.sectionHead}><div><span className={styles.eyebrow}>{zh ? "跨市场结构" : "CROSS-MARKET STRUCTURE"}</span><h2>{zh ? "发现值得调查的结构" : "Find the structure worth investigating"}</h2><p className={styles.note}>{zh ? "现有结构指数与自身历史分位数。每行保留来源日期。" : "Published structure index and own-history ranks. Each instrument retains its source session."}</p></div><button type="button" disabled={loading} onClick={() => refresh(n => n + 1)}>{loading ? (zh ? "读取中…" : "Reading…") : (zh ? "刷新扫描" : "Refresh scan")}</button></header>
    <div className={styles.toolbar}><input value={filter} onChange={e => setFilter(e.target.value)} aria-label={zh ? "筛选代码" : "Filter symbols"} placeholder={zh ? "筛选代码" : "Filter symbols"} /><select value={sign} onChange={e => setSign(e.target.value)} aria-label={zh ? "Gamma 正负" : "Gamma sign"}><option value="all">{zh ? "全部账簿" : "All books"}</option><option value="positive">{zh ? "正净 Gamma" : "Positive net gamma"}</option><option value="negative">{zh ? "负净 Gamma" : "Negative net gamma"}</option></select><select value={sort} onChange={e => setSort(e.target.value)} aria-label={zh ? "扫描排序" : "Scanner ranking"}><option value="distance">{zh ? "距离关键位最近" : "Nearest published level"}</option><option value="gamma">{zh ? "最大净 Gamma 绝对值" : "Largest absolute net gamma"}</option><option value="rank">{zh ? "最高自身历史分位数" : "Highest own-history rank"}</option></select><span className={styles.note}>{rows.length} {zh ? "个标的" : "instruments"}</span></div>
    {!loading && !data?.index && <p role="status" className={styles.empty}>{data?.failed ? (zh ? "结构指数读取失败。请重试。" : "The structure index could not be read. Retry the source.") : (zh ? "没有已发布的结构指数。" : "No published structure index is available.")}</p>}
    {withheld > 0 && <p role="status" className={styles.note}>{zh ? `${withheld} 个标的因来源日期缺失、无效或尚未发生而隐藏。` : `${withheld} instruments withheld because their source session is missing, invalid, or in the future.`}</p>}
    <div className={styles.scanScroll}><table className={styles.scanTable}><thead><tr>{(zh ? ["标的", "账簿日期", "参考现价", "最近关键位", "距离", "净 Gamma / 十亿", "Gamma 分位数", "Vanna 分位数", "历史样本"] : ["Instrument", "Book session", "Reference spot", "Nearest level", "Distance", "Net gamma / $bn", "Gamma rank", "Vanna rank", "History"]).map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.root}><td><button type="button" onClick={() => onOpen(r.root)}>{r.root} ↗</button></td><td>{r.row.asofDate ?? "—"}</td><td>{exposureValue(r.row.spot)}</td><td>{r.near ? <>{r.near.price}<small> · {r.near.name}</small></> : "—"}</td><td>{r.distance == null ? "—" : `${exposureValue(r.distance)}%`}</td><td data-sign={(r.row.netGexBn ?? 0) < 0 ? "negative" : "positive"}>{exposureValue(r.row.netGexBn)}</td><td>{r.rank ? `${exposureValue(r.rank.gamma_pctile,1)}%` : "—"}</td><td>{r.rank ? `${exposureValue(r.rank.vanna_pctile,1)}%` : "—"}</td><td>{r.rank ? `${r.rank.n_days} ${zh ? "天" : "days"}` : "—"}</td></tr>)}</tbody></table></div>
    <p className={styles.note}>{zh ? "排名日期" : "Rank snapshot"}: {data?.ranks.asof ?? "—"} · {zh ? "分位数窗口" : "Percentile window"}: {data?.ranks.pctileWindowDays ?? "—"} · {data?.ranks.skipped.length ?? 0} {zh ? "个历史不足标的被排除。低分位数不代表负 Gamma；排名不表示价格方向或概率。" : "excluded for insufficient history. A low percentile does not mean negative gamma. Rankings imply no price direction or probability."}</p>
  </section>;
}
