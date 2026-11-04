"use client";

import { useMemo, useRef, useState } from "react";
import { useChartWidth, niceTicks, fmtTick, padDomain, thinLabels, MIN_CHART_H } from "@/components/charts/svgChart";
import { sectorRegularSession } from "@/lib/sectorRegularReading";
import type { RotationMonitorReport } from "@/lib/rotationMonitor";
import { buildRotationPivotProjection, type RotationPivotProjectionReason, type RotationPivotProjection } from "@/lib/rotationPivotPreview";
import type { PivotPreview, PivotReason, PivotState } from "@/lib/pivotWatchPreview";

const STATES: Record<PivotState, [string, string]> = {
  unavailable: ["Unavailable", "不可用"], warming_up: ["Opening range forming", "开盘区间形成中"],
  watching: ["No encounter yet", "尚未触及区间"], approaching: ["Approaching known zone", "接近已知区间"],
  forming: ["Level encountered", "已触及区间"],
  confirmed: ["Later confirmation observed", "后续确认已出现"], failed: ["Invalidated", "已失效"],
  expired: ["Observation window expired", "观察期限已过"],
};
const REASONS: Record<PivotReason, [string, string]> = {
  source_unqualified: ["Source evidence unavailable", "来源证据不可用"], invalid_clock: ["Clock not qualified", "时间基准未核验"],
  invalid_series: ["Invalid bars", "K线数据无效"], missing_interval: ["Missing completed interval", "缺少已完成区间"],
  no_range: ["No opening range", "没有开盘区间"], insufficient_completed_bars: ["Waiting for six completed bars", "等待六根已完成K线"],
  level_breached: ["Invalidation reached", "已触发失效价位"], watch_timeout: ["No encounter in observation window", "观察期内未触及"],
  confirmation_timeout: ["No later confirmation within 30 minutes", "30分钟内没有后续确认"],
  reclaim_confirmed: ["Later support reclaim observed", "后续支撑收复已出现"],
  rejection_confirmed: ["Later resistance rejection observed", "后续阻力回落已出现"],
  level_nearby: ["Encounter observed; confirmation pending", "已观察触及；待后续确认"],
  approach_observed: ["Completed close near known level; no touch or turn confirmed", "已完成收盘靠近已知价位；尚未触及或确认反转"],
  no_encounter: ["Level not encountered", "尚未触及价位"],
};
const GATES: Record<RotationPivotProjectionReason, [string, string]> = {
  session_unavailable: ["Session calendar unavailable", "交易日历不可用"],
  session_mismatch: ["Session and measurement do not agree", "交易时段和测量结果不一致"],
  symbol_unavailable: ["Selected sector is unavailable", "所选板块不可用"],
  common_interval_unavailable: ["Comparable completed 5m sector/SPY interval unavailable", "板块与SPY的可比已完成5分钟区间不可用"],
  source_unqualified: ["Pivot input source or completed bars unavailable", "枢轴输入来源或已完成K线不可用"],
};
const fmt = (v: number | null): string => v !== null && Number.isFinite(v) ? v.toFixed(2) : "—";
const clock = (t: number | null): string => {
  if (t === null || !Number.isSafeInteger(t)) return "—";
  const date = new Date(t * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(11, 16) + " ET" : "—";
};
const box: React.CSSProperties = { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, minWidth: 0 };

function Readout({ row, zh }: { row: PivotPreview; zh: boolean }) {
  const pick = (en: string, cn: string) => zh ? cn : en;
  const side = row.side === "bottom" ? pick("Opening-range low · support test", "开盘区间低点 · 支撑观察")
    : pick("Opening-range high · resistance test", "开盘区间高点 · 阻力观察");
  const state = STATES[row.state][zh ? 1 : 0];
  const explanation = REASONS[row.reason][zh ? 1 : 0];
  return <div style={box} data-testid={"rotation-pivot-" + row.side} data-state={row.state}>
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
      <strong style={{ fontSize: 13 }}>{side}</strong>
      <span style={{ fontSize: 12, color: "var(--text)" }}>{state}</span>
    </div>
    <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 10px" }}>{explanation}</p>
    <dl style={{ display: "grid", gridTemplateColumns: "minmax(100px, 1fr) minmax(80px, 1fr)", gap: "6px 12px", fontSize: 12, margin: 0 }}>
      <dt style={{ color: "var(--muted)" }}>{pick("Known level", "已知价位")}</dt><dd style={{ margin: 0 }}>{fmt(row.levelPrice)}</dd>
      <dt style={{ color: "var(--muted)" }}>{pick("Zone ±", "区域 ±")}</dt><dd style={{ margin: 0 }}>{fmt(row.zoneHalfWidth)}</dd>
      <dt style={{ color: "var(--muted)" }}>{pick("Last close vs level", "最新收盘相对价位")}</dt><dd style={{ margin: 0 }}>{row.distanceFromLevelPct === null ? "—" : (row.distanceFromLevelPct > 0 ? "+" : "") + row.distanceFromLevelPct.toFixed(2) + "%"}</dd>
      <dt style={{ color: "var(--muted)" }}>{pick("Invalidation", "失效价位")}</dt><dd style={{ margin: 0 }}>{fmt(row.invalidationPrice)}</dd>
      <dt style={{ color: "var(--muted)" }}>{pick("Level known", "价位已知时间")}</dt><dd style={{ margin: 0 }}>{clock(row.levelKnownAtDisplayEpoch)}</dd>
      <dt style={{ color: "var(--muted)" }}>{pick("First encounter", "首次触及")}</dt><dd style={{ margin: 0 }}>{clock(row.firstEncounterAtDisplayEpoch)}</dd>
      <dt style={{ color: "var(--muted)" }}>{pick("Later resolution", "后续状态确认")}</dt><dd style={{ margin: 0 }}>{clock(row.resolutionAtDisplayEpoch)}</dd>
    </dl>
  </div>;
}

/** SVG is computed from the same accepted completed-bar prefix as the watch engine.
 * It cannot display forming/future prices and has no separate market-data read.
 */
function PivotReconstructionChart({ report, zh }: {
  report: NonNullable<RotationPivotProjection["preview"]>; zh: boolean;
}) {
  const plotRef = useRef<HTMLElement | null>(null);
  const width = useChartWidth(plotRef, 660);
  const height = Math.max(MIN_CHART_H.axis, Math.min(288, Math.round(width * 0.36)));
  const bars = report.visibleBars;
  // The measured wrapper stays mounted even in the empty state (ResizeObserver contract).
  if (bars.length < 2) return <figure ref={plotRef} style={{ margin: "14px 0", minWidth: 0 }} />;
  const label = (en: string, cn: string) => zh ? cn : en;
  const left = 54, top = 22, right = 18, bottom = 36;
  const innerW = Math.max(1, width - left - right), innerH = Math.max(1, height - top - bottom);
  const low = report.rows[0], high = report.rows[1];
  const levels = [low, high].flatMap(r => r.levelPrice === null || r.zoneHalfWidth === null
    ? [] : [r.levelPrice - r.zoneHalfWidth, r.levelPrice + r.zoneHalfWidth]);
  const prices = [...bars.flatMap(b => [b[3], b[2]]), ...levels]
    .filter(p => Number.isFinite(p) && p > 0);
  if (!prices.length) return <figure ref={plotRef} style={{ margin: "14px 0", minWidth: 0 }} />;
  const [min, max] = padDomain(Math.min(...prices), Math.max(...prices), { padFrac: 0.08, clampMin: 0 });
  const scale = max - min;
  if (!(scale > 0) || !Number.isFinite(scale)) return <figure ref={plotRef} style={{ margin: "14px 0", minWidth: 0 }} />;
  const start = bars[0][0] + report.barSeconds, end = bars[bars.length - 1][0] + report.barSeconds;
  const x = (epoch: number) => left + innerW * (epoch - start) / Math.max(end - start, 1);
  const y = (price: number) => top + innerH * (max - price) / scale;
  const yTicks = niceTicks(min, max, 4);
  const xTicks = thinLabels(bars.map(b => b[0] + report.barSeconds), x, 84);
  const line = bars.map((b, i) => (i ? "L" : "M") + x(b[0] + report.barSeconds).toFixed(2) + "," + y(b[4]).toFixed(2)).join(" ");
  const marker = (row: typeof low, when: number | null, resolution: boolean) => {
    if (when === null || when < start || when > end) return null;
    const at = bars.find(b => b[0] + report.barSeconds === when);
    if (!at) return null;
    return <circle key={row.side + (resolution ? "-resolved" : "-touch")} cx={x(when)} cy={y(at[4])}
      r={resolution ? 5.5 : 4} fill={row.side === "bottom" ? "var(--up)" : "var(--down)"}
      stroke="var(--panel)" strokeWidth={2} />;
  };
  return <figure ref={plotRef} data-testid="rotation-pivot-chart" style={{ margin: "14px 0", minWidth: 0 }}>
    <svg role="img" aria-label={label("Reconstructed completed five-minute closing prices, known opening-range support and resistance, and later encounter or resolution markers", "按已完成五分钟收盘价重建，并标注开盘区间支撑、阻力及后续触及或结果")}
      viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block", width: "100%", border: "1px solid var(--line)", borderRadius: 8, background: "var(--bg)" }}>
      <title>{label("Causal opening-range reconstruction · no live issued events", "因果开盘区间重建 · 不代表实时发布事件")}</title>
      {yTicks.values.map(tick => <g key={"tick-" + tick}>
        <line x1={left} x2={width-right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={0.6} />
        <text x={left-7} y={y(tick)+3} fontSize={10} fill="var(--muted)" textAnchor="end">{fmtTick(tick, yTicks.step)}</text>
      </g>)}
      {[low, high].map(row => row.levelPrice === null ? null : <g key={row.side}>
        <line x1={left} x2={width-right} y1={y(row.levelPrice)} y2={y(row.levelPrice)}
          stroke={row.side === "bottom" ? "var(--up)" : "var(--down)"} strokeDasharray="6 4" strokeWidth={1.5} />
        <text x={left+5} y={y(row.levelPrice)-5} fontSize={10} fill="var(--muted)">
          {row.side === "bottom" ? label("Support", "支撑") : label("Resistance", "阻力")} {fmt(row.levelPrice)}</text>
      </g>)}
      <path d={line} stroke="var(--brand-2)" strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {report.levelKnownAtDisplayEpoch !== null && report.levelKnownAtDisplayEpoch >= start && <line
        x1={x(report.levelKnownAtDisplayEpoch)} x2={x(report.levelKnownAtDisplayEpoch)}
        y1={top} y2={height-bottom} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 4" />}
      {report.rows.flatMap(row => [marker(row, row.firstEncounterAtDisplayEpoch, false), marker(row, row.resolutionAtDisplayEpoch, true)])}
      {xTicks.map(tick => <text key={"x-" + tick} x={x(tick)} y={height-10}
        textAnchor={tick === start ? "start" : tick === end ? "end" : "middle"}
        fill="var(--muted)" fontSize={10}>{clock(tick)}</text>)}
    </svg>
    <figcaption style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
      {label("Completed closes only · dashed lines are frozen opening-range levels · dots mark reconstructed later encounters or resolutions", "仅已完成收盘价 · 虚线为冻结的开盘区间价位 · 圆点标示重建的后续触及或结果")}
    </figcaption>
  </figure>;
}

/**
 * An explicitly labeled replay/preview, fed by the R1 visible-view histories.
 * It never submits an alert, mutates a watch ledger, or starts another reader.
 */
export default function RSPivotWatchPreview({ monitor, histories, nowMs, zh }: {
  monitor: RotationMonitorReport;
  histories: Record<string, unknown>;
  nowMs: number;
  zh: boolean;
}) {
  const [symbol, setSymbol] = useState("XLK");
  const pick = (en: string, cn: string) => zh ? cn : en;
  const session = useMemo(() => sectorRegularSession(nowMs), [nowMs]);
  const result = useMemo(() => buildRotationPivotProjection({ monitor, symbol, session,
    history: histories[symbol] }), [monitor, histories, symbol, session]);
  const context = monitor.rows.find(row => row.symbol === symbol);
  const pct = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value)
    ? "—" : (value > 0 ? "+" : "") + value.toFixed(2) + "%";
  const r5 = context?.windows[5].state === "measured" ? context.windows[5].relativePct : null;
  const r30 = context?.windows[30].state === "measured" ? context.windows[30].relativePct : null;
  const contrast = r5 === null || r30 === null
    ? pick("Multi-horizon agreement unmeasured; no confluence score is inferred.", "多周期一致性未测量；不推断合流评分。")
    : Math.sign(r5) !== Math.sign(r30)
      ? pick("5m and 30m relative strength disagree. The longer horizon opposes a simple momentum narrative.", "5分钟与30分钟相对强度不一致；较长周期不支持简单动量判断。")
      : pick("5m and 30m relative signs agree; this is descriptive, not predictive validation.", "5分钟与30分钟相对方向一致；这仅是描述性证据，不代表预测验证。");
  return <section data-testid="rotation-pivot-preview" aria-labelledby="rotation-pivot-title"
    style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
      <div>
        <h3 id="rotation-pivot-title" style={{ margin: "0 0 4px", fontSize: 15 }}>
          {pick("Opening-range pivot preview", "开盘区间枢轴预览")}
        </h3>
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
          {pick("Reconstructed from completed 5m bars · not an issued watch or a forecast",
            "基于已完成的5分钟K线重建 · 不是已发布的观察或预测")}
        </p>
      </div>
      <label htmlFor="rotation-pivot-sector" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        {pick("Sector ETF", "板块ETF")}
        <select id="rotation-pivot-sector" data-testid="rotation-pivot-sector" value={symbol}
          onChange={e => setSymbol(e.target.value)}
          style={{ minHeight: 38, minWidth: 92, padding: 8, color: "var(--text)", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6 }}>
          {monitor.rows.filter(r => r.symbol !== "SPY").map(r => <option value={r.symbol} key={r.symbol}>{r.symbol}</option>)}
        </select>
      </label>
    </div>
    <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0" }}>
      {pick("Shared completed sector/SPY endpoint:", "板块与SPY共同已完成区间：")}{" "}
      {monitor.sessionDate ?? "—"} {clock(result.commonEndpointDisplayEpoch)}
    </p>
    <div data-testid="rotation-pivot-context" style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "var(--muted)" }}>
      <span>5m {pick("relative", "相对")} <strong style={{ color: "var(--text)" }}>{pct(r5)}</strong></span>
      <span>30m {pick("relative", "相对")} <strong style={{ color: "var(--text)" }}>{pct(r30)}</strong></span>
      <span>{contrast}</span>
    </div>
    {result.state === "unavailable" || !result.preview
      ? <p role="status" data-testid="rotation-pivot-unavailable" style={{ fontSize: 12, color: "var(--muted)" }}>
        {result.reason ? GATES[result.reason][zh ? 1 : 0] : pick("Unavailable", "不可用")}.
        {" "}{pick("No synthetic watch is shown.", "不显示模拟观察。")}
      </p>
      : <>
        <PivotReconstructionChart report={result.preview} zh={zh} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))", gap: 10 }}>
          {result.preview.rows.map(row => <Readout key={row.side} row={row} zh={zh} />)}
        </div>
      </>}
    <p style={{ fontSize: 11, lineHeight: 1.6, color: "var(--muted)", margin: "12px 0 0" }}>
      {pick("Times are New York display-clock labels, not verified receipt timestamps. Source data may be delayed or corrected. No alerts, probabilities, entries, sizing, or historical as-issued claims.",
        "时间为纽约市场显示标签，并非已核验的接收时间。来源可能延迟或修正。不产生提醒、概率、入场、仓位或历史原始发布声明。")}
    </p>
  </section>;
}
