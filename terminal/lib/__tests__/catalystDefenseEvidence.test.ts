import { describe, expect, it } from "vitest";
import owner from "./fixtures/catalystDefenseOwner.json";
import { decodeDefenseContext, type DefenseFact } from "../catalystDefense";
import { defenseEvidenceFor, defensePeriodText, presentDefenseFact } from "../catalystDefenseEvidence";

const view = () => decodeDefenseContext(structuredClone(owner), Date.parse("2026-10-17T18:00:00Z"));
const fact = (ticker: string, key: string): DefenseFact => view().profiles.find(p => p.ticker_display === ticker)!.axes.economics.facts.find(f => f.fact_id.endsWith(`:${key}`))!;

describe("source-bound Defense evidence selection", () => {
  it("reads all 95 unchanged owner facts with English and Chinese semantic labels", () => {
    const data = view(), before = JSON.stringify(data);
    expect(data.profiles.reduce((sum, p) => sum + p.axes.economics.facts.length, 0)).toBe(95);
    for (const profile of data.profiles) {
      expect(defenseEvidenceFor(profile).facts).toEqual(profile.axes.economics.facts);
      for (const row of profile.axes.economics.facts) for (const lang of ["en", "zh"] as const) {
        expect(presentDefenseFact(row, lang), `${profile.ticker_display} ${row.fact_id} ${lang}`).not.toBeNull();
      }
    }
    expect(JSON.stringify(data)).toBe(before);
  });
  it.each([0, 1, 2, 3])("resolves only the exact references for issuer %s", index => {
    const profile = view().profiles[index];
    for (const row of [...profile.interpretation!.chain, ...profile.interpretation!.scenarios]) {
      const selected = defenseEvidenceFor(profile, row.fact_refs);
      expect(selected.unresolved).toBe(0);
      expect(selected.facts.map(f => ({ fact_id: f.fact_id, owner_ref: f.owner_ref }))).toEqual(row.fact_refs);
    }
  });
  it("does not substitute another issuer or another source for an unresolved reference", () => {
    const [lmt, rtx] = view().profiles, native = lmt.axes.economics.facts[0];
    for (const ref of [rtx.axes.economics.facts[0], { fact_id: native.fact_id, owner_ref: "other-owner" }]) {
      expect(defenseEvidenceFor(lmt, [ref])).toEqual({ facts: [], unresolved: 1 });
    }
  });
  it("deduplicates repeated citations while refusing an ambiguous duplicate source fact", () => {
    const p = view().profiles[0], f = p.axes.economics.facts[0];
    expect(defenseEvidenceFor(p, [f, f])).toEqual({ facts: [f], unresolved: 0 });
    p.axes.economics.facts.push({ ...f, value: 123 });
    expect(defenseEvidenceFor(p, [f])).toEqual({ facts: [], unresolved: 1 });
  });
});

describe("financial meaning is preserved, never inferred from a number", () => {
  it("retains negative cash values and distinguishes current from disclosed prior periods", () => {
    const prior = presentDefenseFact(fact("LMT", "issuer_free_cash_quarter_prior"), "en")!;
    expect(prior.value).toBe("-150"); expect(prior.unit).toBe("USD million"); expect(prior.period).toBe("Q2 2025");
    expect(prior.nature).toContain("prior-period"); expect(prior.basis).toContain("Company-wide");
  });
  it("does not relabel adjusted free cash flow as ordinary free cash flow", () => {
    const noc = presentDefenseFact(fact("NOC", "issuer_free_cash_half_year"), "en")!;
    expect(noc.title).toBe("Adjusted free cash flow"); expect(noc.value).toBe("-845"); expect(noc.period).toBe("First half 2026");
  });
  it("does not convert billions to millions or backlog into new sales", () => {
    const rtx = presentDefenseFact(fact("RTX", "issuer_backlog"), "en")!;
    expect(rtx.value).toBe("289"); expect(rtx.unit).toBe("USD billion"); expect(rtx.basis).toContain("not sales or new orders");
    expect(presentDefenseFact(fact("NOC", "issuer_backlog_unfunded"), "en")!.title).toBe("Unfunded backlog");
  });
  it("separates current guidance, prior guidance and reported cash", () => {
    const low = presentDefenseFact(fact("LMT", "issuer_free_cash_guidance_low"), "en")!;
    const old = presentDefenseFact(fact("LMT", "issuer_free_cash_guidance_low_prior"), "en")!;
    expect(low.title).toContain("lower bound"); expect(low.nature).toContain("not a reported result");
    expect(old.nature).toContain("Earlier company guidance"); expect(low.period).toBe("Full year 2026");
    expect(presentDefenseFact(fact("LHX", "issuer_free_cash_guidance_point"), "en")!.title).toContain("point estimate");
  });
  it("keeps cost revisions separate from payments and prior margins separate from current margins", () => {
    expect(presentDefenseFact(fact("NOC", "siaw_unfavorable_eac"), "en")!.basis).toContain("not a cash payment");
    const now = presentDefenseFact(fact("NOC", "defense_segment_margin"), "en")!;
    const old = presentDefenseFact(fact("NOC", "defense_segment_prior_margin"), "en")!;
    expect([now.value, now.period, old.value, old.period]).toEqual(["7.5%", "Q2 2026", "12.7%", "Q2 2025"]);
  });
  it("keeps balance-sheet changes as cash-flow effects rather than balance levels", () => {
    const result = presentDefenseFact(fact("LHX", "issuer_receivables_cash_change_half_year"), "en")!;
    expect(result.value).toBe("-675"); expect(result.title).toBe("Cash-flow effect of receivables");
    expect(result.basis).toContain("not a balance-sheet level");
  });
  it("keeps earlier net-enterprise terms distinct from completed total-enterprise terms", () => {
    const pending = fact("LHX", "space_business_sale_pending_terms"), completed = fact("LHX", "space_business_sale_completed_terms");
    const a = presentDefenseFact(pending, "en")!, b = presentDefenseFact(completed, "en")!;
    expect(a.value).toBe(pending.value); expect(b.value).toBe(completed.value);
    expect(a.nature).toContain("Conditional"); expect(b.nature).toBe("Completed transaction disclosure");
    expect(a.value).toContain("$825 million"); expect(b.value).toContain("$845 million");
    expect(a.originalTerms && b.originalTerms).toBe(true);
  });
  it("refuses a known metric suffix with a mismatched basis, class, type or unit", () => {
    const f = fact("LMT", "issuer_operating_cash_quarter");
    for (const patch of [{ accounting_basis: "issuer_reported_consolidated:total_backlog_stock" }, { fact_class: "reported_guidance" }, { unit: "percent" }, { value: "3235" }, { value: Infinity }]) {
      expect(presentDefenseFact({ ...f, ...patch }, "en")).toBeNull();
    }
    expect(presentDefenseFact({ ...f, fact_id: "owner:unrecognized_metric" }, "en")).toBeNull();
  });
  it("does not turn an unknown period into an intraday time", () => {
    expect(defensePeriodText("2026-02-30", "en")).toBe("Reporting period not recognized");
    expect(defensePeriodText("2026Q2", "zh")).toBe("2026年第2季度");
    expect(defensePeriodText("2026H1", "zh")).toBe("2026年上半年");
    expect(defensePeriodText("2026FY", "zh")).toBe("2026全年");
  });
});
