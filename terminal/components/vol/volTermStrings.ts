import type { Lang } from "@/lib/i18n";

const LEX = {
  exact: ["Exact expiry values", "精确到期日数值"],
  source: ["Source & method", "来源与方法"],
  selected: ["Selected term observation", "所选期限观测值"],
  expiry: ["Expiry", "到期日"],
  days: ["Days to expiry", "距到期天数"],
  iv: ["Reported ATM IV", "报告平值 IV"],
  ivColumn: ["ATM IV (%)", "平值 IV（%）"],
  unavailable: ["Unavailable", "不可用"],
  conflict: ["Conflicting records", "记录冲突"],
  caption: ["Supplied expiry observations", "已提供的到期日观测值"],
  precision: [
    "Values are shown without display rounding. Days to expiry come from the same source read. Missing or conflicting IV stays unavailable.",
    "数值显示不作舍入。距到期天数来自同一次来源读数。缺失或冲突的 IV 保持不可用。",
  ],
  coordinate: [
    "This selected expiry has no unambiguous supplied term coordinate. No neighboring expiry is substituted.",
    "所选到期日没有明确的已提供期限坐标。系统不会替换为邻近到期日。",
  ],
  tableScope: [
    "Only valid expiry and day coordinates appear here. Rejected or ambiguous coordinates are disclosed above; no date or day count is invented.",
    "此处仅列出有效到期日和天数坐标。被拒绝或含糊的坐标在上方说明；不补造日期或天数。",
  ],
  chartDescription: [
    "Reported ATM IV by supplied days to expiry. A selected expiry with a known day coordinate has a vertical guide; a marker appears only when its IV is supplied. Exact expiry values provide every admitted observation.",
    "按来源提供的距到期天数展示报告平值 IV。所选到期日的天数坐标明确时显示垂直参考线；仅在 IV 已提供时显示标记。精确到期日数值提供每条有效观测值。",
  ],
  narrow: [
    "This space is too narrow for readable chart axes. Open exact expiry values to continue the investigation.",
    "此区域过窄，图表坐标轴无法清晰呈现。打开精确到期日数值以继续研究。",
  ],
} as const;

export function makeVolTermT(lang: Lang) {
  return (key: keyof typeof LEX): string => LEX[key][lang === "zh" ? 1 : 0];
}
