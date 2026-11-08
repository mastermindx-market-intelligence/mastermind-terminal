/** Request-local protocol adapter for the incumbent Matrix read. No reader/cache/grant. */
import { ownerUserId } from "./accountIdentity";
import { canonicalJson, sha256Hex } from "./investigationEvidenceOptions";
import { parseOptionsMatrixVersionRef } from "./investigationOptionsReference";
import { mintOptionsSelectionEvidence, type OptionsSelectionMintInput } from "./investigationEvidenceOptionsSelection";
import { isGregorianDate, MATRIX_ACQUIRED_BYTES_MAX } from "./matrixAcquisition";
import { isValidRoot } from "./flowRoot";
import { decodeRetainedOptions, type RetainedInput } from "./retainedOptionsWire";

export type RetainedMatrixRequest = {
  root: string; ownerKey: string; session: string; version_ref: string; sha256: string;
  expiry: string; side: "all" | "call" | "put"; selection: string;
};
/** Object identity is the mounted selection epoch, including A -> null -> A. */
export type RetainedMatrixBinding = { request: RetainedMatrixRequest };
export type RetainedMatrixAvailable = {
  schema: "options.matrix.read/v1"; status: "available"; display: Record<string, unknown>;
  retained: { wire_utf8: string; reference: { root: string; session: string; version_ref: string; sha256: string; byte_length: number };
    selector: { expiry: string; side: string }; read_generation: string; selection_sha256: string; owner_id: string };
  reason: null;
};
export type RetainedMatrixUnavailable = { schema: "options.matrix.read/v1"; status: "unavailable"; display: null; retained: null; reason: string };
export type RetainedMatrixResponse = RetainedMatrixAvailable | RetainedMatrixUnavailable;
export type MountedRetainedMatrix = { binding: RetainedMatrixBinding; result: RetainedMatrixAvailable };
export const retainedUnavailable = (reason = "unavailable"): RetainedMatrixUnavailable =>
  ({ schema: "options.matrix.read/v1", status: "unavailable", display: null, retained: null, reason });
export const RETAINED_QUERY_KEYS = ["retained", "version_ref", "sha256", "session", "expiry", "side", "selection"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const closed = (v: unknown, keys: string[]): v is Record<string, unknown> => obj(v) && Object.keys(v).sort().join() === [...keys].sort().join();

export function validRetainedRequest(r: RetainedMatrixRequest): boolean {
  try {
    const ref = parseOptionsMatrixVersionRef(r.version_ref, r.sha256, MATRIX_ACQUIRED_BYTES_MAX);
    const s: unknown = JSON.parse(r.selection);
    return isValidRoot(r.root) && UUID.test(ownerUserId(r.ownerKey)) && !!ref && ref.sourceSession === r.session
      && isGregorianDate(r.session) && isGregorianDate(r.expiry) && ["all", "call", "put"].includes(r.side)
      && new TextEncoder().encode(r.selection).length <= 16_384
      && obj(s) && s.schema === "options_matrix_selection.v1" && obj(s.view)
      && s.view.expiry === r.expiry && s.view.side === r.side;
  } catch { return false; }
}

/** The existing mint names an expected object; only the server can qualify its immutable read. */
export function prepareRetainedMatrixRequest(input: OptionsSelectionMintInput, ownerKey: string | null): RetainedMatrixRequest | null {
  if (!ownerKey || !isGregorianDate(input.view.expiry)) return null;
  const minted = mintOptionsSelectionEvidence(input);
  if (!minted.ok || !input.session) return null;
  const request: RetainedMatrixRequest = { root: input.root, ownerKey, session: input.session,
    version_ref: minted.ref.version_ref!, sha256: minted.ref.fingerprint!,
    expiry: input.view.expiry, side: input.view.side as RetainedMatrixRequest["side"], selection: minted.selection };
  return validRetainedRequest(request) ? Object.freeze(request) : null;
}

export function retainedQuery(r: RetainedMatrixRequest): URLSearchParams {
  return new URLSearchParams({ retained: "1", version_ref: r.version_ref, sha256: r.sha256,
    session: r.session, expiry: r.expiry, side: r.side, selection: r.selection });
}

/** Parse only the frozen query, with f allowed solely at Terminal's existing route. */
export function parseRetainedQuery(params: URLSearchParams, root: string, ownerKey: string): RetainedMatrixRequest | null {
  if ([...params.keys()].sort().join() !== [...RETAINED_QUERY_KEYS, "f"].sort().join() || params.get("retained") !== "1") return null;
  if ([...params.values()].some(v => new TextEncoder().encode(v).length > 16_384)) return null;
  const r: RetainedMatrixRequest = { root, ownerKey, version_ref: params.get("version_ref")!, sha256: params.get("sha256")!,
    session: params.get("session")!, expiry: params.get("expiry")!, side: params.get("side") as RetainedMatrixRequest["side"], selection: params.get("selection")! };
  return validRetainedRequest(r) ? Object.freeze(r) : null;
}

/** Validate the coupled result against this request, never against a cached display. */
export async function validateRetainedMatrixResponse(value: unknown, request: RetainedMatrixRequest): Promise<RetainedMatrixResponse> {
  try {
    if (!validRetainedRequest(request) || !closed(value, ["schema", "status", "display", "retained", "reason"])
      || value.schema !== "options.matrix.read/v1") return retainedUnavailable("invalid_response");
    if (value.status === "unavailable") {
      return value.display === null && value.retained === null && typeof value.reason === "string" && /^[a-z0-9_]{1,96}$/.test(value.reason)
        ? value as RetainedMatrixUnavailable : retainedUnavailable("invalid_response");
    }
    const r = value.retained;
    if (value.status !== "available" || value.reason !== null || !obj(value.display)
      || !closed(r, ["wire_utf8", "reference", "selector", "read_generation", "selection_sha256", "owner_id"])
      || !closed(r.reference, ["root", "session", "version_ref", "sha256", "byte_length"])
      || !closed(r.selector, ["expiry", "side"]) || r.owner_id !== ownerUserId(request.ownerKey)
      || r.reference.root !== request.root || r.reference.session !== request.session
      || r.reference.sha256 !== request.sha256 || r.reference.version_ref !== request.version_ref
      || r.selector.expiry !== request.expiry || r.selector.side !== request.side
      || typeof r.read_generation !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(r.read_generation)
      || typeof r.wire_utf8 !== "string" || r.wire_utf8.length > 64 * 1024 * 1024
      || r.selection_sha256 !== await sha256Hex(request.selection)) return retainedUnavailable("invalid_binding");
    const view = await decodeRetainedOptions(r.wire_utf8, request);
    if (!view || view.kind !== "matrix") return retainedUnavailable("invalid_wire");
    const wire = JSON.parse(r.wire_utf8);
    if (wire.snapshot.version_ref !== request.version_ref || wire.snapshot.sha256 !== request.sha256
      || wire.snapshot.byte_length !== r.reference.byte_length || wire.selector.expiry !== request.expiry
      || wire.selector.side !== request.side) return retainedUnavailable("invalid_binding");
    // Existing chart coordinates use Number. Never promote its rounded spelling
    // to a different exact captured coordinate. The supplier remains authoritative;
    // this checks its returned pair against the exact requested primary/comparisons.
    const selection = JSON.parse(request.selection);
    if (!Array.isArray(selection.comparisons) || selection.comparisons.length > 3) return retainedUnavailable("invalid_coordinate");
    const cells: unknown[] = wire.document.object.cells.array;
    for (const coordinate of [selection.primary, ...selection.comparisons]) {
      if (!obj(coordinate) || !["call", "put"].includes(String(coordinate.side))
        || !cells.some(cell => obj(cell) && obj(cell.object) && obj(cell.object.strike)
          && cell.object.expiry === coordinate.expiry && cell.object.strike.decimal === coordinate.strike)) {
        return retainedUnavailable("invalid_coordinate");
      }
    }
    const bytes = Uint8Array.from(atob(view.captureBase64), c => c.charCodeAt(0));
    const display: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!obj(display) || canonicalJson(display) !== canonicalJson(value.display)) return retainedUnavailable("display_mismatch");
    return value as RetainedMatrixAvailable;
  } catch { return retainedUnavailable("invalid_response"); }
}

export function retainedInput(result: RetainedMatrixAvailable, request: RetainedMatrixRequest): RetainedInput {
  return { root: request.root, session: request.session, ownerKey: request.ownerKey, wire: result.retained.wire_utf8 };
}

/** A marker is only a request hint. Do not place verified wire beside a different
 * ordinary book. Ignore only the incumbent locally attached expected marker. */
export function retainedDisplayMatches(matrix: unknown, result: RetainedMatrixAvailable): boolean {
  if (!obj(matrix)) return false;
  const { _matrix_source_identity: expectedIdentity, ...display } = matrix;
  void expectedIdentity;
  try { return canonicalJson(display) === canonicalJson(result.display); }
  catch { return false; }
}
