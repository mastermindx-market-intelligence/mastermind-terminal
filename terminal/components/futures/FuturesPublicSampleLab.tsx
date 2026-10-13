"use client";
import { useState } from "react";
import type { FuturesPublicSampleView } from "@/lib/futuresSampleView";
import FuturesMicrostructureChart from "./FuturesMicrostructureChart";
import css from "./futuresLab.module.css";

export default function FuturesPublicSampleLab({ data }: { data: FuturesPublicSampleView }) {
  const [mode, setMode] = useState<"depth" | "footprint">("depth"), [cursor, setCursor] = useState(data.framesByCutoff.length - 1);
  const [lang, setLang] = useState<0 | 1>(0), [zoom, setZoom] = useState(1), [showCvd, setShowCvd] = useState(true);
  const frames = data.framesByCutoff[cursor], through = data.baseMs + (cursor + 1) * 60000;
  const volume = frames.reduce((sum, f) => sum + f.bar.total, 0), delta = frames.reduce((sum, f) => sum + f.bar.deltaKnown, 0);
  const unknown = frames.reduce((sum, f) => sum + f.bar.unknown, 0);
  const pick = (en: string, zh: string) => lang ? zh : en;
  return <main className={css.page} data-testid="futures-public-sample" lang={lang ? "zh" : "en"}>
    <header className={css.header}><div><span className={css.eyebrow}>{pick("HISTORICAL PUBLIC SAMPLE · INTERNAL VERIFICATION", "历史公开样本 · 内部验证")}</span>
      <h1>{pick("Real-source futures verification", "真实来源期货验证")}</h1>
      <p>{data.contract} · {new Date(data.baseMs).toISOString().slice(0, 10)} · {pick("Not a live connection", "并非实时连接")}</p></div>
      <button aria-label="Language" onClick={() => setLang(lang ? 0 : 1)}>{lang ? "English" : "中文"}</button></header>
    <p className={css.warning}>{pick("Historical vendor sample, not synthetic prices. This internal view does not establish live-market access or subscriber redistribution rights.",
      "这是供应商历史样本，价格不是合成数据。此内部视图不代表已取得实时行情访问或订阅者分发许可。")}</p>
    <section className={css.controls}>
      <div role="tablist" aria-label={pick("Chart view", "图表视图")} className={css.tabs}>
        <button role="tab" aria-selected={mode === "depth"} onClick={() => setMode("depth")}>{pick("Depth", "深度")}</button>
        <button role="tab" aria-selected={mode === "footprint"} onClick={() => setMode("footprint")}>{pick("Footprint", "足迹")}</button>
      </div>
      <label className={css.checkbox}><input type="checkbox" checked={showCvd} onChange={e => setShowCvd(e.target.checked)} />{pick("Show cumulative delta", "显示累积净量")}</label>
      <button onClick={() => setZoom(zoom === 1 ? 2 : 1)}>{pick("Price zoom", "价格缩放")} {zoom}×</button>
    </section>
    <section className={css.metrics} aria-live="polite">
      <div><span>{pick("Observed contracts", "观测合约数")}</span><strong data-testid="sample-volume">{volume.toLocaleString("en-US")}</strong></div>
      <div><span>{pick("Known-side delta", "已知方向净量")}</span><strong>{delta}</strong></div>
      <div><span>{pick("Unknown-side contracts", "方向未知合约数")}</span><strong>{unknown}</strong></div>
    </section>
    <FuturesMicrostructureChart frames={frames} mode={mode} showGex={false} showCvd={showCvd} zoom={zoom}
      lowTick={data.lowTick} highTick={data.highTick} priceStepTicks={1} lang={lang} contract={data.contract} method="historical" />
    <section className={css.replay}><label htmlFor="futures-sample-replay">{pick("Replay cutoff", "回放截止时间")} · {new Date(through).toISOString().slice(11, 19)} UTC</label>
      <input id="futures-sample-replay" type="range" min="0" max={data.framesByCutoff.length - 1} value={cursor}
        onChange={e => setCursor(Number(e.target.value))} />
      <p>{pick("Depth integrates every completed source event inside the initial price window. Times are historical vendor capture times, not historical Mastermind receipt times.",
        "深度在初始价格窗口内整合每一个已完成的来源事件。时间为供应商历史采集时间，并非 Mastermind 当时接收时间。")}</p>
    </section>
    <section className={css.inspector}><h2>{pick("Verification and missing inputs", "验证结果与缺失输入")}</h2>
      <p data-testid="sample-gex-unavailable">{pick("GEX unavailable: this sample contains no contemporaneous SPX positioning or index-to-futures quote pair. No generated gamma is overlaid on these real prices.",
        "GEX 不可用：此样本没有同时点 SPX 持仓或指数与期货配对报价。未在真实价格上叠加生成的伽马数据。")}</p>
      <p data-testid="sample-comparison">{data.comparison.exact.toLocaleString("en-US")} / {data.comparison.compared.toLocaleString("en-US")} {pick("BBO comparison groups agree on price, size and order count. This is not a full-book oracle or a full-session test.",
        "个最优买卖报价比较组的价格、数量及订单数一致。这不是完整订单簿基准，也不是全交易时段测试。")}</p>
      <p className={css.receipt}>{pick("Source digest", "来源摘要")}: {data.sourceRawSha256.slice(0, 20)}…</p>
      <p className={css.receipt}>{pick("Reference digest", "参考摘要")}: {data.referenceRawSha256.slice(0, 20)}…</p>
    </section>
  </main>;
}
