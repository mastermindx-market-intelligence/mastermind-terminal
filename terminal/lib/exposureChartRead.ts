import { exposureChartFingerprint, type ExposureChartRequest } from "./exposureChartLink";
import { readExposureMap } from "./exposureMap";
import { flowGetResult } from "./flowClientCache";
import type { GexMatrix } from "./gexLadder";

/** What one re-resolution of a bounded exposure request established. `changed` carries the current digest whenever a
 * value could still be read at the same session and strike, so a saved revision can show both digests side by side. */
export type ExposureChartRead =
  | { state: "unavailable" }
  | { state: "changed"; fingerprint: string | null }
  | { state: "ready"; fingerprint: string; session: string; strike: number };

/** Re-resolve a request through the incumbent source cache: the same read the chart reference performs.
 * The request supplies a selection and a comparison digest, never a drawable exposure. */
export async function readExposureChartRequest(request: ExposureChartRequest, now = Date.now()): Promise<ExposureChartRead> {
  const outcome = await flowGetResult(request.archived ? `gex_at:${request.root}:${request.session}` : `gex:${request.root}`, { refresh: true });
  if (outcome.status !== "data") return { state: "unavailable" };
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  let read = readExposureMap(outcome.data, request.root, null, request.lens, request.metric, today, now, request.shock);
  if (read.state === "unavailable" && read.qualification === "legacy" && request.lens.kind !== "all" && !request.archived) {
    const matrix = await flowGetResult(`matrix:${request.root}`, { refresh: true });
    if (matrix.status === "data") read = readExposureMap(outcome.data, request.root, matrix.data as GexMatrix, request.lens, request.metric, today, now, request.shock);
  }
  const node = read.summary.nodes.find(item => item.strike === request.strike);
  if (read.state !== "data" || read.session !== request.session || !node || (node.netMn == null && node.grossMn == null)) return { state: "changed", fingerprint: null };
  const fingerprint = await exposureChartFingerprint(request.root, read, request.lens, request.metric, request.shock);
  if (fingerprint !== request.fingerprint) return { state: "changed", fingerprint };
  return { state: "ready", fingerprint, session: read.session, strike: node.strike };
}
