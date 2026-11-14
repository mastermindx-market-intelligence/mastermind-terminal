export type EditorialTopic = { key: string; en: string; zh: string };
export type EditorialReport = {
  slug: string; date: string; read_min: number;
  title_en: string; title_zh: string; dek_en: string; dek_zh: string;
  tags: EditorialTopic[];
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function validTopic(value: unknown): value is EditorialTopic {
  return record(value) && text(value.key) && /^[a-z0-9_-]+$/.test(value.key) && text(value.en) && text(value.zh);
}
function validReport(value: unknown): value is EditorialReport {
  if (!record(value) || !text(value.slug) || !/^report_[a-z0-9_]+$/.test(value.slug) ||
    !text(value.date) || !/^\d{4}-\d\d-\d\d$/.test(value.date) ||
    typeof value.read_min !== "number" || !Number.isSafeInteger(value.read_min) || value.read_min <= 0 ||
    ![value.title_en, value.title_zh, value.dek_en, value.dek_zh].every(text) ||
    !Array.isArray(value.tags) || !value.tags.every(validTopic)) return false;
  const date = new Date(value.date + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.date &&
    new Set(value.tags.map(tag => tag.key)).size === value.tags.length;
}

export function decodeEditorialReports(value: unknown): EditorialReport[] | null {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.reports) ||
    !value.reports.every(validReport)) return null;
  const reports = value.reports;
  if (new Set(reports.map(report => report.slug)).size !== reports.length) return null;
  return [...reports].sort((a, b) => b.date.localeCompare(a.date));
}

export function editorialTopics(reports: readonly EditorialReport[]) {
  const topics = new Map<string, EditorialTopic & { count: number }>();
  for (const report of reports) for (const tag of report.tags) {
    const known = topics.get(tag.key);
    if (known) known.count++;
    else topics.set(tag.key, { ...tag, count: 1 });
  }
  return [...topics.values()].sort((a, b) => b.count - a.count || a.en.localeCompare(b.en, "en"));
}

export type ArchiveFilter = { q: string; tag: string; sort: "new" | "old" };
export function archiveFilter(params: URLSearchParams, topics: readonly EditorialTopic[]): ArchiveFilter {
  const tag = params.get("tag");
  return { q: params.get("q") ?? "", tag: topics.some(topic => topic.key === tag) ? tag! : "all",
    sort: params.get("sort") === "old" ? "old" : "new" };
}
export function filterEditorialReports(reports: readonly EditorialReport[], state: ArchiveFilter) {
  const query = state.q.trim().toLowerCase();
  const matching = reports.filter(report => (state.tag === "all" || report.tags.some(tag => tag.key === state.tag)) &&
    [report.title_en, report.dek_en, report.title_zh, report.dek_zh].join(" ").toLowerCase().includes(query));
  if (state.sort === "old") matching.sort((a, b) => a.date.localeCompare(b.date));
  return matching;
}
