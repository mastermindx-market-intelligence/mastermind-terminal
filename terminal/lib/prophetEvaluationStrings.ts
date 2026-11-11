/**
 * prophetEvaluationStrings.ts — bilingual EN/ZH string table for the Strategy
 * Evaluation surface (`/prophet/evaluation`).
 *
 * Pattern matches components/prophet/prophetStrings.ts (feature-local lexicon,
 * never the global LEX bundle). NOT part of prophetStrings.ts: the Prophet
 * desk and this evaluation surface ship on different cadences.
 *
 * HONESTY DOCTRINE (binding for every string here):
 *   - The words "descriptive" and "not validated" ride along wherever a
 *     performance number is shown at headline size (release level is L0
 *     today; the label follows the artifact's `release.overall_level`).
 *   - No alpha, no "outperformance", no "beats the market", no edge, no
 *     recommendation, no claim that sector strength is a reason to trade.
 *   - Every number in a templated sentence is interpolated from the
 *     artifact — this file carries words only, never figures.
 *   - Translated strings never appear in HTML `title=` attributes.
 */
import type { Lang } from "@/lib/i18n";

export type EvaluationLexKey = keyof typeof PROPHET_EVALUATION_LEX;

const PROPHET_EVALUATION_LEX = {
  // ── Surface chrome ────────────────────────────────────────────────────────
  pageTitle: ["Strategy Evaluation", "策略评估"],
  pageEyebrow: ["Prophet · model book versus the market", "Prophet · 模型组合与市场对比"],
  backToProphet: ["Back to the Prophet board", "返回 Prophet 看板"],
  levelLabel: ["Release level", "发布级别"],
  levelL0: ["Descriptive only — not validated", "仅为描述性 — 未经验证"],
  levelL1: ["Accepted historical evidence", "历史证据已获接受"],
  levelL2: ["Prospective shadow tracking", "前瞻影子跟踪"],
  levelL3: ["Approved product prediction", "已批准的产品预测"],
  windowLabel: ["Evaluation window", "评估窗口"],
  sessionsUnit: ["sessions", "个交易日"],
  netOfCosts: ["net of costs", "已扣除成本"],
  notValidatedTag: ["Descriptive · not validated", "描述性 · 未经验证"],

  // ── Verdict (SX05 reading order, first) ───────────────────────────────────
  verdictTitle: ["The verdict, in plain words", "直白结论"],
  verdictWindowSentence: [
    "Evaluated over {sessions} sessions ({first} to {last}); the predeclared minimum for any accepted historical claim is {minSessions} sessions including a market drawdown of {needDd} or deeper. This window saw {seenDd}.",
    "评估区间 {first} 至 {last}，共 {sessions} 个交易日；任何被接受的历史结论所需的预申报下限为 {minSessions} 个交易日，且须包含一次不浅于 {needDd} 的市场回撤。本窗口实际最深回撤为 {seenDd}。",
  ],
  verdictBookSentence: [
    "The model book of published Prophet plans returned {book} while {benchmark} returned {spy} — a difference of {diff} (95% interval {ci}), which {zero}.",
    "已发布 Prophet 计划构成的模型组合收益为 {book}，{benchmark} 同期收益为 {spy}——差额 {diff}（95% 区间 {ci}），区间{zero}。",
  ],
  ciIncludesZero: ["includes zero", "包含零"],
  ciExcludesZero: ["excludes zero", "不包含零"],
  // The dominant reading when the interval spans zero (computed from the
  // artifact's CI — never a win framing, and it stays true when the excess is
  // small or negative).
  notDistinguishableSentence: [
    "Over these {sessions} sessions the book is not distinguishable from simply holding {benchmark}.",
    "在这 {sessions} 个交易日内，该组合与直接持有 {benchmark} 无法区分。",
  ],
  intervalExcludesZeroNote: [
    "The interval does not include zero; this remains descriptive and not validated.",
    "该区间不含零；结果仍为描述性、未经验证。",
  ],
  verdictClaimSentence: [
    "Nothing in this window shows value beyond market participation: sector context and member selection are not established by this evaluation.",
    "本窗口内没有任何证据显示超越市场参与的额外价值：本次评估未能确立行业环境或成分股选择的价值。",
  ],
  exNameBody: [
    "Without {asset} — the largest single contributor — the book is {diff} versus {benchmark} (interval {ci}).",
    "剔除 {asset}（最大单一贡献名称）后，组合相对 {benchmark} 为 {diff}（区间 {ci}）。",
  ],
  exNameContribution: [
    "{asset} alone contributed {pp} to the book's sum of daily returns.",
    "仅 {asset} 一项就对组合日收益合计贡献了 {pp}。",
  ],
  top5Share: ["Top 5 names: {share} of all positive contribution.", "前 5 大名称占全部正贡献的 {share}。"],

  // ── Market participation (beta first) ─────────────────────────────────────
  participationTitle: ["Market participation — beta first", "市场参与 — 先看贝塔"],
  participationKicker: [
    "Prophet must capture market beta before claiming anything else.",
    "Prophet 必须先跟上市场贝塔，才谈得上其他。",
  ],
  betaLabel: ["Beta vs {benchmark}", "相对 {benchmark} 的贝塔"],
  investedLabel: ["Mean invested weight", "平均投入权重"],
  upsideCaptureLabel: ["Upside capture", "上行捕获"],
  downsideCaptureLabel: ["Downside capture", "下行捕获"],
  criteriaLabel: ["Predeclared criteria", "预申报标准"],
  observedLabel: ["observed", "实测"],
  requiredLabel: ["required", "要求"],
  metLabel: ["met", "达标"],
  notMetLabel: ["not met", "未达标"],
  capNote: [
    "Cannot yet be judged: the window is below the predeclared global minimum, so every performance job stays descriptive.",
    "尚无法判定：窗口低于预申报的总体下限，因此所有绩效任务仍停留在描述性层面。",
  ],

  // ── Comparison family ─────────────────────────────────────────────────────
  comparisonTitle: ["The comparison family", "对比组合"],
  comparisonKicker: [
    "Each strategy's total return versus {benchmark} over the same window, with its 95% interval. The vertical line is zero — exactly matching {benchmark}.",
    "同一窗口内各策略相对 {benchmark} 的总收益差及其 95% 区间。竖线为零——即与 {benchmark} 完全一致。",
  ],
  colComparator: ["Comparator", "对比对象"],
  colTotal: ["Total (net)", "总收益（净）"],
  colVsSpy: ["vs {benchmark}", "相对 {benchmark}"],
  colCi: ["95% interval", "95% 区间"],
  colBeta: ["Beta", "贝塔"],
  colCapture: ["Up / down capture", "上/下行捕获"],
  colDrawdown: ["Max drawdown", "最大回撤"],
  colHolm: ["Holm p", "Holm 校正 p"],
  confirmatoryTitle: ["Confirmatory family — corrected p-values", "确认性检验族 — 校正后 p 值"],
  significantYes: ["significant after correction: yes", "校正后显著：是"],
  significantNo: ["significant after correction: no", "校正后显著：否"],
  rowUnavailable: ["not available — {reason}", "不可用 — {reason}"],
  tableIsAlternative: ["The table lists the same values as the chart.", "表格列出与图表相同的数值。"],
  referenceNote: ["Reference row: no costs charged.", "参考行：未计成本。"],

  // ── Material caveats ──────────────────────────────────────────────────────
  caveatsTitle: ["Material caveats", "重要注意事项"],
  caveatSingleNameTitle: ["The largest single name", "组合中最大的单一名称"],
  caveatRawPicksTitle: ["Raw picks, held without Prophet's exits", "不经 Prophet 退出管理的原始选股"],
  caveatRawPicksBody: [
    "Published plans held for a fixed {h}-session window without Prophet's exits averaged {mean} versus {benchmark} (interval {ci}); {rate} of them ended above {benchmark}.",
    "已发布计划若按固定 {h} 个交易日持有、不使用 Prophet 的退出管理，平均相对 {benchmark} 为 {mean}（区间 {ci}）；其中 {rate} 的结果高于 {benchmark}。",
  ],
  caveatNarrowCi: [
    "These intervals are likely too narrow: nearby publication dates share overlapping market paths.",
    "这些区间可能偏窄：相邻发布日期共享重叠的市场路径。",
  ],
  caveatRosterTitle: ["Membership and labels are current-basis", "成员与行业标签为当前口径"],
  caveatRosterBody: [
    "Point-in-time membership has no recorded change after {date}; {n} members had no price file and were excluded. Sector labels are current-basis GICS, not the classification in force at each date.",
    "时点成员表在 {date} 之后无任何变动记录；{n} 个成员缺少价格文件而被排除。行业标签为当前口径 GICS，并非各日期当时的分类。",
  ],

  // ── Disclosures (SX12) ────────────────────────────────────────────────────
  disclosuresTitle: ["Evaluation disclosures", "评估披露"],
  disclosureDetails: ["Evaluation details", "评估详情"],
  disclosureAttribution: ["How attribution works", "归因如何计算"],
  disclosureCoverage: ["Coverage", "覆盖情况"],
  disclosurePortfolio: ["Portfolio", "投资组合"],
  closeLabel: ["Close", "关闭"],
  opensPanelAria: ["Opens the {name} panel", "打开{name}面板"],

  // Evaluation details panel
  protocolTitle: ["Protocol", "协议"],
  codeTitle: ["Code", "代码"],
  clocksTitle: ["Data clocks", "数据时钟"],
  basisTitle: ["Evaluation basis", "评估基准"],
  statsTitle: ["Statistics", "统计方法"],
  bootstrapLine: [
    "Bootstrap B={b}, seed {seed}; mean block {mean} sessions, sensitivity block {sens} sessions.",
    "自助法 B={b}，种子 {seed}；均值块 {mean} 个交易日，敏感性块 {sens} 个交易日。",
  ],
  holmLine: ["Holm correction across the confirmatory family (α 0.05, one-sided).", "对确认性检验族做 Holm 校正（α 0.05，单侧）。"],
  jobsCriteriaTitle: ["Release-level criteria, with observed values", "发布级别标准及实测值"],
  globalMinimumTitle: ["Global minimum for any accepted claim", "任何被接受结论的总体下限"],
  l0ChecksTitle: ["L0 source checks", "L0 来源检查"],
  deviationsTitle: ["Deviations from the frozen header", "与冻结协议头的偏离"],
  claimsTitle: ["Claim statuses", "结论状态"],
  engineSummaryTitle: ["Engine-published summary (verbatim)", "引擎发布摘要（原文）"],
  limitationsTitle: ["All published limitations", "全部已发布限制"],
  zhVerbatimNote: [
    "Fields marked as published verbatim are shown in the engine's own words (English).",
    "标注为“原文”的字段按引擎原文（英文）展示。",
  ],

  // Attribution panel
  attributionMethodLabel: ["Method", "方法"],
  bridgeTitle: ["Where the book's return came from", "组合收益从何而来"],
  bridgeIdentity: [
    "benchmark + uninvested shortfall + sector allocation + selection within sector + cash + costs = strategy (unlinked sum of daily returns, not compounded).",
    "基准 + 未投入缺口 + 行业配置 + 行业内选股 + 现金 + 成本 = 策略（日收益的未链接加总，非复利）。",
  ],
  bridgeBenchmark: ["Benchmark ({benchmark})", "基准（{benchmark}）"],
  bridgeUninvested: ["Uninvested shortfall", "未投入缺口"],
  bridgeSector: ["Sector allocation", "行业配置"],
  bridgeSelection: ["Selection within sector", "行业内选股"],
  bridgeCash: ["Cash", "现金"],
  bridgeCosts: ["Costs", "成本"],
  bridgeStrategy: ["Strategy (sum of daily returns)", "策略（日收益合计）"],
  compoundingNote: [
    "The sum of daily returns ({sum}) differs from the compounded total ({total}); the compounding residual ({residual}) is exactly that difference.",
    "日收益合计（{sum}）与复利总收益（{total}）不同；复利残差（{residual}）正是这一差额。",
  ],
  identityErrorNote: ["Identity error as published: {value}.", "按原文发布的恒等式误差：{value}。"],
  modelBookNote: [
    "This is an accounting identity of an equal-weight model book of published plans. It is not a factor model, not actual holdings, and not a portfolio recommendation. The selection leg includes stock beta different from one.",
    "这是已发布计划等权模型组合的会计恒等式。它不是因子模型，不是实际持仓，也不是投资组合建议。选股腿中包含了不等于 1 的个股贝塔。",
  ],

  // Coverage panel
  coveragePlansTitle: ["Every plan accounted for", "每个计划均有归属"],
  coverageEraPlans: ["Plans published in the evaluation era", "评估周期内发布的计划"],
  coverageEvaluated: ["Evaluated positions", "已评估持仓"],
  coverageExcludedTitle: ["Excluded, with recorded reasons", "已排除及记录原因"],
  coverageExitTitle: ["Exit basis of evaluated positions", "已评估持仓的了结依据"],
  exitRecorded: ["Recorded close date", "记录的收盘了结日"],
  exitMechanical: ["Mechanical published levels", "发布级别的机械了结"],
  exitCensored: ["Still open at window end", "窗口结束时仍持有"],
  coverageMembershipTitle: ["Membership and price coverage", "成员与价格覆盖"],
  coverageMissingPrice: [
    "Point-in-time members with no price file ({n}), excluded and listed by the engine.",
    "无价格文件的时点成员（{n} 个），已被排除并由引擎列出。",
  ],
  coverageNotEvaluableTitle: ["What could not be evaluated, and why", "无法评估的内容及原因"],
  coverageSleeves: [
    "The eight catalog sleeves: plans carry no sleeve link.",
    "八个目录分支：计划未携带分支链接。",
  ],
  coveragePeers: ["Issuer-excluded peer counts: {status} — {reason}", "同发行人排除的同类计数：{status} — {reason}"],
  coverageHoldings: [
    "Actual-holdings attribution: no holdings exist — the evaluation follows a model book.",
    "实际持仓归因：不存在持仓数据——本评估跟踪的是模型组合。",
  ],
  coverageHitRate: [
    "{beat} of {n} positions ended above {benchmark} over their own holding window ({rate}, Wilson interval {ci}).",
    "{n} 个持仓中 {beat} 个在其自身持有期内高于 {benchmark}（{rate}，Wilson 区间 {ci}）。",
  ],

  // Portfolio panel
  portfolioPanelTitle: ["This is a model book, not your portfolio", "这是模型组合，不是你的投资组合"],
  portfolioPanelBody: [
    "The evaluation follows an equal-weight model book of published plans. It is not your portfolio, and no reconciliation to actual holdings is offered.",
    "本评估跟踪已发布计划的等权模型组合。它不是你的投资组合，也不提供与实际持仓的对账。",
  ],
  portfolioCta: ["Open Portfolio", "打开投资组合"],

  // ── Data states ───────────────────────────────────────────────────────────
  loadingTitle: ["Loading the evaluation…", "正在加载评估…"],
  unavailableTitle: ["Evaluation not available yet", "评估结果尚未发布"],
  unavailableBody: [
    "The strategy evaluation is published by the Macro evaluation engine. When an artifact is available for a complete window, this page will show it. Nothing is inferred in the meantime.",
    "策略评估由 Macro 评估引擎发布。当存在完整窗口的评估结果时，本页将展示它。在此之前不作任何推断。",
  ],
  tryAgain: ["Try again", "重试"],
  unauthenticatedTitle: ["Sign in to view the evaluation", "登录后查看评估"],
  forbiddenTitle: ["Plan access required", "需要相应订阅权限"],

  // ── Footer / stamps ───────────────────────────────────────────────────────
  asofPlans: ["Plan snapshot", "计划快照"],
  asofPrices: ["Prices through", "价格截至"],
  asofWindow: ["{sessions} sessions · {returns} daily returns · costs {etf} bp ETF / {stock} bp stock per side", "{sessions} 个交易日 · {returns} 个日收益 · 成本 每边 ETF {etf} bp / 个股 {stock} bp"],

  // ── Job names (release.jobs keys) ─────────────────────────────────────────
  jobA: ["Market participation (beta first)", "市场参与（先贝塔）"],
  jobB: ["Sector context", "行业环境"],
  jobC: ["Member selection", "成分股选择"],

  // ── Comparator short names (by wire id; artifact label is the fallback) ───
  cmpC1: ["Passive market (SPY)", "被动市场（SPY）"],
  cmpC2: ["Simple participation rule", "简单参与规则"],
  cmpC3: ["Sector rotation only", "仅行业轮动"],
  cmpC4: ["Member momentum only", "仅成分股动量"],
  cmpC5: ["Sector × member", "行业 × 个股"],
  cmpC6: ["Prophet book (as built)", "Prophet 组合（按现行规则）"],
  cmpC7: ["Prophet, outside leading sectors", "Prophet，非领涨行业"],
  cmpC6A: ["Prophet, inside leading sectors", "Prophet，领涨行业内"],
  // X6 is an exposure-weight reference only — never evidence that member
  // selection has (or lacks) value; value is "not shown", never "no value".
  cmpX6: ["Exposure-weight reference (SPY/cash at Prophet's weight)", "敞口加权参考（按 Prophet 仓位的 SPY/现金）"],

  // ── Confirmatory table extras ─────────────────────────────────────────────
  colContrast: ["Contrast", "对比"],
  colAnnDiff: ["Annualised diff", "年化差"],
  colRawP: ["p (raw)", "p（原始）"],
  block21Label: ["21-session block", "21 个交易日块"],
  at2xLabel: ["at 2× costs", "2 倍成本下"],

  // ── Evaluation details panel field labels ────────────────────────────────
  capRuleTitle: ["Cap rule (verbatim)", "上限规则（原文）"],
  l2l3Title: ["L2/L3 rule (verbatim)", "L2/L3 规则（原文）"],
  clockMacro: ["Macro data commit", "Macro 数据提交"],
  clockPlans: ["Plan index", "计划索引"],
  clockResolution: ["Resolution log", "了结日志"],
  clockPit: ["Point-in-time membership", "时点成员表"],
  clockPrices: ["Prices", "价格"],
  basisMarket: ["Market", "市场"],
  basisBenchmark: ["Benchmark", "基准"],
  basisCurrency: ["Currency", "币种"],
  basisReturn: ["Return basis", "收益口径"],
  basisCash: ["Cash instrument", "现金工具"],
  basisCosts: ["Costs (bp per side)", "成本（每边 bp）"],
  codeCommit: ["Commit", "提交"],
  codeModule: ["Module", "模块"],
  codeRunner: ["Runner", "执行器"],
  codeHarness: ["Working tree dirty", "工作区含未提交改动"],
  frozenOn: ["Protocol frozen on", "协议冻结于"],
  headerSha: ["Header SHA-256", "协议头 SHA-256"],

  // ── Release criteria rows (by wire criterion id; fallback = the id) ───────
  crit_window_sessions: ["Window sessions", "窗口交易日"],
  crit_spy_drawdown_present: ["Market drawdown in window", "窗口内市场回撤"],
  crit_resolved_positions: ["Resolved positions", "已了结持仓"],
  crit_era_plans_classified_share: ["Era plans classified", "评估周期计划分类率"],
  crit_entered_positions_priced_share: ["Entered positions priced", "已入场持仓定价率"],
  crit_beta_point_in: ["Beta point estimate in band", "贝塔点估计落在区间内"],
  crit_beta_ci_lower: ["Beta CI lower bound", "贝塔区间下界"],
  crit_upside_capture_point: ["Upside capture", "上行捕获"],
  crit_upside_capture_ci_lower: ["Upside capture CI lower bound", "上行捕获区间下界"],
  crit_mean_invested: ["Mean invested weight", "平均投入权重"],
  crit_ann_excess_ci_lower_noninferior: ["Annual excess CI lower (non-inferiority)", "年化超额区间下界（非劣性）"],
  crit_noninferior_at_2x_costs_point: ["Non-inferiority at 2× costs", "2 倍成本下非劣性"],
  crit_holding_period_sessions: ["Holding period", "持有期"],
  crit_sector_coverage_share: ["Sector coverage", "行业覆盖率"],
  crit_name_coverage_share: ["Name coverage", "个股覆盖率"],

  // ── Attribution waterfall bar labels (short — the panel table beside the
  //    chart carries the full names and the exact values) ────────────────────
  wfBenchmark: ["Bench", "基准"],
  wfUninvested: ["Uninv.", "缺口"],
  wfSector: ["Sector", "行业"],
  wfSelection: ["Select", "选股"],
  wfCash: ["Cash", "现金"],
  wfCosts: ["Costs", "成本"],
  wfStrategy: ["Total", "合计"],

  // ── Generic table/status words ────────────────────────────────────────────
  statusLabel: ["Status", "状态"],
  criterionCol: ["Criterion", "标准"],
  wordFalse: ["false", "false"],

  // ── Attribution panel extras ──────────────────────────────────────────────
  compoundedTotalLabel: ["Compounded total (net)", "复利总收益（净）"],
  otherBooksTitle: ["The same bridge, other Prophet books", "其他 Prophet 组合的同一桥接"],
  concurrentTitle: ["Concurrent positions (min / median / max)", "并发持仓（最小 / 中位 / 最大）"],

  // ── Coverage panel extras ─────────────────────────────────────────────────
  rbDecision: ["Decision", "决策日"],
  rbExecution: ["Execution", "执行日"],
  rbPitActive: ["PIT members", "时点成员"],
  rbNoPrice: ["No price file", "缺价格文件"],
  rbNoSector: ["No sector", "无行业"],
  rbShort: ["Short history", "历史过短"],
  rbBelowMin: ["Below price min", "低于价格下限"],
  rbEligible: ["Eligible", "合格"],
  rbC4: ["C4 names", "C4 个股"],
  rbC5: ["C5 names", "C5 个股"],
  rbC5Sectors: ["C5 sectors", "C5 行业"],
  sectorWeightsTitle: ["C4 sector weights (as published)", "C4 行业权重（按原文）"],
  splitTitle: ["Leading-sector split (C7 / C6A)", "领涨行业拆分（C7 / C6A）"],
  splitOutside: ["Outside leading sectors", "非领涨行业"],
  splitInside: ["Inside leading sectors", "领涨行业内"],
  splitUnmapped: ["Unmapped", "未映射"],
  coverageTickersTitle: ["Members excluded for a missing price file", "因缺少价格文件被排除的成员"],
  dropSensitivityTitle: ["Drop-corrected sensitivity re-run", "剔除修正敏感性复跑"],

  // ── Raw-picks decomposition (event study, stock vs sector leg) ───────────
  // Sign-agnostic: the engine's own reading of which leg dominates lives in
  // the verbatim headline; this sentence only states both published legs.
  rawPicksDecompose: [
    "Decomposition: the stock versus its own sector ETF {stock}; the sector ETF versus {benchmark} {sector}.",
    "分解：个股相对其自身行业 ETF 为 {stock}；行业 ETF 相对 {benchmark} 为 {sector}。",
  ],

  // ── Exclusion reasons (closed set from the contract) ─────────────────────
  reason_recorded_no_entry: ["Recorded as never entered", "记录为从未入场"],
  reason_not_entered_zone_live: ["Entry zone still open, never filled", "入场区间仍开放，未触发"],
  reason_not_entered_zone_expired: ["Entry zone expired unfilled", "入场区间到期未触发"],
  reason_resolved_at_or_before_follower_fill: ["Closed before a follower could buy", "跟随者可买入前已了结"],
  reason_published_after_window: ["Published after the window", "窗口结束后发布"],
  reason_fill_after_window: ["Filled after the window", "窗口结束后成交"],
  reason_no_fill_no_close_at_entry: ["No price at the fill session", "成交日无价格数据"],
  reason_no_publication_clock: ["No publication clock", "无发布时钟"],
  reason_not_long: ["Not a long plan", "非做多计划"],
  reason_excluded_by_sensitivity: ["Excluded by the sensitivity rule", "因敏感性规则排除"],
} as const;

export function getEvaluationStr(lang: Lang, key: EvaluationLexKey): string {
  const entry = PROPHET_EVALUATION_LEX[key];
  return lang === "zh" ? entry[1] : entry[0];
}

export function makeEvaluationT(lang: Lang): (key: EvaluationLexKey) => string {
  return (key: EvaluationLexKey) => getEvaluationStr(lang, key);
}

/** Interpolate {placeholders} from a bound set — words only, numbers arrive
 * already formatted from the artifact. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? values[name] : whole);
}

/** Short display name for a comparator id; the artifact's own label is the
 * honest fallback for any future id this build does not know. */
export function comparatorShortName(lang: Lang, id: string, artifactLabel: string): string {
  const byId: Record<string, EvaluationLexKey> = {
    C1_passive_market: "cmpC1", C2_simple_participation: "cmpC2", C3_sector_allocation_only: "cmpC3",
    C4_member_selection_only: "cmpC4", C5_joint_sector_and_name: "cmpC5",
    C6_exact_incumbent_prophet: "cmpC6", C7_independent_emergence: "cmpC7",
    C6A_context_aligned_prophet: "cmpC6A", X6_exposure_matched_reference: "cmpX6",
  };
  const key = byId[id];
  return key ? getEvaluationStr(lang, key) : artifactLabel;
}

/** Release-level label from the artifact's own level id (forward-compatible:
 * an unknown future id renders as its own id, never a wrong label). */
export function evaluationLevelLabel(lang: Lang, level: string): string {
  const byLevel: Record<string, EvaluationLexKey> = {
    L0_descriptive: "levelL0", L1_accepted_historical: "levelL1",
    L2_prospective_shadow: "levelL2", L3_approved_product_prediction: "levelL3",
  };
  const key = byLevel[level];
  return key ? getEvaluationStr(lang, key) : level;
}

/** Exclusion-reason label from the contract's closed set; unknown reasons
 * render as their wire slug rather than a guessed translation. */
export function exclusionReasonLabel(lang: Lang, reason: string): string {
  const key = `reason_${reason}` as EvaluationLexKey;
  return Object.hasOwn(PROPHET_EVALUATION_LEX, key) ? getEvaluationStr(lang, key) : reason;
}

/** Release job display name; unknown future job keys render as the wire key. */
export function releaseJobName(lang: Lang, key: string): string {
  const byKey: Record<string, EvaluationLexKey> = {
    A_market_participation: "jobA", B_sector_context: "jobB", C_member_selection: "jobC",
  };
  const lexKey = byKey[key];
  return lexKey ? getEvaluationStr(lang, lexKey) : key;
}

/** Release-criterion display name; unknown future criterion ids render as the
 * wire id (never a guessed label that could misname a future check). */
export function criterionLabel(lang: Lang, id: string): string {
  const key = `crit_${id}` as EvaluationLexKey;
  return Object.hasOwn(PROPHET_EVALUATION_LEX, key) ? getEvaluationStr(lang, key) : id;
}
