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
  "~buy": ["Leans buy (approximate)", "偏买入（近似）"],
  buy: ["Leans buy (approximate)", "偏买入（近似）"],
  "~sell": ["Leans sell (approximate)", "偏卖出（近似）"],
  sell: ["Leans sell (approximate)", "偏卖出（近似）"],
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
  transcript: ["Earnings call transcript", "财报电话会记录"],
  earnings_history: ["Historical earnings record", "历史财报记录"],
  score_overlay: ["Structured event analysis", "结构化事件分析"],
  issuer_release: ["Company 8-K filing, exhibit 99.1", "公司 8-K 披露文件，附件 99.1"],
  filing: ["Company 8-K filing, exhibit 99.1", "公司 8-K 披露文件，附件 99.1"],
  release: ["Company 8-K filing, exhibit 99.1", "公司 8-K 披露文件，附件 99.1"],
  public_wire: ["Public wire record", "公开快讯"],
  edgar_collector: ["SEC filing feed", "监管披露来源"],
  presentation: ["Slides", "演示文稿"],
} as const;

export type SourceKindKey = keyof typeof SOURCE_KIND_LABEL;

export function sourceKindLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null || value === "") return notClassified(lang);
  const pair = SOURCE_KIND_LABEL[value as SourceKindKey];
  if (!pair) return notClassified(lang);
  return lang === "zh" ? pair[1] : pair[0];
}

/**
 * A kind that names a regulatory filing family. Only these may fall back to the
 * filing wording: asserting a regulatory provenance for a source whose kind is
 * unknown or absent would state more than the data supports.
 */
function isFilingFamilyKind(value: string): boolean {
  return /(^|[_-])(filing|filings|edgar|sec)([_-]|$)/.test(value.trim().toLowerCase());
}

/** The unclassified source line — never a document id, CIK, or accession. */
function sourceNotClassified(lang: PlainLang): string {
  return lang === "zh" ? "来源未分类" : "Source not classified";
}

/** Visible kind when no plainer label exists — never a document id, CIK, or accession. */
export function sourceVisibleKindLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null || value.trim() === "") return sourceNotClassified(lang);
  const mapped = sourceKindLabel(value, lang);
  if (mapped !== notClassified(lang)) return mapped;
  if (isFilingFamilyKind(value)) return lang === "zh" ? "监管披露文件" : "SEC filing";
  return sourceNotClassified(lang);
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

/**
 * Time-zone picker labels (B-F08-6).
 *
 * The stored value is always the IANA id — macro validates against the full
 * IANA database and that is what goes on the wire. Only the text a person
 * reads changes: a place name in their own language plus the zone's current
 * offset from UTC, e.g. "New York (UTC−4)" / "纽约（UTC−4）".
 *
 * This map is the WHOLE of what a picker may offer (see curatedTimeZones).
 * A zone with no entry here is never rendered as an identifier: it reads as
 * "Current setting (UTC±X)" / "当前设置（UTC±X）", which keeps the account's
 * stored value without putting a slug path or a snake_case segment on screen,
 * and without putting an English place name on the Chinese surface.
 *
 * The offset is computed at render time from the real clock, so a zone that
 * observes daylight saving shows the offset in force today, not a frozen one.
 */
export const TIME_ZONE_CITY: Record<string, readonly [string, string]> = {
  UTC: ["UTC", "协调世界时"],
  "Etc/UTC": ["UTC", "协调世界时"],
  "Etc/GMT": ["UTC", "协调世界时"],
  // Asia
  "Asia/Shanghai": ["Shanghai", "上海"],
  "Asia/Urumqi": ["Urumqi", "乌鲁木齐"],
  "Asia/Hong_Kong": ["Hong Kong", "香港"],
  "Asia/Macau": ["Macau", "澳门"],
  "Asia/Taipei": ["Taipei", "台北"],
  "Asia/Tokyo": ["Tokyo", "东京"],
  "Asia/Seoul": ["Seoul", "首尔"],
  "Asia/Pyongyang": ["Pyongyang", "平壤"],
  "Asia/Singapore": ["Singapore", "新加坡"],
  "Asia/Kuala_Lumpur": ["Kuala Lumpur", "吉隆坡"],
  "Asia/Bangkok": ["Bangkok", "曼谷"],
  "Asia/Jakarta": ["Jakarta", "雅加达"],
  "Asia/Manila": ["Manila", "马尼拉"],
  "Asia/Saigon": ["Ho Chi Minh City", "胡志明市"],
  "Asia/Ho_Chi_Minh": ["Ho Chi Minh City", "胡志明市"],
  "Asia/Phnom_Penh": ["Phnom Penh", "金边"],
  "Asia/Vientiane": ["Vientiane", "万象"],
  "Asia/Rangoon": ["Yangon", "仰光"],
  "Asia/Yangon": ["Yangon", "仰光"],
  "Asia/Dhaka": ["Dhaka", "达卡"],
  "Asia/Kathmandu": ["Kathmandu", "加德满都"],
  "Asia/Katmandu": ["Kathmandu", "加德满都"],
  "Asia/Kolkata": ["Kolkata", "加尔各答"],
  "Asia/Calcutta": ["Kolkata", "加尔各答"],
  "Asia/Colombo": ["Colombo", "科伦坡"],
  "Asia/Karachi": ["Karachi", "卡拉奇"],
  "Asia/Kabul": ["Kabul", "喀布尔"],
  "Asia/Tashkent": ["Tashkent", "塔什干"],
  "Asia/Almaty": ["Almaty", "阿拉木图"],
  "Asia/Bishkek": ["Bishkek", "比什凯克"],
  "Asia/Dushanbe": ["Dushanbe", "杜尚别"],
  "Asia/Ashgabat": ["Ashgabat", "阿什哈巴德"],
  "Asia/Ulaanbaatar": ["Ulaanbaatar", "乌兰巴托"],
  "Asia/Tehran": ["Tehran", "德黑兰"],
  "Asia/Baghdad": ["Baghdad", "巴格达"],
  "Asia/Riyadh": ["Riyadh", "利雅得"],
  "Asia/Kuwait": ["Kuwait City", "科威特城"],
  "Asia/Qatar": ["Doha", "多哈"],
  "Asia/Bahrain": ["Manama", "麦纳麦"],
  "Asia/Muscat": ["Muscat", "马斯喀特"],
  "Asia/Dubai": ["Dubai", "迪拜"],
  "Asia/Jerusalem": ["Jerusalem", "耶路撒冷"],
  "Asia/Beirut": ["Beirut", "贝鲁特"],
  "Asia/Damascus": ["Damascus", "大马士革"],
  "Asia/Amman": ["Amman", "安曼"],
  "Asia/Nicosia": ["Nicosia", "尼科西亚"],
  "Asia/Baku": ["Baku", "巴库"],
  "Asia/Tbilisi": ["Tbilisi", "第比利斯"],
  "Asia/Yerevan": ["Yerevan", "埃里温"],
  "Asia/Vladivostok": ["Vladivostok", "海参崴"],
  "Asia/Yekaterinburg": ["Yekaterinburg", "叶卡捷琳堡"],
  "Asia/Novosibirsk": ["Novosibirsk", "新西伯利亚"],
  "Asia/Krasnoyarsk": ["Krasnoyarsk", "克拉斯诺亚尔斯克"],
  "Asia/Irkutsk": ["Irkutsk", "伊尔库茨克"],
  "Asia/Yakutsk": ["Yakutsk", "雅库茨克"],
  "Asia/Magadan": ["Magadan", "马加丹"],
  "Asia/Kamchatka": ["Kamchatka", "堪察加"],
  // Europe
  "Europe/London": ["London", "伦敦"],
  "Europe/Dublin": ["Dublin", "都柏林"],
  "Europe/Lisbon": ["Lisbon", "里斯本"],
  "Europe/Madrid": ["Madrid", "马德里"],
  "Europe/Paris": ["Paris", "巴黎"],
  "Europe/Brussels": ["Brussels", "布鲁塞尔"],
  "Europe/Amsterdam": ["Amsterdam", "阿姆斯特丹"],
  "Europe/Luxembourg": ["Luxembourg", "卢森堡"],
  "Europe/Berlin": ["Berlin", "柏林"],
  "Europe/Zurich": ["Zurich", "苏黎世"],
  "Europe/Vienna": ["Vienna", "维也纳"],
  "Europe/Rome": ["Rome", "罗马"],
  "Europe/Malta": ["Valletta", "瓦莱塔"],
  "Europe/Copenhagen": ["Copenhagen", "哥本哈根"],
  "Europe/Oslo": ["Oslo", "奥斯陆"],
  "Europe/Stockholm": ["Stockholm", "斯德哥尔摩"],
  "Europe/Helsinki": ["Helsinki", "赫尔辛基"],
  "Europe/Tallinn": ["Tallinn", "塔林"],
  "Europe/Riga": ["Riga", "里加"],
  "Europe/Vilnius": ["Vilnius", "维尔纽斯"],
  "Europe/Warsaw": ["Warsaw", "华沙"],
  "Europe/Prague": ["Prague", "布拉格"],
  "Europe/Bratislava": ["Bratislava", "布拉迪斯拉发"],
  "Europe/Budapest": ["Budapest", "布达佩斯"],
  "Europe/Ljubljana": ["Ljubljana", "卢布尔雅那"],
  "Europe/Zagreb": ["Zagreb", "萨格勒布"],
  "Europe/Belgrade": ["Belgrade", "贝尔格莱德"],
  "Europe/Sarajevo": ["Sarajevo", "萨拉热窝"],
  "Europe/Skopje": ["Skopje", "斯科普里"],
  "Europe/Tirane": ["Tirana", "地拉那"],
  "Europe/Sofia": ["Sofia", "索非亚"],
  "Europe/Bucharest": ["Bucharest", "布加勒斯特"],
  "Europe/Athens": ["Athens", "雅典"],
  "Europe/Istanbul": ["Istanbul", "伊斯坦布尔"],
  "Europe/Kiev": ["Kyiv", "基辅"],
  "Europe/Kyiv": ["Kyiv", "基辅"],
  "Europe/Chisinau": ["Chisinau", "基希讷乌"],
  "Europe/Minsk": ["Minsk", "明斯克"],
  "Europe/Moscow": ["Moscow", "莫斯科"],
  "Europe/Kaliningrad": ["Kaliningrad", "加里宁格勒"],
  "Europe/Reykjavik": ["Reykjavik", "雷克雅未克"],
  "Atlantic/Reykjavik": ["Reykjavik", "雷克雅未克"],
  "Atlantic/Azores": ["Azores", "亚速尔群岛"],
  "Atlantic/Canary": ["Canary Islands", "加那利群岛"],
  "Atlantic/Madeira": ["Madeira", "马德拉群岛"],
  "Atlantic/Bermuda": ["Bermuda", "百慕大"],
  "Atlantic/Cape_Verde": ["Cape Verde", "佛得角"],
  // North America
  "America/New_York": ["New York", "纽约"],
  "America/Toronto": ["Toronto", "多伦多"],
  "America/Montreal": ["Montreal", "蒙特利尔"],
  "America/Detroit": ["Detroit", "底特律"],
  "America/Indianapolis": ["Indianapolis", "印第安纳波利斯"],
  "America/Chicago": ["Chicago", "芝加哥"],
  "America/Winnipeg": ["Winnipeg", "温尼伯"],
  "America/Mexico_City": ["Mexico City", "墨西哥城"],
  "America/Denver": ["Denver", "丹佛"],
  "America/Edmonton": ["Edmonton", "埃德蒙顿"],
  "America/Phoenix": ["Phoenix", "凤凰城"],
  "America/Los_Angeles": ["Los Angeles", "洛杉矶"],
  "America/Vancouver": ["Vancouver", "温哥华"],
  "America/Tijuana": ["Tijuana", "蒂华纳"],
  "America/Anchorage": ["Anchorage", "安克雷奇"],
  "America/Halifax": ["Halifax", "哈利法克斯"],
  "America/St_Johns": ["St. John's", "圣约翰斯"],
  "America/Havana": ["Havana", "哈瓦那"],
  "America/Panama": ["Panama City", "巴拿马城"],
  "America/Guatemala": ["Guatemala City", "危地马拉城"],
  "America/Costa_Rica": ["San José", "圣何塞"],
  "America/Puerto_Rico": ["San Juan", "圣胡安"],
  "America/Jamaica": ["Kingston", "金斯敦"],
  "Pacific/Honolulu": ["Honolulu", "檀香山"],
  // South America
  "America/Sao_Paulo": ["São Paulo", "圣保罗"],
  "America/Argentina/Buenos_Aires": ["Buenos Aires", "布宜诺斯艾利斯"],
  "America/Buenos_Aires": ["Buenos Aires", "布宜诺斯艾利斯"],
  "America/Santiago": ["Santiago", "圣地亚哥"],
  "America/Lima": ["Lima", "利马"],
  "America/Bogota": ["Bogotá", "波哥大"],
  "America/Caracas": ["Caracas", "加拉加斯"],
  "America/Montevideo": ["Montevideo", "蒙得维的亚"],
  "America/Asuncion": ["Asunción", "亚松森"],
  "America/La_Paz": ["La Paz", "拉巴斯"],
  "America/Guayaquil": ["Guayaquil", "瓜亚基尔"],
  // Africa
  "Africa/Cairo": ["Cairo", "开罗"],
  "Africa/Lagos": ["Lagos", "拉各斯"],
  "Africa/Accra": ["Accra", "阿克拉"],
  "Africa/Abidjan": ["Abidjan", "阿比让"],
  "Africa/Dakar": ["Dakar", "达喀尔"],
  "Africa/Casablanca": ["Casablanca", "卡萨布兰卡"],
  "Africa/Algiers": ["Algiers", "阿尔及尔"],
  "Africa/Tunis": ["Tunis", "突尼斯"],
  "Africa/Tripoli": ["Tripoli", "的黎波里"],
  "Africa/Khartoum": ["Khartoum", "喀土穆"],
  "Africa/Addis_Ababa": ["Addis Ababa", "亚的斯亚贝巴"],
  "Africa/Nairobi": ["Nairobi", "内罗毕"],
  "Africa/Kampala": ["Kampala", "坎帕拉"],
  "Africa/Dar_es_Salaam": ["Dar es Salaam", "达累斯萨拉姆"],
  "Africa/Kinshasa": ["Kinshasa", "金沙萨"],
  "Africa/Luanda": ["Luanda", "罗安达"],
  "Africa/Harare": ["Harare", "哈拉雷"],
  "Africa/Lusaka": ["Lusaka", "卢萨卡"],
  "Africa/Maputo": ["Maputo", "马普托"],
  "Africa/Johannesburg": ["Johannesburg", "约翰内斯堡"],
  "Africa/Windhoek": ["Windhoek", "温得和克"],
  "Indian/Mauritius": ["Mauritius", "毛里求斯"],
  "Indian/Maldives": ["Maldives", "马尔代夫"],
  // Oceania
  "Australia/Sydney": ["Sydney", "悉尼"],
  "Australia/Melbourne": ["Melbourne", "墨尔本"],
  "Australia/Canberra": ["Canberra", "堪培拉"],
  "Australia/Brisbane": ["Brisbane", "布里斯班"],
  "Australia/Adelaide": ["Adelaide", "阿德莱德"],
  "Australia/Perth": ["Perth", "珀斯"],
  "Australia/Darwin": ["Darwin", "达尔文"],
  "Australia/Hobart": ["Hobart", "霍巴特"],
  "Pacific/Auckland": ["Auckland", "奥克兰"],
  "Pacific/Fiji": ["Fiji", "斐济"],
  "Pacific/Guam": ["Guam", "关岛"],
  "Pacific/Port_Moresby": ["Port Moresby", "莫尔兹比港"],
  "Pacific/Noumea": ["Nouméa", "努美阿"],
  "Pacific/Tahiti": ["Tahiti", "塔希提"],
};

/**
 * Curated ids that name a zone the picker already offers under another id,
 * each mapped to the id the picker actually carries. IANA keeps both spellings
 * alive and macro accepts either, so the label map above keeps them — a value
 * stored under the older spelling still reads as a place, and it reads as the
 * SAME place, on the one option the picker offers for it. Two options with the
 * same words and different values would give the reader nothing to choose by.
 */
const TIME_ZONE_ALIASES: ReadonlyMap<string, string> = new Map([
  ["Etc/UTC", "UTC"],
  ["Etc/GMT", "UTC"],
  ["Asia/Saigon", "Asia/Ho_Chi_Minh"],
  ["Asia/Rangoon", "Asia/Yangon"],
  ["Asia/Katmandu", "Asia/Kathmandu"],
  ["Asia/Calcutta", "Asia/Kolkata"],
  ["Europe/Kiev", "Europe/Kyiv"],
  ["Europe/Reykjavik", "Atlantic/Reykjavik"],
  ["America/Buenos_Aires", "America/Argentina/Buenos_Aires"],
]);

/**
 * The id the picker carries for this zone: an alias resolves to its curated
 * twin, everything else is itself. Display only — the stored value stays what
 * the account holds until the reader picks something new.
 */
export function canonicalTimeZone(zone: string): string {
  return TIME_ZONE_ALIASES.get(zone) ?? zone;
}

/** Words for a zone this file carries no name for, so the reader is never shown
 *  the identifier and a Chinese reader is never shown an English place name. */
const CURRENT_ZONE_WORDS: readonly [string, string] = ["Current setting", "当前设置"];

/**
 * The zones a picker may offer, each place exactly once, ordered by the name
 * the reader actually sees. Nothing outside this list is ever an option.
 */
export function curatedTimeZones(lang: PlainLang): string[] {
  const name = (id: string) => TIME_ZONE_CITY[id][lang === "zh" ? 1 : 0];
  return Object.keys(TIME_ZONE_CITY)
    .filter((id) => !TIME_ZONE_ALIASES.has(id))
    .sort((a, b) => name(a).localeCompare(name(b), lang === "zh" ? "zh-Hans-CN" : "en"));
}

/** True when the picker carries this zone under its own name. */
export function isCuratedTimeZone(zone: string): boolean {
  return Object.prototype.hasOwnProperty.call(TIME_ZONE_CITY, zone) && !TIME_ZONE_ALIASES.has(zone);
}

/** The zone's offset from UTC right now, e.g. "UTC+8", "UTC−4", "UTC+5:30".
 *  Empty when the runtime cannot resolve the zone, so the caller drops it. */
function utcOffsetLabel(zone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    }).formatToParts(at);
    const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    const m = /GMT([+-])(\d{1,2}):(\d{2})/.exec(raw);
    if (!m) return /GMT$/.test(raw) ? "UTC+0" : "";
    const sign = m[1] === "-" ? "−" : "+";
    const hours = String(Number(m[2]));
    const minutes = m[3] === "00" ? "" : `:${m[3]}`;
    return `UTC${sign}${hours}${minutes}`;
  } catch {
    return "";
  }
}

/**
 * Reader-facing label for one IANA time zone. The value stored stays the id.
 *
 * There is no path here that returns the identifier. A zone this file carries
 * no name for reads as "Current setting (UTC−4)" / "当前设置（UTC−4）" — the
 * account keeps the value it has, and the screen keeps its words.
 */
export function timeZoneLabel(zone: string, lang: PlainLang, at: Date = new Date()): string {
  const pair = TIME_ZONE_CITY[zone] ?? CURRENT_ZONE_WORDS;
  const name = lang === "zh" ? pair[1] : pair[0];
  const offset = utcOffsetLabel(zone, at);
  if (!offset) return name;
  return lang === "zh" ? `${name}（${offset}）` : `${name} (${offset})`;
}
