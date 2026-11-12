import { parseReadingSelection, progressKey, type ReadingSelection } from "./readingContracts";

export type ReadingProgress = { selection: ReadingSelection; segmentStart: number };
const pointerKey = (subject: string) => `mm.research.last.v1:${subject}`;
export function readingHref(selection: ReadingSelection, segmentStart = 0): string {
  const query = new URLSearchParams({ doc_id: selection.docId, source_pdf_sha256: selection.sourcePdfSha256,
    extracted_text_sha256: selection.extractedTextSha256, extractor_version: selection.extractorVersion,
    segmenter_version: selection.segmenterVersion, segment_start: String(segmentStart) });
  return `/research?${query}`;
}
export function loadReadingProgress(subject: string, storage: Pick<Storage,"getItem">): ReadingProgress | null {
  try {
    const pointer: unknown = JSON.parse(storage.getItem(pointerKey(subject)) || "null");
    if (!pointer || typeof pointer !== "object") return null;
    const selection = parseReadingSelection((pointer as ReadingProgress).selection);
    if (!selection) return null;
    const raw: unknown = JSON.parse(storage.getItem(progressKey(subject, selection)) || "null");
    if (!raw || typeof raw !== "object") return null;
    const segmentStart = (raw as ReadingProgress).segmentStart;
    if (!Number.isSafeInteger(segmentStart) || segmentStart < 0) return null;
    return { selection, segmentStart };
  } catch { return null; }
}
export function saveReadingProgress(subject: string, progress: ReadingProgress, storage: Pick<Storage,"setItem">): boolean {
  try {
    const selection = parseReadingSelection(progress.selection);
    if (!selection || !Number.isSafeInteger(progress.segmentStart) || progress.segmentStart < 0) return false;
    storage.setItem(progressKey(subject, selection), JSON.stringify({ segmentStart: progress.segmentStart }));
    storage.setItem(pointerKey(subject), JSON.stringify({ selection }));
    return true;
  } catch { return false; }
}
export function loadBrowserReadingProgress(subject: string): ReadingProgress | null {
  try { return loadReadingProgress(subject, window.localStorage); } catch { return null; }
}
export function saveBrowserReadingProgress(subject: string, progress: ReadingProgress): boolean {
  try { return saveReadingProgress(subject, progress, window.localStorage); } catch { return false; }
}
