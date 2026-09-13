/**
 * Glance-tier expansions for abbreviations that used to ship as machine text
 * ("Nd", "vol>OI"). Numbers stay identical; only the unit words change.
 */

export function daysToExpiry(n: number, lang: "en" | "zh"): string {
  if (lang === "zh") return `${n} 天到期`;
  return n === 1 ? "1 day to expiry" : `${n} days to expiry`;
}

/** Short unabbreviated count for compact table cells ("3d" → "3 days" / "3 天"). */
export function daysHeld(n: number, lang: "en" | "zh"): string {
  if (lang === "zh") return `${n} 天`;
  return n === 1 ? "1 day" : `${n} days`;
}

export function volAboveOi(lang: "en" | "zh"): string {
  return lang === "zh" ? "成交量高于未平仓量" : "volume above open interest";
}
