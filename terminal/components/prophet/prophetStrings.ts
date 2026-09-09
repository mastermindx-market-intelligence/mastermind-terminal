/**
 * prophetStrings.ts — bilingual EN/ZH string table for the Prophet Desk surface.
 *
 * Pattern matches flowdeskStrings.ts / gexStrings.ts: each key maps to [English, 中文].
 *
 * HONESTY DOCTRINE (non-negotiable):
 *   - Management confidence is a TRADE-STATE score, not a pick rank.
 *   - Ceiling 92 — uncertainty is honest; certainty is forbidden.
 *   - No "validated", "predictive", or directional claim language.
 *   - Thesis lines carry "machine-generated from engine fields" caption.
 *   - Cadence chip: "nightly EOD — updates after close".
 *   - Authority chip: "display-only — forward ledger accruing".
 *
 * NOTE: translated strings MUST NOT appear in HTML title= attributes (CI-guarded).
 * Use aria-label or visible text spans instead.
 */

import type { Lang } from "@/lib/i18n";

const PROPHET_LEX = {
  // ── Tab / surface header ───────────────────────────────────────────────────
  tabProphet:       ["Prophet", "预言台"],
  tabSubtitle:      ["Managed-pick desk", "主动选股台"],
  laneMacro:        ["Macro Plans", "宏观计划"],
  laneOptions:      ["Options Alpha", "期权阿尔法"],
  laneIssueDesk:    ["Issue Desk", "发布台"],
  laneIssueDeskCaption: ["operator reviewed", "人工审核"],
  laneNavAria:      ["Prophet signal lanes", "预言台信号分区"],
  // Reworded (D3 honesty pass): "Managed signal intelligence" implied options provenance
  // this desk does not have. The eyebrow now states what it is and how often it moves.
  mastheadEyebrow:  ["Signal desk · nightly EOD", "信号台 · 每日收盘"],
  mastheadActive:   ["Active plans", "活跃计划"],
  mastheadFocus:    ["In focus", "当前焦点"],
  mastheadUpdated:  ["Model close", "模型收盘"],
  mastheadMarks:    ["Option marks", "期权报价"],
  mastheadMarksLive:["Live", "实时"],

  // ── Provenance (D3 honesty pass) ───────────────────────────────────────────
  // The desk is mounted in the Options Hub but the signals come from the stock factor
  // engine. Saying so is the whole point of this line — never soften it.
  provenanceLine: [
    "Source: Mastermind factor engine — nightly EOD standouts. Options shown as context overlays, not signal input.",
    "来源：Mastermind 因子引擎 — 每日收盘精选。期权仅为背景叠加信息，不参与信号生成。",
  ],
  provSource:       ["Mastermind factor engine", "Mastermind 因子引擎"],
  provCadence:      ["nightly EOD", "每日收盘"],
  provAuthority:    ["display only", "仅供展示"],
  tagDisplayOnly:   ["Display only", "仅供展示"],

  // ── Cadence / authority chips ──────────────────────────────────────────────
  cadenceLabel:     ["nightly EOD — updates after close", "每日收盘后更新"],
  authorityLabel:   ["display-only — forward ledger accruing", "仅供展示 — 前向账本积累中"],

  // ── Contract structure receipt (OEU T-E) ───────────────────────────────────
  // The receipt answers the three questions a reader has about a NAMED contract: what the
  // spread costs, whether anyone else is in the strike, and whether the option is dear for
  // THIS name. macro (lib/options_context.structure_receipt) ships the plain word and the
  // Tier-2 sentence pre-translated; only this chrome is local.
  structTitle:      ["Contract structure", "合约结构"],
  structAria:       ["Option contract structure receipt", "期权合约结构说明"],
  // Stated on the chip, because a spread and an OI count read as live numbers otherwise.
  structVintage:    ["at the close", "收盘时"],
  structYoung:      ["short IV history", "IV 历史较短"],
  // Absent-safe: a plan whose build predates the receipt, or a contract macro could not
  // price. Silence would leave the reader assuming the contract is fine to trade.
  structAbsent: [
    "Contract structure not published for this plan.",
    "该计划未发布合约结构数据。",
  ],

  // ── Sub-tabs ───────────────────────────────────────────────────────────────
  tabSignals:       ["Signals", "信号"],
  tabPerf:          ["PERF", "绩效"],

  // ── Signal stream ──────────────────────────────────────────────────────────
  signalStreamTitle:["Signal Stream", "信号流"],
  noPlans:          ["No active prophecies — ledger accruing.", "暂无活跃预测 — 账本积累中。"],
  // An empty desk must say WHICH empty it is: the run happened and published nothing,
  // rather than "still loading" or "broken".
  noPlansWhy: [
    "The nightly EOD run published no active plans. The forward ledger keeps accruing.",
    "每日收盘运行未发布活跃计划。前向账本持续积累。",
  ],
  sortNew:          ["NEW", "最新"],
  sortBest:         ["BEST", "最优"],
  sortGainers:      ["GAINERS", "涨幅"],
  daysActive:       ["d active", "天活跃"],
  entryLabel:       ["Entry", "入场价"],
  // Suffix label on the live P&L % — "vs plan" states the figure is measured against
  // the plan's entry, never realized (honesty doctrine).
  vsPlan:           ["vs plan", "较计划"],
  phase:            ["Phase", "阶段"],
  t1Progress:       ["→ T1", "→ T1"],
  minHold:          ["min hold", "最短持有"],
  locked:           ["LOCKED", "锁定中"],
  eligible:         ["ELIGIBLE", "可退出"],
  hold:             ["HOLD", "持有"],

  // ── Direction badges ───────────────────────────────────────────────────────
  bull:             ["BULL", "做多"],
  bear:             ["BEAR", "做空"],

  // ── Lifecycle phases (7-phase) ────────────────────────────────────────────
  // Display vocabulary ONLY. The wire enum (pre_trigger … overtime … invalidated) is
  // the producer's and never changes here — these keys are what the reader sees.
  phasePretrigger:  ["Pre-Trigger", "触发前"],
  phaseTriggered:   ["Triggered", "已触发"],
  phaseAtT1:        ["At T1", "T1位"],
  phaseBetweenT1T2: ["T1→T2", "T1→T2"],
  phaseAtT2:        ["At T2", "T2位"],
  // `overtime` does NOT mean a live plan that simply ran past its holding period —
  // that reading is what "Overtime" shipped, and it is wrong. Under Prophet's closure
  // contract the reachable open state is the stale / no-closing-print case, so the
  // label names the WINDOW, not a running clock (macro Q2 vocabulary ruling).
  phaseOvertime:    ["Window Elapsed", "窗口已到期"],
  phaseInvalidated: ["Invalidated", "已失效"],
  // The one phase whose label alone still understates it: "Window Elapsed" reads as
  // "ran long" unless the price-frame half is said out loud. Rides as the chip's
  // accessible name — never a title= (CI-guarded; see the file header).
  //
  // It states the STATE and stops there. That the row also instructs no action is a
  // consequence the reader sees rendered — an absent action chip — and deliberately
  // not a claim made here, so this sentence stays true of every overtime row whatever
  // the safety contract publishes alongside it.
  phaseOvertimeWhy: [
    "The declared plan window elapsed. The close or current price frame is unavailable or awaiting reconciliation.",
    "计划声明的窗口已到期。收盘或现价数据帧不可用或尚待对账。",
  ],

  // ── Geometry ladder ────────────────────────────────────────────────────────
  geometryTitle:    ["Trade Geometry", "交易结构"],
  stop:             ["STOP", "止损"],
  entry:            ["ENTRY", "入场"],
  last:             ["LAST", "现价"],
  t1:               ["T1", "T1"],
  t2:               ["T2", "T2"],
  rUnit:            ["R", "R"],
  distAway:         ["away", "距离"],
  horizonPct:       ["horizon used", "持有进度"],
  geometryEmpty:    ["Insufficient geometry data", "结构数据不足"],
  geometryEmptyWhy: [
    "Entry, stop and at least one target are required to draw the ladder.",
    "绘制价格阶梯需要入场价、止损价和至少一个目标价。",
  ],
  ladderCaption: [
    "Plan levels on one price axis. R is the entry-to-stop distance.",
    "同一价格轴上的计划价位。R 为入场价至止损价的距离。",
  ],
  // Wide-geometry display guard (D3 fix_spec 1). {r} = R in dollars, {pct} = R as % of entry.
  wideGeomTag:      ["Wide geometry", "结构过宽"],
  wideGeomBody: [
    "Targets are projected from a structural base-low stop (R = {r}, {pct}% of entry). Treat T1/T2 as geometry, not forecasts.",
    "目标价由结构性低点止损推算得出（R = {r}，为入场价的 {pct}%）。请将 T1/T2 视为几何推算，而非预测。",
  ],
  // Live payloads carry no last_price — say so rather than letting plan levels read as current.
  noLastNote: [
    "No intraday price in this payload — entry, stop and targets are plan levels, marked nightly.",
    "此数据包不含盘中价格 — 入场、止损与目标均为计划价位，按每日收盘更新。",
  ],

  // ── Confidence panel ────────────────────────────────────────────────────────
  confidenceHeader:    ["Management confidence — trade state, not a pick rank", "管理置信度 — 交易状态分，非选股排名"],
  confidenceCeil:      ["Ceiling: 92", "上限：92"],
  confidenceCeilNote:  ["Uncertainty is honest; certainty is forbidden.", "不确定性是诚实的；确定性是被禁止的。"],
  componentValidity:   ["Validity", "有效性"],
  componentProgress:   ["Progress", "进展"],
  componentPace:       ["Pace", "节奏"],
  componentRetention:  ["Retention", "价格保留"],
  componentOverlay:    ["Overlay", "市场叠加"],
  componentTooltipValidity:  [
    "Thesis validity: has the invalidation level been breached?",
    "论点有效性：止损位是否被突破？",
  ],
  componentTooltipProgress:  [
    "Progress toward T1: how far along the trade path?",
    "T1进展：距目标还有多远？",
  ],
  componentTooltipPace:      [
    "Pace vs expected: is the trade moving at the expected rate?",
    "节奏对比预期：交易速度是否符合预期？",
  ],
  componentTooltipRetention: [
    "Price retention: is the trade holding its gains?",
    "价格保留：交易是否保住盈利？",
  ],
  componentTooltipOverlay:   [
    "Market overlay: macro/sector alignment with this trade.",
    "市场叠加：宏观/行业与该交易的一致性。",
  ],
  changeReasonLabel:   ["Change reason", "变化原因"],
  actionLabel:         ["Recommended action", "建议操作"],

  // ── Recommended actions (enum) ────────────────────────────────────────────
  actionWait:       ["Wait", "等待"],
  actionEnter:      ["Enter", "入场"],
  actionHold:       ["Hold", "持有"],
  actionTrim:       ["Trim", "减仓"],
  actionTrail:      ["Trail stop", "移动止损"],
  actionExit:       ["Exit", "退出"],
  actionInvalidated:["Invalidated", "已失效"],

  // ── Option sub-card ────────────────────────────────────────────────────────
  optionCardTitle:  ["Oracle Option", "期权方案"],
  optionType:       ["Type", "类型"],
  optionStrike:     ["Strike", "行权价"],
  optionExpiry:     ["Expiry", "到期日"],
  optionPremEntry:  ["Entry prem.", "入场权利金"],
  optionEodMark:    ["EOD mark", "收盘标记"],
  optionLiveQuote:  ["Intraday live quote", "盘中实时报价"],
  optionLiveTip:    ["Intraday mid-price — updated within 20 min", "盘中实时中间价 — 20分钟内更新"],
  optionEodTip:     ["End-of-day mark — not a live quote", "收盘标记 — 不是实时报价"],
  optionCall:       ["CALL", "认购"],
  optionPut:        ["PUT", "认沽"],
  optionExpand:     ["Show option contract", "显示期权合约"],
  optionCollapse:   ["Hide option contract", "隐藏期权合约"],
  // The contract is a suggested overlay on a stock signal — it never generated the signal.
  optionOverlayTag: ["Overlay — not signal input", "叠加信息 — 非信号来源"],

  // ── Analysis center / thesis ──────────────────────────────────────────────
  thesisLabel:      ["Signal Thesis", "信号论点"],
  thesisCaption:    ["Machine-generated from engine fields — display only", "由引擎字段自动生成 — 仅供展示"],
  // The dealer-positioning sentence is context appended by the options overlay, not a
  // driver of the signal — it is lifted out of the prose so it cannot read as one.
  positioningLabel: ["Dealer positioning — context overlay", "做市商持仓 — 背景叠加"],
  briefLabel:       ["What To Do Now", "当前操作建议"],
  briefCaption:     ["Phase-keyed action guide — display only", "阶段动作指南 — 仅供展示"],
  profitPlanLabel:  ["Profit Taking Plan", "利润获取计划"],
  profitPlanCaption:["Exit levels from engine geometry — display only", "引擎几何计算的退出位 — 仅供展示"],
  profitStatusActive:["ACTIVE", "进行中"],
  profitStatusPending:["PENDING", "待定"],
  profitStatusDone: ["DONE", "完成"],
  profitColLevel:   ["Level", "价位"],
  profitColAction:  ["Action", "操作"],
  profitColStatus:  ["Status", "状态"],
  rrLabel:          ["R/R at Entry", "入场风险收益比"],
  rrRisk:           ["Risk", "风险"],
  rrReward:         ["Reward (T1)", "收益(T1)"],
  rrRiskTile:       ["Risk to stop", "至止损风险"],
  rrRewardTile:     ["Reward to T1", "至 T1 收益"],
  horizonMeter:     ["Horizon used", "持有进度"],
  analysisTitle:    ["Analysis", "分析"],
  confidenceTitle:  ["Confidence Index", "置信度指标"],
  confidenceEyebrow:["Confidence", "置信度"],
  // Dossier meta line + per-plan provenance row.
  dossierSignalOn:  ["Signal", "信号日"],
  dossierConviction:["Conviction", "信心分"],
  // Component surfaces are honest about absence — the live payload publishes neither.
  verdictNoScore: [
    "No management score in this payload.",
    "此数据包未提供管理评分。",
  ],
  componentMixLabel:  ["Component mix", "分项构成"],
  componentMixCaption:[
    "Segment width is each component's share of the five component scores.",
    "分段宽度为各分项占五项分数之和的比重。",
  ],
  componentsAbsent: [
    "Component scores are not published in this payload — only the headline score is.",
    "此数据包未发布分项评分 — 仅提供总分。",
  ],

  // ── PERF sub-tab placeholder ───────────────────────────────────────────────
  perfPlaceholderTitle:  ["Outcome Ledger", "结果账本"],
  perfPlaceholderBody:   [
    "Outcome ledger accruing — performance will appear here once the forward ledger has sufficient closed trades.",
    "结果账本积累中 — 前向账本积累足够的已平仓交易后，绩效数据将在此显示。",
  ],

  // ── Options Alpha shadow lane ─────────────────────────────────────────────
  optionsAlphaEyebrow: ["Options-originated research · shadow", "期权原生研究 · 影子模式"],
  optionsAlphaTitle: ["Options Alpha", "期权阿尔法"],
  optionsAlphaSource: ["Options-derived candidate desk", "期权衍生候选台"],
  optionsAlphaAuthority: ["Display only · no trading authority", "仅供展示 · 无交易权限"],
  optionsAlphaProvenance: [
    "Origin: options flow and positioning evidence. Kept separate from Macro Plans while the forward ledger accrues.",
    "来源：期权流与持仓证据。在前向账本积累期间，与宏观计划保持分离。",
  ],
  optionsTrueFires: ["True fires", "真实触发"],
  optionsWatchlist: ["Watchlist", "观察名单"],
  optionsAsOf: ["Evidence close", "证据收盘"],
  optionsAvailableAt: ["Available at · exact UTC", "可用时间 · 精确 UTC"],
  optionsDecisionAt: ["Decision at · exact UTC", "决策时间 · 精确 UTC"],
  optionsClockUnavailable: ["Not published", "未发布"],
  optionsShadow: ["Shadow", "影子"],
  optionsFireTag: ["Options-originated fire", "期权原生触发"],
  optionsWatchTag: ["Watchlist · not a signal", "观察名单 · 非信号"],
  optionsNoFires: [
    "Abstention is a valid result. No true options fire—and no portfolio position—was issued in this run.",
    "允许本次无触发。本次没有真实期权触发，也没有发布任何投资组合持仓。",
  ],
  optionsNoWatchlist: ["No watchlist candidates published.", "未发布观察名单候选。"],
  optionsReadiness: ["Research readiness", "研究就绪度"],
  optionsInformation: ["Information", "信息"],
  optionsPositioning: ["Positioning", "持仓结构"],
  optionsExecution: ["Execution", "执行"],
  optionsInfoNote: ["Flow-leader evidence and source alignment", "资金流领先证据与来源一致性"],
  optionsPositioningNote: [
    "Dealer gamma regime and source-signing context; neither grants direction",
    "做市商伽马环境与来源方向判定背景；两者均不授予方向信号",
  ],
  optionsExecutionNote: ["Prospective picks, outcomes and calibration", "前向候选、结果与校准"],
  optionsPortfolioBoundary: ["Research fire · not an issued position", "研究触发 · 非已发布持仓"],
  optionsPortfolioBoundaryBody: [
    "Wave 0 publishes governed research fires only. They are neither operator-issued nor automatic portfolio positions; no Issue Desk or model-portfolio engine exists here.",
    "Wave 0 仅发布受治理的研究触发。它们既非人工审核后发布，也非自动投资组合持仓；此处没有发布台或模型投资组合引擎。",
  ],
  optionsAbstentionFirst: ["Abstention first", "优先允许无触发"],
  optionsAbstentionBody: [
    "The projection may publish zero fires and never hides extra research fires to simulate a future 3–4 position policy.",
    "本投影可以发布零个触发，也不会隐藏额外研究触发来模拟未来的 3–4 个持仓策略。",
  ],
  optionsFutureBatch: ["Future target batch", "未来目标批次"],
  optionsCapacityBreach: [
    "Research-fire count exceeds the future target; no rows were hidden.",
    "研究触发数量超过未来目标；未隐藏任何条目。",
  ],
  optionsStatusReady: ["Ready", "就绪"],
  optionsStatusMeasured: ["Measured", "已测量"],
  optionsStatusBuilding: ["Building history", "积累历史中"],
  optionsStatusBlocked: ["Blocked", "受阻"],
  optionsStatusUnavailable: ["Not available", "不可用"],
  optionsStatusPending: ["Pending", "待定"],
  optionsStatusShadow: ["Shadow only", "仅影子模式"],
  optionsEvidence: ["Evidence", "证据"],
  optionsRecurrence: ["Recurrence", "重复出现"],
  optionsFlowZ: ["Flow z", "资金流 z 值"],
  optionsFlowMagnitudeOnly: ["Flow z · magnitude only", "资金流 z · 仅强度"],
  optionsFlowMagnitudeNote: [
    "Source signing has not passed reliability. Flow z is magnitude context, not direction.",
    "来源方向判定尚未通过可靠性门槛。资金流 z 仅表示强度背景，不代表方向。",
  ],
  optionsFireSigningNote: [
    "Source signing has not passed reliability; opportunity direction remains withheld.",
    "来源方向判定尚未通过可靠性门槛；机会方向继续暂不发布。",
  ],
  optionsNormPremium: ["Norm. premium", "标准化权利金"],
  optionsOi: ["OI confirmation", "未平仓确认"],
  optionsOiYes: ["Confirmed", "已确认"],
  optionsOiNo: ["Not confirmed", "未确认"],
  optionsOiPending: ["Pending", "待定"],
  optionsGamma: ["Gamma regime", "伽马环境"],
  optionsGammaPositive: ["Positive", "正伽马"],
  optionsGammaNegative: ["Negative", "负伽马"],
  optionsGammaNeutral: ["Neutral", "中性"],
  optionsGammaLong: ["Long gamma", "长伽马"],
  optionsGammaShort: ["Short gamma", "短伽马"],
  optionsInflectionAge: ["Inflection age", "拐点距今"],
  optionsDays: ["d", "天"],
  optionsSigning: ["Signing source", "方向判定来源"],
  optionsSigningReliability: ["Source-signing reliability", "来源方向判定可靠性"],
  optionsSigningReliable: ["Reliable source", "来源可靠"],
  optionsSigningUnreliable: ["Not reliable · magnitude only", "未通过 · 仅看强度"],
  optionsSigningPending: ["Not published", "未发布"],
  optionsSigningMixed: ["Bar + tape mixed", "价格柱与逐笔混合"],
  optionsSigningTape: ["Tape only", "仅逐笔数据"],
  optionsSigningBar: ["Bar only", "仅价格柱数据"],
  optionsSigningMinuteTick: ["Minute tick", "分钟级成交"],
  optionsSigningMinuteBar: ["Minute bar", "分钟价格柱"],
  optionsDirectionSoft: ["Direction withheld", "方向暂不发布"],
  optionsDirectionReason: ["Direction is not yet reliable enough to publish.", "方向可靠性尚不足，暂不发布。"],
  optionsForward: ["Forward ledger", "前向账本"],
  optionsBook: ["Book", "账本"],
  optionsFires: ["Fires", "触发"],
  optionsOpen: ["Open", "进行中"],
  optionsH5: ["5d graded", "5日已评分"],
  optionsH21: ["21d graded", "21日已评分"],
  optionsNoLedger: ["No forward-ledger books published.", "未发布前向账本。"],
  optionsAttributionUnavailable: ["Incremental options attribution unavailable", "期权增量归因暂不可用"],
  optionsAttributionReason: [
    "Matched Macro-versus-options attribution is still accruing.",
    "宏观与期权匹配归因样本仍在积累中。",
  ],
  optionsMacroFeedback: ["Macro feedback", "宏观反馈"],
  optionsFeedbackOff: ["Off", "关闭"],
  optionsWeight: ["Weight", "权重"],
  optionsTrajectory: ["Trajectory", "轨迹"],
  optionsTrajectoryWithheld: ["Withheld until calibrated", "校准完成前暂不发布"],
  optionsTrajectoryReason: [
    "Take-profit timing and exit windows are withheld until forward calibration is sufficient.",
    "在前向校准样本充足前，暂不发布止盈时点与退出窗口。",
  ],
  optionsExecutionWithheld: ["Execution withheld", "执行信息暂不发布"],
  optionsExecutionBody: [
    "No executable OCC contract, quote or fill, stop, target, or take-profit lifecycle is attached.",
    "未附带可执行 OCC 合约、报价或成交、止损、目标或止盈生命周期。",
  ],
  optionsContractStrikeExpiry: ["Contract / strike / expiry", "合约 / 行权价 / 到期日"],
  optionsEntryReceipt: ["Entry / quote", "入场 / 报价"],
  optionsTargets: ["Targets", "目标"],
  optionsTakeProfitManagement: ["TP management", "止盈管理"],
  optionsWithheldValue: ["Withheld · null", "暂不发布 · 空值"],
  optionsResearchQueue: ["Research queue", "研究队列"],
  optionsResearchQueueSummary: [
    "Broad source-ordered context · collapsed by default",
    "广泛的来源排序背景 · 默认折叠",
  ],
  optionsAccrual: ["Prospective accrual", "前向积累"],
  optionsEventAccrual: ["Immutable fire events", "不可变触发事件"],
  optionsOutcomeAccrual: ["Outcomes · separate ledger", "结果 · 独立账本"],
  optionsOutcomes: ["Graded outcomes", "已评分结果"],
  optionsPublishedNow: ["Published now", "当前发布"],
  optionsExactDecisionCoverage: ["Exact decisions", "精确决策时间"],
  optionsExactAvailableCoverage: ["Exact availability", "精确可用时间"],
  optionsDistinctDates: ["Book-date total", "账本日期合计"],
  optionsNotInstrumented: ["Not instrumented", "尚未接入"],
  optionsDescriptiveOnly: ["Descriptive only", "仅描述性"],
  optionsPitExact: ["PIT exact", "PIT 精确"],
  optionsPitLegacy: ["Legacy clocks", "历史时钟"],
  optionsAccrualSeparateNote: [
    "Event counts answer how many immutable fires exist. Horizon cells separately show how many outcomes can be graded.",
    "事件计数表示不可变触发的数量；各期限单元格另行显示可评分结果数量。",
  ],
  optionsKonseki: ["Konseki Market Memory", "Konseki 市场记忆"],
  optionsKonsekiContextOnly: ["Context only · weight 0", "仅作背景 · 权重 0"],
  optionsKonsekiConnected: ["Governed receipt connected", "已连接受治理凭据"],
  optionsKonsekiDisconnected: ["No governed receipt connected", "未连接受治理凭据"],
  optionsKonsekiBody: [
    "Market Memory may annotate context only. It cannot rank, gate, size, or originate a fire.",
    "市场记忆仅可添加背景说明，不能排名、设门槛、调整仓位或生成触发。",
  ],
  optionsMemoryReceipt: ["Memory receipt", "记忆凭据"],
  optionsDeescalated: ["De-escalated", "已降级"],
  optionsEarningsWindow: ["Earnings window", "财报窗口"],
  optionsVolTrade: ["Volatility trade", "波动率交易"],
  optionsProtectivePut: ["Protective put", "保护性认沽"],
  optionsGammaCaution: ["Gamma caution", "伽马风险提示"],
  optionsSourceRank: ["Source rank", "来源排名"],
  optionsSourcePositions: ["Source positions", "来源位置"],
  optionsLane: ["Lane", "分区"],
  optionsLaneFlowLeader: ["Flow Leader", "资金流领先"],
  optionsLaneFlowWashout: ["Flow Washout", "资金流洗盘"],
  optionsLaneBoardA: ["Board A", "A 榜"],
  optionsLaneBoardB: ["Board B", "B 榜"],
  optionsMethod: ["Method", "方法"],
  optionsMethodFallback: [
    "Prospective options evidence; display-only while forward outcomes accrue.",
    "前瞻期权证据；前向结果积累期间仅供展示。",
  ],
  optionsFireEvidenceFallback: [
    "Published fire-rule evidence. Source detail remains in Flow Leaders.",
    "已发布触发规则证据。来源详情保留在资金流领先面板中。",
  ],
  optionsShowing: ["Showing {shown} of {total}", "显示 {shown} / {total}"],
  optionsReferenceClose: ["Reference close", "参考收盘价"],
  optionsStaleTitle: ["Cached or aged evidence", "缓存或过期资料"],
  optionsStaleBody: [
    "The server may be refreshing a cached artifact, or its exact availability is beyond the freshness window. Treat every row as stale research context.",
    "服务器可能正在刷新缓存数据，或其精确可用时间已超过新鲜度窗口。所有条目均应视为过期资料背景。",
  ],
  optionsLoadError: ["Could not load Options Alpha data.", "无法加载期权阿尔法数据。"],

  // ── Loading / error states ─────────────────────────────────────────────────
  loading:    ["Loading…", "加载中…"],
  error:      ["Could not load prophet data.", "无法加载预言台数据。"],
  retry:      ["Retry", "重试"],
  asOf:       ["as of", "更新于"],
} as const;

type ProphetKey = keyof typeof PROPHET_LEX;

export function getProphetStr(lang: Lang, key: ProphetKey): string {
  const entry = PROPHET_LEX[key];
  if (!entry) return "";
  return lang === "zh" ? entry[1] : entry[0];
}

export function makeProphetT(lang: Lang): (key: ProphetKey) => string {
  return (key: ProphetKey) => getProphetStr(lang, key);
}

/**
 * Explanatory copy for a lifecycle phase, or null when the label speaks for itself.
 *
 * Shared by all three surfaces that draw a phase chip — the stream card, the analysis
 * header, the confidence panel — for the same reason phaseTone() is shared: one state
 * must not be explained three ways. Keyed on the WIRE enum, so the internal value is
 * what routes here and only the returned sentence is vocabulary.
 */
export function phaseWhy(lang: Lang, phase: string | null | undefined): string | null {
  if (phase === "overtime") return getProphetStr(lang, "phaseOvertimeWhy");
  return null;
}

export type { ProphetKey };
