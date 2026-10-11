"use client";

import React, { useMemo, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { fmtTick, niceTicks, padDomain, useChartWidth } from "@/components/charts/svgChart";
import {
  PAYOFF_MAX_LEGS,
  analyzeExpirationPayoff,
  payoffAtExpiry,
  type OptionPositionSide,
  type OptionRight,
  type PayoffLegInput,
} from "@/lib/optionsPayoff";
import s from "./PayoffLab.module.css";

const COPY = {
  en: {
    eyebrow: "PLAN · MANUAL STRUCTURE",
    title: "Payoff Lab",
    subtitle: "Shape an option structure and inspect its exact expiration P/L before you save or act on anything.",
    expiryOnly: "Expiration-only",
    manual: "Manual premiums",
    sameExpiry: "Same expiration",
    displayOnly: "Display only",
    editor: "Structure editor",
    editorSub: "Up to six option legs · premium is dollars per share",
    expirationLabel: "Shared expiration",
    expirationHelp: "Every leg uses this same manually selected calendar date. Calendar and diagonal spreads are not modeled.",
    invalidExpiration: "Choose one valid shared expiration to calculate the structure.",
    reset: "Reset example",
    add: "Add leg",
    side: "Side",
    optionType: "Type",
    strike: "Strike",
    premium: "Premium",
    qty: "Qty",
    remove: "Remove leg",
    long: "Long",
    short: "Short",
    call: "Call",
    put: "Put",
    inputNote: "Each contract uses the standard 100-share multiplier. Inputs are yours; no quote is inferred.",
    expiration: "Expiration payoff",
    expirationSub: "P/L includes entered premium and intrinsic value at expiry",
    entry: "Entry cashflow",
    credit: "Net credit",
    debit: "Net debit",
    flat: "No debit / credit",
    breakEven: "Break-even",
    bestPnl: "Best expiry P/L",
    maxLoss: "Max loss",
    unlimited: "Unlimited",
    none: "None",
    range: "range",
    underlying: "Underlying at expiry",
    scenarioPnl: "Scenario P/L",
    chartAria: "Expiration payoff by underlying price",
    underlyingAxis: "Underlying at expiry",
    pnlAxis: "Expiration P/L",
    breakEvenLegend: "Break-even",
    scenarioLegend: "Scenario",
    method: "Method & boundaries",
    exactMath: "Deterministic math",
    exactMathBody: "Intrinsic option payoff plus your entered premium, quantity, side, and a 100-share contract multiplier.",
    excluded: "Not modeled",
    excludedBody: "No pre-expiry option value, IV, probability, calendar/diagonal spreads, early exercise, dividends, borrow, commissions, slippage, taxes, assignment timing, or order routing.",
    notice: "A payoff diagram describes a user-entered structure. It is not a forecast, expected return, probability, trade recommendation, or executable quote.",
    invalid: "Fix the highlighted inputs to calculate the payoff.",
  },
  zh: {
    eyebrow: "计划 · 手动结构",
    title: "到期收益实验室",
    subtitle: "在保存或采取任何行动前，先构建期权结构并查看精确的到期损益。",
    expiryOnly: "仅到期损益",
    manual: "手动权利金",
    sameExpiry: "同一到期日",
    displayOnly: "仅展示",
    editor: "结构编辑器",
    editorSub: "最多六条期权腿 · 权利金单位为每股美元",
    expirationLabel: "统一到期日",
    expirationHelp: "所有期权腿都使用同一个手动选择的日历日期。当前不建模日历价差或对角价差。",
    invalidExpiration: "请选择一个有效的统一到期日后再计算结构。",
    reset: "重置示例",
    add: "添加一腿",
    side: "方向",
    optionType: "类型",
    strike: "行权价",
    premium: "权利金",
    qty: "数量",
    remove: "移除该腿",
    long: "买入",
    short: "卖出",
    call: "认购",
    put: "认沽",
    inputNote: "每张合约按标准 100 股乘数计算。输入由你提供；系统不会推断报价。",
    expiration: "到期损益",
    expirationSub: "损益包含输入的权利金以及到期时的内在价值",
    entry: "入场现金流",
    credit: "净收取",
    debit: "净支付",
    flat: "无净支付 / 收取",
    breakEven: "盈亏平衡",
    bestPnl: "最佳到期损益",
    maxLoss: "最大亏损",
    unlimited: "无限",
    none: "无",
    range: "区间",
    underlying: "到期标的价格",
    scenarioPnl: "情景损益",
    chartAria: "标的价格对应的到期损益",
    underlyingAxis: "到期标的价格",
    pnlAxis: "到期损益",
    breakEvenLegend: "盈亏平衡",
    scenarioLegend: "情景",
    method: "方法与边界",
    exactMath: "确定性计算",
    exactMathBody: "使用期权内在价值、你输入的权利金、数量、方向和 100 股合约乘数。",
    excluded: "未建模",
    excludedBody: "不包含到期前期权价值、IV、概率、日历/对角价差、提前行权、分红、借券、手续费、滑点、税务、指派时点或订单路由。",
    notice: "收益图描述的是用户输入的结构。它不是预测、预期收益、概率、交易建议或可执行报价。",
    invalid: "请修正高亮输入后再计算收益。",
  },
} as const;

const EXAMPLE: PayoffLegInput[] = [
  { id: "leg-1", side: "long", right: "C", strike: 100, premium: 4.2, quantity: 1 },
  { id: "leg-2", side: "short", right: "C", strike: 110, premium: 1.6, quantity: 1 },
];

function parseNumber(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}

function money(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 0 : 2;
  return `$${abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function signedMoney(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const prefix = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${prefix}${money(v)}`;
}

export function formatPayoffPrice(v: number): string {
  if (!Number.isFinite(v) || v < 0) return "—";
  const normalized = Object.is(v, -0) ? 0 : v;
  const compact = normalized.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const roundTrip = Number(compact.replace(/,/g, ""));
  return `$${roundTrip === normalized ? compact : String(normalized)}`;
}

function breakEvenText(
  roots: number[],
  ranges: { from: number; to: number | null }[],
  c: typeof COPY.en | typeof COPY.zh,
): string {
  const parts = roots.map(formatPayoffPrice);
  for (const range of ranges) {
    parts.push(range.to == null
      ? `${formatPayoffPrice(range.from)}+ ${c.range}`
      : `${formatPayoffPrice(range.from)}–${formatPayoffPrice(range.to)} ${c.range}`);
  }
  return parts.length ? parts.join(" · ") : c.none;
}

function editableValue(v: number): string | number {
  return Number.isFinite(v) ? v : "";
}

function validIsoCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const epoch = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value;
}

export function PayoffLab() {
  const { lang } = useLang();
  const c = lang === "zh" ? COPY.zh : COPY.en;
  const [legs, setLegs] = useState<PayoffLegInput[]>(() => EXAMPLE.map((leg) => ({ ...leg })));
  const [expiration, setExpiration] = useState("2026-10-16");
  const [scenarioPrice, setScenarioPrice] = useState(105);
  const idRef = useRef(3);
  const analysis = useMemo(() => analyzeExpirationPayoff(legs), [legs]);
  const expirationValid = validIsoCalendarDay(expiration);
  const ready = analysis.valid && expirationValid;
  const scenarioPnl = ready && Number.isFinite(scenarioPrice) && scenarioPrice >= 0
    ? payoffAtExpiry(analysis.legs, scenarioPrice)
    : Number.NaN;

  const update = (id: string, patch: Partial<PayoffLegInput>) => {
    setLegs((current) => current.map((leg) => leg.id === id ? { ...leg, ...patch } : leg));
  };
  const remove = (id: string) => setLegs((current) => current.filter((leg) => leg.id !== id));
  const add = () => {
    setLegs((current) => {
      if (current.length >= PAYOFF_MAX_LEGS) return current;
      const maxStrike = Math.max(100, ...current.map((leg) => Number.isFinite(leg.strike) ? leg.strike : 0));
      return [...current, {
        id: `leg-${idRef.current++}`,
        side: "long",
        right: "C",
        strike: Math.round((maxStrike + 5) * 100) / 100,
        premium: 0,
        quantity: 1,
      }];
    });
  };
  const reset = () => {
    idRef.current = 3;
    setLegs(EXAMPLE.map((leg) => ({ ...leg })));
    setScenarioPrice(105);
  };

  const cashLabel = analysis.entryCashflow > 0 ? c.credit : analysis.entryCashflow < 0 ? c.debit : c.flat;
  const cashValue = money(analysis.entryCashflow);
  const riskProfit = analysis.bestExpiryPnlUnlimited ? c.unlimited : signedMoney(analysis.bestExpiryPnl ?? Number.NaN);
  const riskLoss = analysis.maxLossUnlimited ? c.unlimited : money(analysis.maxLoss ?? Number.NaN);

  return (
    <div className={s.root} data-testid="payoff-lab">
      <header className={s.header}>
        <div className={s.headerCopy}>
          <span className={s.eyebrow}>{c.eyebrow}</span>
          <h1 className={s.title}>{c.title}</h1>
          <p className={s.subtitle}>{c.subtitle}</p>
        </div>
        <div className={s.badgeRow} aria-label={c.method}>
          <span className={s.badge}>{c.expiryOnly}</span>
          <span className={s.badge}>{c.sameExpiry}</span>
          <span className={s.badge}>{c.manual}</span>
          <span className={s.badge}>{c.displayOnly}</span>
        </div>
      </header>

      <div className={s.layout}>
        <div className={s.stack}>
          <section className={s.card} aria-labelledby="payoff-editor-title">
            <div className={s.cardHead}>
              <div className={s.cardHeadCopy}>
                <h2 id="payoff-editor-title">{c.editor}</h2>
                <p>{c.editorSub}</p>
              </div>
              <button type="button" className={s.smallButton} onClick={reset}>{c.reset}</button>
            </div>
            <div className={s.expiryField}>
              <label htmlFor="payoff-expiration">{c.expirationLabel}</label>
              <input
                id="payoff-expiration"
                className={`${s.input}${expirationValid ? "" : ` ${s.inputInvalid}`}`}
                type="date"
                value={expiration}
                aria-invalid={!expirationValid}
                onChange={(event) => setExpiration(event.target.value)}
              />
              <span>{c.expirationHelp}</span>
            </div>
            <table className={s.legTable}>
              <thead>
                <tr>
                  <th>{c.side}</th><th>{c.optionType}</th><th>{c.strike}</th><th>{c.premium}</th><th>{c.qty}</th><th aria-label={c.remove} />
                </tr>
              </thead>
              <tbody>
                {legs.map((leg, index) => {
                  const strikeBad = !Number.isFinite(leg.strike) || leg.strike <= 0;
                  const premiumBad = !Number.isFinite(leg.premium) || leg.premium < 0;
                  const qtyBad = !Number.isSafeInteger(leg.quantity) || leg.quantity < 1 || leg.quantity > 100_000;
                  return (
                    <tr key={leg.id} data-leg={leg.id}>
                      <td>
                        <select className={s.select} aria-label={`${c.side} ${index + 1}`} value={leg.side}
                          onChange={(event) => update(leg.id, { side: event.target.value as OptionPositionSide })}>
                          <option value="long">{c.long}</option><option value="short">{c.short}</option>
                        </select>
                      </td>
                      <td>
                        <select className={s.select} aria-label={`${c.optionType} ${index + 1}`} value={leg.right}
                          onChange={(event) => update(leg.id, { right: event.target.value as OptionRight })}>
                          <option value="C">{c.call}</option><option value="P">{c.put}</option>
                        </select>
                      </td>
                      <td><input className={`${s.input}${strikeBad ? ` ${s.inputInvalid}` : ""}`} aria-label={`${c.strike} ${index + 1}`} type="number" min="0" step="0.5" value={editableValue(leg.strike)} onChange={(event) => update(leg.id, { strike: parseNumber(event.target.value) })} /></td>
                      <td><input className={`${s.input}${premiumBad ? ` ${s.inputInvalid}` : ""}`} aria-label={`${c.premium} ${index + 1}`} type="number" min="0" step="0.05" value={editableValue(leg.premium)} onChange={(event) => update(leg.id, { premium: parseNumber(event.target.value) })} /></td>
                      <td><input className={`${s.input}${qtyBad ? ` ${s.inputInvalid}` : ""}`} aria-label={`${c.qty} ${index + 1}`} aria-invalid={qtyBad} type="number" min="1" max="100000" step="1" value={editableValue(leg.quantity)} onChange={(event) => update(leg.id, { quantity: parseNumber(event.target.value) })} /></td>
                      <td><button type="button" className={s.iconButton} aria-label={`${c.remove} ${index + 1}`} onClick={() => remove(leg.id)}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className={s.editorFoot}>
              <span>{c.inputNote}</span>
              <button type="button" className={s.primaryButton} disabled={legs.length >= PAYOFF_MAX_LEGS} onClick={add}>{c.add}</button>
            </div>
            {!ready && <ul className={s.errors} role="alert">
              {!expirationValid && <li>{c.invalidExpiration}</li>}
              {!analysis.valid && <li>{c.invalid}</li>}
              {analysis.errors.map((error) => <li key={error}>{error}</li>)}
            </ul>}
          </section>

          <section className={s.card} aria-labelledby="payoff-method-title">
            <div className={s.cardHead}><div className={s.cardHeadCopy}><h2 id="payoff-method-title">{c.method}</h2></div></div>
            <div className={s.method}>
              <div className={s.methodBox}><strong>{c.exactMath}</strong><p>{c.exactMathBody}</p></div>
              <div className={s.methodBox}><strong>{c.excluded}</strong><p>{c.excludedBody}</p></div>
            </div>
            <p className={s.notice}>{c.notice}</p>
          </section>
        </div>

        <div className={s.stack}>
          <section className={s.card} aria-labelledby="payoff-chart-title">
            <div className={s.cardHead}>
              <div className={s.cardHeadCopy}><h2 id="payoff-chart-title">{c.expiration}</h2><p>{c.expirationSub}</p></div>
            </div>
            <div className={s.kpis}>
              <Kpi label={c.entry} value={ready ? cashValue : "—"} sub={ready ? cashLabel : undefined} />
              <Kpi label={c.breakEven} value={ready ? breakEvenText(analysis.breakEvens, analysis.breakEvenRanges, c) : "—"} sub={ready && analysis.breakEvenRanges.length ? c.range : undefined} wrap testId="payoff-break-even-value" />
              <Kpi label={c.bestPnl} value={ready ? riskProfit : "—"} />
              <Kpi label={c.maxLoss} value={ready ? riskLoss : "—"} />
            </div>
            <PayoffChart analysis={analysis} ready={ready} scenarioPrice={scenarioPrice} scenarioPnl={scenarioPnl} c={c} />
            <div className={s.legend}><span><b>●</b> {c.expiration}</span><span>◇ {c.breakEvenLegend}</span><span>│ {c.scenarioLegend}</span></div>
            <div className={s.scenario}>
              <div className={s.scenarioControl}>
                <label htmlFor="payoff-scenario-price">{c.underlying}</label>
                <input id="payoff-scenario-price" className={s.input} type="number" min="0" step="any" value={editableValue(scenarioPrice)} onChange={(event) => setScenarioPrice(parseNumber(event.target.value))} />
              </div>
              <div className={s.scenarioResult} data-testid="payoff-scenario-result">
                <span>{c.scenarioPnl}</span><strong style={{ color: scenarioPnl > 0 ? "var(--up)" : scenarioPnl < 0 ? "var(--down)" : "var(--text)" }}>{Number.isFinite(scenarioPnl) ? signedMoney(scenarioPnl) : "—"}</strong>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, wrap = false, testId }: { label: string; value: string; sub?: string; wrap?: boolean; testId?: string }) {
  return <div className={s.kpi}><span className={s.kpiLabel}>{label}</span><span data-testid={testId} className={`${s.kpiValue}${wrap ? ` ${s.kpiValueWrap}` : ""}`}>{value}</span>{sub && <span className={s.kpiSub}>{sub}</span>}</div>;
}

function PayoffChart({
  analysis,
  ready,
  scenarioPrice,
  scenarioPnl,
  c,
}: {
  analysis: ReturnType<typeof analyzeExpirationPayoff>;
  ready: boolean;
  scenarioPrice: number;
  scenarioPnl: number;
  c: typeof COPY.en | typeof COPY.zh;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const width = useChartWidth(boxRef);
  const height = 310;
  const pad = { l: 66, r: 18, t: 18, b: 42 };
  if (!ready || analysis.chart.length < 2) return <div ref={boxRef} className={s.chartEmpty}>{c.invalid}</div>;
  const xValues = analysis.chart.map((p) => p.price);
  const yValues = analysis.chart.map((p) => p.pnl);
  if (Number.isFinite(scenarioPnl)) yValues.push(scenarioPnl);
  const [x0, x1] = [Math.min(...xValues), Math.max(...xValues)];
  const [y0, y1] = padDomain(Math.min(0, ...yValues), Math.max(0, ...yValues), { padFrac: 0.12 });
  const plotW = Math.max(10, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const x = (v: number) => pad.l + ((v - x0) / Math.max(1e-9, x1 - x0)) * plotW;
  const y = (v: number) => pad.t + (1 - (v - y0) / Math.max(1e-9, y1 - y0)) * plotH;
  const xTickSet = niceTicks(x0, x1, width < 520 ? 4 : 7);
  const yTickSet = niceTicks(y0, y1, 5);
  const xTicks = xTickSet.values;
  const yTicks = yTickSet.values;
  const line = analysis.chart.map((p, index) => `${index === 0 ? "M" : "L"}${x(p.price).toFixed(1)},${y(p.pnl).toFixed(1)}`).join(" ");
  const scenarioInRange = Number.isFinite(scenarioPrice) && scenarioPrice >= x0 && scenarioPrice <= x1 && Number.isFinite(scenarioPnl);

  return (
    <div ref={boxRef} className={s.chartWrap}>
      <svg className={s.chart} viewBox={`0 0 ${Math.max(width, 320)} ${height}`} role="img" aria-label={c.chartAria}>
        {yTicks.map((tick) => <g key={`y-${tick}`}><line x1={pad.l} x2={width - pad.r} y1={y(tick)} y2={y(tick)} stroke="var(--grid)" strokeWidth="1" /><text x={pad.l - 8} y={y(tick) + 4} textAnchor="end" fill="var(--muted)" fontSize="10">{signedMoney(tick)}</text></g>)}
        {xTicks.map((tick) => <g key={`x-${tick}`}><line x1={x(tick)} x2={x(tick)} y1={pad.t} y2={height - pad.b} stroke="var(--grid)" strokeWidth="1" opacity=".55" /><text x={x(tick)} y={height - 17} textAnchor="middle" fill="var(--muted)" fontSize="10">${fmtTick(tick, xTickSet.step)}</text></g>)}
        <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke="var(--text-dim)" strokeWidth="1.25" />
        <path d={line} fill="none" stroke="var(--brand-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        {analysis.breakEvens.map((root) => root >= x0 && root <= x1 ? <g key={`be-${root}`} data-break-even-root={String(root)} role="img" aria-label={`${c.breakEvenLegend} ${formatPayoffPrice(root)}`}><line x1={x(root)} x2={x(root)} y1={y(0) - 8} y2={y(0) + 8} stroke="var(--warn)" strokeWidth="1.4" /><rect x={x(root) - 3} y={y(0) - 3} width="6" height="6" transform={`rotate(45 ${x(root)} ${y(0)})`} fill="var(--panel)" stroke="var(--warn)" /></g> : null)}
        {scenarioInRange && <g><line x1={x(scenarioPrice)} x2={x(scenarioPrice)} y1={pad.t} y2={height - pad.b} stroke="var(--signal)" strokeWidth="1.2" strokeDasharray="4 4" /><circle cx={x(scenarioPrice)} cy={y(scenarioPnl)} r="4.5" fill="var(--panel)" stroke="var(--signal)" strokeWidth="2" /></g>}
        <text x={(pad.l + width - pad.r) / 2} y={height - 3} textAnchor="middle" fill="var(--muted)" fontSize="10">{c.underlyingAxis}</text>
        <text transform={`translate(12 ${(pad.t + height - pad.b) / 2}) rotate(-90)`} textAnchor="middle" fill="var(--muted)" fontSize="10">{c.pnlAxis}</text>
      </svg>
    </div>
  );
}
