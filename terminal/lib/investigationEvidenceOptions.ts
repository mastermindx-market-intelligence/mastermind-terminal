import type { ExposureChartRequest } from "./exposureChartLink";
import type { ExposureOrigin } from "./exposureOrigin";
import type { InvestigationEvidenceRef } from "./investigationContracts";

/** Evidence adapter for the Options journey (W2C). It mints pinned references to what the person actually
 * looked at: a bounded exposure read, the sector roster they arrived from and one rotation measurement.
 * References identify and fingerprint sources; they never grant access and never re-derive a value. */
export const OPTIONS_EVIDENCE_OWNER = "terminal.options_exposure" as const;
export const OPTIONS_EVIDENCE_OBJECT_TYPES = ["exposure_chart_request", "sector_origin", "rotation_measurement"] as const;
export type OptionsEvidenceObjectType = (typeof OPTIONS_EVIDENCE_OBJECT_TYPES)[number];

export interface RotationMeasurementInput {
  method: string;
  version: string;
  sector: string;
  observationDate: string;
  vintage?: string;
}

export interface OptionsEvidenceInput {
  request?: ExposureChartRequest;
  origin?: ExposureOrigin;
  rotation?: RotationMeasurementInput;
}

export type OptionsEvidenceState = "matches" | "source_corrected" | "unavailable";

export interface OptionsEvidenceStatus {
  ref: InvestigationEvidenceRef;
  state: OptionsEvidenceState;
  savedFingerprint: string | null;
  currentFingerprint: string | null;
}

const MAX_REF_TEXT = 256;
const DIGEST = /^[0-9a-f]{64}$/;
const STATE_LABELS: Record<OptionsEvidenceState, { en: string; zh: string }> = {
  matches: { en: "Matches the saved source", zh: "与保存时来源一致" },
  source_corrected: { en: "Source corrected since this revision", zh: "来源在此版本后已修正" },
  unavailable: { en: "Current source unavailable", zh: "当前来源不可用" },
};

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(row).sort().map(key => [key, sortKeys(row[key])]));
  }
  return value;
}

/** Stable serialisation: sorted keys, no whitespace, so equal content always digests equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

const normaliseDigest = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const bare = value.replace(/^sha256:/i, "").toLowerCase();
  return DIGEST.test(bare) ? bare : null;
};

function pinned(objectType: OptionsEvidenceObjectType, objectId: string, versionRef: string, fingerprint: string | null): InvestigationEvidenceRef {
  if (objectId.length > MAX_REF_TEXT || versionRef.length > MAX_REF_TEXT) throw new Error("evidence_ref_too_long");
  const ref: InvestigationEvidenceRef = { owner: OPTIONS_EVIDENCE_OWNER, object_type: objectType, object_id: objectId, mode: "pinned", version_ref: versionRef };
  if (fingerprint !== null) ref.fingerprint = fingerprint;
  return ref;
}

const lensKey = (lens: ExposureChartRequest["lens"]): string => lens.kind === "one" ? `one:${lens.exp}` : lens.kind;

async function requestRef(request: ExposureChartRequest): Promise<InvestigationEvidenceRef> {
  const objectId = `${request.root}/${request.session}/${request.strike}/${request.metric}/${lensKey(request.lens)}`;
  const versionRef = `exposure_chart_request.v1:${await sha256Hex(canonicalJson(request))}`;
  return pinned("exposure_chart_request", objectId, versionRef, normaliseDigest(request.fingerprint));
}

function originRef(origin: ExposureOrigin): InvestigationEvidenceRef {
  const objectId = `${origin.sector}/${origin.group}/${origin.company}`;
  return pinned("sector_origin", objectId, `exposure_origin.v1@${origin.asOf ?? "undated"}`, normaliseDigest(origin.contentHash));
}

function rotationRef(rotation: RotationMeasurementInput): InvestigationEvidenceRef {
  const objectId = `${rotation.method}:${rotation.sector}:${rotation.observationDate}`;
  const versionRef = rotation.vintage === undefined ? rotation.version : `${rotation.version}@${rotation.vintage}`;
  return pinned("rotation_measurement", objectId, versionRef, normaliseDigest(rotation.vintage));
}

/** Mint the references for what is on screen, in journey order: the read, where it came from, the measurement it sat on. */
export async function optionsEvidenceRefs(input: OptionsEvidenceInput): Promise<InvestigationEvidenceRef[]> {
  const refs: InvestigationEvidenceRef[] = [];
  if (input.request) refs.push(await requestRef(input.request));
  if (input.origin) refs.push(originRef(input.origin));
  if (input.rotation) refs.push(rotationRef(input.rotation));
  return refs;
}

export function isOptionsEvidenceRef(ref: InvestigationEvidenceRef): boolean {
  return ref.owner === OPTIONS_EVIDENCE_OWNER && (OPTIONS_EVIDENCE_OBJECT_TYPES as readonly string[]).includes(ref.object_type);
}

/** On reopen, compare each saved Options reference with what the current source would mint for the same object.
 * Saved references are never rewritten; the result only reports whether the source still matches. */
export async function evaluateOptionsEvidence(saved: readonly InvestigationEvidenceRef[], current: OptionsEvidenceInput): Promise<OptionsEvidenceStatus[]> {
  const minted = await optionsEvidenceRefs(current);
  const byObject = new Map(minted.map(ref => [`${ref.object_type}\u0000${ref.object_id}`, ref]));
  const statuses: OptionsEvidenceStatus[] = [];
  for (const ref of saved) {
    if (!isOptionsEvidenceRef(ref)) continue;
    const savedFingerprint = ref.fingerprint ?? null;
    const live = byObject.get(`${ref.object_type}\u0000${ref.object_id}`);
    if (!live) {
      statuses.push({ ref, state: "unavailable", savedFingerprint, currentFingerprint: null });
      continue;
    }
    const currentFingerprint = live.fingerprint ?? null;
    // A saved reference without a fingerprint can only be shown equal to a source that is still unfingerprinted
    // at the same version; a newly fingerprinted source is reported as corrected rather than assumed equal.
    const same = savedFingerprint !== null
      ? savedFingerprint === currentFingerprint
      : currentFingerprint === null && ref.version_ref === live.version_ref;
    statuses.push({ ref, state: same ? "matches" : "source_corrected", savedFingerprint, currentFingerprint });
  }
  return statuses;
}

export function optionsEvidenceStateLabel(state: OptionsEvidenceState, lang: "en" | "zh"): string {
  return STATE_LABELS[state][lang];
}
