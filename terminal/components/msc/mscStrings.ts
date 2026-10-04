/**
 * mscStrings.ts — bilingual EN/ZH string table for the Market Structure Core panel.
 *
 * Pattern matches gexStrings.ts / structureStrings.ts: each key maps to [English, 中文].
 *
 * HONESTY DOCTRINE (enforced here — masterplan §4.1 tiering):
 *   - Tier A copy states the reading is magnitude-only and convention-independent.
 *   - Tier B copy ALWAYS carries the dealer-sign disclosure and the sensitivity verdict.
 *   - The scenario grid is named a LOCAL ESTIMATE wherever it appears; it is a first-order
 *     expansion around the published snapshot, not a re-priced book.
 *   - No support/resistance claim, no "validated"/"predictive" language, no win rates.
 *     Level *claims* need a live grade (wave R2.4) and are absent from this wave.
 *
 * NOTE: translated strings MUST NOT appear in HTML title= attributes (CI-guarded across
 * every options surface). Use the <Tip> primitive, aria-label, or a visible span.
 */

import type { Lang } from "@/lib/i18n";

const MSC_LEX = {
  // ── Drawer chrome ──────────────────────────────────────────────────────────
  panelTitle: ["Positioning Core", "持仓结构核心"],
  panelSub: ["Dealer positioning mechanics", "做市商持仓机制"],

  // ── Section rules (the tab's narrative order) ──────────────────────────────
  secToday: ["Today's structure", "当日结构"],
  secHistory: ["Against its own history", "对比自身历史"],
  secMarket: ["Across the market", "横向市场对比"],

  // ── Key levels rail (EM frame + gamma topology, merged) ────────────────────
  klTitle: ["Key levels", "关键水平"],
  klSpot: ["Spot", "现价"],

  // ── Exposure profile (§4.2 — the flagship curve) ───────────────────────────
  pfTitle: ["Exposure profile", "敞口曲线"],
  pfLead: [
    "Net dealer gamma with the whole book RE-PRICED at each hypothetical spot — exposure as a function of price, not just at today's. The zero crossing nearest spot IS the gamma flip; the curve and the flip come from one evaluation and cannot disagree.",
    "将全部持仓在每个假设现价处重新定价后的净做市商伽马——敞口是价格的函数，而非仅在当前价位。最接近现价的零点即伽马翻转位；曲线与翻转位出自同一次计算，不会相互矛盾。",
  ],
  pfUnit: ["$bn per +1% spot", "每 +1% 标的（十亿美元）"],
  pfDampen: ["dealers dampen", "做市商抑制波动"],
  pfAmplify: ["dealers amplify", "做市商放大波动"],
  pfLegend: [
    "±{p}% spot grid, re-priced from quoted IV — the same evaluation that produces the published flip",
    "±{p}% 现价网格，按市场隐含波动率重新定价——与已发布翻转位出自同一次计算",
  ],
  pfMulti: ["{n} zero crossings — the nearest to spot is the flip", "{n} 个零点——距现价最近者为翻转位"],
  pfNone: [
    "No profile published for this ladder yet — it ships with the next nightly build; the flip scalar above already uses the same grid method.",
    "该梯图暂未发布敞口曲线——将随下一次夜间构建发布；上方翻转位标量已采用相同网格方法。",
  ],
  // Measured live on the first production profile (SPY 2026-07-31): curve −1.4bn at
  // spot vs headline +5.6bn. Near the flip, two honest estimators of one book can
  // disagree on sign — the card says so rather than leaving a silent contradiction.
  pfSignSplit: [
    "The re-priced curve and the feed-greek headline disagree on today's sign — the book is near its flip and the sign is not resolved. See Sign robustness.",
    "重定价曲线与源数据希腊值的合计在当日符号上不一致——持仓临近翻转位，符号尚无定论。参见符号稳健性。",
  ],

  // ── Ranked gamma strikes (SpotGamma Large Gamma Strikes / MenthorQ GEX 1..n) ─
  rkTitle: ["Largest gamma strikes", "伽马最大的行权价"],
  rkLead: [
    "The strikes carrying the most absolute gamma, ranked — the market's scalp-target vocabulary (GEX 1…n), with each strike priced in expected-move units.",
    "按绝对伽马排序的行权价——市场常用的短线目标词汇（GEX 1…n），并以预期波动单位标注距离。",
  ],
  rkFoot: [
    "Magnitude only — convention-independent. Distance in expected moves; a graded hold-rate arrives with the level report card.",
    "仅按量级——与符号约定无关。距离以预期波动计；持守胜率评级将随水平评分卡推出。",
  ],

  // ── Strike × expiry heat (R1.4) ────────────────────────────────────────────
  hmTitle: ["Dealer heat · strike × expiry", "做市商热力 · 行权价 × 到期日"],
  hmLead: [
    "The whole grid at once: where in price AND time the book concentrates. Net hedge renders the tab's one axis — dollars a continuously hedged dealer transacts per +1% spot; OI and volume are raw contract counts; ΔOI is the day's build or unwind.",
    "一图纵览全局：持仓在价格与时间两个维度上的集中位置。净对冲沿用本页统一坐标——标的每 +1% 时持续对冲的做市商需交易的美元量；未平仓与成交量为原始合约数；ΔOI 为当日增减仓。",
  ],
  hmMetricHedge: ["Net hedge", "净对冲"],
  hmMetricOi: ["OI", "未平仓"],
  hmMetricVol: ["Volume", "成交量"],
  hmMetricDoi: ["ΔOI", "ΔOI"],
  hmMetricAria: ["Heat metric", "热力指标"],
  hmWindow: [
    "±{p}% window · {n}/{full} strikes · {e} expirations",
    "±{p}% 窗口 · {n}/{full} 个行权价 · {e} 个到期日",
  ],
  hmMoreExp: ["+{n} later expirations not shown", "另有 {n} 个较远到期日未显示"],
  hmBucket: ["strikes summed into {b}-wide rows", "行权价按 {b} 宽度归并为行"],
  hmNone: [
    "No strike × expiry grid published for this ticker.",
    "该品种未发布行权价 × 到期日网格。",
  ],
  hmLegendHedge: [
    "Positive = dealers buy · negative = dealers sell · colour saturates at the 5–95th percentile so one strike cannot wash out the field",
    "正值＝做市商买入 · 负值＝做市商卖出 · 颜色在第 5–95 百分位处饱和，单一行权价不会淹没整个网格",
  ],
  hmLegendDoi: [
    "Positive = OI built · negative = OI unwound · colour saturates at the 5–95th percentile",
    "正值＝增仓 · 负值＝减仓 · 颜色在第 5–95 百分位处饱和",
  ],
  hmLegendMag: [
    "Contracts, calls plus puts · colour saturates at the 5–95th percentile",
    "合约数（看涨加看跌）· 颜色在第 5–95 百分位处饱和",
  ],
  hmWalls: ["CW = call wall · PW = put wall", "CW＝看涨墙 · PW＝看跌墙"],
  hmSpotNote: ["dashed line = spot", "虚线＝现价"],
  tierA: ["Magnitude", "量级"],
  tierB: ["Signed estimate", "带符号估计"],
  // Same honesty tier as `tierA` — convention-independent — but "Magnitude" was written
  // for the gamma cards and says nothing true about a regression between two quoted
  // series. Same guarantee, accurate word.
  tierMeasured: ["Measured", "实测"],
  // ⚠️ The expected-move card is MIXED and takes the weaker label deliberately. The
  // distances it measures are convention-independent arithmetic over prices and a
  // quoted vol band; the LEVELS being measured (call wall, put wall, flip) are signed
  // net-gamma outputs and are not. A reader acts on the level, so the card discloses at
  // the level's tier, and this string names the split instead of hiding it.
  emTierWhy: [
    "The expected-move distances are convention-independent arithmetic. The levels they measure — call wall, put wall, flip — are signed net-gamma outputs and inherit the dealer-sign assumption.",
    "预期波动距离本身与符号约定无关；但所衡量的水平（看涨墙、看跌墙、翻转点）为带符号净伽马的输出，沿用做市商符号假设。",
  ],
  tierAWhy: [
    "Depends on gamma magnitude and open interest only — the dealer-sign assumption cannot change this reading.",
    "仅取决于伽马量级与未平仓量——做市商符号假设不会改变该读数。",
  ],
  tierBWhy: [
    "Inherits the payload's dealer-sign assumption. The sensitivity panel shows how much the reading depends on it.",
    "沿用数据中的做市商符号假设。敏感度面板显示该读数对此假设的依赖程度。",
  ],
  noData: ["No exposure ladder for this ticker yet.", "该品种暂无敞口梯图。"],
  loading: ["Loading…", "加载中…"],
  errorLoad: ["Could not load", "无法加载"],
  asofChip: ["Nightly EOD · as of {date}", "每日收盘 · 截至 {date}"],
  asofStale: ["{n} sessions old", "已过 {n} 个交易日"],
  emptyTitle: ["No positioning snapshot", "无持仓快照"],
  emptyWhy: [
    "The nightly options build covers the index anchors first, so a missing single name is a coverage gap rather than a broken desk. Try {sym} again after tonight's build, or pick another root.",
    "夜间期权构建优先覆盖指数锚定品种，因此缺少个股属于覆盖缺口而非故障。可在今晚构建后重试 {sym}，或选择其他标的。",
  ],
  windowed: [
    "{n} of {full} strikes — the published ladder is a ±20% window, so these are window sums, not the full book.",
    "{n}/{full} 个行权价——已发布梯图为 ±20% 窗口，因此为窗口合计而非完整持仓。",
  ],

  // ── Module A: sign sensitivity (Tier B) ────────────────────────────────────
  signTitle: ["Sign robustness", "符号稳健性"],
  signLead: [
    "How much does the long/short-gamma read depend on the dealer-sign assumption?",
    "多空伽马判断在多大程度上依赖做市商符号假设？",
  ],
  signRobust: ["Robust", "稳健"],
  signFragile: ["Fragile", "脆弱"],
  signUnknown: ["No gamma", "无伽马"],
  signTilt: ["Gamma tilt", "伽马倾斜"],
  signTiltWhy: [
    "Gross call gamma minus gross put gamma, over their sum. The margin by which the regime read survives a change of convention.",
    "看涨伽马总量减看跌伽马总量，再除以两者之和。该判断在符号约定变化下的安全边际。",
  ],
  signCritical: ["Flips at call weight", "翻转于看涨权重"],
  signCriticalWhy: [
    "Our published convention weights the call side at +1 (dealers long calls). This is the weight at which net gamma would be exactly zero.",
    "已发布约定将看涨方权重设为 +1（做市商持有看涨期权多头）。此为净伽马恰好为零时的权重。",
  ],
  signNoFlip: ["No plausible weight flips it", "任何合理权重都无法翻转"],
  signVerdictLbl: ["Verdict", "结论"],
  signCurve: ["Net gamma by call-side weight", "按看涨方权重的净伽马"],
  signRobustNote: [
    "The regime read survives the full range of conventions we consider plausible.",
    "该判断在我们认为合理的全部约定范围内均成立。",
  ],
  signFragileNote: [
    "Call and put gamma are close to balanced — a small change of convention would flip the regime read. Treat the sign as unresolved.",
    "看涨与看跌伽马接近平衡——约定的微小变化即可翻转该判断。应视符号为未定。",
  ],
  signConventionLabel: ["Convention", "约定"],
  signWeightPlus1: ["+1 dealers long calls", "+1 做市商看涨多头"],
  signWeight0: ["0 calls unsigned", "0 看涨方无符号"],
  signWeightMinus1: ["−1 dealers short calls", "−1 做市商看涨空头"],

  // ── Module B: gamma topology (Tier A) ──────────────────────────────────────
  topoTitle: ["Gamma topology", "伽马拓扑"],
  topoAbsStrike: ["Absolute gamma strike", "绝对伽马行权价"],
  topoAbsWhy: [
    "The strike carrying the most gamma in absolute terms (calls plus puts). Computed from magnitudes, so it does not inherit the dealer-sign assumption.",
    "以绝对值计伽马最大的行权价（看涨加看跌）。基于量级计算，因此不受做市商符号假设影响。",
  ],
  topoShare: ["of gross gamma", "占伽马总量"],
  topoRanked: ["Largest absolute-gamma strikes", "绝对伽马最大的行权价"],
  topoColStrike: ["Strike", "行权价"],
  topoColAbs: ["Abs gamma", "绝对伽马"],
  topoColShare: ["Share", "占比"],
  topoNone: ["No gamma in the published window.", "已发布窗口内无伽马。"],

  // ── Module C: hedge-flow scenario grid (Tier B) ────────────────────────────
  scenTitle: ["Hedge-flow scenarios", "对冲流量情景"],
  scenLead: [
    "Underlying a continuously hedged dealer would have to trade to stay flat.",
    "持续对冲的做市商为维持中性所需交易的标的数量。",
  ],
  scenAxisSpot: ["Spot move", "标的变动"],
  scenAxisVol: ["IV shock", "隐波冲击"],
  scenVolUnit: ["vol pts", "波动点"],
  scenBuy: ["dealers buy", "做市商买入"],
  scenSell: ["dealers sell", "做市商卖出"],
  scenLegend: ["Positive = dealers buy · negative = dealers sell", "正值＝做市商买入 · 负值＝做市商卖出"],
  scenCharm: ["One day of decay", "一日时间衰减"],
  scenCharmWhy: [
    "Delta drift from time passing alone, with spot and implied volatility unchanged — the charm bid or offer.",
    "仅因时间流逝产生的德尔塔漂移（标的与隐含波动率不变）——即 charm 带来的买盘或卖盘。",
  ],
  scenNoVanna: ["No vanna lens in this payload — the IV axis is gamma-only.", "该数据无 vanna 维度——隐波轴仅含伽马。"],
  scenNoCharm: ["No charm lens in this payload.", "该数据无 charm 维度。"],
  scenDisclose: [
    "Local estimate. A first-order expansion around the published snapshot: the greeks are measured at the current spot and are themselves functions of spot, so accuracy falls away from the centre. Bounded to ±3% and ±5 vol points for that reason.",
    "局部估计。围绕已发布快照的一阶展开：希腊值在当前标的价处测得，而其本身又是标的价的函数，因此偏离中心后精度下降。故限定在 ±3% 与 ±5 个波动点以内。",
  ],
  // The value is auto-scaled by the shared $mn formatter (it prints its own K/M/B
  // suffix), so this label names WHAT the number is, never its unit.
  scenUnit: ["Largest scenario", "最大情景"],

  // ── Module D: levels in expected-move units (Tier A) ───────────────────────
  emTitle: ["Levels in expected moves", "以预期波动计的水平"],
  emLead: [
    "Structural levels priced in today's expected move rather than in points — a level three expected moves away is not this session's structure.",
    "以当日预期波动而非点数衡量结构水平——距离三个预期波动的水平不构成当日结构。",
  ],
  emColLevel: ["Level", "水平"],
  emColPrice: ["Price", "价格"],
  emColDist: ["Distance", "距离"],
  emColEm: ["In EM", "预期波动数"],
  emReachable: ["in range", "可及"],
  emFar: ["far", "远"],
  emOneSigma: ["1σ expected move", "1σ 预期波动"],
  emHorizon: ["horizon {d}d", "期限 {d} 天"],
  emCalib: [
    "A same-multiplier band contained the next session's range in {pct} of {n} historical sessions.",
    "同倍数区间在 {n} 个历史交易日中的 {pct} 覆盖了下一交易日的波动范围。",
  ],
  emCalibCi: ["95% CI {lo}–{hi}", "95% 置信区间 {lo}–{hi}"],
  emNoBand: [
    "No expected-move band published for this ticker — distances are shown in percent only.",
    "该品种未发布预期波动区间——仅按百分比显示距离。",
  ],
  // ── Volland-parity wave 1: hedging-requirement framing ─────────────────────
  hgTitle: ["Snapshot hedge sensitivity by strike", "按行权价的快照对冲敏感度"],
  hgLead: [
    "Snapshot sensitivities under the stated inventory assumptions, grouped by contract strike. These values do not measure trades as spot moves.",
    "在既定持仓假设下，按合约行权价分组的快照敏感度。这些数值不代表现价变化过程中的交易量。",
  ],
  hgGreekAria: ["Greek lens", "希腊值维度"],
  hgViewAria: ["Chart form", "图表形式"],
  hgGamma: ["Gamma", "Gamma"],
  hgDelta: ["Delta", "Delta"],
  hgVanna: ["Vanna", "Vanna"],
  hgCharm: ["Charm", "Charm"],
  hgViewBars: ["By strike", "按行权价"],
  hgViewProfile: ["Strike subtotal", "行权价小计"],
  hgPerUnit: ["{u}", "{u}"],
  unitSpot: ["+1% spot", "标的 +1%"],
  unitVol: ["+1 vol point", "+1 波动点"],
  unitDay: ["+1 day", "+1 天"],
  unitPosition: ["position", "持仓"],
  hgUnitSpot: ["USD mn per +1% spot", "百万美元 / 标的 +1%"],
  hgUnitVol: ["USD mn per +1 vol point", "百万美元 / +1 波动点"],
  hgUnitDay: ["USD mn per +1 day", "百万美元 / +1 天"],
  hgUnitPosition: ["USD mn position hedge", "百万美元 持仓对冲"],
  hgSpot: ["spot", "现价"],
  hgStrikeAxis: ["Contract strike", "合约行权价"],
  hgLegend: ["Positive = dealers buy · negative = dealers sell", "正值＝做市商买入 · 负值＝做市商卖出"],
  // Dedicated by-strike legend: the frozen "modeled sensitivity" wording must not leak into
  // the term-structure card, which still shares the older hgLegend key above.
  hgLegendByStrike: ["Positive = modeled buy sensitivity · negative = modeled sell sensitivity", "正值＝模型买入敏感度 · 负值＝模型卖出敏感度"],
  hgAnchored: [
    "Snapshot contributions are summed outward on each side of reference spot. The horizontal axis is contract strike; this is not a spot-path hedge total.",
    "以参考现价为界向两侧累计快照贡献。横轴是合约行权价，并非价格路径上的对冲交易总量。",
  ],
  hgUnanchored: [
    "Running subtotal of the supplied snapshot contributions by contract strike. Delta is a position hedge amount; the other lenses are per stated shock.",
    "按合约行权价累计所提供的快照贡献。Delta 为持仓对冲量，其他维度按所示冲击单位计量。",
  ],
  hgNoLens: ["This greek is not published for the current ladder.", "当前梯图未发布该希腊值。"],
  hgScale: ["Largest bar ± {v}", "最大值 ± {v}"],
  hgCoverage: ["{known}/{total} supplied rows known", "已知 {known}/{total} 条输入"],
  hgPartial: ["Partial snapshot · missing values excluded", "部分快照 · 缺失数值未计入"],

  tsTitle: ["Term structure of hedging", "对冲的期限结构"],
  tsLead: [
    "Where in TIME the dealer risk sits — the same requirement, per expiration, accumulating from the nearest outward.",
    "做市商风险在时间上的分布——同一对冲需求按到期日展开，并自最近到期日向外累计。",
  ],
  tsColExp: ["Expiration", "到期日"],
  tsColDte: ["DTE", "剩余天数"],
  tsColHedge: ["Hedge", "对冲"],
  tsColCum: ["Cumulative", "累计"],
  tsNone: ["No expiration breakdown for this ticker yet.", "该品种暂无按到期日数据。"],
  tsMore: ["+{n} further expirations not shown.", "另有 {n} 个到期日未显示。"],
  tsBandWhy: [
    "The colour marks the GAP to the next expiration, not its distance from today — so a dense front-month cluster and an isolated long-dated line are distinguishable at a glance.",
    "颜色标记的是与下一到期日之间的间隔，而非距今天的远近——因此密集的近月序列与孤立的远期到期日一眼即可区分。",
  ],
  tsGammaOnly: [
    "Gamma only: the by-expiration payload carries gamma and delta, never vanna or charm.",
    "仅限 Gamma：按到期日的数据仅含 gamma 与 delta，不含 vanna 或 charm。",
  ],
  bandDaily: ["daily", "每日"],
  bandWeekly: ["weekly", "每周"],
  bandMonthly: ["monthly", "每月"],
  bandQuarterly: ["quarterly", "每季"],
  bandAnnual: ["annual", "每年"],

  dhTitle: ["Today's hedging", "今日对冲"],
  dhLead: [
    "What a typical session asks of dealers, each leg scaled by a stated shock rather than a nominal unit.",
    "典型交易日对做市商的要求，各分项均按明示的冲击幅度而非名义单位缩放。",
  ],
  dhSpot: ["From a spot move", "来自标的变动"],
  dhVol: ["From an IV move", "来自隐波变动"],
  dhTime: ["From time passing", "来自时间流逝"],
  dhTotal: ["Total", "合计"],
  dhOneDay: ["1 day", "1 天"],
  // Unit chips that previously leaked English into the zh view ("123d", "+1 pt").
  dteUnit: ["{n}d", "{n}天"],
  volPtNote: ["+{n} pt", "+{n} 点"],
  dhAbsent: ["not published", "未发布"],
  dhLegend: ["Positive = dealers buy · negative = dealers sell", "正值＝做市商买入 · 负值＝做市商卖出"],
  dhDisclose: [
    "The spot leg uses this ticker's own one-sigma expected move UP rather than a nominal 1% — a down move mirrors that leg's sign. Legs are independent first-order estimates and do not compound; a greek we do not publish is shown absent and its leg is left out of the total (so the total covers only the legs shown).",
    "标的分项采用该品种自身向上 1σ 的预期波动而非名义 1%——向下波动时该分项符号相反。各分项为彼此独立的一阶估计，不做复合；未发布的希腊值显示为缺失，其分项不计入合计（合计仅涵盖所示分项）。",
  ],
  emArchived: [
    "The expected-move band is a current-session read and did not travel with the archived ladder — distances are shown in percent only.",
    "预期波动区间为当前交易日读数，不随已归档梯图回放——仅按百分比显示距离。",
  ],
  emNone: ["No levels published for this ticker.", "该品种未发布水平。"],
  // Level display names (keys mirror the payload fields they come from).
  lvlCallWall: ["Call wall", "看涨墙"],
  lvlPutWall: ["Put wall", "看跌墙"],
  lvlFlip: ["Gamma flip", "伽马翻转"],
  lvlAbsGamma: ["Absolute gamma", "绝对伽马"],
  lvlMaxPain: ["Max pain", "最大痛点"],
  lvlMagnet: ["Magnet", "磁吸位"],

  // ── Module E: front expiry / post-expiry book (Tier A) ─────────────────────
  expTitle: ["Front expiry & the book after it", "近月到期与到期后持仓"],
  expLead: [
    "How much of the exposure rolls off at the next expiration, and what the book looks like once it does.",
    "有多少敞口在下一到期日消失，以及消失后的持仓形态。",
  ],
  expNext: ["Next expiration", "下一到期日"],
  expGammaShare: ["Gamma expiring", "到期伽马占比"],
  expDeltaShare: ["Delta expiring", "到期德尔塔占比"],
  expConcentrated: ["Concentrated", "集中"],
  expConcentratedWhy: [
    "More than a quarter of gross gamma sits in the front expiration — the structure the desk reads today is largely a front-expiry structure.",
    "超过四分之一的伽马总量集中于近月到期——当前所读结构在很大程度上属于近月结构。",
  ],
  expCurrent: ["Net gamma now", "当前净伽马"],
  expAfter: ["After the front expiry", "近月到期之后"],
  expSignFlip: ["Sign flips on expiry", "到期后符号翻转"],
  expSignFlipWhy: [
    "Removing the front expiration reverses the sign of net gamma: the regime the desk reads today is carried by contracts that are about to disappear.",
    "剔除近月到期后净伽马符号反转：当前所读机制由即将消失的合约支撑。",
  ],
  expNone: ["No expiration breakdown for this ticker yet.", "该品种暂无按到期日数据。"],
  expNoAfter: ["Only one expiration published — no after-expiry preview.", "仅发布一个到期日——无到期后预览。"],

  // ── W2 · Aggregate greek trend ─────────────────────────────────────────────
  atTitle: ["Positioning vs its own history", "持仓与自身历史对比"],
  atLead: [
    "One number per session for the whole book. A dollar figure means little alone; where it sits in its own record is the reading.",
    "全账簿每个交易日一个数值。单看金额意义有限；它在自身历史中的位置才是要点。",
  ],
  atTierWhy: [
    "The level inherits the dealer-sign assumption. The percentile is sturdier: the same assumption applies to every session, so a constant sign error largely cancels when today is ranked against its own record.",
    "绝对水平沿用做市商符号假设；百分位更稳健：该假设对每个交易日一致，将今日与自身历史排名时，恒定的符号误差大体相互抵销。",
  ],
  atVega: ["Vega", "维加"],
  atWin1y: ["1Y", "1年"],
  atWin3y: ["3Y", "3年"],
  atWinAll: ["All", "全部"],
  atWinAria: ["History window", "历史窗口"],
  atToday: ["Latest", "最新"],
  atRank: ["Rank in window", "窗口内排名"],
  atTypical: ["Median", "中位数"],
  atRange: ["Usual range", "常见区间"],
  atCoverage: ["{n} sessions since {since}.", "自 {since} 起共 {n} 个交易日。"],
  atTruncated: [
    "Shorter than the window requested — the published history does not reach that far.",
    "短于所选窗口——已发布历史未覆盖该长度。",
  ],
  atBandLegend: [
    "Shaded band = the 5th–95th percentile of this window; dashed line = its median.",
    "阴影带为该窗口的第 5–95 百分位；虚线为其中位数。",
  ],
  atNone: ["No positioning history published for this ticker yet.", "该品种暂无持仓历史数据。"],
  atDrift: [
    "Over a long window the rank partly reflects growth: exposure scales with the underlying, and this one has risen a long way since the series began. Shorter windows compare like with like.",
    "长窗口下的排名部分反映规模增长：敞口随标的价格放大，而该标的自序列起点以来涨幅可观。较短窗口的对比更为同类可比。",
  ],

  // ── W2 · Spot–vol relationship ─────────────────────────────────────────────
  svTitle: ["Spot–vol relationship", "现货与波动率关系"],
  svLead: [
    "Daily change in at-the-money implied vol regressed on the day's move. The gauge asks whether vol moved more than the move usually implies — not whether vol is high.",
    "以当日涨跌幅回归平值隐含波动率的日变化。仪表衡量的是波动率相对该涨跌幅是否反应过度，而非波动率本身是否偏高。",
  ],
  svTierWhy: [
    "Two market-quoted series regressed against each other, with n and R² stated. No dealer-sign assumption enters this reading.",
    "两组市场报价序列的回归，并给出样本量与判定系数。该读数不涉及做市商符号假设。",
  ],
  svBeta: ["Vol pts per +1%", "每 +1% 的波动点"],
  svR2: ["Explained", "可解释比例"],
  svVerdict: ["Today", "今日"],
  // ⚠️ REACTION words, not LEVEL words. The verdict grades the residual of today's
  // vol change against what today's spot move usually implies — svLead explicitly
  // disavows "is vol high". A zh reading of 偏高/偏低 would claim exactly the thing
  // the lead says this card does not measure.
  svOver: ["Overvixed", "波动率反应过度"],
  svUnder: ["Undervixed", "波动率反应不足"],
  svInline: ["In line", "符合"],
  svUnknown: ["Not graded", "未评级"],
  svGaugeAria: ["Vol reaction versus the regression", "波动率反应与回归对比"],
  svToday: [
    "Latest session moved {r}; implied vol changed {a} pts against {p} expected.",
    "最新交易日涨跌 {r}；隐含波动率变化 {a} 点，预期为 {p} 点。",
  ],
  svLegend: [
    "Fitted over the last {n} sessions. Ring marks the latest session.",
    "基于最近 {n} 个交易日拟合。圆环标记最新交易日。",
  ],
  svNone: [
    "Not enough paired sessions to fit a relationship yet ({n} so far).",
    "配对交易日不足，暂无法拟合关系（当前 {n} 个）。",
  ],

  // ── W2 · Positioning extremes by horizon ───────────────────────────────────
  exTitle: ["Where gamma sits, by horizon", "各期限的伽马集中位置"],
  exLead: [
    "The heaviest gamma strike each side of spot, split by time to expiry. Near-dated concentration decays within days; far-dated persists.",
    "按到期时间划分，现价两侧伽马最重的行权价。近月集中度数日内即衰减，远月则持续存在。",
  ],
  exTierWhy: [
    "Measures where dealer gamma concentrates, under the payload's sign convention. It is not a claim that price will respect these levels — a graded version arrives with the level report card.",
    "在数据的符号约定下衡量做市商伽马的集中位置；并非断言价格会尊重这些水平——评级版本将随水平评分卡推出。",
  ],
  exColHorizon: ["Horizon", "期限"],
  exColBelow: ["Heaviest below", "下方最重"],
  exColAbove: ["Heaviest above", "上方最重"],
  exNear: ["0–5 days", "0–5 天"],
  exSwing: ["6–30 days", "6–30 天"],
  exFar: ["31+ days", "31 天以上"],
  exUnknown: ["no data", "无数据"],
  exNoWall: ["none", "无"],
  exNone: [
    "No strike-by-expiry grid published for this ticker — the horizon split needs both axes together.",
    "该品种未发布行权价×到期日网格——按期限拆分需要两个维度同时具备。",
  ],
  exLegend: [
    "Strike prices — the heaviest |gamma| each side, any sign. “none” means no strikes on that side; “no data” means this horizon is not covered.",
    "为行权价——每侧 |伽马| 最重者，不限符号。“无”表示该侧无行权价；“无数据”表示该期限未覆盖。",
  ],
  exDisclose: [
    "Concentration of dealer gamma — not a forecast that these levels hold.",
    "为做市商伽马的集中位置，并非这些水平将保持有效的预测。",
  ],

  // ── W3 · Floating strike (delta-space exposure) ────────────────────────────
  fsTitle: ["The book in delta space", "以 Delta 视角看持仓"],
  fsLead: [
    "Exposure filed by call-equivalent delta rather than by strike. A strike is a fixed price; a delta band stays the same object as spot travels and time passes.",
    "按看涨等效 Delta 而非行权价归类的敞口。行权价是固定价格；Delta 区间在现价移动与时间流逝中仍指向同一对象。",
  ],
  // ⚠️ This card and the by-strike chart above it are NOT the same population, and the
  // copy must not imply they are. by_strike is windowed to ±20% of spot and capped at
  // 160 rows; this is the whole book — deliberately, because the far wings are where a
  // delta view earns its keep. Their totals therefore differ on any real index root.
  fsCoverage: [
    "Covers the whole book, including strikes beyond the ±20% window the by-strike chart draws — so the two do not sum to the same total.",
    "涵盖全部持仓，包括按行权价图表所绘 ±20% 窗口以外的行权价——因此两者合计并不相等。",
  ],
  fsPeak: ["Heaviest band {b}", "最重区间 {b}"],
  fsLegend: [
    "Dashed line = 50Δ, the at-the-money band. Puts are folded onto the call axis: a −30Δ put sits with the 70Δ calls.",
    "虚线为 50Δ（平值区间）。看跌期权折算到看涨轴：−30Δ 看跌与 70Δ 看涨同区间。",
  ],
  fsScale: ["Largest band {v}.", "最大区间 {v}。"],
  fsNone: [
    "No delta breakdown published for this ticker yet.",
    "该品种暂无按 Delta 拆分数据。",
  ],

  // ── R2.4 · The live Level Report Card ──────────────────────────────────────
  gcTitle: ["Level report card — {sym}", "水平评分卡 — {sym}"],
  gcTitleUniverse: ["Level report card — graded universe", "水平评分卡 — 已评级全体"],
  gcLead: [
    "Every published level, graded against the NEXT session and recomputed nightly: a level counts as touched when the next session trades through it, and as held when the close finishes on the defending side. The category sells static hit-rates nobody can audit; this one you can.",
    "每个已发布水平均按下一交易日评级并每晚重算：下一交易日成交穿越该价位记为触及；收盘停在防守一侧记为守住。业内出售无法审计的静态胜率；这份可以审计。",
  ],
  gcTierWhy: [
    "Measured frequencies with Wilson 95% intervals, judged against a stated null. Not a claim that any level will hold — when the record does not beat the null, the card says so.",
    "以 Wilson 95% 区间给出的实测频率，并与明示的基准对比。并非任何水平将守住的断言——当记录未胜过基准时，本卡直言。",
  ],
  gcNull: [
    "Where the record carries them, each role is judged against an EQUIDISTANT null — the same hold test on a level mirrored across spot, same distance, zero positioning information — and each board against the prior-day extremes; older windows fall back to the coin-flip 50%. A level earns “beats null” only when the two records' intervals separate: its Wilson lower bound must clear the null's Wilson upper bound. The mirror sits on the opposite side of spot, so that comparison also absorbs up/down asymmetry — the side-matched null is the prior-day extreme.",
    "在记录覆盖之处，每类水平以等距基准评判——同一守住检验施加于以现价镜像、同距离但不含持仓信息的价位——每个盘面另与前日极值对比；较早窗口回退为抛硬币 50%。仅当两条记录的区间彼此分离——其 Wilson 下界越过基准的 Wilson 上界——才标注“胜过基准”。镜像位处于现价另一侧，该对比亦包含涨跌不对称；同侧基准为前日极值。",
  ],
  gcScopeRoot: ["{n} boards, this root", "本标的 {n} 个盘面"],
  gcScopeUniverse: ["{n} boards · graded universe", "{n} 个盘面 · 已评级全体"],
  gcUncovered: [
    "No graded history for {sym} yet — the figures below are the graded UNIVERSE, shown as context, not this ticker's record.",
    "{sym} 暂无评级历史——下方数字为已评级全体，仅作参照，并非该标的自身记录。",
  ],
  gcColRole: ["Level", "水平"],
  gcColTouches: ["Scored touches", "有效触及"],
  gcColHold: ["P(hold)", "守住率"],
  gcColCi: ["95% CI", "95% 区间"],
  gcColNull: ["vs null", "对比基准"],
  gcBeats: ["beats null", "胜过基准"],
  gcNoEdge: ["no edge", "无优势"],
  gcAnchor: ["Anchor", "锚定位"],
  gcCluster: ["Cluster", "聚集位"],
  gcCounter: ["Counter", "反向位"],
  gcTrapdoor: ["Trapdoor", "陷阱位"],
  gcLaunchpad: ["Launchpad", "发射位"],
  gcWallContained: ["Close inside the walls", "收盘位于两墙之间"],
  gcBandContained: ["Range inside the EM band", "波幅位于预期区间内"],
  gcWallRange: ["Range inside the walls", "波幅位于两墙之间"],
  gcBandClose: ["Close inside the EM band", "收盘位于预期区间内"],
  gcPrevdayClose: ["Prev-day range held the close (null)", "昨日区间包含收盘（基准）"],
  gcNullAt: ["null {p}", "基准 {p}"],
  gcFlipTouches: ["Flip touches · mean |move|", "翻转触及 · 平均|波动|"],
  gcWindow: ["Window", "统计窗口"],
  gcNoneBeat: [
    "Under the close-side test no role currently beats its null — which is exactly why this desk makes no support/resistance claims.",
    "在收盘侧检验下，当前没有任何水平类型胜过其基准——这正是本页不做支撑/阻力断言的原因。",
  ],
  gcSomeBeat: [
    "Roles marked “beats null” cleared their null's bar at 95% confidence in this window.",
    "标注“胜过基准”的类型在本窗口内以 95% 置信度越过其基准。",
  ],
  gcRecomputed: ["Recomputed nightly by the grading lane", "由评级流水线每晚重算"],

  // ── W3 · Cross-root screener ───────────────────────────────────────────────
  qdTitle: ["Which names sit at a positioning extreme", "哪些标的处于持仓极端"],
  qdLead: [
    "Every root ranked against its own recent history, not against the others on screen. A percentile is a claim about that ticker; “most negative on the board” is a claim about the board.",
    "每个标的与自身近期历史对比排名，而非与屏幕上其他标的对比。百分位是关于该标的的判断；“全表最负”只是关于这张表的判断。",
  ],
  qdTierWhy: [
    "Both axes inherit the dealer-sign convention. Ranking each root against its own record is the sturdier half: the same assumption applies to every session, so a constant sign error largely cancels.",
    "两轴均沿用做市商符号假设。将每个标的与自身历史排名更为稳健：该假设对每个交易日一致，恒定符号误差大体抵销。",
  ],
  qdAxisX: ["Dealer gamma percentile →", "做市商伽马百分位 →"],
  qdAxisY: ["Dealer vanna percentile →", "做市商 Vanna 百分位 →"],
  qdColGammaPct: ["Γ pct", "Γ 百分位"],
  qdColGammaUsd: ["Γ $", "Γ 金额"],
  qdColVannaPct: ["V pct", "V 百分位"],
  qdColVannaUsd: ["V $", "V 金额"],
  qdFootMeta: [
    "{n} roots · ranked within each root's trailing {d} sessions · needs {m}+ sessions of history",
    "共 {n} 个标的 · 在各自最近 {d} 个交易日内排名 · 需 {m}+ 个交易日历史",
  ],
  qdAmpVol: ["Amplify · vol-sensitive", "放大 · 对波动敏感"],
  qdAmpStable: ["Amplify · vol-quiet", "放大 · 波动平静"],
  qdDampVol: ["Dampen · vol-sensitive", "抑制 · 对波动敏感"],
  qdDampStable: ["Dampen · vol-quiet", "抑制 · 波动平静"],
  qdColRoot: ["Root", "标的"],
  qdColGamma: ["Gamma pct · $", "伽马百分位 · 金额"],
  qdColVanna: ["Vanna pct · $", "Vanna 百分位 · 金额"],
  qdColRegime: ["Hedging regime", "对冲机制"],
  qdWindow: [
    "Ranked within each root's trailing {d} sessions, not its whole history — over nine years the rank would partly measure how much the market grew.",
    "在每个标的最近 {d} 个交易日内排名，而非全部历史——若取九年，排名将部分反映市场规模的增长。",
  ],
  qdLegend: [
    "{n} roots. Horizontal = dealer gamma percentile (left: hedging amplifies a move). Vertical = dealer vanna percentile (top: a vol move forces hedging). Highlighted points are at a historical extreme.",
    "共 {n} 个标的。横轴为做市商伽马百分位（左侧：对冲放大波动）。纵轴为做市商 Vanna 百分位（上方：波动变化迫使对冲）。高亮点处于历史极端。",
  ],
  qdMinHistory: [
    "A root needs {d} sessions of history before it is ranked.",
    "标的需具备 {d} 个交易日历史方可参与排名。",
  ],
  qdSkipped: ["{n} skipped for thin history: {r}.", "{n} 个因历史过短被排除：{r}。"],
  qdNone: [
    "The cross-root board has not been published yet.",
    "跨标的看板尚未发布。",
  ],
} as const;

type MscKey = keyof typeof MSC_LEX;

export function getMscStr(lang: Lang, key: MscKey): string {
  const entry = MSC_LEX[key];
  if (!entry) return "";
  return lang === "zh" ? entry[1] : entry[0];
}

export function makeMscT(lang: Lang): (key: MscKey) => string {
  return (key: MscKey) => getMscStr(lang, key);
}

export type { MscKey };
