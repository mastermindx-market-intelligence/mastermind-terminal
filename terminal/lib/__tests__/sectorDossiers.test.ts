import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sectorDossiers } from "../sectorDossiers";
import { readableOwnerEnvelope, sectorMeasuredRead } from "../sectorIntelligence";
import fixture from "./fixtures/sector_dossiers_v1.json";
import outage from "./fixtures/sector_dossiers_unavailable_v1.json";
import legacy from "./fixtures/measured_read_v1.json";

const payload = (read: unknown = fixture) => ({ measured_read: read });
const clone = () => structuredClone(fixture);
const object = (value: unknown) => value as Record<string, unknown>;
function changed(path: string[], value: unknown) {
  const read = clone();
  let target = object(read);
  for (const key of path.slice(0, -1)) target = object(target[key]);
  target[path[path.length - 1]] = value;
  return payload(read);
}

describe("Persistent Sector Leadership dossier consumer", () => {
  it("pins actual producer bytes and leaves the accepted legacy fixture intact", () => {
    const bytes = readFileSync(new URL("./fixtures/sector_dossiers_v1.json", import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("22bb12e0516db2ca8f99b8d10af93deab0f75c96d362ae84a3fa99d95855fcb3");
    const { sector_dossiers: addendum, ...old } = fixture;
    expect(addendum.schema).toBe("leadership_rotation_context.sector_dossiers/v1");
    expect(old).toEqual(legacy);
    expect(sectorMeasuredRead(payload())).toEqual(sectorMeasuredRead(payload(legacy)));
  });

  it("preserves all eleven identities, owner missingness, zero and exact windows", () => {
    const result = sectorDossiers(payload());
    expect(result.state).toBe("ok");
    if (result.state !== "ok") throw new Error("Expected producer dossier");
    expect(result.dossier).toEqual(fixture.sector_dossiers);
    expect(result.dossier).not.toBe(fixture.sector_dossiers);
    expect(result.dossier.groups.map(row => row.group_id))
      .toEqual(["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]);
    const zero = result.dossier.groups.find(row => row.group_id === "XLK")!;
    expect(zero.relative_wealth_pct.rs_63d).toBe(0);
    expect(zero.null_reasons.rs_63d).toBeNull();
    for (const id of ["XLU", "XLRE"]) {
      const row = result.dossier.groups.find(row => row.group_id === id)!;
      expect(row.relative_wealth_pct).toEqual({ rs_21d: null, rs_63d: null });
      expect(row.null_reasons.rs_63d).not.toBeNull();
    }
    expect(result.dossier.windows_sessions).toEqual([21, 63]);
    expect(result.dossier.unavailable_windows.sessions).toEqual([5, 20]);
    expect(result.dossier.availability.historically_admissible).toBe(false);
    expect(Object.values(result.dossier.authority)).toEqual([false, false, false, false, false]);
  });

  it("returns absent for old or missing addenda without recursive fallback", () => {
    for (const input of [null, [], {}, "bad", payload(legacy),
      { sector_dossiers: fixture.sector_dossiers },
      { data: payload() }]) {
      expect(sectorDossiers(input)).toEqual({
        state: "absent", reason: "dossier_not_supplied", dossier: null,
      });
    }
  });

  it("preserves the actual owner's unavailable document without inventing a zero", () => {
    const result = sectorDossiers(payload(outage));
    expect(result.state).toBe("outage");
    expect(result.dossier).toEqual(outage.sector_dossiers);
    expect(result.dossier?.groups).toHaveLength(11);
    expect(result.dossier?.cross_sector_breadth_counts["21"].positive_n).toBeNull();
    expect(result.dossier?.as_of).toBeNull();
  });

  it("survives the existing sector owner-envelope boundary without a new gateway", () => {
    const ownerBody = { as_of: "2026-10-09", sectors: [], measured_read: fixture };
    expect(readableOwnerEnvelope("sector", ownerBody)).toBe(true);
    expect(sectorDossiers(ownerBody).dossier).toEqual(fixture.sector_dossiers);
  });

  it("returns detached content and never mutates the shared owner object", () => {
    const source = clone(), before = structuredClone(source);
    const result = sectorDossiers(payload(source));
    expect(source).toEqual(before);
    if (result.state !== "ok") throw new Error("Expected producer dossier");
    result.dossier.groups[0].relative_wealth_pct.rs_21d = 999;
    result.dossier.diagnostics.qualification_reasons.push("consumer_edit");
    expect(source).toEqual(before);
  });

  it.each([
    [["schema"], "other"],
    [["status"], "unknown"],
    [["generation", "cohort_id"], "top_six"],
    [["generation", "session_end"], "2026-10-08"],
    [["sector_dossiers", "schema"], "other/v1"],
    [["sector_dossiers", "cohort_id"], "top_six"],
    [["sector_dossiers", "as_of"], "2026-02-30"],
    [["sector_dossiers", "as_of"], "2026-10-08"],
    [["sector_dossiers", "benchmark"], "QQQ"],
    [["sector_dossiers", "price_basis"], "price_only"],
    [["sector_dossiers", "units"], "fraction"],
    [["sector_dossiers", "windows_sessions"], [20, 63]],
    [["sector_dossiers", "source_generation", "id"], "invented"],
    [["sector_dossiers", "availability", "original_available_at"], "2026-10-09T12:00:00Z"],
    [["sector_dossiers", "availability", "historically_admissible"], true],
    [["sector_dossiers", "availability", "mode"], "as_known"],
    [["sector_dossiers", "history", "naturally_observed"], true],
    [["sector_dossiers", "freshness", "status"], "fresh"],
    [["sector_dossiers", "authority", "may_trade"], true],
    [["sector_dossiers", "forecasts", "allocation_weight"], 0.2],
    [["sector_dossiers", "independent_confidence"], 0.9],
    [["sector_dossiers", "groups", "0", "group_id"], "QQQ"],
    [["sector_dossiers", "groups", "0", "relative_wealth_pct", "rs_21d"], false],
    [["sector_dossiers", "groups", "0", "relative_wealth_pct", "rs_21d"], Number.NaN],
    [["sector_dossiers", "groups", "0", "relative_wealth_pct", "rs_21d"], Number.POSITIVE_INFINITY],
    [["sector_dossiers", "groups", "0", "relative_wealth_pct", "rs_21d"], -101],
    [["sector_dossiers", "groups", "0", "relative_wealth_pct", "rs_21d"], 999],
    [["sector_dossiers", "groups", "0", "null_reasons", "rs_21d"], "missing_input"],
    [["sector_dossiers", "groups", "0", "qualification_reasons"], ["contradiction"]],
    [["sector_dossiers", "cross_sector_breadth_counts", "63", "positive_n"], 0],
    [["sector_dossiers", "dependency_audit", "source_family_count"], 0],
    [["sector_dossiers", "dependency_audit", "independence"], "independent"],
    [["sector_dossiers", "measurement_status"], "available"],
    [["sector_dossiers", "compatibility_key"], "another_generation"],
  ] as [string[], unknown][])("refuses incompatible contract at %j", (path, value) => {
    expect(sectorDossiers(changed(path, value))).toEqual({
      state: "invalid", reason: "invalid_dossier_contract", dossier: null,
    });
  });

  it("refuses duplicate, omitted and extra sector identities before rendering coverage", () => {
    const duplicate = clone();
    duplicate.sector_dossiers.groups[1].group_id = duplicate.sector_dossiers.groups[0].group_id;
    const missing = clone(); missing.sector_dossiers.groups.pop();
    const extra = clone(); extra.sector_dossiers.groups.push(structuredClone(extra.sector_dossiers.groups[0]));
    const parentDuplicate = clone(); parentDuplicate.groups[1].group_id = parentDuplicate.groups[0].group_id;
    for (const input of [duplicate, missing, extra, parentDuplicate]) {
      expect(sectorDossiers(payload(input)).state).toBe("invalid");
    }
  });

  it("refuses a null measurement that lost its explicit owner reason", () => {
    const read = clone();
    const missing = read.sector_dossiers.groups.find(row => row.group_id === "XLRE")!;
    missing.null_reasons.rs_63d = null;
    expect(sectorDossiers(payload(read)).state).toBe("invalid");
  });
});


it("rejects trailing control characters even when parent and addendum agree", () => {
  const benchmark = clone();
  benchmark.generation.benchmark = "SPY\n";
  benchmark.sector_dossiers.benchmark = "SPY\n";
  const session = clone();
  session.generation.session_end = "2026-10-09\n";
  session.sector_dossiers.as_of = "2026-10-09\n";
  const name = clone();
  name.sector_dossiers.groups[0].name_en = "Materials\n";
  for (const source of [benchmark, session, name]) {
    expect(sectorDossiers(payload(source)).state).toBe("invalid");
  }
});

it("rejects an audit that calls a native member outside its own cohort", () => {
  expect(sectorDossiers(changed(["sector_dossiers", "diagnostics", "outside_cohort"], ["XLB"])).state)
    .toBe("invalid");
});
