import { parseReadingSelection, type ReadingSelection } from "./readingContracts";
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export type Pair = { en: string; zh: string };
const pair = (value: unknown): value is Pair => record(value) && typeof value.en === "string" && typeof value.zh === "string";
export const localText = (value: unknown, lang: "en" | "zh"): string => pair(value) ? value[lang] : "";
export type CatalogItem = { id: string; title: string; institution?: string; published_at?: string; summary_points?: string[] };
export function catalogItems(value: unknown): CatalogItem[] | null {
  if (!record(value) || value.available === false || !Array.isArray(value.items)) return null;
  if (!value.items.every(item => record(item) && typeof item.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(item.id) && typeof item.title === "string" && (item.institution === undefined || typeof item.institution === "string") && (item.published_at == null || typeof item.published_at === "string") && (item.summary_points === undefined || Array.isArray(item.summary_points) && item.summary_points.every(point => typeof point === "string")))) return null;
  return value.items as CatalogItem[];
}
export type ReadingSegment = { segment_index: number; text: string; page_start: number; page_end: number; segment_text_sha256: string; start_byte: number; end_byte: number };
export type ReadingBody = { selection: ReadingSelection; segments: ReadingSegment[]; total: number; textLayer: "full" | "thin" | "none"; catalogGeneratedAt: string | null };
export function readingBody(value: unknown, docId: string, selected: ReadingSelection | null, start: number): ReadingBody | null {
  if (!record(value) || value.schema !== "research_vault.browser_read.v1" || value.report_id !== docId || !record(value.selection)) return null;
  const s = value.selection;
  const selection = parseReadingSelection({ docId, sourcePdfSha256: s.source_pdf_sha256, extractedTextSha256: s.extracted_text_sha256, extractorVersion: s.extractor_version, segmenterVersion: s.segmenter_version });
  if (!selection || (selected && (selection.docId !== selected.docId || selection.sourcePdfSha256 !== selected.sourcePdfSha256 || selection.extractedTextSha256 !== selected.extractedTextSha256 || selection.extractorVersion !== selected.extractorVersion || selection.segmenterVersion !== selected.segmenterVersion))) return null;
  if (s.segment_max_bytes !== 4000 || !Number.isSafeInteger(value.segment_count_total) || (value.segment_count_total as number) < 0 || !Array.isArray(value.segments) || value.segments.length > 4) return null;
  if (!["full", "thin", "none"].includes(value.text_layer_state as string)) return null;
  if (!value.segments.every((part, index) => record(part) && part.schema === "research_vault.segment.v1" && part.report_id === docId && part.source_pdf_sha256 === selection.sourcePdfSha256 && part.extracted_text_sha256 === selection.extractedTextSha256 && part.extractor_version === selection.extractorVersion && part.segmenter_version === selection.segmenterVersion && part.segment_max_bytes === 4000 && part.replay_state === "EXACT" && part.segment_index === start + index && typeof part.text === "string" && new TextEncoder().encode(part.text).length <= 4000 && Number.isSafeInteger(part.page_start) && (part.page_start as number) >= 0 && Number.isSafeInteger(part.page_end) && (part.page_end as number) >= (part.page_start as number) && Number.isSafeInteger(part.start_byte) && (part.start_byte as number) >= 0 && Number.isSafeInteger(part.end_byte) && (part.end_byte as number) - (part.start_byte as number) === new TextEncoder().encode(part.text).length && typeof part.segment_text_sha256 === "string" && /^[a-f0-9]{64}$/.test(part.segment_text_sha256))) return null;
  if (start + value.segments.length > (value.segment_count_total as number) || (value.segment_count_total !== 0 && start >= (value.segment_count_total as number)) || (start < (value.segment_count_total as number) && value.segments.length === 0)) return null;
  return { selection, segments: value.segments as ReadingSegment[], total: value.segment_count_total as number, textLayer: value.text_layer_state as ReadingBody["textLayer"], catalogGeneratedAt: record(value.source) && typeof value.source.catalog_generated_at === "string" ? value.source.catalog_generated_at : null };
}
export type TodayChip = { id: string; section: string; label: Pair; value: Pair; tone: string; null: boolean; cause: unknown; note: Pair | null; meaning: Pair | null; as_of: string | null; as_of_display: Pair | null };
export type TodayPayload = { schema: string; state: "ready" | "partial" | "unavailable"; source: { manifest_generated_at: string | null; manifest_sha256: string; composed_at: string }; read: { as_of: string | null; as_of_display: Pair | null; as_of_meaning: Pair | null; omitted: boolean; clauses: { topic: Pair; predicate: Pair; punct: Pair; section: string }[] }; strip: TodayChip[]; coverage: { available: number; total: number }; sections: { id: string; label: Pair; href: string }[]; workspaces: { workspace_id: string; title: Pair; state: string | null; effective_date: string | null; calculation_as_of: string | null; failure: unknown; availability: unknown; href: string }[] };
export function todayPayload(value: unknown): TodayPayload | null {
  if (!record(value) || value.schema !== "mastermind.macro_command_read.v1" || !["ready","partial","unavailable"].includes(value.state as string) || !record(value.source) || value.source.served_root_qualified !== true || !record(value.read) || !record(value.coverage)) return null;
  if (!Number.isSafeInteger(value.coverage.available) || !Number.isSafeInteger(value.coverage.total) || (value.coverage.available as number) < 0 || (value.coverage.available as number) > (value.coverage.total as number)) return null;
  const nullableText = (entry: unknown) => entry === null || typeof entry === "string";
  const nullablePair = (entry: unknown) => entry === null || pair(entry);
  if (typeof value.source.manifest_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.source.manifest_sha256) || !nullableText(value.source.manifest_generated_at) || !nullableText(value.read.as_of) || !nullablePair(value.read.as_of_display) || !nullablePair(value.read.as_of_meaning) || typeof value.read.omitted !== "boolean") return null;
  if (!Array.isArray(value.strip) || !value.strip.every(chip => record(chip) && typeof chip.id === "string" && typeof chip.section === "string" && pair(chip.label) && pair(chip.value))) return null;
  if (!Array.isArray(value.read.clauses) || !value.read.clauses.every(clause => record(clause) && pair(clause.topic) && pair(clause.predicate) && pair(clause.punct) && typeof clause.section === "string")) return null;
  if (!Array.isArray(value.sections) || !value.sections.every(section => record(section) && typeof section.id === "string" && pair(section.label) && section.href === `/macro_monetary.html#${section.id}` && /^[a-z0-9_-]+$/.test(section.id))) return null;
  if (!Array.isArray(value.workspaces) || !value.workspaces.every(workspace => record(workspace) && typeof workspace.workspace_id === "string" && pair(workspace.title) && nullableText(workspace.state) && nullableText(workspace.effective_date) && nullableText(workspace.calculation_as_of))) return null;
  return value as unknown as TodayPayload;
}
