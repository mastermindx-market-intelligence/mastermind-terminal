/**
 * eodStrings.ts — bilingual EN/ZH string table for the EOD context belt (OEU T-E).
 *
 * Pattern matches gexStrings.ts / flowdeskStrings.ts: each key maps to [English, 中文].
 *
 * PROVENANCE OF THE WORDS
 *   The dark-pool lean labels, stances and reads below are the macro darkpool page's OWN
 *   published copy (macro `engine/darkpool_context.py`), carried across verbatim in both
 *   languages. Two estates must not describe the same footprint with different words. Copy
 *   marked "(T-E)" is new to this surface — it exists only where macro has no counterpart
 *   (the Terminal-only belt chrome, and the per-name "covered but not a standout" state,
 *   which macro's desk expresses by simply not tagging the row).
 *
 * HONESTY DOCTRINE (enforced here):
 *   - Everything on this belt is SETTLED CLOSE data sitting beside live surfaces. The
 *     cadence boundary is stated in chrome and stamped on every value.
 *   - Dark-pool leans are positioning context, never a trade call — the disclaimer ships
 *     with the panel, not in a footnote nobody opens.
 *   - "Not covered" (macro's panel has no row) and "unavailable" (the feed itself is
 *     missing) are different sentences, because they are different facts.
 *   - No "validated", no forecast language, no re-derived vocabulary.
 *
 * NOTE: translated strings MUST NOT appear in HTML title= attributes (CI-guarded).
 * Use aria-label or visible text spans instead.
 */

import type { Lang } from "@/lib/i18n";

const EOD_LEX = {
  // ── Belt chrome (T-E) ──────────────────────────────────────────────────────
  beltTitle:      ["EOD structure", "收盘结构"],
  // Same idiom as the replay spine's "EOD structure — not replayed" tag (#205): one line
  // that names the cadence boundary instead of letting the reader assume it is live.
  beltTag:        ["settled close — not live", "结算收盘 — 非实时"],
  beltAria:       ["End-of-day options structure context", "收盘期权结构背景"],
  // {d} = the SOURCE STORE's own session date, per value.
  eodStamp:       ["EOD · {d}", "收盘 · {d}"],
  eodStampNone:   ["EOD · date unknown", "收盘 · 日期未知"],
  beltEmpty: [
    "No settled structure published for this ticker yet — indices and liquid single names build nightly.",
    "该品种暂无已结算的结构数据 — 指数与高流动性个股每晚构建。",
  ],

  // ── Structure cells ────────────────────────────────────────────────────────
  cellCallWall:   ["Call wall", "看涨墙"],
  cellPutWall:    ["Put wall", "看跌墙"],
  cellFlip:       ["Gamma flip", "伽马翻转"],
  cellExpMove:    ["Expected move", "预期波动"],
  cellMaxPain:    ["Max pain", "最大痛苦点"],
  cellIvPct:      ["IV percentile", "IV 百分位"],
  cellOiConf:     ["OI confirmed", "持仓确认"],
  cellAbsent:     ["—", "—"],
  cellAbsentNote: ["not published", "未发布"],

  // Per-cell hovers (Tier-2). Numbers and their meaning live here; the belt stays glanceable.
  tipCallWall: [
    "Strongest call-side dealer gamma above spot at the close. A descriptive level, not a forecast of reversal.",
    "收盘时现价上方认购端做市商伽马最强的价位。描述性水平，并非反转预测。",
  ],
  tipPutWall: [
    "Strongest put-side dealer gamma below spot at the close. A descriptive level, not a forecast of a bounce.",
    "收盘时现价下方认沽端做市商伽马最强的价位。描述性水平，并非反弹预测。",
  ],
  tipFlip: [
    "Where net dealer gamma changed sign at the close. Above it, hedging conventionally dampens moves; below, it amplifies them. Dealer-sign is an assumption.",
    "收盘时做市商净伽马变号的位置。该位之上，对冲通常抑制波动；之下则放大波动。做市商符号为假设。",
  ],
  tipExpMove: [
    "The options market's own priced move for the next session, from ATM implied vol — a band, not a target. Positioning context, not a forecast.",
    "由平值隐含波动率得出的、期权市场为下一交易日定价的波动区间——是区间而非目标。仅为仓位背景，非预测。",
  ],
  tipMaxPain: [
    "The strike where the most open contracts would expire worthless. Published by the structure snapshot; display-only.",
    "使最多未平仓合约到期归零的行权价。基于最新的已结算结构数据。",
  ],
  tipIvPct: [
    "Where this name's at-the-money implied vol sits within its own range over the past trading year. High = its options are dear for this name, not dear in absolute terms.",
    "该标的平值隐含波动率在其过去一个交易年区间中的位置。数值高=相对该股自身而言期权偏贵，并非绝对昂贵。",
  ],
  tipOiConf: [
    "How many of the prior session's large trades were backed by an overnight open-interest build — i.e. new positions, not closed ones.",
    "上一交易日有多少笔大额成交被隔夜未平仓量增加所印证——即新开仓而非平仓。",
  ],
  // The two stores can run different sessions; the fallback is disclosed, never silent.
  srcFallback:    ["from the options ladder", "取自期权梯图"],

  // ── Dark Pool mini-panel ───────────────────────────────────────────────────
  dpTitle:        ["Dark pool", "暗池"],
  dpSubtitle:     ["Off-exchange share vs its own norm", "场外成交占比 vs 自身常态"],
  dpAria:         ["Dark pool positioning context", "暗池仓位背景"],
  // Carried from the macro darkpool page's standing disclaimer line.
  dpDisclaimer:   ["Positioning context, not a trade call.", "仓位背景，非交易信号。"],
  dpOeShare:      ["Off-exchange", "场外占比"],
  dpVsNorm:       ["vs its norm", "vs 常态"],
  dpShortMark:    ["Short-marked selling", "卖空标记"],
  dpDays:         ["{n} matched days", "{n} 个匹配交易日"],
  dpFewDays:      ["short history", "历史较短"],

  // Lean labels — macro `_LEAN_LABEL`, verbatim.
  dpLeanAccumulation: ["Quiet accumulation", "悄然吸筹"],
  dpLeanDistribution: ["Distribution pressure", "派发压力"],
  dpLeanUnusual:      ["Unusual, unclear", "异常但方向不明"],
  // Lean stances — macro `_LEAN_STANCE`, verbatim.
  dpStanceAccumulation: ["Watch — don't chase", "观察——勿追高"],
  dpStanceDistribution: ["Watch for weakness", "留意走弱"],
  dpStanceUnusual:      ["Watch closely", "密切观察"],
  // Per-name reads — macro `_name_read`, verbatim.
  dpReadAccumulation: [
    "Heavy dark footprint and short-marked selling backing off — a quiet-accumulation lean.",
    "暗池痕迹沉重、卖空标记回落——偏向悄然吸筹。",
  ],
  dpReadDistribution: [
    "Dark volume elevated and short-marked selling climbing fast — a distribution lean.",
    "暗池成交偏高、卖空标记快速攀升——偏向派发。",
  ],
  dpReadUnusual: [
    "Dark volume well above its norm with mixed short-marking — heavy activity, direction unclear.",
    "暗池成交远高于常态、卖空标记不一——异动明显，方向不明。",
  ],

  // "vs own norm" bands — macro `_norm_label`, plus an at-norm word macro has no cell for.
  dpNormFar:      ["Far above", "远超常态"],
  dpNormWell:     ["Well above", "明显高于"],
  dpNormAbove:    ["Above", "高于常态"],
  dpNormAt:       ["At its norm", "处于常态"],

  // Short-marking reads — macro `_short_label`, verbatim ({n} = the pp magnitude).
  dpShortBuilding: ["Building ▲{n}pp", "上升 ▲{n}pp"],
  dpShortFading:   ["Fading ▼{n}pp", "回落 ▼{n}pp"],
  dpShortLight:    ["Light vs norm", "低于常态"],
  dpShortHeavy:    ["Heavy vs norm", "高于常态"],
  dpShortNormal:   ["About normal", "大致正常"],

  // Covered, but not a standout (T-E — macro's desk expresses this by not tagging the row).
  dpQuietLabel:   ["Nothing unusual", "无异常"],
  dpQuietRead: [
    "Off-exchange share is inside this name's normal range — no unusual dark activity to read.",
    "场外占比处于该股常态区间——暂无异常暗池活动可读。",
  ],

  // The two absent states, kept distinct because they are different facts.
  dpNotCovered:   ["{root} isn't in the off-exchange panel", "{root} 不在场外成交面板中"],
  dpNotCoveredWhy: [
    "The panel is built from FINRA facility reporting over a fixed list of names — ETFs and thinner tickers aren't in it.",
    "该面板基于 FINRA 设施上报数据、覆盖固定的个股名单构建——ETF 与流动性较弱的代码不在其中。",
  ],
  dpUnavailable:  ["Off-exchange panel unavailable", "场外成交面板不可用"],
  dpUnavailableWhy: [
    "Dark-pool data for the latest settled close isn't available yet. We don't estimate a replacement.",
    "已结算的暗池数据尚未发布。此处不会以任何估算值替代。",
  ],

  // ── Vol regime chip ────────────────────────────────────────────────────────
  volChipLabel:   ["Vol", "波动率"],
  volChipAria:    ["Market volatility regime", "市场波动率体制"],
  volChipAbsent:  ["Vol regime unavailable", "波动率体制不可用"],
  volChipAbsentWhy: [
    "Volatility-regime data for the latest settled close isn't available yet.",
    "已结算的波动率体制数据尚未发布。",
  ],
  volChipCadence: ["Index vol regime · settled close", "指数波动率体制 · 结算收盘"],
} as const;

type EodKey = keyof typeof EOD_LEX;

export function getEodStr(lang: Lang, key: EodKey): string {
  const entry = EOD_LEX[key];
  if (!entry) return "";
  return lang === "zh" ? entry[1] : entry[0];
}

export function makeEodT(lang: Lang): (key: EodKey) => string {
  return (key: EodKey) => getEodStr(lang, key);
}

export type { EodKey };
