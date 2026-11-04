"use client";
/** Reusable rendering layer. No fixture, source fetch, vendor key, or gamma computation. */
import { useId, useRef } from "react";
import { useChartWidth, padDomain, niceTicks, fmtTick, thinLabels } from "@/components/charts/svgChart";
import type { FuturesChartFrame } from "@/lib/futuresWorkspace";
import { layoutPriceAxisBadges, priceTagRowTop } from "@/lib/priceTagPlacement";
import { observedFuturesProfile } from "@/lib/futuresVolumeProfile";
import { futuresGexInView, futuresGexVisualScale, futuresGexScaleLabel } from "@/lib/futuresGexVisual";
import css from "./futuresLab.module.css";

export default function FuturesMicrostructureChart({ frames, mode, showGex, zoom, lowTick, highTick, priceStepTicks,
  lang, contract, method, showCvd = true }: {
  frames: FuturesChartFrame[]; mode: "depth" | "footprint"; showGex: boolean; zoom: number;
  lowTick: number; highTick: number; priceStepTicks: number; lang: 0 | 1; contract: string; method: string; showCvd?: boolean;
}) {
  const pick = (en: string, zh: string) => lang ? zh : en;
  const wrap = useRef<HTMLDivElement>(null), width = useChartWidth(wrap, 640);
  const id = useId().replace(/:/g, ""), clipId = `futures-plot-${id}`, gapId = `futures-gap-${id}`;
  const priceHeight = width < 700 ? 460 : 530;
  const height = priceHeight + (showCvd ? 110 : 0);
  const gutter = mode === "footprint" ? (width < 700 ? 156 : 210) : (width < 700 ? 112 : 170);
  const visibleCount = mode === "footprint" ? Math.max(2, Math.floor((width - gutter - 96) / 66)) : 120;
  const start = Math.max(0, frames.length - visibleCount), visible = frames.slice(start), current = frames.at(-1);
  const left = 12, right = Math.max(left + 60, width - gutter), top = 26, bottom = priceHeight - 48;
  // Reserve a label column outside plotted observations. Never cover the last
  // footprint's bid/ask numbers with a POC or options-landmark badge.
  const reserveTags = mode === "footprint" || showGex && current?.gex.status === "ok" && !!current.gex.landmarks?.length;
  const dataRight = Math.max(left + 60, right - (reserveTags ? 84 : 0));
  const step = (dataRight - left) / Math.max(visible.length, 1);
  // A last traded price may center the viewport, but is never drawn as a made-up candle.
  const lastTradePrice = frames.slice().reverse().find(f => f.bar.kind !== "no_captured_trades")?.bar.closeTicks;
  const center = typeof lastTradePrice === "number" ? lastTradePrice / 4 : (lowTick + highTick) / 8;
  const half = mode === "footprint" ? Math.max(zoom === 1 ? 3 : 1.75, priceStepTicks / 2) : 4;
  const [lo, hi] = padDomain(mode === "depth" && zoom === 1 ? lowTick / 4 - .125 : center - half,
    mode === "depth" && zoom === 1 ? highTick / 4 + .125 : center + half, { padFrac: .02 });
  const gammaScale = futuresGexVisualScale(visible, lo, hi);
  const y = (p: number) => bottom - (p - lo) / (hi - lo) * (bottom - top);
  const x = (i: number) => left + (i + .5) * step;
  const ticks = niceTicks(lo, hi, 7), labelTicks = thinLabels(ticks.values.slice().reverse(), y, 36);
  const color = (v: number) => v >= 0 ? "#3bd4b0" : "#ff6c82";
  const heat = (size: number) => size >= 260 ? `rgba(255,220,128,${Math.min(.95, size / 500)})`
    : size >= 180 ? `rgba(79,211,221,${Math.min(.85, size / 400)})` : `rgba(72,105,204,${Math.min(.6, size / 300)})`;
  const time = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  const times = thinLabels(visible.map((_, i) => i), x, 65);
  const observedProfile = observedFuturesProfile(frames);
  const profile = new Map(observedProfile.cells.map(cell => [cell.priceTicks, cell]));
  const peak = Math.max(1, ...[...profile.values()].map(v => Math.max(v.buy, v.sell)));
  const profileX = right + (width < 700 ? 84 : 100), profileHalf = width < 700 ? 22 : 32;
  const gammaX = mode === "footprint" ? right + (width < 700 ? 118 : 144) : right + 64;
  const gammaWidth = Math.max(12, width - gammaX - 6);
  const unknownText = lang ? "方向未知" : "unknown side";
  const cvdValues = visible.map(f => f.bar.cvdKnown).filter(Number.isFinite);
  const [cvdLo, cvdHi] = padDomain(Math.min(0, ...cvdValues), Math.max(0, ...cvdValues), { padFrac: .1 });
  const cvdTop = priceHeight - 18, cvdBottom = height - 48;
  const cvdY = (v: number) => cvdBottom - (v - cvdLo) / (cvdHi - cvdLo) * (cvdBottom - cvdTop);
  const cvdPath = visible.map((f, i) => `${i === 0 ? "M" : "L"}${x(i)},${cvdY(f.bar.cvdKnown)}`).join(" ");
  const titles = { call_wall: pick("Call wall", "\u770b\u6da8\u5899"), put_wall: pick("Put wall", "\u770b\u8dcc\u5899"),
    gamma_flip: pick("Gamma flip", "\u4f3d\u9a6c\u7ffb\u8f6c") };
  const shorts = { call_wall: pick("CW \u00b7 all", "\u770b\u6da8\u00b7\u5168"), put_wall: pick("PW \u00b7 all", "\u770b\u8dcc\u00b7\u5168"),
    gamma_flip: pick("ZG \u00b7 all", "\u7ffb\u8f6c\u00b7\u5168") };
  const keyLevels = showGex && current?.gex.status === "ok" ? current.gex.landmarks ?? [] : [];
  const poc = mode === "footprint" ? observedProfile.pointOfControl : null;
  const tagData = [
    ...keyLevels.map(level => ({ id: level.key, price: level.futuresPrice, short: shorts[level.key],
      title: `${titles[level.key]} \u00b7 ${pick("all expiries", "\u5168\u90e8\u5230\u671f\u65e5")} \u00b7 ${level.sourcePrice} \u2192 ${level.futuresPrice.toFixed(4)}`, tone: "#adbbd6" })),
    ...(poc ? [{ id: "poc", price: poc.priceTicks / 4, short: pick("POC \u00b7 obs", "\u63a7\u70b9\u00b7\u89c2\u6d4b"),
      title: `${pick("Observed volume peak; captured window; lower price wins ties", "\u89c2\u6d4b\u7a97\u53e3\u6210\u4ea4\u91cf\u5cf0\u503c\uff1b\u5e76\u5217\u53d6\u8f83\u4f4e\u4ef7")} \u00b7 ${poc.priceTicks / 4}${priceStepTicks > 1 ? `-${(poc.priceTicks + priceStepTicks - 1) / 4}` : ""} \u00b7 ${poc.total}`, tone: "#bda5ff" }] : []),
  ].filter(tag => y(tag.price) >= top && y(tag.price) <= bottom);
  const tagWidth = Math.max(48, Math.min(76, right - left - 8));
  const placements = layoutPriceAxisBadges({ paneHeight: bottom - top, activeTop: priceTagRowTop(y(center) - top),
    activeHeight: 0, rowHeight: 16, gap: 2, badges: tagData.map(tag => ({ id: tag.id,
      anchorY: y(tag.price) - top, naturalTop: priceTagRowTop(y(tag.price) - top, 16) })) });
  return <div className={css.chart} ref={wrap} data-contract={contract} data-testid="futures-chart">
    {!current && <p role="status" className={css.empty}>{pick("No completed intervals at this replay cutoff.", "截止时间内没有已完成的时间区间。")}</p>}
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${contract} ${mode === "depth" ? (lang ? "深度" : "Depth") : (lang ? "足迹" : "Footprint")} · ${current ? time(current.endMs) : "—"} UTC`}>
      <defs><clipPath id={clipId}><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath>
        <pattern id={gapId} width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-2,2L2,-2M0,8L8,0M6,10L10,6" stroke="#9ba6bb" strokeWidth="1" /></pattern></defs>
      {labelTicks.map(p => <g key={p}><line x1={left} x2={width - 6} y1={y(p)} y2={y(p)} stroke="#25324a" />
        <text x={right + 6} y={y(p) - 5} fill="#b0bbce" fontSize="11">{fmtTick(p, ticks.step)}</text></g>)}
      <g clipPath={`url(#${clipId})`}>
        {mode === "depth" && visible.map((frame, n) => <g key={frame.bar.startNs}>
          {frame.depth?.levels.map(cell => cell.bidMean === null ? null : <rect key={cell.priceTicks} x={x(n) - step / 2}
            y={y(cell.priceTicks / 4 + .125)} width={step + .2} height={Math.max(1, y(cell.priceTicks / 4 - .125) - y(cell.priceTicks / 4 + .125))}
            fill={heat((cell.bidMean ?? 0) + (cell.askMean ?? 0))} />)}
          {(!frame.depth || frame.depth.coverage !== "full") && <rect data-testid="depth-gap" x={x(n) - step / 2} y={top}
            width={step} height={bottom - top} fill={`url(#${gapId})`} opacity=".6"><title>{frame.depth?.coverage ?? "gap"}</title></rect>}
        </g>)}
        {visible.map(({ bar }, n) => <g key={bar.startNs} data-testid={bar.kind === "no_captured_trades" ? "futures-empty-interval" : "futures-bar"}>
          {bar.kind === "no_captured_trades" ? <>
            <title>{pick("No captured executions in this interval; any observed depth remains visible.", "本时段未捕获成交；已观测深度仍可见。")}</title>
            <line x1={x(n) - step * .2} x2={x(n) + step * .2} y1={bottom - 2} y2={bottom - 2} stroke="#a9b6cf" strokeWidth="1" />
          </> : mode === "depth" ? <><line x1={x(n)} x2={x(n)} y1={y(bar.highTicks / 4)} y2={y(bar.lowTicks / 4)} stroke={color(bar.closeTicks - bar.openTicks)} />
            <rect x={x(n) - Math.min(5, step * .25)} y={Math.min(y(bar.openTicks / 4), y(bar.closeTicks / 4))}
              width={Math.min(10, step * .5)} height={Math.max(2, Math.abs(y(bar.openTicks / 4) - y(bar.closeTicks / 4)))} fill={color(bar.closeTicks - bar.openTicks)} /></>
            : bar.cells.map(cell => <g key={cell.priceTicks} data-testid="footprint-cell"><rect x={x(n) - step * .45}
                y={y(cell.priceTicks / 4) - 7} width={step * .9} height="15" fill={cell.buyImbalance || cell.sellImbalance ? "#284661" : "#1b2942"} />
              <text x={x(n) - 3} y={y(cell.priceTicks / 4) + 4} textAnchor="end" fill="#ff8a99" fontSize="10">{cell.sell}</text>
              <text x={x(n) + 3} y={y(cell.priceTicks / 4) + 4} fill="#5dddbf" fontSize="10">{cell.buy}</text>
              {cell.unknown > 0 && <circle cx={x(n)} cy={y(cell.priceTicks / 4) - 8} r="3" fill="#ffd47a"><title>{`${cell.unknown} ${unknownText}`}</title></circle>}
            </g>)}
        </g>)}
        {showGex && visible.map(({ gex }, n) => gex.status !== "ok" ? null : (gex.landmarks ?? []).map(level =>
          <line key={`landmark:${n}:${level.key}`} data-testid="futures-landmark-segment" data-level-key={level.key}
            data-mapped-price={level.futuresPrice} data-frame-end={visible[n].endMs}
            x1={x(n) - step / 2} x2={x(n) + step / 2} y1={y(level.futuresPrice)} y2={y(level.futuresPrice)}
            stroke="#adbbd6" strokeWidth="1" strokeDasharray="3 4" opacity=".55" />))}
        {showGex && visible.map(({ gex }, n) => gex.status !== "ok" ? null : gex.projection.mapped.map(level =>
          level.gammaNetMn === null || !futuresGexInView(level.futuresPrice, lo, hi) ? null : <circle key={`${n}:${level.sourceStrike}`} data-testid="gex-bubble" cx={x(n)} cy={y(level.futuresPrice)}
            data-source-strike={level.sourceStrike} data-mapped-price={level.futuresPrice}
            r={8 * Math.sqrt(Math.min(1, Math.abs(level.gammaNetMn) / gammaScale.limitMn))} fill={color(level.gammaNetMn)} fillOpacity=".55" stroke={color(level.gammaNetMn)}>
            <title>{`${level.sourceStrike} → ${level.futuresPrice.toFixed(2)} · ${level.gammaNetMn}M`}</title></circle>))}
      </g>
      {mode === "footprint" && <g data-testid="futures-volume-profile">
        <text x={profileX} y={16} textAnchor="middle" fill="#a9b6cf" fontSize="9">{lang ? "成交量" : "Volume"}</text>
        {[...profile.entries()].map(([tick, cell]) => y(tick / 4) < top || y(tick / 4) > bottom ? null : <g key={tick}>
          <rect x={profileX - cell.sell / peak * profileHalf} y={y(tick / 4) - 3} width={cell.sell / peak * profileHalf} height="6" fill="#ff6c82" />
          <rect x={profileX} y={y(tick / 4) - 3} width={cell.buy / peak * profileHalf} height="6" fill="#3bd4b0" />
          {cell.unknown > 0 && <circle cx={profileX} cy={y(tick / 4)} r="2" fill="#ffd47a" />}
          <title>{`${tick / 4}: ${cell.sell} / ${cell.buy}; ${cell.unknown} ${unknownText}`}</title>
        </g>)}
      </g>}
      {showGex && <text x={gammaX} y={16} fill="#a9b6cf" fontSize="9">{pick("Gamma", "伽马")}</text>}
      {showGex && current?.gex.status === "ok" && current.gex.projection.mapped.map(level =>
        level.gammaNetMn === null || y(level.futuresPrice) < top || y(level.futuresPrice) > bottom ? null : <g key={level.sourceStrike}>
          <rect x={gammaX} y={y(level.futuresPrice) - 3} width={Math.min(gammaWidth, Math.abs(level.gammaNetMn) / gammaScale.limitMn * gammaWidth)} height="6" fill={color(level.gammaNetMn)} />
          <text x={gammaX} y={y(level.futuresPrice) - 8} fill={color(level.gammaNetMn)} fontSize="10">{futuresGexScaleLabel(level.gammaNetMn)}</text></g>)}
      <g clipPath={`url(#${clipId})`}>
        {placements.map(placement => {
          const tag = tagData.find(item => item.id === placement.id)!;
          const tagX = right - tagWidth - 8, tagY = top + placement.top;
          return <g key={tag.id} data-testid={tag.id === "poc" ? "futures-poc" : "futures-key-level"}
            data-level-key={tag.id} data-mapped-price={tag.price} data-expiry-scope={tag.id === "poc" ? "observed_window" : "all"}>
            <line x1={tagX + tagWidth} x2={right} y1={tagY + 8} y2={top + placement.anchorY} stroke={tag.tone} strokeWidth="1" />
            <rect x={tagX} y={tagY} width={tagWidth} height="16" rx="2" fill="#18243a" stroke={tag.tone} strokeWidth=".5" />
            <text x={tagX + 4} y={tagY + 11} fontSize="10" fill={tag.tone}>{tag.short}</text>
            <title>{tag.title}</title>
          </g>;
        })}
      </g>
      {showCvd && current && <g data-testid="futures-cvd" data-cvd={current.bar.cvdKnown}>
        <line x1={left} x2={right} y1={cvdTop - 9} y2={cvdTop - 9} stroke="#334259" />
        <text x={left} y={cvdTop - 14} fill="#a9b6cf" fontSize="10">{pick("Known-side CVD · captured window", "已知方向累积净量 · 观测窗口")}</text>
        <line x1={left} x2={right} y1={cvdY(0)} y2={cvdY(0)} stroke="#344057" strokeDasharray="3 4" />
        <path d={cvdPath} fill="none" stroke="#77bbf4" strokeWidth="1.5" />
        <text x={right + 6} y={cvdY(current.bar.cvdKnown) + 4} fill="#77bbf4" fontSize="10">{current.bar.cvdKnown}</text>
      </g>}
      {times.map(i => <text key={i} x={x(i)} y={height - 20} textAnchor="middle" fill="#a9b6cf" fontSize="11">{time(visible[i].endMs)}</text>)}
      <text x={width - 6} y={height - 5} textAnchor="end" fill="#a9b6cf" fontSize="10">UTC · {method}</text>
    </svg>
    {showGex && gammaScale.knownPoints > 0 && <p className={css.scaleNote} data-testid="gex-visual-scale">
      {pick("Gamma size scale: $", "伽马大小刻度：$")}{futuresGexScaleLabel(gammaScale.limitMn)}
      {pick(" per 1% index move. Scale uses the visible price/time range; source values are unchanged.", " / 指数变动 1%。刻度仅使用可见价格与时间范围，不改变来源数值。")}
    </p>}
  </div>;
}
