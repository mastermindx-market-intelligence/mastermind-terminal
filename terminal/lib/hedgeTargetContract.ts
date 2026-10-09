/**
 * Consumer-only projection of Macro options.hedge_target_change/v1.
 * No pricing, signing, fetching, publication, or forecast lifecycle lives here.
 * A structurally valid receipt is still a caller assertion, never data admission.
 */
export interface HedgeTargets {
  anchor_target: number;
  endpoint_target: number;
  target_change: number;
  reference_notional_usd: number;
  gross_contract_target_changes: number;
  /** abs(net)/gross: zero is maximal cancellation, one is no cancellation. */
  cancellation_ratio: number | null;
}
export interface HedgeAttribution {
  method: "symmetric_inventory_repricing";
  repricing: number;
  inventory: number;
  linear_approximation: number;
  linear_residual: number;
  identity_residual: number;
}
export interface HedgeExpiry {
  option_root: "SPX" | "SPXW";
  expiry: string;
  fixing_at: string;
  target_change: number;
}
export interface HedgeCohort {
  cohort: "0DTE" | "1-7D" | "8+D";
  contracts: number;
  anchor_target: number;
  endpoint_target: number;
  target_change: number;
}
const authorityKeys = ["calibrated_probability", "actual_dealer_inventory", "executed_flow",
  "trading", "can_publish", "ranking", "portfolio", "sizing", "auto_exit"] as const;
type Authority = Record<(typeof authorityKeys)[number], false>;
export interface HedgeTargetView {
  kind: "conditional_hedge_target";
  contentId: string;
  status: "complete_for_supplied_universe" | "unavailable";
  observedAt: string;
  asOf: string;
  targetAt: string;
  spot: number;
  targetSpot: number;
  scope: { kind: "all_supplied_expiries" | "selected_supplied_expiries";
    expiries: string[] | null; universeRef: string; expectedContracts: number;
    receivedContracts: number; selectedContracts: number; missingContracts: string[] };
  source: { reference: string; sourceRevision: string | null; contractReferenceRevision: string | null;
    observedAt: string; receivedAt: string; consumerAvailableAt: string;
    /** Age at payload asOf, not an assertion of freshness at browser render time. */
    ageAtDecisionSeconds: number };
  inventory: { scenarioId: string; method: string; dealerFraction: number | null;
    nontradeAssumption: "supplied" | "assumed_zero" | null };
  assumptions: { pricing: string; volMap: string; ivShift: number; rate: number; dividendYield: number;
    maxSourceAgeSeconds: number };
  units: { target_change: "SPX_index_equivalent_units";
    reference_notional_usd: "target_SPX_times_change_in_hedge_units" };
  authority: Authority;
  hedge: HedgeTargets | null;
  attribution: HedgeAttribution | null;
  byExpiry: HedgeExpiry[];
  byCohort: HedgeCohort[];
  unavailableReasons: string[];
}

type Obj = Record<string, unknown>;
const record = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const positive = (x: unknown): x is number => finite(x) && x > 0;
const text = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const nullableText = (x: unknown): x is string | null => x === null || text(x);
const instant = (x: unknown): x is string => text(x) && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));
const day = (x: unknown): x is string => text(x) && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const integer = (x: unknown): x is number => finite(x) && Number.isSafeInteger(x) && x >= 0;
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(text);
const unique = (xs: string[]) => new Set(xs).size === xs.length;
const close = (a: number, b: number, ...scale: number[]) => [a, b, ...scale].every(Number.isFinite) &&
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b), ...scale.map(Math.abs));
const numeric = <K extends string>(x: unknown, keys: readonly K[]): x is Obj & Record<K, number> =>
  record(x) && keys.every(k => finite(x[k]));
const rows = (x: unknown): x is Obj[] => Array.isArray(x) && x.every(record);
const flowMethods = ["supplied_prior_minus_participation_times_signed_flow/v1",
  "supplied_prior_minus_participation_times_signed_flow_plus_adjustments/v1"];
const etDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
function etDay(instant: string): string {
  const parts = etDateFormat.formatToParts(new Date(instant));
  return ["year", "month", "day"].map(k => parts.find(p => p.type === k)?.value).join("-");
}
function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map(key => [key, value[key]])) as Pick<T, K>;
}

export function parseHedgeTargetChange(value: unknown): HedgeTargetView | null {
  if (!record(value)) return null;
  const v = value;
  if (v.schema !== "options.hedge_target_change/v1" || v.evidence_class !== "SCENARIO" || v.root !== "SPX" ||
      !text(v.content_id) || !/^hedge-target:[a-f0-9]{64}$/.test(v.content_id) ||
      !instant(v.observed_at) || !instant(v.as_of) || !instant(v.target_at) ||
      !positive(v.spot) || !positive(v.target_spot) || !text(v.inventory_scenario_id)) return null;
  const observed = Date.parse(v.observed_at), cutoff = Date.parse(v.as_of), target = Date.parse(v.target_at);
  if (observed > cutoff || target < observed) return null;
  const s = v.source_receipt, c = v.coverage, a = v.assumptions, inv = v.inventory_assumptions;
  if (!record(s) || !text(s.source_ref) || !nullableText(s.source_revision) || !nullableText(s.contract_reference_revision) ||
      !instant(s.source_observed_at) || !instant(s.received_at) || !instant(s.consumer_available_at)) return null;
  const source = Date.parse(s.source_observed_at), received = Date.parse(s.received_at), available = Date.parse(s.consumer_available_at);
  if (source > observed || source > received || received > available || available > cutoff ||
      !finite(v.source_age_seconds) || v.source_age_seconds < 0 || !close(v.source_age_seconds, (cutoff - source) / 1000)) return null;
  if (!record(a) || a.pricing !== "engine.intraday_greeks.bs_greeks_vec" ||
      a.pricing_convention !== "European_constant_carry_pricing_delta" || a.year_days !== 365 ||
      a.cohort_convention !== "anchor_calendar_days_America/New_York" ||
      !["sticky_strike_parallel_shift", "supplied_contract_endpoint_iv"].includes(String(a.vol_map)) ||
      !finite(a.iv_shift) || !finite(a.r) || !finite(a.q) || !positive(a.max_source_age_seconds)) return null;
  if (!record(inv) || !text(inv.method) || (inv.method !== "supplied_signed_positions" && !flowMethods.includes(inv.method))) return null;
  if (flowMethods.includes(inv.method) && (!finite(inv.dealer_fraction) || inv.dealer_fraction < 0 || inv.dealer_fraction > 1 ||
      !["supplied", "assumed_zero"].includes(String(inv.nontrade_assumption)))) return null;
  const authority = v.authority;
  if (!record(authority) || !authorityKeys.every(k => authority[k] === false) ||
      !record(v.units) || v.units.target_change !== "SPX_index_equivalent_units" ||
      v.units.reference_notional_usd !== "target_SPX_times_change_in_hedge_units") return null;
  if (!record(c) || c.scope !== "supplied_universe" || !text(c.universe_ref) ||
      !strings(c.expected_contract_ids) || !c.expected_contract_ids.length || !unique(c.expected_contract_ids) ||
      !strings(c.missing_contract_ids) || !unique(c.missing_contract_ids) || !integer(c.received) || !integer(c.selected) ||
      !(c.expiry_scope === null || (strings(c.expiry_scope) && c.expiry_scope.length > 0 && unique(c.expiry_scope) && c.expiry_scope.every(day))) ||
      !rows(v.contracts) || v.contracts.length !== c.received) return null;
  const ids = new Set<string>(), economics = new Set<string>();
  for (const row of v.contracts) {
    if (!text(row.contract_id) || ids.has(row.contract_id) || !c.expected_contract_ids.includes(row.contract_id) ||
        !((row.option_root === "SPX" && row.settlement === "AM") || (row.option_root === "SPXW" && row.settlement === "PM")) ||
        !day(row.expiry) || !instant(row.fixing_at) || etDay(row.fixing_at) !== row.expiry ||
        !["0DTE", "1-7D", "8+D", "past_expiry"].includes(String(row.anchor_cohort)) ||
        !["0DTE", "1-7D", "8+D", "past_expiry"].includes(String(row.endpoint_cohort)) ||
        !positive(row.strike) || row.multiplier !== 100 ||
        !["C", "P"].includes(String(row.right))) return null;
    const key = [row.option_root, row.expiry, row.right, row.strike].join(":");
    if (economics.has(key)) return null;
    ids.add(row.contract_id); economics.add(key);
  }
  const missing = c.expected_contract_ids.filter(id => !ids.has(id));
  const declaredMissing = c.missing_contract_ids;
  if (missing.length !== declaredMissing.length || !missing.every(id => declaredMissing.includes(id))) return null;
  const scope = c.expiry_scope;
  const selected = v.contracts.filter(row => scope === null || scope.includes(String(row.expiry)));
  if (selected.length !== c.selected || !strings(v.unavailable_reasons) || !unique(v.unavailable_reasons) ||
      !rows(v.by_expiry) || !rows(v.by_cohort)) return null;
  if (v.status === "unavailable") {
    if (!v.unavailable_reasons.length || v.hedge !== null || v.attribution !== null || v.by_expiry.length || v.by_cohort.length) return null;
  } else if (v.status === "complete_for_supplied_universe") {
    if (v.unavailable_reasons.length || missing.length || !selected.length || v.source_age_seconds > a.max_source_age_seconds ||
        (scope !== null && scope.some(expiry => !selected.some(row => row.expiry === expiry))) ||
        selected.some(row => !finite(row.n0) || !finite(row.n1) || !positive(row.iv) || !positive(row.target_iv) || Date.parse(String(row.fixing_at)) <= target)) return null;
    const h = v.hedge, attr = v.attribution;
    if (!numeric(h, ["anchor_target", "endpoint_target", "target_change", "reference_notional_usd", "gross_contract_target_changes"] as const) ||
        h.gross_contract_target_changes < 0 || !record(h) ||
        !(h.cancellation_ratio === null || (finite(h.cancellation_ratio) && h.cancellation_ratio >= 0 && h.cancellation_ratio <= 1)) ||
        !close(h.endpoint_target - h.anchor_target, h.target_change, h.anchor_target, h.endpoint_target) ||
        !close(h.reference_notional_usd, v.target_spot * h.target_change) ||
        h.gross_contract_target_changes + 1e-9 < Math.abs(h.target_change) ||
        (h.gross_contract_target_changes === 0 ? h.cancellation_ratio !== null : !finite(h.cancellation_ratio) || !close(h.cancellation_ratio, Math.abs(h.target_change) / h.gross_contract_target_changes))) return null;
    if (!numeric(attr, ["repricing", "inventory", "linear_approximation", "linear_residual", "identity_residual"] as const) ||
        !record(attr) || attr.method !== "symmetric_inventory_repricing" ||
        !close(attr.repricing + attr.inventory + attr.identity_residual, h.target_change) ||
        !close(attr.linear_approximation + attr.linear_residual, h.target_change)) return null;
    const groups = new Set(selected.map(row => [row.option_root, row.expiry, row.fixing_at].join("|")));
    if (v.by_expiry.length !== groups.size) return null;
    for (const row of v.by_expiry) {
      const key = [row.option_root, row.expiry, row.fixing_at].join("|");
      if (!groups.delete(key) || !finite(row.target_change)) return null;
    }
    if (!close(v.by_expiry.reduce((sum, row) => sum + Number(row.target_change), 0), h.target_change)) return null;
    const cohorts = new Set(["0DTE", "1-7D", "8+D"]);
    if (v.by_cohort.length !== cohorts.size) return null;
    for (const row of v.by_cohort) {
      if (!cohorts.delete(String(row.cohort)) || !integer(row.contracts) ||
          !numeric(row, ["anchor_target", "endpoint_target", "target_change"] as const) ||
          row.contracts !== selected.filter(leg => leg.anchor_cohort === row.cohort).length ||
          !close(row.endpoint_target - row.anchor_target, row.target_change, row.anchor_target, row.endpoint_target)) return null;
    }
    for (const key of ["anchor_target", "endpoint_target", "target_change"] as const) {
      if (!close(v.by_cohort.reduce((sum, row) => sum + Number(row[key]), 0), h[key])) return null;
    }
    if (v.by_cohort.reduce((sum, row) => sum + Number(row.contracts), 0) !== selected.length) return null;
  } else return null;
  return {
    kind: "conditional_hedge_target", contentId: v.content_id, status: v.status,
    observedAt: v.observed_at, asOf: v.as_of, targetAt: v.target_at, spot: v.spot, targetSpot: v.target_spot,
    scope: { kind: scope === null ? "all_supplied_expiries" : "selected_supplied_expiries",
      expiries: scope === null ? null : [...scope], universeRef: c.universe_ref,
      expectedContracts: c.expected_contract_ids.length, receivedContracts: c.received, selectedContracts: c.selected, missingContracts: [...missing] },
    source: { reference: s.source_ref, sourceRevision: s.source_revision, contractReferenceRevision: s.contract_reference_revision,
      observedAt: s.source_observed_at, receivedAt: s.received_at, consumerAvailableAt: s.consumer_available_at, ageAtDecisionSeconds: v.source_age_seconds },
    inventory: { scenarioId: v.inventory_scenario_id, method: inv.method,
      dealerFraction: finite(inv.dealer_fraction) ? inv.dealer_fraction : null,
      nontradeAssumption: inv.nontrade_assumption === "supplied" || inv.nontrade_assumption === "assumed_zero" ? inv.nontrade_assumption : null },
    assumptions: { pricing: a.pricing, volMap: String(a.vol_map), ivShift: a.iv_shift, rate: a.r, dividendYield: a.q, maxSourceAgeSeconds: a.max_source_age_seconds },
    units: { target_change: "SPX_index_equivalent_units", reference_notional_usd: "target_SPX_times_change_in_hedge_units" },
    authority: Object.fromEntries(authorityKeys.map(k => [k, false])) as Authority,
    hedge: v.hedge === null ? null : pick(v.hedge as unknown as HedgeTargets,
      ["anchor_target", "endpoint_target", "target_change", "reference_notional_usd", "gross_contract_target_changes", "cancellation_ratio"]),
    attribution: v.attribution === null ? null : pick(v.attribution as unknown as HedgeAttribution,
      ["method", "repricing", "inventory", "linear_approximation", "linear_residual", "identity_residual"]),
    byExpiry: v.by_expiry.map(row => pick(row as unknown as HedgeExpiry,
      ["option_root", "expiry", "fixing_at", "target_change"])),
    byCohort: v.by_cohort.map(row => pick(row as unknown as HedgeCohort,
      ["cohort", "contracts", "anchor_target", "endpoint_target", "target_change"])),
    unavailableReasons: [...v.unavailable_reasons],
  };
}
