"use client";
import type { ChartWorkflowPreset } from "@/lib/suites/presets";
import type { SuiteTier } from "@/lib/indicator-canvas/types";
import styles from "./ChartWorkflowCard.module.css";

// Scoped presentation copy, as [English, Chinese] pairs. The shared dictionary is
// evidence-locked by unrelated account/research screens; this card does not alter it.
const ENTRY_COPY = {
  title: ["Start with a workflow", "从工作流开始"],
  description: ["Bring structure, momentum and price confirmation into one chart", "把结构、动能与价格确认放进同一张图"],
} satisfies Record<string, [string, string]>;

export function ChartWorkflowEntry({ lang, onOpen }: { lang: "en" | "zh"; onOpen: () => void }) {
  const pick = (key: keyof typeof ENTRY_COPY) => ENTRY_COPY[key][lang === "zh" ? 1 : 0];
  return <button type="button" className={styles.entry} data-testid="open-chart-workflows" onClick={onOpen}>
    <span><strong>{pick("title")}</strong>
      <small>{pick("description")}</small></span>
    <span aria-hidden="true">↗</span>
  </button>;
}
export default function ChartWorkflowCard({ recipe, lang, userTier, applied, onApply, onUndo, onView, onGuide }: {
  recipe: ChartWorkflowPreset; lang: "en" | "zh"; userTier: SuiteTier; applied: boolean;
  onApply?: () => void; onUndo?: () => void; onView: () => void; onGuide?: (id: string) => void;
}) {
  const copy = (en: string, zh: string) => lang === "zh" ? zh : en;
  const rank = { free: 0, essential: 1, pro: 2 };
  const locked = rank[userTier] < rank[recipe.minTier];
  const steps = [
    { title: copy("Location", "位置"), body: copy("Relevant levels and the active trendline. Is price at a useful reference, or already stretched?", "查看关键价位与当前趋势线：价格靠近参考位，还是已经远离？"), guide: "suite:structure/sr" },
    { title: copy("Momentum", "动能"), body: copy("RSI turns and regular divergence. Inspect the evidence; a turn alone does not confirm a lasting bottom or top.", "查看 RSI 转折与常规背离。动能转向本身不等于持续底部或顶部已经确认。"), guide: "suite:rsix/div" },
    { title: copy("Price confirmation", "价格确认"), body: copy("Check reclaim or failed-reclaim evidence against the level. Invalidated swing failures remain visible.", "对照价位检查收复或收复失败的证据。失效的摆动失败标记仍保留。"), guide: "suite:structure/sfp" },
  ];
  return <section className={styles.card} data-testid={`workflow-${recipe.id}`} aria-labelledby={`workflow-title-${recipe.id}`}>
    <div className={styles.heading}><div><span className={styles.eyebrow}>{copy("CHART WORKFLOW", "图表工作流")}</span>
      <h3 id={`workflow-title-${recipe.id}`}>{recipe.name[lang]}</h3></div><span className={styles.badge}>PRO</span></div>
    <p className={styles.lede}>{copy("A focused view of where a reversal could develop—and the price evidence still needed.", "聚焦潜在转折的位置，以及仍然需要出现的价格证据。")}</p>
    <ol className={styles.steps}>{steps.map((step, i) => <li key={step.guide}>
      <span className={styles.number} aria-hidden="true">0{i + 1}</span><strong>{step.title}</strong><p>{step.body}</p>
      {onGuide && <button type="button" className={styles.guide} onClick={() => onGuide(step.guide)}>{copy("Read the guide", "阅读指南")} ↗</button>}
    </li>)}</ol>
    <p className={styles.scope}>{copy("Chart timeframe only. Confirmed pivots need later bars; the newest candle may still be forming. This arrangement does not qualify or authorize a trade.", "仅使用当前图表周期。枢轴需要后续K线确认；最新K线可能仍在形成。此组合不构成交易资格或授权。")}</p>
    <div className={styles.actions}>
      <button type="button" className={styles.apply} data-testid="apply-chart-workflow" disabled={locked || applied || !onApply} onClick={onApply}>
        {locked ? copy("Requires Pro", "需要 Pro") : applied ? copy("Workspace configured", "工作区已配置") : copy("Apply to workspace", "应用到工作区")}
      </button>
      {applied && <button type="button" className={styles.secondary} data-testid="view-workflow-chart" onClick={onView}>{copy("View chart", "查看图表")}</button>}
      {onUndo && <button type="button" className={styles.secondary} data-testid="undo-chart-workflow" onClick={onUndo}>{copy("Undo this change", "撤销此次更改")}</button>}
    </div>
    <p className={styles.footnote}>{copy("Replaces built-in studies, not drawings or scripts. Keeps custom calculation inputs; applies a quiet display recipe and turns historical auto-optimization off. Undo is available until another edit.", "替换内置指标，不删除绘图或脚本。保留自定义计算参数，采用简洁显示，并关闭历史自动优化。后续编辑前可撤销。")}</p>
  </section>;
}
