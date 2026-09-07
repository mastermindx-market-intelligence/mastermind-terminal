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
