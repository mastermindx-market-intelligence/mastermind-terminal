const PERF_LEX = {
  title: ["Forward track record", "前向记录"],
  subtitle: ["Canonical effective Prophet ledger", "Prophet 规范有效账本"],
  source: ["Source", "来源"],
  ledgerAsOf: ["Ledger as of", "账本截至"],
  latestClose: ["Latest close", "最近平仓"],
  closedPlans: ["Closed plans", "已平仓计划"],
  noEntry: ["No entry", "未入场"],
  rawMean: ["Raw underlying · mean", "原始标的收益 · 平均"],
  rawMedian: ["Raw underlying · median", "原始标的收益 · 中位数"],
  rawRange: ["Raw underlying · range", "原始标的收益 · 区间"],
  rawTitle: ["Raw underlying returns", "原始标的收益"],
  rawBody: [
    "Unweighted per-plan underlying price returns. Not option-contract return, portfolio return, benchmarked return, or alpha.",
    "按每个已入场计划等权显示标的价格原始收益。它不是期权合约收益、投资组合收益、基准收益或阿尔法。",
  ],
  benchmarkTitle: ["Benchmark context", "基准对照"],
  benchmarkUnavailable: [
    "The canonical ledger has no benchmark-return evidence, so benchmark and excess returns are not shown.",
    "规范账本目前没有基准收益证据，因此不显示基准收益或超额收益。",
  ],
  benchmarkReturn: ["Benchmark return", "基准收益"],
  excessReturn: ["Excess vs benchmark", "相对基准超额"],
  integrityTitle: ["Ledger integrity", "账本完整性"],
  canonicalRows: ["Canonical rows", "规范行数"],
  effectiveRows: ["Effective rows", "有效行数"],
  excludedRows: ["Quarantined rows excluded", "已排除隔离行"],
  correctedRows: ["Rows with applied corrections", "已应用更正的行"],
  historyTitle: ["Closed-plan history", "已平仓计划历史"],
  historyBody: [
    "Outcome counts use terminal closing labels only. T1/T2 counts are not “ever reached target” frequencies.",
    "结果计数只使用最终平仓标签。T1/T2 计数不代表“曾经触及目标”的频率。",
  ],
  ticker: ["Ticker", "代码"],
  direction: ["Direction", "方向"],
  signalDate: ["Signal", "信号日"],
  closeDate: ["Close", "平仓日"],
  outcome: ["Closing outcome", "平仓结果"],
  held: ["Held", "持有"],
  adherence: ["Plan adherence", "计划执行"],
  stockReturn: ["Raw underlying", "原始标的收益"],
  optionReturn: ["Option result", "期权结果"],
  bull: ["Bull", "看多"],
  bear: ["Bear", "看空"],
  outcomeT1: ["T1 close", "T1 平仓"],
  outcomeT2: ["T2 close", "T2 平仓"],
  outcomeInvalidated: ["Invalidated", "已失效"],
  outcomeExpired: ["Expired", "到期"],
  outcomeClosedEarly: ["Closed early", "提前平仓"],
  outcomeNoEntry: ["No entry", "未入场"],
  day: ["day", "天"],
  days: ["days", "天"],
  notPublished: ["Not published", "未发布"],
  noPosition: ["No position", "无持仓"],
  loading: ["Loading forward ledger…", "正在加载前向账本…"],
  unavailableTitle: ["Track record unavailable", "记录暂不可用"],
  unavailableBody: [
    "The private forward-ledger projection could not be read. Active plans are unaffected.",
    "无法读取私有前向账本投影。活跃计划不受影响。",
  ],
  retry: ["Retry", "重试"],
  emptyTitle: ["No terminal plans yet", "暂无终结计划"],
  emptyBody: [
    "The forward ledger is readable, but it does not yet contain a terminal plan.",
    "前向账本可读取，但目前还没有终结计划。",
  ],
} as const;

export type ProphetPerfStringKey = keyof typeof PERF_LEX;

export function makeProphetPerfT(lang: "en" | "zh") {
  return (key: ProphetPerfStringKey): string => {
    const pair = PERF_LEX[key];
    return lang === "zh" ? pair[1] : pair[0];
  };
}
