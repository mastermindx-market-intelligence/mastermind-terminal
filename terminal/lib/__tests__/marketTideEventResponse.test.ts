import { describe, expect, it } from "vitest";
import { parseMarketTideEventResponse } from "../marketTideEventResponse";

const windowRef = "synthetic:2026-11-04T14:20Z..14:29Z";
const receipt = (source_ref: string) => ({
  source_ref, revision: "1", rights_ref: "synthetic:no-license", status: "complete",
  observed_at: "2026-11-04T14:29:00Z", usable_at: "2026-11-04T14:29:30Z",
  return_window_ref: windowRef,
});
const valid = () => ({
  schema: "market_tide.event_response/v1",
  evidence_class: "OBSERVATION",
  decision_at: "2026-11-04T14:30:00.000001Z",
  interpretation: "descriptive_noncausal",
  forecast: null, hedge_flow: null,
  authority: {
    may_rank: false, may_gate: false, may_size: false,
    may_trade: false, may_alert: false, may_forecast: false,
  },
  market_status: "admitted", market_reason: null,
  event_count_known: 2, event_count_withheld: 1,
  events: [
    {
      event_id: "fictional:earnings", event_type: "earnings",
      source_ref: "synthetic:filing", revision: "1",
      known_at: "2026-11-04T10:00:00Z",
      resolution_state: "resolved", status: "admitted",
    },
    {
      event_id: "fictional:election", event_type: "election",
      source_ref: "synthetic:official", revision: "1",
      known_at: "2026-11-04T10:00:00Z",
      resolution_state: "unresolved", status: "admitted",
    },
  ],
  securities: [
    {
      security_id: "synthetic:MCD", ticker: "MCD",
      status: "observed", reason: null, return_pct: 6,
      source: {
        source_ref: "synthetic:bar", revision: "1",
        rights_ref: "synthetic:no-license", status: "partial",
        observed_at: "2026-11-04T14:29:00Z",
        usable_at: "2026-11-04T14:29:30Z", return_window_ref: windowRef,
      },
      event_links: [
        {
          event_id: "fictional:earnings", channel: "demand",
          evidence_class: "verified_fact", source_ref: "synthetic:filing",
          scenario_direction: null, causality_established: false,
        },
        {
          event_id: "fictional:election", channel: "policy",
          evidence_class: "hypothesis", source_ref: "synthetic:research",
          scenario_direction: "mixed", causality_established: false,
        },
      ],
      decomposition: {
        market_pct: 2, sector_excess_pct: 1, unexplained_pct: 3,
        method: "market_plus_sector_excess/v1", causal_attribution: false,
      },
      factor_receipts: {
        market: receipt("synthetic:SPY"),
        sector: receipt("synthetic:XLP"),
        return_window_ref: windowRef,
      },
    },
    {
      security_id: "synthetic:SEMIS", ticker: "SEMIS",
      status: "unavailable", reason: "STALE_SOURCE",
      return_pct: null, source: null, event_links: [], decomposition: null,
    },
  ],
  coverage: { eligible: 2, observed: 1, modeled: 1, unavailable: 1,
    event_links_withheld: 0 },
});

describe("Market Tide observed-response consumer", () => {
  it("preserves separate company and policy events without claiming causality", () => {
    const x = parseMarketTideEventResponse(valid());
    expect(x).toMatchObject({
      kind: "observed_noncausal_event_response",
      coverage: { eligible: 2, observed: 1, modeled: 1, unavailable: 1,
        eventsWithheld: 1 },
      tradingAllowed: false, publishingAllowed: false,
      forecastAvailable: false, hedgeFlowAvailable: false,
    });
    expect(x?.rows[0].eventLinks.map(l => l.eventId))
      .toEqual(["fictional:earnings", "fictional:election"]);
    expect(x?.rows[0].decomposition?.unexplainedPct).toBe(3);
    expect(x?.rows[1]).toMatchObject({ status: "unavailable", returnPct: null,
      reason: "STALE_SOURCE" });
  });

  const mutate = (fn: (v: ReturnType<typeof valid>) => void) => {
    const x = valid();
    fn(x);
    return x;
  };

  it("does not mutate the machine result", () => {
    const source = valid();
    const clone = structuredClone(source);
    expect(parseMarketTideEventResponse(source)).not.toBeNull();
    expect(source).toEqual(clone);
  });

  it("rejects later information by microsecond, not millisecond", () => {
    const x = mutate(v => { v.events[0].known_at = "2026-11-04T14:30:00.000002Z"; });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("rejects late sector evidence in a claimed factor decomposition", () => {
    const x = mutate(v => {
      v.securities[0].factor_receipts!.sector.usable_at = "2026-11-04T14:31:00Z";
    });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("rejects mismatched return windows", () => {
    const x = mutate(v => {
      v.securities[0].factor_receipts!.sector.return_window_ref = "synthetic:different";
    });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("rejects unavailable observations disguised as valid", () => {
    const x = mutate(v => { v.securities[1].return_pct = 0 as never; });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("rejects false coverage denominators", () => {
    const x = mutate(v => { v.coverage.observed = 2; });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("rejects incorrect decomposition arithmetic", () => {
    const x = mutate(v => { v.securities[0].decomposition!.unexplained_pct = -8; });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("rejects synthetic causal attribution", () => {
    const x = mutate(v => {
      v.securities[0].event_links[0].causality_established = true;
    });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("rejects arbitrary forecast or hedge-flow payload", () => {
    for (const key of ["forecast", "hedge_flow"] as const) {
      const x = valid();
      (x as Record<string, unknown>)[key] = { directional_probability: 0.9 };
      expect(parseMarketTideEventResponse(x)).toBeNull();
    }
  });

  it("rejects any authority escalation", () => {
    const x = mutate(v => { v.authority.may_alert = true; });
    expect(parseMarketTideEventResponse(x)).toBeNull();
    const y = valid() as Record<string, unknown>;
    y.authority = { ...valid().authority, may_publish: true };
    expect(parseMarketTideEventResponse(y)).toBeNull();
  });

  it("rejects event-linked future or absent identities", () => {
    const x = mutate(v => { v.securities[0].event_links[0].event_id = "unknown"; });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("rejects repeated security identities", () => {
    const x = mutate(v => {
      v.securities[1].security_id = v.securities[0].security_id;
    });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("rejects receipt availability after decision", () => {
    const x = mutate(v => {
      v.securities[0].source!.usable_at = "2026-11-04T14:31:00Z";
    });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("rejects impossible dates and naive timestamps", () => {
    const x = mutate(v => { v.decision_at = "2026-02-30T14:30:00Z"; });
    expect(parseMarketTideEventResponse(x)).toBeNull();
    const y = mutate(v => { v.decision_at = "2026-11-04T14:30:00"; });
    expect(parseMarketTideEventResponse(y)).toBeNull();
  });

  it("rejects event revision duplicate", () => {
    const x = mutate(v => { v.events[1].event_id = v.events[0].event_id; });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("rejects unsupported evidence status", () => {
    const x = mutate(v => { v.securities[0].event_links[0].evidence_class = "confirmed_trade" as never; });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("retains explicit missing cause and incomplete market status", () => {
    const x = { ...valid(), market_status: "unavailable",
      market_reason: "MISSING_MARKET_RETURN" };
    // This only validates the producer's report. It cannot independently
    // authenticate an unseen market source or imply fresh browser data.
    // A market-unavailable status cannot coexist with a valid decomposition.
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });

  it("rejects mutation of source into an impossible chronology", () => {
    const x = mutate(v => { v.securities[0].source!.observed_at = "2026-11-04T14:31:00Z"; });
    expect(parseMarketTideEventResponse(x)).toBeNull();
  });
});

// Added after the complete unchanged original 19-test file: strict
// actual-string membership at the six enum guard regions.

type Parsed = ReturnType<typeof parseMarketTideEventResponse>;
type X = Omit<ReturnType<typeof valid>, "market_reason"> & { market_reason: string | null };

const fresh = (): X => structuredClone(valid());
const dropLink = (x: X) => {
  x.securities[0].event_links.splice(0, 1);
  x.coverage.event_links_withheld = 1;
};
const unmodeled = (): X => {
  const x = fresh();
  x.market_status = "unavailable";
  x.market_reason = "MISSING_MARKET_RETURN";
  x.securities[0].decomposition = null;
  x.securities[0].factor_receipts = null as never;
  x.coverage.modeled = 0;
  return x;
};
const observedSource = {
  source_ref: "synthetic:bar2", revision: "1", rights_ref: "synthetic:no-license",
  status: "complete", observed_at: "2026-11-04T14:29:00Z",
  usable_at: "2026-11-04T14:29:30Z", return_window_ref: windowRef,
};
const coercing = (literal: string, hook: { count: number }) => ({
  toString: () => { hook.count += 1; return literal; },
});

const controls: Array<[string, string, (x: X) => void, (p: Parsed) => unknown]> = [
  ["receipt status", "complete", x => { x.securities[0].source!.status = "complete"; }, p => p?.rows[0].source?.status],
  ["receipt status", "partial", x => { x.securities[0].source!.status = "partial"; }, p => p?.rows[0].source?.status],
  ["event status", "admitted", x => { x.events[0].status = "admitted"; }, p => p?.events[0].status],
  ["event status", "resolution_unverified", x => { x.events[0].status = "resolution_unverified"; x.events[0].resolution_state = "unverified"; dropLink(x); }, p => p?.events[0].status],
  ["event resolution_state", "scheduled", x => { x.events[0].resolution_state = "scheduled"; }, p => p?.events[0].resolutionState],
  ["event resolution_state", "unresolved", x => { x.events[0].resolution_state = "unresolved"; }, p => p?.events[0].resolutionState],
  ["event resolution_state", "resolved", x => { x.events[0].resolution_state = "resolved"; }, p => p?.events[0].resolutionState],
  ["event resolution_state", "cancelled", x => { x.events[0].resolution_state = "cancelled"; }, p => p?.events[0].resolutionState],
  ["event resolution_state", "unverified", x => { x.events[0].status = "resolution_unverified"; x.events[0].resolution_state = "unverified"; dropLink(x); }, p => p?.events[0].resolutionState],
  ["security status", "observed", x => { const s = x.securities[1]; s.status = "observed"; s.reason = null; s.return_pct = 2.5; s.source = observedSource as never; s.decomposition = null; s.factor_receipts = null as never; x.coverage.observed = 2; x.coverage.unavailable = 0; }, p => p?.rows[1].status],
  ["security status", "unavailable", x => { x.securities[1].status = "unavailable"; }, p => p?.rows[1].status],
  ["link evidence_class", "verified_fact", x => { x.securities[0].event_links[0].evidence_class = "verified_fact"; }, p => p?.rows[0].eventLinks[0].evidenceClass],
  ["link evidence_class", "scenario", x => { x.securities[0].event_links[0].evidence_class = "scenario"; }, p => p?.rows[0].eventLinks[0].evidenceClass],
  ["link evidence_class", "hypothesis", x => { x.securities[0].event_links[0].evidence_class = "hypothesis"; }, p => p?.rows[0].eventLinks[0].evidenceClass],
  ["market status", "admitted", x => { x.market_status = "admitted"; }, p => p?.marketStatus],
  ["market status", "unavailable", x => { x.market_status = "unavailable"; x.market_reason = "MISSING_MARKET_RETURN"; x.securities[0].decomposition = null; x.securities[0].factor_receipts = null as never; x.coverage.modeled = 0; }, p => p?.marketStatus],
];

const malformed: Array<[string, string, (v: unknown) => X, (p: Parsed) => unknown]> = [
  ["receipt status", "partial", v => { const x = fresh(); x.securities[0].source!.status = v as never; return x; }, p => p?.rows[0].source?.status],
  ["event status", "admitted", v => { const x = fresh(); x.events[0].status = v as never; dropLink(x); return x; }, p => p?.events[0].status],
  ["event resolution_state", "resolved", v => { const x = fresh(); x.events[0].resolution_state = v as never; return x; }, p => p?.events[0].resolutionState],
  ["security status", "unavailable", v => { const x = fresh(); x.securities[1].status = v as never; return x; }, p => p?.rows[1].status],
  ["link evidence_class", "verified_fact", v => { const x = fresh(); x.securities[0].event_links[0].evidence_class = v as never; return x; }, p => p?.rows[0].eventLinks[0].evidenceClass],
  ["market status", "unavailable", v => { const x = unmodeled(); x.market_status = v as never; return x; }, p => p?.marketStatus],
];

describe("Market Tide strict actual-string enum membership", () => {
  it.each(controls)("admits the valid literal at the %s guard", (name, literal, norm, pick) => {
    const x = fresh();
    norm(x);
    const p = parseMarketTideEventResponse(x);
    expect(p, `${name}: expected a parsed view`).not.toBeNull();
    expect(typeof pick(p!), `${name}: projected value must be a primitive string`).toBe("string");
    expect(pick(p!), `${name}: projected value`).toBe(literal);
    expect(p).toMatchObject({ forecastAvailable: false, hedgeFlowAvailable: false, tradingAllowed: false, publishingAllowed: false });
  });

  it.each(malformed)("rejects a singleton array at the %s guard", (name, literal, build, pick) => {
    const p = parseMarketTideEventResponse(build([literal]));
    expect(p, `${name}: parser must reject the complete malformed input`).toBeNull();
    expect(pick(p) ?? null, `${name}: singleton array [${literal}] was admitted`).toBeNull();
  });

  it.each(malformed)("rejects a coercing object at the %s guard", (name, literal, build, pick) => {
    const hook = { count: 0 };
    const p = parseMarketTideEventResponse(build(coercing(literal, hook)));
    expect(p, `${name}: parser must reject the complete malformed input`).toBeNull();
    expect(pick(p) ?? null, `${name}: coercing object was admitted`).toBeNull();
    expect(hook.count, `${name}: coercion hook must not be invoked`).toBe(0);
  });
});
