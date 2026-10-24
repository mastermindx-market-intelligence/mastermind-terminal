import { buildPin } from "../../optionsContractShortlist";
import { createOptionsPlanDraft, type OptionsPlanDraft } from "../../optionsPlanDraft";
import type { PlanExpiryRequest } from "../../optionsPlanPayoff";

export function draft(): OptionsPlanDraft {
  const row = { root: "SPY", exp: "2026-10-30", right: "C", strike: 765, mid: 3, oi: 10 };
  const pin = buildPin(row, { family: "doi", asof: "2026-10-23T20:00:00Z", schema: null, stale: false, hotView: null }, [row]);
  if (!pin.ok) throw new Error(pin.reason);
  const result = createOptionsPlanDraft([pin.pin]);
  if (!result.ok) throw new Error(result.reason);
  const d = JSON.parse(JSON.stringify(result.value));
  d.legs[0].assumptions = { side: "buy", quantity: 1, entry: { kind: "user_assumption", premium_per_unit: 2, currency: "USD" } };
  return d;
}
export function response(request: PlanExpiryRequest) {
  return { schema: "options.plan_expiry_preparation/v1", status: "PREPARED_EXPIRY_PAYOFF", reasons: [],
    known_by: "2026-10-24T12:00:00Z", contract_expirations: ["2026-10-30"],
    curve: { spots: request.spots, pnl: request.spots.map(s => Math.max(s - 765, 0) * 100 - 200), cost: 200,
      max_gain: "UNBOUNDED", max_loss: -200, breakevens: [767] },
    source_boundary: { terms: "server_held_qualified_reference", terms_temporal_basis: "dated_reference",
      reference_as_of: "2026-10-23", current_terms_qualified: false, original_response_bytes_replayed: false, installed_observation_sha256: "b".repeat(64), discovery_snapshot_authenticated: false,
      current_quote_eligible: false, historical_first_availability_established: false, reference_request_count: 0,
      reference_sha256: "a".repeat(64), reference_observed_at: "2026-10-23T20:00:00Z" } };
}
