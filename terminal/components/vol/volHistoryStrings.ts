import type { Lang } from "@/lib/i18n";

const LEX = {
  view: ["History view", "历史视图"],
  chart: ["Chart", "图表"],
  exact: ["Exact history values", "精确历史数值"],
  source: ["Source & method", "来源与方法"],
  date: ["Observation date", "观测日期"],
  iv: ["ATM IV (%)", "平值 IV（%）"],
  unavailable: ["Unavailable", "不可用"],
  conflict: ["Conflicting records", "记录冲突"],
  caption: ["Reported ATM IV by observation date", "按观测日期列出的报告平值 IV"],
  counts: ["{values} IV observations · {dates} supplied dates", "{values} 个 IV 观测值 · {dates} 个已提供日期"],
  precision: [
    "Values use the supplied percentage scale, without display rounding. Missing or conflicting IV remains unavailable.",
    "数值使用来源提供的百分数尺度，显示不作舍入。缺失或冲突的 IV 保持不可用。",
  ],
  dateMeaning: [
    "Each date identifies a supplied observation. Its availability timestamp is not supplied here.",
    "每个日期标识一条已提供的观测记录。此处未提供该数据的可用时间戳。",
  ],
  scope: [
    "Only valid supplied dates appear here. Duplicate dates retain one conflict row. The chart requires at least 10 finite IV observations; exact values remain available below that threshold.",
    "此处仅列出有效的已提供日期。重复日期保留一条冲突记录。图表至少需要 10 个有效 IV 观测值；不足时仍可查看精确数值。",
  ],
  chartDescription: [
    "Reported ATM IV by observation date, in percent. Missing or conflicting IV breaks the line. Dashed 52-week references appear only within the chart range. Choose Exact history values for every valid supplied date.",
    "按观测日期展示报告平值 IV，单位为百分数。缺失或冲突的 IV 使曲线中断。52 周参考虚线仅在图表范围内显示。选择精确历史数值以查看每个有效的已提供日期。",
  ],
  narrow: [
    "This space is too narrow for readable chart axes. Open exact history values to continue the investigation.",
    "此区域过窄，图表坐标轴无法清晰呈现。打开精确历史数值以继续研究。",
  ],
} as const;

export function makeVolHistoryT(lang: Lang) {
  return (key: keyof typeof LEX): string => LEX[key][lang === "zh" ? 1 : 0];
}
