/** Signed labels compare a value with its own baseline; they do not infer trade intent. */
export type FlowActivityLang = "en" | "zh";

/**
 * Signed, glanceable label for a compared-with-baseline z-score.
 * Negative → "Below avg", zero → "At avg", positive → "Above avg";
 * null or non-finite (including ±Infinity) → "Unavailable". Missing data is
 * never "Warming" — the score is either there or it is not.
 */
export function signedActivityLabel(z: number | null, lang: FlowActivityLang): string {
  if (z == null || !Number.isFinite(z)) return lang === "zh" ? "数据不足" : "Unavailable";
  if (z === 0) return lang === "zh" ? "等于均值" : "At avg"; // -0 === 0
  return z < 0
    ? lang === "zh" ? "低于均值" : "Below avg"
    : lang === "zh" ? "高于均值" : "Above avg";
}

/**
 * Bar width on a 0..100 scale with z=5 ≙ full, matching the tape's bar scale.
 * Negative, zero, missing or non-finite scores get no bar.
 */
export function activityBarWidth(z: number | null): number {
  if (z == null || !Number.isFinite(z) || z <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((z / 5) * 100)));
}

/** Full-day reference for cumulative daily premium, not an intraday activity forecast. */
export function dailyActivityNote(lang: FlowActivityLang): string {
  return lang === "zh"
    ? "当日累计权利金与过去252个完整交易日的均值比较，未按日内时段调整。"
    : "Premium so far today compared with the past 252 full trading days; not adjusted for the time of day.";
}
