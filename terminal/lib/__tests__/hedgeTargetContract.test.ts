import { describe, expect, it } from "vitest";
import fixture from "./fixtures/hedgeTargetChange.synthetic.json";
import zero from "./fixtures/hedgeTargetZero.synthetic.json";
import unavailable from "./fixtures/hedgeTargetUnavailable.synthetic.json";
import controls from "./fixtures/hedgeTargetControls.synthetic.json";
import { parseHedgeTargetChange } from "../hedgeTargetContract";

// Actual Macro CLI output at 4e7e44b, from its explicitly synthetic input.
// These assertions concern transport semantics, not empirical dealer positions.
const fresh = () => structuredClone(fixture);

describe("hedge-target scenario consumer", () => {
  it.each(controls)("preserves actual Macro control $name", ({ output }) => {
    const parsed = parseHedgeTargetChange(output);
    expect(parsed).not.toBeNull();
    expect(parsed?.status).toBe(output.status);
    expect(parsed?.hedge?.target_change ?? null).toBe(output.hedge?.target_change ?? null);
  });
  it("consumes the actual Macro output without converting its units or authority", () => {
    const parsed = parseHedgeTargetChange(fresh());
    expect(parsed).toMatchObject({
      kind: "conditional_hedge_target",
      status: "complete_for_supplied_universe",
      scope: { kind: "all_supplied_expiries", selectedContracts: 1, expectedContracts: 1 },
      source: { ageAtDecisionSeconds: 2, sourceRevision: "synthetic-fixture-v1" },
      hedge: { target_change: fixture.hedge.target_change },
      authority: { can_publish: false, calibrated_probability: false, trading: false },
    });
  });

  it("labels an explicit expiry subset without implying all-market coverage", () => {
    const raw = fresh();
    raw.coverage.expiry_scope = ["2026-10-08"] as never;
    expect(parseHedgeTargetChange(raw)).toMatchObject({
      scope: { kind: "selected_supplied_expiries", expiries: ["2026-10-08"] },
    });
  });

  it("preserves unavailable state and reasons with no numeric exposure", () => {
    const raw = { ...fresh(), status: "unavailable", unavailable_reasons: ["stale_source"],
      hedge: null, attribution: null, by_expiry: [], by_cohort: [], source_age_seconds: 62,
      as_of: "2026-10-08T18:01:02+00:00" };
    expect(parseHedgeTargetChange(raw)).toMatchObject({ status: "unavailable", hedge: null,
      unavailableReasons: ["stale_source"], source: { ageAtDecisionSeconds: 62 } });
  });

  const bad: Array<[string, Array<[string, unknown]>]> = [
    ["wrong schema", [["schema", "options.scenario_surface/v1"]]],
    ["forecast claim", [["evidence_class", "FORECAST"]]],
    ["invented units", [["units.target_change", "ES_contracts"]]],
    ["publication claim", [["authority.can_publish", true]]],
    ["missing authority", [["authority.trading", undefined]]],
    ["probability claim", [["authority.calibrated_probability", true]]],
    ["naive observation", [["observed_at", "2026-10-08T18:00:00"]]],
    ["late receipt", [["source_receipt.consumer_available_at", "2026-10-09T18:00:00Z"]]],
    ["future source", [["source_receipt.source_observed_at", "2026-10-09T18:00:00Z"]]],
    ["dishonest age", [["source_age_seconds", 0]]],
    ["stale complete", [["as_of", "2026-10-08T18:01:02Z"], ["source_age_seconds", 62]]],
    ["missing reason", [["status", "unavailable"]]],
    ["unavailable numeric", [["status", "unavailable"], ["unavailable_reasons", ["stale_source"]]]],
    ["nonfinite target", [["hedge.target_change", Infinity]]],
    ["false denominator", [["coverage.received", 2]]],
    ["duplicate denominator", [["coverage.expected_contract_ids", [...fixture.coverage.expected_contract_ids, ...fixture.coverage.expected_contract_ids]]]],
    ["missing contract", [["contracts", []]]],
    ["duplicate economic leg", [["contracts", [...fixture.contracts, ...fixture.contracts]], ["coverage.received", 2]]],
    ["unknown inventory", [["contracts.0.n0", null]]],
    ["invalid IV", [["contracts.0.target_iv", 0]]],
    ["fixing crossed", [["target_at", fixture.contracts[0].fixing_at]]],
    ["wrong settlement", [["contracts.0.settlement", "AM"]]],
    ["empty expiry selection", [["coverage.expiry_scope", []]]],
    ["uncovered expiry", [["coverage.expiry_scope", ["2026-10-09"]]]],
    ["wrong target identity", [["hedge.endpoint_target", fixture.hedge.endpoint_target + 10]]],
    ["wrong notional", [["hedge.reference_notional_usd", fixture.hedge.reference_notional_usd + 10]]],
    ["wrong expiry sum", [["by_expiry.0.target_change", 0]]],
    ["wrong cohort sum", [["by_cohort.0.target_change", 0]]],
    ["wrong attribution", [["attribution.inventory", fixture.attribution.inventory + 10]]],
    ["unknown inventory model", [["inventory_assumptions.method", "actual_dealer_positions"]]],
    ["wrong fixing date", [["contracts.0.fixing_at", "2026-10-09T20:00:00Z"], ["by_expiry.0.fixing_at", "2026-10-09T20:00:00Z"]]],
    ["wrong cohort membership", [["contracts.0.anchor_cohort", "unknown"], ["by_cohort.0.contracts", 0]]],
    ["one-microsecond late receipt", [["source_receipt.consumer_available_at", "2026-10-08T18:00:02.000001+00:00"]]],
    ["impossible clock date", ["observed_at", "as_of", "target_at", "source_receipt.source_observed_at", "source_receipt.received_at", "source_receipt.consumer_available_at"].map(path => {
      const raw = path.startsWith("source_receipt.") ? fixture.source_receipt[path.split(".")[1] as keyof typeof fixture.source_receipt] : fixture[path as "observed_at" | "as_of" | "target_at"];
      return [path, raw.replace("2026-10-08", "2026-02-30")];
    })],
    ["coherent but false cohort label", [["contracts.0.anchor_cohort", "1-7D"], ["by_cohort", [
      { ...fixture.by_cohort[1], cohort: "0DTE" },
      { ...fixture.by_cohort[0], cohort: "1-7D" }, fixture.by_cohort[2],
    ]]]],
    ["Flow claim without maps", [["inventory_assumptions", {
      method: "supplied_prior_minus_participation_times_signed_flow_plus_adjustments/v1",
      dealer_fraction: .5, nontrade_assumption: "assumed_zero",
    }]]],
  ];
  it.each(bad)("rejects %s", (_name, changes) => {
    const raw = fresh();
    for (const [path, value] of changes) {
      const keys = path.split(".");
      let node = raw as unknown as Record<string, unknown>;
      for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
      node[keys.at(-1)!] = value;
    }
    expect(parseHedgeTargetChange(raw)).toBeNull();
  });

  it("keeps actual zero separate from unavailable, with undefined net/gross at zero", () => {
    expect(parseHedgeTargetChange(zero)).toMatchObject({ status: "complete_for_supplied_universe",
      hedge: { target_change: 0, gross_contract_target_changes: 0, cancellation_ratio: null } });
    expect(parseHedgeTargetChange(unavailable)).toMatchObject({ status: "unavailable", hedge: null });
  });

  it("isolates returned collections from subsequent input mutations", () => {
    const raw = fresh();
    const parsed = parseHedgeTargetChange(raw)!;
    raw.hedge.target_change = 123;
    raw.by_expiry[0].target_change = 123;
    raw.coverage.expected_contract_ids.push("invented");
    expect(parsed.hedge?.target_change).toBe(fixture.hedge.target_change);
    expect(parsed.byExpiry[0].target_change).toBe(fixture.hedge.target_change);
    expect(parsed.scope.expectedContracts).toBe(1);
  });

  it("rejects overflowing arithmetic instead of accepting Infinity <= Infinity", () => {
    const raw = structuredClone(zero);
    raw.hedge.anchor_target = -1e308;
    raw.hedge.endpoint_target = 1e308;
    raw.by_cohort[0].anchor_target = -1e308;
    raw.by_cohort[0].endpoint_target = 1e308;
    expect(parseHedgeTargetChange(raw)).toBeNull();
  });

  it("does not project unvalidated extra numeric claims", () => {
    const raw = fresh();
    Object.assign(raw.hedge, { probability: 0.99 });
    Object.assign(raw.by_expiry[0], { dealer_ownership: "observed" });
    const parsed = parseHedgeTargetChange(raw)!;
    expect(parsed.hedge).not.toHaveProperty("probability");
    expect(parsed.byExpiry[0]).not.toHaveProperty("dealer_ownership");
  });

  it.each([null, [], "", 0, true, {}])("fails closed on non-contract input %j", (raw) => {
    expect(parseHedgeTargetChange(raw)).toBeNull();
  });
});
