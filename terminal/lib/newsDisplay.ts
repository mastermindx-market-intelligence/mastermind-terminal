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
  "cls.cn": "财联社", "yicai.com": "第一财经", "stcn.com": "证券时报",
  "cnstock.com": "中国证券网", "cs.com.cn": "中证网", "caixin.com": "财新",
  "wallstreetcn.com": "华尔街见闻", "cnfin.com": "新华财经",
  "finance.eastmoney.com": "东方财富", "stock.eastmoney.com": "东方财富",
  "finance.sina.com.cn": "新浪财经", "news.10jqka.com.cn": "同花顺",
  "etnet.com.hk": "經濟通", "aastocks.com": "阿思達克", "hkej.com": "信報",
  "hket.com": "香港經濟日報", "zhitongcaijing.com": "智通財經",
};

export function sourceLabel(source: string): string {
  const key = source.trim().toLowerCase();
  if (!key) return "Source";
  const publisher = (key === "benzinga" ? "benzinga.com" : key.replace(/^(?:massive|finlight):/, ""))
    .replace(/^www\./, "").replace(/\.$/, "");
  return (Object.hasOwn(PUBLISHER_LABELS, publisher) ? PUBLISHER_LABELS[publisher] : undefined) ?? (/^(?:massive|finlight):/.test(key) ? publisher
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

/**
 * The named entities a feed body may carry into plain text. A Map, never an object
 * literal: a prototype key such as `constructor` must read as unknown and stay
 * literal instead of resolving to an inherited property.
 */
const NEWS_TEXT_ENTITIES = new Map<string, string>([
  ["amp", "&"], ["apos", "'"], ["quot", '"'],
  ["lt", "<"], ["gt", ">"], ["nbsp", "\u00a0"],
]);

/**
 * Decode common feed entities once, for plain React text, on server and client.
 * This is not an HTML parser and it never builds markup: the result is a string
 * that React escapes on render, so a decoded angle bracket stays a visible
 * character. The pass is single — `&amp;lt;` decodes to `&lt;`, never to `<`.
 * Unknown, malformed, zero, surrogate and out-of-range entities stay literal, and
 * callers keep the original strings for URLs, canonical identity and revisions.
 */
export function decodeNewsText(raw: string): string {
  return raw.replace(/&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|[A-Za-z][A-Za-z0-9]*);/g, (entity, token: string) => {
    if (token[0] !== "#") return NEWS_TEXT_ENTITIES.get(token) ?? entity;
    const hexadecimal = token[1].toLowerCase() === "x";
    const codePoint = Number.parseInt(token.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)) return entity;
    return String.fromCodePoint(codePoint);
  });
}
