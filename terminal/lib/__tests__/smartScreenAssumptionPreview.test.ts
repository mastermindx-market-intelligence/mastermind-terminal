import { describe, expect, it } from "vitest";
import {
  buildTrialDefinition, captureAssumptionSnapshot, compareDefinitions, listNumericLeaves,
  type PreviewBucket,
} from "@/lib/smartScreen/assumptionPreview";
import { normalizeDefinition, type ScreenDefinition, type ScreenRow } from "@/lib/smartScreen/predicate";

// Recipe A: two numeric leaves (one at the root, two inside an OR), one enum leaf and one
// boolean leaf — the trial must be able to reach the numeric leaves WITHOUT disturbing the
// rest, and the scope names an asset class (Funds) so out-of-scope rows exist.
const RAW_A = {
  grammar: 1,
  scope: { markets: "all", asset: "Funds", unpriced: false },
  where: {
    all: [
      { f: "dv", op: "gte", v: 1_000_000 },
      { f: "verdict", op: "in", v: ["BUY", "RECLAIM"] },
      { f: "regimeBull", op: "is", v: true },
      { any: [{ f: "mcap", op: "gte", v: 5e9 }, { f: "offHi", op: "lte", v: -30 }] },
    ],
  },
};

const defA = (): ScreenDefinition => {
  const normalized = normalizeDefinition(RAW_A);
  if (!normalized.ok) throw new Error(`fixture refused: ${normalized.error}`);
  return normalized.def;
};

const row = (over: Partial<ScreenRow>): ScreenRow => ({
  sym: "X", sec: "Funds", mktId: "us",
  last: 25, chg: 1, dv: 5e7, mcap: 1e10, offHi: -10, offLo: 8,
  verdict: "BUY", gics: "Financials", regimeBull: true,
  ...over,
});

// Fixed captured population: every bucket the preview can name is represented once.
const ROWS: ScreenRow[] = [
  row({ sym: "F1", dv: 5e6 }),                              // A matches; fails a raised dv threshold
  row({ sym: "F2", dv: 5e7 }),                              // matches A and both trials
  row({ sym: "F3", dv: null }),                             // dv missing → unknown, never false
  row({ sym: "F4", last: 0 }),                              // unpriced (Funds cannot trade at 0)
  row({ sym: "F5", sec: "Bonds" }),                         // outside the screen's asset scope
  row({ sym: "F6", dv: 5e7, verdict: null }),               // verdict missing → unknown overall
  row({ sym: "F7", dv: 5e5 }),                              // fails A, matches a lowered dv threshold
];

const leafOf = (def: ScreenDefinition, f: string) => {
  const ref = listNumericLeaves(def).find((r) => r.leaf.f === f);
  if (!ref) throw new Error(`no ${f} leaf`);
  return ref;
};

describe("listNumericLeaves", () => {
  it("enumerates every numeric leaf, including leaves nested in an OR group", () => {
    const fields = listNumericLeaves(defA()).map((ref) => ref.leaf.f).sort();
    expect(fields).toEqual(["dv", "mcap", "offHi"]);
  });

  it("offers nothing for a newer grammar — the refusal path, not a best-effort read", () => {
    const newer = { ...defA(), grammar: 2 } as unknown as ScreenDefinition;
    expect(listNumericLeaves(newer)).toEqual([]);
    expect(listNumericLeaves(defA()).length).toBeGreaterThan(0);
  });
});

describe("buildTrialDefinition", () => {
  it("changes exactly the selected threshold and keeps every other leaf, scope and group", () => {
    const a = defA();
    const ref = leafOf(a, "dv");
    const built = buildTrialDefinition(a, ref.path, "gte", 2e7);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // B is canonically valid under the OWNER's normalizer: its hash is the hash of the
    // hand-built draft, not of anything this module invented.
    const handDraft = normalizeDefinition({
      grammar: 1,
      scope: { markets: "all", asset: "Funds", unpriced: false },
      where: {
        all: [
          { f: "dv", op: "gte", v: 2e7 },
          { f: "verdict", op: "in", v: ["BUY", "RECLAIM"] },
          { f: "regimeBull", op: "is", v: true },
          { any: [{ f: "mcap", op: "gte", v: 5e9 }, { f: "offHi", op: "lte", v: -30 }] },
        ],
      },
    });
    expect(handDraft.ok).toBe(true);
    if (handDraft.ok) expect(built.hash).toBe(handDraft.hash);
    // The untouched leaves survive verbatim, including the enum, the boolean and the OR pair.
    // Canonical order walks the OR group first (its canonical text sorts before leaf keys).
    expect(listNumericLeaves(built.def).map((r) => [r.leaf.f, r.leaf.op, r.leaf.v])).toEqual([
      ["mcap", "gte", 5e9], ["offHi", "lte", -30], ["dv", "gte", 2e7],
    ]);
    expect(built.def.scope).toEqual(a.scope);
  });

  it("never mutates the saved definition A", () => {
    const a = defA();
    const before = JSON.stringify(a);
    const ref = leafOf(a, "dv");
    buildTrialDefinition(a, ref.path, "lte", -1);
    expect(JSON.stringify(a)).toBe(before);
  });

  it("refuses a newer grammar by name instead of reinterpreting it as v1", () => {
    const newer = { ...defA(), grammar: 2 } as unknown as ScreenDefinition;
    const ref = { key: "where.all[0]", steps: [0] };
    const out = buildTrialDefinition(newer, ref, "gte", 2e7);
    expect(out).toEqual({ ok: false, reason: "grammar_newer" });
  });

  it("refuses an unsupported (lower/unknown) grammar value", () => {
    const weird = { ...defA(), grammar: 0 } as unknown as ScreenDefinition;
    const out = buildTrialDefinition(weird, { key: "where.all[0]", steps: [0] }, "gte", 1);
    expect(out).toEqual({ ok: false, reason: "grammar_invalid" });
  });

  it("refuses when the screen has no numeric leaf at all", () => {
    const normalized = normalizeDefinition({
      grammar: 1,
      scope: { markets: "all", asset: null, unpriced: false },
      where: { all: [{ f: "verdict", op: "present" }] },
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const out = buildTrialDefinition(normalized.def, { key: "", steps: [] }, "gte", 1);
    expect(out).toEqual({ ok: false, reason: "no_numeric_leaf" });
  });

  it("refuses invalid and out-of-range thresholds", () => {
    const a = defA();
    const ref = leafOf(a, "dv");
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, 1e16, -1e16]) {
      expect(buildTrialDefinition(a, ref.path, "gte", v)).toEqual({ ok: false, reason: "bad_threshold" });
    }
    expect(buildTrialDefinition(a, ref.path, "eq" as "gte", 1)).toEqual({ ok: false, reason: "bad_op" });
  });
});

describe("captureAssumptionSnapshot", () => {
  it("freezes one copy of the rows and the generation; later panel changes do not seep in", () => {
    const a = defA();
    const rows = [...ROWS];
    const capture = captureAssumptionSnapshot({ screenId: "s1", name: "Fund screen", def: a, asOf: "2026-10-10", rows });
    expect(Object.isFrozen(capture)).toBe(true);
    expect(Object.isFrozen(capture.rows)).toBe(true);
    expect(capture.asOf).toBe("2026-10-10");
    // The panel's own array mutating afterwards must not touch the capture.
    rows.push(row({ sym: "LATE" }));
    expect(capture.rows).toHaveLength(ROWS.length);
    expect(capture.rows.some((r) => r.sym === "LATE")).toBe(false);
    expect(capture.sourceRows).toBe(rows); // drift signal only, never evaluated
  });
});

describe("compareDefinitions", () => {
  it("labels overlap and coverage on ONE captured population — both, A-only, B-only", () => {
    const a = defA();
    const up = buildTrialDefinition(a, leafOf(a, "dv").path, "gte", 2e7);
    const down = buildTrialDefinition(a, leafOf(a, "dv").path, "gte", 1e5);
    expect(up.ok && down.ok).toBe(true);
    if (!up.ok || !down.ok) return;

    const raised = compareDefinitions(a, up.def, ROWS);
    expect(raised.population).toBe(ROWS.length);
    expect(raised.counts.both).toBe(1);        // F2
    expect(raised.counts.aOnly).toBe(1);       // F1: A matched, raised threshold drops it
    expect(raised.counts.bOnly).toBe(0);

    const lowered = compareDefinitions(a, down.def, ROWS);
    expect(lowered.counts.both).toBe(2);       // F1, F2
    expect(lowered.counts.bOnly).toBe(1);      // F7: fails A, admitted by the lower threshold
    expect(lowered.counts.aOnly).toBe(0);
    expect(lowered.lists.bOnly).toEqual(["F7"]);
  });

  it("keeps missing data unknown — never a false fail, never an entry/exit claim", () => {
    const a = defA();
    const same = buildTrialDefinition(a, leafOf(a, "dv").path, "gte", 1_000_000);
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    const out = compareDefinitions(a, same.def, ROWS);
    expect(out.counts.unknown).toBe(2);        // F3 (dv missing), F6 (verdict missing)
    expect(out.counts.unpriced).toBe(1);       // F4
    expect(out.counts.outOfScope).toBe(1);     // F5
    expect(out.counts.failed).toBe(1);         // F7: truly fails both (dv 5e5 < 1e6)
    expect(out.counts.both).toBe(2);           // F1, F2
    expect(out.lists.unknown).toEqual(["F3", "F6"]);
  });

  it("bounds every list visibly and counts what it does not show", () => {
    const a = defA();
    const many = Array.from({ length: 150 }, (_, i) => row({ sym: `M${i}`, dv: 5e7 }));
    const same = buildTrialDefinition(a, leafOf(a, "dv").path, "gte", 1_000_000);
    if (!same.ok) throw new Error("fixture refused");
    const out = compareDefinitions(a, same.def, many);
    const buckets = Object.keys(out.lists) as PreviewBucket[];
    for (const bucket of buckets) {
      expect(out.lists[bucket].length).toBeLessThanOrEqual(60);
      expect(out.counts[bucket]).toBe(out.lists[bucket].length + out.hidden[bucket]);
    }
    expect(out.counts.both).toBe(150);
    expect(out.hidden.both).toBe(90);
  });

  it("takes ONE rows argument — A and B cannot be handed different generations", () => {
    const a = defA();
    const same = buildTrialDefinition(a, leafOf(a, "dv").path, "gte", 1_000_000);
    if (!same.ok) throw new Error("fixture refused");
    expect(compareDefinitions.length).toBe(3); // defA, defB, rows — no second row set exists
    expect(compareDefinitions(a, same.def, Object.freeze([...ROWS]))).toBeTruthy();
  });
});

// Assigning coordinator's independent controls: these failed against the original worker bytes.
describe("independent snapshot and predicate controls", () => {
  it("detaches row objects and the complete A definition while leaving caller objects mutable", () => {
    const a = defA(); const rows = [row({sym:"ORIGINAL", dv:5e6})];
    const before = JSON.stringify(a);
    const cap = captureAssumptionSnapshot({screenId:"s",name:"S",def:a,rows,asOf:"2026-10-10"});
    rows[0].dv = 0; rows[0].sym = "MUTATED";
    leafOf(a,"dv").leaf.v = 99;
    expect(cap.rows[0].sym).toBe("ORIGINAL");
    expect(cap.rows[0].dv).toBe(5e6);
    expect(JSON.stringify(cap.def)).toBe(before);
    expect(Object.isFrozen(cap.rows[0])).toBe(true);
    expect(Object.isFrozen(cap.def.where)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(false);
    expect(Object.isFrozen(a)).toBe(false);
  });
  it("resolves the selected key itself rather than trusting mismatched caller path steps", () => {
    const a = defA(); const dv = leafOf(a,"dv"); const other = leafOf(a,"offHi");
    const good = buildTrialDefinition(a,dv.path,"gte",2e7);
    const forged = buildTrialDefinition(a,{key:dv.path.key,steps:other.path.steps},"gte",2e7);
    expect(forged).toEqual(good);
  });
  it("refuses an operator change: B changes exactly one threshold", () => {
    const a=defA(); expect(buildTrialDefinition(a,leafOf(a,"dv").path,"lte",2e7)).toEqual({ok:false,reason:"bad_op"});
  });
  it("keeps match versus unknown in coverage rather than inventing A-only", () => {
    const n=normalizeDefinition({grammar:1,scope:{markets:"all",asset:"Funds",unpriced:false},where:{any:[{f:"chg",op:"gte",v:3},{f:"regimeBull",op:"is",v:true}]}});
    if(!n.ok)throw new Error(n.error);
    const b=buildTrialDefinition(n.def,leafOf(n.def,"chg").path,"gte",5);
    if(!b.ok)throw new Error(b.reason);
    const out=compareDefinitions(n.def,b.def,[row({sym:"PARTIAL",chg:4,regimeBull:null})]);
    expect(out.counts.unknown).toBe(1); expect(out.counts.aOnly).toBe(0);
    expect(out.lists.unknown).toEqual(["PARTIAL"]);
  });
});
