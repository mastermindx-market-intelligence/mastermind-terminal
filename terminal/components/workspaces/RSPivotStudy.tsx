"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { runRSPivotStudy, type StudyReport, type StudySummary, STUDY_ARMS } from "@/lib/rsPivotStudy";
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
  };
};

const L = {
  en: {
    title: "RS × 30m Pivot Study",
    subtitle: "Explore whether benchmark-relative leaders improve the payoff of confirmed 30-minute swing-low reclaims. SHADOW RESEARCH — never a trade signal.",
    symbol: "Equity ticker", bench: "Benchmark", hold: "Max hold", costs: "Round-trip costs (bps)",
    run: "Run local study", running: "Loading historical 30m bars…",
    condition: "Leader gate: positive 5-day AND 20-day excess close-to-close returns vs benchmark. This is not a market-wide RS percentile.",
    pivot: "Pivot definition: 2 left + 2 right completed bars; reclaim is eligible only AFTER the confirming candle closes. Fill = next candle open.",
    warning: "Corrected historical OHLC is NOT verified point-in-time. Results are exploratory, not strategy qualification. Do not infer institutional orders.",
    no: "Select a liquid US equity and run the study. Results appear only when aligned, complete 30-minute sessions are available.",
    source: "Input source evidence (descriptive only)",
    scope: "Aligned 30m bars", dates: "Sessions", cut: "Chronological 70/30 split",
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
    condition: "强势过滤：过去约5日和20日相对基准的超额收益均为正；并非全市场相对强度百分位。",
    pivot: "枢轴定义：左右各2根已完成K线；确认收盘之后才能触发，下一根K线开盘模拟成交。",
    warning: "历史修正K线尚未通过历史时点可用性验证。结果仅供探索，不代表策略合格，也不能推断机构订单。",
    no: "输入一只流动性较好的美股并运行；仅在有足够完整且对齐的30分钟数据时显示结果。",
    source: "输入来源证据（仅描述性）",
    scope: "对齐30分钟K线", dates: "完整交易日", cut: "按时间70/30切分",
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
async function loadBars(sym: string): Promise<SourceResponse> {
  const res = await fetch("/api/intraday?sym=" + encodeURIComponent(sym) + "&tf=30m&ext=0", { cache: "no-store" });
  if (!res.ok) throw new Error(sym + ": HTTP " + res.status);
  const data: SourceResponse = await res.json();
  if (data.error) throw new Error(sym + ": " + data.error);
  if (!Array.isArray(data.bars) || !data.bars.length) throw new Error(sym + ": no historical 30m bars returned" + (data.note ? " (" + data.note + ")" : ""));
  return data;
}

export default function RSPivotStudy() {
  const { lang } = useLang();
  const t = L[lang];
  const [symbol, setSymbol] = useState("NVDA");
  const [benchmark, setBenchmark] = useState("SPY");
  const [hold, setHold] = useState<13 | 26 | 39>(26);
  const [cost, setCost] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<StudyReport | null>(null);
  const [sources, setSources] = useState<{ symbol: SourceResponse; benchmark: SourceResponse } | null>(null);
  const run = async () => {
    const sym = symbol.trim().toUpperCase(), bm = benchmark.trim().toUpperCase();
    setReport(null); setSources(null); setError("");
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(sym) || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(bm) || sym === bm) {
      setError("Select a valid equity ticker and a different benchmark."); return;
    }
    setBusy(true);
    try {
      const [s, b] = await Promise.all([loadBars(sym), loadBars(bm)]);
      const out = runRSPivotStudy(s.bars as Bar6[], b.bars as Bar6[], bm, { costBps: cost, holdBars: hold });
      setSources({ symbol: s, benchmark: b });
      setReport(out);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const exportJson = () => {
    if (!report) return;
    const payload = JSON.stringify({ ...report, requested_symbol: symbol.trim().toUpperCase(),
      sources: { symbol: sources?.symbol.source_evidence ?? null, benchmark: sources?.benchmark.source_evidence ?? null } }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "rs-pivot-" + symbol.trim().toUpperCase() + ".json";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const preferred = report?.results.find(x => x.arm === "rs_pivot");
  const recent = preferred?.trades.slice(-12).reverse() ?? [];
  return (
    <main className="main2" style={{ overflowY: "auto", padding: "clamp(12px, 2vw, 26px)", color: "var(--text)", height: "100%" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 16, paddingBottom: 40 }}>
        <header>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--warn)", letterSpacing: 1 }}>SHADOW RESEARCH / 30M</div>
          <h1 style={{ fontSize: "clamp(20px, 2vw, 28px)", margin: "7px 0" }}>{t.title}</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", maxWidth: 880 }}>{t.subtitle}</p>
        </header>
        <section style={container}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <label style={label}>{t.symbol}<input aria-label={t.symbol} style={field} value={symbol} maxLength={15} onChange={e => setSymbol(e.target.value.toUpperCase())} /></label>
            <label style={label}>{t.bench}<select aria-label={t.bench} style={field} value={benchmark} onChange={e => setBenchmark(e.target.value)}>
              <option value="SPY">SPY · S&P 500</option><option value="QQQ">QQQ · Nasdaq 100</option><option value="IWM">IWM · Russell 2000</option>
            </select></label>
            <label style={label}>{t.hold}<select aria-label={t.hold} style={field} value={hold} onChange={e => setHold(Number(e.target.value) as 13 | 26 | 39)}>
              <option value="13">13 × 30m</option><option value="26">26 × 30m</option><option value="39">39 × 30m</option>
            </select></label>
            <label style={label}>{t.costs}<input aria-label={t.costs} style={field} type="number" min="0" max="150" step="1" value={cost} onChange={e => setCost(Math.max(0, Math.min(150, Number(e.target.value))))} /></label>
            <button type="button" disabled={busy} onClick={run} style={{ ...field, width: "auto", minWidth: 155, color: "var(--text)", cursor: busy ? "wait" : "pointer", fontWeight: 700, borderColor: "var(--brand-2)" }}>{busy ? t.running : t.run}</button>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>{t.condition}</p>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{t.pivot}</p>
        </section>
        <div role="note" style={{ padding: "12px 14px", borderLeft: "3px solid var(--warn)", background: "var(--panel)", fontSize: 12 }}>{t.warning}</div>
        {error && <div role="alert" style={{ ...container, borderColor: "var(--down)" }}>{error}</div>}
        {!report && !error && !busy && <section style={{ ...container, color: "var(--muted)", fontSize: 13 }}>{t.no}</section>}
        {report && <>
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
                  <td style={td}>{fmt(row.earlier.expectancyR)}R</td><td style={td}>{fmt(row.recent.expectancyR)}R</td><td style={td}>{row.censored}</td></tr>;
              })}</tbody>
            </table></div>
            <p style={{ fontSize: 12, color: "var(--warn)", marginTop: 10 }}>{t.sparse}</p>
          </section>
          <section style={container}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t.table}</h2>
            {recent.length ? <div style={{ overflowX: "auto", maxWidth: "100%" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>{t.at}</th><th style={th}>{t.entry}</th><th style={th}>{t.stop}</th><th style={th}>{t.exit}</th><th style={th}>{t.reason}</th><th style={th}>{t.result}</th></tr></thead>
              <tbody>{recent.map(x => <tr key={String(x.signalAt)}><td style={td}>{dt(x.signalAt)}</td>
                <td style={td}>{fmt(x.entry)}</td><td style={td}>{fmt(x.stop)}</td>
                <td style={td}>{fmt(x.exit)}</td><td style={td}>{x.exitReason}</td><td style={td}>{fmt(x.rNet)}R</td></tr>)}</tbody>
            </table></div> : <p style={{ fontSize: 12, color: "var(--muted)" }}>{t.insufficient}</p>}
          </section>
          <section style={{ ...container, fontSize: 12, color: "var(--muted)" }}>
            <strong style={{ color: "var(--text)" }}>{t.source}</strong>
            <p>Symbol: {sources?.symbol.source_evidence?.construction ?? "unknown"} · Benchmark: {sources?.benchmark.source_evidence?.construction ?? "unknown"}</p>
            <p>Instrument identity / adjustment / PIT availability: not certified.</p>
            <p>{t.disclaimer}</p>
            <p>{report.limitations.join(" · ")}</p>
          </section>
        </>}
      </div>
    </main>
  );
}
