"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang, applyLang } from "@/lib/i18n";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { fetchLargeTrades } from "@/lib/largeTrades/client";
import { parseIexDepthEnvelope, iexExecutionProfile, type IexDepthEnvelope, type IexDepthPoint } from "@/lib/iexDepthReplay";
import { useChartWidth, padDomain, niceTicks, fmtTick, thinLabels } from "@/components/charts/svgChart";
import css from "./futuresLab.module.css";

const timestamp = (ns: string) => new Date(Number(BigInt(ns) / BigInt(1000000))).toISOString().replace("T", " ").replace(".000Z", " UTC");
const price = (p: number) => (p / 10000).toFixed(4);

/** Each column is an observed state, not an interpolated or time-weighted interval. */
function DepthSnapshots({ samples, zh }: { samples: IexDepthPoint[]; zh: boolean }) {
  const pick = (en: string, cn: string) => zh ? cn : en;
  const host = useRef<HTMLDivElement>(null), width = useChartWidth(host, 640), height = 360;
  const points = samples.slice(-60), left = 8, right = Math.max(100, width - 78), top = 18, bottom = height - 44;
  const prices = points.flatMap(p => [...p.bids, ...p.asks].map(l => l.priceInt / 10000));
  const [lo, hi] = padDomain(prices.length ? Math.min(...prices) : 0, prices.length ? Math.max(...prices) : 1, { padFrac: .05 });
  const y = (p: number) => bottom - (p - lo) / (hi - lo) * (bottom - top);
  const dx = (right - left) / Math.max(1, points.length), x = (n: number) => left + (n + .5) * dx;
  const maximum = Math.max(1, ...points.flatMap(p => [...p.bids, ...p.asks].map(v => v.quantity)));
  const ticks = niceTicks(lo, hi, 6), labels = thinLabels(ticks.values.slice().reverse(), y, 28);
  const times = thinLabels(points.map((_, i) => i), x, 76);
  if (!prices.length) return <div ref={host} className={css.chart} data-testid="iex-depth-chart"><p role="status">{pick("No qualified displayed levels in these observations. No price axis is invented.", "这些观测中没有可信的展示价位，不虚构价格轴。")}</p></div>;
  return <div ref={host} className={css.chart} data-testid="iex-depth-chart">
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={pick("IEX observed depth snapshots", "IEX 已观测深度快照")}>
      {labels.map(p => <g key={p}><line x1={left} x2={right} y1={y(p)} y2={y(p)} stroke="#293449" />
        <text x={right + 6} y={y(p) + 4} fontSize="10" fill="#a7b4c9">{fmtTick(p, ticks.step)}</text></g>)}
      {points.map((point, n) => point.status === "unavailable" ?
        <g key={n} data-testid="iex-depth-gap"><rect x={left+n*dx} y={top} width={Math.max(1, dx)} height={bottom-top} fill="#777c8b" opacity=".2" />
          <title>{pick("Source gap: no depth inferred", "来源缺口：不推测深度")}</title></g> :
        <g key={n}>{(["bids", "asks"] as const).flatMap(side => point[side].map(level => <rect key={side+level.priceInt}
          data-testid="iex-depth-level" data-price-int={level.priceInt} data-quantity={level.quantity}
          x={left+n*dx} y={Math.max(top, Math.min(bottom-4, y(level.priceInt/10000)-2))} width={Math.max(1, dx-.5)} height="4"
          fill={side === "bids" ? "#3bd4b0" : "#ff8d93"} opacity={.25+.75*Math.log1p(level.quantity)/Math.log1p(maximum)}>
          <title>{`${price(level.priceInt)} · ${level.quantity} ${pick("shares", "股")}`}</title></rect>))}</g>)}
      {times.map(n => <text key={n} x={x(n)} y={height-18} textAnchor="middle" fontSize="9" fill="#a7b4c9">{timestamp(points[n].marketNs).slice(11,19)}</text>)}
    </svg>
  </div>;
}

type State = { key: string; status: "loading" | "ready" | "unavailable"; envelope?: IexDepthEnvelope };
export default function IexDepthReplayView({ initialSymbol }: { initialSymbol: string }) {
  const { lang } = useLang(), owner = useShellIdentity(), zh = lang === "zh";
  const pick = (en: string, cn: string) => zh ? cn : en;
  const [symbol, setSymbol] = useState(initialSymbol), [refresh, setRefresh] = useState(0);
  const [index, setIndex] = useState(-1), [mode, setMode] = useState<"depth" | "footprint">("depth");
  const [state, setState] = useState<State>({ key: "", status: "loading" });
  const key = JSON.stringify(owner) + ":" + symbol + ":" + refresh;
  useEffect(() => {
    const controller = new AbortController();
    void fetchLargeTrades(symbol, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const envelope = result.state === "ready" ? parseIexDepthEnvelope(result.envelope, symbol) : null;
      setState(envelope ? { key, status: "ready", envelope } : { key, status: "unavailable" });
    }).catch(() => { if (!controller.signal.aborted) setState({ key, status: "unavailable" }); });
    return () => controller.abort();
  }, [key, symbol]);
  const active = state.key === key ? state : { key, status: "loading" as const };
  const envelope = active.status === "ready" ? active.envelope : undefined;
  const points = envelope?.depthReplay.samples ?? [];
  const cursor = index < 0 ? points.length - 1 : Math.min(index, points.length - 1), current = points[cursor];
  const profile = useMemo(() => {
    if (!envelope || !current) return null;
    try { return iexExecutionProfile(envelope, current); } catch { return null; }
  }, [envelope, current]);
  const choose = (s: string) => { setSymbol(s); setIndex(-1); window.history.replaceState(null, "", "/options/equity-replay?symbol="+s); };
  return <main className="main2" style={{ overflow: "auto", minWidth: 0 }}><section className={css.page} data-testid="iex-depth-replay" lang={lang}>
    <header className={css.header}><div><h1>{pick("Equity depth replay", "股票深度回放")}</h1>
      <p>{pick("IEX venue only · historical archive · shares, not futures contracts", "仅 IEX 场所 · 历史档案 · 单位为股，不是期货合约")}</p>
      <p><Link href="/options/futures">{pick("Futures workspace", "期货工作区")}</Link> · <Link href="/terminal">{pick("Price chart", "价格图表")}</Link></p></div>
      <button aria-label="Language" onClick={() => applyLang(zh ? "en" : "zh")}>{pick("中文", "English")}</button>
    </header>
    <section className={css.controls}>
      <label>{pick("Symbol", "代码")}<select aria-label={pick("Symbol", "代码")} value={symbol} onChange={e => choose(e.target.value)}>
        {[...new Set([initialSymbol,"NVDA","SPY","QQQ"])].map(s => <option key={s}>{s}</option>)}</select></label>
      <button onClick={() => { setIndex(-1); setRefresh(n => n+1); }}>{pick("Refresh source", "刷新来源")}</button>
      <div className={css.tabs} role="tablist" aria-label={pick("Replay view", "回放视图")}>
        <button role="tab" aria-selected={mode === "depth"} onClick={() => setMode("depth")}>{pick("Depth snapshots", "深度快照")}</button>
        <button role="tab" aria-selected={mode === "footprint"} onClick={() => setMode("footprint")}>{pick("Executed volume", "成交量")}</button>
      </div>
    </section>
    <p className={css.warning}>{pick("Discrete observed books, not continuous liquidity or a full-session heatmap. No missing interval is filled. This is not live CME data or original intraday knowledge.", "离散观测订单簿，不代表连续流动性或完整交易日热力图；不填补缺失时段。这不是实时 CME 数据，也不是当时已知的信息。")}</p>
    {active.status === "loading" ? <p role="status">{pick("Reading the published archive…", "正在读取已发布档案…")}</p> : !envelope || !current ?
      <p role="status" data-testid="iex-depth-unavailable">{pick("No admitted IEX depth archive is available for this symbol. No synthetic source is substituted.", "该代码没有可用的获准 IEX 深度档案，不会用合成来源替代。")}</p> : <>
        <p data-testid="iex-depth-source">{symbol} · {timestamp(current.marketNs)} · {pick("Archive acquired", "档案获取于")}: {timestamp(current.availableNs)}</p>
        <label style={{ display: "block" }}>{pick("Observed snapshot", "观测快照")} {cursor+1}/{points.length}
          <input aria-label={pick("Observed snapshot", "观测快照")} type="range" min="0" max={points.length-1} value={cursor}
            onChange={e => setIndex(Number(e.target.value))} style={{ width: "100%", minHeight: 44 }} /></label>
        <section className={css.metrics}>
          <div><span>{pick("Observed bid shares", "观测买方挂单股数")}</span><strong data-testid="iex-bid-total">{current.status === "observed" ? current.bidTotal.toLocaleString("en-US") : "—"}</strong></div>
          <div><span>{pick("Observed ask shares", "观测卖方挂单股数")}</span><strong>{current.status === "observed" ? current.askTotal.toLocaleString("en-US") : "—"}</strong></div>
          <div><span>{pick("Captured executed shares through this state", "截至此状态捕获的成交股数")}</span><strong data-testid="iex-executed-total">{profile?.volume.toLocaleString("en-US") ?? "—"}</strong></div>
        </section>
        {mode === "depth" ? <DepthSnapshots samples={points.slice(0,cursor+1)} zh={zh} /> : <section className={css.inspector}>
          <h2>{pick("Price-by-price observed executions", "逐价观测成交")}</h2>
          <p>{pick("Net of observed trade breaks through this native sequence. Buy/sell requires an intact resting-order chain; other executions remain unclassified.", "按该原生序列扣除已观测撤销成交。买卖方向需要完整挂单链，其余成交保留为未分类。")}</p>
          <div style={{ overflowX:"auto", maxWidth:"100%" }}><table style={{ minWidth:320, width:"100%" }}><thead><tr>
            <th>{pick("Price", "价格")}</th><th>{pick("Sell", "卖出")}</th><th>{pick("Buy", "买入")}</th><th>{pick("Unknown", "未知")}</th></tr></thead>
            <tbody>{profile?.rows.slice(0,64).map(r => <tr key={r.priceInt} data-testid="iex-footprint-row"><td>{price(r.priceInt)}</td><td>{r.sell}</td><td>{r.buy}</td><td>{r.unknown}</td></tr>)}</tbody></table></div>
          {profile && profile.rows.length > 64 && <p>{pick("First 64 price rows shown; totals retain every captured execution.", "显示前64个价格行，总量保留全部已捕获成交。")}</p>}
        </section>}
        {current.status === "unavailable" && <p className={css.warning} data-testid="iex-book-gap">{pick("Order-chain coverage is incomplete. The book is withheld, not shown as zero.", "订单链覆盖不完整，暂不显示订单簿，而非将其显示为零。")}</p>}
        <section className={css.inspector}><h2>{pick("Source and limitations", "来源与限制")}</h2>
          <p>{pick("Partial captured window. Snapshot levels are bounded; no consolidated NBBO, hidden-order identity, trading advantage or options gamma is asserted.", "仅部分捕获时段，快照价位有数量上限；不代表综合最优买卖价、隐藏订单身份、交易优势或期权伽马。")}</p>
          <p>{pick("Some earlier snapshots omitted by the retention limit", "保留上限可能省略早期快照")}: {envelope.depthReplay.samplingTruncated ? pick("Yes", "是") : pick("No", "否")}</p>
          <p>{envelope.provenance.attribution} <a href="https://www.iex.io/legal/hist-data-terms" target="_blank" rel="noopener noreferrer">{pick("IEX historical data terms", "IEX 历史数据条款")}</a></p>
        </section>
      </>}
  </section></main>;
}
