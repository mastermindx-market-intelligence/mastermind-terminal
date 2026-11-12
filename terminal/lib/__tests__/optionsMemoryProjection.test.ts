import { describe, expect, it } from "vitest";
import { readCompanionGexSnapshot, buildCompanionGexMemory } from "../optionsCompanion";
import oneSided from "./fixtures/exposure-projection-one-sided-v2.json";

const now = Date.parse("2026-10-20T15:00:00Z");
const envelope = () => ({ schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-15",
  spot_ref: 100, net_gex_bn: 9.9, by_strike: [{ strike: 100, gamma_net: 999 }],
  exposure_projection: structuredClone(oneSided) });
const prior = () => ({ schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-14",
  spot_ref: 99, net_gex_bn: .02, by_strike: [{ strike: 100, gamma_net: 20 }] });

describe("source-bound exposure memory", () => {
  it("uses the same measured projection as the map instead of conflicting legacy totals", () => {
    const r = readCompanionGexSnapshot(envelope(), "SPY", now);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.value.netGexBn).toBe(.00001);
    expect(r.value.rows).toEqual([{ strike: 100, gammaMn: .01 }]);
    expect(r.value.measurement).toMatchObject({ qualification: "qualified", coveredOnly: true,
      coverage: { expected: null, received: 1, qualified: 1, missing: 0 } });
  });
  it("accepts a projection with an empty legacy ladder, without inventing legacy values", () => {
    const r = readCompanionGexSnapshot({ ...envelope(), by_strike: [] }, "SPY", now);
    expect(r.ok).toBe(true); if (r.ok) expect(r.value.rows[0].gammaMn).toBe(.01);
  });
  it("does not downgrade a corrupt or future projection to its numeric legacy ladder", () => {
    const p = envelope(); p.exposure_projection.clocks.available_at = "2026-10-21T20:00:00Z";
    expect(readCompanionGexSnapshot(p, "SPY", now).ok).toBe(false);
    expect(readCompanionGexSnapshot({ ...envelope(), exposure_projection: {} }, "SPY", now).ok).toBe(false);
  });
  it("keeps side-by-side measurements but withholds deltas without comparable source populations", () => {
    const current = readCompanionGexSnapshot(envelope(), "SPY", now);
    const previous = readCompanionGexSnapshot(prior(), "SPY", now);
    if (!current.ok || !previous.ok) throw Error("fixture");
    const memory = buildCompanionGexMemory(current.value, previous.value, 100)!;
    expect(memory.currentStrikeMn).toBe(.01); expect(memory.previousStrikeMn).toBe(20);
    expect(memory.changeBasis).toBe("unestablished");
  });
  it("preserves the existing aggregate-reference comparison separately", () => {
    const current = readCompanionGexSnapshot({ ...prior(), asof: "2026-10-15" }, "SPY", now);
    const previous = readCompanionGexSnapshot(prior(), "SPY", now);
    if (!current.ok || !previous.ok) throw Error("fixture");
    expect(buildCompanionGexMemory(current.value, previous.value, 100)?.changeBasis).toBe("aggregate_reference");
  });
});
