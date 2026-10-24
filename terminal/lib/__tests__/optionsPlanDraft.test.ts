import { describe, expect, it } from "vitest";
import { buildPin, type ShortlistPin } from "../optionsContractShortlist";
import { createOptionsPlanDraft, validateOptionsPlanDraft, type OptionsPlanDraft } from "../optionsPlanDraft";
import sourceFixture from "./fixtures/options_plan_draft_v1.json";

function pin(extra: Record<string, unknown> = {}): ShortlistPin {
  const row = { root: "NVDA", right: "C", exp: "2026-11-20", strike: 180, mid: 4.5, oi: 500, nested: { source: ["原始数据", 3] }, ...extra };
  const r = buildPin(row, { family: "doi", asof: "2026-10-23T20:00:00Z", schema: "options_hub.oi_movers/v1", stale: true, hotView: null }, [row]);
  if (!r.ok) throw new Error(r.reason);
  return r.pin;
}
function draft(): OptionsPlanDraft {
  const r = createOptionsPlanDraft([pin()]);
  if (!r.ok) throw new Error(r.reason);
  return JSON.parse(JSON.stringify(r.value));
}
describe("exact-contract Plan preparation", () => {
  it("round-trips the shared synthetic integration fixture with null and zero kept distinct", () => {
    const result = validateOptionsPlanDraft(sourceFixture);
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(JSON.stringify(result.value))).toEqual(sourceFixture);
    expect(sourceFixture.legs[0].assumptions.entry).toBeNull();
    expect(sourceFixture.legs[1].assumptions.entry?.premium_per_unit).toBe(0);
  });
  it("retains exact source, explicit unknown terms and clocks without copying reference prices into assumptions", () => {
    const p = pin(), r = createOptionsPlanDraft([p]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const leg = r.value.legs[0];
    expect(leg.snapshot).toEqual(p);
    expect(leg.snapshot.identity.terms).toEqual({ multiplier: null, deliverable: null, settlement: null, exercise_style: null });
    expect(leg.snapshot.asofRaw).toBe("2026-10-23T20:00:00Z");
    expect(leg.assumptions).toEqual({ side: null, quantity: null, entry: null });
    expect(r.value.research.horizon).toBe("");
    expect(JSON.stringify(r.value)).not.toContain("available_at");
    (p.row.nested as { source: unknown[] }).source[0] = "changed";
    p.identity.terms.multiplier = 100;
    expect((leg.snapshot.row.nested as { source: unknown[] }).source[0]).toBe("原始数据");
    expect(leg.snapshot.identity.terms.multiplier).toBeNull();
    expect(Object.isFrozen(leg.snapshot.row.nested)).toBe(true);
    expect(Object.isFrozen(leg.snapshot.identity.terms)).toBe(true);
    expect(Object.isFrozen(leg.assumptions)).toBe(true);
  });
  it.each([0, 0.01, 3.5])("accepts explicit nonnegative entry %s without claiming a quote", n => {
    const d = draft();
    Object.assign(d.legs[0].assumptions, { side: "sell", quantity: 2, entry: { kind: "user_assumption", premium_per_unit: n, currency: "USD" } });
    const r = validateOptionsPlanDraft(d);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.legs[0].snapshot.row.mid).toBe(4.5);
  });
  it.each([-1, Infinity, NaN])("refuses invalid entry %s", n => {
    const d = draft(); d.legs[0].assumptions.entry = { kind: "user_assumption", premium_per_unit: n, currency: "USD" };
    expect(validateOptionsPlanDraft(d).ok).toBe(false);
  });
  it.each([0, -2, 1.5, 1000001, Infinity])("refuses quantity %s", n => {
    const d = draft(); d.legs[0].assumptions.quantity = n;
    expect(validateOptionsPlanDraft(d).ok).toBe(false);
  });
  it("refuses mismatched identity, terms, session and key instead of normalizing", () => {
    for (const change of [
      (p: ShortlistPin) => { p.identity.root = "nvda"; },
      (p: ShortlistPin) => { p.identity.terms.multiplier = 100; },
      (p: ShortlistPin) => { p.session = "2026-10-22"; },
      (p: ShortlistPin) => { p.pinKey = "invented"; },
    ]) {
      const d = draft(); change(d.legs[0].snapshot);
      expect(validateOptionsPlanDraft(d)).toMatchObject({ ok: false, reason: "source_snapshot" });
    }
  });
  it("refuses true duplicates and mixed roots while keeping distinct deliverables distinct", () => {
    expect(createOptionsPlanDraft([pin(), pin()])).toMatchObject({ ok: false, reason: "duplicate_contract" });
    expect(createOptionsPlanDraft([pin(), pin({ root: "NVDA1" })])).toMatchObject({ ok: false, reason: "mixed_root" });
    expect(createOptionsPlanDraft([pin({ multiplier: 50 }), pin({ multiplier: 100 })]).ok).toBe(true);
    expect(createOptionsPlanDraft([]).ok).toBe(false);
    expect(createOptionsPlanDraft(Array.from({ length: 5 }, (_, i) => pin({ strike: 180 + i }))).ok).toBe(false);
  });
  it("preserves multilingual authored text and treats horizon independently of expiry", () => {
    const d = draft(); d.research = { thesis: "保持 ZWJ 👨‍👩‍👧‍👦\n观点\tتجربة", invalidation: "价格跌破研究条件", horizon: "3–10个交易日，非到期日" };
    const r = validateOptionsPlanDraft(d);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.research).toEqual(d.research);
    for (const s of ["\ud800", "a\u0000b", "a\u0001b", "x".repeat(4001)]) {
      d.research.thesis = s;
      expect(validateOptionsPlanDraft(d).ok).toBe(false);
    }
  });
  it("rejects unknown typed fields and executable/source-entry claims", () => {
    const addAt = ["root", "research", "leg", "snapshot", "identity", "terms", "assumptions", "entry"];
    for (const where of addAt) {
      const d = draft(); d.legs[0].assumptions.entry = { kind: "user_assumption", premium_per_unit: 1, currency: "USD" };
      const l = d.legs[0];
      const target = { root: d, research: d.research, leg: l, snapshot: l.snapshot, identity: l.snapshot.identity, terms: l.snapshot.identity.terms, assumptions: l.assumptions, entry: l.assumptions.entry }[where];
      Object.assign(target!, { executable: true });
      expect(validateOptionsPlanDraft(d).ok).toBe(false);
    }
  });
  it("rejects unsafe/deep/oversize data before reading accessors and never drops row fields", () => {
    let invoked = 0;
    const unsafe: unknown[] = [undefined, NaN, () => 1, new Date(), Object.create({ inherited: 1 }), JSON.parse('{"__proto__":{"polluted":true}}')];
    const accessor = {}; Object.defineProperty(accessor, "value", { enumerable: true, get() { invoked++; return 1; } }); unsafe.push(accessor);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic; unsafe.push(cyclic);
    for (const v of unsafe) {
      const d = draft(); d.legs[0].snapshot.row = { ...d.legs[0].snapshot.row, payload: v };
      expect(validateOptionsPlanDraft(d).ok).toBe(false);
    }
    expect(invoked).toBe(0);
    const d = draft(); d.legs[0].snapshot.row = { ...d.legs[0].snapshot.row, extra: "界".repeat(3000) };
    expect(validateOptionsPlanDraft(d).ok).toBe(false);
    let nested: unknown = 1; for (let i = 0; i < 10; i++) nested = { nested };
    d.legs[0].snapshot.row = { ...pin().row, extra: nested };
    expect(validateOptionsPlanDraft(d).ok).toBe(false);
    const p = pin(); Object.defineProperty(p, "identity", { get() { invoked++; throw new Error("must not read"); } });
    expect(createOptionsPlanDraft([p]).ok).toBe(false);
    expect(invoked).toBe(0);
  });
});
