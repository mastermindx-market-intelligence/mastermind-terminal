import { describe, expect, it } from "vitest";
import { MEASURED_READ_SCHEMA, sectorMeasuredRead } from "../sectorIntelligence";
import fixture from "./fixtures/measured_read_v1.json";

const payload = { as_of: "2026-10-09", measured_read: fixture };
const clone = () => JSON.parse(JSON.stringify(fixture)) as typeof fixture;

describe("sector measured_read consumer contract", () => {
  it("parses the owner measured read with rank-ascending measured groups and no invented numbers", () => {
    const read = sectorMeasuredRead(payload);
    expect(read.state).toBe("ok");
    expect(read.partial).toBe(true);
    expect(read.sessionEnd).toBe("2026-10-09");
    expect(read.benchmark).toBe("SPY");
    expect(read.expectedN).toBe(11);
    expect(read.measuredN).toBe(9);
    expect(read.ranked.map(group => group.groupId)).toEqual(["XLE", "XLY", "XLC", "XLF", "XLV", "XLK", "XLI", "XLB", "XLP"]);
    expect(read.ranked).toHaveLength(9);
    const xle = read.ranked[0];
    expect(xle.measured).toBe(true);
    expect(xle.nameEn).toBe("Energy");
    expect(xle.nameZh).toBe("能源");
    expect(xle.rank).toBe(1);
    // Values held by the byte-copied T17 fixture, not invented by this consumer.
    expect(xle.rs63d).toBe(4.1);
    expect(xle.rs21d).toBe(2.4);
    expect(xle.reasonCode).toBeNull();
  });

  it("keeps unmeasured sectors named with owner reason codes and null numbers, never zero", () => {
    const read = sectorMeasuredRead(payload);
    expect(read.unmeasured.map(group => group.groupId)).toEqual(["XLRE", "XLU"]);
    expect(read.unmeasured.map(group => group.reasonCode)).toEqual(["missing_input", "thin_history"]);
    for (const group of read.unmeasured) {
      expect(group.measured).toBe(false);
      expect(group.rank).toBeNull();
      expect(group.rs21d).toBeNull();
      expect(group.rs63d).toBeNull();
      expect(group.rank).not.toBe(0);
      expect(group.rs21d).not.toBe(0);
      expect(group.rs63d).not.toBe(0);
    }
    expect(read.unmeasured[0].nameEn).toBe("Real Estate");
    expect(read.unmeasured[1].nameEn).toBe("Utilities");
  });

  it("reports absent, outage and invalid states with the exact empty result on any input", () => {
    const empty = (state: string) => ({ state, partial: false, sessionEnd: null, benchmark: null, expectedN: null, measuredN: null, ranked: [], unmeasured: [] });
    for (const bad of [{}, null, "x", []]) {
      expect(sectorMeasuredRead(bad)).toEqual(empty("absent"));
    }
    expect(sectorMeasuredRead({ measured_read: { status: "unavailable" } }).state).toBe("outage");
    expect(sectorMeasuredRead({ measured_read: { ...clone(), schema: "some.other.schema/v1" } }).state).toBe("invalid");
    expect(sectorMeasuredRead({ measured_read: { ...clone(), schema: MEASURED_READ_SCHEMA, status: "weird" } }).state).toBe("invalid");
    expect(sectorMeasuredRead({ measured_read: { ...clone(), groups: "eleven" } }).state).toBe("invalid");
    expect(sectorMeasuredRead({ measured_read: 7 }).state).toBe("invalid");
  });

  it("never ranks a measured-status group whose rank is not a finite number", () => {
    const broken = clone();
    const xle = broken.groups.find(group => group.group_id === "XLE");
    expect(xle).toBeTruthy();
    const current = xle!.current as Record<string, unknown>;
    current.rank = null;
    const read = sectorMeasuredRead({ measured_read: broken });
    expect(read.ranked.map(group => group.groupId)).not.toContain("XLE");
    const row = read.unmeasured.find(group => group.groupId === "XLE");
    expect(row).toBeTruthy();
    expect(row!.measured).toBe(false);
    expect(row!.rank).toBeNull();
    expect(row!.rs21d).toBeNull();
    expect(row!.rs63d).toBeNull();
  });

  it("never copies the owner z-score or its field names into the view result", () => {
    const read = sectorMeasuredRead(payload);
    const serialized = JSON.stringify(read);
    expect(serialized).not.toContain('"z"');
    expect(serialized).not.toContain("z_");
    expect(Object.keys(read)).not.toContain("z");
    for (const group of [...read.ranked, ...read.unmeasured]) {
      expect(Object.hasOwn(group, "z")).toBe(false);
    }
  });
});
