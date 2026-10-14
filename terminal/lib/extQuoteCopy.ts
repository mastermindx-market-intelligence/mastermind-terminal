/** BOATS display copy uses the shared language state and the existing feature-copy pattern. */
import type { Lang } from "@/lib/i18n";

const pick = (lang: Lang, en: string, zh: string): string =>
  lang === "zh" ? zh : en;

export function boatsLatestTradeLabel(lang: Lang): string {
  return pick(lang, "Latest qualifying BOATS trade · single venue", "BOATS 最新合格成交 · 单一场所");
}
