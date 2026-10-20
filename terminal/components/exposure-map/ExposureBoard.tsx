"use client";

import { useEffect, useRef, useState } from "react";
import { flowGetResult, flowInvalidate, type FlowOutcome } from "@/lib/flowClientCache";
import { GEX_AUTOCOMPLETE_ROOTS } from "@/lib/optionsRoots";
import { createExposureMapReader, exposureValue } from "@/lib/exposureMap";
import { describeExposure } from "@/lib/exposureWorkspace";
import { useLang } from "@/lib/i18n";
import ExposureScanner from "./ExposureScanner";
import ExposureComparisonChart from "./ExposureComparisonChart";
import { isMatrixDocForRoot } from "@/components/gexdesk/matrixDoc";
import type { GexMatrix } from "@/lib/gexLadder";
import styles from "./ExposureMap.module.css";

type Book = { root: string; outcome: FlowOutcome; matrix: GexMatrix | null; reader: ReturnType<typeof createExposureMapReader> };
const NO_BOOKS: Book[] = [];
const QUAD = ["SPY", "QQQ", "IWM", "SPX"];
// Use the existing published options universe and cache; no scanner service or new polling owner.
export default function ExposureBoard({mode,onOpen}:{mode:"compare"|"scan";onOpen:(root:string)=>void}) {
  return mode === "scan" ? <ExposureScanner onOpen={onOpen} /> : <ExposureComparison onOpen={onOpen} />;
}
function ExposureComparison({ onOpen }: { onOpen: (root: string) => void }) {
  const { lang } = useLang(); const zh = lang === "zh";
  const [roots, setRoots] = useState(QUAD);
  const boardRef = useRef<HTMLElement>(null);
  const [fullscreen,setFullscreen] = useState(false);
  useEffect(() => { const changed = () => setFullscreen(document.fullscreenElement === boardRef.current); document.addEventListener("fullscreenchange",changed); return () => document.removeEventListener("fullscreenchange",changed); },[]);
  const toggleFullscreen = () => { if (document.fullscreenElement === boardRef.current) void document.exitFullscreen().catch(() => {}); else void boardRef.current?.requestFullscreen?.().catch(() => {}); };
  const [metric, setMetric] = useState<"gamma" | "vanna">("gamma");
  const [scope, setScope] = useState("all");
  const [timeframe, setTimeframe] = useState("5m");
  const [presentation,setPresentation] = useState<"charts"|"profiles">("charts");
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [stored, setStored] = useState<{key:string;books:Book[]}>({key:"",books:[]});
  const [request, refresh] = useState(0);
  const symbols = [...new Set(roots)];
  const symbolsKey = symbols.join(",");
  const key = `${symbolsKey}|${request}`;
  const books = stored.key === key ? stored.books : NO_BOOKS;
  const loading = books.length < symbols.length;
  useEffect(() => {
    let current = true;
    const symbols = symbolsKey.split(",");
    // Four bounded concurrent reads; every result remains tied to its exact requested root.
    let cursor = 0;
    const run = async () => {
      while (current && cursor < symbols.length) {
        const root = symbols[cursor++];
        if (request) { flowInvalidate(`gex:${root}`); flowInvalidate(`matrix:${root}`); }
        const [outcome, matrixResult] = await Promise.all([flowGetResult(`gex:${root}`), flowGetResult(`matrix:${root}`)]);
        const matrix = matrixResult.status === "data" && isMatrixDocForRoot(matrixResult.data, root) ? matrixResult.data : null;
        if (!current) return;
        const now = Date.now(), today = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const reader = createExposureMapReader(outcome.status === "data" ? outcome.data : null, root, matrix, today, now);
        setStored(previous => ({ key, books: [...(previous.key === key ? previous.books : []), { root, outcome, matrix, reader }] }));
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, symbols.length) }, run));
    return () => { current = false; };
  }, [key, symbolsKey, request]);
  const unavailable = (book?: Book) => !book ? (zh ? "正在读取…" : "Reading book…") : book.outcome.status === "absent" ? (zh ? "未发布" : "Not published") : book.outcome.status === "unavailable" ? (zh ? "读取失败" : "Read failed") : (zh ? "此指标不可用" : "Metric unavailable");
  return <section ref={boardRef} className={styles.board} data-testid="exposure-board">
    <header className={styles.sectionHead}><div><span className={styles.eyebrow}>{zh ? "跨市场结构" : "CROSS-MARKET STRUCTURE"}</span><h2>{zh ? "四市场对比" : "Compare four markets"}</h2><p className={styles.note}>{zh ? "按实际快照比较。日期不同的账簿保持独立，不计算合成交易分数。" : "Compare dated books. Different sessions stay distinct; rankings describe structure, not trade probability."}</p></div><button type="button" disabled={loading} onClick={() => refresh(n => n + 1)}>{loading ? `${books.length}/${symbols.length}` : zh ? "刷新账簿" : "Refresh books"}</button></header>
    <div className={styles.toolbar}><div className={styles.segment} aria-label={zh ? "敞口指标" : "Board exposure metric"}>{(["gamma", "vanna"] as const).map(m => <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>{m === "gamma" ? "Gamma" : "Vanna"}</button>)}</div><span className={styles.note}>{zh ? "全部已提供到期日 · 百万美元" : "$mn · independently normalized books"}</span><select aria-label={zh ? "统一到期范围" : "Shared expiration scope"} value={scope} onChange={e => { setScope(e.target.value); setOverrides({}); }}><option value="all">{zh ? "全部到期日" : "All expirations"}</option><option value="zero">{zh ? "账簿 0DTE" : "Book-session 0DTE"}</option></select></div>
    <div className={styles.toolbar}><button type="button" onClick={toggleFullscreen}>{fullscreen ? (zh ? "退出全屏" : "Exit full screen") : (zh ? "全屏对比" : "Full-screen comparison")}</button><div className={styles.segment}>{(["charts","profiles"] as const).map(p => <button key={p} type="button" aria-pressed={presentation === p} onClick={() => setPresentation(p)}>{p === "charts" ? (zh ? "价格图与敞口" : "Price + exposure") : (zh ? "精确节点" : "Exact nodes")}</button>)}</div>{presentation === "charts" && <select aria-label={zh ? "统一图表周期" : "Shared chart timeframe"} value={timeframe} onChange={e => setTimeframe(e.target.value)}>{["5m","30m","2h","D","W"].map(tf => <option key={tf}>{tf}</option>)}</select>}<span className={styles.note}>{zh ? "当前价格图 · 各账簿日期独立显示" : "Current price bars · book dates remain explicit"}</span></div>
    <div className={`${styles.quad} ${presentation === "charts" ? styles.quadCharts : ""}`}>{roots.map((root, index) => {
      const book = books.find(b => b.root === root), ownScope = overrides[index] ?? scope;
      const read = book?.reader(ownScope === "all" || ownScope === "zero" ? {kind:ownScope} : {kind:"one",exp:ownScope}, metric);
      const structure = describeExposure(read?.summary.nodes ?? [], read?.spot ?? null, read?.summary.netLeader?.strike ?? null);
      const known = read?.state === "data", spot = read?.spot;
      const near = read?.summary.nodes.filter(n => n.netMn != null).sort((a, b) => Math.abs(a.strike - (spot ?? 0)) - Math.abs(b.strike - (spot ?? 0))).slice(0, 17).sort((a, b) => b.strike - a.strike) ?? [];
      const max = Math.max(...(read?.summary.nodes.map(n => Math.abs(n.netMn ?? 0)) ?? [0]));
      return <article key={index} className={styles.marketColumn} data-testid={`exposure-market-${index + 1}`}><header><select aria-label={`${zh ? "市场" : "Market"} ${index + 1}`} value={root} onChange={e => setRoots(p => p.map((r, i) => i === index ? e.target.value : r))}>{GEX_AUTOCOMPLETE_ROOTS.map(r => <option key={r}>{r}</option>)}</select><strong>{known ? `$${exposureValue(spot ?? null)}` : "—"}</strong></header><p className={styles.note}>{read?.session ?? "—"} · {zh ? "快照现价" : "snapshot spot"}</p><select className={styles.panelScope} aria-label={`${zh ? "到期范围" : "Expiration scope"} ${index + 1}`} value={ownScope} onChange={e => setOverrides(p => ({...p,[index]:e.target.value}))}><option value="all">{zh ? "全部到期日" : "All expirations"}</option><option value="zero">{zh ? "账簿 0DTE" : "Book-session 0DTE"}</option>{read?.expiries.map(exp => <option key={exp}>{exp}</option>)}</select>{known && near.length ? <><button type="button" className={styles.marketLeader} data-leader={presentation === "charts" ? "true" : undefined} onClick={() => onOpen(root)}><span>{zh ? "最大净节点" : "DOMINANT NET NODE"}</span><strong>{read.summary.netLeader?.strike ?? "—"}</strong><small>{structure.contested ? (zh ? "与第二名接近" : "Closely contested") : (zh ? "打开结构图 →" : "Open structure →")}</small></button>{presentation === "charts" && <ExposureComparisonChart root={root} timeframe={timeframe} nodes={read.summary.nodes} session={read.session} />}<div className={`${styles.profile} ${presentation === "charts" ? styles.compactProfile : ""}`}>{near.map(n => <button type="button" key={n.strike} onClick={() => onOpen(root)} data-sign={n.netMn! < 0 ? "negative" : "positive"} data-leader={presentation === "profiles" && n.strike === read.summary.netLeader?.strike}><i style={{ width: `${max ? Math.abs(n.netMn!) / max * 100 : 0}%` }} /><span>{n.strike}</span><b>{exposureValue(n.netMn)}</b></button>)}</div><p className={styles.note}>{zh ? "强度在本账簿内归一化" : "Intensity normalized within this book"}</p></> : <p className={styles.empty}>{unavailable(book)}</p>}</article>;
    })}</div>
  </section>;
}
