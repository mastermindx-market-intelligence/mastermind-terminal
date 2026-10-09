"use client";

import { useEffect, useRef, useState } from "react";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { useLang } from "@/lib/i18n";
import { prepareStudyBarsFrom5m, runRSPivotStudy, type StudyReport, type StudySummary, STUDY_ARMS } from "@/lib/rsPivotStudy";
import { liveDisplayEpoch } from "@/lib/liveCandle";
import { usRegularSessionWindow } from "@/lib/usEquitySessionClock";
import RSPivotChart from "./RSPivotChart";
import type { Bar6 } from "@/lib/intradayShared";

type SourceResponse = {
  bars?: Bar6[];
  note?: string;
  error?: string;
  source_evidence?: {
    construction?: string;
    source_counts?: Record<string, number>;
    completeness?: string;
    point_in_time_availability?: string;
    research_admission?: string;
    warnings?: string[];
    timestamp_basis?: string;
    assembly_store_reads?: Array<{ base: string; status: string; content_sha256: string | null }>;
    assembly_clock?: { cache_state: string };
  };
};

const L = {
  en: {
    title: "RS × 30m Pivot Study",
    subtitle: "Explore whether benchmark-relative leaders improve the payoff of confirmed 30-minute swing-low reclaims. SHADOW RESEARCH — never a trade signal.",
    symbol: "Equity ticker", bench: "Benchmark", hold: "Max hold", costs: "Round-trip costs (bps)",
    run: "Run local study", running: "Loading historical 30m bars…",
    condition: "Leader gate: positive excess close-to-close returns over 65 AND 260 aligned bars (approximately 5/20 full sessions) vs benchmark. This is not a market-wide RS percentile.",
    pivot: "Pivot definition: 2 left + 2 right completed bars; reclaim is eligible only AFTER the confirming candle closes. Fill = next candle open.",
    warning: "Corrected historical OHLC is NOT verified point-in-time. Results are exploratory, not strategy qualification. Do not infer institutional orders.",
    no: "Select a liquid US equity and run the study. Results appear only when aligned, complete 30-minute sessions are available.",
    source: "Input source evidence (descriptive only)",
    scope: "Aligned 30m bars", dates: "Sessions", cut: "Descriptive 70/30 split",
    arm: "Test arm", n: "Trades", wr: "Win rate", avg: "Mean net R", pf: "Profit factor",
    earlier: "Earlier mean R", recent: "Recent mean R", censored: "Censored",
    table: "Recent RS + pivot hypothetical trades",
    at: "Signal (ET)", entry: "Next-open entry", exit: "Exit", stop: "Stop", reason: "Exit reason", result: "Net R",
    sparse: "Small samples and single-name comparisons are NOT evidence of a high-probability edge. Compare across an ex-ante universe with matched controls in Evaluation OS.",
    explain: "Four arms use the same fill, stop, 2R target and friction model. EMA arms enter after an EMA20 reclaim; pivot arms enter after an already-confirmed swing-low retest. The RS gate restricts each family.",
    export: "Export report JSON", outcomes: "Hypothetical OHLC replay — not live or broker-executable",
    insufficient: "No qualifying trades for this arm. A zero sample is not a zero return.",
    disclaimer: "No corporate-action or historical universe certification, catalyst/halts filter, or source availability receipts. Daily gaps, spread, fill constraints and parameter searching may make live outcomes worse.",
  },
  zh: {
    title: "相对强度 × 30分钟枢轴研究",
    subtitle: "探索相对强势股在已确认的30分钟摆动低点收复后是否改善回报。仅供模拟研究，不是交易信号。",
    symbol: "股票代码", bench: "比较基准", hold: "最长持有", costs: "往返成本（基点）",
    run: "运行本地研究", running: "正在加载历史30分钟K线…",
    condition: "强势过滤：过去65根和260根对齐K线（约5/20个完整交易日）的相对基准超额收益均为正；并非全市场相对强度百分位。",
    pivot: "枢轴定义：左右各2根已完成K线；确认收盘之后才能触发，下一根K线开盘模拟成交。",
    warning: "历史修正K线尚未通过历史时点可用性验证。结果仅供探索，不代表策略合格，也不能推断机构订单。",
    no: "输入一只流动性较好的美股并运行；仅在有足够完整且对齐的30分钟数据时显示结果。",
    source: "输入来源证据（仅描述性）",
    scope: "对齐30分钟K线", dates: "完整交易日", cut: "描述性70/30切分",
    arm: "研究组别", n: "交易次数", wr: "胜率", avg: "平均净R", pf: "盈利因子",
    earlier: "早期平均R", recent: "近期平均R", censored: "删失",
    table: "最近的相对强度+枢轴模拟交易",
    at: "信号（美东）", entry: "次根开盘价", exit: "离场价", stop: "止损价", reason: "离场原因", result: "净R",
    sparse: "单只股票或少量交易不能证明高胜率。正式评估须由评估系统使用事前股票池和匹配对照。",
    explain: "四组使用相同的成交、止损、2R目标和成本；EMA组测试EMA20收复，枢轴组测试已确认的摆动低点回踩。",
    export: "导出研究JSON", outcomes: "假设性K线回测，不是真实成交",
    insufficient: "此组没有合格交易。无样本并不等于零收益。",
    disclaimer: "未核验除权、历史股票池、催化剂与停牌过滤或历史数据可用性；跳空、点差和参数选择都可能使实盘更差。",
  },
};
const ARM_LABELS: Record<string, [string, string]> = {
  rs_pivot: ["RS + confirmed pivot", "相对强度 + 已确认枢轴"],
  pivot: ["Confirmed pivot, no RS filter", "已确认枢轴（无相对强度过滤）"],
  rs_ema: ["RS + EMA20 reclaim", "相对强度 + EMA20收复"],
  ema: ["EMA20 reclaim, no RS filter", "EMA20收复（无相对强度过滤）"],
};
const container: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 16 };
const field: React.CSSProperties = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 6, minHeight: 38, padding: "6px 9px", width: "100%" };
const label: React.CSSProperties = { display: "grid", gap: 5, fontSize: 12, color: "var(--muted)", minWidth: 120, flex: "1 1 140px" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: "var(--muted)", padding: "10px 9px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "9px", fontSize: 12, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const fmt = (v: number | null, d = 2) => v == null || !Number.isFinite(v) ? "—" : v.toFixed(d);
const pct = (v: number | null) => v == null ? "—" : (v * 100).toFixed(1) + "%";
const dt = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");

function SummaryRow({ row }: { row: StudySummary }) {
  return <><td style={td}>{row.trades}</td><td style={td}>{pct(row.winRate)}</td>
    <td style={td}>{fmt(row.expectancyR)}R</td><td style={td}>{fmt(row.profitFactor)}</td></>;
}
async function loadBars(sym: string, signal: AbortSignal): Promise<SourceResponse> {
  const res = await fetch("/api/intraday?sym=" + encodeURIComponent(sym) + "&tf=5m&ext=0", { cache: "no-store", signal });
  if (!res.ok) throw new Error(sym + ": HTTP " + res.status);
  const data: SourceResponse = await res.json();
  if (data.error) throw new Error(sym + ": " + data.error);
  if (!Array.isArray(data.bars) || !data.bars.length) throw new Error(sym + ": no historical 5m bars returned" + (data.note ? " (" + data.note + ")" : ""));
  return data;
}

export default function RSPivotStudy() {
  const { lang } = useLang();
  const identity = useShellIdentity();
  const t = L[lang];
  const zh = lang === "zh";
  const c = (en: string, cn: string) => zh ? cn : en;
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const [symbol, setSymbol] = useState("NVDA");
  const [benchmark, setBenchmark] = useState("SPY");
  const [hold, setHold] = useState<13 | 26 | 39>(26);
  const [cost, setCost] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<StudyReport | null>(null);
  const [sources, setSources] = useState<{ symbol: SourceResponse; benchmark: SourceResponse } | null>(null);
  const [chartBars, setChartBars] = useState<Bar6[]>([]);
  const [selectedArm, setSelectedArm] = useState("rs_pivot");
  const [selectedTrade, setSelectedTrade] = useState("");
  const [runMeta, setRunMeta] = useState<{ symbol: string; benchmark: string; inputHashes: string[]; elapsedMs: number; engineMs: number; geometry: ReturnType<typeof prepareStudyBarsFrom5m>[]; stale: boolean } | null>(null);
  const invalidate = () => { setReport(null); setRunMeta(null); setSources(null); };
  const run = async () => {
    if (identity.kind !== "account") return;
    const sym = symbol.trim().toUpperCase(), bm = benchmark.trim().toUpperCase();
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    invalidate(); setError(""); setSelectedTrade("");
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(sym) || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(bm) || sym === bm) {
      setError(c("Select a valid US equity and a different benchmark.", "请选择有效美股代码与不同的比较基准。")); return;
    }
    setBusy(true);
    try {
      const started = performance.now();
      const [s, b] = await Promise.all([loadBars(sym, controller.signal), loadBars(bm, controller.signal)]);
      const asOf = liveDisplayEpoch(Date.now(), "us")!;
      for (const input of [s, b]) {
        if (input.source_evidence?.timestamp_basis !== "market_local_display_epoch" || !input.source_evidence.source_counts?.stored_5m)
          throw new Error("STORED_5M_SOURCE_UNAVAILABLE");
      }
      const geometry = [prepareStudyBarsFrom5m(s.bars!, asOf), prepareStudyBarsFrom5m(b.bars!, asOf)];
      const computeStarted = performance.now();
      const out = runRSPivotStudy(geometry[0].bars, geometry[1].bars, bm, { costBps: cost, holdBars: hold }, asOf);
      const engineMs = performance.now() - computeStarted;
      const inputHashes = await Promise.all([s.bars, b.bars].map(async bars => {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(bars)));
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      }));
      if (controller.signal.aborted) return;
      let expected = Math.floor(asOf / 86400) * 86400;
      for (let n = 0; n < 10; n++, expected -= 86400) {
        const w = usRegularSessionWindow(expected);
        if (w && asOf >= expected + w[1] * 60) break;
      }
      const expectedDate = new Date(expected * 1000).toISOString().slice(0, 10);
      const stale = out.coverage.lastDate < expectedDate || [s, b].some(input => input.source_evidence?.assembly_clock?.cache_state === "stale_cache");
      setSources({ symbol: s, benchmark: b }); setChartBars(geometry[0].bars);
      setRunMeta({ symbol: sym, benchmark: bm, inputHashes, geometry: geometry.map(g => ({ ...g, bars: [] })), elapsedMs: performance.now() - started, engineMs, stale });
      setReport(out);
    } catch (e) {
      if (!controller.signal.aborted) {
        const message = e instanceof Error ? e.message : String(e);
        const status = message.match(/HTTP \d+/)?.[0];
        setError(status ? c("Source request unavailable: ", "来源请求不可用：") + status : /Insufficient/.test(message) ? c("Insufficient complete aligned history. At least 22 sessions and the RS lookback are required.", "完整对齐历史不足。需要至少22个交易日与相对强度回看窗口。") : /no historical|STORED_5M/.test(message) ? c("Stored 5m source or benchmark is unavailable; no results were simulated.", "已存储5分钟来源或基准不可用；未模拟任何结果。") : c("Input validation failed or the source could not be loaded. No results were simulated.", "输入验证失败或来源无法加载。未模拟任何结果。"));
      }
    }
    finally { setBusy(false); }
  };
  const exportJson = () => {
    if (!report || !runMeta) return;
    const payload = JSON.stringify({ ...report, requested_symbol: runMeta.symbol, input_hashes_sha256: runMeta.inputHashes, input_hash_basis: "JSON_serialized_returned_5m_bars", nominal_geometry: runMeta.geometry, engine_compute_ms: runMeta.engineMs,
      sources: { symbol: sources?.symbol.source_evidence ?? null, benchmark: sources?.benchmark.source_evidence ?? null } }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "rs-pivot-" + runMeta.symbol + ".json";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const preferred = report?.results.find(x => x.arm === selectedArm);
  const recent = preferred?.trades.slice(-60).reverse() ?? [];
  const trade = recent.find(x => String(x.signalBarAt) === selectedTrade) ?? recent[0] ?? null;
  return (
    <main className="main2" style={{ overflowY: "auto", padding: "clamp(12px, 2vw, 26px)", color: "var(--text)", height: "100%" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 16, paddingBottom: 40 }}>
        <header>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--warn)", letterSpacing: 1 }}>{c("SHADOW RESEARCH / 30M", "模拟研究 / 30分钟")}</div>
          <h1 style={{ fontSize: "clamp(20px, 2vw, 28px)", margin: "7px 0" }}>{t.title}</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", maxWidth: 880 }}>{t.subtitle}</p>
        </header>
        {identity.kind !== "account" && <div role="note" style={{...container,borderColor:"var(--warn)"}}>{c("Sign in to load historical research inputs through your existing Terminal access.", "请登录，通过您现有的Terminal访问权限加载历史研究输入。") } <a href="/login" style={{color:"var(--brand-2)"}}>{c("Sign in", "登录")}</a></div>}
        <section style={container}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <label style={label}>{t.symbol}<input aria-label={t.symbol} style={field} value={symbol} maxLength={15} disabled={busy} onChange={e => { setSymbol(e.target.value.toUpperCase()); invalidate(); }} /></label>
            <label style={label}>{t.bench}<select aria-label={t.bench} style={field} value={benchmark} disabled={busy} onChange={e => { setBenchmark(e.target.value); invalidate(); }}>
              <option value="SPY">SPY · S&P 500</option><option value="QQQ">QQQ · Nasdaq 100</option><option value="IWM">IWM · Russell 2000</option>
            </select></label>
            <label style={label}>{t.hold}<select aria-label={t.hold} style={field} value={hold} disabled={busy} onChange={e => { setHold(Number(e.target.value) as 13 | 26 | 39); invalidate(); }}>
              <option value="13">13 × 30m</option><option value="26">26 × 30m</option><option value="39">39 × 30m</option>
            </select></label>
            <label style={label}>{t.costs}<input aria-label={t.costs} style={field} type="number" min="0" max="150" step="1" value={cost} disabled={busy} onChange={e => { setCost(Math.max(0, Math.min(150, Number(e.target.value)))); invalidate(); }} /></label>
            <button type="button" disabled={busy || identity.kind !== "account"} onClick={run} style={{ ...field, width: "auto", minWidth: 155, color: "var(--text)", cursor: busy ? "wait" : "pointer", fontWeight: 700, borderColor: "var(--brand-2)" }}>{busy ? t.running : t.run}</button>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>{t.condition}</p>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{t.pivot}</p>
        </section>
        <div role="note" style={{ padding: "12px 14px", borderLeft: "3px solid var(--warn)", background: "var(--panel)", fontSize: 12 }}>{t.warning}</div>
        {error && <div data-testid="rs-pivot-error" role="alert" style={{ ...container, borderColor: "var(--down)" }}>{error}</div>}
        {!report && !error && !busy && <section style={{ ...container, color: "var(--muted)", fontSize: 13 }}>{t.no}</section>}
        {report && <>
          <div role="status" style={{...container, borderColor: "var(--warn)", fontSize: 12}}>
            <strong>{runMeta?.symbol} / {runMeta?.benchmark} · {c("Historical research snapshot", "历史研究快照")} · {report.coverage.firstDate} → {report.coverage.lastDate}</strong>
            <p>{runMeta?.stale ? c("DEGRADED — latest expected session or cache freshness is missing. This is archived evidence, not a current setup.", "降级：缺少最近应有交易日或缓存已过期。此为存档证据，并非当前形态。") : c("Completed historical bars only. Market data delay and per-observation availability are not certified.", "仅使用已完成历史K线。未认证行情延迟或逐条历史可用时间。")}</p>
            <p>{c("Excluded nominal buckets / future buckets (stock, benchmark):", "剔除不完整区间 / 未完成区间（股票、基准）：")} {runMeta?.geometry.map(g=>`${g.incompleteBuckets} / ${g.futureBuckets}`).join(" · ")}</p>
            <p>{c("Missing exchange sessions / continuity segments / ambiguous price gaps:", "缺失交易日 / 连续片段 / 不明价格跳变：")} {report.coverage.missingExchangeSessions} / {report.coverage.segments} / {report.coverage.discontinuities}. {c("Six 5m timestamps establish nominal geometry, not feed completeness or PIT qualification.", "六个5分钟时间戳仅证明标称区间，并非行情完整性或历史时点资格。")}</p>
          </div>
          <section style={{ ...container, display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
            <div><div style={label}>{t.scope}</div><strong>{report.coverage.alignedBars.toLocaleString()}</strong></div>
            <div><div style={label}>{t.dates}</div><strong>{report.coverage.completeSessions}</strong></div>
            <div><div style={label}>{t.cut}</div><strong>{report.coverage.chronologicalCutDate}</strong></div>
            <div style={{ marginLeft: "auto" }}><button type="button" onClick={exportJson} style={{ ...field, width: "auto", cursor: "pointer" }}>{t.export}</button></div>
          </section>
          <section style={container}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t.outcomes}</h2>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>{t.explain}</p>
            <div style={{ overflowX: "auto", maxWidth: "100%" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>{t.arm}</th><th style={th}>{t.n}</th><th style={th}>{t.wr}</th>
                <th style={th}>{t.avg}</th><th style={th}>{t.pf}</th><th style={th}>{t.earlier}</th><th style={th}>{t.recent}</th><th style={th}>{t.censored}</th></tr></thead>
              <tbody>{STUDY_ARMS.map(arm => {
                const row = report.results.find(r => r.arm === arm);
                if (!row) return null;
                return <tr key={arm}><th scope="row" style={{ ...td, textAlign: "left" }}>{ARM_LABELS[arm][lang === "en" ? 0 : 1]}</th>
                  <SummaryRow row={row.summary} />
                  <td style={td}>{fmt(row.earlier.expectancyR)}R</td><td style={td}>{fmt(row.recent.expectancyR)}R</td><td style={td}>{row.censored + row.unresolved}</td></tr>;
              })}</tbody>
            </table></div>
            <p style={{ fontSize: 12, color: "var(--warn)", marginTop: 10 }}>{t.sparse}</p>
          </section>
          <section style={container}>
            <h2 style={{fontSize:14,fontWeight:700}}>{c("Candidate accounting", "候选记账")}</h2>
            <div style={{overflowX:"auto",maxWidth:"100%"}}><table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{[t.arm,c("Candidates","候选"),c("RS excluded","相对强度剔除"),c("Risk rejected","风险拒绝"),c("Missed entry","错过入场"),c("Overlap excluded","重叠剔除"),c("Unresolved gaps","缺口未结"),c("Right censored","右删失")].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{report.results.map(r=><tr key={r.arm}><th scope="row" style={td}>{ARM_LABELS[r.arm][zh?1:0]}</th>{[r.candidates,r.filteredRS,r.rejectedRisk,r.missedEntry,r.overlapping,r.unresolved,r.censored].map((n,i)=><td key={i} style={td}>{n}</td>)}</tr>)}</tbody>
            </table></div>
            <p style={{fontSize:12,color:"var(--warn)"}}>{c("Metrics describe resolved trades only; excluded and unresolved candidates remain in the denominator disclosure. These controls are exploratory, not sector/regime matched scientific controls.", "指标仅描述已结模拟交易；剔除与未结候选保留于分母披露。这些对照仅供探索，并非行业或市场状态匹配的科学对照。")}</p>
          </section>
          <section style={{...container,minWidth:0}}>
            <h2 style={{fontSize:14,fontWeight:700}}>{c("Historical chart and trade replay", "历史图表与交易重放")}</h2>
            <div style={{display:"flex",flexWrap:"wrap",gap:12,margin:"12px 0"}}>
              <label style={label}>{t.arm}<select aria-label={t.arm} style={field} value={selectedArm} onChange={e=>{setSelectedArm(e.target.value);setSelectedTrade("");}}>{STUDY_ARMS.map(a=><option key={a} value={a}>{ARM_LABELS[a][zh?1:0]}</option>)}</select></label>
              <label style={label}>{c("Historical trade", "历史交易")}<select aria-label={c("Historical trade", "历史交易")} style={field} value={trade?String(trade.signalBarAt):""} onChange={e=>setSelectedTrade(e.target.value)}>{recent.length?recent.map(x=><option key={x.signalBarAt} value={String(x.signalBarAt)}>{dt(x.signalAt)} · {fmt(x.rNet)}R</option>):<option value="">{t.insufficient}</option>}</select></label>
            </div>
            <RSPivotChart key={`${selectedArm}-${trade?.signalBarAt ?? "latest"}`} bars={chartBars} report={report} trade={trade} />
            {trade && <div style={{fontSize:12,color:"var(--muted)",display:"grid",gap:6,marginTop:12}}>
              <div>{c("Pivot confirmation close", "枢轴确认收盘")} {trade.confirmedAt?dt(trade.confirmedAt):"—"} → {c("Reclaim close", "收复收盘")} {dt(trade.signalAt)}</div>
              <div>{c("Next permitted open", "下个允许开盘")} {dt(trade.entryAt)} · {fmt(trade.entry)} → {c("Exit observed", "离场观察")} {dt(trade.exitAt)} · {fmt(trade.exit)}</div>
              <div>{c("Intrabar exit time unknown unless filled at the open; charts attach that observation to the exit candle.", "除开盘成交外，根内离场时刻未知；图表将该观察附于离场K线。")}</div>
              <div>{c("Gross / assumed costs / net R; conservative MFE / MAE", "毛收益 / 假设成本 / 净R；保守最大有利 / 不利波动")} {fmt(trade.grossR)} / {fmt(trade.costsR)} / {fmt(trade.rNet)}R · {fmt(trade.mfeR)} / {fmt(trade.maeR)}R</div>
            </div>}
            {!trade && <p style={{fontSize:12,color:"var(--muted)"}}>{t.insufficient}</p>}
            <p style={{fontSize:12,color:"var(--muted)"}}>{c("Latest completed historical close / confirmed swing level:", "最近已完成历史收盘 / 已确认摆动价位：")} {report.lastCompleted?dt(report.lastCompleted.closeAt):"—"} · {fmt(report.lastCompleted?.close??null)} / {fmt(report.lastCompleted?.pivotPrice??null)}. {c("A historical level, not a live entry recommendation.", "历史价位，不是实时入场建议。")}</p>
          </section>
          <section style={container}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{c("Historical trades for selected arm", "所选组别的历史交易")}</h2>
            {recent.length ? <div style={{ overflowX: "auto", maxWidth: "100%" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>{t.at}</th><th style={th}>{t.entry}</th><th style={th}>{t.stop}</th><th style={th}>{t.exit}</th><th style={th}>{t.reason}</th><th style={th}>{t.result}</th></tr></thead>
              <tbody>{recent.map(x => <tr key={String(x.signalAt)}><td style={td}>{dt(x.signalAt)}</td>
                <td style={td}>{fmt(x.entry)}</td><td style={td}>{fmt(x.stop)}</td>
                <td style={td}>{fmt(x.exit)}</td><td style={td}>{x.exitReason === "stop" ? c("Stop", "止损") : x.exitReason === "target" ? c("Target", "目标") : c("Max hold", "最长持有")}</td><td style={td}>{fmt(x.rNet)}R</td></tr>)}</tbody>
            </table></div> : <p style={{ fontSize: 12, color: "var(--muted)" }}>{t.insufficient}</p>}
          </section>
          <section style={{ ...container, fontSize: 12, color: "var(--muted)" }}>
            <strong style={{ color: "var(--text)" }}>{t.source}</strong>
            <p>{c("Equity / benchmark construction", "股票 / 基准构造")}：{sources?.symbol.source_evidence?.construction ?? "unknown"} / {sources?.benchmark.source_evidence?.construction ?? "unknown"}</p>
            <p>{c("Instrument identity, corporate actions, rights and PIT availability: unqualified. Historical corrections and ticker reuse may invalidate results.", "证券身份、公司行动、权利及历史时点可用性：未合格。历史修正与代码复用可能使结果失效。")}</p>
            <p>{c("Returned-input SHA-256 (stock / benchmark)", "返回输入SHA-256（股票 / 基准）")}：<span style={{overflowWrap:"anywhere"}}>{runMeta?.inputHashes.join(" / ")}</span></p>
            <p>{t.disclaimer}</p>
            <p>{c("Interactive parameter choices contaminate any holdout; no scientific edge verdict exists. Export preserves the engine revision, cutoff, parameters, source evidence and input hashes for the existing Macro evaluator.", "交互式参数选择会污染留出样本；尚无科学优势结论。导出保留引擎版本、截点、参数、来源证据与输入哈希，供现有Macro评估所有者复现。")}</p>
          </section>
        </>}
      </div>
    </main>
  );
}
