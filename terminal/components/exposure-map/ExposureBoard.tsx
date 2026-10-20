"use client";
import { exposureMapT } from "./exposureMapStrings";

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
  const { lang } = useLang(); const t = exposureMapT(lang);
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
  const unavailable = (book?: Book) => !book ? (t("readingBook")) : book.outcome.status === "absent" ? (t("notPublished")) : book.outcome.status === "unavailable" ? (t("readFailed2")) : (t("metricUnavailable"));
  return <section ref={boardRef} className={styles.board} data-testid="exposure-board">
    <header className={styles.sectionHead}><div><span className={styles.eyebrow}>{t("crossMarketStructure")}</span><h2>{t("compareFourMarkets")}</h2><p className={styles.note}>{t("compareDatedBooksDifferentSessionsStayDistinctRankings")}</p></div><button type="button" disabled={loading} onClick={() => refresh(n => n + 1)}>{loading ? `${books.length}/${symbols.length}` : t("refreshBooks")}</button></header>
    <div className={styles.toolbar}><div className={styles.segment} aria-label={t("boardExposureMetric")}>{(["gamma", "vanna"] as const).map(m => <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>{t(m)}</button>)}</div><span className={styles.note}>{t("mnIndependentlyNormalizedBooks")}</span><select aria-label={t("sharedExpirationScope")} value={scope} onChange={e => { setScope(e.target.value); setOverrides({}); }}><option value="all">{t("allExpirations")}</option><option value="zero">{t("bookSession0dte")}</option></select></div>
    <div className={styles.toolbar}><button type="button" onClick={toggleFullscreen}>{fullscreen ? (t("exitFullScreen")) : (t("fullScreenComparison"))}</button><div className={styles.segment}>{(["charts","profiles"] as const).map(p => <button key={p} type="button" aria-pressed={presentation === p} onClick={() => setPresentation(p)}>{p === "charts" ? (t("priceExposure")) : (t("exactNodes"))}</button>)}</div>{presentation === "charts" && <select aria-label={t("sharedChartTimeframe")} value={timeframe} onChange={e => setTimeframe(e.target.value)}>{["5m","30m","2h","D","W"].map(tf => <option key={tf}>{tf}</option>)}</select>}<span className={styles.note}>{t("currentPriceBarsBookDatesRemainExplicit")}</span></div>
    <div className={`${styles.quad} ${presentation === "charts" ? styles.quadCharts : ""}`}>{roots.map((root, index) => {
      const book = books.find(b => b.root === root), ownScope = overrides[index] ?? scope;
      const read = book?.reader(ownScope === "all" || ownScope === "zero" ? {kind:ownScope} : {kind:"one",exp:ownScope}, metric);
      const structure = describeExposure(read?.summary.nodes ?? [], read?.spot ?? null, read?.summary.netLeader?.strike ?? null);
      const known = read?.state === "data", spot = read?.spot;
      const near = read?.summary.nodes.filter(n => n.netMn != null).sort((a, b) => Math.abs(a.strike - (spot ?? 0)) - Math.abs(b.strike - (spot ?? 0))).slice(0, 17).sort((a, b) => b.strike - a.strike) ?? [];
      const max = Math.max(...(read?.summary.nodes.map(n => Math.abs(n.netMn ?? 0)) ?? [0]));
      return <article key={index} className={styles.marketColumn} data-testid={`exposure-market-${index + 1}`}><header><select aria-label={`${t("market")} ${index + 1}`} value={root} onChange={e => setRoots(p => p.map((r, i) => i === index ? e.target.value : r))}>{GEX_AUTOCOMPLETE_ROOTS.map(r => <option key={r}>{r}</option>)}</select><strong>{known ? `$${exposureValue(spot ?? null)}` : "—"}</strong></header><div className={styles.marketMeta}><p className={styles.note}>{read?.session ?? "—"} · {t("snapshotSpot")}</p><select className={styles.panelScope} aria-label={`${t("scope")} ${index + 1}`} value={ownScope} onChange={e => setOverrides(p => ({...p,[index]:e.target.value}))}><option value="all">{t("allExpirations")}</option><option value="zero">{t("bookSession0dte")}</option>{read?.expiries.map(exp => <option key={exp}>{exp}</option>)}</select></div>{known && near.length ? <><button type="button" className={styles.marketLeader} data-leader={presentation === "charts" ? "true" : undefined} onClick={() => onOpen(root)}><span>{t("dominantNetNode")}</span><strong>{read.summary.netLeader?.strike ?? "—"}</strong><small>{structure.contested ? (t("closelyContested")) : (t("openStructure"))}</small></button>{presentation === "charts" && <ExposureComparisonChart root={root} timeframe={timeframe} nodes={read.summary.nodes} session={read.session} />}<div className={`${styles.profile} ${presentation === "charts" ? styles.compactProfile : ""}`}>{near.map(n => <button type="button" key={n.strike} onClick={() => onOpen(root)} data-sign={n.netMn! < 0 ? "negative" : "positive"} data-leader={presentation === "profiles" && n.strike === read.summary.netLeader?.strike}><i style={{ width: `${max ? Math.abs(n.netMn!) / max * 100 : 0}%` }} /><span>{n.strike}</span><b>{exposureValue(n.netMn)}</b></button>)}</div><p className={styles.note}>{t("intensityNormalizedWithinThisBook")}</p></> : <p className={styles.empty}>{unavailable(book)}</p>}</article>;
    })}</div>
  </section>;
}
