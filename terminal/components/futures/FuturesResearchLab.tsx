"use client";
/** Synthetic inputs/scenarios stay in this production-disabled harness, not the renderer. */
import { useMemo, useState } from "react";
import type { ExpiryLens } from "@/lib/gexLadder";
import { buildFuturesLabFrames, type FuturesLabDataset } from "@/lib/futuresWorkspace";
import FuturesMicrostructureChart from "./FuturesMicrostructureChart";
import esData from "@/fixtures/futures-microstructure.json";
import nqData from "@/fixtures/futures-microstructure-nq.json";
import css from "./futuresLab.module.css";

const DATASETS: Record<"ES" | "NQ", FuturesLabDataset> = { ES: esData as FuturesLabDataset, NQ: nqData as FuturesLabDataset };
const L = {
  chartView: ["Chart view", "图表视图"],
  gammaHeading: ["Gamma exposure", "伽马敞口"],
  cvd: ["Show cumulative delta", "显示累积净量"],
  title: ["Futures microstructure", "期货微观结构"], lab: ["RESEARCH LAB · SYNTHETIC DATA", "研究实验室 · 合成数据"],
  warning: ["Development preview only. These are generated fixtures, not live CME data or trading evidence.", "仅为开发预览。数据为生成的测试样本，并非 CME 实时行情或交易证据。"],
  depth: ["Depth", "深度"], footprint: ["Footprint", "足迹"], mapping: ["Mapping", "价格映射"],
  basis: ["Price offset", "价差"], ratio: ["Price ratio", "价格比率"], normal: ["Normal fixture", "正常样本"],
  stale: ["Stale gamma quotes", "伽马报价过期"], late: ["Late gamma publication", "伽马延迟发布"], gap: ["Depth feed gap", "深度数据缺口"],
  "matrix-late": ["Late expiry matrix", "到期矩阵延迟发布"],
  scenario: ["Test scenario", "测试场景"], replay: ["Replay cutoff", "回放截止时间"], show: ["Show GEX", "显示 GEX"],
  volume: ["Observed contracts", "观测合约数"], delta: ["Known-side delta", "已知方向净量"], unknown: ["Unknown-side contracts", "方向未知合约数"],
  unavailable: ["Current GEX unavailable", "当前 GEX 不可用"], inspector: ["Source inspector", "来源详情"],
  liquidity: ["Displayed resting orders; excludes implied liquidity. Heat = time-weighted contracts. Hatching = missing coverage.", "展示的挂单，不含隐含流动性。热度代表按时间加权的合约数；斜线代表数据缺口。"],
  footprintHelp: ["Left = sell-aggressed; right = buy-aggressed. Gold = unknown side. Delta uses known sides only.", "左侧为主动卖出，右侧为主动买入，金色为方向未知。净量仅使用方向已知的成交。"],
  scale: ["Fixed exposure scale: 400M maximum. Circle = modeled GEX, not an execution.", "敞口使用固定的 4 亿刻度。圆点表示模型 GEX，而非成交。"],
  quoteAge: ["quote age", "报价年龄"], noLive: ["No live feed connected", "未连接实时数据源"], zoom: ["Price zoom", "价格缩放"],
  instrument: ["Instrument", "交易品种"], interval: ["Interval", "时间区间"], rows: ["Price rows", "价位分组"],
  expiry: ["Expiry lens", "到期筛选"], all: ["All expiries", "全部到期日"], zero: ["Source-session expiry (0DTE)", "来源交易日到期（0DTE）"],
  "ex-zero": ["Later expiries", "后续到期日"], one: ["Oct 16, 2026", "2026年10月16日"],
  sourceSession: ["Source session", "来源交易日"], through: ["Plotted through", "图表截至"],
  completed: ["Completed intervals only; changing the interval never advances the replay cutoff.", "仅显示已完成的时间区间；切换区间不会提前回放截止时间。"],
  basisNotice: ["Expiry dates refer to the source session, not a guarantee the contracts are still tradable. Source OI: t−1.", "到期日期以来源交易日为准，不保证合约仍可交易。来源持仓量为前一日。"],
} as const;

export default function FuturesResearchLab() {
  const [lang, setLang] = useState<0 | 1>(0), [mode, setMode] = useState<"depth" | "footprint">("depth");
  const [pair, setPair] = useState<"ES" | "NQ">("ES"), [mapping, setMapping] = useState<"basis" | "ratio">("ratio");
  const [fault, setFault] = useState("normal"), [cursor, setCursor] = useState(23), [showGex, setShowGex] = useState(true);
  const [showCvd, setShowCvd] = useState(true);
  const [zoom, setZoom] = useState(1), [interval, setInterval] = useState(1), [priceStep, setPriceStep] = useState(1);
  const [expiry, setExpiry] = useState<ExpiryLens["kind"]>("all");
  const dataset = DATASETS[pair], cutoffMs = dataset.baseMs + (cursor + 1) * 60000;
  const t = (key: keyof typeof L) => L[key][lang];
  const frames = useMemo(() => buildFuturesLabFrames(dataset, { cutoffMs, intervalMinutes: interval, priceStepTicks: priceStep,
    lens: expiry === "one" ? { kind: "one", exp: "2026-10-16" } : { kind: expiry }, method: mapping, fault }),
  [dataset, cutoffMs, interval, priceStep, expiry, mapping, fault]);
  const current = frames.at(-1)?.gex;
  const volume = frames.reduce((sum, f) => sum + f.bar.total, 0), delta = frames.reduce((sum, f) => sum + f.bar.deltaKnown, 0);
  const unknown = frames.reduce((sum, f) => sum + f.bar.unknown, 0);
  const time = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  return <main className={css.page} data-testid="futures-lab" lang={lang ? "zh" : "en"}>
    <header className={css.header}><div><span className={css.eyebrow}>{t("lab")}</span><h1>{t("title")}</h1>
      <p data-testid="futures-instrument">{dataset.contract} · {dataset.indexRoot} → {pair} · {t("noLive")}</p></div>
      <button onClick={() => setLang(lang ? 0 : 1)} aria-label="Language">{lang ? "English" : "中文"}</button></header>
    <p className={css.warning}>{t("warning")}</p>
    <section className={css.controls} aria-label={t("title")}>
      <div className={css.tabs} role="tablist" aria-label={t("chartView")}>
        {(["depth", "footprint"] as const).map(v => <button role="tab" key={v} aria-selected={mode === v} onClick={() => setMode(v)}>{t(v)}</button>)}
      </div>
      <label>{t("instrument")}<select aria-label="Instrument" value={pair} onChange={e => { setPair(e.target.value as "ES" | "NQ"); setZoom(1); }}>
        <option value="ES">ESZ6 · SPX</option><option value="NQ">NQZ6 · NDX</option></select></label>
      <label>{t("interval")}<select aria-label="Interval" value={interval} onChange={e => setInterval(Number(e.target.value))}>
        <option value="1">{lang ? "1 分钟" : "1 minute"}</option><option value="5">{lang ? "5 分钟" : "5 minutes"}</option></select></label>
      <label>{t("rows")}<select aria-label="Price rows" value={priceStep} onChange={e => setPriceStep(Number(e.target.value))}>
        {[1, 4, 8].map(n => <option key={n} value={n}>{n} {lang ? "跳" : "ticks"} · {(n / 4).toFixed(2)}</option>)}</select></label>
      <label>{t("expiry")}<select aria-label="Expiry lens" value={expiry} onChange={e => setExpiry(e.target.value as ExpiryLens["kind"])}>
        {(["all", "zero", "ex-zero", "one"] as const).map(v => <option key={v} value={v}>{t(v)}</option>)}</select></label>
      <label>{t("mapping")}<select aria-label="Mapping" value={mapping} onChange={e => setMapping(e.target.value as "basis" | "ratio")}>
        <option value="ratio">{t("ratio")}</option><option value="basis">{t("basis")}</option></select></label>
      <label>{t("scenario")}<select aria-label="Test scenario" value={fault} onChange={e => setFault(e.target.value)}>
        {(["normal", "stale", "late", "matrix-late", "gap"] as const).map(v => <option key={v} value={v}>{t(v)}</option>)}</select></label>
      <label className={css.checkbox}><input type="checkbox" checked={showGex} onChange={e => setShowGex(e.target.checked)} />{t("show")}</label>
      <label className={css.checkbox}><input type="checkbox" checked={showCvd} onChange={e => setShowCvd(e.target.checked)} />{t("cvd")}</label>
      <button onClick={() => setZoom(zoom === 1 ? 2 : 1)}>{t("zoom")} {zoom}×</button>
    </section>
    <section className={css.metrics} aria-live="polite">
      <div><span>{t("volume")}</span><strong data-testid="futures-volume">{volume.toLocaleString("en-US")}</strong></div>
      <div><span>{t("delta")}</span><strong>{delta > 0 ? "+" : ""}{delta.toLocaleString("en-US")}</strong></div>
      <div><span>{t("unknown")}</span><strong>{unknown}</strong></div>
    </section>
    <FuturesMicrostructureChart frames={frames} mode={mode} showGex={showGex} zoom={zoom} lowTick={dataset.lowTick}
      highTick={dataset.highTick} priceStepTicks={priceStep} lang={lang} contract={dataset.contract} method={mapping} showCvd={showCvd} />
    <section className={css.replay}><label htmlFor="futures-replay">{t("replay")} · <strong>{time(cutoffMs)} UTC</strong></label>
      <input id="futures-replay" type="range" min="0" max="23" step="1" value={cursor} onChange={e => setCursor(Number(e.target.value))} />
      <p data-testid="futures-plotted-through">{t("through")}: {frames.length ? time(frames.at(-1)!.endMs) : "—"} UTC. {t("completed")}</p>
      <p>{t(mode === "depth" ? "liquidity" : "footprintHelp")} {t("scale")}</p></section>
    <section className={css.inspector}><h2>{t("inspector")}</h2>
      <p data-testid="futures-expiry-basis">{dataset.indexRoot} · {t(expiry)} · {t("sourceSession")}: {dataset.sessionId}. {t("basisNotice")}</p>
      {!current || current.status !== "ok" ? <p role="status" data-testid="gex-unavailable">{t("unavailable")}: {current?.reason ?? "no_completed_interval"}</p> : <>
        <p className={css.receipt}>{dataset.contract} · {current.projection.method} · F−S {current.projection.basis.toFixed(4)} · F/S {current.projection.ratio.toFixed(7)} · {t("quoteAge")} {current.provenance.quoteAgeMs}ms</p>
        <p className={css.receipt} data-testid="futures-source-reference">{current.provenance.artifactId}{current.provenance.matrixArtifactId ? ` · ${current.provenance.matrixArtifactId}` : ""}</p>
        <table><thead><tr><th>{dataset.indexRoot} {lang ? "行权价" : "strike"}</th><th>{pair} {lang ? "价位" : "level"}</th>
          <th>{t("gammaHeading")} ($M / 1% {dataset.indexRoot})</th></tr></thead><tbody>
          {current.projection.mapped.map(row => <tr key={row.sourceStrike}><td>{row.sourceStrike}</td>
            <td data-testid="mapped-level">{row.futuresPrice.toFixed(4)}</td><td data-testid="mapped-exposure">{row.gammaNetMn === null ? "—" : row.gammaNetMn.toFixed(2)}</td></tr>)}
        </tbody></table></>}
    </section>
  </main>;
}
