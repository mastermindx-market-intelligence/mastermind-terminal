import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createExposureMapReader } from "../exposureMap";
import { qualifiedExposureProjection, projectionReportedGamma } from "../exposureMapProjection";
import { readCompanionGexSnapshot, bindCompanionGexComparison, buildCompanionGexMemory } from "../optionsCompanion";
import { compareReportedGamma } from "../exposureReportedChange";
import { reportedGammaBook } from "./fixtures/reportedGammaBooks";

const now = Date.parse("2026-10-20T15:00:00Z");
const all = { kind: "all" } as const;
async function snapshot(raw: unknown, session?: string, lens = all) {
  const wrapped = raw as { clocks?: { source_session: string }; exposure_projection?: unknown };
  const envelope = wrapped.clocks ? { schema: "options_hub.gex/v1", root: "SPY", asof: session ?? wrapped.clocks.source_session,
    by_strike: [], exposure_projection: raw } : raw;
  const r = readCompanionGexSnapshot(envelope, "SPY", now, lens);
  if (!r.ok) throw new Error(`Snapshot unavailable: ${r.reason}`);
  return bindCompanionGexComparison(r.value);
}

describe("comparison-only projection admission", () => {
  it("uses qualified exact sides while preserving map admission and original totals", async () => {
    const current = await snapshot(reportedGammaBook("2026-10-19"));
    const previous = await snapshot(reportedGammaBook("2026-10-16", 2));
    expect(current.netGexBn).toBe(.00001); expect(previous.netGexBn).toBe(.00002);
    const change = buildCompanionGexMemory(current, previous, 100, now)!.reportedChange!;
    expect(change.state).toBe("data"); if (change.state !== "data") return;
    expect(change.aggregate).toMatchObject({ contracts: 119, signedChangeUsd: -10_000,
      netMagnitudeChangeUsd: -10_000, grossChangeUsd: -1_190_000 });
    expect(change.population).toMatchObject({ previousObserved: 120, currentObserved: 120,
      previousQualified: 119, currentQualified: 119, matchedQualified: 119, unavailableEither: 1 });
    expect(change.velocity).toBeNull(); expect(change.percentChange).toBeNull();
    expect(current.measurement!.reportedGamma!.sourceKey).toMatch(/^[a-f0-9]{64}$/);
    expect(current.measurement!.sourceRef).toBe(previous.measurement!.sourceRef);
    expect(change.currentKey).not.toBe(change.previousKey);
  });
  it("withholds corrupt side evidence only in this lane", () => {
    const raw = reportedGammaBook("2026-10-19");
    (raw.exposure_projection.cells[0][3][0] as unknown[])[10] = "bad-side";
    const reader = createExposureMapReader(raw, "SPY", null, "2026-10-20", now);
    expect(reader(all, "gamma").state).toBe("data");
    expect(reader.reportedGamma(all)).toBeNull();
  });
  it("refuses a finite contribution on an unbound member and wrong side sum", () => {
    const raw = reportedGammaBook("2026-10-19"), p = raw.exposure_projection;
    p.cells[0][3][0][10] = 11_000;
    const admitted = qualifiedExposureProjection(p, "SPY", "2026-10-19", now)!;
    expect(admitted).not.toBeNull(); expect(projectionReportedGamma(admitted, all, now)).toBeNull();
  });
  it("refuses overflowing side reconciliation without changing map admission", () => {
    const raw = reportedGammaBook("2026-10-19"), m = raw.exposure_projection.cells[0][3][0];
    [m[5], m[6], m[7], m[8], m[10], m[11]] = [0, 1e308, 0, 1e308, 1e308, -1e308];
    const reader = createExposureMapReader(raw, "SPY", null, "2026-10-20", now);
    expect(reader(all, "gamma").state).toBe("data");
    expect(reader.reportedGamma(all)).toBeNull();
  });
  it("checks the actual qualified side, not just a bound-member count", () => {
    const raw = reportedGammaBook("2026-10-19"), p = raw.exposure_projection;
    p.contract_identity.contract_keys = p.contract_identity.contract_keys.filter(k => !(k[0] === p.expiry_terms[0][0] && Number(k[1]) === 100 && k[2] === "C"));
    const m = p.cells[0][3][0];
    [m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[11]] = [1, 1, 1, null, null, 10000, 10000, null];
    const reader = createExposureMapReader(raw, "SPY", null, "2026-10-20", now);
    expect(reader(all, "gamma").state).toBe("data");
    expect(reader.reportedGamma(all)).toBeNull();
  });
  it("preserves an observed-only call with missing0 and refuses a ghost unreported put", () => {
    const raw = reportedGammaBook("2026-10-19"), p = raw.exposure_projection, cell = p.cells[0];
    const isRemoved = (k: string[]) => k[0] === p.expiry_terms[cell[0]][0] && Number(k[1]) === cell[1] && k[2] === "P";
    p.contract_identity.observed_contract_keys = p.contract_identity.observed_contract_keys.filter(k => !isRemoved(k));
    p.contract_identity.contract_keys = p.contract_identity.contract_keys.filter(k => !isRemoved(k));
    for (const metric of cell[3]) { metric[0] = null; metric[1] = Math.min(Number(metric[1]), 1); metric[3] = 1; }
    const m = cell[3][0];
    [m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[11]] = [1, 0, 1, null, null, 10000, 10000, null];
    cell[4][0] = null; cell[4][1] = Math.min(Number(cell[4][1]), 1); cell[4][3] = 1;
    const reader = createExposureMapReader(raw, "SPY", null, "2026-10-20", now);
    expect(reader(all, "gamma").state).toBe("data");
    const basis = reader.reportedGamma(all)!;
    expect(basis).not.toBeNull();
    expect(basis.members.filter(member => member.expiry === p.expiry_terms[cell[0]][0] && member.strike === cell[1]))
      .toEqual([{ expiry: p.expiry_terms[cell[0]][0], strike: cell[1], right: "C", valueUsd: 10000 }]);
    m[11] = -20;
    const ghost = createExposureMapReader(raw, "SPY", null, "2026-10-20", now);
    expect(ghost(all, "gamma").state).toBe("data"); expect(ghost.reportedGamma(all)).toBeNull();
  });
  it.each(["method", "unit", "tenor_policy"])("keeps unsupported %s out of the comparison lane", key => {
    const raw = reportedGammaBook("2026-10-19"); raw.exposure_projection.greek_provenance.gamma[key] = "unsupported";
    const reader = createExposureMapReader(raw, "SPY", null, "2026-10-20", now);
    expect(reader(all, "gamma").state).toBe("data"); expect(reader.reportedGamma(all)).toBeNull();
  });
  it("binds a known declared model change and refuses its comparison", async () => {
    const raw = reportedGammaBook("2026-10-19"); raw.exposure_projection.greek_provenance.gamma.model_ref += "-changed";
    const a = await snapshot(raw), b = await snapshot(reportedGammaBook("2026-10-16"));
    expect(compareReportedGamma(a.measurement!.reportedGamma, b.measurement!.reportedGamma, now)).toEqual({ state: "unavailable", reason: "definition" });
  });
  it("fingerprints actual contributions even when the caller repeats its source reference and input identity", async () => {
    const a = await snapshot(reportedGammaBook("2026-10-19"));
    const b = await snapshot(reportedGammaBook("2026-10-19", 2));
    expect(a.measurement!.sourceRef).toBe(b.measurement!.sourceRef);
    expect(a.measurement!.reportedGamma!.sourceBinding.inputSha256).toBe(b.measurement!.reportedGamma!.sourceBinding.inputSha256);
    expect(a.measurement!.reportedGamma!.sourceKey).not.toBe(b.measurement!.reportedGamma!.sourceKey);
  });
  it("binds the declared 100k-member bound without changing the shared chart fingerprint limits", async () => {
    const parsed = readCompanionGexSnapshot(reportedGammaBook("2026-10-19"), "SPY", now);
    if (!parsed.ok) throw Error("fixture");
    const basis = parsed.value.measurement!.reportedGamma!;
    basis.members = Array.from({ length: 100_000 }, (_, i) => ({ expiry: "2026-10-23", strike: i + 1,
      right: "C" as const, valueUsd: null }));
    const bound = await bindCompanionGexComparison(parsed.value);
    expect(bound.measurement!.reportedGamma!.sourceKey).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects a future replay origin without using capture order as market time", () => {
    const p = reportedGammaBook("2026-10-19");
    expect(readCompanionGexSnapshot(p, "SPY", Date.parse("2026-10-20T08:59:59Z")).ok).toBe(false);
  });
  it("resolves source-session zero separately and never matches rolling different expiries", async () => {
    const a = reportedGammaBook("2026-10-19", 1, true), b = reportedGammaBook("2026-10-16", 2, true);
    const zero = { kind: "zero" } as const;
    const ar = readCompanionGexSnapshot(a, "SPY", now, zero), br = readCompanionGexSnapshot(b, "SPY", now, zero);
    if (!ar.ok || !br.ok) throw Error("zero fixture");
    const [x, y] = await Promise.all([bindCompanionGexComparison(ar.value), bindCompanionGexComparison(br.value)]);
    expect(x.measurement!.reportedGamma!.members.every(m => m.expiry === "2026-10-19")).toBe(true);
    expect(compareReportedGamma(x.measurement!.reportedGamma, y.measurement!.reportedGamma, now)).toEqual({ state: "unavailable", reason: "empty_intersection" });
  });
  it("validates the retained actual pair when supplied, otherwise the coherent synthetic pair", async () => {
    const currentPath = process.env.EXPOSURE_P09_CURRENT_WITNESS, previousPath = process.env.EXPOSURE_P09_PREVIOUS_WITNESS;
    if (!!currentPath !== !!previousPath) throw Error("Supply both actual source witnesses");
    const current = await snapshot(currentPath ? JSON.parse(readFileSync(currentPath, "utf8")) : reportedGammaBook("2026-10-19"));
    const previous = await snapshot(previousPath ? JSON.parse(readFileSync(previousPath, "utf8")) : reportedGammaBook("2026-10-16", 2));
    const r = compareReportedGamma(current.measurement!.reportedGamma, previous.measurement!.reportedGamma, now);
    expect(r.state).toBe("data"); if (r.state !== "data") return;
    expect(r.aggregate.contracts).toBe(currentPath ? 20 : 119);
    expect(r.aggregate.signedChangeUsd).toBeCloseTo(currentPath ? -583821848.219118150 : -10000, 5);
    expect(r.aggregate.netMagnitudeChangeUsd).toBeCloseTo(currentPath ? 583821848.219118150 : -10000, 5);
    expect(r.aggregate.grossChangeUsd).toBeCloseTo(currentPath ? 1208861627.295489700 : -1190000, 5);
    if (currentPath) {
      expect(r.byStrike).toHaveLength(10);
      expect(r.population).toMatchObject({ previousObserved: 13104, currentObserved: 20,
        previousQualified: 12212, currentQualified: 20, previousOnlyReported: 13084, currentOnlyReported: 0 });
      // Independent Decimal readback: a shrinking positive node and a zero
      // crossing distinguish signed movement from net-magnitude movement.
      expect(r.byStrike.find(row => row.strike === 768)!.netMagnitudeChangeUsd).toBeCloseTo(-5092150.424262949, 5);
      expect(r.byStrike.find(row => row.strike === 772)!.signedChangeUsd).toBeCloseTo(21169143.1664154, 5);
      expect(r.byStrike.find(row => row.strike === 772)!.netMagnitudeChangeUsd).toBeCloseTo(-4791640.1008346, 5);
      const expectedPath = process.env.EXPOSURE_P09_EXPECTED_WITNESS;
      if (expectedPath) {
        const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as { byStrike: Record<string, Record<string, string | number>> };
        for (const row of r.byStrike) for (const [key, value] of Object.entries(expected.byStrike[String(row.strike)])) {
          expect(row[key as keyof typeof row], `${row.strike} ${key}`).toBeCloseTo(Number(value), 5);
        }
      }
    }
  });
});
