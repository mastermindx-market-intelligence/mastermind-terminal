"use client";
/** Development consumer of real projection/reducer outputs. Synthetic input, never a live claim. */
import { useMemo, useRef, useState } from "react";
import { buildFuturesGexFrame } from "@/lib/futuresGexFrame";
import { useChartWidth, padDomain, niceTicks, fmtTick, thinLabels } from "@/components/charts/svgChart";
import fixture from "@/fixtures/futures-microstructure.json";
import css from "./futuresLab.module.css";

const L = {
  title: ["Futures microstructure", "期货微观结构"], lab: ["RESEARCH LAB · SYNTHETIC DATA", "研究实验室 · 合成数据"],
  warning: ["Development preview only. These are generated fixtures, not live CME data or trading evidence.", "仅为开发预览。数据为生成的测试样本，并非 CME 实时行情或交易证据。"],
  depth: ["Depth", "深度"], footprint: ["Footprint", "足迹"], mapping: ["Mapping", "价格映射"],
  basis: ["Price offset", "价差"], ratio: ["Price ratio", "价格比率"], normal: ["Normal fixture", "正常样本"],
  stale: ["Stale gamma quotes", "伽马报价过期"], late: ["Late gamma publication", "伽马延迟发布"], gap: ["Depth feed gap", "深度数据缺口"],
  scenario: ["Test scenario", "测试场景"], replay: ["Replay cutoff", "回放截止时间"], show: ["Show GEX", "显示 GEX"],
  volume: ["Observed contracts", "观测合约数"], delta: ["Known-side delta", "已知方向净量"], unknown: ["Unknown-side contracts", "方向未知合约数"],
  unavailable: ["Current GEX unavailable", "当前 GEX 不可用"], inspector: ["Source inspector", "来源详情"],
  estimate: ["Estimated SPX exposure · all expiries · source OI t−1", "SPX 估算敞口 · 全部到期日 · 来源持仓量为前一日"],
  liquidity: ["Displayed resting orders; excludes implied liquidity. Heat = time-weighted contracts. Hatching = missing coverage.", "展示的挂单，不含隐含流动性。热度代表按时间加权的合约数；斜线代表数据缺口。"],
  footprintHelp: ["Left = sell-aggressed; right = buy-aggressed. Gold = unknown side. Delta uses known sides only.", "左侧为主动卖出，右侧为主动买入，金色为方向未知。净量仅使用方向已知的成交。"],
  scale: ["Fixed exposure scale: 400M maximum. Circle = modeled GEX, not an execution.", "敞口使用固定的 4 亿刻度。圆点表示模型 GEX，而非成交。"],
  profile: ["Volume", "成交量"],
  quoteAge: ["quote age", "报价年龄"],
  noLive: ["No live feed connected", "未连接实时数据源"], zoom: ["Price zoom", "价格缩放"],
  original: ["SPX strike", "SPX 行权价"], mapped: ["ES level", "ES 价位"], exposure: ["GEX ($M / 1% SPX)", "GEX（百万美元 / SPX 变动 1%）"],
} as const;
export default function FuturesResearchLab() {
  const [lang, setLang] = useState<0 | 1>(0), [mode, setMode] = useState<"depth" | "footprint">("depth");
  const [mapping, setMapping] = useState<"basis" | "ratio">("ratio"), [fault, setFault] = useState("normal");
  const [cursor, setCursor] = useState(23), [showGex, setShowGex] = useState(true), [zoom, setZoom] = useState(1);
  const wrap = useRef<HTMLDivElement>(null), width = useChartWidth(wrap, 640), height = width < 700 ? 460 : 530;
  const t = (key: keyof typeof L) => L[key][lang];
  const allBars = fixture.footprint.bars.slice(0, cursor + 1);
  const gutter = mode === "footprint" ? (width < 700 ? 156 : 210) : (width < 700 ? 112 : 170);
  const visibleCount = mode === "footprint" ? Math.max(2, Math.floor((width - gutter - 12) / 66)) : 24;
  const startIndex = Math.max(0, allBars.length - visibleCount), bars = allBars.slice(startIndex);
  const frames = useMemo(() => Array.from({ length: cursor + 1 }, (_, i) => {
    const time = fixture.baseMs + (i + 1) * 60000, future = fixture.lastPrices[i], index = future - 20 + (i % 3) * .04;
    const badAge = i === cursor && fault === "stale" ? 60000 : 0;
    return buildFuturesGexFrame({
      quotes: { pair: "ES", indexRoot: "SPX", futuresContract: "ESZ6", indexPrice: index, futuresPrice: future,
        indexTimestampMs: time - 1000 - badAge, futuresTimestampMs: time - 500 - badAge },
      quoteAvailability: { indexAvailableAtMs: time - 900, futuresAvailableAtMs: time - 400,
        indexFeedBasis: "realtime", futuresFeedBasis: "realtime" },
      contract: { symbol: "ESZ6", definitionId: "synthetic:ESZ6:definition",
        validFromMs: fixture.baseMs - 86400000, validUntilMs: fixture.baseMs + 86400000 },
      source: { schema: "options_hub.gex/v1", root: "SPX", asof: "2026-10-09", coverage: { oi_date: "t-1" },
        by_strike: [{ strike: 7475, gamma_net: 65 + i }, { strike: 7480, gamma_net: -180 - i * 3 },
          { strike: 7485, gamma_net: 95 + i * 2 }] },
      sourceReceipt: { artifactId: `synthetic:gex:${i}`, sessionDate: "2026-10-09", sourceAsOfMs: time - 5000,
        availableAtMs: i === cursor && fault === "late" ? time + 1000 : time - 4000 },
      policy: { decisionTimeMs: time, maxQuoteAgeMs: 5000, maxExposureAgeMs: 60000, maxClockSkewMs: 2000, method: mapping },
    });
  }), [cursor, fault, mapping]);
  const current = frames[cursor], color = (v: number) => v >= 0 ? "#3bd4b0" : "#ff6c82";
  const plotLeft = 12, plotRight = Math.max(plotLeft + 90, width - gutter);
  const plotTop = 26, plotBottom = height - 48, step = (plotRight - plotLeft) / Math.max(bars.length, 1);
  const center = allBars[allBars.length - 1].closeTicks / 4;
  const half = mode === "footprint" ? (zoom === 1 ? 3 : 1.75) : 4;
  const fullDepth = mode === "depth" && zoom === 1;
  const [low, high] = padDomain(fullDepth ? 7494.5 : center - half, fullDepth ? 7510.5 : center + half, { padFrac: .02 });
  const y = (price: number) => plotBottom - (price - low) / (high - low) * (plotBottom - plotTop);
  const x = (index: number) => plotLeft + (index - startIndex + .5) * step;
  const ticks = niceTicks(low, high, 7);
  const labelTicks = thinLabels(ticks.values.slice().reverse(), p => y(p), 36);
  const cols = (fault === "gap" ? fixture.depthGap : fixture.depth).columns.slice(startIndex, cursor + 1);
  const volume = allBars.reduce((s, b) => s + b.total, 0), delta = allBars.reduce((s, b) => s + b.deltaKnown, 0);
  const unknown = allBars.reduce((s, b) => s + b.unknown, 0);
  // Aggregate ONLY bars admitted by the replay cutoff, never the full fixture profile.
  const profile = new Map<number, { buy: number; sell: number; unknown: number }>();
  for (const bar of allBars) for (const cell of bar.cells) {
    const prior = profile.get(cell.priceTicks) ?? { buy: 0, sell: 0, unknown: 0 };
    prior.buy += cell.buy; prior.sell += cell.sell; prior.unknown += cell.unknown;
    profile.set(cell.priceTicks, prior);
  }
  const profilePeak = Math.max(1, ...[...profile.values()].map(cell => Math.max(cell.buy, cell.sell)));
  const profileCenter = plotRight + (width < 700 ? 84 : 100), profileHalf = width < 700 ? 22 : 32;
  const gammaLeft = mode === "footprint" ? plotRight + (width < 700 ? 118 : 144) : plotRight + 64;
  const gammaWidth = Math.max(12, width - gammaLeft - 6);
  const heat = (size: number) => size >= 260 ? `rgba(255,220,128,${Math.min(.95, size / 500)})`
    : size >= 180 ? `rgba(79,211,221,${Math.min(.85, size / 400)})` : `rgba(72,105,204,${Math.min(.6, size / 300)})`;

  const timeLabel = (i: number) => new Date(fixture.baseMs + (i + 1) * 60000).toISOString().slice(11, 16);
  const times = thinLabels(bars.map((_, i) => i + startIndex), x, 65);
  return <main className={css.page} data-testid="futures-lab" lang={lang ? "zh" : "en"}>
    <header className={css.header}><div><span className={css.eyebrow}>{t("lab")}</span><h1>{t("title")}</h1>
      <p>{fixture.contract} · SPX → ES · {t("noLive")}</p></div>
      <button onClick={() => setLang(lang ? 0 : 1)} aria-label="Language">{lang ? "English" : "中文"}</button></header>
    <p className={css.warning}>{t("warning")}</p>
    <section className={css.controls} aria-label={t("title")}>
      <div className={css.tabs} role="tablist" aria-label="Chart view">
        {(["depth", "footprint"] as const).map(v => <button role="tab" key={v} aria-selected={mode === v} onClick={() => setMode(v)}>{t(v)}</button>)}
      </div>
      <label>{t("mapping")}<select aria-label="Mapping" value={mapping} onChange={e => setMapping(e.target.value as "basis" | "ratio")}>
        <option value="ratio">{t("ratio")}</option><option value="basis">{t("basis")}</option></select></label>
      <label>{t("scenario")}<select aria-label="Test scenario" value={fault} onChange={e => setFault(e.target.value)}>
        {(["normal", "stale", "late", "gap"] as const).map(v => <option key={v} value={v}>{t(v)}</option>)}</select></label>
      <label className={css.checkbox}><input type="checkbox" checked={showGex} onChange={e => setShowGex(e.target.checked)} />{t("show")}</label>
      <button onClick={() => setZoom(zoom === 1 ? 2 : 1)}>{t("zoom")} {zoom}×</button>
    </section>
    <section className={css.metrics} aria-live="polite">
      <div><span>{t("volume")}</span><strong data-testid="futures-volume">{volume.toLocaleString("en-US")}</strong></div>
      <div><span>{t("delta")}</span><strong>{delta > 0 ? "+" : ""}{delta.toLocaleString("en-US")}</strong></div>
      <div><span>{t("unknown")}</span><strong>{unknown}</strong></div>
    </section>
    <div className={css.chart} ref={wrap}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${t(mode)} · ${timeLabel(cursor)} UTC`}>
        <defs><clipPath id="futures-plot"><rect x={plotLeft} y={plotTop} width={plotRight - plotLeft} height={plotBottom - plotTop} /></clipPath>
          <pattern id="futures-gap" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-2,2L2,-2M0,8L8,0M6,10L10,6" stroke="#9ba6bb" strokeWidth="1" /></pattern></defs>
        {labelTicks.map(p => <g key={p}><line x1={plotLeft} x2={width - 6} y1={y(p)} y2={y(p)} stroke="#25324a" />
          <text x={plotRight + 6} y={y(p) - 5} fill="#b0bbce" fontSize="11">{fmtTick(p, ticks.step)}</text></g>)}
        <g clipPath="url(#futures-plot)">
          {mode === "depth" && cols.map((col, n) => <g key={col.startNs}>
            {col.levels.map(cell => cell.bidMean === null ? null : <rect key={cell.priceTicks} x={x(startIndex + n) - step / 2}
              y={y(cell.priceTicks / 4 + .125)} width={step + .2} height={Math.max(1, y(cell.priceTicks / 4 - .125) - y(cell.priceTicks / 4 + .125))}
              fill={heat((cell.bidMean ?? 0) + (cell.askMean ?? 0))} />)}
            {col.coverage !== "full" && <rect data-testid="depth-gap" x={x(startIndex + n) - step / 2} y={plotTop}
              width={step} height={plotBottom - plotTop} fill="url(#futures-gap)" opacity=".6"><title>{col.coverage}</title></rect>}
          </g>)}
          {bars.map((bar, n) => <g key={bar.startNs}>
            {mode === "depth" ? <><line x1={x(startIndex + n)} x2={x(startIndex + n)} y1={y(bar.highTicks / 4)} y2={y(bar.lowTicks / 4)} stroke={color(bar.closeTicks - bar.openTicks)} />
              <rect x={x(startIndex + n) - Math.min(5, step * .25)} y={Math.min(y(bar.openTicks / 4), y(bar.closeTicks / 4))}
                width={Math.min(10, step * .5)} height={Math.max(2, Math.abs(y(bar.openTicks / 4) - y(bar.closeTicks / 4)))} fill={color(bar.closeTicks - bar.openTicks)} /></>
              : bar.cells.map(cell => <g key={cell.priceTicks}><rect x={x(startIndex + n) - step * .45} y={y(cell.priceTicks / 4) - 7} width={step * .9} height="15" fill="#1b2942" />
                <text x={x(startIndex + n) - 3} y={y(cell.priceTicks / 4) + 4} textAnchor="end" fill="#ff8a99" fontSize="10">{cell.sell}</text>
                <text x={x(startIndex + n) + 3} y={y(cell.priceTicks / 4) + 4} fill="#5dddbf" fontSize="10">{cell.buy}</text>
                {cell.unknown > 0 && <circle cx={x(startIndex + n)} cy={y(cell.priceTicks / 4) - 8} r="3" fill="#ffd47a"><title>{`${cell.unknown} ${t("unknown")}`}</title></circle>}
              </g>)}
          </g>)}
          {showGex && frames.slice(startIndex).map((frame, n) => frame.status !== "ok" ? null : frame.projection.mapped.map(level =>
            level.gammaNetMn === null ? null : <circle key={`${n}:${level.sourceStrike}`} data-testid="gex-bubble" cx={x(startIndex + n)} cy={y(level.futuresPrice)}
              r={8 * Math.sqrt(Math.min(400, Math.abs(level.gammaNetMn)) / 400)} fill={color(level.gammaNetMn)} fillOpacity=".55" stroke={color(level.gammaNetMn)}>
              <title>{`${level.sourceStrike} → ${level.futuresPrice.toFixed(2)} · ${level.gammaNetMn}M`}</title></circle>))}
        </g>
        {mode === "footprint" && <g data-testid="futures-volume-profile">
          <text x={profileCenter} y={16} textAnchor="middle" fill="#a9b6cf" fontSize="9">{t("profile")}</text>
          {[...profile.entries()].map(([tick, cell]) => y(tick / 4) < plotTop || y(tick / 4) > plotBottom ? null : <g key={tick}>
            <rect x={profileCenter - cell.sell / profilePeak * profileHalf} y={y(tick / 4) - 3}
              width={cell.sell / profilePeak * profileHalf} height="6" fill="#ff6c82" />
            <rect x={profileCenter} y={y(tick / 4) - 3} width={cell.buy / profilePeak * profileHalf} height="6" fill="#3bd4b0" />
            {cell.unknown > 0 && <circle cx={profileCenter} cy={y(tick / 4)} r="2" fill="#ffd47a" />}
            <title>{`${tick / 4}: ${cell.sell} / ${cell.buy}; ${cell.unknown} ${t("unknown")}`}</title>
          </g>)}
        </g>}
        {showGex && <text x={gammaLeft} y={16} fill="#a9b6cf" fontSize="9">GEX</text>}
        {showGex && current.status === "ok" && current.projection.mapped.map(level =>
          level.gammaNetMn === null || y(level.futuresPrice) < plotTop || y(level.futuresPrice) > plotBottom ? null : <g key={level.sourceStrike}>
          <rect x={gammaLeft} y={y(level.futuresPrice) - 3} width={Math.min(gammaWidth, Math.abs(level.gammaNetMn) / 400 * gammaWidth)} height="6" fill={color(level.gammaNetMn)} />
          <text x={gammaLeft} y={y(level.futuresPrice) - 8} fill={color(level.gammaNetMn)} fontSize="10">{level.gammaNetMn}M</text></g>)}
        {times.map(i => <text key={i} x={x(i)} y={height - 20} textAnchor="middle" fill="#a9b6cf" fontSize="11">{timeLabel(i)}</text>)}
        <text x={width - 6} y={height - 5} textAnchor="end" fill="#a9b6cf" fontSize="10">UTC · {mapping}</text>
      </svg>
    </div>
    <section className={css.replay}><label htmlFor="futures-replay">{t("replay")} · <strong>{timeLabel(cursor)} UTC</strong></label>
      <input id="futures-replay" type="range" min="0" max="23" step="1" value={cursor} onChange={e => setCursor(Number(e.target.value))} />
      <p>{t(mode === "depth" ? "liquidity" : "footprintHelp")} {t("scale")}</p></section>
    <section className={css.inspector}><h2>{t("inspector")}</h2><p>{t("estimate")}</p>
      {current.status !== "ok" ? <p role="status" data-testid="gex-unavailable">{t("unavailable")}: {current.reason}</p> : <>
        <p className={css.receipt}>ESZ6 · {current.projection.method} · F−S {current.projection.basis.toFixed(4)} · F/S {current.projection.ratio.toFixed(7)} · {t("quoteAge")} {current.provenance.quoteAgeMs}ms</p>
        <table><thead><tr><th>{t("original")}</th><th>{t("mapped")}</th><th>{t("exposure")}</th></tr></thead><tbody>
          {current.projection.mapped.map(row => <tr key={row.sourceStrike}><td>{row.sourceStrike}</td><td data-testid="mapped-level">{row.futuresPrice.toFixed(4)}</td><td>{row.gammaNetMn}</td></tr>)}
        </tbody></table></>}
    </section>
  </main>;
}
