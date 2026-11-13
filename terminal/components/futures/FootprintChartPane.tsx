"use client";

/** Main-chart order-flow presentation. The futures API remains the only data owner. */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { DEFAULT_FUTURES_REQUEST, futuresQuery } from "@/lib/futuresRequest";
import type { FootprintPair, FootprintInterval } from "@/lib/footprintChartMode";
import { footprintEligibility } from "@/lib/footprintChartMode";
import { useLang } from "@/lib/i18n";
import { useFuturesText } from "@/lib/futuresUiCopy";
import { useFuturesWorkspace } from "./useFuturesWorkspace";
import FuturesMicrostructureChart from "./FuturesMicrostructureChart";
import styles from "./FootprintChartPane.module.css";

export default function FootprintChartPane({ symbol, timeframe, dataReady }: {
  symbol: string; timeframe: string; dataReady: boolean;
}) {
  const { lang } = useLang();
  const eligibility = footprintEligibility(symbol, timeframe);
  const zh = lang === "zh";
  const link = `/options/futures?${futuresQuery({ ...DEFAULT_FUTURES_REQUEST, pair: "NQ" })}`;

  if (!dataReady) return <section className={styles.root} role="status" data-testid="footprint-loading">
    {zh ? "正在准备订单流视图…" : "Preparing order-flow view…"}
  </section>;

  if (eligibility.status !== "supported") return <section className={styles.root} data-testid="footprint-unavailable">
    <div className={styles.placeholder}>
      <h2>{zh ? "订单流足迹图" : "Order-flow footprint"}</h2>
      <p>{eligibility.status === "unsupported_symbol"
        ? zh ? "足迹图需要逐笔成交数据。目前主图仅支持 ES 和 NQ 期货；不能从股票 K 线推算买卖盘成交。"
          : "Footprints need individual trade executions. Only ES and NQ futures are connected to this view; stock candles cannot provide bid/ask volume."
        : zh ? "当前足迹数据只支持 1 分钟和 5 分钟周期。请在顶部选择 1m 或 5m。"
          : "The captured futures tape supports 1m and 5m intervals. Choose 1m or 5m in the chart toolbar."}</p>
      <Link className={styles.action} href={link}>{zh ? "打开 NQ 期货足迹" : "Open NQ futures footprint"}</Link>
    </div>
  </section>;

  return <SupportedFootprint pair={eligibility.pair} intervalMinutes={eligibility.intervalMinutes} />;
}

function SupportedFootprint({ pair, intervalMinutes }: { pair: FootprintPair; intervalMinutes: FootprintInterval }) {
  const { lang } = useLang();
  const t = useFuturesText();
  const zh = lang === "zh";
  const identity = useShellIdentity();
  const [rows, setRows] = useState<1 | 4 | 8>(1);
  const [showCvd, setShowCvd] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const request = useMemo(() => ({
    ...DEFAULT_FUTURES_REQUEST, pair, intervalMinutes, priceStepTicks: rows,
  }), [pair, intervalMinutes, rows]);
  const state = useFuturesWorkspace(request, JSON.stringify(identity), refresh);
  const data = state.status === "data" ? state.data : undefined;
  const total = data?.frames.reduce((n, frame) => n + frame.bar.total, 0) ?? 0;
  const delta = data?.frames.reduce((n, frame) => n + frame.bar.deltaKnown, 0) ?? 0;
  const unknown = data?.frames.reduce((n, frame) => n + frame.bar.unknown, 0) ?? 0;
  const link = `/options/futures?${futuresQuery(request)}`;

  return <section className={styles.root} aria-label={zh ? "订单流足迹图" : "Order-flow footprint chart"}
    data-testid="terminal-footprint" data-pair={pair} data-interval={intervalMinutes}>
    <div className={styles.toolbar}>
      <div className={styles.heading}>
        <strong>{pair} · {zh ? "成交足迹图" : "Footprint"}</strong>
        <span>{zh ? "逐价位主动买卖成交量" : "Executed buy/sell volume by price level"}</span>
      </div>
      <label className={styles.control}>{zh ? "每行跳动" : "Ticks / row"}
        <select aria-label={zh ? "每行跳动" : "Ticks per price row"} value={rows}
          onChange={e => setRows(Number(e.target.value) as 1 | 4 | 8)}>
          <option value="1">1</option><option value="4">4</option><option value="8">8</option>
        </select>
      </label>
      <label className={styles.control}><input type="checkbox" checked={showCvd}
        onChange={e => setShowCvd(e.target.checked)} />{zh ? "累计量差" : "CVD"}</label>
      <button type="button" onClick={() => setZoom(z => z === 1 ? 2 : 1)}>{zh ? "放大" : "Zoom"} {zoom}×</button>
      <button type="button" onClick={() => setRefresh(n => n + 1)}>{zh ? "刷新" : "Refresh"}</button>
      <Link className={styles.action} href={link}>{zh ? "完整期货分析" : "Full futures view"}</Link>
    </div>

    {state.status === "loading" && <p role="status" className={styles.warning} data-testid="footprint-fetching">
      {zh ? "正在读取已授权的期货逐笔成交…" : "Loading authorized futures executions…"}
    </p>}
    {state.status === "unavailable" && <p role="status" className={styles.warning} data-testid="footprint-source-unavailable">
      {t(state.reason ?? "source_unavailable")}
      {" "}{zh ? "不能使用 K 线成交量代替足迹图。" : "OHLC volume is not substituted for missing trade prints."}
    </p>}
    {data && <>
      <p className={styles.source} data-testid="footprint-source-basis">
        {data.contract} · {data.basis === "historical" ? (zh ? "历史回放" : "Historical capture")
          : data.basis === "delayed" ? (zh ? "延时数据" : "Delayed tape") : (zh ? "实时来源" : "Real-time source")}
        {" · "}{new Date(data.cutoffMs).toISOString().slice(0, 16).replace("T", " ")} UTC
        {" · "}{zh ? "来源" : "Source"}: {data.sourceId}
      </p>
      {data.tradeCoverage !== "complete" && <p role="status" className={styles.warning} data-testid="footprint-partial-coverage">
        {zh ? "成交覆盖不完整。显示的成交量与量差仅统计已捕获的逐笔数据，空白不等于零成交。"
          : "Incomplete trade coverage. Volume and delta include captured executions only; missing prints do not mean zero volume."}
      </p>}
      {!data.frames.length && <p role="status" className={styles.warning} data-testid="footprint-no-intervals">
        {zh ? "此窗口无已完成的成交区间。" : "No completed trade intervals in this capture."}
      </p>}
      <div className={styles.summary} data-testid="footprint-summary">
        <span>{zh ? "观测成交量" : "Observed volume"} <b>{total.toLocaleString("en-US")}</b></span>
        <span>{zh ? "已知方向量差" : "Known-side delta"} <b>{delta > 0 ? "+" : ""}{delta.toLocaleString("en-US")}</b></span>
        <span>{zh ? "方向未知" : "Unknown side"} <b>{unknown.toLocaleString("en-US")}</b></span>
      </div>
      <FuturesMicrostructureChart frames={data.frames} mode="footprint" showGex={false}
        showCvd={showCvd} zoom={zoom} lowTick={data.lowTick} highTick={data.highTick}
        priceStepTicks={rows} lang={zh ? 1 : 0} contract={data.contract} method={request.method} />
      <p className={styles.note}>{zh
        ? "绿色：主动买入；红色：主动卖出。右侧为观测窗口的成交量分布。非挂单簿深度，也非交易信号。"
        : "Green: aggressor buys. Red: aggressor sells. Right: observed-window volume profile. This is executed volume, not resting order-book depth or a trade signal."}</p>
    </>}
  </section>;
}
