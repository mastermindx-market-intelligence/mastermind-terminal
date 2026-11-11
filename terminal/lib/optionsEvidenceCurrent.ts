import { readExposureChartRequest } from "./exposureChartRead";
import type { InvestigationEvidenceRef } from "./investigationContracts";
import {
  evaluateOptionsEvidence, exposureRequestFromRef, isOptionsEvidenceRef,
  type OptionsEvidenceInput, type OptionsEvidenceStatus, type OriginEvidenceInput,
} from "./investigationEvidenceOptions";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
type FetchJson = (url: string) => Promise<unknown>;
const defaultFetch: FetchJson = async url => (await fetch(url, { cache: "no-store" })).json();

/** The roster a sector origin pointed at, as its feed reports it now. Null when the feed is not readable. */
async function currentOrigin(ref: InvestigationEvidenceRef, fetchJson: FetchJson): Promise<OriginEvidenceInput | null> {
  const [sector, group, company, ...rest] = ref.object_id.split("/");
  if (!sector || !group || !company || rest.length) return null;
  const value = await fetchJson("/api/sector-intelligence?source=confluence");
  if (!record(value) || !record(value.receipt) || value.receipt.status !== "ready") return null;
  const asOf = typeof value.receipt.asOf === "string" ? value.receipt.asOf : null;
  const contentHash = typeof value.receipt.contentHash === "string" ? value.receipt.contentHash : null;
  return { sector, group, company, asOf, contentHash };
}

/** Evaluate the Options references a revision saved against what their sources say now. Nothing saved is rewritten;
 * each status reports whether the same object still digests equally and carries both digests when it does not.
 * A source that cannot be read is reported as unavailable, never as equal. */
export async function currentOptionsEvidence(saved: readonly InvestigationEvidenceRef[], options: { fetchJson?: FetchJson; now?: number } = {}): Promise<OptionsEvidenceStatus[]> {
  const refs = saved.filter(isOptionsEvidenceRef);
  if (!refs.length) return [];
  const fetchJson = options.fetchJson ?? defaultFetch;
  const current: OptionsEvidenceInput = {};
  const requestRef = refs.find(ref => ref.object_type === "exposure_chart_request");
  const request = requestRef ? exposureRequestFromRef(requestRef) : null;
  if (request) {
    try {
      const read = await readExposureChartRequest(request, options.now);
      if (read.state !== "unavailable") current.request = { ...request, fingerprint: read.fingerprint ?? "" };
    } catch { /* reported as unavailable below */ }
  }
  const originRef = refs.find(ref => ref.object_type === "sector_origin");
  if (originRef) {
    try {
      const origin = await currentOrigin(originRef, fetchJson);
      if (origin) current.origin = origin;
    } catch { /* reported as unavailable below */ }
  }
  return evaluateOptionsEvidence(refs, current);
}
