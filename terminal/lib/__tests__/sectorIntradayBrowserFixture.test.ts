import { describe, expect, it } from "vitest";
import { intradayPulseWithStaleComparison } from "../../e2e/fixtures/sector-intraday-pulse";
import { sectorIntradayRead } from "../sectorIntradayComparison";

describe("browser intraday stale fixture preserves coherent owner clocks", () => {
  it.each([
    { name: "reported CI midnight", now: "2026-10-23T04:11:00.000Z", source: "2026-10-23T03:21:00.000Z", reference: "2026-10-23T02:21:00.000Z", session: "2026-10-22" },
    { name: "summer New York midnight", now: "2026-07-15T04:11:00.000Z", source: "2026-07-15T03:21:00.000Z", reference: "2026-07-15T02:21:00.000Z", session: "2026-07-14" },
    { name: "winter New York midnight", now: "2026-12-15T05:11:00.000Z", source: "2026-12-15T04:21:00.000Z", reference: "2026-12-15T03:21:00.000Z", session: "2026-12-14" },
    { name: "ordinary intraday", now: "2026-10-23T16:11:00.000Z", source: "2026-10-23T15:21:00.000Z", reference: "2026-10-23T14:21:00.000Z", session: "2026-10-23" },
  ])("$name is stale with evidence, rather than malformed", sample => {
    const now = Date.parse(sample.now);
    const pulse = intradayPulseWithStaleComparison(now);
    const read = sectorIntradayRead(pulse, now);
    expect(read).not.toBeNull();
    const row = read!.rows.find(item => item.basketId === "ai_infra");
    expect(row).toMatchObject({
      outcome: "unverified", reason: "stale", ownerStatus: "observed",
      clock: { sourceAsOf: sample.source, referenceAsOf: sample.reference,
        sessionDate: sample.session, elapsedMinutes: 60, maxClockSkewSeconds: 60, ageSeconds: 3000 },
      coverage: { matchedMembers: 8, totalMembers: 10, coveragePct: 80 },
      deliveryState: "new", isNewObservation: true,
    });
    for (const field of ["absoluteChangePct", "benchmarkChangePct", "relativeChangePct", "positiveRelativeBreadthPct"]) {
      expect(row).not.toHaveProperty(field);
    }
    expect(read!.rows.find(item => item.basketId === "mag7")).toMatchObject({
      outcome: "observed", relativeChangePct: -2.238806, deliveryState: "retained",
    });
    expect(pulse.as_of_utc).toBe(sample.now);
  });
});
