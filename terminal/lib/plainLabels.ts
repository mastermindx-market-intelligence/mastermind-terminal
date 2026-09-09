/** Bilingual display labels for values that used to leak raw keys onto the screen. */

export type PlainLang = "en" | "zh";

export function notClassified(lang: PlainLang): string {
  return lang === "zh" ? "未分类" : "Not classified";
}

export function regimeLabel<K extends string>(
  t: (key: K) => string,
  value: string | null | undefined,
  lang: PlainLang,
): string {
  if (value == null || value === "") return notClassified(lang);
  // K is inferred from the argument: a non-function or a wrong-arity translator
  // fails to type-check. The generic does not detect "the wrong desk's translator"
  // — any `(key: string-ish) => string` is accepted. The interpolated key still
  // uses the same `as K` escape hatch the call sites used inline before.
  return t(`regime${value}` as K) || notClassified(lang);
}

export const TRUST_TIER_LABEL = {
  "event-edge": ["Event edge", "事件驱动"],
  technical: ["Technical", "技术面"],
  context: ["Context", "背景因素"],
  reversal: ["Reversal", "反转"],
  screen: ["Screen", "筛选"],
  validated: ["Passed checks", "已通过检验"],
} as const;

export type TrustTier = keyof typeof TRUST_TIER_LABEL;

export function trustTierLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null || value === "") return notClassified(lang);
  const pair = TRUST_TIER_LABEL[value as TrustTier];
  if (!pair) return notClassified(lang);
  return lang === "zh" ? pair[1] : pair[0];
}

export const MACRO_DURATION_ZH: Record<string, string> = {
  "Duration-neutral": "久期中性",
};

export const MACRO_REGIME_ZH: Record<string, string> = {
  "rate-neutral": "利率中性",
};

export const MACRO_INFLATION_ZH: Record<string, string> = {
  "Inflation-neutral": "通胀中性",
};

export function macroChipLabel(
  en: string,
  zhMap: Record<string, string>,
  lang: PlainLang,
): string {
  if (lang === "zh") return zhMap[en] || en;
  return en;
}

/** Onboarding LEX keys — `essential` displays as Essential via `obPlanInsider`. */
export const PLAN_TIER_TKEY = {
  free: "obPlanFree",
  essential: "obPlanInsider",
  pro: "obPlanPro",
} as const;

export type PlanTier = keyof typeof PLAN_TIER_TKEY;

export function planTierLabel(
  value: string,
  t: (key: string, fallback?: string) => string,
  lang: PlainLang,
): string {
  const tkey = (PLAN_TIER_TKEY as Record<string, string>)[value];
  if (!tkey) return notClassified(lang);
  return t(tkey, "") || notClassified(lang);
}

export const CLASSIC_INDICATOR_CATEGORIES = [
  "Mastermind",
  "Trend",
  "Momentum",
  "Price Action",
  "Volume",
  "daytrade",
] as const;

export type ClassicIndicatorCategory = (typeof CLASSIC_INDICATOR_CATEGORIES)[number];

export const CLASSIC_CATEGORY_TKEY: Record<ClassicIndicatorCategory, string> = {
  Mastermind: "catMastermind",
  Trend: "catTrend",
  Momentum: "catMomentum",
  "Price Action": "catPriceAction",
  Volume: "catVolume",
  daytrade: "catDaytrade",
};

export function classicCategoryLabel(
  category: string,
  t: (key: string, fallback?: string) => string,
  lang: PlainLang,
): string {
  const tkey = (CLASSIC_CATEGORY_TKEY as Record<string, string>)[category];
  if (!tkey) return notClassified(lang);
  return t(tkey, "") || notClassified(lang);
}

export function mappedOrNeutral(mapped: string | undefined, lang: PlainLang): string {
  return mapped || notClassified(lang);
}

/** Glance-tier signal words that used to render as raw BUY/SELL/REBUY/RECLAIM. */
export const SIGNAL_VERDICT_LABEL = {
  BUY: ["Buy", "买入"],
  SELL: ["Sell", "卖出"],
  CUT: ["Cut", "减持"],
  REBUY: ["Buy again", "再次买入"],
  RECLAIM: ["Take back", "重新站上"],
  STOP: ["Stop", "止损"],
  EARLY: ["Early watch", "提前关注"],
} as const;

export type SignalVerdict = keyof typeof SIGNAL_VERDICT_LABEL;

export function verdictLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null || value === "") return notClassified(lang);
  const pair = SIGNAL_VERDICT_LABEL[value as SignalVerdict];
  if (!pair) return notClassified(lang);
  return lang === "zh" ? pair[1] : pair[0];
}

/** Timing-window status on the analysis rail. */
export const ENTRY_STATUS_LABEL = {
  open: ["Window open", "窗口已开"],
  blocked: ["Blocked", "受阻"],
  closed: ["Closed", "已关闭"],
  "act now": ["Act now", "现在行动"],
  avoid: ["Stand aside", "回避"],
  later: ["Wait", "再等"],
  wait_pullback: ["Wait for a dip", "等待回撤"],
} as const;

export type EntryStatus = keyof typeof ENTRY_STATUS_LABEL;

export function entryStatusLabel(
  value: string | null | undefined,
  lang: PlainLang,
  fallback?: string | null,
): string {
  if (value == null || value === "") {
    return fallback != null && fallback !== ""
      ? entryStatusLabel(fallback, lang)
      : notClassified(lang);
  }
  const normalized = value.trim().toLowerCase().replace(/\?+$/, "") as EntryStatus;
  const pair = ENTRY_STATUS_LABEL[normalized];
  if (pair) return lang === "zh" ? pair[1] : pair[0];
  if (fallback != null && fallback !== "" && fallback !== value) {
    return entryStatusLabel(fallback, lang);
  }
  // A leftover slug never reaches the screen. An unmapped English phrase
  // stays English only; Chinese never inherits the English words.
  if (/\s/.test(value)) return lang === "zh" ? notClassified(lang) : value;
  return notClassified(lang);
}

/** Statistic tokens the guard flags when they reach a visible span. */
export const STAT_TOKEN_LABEL = {
  oi: ["Open interest", "未平仓合约"],
  iv: ["Implied volatility", "隐含波动率"],
  iv_rank: ["IV rank", "隐含波动率百分位"],
  ivr: ["IV rank", "隐含波动率百分位"],
  dte: ["Days to expiry", "距到期天数"],
} as const;

export type StatToken = keyof typeof STAT_TOKEN_LABEL;

export function statTokenLabel(token: string | null | undefined, lang: PlainLang): string {
  if (token == null || token === "") return notClassified(lang);
  const pair = STAT_TOKEN_LABEL[token.toLowerCase() as StatToken];
  if (!pair) return notClassified(lang);
  return lang === "zh" ? pair[1] : pair[0];
}

/** Compact chip for volume exceeding prior open interest — never the raw vol>OI token. */
export function volAboveOiLabel(lang: PlainLang): string {
  return lang === "zh" ? "成交量高于未平仓量" : "Volume above open interest";
}

/** Workspace widget type shown on the generic-tile fallback. */
export const WIDGET_TYPE_LABEL = {
  screener: ["Screener", "选股"],
  chart: ["Chart", "图表"],
  pane: ["Panel", "面板"],
  overlay: ["Overlay", "叠加层"],
  unknown: ["Unknown", "未知"],
} as const;

export type WidgetTypeKey = keyof typeof WIDGET_TYPE_LABEL;

export function widgetTypeLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null || value === "") return notClassified(lang);
  const pair = WIDGET_TYPE_LABEL[value as WidgetTypeKey];
  if (!pair) return notClassified(lang);
  return lang === "zh" ? pair[1] : pair[0];
}

/** Thesis subject kind shown on the research workspace inspector. */
export const SUBJECT_KIND_LABEL = {
  issuer: ["Company listing", "上市公司"],
  theme: ["Theme", "主题"],
} as const;

export type SubjectKind = keyof typeof SUBJECT_KIND_LABEL;

export function subjectKindLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null || value === "") return notClassified(lang);
  const pair = SUBJECT_KIND_LABEL[value as SubjectKind];
  if (!pair) return notClassified(lang);
  return lang === "zh" ? pair[1] : pair[0];
}

/** Inferred tape lean shown on the 0DTE board and flow cards — never the raw ~buy token. */
export const FLOW_SIDE_LABEL = {
  "~buy": ["Likely buying", "偏买入"],
  buy: ["Likely buying", "偏买入"],
  "~sell": ["Likely selling", "偏卖出"],
  sell: ["Likely selling", "偏卖出"],
  mixed: ["Mixed", "混合"],
} as const;

/** Option right shown on the flow board chips — never the bare C / P letter. */
export const OPTION_RIGHT_LABEL = {
  C: ["Call", "认购"],
  c: ["Call", "认购"],
  call: ["Call", "认购"],
  P: ["Put", "认沽"],
  p: ["Put", "认沽"],
  put: ["Put", "认沽"],
} as const;

export type OptionRightKey = keyof typeof OPTION_RIGHT_LABEL;

/** Empty value means "no right filter" — the chip reads All / 全部, not a raw token. */
export function optionRightLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null || value === "") return lang === "zh" ? "全部" : "All";
  const pair = OPTION_RIGHT_LABEL[value as OptionRightKey];
  if (!pair) return notClassified(lang);
  return lang === "zh" ? pair[1] : pair[0];
}

export type FlowSideKey = keyof typeof FLOW_SIDE_LABEL;

export function flowSideLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null || value === "") return notClassified(lang);
  const pair = FLOW_SIDE_LABEL[value.toLowerCase() as FlowSideKey];
  if (!pair) return notClassified(lang);
  return lang === "zh" ? pair[1] : pair[0];
}

/** Company-intelligence source kind shown on the manifest. */
export const SOURCE_KIND_LABEL = {
  transcript: ["Earnings call transcript", "电话会记录"],
  earnings_history: ["Historical earnings record", "历史财报记录"],
  score_overlay: ["Structured event analysis", "结构化事件分析"],
  issuer_release: ["Company filing", "公司公告"],
  filing: ["Company filing", "公司公告"],
  release: ["Company filing", "公司公告"],
  public_wire: ["Public wire record", "公开快讯"],
  edgar_collector: ["SEC filing feed", "监管申报来源"],
  presentation: ["Slides", "演示文稿"],
} as const;

export type SourceKindKey = keyof typeof SOURCE_KIND_LABEL;

export function sourceKindLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null || value === "") return notClassified(lang);
  const pair = SOURCE_KIND_LABEL[value as SourceKindKey];
  if (!pair) return notClassified(lang);
  return lang === "zh" ? pair[1] : pair[0];
}

/** Source completeness shown on the company-intelligence manifest. */
export const SOURCE_STATUS_LABEL = {
  present: ["Present", "可用"],
  Present: ["Present", "可用"],
  metadata_only: ["Recorded, file missing", "有记录，无正文"],
  missing: ["Missing", "缺失"],
  Unavailable: ["Unavailable", "不可用"],
  unavailable: ["Unavailable", "不可用"],
  "address only": ["Address only", "仅有地址"],
  address_only: ["Address only", "仅有地址"],
  "Address only": ["Address only", "仅有地址"],
  Unjoinable: ["Cannot be joined", "无法匹配"],
  unjoinable: ["Cannot be joined", "无法匹配"],
  byte_replayed: ["Present", "可用"],
  typed_absence: ["Not available", "暂无"],
} as const;

export type SourceStatusKey = keyof typeof SOURCE_STATUS_LABEL;

export function sourceStatusLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null || value === "") return notClassified(lang);
  const pair = SOURCE_STATUS_LABEL[value as SourceStatusKey];
  if (!pair) return notClassified(lang);
  return lang === "zh" ? pair[1] : pair[0];
}

/** Topic timeline state on company intelligence. */
export const TOPIC_STATUS_LABEL = {
  added: ["Added", "新增"],
  persistent: ["Persistent", "延续"],
  dropped: ["Dropped", "退出"],
} as const;

export type TopicStatusKey = keyof typeof TOPIC_STATUS_LABEL;

export function topicStatusLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null || value === "") return notClassified(lang);
  const pair = TOPIC_STATUS_LABEL[value as TopicStatusKey];
  if (!pair) return notClassified(lang);
  return lang === "zh" ? pair[1] : pair[0];
}

/** Heatmap ΔOI put/call ratio — spelled out, never the raw OI token. */
export function deltaOiPutCallLabel(lang: PlainLang): string {
  return lang === "zh" ? "未平仓量变化（认沽/认购）" : "Open-interest change, puts vs calls";
}
