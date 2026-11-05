/** Panel-local EN/ZH copy. The shared volatility/source owners stay unchanged. */
import type { Lang } from "@/lib/i18n";

const LEX = {
  view: ["Smile view", "微笑曲线视图"],
  chart: ["Chart", "图表"],
  exact: ["Exact IV", "精确 IV"],
  source: ["Source & method", "来源与方法"],
  count: ["Strikes shown: {shown} / {total}", "显示行权价：{shown} / {total}"],
  caption: ["{exp} · reported IV by strike", "{exp} · 各行权价报告 IV"],
  precision: [
    "IV values are percentages, shown without display rounding. Missing legs stay unavailable.",
    "IV 数值以百分数表示，显示不作舍入。缺失的一侧保持不可用。",
  ],
  scope: [
    "Chart and table share the selected expiry and strike range. Counts include valid strike coordinates; conflicting records are marked unavailable.",
    "图表与表格共用所选到期日和行权价范围。数量包含有效行权价坐标；冲突记录标为不可用。",
  ],
  method: [
    "Quote inputs and IV method are not supplied in this read.",
    "本次读数未提供报价输入或 IV 计算方法。",
  ],
  strike: ["Strike", "行权价"],
  call: ["Call IV (%)", "认购 IV（%）"],
  put: ["Put IV (%)", "认沽 IV（%）"],
  unavailable: ["Unavailable", "不可用"],
  conflict: ["Conflicting records", "记录冲突"],
  callKey: ["Calls · solid line, circle", "认购 · 实线、圆点"],
  putKey: ["Puts · dashed line, diamond", "认沽 · 虚线、菱形"],
  chartDescription: [
    "Calls use a solid line and circles; puts use a dashed line and diamonds. Missing observations break each leg separately. Choose Exact IV for all values in this range.",
    "认购使用实线和圆点，认沽使用虚线和菱形。缺失数据分别中断对应侧的连线。选择精确 IV 可查看此范围内的全部数值。",
  ],
  narrow: [
    "This space is too narrow for readable chart axes. Exact IV keeps every value and range control available.",
    "此区域过窄，图表坐标轴无法清晰呈现。精确 IV 仍提供全部数值和范围控件。",
  ],
} as const;

export function makeVolSkewT(lang: Lang) {
  return (key: keyof typeof LEX): string => LEX[key][lang === "zh" ? 1 : 0];
}
