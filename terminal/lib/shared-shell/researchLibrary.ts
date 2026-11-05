import type { CatalogItem } from "./readingPayloads";
export type ResearchLibrarySort = "date-newest" | "date-oldest" | "title";
export type ResearchLibraryFilters = { institution?: string; topic?: string; sort?: ResearchLibrarySort };
type PublicationInstant = { second: number; fraction: string };

/** Calendar validation precedes Date.parse so February30 never becomes March. */
function publicationInstant(value: string | null | undefined): PublicationInstant | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  if (match[4] !== undefined && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59)) return null;
  const zone = match[8];
  if (zone && zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return null;
  const stamp = Date.parse(match[4] === undefined ? `${value}T00:00:00Z` : `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${zone}`);
  return Number.isFinite(stamp) ? { second: stamp / 1000, fraction: match[7] ?? "" } : null;
}
export const isResearchPublicationDate = (value: string | null | undefined): boolean => publicationInstant(value) !== null;

function compareInstant(a: PublicationInstant, b: PublicationInstant): number {
  if (a.second !== b.second) return a.second < b.second ? -1 : 1;
  const precision = Math.max(a.fraction.length, b.fraction.length);
  const left = a.fraction.padEnd(precision, "0"), right = b.fraction.padEnd(precision, "0");
  return left < right ? -1 : left > right ? 1 : 0;
}
const literalOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Options and counts describe only the received selection. No reads or input mutation. */
export function researchLibrary(items: readonly CatalogItem[], filters: ResearchLibraryFilters = {}) {
  const topics = [...new Set(items.flatMap(item => item.tags ?? []).filter(label => label !== ""))].sort(literalOrder);
  const institutions = [...new Set(items.flatMap(item => item.institution ? [item.institution] : []))].sort(literalOrder);
  const { topic = "", institution = "", sort = "date-newest" } = filters;
  const valid = typeof topic === "string" && typeof institution === "string" &&
    ["date-newest", "date-oldest", "title"].includes(sort) &&
    (!topic || topics.includes(topic)) && (!institution || institutions.includes(institution));
  const rows = valid ? items.map((item, index) => ({ item, index, date: publicationInstant(item.published_at) }))
    .filter(({ item }) => (!topic || item.tags?.includes(topic)) && (!institution || item.institution === institution)) : [];
  rows.sort((a, b) => {
    if (sort === "title") return literalOrder(a.item.title, b.item.title) || a.index - b.index;
    if (a.date === null || b.date === null) return a.date === b.date ? a.index - b.index : a.date === null ? 1 : -1;
    const order = compareInstant(a.date, b.date);
    return (sort === "date-newest" ? -order : order) || a.index - b.index;
  });
  return { items: rows.map(row => row.item), topics, institutions, loadedCount: items.length, matchedCount: rows.length };
}
