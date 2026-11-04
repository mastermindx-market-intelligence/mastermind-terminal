import { canonicalJson, OPTIONS_EVIDENCE_OWNER } from "./investigationEvidenceOptions";
import { parseOptionsMatrixVersionRef } from "./investigationOptionsReference";
import type { InvestigationEvidenceRef } from "./investigationContracts";

/** Terminal mint for retained Options Matrix selection evidence (OPT-006 v3 lane 1b). The mint
 *  COMPUTES the object_id, the refusal reasons and the canonical v1 selection bytes, and CARRIES
 *  the root spelling, source session, matrix digest and byte length. It NEVER computes snapshot
 *  membership, underlying identity, hidden flags, clocks or rights — those stay with Macro's
 *  resolve_option_matrix_selection. Pure and synchronous: no I/O, no clock, no storage. */
export const OPTIONS_SELECTION_OBJECT_TYPE = "options_matrix_selection" as const;
export const OPTIONS_MATRIX_SOURCE_MAX_BYTES = 16777216; // producer ceiling, Macro docs/OPTIONS_MATRIX_RETENTION.md l.8 and l.39

export type OptionsSelectionCoordinate = { expiry: string; side: string; strikeToken: string | null };

export type OptionsSelectionMintInput = {
  root: string;
  session: string | null;
  matrix: { sha256: string; bytes: number } | null;
  lens: string;
  primary: OptionsSelectionCoordinate | null;
  comparisons: readonly OptionsSelectionCoordinate[];
  view: { metric: string; side: string; expiry: string; displayMode: string };
};

export type OptionsSelectionRefusal =
  | "input_invalid"
  | "source_session_unavailable"
  | "matrix_unavailable"
  | "root_not_carried"
  | "no_primary"
  | "expiry_invalid"
  | "strike_not_exact"
  | "side_invalid"
  | "comparisons_over_limit"
  | "comparison_duplicate"
  | "lens_not_chain"
  | "view_invalid"
  | "version_ref_invalid"
  | "selection_too_long"
  | "evidence_ref_too_long";

export type OptionsSelectionMint =
  | { ok: true; ref: InvestigationEvidenceRef; selection: string }
  | { ok: false; reason: OptionsSelectionRefusal };

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ROOT_PATTERN = /^[A-Z0-9](?:[A-Z0-9.-]{0,13}[A-Z0-9])?$/;
const STRIKE_PATTERN = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{0,7}[1-9])?$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const SELECTION_MAX_BYTES = 2048;
const OBJECT_ID_MAX_LENGTH = 256;
const COMPARISONS_MAX = 3;

const PLAIN = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Canonical Gregorian YYYY-MM-DD by arithmetic only — calendar math, never a clock. */
function DATE(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const limit = month === 2 ? (leap ? 29 : 28) : DAYS_IN_MONTH[month - 1];
  return limit !== undefined && day <= limit;
}

const isCoordinate = (value: unknown): value is OptionsSelectionCoordinate => {
  if (!PLAIN(value)) return false;
  if (typeof value.expiry !== "string" || typeof value.side !== "string") return false;
  return value.strikeToken === null || typeof value.strikeToken === "string";
};

type OptionsSelectionView = OptionsSelectionMintInput["view"];

const isView = (value: unknown): value is OptionsSelectionView => {
  if (!PLAIN(value)) return false;
  return (
    typeof value.metric === "string" && typeof value.side === "string"
    && typeof value.expiry === "string" && typeof value.displayMode === "string"
  );
};

const isMatrix = (value: unknown): value is { sha256: string; bytes: number } => {
  if (!PLAIN(value)) return false;
  return typeof value.sha256 === "string" && typeof value.bytes === "number";
};

const refusal = (reason: OptionsSelectionRefusal): OptionsSelectionMint => ({ ok: false, reason });

/** The three typed coordinate checks in stored order: real Gregorian expiry, exact canonical
 *  positive strike token, then the call/put side. */
const coordinateRefusal = (coordinate: OptionsSelectionCoordinate): OptionsSelectionRefusal | null => {
  if (!DATE(coordinate.expiry)) return "expiry_invalid";
  const strike = coordinate.strikeToken;
  if (strike === null || strike.length > 21 || strike === "0" || !STRIKE_PATTERN.test(strike)) return "strike_not_exact";
  if (coordinate.side !== "call" && coordinate.side !== "put") return "side_invalid";
  return null;
};

const coordinateSegment = (coordinate: OptionsSelectionCoordinate): string =>
  `${coordinate.expiry},${coordinate.side},${coordinate.strikeToken}`;

/** Mint the pinned reference for what the person selected in the Options Matrix chain lens.
 *  The first failing check wins; the object_id names every bounded field so a reopen can rebuild
 *  the exact selection from the reference alone. */
export function mintOptionsSelectionEvidence(input: OptionsSelectionMintInput): OptionsSelectionMint {
  try {
    const source: unknown = input;
    if (!PLAIN(source)) return refusal("input_invalid");
    const root = source.root;
    const lens = source.lens;
    const session = source.session;
    const view = source.view;
    const primary = source.primary;
    const comparisonsValue = source.comparisons;
    const matrix = source.matrix;
    // Group 1 — closed shape and string types only; any failure here is input_invalid.
    if (!isView(view)) return refusal("input_invalid");
    if (primary !== null && !isCoordinate(primary)) return refusal("input_invalid");
    if (!Array.isArray(comparisonsValue)) return refusal("input_invalid");
    const comparisonCoordinates = comparisonsValue.filter(isCoordinate);
    if (comparisonCoordinates.length !== comparisonsValue.length) return refusal("input_invalid");
    if (matrix !== null && !isMatrix(matrix)) return refusal("input_invalid");
    if (typeof root !== "string" || typeof lens !== "string") return refusal("input_invalid");
    if (session !== null && typeof session !== "string") return refusal("input_invalid");
    // Carried state: session, matrix source, root spelling, primary presence.
    if (session === null || !DATE(session)) return refusal("source_session_unavailable");
    if (matrix === null || !SHA256_HEX.test(matrix.sha256) || !Number.isSafeInteger(matrix.bytes) || matrix.bytes <= 0) {
      return refusal("matrix_unavailable");
    }
    if (!ROOT_PATTERN.test(root) || root.includes("..")) return refusal("root_not_carried");
    if (primary === null) return refusal("no_primary");
    // Primary coordinate, then the comparison cap, then each comparison in stored order.
    const primaryRefusal = coordinateRefusal(primary);
    if (primaryRefusal !== null) return refusal(primaryRefusal);
    if (comparisonCoordinates.length > COMPARISONS_MAX) return refusal("comparisons_over_limit");
    for (const coordinate of comparisonCoordinates) {
      const comparisonRefusal = coordinateRefusal(coordinate);
      if (comparisonRefusal !== null) return refusal(comparisonRefusal);
    }
    // Comparisons are value-keyed: two equal comparisons refuse; equal-to-primary does not.
    const seen = new Set<string>();
    for (const coordinate of comparisonCoordinates) {
      const key = coordinateSegment(coordinate);
      if (seen.has(key)) return refusal("comparison_duplicate");
      seen.add(key);
    }
    if (lens !== "chain") return refusal("lens_not_chain");
    // Stored view filters, checked metric, side, expiry, displayMode.
    if (view.metric !== "volume" && view.metric !== "openInterest" && view.metric !== "deltaOi") return refusal("view_invalid");
    if (view.side !== "all" && view.side !== "call" && view.side !== "put") return refusal("view_invalid");
    if (view.expiry !== "all" && !DATE(view.expiry)) return refusal("view_invalid");
    if (view.displayMode !== "3d" && view.displayMode !== "table") return refusal("view_invalid");
    // The version reference is carried, never inferred: re-decode it against the producer ceiling.
    const sha256 = matrix.sha256;
    const versionRef = `sha256:${sha256}:bytes:${matrix.bytes}:session:${session}`;
    const decoded = parseOptionsMatrixVersionRef(versionRef, sha256, OPTIONS_MATRIX_SOURCE_MAX_BYTES);
    if (decoded === null || decoded.sourceSession !== session) return refusal("version_ref_invalid");
    const objectId = `v1/${root}/${session}/${coordinateSegment(primary)}/${comparisonCoordinates.map(coordinateSegment).join(";")}/${view.metric},${view.side},${view.expiry},${view.displayMode}`;
    const selection = selectionFromObjectId(objectId);
    if (selection === null) return refusal("input_invalid");
    if (new TextEncoder().encode(selection).length > SELECTION_MAX_BYTES) return refusal("selection_too_long");
    if (objectId.length > OBJECT_ID_MAX_LENGTH) return refusal("evidence_ref_too_long");
    const ref: InvestigationEvidenceRef = {
      owner: OPTIONS_EVIDENCE_OWNER,
      object_type: OPTIONS_SELECTION_OBJECT_TYPE,
      object_id: objectId,
      mode: "pinned",
      version_ref: versionRef,
      fingerprint: sha256,
    };
    return { ok: true, ref, selection };
  } catch {
    return refusal("input_invalid");
  }
}

function coordinateFields(segment: string): { expiry: string; side: string; strike: string } | null {
  const fields = segment.split(",");
  if (fields.length !== 3) return null;
  const expiry = fields[0];
  const side = fields[1];
  const strike = fields[2];
  if (expiry === undefined || side === undefined || strike === undefined) return null;
  return { expiry, side, strike };
}

/** Rebuild the canonical v1 selection bytes from an object_id this mint could have written, by
 *  shape only. Null for any other string — never a validation of the coordinates themselves. */
export function selectionFromObjectId(objectId: string): string | null {
  const parts = objectId.split("/");
  if (parts.length !== 6) return null;
  const version = parts[0];
  const primarySegment = parts[3];
  const comparisonSegment = parts[4];
  const viewSegment = parts[5];
  if (version === undefined || version !== "v1") return null;
  if (primarySegment === undefined || comparisonSegment === undefined || viewSegment === undefined) return null;
  const primaryCoordinate = coordinateFields(primarySegment);
  if (primaryCoordinate === null) return null;
  const comparisons: Array<{ expiry: string; side: string; strike: string }> = [];
  if (comparisonSegment !== "") {
    for (const item of comparisonSegment.split(";")) {
      const coordinate = coordinateFields(item);
      if (coordinate === null) return null;
      comparisons.push(coordinate);
    }
  }
  const viewFields = viewSegment.split(",");
  if (viewFields.length !== 4) return null;
  const metric = viewFields[0];
  const viewSide = viewFields[1];
  const viewExpiry = viewFields[2];
  const displayMode = viewFields[3];
  if (metric === undefined || viewSide === undefined || viewExpiry === undefined || displayMode === undefined) return null;
  return canonicalJson({
    schema: "options_matrix_selection.v1",
    primary: primaryCoordinate,
    comparisons,
    view: { lens: "chain", metric, side: viewSide, expiry: viewExpiry, display_mode: displayMode },
  });
}
