/** R2-PR5 — scanPreset/buildScanRecord/refreshScan contract, DOM-free. The
 * projections are built structurally (the same shape qualifiedExposureProjection
 * returns) so the tests exercise the OWNERS: reduceExposureNodes + scannerScore.
 * The oracle base case: spot 100, dominant 102, EM 2 points → distance 1 EM,
 * fit 1, negative regime → score 78 (positive regime 66.3 = 78 × 0.85). */
import { describe, expect, it } from "vitest";
import { buildScanRecord, metricNotScannedRow, refreshScan, scanPreset, scanRecordId,
  scanRowDelta, SCAN_VERSION, type ScanRow } from "../exposureScan";
import type { ExpectedMoveInput } from "../exposureNodeReducer";
import type { QualifiedProjection } from "../exposureMapProjection";

const DIGEST = "a".repeat(64);
const SNAP = "owner:immutable-snapshot-1";
const SESSION = "2026-10-19";
const now = Date.parse("2026-10-19T20:00:00Z");
const UNIT = "usd_delta_per_1pct_spot";
const MN = 1e6;

interface CellSpec { strike: number; net: number | null; knownNet?: number }

// Nets are USD per +1% spot; the reducer scales to $mn exactly once.
const BASE: CellSpec[] = [
  { strike: 102, net: -100 * MN },
  { strike: 100, net: -80 * MN },
  { strike: 99, net: -80 * MN },
  { strike: 98, net: -60 * MN },
];

const cell = (spec: CellSpec, partial: boolean) => {
  const gross = (net: number | null, known: number) => Math.abs(net ?? known) * 2;
  const metric = (net: number | null, known: number) => ({
    unit: UNIT, expected: 10, received: partial ? 8 : 10, qualified: partial ? 8 : 10,
    missing: partial ? 2 : 0, net, gross: gross(net, known), known_net: net ?? known,
    known_gross: gross(net, known), qualified_population_id: DIGEST,
    status: net != null ? "complete_observed" : "partial" });
  return { expiry: SESSION, strike: spec.strike, economic_expiry_at: null, population_id: DIGEST,
    joint: { expected: 10, received: 10, qualified: 10, missing: 0, population_id: DIGEST,
      model_ref: null, complete: false },
    gamma: metric(spec.net, spec.knownNet ?? 0), vanna: metric(null, 0), charm: metric(null, 0) };
};

const projection = (cells: CellSpec[], partial = false): QualifiedProjection => ({
  kind: "modeled_exposure", root: "SPY", source_snapshot_ref: SNAP, security_id: "SEC:US-ARCX-SPY",
  clocks: { source_session: SESSION, oi_report_date: SESSION },
  population: { id: DIGEST, scope: "observed_population", full_universe_expected: null, full_universe_complete: false },
  greek_provenance: null, cells: cells.map((c) => cell(c, partial)), input_sha256: DIGEST,
} as unknown as QualifiedProjection);

const EM: ExpectedMoveInput = { points: 2, horizon: "1d", sourceRef: `${SESSION}T15:45:00Z` };

const scan = (p: QualifiedProjection | null, o: { em?: ExpectedMoveInput | null; spot?: number | null;
  book?: "data" | "absent" | "unavailable" | "not_loaded"; fresh?: boolean } = {}): ScanRow =>
  scanPreset({ preset: "SPY", projection: p, spot: o.spot ?? 100, expectedMove: o.em === undefined ? EM : o.em,
    emPct: o.em ? 2 : null, fresh: o.fresh ?? true, bookStatus: o.book ?? "data" }, { lens: { kind: "all" }, now });

// The P53 partial book: only the 98 strike is unobserved — it contributes its
// known subset, coverage counts stay, and the scanner refuses on coverage.
const PARTIAL: CellSpec[] = [BASE[0], BASE[1], BASE[2], { strike: 98, net: null, knownNet: -60 * MN }];
const partialProjection = (): QualifiedProjection => ({
  ...JSON.parse(JSON.stringify(projection(PARTIAL))) as QualifiedProjection,
  cells: PARTIAL.map((c, i) => cell(c, i === 3)),
} as unknown as QualifiedProjection);

describe("scanPreset", () => {
  it("scores the oracle base case: negative regime strength 60 fit 1 → 78", () => {
    const row = scan(projection(BASE));
    expect(row.status).toBe("candidate");
    expect(row.identity?.securityId).toBe("SEC:US-ARCX-SPY");
    expect(row.identity?.version).toBe("v2");
    expect(row.identity?.populationId).toBe(DIGEST);
    expect(row.identity?.inputSha256).toBe(DIGEST);
    expect(row.identity?.sourceSnapshotRef).toBe(SNAP);
    expect(row.identity?.session).toBe(SESSION);
    expect(row.scopeLabel).toBe(`all 1`);
    expect(row.dominantStrike).toBe(102);
    expect(row.dominantNetMn).toBeCloseTo(-100, 6);
    expect(row.sharePct).toBeCloseTo(31.25, 6);
    expect(row.contestedRatio).toBeCloseTo(0.8, 6);
    expect(row.contested).toBe(false);
    expect(row.distancePct).toBeCloseTo(2, 6);
    expect(row.distanceEm).toBeCloseTo(1, 6);
    expect(row.distanceFit).toBe(1);
    expect(row.score).toBeCloseTo(78, 6);
    expect(row.candidateScore).toBeCloseTo(78, 6);
    expect(row.reasons).toEqual([]);
    expect(row.reductionStatus).toBe("ok");
  });

  it("applies the 0.85 positive-regime penalty: 66.3", () => {
    const up = BASE.map((c) => ({ ...c, net: c.net == null ? null : -c.net }));
    expect(scan(projection(up)).score).toBeCloseTo(66.3, 6);
  });

  it("keeps a far node visible but unscored with outside_horizon (P53)", () => {
    const far = [{ strike: 105, net: -100 * MN }, BASE[1], BASE[2], BASE[3]];
    const row = scan(projection(far));
    expect(row.status).toBe("unscored");
    expect(row.reasons).toEqual(["outside_horizon"]);
    expect(row.candidateScore).toBeNull();
    expect(row.score).not.toBeNull();
    expect(row.dominantStrike).toBe(105);
    expect(row.sharePct).toBeCloseTo(31.25, 6);
    expect(row.contestedRatio).toBeCloseTo(0.8, 6);
  });

  it("refuses an unadmitted projection: identity_unadmitted with identity null", () => {
    expect(scan(null).status).toBe("identity_unadmitted");
    expect(scan(null).identity).toBeNull();
    const anon = projection(BASE) as QualifiedProjection;
    expect(scan({ ...anon, security_id: "" }).status).toBe("identity_unadmitted");
  });

  it("labels a present projection without its book: book_unavailable", () => {
    expect(scan(projection(BASE), { book: "unavailable" }).status).toBe("book_unavailable");
  });

  it("reports a partial book with its coverage percentage and reason", () => {
    const row = scan(partialProjection());
    expect(row.status).toBe("partial");
    expect(row.coveragePct).toBeCloseTo(95, 6);
    expect(row.reasons).toEqual(["insufficient_coverage"]);
    expect(row.dominantStrike).toBe(102);
    expect(row.score).toBeNull();
  });

  it("never scores a missing expected move as zero", () => {
    const row = scan(projection(BASE), { em: null });
    expect(row.status).toBe("unscored");
    expect(row.reasons).toEqual(["missing_expected_move"]);
    expect(row.score).toBeNull();
  });

  it("labels a refused empty scope through the reducer, never zero", () => {
    const row = scan(projection([]));
    expect(row.status).toBe("unscored");
    expect(row.reductionStatus).toBe("empty");
    expect(row.reasons).toEqual(["empty_scope"]);
    expect(metricNotScannedRow("SPY", null).status).toBe("metric_not_scanned");
  });
});

describe("buildScanRecord", () => {
  const scored = () => scan(projection(BASE));
  const missingEm = () => scan(projection(BASE), { em: null });
  const unadmitted = () => scan(null);

  it("counts scored / unscored / unadmitted and never claims the preset count", () => {
    const record = buildScanRecord([scored(), missingEm(), unadmitted()], now);
    expect(record.version).toBe(SCAN_VERSION);
    expect(record.origin).toBe("original");
    expect(record.revision).toBe(1);
    expect(record.presets).toBe(3);
    expect(record.scored).toBe(1);
    expect(record.unscored).toBe(1);
    expect(record.unadmitted).toBe(1);
    expect(record.scored).not.toBe(record.presets);
  });

  it("deep-freezes the record", () => {
    const record = buildScanRecord([scored(), missingEm()], now);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.rows[0])).toBe(true);
    expect(Object.isFrozen(record.rows[0].reasons)).toBe(true);
  });
});

describe("refreshScan", () => {
  const before = () => scan(projection(BASE));
  const after = () => scan(projection([{ strike: 105, net: -100 * MN }, BASE[1], BASE[2], BASE[3]]));

  it("appends revisions and never rewrites the original", () => {
    const original = buildScanRecord([before()], now);
    const frozen = JSON.stringify(original);
    expect(Object.isFrozen(original)).toBe(true);
    const first = refreshScan(original, [after()], now + 1);
    expect(Object.isFrozen(first.original)).toBe(true);
    expect(first.latest.revision).toBe(2);
    expect(first.history.length).toBe(2);
    const second = refreshScan(first, [before()], now + 2);
    expect(second.history.length).toBe(3);
    expect(second.latest.revision).toBe(3);
    expect(second.latest.origin).toBe("refresh");
    expect(Object.is(second.original, original)).toBe(true);
    expect(second.original.rows[0].dominantStrike).toBe(102);
    expect(JSON.stringify(second.original)).toBe(frozen);
  });

  it("accepts a bare record as the original", () => {
    const record = buildScanRecord([before()], now);
    const refresh = refreshScan(record, [after()], now + 1);
    expect(Object.is(refresh.original, record)).toBe(true);
    expect(refresh.latest.revision).toBe(2);
  });
});

describe("scanRowDelta", () => {
  const row = (o: { strike?: number | null; contested?: boolean | null; score?: number | null;
    status?: ScanRow["status"] }): ScanRow => ({ ...scan(projection(BASE)), preset: "SPY",
    dominantStrike: o.strike !== undefined ? o.strike : 600,
    contested: o.contested !== undefined ? o.contested : false,
    score: o.score !== undefined ? o.score : 43.2, status: o.status ?? "candidate" });

  it("flags a moved node, a contested flip and the score delta", () => {
    const delta = scanRowDelta(row({}), row({ strike: 605, contested: true, score: 45.3, status: "contested" }));
    expect(delta).toEqual({ preset: "SPY", nodeMoved: true, previousStrike: 600, currentStrike: 605,
      contestedChanged: true, scoreDelta: 45.3 - 43.2, statusChanged: true });
    expect(delta.scoreDelta).toBeCloseTo(2.1, 6);
  });

  it("flags a node that became null and leaves the score delta null", () => {
    expect(scanRowDelta(row({}), row({ strike: null, score: null, status: "unscored" }))).toMatchObject({
      nodeMoved: true, previousStrike: 600, currentStrike: null, scoreDelta: null, contestedChanged: false });
    expect(scanRowDelta(undefined, row({}))).toMatchObject({ nodeMoved: false, contestedChanged: false });
  });
});

describe("scanRecordId", () => {
  it("is deterministic and moves when the dominant node moves", async () => {
    const rows = () => [scan(projection(BASE))];
    expect(await scanRecordId(rows())).toBe(await scanRecordId(rows()));
    expect(await scanRecordId(rows())).not.toBe(await scanRecordId([scan(projection([
      { strike: 105, net: -100 * MN }, BASE[1], BASE[2], BASE[3]]))]));
  });
});

