/**
 * gexStrings.ts — bilingual EN/ZH string table for the GEX Desk surface.
 *
 * Pattern matches flowdeskStrings.ts: each key maps to [English, 中文].
 *
 * HONESTY DOCTRINE (enforced here):
 *   - GEX levels are a LEVELS MAP, display-only until forward-vol gate (~Sept 2026).
 *   - Dealer-sign is an ASSUMPTION (standard convention), not a verified fact.
 *   - Single-name GEX regime is a near-constant product attribute, not time-varying signal.
 *   - No "validated", "predictive", or directional trade-signal language.
 *   - State descriptions are structural/descriptive, not forecasts.
 *
 * NOTE: translated strings MUST NOT appear in HTML title= attributes (CI-guarded).
 * Use aria-label or visible text spans instead.
 */

import type { Lang } from "@/lib/i18n";

const GEX_LEX = {
  // ── Tab / surface header ───────────────────────────────────────────────────
  gexTitle:        ["Exposure Desk", "敞口台"],
  gexSubtitle:     ["Dealer greek exposure & levels", "做市商希腊值敞口与水平"],

  // ── Controls ───────────────────────────────────────────────────────────────
  tickerInputLabel:  ["Ticker", "代码"],
  tickerPlaceholder: ["SPY", "SPY"],
  expiryAll:         ["ALL", "全部"],
  expiryChipDte:     ["DTE", "到期天数"],

  // ── Greek exposure lens (GEX / DEX / VEX / CHEX switcher) ───────────────────
  // Acronyms are identical EN/ZH; the aria + full names carry the translation.
  greekLensAria:  ["Exposure greek", "敞口希腊值"],
  greekGamma:     ["GEX", "GEX"],
  greekDelta:     ["DEX", "DEX"],
  greekVanna:     ["VEX", "VEX"],
  greekCharm:     ["CHEX", "CHEX"],
  greekGammaFull: ["Gamma exposure", "伽马敞口"],
  greekDeltaFull: ["Delta exposure", "德尔塔敞口"],
  greekVannaFull: ["Vanna exposure", "Vanna 敞口"],
  greekCharmFull: ["Charm exposure", "Charm 敞口"],
  // Walls/flip are gamma-only constructs — this note shows when a non-gamma lens is active.
  greekLensNote:  ["walls & flip apply to gamma only", "墙与翻转仅适用于伽马"],
  ladderNetPrefix:["Net", "净"],

  // ── Exposure axis toggle: By Strike / By Expiration ────────────────────────
  viewAria:       ["Exposure axis", "敞口维度"],
  viewByStrike:   ["By Strike", "按行权价"],
  viewByExpiry:   ["By Expiration", "按到期日"],
  expiryLensNA:   [
    "Vanna & Charm aren't provided per-expiration yet — gamma & delta only.",
    "Vanna 与 Charm 暂未提供按到期日数据 — 仅伽马与德尔塔。",
  ],
  expiryNoData:   ["No expiration breakdown for this ticker yet.", "该品种暂无按到期日数据。"],
  // Column headers for the by-expiration bars (the table shipped without any).
  expiryColExp:   ["Expiration", "到期日"],
  expiryColNet:   ["Net exposure", "净敞口"],

  // ── Summary bar labels ─────────────────────────────────────────────────────
  sumNetGex:      ["Net GEX", "净GEX"],
  sumCallWall:    ["Call Wall", "看涨墙"],
  sumPutSupport:  ["Put Support", "看跌墙"],
  sumMagnet:      ["Magnet / HVL", "磁吸 / 高量位"],
  sumMaxPain:     ["Max Pain", "最大痛苦点"],
  sumPcOi:        ["P/C Ratio", "认沽/认购比"],
  sumCallOI:      ["Call OI", "认购持仓"],
  sumPutOI:       ["Put OI", "认沽持仓"],
  sumIv30:        ["IV30", "30日IV"],
  sumFlip:        ["Gamma Flip", "伽马翻转"],
  sumNotAvail:    ["—", "—"],
  // Tag on the summary bar's LEVEL cells while a narrower expiry lens is active: walls,
  // flip and magnet are all-expiry constructs and do not re-derive per expiration.
  sumAllExpTag:   ["all exp", "全到期"],
  // Hover disclosure on the scoped Net GEX tag: a narrower expiry lens sums over the
  // per-expiration snapshot's own (narrower) strike window, not the full ladder — this
  // states that second swap explicitly instead of leaving it implied by the expiry word.
  sumLensScopeTip: [
    "Net GEX for this expiration, summed over the {n} of {m} ladder strikes the per-expiration snapshot covers — a narrower strike window than the full ladder, not just a narrower expiration.",
    "本到期日的净GEX，基于按到期日快照覆盖的梯图 {n}/{m} 个行权价汇总——行权价范围比完整梯图更窄，不仅是到期日范围更窄。",
  ],

  // ── Expiry lens (dropdown + 0DTE chip) ─────────────────────────────────────
  expiryDropdownLabel: ["All expirations", "全部到期日"],
  expiry0Dte:          ["0DTE", "当日到期"],
  expiryLensAria:      ["Expiration lens", "到期日视角"],
  expiryLensZero:      ["0DTE only", "仅当日到期"],
  expiryLensExZero:    ["All except 0DTE", "除当日到期外"],
  expiryLensGroupOne:  ["Single expiration", "单一到期日"],
  // Shown against an expiry the per-strike store cannot answer for.
  expiryLensNoRows:    ["no per-strike data", "无逐行权价数据"],
  // Honest footers under the lens bar — one per state, never a silent fallback.
  expiryAggregateNote: [
    "ladder shows every expiration combined",
    "梯图为全部到期日合计",
  ],
  expiryScopedNote: [
    "per-strike split from the structure snapshot · {n}/{m} strikes covered",
    "逐行权价拆分来自结构快照 · 覆盖 {n}/{m} 个行权价",
  ],
  expiryNoMatrixNote: [
    "per-expiration split not available for this ticker — ladder stays all-expiry",
    "该品种暂无按到期日拆分 — 梯图保持全到期日合计",
  ],
  expiryGammaOnlyNote: [
    "per-expiration split is gamma-only — switch to GEX to use the lens",
    "按到期日拆分仅支持伽马 — 切换到 GEX 使用该视角",
  ],
  expiryDashNote: [
    "— = strike outside the per-expiration snapshot, not a zero",
    "— 表示该行权价不在按到期日快照范围内，并非零值",
  ],

  // ── Net | Call/Put ladder side toggle ──────────────────────────────────────
  sideAria:    ["Ladder side", "梯图方向"],
  sideNet:     ["Net", "净值"],
  sideSplit:   ["Call/Put", "认购/认沽"],
  sideNote: [
    "call/put split is carried all-expiry on gamma only",
    "认购/认沽拆分仅在全到期日的伽马数据中提供",
  ],

  // ── Strike ladder ──────────────────────────────────────────────────────────
  ladderTitle:      ["Strike Ladder", "行权价梯度"],
  // Right-edge level tags. The `…Short` pair is the compact-grid (phone) form, where the
  // tag column is 34px wide.
  ladderCallWall:   ["WALL", "看涨墙"],
  ladderPutSupport: ["SUPPORT", "看跌墙"],
  ladderMagnet:     ["MAGNET", "磁吸"],
  ladderFlip:       ["FLIP", "翻转"],
  ladderCallWallShort:   ["WALL", "涨墙"],
  ladderPutSupportShort: ["SUPP", "跌墙"],
  ladderMagnetShort:     ["MAG", "磁吸"],
  ladderFlipShort:       ["FLIP", "翻转"],
  ladderSpot:       ["SPOT", "现价"],
  ladderNetGex:     ["Net GEX", "净GEX"],
  ladderCallGex:    ["Call GEX", "认购GEX"],
  ladderPutGex:     ["Put GEX", "认沽GEX"],
  ladderStrike:     ["Strike", "行权价"],
  ladderFlipLine:   ["Γ FLIP", "Γ翻转"],
  ladderNoData:     ["No GEX for this ticker yet — indices + liquid single names build nightly", "该品种暂无GEX — 指数与高流动性个股每日夜间构建"],
  ladderLoading:    ["Loading strike ladder…", "加载行权价梯度中…"],

  // ── Market state card ──────────────────────────────────────────────────────
  stateTitle:         ["Market State", "市场状态"],
  stateComputing:     ["State computing — nightly", "状态计算中 — 每日更新"],
  stateRegimeLabel:   ["Regime", "状态"],
  stateStability:     ["Stability", "稳定性"],
  stateGravity:       ["Gravity", "引力"],
  stateGravityUp:     ["up", "向上"],
  stateGravityDown:   ["down", "向下"],
  stateGravityNeutral:["neutral", "中性"],
  statePinTarget:     ["Pin Target", "锁定目标"],
  statePinProb:       ["prob", "概率"],
  statePinNone:       ["—", "—"],
  stateCascadeTrigger:["Cascade Trigger", "瀑布触发"],
  stateUpsideTrigger: ["Upside Trigger", "上行触发"],
  stateRange:         ["Structural Range", "结构区间"],
  stateNetGamma:      ["Net γ", "净伽马"],
  stateGammaPos:      ["POSITIVE", "正值"],
  stateGammaNeg:      ["NEGATIVE", "负值"],
  stateDistToFlip:    ["Dist to flip", "距翻转"],
  stateAboveFlip:     ["above", "上方"],
  stateBelowFlip:     ["below", "下方"],
  // Structural range bar + what-if boxes (were hardcoded English on a bilingual card).
  statePutSupp:       ["PUT SUPP", "看跌墙"],
  stateCallWall:      ["CALL WALL", "看涨墙"],
  stateFlipMark:      ["FLIP", "翻转"],
  stateSpotMark:      ["SPOT", "现价"],
  stateWhatIf:        ["What if flip breaks?", "若翻转位失守？"],
  // γ polarity block
  statePolarity:      ["γ polarity", "伽马极性"],
  statePolarityLong:  ["LONG γ DOMINANT", "多头伽马主导"],
  statePolarityShort: ["SHORT γ DOMINANT", "空头伽马主导"],
  statePolarityCaption: ["Net dealer gamma regime.", "做市商净伽马状态。"],
  // Hedge pressure block
  stateHedgePressure: ["Hedge pressure", "对冲压力"],
  stateHedgeHigh:     ["HIGH", "高"],
  stateHedgeLow:      ["LOW", "低"],
  stateHedgeCaption:  ["Size of dealer hedging flow.", "做市商对冲流的规模。"],
  stateHedgeAbs:      ["|net γ|", "|净伽马|"],
  // Pin target block
  statePinCaption:    ["Strike dealers pin toward.", "做市商倾向锁定的行权价。"],
  // Hover disclosure on the pin probability — a bare "{n}% prob" reads as a calibrated
  // forecast; this states plainly that it is not one yet.
  statePinProbTip: [
    "Model output, not a calibrated probability — display-only until scored against realized pins through a pre-registered gate. No accuracy track record exists yet.",
    "模型输出，并非经过校准的概率——在通过预注册验证并对照实际锁定结果评分之前，仅供展示。目前尚无准确性记录。",
  ],
  stateDistToFlipTip: [
    "Spot's distance from the gamma-flip level, as % of spot. Above the flip = long-gamma (dealers dampen moves — pinning / mean-reversion); below = short-gamma (dealers amplify — trend / cascade risk). The smaller the number, the closer to a regime change.",
    "现价距伽马翻转位的距离（占现价百分比）。翻转位上方=多头伽马（做市商抑制波动——锁定/均值回归）；下方=空头伽马（做市商放大波动——趋势/瀑布风险）。数值越小，越接近状态切换。",
  ],

  // ── Regime names + one-line honest structural theses ──────────────────────
  // These are structural descriptions only — not trade forecasts.
  regimePIN:        ["PIN", "锁定"],
  regimeDRIFT:      ["DRIFT", "漂移"],
  regimeRANGE:      ["RANGE", "区间"],
  regimeTRANSITION: ["TRANSITION", "转变"],
  regimeTREND:      ["TREND", "趋势"],
  regimeCASCADE:    ["CASCADE", "瀑布"],
  regimeUNKNOWN:    ["UNKNOWN", "未知"],

  // One-line structural theses per regime (display-only, not forecasts)
  thesisPIN:        [
    "Strong dealer positioning near magnet — bounded range structure.",
    "做市商持仓集中于磁吸附近，区间结构稳固。",
  ],
  thesisDRIFT:      [
    "Saturated positive gamma — passive positioning, pinning weaker.",
    "正伽马饱和，被动持仓，锁定效果趋弱。",
  ],
  thesisRANGE:      [
    "Positive gamma dominant — mean-reverting structure between walls.",
    "正伽马主导，两墙之间均值回归结构。",
  ],
  thesisTRANSITION: [
    "Near gamma flip — structural sensitivity elevated, regime shift possible.",
    "接近伽马翻转，结构敏感性上升，可能发生状态切换。",
  ],
  thesisTREND:      [
    "Negative gamma — dealer hedging amplifies moves directionally.",
    "负伽马，做市商对冲放大单边走势。",
  ],
  thesisCASCADE:    [
    "Deep negative gamma — sharp move amplification likely near limit breaks.",
    "深度负伽马，关键位突破时跌势放大风险上升。",
  ],
  thesisUNKNOWN:    [
    "Insufficient chain data for regime classification.",
    "链条数据不足，无法分类状态。",
  ],

  // ── Passport / honesty caveat chips (non-negotiable display) ──────────────
  passportIndex:    [
    "Levels map — dealer-sign assumed; display-only",
    "水平图 — 假定做市商符号；仅供展示",
  ],
  passportSingleName: [
    "Single-name GEX — regime is a near-constant product attribute, not a time-varying signal",
    "个股GEX — 状态为近似固定的产品属性，非实时信号",
  ],
  passportGate:     [
    "Forward-vol gate: display-only until ~Sept 2026",
    "前向波动率验证中：~2026年9月前仅供展示",
  ],

  // ── GEX Guide ─────────────────────────────────────────────────────────────
  guideTitle:       ["How to Read GEX", "如何解读GEX"],
  guideToggleOpen:  ["How to Read ▼", "解读指南 ▼"],
  guideToggleClose: ["How to Read ▲", "解读指南 ▲"],

  guideGexTerm:   ["GEX (Gamma Exposure)", "GEX（伽马敞口）"],
  guideGexBody:   [
    "A map of where the largest options positions sit and where dealer hedging activity concentrates. Sign is the standard dealer convention (calls +, puts −) — an assumption, not a measured fact. Magnitude is the reliable read.",
    "显示最大期权持仓的分布图，以及做市商对冲活动的集中区域。符号遵循标准做市商惯例（认购为正，认沽为负）——这是假设而非实测事实。数量级才是可靠的读数。",
  ],
  guideCallWallTerm: ["Call Wall", "看涨墙"],
  guideCallWallBody: [
    "The strike with the strongest call-side dealer gamma above spot. Price movement toward this level faces concentrated hedge-driven supply. A descriptive level — not a forecast of reversal.",
    "现价上方认购端做市商伽马最强的行权价。价格向该水平运动时，面临集中的对冲驱动抛压。这是一个描述性水平，而非反转预测。",
  ],
  guidePutSupportTerm: ["Put Support", "看跌墙"],
  guidePutSupportBody: [
    "The strike with the strongest put-side dealer gamma below spot. Describes where hedge-driven demand concentrates on the downside. A descriptive level — not a forecast of bounce.",
    "现价下方认沽端做市商伽马最强的行权价。描述下行时对冲驱动需求的集中区域。这是一个描述性水平，而非反弹预测。",
  ],
  guideMagnetTerm: ["Magnet / HVL", "磁吸 / 高量位"],
  guideMagnetBody: [
    "The High-Volume Level — the strike between the walls with the highest combined OI and gamma proximity to spot. Historically shows price clustering in positive-gamma regimes. Display-only until gauntleted.",
    "高量位 — 两墙之间对现价综合持仓量与伽马最大的行权价。在正伽马状态下历史上显示出价格聚集效应。正式验证前仅供展示。",
  ],
  guideFlipTerm: ["Gamma Flip", "伽马翻转"],
  guideFlipBody: [
    "The estimated price level where net dealer gamma changes sign. Above it, dealer hedging is conventionally stabilizing (positive gamma). Below it, hedging conventionally amplifies moves (negative gamma). Method: zero-crossing of the GEX profile curve — an approximation with acknowledged error bounds.",
    "净做市商伽马符号改变的估算价格水平。该水平以上，做市商对冲通常起稳定作用（正伽马）；以下则通常放大波动（负伽马）。方法：GEX曲线零交叉点估算——为近似值，存在已知误差范围。",
  ],
  guideRegimeTerm: ["Regime States", "状态分类"],
  guideRegimeBody: [
    "PIN / DRIFT / RANGE: positive gamma regimes — structural tendency toward bounded, mean-reverting price action. TRANSITION: near the flip — elevated sensitivity. TREND / CASCADE: negative gamma regimes — moves potentially amplified. These are structural descriptions, not forecasts.",
    "PIN / DRIFT / RANGE：正伽马状态——结构上趋向有界均值回归走势。TRANSITION：接近翻转点——敏感性上升。TREND / CASCADE：负伽马状态——走势可能被放大。以上均为结构性描述，非价格预测。",
  ],
  guideDealerSignTerm: ["Dealer-Sign Assumption", "做市商符号假设"],
  guideDealerSignBody: [
    "All GEX calculations assume dealers sold the options in the chain (standard convention). If significant dealer-long positioning exists (e.g. bought protection), the sign assumption fails and all derived levels invert. This is a known limitation of all publicly-available GEX products. Single-name GEX is especially fragile — regime classification may be near-constant rather than dynamic.",
    "所有GEX计算均假设做市商卖出了链中期权（标准惯例）。若存在大量做市商净多持仓（如购买保护），符号假设失效，所有衍生水平将反转。这是所有公开GEX产品的已知局限。个股GEX尤为脆弱——状态分类可能近似为固定值而非动态变化。",
  ],

  // ── Loading / error / placeholder states ──────────────────────────────────
  loading:         ["Loading…", "加载中…"],
  loadingGex:      ["Loading GEX data…", "加载GEX数据中…"],
  errorGex:        ["Could not load GEX data", "无法加载GEX数据"],
  errorRetry:      ["Retry", "重试"],
  noGexData:       ["No GEX data for this ticker", "该品种暂无GEX数据"],
  stateAbsent:     ["State computing — nightly", "状态计算中 — 每日更新"],
  // An empty desk must name WHICH emptiness it is. Upstream reality: the nightly
  // options build re-pulls the index anchors first, so a single name can be missing
  // from a snapshot outright — that is a coverage gap, not a broken ticker.
  gexNoSnapshot:   ["No strike snapshot for this name yet", "该品种暂无逐行权价快照"],
  gexNoSnapshotWhy: [
    "{sym} isn't in this nightly build — index anchors and the most liquid single names publish first.",
    "本次夜间构建中没有 {sym} — 指数锚定品种与流动性最高的个股优先发布。",
  ],

  // ── Tooltip / hover labels ─────────────────────────────────────────────────
  tooltipNetGex:   ["Net GEX", "净GEX"],
  tooltipCallGex:  ["Call GEX", "认购GEX"],
  tooltipPutGex:   ["Put GEX", "认沽GEX"],
  tooltipTotalOi:  ["Total OI", "总持仓"],
  tooltipCallOi:   ["Call OI", "认购持仓"],
  tooltipPutOi:    ["Put OI", "认沽持仓"],

  // ── Walls chip row + range presets + NOW|PEAK scale (Wave-1 ladder upgrades) ──
  ladderWallsNet:  ["NET GEX", "净GEX"],
  ladderWallsFlip: ["FLIP", "翻转"],
  ladderWallsCall: ["C WALL", "认购墙"],
  ladderWallsPut:  ["P WALL", "认沽墙"],
  rangePresetAria: ["Strike range", "行权价范围"],
  rangeAll:        ["All", "全部"],
  // Bar normalization (B1). Both bases are the SAME quantity as the bars — per-strike
  // exposure under the active greek + expiry lens. The old PEAK divided per-strike bars
  // by the session's AGGREGATE net in billions; bars collapsed (fixtures) or saturated
  // (live). Never normalize one quantity against another.
  scaleAria:       ["Bar scale", "柱状刻度"],
  scaleNow:        ["NOW", "当前"],
  scalePeak:       ["LADDER MAX", "全梯最大"],
  scalePeakNote:   [
    "NOW scales bars to the biggest strike on screen; LADDER MAX to the biggest in the whole ladder, so the range presets don't rescale them.",
    "「当前」以屏幕内最大的行权价归一化柱状图；「全梯最大」以整个梯图的最大值归一化，切换范围时刻度不变。",
  ],
  expiryBreakdownTitle: ["Top expiries", "主要到期日"],
  expiryBreakdownNote:  ["per-expiry net-γ share", "按到期日净伽马占比"],

  // ── Data freshness ─────────────────────────────────────────────────────────
  asOf:            ["as of", "更新于"],
  lastSession:     ["last session", "上一交易日"],
  daysOld:         ["{n}d old", "{n}天前"],
  dataEod:         ["EOD", "收盘数据"],
  dataIntraday:    ["intraday", "盘中"],

  // ── Exposure-by-Expiry term-structure drawer (Wave 2E, RECON §4.5) ──────────
  xdrawerTitle:    ["Exposure by expiry", "各到期日敞口"],
  xdrawerExp:      ["exp", "到期"],
  xdrawerBubbles:  ["Bubbles", "气泡"],
  xdrawerBars:     ["Bars", "柱状"],
  xdrawerViewAria: ["Term-structure view", "期限结构视图"],
  xdrawerNet:      ["Net", "净"],
  xdrawerNetOnly:  [
    "Net only — the payload carries no call/put split per expiration. EOD structural read, not intraday.",
    "仅净值——数据未按到期日提供认购/认沽拆分。收盘结构快照，非盘中。",
  ],
  xdrawerNA:       [
    "Vanna & Charm aren't provided per-expiration yet — gamma & delta only.",
    "Vanna 与 Charm 暂未提供按到期日数据 — 仅伽马与德尔塔。",
  ],
  xdrawerEmpty:    ["No expiration breakdown for this ticker yet.", "该品种暂无按到期日数据。"],

  // ── GEX history strip (net-GEX trend over recent sessions, from the EOD surface) ──
  gexHistTitle:    ["Net GEX — history", "净GEX — 历史"],
  gexHistSessions: ["sessions", "个交易日"],
  gexHistAria:     ["Net gamma exposure across recent sessions", "近期交易日的净伽马敞口"],
  gexHistLatest:   ["Latest", "最新"],
  gexHistFlip:     ["Flip", "翻转点"],
  // Slice 2 — session scrubber. The sparkline becomes a scrub track; these label the
  // per-session read-out. γ-polarity chips are compact forms of the history `regime` field
  // (long/short γ), shown only alongside the net value + its Δ + the sparkline (never bare).
  gexHistScrubHint:   ["drag · ← → keys", "拖动 · ← → 键"],
  gexHistNow:         ["now", "当前"],
  gexHistRegimeLong:  ["long γ", "多头γ"],
  gexHistRegimeShort: ["short γ", "空头γ"],
  gexHistRegimeFlat:  ["flat γ", "中性γ"],
  gexHistShift:       ["γ-polarity shifted this session", "本交易日γ极性发生切换"],
  // Honest-thin state. The strip used to return null and vanish from the page when the
  // archive held fewer than two sessions — it now keeps its header and names the condition.
  gexHistThin:        ["Only {n} settled session on file", "仅有 {n} 个已结算交易日"],
  gexHistThinNone:    ["No settled sessions on file yet", "暂无已结算交易日"],
  gexHistThinWhy:     [
    "The history strip needs at least two archived sessions to draw a trend.",
    "历史条形图需要至少两个已归档交易日才能绘制趋势。",
  ],

  // ── Dated session replay (R0.10) — full-ladder date picker on the scrubber ──
  // The scalar scrubber above gains a load path into options_hub/gex_history/{ROOT}/{DATE}:
  // the FULL by-strike ladder exactly as the desk published it that session. Honesty: the
  // history plane has accrual holes (sessions that were never published) — a missing date
  // gets its own named state, never today's ladder wearing an archived label.
  sessionPickerAria:  ["Archived session", "已归档交易日"],
  sessionLive:        ["Latest (live)", "最新（当前）"],
  archivedChip:       ["archived session · {date}", "已归档交易日 · {date}"],
  backToLive:         ["Back to latest", "返回最新"],
  loadFullLadder:     ["Load full ladder", "加载完整梯图"],
  viewingSession:     ["viewing", "正在查看"],
  archivedLoading:    ["Loading archived session…", "加载已归档交易日中…"],
  archivedMissingTitle: ["No archived snapshot for {date}", "{date} 无已归档快照"],
  archivedMissingWhy: [
    "This session was never published to the ladder history plane — an archive gap, not a data error. Pick another date or return to the latest session.",
    "该交易日的完整梯图未发布到历史层——属于归档缺口，并非数据错误。请选择其他日期或返回最新交易日。",
  ],
  archivedMatrixTitle: ["Matrix unavailable while replaying", "回放时矩阵不可用"],
  archivedMatrixNote:  [
    "The strike × expiry matrix is a current-session store with no dated twin — showing today's grid under an archived session would be the cross-session mix replay mode exists to prevent. Return to the latest session to use it.",
    "行权价×到期日矩阵仅有当前交易日数据，没有对应的历史快照——在已归档交易日下显示今日网格，正是回放模式要避免的跨交易日混用。请返回最新交易日后使用。",
  ],
  archivedPaneTitle:  ["Archived session", "已归档交易日"],
  archivedPaneNote:   [
    "Market state and the EOD context belt describe the current session only — hidden while replaying an archived ladder.",
    "市场状态与收盘背景条仅描述当前交易日——回放已归档梯图时予以隐藏。",
  ],

  // ══ §5.3 — the matrix view, merged in from the retired PRISM tab ═══════════
  // Copy moved from components/prism/prismStrings.ts with its zh translations intact.
  // The PRISM lens names (GEX/VEX/UNUSUAL) did NOT come with it: the matrix now speaks
  // the same net-hedge metric set as the Positioning tab's card, because both render
  // through components/shared/StrikeExpiryMatrix.

  // ── View switcher ──────────────────────────────────────────────────────────
  viewMatrix:      ["Matrix", "矩阵"],
  viewMatrixFull:  ["Strike × expiry matrix", "行权价 × 到期日矩阵"],

  // ── Matrix metric chips (mirror the Positioning card's metric set) ─────────
  mtxMetricHedge:  ["Net hedge", "净对冲"],
  mtxMetricOi:     ["OI", "未平仓"],
  mtxMetricVol:    ["Volume", "成交量"],
  mtxMetricDoi:    ["ΔOI", "ΔOI"],
  mtxMetricAria:   ["Matrix metric", "矩阵指标"],

  // ── Matrix controls ────────────────────────────────────────────────────────
  mtxColsLabel:    ["COLS", "列数"],
  mtxColsAria:     ["Expiry column count", "到期日列数"],
  scopeDefault:    ["DEFAULT", "默认"],
  scope0dte:       ["0DTE", "0DTE"],
  scopeAll:        ["ALL Σ", "全部Σ"],
  mtxScopeAria:    ["Expiry scope", "到期日范围"],
  // Windows are PERCENT of spot. Scaled to a prod ladder, not to the thin fixture: a
  // real SPY chain runs ~281 strikes at $1 over roughly ±19%, so ±20%/±40% both clamped
  // to the WHOLE ladder and rendered the identical $5-bucket grid. ±3/±6/±12 keep three
  // genuinely different reads, and ±3% lands native $1 resolution inside DESK_MAX_ROWS.
  range3:          ["±3%", "±3%"],
  range6:          ["±6%", "±6%"],
  range12:         ["±12%", "±12%"],
  strikeRangeLabel:["RANGE", "区间"],
  mtxRangeAria:    ["Strike window around spot", "现价周边行权价区间"],
  normColumn:      ["PER-COL", "按列"],
  normGlobal:      ["GLOBAL", "全局"],
  mtxNormAria:     ["Colour normalization", "配色归一化"],

  // ── Matrix column headers / legend ─────────────────────────────────────────
  colStrike:       ["Strike", "行权价"],
  colSpotPct:      ["% from Spot", "距现价%"],
  mtxSigmaAria:    ["Sum across the visible expirations", "可见到期日合计"],
  legendTitle:     ["Level markers", "关键价位标记"],
  spotLabel:       ["Spot", "现价"],

  // ── Level badges (strike-row markers) ──────────────────────────────────────
  levelWall:       ["WALL", "看涨墙"],
  levelSupport:    ["SUPPORT", "看跌墙"],
  levelFlip:       ["FLIP", "翻转"],
  levelMagnet:     ["MAGNET", "磁吸"],
  levelMaxPain:    ["MAX PAIN", "最大痛苦"],
  levelSpot:       ["SPOT", "现价"],

  // ── Matrix honesty copy ────────────────────────────────────────────────────
  // The matrix store is nightly EOD — never dressed in live chrome. This chip states
  // the session the CELLS describe, which is not always the ladder's own session.
  mtxAsOfLabel:    ["Matrix session", "矩阵交易日"],
  mtxEodNote:      [
    "Nightly end-of-day snapshot — not a live feed.",
    "每晚收盘快照——非实时数据。",
  ],
  mtxHedgeLegend:  [
    "Cells are net dealer hedge per +1% spot ($mn) — a transaction side, not a price direction.",
    "单元格为每上涨1%的做市商净对冲额（百万美元）——表示交易方向，而非价格涨跌。",
  ],
  mtxDoiLegend:    [
    "PIT: OI[t-1] − OI[t-2] — contracts added vs removed, per cell.",
    "定点快照：OI[t-1]−OI[t-2] — 每格新增与减少的合约数。",
  ],
  mtxMagLegend:    [
    "Magnitude only — call + put, in contracts. Not call/put-signed.",
    "仅数量级 — 认购+认沽，单位：张。不区分认购/认沽方向。",
  ],
  mtxWindow:       [
    "±{p}% of spot · {n} of {full} strikes · {e} expirations",
    "现价±{p}% · {full}个行权价中的{n}个 · {e}个到期日",
  ],
  mtxBucket:       ["strikes summed into {b}-wide rows", "行权价按 {b} 宽度归并为行"],
  mtxMoreExp:      ["+{n} later expirations not shown", "另有 {n} 个较远到期日未显示"],
  mtxNone:         [
    "No strike × expiry matrix published for this root.",
    "该品种暂无行权价×到期日矩阵数据。",
  ],

  // ── Exact-side settled-volume rail ────────────────────────────────────────
  // This is an annotation over RAW contracts, not a fifth matrix lens. The heatmap
  // continues to aggregate call+put and strike buckets exactly as before.
  mtxUnusualAria:  ["Exact-side EOD volume baseline", "逐边收盘成交量基线"],
  mtxUnusualTitle: ["Exact-side EOD baseline", "逐边收盘基线"],
  mtxUnusualRule:  ["3× exact-side median · 10–30 observed days", "逐边中位数3倍 · 10–30个观测日"],
  mtxUnusualAuthority: ["DISPLAY ONLY", "仅供展示"],
  mtxUnusualExactNote: [
    "All published expiries · raw cells · independent of heatmap controls.",
    "覆盖全部已发布到期日 · 原始单元格 · 独立于热图控制项。",
  ],
  mtxUnusualCall:  ["CALL", "认购"],
  mtxUnusualPut:   ["PUT", "认沽"],
  mtxUnusualReceiptUnusual: ["UNUSUAL", "异常"],
  mtxUnusualReceiptNormal: ["NORMAL", "正常"],
  mtxUnusualReceiptUnavailable: ["UNAVAILABLE", "不可用"],
  mtxUnusualReceiptWithheld: ["WITHHELD", "已隐藏"],
  mtxUnusualCurrent: ["vol", "成交"],
  mtxUnusualMedian:  ["median", "中位数"],
  mtxUnusualSamples: ["observed days", "观测日"],
  mtxUnusualFlagged: ["{n} exact contracts flagged", "{n}个精确合约触发"],
  mtxUnusualUnavailable: [
    "Baseline not published for this matrix session.",
    "本矩阵交易日尚未发布基线。",
  ],
  mtxUnusualInsufficient: [
    "Baseline present · no side published an eligible exact-contract baseline.",
    "基线已接入 · 暂无逐边合约发布合格基线。",
  ],
  mtxUnusualClear: [
    "Eligible baselines present · no exact side reached 3×.",
    "已有合格基线 · 暂无逐边合约达到3倍。",
  ],
  mtxUnusualMalformed: [
    "Baseline fields invalid · unusual read withheld.",
    "基线字段无效 · 已隐藏异常读数。",
  ],
  magnitudeFirst:  [
    "Sign is an assumption, not a fact. Magnitude is the reliable read.",
    "符号为假设而非事实。数量级才是可靠读数。",
  ],
  descriptiveOnly: [
    "Descriptive — not a recommendation. Index complex only.",
    "仅供描述 — 非交易建议。仅限指数组合。",
  ],

  // ── Confluence (SPY + QQQ + IWM), ported from prism/ConfluenceView ─────────
  modeSingle:         ["SINGLE", "单品种"],
  modeConfluence:     ["CONFLUENCE", "联合"],
  mtxModeAria:        ["Matrix mode", "矩阵模式"],
  confluenceTitle:    ["Confluence", "联合视图"],
  confluenceNote:     [
    "Strikes normalized to % from spot — index-only, descriptive. This is not a trading signal.",
    "行权价以距现价百分比表示 — 仅限指数，仅供描述。这不是交易信号。",
  ],
  confluenceAligned:  ["levels aligned — index complex", "水平对齐 — 指数组合"],
  confluence2of3:     ["2/3 aligned", "2/3对齐"],
  confluence3of3:     ["3/3 aligned", "3/3对齐"],
  confluenceEmpty:    [
    "No alignment detected across indices at this metric.",
    "当前指标下指数间未检测到对齐。",
  ],

  // ── HeatSeeker card, ported from prism/HeatSeekerCard ─────────────────────
  heatSeekerTitle:      ["HeatSeeker Pick", "热点精选"],
  heatSeekerDisclaimer: [
    "descriptive — not a recommendation",
    "仅供描述 — 非交易建议",
  ],
  heatSeekerExpiry:     ["Expiry", "到期日"],
  heatSeekerRatio:      ["Standout ratio", "突出比率"],
  // The engine field is a 0..1 FRACTION rendered as a percent — the unit rides the
  // label so the bare ring numeral can never be misread as a tier or a raw score.
  heatSeekerConfUnit:   ["Confidence %", "置信度 %"],
  heatSeekerFromSpot:   ["from spot", "距现价"],
  heatSeekerNull:       [
    "No standout pick — load is shared across levels.",
    "无突出精选 — 仓位分布于多个价位。",
  ],
  // A DIFFERENT fact from "no pick": the build published one, but it expired on or before
  // the session this snapshot describes. Saying "load is shared" there would be a guess.
  heatSeekerStale:      [
    "The published pick expired within this snapshot's session — nothing current to show.",
    "已发布的精选在本快照交易日内已到期 — 暂无有效标的。",
  ],
  // SVG aria-label for the expiry term-structure chart
  exposureByExpiry: ["Exposure by expiry term structure", "按到期期限结构显示敞口"],
  // Exact-side receipt states for aria-label
  mtxReceiptLoading: ["Loading…", "加载中……"],
  mtxReceiptNoData: ["No data", "暂无数据"],
  mtxReceiptStale: ["Stale", "数据过期"],
  mtxReceiptError: ["Error", "错误"],
  mtxReceiptFlagged: ["Flagged: {n}", "已标记：{n}"],
  mtxReceiptUnknown: ["Unknown", "未知"],
} as const;

type GexDeskKey = keyof typeof GEX_LEX;

export function getGexStr(lang: Lang, key: GexDeskKey): string {
  const entry = GEX_LEX[key as keyof typeof GEX_LEX];
  if (!entry) return "";
  return lang === "zh" ? entry[1] : entry[0];
}

export function makeGexT(lang: Lang): (key: GexDeskKey) => string {
  return (key: GexDeskKey) => getGexStr(lang, key);
}

export type { GexDeskKey };
