/**
 * Shared display helpers for the ticker-news rail (Wave B3): the source label and
 * the rail time format, moved out of TickerNewsPanel.tsx so the news-flow strip
 * and the specimen reuse the exact same bytes the rows render.
 */
import type { NewsCatchupLang } from "@/lib/newsCatchupLex";
import type { TickerNewsContentKind } from "@/lib/newsTypes";

// Display names only. Editorial admission and publisher rights belong to the API.
const PUBLISHER_LABELS: Readonly<Record<string, string>> = {
  "benzinga.com": "Benzinga", "reuters.com": "Reuters", "apnews.com": "Associated Press",
  "bloomberg.com": "Bloomberg", "ft.com": "Financial Times", "wsj.com": "Wall Street Journal",
  "cnbc.com": "CNBC", "marketwatch.com": "MarketWatch", "barrons.com": "Barron's",
  "globenewswire.com": "GlobeNewswire", "businesswire.com": "Business Wire",
  "prnewswire.com": "PR Newswire", "accesswire.com": "Accesswire",
  "accessnewswire.com": "Access Newswire", "thefly.com": "The Fly",
};

export function sourceLabel(source: string): string {
  const key = source.trim().toLowerCase();
  if (!key) return "Source";
  const publisher = (key === "benzinga" ? "benzinga.com" : key.replace(/^massive:/, ""))
    .replace(/^www\./, "").replace(/\.$/, "");
  return PUBLISHER_LABELS[publisher] ?? (key.startsWith("massive:") ? publisher
    : source.trim().charAt(0).toUpperCase() + source.trim().slice(1));
}

export function reportSourceLabel(source: string, kind: TickerNewsContentKind | undefined, lang: NewsCatchupLang): string {
  const label = sourceLabel(source);
  return kind === "press_release" ? `${label} · ${lang === "zh" ? "公司公告" : "Press release"}` : label;
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
