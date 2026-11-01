/**
 * volStrings.ts — bilingual EN/ZH string table for the Volatility tab.
 *
 * Pattern matches gexStrings.ts: each key maps to [English, 中文].
 *
 * HONESTY DOCTRINE (enforced here):
 *   - The options_hub.vol store is NIGHTLY EOD — no "LIVE" language anywhere;
 *     the asof chip is the only freshness truth.
 *   - Vol is NON-DIRECTIONAL: no bullish/bearish copy, no signal language.
 *   - Structure labels (Contango / Inverted) are descriptive term-structure
 *     geometry, never a forecast.
 *
 * NOTE: translated strings MUST NOT appear in HTML title= attributes
 * (CI-guarded). Use aria-label or the components/ui/Tip primitive instead.
 */

import type { Lang } from "@/lib/i18n";

const VOL_LEX = {
  // ── Header / controls ──────────────────────────────────────────────────────
  tickerInputLabel:  ["Ticker", "代码"],
  tickerPlaceholder: ["SPY", "SPY"],
  // Freshness chip — the ONE truth about cadence on this surface.
  asofChip:          ["Nightly EOD · as of {date}", "每晚收盘 · 更新于 {date}"],
  asofStaleAge:      ["{n} sessions old", "{n} 个交易日前"],
  loading:           ["Loading volatility data…", "加载波动率数据中…"],
  errorLoad:         ["Could not load volatility data", "无法加载波动率数据"],
  errorWhy: [
    "The volatility store could not be read just now. This is a failed read, not a missing snapshot.",
    "暂时无法读取波动率数据。这是读取失败，并非缺少快照。",
  ],
  // Re-reads in place: a failed read is retried here, never by reloading the page.
  retry:             ["Retry", "重试"],
  // Honest empty — a missing single name is a nightly-coverage gap, not a broken tab.
  emptyTitle:        ["No volatility snapshot for this name yet", "该品种暂无波动率快照"],
  emptyWhy: [
    "{sym} isn't in this nightly build — index anchors and the most liquid single names publish first.",
    "本次夜间构建中没有 {sym} — 指数锚定品种与流动性最高的个股优先发布。",
  ],
  // Per-panel provenance footer (store name stays literal; cadence translates).
  provenance:        ["options_hub · nightly EOD", "options_hub · 每晚收盘数据"],

  // ── Panel A — stat tiles ───────────────────────────────────────────────────
  statsTitle:        ["Volatility snapshot", "波动率概览"],
  statAtmIv:         ["Headline ATM IV", "报告平值IV"],
  statAtmIvCaption:  ["tenor not supplied", "未提供期限"],
  statIvRank252:     ["IV Rank 252d", "IV百分位 252日"],
  statIvRankAll:     ["IV Rank all-history", "IV百分位 全历史"],
  statSinceCaption:  ["since {date} · {n}d", "自 {date} · {n}日"],
  stat52wRange:      ["52-week IV range", "52周IV区间"],
  statRv20:          ["RV20", "RV20"],
  statRv20Caption:   ["20d realized vol", "20日已实现波动率"],
  statVrp:           ["Reported IV − RV20", "报告IV − RV20"],
  statVrpCaption:    ["source-reported spread", "来源报告差值"],
  statRangeAria:     ["Current ATM IV position inside the 52-week range", "当前平值IV在52周区间中的位置"],

  // ── Panel B — ATM IV history ───────────────────────────────────────────────
  histTitle:         ["ATM IV history", "平值IV历史"],
  // Coverage is disclosed from the data (the old title asserted "90-day" over
  // whatever history[] actually held).
  histCoverage:      ["{n} sessions · since {d} through {last}", "{n} 个交易日 · 自 {d} 至 {last}"],
  histConflictCount: ["Partial IV history · {n} conflicting date unavailable", "IV历史不完整 · {n} 个冲突日期不可用"],
  histEmptyTitle:    ["Not enough IV history to draw yet", "IV历史数据不足，暂无法绘制"],
  histEmptyWhy: [
    "The history line needs at least 10 sessions of ATM IV.",
    "历史曲线需要至少 10 个交易日的平值IV数据。",
  ],
  hist52wHi:         ["52w hi", "52周高"],
  hist52wLo:         ["52w lo", "52周低"],
  histAria:          ["ATM implied volatility across recent sessions", "近期交易日的平值隐含波动率"],

  // ── Panel C — term structure ───────────────────────────────────────────────
  termTitle:         ["Term structure", "期限结构"],
  termEmptyTitle:    ["No term structure for this name yet", "该品种暂无期限结构数据"],
  termEmptyWhy: [
    "The nightly build publishes per-expiration ATM IV only for covered names.",
    "夜间构建仅为已覆盖品种发布按到期日的平值IV。",
  ],
  termXAxis:         ["DTE", "到期天数"],
  termExpAria:       ["Expiry investigation", "到期日调查"],
  termExpControl:    ["Investigate expiry", "调查到期日"],
  termExpCount:      ["{n} supplied expiry rows", "已提供 {n} 个到期日行"],
  termExpUnavailable:["ATM IV unavailable", "平值IV不可用"],
  termConflictCount: ["Partial IV data · {n} conflicting expiry unavailable", "IV数据不完整 · {n} 个冲突到期日不可用"],
  termConflictAmbiguous: ["Term-curve lines withheld · {n} conflicting expiry has inconsistent DTE", "期限曲线连线暂不显示 · {n} 个冲突到期日的DTE不一致"],
  termUnplaceable:   ["Term-curve lines withheld · {n} supplied row has no valid days-to-expiry value", "期限曲线连线暂不显示 · {n} 个已提供行缺少有效的到期天数"],
  // A break is claimed only where the drawn curve actually breaks; other invalid-expiry rows are "excluded".
  termInvalidExpiryBreakOne: ["Curve breaks at 1 supplied row with an invalid expiry date", "曲线在 1 个到期日无效的已提供行处断开"],
  termInvalidExpiryBreak:    ["Curve breaks at {n} supplied rows with an invalid expiry date", "曲线在 {n} 个到期日无效的已提供行处断开"],
  termInvalidExpiryExcludedOne: ["1 supplied row with an invalid expiry date excluded", "1 个到期日无效的已提供行已排除"],
  termInvalidExpiryExcluded:    ["{n} supplied rows with an invalid expiry date excluded", "{n} 个到期日无效的已提供行已排除"],
  termExpSelectAria: ["Select {exp}, {dte} days, reported ATM IV {iv}%", "选择 {exp}，{dte} 天，报告平值IV {iv}%"],
  termExpMissingAria:["Select {exp}, {dte} days, ATM IV unavailable", "选择 {exp}，{dte} 天，平值IV不可用"],
  termContango:      ["Contango", "正向期限结构"],
  termInverted:      ["Inverted", "期限结构倒挂"],
  // Chip disclosure — states WHAT is compared, so the label can't read as a signal.
  termChipAria: [
    "Reported {frontDte}D ATM IV {front}% vs {farDte}D ATM IV {far}% — a source term-structure comparison, not a forecast.",
    "报告的{frontDte}天平值IV {front}% 对比{farDte}天平值IV {far}% — 仅为来源期限结构对比，并非预测。",
  ],

  // ── Panel D — smile / skew ─────────────────────────────────────────────────
  skewTitle:         ["Smile / skew", "微笑 / 偏斜"],
  skewEmptyTitle:    ["No smile data for this name yet", "该品种暂无微笑曲线数据"],
  skewEmptyWhy: [
    "The nightly build publishes per-strike IV only for the nearest expirations of covered names.",
    "夜间构建仅为已覆盖品种的近月到期发布按行权价的IV。",
  ],
  skewExpAria:       ["Smile expiration", "微笑曲线到期日"],
  skewCallLeg:       ["Call IV", "认购IV"],
  skewPutLeg:        ["Put IV", "认沽IV"],
  skewFullChain:     ["Full supplied range", "全部已提供范围"],
  skewTrimmedChip:   ["display window ±20% proxy", "显示窗口 ±20% 代理中心"],
  // Disclosure for the trim chip — deep-ITM wings carry garbage IV prints.
  skewTrimTip: [
    "This display window is centered on the supplied strike with the smallest call/put IV difference, not an observed underlying price. Full supplied range shows all supplied strikes. Neither mode certifies quote quality or full-chain coverage.",
    "显示窗口以已提供的认购/认沽IV差最小的行权价为中心，并非已观测标的价格。全部已提供范围展示已提供的行权价；两种模式均不证明报价质量或完整链覆盖。",
  ],
  skewStrikeAxis:    ["Strike", "行权价"],
  skewSelectedMissingTitle: ["No smile for the selected expiry", "所选到期日暂无微笑曲线"],
  skewSelectedMissingWhy: [
    "{exp} has no supplied per-strike IV series. Choose another supplied expiry; nothing is substituted.",
    "{exp} 未提供按行权价的IV序列。请选择另一个已提供的到期日；系统不会替换为邻近到期日。",
  ],
  skewConflictCount: ["Partial IV data · {n} conflicting strike unavailable", "IV数据不完整 · {n} 个冲突行权价不可用"],
  skewExpiryConflict: ["{exp} has conflicting expiry records", "{exp} 存在冲突的到期日记录"],
  skewSelectedConflictTitle: ["Smile unavailable · conflicting source records", "微笑曲线不可用 · 来源记录冲突"],
  skewSelectedConflictWhy: [
    "{exp} has conflicting expiry or strike records. No client-side winner is selected and no neighboring value is substituted.",
    "{exp} 存在冲突的到期日或行权价记录。客户端不会选择任一版本，也不会用邻近值替代。",
  ],

  // ── Shared expiry investigation context ───────────────────────────────────
  expiryContextLabel: ["Investigating expiry", "正在调查到期日"],
  expiryContextDte: ["{n} days", "{n} 天"],
  expiryContextAtm: ["reported ATM IV {v}%", "报告平值IV {v}%"],
  expiryContextAtmMissing: ["ATM IV unavailable", "平值IV不可用"],
  expiryContextAtmConflict: ["ATM IV unavailable · conflicting expiry records", "平值IV不可用 · 到期日记录冲突"],
  expiryContextSmile: ["smile supplied", "已提供微笑曲线"],
  expiryContextSmilePartial: ["smile partial · {n} conflicting strike unavailable", "微笑曲线不完整 · {n} 个冲突行权价不可用"],
  expiryContextSmileMissing: ["smile unavailable for this expiry", "该到期日微笑曲线不可用"],
  expiryContextSmileConflict: ["smile unavailable · conflicting records", "微笑曲线不可用 · 记录冲突"],

  // ── VRP regime panel (R2.3 — level + trend + velocity, regime-dynamics law) ──
  vrpTitle:          ["IV − realized-vol spread · history", "IV − 已实现波动率差值 · 历史"],
  vrpDerived:        ["historical band derived from published closes + nightly IV", "历史区间由已发布收盘价与每晚IV推导"],
  vrpNow:            ["Reported spread now", "当前报告差值"],
  vrpUnit:           ["source IV − trailing 20-return RV, vol pts", "来源IV − 过去20个收益率RV（波动点）"],
  vrpRegime:         ["Historical range", "历史区间"],
  vrpCompressed:     ["Lower range", "历史较低区间"],
  vrpNormal:         ["Middle range", "历史中间区间"],
  vrpElevated:       ["Upper range", "历史较高区间"],
  vrpUnknown:        ["Not enough history", "历史不足"],
  vrpUnaligned:      ["Withheld · sessions differ", "暂不显示 · 数据日期不一致"],
  vrpHistoryAligned: ["Derived history reaches the current source session · {date}", "推导历史已覆盖当前来源交易日 · {date}"],
  vrpHistoryMismatch: ["Derived history ends {history}; current source snapshot is {current}. Current range, trend and change are withheld.", "推导历史截至 {history}；当前来源快照为 {current}。当前区间、趋势和变化暂不显示。"],
  vrpHistoryThrough: ["Derived history through {date}; current source session unavailable for alignment.", "推导历史截至 {date}；当前来源交易日不可用，无法对齐。"],
  vrpWithheldCaption:["withheld until sessions align", "等待交易日对齐后显示"],
  vrpPctile:         ["{p}th pct of supplied 1y window", "已提供1年窗口第{p}百分位"],
  vrpTrend:          ["5-session trend", "5日趋势"],
  vrpTrendCaption:   ["vol pts", "波动点"],
  vrpVelocity:       ["1-session change", "1日变化"],
  vrpVelocityCaption:["vol pts", "波动点"],
  vrpEmptyTitle:     ["No IV − realized-vol spread history for this name", "该品种暂无IV − 已实现波动率差值历史"],
  vrpEmptyWhy: [
    "The historical band needs the aggregate-trend store (spot + IV per session); it has not been published for this root.",
    "历史区间需要聚合趋势数据（每日现价与IV）；该标的尚未发布。",
  ],
  vrpLoading:        ["Loading spread history…", "加载差值历史中…"],
  vrpErrorTitle:     ["Could not load the spread history", "无法加载差值历史"],
  vrpErrorWhy: [
    "The aggregate-trend store could not be read just now. This is a failed read, not a missing history.",
    "暂时无法读取聚合趋势数据。这是读取失败，并非缺少历史。",
  ],
  // "Partial" only when a rejected row lies inside the drawn window's source span.
  vrpOrderRejectedWindowOne: ["Partial spread history · 1 supplied row rejected for a duplicate or out-of-order date", "差值历史不完整 · 1 个已提供行因日期重复或顺序错乱被排除"],
  vrpOrderRejectedWindow:    ["Partial spread history · {n} supplied rows rejected for a duplicate or out-of-order date", "差值历史不完整 · {n} 个已提供行因日期重复或顺序错乱被排除"],
  vrpOrderRejectedOutsideOne: ["1 supplied row outside the displayed window rejected for a duplicate or out-of-order date", "显示区间之外有 1 个已提供行因日期重复或顺序错乱被排除"],
  vrpOrderRejectedOutside:    ["{n} supplied rows outside the displayed window rejected for a duplicate or out-of-order date", "显示区间之外有 {n} 个已提供行因日期重复或顺序错乱被排除"],
  vrpOrderRejectedOne: ["1 supplied row rejected for a duplicate or out-of-order date", "1 个已提供行因日期重复或顺序错乱被排除"],
  vrpOrderRejected:    ["{n} supplied rows rejected for a duplicate or out-of-order date", "{n} 个已提供行因日期重复或顺序错乱被排除"],
  vrpEmptyRejectedTitle: ["Supplied spread history could not be put in session order", "已提供的差值历史无法按交易日排序"],
  vrpEmptyWhyRejected: [
    "Aggregate-trend rows were supplied for this root, but {n} were rejected for duplicate or out-of-order dates, leaving too few sessions in an established order to derive the band.",
    "该标的已提供聚合趋势数据，但其中 {n} 行因日期重复或顺序错乱被排除，顺序确定的交易日不足以推导历史区间。",
  ],
  vrpEmptyWhyMalformedOne: [
    "Aggregate-trend rows were supplied for this root, but 1 supplied row has no valid session date, and fewer than {n} sessions have the dates, closes and IV needed to derive the band.",
    "该标的已提供聚合趋势数据，但其中 1 个已提供行没有有效的交易日日期，具备推导历史区间所需日期、收盘价与IV的交易日少于 {n} 个。",
  ],
  vrpEmptyWhyMalformed: [
    "Aggregate-trend rows were supplied for this root, but {m} supplied rows have no valid session date, and fewer than {n} sessions have the dates, closes and IV needed to derive the band.",
    "该标的已提供聚合趋势数据，但其中 {m} 个已提供行没有有效的交易日日期，具备推导历史区间所需日期、收盘价与IV的交易日少于 {n} 个。",
  ],
  vrpEmptyWhyShort: [
    "Aggregate-trend rows were supplied for this root, but fewer than {n} sessions have the closes and IV needed to derive the band.",
    "该标的已提供聚合趋势数据，但具备推导历史区间所需收盘价与IV的交易日少于 {n} 个。",
  ],

  // ── Skew read (95–105% moneyness, from the drawn expiry) ───────────────────
  skewRead:          ["Proxy skew 95–105%", "代理中心偏斜 95–105%"],
  skewReadTip: [
    "Approximate reported put-minus-call IV around the display proxy, not measured spot moneyness. Uses only adjacent supplied valid legs at 95%/105% of that proxy; unavailable legs break the calculation. It is not a quote-price or directional verdict.",
    "围绕显示代理中心的报告认沽减认购IV近似差值，并非依据已观测标的价格的价内外程度。仅使用该代理中心95%/105%位置附近相邻且有效的已提供数据；缺失侧中断计算。这不是报价价格或方向判断。",
  ],
  skewPutBias:       ["put bias", "看跌偏斜"],
  skewCallBias:      ["call bias", "看涨偏斜"],
  skewFlat:          ["flat", "平坦"],

  // ── Term slope chips ────────────────────────────────────────────────────────
  termSlopeActual:   ["{from}→{to}d {v} pts", "{from}→{to}天 {v} 点"],
  termSlopeFront:    ["0→30d {v} pts", "0→30天 {v} 点"],
  termSlopeBack:     ["30→90d {v} pts", "30→90天 {v} 点"],

  // ── W3B constant-tenor comparison (VolComparePanel) ─────────────────────────
  // Honesty: every point is supplied / interpolated / unsupported; the payload
  // publishes no spot or delta, so the delta axis and the quote side are named
  // as not stated; the expected move is a declared approximation and never a
  // confidence level. Vol stays non-directional.
  cmpTitleRich:      ["Is the {exp} expiry rich against its own curve?", "{exp} 到期日相对自身曲线是否偏贵？"],
  cmpTitleCompare:   ["Is this expiry rich against its own curve?", "该到期日相对自身曲线是否偏贵？"],
  cmpContextExpiries: ["{n} expiries supplied · nightly EOD", "已提供 {n} 个到期日 · 每晚收盘"],
  cmpStripNearest:   ["nearest supplied tenor", "最近的已提供期限"],
  cmpBasisSupplied:  ["supplied", "已提供"],
  cmpBasisInterpolated: ["interpolated", "插值"],
  cmpStripBasis: [
    "Basis published ATM IV · Clock {date} nightly · side not stated by source · variance-linear",
    "基准为已发布平值IV · 时钟为 {date} 每晚收盘 · 来源未说明报价口径 · 方差线性插值",
  ],
  cmpClockUnstated:  ["clock not stated by source", "来源未说明时钟"],
  // AC40 Option B: an interpolated row dated on the producer clock whose date is on or before
  // the viewer's ET today. True at the boundary (a row dated today is "not ahead of today").
  cmpRowPastRead:    ["not ahead of today · from the {asof} read", "不晚于今日 · 来自{asof}的读数"],
  // AC40 point 4: the skew calendar fallback runs from the viewer's today only when asof is absent.
  cmpSkewDteFromToday: ["days counted from today: clock not stated by source", "天数自今日起算：来源未说明时钟"],
  cmpDeltaAxis: [
    "Delta axis unsupported · no spot or delta published",
    "Delta 轴不支持 · 来源未发布现价或 Delta",
  ],
  cmpStale: [
    "Vol as of {date} · this read is {n} sessions old · both clocks stay visible",
    "波动率截至 {date} · 本次读数已过去 {n} 个交易日 · 两个时钟均保留显示",
  ],

  cmpTermTitle:      ["Term structure · ATM IV by expiry", "期限结构 · 按到期日的平值IV"],
  cmpTermSub:        ["{n} supplied · {m} interpolated for this read · nightly EOD {date}", "{n} 个已提供 · 本次读数插值 {m} 个 · 每晚收盘 {date}"],
  cmpColTenor:       ["TENOR", "期限"],
  cmpColExpiry:      ["EXPIRY", "到期日"],
  cmpColIv:          ["ATM IV", "平值IV"],
  cmpColBasis:       ["BASIS", "口径"],
  cmpColEvent:       ["EVENT WINDOW", "事件窗口"],
  cmpColLevel:       ["LEVEL", "水平"],
  cmpLevelLabel:     ["LEVEL · {lo} – {hi} %", "水平 · {lo} – {hi} %"],
  cmpSelected:       ["SELECTED", "已选中"],
  cmpBasisBetween:   ["interpolated · {lo}D → {hi}D", "插值 · {lo}D → {hi}D"],
  cmpBasisBetweenStrikes: ["interpolated · {lo} → {hi}", "插值 · {lo} → {hi}"],
  cmpUnsupportedRange: ["unsupported · outside the supplied range", "不支持 · 超出已提供范围"],
  cmpEventInsideCell: ["{label} {date} inside", "{label} {date} 在窗口内"],
  cmpTermFoot: [
    "Interpolation is variance-linear in calendar days between the two nearest supplied expiries; nothing is extrapolated outside them.",
    "插值是在两个最近的已提供到期日之间按日历天数做方差线性计算；不会外推到该范围之外。",
  ],
  cmpTermLink:       ["Table of all {n} expiries →", "全部 {n} 个到期日的表格 →"],
  cmpNoExpiries:     ["No supplied expiries for this root on the nightly read.", "本次夜间读数中该品种没有已提供的到期日。"],

  cmpAnswerSide:     ["{v} vol points {dir} {tenor}D", "比 {tenor}D {dir} {v} 个波动点"],
  cmpDirAbove:       ["above", "高"],
  cmpDirBelow:       ["below", "低"],
  cmpAnswerLine: [
    "The selected {dte}D point sits {a} and {b} on the supplied curve.",
    "所选的 {dte}D 读数{a}、{b}，均基于已提供曲线。",
  ],
  cmpAnswerLineOne: [
    "The selected {dte}D point sits {a} on the supplied curve.",
    "所选的 {dte}D 读数{a}，基于已提供曲线。",
  ],
  cmpAnswerNone: [
    "No 7D or 30D anchor is supplied on this curve; nothing is compared.",
    "该曲线没有已提供的 7D 或 30D 锚点；无法进行对比。",
  ],
  cmpAnswerMissing: [
    "The selected expiry has no supplied ATM IV; nothing is compared.",
    "所选到期日没有已提供的平值IV；无法进行对比。",
  ],
  cmpAnswerDisclaimer: [
    "A description of the supplied curve on one nightly observation, not a forecast.",
    "这是对单个每晚观测中已提供曲线的描述，并非预测。",
  ],

  cmpMoveTitle:      ["Expected move to the {exp} close", "到 {exp} 收盘的预期波动区间"],
  cmpMoveSub:        ["no confidence level is attached", "不附带任何置信水平"],
  cmpMovePctOnly:    ["±{v} % · price range not shown · no spot supplied to this view", "±{v} % · 未显示价格区间 · 该视图未提供现价"],
  cmpMoveFromSpot:   ["from spot {spot} at {clock}", "基于现价 {spot}（{clock}）"],
  cmpMoveEstimatorLabel: ["Estimator", "估计方法"],
  cmpMoveEstimatorValue: ["IV · √T on published ATM IV {iv} % · declared approximation", "IV · √T，基于已发布平值IV {iv} % · 已声明的近似方法"],
  cmpMoveHorizonLabel: ["Horizon", "区间长度"],
  cmpMoveHorizonValue: ["{n} trading days · {from} → {to} close", "{n} 个交易日 · {from} → {to} 收盘"],
  cmpMoveHorizonNote: ["weekdays, exchange holidays not subtracted", "按工作日计算，未扣除交易所假期"],
  cmpMoveVolClockLabel: ["Volatility clock", "波动率时钟"],
  cmpMoveVolClockValue: ["{date} nightly EOD", "{date} 每晚收盘"],
  cmpMoveSpotClockLabel: ["Spot clock", "现价时钟"],
  cmpMoveSpotClockValue: ["{clock} · live quote", "{clock} · 实时报价"],
  cmpMoveSpotClockMissing: ["no spot supplied", "未提供现价"],
  cmpBandHeading:    ["Published one-day band", "来源发布的单日区间"],
  cmpBandPct:        ["±{v} % at {m}σ · horizon {n} day", "±{v} %（{m}σ） · 区间 {n} 天"],
  cmpBandMethod:     ["Band method not stated by source", "来源未说明区间的计算方法"],
  cmpBandClock:      ["Band clock as of {date} · moves with the producer", "区间时钟截至 {date} · 随来源更新"],
  cmpBandStraddle:   ["Straddle prices not in source · no straddle-derived range", "来源无跨式组合价格 · 无法给出跨式推导区间"],
  cmpMoveFoot: [
    "Two clocks are shown because the volatility and the spot were observed at different times.",
    "显示两个时钟，是因为波动率与现价的观测时间不同。",
  ],

  cmpSkewTitle:      ["Skew · {tenor} · strike space", "偏斜 · {tenor} · 行权价空间"],
  cmpSkewSub:        ["delta axis unsupported", "Delta 轴不支持"],
  cmpSkewNote: [
    "Shown by strike as a share of the reference price because the source publishes no spot or delta per strike.",
    "由于来源未发布现价或每个行权价的 Delta，此处按行权价占参考价格的百分比显示。",
  ],
  cmpColStrike:      ["STRIKE", "行权价"],
  cmpAtmRow:         ["ATM", "平值"],
  cmpSkewWing:       ["unsupported · no strike supplied", "不支持 · 未提供该行权价"],
  cmpSkewGap:        ["unsupported · gap in supplied strikes", "不支持 · 已提供行权价之间存在缺口"],
  cmpSkewNoRef:      ["unsupported · no reference strike", "不支持 · 无参考行权价"],
  cmpSkewOnSelected: ["smile read on the selected expiry {exp}", "读取所选到期日 {exp} 的微笑曲线"],
  cmpSkewOnNearest:  ["smile read on {exp} · the supplied smile nearest 30D", "读取 {exp} 的微笑曲线 · 最接近 30D 的已提供微笑曲线"],
  cmpSkewFoot: [
    "Put-side strikes carry {v} vol points over the ATM point on this nightly read.",
    "在本次每晚读数中，认沽侧行权价较平值读数高 {v} 个波动点。",
  ],

  cmpEventsTitle:    ["Events inside the curve", "曲线窗口内的事件"],
  cmpEventsSub:      ["dates only · time of day not supplied", "仅日期 · 未提供具体时间"],
  cmpEventsNone:     ["No calendar events are supplied to this view.", "该视图未提供任何日历事件。"],
  cmpEventsNoneWhy: [
    "The comparison accepts an event calendar, but none is wired into this view; the curve is shown without event context.",
    "对比面板支持接入事件日历，但当前视图尚未接入；曲线在不带事件背景的情况下显示。",
  ],
  cmpEventFrom:      ["Inside every tenor from {n}D.", "从 {n}D 起的每个期限都在窗口内。"],
  cmpEventOutside:   ["Outside every supplied tenor.", "不在任何已提供期限的窗口内。"],
  cmpEventInsideSelected: ["Inside the selected {dte}D expiry.", "在所选 {dte}D 到期日的窗口内。"],
  cmpEventNotInsideSelected: ["Not inside the selected {dte}D expiry.", "不在所选 {dte}D 到期日的窗口内。"],
  cmpEventsFoot: [
    "No event premium is estimated. The curve is shown as supplied.",
    "不估计任何事件溢价。曲线按来源提供的样子显示。",
  ],
} as const;

type VolDeskKey = keyof typeof VOL_LEX;

export function getVolStr(lang: Lang, key: VolDeskKey): string {
  const entry = VOL_LEX[key as keyof typeof VOL_LEX];
  if (!entry) return "";
  return lang === "zh" ? entry[1] : entry[0];
}

export function makeVolT(lang: Lang): (key: VolDeskKey) => string {
  return (key: VolDeskKey) => getVolStr(lang, key);
}

export type { VolDeskKey };
