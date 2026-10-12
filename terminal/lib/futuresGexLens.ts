/** Strict PIT adapter around the EXISTING GEX desk's matrix lens, not new Greek math. */
import { matrixLensByStrike, type ExpiryLens, type GexMatrix } from "./gexLadder";
import { isRecord, finiteNumber, validClockMs } from "./futuresGexProjection";

export type FuturesSourceReceipt = {
  artifactId: string; sessionDate: string; sourceAsOfMs: number; availableAtMs: number;
};
export type FuturesMatrixSource = { payload: unknown; receipt: FuturesSourceReceipt };
export type FuturesLensReason = "invalid_expiry_lens" | "matrix_unavailable" | "matrix_receipt" |
  "matrix_clock" | "matrix_session" | "matrix_schema" | "matrix_rows" | "expiry_unavailable";
export type FuturesLensSelection = { status: "unavailable"; reason: FuturesLensReason } | {
  status: "ok"; byStrike: Map<number, number | null>; matrixArtifactId: string;
  matrixAvailableAtMs: number; matrixAsOfMs: number; sessionDate: string; selectedExpiries: string[];
};
const fail = (reason: FuturesLensReason): FuturesLensSelection => ({ status: "unavailable", reason });
export const isExpiryDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
};
export const validFuturesLens = (value: unknown): value is ExpiryLens => isRecord(value) &&
  typeof value.kind === "string" && ["all", "zero", "ex-zero", "one"].includes(value.kind) &&
  (value.kind !== "one" || isExpiryDate(value.exp));

export function selectFuturesGexLens({ matrix, lens, root, sourceSession, strikes, decisionTimeMs, maxAgeMs }: {
  matrix?: FuturesMatrixSource; lens: ExpiryLens; root: string; sourceSession: string;
  strikes: number[]; decisionTimeMs: number; maxAgeMs: number;
}): FuturesLensSelection {
  if (!validFuturesLens(lens) || lens.kind === "all") return fail("invalid_expiry_lens");
  if (!isRecord(matrix) || !isRecord(matrix.payload)) return fail("matrix_unavailable");
  const receipt = matrix.receipt;
  if (!isRecord(receipt) || typeof receipt.artifactId !== "string" || !receipt.artifactId.trim() ||
      !isExpiryDate(receipt.sessionDate) || !validClockMs(receipt.sourceAsOfMs) || !validClockMs(receipt.availableAtMs))
    return fail("matrix_receipt");
  if (!validClockMs(decisionTimeMs) || !finiteNumber(maxAgeMs) || maxAgeMs < 0 ||
      receipt.availableAtMs < receipt.sourceAsOfMs || receipt.availableAtMs > decisionTimeMs ||
      decisionTimeMs - receipt.sourceAsOfMs > maxAgeMs) return fail("matrix_clock");
  let payload: unknown = matrix.payload;
  if (Object.prototype.hasOwnProperty.call(payload, root)) payload = (payload as Record<string, unknown>)[root];
  if (!isRecord(payload) || payload.schema !== "options_structure.matrix/v1" || payload.root !== root)
    return fail("matrix_schema");
  if (typeof payload.asof !== "string" || payload.asof.slice(0, 10) !== receipt.sessionDate ||
      receipt.sessionDate !== sourceSession) return fail("matrix_session");
  if (!Array.isArray(payload.strikes) || !payload.strikes.length || payload.strikes.length > 10000 ||
      !payload.strikes.every(v => finiteNumber(v) && v > 0) ||
      !Array.isArray(payload.expiries) || !payload.expiries.every(isExpiryDate) ||
      !Array.isArray(payload.cells) || payload.cells.length > 100000) return fail("matrix_rows");
  const covered = new Set<number>(payload.strikes), expiries = new Set<string>(payload.expiries);
  if (covered.size !== payload.strikes.length || expiries.size !== payload.expiries.length) return fail("matrix_rows");
  const selected = [...expiries].filter(e => e >= sourceSession &&
    (lens.kind === "zero" ? e === sourceSession : lens.kind === "ex-zero" ? e > sourceSession : e === lens.exp)).sort();
  if (!selected.length) return fail("expiry_unavailable");
  const selectedSet = new Set(selected), missing = new Set<number>(), seen = new Set<string>();
  for (const cell of payload.cells) {
    if (!isRecord(cell) || !finiteNumber(cell.strike) || !covered.has(cell.strike) ||
        !isExpiryDate(cell.expiry) || !expiries.has(cell.expiry) ||
        !(cell.gex === null || finiteNumber(cell.gex))) return fail("matrix_rows");
    const key = `${cell.strike}:${cell.expiry}`;
    if (seen.has(key)) return fail("matrix_rows");
    seen.add(key);
    // The old desk helper skips null cells. A selected null MUST poison that strike
    // here rather than silently converting an incomplete sum to zero/known gamma.
    if (selectedSet.has(cell.expiry) && cell.gex === null) missing.add(cell.strike);
  }
  const values = matrixLensByStrike(payload as unknown as GexMatrix, lens, sourceSession);
  const byStrike = new Map<number, number | null>();
  for (const strike of strikes) {
    const value = !covered.has(strike) || missing.has(strike) ? null : values.byStrike.get(strike) ?? 0;
    if (value !== null && !Number.isFinite(value)) return fail("matrix_rows");
    byStrike.set(strike, value);
  }
  return { status: "ok", byStrike, matrixArtifactId: receipt.artifactId,
    matrixAvailableAtMs: receipt.availableAtMs, matrixAsOfMs: receipt.sourceAsOfMs,
    sessionDate: receipt.sessionDate, selectedExpiries: selected };
}
