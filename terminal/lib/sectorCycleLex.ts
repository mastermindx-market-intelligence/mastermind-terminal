"use client";
import { useCallback } from "react";
import { useLang, useT } from "./i18n";

/** Lane-local Cycles copy (EN/ZH). Language state remains the shared
 * LangProvider; every pair is traced to a donor deck — Terminal #1249's LEX,
 * Macro #10707's COPY table or the frozen SC_FACE copy deck — never invented
 * here. Keeping this out of the shared workspace lexicon leaves the workspace
 * lane free to mount or skip the Cycles experience per route. */
export const SECTOR_CYCLE_LEX: Record<string, [string, string]> = {
  /* Title / identity */
  scTitle: ["Sector cycles", "板块周期"],
  scCycleEvidence: ["Cycle evidence", "周期证据"],
  scKindSector: ["sector", "板块"],
  scKindBasket: ["theme", "主题"],
  scKindIndex: ["index", "指数"],
  scAsOf: ["As of", "截至"],
  scStaleChip: ["Historical snapshot", "历史快照"],
  scFixtureChip: ["Fixture", "示例数据"],

  /* Access / data states (#10707 COPY) */
  scLoading: ["Loading cycle evidence…", "正在加载周期证据…"],
  scDenied: ["Cycle evidence is not available with this access", "当前访问权限无法查看周期证据"],
  scUnauthenticated: ["Sign in to view cycle evidence", "请登录以查看周期证据"],
  scUnavailable: ["Cycle evidence unavailable", "周期证据暂不可用"],
  scUnavailableBody: ["No reading is inferred. Other parts of this investigation remain available.", "不推断任何读数，仍可查看本次研究的其他内容。"],
  scIncompatibleGeneration: ["Snapshots do not match", "快照版本不一致"],
  scIncompatibleBody: ["This reading is withheld rather than mixing source dates or publication versions.", "暂不显示此读数，以免混用不同的日期或发布版本。"],
  scRefresh: ["Refresh", "刷新"],

  /* Phase rail */
  scRailHead: ["Sectors by phase", "各板块周期阶段"],
  scRailHeadBaskets: ["Themes by phase", "各主题周期阶段"],
  scMeasuredCount: ["{n} of {total} measured", "{n}/{total} 个有观测"],
  scUniverseTabs: ["Sector ETFs vs SPY", "板块 ETF 对比 SPY"],
  scUniverseBaskets: ["Thematic Baskets vs SPY", "主题组合对比 SPY"],
  scUniverseNasdaq: ["Nasdaq-100 vs QQQ", "纳斯达克100对比 QQQ"],
  scUniverseRussell: ["Russell-2000 vs IWM", "罗素2000对比 IWM"],
  scRailSearch: ["Filter series", "筛选序列"],
  scRailAll: ["All {n}", "全部 {n}"],
  scRailEmptyGroup: ["No {phase} readings in this family right now", "该家族当前没有「{phase}」读数"],
  scRailLeadLag: ["Lead-lag: no claim. The lead-lag study stopped; nothing here orders sectors in time.", "领先滞后：不作声明。领先滞后研究已停止；此处不对板块作时间排序。"],
  scPositionUnavailable: ["Phase unavailable", "阶段暂不可用"],

  /* Facts */
  scPhase: ["Cycle phase · ontology", "周期阶段 · 本体框架"],
  scPositionFact: ["Position · ontology", "位置 · 本体框架"],
  scPositionNote: ["0–100 scale. Not a probability.", "0–100刻度，并非概率。"],
  scTrend: ["Price vs 200-session average", "价格与200日均线"],
  scAbove: ["Above", "高于"],
  scBelow: ["Below", "低于"],
  scUnknown: ["Unavailable", "暂不可用"],
  scLegacyPhase: ["Legacy phase", "旧版阶段"],
  scLegacyWithheld: ["The legacy cycle read names a different phase family than the phase clock; it is kept verbatim in the provenance drawer and is not drawn as the current read.", "旧版周期读数所指阶段族与阶段时钟不同；原文保留于来源抽屉，不作为当前读数显示。"],

  /* Phase age (SC_FACE) */
  scAgeMeasured: ["{n} sessions in this phase", "本阶段已持续 {n} 个交易日"],
  scAgeLowerBound: ["At least {n} sessions in this phase (history starts {date})", "本阶段至少已持续 {n} 个交易日（历史自 {date} 起）"],
  scAgeUnknown: ["Phase age not yet measured", "阶段持续时间尚未测得"],

  /* Stance / clocks */
  scStanceTitle: ["Stance", "立场"],
  scStanceUnavailable: ["Stance unavailable", "立场不可用"],
  scStanceSource: ["Engine mapping · Sector Cycles", "引擎映射 · 板块周期"],
  scClocks: ["Clocks", "时钟"],
  scClockPhase: ["phase clock", "阶段时钟"],
  scClockHazard: ["hazard clock", "风险时钟"],
  scClockRhythm: ["rhythm clock", "节律时钟"],
  scClockLadder: ["timing ladder", "时序阶梯"],
  scClockRead: ["cycle read", "周期读数"],
  scClocksFoot: ["Each disagreeing clock's own values are kept in the provenance drawer.", "各分歧时钟自身的数值保留于来源抽屉。"],
  scClockLadderChip: ["Ladder disagrees", "阶梯分歧"],
  scClockHazardChip: ["Hazard clock disagrees", "风险时钟分歧"],
  scClockRhythmChip: ["Rhythm clock disagrees", "节律时钟分歧"],
  scClockReadChip: ["Read disagrees", "读数分歧"],
  scClockLadderPattern: ["{phase_name} says {phase} · {ladder_name} says {ladder}", "{phase_name}显示{phase} · {ladder_name}显示{ladder}"],
  scClockDisagreePattern: ["{a_name} says {a} · {b_name} says {b}", "{a_name}显示{a} · {b_name}显示{b}"],

  /* Chart panel */
  scChartTitle: ["Strength vs {bench}", "相对 {bench} 强弱"],
  scChartNote: ["The lines show rolling 21- and 63-session total returns relative to {bench}. Zero means it matched {bench}. Past turns are reconstructed, not signals known at the time.", "曲线为相对 {bench} 的滚动21和63个交易日总回报。零表示与 {bench} 持平。历史转折为事后重建，并非当时可用的信号。"],
  scReconLabel: ["Reconstructed from prices", "按价格重建"],
  scReconBody: ["Reconstructed from prices: calculated later, not what Mastermind showed at the time.", "按价格重建：事后计算，并非 Mastermind 当时显示的内容。"],
  scSeries21: ["21 sessions", "21个交易日"],
  scSeries63: ["63 sessions", "63个交易日"],
  scOscSeries: ["Cycle position · 0–100", "周期位置 · 0–100"],
  scExactValues: ["Exact values", "精确数值"],
  scExactNote: ["Original plotted observations.", "原始绘图观测值。"],
  scOscExactNote: ["Original plotted observations. Decimal-year coordinates are not publication dates.", "原始绘图观测值。小数年份坐标并非发布日期。"],
  scChart: ["Chart", "图表"],
  scTable: ["Data table", "数据表"],
  scObservationDate: ["Observation date", "观测日期"],
  scChartRange: ["Chart range", "图表范围"],
  /* v1.1: fixed historical windows. These are SESSION counts (the feed's own
   * 21/63/252-session horizons) — never relabelled as calendar months, and
   * never confused with Prophet's separate 20-completed-session horizon. */
  scRange21: ["21 sessions", "21个交易日"],
  scRange63: ["63 sessions", "63个交易日"],
  scRange252: ["252 sessions", "252个交易日"],
  scRangeAll: ["All", "全部"],
  scScale: ["Scale", "刻度"],
  scScaleLinear: ["Linear", "线性"],
  scScaleLog: ["Log", "对数"],
  scScaleLogUnavailable: ["Log scale needs strictly positive values on every visible series", "对数刻度要求所有可见序列严格为正"],
  scSeries: ["Series", "序列"],
  scBasisPillPrice: ["price", "价格"],
  scBasisPillTr: ["total return", "总回报"],
  scBasisRefusal: ["{a} is measured on a {basisA} basis and {b} on a {basisB} basis; overlaying them would compare different measures.", "{a} 为{basisA}口径，{b} 为{basisB}口径，叠加显示会混淆不同的测量。"],
  scNoHistory: ["No comparable closes", "无可比收盘数据"],
  scHistoryInvalid: ["History withheld: observations are invalid or out of order. Core facts remain available.", "历史暂不显示：观测值无效或顺序有误。核心事实仍可查看。"],
  scHistoryUnverified: ["History withheld until its source part is verified. Core facts remain available.", "历史需待来源分块核验后显示。核心事实仍可查看。"],
  scHistoryMissing: ["History not attached", "尚未附上历史序列"],
  scHistoryFailed: ["History could not be drawn; the facts above are unchanged", "历史图暂无法绘制，上方事实读数不受影响"],
  scNoTurns: ["No turns in this range", "所选范围无转折"],
  scTurns: ["Price turns", "价格转折"],
  scPeak: ["Peak", "高点"],
  scTrough: ["Trough", "低点"],
  scProvisional: ["Provisional", "暂定"],
  scConfirmed: ["Confirmed", "已确认"],
  scOpenLeg: ["Open leg", "开放段"],
  scTurnSince: ["since {date}", "自 {date} 起"],
  scPrice: ["Price", "价格"],

  /* Leg timeline / story */
  scLegTimeline: ["Leg timeline", "周期段 timeline"],
  scLegOpenSessions: ["Open · {n} sessions", "开放 · {n} 个交易日"],
  scLegOpenNoCount: ["Open leg", "开放周期段"],
  scLegDetails: ["Leg details", "周期段详情"],
  scLegVsBenchmark: ["vs {bench}", "相对 {bench}"],
  scStory: ["Story", "周期段解读"],
  scStoryAbsent: ["No story attached to this leg", "该周期段没有附带解读"],
  scStoryExpired: ["Story quarantined: its own TTL or staleness marker fired", "解读已隔离：其有效期或陈旧标记已触发"],
  scStoryWrongEpoch: ["Story quarantined: written for a different generation", "解读已隔离：写于另一个生成版本"],
  scStoryProvenance: ["Narrative, written from the cycle record. Not a measurement.", "叙述，基于周期记录撰写，并非测量值。"],

  /* Timing / rhythm */
  scTiming: ["Timing & projection", "时机与推演"],
  scRhythmKind: ["Descriptive rhythm", "描述性节律"],
  scRhythmKindBody: ["Own rhythm, descriptive. Not a model.", "自身节律，描述性，非模型。"],
  scForecastFootnote: ["Projected next {turn} ≈ {month} ({low}–{high}), from this {unit}'s own median half-cycle: a descriptive rhythm, not a model, and a timing window, not a guarantee.", "预计下次{turn}约在 {month}（{low}–{high}），基于该{unit}自身的中位半周期：描述性节律而非模型，仅为时间窗口。"],
  scTurnWordPeak: ["peak", "顶部"],
  scTurnWordTrough: ["trough", "底部"],
  scWinLow: ["earliest", "最早"],
  scWinCentral: ["central", "中位"],
  scWinHigh: ["latest", "最晚"],
  scOverdueChip: ["Overdue", "已逾期"],
  scWindowBefore: ["Window has not opened", "时间窗尚未开启"],
  scWindowInside: ["Inside the timing window", "处于时间窗内"],
  scWindowPast: ["Window has passed", "时间窗已过"],
  scWindowUnavailable: ["Rhythm window unavailable", "节律时间窗暂不可用"],
  scRhythmExpired: ["Rhythm kept from a different generation; withheld", "节律数据来自另一个生成版本，已暂不显示"],
  scNextPeak: ["Next peak", "下次顶部"],
  scNextTrough: ["Next trough", "下次底部"],

  /* Hazard */
  scHazardLabel: ["Turn hazard (historical qualification only)", "转折风险（仅历史校验）"],
  scHazardFaceNote: ["Probability that the open leg's next confirmed turn lands inside each horizon. Historical calibration only; not a current claim while live parity is unproven.", "开放周期段的下一个已确认拐点落在各时间窗内的概率。仅为历史校准；实时一致性未证实期间不构成当前判断。"],
  scHazardUnavailable: ["No calibrated cell for this leg. The producer could not form a monotone turn curve; shown as a gap, never as zero.", "该周期段没有校准单元格。生产端无法形成单调的转折曲线；显示为空缺，绝不记为零。"],
  scHazardWithheld: ["The hazard ladder for this leg is kept in the provenance drawer; it is not drawn as the current leg.", "该周期段的风险阶梯保留于来源抽屉，不作为当前周期段显示。"],
  scHazardParityChip: ["Live parity unproven", "实时一致性未证实"],
  scHz1m: ["P(turn ≤ 1m)", "转折≤1月"],
  scHz3m: ["≤3m", "≤3月"],
  scHz6m: ["≤6m", "≤6月"],
  scBadgeModel: ["MODEL", "模型"],
  scBadgePrior: ["PRIOR", "先验"],
  scPriorGloss: ["PRIOR: historical base rate, not a model", "先验：历史基准率，并非模型"],
  scHazardRowUp: ["an up leg", "向上段"],
  scHazardRowDown: ["a down leg", "向下段"],
  scHazardWrongEpoch: ["Hazard cells were calibrated for a different epoch; withheld whole", "风险单元格校准于另一个版本，整体暂不显示"],

  /* Qualification strip */
  scParityFailed: ["Model reading is not current: live parity not met", "模型读数不代表当前状态：实时一致性核验未通过"],

  /* v1.1 per-head forecast capabilities (lane 8 R3 wording, replaces the
   * generic "model not qualified today" line). Each head is judged ALONE:
   * one withdrawn head never hides its siblings or the observed Cycles facts
   * (SP10), and no withheld head ever shows a number. On the wire every
   * head — withdrawn included — carries status "withheld" with its own
   * reason code; no qualified or dated-withdrawal status exists today. */
  scForecastHeads: ["Remaining-opportunity forecasts", "剩余机会预测"],
  scForecastHeadsFoot: ["Each forecast is withheld on its own; the observed cycle facts above are unaffected.", "每项预测单独判断是否暂缓显示；上方已观测的周期事实不受影响。"],
  scForecastHeadsAbsent: ["No forecast capability block is attached to this record; nothing is inferred.", "该记录未附带预测能力分块；不作任何推断。"],
  scForecastHeadsInvalid: ["This record's forecast block did not match its published contract; nothing is drawn from it.", "该记录的预测分块与已发布契约不符；不从中绘制任何内容。"],
  /* The four head names (lane 8 wire contract, canonical order). */
  scHeadRemainingReturn: ["Remaining return", "剩余回报"],
  scHeadAdverseTail: ["Adverse tail", "不利尾部"],
  scHeadTargetBeforeInvalidation: ["Target before invalidation", "先达目标还是先失效"],
  scHeadTransitionTime: ["Transition time", "转折确认时间"],
  scHeadStatusWithheld: ["Withheld", "暂缓显示"],
  scHeadWithheldNoNumber: ["No estimate is shown for a withheld forecast.", "暂缓显示的预测不展示任何数值。"],
  scHeadEvidence: ["Evidence", "证据"],
  scHeadHorizon: ["Horizon: {n} completed sessions", "时间跨度：{n} 个已完结交易日"],
  scHeadDirectional: ["Leg-direction fact: what the current up/down leg tends to reach, not a cycle-timing edge.", "周期段方向事实：描述当前上行/下行段的倾向，并非周期择时边界。"],
  /* Lane 8's reason-specific lines (its return names these five). */
  scReasonResearchWithheldFailed: ["Withheld: the research test failed this forecast on current data", "暂缓：该预测在当前数据上的研究检验未通过"],
  scReasonLiveStateNotProtocolEpoch: ["Withheld: live cycle state does not match the research protocol's turn epoch", "暂缓：实时周期状态与研究协议的转折口径不一致"],
  scReasonMembershipNotPointInTime: ["Withheld: membership is not point-in-time for this record", "暂缓：该记录的成分并非时点口径"],
  scReasonRecordKindNotEvaluated: ["Withheld: this record kind was not part of the research evaluation", "暂缓：该记录类型未纳入研究评估范围"],
  scReasonMarketNotEvaluated: ["Withheld: this market was not part of the research evaluation", "暂缓：该市场未纳入研究评估范围"],
  /* The producer's other three CURRENT codes — its precedence ladder
   * (engine/sector_heads.py head_capabilities) has eight codes, not five.
   * Any code outside the eight — e.g. a caller-supplied withdraw() reason —
   * falls to scReasonUnknown; never a bare code dump. */
  scReasonResearchWithheldUnderpowered: ["Withheld: not enough data to judge this forecast", "暂缓：数据不足以判断该预测"],
  scReasonResearchNotEvaluated: ["Withheld: this forecast was not evaluated in the research", "暂缓：该预测未经研究评估"],
  scReasonLiveEstimatorNotWired: ["Withheld: no live estimator produces this forecast yet", "暂缓：尚无实时估计器输出该预测"],
  scReasonUnknown: ["Withheld for an unstated reason", "因未说明的原因暂缓显示"],
  scReasonPayloadInvalid: ["Withheld: this forecast block did not match its published contract", "暂缓：该预测分块与已发布契约不符"],

  /* v1.1 SP11: the two dates are distinct facts and never conflated. */
  scTurnKnownSince: ["first known {date}", "最早可知 {date}"],
  scTurnDateNote: ["Turn dates are pivot dates. A turn becomes known only at confirmation — the two dates are kept distinct.", "转折日期为拐点日期。拐点仅在确认后才可知 — 两种日期严格区分。"],

  /* v1.1: historical duration is a measured fact, never remaining upside. */
  scDurationNotUpside: ["Time in phase is a measured historical fact — not remaining upside, and not a time limit.", "阶段时长是已测量的历史事实 — 并非剩余上行空间，也不是时间限制。"],
  scParityNotEstablished: ["Current model qualification unavailable", "当前模型资格尚未确认"],
  scParityHolds: ["Source parity holds; model qualifications remain separate", "源数据一致性核验通过，模型资格仍需单独判断"],
  scModelBody: ["No probability is promoted here. Historical MODEL and PRIOR evidence remains in the full Cycles view.", "此处不提升任何概率主张。完整周期视图保留历史模型与先验证据。"],

  /* The read / events */
  scTheRead: ["The read", "解读"],
  scReadWithheld: ["The production read names a different phase family than the phase clock; it is kept verbatim in the provenance drawer and is not drawn as the current read.", "生产解读所指阶段族与阶段时钟不同；原文保留于来源抽屉，不作为当前读数显示。"],
  scReadAbsent: ["No engine read attached to this record", "该记录没有附带引擎解读"],
  scEvents: ["Rotation events", "轮动事件"],
  scEventsNone: ["No closed rotation episodes in this window", "该窗口内没有已结束的轮动事件"],
  scEventsColdstart: ["Event ledger is cold-starting; recent closures are not yet graded", "事件台账冷启动中，近期结束事件尚未评分"],
  scEventsExcluded: ["{cross} cross-pair and {invalid} invalid rows excluded by the source owner", "来源方已排除 {cross} 个跨对事件与 {invalid} 个无效行"],
  scEventsWrongEpoch: ["Event ledger is stamped after this generation; withheld", "事件台账时间戳晚于本生成版本，已暂不显示"],
  scEventClosed: ["closed", "已结束"],
  scEventDays: ["{n} sessions", "{n} 个交易日"],

  /* DNA / methods */
  scDna: ["Methods and limits", "方法与限制"],
  scSizingInert: ["Position sizing: none. The conviction multiplier is held at 1.0 and is not a size.", "仓位规模：无。信念倍数固定为 1.0，并非仓位大小。"],
  scSourceDetails: ["Evidence details", "证据详情"],
  scProvenanceHint: ["producer fields, codes and sources", "生产字段、代码与来源"],
  scPublication: ["Publication identity", "发布版本身份"],
  scUnverifiedPublication: ["Unverified snapshot", "未核验快照"],
  scClassifier: ["Phase classifier", "阶段分类器"],
  scHistoryBasis: ["Price-history basis", "价格历史口径"],
  scMembership: ["Membership basis", "成员口径"],
  scHistoryMode: ["History interpretation", "历史解释"],
  scSeriesStatus: ["Plotted-history verification", "所绘历史核验"],
  scCurrentReconstruction: ["Reconstructed history; not an observed point-in-time record", "重建历史，并非当时观测记录"],
  scSingleInstrument: ["Single instrument; not a claim about historical constituents", "单一证券，不代表已核验历史成分"],
  scCurrentMembers: ["Current membership; historical constituents not established", "当前成员口径，历史成分尚未确认"],
  scFallbackBasis: ["Declared total-return fallback", "已声明的总回报回退"],
  scVerifiedBy: ["Verified by the original source owner", "已由原有来源核验"],
  scHowMeasured: ["How this was measured", "测量方式"],

  /* Grader */
  scGraderEyebrow: ["Conviction-call grader", "判断评分器"],
  scGraderTitle: ["Conviction-call grader: measured hit rate", "判断评分器：已衡量命中率"],
  scGraderCaption: ["Conviction-call hit rate over all resolved calls, Neutral included. Not a win rate.", "全部已结算判断（含中性）的条件命中率，并非胜率。"],
  scGraderBody: ["Realized directional hit-rate, cross-sectional rank-IC and excess-vs-SPY of the conviction calls, by horizon. Sparse until it accrues; never fed back into the live score.", "按时间跨度衡量信念判断的已实现方向命中率、横截面秩相关与超越SPY的超额收益。数据累积前较稀疏；绝不回灌入实时评分。"],
  scGraderAccruing: ["Accruing: dated calls are logged and will be graded against realized forward returns as time passes ({n} calls logged).", "累积中：带日期的判断已记录，将随时间推移对照已实现的前瞻收益进行评分（已记录 {n} 个判断）。"],
  scGraderAbstained: ["No call made", "未下判断"],
  scGraderUnavailable: ["Grader unavailable in this generation", "本生成版本暂无评分器"],
  scGraderHitRate: ["conditional hit rate", "条件命中率"],
  scGraderAbstention: ["abstention", "中性占比"],
  scGraderRankIc: ["rank IC", "秩相关"],
  scGraderExcess: ["mean excess vs SPY", "相对SPY平均超额"],

  /* Basket compare */
  scCompareTitle: ["Compare themes", "比较主题"],
  scCompareChoose: ["Choose a theme", "选择主题"],
  scCompareA: ["First basket", "第一个组合"],
  scCompareB: ["Second basket", "第二个组合"],
  scCompareRs21: ["21 sessions vs SPY", "21个交易日相对 SPY"],
  scCompareRs63: ["63 sessions vs SPY", "63个交易日相对 SPY"],
  scCompareCount: ["Members", "成分股"],
  scCompareCoverage: ["Price coverage", "价格覆盖率"],
  scCompareStale: ["Stale members", "价格滞后的成分股"],
  scCompareMore: ["Method", "计算方法"],
  scCompareBasis: ["Each column is an equal-weight basket, not its proxy ETF. Returns compare the same closing date with SPY. A dash means no comparable reading.", "每列为等权组合，并非其代理 ETF。收益相对同一收盘日的 SPY 计算。破折号表示没有可比数据。"],

  /* Mobile sheets */
  scSeriesSheetTitle: ["Series", "序列"],
  scSeriesSheetApply: ["Apply", "应用"],
  scSeriesSheetCancel: ["Cancel", "取消"],
  scSeriesSheetClear: ["Clear", "清除"],
  scLegSheetFullscreen: ["Open fullscreen", "打开全屏"],
  scCloseFullscreen: ["Close fullscreen", "关闭全屏"],
  scFullscreen: ["Cycles fullscreen", "周期全屏"],

  /* R5 conformance (Paper R5 · Full Cycles depth / Contextual states) */
  scSeriesCount: ["Series ({n})", "序列（{n}）"],
  scChangeSeries: ["Change series", "更换序列"],
  scFullscreenButton: ["Full screen", "全屏"],
  scTurnEstimate: ["Turn estimate & priors", "拐点估计与先验"],
  scModeReconstructed: ["reconstructed price history", "重构价格历史"],
  scOfflineBanner: ["You're offline — showing the last loaded Cycles view.", "设备离线 — 显示最近载入的周期视图。"],
  scIncompatibleLegacy: ["Cycles snapshot from a different generation — overlay refused across builds; showing the last compatible core.", "周期快照来自另一个生成版本 — 拒绝跨版本叠加；显示最近兼容的核心视图。"],
  scLocked: ["Cycles evidence is locked at your access level", "当前访问等级未解锁周期证据"],
  scPhaseFilterAll: ["All phases", "全部阶段"],
  scSelectedSeries: ["Selected", "已选"],
  scBasisRule: ["Comparison series must share the selected series' basis.", "对比序列须与已选序列口径一致。"],

  /* Footer */
  scFooter: ["Descriptive evidence. No stock recommendation, sizing or execution authority.", "描述性证据，不构成个股建议、仓位建议或执行授权。"],
  scFootnotePattern: ["Display-only context, never a signal.", "仅供展示，绝非信号。"],
  scLanesDisclaimer: ["Lanes rank evidence for research. They are not advice and carry no position size.", "分组按证据排序，供研究参考；不构成建议，也不涉及仓位。"],

  /* Phases (SC_FACE PHASES + PHASE_CHIP short labels) */
  scPhaseTrough: ["Bottoming", "筑底中"],
  scPhaseRecovery: ["Prime entry", "入场良机"],
  scPhaseExpansion: ["Trending", "上行中"],
  scPhasePeak: ["Topping · late", "见顶 · 晚期"],
  scPhaseDownturn: ["Rolling over", "回落中"],
  scPhaseTroughFull: ["Trough", "底部"],
  scPhaseRecoveryFull: ["Recovery", "复苏"],
  scPhaseExpansionFull: ["Expansion", "扩张"],
  scPhasePeakFull: ["Peak", "顶部"],
  scPhaseDownturnFull: ["Downturn", "下行"],

  /* Navigation */
  scOpenDossier: ["Open sector dossier", "查看板块档案"],
  scBackToCycles: ["Back to Cycles", "返回周期"],
  scMembers: ["View constituent evidence", "查看成分股证据"],
  scShowing: ["Showing", "显示"],
  scOf: ["of", "共"],
  scPoints: ["observations", "个观测值"],
  scPrevious: ["Previous values", "上一页数值"],
  scNext: ["Next values", "下一页数值"],
  scShortHistoryChip: ["Short history", "价格历史不足"],
};

export function sectorCyclePair(key: string): [string, string] | undefined {
  return SECTOR_CYCLE_LEX[key];
}

export function useSectorCycleT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const pair = SECTOR_CYCLE_LEX[key];
      let out = pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key);
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          out = out.split(`{${name}}`).join(String(value));
        }
      }
      return out;
    },
    [lang, sharedT],
  );
}
