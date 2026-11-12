// Data OS U02 — deriveDataOrigin: the pure rules that turn a daily-OHLC document's
// `view` block (schema terminal.ohlc_view.v1, produced by ingest/polygon_bars.py)
// into the frame-bar readout state. A file with NO view is the normal production
// state today and must read "unknown" — never an error, never a claimed "adjusted".
import { describe, expect, it } from "vitest";
import { deriveDataOrigin, originComposite, originNotCovered, originPending, originUnavailable } from "@/lib/dataOrigin";

const AS_OF = "2026-10-13T00:00:00Z";
const REV = "rev-2026-10-13-0007";

function contract(basis = "tradj") {
  return {
    schema: "dataos.view_contract.v1",
    purpose: "terminal_daily_ohlc",
    identity_namespace: "mmx/us/daily",
    field_units: { o: "vendor_adjusted_usd" },
    adjustment_reference: { basis, action_revision_set_id: REV, as_at: AS_OF },
    evidence_mode: { mode: "CURRENT", clock: "td_close", dependency_generation_ids: ["g1"], code_version: "1" },
    coverage: { from: "1999-01-04", to: "2026-10-10" },
    refusal_reasons: [],
  };
}

function view(overrides: Record<string, unknown> = {}) {
  return {
    schema: "terminal.ohlc_view.v1",
    contract: contract(),
    listing: { security_id: "s1", listing_id: "l1", mic: "XNAS", src: "polygon", refusal_reasons: [] },
    segments: [{ from: "1999-01-04", to: "2026-10-10", src: "polygon", bar_quality: "raw" }],
    basis_drift: null,
    suspected_breaks: [],
    refusal_reasons: [],
    ...overrides,
  };
}

function doc(overrides: Record<string, unknown> = {}) {
  return { t: "NVDA", o: 1, src: "polygon", bar_quality: "raw", bars: [], view: view(), ...overrides };
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

describe("deriveDataOrigin", () => {
  it("u02_fix_known: tradj contract with no refusals is known, with contract facts copied verbatim", () => {
    const o = deriveDataOrigin("NVDA", doc());
    expect(o.state).toBe("known");
    expect(o.symbol).toBe("NVDA");
    expect(o.basis).toBe("tradj");
    expect(o.src).toBe("polygon");
    expect(o.asOf).toBe(AS_OF);
    expect(o.generation).toBe(REV);
    expect(o.mode).toBe("CURRENT");
    expect(o.refusals).toEqual([]);
    expect(o.openReconstructed).toBe(false);
    expect(o.segments).toEqual([{ from: "1999-01-04", to: "2026-10-10", src: "polygon", quality: "raw" }]);
    expect(o.suspectedBreaks).toBe(0);
    expect(o.basisDrift).toBe(false);
  });

  it("u02_fix_partial: a tradj contract with a caveat refusal is partial", () => {
    const o = deriveDataOrigin("NVDA", doc({ view: view({ refusal_reasons: ["SEGMENT_SRC_UNKNOWN"] }) }));
    expect(o.state).toBe("partial");
    expect(o.basis).toBe("tradj");
    expect(o.refusals).toEqual(["SEGMENT_SRC_UNKNOWN"]);
  });

  it("u02_fix_legacy_unknown: a real-shape legacy doc (no view) reads unknown/VIEW_ABSENT, never adjusted", () => {
    const o = deriveDataOrigin("NVDA", { t: "NVDA", o: 1, src: "deep", bar_quality: "synthetic_open_deepstore", bars: [] });
    expect(o.state).toBe("unknown");
    expect(o.refusals).toEqual(["VIEW_ABSENT"]);
    expect(o.src).toBe("deep");
    expect(o.openReconstructed).toBe(true);
    expect(o.basis).toBe(null);
    expect(o.segments).toEqual([]);
  });

  it.each(["VIEW_BASIS_UNSUPPORTED", "VENUE_OUT_OF_SCOPE", "LISTING_ABSENT"] as const)(
    "u02_fix_refused: %s refuses the view with no basis claim",
    (code) => {
      const o = deriveDataOrigin("NVDA", doc({ view: view({ refusal_reasons: [code] }) }));
      expect(o.state).toBe("refused");
      expect(o.basis).toBe(null);
      expect(o.refusals).toEqual([code]);
    },
  );

  it("u02_fix_refused: a basis other than tradj is refused and labelled VIEW_BASIS_UNSUPPORTED", () => {
    const o = deriveDataOrigin("NVDA", doc({ view: view({ contract: contract("sadj") }) }));
    expect(o.state).toBe("refused");
    expect(o.basis).toBe(null);
    expect(o.refusals).toEqual(["VIEW_BASIS_UNSUPPORTED"]);
  });

  it("u02_fix_contract_null: a view without a contract is unknown", () => {
    const o = deriveDataOrigin("NVDA", doc({ view: view({ contract: null }) }));
    expect(o.state).toBe("unknown");
    expect(o.basis).toBe(null);
    expect(o.src).toBe("polygon");   // segment/listing src still describes the file honestly
  });

  it("u02_fix_src_unknown_literal: the literal 'unknown' prints as null, never a lower-layer guess", () => {
    // Whichever layer WINS the chain, the literal "unknown" maps to null.
    const unknownListing = doc({
      view: view({
        listing: { src: "unknown" },
        segments: [{ from: "a", to: "b", src: "polygon", bar_quality: "raw" }],
      }),
    });
    expect(deriveDataOrigin("NVDA", unknownListing).src).toBe(null);
    expect(deriveDataOrigin("NVDA", { t: "NVDA", src: "unknown", bars: [] }).src).toBe(null);
    // A usable top-level src still loses to the listing layer's concrete answer.
    expect(deriveDataOrigin("NVDA", doc({ src: "unknown" })).src).toBe("polygon");
  });

  it("u02_fix_symbol_mismatch: a file for another symbol is never adopted", () => {
    const o = deriveDataOrigin("NVDA", doc({ t: "amd" }));
    expect(o.state).toBe("unknown");
    expect(o.refusals).toEqual(["SYMBOL_MISMATCH"]);
  });

  it("u02_fix_null_payload: no document is unavailable/DATA_ABSENT, distinct from unknown", () => {
    for (const payload of [null, undefined, "x", 7]) {
      const o = deriveDataOrigin("NVDA", payload);
      expect(o.state).toBe("unavailable");
      expect(o.refusals).toEqual(["DATA_ABSENT"]);
    }
  });

  it("u02_fix_pure: a deep-frozen payload neither throws nor changes", () => {
    const payload = deepFreeze(doc({
      view: view({
        refusal_reasons: ["BASIS_DRIFT_SUSPECTED"],
        basis_drift: { status: "SUSPECTED", date: "2026-10-09", stored_close: 1, vendor_close: 2, ratio: 2 },
        suspected_breaks: [{ status: "SUSPECTED", at: "2010-06-01", reason: "gap", retained_bars: 3 }],
      }),
    }));
    const before = JSON.stringify(payload);
    const o = deriveDataOrigin("NVDA", payload);
    expect(o.state).toBe("partial");
    expect(o.suspectedBreaks).toBe(1);
    expect(o.basisDrift).toBe(true);
    expect(JSON.stringify(payload)).toBe(before);
  });
});

describe("origin constructors", () => {
  it("originPending carries no facts", () => {
    const o = originPending("NVDA");
    expect(o).toMatchObject({ symbol: "NVDA", state: "pending", basis: null, src: null, asOf: null, generation: null, mode: null, openReconstructed: false, suspectedBreaks: 0, basisDrift: false, refusals: [], segments: [] });
  });
  it("originUnavailable is the failure state", () => {
    expect(originUnavailable("NVDA")).toMatchObject({ state: "unavailable", refusals: ["DATA_UNAVAILABLE"] });
  });
  it("originComposite is per-leg, not claimed in v1", () => {
    expect(originComposite("AAPL+MSFT")).toMatchObject({ state: "composite", refusals: ["COMPOSITE_NOT_IN_V1"] });
  });
  it("originNotCovered names its code", () => {
    expect(originNotCovered("NVDA", "INTRADAY_NOT_IN_V1")).toMatchObject({ state: "unknown", refusals: ["INTRADAY_NOT_IN_V1"] });
  });
});

// B1 — the source clock (sourceLastSession): the document's OWN last daily session,
// carried as an optional field that is strictly separate from the adjustment reference.
// asOf/generation keep answering adjustment_reference.as_at/action_revision_set_id and
// nothing else; the source clock never fills them, and every non-qualifying document
// omits the field entirely instead of guessing.
describe("sourceLastSession (B1 source clock)", () => {
  const LAST = "2026-10-09";
  const bar = (t: unknown) => [t, 1, 2, 0.5, 1.5, 10];
  const withBars = (overrides: Record<string, unknown> = {}) => doc({ bars: [bar("2026-10-05"), bar(LAST)], ...overrides });

  it("u02_b1_known: a known tradj doc gains its own last session; the adjustment references are unchanged", () => {
    const o = deriveDataOrigin("NVDA", withBars());
    expect(o.sourceLastSession).toBe(LAST);
    expect(o.state).toBe("known");
    expect(o.basis).toBe("tradj");
    expect(o.asOf).toBe(AS_OF);
    expect(o.generation).toBe(REV);
    expect(o.mode).toBe("CURRENT");
  });

  it("u02_b1_partial: a partial tradj doc keeps both the caveats and its source session", () => {
    const o = deriveDataOrigin("NVDA", withBars({ view: view({ refusal_reasons: ["SEGMENT_SRC_UNKNOWN"] }) }));
    expect(o.state).toBe("partial");
    expect(o.sourceLastSession).toBe(LAST);
    expect(o.asOf).toBe(AS_OF);
    expect(o.generation).toBe(REV);
  });

  it("u02_b1_legacy: a legacy doc (no view) gains the source clock while basis/asOf/generation stay unknown", () => {
    const o = deriveDataOrigin("NVDA", { t: "NVDA", o: 1, src: "deep", bar_quality: "raw", bars: [bar(LAST)] });
    expect(o.state).toBe("unknown");
    expect(o.refusals).toEqual(["VIEW_ABSENT"]);
    expect(o.sourceLastSession).toBe(LAST);
    expect(o.basis).toBe(null);
    expect(o.asOf).toBe(null);
    expect(o.generation).toBe(null);
  });

  it("u02_b1_contract_null: the source clock is a document fact, not a contract fact", () => {
    const o = deriveDataOrigin("NVDA", withBars({ view: view({ contract: null }) }));
    expect(o.state).toBe("unknown");
    expect(o.sourceLastSession).toBe(LAST);
    expect(o.basis).toBe(null);
    expect(o.asOf).toBe(null);
    expect(o.generation).toBe(null);
  });

  it("u02_b1_no_field: empty/missing bars and non-tuple last bars never qualify", () => {
    expect(deriveDataOrigin("NVDA", withBars({ bars: [] })).sourceLastSession).toBeUndefined();
    expect(deriveDataOrigin("NVDA", doc({})).sourceLastSession).toBeUndefined();
    expect(deriveDataOrigin("NVDA", withBars({ bars: [{ t: LAST, o: 1 }] })).sourceLastSession).toBeUndefined();
    expect(deriveDataOrigin("NVDA", withBars({ bars: [["2026-10-05"]] })).sourceLastSession).toBe("2026-10-05");
  });

  it("u02_b1_wrong_symbol: a wrong or merely case-variant document is never adopted", () => {
    // A different symbol is refused outright.
    const wrong = deriveDataOrigin("NVDA", withBars({ t: "AMD" }));
    expect(wrong.refusals).toEqual(["SYMBOL_MISMATCH"]);
    expect(wrong.sourceLastSession).toBeUndefined();
    // The case-insensitive mismatch guard tolerates a case-variant file, but the exact
    // source-clock gate does not: no field rather than an adopted guess.
    expect(deriveDataOrigin("NVDA", withBars({ t: "nvda" })).sourceLastSession).toBeUndefined();
  });

  it.each(["2026-13-01", "2026-02-30", "2026-04-31", "20261009", "2026-10", "not-a-date", ""])(
    "u02_b1_invalid_date: %s never qualifies",
    (bad) => {
      expect(deriveDataOrigin("NVDA", withBars({ bars: [bar(bad)] })).sourceLastSession).toBeUndefined();
    },
  );

  it("u02_b1_numeric_time: an intraday numeric epoch in the last tuple never qualifies", () => {
    expect(deriveDataOrigin("NVDA", withBars({ bars: [bar(1760006400000)] })).sourceLastSession).toBeUndefined();
  });

  it("u02_b1_calendar: only a real UTC-calendar date qualifies (leap years included)", () => {
    expect(deriveDataOrigin("NVDA", withBars({ bars: [bar("2024-02-29")] })).sourceLastSession).toBe("2024-02-29");
    expect(deriveDataOrigin("NVDA", withBars({ bars: [bar("2023-02-29")] })).sourceLastSession).toBeUndefined();
    expect(deriveDataOrigin("NVDA", withBars({ bars: [bar("2000-02-29")] })).sourceLastSession).toBe("2000-02-29");
    expect(deriveDataOrigin("NVDA", withBars({ bars: [bar("1900-02-29")] })).sourceLastSession).toBeUndefined();
  });

  it("u02_b1_pure: a deep-frozen payload neither throws nor changes", () => {
    const payload = deepFreeze(withBars({ view: view({ refusal_reasons: ["SEGMENT_SRC_UNKNOWN"] }) }));
    const before = JSON.stringify(payload);
    const o = deriveDataOrigin("NVDA", payload);
    expect(o.state).toBe("partial");
    expect(o.sourceLastSession).toBe(LAST);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it("u02_b1_constructors_unchanged: the no-date constructors still carry no source clock key", () => {
    for (const o of [originPending("NVDA"), originUnavailable("NVDA"), originComposite("AAPL+MSFT"), originNotCovered("NVDA", "INTRADAY_NOT_IN_V1")]) {
      expect("sourceLastSession" in o).toBe(false);
    }
    // And a non-qualifying document leaves the key absent, not present-with-null.
    expect("sourceLastSession" in deriveDataOrigin("NVDA", doc({}))).toBe(false);
    expect("sourceLastSession" in deriveDataOrigin("NVDA", withBars({ t: "AMD" }))).toBe(false);
  });
});
