/** Source-page ranges only. No inferred headings or document text live here. */
export type ResearchOutlineEntry = { segment_index: number; page_start: number; page_end: number };
type VisibleRange = Pick<ResearchOutlineEntry, "segment_index" | "page_start" | "page_end">;

/** Undefined is an older backend; null is supplied metadata that cannot be trusted. */
export function researchOutline(value: unknown, total: number, visible: readonly VisibleRange[]): ResearchOutlineEntry[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(value) || value.length !== total) return null;
  const entries: ResearchOutlineEntry[] = [];
  for (let index = 0; index < value.length; index++) {
    const row: unknown = value[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const item = row as Record<string, unknown>;
    if (item.segment_index !== index || !Number.isSafeInteger(item.page_start) || (item.page_start as number) < 1 ||
      !Number.isSafeInteger(item.page_end) || (item.page_end as number) < (item.page_start as number)) return null;
    const previous = entries[index - 1];
    if (previous && ((item.page_start as number) < previous.page_start || (item.page_end as number) < previous.page_end)) return null;
    entries.push({ segment_index: index, page_start: item.page_start as number, page_end: item.page_end as number });
  }
  if (visible.some(part => {
    const entry = entries[part.segment_index];
    return !entry || entry.page_start !== part.page_start || entry.page_end !== part.page_end;
  })) return null;
  return entries;
}

/** One destination per supplied page range; repeated segments do not invent more pages. */
export function sourcePageDestinations(outline: readonly ResearchOutlineEntry[]): ResearchOutlineEntry[] {
  const seen = new Set<string>();
  return outline.filter(entry => {
    const key = `${entry.page_start}:${entry.page_end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
