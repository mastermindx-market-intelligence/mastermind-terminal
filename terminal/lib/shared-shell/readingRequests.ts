import { readingQuery, type ReadingSelection } from "./readingContracts";
/** URL/progress identity keeps the complete tuple. The incumbent API accepts
 * only the two hashes and text-window bounds; docId is already in its path. */
export function researchReadQuery(selection: ReadingSelection, start = 0): URLSearchParams {
  const full = readingQuery(selection, start);
  const query = new URLSearchParams();
  for (const key of ["source_pdf_sha256","extracted_text_sha256","segment_start","max_segments"])
    query.set(key, full.get(key)!);
  return query;
}
