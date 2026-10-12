/**
 * Shared display helpers for the ticker-news rail (Wave B3): the source label and
 * the rail time format, moved out of TickerNewsPanel.tsx so the news-flow strip
 * and the specimen reuse the exact same bytes the rows render.
 */
import type { NewsCatchupLang } from "@/lib/newsCatchupLex";

export function sourceLabel(source: string): string {
  if (!source) return "Source";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

/**
 * The rail's one time format (Wave B adds no second date format). `timeZone` is
 * passed into toLocaleTimeString options only when given — the specimen pins it
 * to "UTC" so its bytes do not depend on the machine; rows never pass it.
 */
export function formatRailTime(raw: string, lang: NewsCatchupLang, timeZone?: string): string {
  const dt = new Date(raw);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}
