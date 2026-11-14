/** Feature copy consumes the shared locale; it owns no language preference. */
export const pick = (lang: "en" | "zh", en: string, zh: string): string => lang === "zh" ? zh : en;
export function macroHealthLabel(value: unknown, lang: "en" | "zh"): string {
 switch (String(value).toLowerCase()) {
  case "ok": case "fresh": case "healthy": return pick(lang, "Available", "可用");
  case "stale": return pick(lang, "Older input", "较早的数据");
  case "error": case "failed": return pick(lang, "Needs attention", "需要关注");
  case "missing": return pick(lang, "Missing input", "缺少输入");
  case "empty": return pick(lang, "No observations", "暂无观测值");
  case "partial": case "degraded": return pick(lang, "Partial coverage", "部分覆盖");
  default: return pick(lang, "Status unavailable", "状态不可用");
 }
}
