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

const NEWS_TEXT_ENTITIES = new Map([
  ["amp", "&"], ["apos", "'"], ["quot", '"'],
  ["lt", "<"], ["gt", ">"], ["nbsp", "\u00a0"],
]);

/**
 * Decode common feed entities once for plain React text, on server and client.
 * This is not an HTML parser. Unknown/malformed entities remain visible, and
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
