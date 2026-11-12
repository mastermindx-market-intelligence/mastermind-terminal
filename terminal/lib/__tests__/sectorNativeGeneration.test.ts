import { describe, expect, it } from "vitest";
import { sectorDossiers, sectorWindowMeasurements } from "../sectorDossiers";
import { nativeSectorEvidence, sectorNativeGeneration, SECTOR_GENERATION_PATH } from "../sectorNativeGeneration";
import type { FeedPayload } from "../sectorIntelligence";
import captured from "./fixtures/sector_generation.captured.preview.v1.json";

// Actual capture -> five-document publisher -> mounted Macro API preview bytes.
// The population and authentication are controlled fixtures, not production proof.
const wire = () => structuredClone(captured);
const feed = (data: unknown = wire()): FeedPayload => ({ data, receipt: {
  source: "generation", path: SECTOR_GENERATION_PATH, status: "ready",
  asOf: captured.source_session, observedAt: "2026-11-07T20:00:00Z", stale: false,
  contentHash: "a".repeat(64),
} });

describe("one selected native Sector generation", () => {
  it("admits the actual mounted API wire and preserves all eleven identities, zeros and companion values", () => {
    const read = sectorNativeGeneration(captured);
    expect(read).not.toBeNull();
    expect(read!.receipt).toEqual(captured.projection.receipt);
    expect(read!.sectors).toHaveLength(11);
    expect(Object.keys(read!.history.series)).toHaveLength(11);
    expect(read!.history.series.xlk.points.at(-1)).toMatchObject({ date: captured.source_session, rs21: 0, rs63: 0 });
    expect(sectorDossiers(read!.core)).toEqual(sectorDossiers(captured.projection.data.core));
    expect(sectorWindowMeasurements(read!.core)).toEqual(sectorWindowMeasurements(captured.projection.data.core));
    expect(sectorDossiers(read!.core).state).toBe("ok");
    expect(sectorWindowMeasurements(read!.core).state).toBe("ok");
  });

  it.each([
    ["outer audience", (w: ReturnType<typeof wire>) => { w.audience = "entitled"; }],
    ["projection audience", (w: ReturnType<typeof wire>) => { w.projection.data.audience = "entitled"; }],
    ["receipt session", (w: ReturnType<typeof wire>) => { w.projection.receipt.source_session = "2026-11-04"; }],
    ["receipt publication", (w: ReturnType<typeof wire>) => { w.projection.receipt.published_at = "2026-11-04T01:00:00Z"; }],
    ["receipt qualification", (w: ReturnType<typeof wire>) => { w.projection.receipt.qualification = "stale"; }],
    ["core session", (w: ReturnType<typeof wire>) => { w.projection.data.core.as_of = "2026-11-04"; }],
    ["history session", (w: ReturnType<typeof wire>) => { w.projection.data.history.meta.asOf = "2026-11-04"; }],
    ["measured session", (w: ReturnType<typeof wire>) => { w.projection.data.core.measured_read.generation.session_end = "2026-11-04"; }],
    ["history identity", (w: ReturnType<typeof wire>) => { w.projection.data.history.sectors[0].ticker = "XLE"; }],
    ["duplicate core identity", (w: ReturnType<typeof wire>) => { w.projection.data.core.sectors[1].id = w.projection.data.core.sectors[0].id; }],
    ["missing history member", (w: ReturnType<typeof wire>) => { w.projection.data.history.sectors.pop(); }],
    ["future history", (w: ReturnType<typeof wire>) => { w.projection.data.history.sectors[0].rs_history.at(-1)!.date = "2026-11-04"; }],
    ["invalid hash", (w: ReturnType<typeof wire>) => { w.projection.receipt.content_sha256 = "unbound"; }],
    ["invalid owner token", (w: ReturnType<typeof wire>) => { w.projection.receipt.generation_id = "g:1"; }],
    ["year zero", (w: ReturnType<typeof wire>) => { w.source_session = "0000-11-03"; }],
    ["oversized publication clock", (w: ReturnType<typeof wire>) => {
      w.published_at = w.projection.receipt.published_at = "2026-11-03T23:00:21.123456789012345Z";
    }],
    ["impossible date", (w: ReturnType<typeof wire>) => { w.source_session = "2026-02-30"; }],
  ])("refuses a mixed or invalid %s", (_name, mutate) => {
    const w = wire(); mutate(w); expect(sectorNativeGeneration(w)).toBeNull();
  });

  it("never compares the owner representation hash to the gateway's full wire hash", () => {
    const result = nativeSectorEvidence(feed());
    expect(result.generation).not.toBeNull();
    expect(result.feed!.receipt.contentHash).toBe("a".repeat(64));
    expect(result.generation!.receipt.content_sha256).not.toBe(result.feed!.receipt.contentHash);
    expect(result.feed!.receipt.asOf).toBe(captured.source_session);
    expect(result.feed!.receipt.observedAt).toBe("2026-11-07T20:00:00Z");
  });

  it("admits only the closed projection-error stub and never ignores an added mismatched parent", () => {
    const w = wire();
    const stub = { schema: "leadership_rotation_context.measured_group_read/v1", status: "unavailable", reason: "projection_error" };
    Object.assign(w.projection.data.core, { measured_read: stub });
    expect(sectorNativeGeneration(w)).not.toBeNull();
    Object.assign(stub, { generation: { session_end: w.source_session, benchmark: "QQQ" }, cohort: {}, groups: [] });
    expect(sectorNativeGeneration(w)).toBeNull();
  });

  it.each(["constructor", "prototype", "x".repeat(300)])("preserves accepted opaque companion receipt keys: %s", key => {
    const w = wire();
    Object.assign(w.projection.data.core.measured_read.sector_window_measurements, { receipt: { [key]: 1 } });
    const existing = sectorWindowMeasurements(w.projection.data.core);
    expect(existing.state).toBe("ok");
    const admitted = sectorNativeGeneration(w);
    expect(admitted).not.toBeNull();
    expect(sectorWindowMeasurements(admitted!.core)).toEqual(existing);
  });

  it.each(["access", "unavailable", "invalid", "error", "loading"] as const)("withdraws all native data on %s", status => {
    const f = feed(); f.receipt.status = status;
    const result = nativeSectorEvidence(f);
    expect(result.generation).toBeNull(); expect(result.feed!.data).toBeNull();
    expect(result.feed!.receipt.status).toBe(status);
  });

  it("refuses the static artifact and path/date substitutions without fallback", () => {
    expect(sectorNativeGeneration(captured.projection.data.core)).toBeNull();
    for (const patch of [{ source: "sector" as const }, { path: "/sectordata/sector_central.json" }, { asOf: "2026-11-04" }]) {
      const f = feed(); Object.assign(f.receipt, patch);
      expect(nativeSectorEvidence(f).generation).toBeNull();
      expect(nativeSectorEvidence(f).feed!.data).toBeNull();
    }
  });

  it("changes presentation identity for a same-session replacement without restamping source time", () => {
    const first = sectorNativeGeneration(wire())!;
    const next = wire(); next.projection.receipt.generation_id = "captured-sector-2";
    next.projection.receipt.content_sha256 = "b".repeat(64);
    const second = sectorNativeGeneration(next)!;
    expect(second.key).not.toBe(first.key);
    expect(second.receipt.source_session).toBe(first.receipt.source_session);
  });

  it("retains a stale/degraded owner verdict without treating retrieval as freshness", () => {
    for (const qualification of ["stale", "degraded"]) {
      const w = wire(); w.qualification = qualification; w.projection.receipt.qualification = qualification;
      const result = nativeSectorEvidence(feed(w));
      expect(result.generation!.receipt.qualification).toBe(qualification);
      expect(result.feed!.receipt.stale).toBe(qualification === "stale");
    }
  });
});
