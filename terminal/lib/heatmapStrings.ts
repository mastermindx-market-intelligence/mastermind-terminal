/**
 * heatmapStrings.ts — EN/ZH string table for the Heatmap surface.
 *
 * HONESTY DOCTRINE:
 *   - GEX regime: display-only until forward-vol gate (~Sept 2026); caveat shown.
 *   - Flow direction / tone: soft — magnitude headlines, direction dead-zoned.
 *   - No "validated" / predictive copy.
 *   - Single-name GEX regime: near-constant product attribute, not a signal.
 *   - No translated text in title= attributes (CI-guarded).
 */

import type { Lang } from "@/lib/i18n";

const HM_LEX = {
  // ── Page / tab ──────────────────────────────────────────────────────────────
  pageTitle:        ["Heatmap", "热力图"],
  pageSubtitle:     ["Dual-layer market view — PRICE & FLOW", "市场双层视图 — 价格与资金流"],

  // ── Layer toggle ────────────────────────────────────────────────────────────
  layerPrice:       ["PRICE", "价格"],
  layerFlow:        ["FLOW", "资金流"],

  // ── View toggle ─────────────────────────────────────────────────────────────
  viewMap:          ["MAP", "热力图"],
  viewTable:        ["TABLE", "列表"],

  // ── Sizing modes ─────────────────────────────────────────────────────────────
  sizeCap:          ["CAP", "市值"],
  sizeEqual:        ["EQUAL", "等面积"],
  sizeCapDeferred:  ["CAP (soon)", "市值（即将上线）"],
  sizePremium:      ["PREMIUM", "权利金"],

  // ── Timeframes ───────────────────────────────────────────────────────────────
  tf1D:             ["1D", "1日"],
  tf1W:             ["1W (accruing)", "1周（积累中）"],
  tf1M:             ["1M (accruing)", "1月（积累中）"],
  tfYTD:            ["YTD (accruing)", "年初至今（积累中）"],
  tfAccruingTip:    ["Broader universe accruing — expanding nightly", "更广泛数据积累中，每日扩展"],

  // ── Breadth strip ────────────────────────────────────────────────────────────
  advancers:        ["Adv", "上涨"],
  decliners:        ["Dec", "下跌"],
  totalPremium:     ["Total premium", "总权利金"],
  magnitudeOnly:    ["magnitude only", "仅规模"],
  netPut:           ["net put", "净认沽"],
  premiumSize:      ["premium size", "权利金规模"],
  netCall:          ["net call", "净认购"],
  directionIsSoft:  ["direction is soft", "方向为软性读数"],
  bullFlow:         ["Bull flow", "偏多流向"],
  bullFlowTip:      ["Share of active-flow names with net-bullish ΔOI (breadth, not premium share)", "净持仓变化偏多的活跃标的占比（广度，非权利金占比）"],
  mixedZone:        ["MIXED", "混合"],
  callHeavy:        ["CALL-HEAVY", "以认购为主"],
  putHeavy:         ["PUT-HEAVY", "以认沽为主"],
  priceMode:        ["Mode", "市场状态"],
  bullish:          ["BULLISH", "偏多"],
  bearish:          ["BEARISH", "偏空"],
  mixed:            ["MIXED", "混合"],

  // ── Flow tone labels (magnitude-first, direction soft) ───────────────────────
  tonePos:          ["positive tone (~soft)", "积极倾向（~软性）"],
  toneNeg:          ["negative tone (~soft)", "消极倾向（~软性）"],
  toneNeutral:      ["neutral / mixed", "中性 / 混合"],
  toneSoftNote:     ["Positioning tone from ΔOI — direction is soft (magnitude reliable)", "基于ΔOI的持仓倾向 — 方向为软性读数，权利金规模可靠"],

  // ── Sector labels ────────────────────────────────────────────────────────────
  sectorAll:        ["ALL", "全部"],
  sectorTech:       ["TECH", "科技"],
  sectorComm:       ["COMM", "通信"],
  sectorConsDisc:   ["CONS DISC", "非必需消费"],
  sectorConsStaple: ["STAPLES", "必需消费"],
  sectorFinance:    ["FINANCE", "金融"],
  sectorHealth:     ["HEALTH", "医疗"],
  sectorEnergy:     ["ENERGY", "能源"],
  sectorIndustrial: ["INDUSTRIAL", "工业"],
  sectorMaterials:  ["MATERIALS", "材料"],
  sectorUtilities:  ["UTILITIES", "公用事业"],
  sectorRealEstate: ["REAL EST", "房地产"],
  sectorCrypto:     ["CRYPTO", "加密货币"],
  sectorETF:        ["ETF", "ETF"],
  sectorOther:      ["OTHER", "其他"],

  // ── Tile & detail ────────────────────────────────────────────────────────────
  tileNoFlow:       ["price only", "仅价格"],
  detailTitle:      ["Detail", "详情"],
  detailPrice:      ["Price", "价格"],
  detailChg:        ["Chg (1D)", "涨跌幅（1日）"],
  detailFlowPrem:   ["Flow premium", "权利金"],
  detailCallPct:    ["Call share", "认购占比"],
  detailTone:       ["Positioning tone", "持仓倾向"],
  detailToneSoft:   ["(ΔOI-based, direction soft)", "（基于ΔOI，方向为软性）"],
  detailLean:       ["Lean (~soft)", "倾向（~软性）"],
  detailDivChip:    ["price/flow divergence — magnitude read", "价格与资金流背离 — 以规模为准"],
  detailDivNote:    ["Price direction and flow tone disagree beyond dead-zones. Treat as a magnitude observation, not a directional call.", "价格走势与持仓倾向超出中性区间后背离。视为规模观察，非方向性判断。"],
  detailNoDoi:      ["ΔOI tone unavailable", "ΔOI倾向数据缺失"],
  detailNoFlow:     ["No flow data — price only", "无资金流数据 — 仅显示价格"],
  detailUnusualZ:   ["Unusual activity", "异常活跃"],
  detailVerdictSoft: ["Verdict (~soft)", "判断（~软性）"],
  detailClose:      ["Close", "关闭"],
  detailNetDoi:     ["Net ΔOI", "净ΔOI"],
  detailDoiPc:      ["ΔOI P/C", "ΔOI认沽/认购"],
  detailZeroDte:    ["0DTE share", "当日到期占比"],
  detailFreshCt:    ["Fresh contracts", "新合约数"],
  detailAsof:       ["As of", "数据截至"],

  // ── Table columns ─────────────────────────────────────────────────────────────
  colTicker:        ["Ticker", "代码"],
  colName:          ["Name", "名称"],
  colPrice:         ["Price", "价格"],
  colChg:           ["Chg%", "涨跌%"],
  colPremium:       ["Premium", "权利金"],
  colCallShare:     ["Call%", "认购%"],
  colDoi:           ["Net ΔOI", "净ΔOI"],
  colTone:          ["Tone", "倾向"],
  colDivergence:    ["Div", "背离"],
  colSector:        ["Sector", "板块"],

  // ── Search ──────────────────────────────────────────────────────────────────
  searchPlaceholder: ["Search ticker…", "搜索代码…"],

  // ── Regime passport (HONESTY DOCTRINE — GEX) ────────────────────────────────
  regimeCaveat:     [
    "GEX levels: display-only — forward-vol gate pending (~Sept 2026). Single-name GEX regime is a near-constant product attribute, not a time-varying signal.",
    "GEX水平：仅供展示 — 待前向波动率验证（约2026年9月）。单一标的GEX区间为近似固定的产品属性，非时变信号。",
  ],

  // ── Data notes ──────────────────────────────────────────────────────────────
  dataNote:         ["EOD/nightly — no live price tick available", "每日收盘数据，无实时行情"],
  capSizingDeferred: ["Cap-weighted sizing: coming soon", "市值加权面积：即将上线"],
  flowDirSoft:      ["Flow direction is soft — magnitude is the reliable read", "资金流方向为软性读数 — 权利金规模是可靠依据"],

  // ── Empty / loading ──────────────────────────────────────────────────────────
  loading:          ["Loading…", "加载中…"],
  loadingHeatmap:   ["Loading heatmap…", "加载热力图中…"],
  noData:           ["No data available", "暂无数据"],
  noFlowData:       ["Flow data unavailable — showing price layer", "资金流数据不可用 — 显示价格层"],
  priceOnly:        ["Price data only (34 names, nightly)", "仅价格数据（34个标的，每日更新）"],

  // ── Soft assertions (HONESTY DOCTRINE) ──────────────────────────────────────
  displayOnly:      ["Display-only — not investment advice", "仅供展示 — 非投资建议"],
  magnitudeRead:    ["Magnitude read — direction is soft", "以规模为主 — 方向为软性"],
} as const;

type HeatmapKey = keyof typeof HM_LEX;

export function getHeatmapStr(lang: Lang, key: HeatmapKey): string {
  const entry = HM_LEX[key];
  return lang === "zh" ? entry[1] : entry[0];
}

export function makeHeatmapT(lang: Lang): (key: HeatmapKey) => string {
  return (key: HeatmapKey) => getHeatmapStr(lang, key);
}

export type { HeatmapKey };
